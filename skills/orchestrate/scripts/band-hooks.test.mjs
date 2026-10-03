// band-hooks.test.mjs — what the hooks leave for the band, end to end: the exact
// JSON the host hands the hook, a fake HOME so nothing touches this machine's
// ~/.claude, and a real persist-check.mjs / router.mjs process each time.
// docs/band.md says where each line comes from. The pure parts are in
// lib/band.test.mjs and the mod that draws the line in band-mod.test.mjs.
//   node --test skills/orchestrate/scripts/band-hooks.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bandLine, parseBand, parsePauseText, WAITING_TEXT } from './lib/band-line.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const HOOK = join(HERE, 'persist-check.mjs');
const ROUTER = join(HERE, 'router.mjs');
const TURN = join(HERE, 'turn-check.mjs');

// ---- transcript records, in the host's JSONL shape ----------------------------
const asst = (...content) => JSON.stringify({ type: 'assistant', message: { role: 'assistant', content } });
const said = text => asst({ type: 'text', text });
const used = (name, id) => asst({ type: 'tool_use', id, name, input: {} });
const result = (id, text) => JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: text }] } });
const lines = (...l) => l.join('\n') + '\n';

// ---- sandbox ------------------------------------------------------------------
function sandbox() {
  const home = mkdtempSync(join(tmpdir(), 'orch-band-'));
  mkdirSync(join(home, '.claude', 'orchestrate', 'sessions'), { recursive: true });
  // As router.test.mjs: a plan on file and the one-time auto-compact offer
  // already spent, so a prompt is about the prompt.
  writeFileSync(join(home, '.claude', 'orchestrate', 'profile.json'), JSON.stringify({ tier: 'max5', tierSource: 'user', setAt: '2026-09-08T00:00:00Z' }));
  writeFileSync(join(home, '.claude', 'orchestrate', 'autocompact-default.json'), '{}');
  return home;
}
// A project folder. `orch` false leaves the plugin's own folder out, which is
// every project the plugin has not worked in.
function project({ orch = true, page = null, git = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'orch-band-proj-'));
  if (git) mkdirSync(join(dir, '.git'));
  if (orch) mkdirSync(join(dir, '.orchestrator'));
  if (page) { mkdirSync(join(dir, '.orchestrator'), { recursive: true }); writeFileSync(join(dir, '.orchestrator', 'PROJECT.md'), page); }
  return dir;
}
const PAGE = '# Project\n\n## Next\n\n1. Fix the date parser\n2. Later thing\n';
function addRun(dir) {
  const runDir = join(dir, '.orchestrator', 'runs', '20260908-tidy-finish');
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, 'RUN.md'), [
    '# Run 20260908-tidy-finish', '', '## Goal', '', 'Finish the tidy command.', '', '## Done when', '', '- tests pass', '',
    '## Tasks', '',
    '| id | phase | role · model | task | acceptance evidence | attempts | result |', '|---|---|---|---|---|---|---|',
    '| 9-8-0001 | 🔨 running | implementer · sonnet | add --since | test passes | 1 | — |', '',
    '## Pickup', '', 'Pickup prompt: dispatch 9-8-0002 once 0001 lands', '',
  ].join('\n'));
}

function run(script, payload, home) {
  const r = spawnSync(process.execPath, [script], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env, HOME: home, USERPROFILE: home, ANTHROPIC_API_KEY: '', CLAUDE_CODE_HOST_SESSION_ID: '', CLAUDE_EFFORT: '', CLAUDE_CODE_AUTO_COMPACT_WINDOW: '' },
  });
  let json = null;
  try { json = r.stdout.trim() ? JSON.parse(r.stdout) : null; } catch {}
  return { status: r.status, stdout: r.stdout, json };
}
const sessionFile = (home, id) => join(home, '.claude', 'orchestrate', 'sessions', `${id}.json`);
const session = (home, id) => JSON.parse(readFileSync(sessionFile(home, id), 'utf8'));
// A session that said "keep going": what router.mjs writes, trimmed to what the
// Stop hook reads.
function arm(home, id, goal = 'ship the site') {
  writeFileSync(sessionFile(home, id), JSON.stringify({ v: 1, session_id: id, persist: { armed: true, goal, goalSource: 'prompt', armedAt: '2026-10-03T00:00:00.000Z', sizeAtArm: 0 } }));
}
function transcript(dir, ...recs) {
  const p = join(dir, 't.jsonl');
  writeFileSync(p, lines(...recs));
  return p;
}
const stopPayload = (id, dir, t, extra = {}) => ({ hook_event_name: 'Stop', session_id: id, cwd: dir, transcript_path: t, stop_hook_active: false, ...extra });
const failurePayload = (id, dir, extra = {}) => ({ hook_event_name: 'StopFailure', session_id: id, cwd: dir, transcript_path: '', error: 'rate_limit', ...extra });
let promptCount = 0;
const promptPayload = (id, dir, text, extra = {}) => ({ hook_event_name: 'UserPromptSubmit', session_id: id, prompt_id: `band-p${++promptCount}`, cwd: dir, permission_mode: 'auto', prompt: text, ...extra });
const stop = (home, id, dir, t, extra) => run(HOOK, stopPayload(id, dir, t, extra), home);
const prompt = (home, id, dir, text, extra) => run(ROUTER, promptPayload(id, dir, text, extra), home);

const bandFile = dir => join(dir, '.orchestrator', 'band.json');
const bandRec = dir => JSON.parse(readFileSync(bandFile(dir), 'utf8'));
const pauseFile = dir => join(dir, '.orchestrator', 'pause.json');
// The line the mod would draw from the two files as they are now.
function lineOf(dir, sessionId) {
  const read = f => { try { return readFileSync(f, 'utf8'); } catch { return ''; } };
  return bandLine({ pause: parsePauseText(read(pauseFile(dir))), band: parseBand(read(bandFile(dir))), session: sessionId, now: Date.now() });
}
const ASKED = 'Which database do you want, Postgres or SQLite?';
const EDITED = [used('Edit', 'e1'), result('e1', 'ok'), said('Header done.')];

// ================================ the Stop hook ===============================
test('a Stop that keep-going refuses writes working, on the goal in the user\'s words', () => {
  const home = sandbox(); const dir = project();
  arm(home, 'k1');
  const r = stop(home, 'k1', dir, transcript(dir, ...EDITED));
  assert.equal(r.json.decision, 'block', 'the Stop is refused, as before');
  const before = Date.now();
  const rec = bandRec(dir);
  assert.deepEqual(Object.keys(rec).sort(), ['at', 'kind', 'session', 'text']);
  assert.equal(rec.kind, 'working');
  assert.equal(rec.session, 'k1');
  assert.equal(rec.text, 'ship the site');
  assert.ok(Date.parse(rec.at) <= before + 1000 && Date.parse(rec.at) >= before - 60000, 'at is a recent ISO time');
  assert.equal(new Date(rec.at).toISOString(), rec.at);
  assert.equal(lineOf(dir, 'k1'), 'Working on: ship the site');
});

test('a refused Stop names the project page\'s next step when there is one, before the goal', () => {
  const home = sandbox(); const dir = project({ page: PAGE });
  arm(home, 'k2');
  assert.equal(stop(home, 'k2', dir, transcript(dir, ...EDITED)).json.decision, 'block');
  assert.equal(bandRec(dir).text, 'Fix the date parser');
  assert.equal(lineOf(dir, 'k2'), 'Working on: Fix the date parser');
});

test('a closing question at Stop writes needs, with keep-going armed or not', () => {
  for (const armed of [true, false]) {
    const home = sandbox(); const dir = project();
    const id = armed ? 'q-armed' : 'q-plain';
    if (armed) arm(home, id);
    const r = stop(home, id, dir, transcript(dir, said(ASKED)));
    assert.notEqual(r.json && r.json.decision, 'block', `armed ${armed}: the question is not refused`);
    const rec = bandRec(dir);
    assert.equal(rec.kind, 'needs', `armed ${armed}`);
    assert.equal(rec.text, ASKED, `armed ${armed}`);
    assert.equal(rec.session, id);
    assert.equal(lineOf(dir, id), `Needs you: ${ASKED}`);
  }
});

test('the question is read from the Stop payload\'s own closing message, and from the transcript when it carries none', () => {
  const home = sandbox(); const dir = project();
  const t = transcript(dir, said('The header and footer are in.'));
  stop(home, 'q2', dir, t, { last_assistant_message: 'All done. Anything else?' });
  assert.equal(bandRec(dir).text, 'Anything else?', 'the payload message wins');
  stop(home, 'q2', dir, transcript(dir, said(ASKED)));
  assert.equal(bandRec(dir).text, ASKED, 'no message in the payload: the transcript\'s last one');
  stop(home, 'q2', dir, transcript(dir, said(ASKED)), { last_assistant_message: 'Done.' });
  assert.equal(bandRec(dir).kind, 'idle', 'a payload message that is not a question beats a question in the transcript');
});

test('a long question is clipped on the line to about a hundred characters', () => {
  const home = sandbox(); const dir = project();
  const long = `Before I go on with the migration, should the old orders table keep its original column names, or do you want them renamed to match the new schema now, which touches every report?`;
  stop(home, 'q3', dir, transcript(dir, said(long)));
  const rec = bandRec(dir);
  assert.ok(rec.text.length <= 100, `${rec.text.length} characters`);
  assert.ok(rec.text.startsWith('Before I go on with the migration'));
  assert.ok(lineOf(dir, 'q3').startsWith('Needs you: Before I go on'));
});

test('a Stop passed because a helper or command is out writes working on the wait', () => {
  const task = { id: 'b1', type: 'subagent', status: 'running', description: 'review the diff', agent_type: 'orch-reviewer' };
  const cron = { id: 'c1', schedule: '*/5 * * * *', recurring: true, prompt: 'check CI' };
  for (const [name, extra] of [['a background task', { background_tasks: [task] }], ['a scheduled prompt', { session_crons: [cron] }]]) {
    const home = sandbox(); const dir = project();
    arm(home, 'w1');
    const r = stop(home, 'w1', dir, transcript(dir, said('Waiting for the reviewer to report.')), extra);
    assert.equal(r.stdout.trim(), '', `${name}: the Stop passes as before`);
    const rec = bandRec(dir);
    assert.equal(rec.kind, 'working', name);
    assert.equal(rec.text, WAITING_TEXT, name);
    assert.equal(lineOf(dir, 'w1'), 'Working on: waiting on a helper or background command', name);
  }
});

test('a wait keeps the time its run of waits began, through wakes and the user asking', () => {
  // A Monitor line, one of two helpers landing, or the user asking "is it
  // stuck?" must not restart "so far" (independent review, rounds 6 and 7).
  const home = sandbox(); const dir = project();
  arm(home, 'w3');
  const began = new Date(Date.now() - 3 * 3600000 - 5 * 60000).toISOString();
  // The loop's record as a wait three hours ago left it.
  writeFileSync(join(home, '.claude', 'orchestrate', 'persist-checks.json'), JSON.stringify({ w3: { armedAt: '2026-10-03T00:00:00.000Z', lastSize: 0, waitingOn: 'r2', waitSince: began } }));
  const task = { id: 'r2', type: 'subagent', status: 'running', description: 'review the diff' };
  const log = [said('One review landed; waiting on the other.')];
  const t = transcript(dir, ...log);
  assert.equal(stop(home, 'w3', dir, t, { background_tasks: [task] }).stdout.trim(), '');
  let rec = bandRec(dir);
  assert.equal(rec.since, began, 'the start of the wait is kept');
  assert.ok(Date.parse(rec.at) > Date.parse(began), 'the write time is new');
  assert.equal(lineOf(dir, 'w3'), `Working on: ${WAITING_TEXT}, 3 h 5 min so far`);
  // The user asks; the band shows the prompt; the next step still only waits.
  prompt(home, 'w3', dir, 'is it stuck?');
  log.push(JSON.stringify({ type: 'user', message: { role: 'user', content: 'is it stuck?' } }), said('No: the second review is still running.'));
  writeFileSync(t, lines(...log));
  assert.equal(stop(home, 'w3', dir, t, { background_tasks: [task] }).stdout.trim(), '', 'a wait again');
  rec = bandRec(dir);
  assert.equal(rec.since, began, 'asking does not restart the clock');
  // Work in between starts it over.
  log.push(used('Edit', 'e9'), result('e9', 'ok'), said('Fixed what the first review found.'));
  writeFileSync(t, lines(...log));
  assert.match(stop(home, 'w3', dir, t, { background_tasks: [task] }).json.reason, /^orchestrate: /, 'work: a continue');
  log.push(said('Waiting on the second review.'));
  writeFileSync(t, lines(...log));
  assert.equal(stop(home, 'w3', dir, t, { background_tasks: [task], stop_hook_active: true }).stdout.trim(), '', 'a wait again');
  assert.ok(Date.now() - Date.parse(bandRec(dir).since) < 60000, 'a new run of waits, a new clock');
});

test('a question at the same Stop comes before the wait', () => {
  const home = sandbox(); const dir = project();
  arm(home, 'w2');
  const task = { id: 'b1', type: 'shell', status: 'running', description: 'npm test' };
  stop(home, 'w2', dir, transcript(dir, said(ASKED)), { background_tasks: [task] });
  assert.equal(bandRec(dir).kind, 'needs');
});

test('any other Stop writes idle, which carries no text and replaces what was there', () => {
  const home = sandbox(); const dir = project();
  prompt(home, 'i1', dir, 'add a --json flag to the status command and test it');
  assert.equal(bandRec(dir).kind, 'working');
  const r = stop(home, 'i1', dir, transcript(dir, said('All done.')));
  assert.equal(r.stdout.trim(), '');
  const rec = bandRec(dir);
  assert.equal(rec.kind, 'idle');
  assert.equal(rec.text, '');
  assert.equal(lineOf(dir, 'i1'), '', 'an idle band draws nothing');
});

test('a keep-going loop that ends on a step with no visible work leaves idle', () => {
  const home = sandbox(); const dir = project();
  arm(home, 'i2');
  const r = stop(home, 'i2', dir, transcript(dir, said('The header is in.')));
  assert.match(r.json.systemMessage, /^Keep-going stopped/);
  assert.equal(bandRec(dir).kind, 'idle');
});

test('a helper\'s own Stop writes nothing and leaves the record that is there', () => {
  const home = sandbox(); const dir = project();
  const prior = JSON.stringify({ session: 'lead', kind: 'working', text: 'Fix the date parser', at: '2026-10-03T09:00:00.000Z' });
  writeFileSync(bandFile(dir), prior);
  const r = stop(home, 'lead', dir, transcript(dir, said(ASKED)), { agent_id: 'helper-1', agent_type: 'orch-implementer', last_assistant_message: ASKED });
  assert.equal(r.status, 0);
  assert.equal(readFileSync(bandFile(dir), 'utf8'), prior, 'byte for byte');

  const fresh = project();
  stop(home, 'lead', fresh, transcript(fresh, said(ASKED)), { agent_id: 'helper-1' });
  assert.equal(existsSync(bandFile(fresh)), false, 'and writes none where there was none');
});

test('in a project the plugin has not worked in, a Stop writes no record and makes no folder', () => {
  const home = sandbox(); const dir = project({ orch: false });
  arm(home, 'n1');
  assert.equal(stop(home, 'n1', dir, transcript(dir, ...EDITED)).json.decision, 'block');
  stop(home, 'n1', dir, transcript(dir, said(ASKED)));
  assert.equal(existsSync(join(dir, '.orchestrator')), false);

  const outside = project({ orch: false, git: false });
  stop(home, 'n2', outside, transcript(outside, said(ASKED)));
  assert.equal(existsSync(join(outside, '.orchestrator')), false, 'a folder that is no repository too');
});

test('a Stop with no cwd writes nothing and fails nothing', () => {
  const home = sandbox();
  const r = run(HOOK, { hook_event_name: 'Stop', session_id: 'x1', last_assistant_message: ASKED }, home);
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), '');
});

test('the record sits at the git root when the payload names a folder inside the repository', () => {
  const home = sandbox(); const repo = project();
  mkdirSync(join(repo, 'src', 'deep'), { recursive: true });
  stop(home, 'g1', join(repo, 'src', 'deep'), transcript(repo, said(ASKED)));
  assert.equal(existsSync(bandFile(repo)), true);
  assert.equal(existsSync(join(repo, 'src', 'deep', '.orchestrator')), false);
});

test('StopFailure leaves the band alone: the pause record is the one that speaks', () => {
  const home = sandbox(); const dir = project();
  const prior = JSON.stringify({ session: 'f1', kind: 'working', text: 'Fix the date parser', at: '2026-10-03T09:00:00.000Z' });
  writeFileSync(bandFile(dir), prior);
  const r = run(HOOK, failurePayload('f1', dir, { last_assistant_message: ASKED }), home);
  assert.equal(r.stdout.trim(), '');
  assert.equal(readFileSync(bandFile(dir), 'utf8'), prior);
  assert.equal(JSON.parse(readFileSync(pauseFile(dir), 'utf8')).kind, 'usage_limit');
});

test('writing the band changes nothing the Stop hook prints or decides', () => {
  const task = { id: 'b1', type: 'subagent', status: 'running', description: 'review the diff', agent_type: 'orch-reviewer' };
  const cases = [
    ['a continue', true, [...EDITED], {}],
    ['a question with keep-going on', true, [said(ASKED)], {}],
    ['a question with keep-going off', false, [said(ASKED)], {}],
    ['a plain finish', false, [said('All done.')], {}],
    ['a step with no visible work', true, [said('The header is in.')], {}],
    ['a wait', true, [said('Waiting for the reviewer to report.')], { background_tasks: [task] }],
  ];
  for (const [name, armed, recs, extra] of cases) {
    const out = [];
    for (const orch of [true, false]) {
      const home = sandbox(); const dir = project({ orch });
      if (armed) arm(home, 'same');
      const r = stop(home, 'same', dir, transcript(dir, ...recs), extra);
      out.push({ status: r.status, stdout: r.stdout, armed: armed ? session(home, 'same').persist.armed : null });
    }
    assert.deepEqual(out[0], out[1], `${name}: the same output and the same decision with and without the band's folder`);
  }
});

// turn-check.mjs runs beside this hook in one Stop group, and the host runs a
// group's commands at once. It refused the Stop while this hook had written
// "Needs you" for it, so the band said the turn was over while it went on
// (whole-file review).
test('a Stop turn-check refuses shows the turn going on, whichever of the two Stop hooks writes first', () => {
  const closing = 'Footer updated. Do you want the header done the same way?';
  for (const order of [['persist', 'turn'], ['turn', 'persist']]) {
    const home = sandbox(); const dir = project({ page: PAGE });
    prompt(home, 'tc', dir, 'change the footer markup to match the header');
    // The third turn in a row that changed project files and not the page.
    writeFileSync(join(home, '.claude', 'orchestrate', 'turn-checks.json'), JSON.stringify({ 'tc-project': { count: 2 } }));
    const t = transcript(dir, JSON.stringify({ type: 'user', message: { role: 'user', content: 'change the footer markup' } }),
      asst({ type: 'tool_use', id: 'e1', name: 'Edit', input: { file_path: join(dir, 'footer.html') } }), result('e1', 'ok'), said(closing));
    const payload = stopPayload('tc', dir, t, { last_assistant_message: closing });
    const out = {};
    for (const which of order) out[which] = run(which === 'turn' ? TURN : HOOK, payload, home);
    assert.equal(out.turn.json && out.turn.json.decision, 'block', `${order}: turn-check refuses, as before`);
    assert.equal(out.persist.stdout.trim(), '', `${order}: persist-check passes, as before`);
    assert.equal(lineOf(dir, 'tc'), 'Working on: change the footer markup to match the header', order.join(' then '));
  }
});

test('writing the band changes nothing turn-check prints or decides', () => {
  const out = [];
  for (const orch of [true, false]) {
    const home = sandbox(); const dir = project({ orch });
    // A task tagged for review came back done with none sent: refused once.
    writeFileSync(sessionFile(home, 'same'), JSON.stringify({ v: 1, session_id: 'same', bandText: 'add the export', returned: [{ task: '10-3-0001', status: 'DONE', reviewGated: true, at: '2026-10-03T09:00:00.000Z' }], dispatches: [] }));
    const r = run(TURN, stopPayload('same', dir, transcript(dir, said('The export is in.'))), home);
    out.push({ status: r.status, stdout: r.stdout });
    if (orch) assert.equal(lineOf(dir, 'same'), 'Working on: add the export', 'with the folder, the band says the turn goes on');
    else assert.equal(existsSync(join(dir, '.orchestrator')), false, 'without it, no folder is made');
  }
  assert.match(out[0].stdout, /"decision":"block"/);
  assert.deepEqual(out[0], out[1], 'the same output and the same decision with and without the band\'s folder');
});

// A session bound to a run closed as dropped kept naming its stuck row, on the
// band and as keep-going's next step (whole-file review). Both read the binding
// through lib/runs.mjs `boundRun`, the turn checks' own test.
test('a run closed as dropped names none of its tasks: not on the band, not as keep-going\'s next step', () => {
  const home = sandbox(); const dir = project();
  const runDir = join(dir, '.orchestrator', 'runs', '20261003-dates');
  mkdirSync(runDir, { recursive: true });
  const runMd = join(runDir, 'RUN.md');
  writeFileSync(runMd, ['# Run 20261003-dates', '', 'Closed: dropped, the user went another way', '', '## Goal', '', 'Rewrite the dates.', '', '## Tasks', '',
    '| id | phase | role · model | task | acceptance evidence | attempts | result |', '|---|---|---|---|---|---|---|',
    '| 10-3-0001 | 🧱 stuck | implementer · sonnet | rewrite the date parser | test passes | 1 | — |', ''].join('\n'));
  const goal = 'add a dark mode toggle to the settings page';
  writeFileSync(sessionFile(home, 'cl'), JSON.stringify({ v: 1, session_id: 'cl', goal, run: { root: dir, runId: '20261003-dates', runMd, boundAt: '2026-10-01T00:00:00.000Z' }, persist: { armed: true, goal, goalSource: 'prompt', armedAt: '2026-10-03T00:00:00.000Z', sizeAtArm: 0 } }));
  prompt(home, 'cl', dir, 'continue');
  assert.equal(lineOf(dir, 'cl'), `Working on: ${goal}`);
  const r = stop(home, 'cl', dir, transcript(dir, ...EDITED));
  assert.equal(r.json.decision, 'block', 'the loop goes on, as before');
  assert.doesNotMatch(r.json.reason, /date parser/);
  assert.equal(lineOf(dir, 'cl'), `Working on: ${goal}`);
});

test('a pause wins over a question on the line, and the Stop that ends the pause leaves the band\'s own line', () => {
  const home = sandbox(); const dir = project();
  stop(home, 'p1', dir, transcript(dir, said(ASKED)));
  assert.equal(lineOf(dir, 'p1'), `Needs you: ${ASKED}`);

  run(HOOK, failurePayload('p1', dir), home);
  assert.match(lineOf(dir, 'p1'), /^Paused for the usage limit/, 'the pause is on, so it is the line');
  assert.equal(bandRec(dir).kind, 'needs', 'the question is still in the record under it');

  // The host carries on after the reset; the turn it resumes ends with the question again.
  stop(home, 'p1', dir, transcript(dir, said(ASKED)));
  assert.equal(parsePauseText(readFileSync(pauseFile(dir), 'utf8')), null, 'the Stop ended the pause');
  assert.equal(lineOf(dir, 'p1'), `Needs you: ${ASKED}`);
});

// It used to beat this session's own question and stay after its next prompt,
// promising keep-going for a session that is not this one (whole-file review).
test('a pause from another session never covers this session\'s own line, and shows without a promise when there is none', () => {
  const home = sandbox(); const dir = project();
  arm(home, 'theirs');
  stop(home, 'mine', dir, transcript(dir, said(ASKED)));
  run(HOOK, failurePayload('theirs', dir), home);
  assert.equal(lineOf(dir, 'mine'), `Needs you: ${ASKED}`, 'this session\'s question stands');
  prompt(home, 'mine', dir, 'Postgres, and add a migration for it');
  assert.equal(lineOf(dir, 'mine'), 'Working on: Postgres, and add a migration for it', 'and its next prompt is its line');
  stop(home, 'mine', dir, transcript(dir, said('Migration added.')));
  assert.equal(lineOf(dir, 'mine'), '(another session) Paused for the usage limit.', 'with nothing of its own to say, the other pause, and no keep-going promise');
  assert.equal(lineOf(dir, 'theirs'), 'Paused for the usage limit; keep-going stays on.', 'the session that paused keeps its own words');
});

// =============================== the prompt hook ===============================
test('a real prompt writes working, on the request in the user\'s own words', () => {
  const home = sandbox(); const dir = project();
  const text = 'add a --json flag to the status command and test it';
  const r = prompt(home, 'r1', dir, text);
  assert.equal(r.status, 0);
  const rec = bandRec(dir);
  assert.deepEqual(Object.keys(rec).sort(), ['at', 'kind', 'session', 'text']);
  assert.equal(rec.kind, 'working');
  assert.equal(rec.session, 'r1');
  assert.equal(rec.text, text);
  assert.equal(new Date(rec.at).toISOString(), rec.at);
  assert.equal(lineOf(dir, 'r1'), `Working on: ${text}`);
});

// The band answers "what is Claude doing right now". The stored item used to
// come first, so a finished first request, or the page's next step, stood above
// every later prompt, a thank-you included (whole-file review).
test('a new request names itself, whatever is stored: the first request done, the page\'s next step, a run\'s task', () => {
  const home = sandbox(); const dir = project();
  prompt(home, 'n1', dir, 'add a --json flag to the status command and test it');
  stop(home, 'n1', dir, transcript(dir, said('Done: the flag is in and its test passes.')));
  assert.equal(lineOf(dir, 'n1'), '');
  prompt(home, 'n1', dir, 'now fix the login page so it remembers the user');
  assert.equal(lineOf(dir, 'n1'), 'Working on: now fix the login page so it remembers the user');

  const paged = project({ page: PAGE });
  prompt(home, 'n2', paged, 'what does the export button in settings do?');
  assert.equal(lineOf(paged, 'n2'), 'Working on: what does the export button in settings do?');
  addRun(paged);
  prompt(home, 'n2', paged, 'and now the list command too, please');
  assert.equal(lineOf(paged, 'n2'), 'Working on: and now the list command too, please');
});

test('a prompt that only resumes names the stored next item, else the goal', () => {
  const home = sandbox(); const dir = project({ page: PAGE });
  for (const text of ['continue', 'keep going', 'ok go ahead with that', 'try again']) {
    prompt(home, 'r2', dir, text);
    assert.equal(lineOf(dir, 'r2'), 'Working on: Fix the date parser', text);
  }
  addRun(dir);
  prompt(home, 'r2', dir, 'carry on');
  assert.equal(bandRec(dir).text, 'add --since', 'a run\'s next task, by its words, without the ledger id');

  const plain = project();
  prompt(home, 'r2b', plain, 'add a --json flag to the status command and test it');
  prompt(home, 'r2b', plain, 'continue');
  assert.equal(lineOf(plain, 'r2b'), 'Working on: add a --json flag to the status command and test it', 'no item stored: the goal');
  prompt(home, 'r2b', plain, 'keep going until the login page works');
  assert.equal(lineOf(plain, 'r2b'), 'Working on: keep going until the login page works', 'keep-going with a goal of its own is a request');
});

test('a thank-you or an "ok" names nothing, so no older item is claimed, and it ends a question that was up', () => {
  const home = sandbox(); const dir = project({ page: PAGE });
  prompt(home, 'r3', dir, 'add a --json flag to the status command and test it');
  stop(home, 'r3', dir, transcript(dir, said(ASKED)));
  assert.equal(bandRec(dir).kind, 'needs');
  for (const text of ['thanks', 'ok', 'where are we?']) {
    prompt(home, 'r3', dir, text);
    assert.equal(lineOf(dir, 'r3'), '', text);
    assert.equal(bandRec(dir).kind, 'working', `${text}: the turn is on, it just names nothing`);
  }
});

// A refused Stop's line used to be the stored item, so a turn that went on
// claimed the page's next step instead of what the user had just asked.
test('a Stop refused with keep-going off keeps the line on what the turn\'s prompt asked', () => {
  const home = sandbox(); const dir = project({ page: PAGE });
  prompt(home, 'r12', dir, 'now fix the login page so it remembers the user');
  // A test count no output shows is refused once (lib/proof-claim.mjs).
  const r = stop(home, 'r12', dir, transcript(dir, ...EDITED, said('Done. All 42 tests pass.')));
  assert.equal(r.json && r.json.decision, 'block', 'the Stop is refused, as before');
  assert.equal(lineOf(dir, 'r12'), 'Working on: now fix the login page so it remembers the user');
});

test('with keep-going, the goal in the user\'s words is what the line says', () => {
  const home = sandbox(); const dir = project();
  prompt(home, 'r4', dir, 'keep going until the login page works');
  const rec = bandRec(dir);
  assert.equal(rec.kind, 'working');
  assert.match(rec.text, /login page works/);
});

test('a prompt that answers a question ends the needs: the line goes back to working', () => {
  const home = sandbox(); const dir = project();
  stop(home, 'r5', dir, transcript(dir, said(ASKED)));
  assert.equal(bandRec(dir).kind, 'needs');
  prompt(home, 'r5', dir, 'Postgres, and add a migration for it');
  assert.equal(bandRec(dir).kind, 'working');
});

test('a slash command writes nothing', () => {
  const home = sandbox(); const dir = project();
  const prior = JSON.stringify({ session: 'r6', kind: 'needs', text: ASKED, at: '2026-10-03T09:00:00.000Z' });
  writeFileSync(bandFile(dir), prior);
  prompt(home, 'r6', dir, '/help');
  prompt(home, 'r6', dir, '/model sonnet');
  assert.equal(readFileSync(bandFile(dir), 'utf8'), prior);
});

test('a notice the host submits as a prompt writes nothing', () => {
  const home = sandbox(); const dir = project();
  const prior = JSON.stringify({ session: 'r7', kind: 'idle', text: '', at: '2026-10-03T09:00:00.000Z' });
  writeFileSync(bandFile(dir), prior);
  prompt(home, 'r7', dir, '[SYSTEM NOTIFICATION - NOT USER INPUT] A background task finished: review the diff');
  prompt(home, 'r7', dir, '<task-notification><task-id>b1</task-id><status>completed</status></task-notification>');
  assert.equal(readFileSync(bandFile(dir), 'utf8'), prior, 'a finished helper\'s notice is not the user asking for anything');
});

test('a helper\'s prompt writes nothing', () => {
  const home = sandbox(); const dir = project();
  prompt(home, 'r8', dir, 'add a --json flag to the status command and test it', { agent_id: 'helper-1', agent_type: 'orch-implementer' });
  assert.equal(existsSync(bandFile(dir)), false);
});

test('in a project the plugin has not worked in, a prompt writes no record and makes no folder', () => {
  const home = sandbox(); const dir = project({ orch: false });
  prompt(home, 'r9', dir, 'add a --json flag to the status command and test it');
  assert.equal(existsSync(join(dir, '.orchestrator')), false);
});

test('a muted router still writes the band, which is not model-facing', () => {
  const home = sandbox(); const dir = project();
  prompt(home, 'r10', dir, 'router off');
  const r = prompt(home, 'r10', dir, 'add a --json flag to the status command and test it');
  assert.equal(r.stdout.trim(), '', 'muted: nothing is said to the model');
  assert.equal(bandRec(dir).kind, 'working');
});

// With the router off a prompt wrote nothing while every Stop still wrote, so
// an answered question stayed up through the whole next turn (whole-file
// review). The router off still says nothing and arms nothing.
test('with the router off in its settings, a prompt still leaves its line and says nothing', () => {
  const home = sandbox(); const dir = project();
  const profile = join(home, '.claude', 'orchestrate', 'profile.json');
  writeFileSync(profile, JSON.stringify({ ...JSON.parse(readFileSync(profile, 'utf8')), router: { enabled: false } }));
  stop(home, 'off1', dir, transcript(dir, said(ASKED)));
  assert.equal(lineOf(dir, 'off1'), `Needs you: ${ASKED}`);
  const r = prompt(home, 'off1', dir, 'Postgres, and add a migration for it');
  assert.equal(r.stdout, '', 'nothing is said to the model');
  assert.equal(lineOf(dir, 'off1'), 'Working on: Postgres, and add a migration for it');
  assert.equal(existsSync(sessionFile(home, 'off1')), false, 'and no session file is made for it');
  prompt(home, 'off1', dir, 'keep going until the migration runs');
  assert.equal(existsSync(sessionFile(home, 'off1')), false, 'nothing is armed');
  const prior = readFileSync(bandFile(dir), 'utf8');
  prompt(home, 'off1', dir, '/help');
  prompt(home, 'off1', dir, '<task-notification><task-id>b1</task-id><status>completed</status></task-notification>');
  assert.equal(readFileSync(bandFile(dir), 'utf8'), prior, 'a slash command or a host notice writes nothing, as with the router on');
});

test('the record sits at the git root when the prompt names a folder inside the repository', () => {
  const home = sandbox(); const repo = project();
  mkdirSync(join(repo, 'src', 'deep'), { recursive: true });
  prompt(home, 'r11', join(repo, 'src', 'deep'), 'add a --json flag to the status command and test it');
  assert.equal(existsSync(bandFile(repo)), true);
  assert.equal(existsSync(join(repo, 'src', 'deep', '.orchestrator')), false);
});

test('writing the band changes nothing the router prints', () => {
  for (const text of ['add a --json flag to the status command and test it', 'keep going until the login page works', 'ok', '/help']) {
    const out = [];
    for (const orch of [true, false]) {
      const home = sandbox(); const dir = project({ orch });
      const r = run(ROUTER, { hook_event_name: 'UserPromptSubmit', session_id: 'same', prompt_id: 'same-prompt', cwd: dir, permission_mode: 'auto', prompt: text }, home);
      out.push({ status: r.status, stdout: r.stdout });
    }
    assert.deepEqual(out[0], out[1], `${JSON.stringify(text)}: the same output with and without the band's folder`);
  }
});

test('the prompt that ends a pause leaves the working line', () => {
  const home = sandbox(); const dir = project();
  run(HOOK, failurePayload('c1', dir), home);
  assert.match(lineOf(dir, 'c1'), /^Paused for the usage limit/);
  prompt(home, 'c1', dir, 'is it still paused? add a --json flag to the status command');
  assert.equal(parsePauseText(readFileSync(pauseFile(dir), 'utf8')), null, 'the prompt cleared the pause');
  assert.match(lineOf(dir, 'c1'), /^Working on: /);
});
