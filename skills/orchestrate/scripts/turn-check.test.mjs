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
import { shouldBlock, heartbeatDecision, pickupSection, pickupHash, pickupWritten, IDLE_READY_MIN, reviewHoldDecision, unreviewedRiskFact } from './turn-check.mjs';

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
  assert.ok(unreviewedRiskFact({ transcriptTail: tail, goal: '', returned: [before] }));
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
