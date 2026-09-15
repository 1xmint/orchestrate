// workers.test.mjs — bounded workers: engineered coordinator nesting, capped role agents
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
import { runningNative, transcriptTurns, concurrencyDecision, lockedWorktreeIn, lockHolder, cappedNote, packetFromMarkdown, helperFiles, markExhausted, exhaustedFor, registerWorker, runningExternal } from './lib/workers.mjs';
import { modeTransition, modeNote, PLAN_NOTE, APPROVED_NOTE } from './lib/modes.mjs';
import { cappedReturn, roleMaxTurns, sumUsage } from './ledger.mjs';
import { loadPolicy, setPolicyValue, sizeBudget, DEFAULT_POLICY } from './lib/policy.mjs';
import { measure, measureTree } from './measure.mjs';
import { check as contextCheck, helperSizeNotice } from './context-check.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const policy = loadPolicy({});
const NOW = Date.parse('2026-09-14T12:00:00Z');
const ago = min => new Date(NOW - min * 60000).toISOString();
const ti = (subagent_type, prompt = 'TASK: 9-14-0001\nfind it', extra = {}) => ({ subagent_type, model: 'sonnet', prompt, ...extra });

test('only a recorded depth-1 coordinator may dispatch a named capped child', () => {
  const opts = (agent, depth = 1) => ({
    policy, installed: 7,
    dispatches: [{ agent, toolUseId: 'toolu_parent', at: ago(1) }],
    files: new Map([['toolu_parent', { agentId: 'a123', meta: { spawnDepth: depth } }]]),
  });
  assert.equal(workflowDecision({ agent_id: 'a123' }, ti('orchestrate:orch-implementer'), opts('orchestrate:orch-coordinator')), null);
  assert.match(workflowDecision({ agent_id: 'a123' }, ti('orch-implementer'), opts('orch-implementer')).reason, /only orch-coordinator/);
  assert.match(workflowDecision({ agent_id: 'a123' }, ti('orch-coordinator'), opts('orch-coordinator')).reason, /may dispatch only/);
  assert.match(workflowDecision({ agent_id: 'a123' }, { subagent_type: 'Explore', prompt: 'find it' }, opts('orch-coordinator')).reason, /must name its model/);
  assert.match(workflowDecision({ agent_id: 'a123' }, ti('orch-reviewer'), opts('orch-coordinator', 2)).reason, /depth 3 exceeds/);
  assert.match(workflowDecision({ agent_id: 'unknown' }, ti('orch-reviewer'), opts('orch-coordinator')).reason, /cannot be attributed to a recorded coordinator parent/);

  const deny = loadPolicy({ policy: { workers: { nested: 'deny' } } });
  assert.match(workflowDecision({ agent_id: 'a123' }, ti('Explore'), { ...opts('orch-coordinator'), policy: deny }).reason, /nested=deny/);
  const allow = loadPolicy({ policy: { workers: { nested: 'allow' } } });
  assert.equal(workflowDecision({ agent_id: 'unknown' }, { subagent_type: 'Explore', prompt: 'x' }, { policy: allow, installed: 7 }), null);
  assert.equal(workflowDecision({}, ti('orch-coordinator'), { policy, installed: 7 }), null, 'the lead remains free to dispatch a coordinator');
});

test('general-purpose is replaced by capped role agents while they are installed', () => {
  const d = workflowDecision({}, ti('general-purpose'), { policy, installed: 7 });
  assert.match(d.reason, /no turn cap/);
  assert.match(d.reason, /orch-implementer/);
  assert.match(workflowDecision({}, ti('claude'), { policy, installed: 7 }).reason, /no turn cap/);
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

test('helperSizeNotice: one fact line, no orders, said once per threshold, return outranking warn', () => {
  const budget = { warnAt: 80000, returnAt: 120000 };
  assert.equal(helperSizeNotice({ role: 'orch-implementer', tokens: 79000, budget, announced: null }), null);
  const warn = helperSizeNotice({ role: 'orch-implementer', tokens: 81000, budget, announced: null, turn: 38, maxTurns: 50, callsSinceEdit: 31, progress: { path: '/r/progress/1.md', minutesAgo: 12 } });
  assert.equal(warn.key, 'size-warn');
  assert.equal(warn.text, '[orchestrate · size] ~81k of ~120k budget · turn 38 of 50 · 31 tool calls since your last edit · progress file: /r/progress/1.md, written 12 min ago');
  assert.equal(helperSizeNotice({ role: 'orch-implementer', tokens: 81000, budget, announced: 'size-warn' }), null, 'said once');
  const ret = helperSizeNotice({ role: 'orch-implementer', tokens: 125000, budget, announced: 'size-warn', progress: null });
  assert.equal(ret.key, 'size-return');
  // At returnAt the same shape fires again; the budget number is just the
  // smaller one now crossed, and no order is given either time.
  assert.equal(ret.text, '[orchestrate · size] ~125k of ~120k budget · progress file: none given');
  assert.doesNotMatch(ret.text, /return|start no new work|PARTIAL/i);
  // A jump straight past returnAt hears only the return notice.
  const jump = helperSizeNotice({ role: 'orch-implementer', tokens: 205000, budget, announced: null });
  assert.equal(jump.key, 'size-return');
  // Turn number and cap drop together when either is unknown, rather than guessing.
  const noTurns = helperSizeNotice({ role: 'orch-implementer', tokens: 81000, budget, announced: null, turn: 5, maxTurns: null });
  assert.doesNotMatch(noTurns.text, /turn/);
  const noCalls = helperSizeNotice({ role: 'orch-implementer', tokens: 81000, budget, announced: null, callsSinceEdit: null });
  assert.doesNotMatch(noCalls.text, /tool call/);
  // A path named but never written: "not written yet", distinct from "none given".
  const notWritten = helperSizeNotice({ role: 'orch-implementer', tokens: 81000, budget, announced: null, progress: { path: '/r/progress/1.md', minutesAgo: null } });
  assert.match(notWritten.text, /progress file: \/r\/progress\/1\.md, not written yet/);
  assert.equal(helperSizeNotice({ role: 'x', tokens: null, budget, announced: null }), null, 'unknown size says nothing');
  assert.equal(helperSizeNotice({ role: 'orch-implementer', tokens: 130000, budget, announced: 'size-return' }), null, 'no warn after return');
});

test('the default size budgets are 80k/120k and coordinator 150k/200k, on purpose', () => {
  assert.deepEqual(DEFAULT_POLICY.workers.size.default, { warnAt: 80000, returnAt: 120000 });
  assert.deepEqual(DEFAULT_POLICY.workers.size['orch-coordinator'], { warnAt: 150000, returnAt: 200000 });
});

test('size budgets: defaults per role, a user override per field, a bad pair falls back', () => {
  const DEF = DEFAULT_POLICY.workers.size.default;
  const COORD = DEFAULT_POLICY.workers.size['orch-coordinator'];
  assert.deepEqual(sizeBudget('orchestrate:orch-implementer', policy), DEF);
  assert.deepEqual(sizeBudget('orchestrate:orch-coordinator', policy), COORD);
  assert.deepEqual(sizeBudget(null, policy), DEF, 'an unresolved role uses default');
  const custom = loadPolicy(setPolicyValue({}, 'workers.size.orch-debugger.returnAt', '160000'));
  assert.deepEqual(sizeBudget('orch-debugger', custom), { warnAt: DEF.warnAt, returnAt: 160000 });
  const coord = loadPolicy({ policy: { workers: { size: { 'orch-coordinator': { warnAt: 170000 } } } } });
  assert.deepEqual(sizeBudget('orch-coordinator', coord), { warnAt: 170000, returnAt: COORD.returnAt });
  const bad = loadPolicy({ policy: { workers: { size: { 'orch-coordinator': { warnAt: 250000 } } } } });
  assert.deepEqual(sizeBudget('orch-coordinator', bad), COORD, 'warnAt >= returnAt keeps the role default');
  assert.throws(() => setPolicyValue({}, 'workers.size.orch-debugger.limit', '1'), /workers\.size\.<role>\.warnAt/);
  assert.throws(() => setPolicyValue({}, 'workers.size.orch-debugger.warnAt', '0'), /positive token count/);
});

test('context-check gives a coordinator one fact line at warnAt and again at returnAt, with turn, calls-since-edit and progress facts', () => {
  const home = mkdtempSync(join(tmpdir(), 'orch-coord-context-'));
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  const sessions = join(home, '.claude', 'orchestrate', 'sessions');
  mkdirSync(sessions, { recursive: true });
  const progressPath = join(home, 'progress-9-14.md');
  writeFileSync(join(sessions, 'coord-context.json'), JSON.stringify({
    v: 1, session_id: 'coord-context', dispatches: [{
      at: new Date().toISOString(), agent: 'orch-coordinator', toolUseId: 'toolu_coord',
      progress: progressPath,
    }],
  }));
  const lead = join(home, 'lead.jsonl');
  writeFileSync(lead, '');
  const sub = join(home, 'lead', 'subagents');
  mkdirSync(sub, { recursive: true });
  const transcript = join(sub, 'agent-coord.jsonl');
  writeFileSync(join(sub, 'agent-coord.meta.json'), JSON.stringify({ agentType: 'orch-coordinator', toolUseId: 'toolu_coord', spawnDepth: 1 }));
  const response = (id, tokens, content) => JSON.stringify({
    type: 'assistant', timestamp: new Date().toISOString(),
    message: { id, model: 'claude-opus-5', usage: { input_tokens: tokens, output_tokens: 1 }, content: content || [{ type: 'text', text: 'x' }] },
  }) + '\n';
  const readTool = (id, name = 'Read') => ({ type: 'tool_use', id, name, input: {} });
  writeFileSync(transcript, response('checkpoint', 150000, [readTool('t1')]));
  const payload = { session_id: 'coord-context', agent_id: 'coord', transcript_path: lead, agent_transcript_path: transcript };
  const first = spawnSync(process.execPath, [join(HERE, 'context-check.mjs')], { input: JSON.stringify(payload), encoding: 'utf8', env });
  assert.equal(first.status, 0, first.stderr);
  const firstText = JSON.parse(first.stdout).hookSpecificOutput.additionalContext;
  // No orders, ever: this is a fact line, not "write PROGRESS" or "return PARTIAL".
  assert.doesNotMatch(firstText, /write|return PARTIAL|do not/i);
  assert.match(firstText, /^\[orchestrate · size\] ~150k of ~200k budget · turn 1 of \d+ · 1 tool call since your last edit · /);
  assert.match(firstText, new RegExp(`progress file: ${progressPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}, not written yet$`));

  // The helper writes its progress file; the counter keeps counting reads and
  // resets on the edit tool call in the next response.
  writeFileSync(progressPath, 'still going');
  writeFileSync(transcript, response('checkpoint', 150000, [readTool('t1')]) + response('edit', 205000, [readTool('t2'), { type: 'tool_use', id: 't3', name: 'Edit', input: {} }, readTool('t4')]));
  const second = spawnSync(process.execPath, [join(HERE, 'context-check.mjs')], { input: JSON.stringify(payload), encoding: 'utf8', env });
  assert.equal(second.status, 0, second.stderr);
  const secondText = JSON.parse(second.stdout).hookSpecificOutput.additionalContext;
  assert.doesNotMatch(secondText, /write|return PARTIAL|do not/i);
  // ~205k has crossed both warnAt and returnAt; only the return key is said.
  assert.match(secondText, /^\[orchestrate · size\] ~205k of ~200k budget · turn 2 of \d+ · 1 tool call since your last edit · /);
  assert.match(secondText, new RegExp(`progress file: ${progressPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}, written (just now|0 min ago)$`));

  // Said once: a third call with no growth repeats nothing.
  const third = spawnSync(process.execPath, [join(HERE, 'context-check.mjs')], { input: JSON.stringify(payload), encoding: 'utf8', env });
  assert.equal(third.status, 0, third.stderr);
  assert.equal(third.stdout, '');
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
  const coordinator = [{ provider: 'claude', role: 'orch-coordinator', task: 'wave' }];
  assert.equal(concurrencyDecision('orch-implementer', { native: [...coordinator, one[0]], policy }), null, 'a live coordinator raises the default slot count to three');
  assert.match(concurrencyDecision('orch-reviewer', { native: [...coordinator, ...two], policy }), /limit is 3/);
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
  const live = runningNative(dispatches, { returned, files, now: NOW, staleMin: 10 });
  assert.deepEqual(live.map(w => w.task || w.role), ['1', 'Explore'], 'writing recently or just dispatched; the silent, returned and stale ones do not count');
  // A return recorded without an agent id still matches by role and task.
  assert.deepEqual(runningNative([{ agent: 'orch-researcher', task: '7', at: ago(1) }], { returned: [{ agent: 'orch-researcher', task: '7', at: ago(0) }], now: NOW }), []);
});

test('running helpers: liveness is one number — just-dispatched counts, a fresh transcript counts however old the dispatch, silent past staleMin does not', () => {
  const files = new Map([
    // Dispatched long ago, but its transcript is still being written: alive.
    ['tu_old_fresh', { agentId: 'of', mtimeMs: NOW - 60000 }],
    // Dispatched long ago, transcript silent past staleMin: not alive.
    ['tu_old_silent', { agentId: 'os', mtimeMs: NOW - 20 * 60000 }],
  ]);
  const dispatches = [
    { agent: 'orch-implementer', task: 'old-fresh', at: ago(120), toolUseId: 'tu_old_fresh' },
    { agent: 'orch-implementer', task: 'old-silent', at: ago(120), toolUseId: 'tu_old_silent' },
    // No transcript yet, but dispatched moments ago: alive on the grace alone.
    { agent: 'orch-implementer', task: 'just-dispatched', at: ago(1) },
  ];
  const live = runningNative(dispatches, { files, now: NOW, staleMin: 10 });
  assert.deepEqual(live.map(w => w.task), ['old-fresh', 'just-dispatched']);
});

test('running helpers: one that used every turn its role allows has stopped, even with no return recorded', () => {
  const files = new Map([
    ['tu_cap', { agentId: 'cap', mtimeMs: NOW - 30000, path: 'cap.jsonl' }],
    ['tu_mid', { agentId: 'mid', mtimeMs: NOW - 30000, path: 'mid.jsonl' }],
  ]);
  const dispatches = [
    { agent: 'orchestrate:orch-implementer', task: '1', at: ago(3), toolUseId: 'tu_cap' },
    { agent: 'orchestrate:orch-implementer', task: '2', at: ago(3), toolUseId: 'tu_mid' },
  ];
  const turnsOf = p => (p === 'cap.jsonl' ? 100 : 12);
  const live = runningNative(dispatches, { files, now: NOW, staleMin: 10, turnsOf });
  assert.deepEqual(live.map(w => w.task), ['2'], 'the capped helper frees its slot at once; the one mid-work still counts');
  assert.equal(roleMaxTurns('orchestrate:orch-implementer'), 100);
  assert.match(concurrencyDecision('orch-implementer', { native: live, policy: loadPolicy() }) || 'free', /free/);
});

test('transcriptTurns counts one turn per model message, however many records it was written as', () => {
  const dir = mkdtempSync(join(tmpdir(), 'orch-turns-'));
  const tr = join(dir, 'agent.jsonl');
  const msg = id => JSON.stringify({ type: 'assistant', message: { id, usage: { input_tokens: 1 } } });
  writeFileSync(tr, [msg('a'), msg('a'), msg('b'), JSON.stringify({ type: 'user' })].join('\n'));
  assert.equal(transcriptTurns(tr), 2);
  assert.equal(transcriptTurns(join(dir, 'missing.jsonl')), 0);
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
  // The block lifts at the reset time the provider stated, and not before.
  const t0 = new Date(2026, 8, 14, 12, 48).getTime();
  markExhausted({ provider: 'codex', account: 'acct3', scope: 'run:r3', message: "You've hit your usage limit. ... or try again at 2:31 PM.", now: t0 }, dir);
  assert.ok(exhaustedFor({ provider: 'codex', account: 'acct3', scope: 'run:r3' }, dir, t0 + 60 * 60000));
  assert.equal(exhaustedFor({ provider: 'codex', account: 'acct3', scope: 'run:r3' }, dir, t0 + 104 * 60000), null);
  // An entry from before resetsAt was stored reads its reset from the message.
  const legacy = mkdtempSync(join(tmpdir(), 'orch-prov-'));
  writeFileSync(join(legacy, 'provider-state.json'), JSON.stringify({ v: 1, exhausted: [
    { provider: 'codex', account: 'a', scope: 's', at: new Date(t0).toISOString(), message: 'try again at 2:31 PM.' },
    { provider: 'codex', account: 'a', scope: 'held', at: new Date(t0).toISOString(), message: 'usage limit' },
  ] }));
  assert.ok(exhaustedFor({ provider: 'codex', account: 'a', scope: 's' }, legacy, t0 + 60 * 60000));
  assert.equal(exhaustedFor({ provider: 'codex', account: 'a', scope: 's' }, legacy, t0 + 104 * 60000), null);
  assert.ok(exhaustedFor({ provider: 'codex', account: 'a', scope: 'held' }, legacy, t0 + 48 * 3600000), 'legacy entries retain their prior behavior');
  const five = mkdtempSync(join(tmpdir(), 'orch-prov-'));
  markExhausted({ provider: 'codex', account: 'a', scope: 'five', message: 'usage limit', now: t0 }, five);
  assert.ok(exhaustedFor({ provider: 'codex', account: 'a', scope: 'five' }, five, t0 + 4 * 3600000));
  assert.equal(exhaustedFor({ provider: 'codex', account: 'a', scope: 'five' }, five, t0 + 5 * 3600000), null);
});

test('reset times are read from the provider message', async () => {
  const { parseResetTime } = await import('./lib/workers.mjs');
  const noon = new Date(2026, 8, 14, 12, 48).getTime();
  assert.equal(new Date(parseResetTime('try again at 2:31 PM.', noon)).getHours(), 14);
  assert.equal(new Date(parseResetTime('try again at 11:00 AM', noon)).getDate(), 15, 'a clock time already past means tomorrow');
  assert.equal(parseResetTime('try again in 3 days 4 hours.', noon), noon + 3 * 86400000 + 4 * 3600000);
  assert.equal(parseResetTime('usage limit reached', noon), null, 'no time stated, no expiry');
});

test('capped returns are partial, and the recovery note is said once', () => {
  assert.equal(roleMaxTurns('orchestrate:orch-implementer'), 100);
  assert.equal(roleMaxTurns('orch-reviewer'), 60);
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
  assert.equal(gp.contexts.length, 274, 'one context figure per request, in order');
  assert.equal(Math.max(...gp.contexts), 683000);
  assert.equal(gp.contexts.at(-1), gp.lastContext);
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
  assert.match(workflowDecision({}, { subagent_type: 'general-purpose', model: 'sonnet', prompt: 'do everything' }, { policy, installed: 7 }).reason, /no turn cap/);
  const nestedOpts = { policy, installed: 7, dispatches: [{ agent: 'general-purpose', toolUseId: 'toolu_gp' }], files: helperFiles(leadPath) };
  assert.match(workflowDecision({ agent_id: 'gp1' }, { subagent_type: 'general-purpose', prompt: 'sub-task' }, nestedOpts).reason, /only orch-coordinator/);
  assert.equal(measure(readFileSync(leadPath, 'utf8')).dispatches.length, 1);
});
