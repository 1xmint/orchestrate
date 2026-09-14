// workers.test.mjs — bounded workers: no nested delegation, capped role agents
// over general-purpose, read-only helpers in Plan mode and the approval
// handoff, two workers across providers with browser work serial, the worktree
// lock, capped returns treated as partial, and a replay of the 274-call helper.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { workflowDecision, PLAN_READ_ROLES } from './guard-agent.mjs';
import { runningNative, concurrencyDecision, lockedWorktreeIn, lockHolder, cappedNote, packetFromMarkdown, helperFiles, markExhausted, exhaustedFor, registerWorker, runningExternal } from './lib/workers.mjs';
import { modeTransition, modeNote, PLAN_NOTE, APPROVED_NOTE } from './lib/modes.mjs';
import { cappedReturn, roleMaxTurns, sumUsage } from './ledger.mjs';
import { loadPolicy } from './lib/policy.mjs';
import { measure, measureTree } from './measure.mjs';
import { check as contextCheck } from './context-check.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const policy = loadPolicy({});
const NOW = Date.parse('2026-09-14T12:00:00Z');
const ago = min => new Date(NOW - min * 60000).toISOString();
const ti = (subagent_type, prompt = 'TASK: 9-14-0001\nfind it', extra = {}) => ({ subagent_type, model: 'sonnet', prompt, ...extra });

test('a helper starting a helper is denied, whatever it asks for', () => {
  for (const role of ['orchestrate:orch-implementer', 'general-purpose', 'Explore']) {
    const d = workflowDecision({ agent_id: 'a123', session_id: 's' }, ti(role), { policy, installed: 6 });
    assert.equal(d.prefix, 'workers');
    assert.match(d.reason, /does not start helpers/);
    assert.match(d.reason, /STATUS: PARTIAL/);
  }
  const allow = loadPolicy({ policy: { workers: { nested: 'allow' } } });
  assert.equal(workflowDecision({ agent_id: 'a' }, ti('Explore'), { policy: allow, installed: 6 }), null);
});

test('general-purpose is replaced by capped role agents while they are installed', () => {
  const d = workflowDecision({}, ti('general-purpose'), { policy, installed: 6 });
  assert.match(d.reason, /no turn cap/);
  assert.match(d.reason, /orch-implementer/);
  assert.match(workflowDecision({}, ti('claude'), { policy, installed: 6 }).reason, /no turn cap/);
  assert.equal(workflowDecision({}, ti('general-purpose'), { policy, installed: 0 }), null, 'without the role agents it is the only choice');
  assert.equal(workflowDecision({}, ti('general-purpose'), { policy, installed: 3 }), null, 'a partial install still falls back on it');
  assert.equal(workflowDecision({}, ti('orchestrate:orch-implementer'), { policy, installed: 6 }), null);
  assert.equal(workflowDecision({}, ti('Explore', 'x', { model: 'haiku' }), { policy, installed: 6 }), null);
});

test('Plan mode: helpers only read, return inline, no worktrees or progress files', () => {
  const plan = { permission_mode: 'plan' };
  assert.match(workflowDecision(plan, ti('orchestrate:orch-implementer'), { policy, installed: 6 }).reason, /Plan mode, where helpers only read/);
  assert.match(workflowDecision(plan, ti('orchestrate:orch-planner'), { policy, installed: 6 }).reason, /only read/, 'only the lead maintains the plan');
  assert.match(workflowDecision(plan, ti('orchestrate:orch-debugger'), { policy, installed: 6 }).reason, /only read/);
  for (const role of PLAN_READ_ROLES) assert.equal(workflowDecision(plan, ti(role === 'Explore' || role === 'Plan' || role === 'claude-code-guide' ? role : `orchestrate:${role}`), { policy, installed: 6 }), null, `${role} may read`);
  assert.match(workflowDecision(plan, ti('orchestrate:orch-researcher', 'x', { isolation: 'worktree' }), { policy, installed: 6 }).reason, /no worktrees/);
  assert.match(workflowDecision(plan, ti('orchestrate:orch-researcher', 'TASK: 1\nWHERE: repo /r  worktree: yes'), { policy, installed: 6 }).reason, /no worktrees/);
  assert.match(workflowDecision(plan, ti('orchestrate:orch-researcher', 'TASK: 1\nPROGRESS: /r/progress/1.md'), { policy, installed: 6 }).reason, /no progress files/);
  // Out of Plan mode the same implementer packet is fine.
  assert.equal(workflowDecision({ permission_mode: 'auto' }, ti('orchestrate:orch-implementer', 'TASK: 1\nPROGRESS: /p'), { policy, installed: 6 }), null);
});

test('mode changes are observed, never forced: entering Plan and the approval handoff', () => {
  assert.equal(modeTransition(null, 'default').note, '');
  assert.equal(modeTransition('default', 'plan').note, PLAN_NOTE);
  assert.equal(modeTransition('plan', 'plan').note, '', 'said once');
  assert.equal(modeTransition('plan', 'acceptEdits').note, APPROVED_NOTE);
  assert.match(APPROVED_NOTE, /execute it as written/);
  assert.match(APPROVED_NOTE, /Do not restart discovery unless new evidence/);
  assert.equal(modeTransition('plan', null).note, '', 'a payload with no mode is not a change');
  assert.equal(modeNote({ mode: 'plan' }, { permission_mode: 'nonsense-mode' }), '', 'an unrecognised mode is not a change either');
  const state = {};
  assert.equal(modeNote(state, { permission_mode: 'plan' }), PLAN_NOTE);
  assert.equal(state.mode, 'plan');
  assert.equal(modeNote(state, { permission_mode: 'default' }), APPROVED_NOTE);
});

test('the tool-boundary hook delivers the approval handoff mid-turn', () => {
  const home = mkdtempSync(join(tmpdir(), 'orch-mode-'));
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  const sess = join(home, '.claude', 'orchestrate', 'sessions');
  mkdirSync(sess, { recursive: true });
  writeFileSync(join(sess, 's-mode.json'), JSON.stringify({ v: 1, session_id: 's-mode', mode: 'plan' }));
  const r = spawnSync(process.execPath, [join(HERE, 'context-check.mjs')], { input: JSON.stringify({ hook_event_name: 'PostToolUse', session_id: 's-mode', tool_name: 'ExitPlanMode', permission_mode: 'acceptEdits' }), encoding: 'utf8', env });
  assert.equal(r.status, 0, r.stderr);
  assert.match(JSON.parse(r.stdout).hookSpecificOutput.additionalContext, /plan approved/);
  const again = spawnSync(process.execPath, [join(HERE, 'context-check.mjs')], { input: JSON.stringify({ session_id: 's-mode', tool_name: 'Edit', permission_mode: 'acceptEdits' }), encoding: 'utf8', env });
  assert.equal(again.stdout, '', 'said once');
  assert.equal(contextCheck({ session_id: 'x', agent_id: 'helper' }), '', 'a helper is never told to compact or plan');
});

test('two workers across providers; browser work serial', () => {
  const one = [{ provider: 'claude', role: 'orch-implementer', task: '1' }];
  const two = [...one, { provider: 'codex', role: 'implement', task: '2' }];
  assert.equal(concurrencyDecision('orch-implementer', { native: one, external: [], policy }), null);
  const busy = concurrencyDecision('orch-implementer', { native: one, external: [two[1]], policy });
  assert.match(busy, /2 workers are already running \(orch-implementer 1, codex implement 2\)/);
  assert.match(busy, /limit is 2 across Claude and Codex/);
  assert.match(concurrencyDecision('orch-browser', { native: [{ provider: 'claude', role: 'orch-browser', task: 'b' }], policy }), /browser work is serial/);
  assert.equal(concurrencyDecision('x', { native: two, policy: loadPolicy({ policy: { workers: { maxConcurrent: 3 } } }) }), null);
  assert.match(workflowDecision({}, ti('orchestrate:orch-researcher'), { policy, installed: 6, native: two }).reason, /already running/);
});

test('running helpers: dispatched and not returned and still alive', () => {
  const files = new Map([
    ['tu_a', { agentId: 'aaa', mtimeMs: NOW - 60000 }],
    ['tu_b', { agentId: 'bbb', mtimeMs: NOW - 30 * 60000 }],
    ['tu_c', { agentId: 'ccc', mtimeMs: NOW - 30000 }],
  ]);
  const dispatches = [
    { agent: 'orchestrate:orch-implementer', task: '1', at: ago(20), toolUseId: 'tu_a' },
    { agent: 'orchestrate:orch-implementer', task: '2', at: ago(40), toolUseId: 'tu_b' },
    { agent: 'Explore', at: ago(2) },
    { agent: 'orchestrate:orch-reviewer', task: '4', at: ago(10), toolUseId: 'tu_c' },
    { agent: 'orchestrate:orch-researcher', task: '5', at: ago(90) },
  ];
  const returned = [{ agent: 'orch-reviewer', agentId: 'ccc', at: ago(1) }];
  const live = runningNative(dispatches, { returned, files, now: NOW, staleMin: 45 });
  assert.deepEqual(live.map(w => w.task || w.role), ['1', 'Explore'], 'writing recently or just dispatched; the silent, returned and stale ones do not count');
  // A return recorded without an agent id still matches by role and task.
  assert.deepEqual(runningNative([{ agent: 'orch-researcher', task: '7', at: ago(1) }], { returned: [{ agent: 'orch-researcher', task: '7', at: ago(0) }], now: NOW }), []);
});

test('helper transcripts are found by the tool call that started them', () => {
  const dir = mkdtempSync(join(tmpdir(), 'orch-helpers-'));
  const lead = join(dir, 'sess.jsonl');
  writeFileSync(lead, '');
  const sub = join(dir, 'sess', 'subagents');
  mkdirSync(sub, { recursive: true });
  writeFileSync(join(sub, 'agent-a1.meta.json'), JSON.stringify({ agentType: 'general-purpose', toolUseId: 'toolu_1', spawnDepth: 1 }));
  writeFileSync(join(sub, 'agent-a1.jsonl'), '{}\n');
  const m = helperFiles(lead);
  assert.equal(m.get('toolu_1').agentId, 'a1');
  assert.ok(m.get('toolu_1').mtimeMs > 0);
});

test('a live Codex worktree is locked against Claude helpers', () => {
  const wt = join(tmpdir(), 'repo-worktrees', '9-14-0001');
  const external = [{ provider: 'codex', task: '9-14-0001', pid: 4242, worktree: wt }];
  const packet = `TASK: 9-14-0001-claude\nWHERE: worktree ${wt} (already exists)`;
  assert.ok(lockedWorktreeIn(packet, external));
  assert.match(workflowDecision({}, ti('orchestrate:orch-implementer', packet), { policy, installed: 6, external }).reason, /Two providers never work in one worktree/);
  assert.equal(lockedWorktreeIn('TASK: other\nWHERE: worktree /elsewhere', external), null);
  assert.ok(lockHolder(wt, external));
  // A crashed adapter's entry does not hold the lock.
  const dir = mkdtempSync(join(tmpdir(), 'orch-reg-'));
  registerWorker({ provider: 'codex', taskId: 'dead', pid: 999999, worktree: wt }, dir);
  assert.deepEqual(runningExternal(dir, () => false), []);
});

test('quota exhaustion is scoped by provider, account and run; unidentified entries are ignored', () => {
  const dir = mkdtempSync(join(tmpdir(), 'orch-prov-'));
  markExhausted({ provider: 'codex', account: 'acct1', scope: 'run:r1', message: 'usage limit' }, dir);
  assert.ok(exhaustedFor({ provider: 'codex', account: 'acct1', scope: 'run:r1' }, dir));
  assert.equal(exhaustedFor({ provider: 'codex', account: 'acct2', scope: 'run:r1' }, dir), null);
  assert.equal(exhaustedFor({ provider: 'codex', account: 'acct1', scope: 'run:r2' }, dir), null);
  assert.equal(exhaustedFor({ provider: 'claude', account: 'acct1', scope: 'run:r1' }, dir), null);
  assert.equal(markExhausted({ provider: 'codex', account: null, scope: 'run:r1' }, dir), false);
  assert.equal(exhaustedFor({ provider: 'codex', account: null, scope: 'run:r1' }, dir), null);
});

test('capped returns are partial, and the recovery note is said once', () => {
  assert.equal(roleMaxTurns('orchestrate:orch-implementer'), 50);
  assert.equal(roleMaxTurns('orch-reviewer'), 30);
  assert.equal(roleMaxTurns('general-purpose'), null);
  assert.deepEqual(cappedReturn(50, 50, 'DONE'), { capped: true, status: 'PARTIAL', claimed: 'DONE' });
  assert.deepEqual(cappedReturn(12, 50, 'DONE'), { capped: false, status: 'DONE', claimed: 'DONE' });
  assert.equal(cappedReturn(274, null, null).capped, false, 'no cap known, nothing inferred');
  const state = { returned: [{ agent: 'orch-implementer', task: '9-14-0002', capped: true, turns: 50, progress: '/r/progress/9-14-0002.md' }, { agent: 'orch-reviewer', task: '3' }] };
  const note = cappedNote(state);
  assert.match(note, /orch-implementer 9-14-0002 \(50 turns, progress \/r\/progress\/9-14-0002\.md\)/);
  assert.match(note, /only the remaining work as a fresh, smaller packet/);
  assert.match(note, /Do not resume the stopped helper/);
  assert.equal(cappedNote(state), '', 'once');
});

test('the packet template reads into the provider-neutral shape', () => {
  const md = 'TASK: 9-14-0009  ROLE: implementer\nRUN: 20260914-x\n\nOBJECTIVE\nMake it so.\n\nCONTEXT\n- a fact\n\nSCOPE\nin: src/a.ts\nout: src/b.ts\n\nDONE WHEN (evidence)\n- npm test passes\n- the page loads\n\nPROGRESS: /r/p.md\n';
  const p = packetFromMarkdown(md, { runtime: 'codex', role: 'implement' });
  assert.equal(p.taskId, '9-14-0009');
  assert.equal(p.run, '20260914-x');
  assert.equal(p.objective, 'Make it so.');
  assert.deepEqual(p.scope, { in: 'src/a.ts', out: 'src/b.ts' });
  assert.deepEqual(p.acceptance, ['npm test passes', 'the page loads']);
  assert.equal(p.runtime, 'codex');
});

// A sanitized replay of the observed helper: built-in general-purpose on
// Sonnet, 274 model calls, context growing to 683k, spawning helpers of its
// own. The meter reports the whole tree; the guard denies both the dispatch
// and the nested ones.
test('replay: the 274-call general-purpose helper is measured whole and would be denied', () => {
  const dir = mkdtempSync(join(tmpdir(), 'orch-replay-'));
  const leadPath = join(dir, 'lead-sess.jsonl');
  const at = i => new Date(NOW + i * 1000).toISOString();
  const lead = [
    JSON.stringify({ type: 'assistant', timestamp: at(0), message: { id: 'm_lead1', model: 'claude-opus-5', usage: { input_tokens: 5, cache_read_input_tokens: 60000, cache_creation_input_tokens: 1000, output_tokens: 400 }, content: [{ type: 'tool_use', id: 'toolu_gp', name: 'Agent', input: { subagent_type: 'general-purpose', model: 'sonnet', prompt: 'do everything' } }] } }),
  ];
  writeFileSync(leadPath, lead.join('\n') + '\n');
  const sub = join(dir, 'lead-sess', 'subagents');
  mkdirSync(sub, { recursive: true });
  const rows = [];
  for (let i = 0; i < 274; i++) {
    const ctx = Math.round(15000 + (668000 * i) / 273);
    const rec = { type: 'assistant', isSidechain: true, agentId: 'gp1', timestamp: at(i + 1), message: { id: `m_gp_${i}`, model: 'claude-sonnet-5', usage: { input_tokens: 3, cache_read_input_tokens: ctx - 1003, cache_creation_input_tokens: 1000, output_tokens: 300 }, content: i % 90 === 5 ? [{ type: 'tool_use', id: `toolu_n${i}`, name: 'Agent', input: { subagent_type: 'general-purpose', prompt: 'sub-task' } }] : [{ type: 'text', text: 'working' }] } };
    rows.push(JSON.stringify(rec));
    if (i % 50 === 0) rows.push(JSON.stringify(rec)); // streaming duplicate
    if (i === 100) rows.push(JSON.stringify({ type: 'assistant', isSidechain: true, isApiErrorMessage: true, timestamp: at(i + 1), message: { model: '<synthetic>', content: [{ type: 'text', text: 'API Error: overloaded, retrying' }] } }));
  }
  writeFileSync(join(sub, 'agent-gp1.jsonl'), rows.join('\n') + '\n');
  writeFileSync(join(sub, 'agent-gp1.meta.json'), JSON.stringify({ agentType: 'general-purpose', toolUseId: 'toolu_gp', spawnDepth: 1, model: 'sonnet' }));
  writeFileSync(join(sub, 'agent-n1.jsonl'), JSON.stringify({ type: 'assistant', isSidechain: true, timestamp: at(400), message: { id: 'm_n1', model: 'claude-sonnet-5', usage: { input_tokens: 10, cache_read_input_tokens: 20000, cache_creation_input_tokens: 0, output_tokens: 50 }, content: [] } }) + '\n');
  writeFileSync(join(sub, 'agent-n1.meta.json'), JSON.stringify({ agentType: 'general-purpose', toolUseId: 'toolu_n5', spawnDepth: 2, parentAgentId: 'gp1' }));

  const tree = measureTree(leadPath);
  const gp = tree.agents.find(a => a.agentId === 'gp1');
  assert.equal(gp.calls, 274, 'streaming duplicates are not extra calls');
  assert.equal(gp.maxContext, 683000);
  assert.deepEqual(gp.models, ['claude-sonnet-5']);
  assert.equal(gp.nestedDispatches, 3);
  assert.equal(gp.retries, 1);
  const nested = tree.agents.find(a => a.agentId === 'n1');
  assert.equal(nested.depth, 2);
  assert.equal(nested.parent, 'gp1');
  assert.equal(tree.totals.agents, 2);
  assert.equal(tree.totals.nestedAgents, 1);
  assert.equal(tree.totals.calls, 1 + 274 + 1);
  assert.equal(sumUsage(join(sub, 'agent-gp1.jsonl')).turns, 274);

  // What the guard says now to the same two dispatches.
  assert.match(workflowDecision({}, { subagent_type: 'general-purpose', model: 'sonnet', prompt: 'do everything' }, { policy, installed: 6 }).reason, /no turn cap/);
  assert.match(workflowDecision({ agent_id: 'gp1' }, { subagent_type: 'general-purpose', prompt: 'sub-task' }, { policy, installed: 6 }).reason, /does not start helpers/);
  assert.equal(measure(readFileSync(leadPath, 'utf8')).dispatches.length, 1);
});
