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
import { scanTurn, persistDecision, shortGoal, errorKey, endMessage, workOut, outKey, QUOTA_FACT, PERSIST_STEP_CAP } from './persist-check.mjs';

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

test('an "orchestrate project:" denial is one the lead fixes in a step, so it does not end auto-continue', () => {
  const denied = scanTurn(line({ type: 'user', message: { content: [{ type: 'tool_result', is_error: true, content: 'orchestrate project: no project page yet' }] } }));
  assert.equal(denied.denied, false);
});

test('a helper refused for usage is neither a denial nor an error: the lead can still work without it', () => {
  const refusal = i => line({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: `a${i}`, is_error: true, content: 'orchestrate quota: the 5-hour usage window is at 82%, so a new helper would likely be cut off mid-task.' }] } });
  const scan = scanTurn(refusal(1) + refusal(2) + refusal(3));
  assert.equal(scan.quotaRefused, true);
  assert.equal(scan.denied, false, 'a usage refusal is not a safety stop');
  assert.deepEqual(scan.errors, [], 'three helpers refused in one step are not "the same error twice"');
});

test('a budget or credential refusal is still a denial, and is not read as a usage refusal', () => {
  for (const prefix of ['budget', 'guard']) {
    const scan = scanTurn(line({ type: 'user', message: { content: [{ type: 'tool_result', is_error: true, content: `orchestrate ${prefix}: refused` }] } }));
    assert.equal(scan.denied, true, prefix);
    assert.equal(scan.quotaRefused, false, prefix);
  }
});

test('a refusal is read with or without the host\'s words in front, and only at the start of the result', () => {
  // The host may report a hook's refusal as "PreToolUse:Agent hook error: ..."
  // and may not mark it as an error (independent review, round 4).
  const res = (content, extra = {}) => line({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'a1', content, ...extra }] } });
  for (const front of ['', 'PreToolUse:Agent hook error: ', 'PreToolUse:Agent hook blocking error: ', '[PreToolUse:Bash] hook error: ']) {
    for (const extra of [{ is_error: true }, {}]) {
      const tag = `${JSON.stringify(front)} ${JSON.stringify(extra)}`;
      assert.equal(scanTurn(res(`${front}orchestrate guard: refused`, extra)).denied, true, tag);
      const q = scanTurn(res(`${front}orchestrate quota: the 5-hour usage window is at 82%.`, extra));
      assert.equal(q.quotaRefused, true, tag);
      assert.equal(q.denied, false, tag);
    }
  }
  // A helper's report that quotes a refusal further down is the helper's work.
  const quoted = scanTurn(res('Done. Earlier the hook said: orchestrate guard: refused', { is_error: true }));
  assert.equal(quoted.denied, false);
  assert.equal(scanTurn(res('Summary of the run.\norchestrate quota: the 5-hour usage window is at 82%.')).quotaRefused, false);
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

test('persistDecision states that helpers are refused only on the continue that follows a refusal, as a fact', () => {
  const scan = { progressed: true, denied: false, quotaRefused: true, errors: [], asked: false, goalMet: false };
  const d = persistDecision({ rec: {}, scan, goal: 'ship it' });
  assert.equal(d.kind, 'continue');
  assert.ok(d.why.includes(QUOTA_FACT));
  assert.match(d.why, /helpers are refused/);
  assert.match(d.why, /this session can still work/);
  assert.doesNotMatch(d.why, /\b(must|should|do not|don't|stop trying)\b/i, 'a fact, not an order');
  assert.doesNotMatch(persistDecision({ rec: {}, scan: { ...scan, quotaRefused: false }, goal: 'ship it' }).why, /helpers are refused/);
});

test('workOut counts only a non-empty list: an absent field is unknown, not empty', () => {
  const task = { id: 'b1', type: 'shell', status: 'running', description: 'npm test' };
  const cron = { id: 'c1', schedule: '*/5 * * * *', recurring: true, prompt: 'check CI' };
  assert.equal(workOut({ background_tasks: [task] }), true);
  assert.equal(workOut({ session_crons: [cron] }), true);
  assert.equal(workOut({ background_tasks: [], session_crons: [cron] }), true);
  assert.equal(workOut({ background_tasks: [], session_crons: [] }), false);
  assert.equal(workOut({}), false);
  assert.equal(workOut(null), false);
  assert.equal(workOut({ background_tasks: 'running', session_crons: 3 }), false, 'a field of the wrong shape is unknown too');
});

test('a step that did no work while something is out is a wait: not a stop, not a step, counters unchanged', () => {
  const idle = { progressed: false, denied: false, errors: [], asked: false, goalMet: false };
  const rec = { steps: 3, lastItem: 'fix the parser', sameItem: 2, errors: [] };
  const w = persistDecision({ rec, scan: idle, outstanding: true });
  assert.equal(w.kind, 'wait');
  assert.equal(w.rec.steps, 3);
  assert.equal(w.rec.sameItem, 2);
  assert.equal(w.rec.lastItem, 'fix the parser');
  assert.equal(persistDecision({ rec, scan: idle, outstanding: false }).kind, 'stop');
  assert.match(persistDecision({ rec, scan: idle }).why, /no visible work/);
  // Everything else still stops while work is out: only the idle-step stop waits.
  assert.equal(persistDecision({ rec, scan: { ...idle, asked: true }, outstanding: true }).kind, 'stop');
  assert.equal(persistDecision({ rec, scan: { ...idle, goalMet: true }, outstanding: true }).kind, 'stop');
  assert.equal(persistDecision({ rec, scan: { ...idle, denied: true }, outstanding: true }).kind, 'stop');
  // And a step that did work while work is out is an ordinary continue.
  assert.equal(persistDecision({ rec, scan: { ...idle, progressed: true }, outstanding: true }).kind, 'continue');
});

test('the same work out after a wait with nothing done since is a stop; other work out is another wait', () => {
  const idle = { progressed: false, denied: false, errors: [], asked: false, goalMet: false };
  const first = persistDecision({ rec: {}, scan: idle, outstanding: true, waitingOn: 'srv' });
  assert.equal(first.kind, 'wait');
  assert.equal(first.rec.waitingOn, 'srv');
  // Woken by what is running (a Monitor line, a recurring prompt): a wait again.
  const woken = persistDecision({ rec: first.rec, scan: idle, outstanding: true, waitingOn: 'srv' });
  assert.equal(woken.kind, 'wait', 'the same work woke the session; it is still a wait');
  // The user spoke and the step still did nothing, with only a background
  // command out (a dev server never reports): keep-going ends.
  const again = persistDecision({ rec: first.rec, scan: { ...idle, prompted: true }, outstanding: true, waitingOn: 'srv', commandsOnly: true });
  assert.equal(again.kind, 'stop');
  assert.match(again.why, /the step after your message did no visible work while only a background command kept running/);
  // The same, with a helper, a Monitor or a scheduled prompt out: they report
  // back, so a user's "how's it going?" meanwhile is still a wait.
  assert.equal(persistDecision({ rec: first.rec, scan: { ...idle, prompted: true }, outstanding: true, waitingOn: 'srv', commandsOnly: false }).kind, 'wait');
  assert.equal(persistDecision({ rec: first.rec, scan: idle, outstanding: true, waitingOn: 'r2' }).kind, 'wait', 'something landed, something else is out');
  const worked = persistDecision({ rec: first.rec, scan: { ...idle, progressed: true }, outstanding: true, waitingOn: 'srv' });
  assert.equal(worked.kind, 'continue');
  assert.equal(worked.rec.waitingOn, null, 'work in between starts the wait over');
});

test('a Monitor started in this stretch holds the wait while what appeared with it is still listed', () => {
  // A Monitor that runs a command may be listed as type "shell", the same as a
  // dev server; it still wakes the session when it fires (independent review,
  // round 4). Its id is not marked, so what first appears at the Stop after
  // the step that started it is held, and only while it is still listed
  // (round 5): once it is gone, a dev server left alone ends keep-going again.
  const idle = { progressed: false, denied: false, errors: [], asked: false, goalMet: false };
  const server = persistDecision({ rec: {}, scan: { ...idle, progressed: true }, waitingOn: 'srv' });
  assert.equal(server.rec.lastOut, 'srv');
  const started = persistDecision({ rec: server.rec, scan: { ...idle, progressed: true, monitorStarted: true }, waitingOn: 'm1,srv' });
  assert.equal(started.kind, 'continue');
  assert.deepEqual(started.rec.monitorIds, ['m1'], 'only what appeared with the Monitor, not the server already out');
  const wait = persistDecision({ rec: started.rec, scan: idle, outstanding: true, waitingOn: 'm1,srv', commandsOnly: true });
  assert.equal(wait.kind, 'wait');
  assert.deepEqual(wait.rec.monitorIds, ['m1'], 'carried through a wait');
  const asked = persistDecision({ rec: wait.rec, scan: { ...idle, prompted: true }, outstanding: true, waitingOn: 'm1,srv', commandsOnly: true });
  assert.equal(asked.kind, 'wait', 'a status question while the Monitor runs keeps keep-going on');
  // The Monitor ends; only the server is left.
  const gone = persistDecision({ rec: asked.rec, scan: idle, outstanding: true, waitingOn: 'srv', commandsOnly: true });
  assert.equal(gone.kind, 'wait');
  assert.deepEqual(gone.rec.monitorIds, []);
  const ended = persistDecision({ rec: gone.rec, scan: { ...idle, prompted: true }, outstanding: true, waitingOn: 'srv', commandsOnly: true });
  assert.equal(ended.kind, 'stop', 'the server alone, the user spoke, nothing done: keep-going ends as before');
  // scanTurn reports the Monitor call.
  const used = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'm1', name: 'Monitor', input: { command: 'tail -f log' } }] } });
  assert.equal(scanTurn(used).monitorStarted, true);
  assert.equal(scanTurn(line({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash' }] } })).monitorStarted, false);
});

test('outKey names what is out, in a stable order; nothing out is an empty key', () => {
  assert.equal(outKey({ background_tasks: [{ id: 'b2' }, { id: 'b1' }], session_crons: [{ id: 'c1' }] }), 'b1,b2,c1');
  assert.equal(outKey({}), '');
  assert.equal(outKey(null), '');
});

test('a helper send refused for usage is not work; a send that went out, or any other work, is', () => {
  const use = (name, id) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input: {} }] } });
  const res = (id, text) => JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: text, is_error: true }] } });
  const refused = 'orchestrate quota: the 5-hour usage window is at 82%.';
  assert.equal(scanTurn([use('Agent', 'a1'), res('a1', refused)].join('\n')).progressed, false);
  assert.equal(scanTurn([use('Agent', 'a1'), res('a1', refused), use('Edit', 'e1')].join('\n')).progressed, true);
  assert.equal(scanTurn([use('Agent', 'a1'), res('a1', refused), use('Agent', 'a2')].join('\n')).progressed, true, 'the second send was not refused');
  assert.equal(scanTurn(use('Agent', 'a1')).progressed, true, 'a send with no refusal is work');
  // A helper's report that only quotes a refusal is that helper's work.
  const quoted = JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'a1', content: 'Done. Two children were refused: orchestrate quota: the week is at 91%.' }] } });
  assert.equal(scanTurn([use('Agent', 'a1'), quoted].join('\n')).progressed, true);
});

test('only the user\'s own words in a slice count as the user speaking', () => {
  const user = content => JSON.stringify({ type: 'user', message: { role: 'user', content } });
  assert.equal(scanTurn(user('is the site up?')).prompted, true);
  assert.equal(scanTurn(user([{ type: 'text', text: 'carry on' }])).prompted, true);
  assert.equal(scanTurn(user('<task-notification>\nthe monitor printed a line\n</task-notification>')).prompted, false, 'a helper or Monitor waking the session');
  assert.equal(scanTurn(user('<monitor-event>lint passed</monitor-event>')).prompted, false, 'any host tag');
  assert.equal(scanTurn(user('Stop hook feedback:\norchestrate: next step')).prompted, false, 'this hook\'s own block');
  assert.equal(scanTurn(JSON.stringify({ type: 'user', isMeta: true, message: { content: 'host text' } })).prompted, false);
  assert.equal(scanTurn(JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'x', content: 'ok' }] } })).prompted, false);
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
  assert.match(out.reason, /says nothing is committed; git status shows a clean tree and 1 commit since this session started/);
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
  assert.match(out.reason, /Uncommitted: c\.txt\./);
});

test('a committed claim over a dirty tree names the resend sentence in the reason', () => {
  const home = mkdtempSync(join(tmpdir(), 'orch-persist-home-'));
  const { dir, startHead } = makeRepo();
  writeFileSync(join(dir, 'c.txt'), 'three\n');
  const transcript_path = writeTranscript(home, 'All committed.');
  writeSession(home, 'sess-3r', { startHead });
  const r = run({ hook_event_name: 'Stop', session_id: 'sess-3r', cwd: dir, transcript_path }, home);
  const out = JSON.parse(r.stdout);
  assert.match(out.reason, /A reply to this block becomes the report the user sees\./);
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
  assert.match(out.reason, /Uncommitted: c\.txt\./);
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

// ---- waiting on nothing ---------------------------------------------------------
// A closing promise to wait or check back, with the Stop payload saying nothing
// is out that could wake the session (lib/wait-claim.mjs, docs/pause.md).

test('keep-going: a step that only promises to wait, with nothing out, hears the fact once per stretch, then ends', () => {
  const idle = { progressed: false, denied: false, errors: [], asked: false, goalMet: false, waitClaim: true };
  const first = persistDecision({ rec: { steps: 2 }, scan: idle, idleKnown: true });
  assert.equal(first.kind, 'continue');
  assert.match(first.why, /^orchestrate: your last message says this session will wait or check back; the Stop payload lists no helper, background command, Monitor or scheduled prompt that would wake this session\.$/);
  assert.equal(first.rec.waitTold, true);
  const second = persistDecision({ rec: first.rec, scan: idle, idleKnown: true });
  assert.equal(second.kind, 'stop');
  assert.match(second.why, /only waited, and nothing was running that would wake this session/);
  // A step that polls and then promises again does not hear it a second time:
  // the next idle promise ends keep-going (independent review, round 5).
  const polled = persistDecision({ rec: first.rec, scan: { ...idle, progressed: true } });
  assert.equal(polled.kind, 'continue');
  assert.equal(polled.rec.waitTold, true);
  assert.equal(persistDecision({ rec: polled.rec, scan: idle, idleKnown: true }).kind, 'stop');
  // The size advice rides along, as on any continue: it is marked delivered.
  assert.match(persistDecision({ rec: {}, scan: idle, idleKnown: true, contextNotice: '[orchestrate · context] size note' }).why, /size note$/);
  // Unknown lists, something out, or no promise: as before.
  assert.equal(persistDecision({ rec: {}, scan: idle, idleKnown: false }).kind, 'stop', 'an older host: the plain no-work stop');
  assert.match(persistDecision({ rec: {}, scan: idle, idleKnown: false }).why, /no visible work/);
  assert.equal(persistDecision({ rec: {}, scan: idle, outstanding: true }).kind, 'wait');
  assert.match(persistDecision({ rec: {}, scan: { ...idle, waitClaim: false }, idleKnown: true }).why, /no visible work/);
});

test('a step that called a scheduling tool is not read as promising a wait on nothing', () => {
  const steps = [
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 's1', name: 'mcp__claude-code-remote__send_later', input: {} }] } }),
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: "I'll check back on CI in 20 minutes." }] } }),
  ].join('\n');
  const scan = scanTurn(steps);
  assert.equal(scan.scheduled, true);
  assert.equal(scan.waitClaim, false);
  assert.equal(scanTurn(steps.split('\n')[1]).waitClaim, true, 'the same words alone are a claim');
});

test('without keep-going: a closing promise to wait with nothing out is refused once with the fact', () => {
  const home = mkdtempSync(join(tmpdir(), 'orch-persist-home-'));
  const stop = (extra = {}) => run({ hook_event_name: 'Stop', session_id: 'sess-w1', stop_hook_active: false, last_assistant_message: "Pushed the fix. I'll let you know when CI finishes.", background_tasks: [], session_crons: [], ...extra }, home);
  const r = stop();
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout);
  assert.equal(out.decision, 'block');
  assert.match(out.reason, /^Your last message says this session will wait or check back; the Stop payload lists no helper, background command, Monitor or scheduled prompt that would wake this session\./);
  assert.match(out.reason, /A reply to this block becomes the report the user sees\.$/);
  assert.equal(stop().stdout.trim(), '', 'the same message is refused once');
});

test('without keep-going: no refusal when something is out, the lists are unknown, a hook already refused, or the user is the one waited on', () => {
  const msg = "Pushed the fix. I'll let you know when CI finishes.";
  const cases = [
    ['a helper out', { background_tasks: [{ id: 'a1', type: 'subagent', status: 'running', description: 'review' }], session_crons: [] }],
    ['a scheduled prompt', { background_tasks: [], session_crons: [{ id: 'c1', recurring: false }] }],
    ['an older host', {}],
    ['a hook already refused this Stop', { background_tasks: [], session_crons: [], stop_hook_active: true }],
    ['waiting on the user', { background_tasks: [], session_crons: [], last_assistant_message: "I'll wait for your go-ahead before deleting the old table." }],
    ['ends on a question', { background_tasks: [], session_crons: [], last_assistant_message: "CI is running. I'll check back when it finishes, or would you rather merge now?" }],
    ['no promise at all', { background_tasks: [], session_crons: [], last_assistant_message: 'The header is in and the tests pass.' }],
  ];
  for (const [name, extra] of cases) {
    const home = mkdtempSync(join(tmpdir(), 'orch-persist-home-'));
    const r = run({ hook_event_name: 'Stop', session_id: 'sess-w2', stop_hook_active: false, last_assistant_message: msg, ...extra }, home);
    assert.equal(r.status, 0, name);
    assert.equal(r.stdout.trim(), '', name);
  }
});

test('without keep-going: a reminder set in the record means the promise may be kept, so nothing is said', () => {
  const home = mkdtempSync(join(tmpdir(), 'orch-persist-home-'));
  const transcript_path = join(home, 'transcript.jsonl');
  writeFileSync(transcript_path, [
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: 's1', name: 'mcp__claude-code-remote__send_later', input: { delay_minutes: 20 } }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 's1', content: 'scheduled' }] } },
    { type: 'assistant', message: { content: [{ type: 'text', text: "I'll check back on CI in 20 minutes." }] } },
  ].map(r => JSON.stringify(r)).join('\n') + '\n');
  const r = run({ hook_event_name: 'Stop', session_id: 'sess-w3', stop_hook_active: false, transcript_path, last_assistant_message: "I'll check back on CI in 20 minutes.", background_tasks: [], session_crons: [] }, home);
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), '');
});

// ---- a test count no output shows ---------------------------------------------
// SKILL.md: copy each number from a proof line; two closing messages carried
// figures that did not exist (lib/proof-claim.mjs).

test('a closing test count that no output shows is refused once with the fact', () => {
  const home = mkdtempSync(join(tmpdir(), 'orch-persist-home-'));
  const transcript_path = join(home, 'transcript.jsonl');
  writeFileSync(transcript_path, [
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'b1', content: 'ℹ tests 37\nℹ pass 36\nℹ fail 1' }] } },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'Done. All 42 tests pass.' }] } },
  ].map(r => JSON.stringify(r)).join('\n') + '\n');
  const stop = (extra = {}) => run({ hook_event_name: 'Stop', session_id: 'sess-p1', stop_hook_active: false, transcript_path, last_assistant_message: 'Done. All 42 tests pass.', ...extra }, home);
  const out = JSON.parse(stop().stdout);
  assert.equal(out.decision, 'block');
  assert.match(out.reason, /^Your last message gives 42 as a count of passing tests or checks; no command output, helper report or message in this session's recent record shows that number\./);
  assert.equal(stop().stdout.trim(), '', 'once per message');
  // The count the output shows, a Stop a hook already refused, and a Stop with
  // no record to compare against are all left alone.
  const fresh = () => mkdtempSync(join(tmpdir(), 'orch-persist-home-'));
  assert.equal(run({ hook_event_name: 'Stop', session_id: 'sess-p2', stop_hook_active: false, transcript_path, last_assistant_message: 'Done: 36 tests pass, 1 fails.' }, fresh()).stdout.trim(), '');
  assert.equal(run({ hook_event_name: 'Stop', session_id: 'sess-p3', stop_hook_active: true, transcript_path, last_assistant_message: 'Done. All 42 tests pass.' }, fresh()).stdout.trim(), '');
  assert.equal(run({ hook_event_name: 'Stop', session_id: 'sess-p4', stop_hook_active: false, last_assistant_message: 'Done. All 42 tests pass.' }, fresh()).stdout.trim(), '');
});

test('no git repo at cwd is silent, whatever the transcript claims', () => {
  const home = mkdtempSync(join(tmpdir(), 'orch-persist-home-'));
  const notARepo = mkdtempSync(join(tmpdir(), 'orch-persist-norepo-'));
  const transcript_path = writeTranscript(home, 'I have not committed these changes to git.');
  writeSession(home, 'sess-6', {});
  const r = run({ hook_event_name: 'Stop', session_id: 'sess-6', cwd: notARepo, transcript_path }, home);
  assert.equal(r.stdout.trim(), '');
});

test('onlyCommandsOut: only background commands, nothing scheduled', async () => {
  const { onlyCommandsOut } = await import('./persist-check.mjs');
  assert.equal(onlyCommandsOut({ background_tasks: [{ id: 's', type: 'shell' }] }), true);
  assert.equal(onlyCommandsOut({ background_tasks: [{ id: 's', type: 'shell' }, { id: 'h', type: 'subagent' }] }), false, 'a helper reports back');
  assert.equal(onlyCommandsOut({ background_tasks: [{ id: 'm', type: 'monitor' }] }), false, 'a Monitor reports back');
  assert.equal(onlyCommandsOut({ background_tasks: [{ id: 's', type: 'shell' }], session_crons: [{ id: 'c', recurring: true }] }), false, 'a scheduled prompt wakes the session');
  assert.equal(onlyCommandsOut({}), false);
});

test('the user speaking is read the way the save point reads it: notes stuck to the front, a message typed mid-turn, the host\'s own mark', () => {
  // The record shape seen live on 2026-10-03: a typed prompt whose content
  // opens with a system note block.
  const typed = JSON.stringify({ type: 'user', origin: { kind: 'human' }, message: { role: 'user', content: [
    { type: 'text', text: '<system-reminder>The user\'s timezone is America/New_York.</system-reminder>' },
    { type: 'text', text: 'is the site up?' },
  ] } });
  assert.equal(scanTurn(typed).prompted, true);
  const queued = JSON.stringify({ type: 'attachment', attachment: { type: 'queued_command', origin: { kind: 'human' }, prompt: 'how is it going?' } });
  assert.equal(scanTurn(queued).prompted, true, 'a message typed while the turn ran');
  const summary = JSON.stringify({ type: 'user', isCompactSummary: true, message: { role: 'user', content: 'This session is being continued from a previous conversation.' } });
  assert.equal(scanTurn(summary).prompted, false, 'a summary of the conversation is not the user speaking');
  const pasted = JSON.stringify({ type: 'user', origin: { kind: 'human' }, message: { role: 'user', content: '<div>why does this not render?</div>' } });
  assert.equal(scanTurn(pasted).prompted, true, 'pasted markup the host marks as typed by the user');
  const hostMarked = JSON.stringify({ type: 'user', origin: { kind: 'task-notification' }, message: { role: 'user', content: 'lint passed' } });
  assert.equal(scanTurn(hostMarked).prompted, false);
});

test('a helper\'s report that quotes a budget or guard refusal is not a refusal of this call', () => {
  const quoted = JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'a1', content: 'Done; note that orchestrate guard: refused one command along the way.' }] } });
  assert.equal(scanTurn(quoted).denied, false);
});
