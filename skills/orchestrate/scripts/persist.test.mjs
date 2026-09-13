// persist.test.mjs — the work-conserving loop: router arming, the Stop hook's
// continue/stop decision, and a replay of the stall it exists for. Hook runs use
// a fake HOME, so nothing touches this machine's ~/.claude.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanTurn, persistDecision, errorKey, PERSIST_STEP_CAP, PERSIST_CHECKIN_EVERY, PERSIST_COST_FLAG_BYTES } from './persist-check.mjs';
import { persistIntent, persistLine } from './router.mjs';

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

test('continues on visible work, and names what to do instead of a bare nudge', () => {
  const d = persistDecision({ rec: {}, scan: base, goal: 'ship the site' });
  assert.equal(d.kind, 'continue');
  assert.match(d.why, /"ship the site"/);
  assert.match(d.why, /Monitor/);
  assert.doesNotMatch(d.why, /Check-in|Cost:/, 'no check-in or cost flag on an ordinary step');
  assert.equal(d.rec.steps, 1);
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

test('the loop stops near the 5-hour limit, and only there', () => {
  const at = pct => ({ fiveHour: { pct, resetsAt: null }, week: null });
  assert.equal(persistDecision({ scan: base, quota: at(91) }).kind, 'stop');
  assert.match(persistDecision({ scan: base, quota: at(91) }).why, /91%/);
  assert.equal(persistDecision({ scan: base, quota: at(70) }).kind, 'continue');
  assert.equal(persistDecision({ scan: base, quota: null }).kind, 'continue', 'no status line means no usage stop');
});

test('the check-in comes at its cadence, the cost flag only on a large session', () => {
  assert.match(persistDecision({ rec: { steps: PERSIST_CHECKIN_EVERY - 1 }, scan: base }).why, /Check-in/);
  assert.doesNotMatch(persistDecision({ rec: { steps: PERSIST_CHECKIN_EVERY }, scan: base }).why, /Check-in/);
  assert.match(persistDecision({ scan: base, transcriptSize: PERSIST_COST_FLAG_BYTES }).why, /Cost:/);
  assert.doesNotMatch(persistDecision({ scan: base, transcriptSize: PERSIST_COST_FLAG_BYTES - 1 }).why, /Cost:|\d+ (tokens|\$)/, 'never a running counter');
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
  assert.match(blocked.json.reason, /Monitor/);

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
