// spend-gate.test.mjs — the pure arithmetic of the budget-ceiling gate, and the
// run a dispatch resolves against, without a machine's real cost history.
//   node --test skills/orchestrate/scripts/lib/spend-gate.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { overCeiling, budgetDecision, runFor, tagFor } from './spend-gate.mjs';

// ---- overCeiling: pure arithmetic ------------------------------------------

test('overCeiling is null when there is no ceiling or no price to estimate', () => {
  assert.equal(overCeiling(5, 1, null), null);
  assert.equal(overCeiling(5, null, 10), null);
});

test('overCeiling returns the numbers once already-spent plus the estimate crosses the ceiling', () => {
  const over = overCeiling(9, 2, 10);
  assert.deepEqual(over, { already: 9, est: 2, total: 11, ceiling: 10 });
});

test('overCeiling is null when the total lands exactly on the ceiling, not past it', () => {
  assert.equal(overCeiling(8, 2, 10), null);
});

test('overCeiling rounds to cents and treats a missing already-spent as zero', () => {
  const over = overCeiling(undefined, 10.005, 5);
  assert.equal(over.already, 0);
  assert.equal(over.est, 10.01);
});

// ---- budgetDecision: the gate as a whole -----------------------------------

test('budgetDecision is null when the dispatch names no model', () => {
  assert.equal(budgetDecision({}, { subagent_type: 'orch-implementer' }, { budget: { ceiling: 1 }, spend: 0 }), null);
});

test('budgetDecision is null when the run has no budget ceiling set', () => {
  const run = { runId: 'r1', spend: 0, budget: null };
  assert.equal(budgetDecision({}, { subagent_type: 'orch-implementer', model: 'claude-sonnet-4-5' }, run), null);
});

test('budgetDecision is null when there is no run resolved at all', () => {
  assert.equal(budgetDecision({}, { subagent_type: 'orch-implementer', model: 'claude-sonnet-4-5' }, null), null);
});

// ---- runFor: which run a packet bills against ------------------------------

test('runFor prefers a RUN: line named in the packet over the session binding', () => {
  const ti = { prompt: 'TASK: 1-2-3\nRUN: 20260101-example\nsome text' };
  assert.equal(runFor({ session_id: 's1' }, ti), '20260101-example');
});

test('runFor falls back to nothing when neither a RUN: line nor a session binding exists', () => {
  assert.equal(runFor({ session_id: 'unbound-session' }, { prompt: 'no run line here' }), null);
});

// ---- tagFor: no model named means no price tag -----------------------------

test('tagFor is empty when the dispatch names no model, and never throws', () => {
  assert.equal(tagFor({ subagent_type: 'orch-implementer', prompt: '' }), '');
});

test('tagFor prints the plain tag by default, and the solo/helper pair only when told to', () => {
  const ti = { subagent_type: 'orch-implementer', model: 'sonnet', prompt: '' };
  assert.doesNotMatch(tagFor(ti), /done in this chat/);
  assert.match(tagFor(ti, { pair: true }), /done in this chat/);
});
