// lib/persist-words.test.mjs — the one place router.mjs still reads wording,
// tested directly against the pure functions rather than through a spawned
// router process (router.test.mjs and persist.test.mjs keep those).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PERSIST_INTENT, syntheticPrompt, persistIntent, GOAL_CAP, persistLine } from './persist-words.mjs';

test('lib/persist-words.mjs exports exactly the names this concern owns', async () => {
  const mod = await import('./persist-words.mjs');
  assert.deepEqual(Object.keys(mod).sort(), ['GOAL_CAP', 'PERSIST_INTENT', 'approves', 'barePersistPhrase', 'promptIntent', 'persistIntent', 'persistLine', 'syntheticPrompt'].sort());
});

test('syntheticPrompt recognizes a background-task notice and a hand-back, not ordinary talk about them', () => {
  assert.equal(syntheticPrompt('  [SYSTEM NOTIFICATION - NOT USER INPUT] x'), true);
  assert.equal(syntheticPrompt('the system notification said to keep going'), false);
  for (const t of [
    '<agent-message from="orch-implementer">\n[Subagent hand-back]\nkeep going',
    '[Subagent hand-back]\nbuild the entire dashboard',
    'Another Claude session sent a message: fix the tests',
    '<ci-monitor-event>build the whole thing</ci-monitor-event>',
  ]) {
    assert.equal(syntheticPrompt(t), true, t);
  }
  assert.equal(syntheticPrompt('please tell me about agent-message formats'), false);
});

test('persistIntent matches an explicit ask to keep going, never a question', () => {
  assert.equal(persistIntent('keep going until it is done'), true);
  assert.equal(persistIntent('should we keep going until it is done?'), false, 'a question never arms it');
  assert.equal(persistIntent(''), false);
  assert.equal(persistIntent('add a --json flag'), false);
  assert.match(PERSIST_INTENT.source, /keep \(going/);
});

test('persistLine says nothing when not armed, and caps the goal at GOAL_CAP', () => {
  assert.equal(persistLine(null), '');
  assert.equal(persistLine({ armed: false, goal: 'x' }), '');
  const short = persistLine({ armed: true, goal: 'ship the thing' });
  assert.match(short, /auto-continue is on toward: "ship the thing"/);
  const long = persistLine({ armed: true, goal: 'x'.repeat(GOAL_CAP + 50) });
  const quoted = /toward: "([^"]*)"/.exec(long)[1];
  assert.ok(quoted.length <= GOAL_CAP, `${quoted.length} <= ${GOAL_CAP}`);
  assert.match(quoted, /\.\.\.$/);
});
