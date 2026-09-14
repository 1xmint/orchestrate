// codex-worker.test.mjs — the Codex adapter against a fake Codex CLI
// (fixtures/fake-codex.mjs): success, quota exhaustion before and after edits,
// malformed output, login and auth errors, throttling, timeout, and the handoff
// to Claude. No network, no real Codex, no quota.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  runWorker, classifyFailure, parseEvents, parseFinal, decideStatus, workerPrompt, fallbackPacket, EXIT, findCodex,
} from './codex-worker.mjs';
import { loadPolicy } from './lib/policy.mjs';
import { registerWorker, exhaustedFor, runningExternal } from './lib/workers.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FAKE = join(HERE, 'fixtures', 'fake-codex.mjs');

const PACKET = `TASK: 9-14-0001  ROLE: implementer

OBJECTIVE
Add a work.txt file.

CONTEXT
- nothing else

SCOPE
in: work.txt
out: every other file

DONE WHEN (evidence)
- node --test passes
- work.txt exists
`;

function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'orch-codex-repo-'));
  const g = (...a) => spawnSync('git', ['-C', dir, '-c', 'user.email=t@example.com', '-c', 'user.name=t', ...a], { encoding: 'utf8' });
  g('init', '-q');
  writeFileSync(join(dir, 'README.md'), '# test\n');
  g('add', '.');
  g('commit', '-q', '-m', 'init');
  return dir;
}

function setup(mode, extra = {}) {
  const home = mkdtempSync(join(tmpdir(), 'orch-codex-home-'));
  const log = join(home, 'calls.jsonl');
  const deps = {
    env: { ...process.env, ORCH_CODEX_BIN: FAKE, FAKE_CODEX_MODE: mode, FAKE_CODEX_LOG: log, CODEX_HOME: join(home, 'codex'), CLAUDE_CODE_SESSION_ID: '' },
    policy: loadPolicy({}),
    workersDir: join(home, 'workers'),
    quota: null,
    skipNative: true,
    ...extra,
  };
  const calls = () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
  return { home, deps, calls };
}

const run = (r, deps, more = {}) => runWorker({ packetText: PACKET, repo: r, role: 'implement', run: join(deps.workersDir, '..', 'run-20260914-x'), ...more }, deps);

test('success: an isolated worktree, explicit arguments, the packet on stdin, a structured report', async () => {
  const r = repo();
  const { deps, calls } = setup('success');
  const { report, code } = await run(r, deps);
  assert.equal(code, EXIT.done);
  assert.equal(report.status, 'done');
  assert.equal(report.runtime, 'codex');
  assert.notEqual(report.worktree, r, 'a writer never works in the main checkout');
  assert.ok(existsSync(join(report.worktree, 'work.txt')));
  assert.equal(existsSync(join(r, 'work.txt')), false);
  assert.deepEqual(report.evidence.untracked, ['work.txt']);
  assert.equal(report.evidence.usage.input, 24763);
  assert.deepEqual(report.acceptance, ['node --test passes', 'work.txt exists']);
  const exec = calls().find(c => c.argv[0] === 'exec');
  for (const a of ['--json', '--output-schema', '-o']) assert.ok(exec.argv.includes(a), `passes ${a}`);
  const dis = exec.argv.map((a, i) => (a === '--disable' ? exec.argv[i + 1] : null)).filter(Boolean);
  assert.deepEqual(dis, ['multi_agent', 'multi_agent_v2'], 'Codex does not start its own agents');
  assert.equal(exec.argv[exec.argv.indexOf('-s') + 1], 'workspace-write');
  assert.ok(exec.argv.includes('model_reasoning_effort="medium"'), 'bounded implementation runs at medium effort');
  assert.equal(exec.argv[exec.argv.length - 1], '-', 'the task arrives on stdin');
  assert.ok(!exec.argv.some(a => /dangerously|ignore-rules|ignore-user-config/.test(a)), 'normal permissions and repo instructions stay on');
  const saved = JSON.parse(readFileSync(join(report.checkpoint, 'report.json'), 'utf8'));
  assert.equal(saved.status, 'done');
  assert.equal(runningExternal(deps.workersDir).length, 0, 'the worker is unregistered after it exits');
});

test('review runs read-only in place at high effort', async () => {
  const r = repo();
  const { deps, calls } = setup('success');
  const { report } = await run(r, deps, { role: 'review' });
  const exec = calls().find(c => c.argv[0] === 'exec');
  assert.equal(exec.argv[exec.argv.indexOf('-s') + 1], 'read-only');
  assert.ok(exec.argv.includes('model_reasoning_effort="high"'));
  assert.equal(report.worktree, r);
});

test('quota exhausted before any edit: marked for this run, never probed again, handed to Claude', async () => {
  const r = repo();
  const { deps, calls } = setup('quota-before');
  const first = await run(r, deps);
  assert.equal(first.report.status, 'quota-exhausted');
  assert.equal(first.code, EXIT.fallback);
  assert.equal(first.report.evidence.edited, false);
  assert.ok(exhaustedFor({ provider: 'codex', account: first.report.account, scope: 'run:run-20260914-x' }, deps.workersDir));
  const fb = readFileSync(first.report.fallback.path, 'utf8');
  assert.match(fb, /^TASK: 9-14-0001-claude/m);
  assert.match(fb, /left no changes/);
  assert.equal(first.report.fallback.subagentType, 'orchestrate:orch-implementer');
  assert.equal(first.report.fallback.model, 'sonnet');
  assert.match(first.report.next, /Hand the unfinished part to Claude/);

  const execsBefore = calls().filter(c => c.argv[0] === 'exec').length;
  const second = await run(r, deps, { task: '9-14-0002' });
  assert.equal(second.report.status, 'quota-exhausted');
  assert.equal(second.report.evidence.skipped, true);
  assert.equal(calls().filter(c => c.argv[0] === 'exec').length, execsBefore, 'the exhausted account is not tried again in this run');

  const otherRun = await runWorker({ packetText: PACKET.replace('9-14-0001', '9-14-0003'), repo: r, run: join(deps.workersDir, '..', 'run-other') }, { ...deps, env: { ...deps.env, FAKE_CODEX_MODE: 'success' } });
  assert.equal(otherRun.report.status, 'done', 'a different run is not blocked by it');
});

test('quota exhausted after edits: the diff is preserved and only the unfinished part goes to Claude', async () => {
  const r = repo();
  const { deps } = setup('quota-after');
  const { report, code } = await run(r, deps);
  assert.equal(report.status, 'quota-exhausted', 'a 429 carrying a usage-limit message is exhaustion, not throttling');
  assert.equal(code, EXIT.fallback);
  assert.equal(report.evidence.edited, true);
  assert.ok(existsSync(join(report.worktree, 'work.txt')), 'the partial work stays in the worktree');
  const fb = readFileSync(report.fallback.path, 'utf8');
  assert.match(fb, /already in .*work\.txt/);
  assert.match(fb, /do not redo them/);
  assert.match(fb, /^in: only the unfinished part of: work\.txt$/m);
  assert.match(fb, /^WHERE: worktree .*already exists/m);
  assert.match(fb, /^- node --test passes$/m);
});

test('both providers unavailable: checkpoint saved and the blocker reported', async () => {
  const r = repo();
  const { deps } = setup('quota-before', { quota: { fiveHour: { pct: 96 } } });
  const { report, code } = await run(r, deps);
  assert.equal(code, EXIT.blocked);
  assert.match(report.next, /Both providers are unavailable/);
  assert.ok(existsSync(join(report.checkpoint, 'report.json')));
  assert.equal(report.fallback.claudeAvailable, false);
});

test('login, auth, throttling and malformed output are told apart', async () => {
  const r = repo();
  const out = await run(r, setup('logged-out').deps);
  assert.equal(out.report.status, 'auth-failed');
  assert.equal(out.code, EXIT.fallback);

  const auth = await run(r, setup('auth').deps, { task: 'a1' });
  assert.equal(auth.report.status, 'auth-failed');

  const thr = setup('throttle');
  const t = await run(r, thr.deps, { task: 't1' });
  assert.equal(t.report.status, 'throttled');
  assert.equal(t.code, EXIT.followUp);
  assert.equal(exhaustedFor({ provider: 'codex', account: t.report.account, scope: 'run:run-20260914-x' }, thr.deps.workersDir), null, 'throttling is never recorded as exhaustion');

  const bad = await run(r, setup('malformed').deps, { task: 'm1' });
  assert.equal(bad.report.status, 'malformed');
  assert.equal(bad.report.evidence.unreadableEvents, 1, 'a partial JSONL line is counted, not fatal');

  const failing = await run(r, setup('checks-fail').deps, { task: 'c1' });
  assert.equal(failing.report.status, 'checks-failed', 'a failing test is not a provider failure');
  assert.equal(failing.report.fallback, undefined);
});

test('timeout: the worker is stopped, it has exited, partial work kept, not called exhaustion', async () => {
  const r = repo();
  const { deps } = setup('hang');
  const started = Date.now();
  const { report, code } = await run(r, deps, { timeoutMin: 0.04 });
  assert.ok(Date.now() - started < 60000, 'did not wait for the hung process');
  assert.equal(report.status, 'timeout');
  assert.equal(code, EXIT.followUp);
  assert.equal(report.evidence.timedOut, true);
  assert.ok(existsSync(report.evidence.diffPath));
  assert.deepEqual(report.evidence.untracked, ['work.txt']);
  assert.equal(exhaustedFor({ provider: 'codex', account: report.account, scope: 'run:run-20260914-x' }, deps.workersDir), null);
  assert.match(report.next, /Continue only the remaining work/);
});

test('two workers already running: a third is not started', async () => {
  const r = repo();
  const { deps, calls } = setup('success');
  registerWorker({ provider: 'codex', taskId: 'w1', pid: process.pid, worktree: join(r, 'a') }, deps.workersDir);
  registerWorker({ provider: 'codex', taskId: 'w2', pid: process.pid, worktree: join(r, 'b') }, deps.workersDir);
  const { report } = await run(r, deps);
  assert.equal(report.status, 'blocked');
  assert.match(report.why, /limit is 2/);
  assert.equal(calls().filter(c => c.argv[0] === 'exec').length, 0);
});

test('pure pieces: classification, events, final report, prompt', () => {
  assert.equal(classifyFailure("You've hit your usage limit. Try again in 2 days."), 'quota-exhausted');
  // Verbatim from a real run on 2026-09-14 (codex-cli 0.154.0-alpha.6.2).
  assert.equal(classifyFailure("You've hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro), visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at 2:31 PM."), 'quota-exhausted');
  assert.equal(classifyFailure('Quota exceeded. Check your plan and billing details. insufficient_quota'), 'quota-exhausted');
  assert.equal(classifyFailure('401 Unauthorized'), 'auth-failed');
  assert.equal(classifyFailure('stream disconnected before completion'), 'throttled');
  assert.equal(classifyFailure('sandbox denied write: permission denied'), 'permission-denied');
  assert.equal(classifyFailure('test failed: expected 2 got 3'), null);

  const ev = parseEvents('{"type":"turn.completed","usage":{"input_tokens":10,"cached_input_tokens":4,"output_tokens":2}}\n{"type":"turn.compl');
  assert.equal(ev.usage.input, 10);
  assert.equal(ev.skipped, 1);

  assert.equal(parseFinal('not json'), null);
  assert.equal(parseFinal('{"status":"weird","summary":"x"}'), null);
  assert.equal(parseFinal('{"status":"partial","summary":"half","changed":[],"checks":[],"remaining":["b"],"notes":""}').remaining[0], 'b');

  // A check the sandbox would not run is unverified, not failed (first real
  // acceptance run: `node --test` hit spawn EPERM and passed 3/3 outside).
  const sandboxed = parseFinal(JSON.stringify({ status: 'done', summary: 'ok', changed: ['slug.mjs'], checks: [
    { command: 'node --test slug.test.mjs', result: 'fail', evidence: 'Test runner blocked by sandbox: Error: spawn EPERM.' },
    { command: 'node --test --test-isolation=none slug.test.mjs', result: 'pass', evidence: 'tests 3, pass 3' },
  ], remaining: [], notes: '' }));
  const d = decideStatus({ exitCode: 0, events: parseEvents(''), final: sandboxed });
  assert.equal(d.status, 'done');
  assert.deepEqual(d.blocked, ['node --test slug.test.mjs']);
  const realFail = parseFinal(JSON.stringify({ status: 'done', summary: 'ok', changed: [], checks: [
    { command: 'npm test', result: 'fail', evidence: 'AssertionError: expected 2, got 3' },
    { command: 'node --test', result: 'fail', evidence: 'spawn EPERM' },
  ], remaining: [], notes: '' }));
  const f = decideStatus({ exitCode: 0, events: parseEvents(''), final: realFail });
  assert.equal(f.status, 'checks-failed');
  assert.equal(f.why, 'npm test', 'only the real failure is named as one');

  // An agent message that talks about rate limits is not a failure.
  const quiet = parseEvents('{"type":"item.completed","item":{"type":"agent_message","text":"added a rate limit of 429 per user"}}');
  assert.equal(decideStatus({ exitCode: 0, events: quiet, final: parseFinal('{"status":"done","summary":"ok","changed":[],"checks":[],"remaining":[],"notes":""}') }).status, 'done');

  const p = workerPrompt(PACKET, { role: 'implement', worktree: '/w', progress: '/c/progress.md' });
  assert.match(p, /Do not start other agents/);
  assert.match(p, /uncommitted/);
  const fb = fallbackPacket({ packet: { taskId: 'x', acceptance: [], scope: {} }, report: { status: 'timeout', worktree: '/w', evidence: {} }, role: 'review', hard: false, checkpoint: '/c' });
  assert.equal(fb.subagentType, 'orchestrate:orch-reviewer');
  assert.equal(fb.model, 'opus', 'difficult review goes to Opus');
});

test('findCodex prefers the override, then PATH, then the app bundle', () => {
  assert.equal(findCodex({ ORCH_CODEX_BIN: FAKE }), FAKE);
  assert.equal(findCodex({ ORCH_CODEX_BIN: join(HERE, 'no-such-codex') }), null);
  assert.equal(findCodex({ PATH: '', LOCALAPPDATA: join(HERE, 'nowhere') }), null);
});

test('the worker is pointed at the repo map only when one exists, and a stale one is rebuilt first', async () => {
  const { mapNote } = await import('./codex-worker.mjs');
  const p = workerPrompt(PACKET, { role: 'implement', worktree: '/w', progress: null, map: { mdPath: '/r/.orchestrator/map/map.md', script: '/s/map.mjs', repo: '/r' } });
  assert.match(p, /Before searching, read \/r\/\.orchestrator\/map\/map\.md/);
  assert.match(p, /node "\/s\/map\.mjs" who-uses <file> --repo "\/r"/);
  assert.doesNotMatch(workerPrompt(PACKET, { role: 'implement', worktree: '/w' }), /Before searching/);

  let built = 0;
  const states = ['stale', 'fresh'];
  const note = mapNote('/r', { build: () => { built++; }, status: () => ({ state: states.shift(), mdPath: '/r/.orchestrator/map/map.md' }) });
  assert.equal(built, 1);
  assert.equal(note.mdPath, '/r/.orchestrator/map/map.md');
  assert.match(note.script, /map\.mjs$/);
  assert.equal(mapNote('/r', { build: () => { throw new Error('should not build'); }, status: () => ({ state: 'missing' }) }), null, 'no map, no note, no build');
  assert.equal(mapNote('/r', { build: () => { throw new Error('git broke'); }, status: () => ({ state: 'stale' }) }), null, 'a failed rebuild costs the note, not the run');
});
