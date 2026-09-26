// lib/state-line.test.mjs — the `router status` line and its pieces, tested
// directly against the pure functions rather than through a spawned process.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stateLine, stateHash, readyPhrase, ungradedPhrase } from './state-line.mjs';

test('lib/state-line.mjs exports exactly the sixteen names this concern owns', async () => {
  const mod = await import('./state-line.mjs');
  assert.deepEqual(Object.keys(mod).sort(), [
    'stateLine', 'statusReply', 'actionableLine', 'contextBand', 'contextPhrase', 'quotaPhrase', 'quotaBand',
    'READY_SHOWN', 'readyPhrase', 'ungradedPhrase', 'budgetPhrase', 'progressPhrase', 'edgesPhrase', 'runPhrase',
    'stateHash', 'codexState',
  ].sort());
});

test('state line and hash carry context bands', () => {
  const base = { self: null, tier: 'pro', agents: 0, limits: [], candidates: [], run: null, quota: null, persist: false };
  assert.match(stateLine({ ...base, context: { tokens: 151000 } }, '[x]'), /ctx ~151k/);
  assert.match(stateLine({ ...base, context: { tokens: 52000 } }, '[x]'), /ctx ~52k/, 'the measured size is always shown');
  assert.notEqual(stateHash({ ...base, context: { tokens: 121000 } }), stateHash({ ...base, context: { tokens: 151000 } }));
  assert.match(stateLine({ ...base, codex: 'limit', context: null }, '[x]'), /codex: limit/);
  assert.notEqual(stateHash({ ...base, codex: 'limit', context: null }), stateHash({ ...base, codex: 'ok', context: null }));
});

test('a long ready list is trimmed rather than filling the line', () => {
  const ready = Array.from({ length: 9 }, (_, i) => `9-8-000${i + 1}`);
  const phrase = readyPhrase({ ready });
  assert.match(phrase, /ready now: 9-8-0001, 9-8-0002, 9-8-0003, 9-8-0004 \+5 more/);
  assert.ok(phrase.length < 80, `${phrase.length} characters is small enough to print every turn`);
  assert.equal(readyPhrase({ ready: [] }), '');
  assert.equal(readyPhrase(null), '');
});

test('a long list of owed returns is trimmed like the ready one', () => {
  const ungraded = Array.from({ length: 7 }, (_, i) => `9-8-000${i + 1}`);
  const phrase = ungradedPhrase({ ungraded });
  assert.match(phrase, /7 returns to grade: 9-8-0001, 9-8-0002, 9-8-0003, 9-8-0004 \+3 more/);
  assert.equal(ungradedPhrase({ ungraded: [] }), '');
  assert.equal(ungradedPhrase(null), '');
});
