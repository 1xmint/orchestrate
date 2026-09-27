// workflow.test.mjs — the scheduling rules a dispatch must clear before the
// model rule or the spend gate ever run: nesting, plan mode, worktree
// isolation, a Codex worktree lock, and concurrency. The uncapped-helper
// install-count gate (workflowDecision's own line) is covered elsewhere.
//   node --test skills/orchestrate/scripts/lib/workflow.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { workflowDecision, nestedReason } from './workflow.mjs';
import { loadPolicy } from './policy.mjs';
import { AGENT_NAMES } from './tier.mjs';

const policy = () => loadPolicy(null);

test('a nested dispatch with no recorded parent is denied when policy.workers.nested is "coordinator" (the default)', () => {
  const input = { agent_id: 'helper-1' };
  const ti = { subagent_type: 'orch-researcher', model: 'haiku', prompt: '' };
  const d = workflowDecision(input, ti, { policy: policy() });
  assert.equal(d.prefix, 'workers');
  assert.equal(d.reason, nestedReason);
});

test('policy.workers.nested="deny" refuses every nested dispatch outright, with no lookup needed', () => {
  const p = { ...policy(), workers: { ...policy().workers, nested: 'deny' } };
  const d = workflowDecision({ agent_id: 'helper-1' }, { subagent_type: 'orch-researcher', model: 'haiku' }, { policy: p });
  assert.match(d.reason, /disabled by policy\.workers\.nested=deny/);
});

test('a recorded coordinator parent may dispatch an allowed child role, naming a model, within the depth-2 limit', () => {
  const dispatches = [{ toolUseId: 'tu1', agent: 'orch-coordinator', at: '2026-01-01T00:00:00Z' }];
  const files = new Map([['tu1', { agentId: 'coord-1', meta: { spawnDepth: 1 } }]]);
  const input = { agent_id: 'coord-1' };
  const ti = { subagent_type: 'orch-researcher', model: 'haiku', prompt: '' };
  const d = workflowDecision(input, ti, { policy: policy(), dispatches, files });
  assert.equal(d, null);
});

test('a coordinator child dispatch that names no model is denied', () => {
  const dispatches = [{ toolUseId: 'tu1', agent: 'orch-coordinator', at: '2026-01-01T00:00:00Z' }];
  const files = new Map([['tu1', { agentId: 'coord-1', meta: { spawnDepth: 1 } }]]);
  const d = workflowDecision({ agent_id: 'coord-1' }, { subagent_type: 'orch-researcher', model: '', prompt: '' }, { policy: policy(), dispatches, files });
  assert.match(d.reason, /must name its model/);
});

test('a non-coordinator parent may not dispatch a nested worker', () => {
  const dispatches = [{ toolUseId: 'tu1', agent: 'orch-implementer', at: '2026-01-01T00:00:00Z' }];
  const files = new Map([['tu1', { agentId: 'imp-1', meta: { spawnDepth: 1 } }]]);
  const d = workflowDecision({ agent_id: 'imp-1' }, { subagent_type: 'orch-researcher', model: 'haiku' }, { policy: policy(), dispatches, files });
  assert.match(d.reason, /only orch-coordinator may dispatch workers/);
});

// ---- plan mode --------------------------------------------------------------

test('plan mode denies a role that can change files, naming the read-only alternatives', () => {
  const d = workflowDecision({ permission_mode: 'plan' }, { subagent_type: 'orch-implementer', model: 'sonnet', prompt: '' }, { policy: policy() });
  assert.equal(d.prefix, 'plan');
  assert.match(d.reason, /orch-advisor/);
});

test('plan mode allows a read-only role, but still refuses one aimed at a worktree or carrying a PROGRESS line', () => {
  const ok = workflowDecision({ permission_mode: 'plan' }, { subagent_type: 'orch-researcher', model: 'haiku', prompt: 'find things' }, { policy: policy() });
  assert.equal(ok, null);
  const worktreeD = workflowDecision({ permission_mode: 'plan' }, { subagent_type: 'orch-researcher', model: 'haiku', prompt: 'WHERE: worktree: yes' }, { policy: policy() });
  assert.match(worktreeD.reason, /no worktrees/);
  const progressD = workflowDecision({ permission_mode: 'plan' }, { subagent_type: 'orch-researcher', model: 'haiku', prompt: 'PROGRESS: foo.md' }, { policy: policy() });
  assert.match(progressD.reason, /no progress files/);
});

// ---- worktree isolation -------------------------------------------------------

test('a worktree-isolated role sent at the shared checkout (worktree: no) is denied', () => {
  const d = workflowDecision({}, { subagent_type: 'orch-implementer', model: 'sonnet', prompt: 'WHERE: worktree: no' }, { policy: policy() });
  assert.equal(d.prefix, 'workers');
  assert.match(d.reason, /always works in its own worktree/);
});

test('a worktree-isolated role that does say worktree: yes clears the isolation check', () => {
  const d = workflowDecision({}, { subagent_type: 'orch-implementer', model: 'sonnet', prompt: 'WHERE: worktree: yes' }, { policy: policy() });
  assert.equal(d, null);
});

// ---- locked worktree and concurrency -----------------------------------------

test('a packet naming a worktree a live Codex worker holds is denied', () => {
  const external = [{ provider: 'codex', task: 'task-1', pid: 123, worktree: 'C:/repo/worktree-a' }];
  const d = workflowDecision({}, { subagent_type: 'orch-researcher', model: 'haiku', prompt: 'work in C:/repo/worktree-a please' }, { policy: policy(), external });
  assert.match(d.reason, /Codex worker/);
});

test('concurrency at the policy limit denies a new direct dispatch', () => {
  const native = [{ provider: 'claude', role: 'orch-researcher', task: 't1' }, { provider: 'claude', role: 'orch-implementer', task: 't2' }];
  const d = workflowDecision({}, { subagent_type: 'orch-researcher', model: 'haiku', prompt: '' }, { policy: policy(), native });
  assert.equal(d.prefix, 'workers');
  assert.match(d.reason, /already running/);
});

test('with nothing running and nothing named, a plain dispatch clears every rule', () => {
  const d = workflowDecision({}, { subagent_type: 'orch-implementer', model: 'sonnet', prompt: 'WHERE: worktree: yes' }, { policy: policy() });
  assert.equal(d, null);
});

// The uncapped-helper gate (general-purpose/claude vs a capped role agent),
// keyed on orch-implementer being installed rather than a full 8-of-8 count.
const fullPolicy = loadPolicy();
const ti = (subagent_type = 'general-purpose') => ({ subagent_type, model: 'sonnet', prompt: 'TASK: 1\ndo it' });
const ALL_MISSING = AGENT_NAMES.slice();
const NONE_MISSING = [];
const THREE_WITH_IMPLEMENTER_MISSING = AGENT_NAMES.filter(n => n !== 'orch-implementer').slice(0, 5); // 3 installed incl. implementer
const THREE_WITHOUT_IMPLEMENTER_MISSING = AGENT_NAMES.filter(n => n !== 'orch-planner' && n !== 'orch-researcher' && n !== 'orch-browser'); // orch-implementer itself missing

test('0 of 8 installed: general-purpose is allowed, it is the only choice', () => {
  assert.equal(workflowDecision({}, ti(), { policy: fullPolicy, installed: 0, missing: ALL_MISSING }), null);
});

test('3 of 8 installed, including orch-implementer: refused, naming the count and the missing files', () => {
  const d = workflowDecision({}, ti(), { policy: fullPolicy, installed: 3, missing: THREE_WITH_IMPLEMENTER_MISSING });
  assert.ok(d);
  assert.match(d.reason, /no turn cap/);
  assert.match(d.reason, /3 of 8/);
  assert.match(d.reason, /orch-planner\.md/);
});

test('3 of 8 installed, orch-implementer itself missing: still allowed', () => {
  assert.equal(workflowDecision({}, ti(), { policy: fullPolicy, installed: 3, missing: THREE_WITHOUT_IMPLEMENTER_MISSING }), null);
});

test('8 of 8 installed: refused as before, no missing-files sentence needed', () => {
  const d = workflowDecision({}, ti(), { policy: fullPolicy, installed: AGENT_NAMES.length, missing: NONE_MISSING });
  assert.ok(d);
  assert.match(d.reason, /no turn cap/);
  assert.doesNotMatch(d.reason, /missing:/);
});

test('policy.workers.generalPurpose = allow overrides the gate even with orch-implementer installed', () => {
  const allow = { ...policy, workers: { ...policy.workers, generalPurpose: 'allow' } };
  assert.equal(workflowDecision({}, ti(), { policy: allow, installed: AGENT_NAMES.length, missing: NONE_MISSING }), null);
});

test('claude is treated the same as general-purpose', () => {
  const d = workflowDecision({}, ti('claude'), { policy: fullPolicy, installed: 3, missing: THREE_WITH_IMPLEMENTER_MISSING });
  assert.match(d.reason, /no turn cap/);
});
