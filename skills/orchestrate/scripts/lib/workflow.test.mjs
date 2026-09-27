// lib/workflow.test.mjs — the uncapped-helper gate (general-purpose/claude vs
// a capped role agent), keyed on orch-implementer specifically rather than a
// full 8-of-8 install count.
//   node --test skills/orchestrate/scripts/lib/workflow.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { workflowDecision } from './workflow.mjs';
import { AGENT_NAMES } from './tier.mjs';
import { loadPolicy } from './policy.mjs';

const policy = loadPolicy();
const ti = (subagent_type = 'general-purpose') => ({ subagent_type, model: 'sonnet', prompt: 'TASK: 1\ndo it' });
const ALL_MISSING = AGENT_NAMES.slice();
const NONE_MISSING = [];
const THREE_WITH_IMPLEMENTER_MISSING = AGENT_NAMES.filter(n => n !== 'orch-implementer').slice(0, 5); // 3 installed incl. implementer
const THREE_WITHOUT_IMPLEMENTER_MISSING = AGENT_NAMES.filter(n => n !== 'orch-planner' && n !== 'orch-researcher' && n !== 'orch-browser'); // orch-implementer itself missing

test('0 of 8 installed: general-purpose is allowed, it is the only choice', () => {
  assert.equal(workflowDecision({}, ti(), { policy, installed: 0, missing: ALL_MISSING }), null);
});

test('3 of 8 installed, including orch-implementer: refused, naming the count and the missing files', () => {
  const d = workflowDecision({}, ti(), { policy, installed: 3, missing: THREE_WITH_IMPLEMENTER_MISSING });
  assert.ok(d);
  assert.match(d.reason, /no turn cap/);
  assert.match(d.reason, /3 of 8/);
  assert.match(d.reason, /orch-planner\.md/);
});

test('3 of 8 installed, orch-implementer itself missing: still allowed', () => {
  assert.equal(workflowDecision({}, ti(), { policy, installed: 3, missing: THREE_WITHOUT_IMPLEMENTER_MISSING }), null);
});

test('8 of 8 installed: refused as before, no missing-files sentence needed', () => {
  const d = workflowDecision({}, ti(), { policy, installed: AGENT_NAMES.length, missing: NONE_MISSING });
  assert.ok(d);
  assert.match(d.reason, /no turn cap/);
  assert.doesNotMatch(d.reason, /missing:/);
});

test('policy.workers.generalPurpose = allow overrides the gate even with orch-implementer installed', () => {
  const allow = { ...policy, workers: { ...policy.workers, generalPurpose: 'allow' } };
  assert.equal(workflowDecision({}, ti(), { policy: allow, installed: AGENT_NAMES.length, missing: NONE_MISSING }), null);
});

test('claude is treated the same as general-purpose', () => {
  const d = workflowDecision({}, ti('claude'), { policy, installed: 3, missing: THREE_WITH_IMPLEMENTER_MISSING });
  assert.match(d.reason, /no turn cap/);
});
