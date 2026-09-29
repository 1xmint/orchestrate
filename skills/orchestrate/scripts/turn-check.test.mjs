// turn-check.test.mjs — the session Stop heartbeat: the exported pure
// decisions (shouldBlock, heartbeatDecision, pickupSection) and the hook
// process's stdin/stdout contract.
//   node --test skills/orchestrate/scripts/turn-check.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { shouldBlock, heartbeatDecision, pickupSection, pickupHash, pickupWritten, IDLE_READY_MIN, reviewHoldDecision, unreviewedRiskFact, leftoverHelpers, leftoverText, mergedBranches, anyHelperRunning } from './turn-check.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const HOOK = join(HERE, 'turn-check.mjs');

function run(input, home = mkdtempSync(join(tmpdir(), 'orch-turncheck-home-'))) {
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: { ...process.env, HOME: home, USERPROFILE: home },
  });
  return { stdout: r.stdout, status: r.status };
}

// A repo with an open run — same shape as hooks.test.mjs's fixtureRepo, kept
// local here since that file does not export it.
function fixtureRepo(runId = '20260909-review-fixture') {
  const dir = mkdtempSync(join(tmpdir(), 'orch-turncheck-repo-'));
  mkdirSync(join(dir, '.git'), { recursive: true });
  const runDir = join(dir, '.orchestrator', 'runs', runId);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, 'RUN.md'), `# Run ${runId}

## Goal

Ship the flag.

## Tasks

| id | phase | role · model | task | acceptance evidence | attempts | result |
|---|---|---|---|---|---|---|
| 9-9-0001 | 🔨 running | implementer · sonnet | add the flag | the test passes | 0 | — |

## Pickup

Pickup prompt: continue from here
Pickup confidence: high
Resume risk: none
`);
  return { dir, runDir, runId, runMd: join(runDir, 'RUN.md') };
}

// Bind a session to a run and give it a `returned` row, the way ledger.mjs's
// SubagentStop handler would have left it.
function bindWithReturn(home, sessionId, repo, returnedRow, dispatches = []) {
  const dir = join(home, '.claude', 'orchestrate', 'sessions');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${sessionId}.json`), JSON.stringify({
    v: 1, session_id: sessionId,
    run: { root: repo.dir, runId: repo.runId, runMd: repo.runMd, boundAt: new Date().toISOString() },
    lastDispatchAt: new Date().toISOString(),
    returned: [returnedRow],
    dispatches,
  }));
}

// Session state with a `returned` row but no `run` at all — the way
// ledger.mjs leaves it when a tagged dispatch's return never had a run to
// file under (no ledger opened, or none bound this session).
function withReturnNoRun(home, sessionId, returnedRow, dispatches = []) {
  const dir = join(home, '.claude', 'orchestrate', 'sessions');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${sessionId}.json`), JSON.stringify({
    v: 1, session_id: sessionId,
    returned: [returnedRow],
    dispatches,
  }));
}

// ---- pickupSection / pickupWritten ---------------------------------------------

test('pickupSection extracts the text between the Pickup heading and the next heading', () => {
  const md = '## Goal\nfoo\n\n## Pickup\nPickup prompt: do the next thing\n\n## Other\nbar\n';
  assert.equal(pickupSection(md), 'Pickup prompt: do the next thing');
});

test('pickupSection is empty when there is no Pickup heading at all', () => {
  assert.equal(pickupSection('## Goal\nfoo\n'), '');
});

test('pickupWritten is false for a template placeholder and true for real text', () => {
  assert.equal(pickupWritten('Pickup prompt: <what to say next>'), false);
  assert.equal(pickupWritten('Pickup prompt: continue with step 3'), true);
  assert.equal(pickupWritten(''), false);
});

// ---- shouldBlock ----------------------------------------------------------------

test('shouldBlock is quiet when nothing has been dispatched this session', () => {
  const d = shouldBlock({ pickupHash: 'h1', section: '', lastDispatchAt: null, prev: {} });
  assert.equal(d.block, false);
});

test('shouldBlock blocks once when the Pickup was never written', () => {
  const d = shouldBlock({ pickupHash: 'h1', section: 'Pickup prompt: <fill in>', lastDispatchAt: '2026-01-01T00:00:00Z', prev: {} });
  assert.equal(d.block, true);
  assert.match(d.why, /never been written/);
});

test('shouldBlock is quiet once it already blocked for this exact text', () => {
  const d = shouldBlock({ pickupHash: 'h1', section: 'Pickup prompt: x', lastDispatchAt: '2026-01-01T00:00:00Z', prev: { blockedFor: 'h1' } });
  assert.equal(d.block, false);
  assert.match(d.why, /already blocked/);
});

test('shouldBlock is quiet when the Pickup text changed since the last check', () => {
  const d = shouldBlock({ pickupHash: 'h2', section: 'Pickup prompt: new text', lastDispatchAt: '2026-01-01T00:00:00Z', prev: { hash: 'h1' } });
  assert.equal(d.block, false);
  assert.match(d.why, /changed since/);
});

test('shouldBlock blocks when the hash is unchanged and a dispatch happened after the last check', () => {
  const d = shouldBlock({ pickupHash: 'h1', section: 'Pickup prompt: same text', lastDispatchAt: '2026-01-02T00:00:00Z', prev: { hash: 'h1', checkedAt: '2026-01-01T00:00:00Z' } });
  assert.equal(d.block, true);
  assert.match(d.why, /has not changed since the last dispatch/);
});

// ---- heartbeatDecision ------------------------------------------------------------

test('heartbeatDecision fires the idle nudge once, for at least IDLE_READY_MIN unblocked tasks', () => {
  const ready = Array.from({ length: IDLE_READY_MIN }, (_, i) => `task-${i}`);
  const first = heartbeatDecision({ run: { ready }, rec: {} });
  assert.equal(first.kind, 'idle');
  assert.match(first.why, /tasks are unblocked/);
  const again = heartbeatDecision({ run: { ready }, rec: first.rec });
  assert.equal(again.kind, null, 'same ready set already flagged, so quiet the second time');
});

test('heartbeatDecision advances the turn counter even when there is nothing to say', () => {
  const d = heartbeatDecision({ run: { ready: [] }, rec: { turns: 4 } });
  assert.equal(d.kind, null);
  assert.equal(d.rec.turns, 5);
});

test('heartbeatDecision does not nudge when fewer than IDLE_READY_MIN tasks are ready', () => {
  const d = heartbeatDecision({ run: { ready: ['only-one'] }, rec: {} });
  assert.equal(d.kind, null);
});

// ---- reviewHoldDecision -----------------------------------------------------

test('reviewHoldDecision blocks a task returned done, tagged for review, with no reviewer sent', () => {
  const d = reviewHoldDecision({
    returned: [{ task: '9-9-0001', status: 'PARTIAL', reviewGated: true }],
    dispatches: [{ task: '9-9-0001', agent: 'orch-implementer' }],
    lastMessage: 'All done, shipped it.',
    blockedFor: [],
  });
  assert.equal(d.block, true);
  assert.equal(d.task, '9-9-0001');
  assert.deepEqual(d.blockedFor, ['9-9-0001']);
});

test('reviewHoldDecision is quiet once a reviewer dispatch names the task under REVIEW OF', () => {
  const d = reviewHoldDecision({
    returned: [{ task: '9-9-0001', reviewGated: true }],
    dispatches: [{ task: '9-9-0500', agent: 'orch-reviewer', reviewOf: '9-9-0001' }],
    lastMessage: '',
    blockedFor: [],
  });
  assert.equal(d.block, false);
});

test('reviewHoldDecision is quiet while a reviewer is running, even one that named a wrong REVIEW OF id', () => {
  const d = reviewHoldDecision({
    returned: [{ status: 'DONE', toolUseId: 'tu1', at: '2026-01-01T00:00:10Z' }],
    dispatches: [
      { toolUseId: 'tu1', agent: 'orch-implementer', review: true, at: '2026-01-01T00:00:00Z' },
      { toolUseId: 'tu2', agent: 'orch-reviewer', reviewOf: 'task', at: '2026-01-01T00:00:05Z' },
    ],
    lastMessage: '',
    blockedFor: [],
  });
  assert.equal(d.block, false);
});

test('reviewHoldDecision is quiet when the lead\'s own closing message explains the review was skipped', () => {
  const d = reviewHoldDecision({
    returned: [{ task: '9-9-0001', reviewGated: true }],
    dispatches: [],
    lastMessage: 'I skipped the independent review because the change is a comment-only typo fix.',
    blockedFor: [],
  });
  assert.equal(d.block, false);
});

test('reviewHoldDecision does not block a task with no reviewGated row', () => {
  const d = reviewHoldDecision({ returned: [{ task: '9-9-0001', status: 'DONE' }], dispatches: [], lastMessage: '', blockedFor: [] });
  assert.equal(d.block, false);
});

test('reviewHoldDecision leaves a task already in blockedFor alone, resolved or not', () => {
  const d = reviewHoldDecision({
    returned: [{ task: '9-9-0001', reviewGated: true }],
    dispatches: [],
    lastMessage: '',
    blockedFor: ['9-9-0001'],
  });
  assert.equal(d.block, false);
  assert.deepEqual(d.blockedFor, ['9-9-0001']);
});

// A free-form brief has no task id: the hold keys on the dispatch call's id.
const FF_DISPATCH = { at: '2026-09-29T10:00:00.000Z', agent: 'orch-implementer', task: null, toolUseId: 'toolu_A', review: true };
const FF_RETURN = { at: '2026-09-29T10:05:00.000Z', agent: 'orch-implementer', toolUseId: 'toolu_A', task: null, status: 'DONE' };

test('reviewHoldDecision holds a flagged free-form dispatch that returned DONE with no review', () => {
  const d = reviewHoldDecision({ returned: [FF_RETURN], dispatches: [FF_DISPATCH], lastMessage: '', blockedFor: [] });
  assert.equal(d.block, true);
  assert.equal(d.task, 'toolu_A');
  assert.deepEqual(d.blockedFor, ['toolu_A']);
});

test('reviewHoldDecision lets a free-form return through once a reviewer was dispatched after it', () => {
  const later = { at: '2026-09-29T10:10:00.000Z', agent: 'orch-reviewer', task: null, toolUseId: 'toolu_R' };
  assert.equal(reviewHoldDecision({ returned: [FF_RETURN], dispatches: [FF_DISPATCH, later], lastMessage: '', blockedFor: [] }).block, false);
  const named = { ...later, reviewOf: 'toolu_A' };
  assert.equal(reviewHoldDecision({ returned: [FF_RETURN], dispatches: [FF_DISPATCH, named], lastMessage: '', blockedFor: [] }).block, false);
});

test('reviewHoldDecision does not hold an unflagged free-form dispatch, nor a reviewer\'s own return', () => {
  const plain = { ...FF_DISPATCH }; delete plain.review;
  assert.equal(reviewHoldDecision({ returned: [FF_RETURN], dispatches: [plain], lastMessage: '', blockedFor: [] }).block, false);
  const rev = { ...FF_DISPATCH, agent: 'orch-reviewer', reviewOf: 'toolu_Z' };
  assert.equal(reviewHoldDecision({ returned: [FF_RETURN], dispatches: [rev], lastMessage: '', blockedFor: [] }).block, false);
});

test('reviewHoldDecision with two open free-form returns does not let one unnamed reviewer clear both', () => {
  const two = { ...FF_DISPATCH, toolUseId: 'toolu_B' };
  const retB = { ...FF_RETURN, toolUseId: 'toolu_B' };
  const later = { at: '2026-09-29T10:10:00.000Z', agent: 'orch-reviewer', task: null, toolUseId: 'toolu_R' };
  const d = reviewHoldDecision({ returned: [FF_RETURN, retB], dispatches: [FF_DISPATCH, two, later], lastMessage: '', blockedFor: [] });
  assert.equal(d.block, true);
  const named = reviewHoldDecision({ returned: [FF_RETURN, retB], dispatches: [FF_DISPATCH, two, { ...later, reviewOf: 'toolu_A' }], lastMessage: '', blockedFor: [] });
  assert.equal(named.task, 'toolu_B', 'only the one the reviewer named is cleared');
});

// Live shape (a real run): the return has an agent id and toolUseId null; the
// dispatch row has both. The hold must still fire, and a reviewer clears it.
test('reviewHoldDecision matches a live return (toolUseId null) to its dispatch by agent id', () => {
  const disp = { ...FF_DISPATCH, agentId: 'a8c3248b76def6836' };
  const live = { ...FF_RETURN, toolUseId: null, agentId: 'a8c3248b76def6836' };
  const d = reviewHoldDecision({ returned: [live], dispatches: [disp], lastMessage: '', blockedFor: [] });
  assert.equal(d.block, true);
  assert.equal(d.task, 'toolu_A');
  const named = { at: '2026-09-29T10:10:00.000Z', agent: 'orch-reviewer', task: null, toolUseId: 'toolu_R', reviewOf: 'toolu_A' };
  assert.equal(reviewHoldDecision({ returned: [live], dispatches: [disp, named], lastMessage: '', blockedFor: [] }).block, false);
  const other = { ...live, agentId: 'not-a-dispatched-agent' };
  assert.equal(reviewHoldDecision({ returned: [other], dispatches: [disp], lastMessage: '', blockedFor: [] }).block, false);
});

// ---- risky work the lead built alone ---------------------------------------------

const editLine = (name, input, at = '2026-09-29T10:00:00.000Z') =>
  JSON.stringify({ type: 'assistant', timestamp: at, message: { content: [{ type: 'tool_use', name, input }] } });
const GOAL = 'a password check on the page that shows who paid what';

test('unreviewedRiskFact names sign-in when the lead edited a password check and no reviewer returned', () => {
  const tail = editLine('Edit', { file_path: 'server.js', old_string: 'a', new_string: 'if (req.body.password !== SECRET) return deny();' });
  const f = unreviewedRiskFact({ transcriptTail: tail, goal: '', returned: [] });
  assert.equal(f.text, 'this change touches sign-in; nobody independent has looked at it.');
});

test('unreviewedRiskFact uses the request when the edit itself is bland, and needs at least one edit', () => {
  const bland = editLine('Write', { file_path: 'a.js', content: 'export const x = 1;' });
  assert.equal(unreviewedRiskFact({ transcriptTail: bland, goal: GOAL, returned: [] }).topic, 'sign-in');
  assert.equal(unreviewedRiskFact({ transcriptTail: '', goal: GOAL, returned: [] }), null, 'no edit, nothing to say');
});

test('unreviewedRiskFact is silent for a session with no risky edit or request', () => {
  const tail = editLine('Edit', { file_path: 'notes.js', new_string: 'const title = "hello";' });
  assert.equal(unreviewedRiskFact({ transcriptTail: tail, goal: 'a tiny notes app', returned: [] }), null);
});

test('unreviewedRiskFact is silent once a reviewer returned after the last risky edit, not before it', () => {
  const tail = editLine('Edit', { file_path: 's.js', new_string: '// check the password here' }, '2026-09-29T10:00:00.000Z');
  const after = { agent: 'orch-reviewer', at: '2026-09-29T10:05:00.000Z', status: 'DONE' };
  const before = { agent: 'orch-reviewer', at: '2026-09-29T09:00:00.000Z', status: 'DONE' };
  assert.equal(unreviewedRiskFact({ transcriptTail: tail, goal: '', returned: [after] }), null);
  const f = unreviewedRiskFact({ transcriptTail: tail, goal: '', returned: [before] });
  assert.equal(f.text, 'this change touches sign-in; the change made since the review has not been looked at.');
  assert.ok(!/nobody/.test(f.text), 'a review exists, so it must not say nobody looked');
});

test('Stop: a lead-built password edit gets the one-line fact once, then the same edits are silent', () => {
  const home = mkdtempSync(join(tmpdir(), 'orch-turncheck-home-'));
  const dir = join(home, '.claude', 'orchestrate', 'sessions');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'risk-1.json'), JSON.stringify({ v: 1, session_id: 'risk-1', goal: GOAL, returned: [], dispatches: [] }));
  const tp = join(home, 'transcript.jsonl');
  writeFileSync(tp, editLine('Edit', { file_path: 'server.js', new_string: 'password check' }) + '\n');
  const input = { hook_event_name: 'Stop', session_id: 'risk-1', transcript_path: tp };
  const first = run(input, home);
  const out = JSON.parse(first.stdout);
  assert.equal(out.decision, 'block');
  assert.equal(out.reason, 'orchestrate: this change touches sign-in; nobody independent has looked at it.');
  assert.equal(run(input, home).stdout.trim(), '', 'said once');
});

test('Stop: a session with no edits and no risky request writes nothing', () => {
  const home = mkdtempSync(join(tmpdir(), 'orch-turncheck-home-'));
  const tp = join(home, 'transcript.jsonl');
  writeFileSync(tp, '{"type":"user","message":{"content":"hi"}}\n');
  assert.equal(run({ hook_event_name: 'Stop', session_id: 'quiet-1', transcript_path: tp }, home).stdout.trim(), '');
});

// A helper branch with one commit of its own, merged into the current branch.
function mergeHelper(g, id) {
  g('checkout', '-q', '-b', `worktree-agent-${id}`);
  g('commit', '-q', '--allow-empty', '-m', `work ${id}`);
  g('checkout', '-q', '-');
  g('merge', '-q', '--no-ff', '-m', `merge ${id}`, `worktree-agent-${id}`);
}

// ---- helper folders left behind after a merge -------------------------------------

test('leftoverHelpers counts folders and branches separately, from what git lists', () => {
  const returned = [{ agentId: 'a1' }, { agentId: 'a1' }, { agentId: 'b2' }, { agentId: 'c3' }, { agentId: null }];
  const merged = ['worktree-agent-a1', 'worktree-agent-b2'];
  const dirOf = id => `/r/.claude/worktrees/agent-${id}`;
  const base = { cwd: '/r', returned, merged, exists: () => true };
  // a1: folder and branch; b2: branch only (folder not listed); c3: unmerged, nothing listed.
  assert.deepEqual(leftoverHelpers({ ...base, known: [dirOf('a1')], branches: ['worktree-agent-a1', 'worktree-agent-b2'] }), { folders: 1, branches: 2, allMerged: true });
  // the incident: branches already gone, one folder git still lists
  assert.deepEqual(leftoverHelpers({ ...base, known: [dirOf('a1')], branches: [] }), { folders: 1, branches: 0, allMerged: true });
  // a folder on disk that git no longer knows is not counted
  assert.deepEqual(leftoverHelpers({ ...base, known: [], branches: [] }), { folders: 0, branches: 0, allMerged: true });
  assert.deepEqual(leftoverHelpers({ ...base, returned: [], known: [dirOf('a1')], branches: ['worktree-agent-a1'] }), { folders: 0, branches: 0, allMerged: true });
});

test('leftoverText words the note by what is left', () => {
  assert.equal(leftoverText({ folders: 1, branches: 0 }), '1 helper folder is still here');
  assert.equal(leftoverText({ folders: 0, branches: 2 }), '2 helper branches are still here');
  assert.equal(leftoverText({ folders: 2, branches: 1 }), '2 helper folders and 1 branch are still here');
  assert.equal(leftoverText({ folders: 1, branches: 1 }), '1 helper folder and 1 branch are still here');
});

test('Stop: merged helper folders still on disk are named once with the count; nothing is removed', () => {
  const home = mkdtempSync(join(tmpdir(), 'orch-turncheck-home-'));
  const repo = mkdtempSync(join(tmpdir(), 'orch-turncheck-lo-'));
  const g = (...a) => spawnSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { encoding: 'utf8' });
  g('init', '-q'); g('commit', '-q', '--allow-empty', '-m', 'base');
  for (const id of ['a1b2', 'c3d4']) { mergeHelper(g, id); g('worktree', 'add', '-q', join(repo, '.claude', 'worktrees', `agent-${id}`), `worktree-agent-${id}`); }
  const dir = join(home, '.claude', 'orchestrate', 'sessions');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'lo-1.json'), JSON.stringify({ v: 1, session_id: 'lo-1', cwd: repo, dispatches: [], returned: [{ agentId: 'a1b2', status: 'DONE' }, { agentId: 'c3d4', status: 'DONE' }] }));
  const input = { hook_event_name: 'Stop', session_id: 'lo-1' };
  assert.equal(run(input, home).stdout.trim(), '', 'the stop path never raises the leftover note');
  assert.equal(readFileSync(join(repo, '.git', 'HEAD'), 'utf8').length > 0, true);
  assert.ok(g('branch', '--list', 'worktree-agent-a1b2').stdout.includes('a1b2'), 'branch left in place');
});

test('Stop: branches already gone and one folder left is counted as one folder, not folder and branch', () => {
  const home = mkdtempSync(join(tmpdir(), 'orch-turncheck-home-'));
  const repo = mkdtempSync(join(tmpdir(), 'orch-turncheck-lo-'));
  const g = (...a) => spawnSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { encoding: 'utf8' });
  g('init', '-q'); g('commit', '-q', '--allow-empty', '-m', 'base');
  g('worktree', 'add', '-q', '--detach', join(repo, '.claude', 'worktrees', 'agent-k1k1'));
  mkdirSync(join(repo, '.claude', 'worktrees', 'agent-u2u2'), { recursive: true });
  const dir = join(home, '.claude', 'orchestrate', 'sessions');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'lo-6.json'), JSON.stringify({ v: 1, session_id: 'lo-6', cwd: repo, dispatches: [], returned: [{ agentId: 'k1k1', status: 'DONE' }, { agentId: 'u2u2', status: 'DONE' }] }));
  assert.equal(run({ hook_event_name: 'Stop', session_id: 'lo-6' }, home).stdout.trim(), '');
});

test('Stop: merged helper branches with no folder are named too', () => {
  const home = mkdtempSync(join(tmpdir(), 'orch-turncheck-home-'));
  const repo = mkdtempSync(join(tmpdir(), 'orch-turncheck-lo-'));
  const g = (...a) => spawnSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { encoding: 'utf8' });
  g('init', '-q'); g('commit', '-q', '--allow-empty', '-m', 'base');
  for (const id of ['e5f6', 'g7h8', 'i9j0']) mergeHelper(g, id);
  const dir = join(home, '.claude', 'orchestrate', 'sessions');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'lo-3.json'), JSON.stringify({ v: 1, session_id: 'lo-3', cwd: repo, dispatches: [], returned: ['e5f6', 'g7h8', 'i9j0'].map(agentId => ({ agentId, status: 'DONE' })) }));
  const input = { hook_event_name: 'Stop', session_id: 'lo-3' };
  assert.equal(run(input, home).stdout.trim(), '');
});

test('a helper branch that has not committed is not merged, even though it sits at the main tip', () => {
  const repo = mkdtempSync(join(tmpdir(), 'orch-turncheck-lo-'));
  const g = (...a) => spawnSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { encoding: 'utf8' });
  g('init', '-q'); g('commit', '-q', '--allow-empty', '-m', 'base');
  g('branch', 'worktree-agent-idle1');
  mergeHelper(g, 'done1');
  assert.deepEqual(mergedBranches(repo), ['worktree-agent-done1']);
});

test('Stop: a returned helper whose branch has no commit and whose folder holds unsaved work is not called merged', () => {
  const home = mkdtempSync(join(tmpdir(), 'orch-turncheck-home-'));
  const repo = mkdtempSync(join(tmpdir(), 'orch-turncheck-lo-'));
  const g = (...a) => spawnSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { encoding: 'utf8' });
  g('init', '-q'); g('commit', '-q', '--allow-empty', '-m', 'base');
  g('worktree', 'add', '-q', '-b', 'worktree-agent-w1w1', join(repo, '.claude', 'worktrees', 'agent-w1w1'));
  writeFileSync(join(repo, '.claude', 'worktrees', 'agent-w1w1', 'unsaved.txt'), 'edit');
  const dir = join(home, '.claude', 'orchestrate', 'sessions');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'lo-4.json'), JSON.stringify({ v: 1, session_id: 'lo-4', cwd: repo, dispatches: [], returned: [{ agentId: 'w1w1', status: 'DONE' }] }));
  assert.equal(run({ hook_event_name: 'Stop', session_id: 'lo-4' }, home).stdout.trim(), '');
});

test('Stop: a clean folder of a returned helper that never merged is named without the word merged', () => {
  const home = mkdtempSync(join(tmpdir(), 'orch-turncheck-home-'));
  const repo = mkdtempSync(join(tmpdir(), 'orch-turncheck-lo-'));
  const g = (...a) => spawnSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { encoding: 'utf8' });
  g('init', '-q'); g('commit', '-q', '--allow-empty', '-m', 'base');
  g('worktree', 'add', '-q', '-b', 'worktree-agent-w2w2', join(repo, '.claude', 'worktrees', 'agent-w2w2'));
  const dir = join(home, '.claude', 'orchestrate', 'sessions');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'lo-5.json'), JSON.stringify({ v: 1, session_id: 'lo-5', cwd: repo, dispatches: [], returned: [{ agentId: 'w2w2', status: 'DONE' }] }));
  assert.equal(run({ hook_event_name: 'Stop', session_id: 'lo-5' }, home).stdout.trim(), '');
});

test('Stop: no returned helper folder on disk, no git call and no output', () => {
  const home = mkdtempSync(join(tmpdir(), 'orch-turncheck-home-'));
  const dir = join(home, '.claude', 'orchestrate', 'sessions');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'lo-2.json'), JSON.stringify({ v: 1, session_id: 'lo-2', cwd: home, dispatches: [], returned: [{ agentId: 'zz99', status: 'DONE' }] }));
  assert.equal(run({ hook_event_name: 'Stop', session_id: 'lo-2' }, home).stdout.trim(), '');
});

// ---- hook process: stdin/stdout contract ---------------------------------------

test('a malformed JSON payload exits 0 and writes nothing', () => {
  const r = spawnSync(process.execPath, [HOOK], { input: 'not json', encoding: 'utf8', env: { ...process.env, HOME: mkdtempSync(join(tmpdir(), 'orch-turncheck-home-')) } });
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), '');
});

test('stop_hook_active suppresses the check so it never blocks its own Stop again', () => {
  const r = run({ hook_event_name: 'Stop', session_id: 's1', stop_hook_active: true });
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), '');
});

test('a session with no run explicitly bound is silent, agent_id or not', () => {
  const withAgent = run({ hook_event_name: 'Stop', session_id: 'unbound-session', agent_id: 'helper-1' });
  assert.equal(withAgent.status, 0);
  assert.equal(withAgent.stdout.trim(), '');
  const withoutAgent = run({ hook_event_name: 'Stop', session_id: 'unbound-session-2' });
  assert.equal(withoutAgent.status, 0);
  assert.equal(withoutAgent.stdout.trim(), '');
});

// ---- hook process: the review hold, end to end -------------------------------

test('Stop: a task tagged for review that returned done with no reviewer blocks once, then is silent on the retry', () => {
  const home = mkdtempSync(join(tmpdir(), 'orch-turncheck-home-'));
  const repo = fixtureRepo();
  bindWithReturn(home, 'review-hold-1', repo, { task: '9-9-0001', status: 'PARTIAL', reviewGated: true }, []);

  const first = run({ hook_event_name: 'Stop', session_id: 'review-hold-1', last_assistant_message: 'Shipped it.' }, home);
  assert.equal(first.status, 0);
  const decision = JSON.parse(first.stdout);
  assert.equal(decision.decision, 'block');
  assert.match(decision.reason, /9-9-0001/);
  assert.match(decision.reason, /REVIEW OF: 9-9-0001/);
  assert.ok(decision.reason.length < 200, `reason is ${decision.reason.length} bytes`);

  const second = run({ hook_event_name: 'Stop', session_id: 'review-hold-1', last_assistant_message: 'Shipped it.' }, home);
  assert.equal(second.status, 0);
  assert.equal(second.stdout.trim(), '', 'blocked once for this task; silent on the retry even though nothing changed');
});

test('Stop: a reviewer dispatch recorded with REVIEW OF the task clears the hold, 0 B', () => {
  const home = mkdtempSync(join(tmpdir(), 'orch-turncheck-home-'));
  const repo = fixtureRepo('20260909-review-fixture-2');
  bindWithReturn(home, 'review-hold-2', repo, { task: '9-9-0001', status: 'PARTIAL', reviewGated: true },
    [{ agent: 'orch-reviewer', task: '9-9-0500', reviewOf: '9-9-0001' }]);

  const r = run({ hook_event_name: 'Stop', session_id: 'review-hold-2', last_assistant_message: 'Sent the reviewer.' }, home);
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), '');
});

test('Stop: a task with no review tag is silent, 0 B', () => {
  const home = mkdtempSync(join(tmpdir(), 'orch-turncheck-home-'));
  const repo = fixtureRepo('20260909-review-fixture-3');
  bindWithReturn(home, 'review-hold-3', repo, { task: '9-9-0001', status: 'DONE' }, []);

  const r = run({ hook_event_name: 'Stop', session_id: 'review-hold-3', last_assistant_message: 'Done, no review needed.' }, home);
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), '');
});

// ---- hook process: the review hold with no run bound (no ledger) ------------

test('Stop: a tagged DONE return with no run bound blocks once, then is silent on the retry', () => {
  const home = mkdtempSync(join(tmpdir(), 'orch-turncheck-home-'));
  withReturnNoRun(home, 'no-ledger-1', { task: '9-9-0002', status: 'PARTIAL', reviewGated: true }, []);

  const first = run({ hook_event_name: 'Stop', session_id: 'no-ledger-1', last_assistant_message: 'Shipped it.' }, home);
  assert.equal(first.status, 0);
  const decision = JSON.parse(first.stdout);
  assert.equal(decision.decision, 'block');
  assert.match(decision.reason, /9-9-0002/);
  assert.ok(decision.reason.length < 200, `reason is ${decision.reason.length} bytes`);

  const second = run({ hook_event_name: 'Stop', session_id: 'no-ledger-1', last_assistant_message: 'Shipped it.' }, home);
  assert.equal(second.status, 0);
  assert.equal(second.stdout.trim(), '', 'blocked once for this task; silent on the retry even though nothing changed');
});

test('Stop: with no run bound, a reviewer dispatch recorded with REVIEW OF the task clears the hold, 0 B', () => {
  const home = mkdtempSync(join(tmpdir(), 'orch-turncheck-home-'));
  withReturnNoRun(home, 'no-ledger-2', { task: '9-9-0002', status: 'PARTIAL', reviewGated: true },
    [{ agent: 'orch-reviewer', task: '9-9-0500', reviewOf: '9-9-0002' }]);

  const r = run({ hook_event_name: 'Stop', session_id: 'no-ledger-2', last_assistant_message: 'Sent the reviewer.' }, home);
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), '');
});

test('Stop: with no run bound, a closing message saying the review was skipped clears the hold, 0 B', () => {
  const home = mkdtempSync(join(tmpdir(), 'orch-turncheck-home-'));
  withReturnNoRun(home, 'no-ledger-3', { task: '9-9-0002', status: 'PARTIAL', reviewGated: true }, []);

  const r = run({ hook_event_name: 'Stop', session_id: 'no-ledger-3', last_assistant_message: 'I skipped the review because this is a comment-only change.' }, home);
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), '');
});

test('Stop: with no run bound, an untagged return is silent, 0 B', () => {
  const home = mkdtempSync(join(tmpdir(), 'orch-turncheck-home-'));
  withReturnNoRun(home, 'no-ledger-4', { task: '9-9-0002', status: 'DONE' }, []);

  const r = run({ hook_event_name: 'Stop', session_id: 'no-ledger-4', last_assistant_message: 'Done, no review needed.' }, home);
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), '');
});

// ---- a failed review is not a review ----------------------------------------

const gatedDone = { task: '9-9-0001', status: 'PARTIAL', reviewGated: true };
const revDispatch = { task: '9-9-0500', agent: 'orch-reviewer', reviewOf: '9-9-0001', toolUseId: 'tu-r1', agentId: 'ag-r1' };
const revFail = { agent: 'reviewer', agentId: 'ag-r1', toolUseId: 'tu-r1', status: 'FAIL', verdict: 'FAIL' };

test('reviewHoldDecision stays quiet while the reviewer is still running', () => {
  const d = reviewHoldDecision({ returned: [gatedDone], dispatches: [revDispatch], lastMessage: '', blockedFor: [] });
  assert.equal(d.block, false);
});

test('reviewHoldDecision is released by a reviewer that returned PASS', () => {
  const d = reviewHoldDecision({
    returned: [gatedDone, { agent: 'reviewer', agentId: 'ag-r1', toolUseId: 'tu-r1', status: 'DONE', verdict: 'PASS' }],
    dispatches: [revDispatch], lastMessage: '', blockedFor: [] });
  assert.equal(d.block, false);
});

test('reviewHoldDecision holds, once, when the reviewer returned FAIL', () => {
  const returned = [gatedDone, revFail];
  const d = reviewHoldDecision({ returned, dispatches: [revDispatch], lastMessage: '', blockedFor: [] });
  assert.equal(d.block, true);
  assert.equal(d.failed, true);
  assert.equal(d.task, '9-9-0001');
  const again = reviewHoldDecision({ returned, dispatches: [revDispatch], lastMessage: '', blockedFor: d.blockedFor });
  assert.equal(again.block, false);
});

test('reviewHoldDecision is released by a later PASS on the same work', () => {
  const second = { ...revDispatch, toolUseId: 'tu-r2', agentId: 'ag-r2' };
  const d = reviewHoldDecision({
    returned: [gatedDone, revFail,
      { agent: 'reviewer', agentId: 'ag-r2', toolUseId: 'tu-r2', status: 'DONE', verdict: 'PASS' }],
    dispatches: [revDispatch, second], lastMessage: '', blockedFor: ['9-9-0001:failed'] });
  assert.equal(d.block, false);
});

test('the hook tells the lead once, in one plain line, that a review failed', () => {
  const home = mkdtempSync(join(tmpdir(), 'orch-turncheck-home-'));
  const dir = join(home, '.claude', 'orchestrate', 'sessions');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'sess-failed-review.json'), JSON.stringify({
    v: 1, session_id: 'sess-failed-review', returned: [gatedDone, revFail], dispatches: [revDispatch],
  }));
  const r = run({ session_id: 'sess-failed-review', cwd: home, last_assistant_message: 'Done.' }, home);
  assert.match(r.stdout, /independent look found a problem/);
  const r2 = run({ session_id: 'sess-failed-review', cwd: home, last_assistant_message: 'Done.' }, home);
  assert.doesNotMatch(r2.stdout, /independent look found a problem/);
});

// ---- a long hand-back is not named at a stop --------------------------------

test("the stop hook no longer reports a helper's hand-back size", () => {
  const home = mkdtempSync(join(tmpdir(), 'orch-turncheck-home-'));
  const dir = join(home, '.claude', 'orchestrate', 'sessions');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'sess-long.json'), JSON.stringify({ v: 1, session_id: 'sess-long', returned: [{ agentId: 'ag-1', longBytes: 6000 }], dispatches: [] }));
  const a = run({ session_id: 'sess-long', cwd: home, last_assistant_message: 'Done.' }, home);
  assert.doesNotMatch(a.stdout, /against 600/);
});

// ---- the leftover note waits while a helper is still working ------------------

test('anyHelperRunning: a dispatch with no return is running; an old one is not', () => {
  const now = Date.parse('2026-09-29T12:00:00Z');
  const d = (id, at) => ({ toolUseId: id, at });
  assert.equal(anyHelperRunning({ dispatches: [d('t1', '2026-09-29T11:59:00Z')], returned: [], now }), true);
  assert.equal(anyHelperRunning({ dispatches: [d('t1', '2026-09-29T11:59:00Z')], returned: [{ toolUseId: 't1' }], now }), false);
  assert.equal(anyHelperRunning({ dispatches: [d('t1', '2026-09-28T01:00:00Z')], returned: [], now }), false);
});

test('Stop: merged helper folders are not named while another helper is still working', () => {
  const home = mkdtempSync(join(tmpdir(), 'orch-turncheck-home-'));
  const repo = mkdtempSync(join(tmpdir(), 'orch-turncheck-lo-'));
  const g = (...a) => spawnSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { encoding: 'utf8' });
  g('init', '-q'); g('commit', '-q', '--allow-empty', '-m', 'base');
  mergeHelper(g, 'a1b2'); g('worktree', 'add', '-q', join(repo, '.claude', 'worktrees', 'agent-a1b2'), 'worktree-agent-a1b2');
  const dir = join(home, '.claude', 'orchestrate', 'sessions');
  mkdirSync(dir, { recursive: true });
  const dispatches = [{ toolUseId: 'tu-1', agentId: 'a1b2', at: new Date().toISOString() }, { toolUseId: 'tu-2', at: new Date().toISOString() }];
  writeFileSync(join(dir, 'run-1.json'), JSON.stringify({ v: 1, session_id: 'run-1', cwd: repo, dispatches, returned: [{ agentId: 'a1b2', toolUseId: 'tu-1', status: 'DONE' }] }));
  const input = { hook_event_name: 'Stop', session_id: 'run-1' };
  assert.equal(run(input, home).stdout.trim(), '', 'a helper is still working: quiet');
  writeFileSync(join(dir, 'run-1.json'), JSON.stringify({ v: 1, session_id: 'run-1', cwd: repo, dispatches, returned: [{ agentId: 'a1b2', toolUseId: 'tu-1', status: 'DONE' }, { agentId: 'z9', toolUseId: 'tu-2', status: 'DONE' }] }));
  assert.equal(run(input, home).stdout.trim(), '', 'all returned: still not said at stop');
});
