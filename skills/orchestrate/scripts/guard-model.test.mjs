// guard-model.test.mjs — the dispatch-time model rule as a pure decision. The
// cases are the dispatches this machine actually recorded: Opus implementers,
// unnamed-model Explore sweeps, and plugin-namespaced role names.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modelDecision, taskKey, FORK_MAX_CONTEXT } from './guard-agent.mjs';
import { normalizeRole, estimateDollars } from './lib/prices.mjs';
import { snapshotFrom, readQuota } from './lib/quota.mjs';
import { quotaPhrase, quotaBand } from './router.mjs';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const pro = { tier: 'pro' };

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
