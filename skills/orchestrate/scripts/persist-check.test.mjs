// persist-check.test.mjs — the work-conserving Stop hook loop: the pure scan
// and decision functions, plus the hook process's stdin/stdout contract.
//   node --test skills/orchestrate/scripts/persist-check.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanTurn, persistDecision, shortGoal, errorKey, endMessage, PERSIST_STEP_CAP } from './persist-check.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const HOOK = join(HERE, 'persist-check.mjs');

function run(input, home = mkdtempSync(join(tmpdir(), 'orch-persist-home-'))) {
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: { ...process.env, HOME: home, USERPROFILE: home },
  });
  return { stdout: r.stdout, status: r.status };
}

// ---- commit-claim helpers -------------------------------------------------------

function git(cwd, args) {
  return spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 'a', GIT_AUTHOR_EMAIL: 'a@example.com', GIT_COMMITTER_NAME: 'a', GIT_COMMITTER_EMAIL: 'a@example.com' } });
}

// A repo with two commits: `startHead` (the first) and HEAD one commit ahead
// of it, tree clean. Callers that want a dirty tree edit a file afterwards.
function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'orch-persist-repo-'));
  git(dir, ['init', '-q']);
  writeFileSync(join(dir, 'a.txt'), 'one\n');
  git(dir, ['add', '.']);
  git(dir, ['commit', '-q', '-m', 'first']);
  const startHead = git(dir, ['rev-parse', 'HEAD']).stdout.trim();
  writeFileSync(join(dir, 'b.txt'), 'two\n');
  git(dir, ['add', '.']);
  git(dir, ['commit', '-q', '-m', 'second']);
  return { dir, startHead };
}

function writeTranscript(home, lastAssistantText) {
  const p = join(home, 'transcript.jsonl');
  writeFileSync(p, JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: lastAssistantText }] } }) + '\n');
  return p;
}

function writeSession(home, sessionId, extra = {}) {
  const dir = join(home, '.claude', 'orchestrate', 'sessions');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${sessionId}.json`), JSON.stringify({ v: 1, session_id: sessionId, ...extra }));
}

// ---- pure: scanTurn -----------------------------------------------------------

const line = rec => JSON.stringify(rec) + '\n';

test('scanTurn sees a work tool call as progress and an assistant question as "asked"', () => {
  const tail = line({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Edit' }, { type: 'text', text: 'Should I proceed?' }] } });
  const scan = scanTurn(tail);
  assert.equal(scan.progressed, true);
  assert.equal(scan.asked, true);
});

test('scanTurn recognizes the goal-met phrasing and a denied dispatch from a tool result', () => {
  const goalMet = scanTurn(line({ type: 'assistant', message: { content: [{ type: 'text', text: 'The goal is met, everything works.' }] } }));
  assert.equal(goalMet.goalMet, true);
  const denied = scanTurn(line({ type: 'user', message: { content: [{ type: 'tool_result', is_error: true, content: 'orchestrate guard: denied' }] } }));
  assert.equal(denied.denied, true);
});

test('scanTurn ignores a line that fails to parse and one with no recognizable shape', () => {
  const scan = scanTurn('not json\n' + line({ type: 'other' }));
  assert.equal(scan.progressed, false);
  assert.equal(scan.tools, 0);
});

// ---- pure: persistDecision -----------------------------------------------------

test('persistDecision stops once the same error repeats', () => {
  const rec = { errors: ['boom at #'] };
  const d = persistDecision({ rec, scan: { progressed: true, denied: false, errors: ['boom at #'], asked: false, goalMet: false } });
  assert.equal(d.kind, 'stop');
  assert.match(d.why, /same error came back twice/);
});

test('persistDecision stops at the step cap and continues below it when work happened', () => {
  const atCap = persistDecision({ rec: { steps: PERSIST_STEP_CAP }, scan: { progressed: true, denied: false, errors: [], asked: false, goalMet: false } });
  assert.equal(atCap.kind, 'stop');
  const below = persistDecision({ rec: { steps: 1 }, scan: { progressed: true, denied: false, errors: [], asked: false, goalMet: false } });
  assert.equal(below.kind, 'continue');
  assert.match(below.why, /step 2 of/);
});

test('persistDecision stops when the last step did no visible work', () => {
  const d = persistDecision({ rec: {}, scan: { progressed: false, denied: false, errors: [], asked: false, goalMet: false } });
  assert.equal(d.kind, 'stop');
  assert.match(d.why, /no visible work/);
});

// ---- shortGoal / errorKey / endMessage -----------------------------------------

test('shortGoal collapses whitespace and truncates a long goal with an ellipsis', () => {
  assert.equal(shortGoal('  a   goal  '), 'a goal');
  assert.equal(shortGoal('x'.repeat(100)).endsWith('...'), true);
});

test('errorKey blurs numbers and paths so the same error survives a changed line number', () => {
  const a = errorKey('Error at line 42 in C:\\repo\\foo.js');
  const b = errorKey('Error at line 99 in C:\\repo\\foo.js');
  assert.equal(a, b);
});

test('endMessage names why the loop stopped and how to restart it', () => {
  assert.match(endMessage('the step cap'), /the step cap.*keep going/s);
});

// ---- hook process: stdin/stdout contract ---------------------------------------

test('a malformed JSON payload exits 0 and writes nothing to stdout', () => {
  const r = spawnSync(process.execPath, [HOOK], { input: 'not json at all', encoding: 'utf8', env: { ...process.env, HOME: mkdtempSync(join(tmpdir(), 'orch-persist-home-')) } });
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), '');
});

test('a helper\'s own Stop (agent_id present) is silent, never blocked with the lead\'s loop text', () => {
  const r = run({ hook_event_name: 'Stop', session_id: 's1', agent_id: 'helper-1', transcript_path: '' });
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), '');
});

test('an unarmed session with no bound run and no transcript is silent', () => {
  const r = run({ hook_event_name: 'Stop', session_id: 'unbound-session', transcript_path: '' });
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), '');
});

// ---- commit-claim check: closing message vs. git status ------------------------

test('a not-committed claim over a clean tree is blocked with a plain reason', () => {
  const home = mkdtempSync(join(tmpdir(), 'orch-persist-home-'));
  const { dir, startHead } = makeRepo();
  const transcript_path = writeTranscript(home, 'I have not committed these changes to git.');
  writeSession(home, 'sess-1', { startHead });
  const r = run({ hook_event_name: 'Stop', session_id: 'sess-1', cwd: dir, transcript_path }, home);
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout);
  assert.equal(out.decision, 'block');
  assert.match(out.reason, /nothing is committed, but git status shows a clean tree and 1 commit since this session started/);
});

test('the same not-committed claim over a dirty tree is not blocked', () => {
  const home = mkdtempSync(join(tmpdir(), 'orch-persist-home-'));
  const { dir, startHead } = makeRepo();
  writeFileSync(join(dir, 'c.txt'), 'three\n');
  const transcript_path = writeTranscript(home, 'I have not committed these changes to git.');
  writeSession(home, 'sess-2', { startHead });
  const r = run({ hook_event_name: 'Stop', session_id: 'sess-2', cwd: dir, transcript_path }, home);
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), '');
});

test('a committed claim over a dirty tree is blocked and names the files', () => {
  const home = mkdtempSync(join(tmpdir(), 'orch-persist-home-'));
  const { dir, startHead } = makeRepo();
  writeFileSync(join(dir, 'c.txt'), 'three\n');
  const transcript_path = writeTranscript(home, 'All committed.');
  writeSession(home, 'sess-3', { startHead });
  const r = run({ hook_event_name: 'Stop', session_id: 'sess-3', cwd: dir, transcript_path }, home);
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout);
  assert.equal(out.decision, 'block');
  assert.match(out.reason, /shows 1 file not committed \(c\.txt\)/);
});

test('a committed claim over a dirty tree names the resend sentence in the reason', () => {
  const home = mkdtempSync(join(tmpdir(), 'orch-persist-home-'));
  const { dir, startHead } = makeRepo();
  writeFileSync(join(dir, 'c.txt'), 'three\n');
  const transcript_path = writeTranscript(home, 'All committed.');
  writeSession(home, 'sess-3r', { startHead });
  const r = run({ hook_event_name: 'Stop', session_id: 'sess-3r', cwd: dir, transcript_path }, home);
  const out = JSON.parse(r.stdout);
  assert.match(out.reason, /Resend the whole report; it becomes what the user sees\./);
});

// Round-9 audit finding 2: the lead's message named the untracked file, but
// the check missed a "did not <verb list> commit" wording and blocked it
// anyway (199 B). All four wordings below are now consistent with the status
// (0 B, no block) once the message names the untracked file.
const didNotCommitWordings = [
  'Everything is committed. I did not commit notes.txt.',
  'Everything is committed. I did not touch, add, or commit notes.txt.',
  'Everything is committed. I did not add, stage, or commit notes.txt.',
  'Everything is committed. I did not touch, stage, change, or commit notes.txt.',
];
for (const [i, text] of didNotCommitWordings.entries()) {
  test(`finding-2 wording ${i + 1} over an untracked notes.txt is not blocked (0 B)`, () => {
    const home = mkdtempSync(join(tmpdir(), 'orch-persist-home-'));
    const { dir, startHead } = makeRepo();
    writeFileSync(join(dir, 'notes.txt'), 'mine\n');
    const transcript_path = writeTranscript(home, text);
    writeSession(home, `sess-fw-${i}`, { startHead });
    const r = run({ hook_event_name: 'Stop', session_id: `sess-fw-${i}`, cwd: dir, transcript_path }, home);
    assert.equal(r.status, 0);
    assert.equal(r.stdout.trim(), '');
  });
}

test('a committed claim that does not name the untracked file is still blocked', () => {
  const home = mkdtempSync(join(tmpdir(), 'orch-persist-home-'));
  const { dir, startHead } = makeRepo();
  writeFileSync(join(dir, 'notes.txt'), 'mine\n');
  const transcript_path = writeTranscript(home, 'Everything is committed.');
  writeSession(home, 'sess-fw-block', { startHead });
  const r = run({ hook_event_name: 'Stop', session_id: 'sess-fw-block', cwd: dir, transcript_path }, home);
  const out = JSON.parse(r.stdout);
  assert.equal(out.decision, 'block');
  assert.match(out.reason, /notes\.txt/);
});

// Round 8's probe: a Stop carrying only last_assistant_message (no
// transcript_path) printed nothing, because the check read the transcript alone.
test('a committed claim in last_assistant_message is checked without a transcript', () => {
  const home = mkdtempSync(join(tmpdir(), 'orch-persist-home-'));
  const { dir, startHead } = makeRepo();
  writeFileSync(join(dir, 'c.txt'), 'three\n');
  writeSession(home, 'sess-3m', { startHead });
  const r = run({ hook_event_name: 'Stop', session_id: 'sess-3m', cwd: dir, last_assistant_message: 'Everything is committed and the login page works.' }, home);
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout);
  assert.equal(out.decision, 'block');
  assert.match(out.reason, /shows 1 file not committed \(c\.txt\)/);
});

test("a committed claim is not blocked when only the plugin's own folders are untracked", () => {
  const home = mkdtempSync(join(tmpdir(), 'orch-persist-home-'));
  const { dir, startHead } = makeRepo();
  mkdirSync(join(dir, '.claude', 'worktrees', 'agent-1'), { recursive: true });
  writeFileSync(join(dir, '.claude', 'worktrees', 'agent-1', 'x.txt'), 'helper\n');
  mkdirSync(join(dir, '.orchestrator', 'runs'), { recursive: true });
  writeFileSync(join(dir, '.orchestrator', 'runs', 'RUN.md'), 'ledger\n');
  const transcript_path = writeTranscript(home, 'All committed.');
  writeSession(home, 'sess-3b', { startHead });
  const r = run({ hook_event_name: 'Stop', session_id: 'sess-3b', cwd: dir, transcript_path }, home);
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), '');
});

test('the same contradicted claim is never blocked twice in one session', () => {
  const home = mkdtempSync(join(tmpdir(), 'orch-persist-home-'));
  const { dir, startHead } = makeRepo();
  writeFileSync(join(dir, 'c.txt'), 'three\n');
  const transcript_path = writeTranscript(home, 'All committed.');
  writeSession(home, 'sess-4', { startHead });
  const first = run({ hook_event_name: 'Stop', session_id: 'sess-4', cwd: dir, transcript_path }, home);
  assert.equal(JSON.parse(first.stdout).decision, 'block');
  const second = run({ hook_event_name: 'Stop', session_id: 'sess-4', cwd: dir, transcript_path }, home);
  assert.equal(second.stdout.trim(), '');
});

test('a helper\'s own Stop (agent_id present) is silent even over a contradicted claim', () => {
  const home = mkdtempSync(join(tmpdir(), 'orch-persist-home-'));
  const { dir, startHead } = makeRepo();
  const transcript_path = writeTranscript(home, 'I have not committed these changes to git.');
  writeSession(home, 'sess-5', { startHead });
  const r = run({ hook_event_name: 'Stop', session_id: 'sess-5', agent_id: 'helper-1', cwd: dir, transcript_path }, home);
  assert.equal(r.stdout.trim(), '');
});

test('no git repo at cwd is silent, whatever the transcript claims', () => {
  const home = mkdtempSync(join(tmpdir(), 'orch-persist-home-'));
  const notARepo = mkdtempSync(join(tmpdir(), 'orch-persist-norepo-'));
  const transcript_path = writeTranscript(home, 'I have not committed these changes to git.');
  writeSession(home, 'sess-6', {});
  const r = run({ hook_event_name: 'Stop', session_id: 'sess-6', cwd: notARepo, transcript_path }, home);
  assert.equal(r.stdout.trim(), '');
});
