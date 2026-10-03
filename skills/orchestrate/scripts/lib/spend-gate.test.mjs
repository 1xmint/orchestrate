// spend-gate.test.mjs — the pure arithmetic of the budget-ceiling gate, and the
// run a dispatch resolves against, without a machine's real cost history.
//   node --test skills/orchestrate/scripts/lib/spend-gate.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { overCeiling, budgetDecision, runFor, tagFor, effectiveModel } from './spend-gate.mjs';

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

test('budgetDecision prices a role that names no model on its own agent file\'s model', () => {
  // A run with a $2 ceiling and $1.90 spent refused a builder that named
  // sonnet and let the same builder through when it named nothing, though it
  // runs on its file's Sonnet either way; a coordinator (Opus) too.
  const run = { runId: 'r1', budget: { ceiling: 2 }, spend: 1.9 };
  const named = budgetDecision({}, { subagent_type: 'orch-implementer', model: 'sonnet' }, run, []);
  const unnamed = budgetDecision({}, { subagent_type: 'orch-implementer' }, run, []);
  assert.ok(named, 'named: refused');
  assert.deepEqual(unnamed, named, 'unnamed: refused the same way');
  assert.equal(unnamed.model, 'sonnet');
  assert.equal(unnamed.est, 1.5);
  const coordinator = budgetDecision({}, { subagent_type: 'orchestrate:orch-coordinator' }, run, []);
  assert.equal(coordinator && coordinator.model, 'opus');
  assert.equal(budgetDecision({}, { subagent_type: 'Explore', model: 'haiku' }, run, []), null, 'a dispatch that fits under the ceiling passes');
});

test('budgetDecision refuses a dispatch nobody can price only once the run has reached its ceiling', () => {
  const over = { runId: 'r2', budget: { ceiling: 2 }, spend: 2.5 };
  const under = { runId: 'r3', budget: { ceiling: 2 }, spend: 0.5 };
  for (const ti of [{ subagent_type: 'claude-code-guide', model: 'haiku' }, { subagent_type: 'general-purpose' }]) {
    const d = budgetDecision({}, ti, over, []);
    assert.ok(d, ti.subagent_type);
    assert.equal(d.est, null);
    assert.equal(budgetDecision({}, ti, under, []), null, `${ti.subagent_type} under the ceiling`);
  }
  assert.ok(budgetDecision({}, { subagent_type: 'orch-implementer' }, over, []), 'a priced role over the ceiling, with no model named');
  assert.ok(budgetDecision({}, { subagent_type: 'orch-implementer', model: 'sonnet' }, over, []), 'and with one named');
});

test('budgetDecision is null when the run has no budget ceiling set', () => {
  const run = { runId: 'r1', spend: 0, budget: null };
  assert.equal(budgetDecision({}, { subagent_type: 'orch-implementer', model: 'claude-sonnet-4-5' }, run, []), null);
  assert.equal(budgetDecision({}, { subagent_type: 'orch-implementer' }, run, []), null);
});

test('budgetDecision is null when there is no run resolved at all', () => {
  assert.equal(budgetDecision({}, { subagent_type: 'orch-implementer', model: 'claude-sonnet-4-5' }, null, []), null);
});

// ---- runFor: which run a packet bills against ------------------------------

test('runFor prefers a RUN: line named in the packet over the session binding', () => {
  const ti = { prompt: 'TASK: 1-2-3\nRUN: 20260101-example\nsome text' };
  assert.equal(runFor({ session_id: 's1' }, ti), '20260101-example');
});

test('runFor falls back to nothing when neither a RUN: line nor a session binding exists', () => {
  assert.equal(runFor({ session_id: 'unbound-session' }, { prompt: 'no run line here' }), null);
});

// ---- effectiveModel: the model that actually runs --------------------------

test('effectiveModel is the named model when one is given', () => {
  assert.equal(effectiveModel({ subagent_type: 'orch-implementer', model: 'opus' }), 'opus');
});

test('effectiveModel falls back to the role\'s own agent-file model when none is named', () => {
  assert.equal(effectiveModel({ subagent_type: 'orch-implementer' }), 'sonnet');
  assert.equal(effectiveModel({ subagent_type: 'orch-reviewer' }), 'opus');
});

test('effectiveModel is empty for a role with no agent file, naming no model', () => {
  assert.equal(effectiveModel({ subagent_type: 'general-purpose' }), '');
  assert.equal(effectiveModel({ subagent_type: 'claude' }), '');
});

// ---- tagFor: no model named means no price tag, unless the role has one ---

test('tagFor is empty when a role with no agent file (general-purpose) names no model, and never throws', () => {
  assert.equal(tagFor({ subagent_type: 'general-purpose', prompt: '' }), '');
});

test('tagFor prices an orch- role on its own file\'s model even when the dispatch names none', () => {
  assert.match(tagFor({ subagent_type: 'orch-implementer', prompt: '' }), /price tag: orch-implementer on sonnet/);
});

test('tagFor prints the plain tag by default, and the solo/helper pair only when told to', () => {
  const ti = { subagent_type: 'orch-implementer', model: 'sonnet', prompt: '' };
  assert.doesNotMatch(tagFor(ti), /done in this chat/);
  assert.match(tagFor(ti, { pair: true }), /done in this chat/);
});
