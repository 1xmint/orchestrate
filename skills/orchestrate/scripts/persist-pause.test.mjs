// persist-pause.test.mjs — keep-going through a usage limit, end to end: the
// exact JSON the host hands the hook, a fake HOME so nothing touches this
// machine's ~/.claude, and a real persist-check.mjs / router.mjs process each
// time. docs/pause.md says what each case is for.
//   node --test skills/orchestrate/scripts/persist-pause.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { QUOTA_FACT, PERSIST_STEP_CAP } from './persist-check.mjs';
import { readQuota, snapshotFrom } from './lib/quota.mjs';
import { readPause } from './lib/pause.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const HOOK = join(HERE, 'persist-check.mjs');
const ROUTER = join(HERE, 'router.mjs');

// ---- transcript records, in the host's JSONL shape ----------------------------
const asst = (...content) => JSON.stringify({ type: 'assistant', message: { role: 'assistant', content } });
const said = text => asst({ type: 'text', text });
const used = (name, id) => asst({ type: 'tool_use', id, name, input: {} });
const result = (id, text, isError = false) => JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: text, is_error: isError }] } });
const lines = (...l) => l.join('\n') + '\n';

// ---- sandbox ------------------------------------------------------------------
function sandbox() {
  const home = mkdtempSync(join(tmpdir(), 'orch-pause-'));
  mkdirSync(join(home, '.claude', 'orchestrate', 'sessions'), { recursive: true });
  return home;
}
// A project the plugin already works in: its .orchestrator folder exists. The
// pause record is written only there (a project the plugin never touched gets
// nothing; the last tests below hold that).
const cwdDir = () => { const d = mkdtempSync(join(tmpdir(), 'orch-pause-cwd-')); mkdirSync(join(d, '.orchestrator')); return d; };
function run(script, payload, home) {
  const r = spawnSync(process.execPath, [script], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, HOME: home, USERPROFILE: home, ANTHROPIC_API_KEY: '', CLAUDE_CODE_HOST_SESSION_ID: '' },
  });
  let json = null;
  try { json = r.stdout.trim() ? JSON.parse(r.stdout) : null; } catch {}
  return { status: r.status, stdout: r.stdout, json };
}
const sessionFile = (home, id) => join(home, '.claude', 'orchestrate', 'sessions', `${id}.json`);
const session = (home, id) => JSON.parse(readFileSync(sessionFile(home, id), 'utf8'));
// A session that said "keep going": what router.mjs writes, trimmed to what the
// Stop hook reads.
function arm(home, id) {
  writeFileSync(sessionFile(home, id), JSON.stringify({ v: 1, session_id: id, persist: { armed: true, goal: 'ship the site', goalSource: 'prompt', armedAt: '2026-10-03T00:00:00.000Z', sizeAtArm: 0 } }));
}
function transcript(dir, ...recs) {
  const p = join(dir, 't.jsonl');
  writeFileSync(p, lines(...recs));
  return p;
}
const stopPayload = (id, dir, t, extra = {}) => ({ hook_event_name: 'Stop', session_id: id, cwd: dir, transcript_path: t, stop_hook_active: false, ...extra });
const failurePayload = (id, dir, extra = {}) => ({ hook_event_name: 'StopFailure', session_id: id, cwd: dir, transcript_path: '', error: 'rate_limit', ...extra });
const pauseFile = dir => join(dir, '.orchestrator', 'pause.json');
const pauseRec = dir => JSON.parse(readFileSync(pauseFile(dir), 'utf8'));

const REFUSAL = 'orchestrate quota: the 5-hour usage window is at 82%, so a new helper would likely be cut off mid-task. It resets at 3:00 PM, and Claude Code resumes on its own after that; work in this conversation still runs.';

// ---- a helper refused for usage -------------------------------------------------
test('a helper refused at 80% does not disarm keep-going; the continue reason says helpers are refused', () => {
  const home = sandbox(); const dir = cwdDir();
  arm(home, 'q1');
  // Three helpers sent in one step, all refused with the same words: the shape
  // that used to read as "the same error twice" as well as a denial.
  const t = transcript(dir,
    used('Agent', 'a1'), result('a1', REFUSAL, true),
    used('Agent', 'a2'), result('a2', REFUSAL, true),
    used('Agent', 'a3'), result('a3', REFUSAL, true),
    used('Edit', 'e1'), result('e1', 'ok'),
    said('Carrying on without them.'));
  const r = run(HOOK, stopPayload('q1', dir, t), home);
  assert.equal(r.status, 0);
  assert.equal(r.json.decision, 'block', 'the Stop is refused, so the loop goes on');
  assert.ok(r.json.reason.includes(QUOTA_FACT));
  assert.match(r.json.reason, /helpers are refused/);
  assert.match(r.json.reason, /this session can still work/);
  assert.match(r.json.reason, new RegExp(`step 1 of ${PERSIST_STEP_CAP}`));
  assert.equal(r.json.systemMessage, undefined, 'nothing says the loop ended');
  const s = session(home, 'q1');
  assert.equal(s.persist.armed, true);
  assert.equal(s.persist.endReason, undefined);
});

test('a helper refused for the week is the same: keep-going stays on', () => {
  const home = sandbox(); const dir = cwdDir();
  arm(home, 'q2');
  const t = transcript(dir, used('Agent', 'a1'), result('a1', 'orchestrate quota: the weekly limit is at 93%, so no new helper starts; work in this conversation still runs.', true), used('Bash', 'b1'), result('b1', 'ok'), said('Doing the step myself.'));
  const r = run(HOOK, stopPayload('q2', dir, t), home);
  assert.equal(r.json.decision, 'block');
  assert.match(r.json.reason, /helpers are refused/);
  assert.equal(session(home, 'q2').persist.armed, true);
});

// Independent review, 2026-10-03: a refused send counted as work, so a lead that
// kept re-sending helpers at the limit was kept going for up to 25 idle turns,
// each re-reading the whole conversation, when usage was scarcest.
test('a step whose only work was helper sends refused for usage did no work: the loop ends', () => {
  const home = sandbox(); const dir = cwdDir();
  arm(home, 'q3');
  const t = transcript(dir,
    used('Agent', 'a1'), result('a1', REFUSAL, true),
    used('Agent', 'a2'), result('a2', REFUSAL, true),
    said('Trying the helpers again.'));
  const r = run(HOOK, stopPayload('q3', dir, t), home);
  assert.equal(r.json.decision, undefined, 'the Stop is not refused');
  assert.match(r.json.systemMessage, /^Keep-going stopped: the last step did no visible work/);
  assert.equal(session(home, 'q3').persist.armed, false);
});

// ---- a budget or credential refusal still stops --------------------------------
test('a budget or guard refusal still stops: keep-going is turned off and the user is told why', () => {
  for (const prefix of ['budget', 'guard']) {
    const home = sandbox(); const dir = cwdDir();
    const id = `d-${prefix}`;
    arm(home, id);
    const t = transcript(dir, used('Agent', 'a1'), result('a1', `orchestrate ${prefix}: this dispatch cannot go ahead`, true), said('Stopping here.'));
    const r = run(HOOK, stopPayload(id, dir, t), home);
    assert.equal(r.json.decision, undefined, `${prefix}: a Stop that ends the loop never blocks`);
    assert.match(r.json.systemMessage, /^Keep-going stopped: a helper was refused \(budget or credential\)/, prefix);
    const s = session(home, id);
    assert.equal(s.persist.armed, false, prefix);
    assert.match(s.persist.endReason, /a helper was refused/, prefix);
  }
});

// ---- the 90% window ------------------------------------------------------------
test('the 90% window no longer stops keep-going', () => {
  const home = sandbox(); const dir = cwdDir();
  arm(home, 'w1');
  // A fresh reading, from a known account, at 95% of the 5-hour window: the
  // snapshot the old stop would have read.
  const now = Date.now();
  const quotaPath = join(home, '.claude', 'orchestrate', 'quota.json');
  writeFileSync(quotaPath, JSON.stringify(snapshotFrom({ rate_limits: { five_hour: { used_percentage: 95, resets_at: Math.floor(now / 1000) + 3600 } } }, now, 'org-a')));
  assert.equal(readQuota(now, quotaPath, 'org-a').fiveHour.pct, 95, 'the fixture is a reading the hooks accept');

  const t = transcript(dir, used('Edit', 'e1'), result('e1', 'ok'), said('Header done.'));
  const r = run(HOOK, stopPayload('w1', dir, t), home);
  assert.equal(r.json.decision, 'block', 'a working step at 95% is continued');
  assert.match(r.json.reason, new RegExp(`step 1 of ${PERSIST_STEP_CAP}`));
  assert.doesNotMatch(r.json.reason, /usage window|%/, 'and no line about the window is added');
  assert.equal(session(home, 'w1').persist.armed, true);
});

// ---- StopFailure: the pause record ----------------------------------------------
test('StopFailure rate_limit writes the pause record and leaves keep-going armed', () => {
  const home = sandbox(); const dir = cwdDir();
  arm(home, 'f1');
  const before = Date.now();
  const r = run(HOOK, failurePayload('f1', dir, { error_details: '429 Too Many Requests', last_assistant_message: 'Working on the footer.' }), home);
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), '', 'the host ignores output here, so nothing is printed');

  const rec = pauseRec(dir);
  assert.deepEqual(Object.keys(rec).sort(), ['at', 'error', 'kind', 'session', 'text']);
  assert.equal(rec.kind, 'usage_limit');
  assert.equal(rec.error, 'rate_limit');
  assert.equal(rec.session, 'f1');
  assert.equal(rec.text, 'Paused for the usage limit; keep-going stays on.');
  assert.equal(new Date(rec.at).toISOString(), rec.at, 'an ISO time');
  assert.ok(Date.parse(rec.at) >= before - 1000 && Date.parse(rec.at) <= Date.now() + 1000);

  const s = session(home, 'f1');
  assert.equal(s.persist.armed, true, 'keep-going is untouched');
  assert.equal(s.persist.endedAt, undefined);
  assert.equal(readPause(dir, { session: 'f1' }).kind, 'usage_limit', 'and the band-side reader sees it');

  // The resume the host performs lands on a loop that still continues.
  const t = transcript(dir, used('Edit', 'e1'), result('e1', 'ok'), said('Footer done.'));
  assert.equal(run(HOOK, stopPayload('f1', dir, t), home).json.decision, 'block');
});

test('StopFailure writes every error kind it sees, and a payload with no usable kind reads as unknown', () => {
  const cases = [
    [{ error: 'overloaded' }, 'overloaded'],
    [{ error: 'authentication_failed' }, 'authentication_failed'],
    [{ error: 'verification_required' }, 'verification_required'],
    [{ error: 'a_kind_nobody_has_seen' }, 'a_kind_nobody_has_seen'],
    [{ error: undefined }, 'unknown'],
    [{ error: '' }, 'unknown'],
    [{ error: { type: 'rate_limit' } }, 'unknown'],
  ];
  for (const [extra, kind] of cases) {
    const home = sandbox(); const dir = cwdDir();
    arm(home, 'f2');
    const r = run(HOOK, failurePayload('f2', dir, extra), home);
    assert.equal(r.stdout.trim(), '');
    const rec = pauseRec(dir);
    assert.equal(rec.kind, 'api_error', kind);
    assert.equal(rec.error, kind);
    assert.equal(rec.text, `Stopped on an API error (${kind}); keep-going stays on.`);
    assert.equal(session(home, 'f2').persist.armed, true, `${kind}: keep-going stays armed`);
  }
});

test('StopFailure in a session that never armed keep-going does not say keep-going stays on', () => {
  const home = sandbox(); const dir = cwdDir();
  run(HOOK, failurePayload('f3', dir), home);
  assert.equal(pauseRec(dir).text, 'Paused for the usage limit.');
  assert.equal(existsSync(sessionFile(home, 'f3')), false, 'and the hook made no session file for it');
});

test('StopFailure inside a helper writes nothing', () => {
  const home = sandbox(); const dir = cwdDir();
  arm(home, 'f4');
  const r = run(HOOK, failurePayload('f4', dir, { agent_id: 'helper-1', agent_type: 'orch-implementer' }), home);
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), '');
  assert.equal(existsSync(pauseFile(dir)), false, 'no record');
  assert.equal(session(home, 'f4').persist.armed, true);
});

test('the record sits at the git root when the payload names a folder inside a repository', () => {
  const home = sandbox();
  const repo = cwdDir();
  mkdirSync(join(repo, '.git'));
  mkdirSync(join(repo, 'src', 'deep'), { recursive: true });
  run(HOOK, failurePayload('f5', join(repo, 'src', 'deep')), home);
  assert.equal(existsSync(pauseFile(repo)), true);
  assert.equal(existsSync(pauseFile(join(repo, 'src', 'deep'))), false);
});

test('a StopFailure with no cwd writes nothing and fails nothing', () => {
  const home = sandbox();
  const r = run(HOOK, { hook_event_name: 'StopFailure', session_id: 'f6', error: 'rate_limit' }, home);
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), '');
});

// ---- the record is cleared by the same session's next Stop or prompt ---------------
test('the pause record is cleared at the next ordinary Stop of that session, and no other', () => {
  const home = sandbox(); const dir = cwdDir();
  run(HOOK, failurePayload('c1', dir), home);
  assert.equal(readPause(dir).session, 'c1');

  // Another session's Stop, and a helper's own Stop, leave it alone.
  assert.equal(run(HOOK, stopPayload('someone-else', dir, ''), home).stdout.trim(), '');
  assert.equal(readPause(dir).session, 'c1', 'another session\'s Stop does not clear it');
  run(HOOK, stopPayload('c1', dir, '', { agent_id: 'helper-1' }), home);
  assert.equal(readPause(dir).session, 'c1', 'a helper\'s Stop does not clear it');

  // The session's own ordinary Stop, armed or not, ends the pause.
  assert.equal(run(HOOK, stopPayload('c1', dir, ''), home).stdout.trim(), '');
  assert.equal(readPause(dir), null);
  const kept = pauseRec(dir);
  assert.equal(kept.error, 'rate_limit', 'the marked record still says which error arrived');
  assert.equal(kept.clearedBy, 'stop');
  assert.equal(new Date(kept.cleared).toISOString(), kept.cleared);
});

test('the pause record is cleared at the next prompt of that session, and no other', () => {
  const home = sandbox(); const dir = cwdDir();
  run(HOOK, failurePayload('c2', dir), home);
  const prompt = (id, extra = {}) => run(ROUTER, { hook_event_name: 'UserPromptSubmit', session_id: id, cwd: dir, prompt: 'is it still paused?', ...extra }, home);

  prompt('someone-else');
  assert.equal(readPause(dir).session, 'c2', 'another session\'s prompt does not clear it');
  prompt('c2', { agent_id: 'helper-1' });
  assert.equal(readPause(dir).session, 'c2', 'a helper\'s prompt does not clear it');

  assert.equal(prompt('c2').status, 0);
  assert.equal(readPause(dir), null);
  assert.equal(pauseRec(dir).clearedBy, 'prompt');
});

test('a later pause replaces a cleared one', () => {
  const home = sandbox(); const dir = cwdDir();
  run(HOOK, failurePayload('c3', dir), home);
  run(HOOK, stopPayload('c3', dir, ''), home);
  assert.equal(readPause(dir), null);
  run(HOOK, failurePayload('c3', dir, { error: 'overloaded' }), home);
  const rec = readPause(dir);
  assert.equal(rec.error, 'overloaded');
  assert.equal(rec.cleared, undefined);
});

// ---- helpers or background commands still out -----------------------------------
test('background work out: no "did no visible work" stop; the Stop passes and keep-going stays armed', () => {
  const task = { id: 'b1', type: 'subagent', status: 'running', description: 'review the diff', agent_type: 'orch-reviewer' };
  const cron = { id: 'c1', schedule: '*/5 * * * *', recurring: true, prompt: 'check CI' };
  for (const [name, extra] of [['a background task', { background_tasks: [task] }], ['a scheduled prompt', { session_crons: [cron] }], ['an empty task list beside a scheduled prompt', { background_tasks: [], session_crons: [cron] }]]) {
    const home = sandbox(); const dir = cwdDir();
    arm(home, 'b1');
    const t = transcript(dir, said('Waiting for the reviewer to report.'));
    const r = run(HOOK, stopPayload('b1', dir, t, extra), home);
    assert.equal(r.status, 0, name);
    assert.equal(r.stdout.trim(), '', `${name}: no block and no "Keep-going stopped" line`);
    const s = session(home, 'b1');
    assert.equal(s.persist.armed, true, name);
    assert.equal(s.persist.endReason, undefined, name);
  }
});

test('with nothing out, or nothing said about it, a step that did no work still ends the loop', () => {
  for (const [name, extra] of [['no fields', {}], ['empty lists', { background_tasks: [], session_crons: [] }], ['fields of the wrong shape', { background_tasks: 'running', session_crons: 2 }]]) {
    const home = sandbox(); const dir = cwdDir();
    arm(home, 'b2');
    const t = transcript(dir, said('The header and footer are in; CI is still running.'));
    const r = run(HOOK, stopPayload('b2', dir, t, extra), home);
    assert.match(r.json.systemMessage, /^Keep-going stopped: the last step did no visible work/, name);
    assert.equal(session(home, 'b2').persist.armed, false, name);
  }
});

// Independent review, 2026-10-03: a dev server or monitor started in the
// background, or a recurring scheduled prompt, stays listed for the whole
// session, so "work is out" alone would wait on it forever.
test('the same work still out after a wait with nothing done since ends the loop; new work out waits again', () => {
  const home = sandbox(); const dir = cwdDir();
  arm(home, 'b4');
  const server = { background_tasks: [{ id: 'srv', type: 'shell', status: 'running', description: 'npm run dev' }] };
  const t = transcript(dir, said('The site is up at localhost:3000.'));
  assert.equal(run(HOOK, stopPayload('b4', dir, t, server), home).stdout.trim(), '', 'the first idle Stop with work out is a wait');
  // Nothing the server does wakes the session; the user asks, and the step
  // still does nothing.
  writeFileSync(t, lines(said('The site is up at localhost:3000.'), JSON.stringify({ type: 'user', message: { role: 'user', content: 'is it done?' } }), said('Still waiting.')));
  const second = run(HOOK, stopPayload('b4', dir, t, server), home);
  assert.match(second.json.systemMessage, /^Keep-going stopped: the step after your message did no visible work while only a background command kept running/);
  assert.equal(session(home, 'b4').persist.armed, false);

  const home2 = sandbox(); const dir2 = cwdDir();
  arm(home2, 'b5');
  const t2 = transcript(dir2, said('Two reviews are out.'));
  assert.equal(run(HOOK, stopPayload('b5', dir2, t2, { background_tasks: [{ id: 'r1', type: 'subagent' }, { id: 'r2', type: 'subagent' }] }), home2).stdout.trim(), '');
  writeFileSync(t2, lines(said('Two reviews are out.'), said('One landed; waiting on the other.')));
  assert.equal(run(HOOK, stopPayload('b5', dir2, t2, { background_tasks: [{ id: 'r2', type: 'subagent' }] }), home2).stdout.trim(), '', 'one landed, the other is still out: a wait again');
  assert.equal(session(home2, 'b5').persist.armed, true);
});

// Independent review round 2, 2026-10-03: a Monitor on CI stays listed and wakes
// the session once per line; a step that only notes the line must not end
// keep-going while CI still runs. Round 4: a Monitor that runs a command may be
// listed as type "shell", like a dev server, so a status question from the user
// while it runs must not end keep-going either.
test('woken by the work that is still out, an idle step waits again, even after the user asks how it is going', () => {
  for (const type of ['shell', 'monitor']) {
    const home = sandbox(); const dir = cwdDir();
    arm(home, 'b6');
    const monitor = { background_tasks: [{ id: 'm1', type, status: 'running', description: 'watch CI' }] };
    const start = [used('Monitor', 'm1'), result('m1', 'Monitor started.'), said('Pushed; watching CI.')];
    const t = transcript(dir, ...start);
    assert.equal(run(HOOK, stopPayload('b6', dir, t, monitor), home).stdout.trim(), '', type);
    const woke = [...start, JSON.stringify({ type: 'user', message: { role: 'user', content: '<task-notification>\nlint passed\n</task-notification>' } }), said('Lint passed; waiting on the tests.')];
    writeFileSync(t, lines(...woke));
    assert.equal(run(HOOK, stopPayload('b6', dir, t, monitor), home).stdout.trim(), '', `${type}: a wait again, not a stop`);
    writeFileSync(t, lines(...woke, JSON.stringify({ type: 'user', message: { role: 'user', content: "how's it going?" } }), said('CI is still running the tests.')));
    assert.equal(run(HOOK, stopPayload('b6', dir, t, monitor), home).stdout.trim(), '', `${type}: the user's question is not a reason to stop`);
    assert.equal(session(home, 'b6').persist.armed, true, type);
  }
});

// A wait on nothing: the message promises to check back, and the payload lists
// nothing out. One refusal with the fact, then an idle step ends keep-going.
test('a step that only promises to check back, with nothing out, hears the fact once and then ends keep-going', () => {
  const home = sandbox(); const dir = cwdDir();
  arm(home, 'n1');
  const none = { background_tasks: [], session_crons: [] };
  const first = [used('Bash', 'b1'), result('b1', 'pushed'), said("Pushed. I'll check back when CI finishes.")];
  const t = transcript(dir, ...first);
  // The push was work: an ordinary continue.
  assert.match(run(HOOK, stopPayload('n1', dir, t, none), home).json.reason, /^orchestrate: /);
  writeFileSync(t, lines(...first, said("CI is running. I'll check back when it finishes.")));
  const told = run(HOOK, stopPayload('n1', dir, t, { ...none, stop_hook_active: true }), home);
  assert.match(told.json.reason, /your last message says this session will wait or check back; the Stop payload lists no helper, background command, Monitor or scheduled prompt that would wake this session/);
  assert.equal(session(home, 'n1').persist.armed, true);
  writeFileSync(t, lines(...first, said("CI is running. I'll check back when it finishes."), said("Still waiting for CI; I'll check back.")));
  const ended = run(HOOK, stopPayload('n1', dir, t, { ...none, stop_hook_active: true }), home);
  assert.match(ended.json.systemMessage, /^Keep-going stopped: the last step only waited, and nothing was running that would wake this session/);
  assert.equal(session(home, 'n1').persist.armed, false);
});

// Inside a keep-going stretch every Stop follows the loop's own refusal, so a
// check that skipped any refused Stop never read the stretch's closing report.
// The closing-claim checks skip only the Stop right after their own refusal.
test('keep-going: a closing claim is read inside a stretch, and the reply to a claim refusal is not refused again', () => {
  const home = sandbox(); const dir = cwdDir();
  arm(home, 'c7');
  const t = join(dir, 't.jsonl');
  const step1 = [used('Edit', 'e1'), result('e1', 'ok'), said('Edited the parser.')];
  writeFileSync(t, lines(...step1));
  assert.match(run(HOOK, stopPayload('c7', dir, t), home).json.reason, /^orchestrate: /, 'an ordinary continue');
  const step2 = [...step1, used('Edit', 'e2'), result('e2', 'ok'), said('Goal met: all 42 tests pass.')];
  writeFileSync(t, lines(...step2));
  const claim = run(HOOK, stopPayload('c7', dir, t, { stop_hook_active: true, last_assistant_message: 'Goal met: all 42 tests pass.' }), home);
  assert.match(claim.json.reason, /^Your last message gives 42 as a count of passing tests or checks/, 'read although the loop refused the Stop before');
  const step3 = [...step2, said('Correction: 12 tests ran; I have not seen a count of 42.')];
  writeFileSync(t, lines(...step3));
  const reply = run(HOOK, stopPayload('c7', dir, t, { stop_hook_active: true, last_assistant_message: 'Correction: 12 tests ran; 12 passing.' }), home);
  assert.doesNotMatch(String(reply.stdout), /count of passing tests/, 'the reply to a claim refusal is not refused for its own claim');
});

test('a wait does not use up a step: the count after the helper lands is where it was', () => {
  const home = sandbox(); const dir = cwdDir();
  arm(home, 'b3');
  const t = join(dir, 't.jsonl');
  const out = { background_tasks: [{ id: 'b1', type: 'shell', status: 'running', description: 'npm test' }] };
  writeFileSync(t, lines(used('Edit', 'e1'), result('e1', 'ok'), said('Started the tests.')));
  assert.match(run(HOOK, stopPayload('b3', dir, t), home).json.reason, new RegExp(`step 1 of ${PERSIST_STEP_CAP}`));
  writeFileSync(t, lines(used('Edit', 'e1'), result('e1', 'ok'), said('Started the tests.'), said('Waiting on the tests.')));
  assert.equal(run(HOOK, stopPayload('b3', dir, t, out), home).stdout.trim(), '', 'idle with a command out: a wait');
  writeFileSync(t, lines(used('Edit', 'e1'), result('e1', 'ok'), said('Started the tests.'), said('Waiting on the tests.'), used('Edit', 'e2'), result('e2', 'ok'), said('Fixed what the tests found.')));
  assert.match(run(HOOK, stopPayload('b3', dir, t), home).json.reason, new RegExp(`step 2 of ${PERSIST_STEP_CAP}`), 'the wait was not a step');
});

test('a project the plugin never touched gets no folder and no record from an API error', () => {
  const home = sandbox();
  const bare = mkdtempSync(join(tmpdir(), 'orch-pause-bare-'));
  arm(home, 'f9');
  const r = run(HOOK, failurePayload('f9', bare), home);
  assert.equal(r.status, 0);
  assert.equal(existsSync(join(bare, '.orchestrator')), false, 'the hook runs in every folder a session opens, so it makes none');
  assert.equal(session(home, 'f9').persist.armed, true, 'and keep-going is untouched');
});

test('the pause record is kept out of commits by a .gitignore beside it', () => {
  const home = sandbox(); const dir = cwdDir();
  run(HOOK, failurePayload('f10', dir), home);
  const ignore = readFileSync(join(dir, '.orchestrator', '.gitignore'), 'utf8').split('\n');
  assert.ok(ignore.includes('pause.json') && ignore.includes('band.json'), 'both state files are named');
});
