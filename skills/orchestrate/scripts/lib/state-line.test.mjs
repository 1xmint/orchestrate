// lib/state-line.test.mjs — the `router status` line and its pieces, tested
// directly against the pure functions rather than through a spawned process.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stateLine, statusReply, statusOpener, actionableLine, stateHash, readyPhrase, ungradedPhrase, budgetPhrase } from './state-line.mjs';
import { AGENT_NAMES } from './tier.mjs';

test('lib/state-line.mjs exports exactly the seventeen names this concern owns', async () => {
  const mod = await import('./state-line.mjs');
  assert.deepEqual(Object.keys(mod).sort(), [
    'stateLine', 'statusReply', 'statusOpener', 'actionableLine', 'contextBand', 'contextPhrase', 'quotaPhrase', 'quotaBand',
    'READY_SHOWN', 'readyPhrase', 'ungradedPhrase', 'budgetPhrase', 'progressPhrase', 'edgesPhrase', 'runPhrase',
    'stateHash', 'codexState',
  ].sort());
});

// ---- statusReply opens with one actionable sentence, chosen by state -------

const baseCtx = { self: null, tier: 'pro', agents: AGENT_NAMES.length, limits: [], candidates: [], run: null, quota: null, persist: false, context: null };

test('statusOpener leads with an actionable fact when one exists (limit reached)', () => {
  const ctx = { ...baseCtx, limits: ['codex'] };
  const opener = statusOpener(ctx);
  assert.equal(opener, actionableLine(ctx));
  assert.match(opener, /limit on Codex is reached/);
  assert.ok(opener.length < 120);
});

test('statusOpener leads with an actionable fact when one exists (run continues this session)', () => {
  const ctx = { ...baseCtx, run: { runId: '20260101-thing', runMd: '.orchestrator/runs/20260101-thing/RUN.md' } };
  const opener = statusOpener(ctx);
  assert.match(opener, /This session continues the run at/);
  assert.ok(opener.length < 120);
});

test('statusOpener leads with an actionable fact when one exists (auto-continue on)', () => {
  const ctx = { ...baseCtx, persist: true };
  const opener = statusOpener(ctx);
  assert.match(opener, /Auto-continue is on/);
  assert.ok(opener.length < 120);
});

test('statusOpener names the missing helper roles when the install is incomplete', () => {
  const ctx = { ...baseCtx, agents: AGENT_NAMES.length - 3 };
  const opener = statusOpener(ctx);
  assert.match(opener, new RegExp(`Only ${AGENT_NAMES.length - 3} of ${AGENT_NAMES.length} helper roles are installed`));
  assert.match(opener, /finish the install/);
  assert.ok(opener.length < 120);
});

test('statusOpener says nothing is running when no run is bound and none is a lone candidate', () => {
  const opener = statusOpener(baseCtx);
  assert.match(opener, /^Nothing is running; describe what you want built/);
  assert.ok(opener.length < 120);
});

test('statusOpener nudges the in-progress run when one is bound and nothing else is actionable', () => {
  const ctx = { ...baseCtx, run: { runId: '20260101-thing' } };
  const opener = statusOpener(ctx);
  assert.equal(opener, 'Run 20260101-thing is in progress; say what to do next.');
  assert.ok(opener.length < 120);
});

test('statusReply opens with the same sentence as statusOpener, then the full state line', () => {
  const opener = statusOpener(baseCtx);
  const reply = statusReply(baseCtx);
  assert.ok(reply.startsWith(opener));
  assert.match(reply, /\[orchestrate\]/);
  assert.match(reply, /tier pro/);
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

test('the spend phrase says helper, not subagent, and that the figure is a list-price model', () => {
  assert.equal(budgetPhrase({ budget: { ceiling: 120 }, spend: 61.55 }), ' · helper spend ~$61.6/$120 at list price');
  assert.equal(budgetPhrase({ spend: 5 }), '', 'no ceiling, no running total');
  assert.doesNotMatch(budgetPhrase({ budget: { ceiling: null }, spend: 5 }), /\$/, 'no ceiling, no dollar sign');
  assert.doesNotMatch(budgetPhrase({ budget: { ceiling: 10 }, spend: 1 }), /subagent/);
});
