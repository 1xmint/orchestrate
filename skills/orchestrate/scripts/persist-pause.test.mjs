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
const cwdDir = () => mkdtempSync(join(tmpdir(), 'orch-pause-cwd-'));
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
  const t = transcript(dir, used('Agent', 'a1'), result('a1', 'orchestrate quota: the weekly limit is at 93%, so no new helper starts; work in this conversation still runs.', true), said('Doing the step myself.'));
  const r = run(HOOK, stopPayload('q2', dir, t), home);
  assert.equal(r.json.decision, 'block');
  assert.match(r.json.reason, /helpers are refused/);
  assert.equal(session(home, 'q2').persist.armed, true);
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
    assert.match(r.json.systemMessage, /^Auto-continue stopped: a dispatch was denied \(budget or credential\)/, prefix);
    const s = session(home, id);
    assert.equal(s.persist.armed, false, prefix);
    assert.match(s.persist.endReason, /a dispatch was denied/, prefix);
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
  assert.equal(existsSync(join(dir, '.orchestrator')), false, 'no record, and no folder made for one');
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
    assert.equal(r.stdout.trim(), '', `${name}: no block and no "Auto-continue stopped" line`);
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
    assert.match(r.json.systemMessage, /^Auto-continue stopped: the last step did no visible work/, name);
    assert.equal(session(home, 'b2').persist.armed, false, name);
  }
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
