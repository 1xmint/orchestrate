// guard-model.test.mjs — the dispatch-time model rule as a pure decision. The
// cases are the dispatches this machine actually recorded: Opus implementers,
// unnamed-model Explore sweeps, and plugin-namespaced role names.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modelDecision, taskKey, grantCheck, FORK_MAX_CONTEXT, progressFact, AUTHOR_ROLES, claimOrDeny } from './guard-agent.mjs';
import { normalizeRole, estimateDollars } from './lib/prices.mjs';
import { snapshotFrom, readQuota } from './lib/quota.mjs';
import { quotaPhrase, quotaBand } from './router.mjs';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const GUARD = join(HERE, 'guard-agent.mjs');
const GUARD_URL = pathToFileURL(GUARD).href;

// tier.mjs pins its DIR to this process's real home the moment it is first
// imported, so readGrantId/grantPath cannot be exercised safely in-process —
// a test here would read and write the real user's home directory, and every
// other test in this file already shares that one import. A child process
// with HOME pointed at a sandbox is the only safe way to reach them.
function evalInSandbox(home, code) {
  const r = spawnSync(process.execPath, ['--input-type=module'], {
    input: code,
    encoding: 'utf8',
    env: { ...process.env, HOME: home, USERPROFILE: home },
  });
  if (r.status !== 0) throw new Error(`sandbox eval failed: ${r.stderr}`);
  return r.stdout;
}

function sandbox() {
  const home = mkdtempSync(join(tmpdir(), 'orch-grant-home-'));
  mkdirSync(join(home, '.claude', 'orchestrate', 'sessions'), { recursive: true });
  writeFileSync(join(home, '.claude', 'orchestrate', 'profile.json'), JSON.stringify({ tier: 'pro' }));
  return home;
}

function writeSession(home, sid, state) {
  writeFileSync(join(home, '.claude', 'orchestrate', 'sessions', `${sid}.json`), JSON.stringify({ v: 1, session_id: sid, ...state }));
}

function dispatch(home, sid, ti) {
  const r = spawnSync(process.execPath, [GUARD], {
    input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Agent', session_id: sid, cwd: home, tool_use_id: `u-${Math.random()}`, tool_input: ti }),
    encoding: 'utf8',
    env: { ...process.env, HOME: home, USERPROFILE: home, ANTHROPIC_API_KEY: '' },
  });
  let json = null;
  try { json = r.stdout.trim() ? JSON.parse(r.stdout) : null; } catch {}
  return { stdout: r.stdout, json };
}

const pro = { tier: 'pro' };

test('progressFact: a plain fact for an author-role packet with no PROGRESS line, absent for reviewer and in plan mode', () => {
  const reason = 'no PROGRESS line: a capped return will have nothing to resume from';
  for (const role of AUTHOR_ROLES) {
    assert.equal(progressFact(role, 'TASK: 1\nfind it', false), reason, `${role} names the missing line`);
    assert.equal(progressFact(`orchestrate:${role}`, 'TASK: 1\nfind it', false), reason, 'a plugin-namespaced role is still recognised');
    assert.equal(progressFact(role, 'TASK: 1\nPROGRESS: /r/p.md\nfind it', false), '', 'said nothing once the line is there');
    assert.equal(progressFact(role, 'TASK: 1\nfind it', true), '', 'plan mode already forbids the line, so this adds nothing');
  }
  assert.equal(progressFact('orch-reviewer', 'TASK: 1\nfind it', false), '', 'a reviewer returns a verdict, not partial work');
  assert.equal(progressFact('orch-coordinator', 'TASK: 1\nfind it', false), '', 'the coordinator packet is the lead\'s business');
  assert.equal(progressFact('Explore', 'x', false), '', 'a built-in sweeper is not an author role');
});

test('role names are one name whatever the install path calls them', () => {
  assert.equal(normalizeRole('orchestrate:orch-planner'), 'orch-planner');
  assert.equal(normalizeRole('orchestrate_orch-planner'), 'orch-planner');
  assert.equal(normalizeRole('orch-planner'), 'orch-planner');
  assert.equal(normalizeRole('Explore'), 'Explore');
  // The budget gate's estimate now finds the reasoned row for a plugin install.
  assert.ok(estimateDollars('orchestrate:orch-implementer', 'sonnet', []) > 0);
});

test('executors start on Sonnet; judgment roles may use Opus', () => {
  for (const role of ['orch-implementer', 'orchestrate:orch-researcher', 'orch-browser']) {
    assert.equal(modelDecision({ subagent_type: role, model: 'opus', prompt: 'TASK: 1-1-0001' }, pro).prefix, 'model', role);
    assert.equal(modelDecision({ subagent_type: role, model: 'sonnet', prompt: 'TASK: 1-1-0001' }, pro), null, role);
    assert.equal(modelDecision({ subagent_type: role, prompt: 'TASK: 1-1-0001' }, pro), null, `${role} with no model runs on its file's Sonnet`);
  }
  for (const role of ['orch-planner', 'orch-reviewer', 'orchestrate:orch-debugger']) {
    assert.equal(modelDecision({ subagent_type: role, model: 'opus', prompt: 'x' }, pro), null, role);
  }
});

test('escalation is allowed only after an attempt at the same task by the same role', () => {
  const ti = { subagent_type: 'orch-implementer', model: 'opus', prompt: 'TASK: 9-9-0002\nfix it' };
  const same = [{ agent: 'orchestrate:orch-implementer', model: 'sonnet', key: '9-9-0002' }];
  const other = [{ agent: 'orch-implementer', model: 'sonnet', key: '9-9-0003' }];
  const inherited = [{ agent: 'orch-implementer', model: 'inherit', key: '9-9-0002' }];
  assert.equal(modelDecision(ti, { ...pro, dispatches: same }), null);
  assert.equal(modelDecision(ti, { ...pro, dispatches: inherited }), null, 'no model named ran on the file\'s Sonnet');
  assert.equal(modelDecision(ti, { ...pro, dispatches: other }).prefix, 'model');
  assert.equal(taskKey('Write the plan for\n the thing'), 'write the plan for', 'a TASK word that is not an id falls back to the first line');
  assert.equal(taskKey('TASK: Write the plan'), 'task: write the plan');
});

test('a grant the user named unlocks one task id and refuses another by name', () => {
  const ti = { subagent_type: 'orch-implementer', model: 'opus', prompt: 'TASK: 9-18-0005\nfix it' };
  const grant = { family: 'opus', at: '2026-09-18T00:00:00Z' };
  // First use: allowed, and it carries the id to claim (main() does the actual
  // atomic claim; the pure function only says what to bind).
  const first = modelDecision(ti, { ...pro, userModel: grant });
  assert.deepEqual(first, { grantBind: '9-18-0005', at: grant.at, family: 'opus' }, 'a fresh grant lets the named task through and says what to bind');
  const bound = { ...grant, taskId: '9-18-0005' };
  assert.equal(modelDecision(ti, { ...pro, userModel: bound }), null, 'the same task id the grant is bound to stays allowed, nothing left to bind');
  const other = { ...ti, prompt: 'TASK: 9-18-0006\nfix something else' };
  const denied = modelDecision(other, { ...pro, userModel: bound });
  assert.equal(denied.prefix, 'model');
  assert.match(denied.reason, /9-18-0005/, 'names the task the grant is bound to');
  assert.match(denied.reason, /9-18-0006/, 'names the task that was refused');
});

test('a grant needs a numeric TASK id in the packet; no id, no unlock', () => {
  const ti = { subagent_type: 'orch-implementer', model: 'opus', prompt: 'fix the thing, no task id here' };
  const grant = { family: 'opus', at: '2026-09-18T00:00:00Z' };
  const d = modelDecision(ti, { ...pro, userModel: grant });
  assert.equal(d.prefix, 'model');
  assert.equal(grantCheck(grant, 'opus', ti.prompt, null), null);
});

test('grantCheck: bind on first use, allow on the bound id, deny naming both ids', () => {
  const grant = { family: 'fable', at: '2026-09-18T00:00:00Z' };
  const first = grantCheck(grant, 'fable', 'TASK: 1-1-0001\nx', null);
  assert.deepEqual(first, { allow: true, bind: '1-1-0001' });
  assert.deepEqual(grantCheck(grant, 'fable', 'TASK: 1-1-0001\nx', '1-1-0001'), { allow: true, bind: null });
  const other = grantCheck(grant, 'fable', 'TASK: 1-1-0002\nx', '1-1-0001');
  assert.equal(other.deny, true);
  assert.match(other.reason, /1-1-0001/);
  assert.match(other.reason, /1-1-0002/);
  assert.equal(grantCheck(null, 'fable', 'TASK: 1-1-0001\nx', null), null, 'no record, no grant');
  assert.equal(grantCheck(grant, 'opus', 'TASK: 1-1-0001\nx', null), null, 'wrong family, no grant');
});

test('claimOrDeny: a different id winning the race is denied by name, on both sides', () => {
  const grantToClaim = { grantBind: '1-1-0002', at: '2026-09-18T00:00:00Z', family: 'opus' };
  // Inject a claim function that behaves like the loser of a race: the file
  // already existed, and whoever created it bound task 1-1-0001.
  const raced = claimOrDeny('s-race', grantToClaim, () => '1-1-0001');
  assert.equal(raced.prefix, 'model');
  assert.match(raced.reason, /1-1-0001/, 'names the task that actually won');
  assert.match(raced.reason, /1-1-0002/, 'names the task that was refused');

  // The winner's own claim call comes back with its own id: allowed, nothing
  // to deny.
  const won = claimOrDeny('s-race', grantToClaim, () => '1-1-0002');
  assert.equal(won, null);
});

test('claimOrDeny: a claim that comes back empty (mid-write, or the claim failed outright) is denied with no id to name', () => {
  const grantToClaim = { grantBind: '1-1-0002', at: '2026-09-18T00:00:00Z', family: 'fable' };
  const gd = claimOrDeny('s-race', grantToClaim, () => null);
  assert.equal(gd.prefix, 'model');
  assert.doesNotMatch(gd.reason, /1-1-0002/, 'nothing to name; the claim itself failed or is still in flight');
  assert.match(gd.reason, /could not be claimed/);
});

test('readGrantId: a claim file that exists but is still empty reads as pending, never as unclaimed', () => {
  const home = sandbox();
  const code = `
    import { mkdirSync, closeSync, openSync } from 'node:fs';
    import { readGrantId, grantPath, grantCheck, GRANTS_DIR } from ${JSON.stringify(GUARD_URL)};
    const session = 's-pending';
    const at = '2026-09-18T00:00:00Z';
    mkdirSync(GRANTS_DIR, { recursive: true });
    closeSync(openSync(grantPath(session, at), 'wx'));
    const id = readGrantId(session, at);
    // grantCheck must refuse to treat this as free to bind: an id that does
    // not match the pending sentinel falls into the deny branch, not the
    // "unclaimed, allow" branch.
    const decision = grantCheck({ family: 'opus', at }, 'opus', 'TASK: 9-9-0001\\nx', id);
    console.log(JSON.stringify({ id, decision }));
  `;
  const out = evalInSandbox(home, code);
  const { id, decision } = JSON.parse(out.trim().split('\n').pop());
  assert.notEqual(id, null, 'an existing empty file is not "no claim yet"');
  assert.equal(decision.deny, true, 'a pending claim is never read as unclaimed');
});

test('modelDecision never returns grantBind for a judgment role or an already-cleared executor', () => {
  const grant = { family: 'opus', at: '2026-09-18T00:00:00Z' };
  // orch-planner is not an executor: never reaches the grant branch at all.
  const planner = modelDecision({ subagent_type: 'orch-planner', model: 'opus', prompt: 'TASK: 1-1-0001\nplan it' }, { ...pro, userModel: grant });
  assert.equal(planner, null, 'a judgment role needs no grant and binds nothing');
  // An executor a prior Sonnet attempt already cleared for this task never
  // reaches the grant branch either (the `tried` guard returns first).
  const tried = [{ agent: 'orch-implementer', model: 'sonnet', key: '1-1-0002' }];
  const cleared = modelDecision({ subagent_type: 'orch-implementer', model: 'opus', prompt: 'TASK: 1-1-0002\nfix it' }, { ...pro, userModel: grant, dispatches: tried });
  assert.equal(cleared, null, 'a task already cleared on Sonnet does not touch the grant');
});

test('taskKey: same header, different ids, different keys once the id has no digit', () => {
  const a = taskKey('APPROVED BY USER: fable\nTASK: X\nfoo');
  const b = taskKey('APPROVED BY USER: fable\nTASK: Y\nbar');
  assert.notEqual(a, b, 'the header line is skipped so the fallback reaches the differing text');
  assert.equal(taskKey('RISK: high\nBUILDS ON: 1\nfirst real line'), 'first real line');
});

test('built-in sweepers must name a cheap model', () => {
  assert.equal(modelDecision({ subagent_type: 'Explore', prompt: 'find X' }, pro).prefix, 'model');
  assert.equal(modelDecision({ prompt: 'find X' }, pro).prefix, 'model', 'no subagent_type is general-purpose');
  assert.equal(modelDecision({ subagent_type: 'Explore', model: 'opus', prompt: 'find X' }, pro).prefix, 'model');
  assert.equal(modelDecision({ subagent_type: 'Explore', model: 'haiku', prompt: 'find X' }, pro), null);
  assert.equal(modelDecision({ subagent_type: 'general-purpose', model: 'sonnet', prompt: 'x' }, pro), null);
});

test('a fork is refused only when the conversation it would copy is large', () => {
  assert.equal(modelDecision({ subagent_type: 'fork', prompt: 'x' }, { ...pro, leadContext: FORK_MAX_CONTEXT + 1 }).prefix, 'model');
  assert.equal(modelDecision({ subagent_type: 'fork', prompt: 'x' }, { ...pro, leadContext: 40000 }), null);
});

test('Fable needs the plan or the user\'s yes', () => {
  const ti = { subagent_type: 'orch-reviewer', model: 'fable', prompt: 'TASK: 1-1-0001' };
  assert.equal(modelDecision(ti, pro).prefix, 'model');
  assert.equal(modelDecision(ti, { tier: 'max20' }), null);
  assert.equal(modelDecision({ ...ti, prompt: 'TASK: 1-1-0001\nAPPROVED BY USER: fable' }, pro), null);
});

test('near the plan limit no helper starts, whatever its model', () => {
  const q = snapshotFrom({ rate_limits: { five_hour: { used_percentage: 83, resets_at: 1790000000 }, seven_day: { used_percentage: 10 } } });
  const d = modelDecision({ subagent_type: 'orch-implementer', model: 'sonnet', prompt: 'x' }, { ...pro, quota: q });
  assert.equal(d.prefix, 'quota');
  assert.match(d.reason, /83%/);
  const week = snapshotFrom({ rate_limits: { seven_day: { used_percentage: 95 } } });
  assert.equal(modelDecision({ subagent_type: 'orch-planner', model: 'opus', prompt: 'x' }, { ...pro, quota: week }).prefix, 'quota');
  const calm = snapshotFrom({ rate_limits: { five_hour: { used_percentage: 20 } } });
  assert.equal(modelDecision({ subagent_type: 'orch-implementer', model: 'sonnet', prompt: 'x' }, { ...pro, quota: calm }), null);
});

test('the router shows usage and names the band, not every percent', () => {
  const q = pct => snapshotFrom({ rate_limits: { five_hour: { used_percentage: pct }, seven_day: { used_percentage: 12 } } });
  assert.equal(quotaPhrase(q(23.4)), ' · usage 5h 23% wk 12%');
  assert.equal(quotaPhrase(null), '');
  assert.equal(quotaBand(q(30)), 'ok');
  assert.equal(quotaBand(q(65)), 'caution');
  assert.equal(quotaBand(q(85)), 'stop');
  assert.equal(quotaBand(null), 'none');
});

test('a stale or empty quota snapshot reads as absent', () => {
  const dir = mkdtempSync(join(tmpdir(), 'orch-quota-'));
  const p = join(dir, 'quota.json');
  const now = Date.now();
  writeFileSync(p, JSON.stringify(snapshotFrom({ rate_limits: { five_hour: { used_percentage: 50 } } }, now - 11 * 60 * 1000, 'org-a')));
  assert.equal(readQuota(now, p, 'org-a'), null);
  writeFileSync(p, JSON.stringify(snapshotFrom({ rate_limits: { five_hour: { used_percentage: 50 } } }, now, 'org-a')));
  assert.equal(readQuota(now, p, 'org-a').fiveHour.pct, 50);
  writeFileSync(p, JSON.stringify(snapshotFrom({}, now, 'org-a')));
  assert.equal(readQuota(now, p, 'org-a'), null, 'an API-key session has no windows');
});

test('guard-agent as a process: a grant binds to the first task id it spends, refuses a second, and a judgment-role dispatch never burns it', () => {
  const home = sandbox();
  const at = '2026-09-18T00:00:00Z';

  // Scenario A: the grant binds on first spend, and a second task id naming
  // the same family is refused by name — even though nothing wrote the
  // binding into session.userModel.taskId (the atomic claim file is the
  // source of truth, not a read-modify-write on the session record).
  writeSession(home, 's-grant-a', { userModel: { family: 'opus', at } });
  const first = dispatch(home, 's-grant-a', { subagent_type: 'orch-implementer', model: 'opus', prompt: 'TASK: 1-1-0001\nfix it' });
  assert.doesNotMatch(first.stdout, /permissionDecision/, 'the first spend on the named task id goes through');

  const second = dispatch(home, 's-grant-a', { subagent_type: 'orch-implementer', model: 'opus', prompt: 'TASK: 1-1-0002\nfix something else' });
  assert.equal(second.json.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(second.json.hookSpecificOutput.permissionDecisionReason, /1-1-0001/, 'names the task the grant is bound to');
  assert.match(second.json.hookSpecificOutput.permissionDecisionReason, /1-1-0002/, 'names the task that was refused');

  // Scenario B: a fresh session's grant survives a judgment-role dispatch
  // (orch-planner never binds it, allowed on Opus on its own terms), so a
  // later implementer on a brand-new task id can still spend the grant —
  // the bug this fixes had the planner dispatch burn the grant on task 0001
  // and refuse the implementer's own task.
  writeSession(home, 's-grant-b', { userModel: { family: 'opus', at } });
  const planner = dispatch(home, 's-grant-b', { subagent_type: 'orch-planner', model: 'opus', prompt: 'TASK: 1-1-0001\nplan it' });
  assert.doesNotMatch(planner.stdout, /permissionDecision/, 'a judgment role runs on Opus without touching the grant');

  const implementer = dispatch(home, 's-grant-b', { subagent_type: 'orch-implementer', model: 'opus', prompt: 'TASK: 1-1-0002\nfix it' });
  assert.doesNotMatch(implementer.stdout, /permissionDecision/, 'the implementer on a new task id still spends the untouched grant');
  const implementerAgain = dispatch(home, 's-grant-b', { subagent_type: 'orch-implementer', model: 'opus', prompt: 'TASK: 1-1-0003\nfix a third thing' });
  assert.equal(implementerAgain.json.hookSpecificOutput.permissionDecision, 'deny', 'the grant is now bound to 1-1-0002, so a third id is refused');
  assert.match(implementerAgain.json.hookSpecificOutput.permissionDecisionReason, /1-1-0002/);
});

test('a quota snapshot is enforced only for the provider and account it names', () => {
  const dir = mkdtempSync(join(tmpdir(), 'orch-quota-'));
  const p = join(dir, 'quota.json');
  const now = Date.now();
  const busy = { rate_limits: { five_hour: { used_percentage: 95 } }, session_id: 's1' };
  writeFileSync(p, JSON.stringify(snapshotFrom(busy, now, 'org-a')));
  assert.equal(readQuota(now, p, 'org-b'), null, 'another account\'s usage never stops this one');
  assert.equal(readQuota(now, p, null).fiveHour.pct, 95, 'an unknown current account still honours an identified snapshot');
  const snap = snapshotFrom(busy, now, 'org-a');
  assert.equal(snap.provider, 'claude');
  assert.equal(snap.session, 's1');
  // Unidentified: an old v1 file, or one written with no account.
  writeFileSync(p, JSON.stringify({ at: now, fiveHour: { pct: 95 } }));
  assert.equal(readQuota(now, p, 'org-a'), null, 'an unidentified snapshot is not enforced');
  writeFileSync(p, JSON.stringify(snapshotFrom(busy, now, null)));
  assert.equal(readQuota(now, p, 'org-a'), null);
});
