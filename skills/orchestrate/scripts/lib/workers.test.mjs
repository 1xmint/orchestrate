// workers.test.mjs — who is working right now, across providers: the pure
// concurrency rule, the reset-time parser, and the file-backed worker
// registry and provider-exhaustion store.
//   node --test skills/orchestrate/scripts/lib/workers.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  concurrencyDecision, parseResetTime, registerWorker, unregisterWorker, runningExternal,
  markExhausted, exhaustedFor, roleOf, cappedNote, lockHolder, lockedWorktreeIn, roleModel,
} from './workers.mjs';
import { loadPolicy } from './policy.mjs';

const policy = () => loadPolicy(null);
const dir = () => mkdtempSync(join(tmpdir(), 'orch-workers-'));

// ---- roleModel: each role's own model, read from its agent file -----------

test('roleModel reads what each of the eight orch- role files names', () => {
  assert.equal(roleModel('orch-implementer'), 'sonnet');
  assert.equal(roleModel('orch-researcher'), 'sonnet');
  assert.equal(roleModel('orch-browser'), 'sonnet');
  assert.equal(roleModel('orch-planner'), 'opus');
  assert.equal(roleModel('orch-reviewer'), 'opus');
  assert.equal(roleModel('orch-advisor'), 'opus');
  assert.equal(roleModel('orch-coordinator'), 'opus');
  assert.equal(roleModel('orch-debugger'), 'opus');
});

test('roleModel is null for a role with no agent file, and normalizes an install-prefixed role', () => {
  assert.equal(roleModel('general-purpose'), null);
  assert.equal(roleModel('claude'), null);
  assert.equal(roleModel('Explore'), null);
  assert.equal(roleModel('orchestrate:orch-implementer'), 'sonnet');
});

// ---- concurrencyDecision: pure rule -----------------------------------------

test('concurrencyDecision allows the first dispatch with nothing running', () => {
  assert.equal(concurrencyDecision('orch-implementer', { policy: policy() }), null);
});

test('concurrencyDecision denies a direct dispatch once maxConcurrent direct workers are running', () => {
  const native = [{ provider: 'claude', role: 'orch-researcher' }, { provider: 'claude', role: 'orch-implementer' }];
  const d = concurrencyDecision('orch-reviewer', { native, policy: policy() });
  assert.match(d, /2 workers are already running/);
});

test('concurrencyDecision serializes browser work regardless of the general limit', () => {
  const native = [{ provider: 'claude', role: 'orch-browser', task: 'check the UI' }];
  const d = concurrencyDecision('orch-browser', { native, policy: policy() });
  assert.match(d, /browser work is serial/);
});

test('a live coordinator\'s child draws on that coordinator\'s own 2-slot pool, not the session-wide pool', () => {
  const native = [
    { provider: 'claude', role: 'orch-coordinator', agentId: 'coord-1' },
    { provider: 'claude', role: 'orch-researcher', task: 't1' },
    { provider: 'claude', role: 'orch-implementer', task: 't2' },
  ];
  // The session-wide pool already has 3 direct workers >= maxConcurrent(2), but
  // this candidate is the coordinator's own child, so it is unaffected.
  const d = concurrencyDecision('orch-researcher', { native, policy: policy(), coordinatorParentId: 'coord-1' });
  assert.equal(d, null);
});

test('a coordinator\'s own two child slots are enforced independently of the session pool', () => {
  const native = [
    { provider: 'claude', role: 'orch-coordinator', agentId: 'coord-1' },
    { provider: 'claude', role: 'orch-researcher', parent: 'coord-1', task: 'a' },
    { provider: 'claude', role: 'orch-implementer', parent: 'coord-1', task: 'b' },
  ];
  const d = concurrencyDecision('orch-researcher', { native, policy: policy(), coordinatorParentId: 'coord-1' });
  assert.match(d, /already has 2 of its own children/);
});

// ---- parseResetTime ------------------------------------------------------------

test('parseResetTime reads a relative "try again in N hours" offset', () => {
  const now = Date.parse('2026-01-01T00:00:00Z');
  assert.equal(parseResetTime('please try again in 2 hours', now), now + 2 * 3600000);
});

test('parseResetTime reads a bare clock time, rolling to the next day when it has already passed', () => {
  const now = new Date(2026, 0, 1, 14, 0, 0).getTime();
  const reset = parseResetTime('try again at 1:00 PM', now);
  assert.ok(reset > now, 'rolled forward to the next occurrence of 1 PM');
});

test('parseResetTime returns null when the message names no time at all', () => {
  assert.equal(parseResetTime('you are out of quota', Date.now()), null);
});

// ---- roleOf and cappedNote ----------------------------------------------------

test('roleOf strips a plugin prefix and defaults an empty role to general-purpose', () => {
  assert.equal(roleOf('orchestrate:orch-implementer'), 'orch-implementer');
  assert.equal(roleOf(''), 'general-purpose');
  assert.equal(roleOf(undefined), 'general-purpose');
});

test('cappedNote reports only unshown capped returns, then marks them shown so it is said once', () => {
  const state = { returned: [{ agent: 'orch-implementer', task: 'x', turns: 40, capped: true }] };
  const first = cappedNote(state);
  assert.match(first, /stopped at the turn cap/);
  assert.equal(cappedNote(state), '', 'already marked shown, so silent the second time');
});

// ---- lockedWorktreeIn / lockHolder --------------------------------------------

test('lockedWorktreeIn finds an external worker whose worktree path appears in the packet text', () => {
  // A path that is absolute on the machine running the test.
  const wt = process.platform === 'win32' ? 'C:/repo/worktree-a' : '/repo/worktree-a';
  const external = [{ worktree: wt, pid: 1, task: 'x' }];
  assert.ok(lockedWorktreeIn(`please work in ${wt} now`, external));
  assert.equal(lockedWorktreeIn('unrelated text', external), null);
});

test('lockHolder matches a worktree path case-insensitively on Windows-style separators', () => {
  const external = [{ worktree: 'C:/repo/worktree-a', pid: 1 }];
  const hit = lockHolder('C:\\repo\\worktree-a\\', external);
  assert.equal(hit.pid, 1);
});

// ---- file-touching: the worker registry and provider-exhaustion store --------

test('registerWorker writes an entry that runningExternal reads back while the process is alive', () => {
  const d = dir();
  registerWorker({ taskId: 'task-1', provider: 'codex', role: 'orch-implementer', pid: process.pid, worktree: d }, d);
  const running = runningExternal(d, pid => pid === process.pid);
  assert.equal(running.length, 1);
  assert.equal(running[0].task, 'task-1');
});

test('runningExternal drops and removes an entry whose process has gone', () => {
  const d = dir();
  registerWorker({ taskId: 'task-dead', provider: 'codex', pid: 999999 }, d);
  const running = runningExternal(d, () => false);
  assert.equal(running.length, 0, 'a crashed worker does not hold a slot');
});

test('unregisterWorker removes the entry so it no longer shows as running', () => {
  const d = dir();
  registerWorker({ taskId: 'task-2', provider: 'codex', pid: process.pid }, d);
  unregisterWorker('task-2', d);
  assert.equal(runningExternal(d, () => true).length, 0);
});

test('markExhausted then exhaustedFor round-trips through disk, and lifts once the reset time has passed', () => {
  const d = dir();
  const now = Date.parse('2026-01-01T00:00:00Z');
  markExhausted({ provider: 'codex', account: 'acct-1', scope: 'run-1', message: 'try again in 1 hour', now }, d);
  const hit = exhaustedFor({ provider: 'codex', account: 'acct-1' }, d, now + 1000);
  assert.ok(hit, 'still exhausted a second later');
  const lifted = exhaustedFor({ provider: 'codex', account: 'acct-1' }, d, now + 2 * 3600000);
  assert.equal(lifted, null, 'lifted once the stated reset time has passed');
});
