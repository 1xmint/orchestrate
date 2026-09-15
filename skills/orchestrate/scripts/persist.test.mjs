// persist.test.mjs — the work-conserving loop: router arming, the Stop hook's
// continue/stop decision, and a replay of the stall it exists for. Hook runs use
// a fake HOME, so nothing touches this machine's ~/.claude.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, appendFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanTurn, persistDecision, errorKey, PERSIST_STEP_CAP, runGoalLine } from './persist-check.mjs';
import { persistIntent, persistLine } from './router.mjs';
import { PERSIST_STOP_FIVE_HOUR } from './lib/quota.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

// ---- transcript records, in the host's JSONL shape ----------------------------
const asst = (...content) => JSON.stringify({ type: 'assistant', message: { role: 'assistant', content } });
const said = text => asst({ type: 'text', text });
const used = name => asst({ type: 'tool_use', id: `t${Math.random()}`, name, input: {} });
const result = (text, isError = false) => JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x', content: text, is_error: isError }] } });
const userSays = text => JSON.stringify({ type: 'user', message: { role: 'user', content: text } });
const tail = (...lines) => lines.join('\n') + '\n';

// ---- intent -------------------------------------------------------------------
test('arms on an explicit ask to keep going, never on a question or a one-off', () => {
  for (const s of ['keep coding until the website is done', 'here is the plan, execute the plan', 'keep going', "don't stop until the tests are green", 'finish the rest', 'work through the checklist', 'build the whole landing page']) {
    assert.equal(persistIntent(s), true, s);
  }
  for (const s of ['is the website done?', 'can you keep going until it is done?', 'fix the typo in README', 'what does the plan say', 'rename foo to bar', 'the build is done']) {
    assert.equal(persistIntent(s), false, s);
  }
});

test('context compact advice stops an armed loop before its did-work check', () => {
  const d = persistDecision({ scan: { progressed: true, denied: false, errors: [], asked: false, goalMet: false }, goal: 'g', contextAdvice: { action: 'compact' }, contextReading: { session: 's', tokens: 151000, compaction: null } });
  assert.equal(d.kind, 'stop');
  assert.match(d.why, /context is ~151k/);
  assert.match(d.why, /checkpoint/);
});

test('the armed line carries the goal verbatim and the ways out', () => {
  const line = persistLine({ armed: true, goal: 'keep coding until the website is done' });
  assert.match(line, /"keep coding until the website is done"/);
  assert.match(line, /persist off/);
  assert.match(line, /Monitor/);
  assert.equal(persistLine({ armed: false, goal: 'x' }), '');
});

// ---- scan ---------------------------------------------------------------------
test('scan: work tools count as progress, talking and reading do not', () => {
  assert.equal(scanTurn(tail(used('Edit'), result('ok'))).progressed, true);
  assert.equal(scanTurn(tail(used('Bash'), result('ok'))).progressed, true);
  assert.equal(scanTurn(tail(used('Read'), result('...'), said('Here is what I found.'))).progressed, false);
  assert.equal(scanTurn(tail(said('All set.'))).progressed, false);
});

test("scan: only the assistant's own words can say done or ask", () => {
  // The user's goal text and a block reason quoting it never read as "done".
  const goal = tail(userSays('keep going until everything is done and the goal is met'), used('Edit'), said('Started the header.'));
  assert.equal(scanTurn(goal).goalMet, false);
  assert.equal(scanTurn(tail(used('Edit'), said('All the tasks are done — the goal is met.'))).goalMet, true);
  assert.equal(scanTurn(tail(used('Edit'), said('Should I use Postgres or SQLite?'))).asked, true);
  assert.equal(scanTurn(tail(used('Edit'), said('Which one do you want? **'))).asked, true);
  assert.equal(scanTurn(tail(used('Edit'), said('Asked myself why? Fixed it.'))).asked, false);
});

test('scan: a guard denial and error keys', () => {
  assert.equal(scanTurn(tail(used('Agent'), result('orchestrate budget: this dispatch would pass the ceiling', true))).denied, true);
  assert.equal(errorKey('Error: ENOENT C:\\tmp\\a1\\x.js line 42'), errorKey('Error: ENOENT C:\\tmp\\b7\\x.js line 99'));
  assert.equal(scanTurn(tail(used('Bash'), result('Error: boom', true), used('Bash'), result('Error: boom', true))).errors.length, 2);
  // A slice that starts mid-record is skipped, not a crash.
  assert.equal(scanTurn('{"type":"assis\n' + used('Edit')).progressed, true);
});

// ---- decision -----------------------------------------------------------------
const base = { progressed: true, denied: false, errors: [], asked: false, goalMet: false };

test('continues on visible work with one line of facts: goal, step, last change', () => {
  const d = persistDecision({ rec: {}, scan: { ...base, lastChange: 'src/site.css' }, goal: 'ship the site' });
  assert.equal(d.kind, 'continue');
  assert.equal(d.why, `orchestrate: "ship the site" · step 1 of ${PERSIST_STEP_CAP} · last edited src/site.css`);
  assert.equal(d.rec.steps, 1);
  // Parts nobody knows are left out, not guessed.
  assert.equal(persistDecision({ rec: { steps: 4 }, scan: base }).why, `orchestrate: step 5 of ${PERSIST_STEP_CAP}`);
  assert.doesNotMatch(d.why, /\n/);
});

test('scan: the last file an edit tool named is the last change', () => {
  const edit = file => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Edit', input: { file_path: file } }] } });
  assert.equal(scanTurn(tail(edit('a.js'), result('ok'), used('Bash'), edit('b.js'))).lastChange, 'b.js');
  assert.equal(scanTurn(tail(used('Bash'), result('ok'))).lastChange, null, 'a command names no file');
});

test('runGoalLine: the first line under the RUN.md Goal heading, else nothing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'goal-'));
  const md = join(dir, 'RUN.md');
  writeFileSync(md, '# Run x\n\nintro\n\n## Goal\n\nShip the site\n\nWhy it matters: users\n\n## Done when\n\n- it ships\n');
  assert.equal(runGoalLine(md), 'Ship the site');
  writeFileSync(md, '# Run x\n\n## Goal\n\n<goal>\n\n## Done when\n');
  assert.equal(runGoalLine(md), null, 'a template placeholder is not a goal');
  assert.equal(runGoalLine(join(dir, 'missing.md')), null);
  assert.equal(runGoalLine(null), null);
});

test('every hardstop fires', () => {
  assert.equal(persistDecision({ scan: { ...base, denied: true } }).kind, 'stop');
  assert.equal(persistDecision({ scan: { ...base, asked: true } }).kind, 'stop');
  assert.equal(persistDecision({ scan: { ...base, goalMet: true } }).kind, 'stop');
  assert.equal(persistDecision({ scan: { ...base, progressed: false } }).kind, 'stop');
  assert.equal(persistDecision({ rec: { steps: PERSIST_STEP_CAP }, scan: base }).kind, 'stop');
  assert.equal(persistDecision({ rec: { steps: PERSIST_STEP_CAP - 1 }, scan: base }).kind, 'continue');
  // Same error twice in one step, and the same error across two steps.
  assert.equal(persistDecision({ scan: { ...base, errors: ['Error: x', 'Error: x'] } }).kind, 'stop');
  const first = persistDecision({ scan: { ...base, errors: ['Error: x'] } });
  assert.equal(first.kind, 'continue');
  assert.equal(persistDecision({ rec: first.rec, scan: { ...base, errors: ['Error: x'] } }).kind, 'stop');
  assert.equal(persistDecision({ rec: first.rec, scan: { ...base, errors: ['Error: y'] } }).kind, 'continue');
});

test('the loop\'s 5-hour stop default is 90, on purpose', () => {
  assert.equal(PERSIST_STOP_FIVE_HOUR, 90);
});

test('the loop stops near the 5-hour limit, and only there', () => {
  const at = pct => ({ fiveHour: { pct, resetsAt: null }, week: null });
  const above = PERSIST_STOP_FIVE_HOUR + 1;
  const below = PERSIST_STOP_FIVE_HOUR - 20;
  assert.equal(persistDecision({ scan: base, quota: at(above) }).kind, 'stop');
  assert.match(persistDecision({ scan: base, quota: at(above) }).why, new RegExp(`${above}%`));
  assert.equal(persistDecision({ scan: base, quota: at(below) }).kind, 'continue');
  assert.equal(persistDecision({ scan: base, quota: null }).kind, 'continue', 'no status line means no usage stop');
});

test('context advice rides along only when given', () => {
  assert.match(persistDecision({ scan: base, contextNotice: '[orchestrate · context] ~152k tokens per step.' }).why, /~152k tokens per step/);
  assert.doesNotMatch(persistDecision({ scan: base }).why, /context\]|\d+k tokens/, 'no size talk without a current measurement');
  // Transcript bytes are no longer an input at all: a huge file says nothing.
  assert.doesNotMatch(persistDecision({ scan: base, transcriptSize: 50_000_000 }).why, /Cost:|context\]/);
});

// ---- the hooks, end to end ----------------------------------------------------
function sandbox() {
  const home = mkdtempSync(join(tmpdir(), 'orch-persist-'));
  mkdirSync(join(home, '.claude', 'orchestrate', 'sessions'), { recursive: true });
  return home;
}
function run(name, payload, home) {
  const r = spawnSync(process.execPath, [join(HERE, name)], { input: JSON.stringify(payload), encoding: 'utf8', env: { ...process.env, HOME: home, USERPROFILE: home, ANTHROPIC_API_KEY: '' } });
  let json = null;
  try { json = r.stdout.trim() ? JSON.parse(r.stdout) : null; } catch {}
  return { status: r.status, stdout: r.stdout, json };
}
const session = (home, id) => JSON.parse(readFileSync(join(home, '.claude', 'orchestrate', 'sessions', `${id}.json`), 'utf8'));

test('replay: the stall — no ledger, a step with work, then a step that only talks', () => {
  const home = sandbox();
  const dir = mkdtempSync(join(tmpdir(), 'orch-cwd-'));
  const transcript = join(dir, 't.jsonl');
  writeFileSync(transcript, tail(userSays('earlier chatter'), said('Hi.')));

  // Before arming, the Stop hook says nothing: this is the old behaviour, and it
  // is still the behaviour for every session that did not ask to keep going.
  const stop = { hook_event_name: 'Stop', session_id: 'p1', cwd: dir, transcript_path: transcript };
  assert.equal(run('persist-check.mjs', stop, home).stdout.trim(), '');

  // The user asks to keep going; the router arms and pins the goal.
  const prompt = 'keep coding until the website is done';
  appendFileSync(transcript, tail(userSays(prompt)));
  const r = run('router.mjs', { hook_event_name: 'UserPromptSubmit', session_id: 'p1', cwd: dir, transcript_path: transcript, prompt }, home);
  assert.match(r.json.hookSpecificOutput.additionalContext, /auto-continue is on toward: "keep coding until the website is done"/);
  assert.equal(session(home, 'p1').persist.armed, true);

  // The model edits a file, starts CI in the background, and ends its turn.
  appendFileSync(transcript, tail(used('Write'), result('ok'), used('Bash'), result('started ci run 42 in background'), said('Kicked off CI.')));
  const blocked = run('persist-check.mjs', { ...stop, stop_hook_active: false }, home);
  assert.equal(blocked.json.decision, 'block', 'the stall is refused');
  assert.match(blocked.json.reason, /keep coding until the website is done/);
  assert.match(blocked.json.reason, new RegExp(`step 1 of ${PERSIST_STEP_CAP}`));

  // Re-entered after its own block (stop_hook_active), another working step still continues.
  appendFileSync(transcript, tail(used('Edit'), result('ok'), said('Added the footer.')));
  assert.equal(run('persist-check.mjs', { ...stop, stop_hook_active: true }, home).json.decision, 'block');

  // A step that only talks ends the loop and disarms.
  appendFileSync(transcript, tail(said('The header and footer are in; CI is still running.')));
  assert.equal(run('persist-check.mjs', { ...stop, stop_hook_active: true }, home).stdout.trim(), '');
  const s = session(home, 'p1');
  assert.equal(s.persist.armed, false);
  assert.match(s.persist.endReason, /no visible work/);
  assert.equal(run('persist-check.mjs', stop, home).stdout.trim(), '', 'disarmed stays quiet');
});

test('router: "persist off" disarms and keeps it off; a question never arms', () => {
  const home = sandbox();
  const dir = mkdtempSync(join(tmpdir(), 'orch-cwd-'));
  const p = prompt => run('router.mjs', { hook_event_name: 'UserPromptSubmit', session_id: 'p2', cwd: dir, prompt }, home);

  p('can you keep going until it is done?');
  assert.equal(session(home, 'p2').persist, undefined);

  p('keep going until the migration is finished');
  assert.equal(session(home, 'p2').persist.armed, true);
  p('persist off');
  assert.equal(session(home, 'p2').persist.armed, false);
  p('keep going until the migration is finished');
  assert.equal(session(home, 'p2').persist.armed, false, 'off stays off for the session');
  p('persist on');
  p('keep going');
  const s = session(home, 'p2');
  assert.equal(s.persist.armed, true);
  assert.equal(s.persist.goal, 'keep going until the migration is finished', 'a bare "keep going" keeps the pinned goal');
});

test('router: after compaction the pinned goal comes back verbatim', () => {
  const home = sandbox();
  const dir = mkdtempSync(join(tmpdir(), 'orch-cwd-'));
  run('router.mjs', { hook_event_name: 'UserPromptSubmit', session_id: 'p3', cwd: dir, prompt: 'execute the plan in docs/plan.md' }, home);
  const out = run('router.mjs', { hook_event_name: 'SessionStart', source: 'compact', session_id: 'p3', cwd: dir }, home);
  assert.match(out.json.hookSpecificOutput.additionalContext, /\[orchestrate · compacted\] auto-continue is on toward: "execute the plan in docs\/plan.md"/);
});

// ---- plugin-wide Stop, not armed: the context-size block ---------------------
test('plugin-wide Stop (not armed) blocks once per epoch at or above compactAt, then passes', () => {
  const home = sandbox();
  const dir = mkdtempSync(join(tmpdir(), 'orch-cwd-'));
  const transcript = join(dir, 't.jsonl');
  writeFileSync(transcript, JSON.stringify({"type":"assistant","timestamp":new Date().toISOString(),"message":{"id":"m1","model":"claude-opus-5","role":"assistant","content":[{"type":"text","text":"x"}],"usage":{"input_tokens":2,"cache_read_input_tokens":158000,"cache_creation_input_tokens":1000,"output_tokens":50}}}) + '\n');

  const stop = { hook_event_name: 'Stop', session_id: 'p5', cwd: dir, transcript_path: transcript };
  const first = run('persist-check.mjs', stop, home);
  assert.equal(first.json.decision, 'block', 'a session that never armed is still blocked once at high context');
  assert.match(first.json.reason, /checkpoint/);

  // Never twice for the same compaction epoch: it blocks once, not in a loop.
  assert.equal(run('persist-check.mjs', stop, home).stdout.trim(), '');
});

test('plugin-wide Stop: silent below compactAt, once a checkpoint exists, and when stop_hook_active', () => {
  const home = sandbox();
  const dir = mkdtempSync(join(tmpdir(), 'orch-cwd-'));

  // Below compactAt: silent outright.
  const smallTranscript = join(dir, 'small.jsonl');
  writeFileSync(smallTranscript, JSON.stringify({"type":"assistant","timestamp":new Date().toISOString(),"message":{"id":"m2","model":"claude-opus-5","role":"assistant","content":[{"type":"text","text":"x"}],"usage":{"input_tokens":2,"cache_read_input_tokens":40000,"cache_creation_input_tokens":1000,"output_tokens":50}}}) + '\n');
  assert.equal(run('persist-check.mjs', { hook_event_name: 'Stop', session_id: 'p6', cwd: dir, transcript_path: smallTranscript }, home).stdout.trim(), '');

  // At or above compactAt, but a checkpoint was already written for this epoch: silent.
  const bigTranscript = join(dir, 'big.jsonl');
  writeFileSync(bigTranscript, JSON.stringify({"type":"assistant","timestamp":new Date().toISOString(),"message":{"id":"m3","model":"claude-opus-5","role":"assistant","content":[{"type":"text","text":"x"}],"usage":{"input_tokens":2,"cache_read_input_tokens":158000,"cache_creation_input_tokens":1000,"output_tokens":50}}}) + '\n');
  const checkpointDir = join(home, '.claude', 'orchestrate', 'context', 'p7');
  mkdirSync(checkpointDir, { recursive: true });
  writeFileSync(join(checkpointDir, 'checkpoint-none.md'), 'already written');
  assert.equal(run('persist-check.mjs', { hook_event_name: 'Stop', session_id: 'p7', cwd: dir, transcript_path: bigTranscript }, home).stdout.trim(), '');

  // At or above compactAt, but this Stop is itself already re-entered: never block itself again.
  assert.equal(run('persist-check.mjs', { hook_event_name: 'Stop', session_id: 'p8', cwd: dir, transcript_path: bigTranscript, stop_hook_active: true }, home).stdout.trim(), '');
});

// 9-14-0002: the checkpoint check accepts a real checkpoint that is not the
// plugin's own file — the host's plan file in Plan mode, or the bound run's
// written Pickup — because a session already holding one of those does not
// need a second file nobody asked it to write.
function bigTranscript(dir, name, startedAgoMs = 3600000) {
  const p = join(dir, name);
  const started = new Date(Date.now() - startedAgoMs).toISOString();
  writeFileSync(p, JSON.stringify({ type: 'user', timestamp: started, message: { role: 'user', content: 'go' } }) + '\n'
    + JSON.stringify({ type: 'assistant', timestamp: new Date().toISOString(), message: { id: 'm', model: 'claude-opus-5', role: 'assistant', content: [{ type: 'text', text: 'x' }], usage: { input_tokens: 2, cache_read_input_tokens: 158000, cache_creation_input_tokens: 1000, output_tokens: 50 } } }) + '\n');
  return p;
}

test('plan mode: a plan file touched this epoch is a real checkpoint', () => {
  const home = sandbox();
  const dir = mkdtempSync(join(tmpdir(), 'orch-cwd-'));
  const plansDir = join(home, '.claude', 'plans');
  mkdirSync(plansDir, { recursive: true });

  // The plan file was touched after the session (and so the epoch) started.
  const t1 = bigTranscript(dir, 'plan-fresh.jsonl');
  writeFileSync(join(plansDir, 'fresh.md'), '# plan\n');
  assert.equal(run('persist-check.mjs', { hook_event_name: 'Stop', session_id: 'pm1', cwd: dir, transcript_path: t1, permission_mode: 'plan' }, home).stdout.trim(), '', 'a fresh plan file stands in for the checkpoint');
});

test('plan mode: a plan file older than the epoch does not stand in for a checkpoint', () => {
  const home = sandbox();
  const dir = mkdtempSync(join(tmpdir(), 'orch-cwd-'));
  const plansDir = join(home, '.claude', 'plans');
  mkdirSync(plansDir, { recursive: true });
  const t = bigTranscript(dir, 'plan-stale.jsonl', 3600000);
  writeFileSync(join(plansDir, 'old.md'), '# old plan\n');
  const oldTime = new Date(Date.now() - 7200000); // touched before the session started
  utimesSync(join(plansDir, 'old.md'), oldTime, oldTime);
  const blocked = run('persist-check.mjs', { hook_event_name: 'Stop', session_id: 'pm2', cwd: dir, transcript_path: t, permission_mode: 'plan' }, home);
  assert.equal(blocked.json.decision, 'block', 'no plan file from this epoch, and no checkpoint: blocks as before');
});

test('a bound run whose Pickup was written this epoch is a real checkpoint', () => {
  const home = sandbox();
  const dir = mkdtempSync(join(tmpdir(), 'orch-cwd-'));
  const runMd = join(dir, 'RUN.md');
  writeFileSync(runMd, '## Goal\n\nship it\n\n## Pickup\n\nPickup prompt: <one sentence that continues from here>\nPickup confidence: high\nResume risk: none\n');
  const sessions = join(home, '.claude', 'orchestrate', 'sessions');
  mkdirSync(sessions, { recursive: true });
  writeFileSync(join(sessions, 'pm3.json'), JSON.stringify({ session_id: 'pm3', run: { root: dir, runId: 'r', runMd } }));

  const t = bigTranscript(dir, 'run-fresh.jsonl');
  // Pickup is still the template placeholder: blocks, same as no checkpoint at all.
  const first = run('persist-check.mjs', { hook_event_name: 'Stop', session_id: 'pm3', cwd: dir, transcript_path: t }, home);
  assert.equal(first.json.decision, 'block', 'an unwritten Pickup is not a checkpoint');

  // Now write the Pickup for real, after the epoch started: it stands in for the checkpoint.
  writeFileSync(runMd, '## Goal\n\nship it\n\n## Pickup\n\nPickup prompt: resume from the reviewer step\nPickup confidence: high\nResume risk: none\n');
  const t2 = bigTranscript(dir, 'run-fresh2.jsonl');
  assert.equal(run('persist-check.mjs', { hook_event_name: 'Stop', session_id: 'pm3', cwd: dir, transcript_path: t2 }, home).stdout.trim(), '', 'a written Pickup this epoch is a real checkpoint');
});
