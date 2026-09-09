// hooks.test.mjs — the four mechanical hooks: the money guard, the ledger, the
// return check and the turn check. Every test runs the real script as a child
// process with a fake HOME and a fixture repo, so nothing here touches the
// machine's own ~/.claude.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseReturn, sumUsage, updateRow, PHASE } from './ledger.mjs';
import { check as returnCheck, MAX_BLOCKS } from './return-check.mjs';
import { shouldBlock, pickupHash, pickupWritten, pickupSection } from './turn-check.mjs';
import { decide } from './guard-agent.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const script = n => join(HERE, n);

function sandbox() {
  const home = mkdtempSync(join(tmpdir(), 'orch-home-'));
  mkdirSync(join(home, '.claude', 'orchestrate'), { recursive: true });
  return home;
}

function run(name, payload, home, extraEnv = {}) {
  const r = spawnSync(process.execPath, [script(name)], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, HOME: home, USERPROFILE: home, ANTHROPIC_API_KEY: '', ...extraEnv },
  });
  let json = null;
  try { json = r.stdout.trim() ? JSON.parse(r.stdout) : null; } catch {}
  return { status: r.status, stdout: r.stdout, json };
}

// A repo with an open run and one planned row.
function fixtureRepo(opts = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'orch-repo-'));
  mkdirSync(join(dir, '.git'), { recursive: true });
  const runDir = join(dir, '.orchestrator', 'runs', '2026-09-09-0001');
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, 'RUN.md'), `# Run 2026-09-09-0001

## Tasks

| id | phase | role · model | task | rubric | attempts | evidence |
|---|---|---|---|---|---|---|
| 9-9-0001 | 🔨 running | implementer · sonnet | add the flag | the test passes | 0 | — |
| 9-9-0002 | 📋 planned | reviewer · opus | review it | PASS | 0 | — |

## Pickup

Pickup prompt: ${opts.pickup ?? '<one sentence that continues from here>'}
Pickup confidence: high
Resume risk: none
`);
  return { dir, runDir, runMd: join(runDir, 'RUN.md') };
}

const GOOD_RETURN = `TASK: 9-9-0001
RESTATED: Add a --since flag to tidy, with a test proving older notes stay put.
STATUS: DONE
BRANCH: task/9-9-0001   WORKTREE: /tmp/wt
CHANGED: src/tidy.py, tests/test_tidy.py; 2 commits
EVIDENCE: pytest -q -> 41 passed
NOT VERIFIED: Windows path handling
QUESTIONS: none`;

// ---------------------------------------------------------------- guard v2 --

test('guard: a credential in the packet is denied whatever the model', () => {
  const d = decide({ tool_input: { model: 'sonnet', prompt: 'use ghp_abcdefghijklmnopqrstuvwxyz012345 to push' } }, { tier: 'max5', fableCount: 0, optedIn: false, skillDir: '/s' });
  assert.equal(d.kind, 'deny');
  assert.match(d.reason, /credential/);
});

test('guard: a non-fable dispatch passes untouched', () => {
  assert.equal(decide({ tool_input: { model: 'opus', prompt: 'TASK: 1' } }, { tier: 'max5', fableCount: 99, optedIn: false, skillDir: '/s' }).kind, 'pass');
});

test('guard: pro, api, team and unknown deny fable; the reason names the opt-in', () => {
  for (const tier of ['pro', 'api', 'team', 'unknown']) {
    const d = decide({ tool_input: { model: 'fable', prompt: 'x' } }, { tier, fableCount: 0, optedIn: false, skillDir: '/s' });
    assert.equal(d.kind, 'deny', tier);
    assert.match(d.reason, /--fable-optin/);
  }
});

test('guard: under the cap fable is counted, at the cap it is downgraded to opus, not denied', () => {
  assert.equal(decide({ tool_input: { model: 'fable', prompt: 'x' } }, { tier: 'max5', fableCount: 2, optedIn: false, skillDir: '/s' }).kind, 'count');
  const d = decide({ tool_input: { model: 'fable', prompt: 'x' } }, { tier: 'max5', fableCount: 3, optedIn: false, skillDir: '/s' });
  assert.equal(d.kind, 'downgrade');
  assert.equal(d.model, 'opus');
  assert.match(d.reason, /cap 3/);
  assert.equal(decide({ tool_input: { model: 'fable', prompt: 'x' } }, { tier: 'max20', fableCount: 5, optedIn: false, skillDir: '/s' }).kind, 'count');
  assert.equal(decide({ tool_input: { model: 'fable', prompt: 'x' } }, { tier: 'max20', fableCount: 6, optedIn: false, skillDir: '/s' }).kind, 'downgrade');
});

test("guard: today's opt-in lifts the cap", () => {
  assert.equal(decide({ tool_input: { model: 'fable', prompt: 'x' } }, { tier: 'pro', fableCount: 0, optedIn: true, skillDir: '/s' }).kind, 'pass');
  assert.equal(decide({ tool_input: { model: 'fable', prompt: 'x' } }, { tier: 'max5', fableCount: 9, optedIn: true, skillDir: '/s' }).kind, 'pass');
});

test('guard: the downgrade is an allow with updatedInput, and it names the downgrade', () => {
  const home = sandbox();
  writeFileSync(join(home, '.claude', 'orchestrate', 'profile.json'), JSON.stringify({ tier: 'max5' }));
  const d = new Date();
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  writeFileSync(join(home, '.claude', 'orchestrate', `fable-count-${day}.json`), JSON.stringify({ count: 3, date: day }));

  const out = run('guard-agent.mjs', {
    hook_event_name: 'PreToolUse', tool_name: 'Agent', session_id: 's1', cwd: home,
    tool_input: { subagent_type: 'orch-planner', model: 'fable', prompt: 'TASK: 9-9-0007\nplan it' },
  }, home);

  const h = out.json.hookSpecificOutput;
  assert.equal(h.permissionDecision, 'allow', 'allow, or updatedInput is ignored');
  assert.equal(h.updatedInput.model, 'opus');
  assert.equal(h.updatedInput.subagent_type, 'orch-planner', 'the rest of the input survives');
  assert.match(h.additionalContext, /moved from fable to opus/);

  const state = JSON.parse(readFileSync(join(home, '.claude', 'orchestrate', 'sessions', 's1.json'), 'utf8'));
  assert.equal(state.dispatches.length, 1);
  assert.equal(state.dispatches[0].agent, 'orch-planner');
  assert.equal(state.dispatches[0].model, 'opus');
  assert.equal(state.dispatches[0].requested, 'fable');
  assert.equal(state.dispatches[0].task, '9-9-0007');
  assert.ok(state.lastDispatchAt);
});

test('guard: a dispatch on an allowed model is recorded and prints nothing', () => {
  const home = sandbox();
  writeFileSync(join(home, '.claude', 'orchestrate', 'profile.json'), JSON.stringify({ tier: 'max5' }));
  const out = run('guard-agent.mjs', {
    hook_event_name: 'PreToolUse', tool_name: 'Agent', session_id: 's2', cwd: home,
    tool_input: { subagent_type: 'orch-implementer', model: 'sonnet', prompt: 'TASK: 9-9-0001\ndo it' },
  }, home);
  assert.equal(out.stdout.trim(), '');
  assert.equal(out.status, 0);
  const state = JSON.parse(readFileSync(join(home, '.claude', 'orchestrate', 'sessions', 's2.json'), 'utf8'));
  assert.equal(state.dispatches[0].model, 'sonnet');
});

test('guard: a non-Agent tool, garbage input and empty stdin all exit 0 silently', () => {
  const home = sandbox();
  for (const p of [{ tool_name: 'Bash' }, { nonsense: true }, {}]) {
    const out = run('guard-agent.mjs', p, home);
    assert.equal(out.status, 0);
    assert.equal(out.stdout.trim(), '');
  }
  const r = spawnSync(process.execPath, [script('guard-agent.mjs')], { input: 'not json', encoding: 'utf8', env: { ...process.env, HOME: home, USERPROFILE: home } });
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), '');
});

// ------------------------------------------------------------------ ledger --

test('ledger: a good return parses into a row', () => {
  const r = parseReturn(GOOD_RETURN);
  assert.equal(r.task, '9-9-0001');
  assert.equal(r.status, 'DONE');
  assert.equal(r.evidence, true);
  assert.deepEqual(r.missing, []);
  assert.equal(r.overLong, false);
  assert.equal(PHASE[r.status], '🔍 review');
});

test('ledger: a broken return names exactly what is missing and is never fatal', () => {
  const r = parseReturn('I finished the work, it looks good.');
  assert.deepEqual(r.missing, ['TASK', 'RESTATED', 'STATUS', 'EVIDENCE']);
  assert.equal(r.status, null);
});

test('ledger: an 80-line return is flagged long but still parsed', () => {
  const long = `${GOOD_RETURN}\n${Array.from({ length: 80 }, (_, i) => `log line ${i}`).join('\n')}`;
  const r = parseReturn(long);
  assert.equal(r.task, '9-9-0001');
  assert.equal(r.overLong, true);
  assert.ok(r.lines > 60);
});

test('ledger: a reviewer PASS/FAIL verdict is picked up', () => {
  assert.equal(parseReturn('TASK: 9-9-0002\nFAIL\nRESTATED: x\nSTATUS: DONE\nEVIDENCE: read the diff').verdict, 'FAIL');
  assert.equal(parseReturn(GOOD_RETURN).verdict, null);
});

test('ledger: usage is summed from the agent transcript, absent fields as zero', () => {
  const dir = mkdtempSync(join(tmpdir(), 'orch-tr-'));
  const p = join(dir, 't.jsonl');
  writeFileSync(p, [
    JSON.stringify({ type: 'assistant', message: { usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 1000, cache_creation_input_tokens: 200 } } }),
    JSON.stringify({ type: 'user', message: { content: 'hi' } }),
    'not json at all',
    JSON.stringify({ type: 'assistant', message: { usage: { input_tokens: 4 } } }),
  ].join('\n'));
  const u = sumUsage(p);
  assert.deepEqual(u, { input: 14, output: 5, cacheRead: 1000, cacheWrite: 200, turns: 2 });
  assert.deepEqual(sumUsage('/no/such/file'), { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, turns: 0 });
});

test('ledger: updateRow rewrites one row and leaves the rest of the file alone', () => {
  const { runMd } = fixtureRepo();
  const md = readFileSync(runMd, 'utf8');
  const next = updateRow(md, '9-9-0001', { phase: '🔍 review', attempts: 1, evidence: 'returns/001-orch-implementer.md' });
  assert.ok(next.includes('| 🔍 review |'));
  assert.ok(next.includes('| 9-9-0002 | 📋 planned |'), 'the other row is untouched');
  assert.equal(next.split('\n').length, md.split('\n').length);
  assert.equal(updateRow(md, '9-9-9999', { phase: 'x' }), null, 'an unknown id matches nothing');
});

test('ledger: a run writes the return file and moves the row to review, never to done', () => {
  const home = sandbox();
  const repo = fixtureRepo();
  const tr = join(repo.dir, 'agent.jsonl');
  writeFileSync(tr, JSON.stringify({ type: 'assistant', message: { usage: { input_tokens: 1200, output_tokens: 900, cache_read_input_tokens: 30000 } } }));

  const out = run('ledger.mjs', {
    hook_event_name: 'SubagentStop', session_id: 's3', cwd: repo.dir,
    agent_type: 'orch-implementer', agent_transcript_path: tr, last_assistant_message: GOOD_RETURN,
  }, home);

  const returns = readdirSync(join(repo.runDir, 'returns'));
  assert.deepEqual(returns, ['001-orch-implementer.md']);
  const saved = readFileSync(join(repo.runDir, 'returns', returns[0]), 'utf8');
  assert.match(saved, /orch-implementer/);
  assert.ok(saved.includes('RESTATED:'), 'the full return is saved, not a summary');

  const md = readFileSync(repo.runMd, 'utf8');
  assert.match(md, /\| 9-9-0001 \| 🔍 review \|/);
  assert.doesNotMatch(md, /✅/, 'the ledger never marks a task done');
  assert.match(md, /returns\/001-orch-implementer\.md/);
  assert.match(md, /\| 1 \|/, 'attempts incremented');
  assert.equal(out.status, 0);
  assert.equal(out.stdout.trim(), '', 'a clean DONE return needs no words back');
});

test('ledger: a broken return still saves, and tells the orchestrator to grade it Failed', () => {
  const home = sandbox();
  const repo = fixtureRepo();
  const out = run('ledger.mjs', {
    hook_event_name: 'SubagentStop', session_id: 's4', cwd: repo.dir,
    agent_type: 'orch-researcher', last_assistant_message: 'all done, looks fine',
  }, home);
  assert.equal(readdirSync(join(repo.runDir, 'returns')).length, 1);
  assert.match(out.json.hookSpecificOutput.additionalContext, /missing TASK, RESTATED, STATUS, EVIDENCE/);
  assert.match(out.json.hookSpecificOutput.additionalContext, /Grade this return Failed/);
  assert.equal(readFileSync(repo.runMd, 'utf8').includes('🔍'), false, 'no TASK line means no row is touched');
});

test('ledger: PARTIAL and BLOCKED map to their glyphs and prompt a decision', () => {
  for (const [status, glyph] of [['PARTIAL', '◐ partial'], ['BLOCKED', '⛔ blocked']]) {
    const home = sandbox();
    const repo = fixtureRepo();
    const out = run('ledger.mjs', {
      hook_event_name: 'SubagentStop', session_id: 's5', cwd: repo.dir, agent_type: 'orch-implementer',
      last_assistant_message: GOOD_RETURN.replace('STATUS: DONE', `STATUS: ${status}`),
    }, home);
    assert.match(readFileSync(repo.runMd, 'utf8'), new RegExp(glyph));
    assert.match(out.json.hookSpecificOutput.additionalContext, new RegExp(`STATUS ${status}`));
  }
});

test('ledger: no run in this repo, or an empty message, is a silent no-op', () => {
  const home = sandbox();
  const bare = mkdtempSync(join(tmpdir(), 'orch-bare-'));
  mkdirSync(join(bare, '.git'), { recursive: true });
  const a = run('ledger.mjs', { hook_event_name: 'SubagentStop', cwd: bare, last_assistant_message: GOOD_RETURN }, home);
  assert.equal(a.status, 0);
  assert.equal(a.stdout.trim(), '');
  const repo = fixtureRepo();
  const b = run('ledger.mjs', { hook_event_name: 'SubagentStop', cwd: repo.dir, last_assistant_message: '' }, home);
  assert.equal(b.stdout.trim(), '');
  assert.equal(existsSync(join(repo.runDir, 'returns')), false);
});

// ------------------------------------------------------------ return check --

test('return check: the schema decides, and the line cap is 60', () => {
  assert.equal(returnCheck(GOOD_RETURN).ok, true);
  assert.deepEqual(returnCheck('STATUS: DONE\nEVIDENCE: x').missing, ['RESTATED']);
  assert.deepEqual(returnCheck('RESTATED: x\nEVIDENCE: y').missing, ['STATUS (DONE, PARTIAL or BLOCKED)']);
  assert.deepEqual(returnCheck('RESTATED: x\nSTATUS: DONE').missing, ['EVIDENCE']);
  assert.equal(returnCheck('RESTATED: x\nSTATUS: MOSTLY DONE\nEVIDENCE: y').ok, false, 'STATUS must be one of the three words');
  const long = `${GOOD_RETURN}\n${Array.from({ length: 70 }, () => 'noise').join('\n')}`;
  assert.equal(returnCheck(long).ok, false);
  assert.match(returnCheck(long).reasons.join(' '), /the cap is 40/);
});

test('return check: blocks twice, then lets the agent finish', () => {
  const home = sandbox();
  const payload = { hook_event_name: 'SubagentStop', session_id: 's6', agent_type: 'orch-implementer', last_assistant_message: 'done!' };
  for (let i = 0; i < MAX_BLOCKS; i++) {
    const out = run('return-check.mjs', payload, home);
    assert.equal(out.json.decision, 'block', `block ${i + 1}`);
    assert.equal(out.json.hookSpecificOutput.decision, 'block');
    assert.match(out.json.reason, /RESTATED/);
  }
  assert.equal(run('return-check.mjs', payload, home).stdout.trim(), '', 'the third time it gives up and allows');
});

test('return check: each agent in a session gets its own two chances', () => {
  const home = sandbox();
  const bad = { hook_event_name: 'SubagentStop', session_id: 's7', last_assistant_message: 'done!' };
  run('return-check.mjs', { ...bad, agent_type: 'orch-implementer' }, home);
  run('return-check.mjs', { ...bad, agent_type: 'orch-implementer' }, home);
  assert.equal(run('return-check.mjs', { ...bad, agent_type: 'orch-reviewer' }, home).json.decision, 'block');
});

test('return check: a good return, a re-entrant call and junk are all silent', () => {
  const home = sandbox();
  assert.equal(run('return-check.mjs', { session_id: 's8', last_assistant_message: GOOD_RETURN }, home).stdout.trim(), '');
  assert.equal(run('return-check.mjs', { session_id: 's8', stop_hook_active: true, last_assistant_message: 'done!' }, home).stdout.trim(), '');
  assert.equal(run('return-check.mjs', { session_id: 's8' }, home).stdout.trim(), '');
});

// -------------------------------------------------------------- turn check --

test('turn check: the decision table', () => {
  const written = 'Pickup prompt: continue at step 3\nPickup confidence: high';
  const unwritten = 'Pickup prompt: <one sentence that continues from here>';
  assert.equal(pickupWritten(written), true);
  assert.equal(pickupWritten(unwritten), false);
  const at = '2026-09-09T12:00:00Z';
  assert.equal(shouldBlock({ pickupHash: 'a', section: written, lastDispatchAt: null }).block, false, 'no dispatch, nothing to record');
  assert.equal(shouldBlock({ pickupHash: 'a', section: unwritten, lastDispatchAt: at }).block, true, 'a placeholder Pickup is never written');
  assert.equal(shouldBlock({ pickupHash: 'b', section: written, lastDispatchAt: at, prev: { hash: 'a', checkedAt: '2026-09-09T11:00:00Z' } }).block, false, 'the text changed since the last check');
  assert.equal(shouldBlock({ pickupHash: 'a', section: written, lastDispatchAt: at, prev: { hash: 'a', checkedAt: '2026-09-09T11:00:00Z' } }).block, true, 'unchanged, and a dispatch happened since');
  assert.equal(shouldBlock({ pickupHash: 'a', section: written, lastDispatchAt: at, prev: { hash: 'a', checkedAt: '2026-09-09T13:00:00Z' } }).block, false, 'no dispatch since the last check');
  assert.equal(shouldBlock({ pickupHash: 'a', section: written, lastDispatchAt: at, prev: { hash: 'a', blockedFor: 'a' } }).block, false, 'one block per text');
});

test('turn check: the Pickup hash changes only when the section changes', () => {
  const a = '# Run\n\n## Pickup\n\nPickup prompt: one\n\n## Verified\n\nx';
  const b = a.replace('# Run', '# Run 2');
  const c = a.replace('one', 'two');
  assert.equal(pickupHash(a), pickupHash(b));
  assert.notEqual(pickupHash(a), pickupHash(c));
  assert.match(pickupSection(a), /^Pickup prompt: one$/);
});

test('turn check: an open run with a stale Pickup blocks once and names the file', () => {
  const home = sandbox();
  const repo = fixtureRepo();
  mkdirSync(join(home, '.claude', 'orchestrate', 'sessions'), { recursive: true });
  writeFileSync(join(home, '.claude', 'orchestrate', 'sessions', 's9.json'), JSON.stringify({ session_id: 's9', lastDispatchAt: new Date().toISOString() }));

  const payload = { hook_event_name: 'Stop', session_id: 's9', cwd: repo.dir };
  const first = run('turn-check.mjs', payload, home);
  assert.equal(first.json.decision, 'block');
  assert.match(first.json.reason, /Pickup section of/);
  assert.ok(first.json.reason.includes('RUN.md'));
  assert.equal(run('turn-check.mjs', payload, home).stdout.trim(), '', 'it nags once, not every turn');
});

test('turn check: no dispatch, no open run, or a Pickup written after the dispatch, stays quiet', () => {
  const home = sandbox();
  const repo = fixtureRepo({ pickup: 'continue at step 3' });
  const sessions = join(home, '.claude', 'orchestrate', 'sessions');
  mkdirSync(sessions, { recursive: true });

  // no dispatch recorded
  writeFileSync(join(sessions, 'a.json'), JSON.stringify({ session_id: 'a' }));
  assert.equal(run('turn-check.mjs', { session_id: 'a', cwd: repo.dir }, home).stdout.trim(), '');

  // A dispatch, and a written Pickup seen for the first time: the orchestrator
  // is taken at its word this turn, so no block, and the sighting is recorded.
  writeFileSync(join(sessions, 'b.json'), JSON.stringify({ session_id: 'b', lastDispatchAt: '2026-09-09T10:00:00Z' }));
  assert.equal(run('turn-check.mjs', { session_id: 'b', cwd: repo.dir }, home).stdout.trim(), '');

  // A second dispatch after that sighting, with the same Pickup text, is the
  // case the hook exists for: the ledger moved but the resume point did not.
  const later = new Date(Date.now() + 60000).toISOString();
  writeFileSync(join(sessions, 'b.json'), JSON.stringify({ session_id: 'b', lastDispatchAt: later }));
  assert.equal(run('turn-check.mjs', { session_id: 'b', cwd: repo.dir }, home).json.decision, 'block');

  writeFileSync(repo.runMd, readFileSync(repo.runMd, 'utf8').replace('continue at step 3', 'now at step 4'));
  assert.equal(run('turn-check.mjs', { session_id: 'b', cwd: repo.dir }, home).stdout.trim(), '', 'a rewritten Pickup clears it');

  // no run at all
  const bare = mkdtempSync(join(tmpdir(), 'orch-bare2-'));
  mkdirSync(join(bare, '.git'), { recursive: true });
  assert.equal(run('turn-check.mjs', { session_id: 'b', cwd: bare }, home).stdout.trim(), '');
});
