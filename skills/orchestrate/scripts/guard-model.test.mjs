// guard-model.test.mjs — the dispatch-time model rule as a pure decision. The
// cases are the dispatches this machine actually recorded: Opus implementers,
// unnamed-model Explore sweeps, and plugin-namespaced role names.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modelDecision, taskKey, grantCheck, FORK_MAX_CONTEXT, progressFact, AUTHOR_ROLES } from './guard-agent.mjs';
import { normalizeRole, estimateDollars } from './lib/prices.mjs';
import { snapshotFrom, readQuota } from './lib/quota.mjs';
import { quotaPhrase, quotaBand } from './router.mjs';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
  // First use: allowed, and it would bind to this task (checked via grantCheck directly).
  assert.equal(modelDecision(ti, { ...pro, userModel: grant }), null, 'a fresh grant lets the named task through');
  const bound = { ...grant, taskId: '9-18-0005' };
  assert.equal(modelDecision(ti, { ...pro, userModel: bound }), null, 'the same task id the grant is bound to stays allowed');
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
  assert.equal(grantCheck(grant, 'opus', ti.prompt), null);
});

test('grantCheck: bind on first use, allow on the bound id, deny naming both ids', () => {
  const grant = { family: 'fable', at: '2026-09-18T00:00:00Z' };
  const first = grantCheck(grant, 'fable', 'TASK: 1-1-0001\nx');
  assert.deepEqual(first, { allow: true, bind: '1-1-0001' });
  const bound = { ...grant, taskId: '1-1-0001' };
  assert.deepEqual(grantCheck(bound, 'fable', 'TASK: 1-1-0001\nx'), { allow: true, bind: null });
  const other = grantCheck(bound, 'fable', 'TASK: 1-1-0002\nx');
  assert.equal(other.deny, true);
  assert.match(other.reason, /1-1-0001/);
  assert.match(other.reason, /1-1-0002/);
  assert.equal(grantCheck(null, 'fable', 'TASK: 1-1-0001\nx'), null, 'no record, no grant');
  assert.equal(grantCheck(grant, 'opus', 'TASK: 1-1-0001\nx'), null, 'wrong family, no grant');
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
