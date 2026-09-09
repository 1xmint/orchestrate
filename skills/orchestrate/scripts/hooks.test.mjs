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
import { parseReturn, sumUsage, updateRow, bumpAttempts, describeDispatch, PHASE, isRepeat } from './ledger.mjs';
import { check as returnCheck, MAX_BLOCKS, countKey } from './return-check.mjs';
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

// ------------------------------------------------------------------- guard --

test('guard: a credential in the packet is denied whatever the model', () => {
  const d = decide({ tool_input: { model: 'sonnet', prompt: 'use ghp_abcdefghijklmnopqrstuvwxyz012345 to push' } });
  assert.equal(d.kind, 'deny');
  assert.match(d.reason, /credential/);
});

test('guard: an ordinary dispatch passes untouched', () => {
  assert.equal(decide({ tool_input: { model: 'opus', prompt: 'TASK: 1' } }).kind, 'pass');
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

// ---- the ledger fires twice on every stop, by design of the install --------

test('ledger: the same stop delivered twice writes one return and one attempt', () => {
  const home = sandbox();
  const repo = fixtureRepo();
  const payload = {
    hook_event_name: 'SubagentStop', session_id: 'dbl', cwd: repo.dir,
    agent_type: 'orch-implementer', last_assistant_message: GOOD_RETURN,
  };
  // The recommended install registers this hook globally AND from SKILL.md's
  // frontmatter, so both copies see the same stop. Before the dedupe this left
  // returns/001 and returns/002 and an attempt count of 2 for one dispatch.
  run('ledger.mjs', payload, home);
  const second = run('ledger.mjs', payload, home);

  assert.deepEqual(readdirSync(join(repo.runDir, 'returns')), ['001-orch-implementer.md']);
  assert.match(readFileSync(repo.runMd, 'utf8'), /\| 9-9-0001 \| 🔍 review \|.*\| 1 \|/);
  assert.equal(second.stdout.trim(), '', 'the second copy says nothing');
});

test('ledger: a genuine second attempt is still recorded', () => {
  const home = sandbox();
  const repo = fixtureRepo();
  const base = { hook_event_name: 'SubagentStop', session_id: 'retry', cwd: repo.dir, agent_type: 'orch-implementer' };
  run('ledger.mjs', { ...base, last_assistant_message: GOOD_RETURN }, home);
  run('ledger.mjs', { ...base, last_assistant_message: GOOD_RETURN.replace('41 passed', '42 passed') }, home);
  assert.equal(readdirSync(join(repo.runDir, 'returns')).length, 2, 'a different return is a different stop');
  assert.match(readFileSync(repo.runMd, 'utf8'), /\| 2 \|/);
});

test('ledger: two agents stopping together are not mistaken for one', () => {
  const home = sandbox();
  const repo = fixtureRepo();
  const base = { hook_event_name: 'SubagentStop', session_id: 'par', cwd: repo.dir, last_assistant_message: GOOD_RETURN };
  run('ledger.mjs', { ...base, agent_type: 'orch-implementer' }, home);
  run('ledger.mjs', { ...base, agent_type: 'orch-reviewer' }, home);
  assert.deepEqual(readdirSync(join(repo.runDir, 'returns')), ['001-orch-implementer.md', '002-orch-reviewer.md']);
});

test('ledger: the dedupe window is a window, not a permanent memory', () => {
  const sig = 'abc';
  assert.equal(isRepeat({ sig, ts: 1000 }, sig, 5000), true, 'four seconds later is the same stop');
  assert.equal(isRepeat({ sig, ts: 1000 }, sig, 60000), false, 'a minute later is not');
  assert.equal(isRepeat({ sig: 'other', ts: 1000 }, sig, 1500), false);
  assert.equal(isRepeat(null, sig, 1000), false);
});

// ---- what the fresh-context audit found ------------------------------------

test('ledger: a pipe in a rubric no longer writes the attempt count into it', () => {
  const md = [
    '| id | phase | role · model | task | rubric | attempts | evidence |',
    '|---|---|---|---|---|---|---|',
    '| 9-9-0001 | 🔨 running | implementer · sonnet | add flag | exit 0 | 41 passed | 0 | — |',
  ].join('\n');
  const out = updateRow(md, '9-9-0001', { phase: '🔍 review', attempts: 1, evidence: 'returns/001.md' });
  const cells = out.split('\n')[2].split('|');
  assert.equal(cells[cells.length - 2].trim(), 'returns/001.md', 'evidence is the last cell');
  assert.equal(cells[cells.length - 3].trim(), '1', 'attempts is the one before it');
  assert.match(out, /exit 0 \| 41 passed/, 'the free-text rubric is untouched');
  assert.equal(bumpAttempts(md, '9-9-0001'), 1);
});

test('ledger: a stop with no agent identity is not a return', () => {
  const home = sandbox();
  const repo = fixtureRepo();
  // Before this check, the orchestrator's own last message was filed under
  // returns/ and could move a row. Two such files landed in a real run.
  const out = run('ledger.mjs', {
    hook_event_name: 'Stop', session_id: 'noid', cwd: repo.dir,
    last_assistant_message: 'wait for the audit and apply its findings',
  }, home);
  assert.equal(out.stdout.trim(), '');
  assert.equal(existsSync(join(repo.runDir, 'returns')), false);
});

test('ledger: the row records the model the guard actually used', () => {
  assert.equal(describeDispatch({ model: 'opus', requested: 'fable' }), 'opus (asked for fable)');
  assert.equal(describeDispatch({ model: 'sonnet', requested: 'sonnet' }), 'sonnet');
  assert.equal(describeDispatch({ model: 'sonnet' }), 'sonnet');
  assert.equal(describeDispatch(null), null);

  const home = sandbox();
  const repo = fixtureRepo();
  mkdirSync(join(home, '.claude', 'orchestrate', 'sessions'), { recursive: true });
  writeFileSync(join(home, '.claude', 'orchestrate', 'sessions', 'dg.json'), JSON.stringify({
    session_id: 'dg', dispatches: [{ at: new Date().toISOString(), agent: 'orch-planner', model: 'opus', requested: 'fable', task: '9-9-0001' }],
  }));
  run('ledger.mjs', {
    hook_event_name: 'SubagentStop', session_id: 'dg', cwd: repo.dir,
    agent_type: 'orch-planner', last_assistant_message: GOOD_RETURN,
  }, home);
  assert.match(readFileSync(repo.runMd, 'utf8'), /opus \(asked for fable\)/,
    'the return echoes the packet, so the row is the only honest record of the downgrade');
});

test('ledger: a reviewer VERDICT line is read as the verdict', () => {
  const r = parseReturn('TASK: 9-9-0002\nRESTATED: x\nSTATUS: DONE\nVERDICT: FAIL\nEVIDENCE: read the diff');
  assert.equal(r.verdict, 'FAIL');
  assert.equal(r.status, 'DONE', 'STATUS says the review finished, not whether it passed');
  assert.deepEqual(r.missing, []);
});

test('return check: each invocation gets its own two chances, not each role', () => {
  const home = sandbox();
  const bad = { hook_event_name: 'SubagentStop', session_id: 'inv', agent_type: 'orch-implementer', last_assistant_message: 'done!' };
  // First implementer spends its budget.
  run('return-check.mjs', { ...bad, agent_id: 'a1' }, home);
  run('return-check.mjs', { ...bad, agent_id: 'a1' }, home);
  assert.equal(run('return-check.mjs', { ...bad, agent_id: 'a1' }, home).stdout.trim(), '');
  // A second implementer in the same session used to inherit that spent budget
  // and was never checked at all.
  assert.equal(run('return-check.mjs', { ...bad, agent_id: 'a2' }, home).json.decision, 'block');
  assert.equal(countKey({ session_id: 's', agent_id: 'a1' }), countKey({ session_id: 's', agent_id: 'a1' }));
  assert.notEqual(countKey({ session_id: 's', agent_id: 'a1' }), countKey({ session_id: 's', agent_id: 'a2' }));
});

test('guard: the credential list covers the shapes an audit fed it', () => {
  const deny = p => decide({ tool_input: { model: 'sonnet', prompt: p } }).kind;
  assert.equal(deny('use sk-proj-abcdefghijklmnopqrstuvwxyz0123456789'), 'deny', 'an OpenAI project key');
  assert.equal(deny('AIzaSyA1bcDefGhIjKlMnOpQrStUvWxYz0123456'), 'deny', 'a Google API key');
  assert.equal(deny('Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcdefghijklmnop'), 'deny', 'a JWT');
  assert.equal(deny('connect with password=hunter2correcthorse'), 'deny', 'a password in a connection string');
  assert.equal(deny('api_key: 9f8e7d6c5b4a39281706'), 'deny');
  assert.equal(deny('-----BEGIN RSA PRIVATE KEY-----'), 'deny');
  // A packet that merely talks about credentials is not carrying one.
  assert.equal(deny('TASK: 9-9-0001 read the token from the environment, never inline it'), 'pass');
  assert.equal(deny('the password field on the login form'), 'pass');
});

test('guard: it never blocks or rewrites a dispatch over its model, on any plan', () => {
  // The cap and the silent downgrade to Opus are gone. A count answers "how
  // many have you done" when the only question worth asking is "is this task
  // worth it", and a cap reads as an allowance. Model choice is the manager's
  // judgment now, with the user asked whenever the model is not included in
  // their plan. This test exists so that cannot creep back.
  for (const tier of ['pro', 'max5', 'max20', 'team', 'api', 'unknown']) {
    for (const model of ['fable', 'opus', 'sonnet', 'haiku', '', undefined]) {
      const d = decide({ tool_input: { subagent_type: 'orch-planner', model, prompt: 'TASK: 9-9-0001\nplan it' } }, { tier });
      assert.equal(d.kind, 'pass', `${tier}/${model}`);
      assert.equal(d.model, undefined, 'it never names a replacement model');
    }
  }
});

test('guard: a Fable dispatch on Pro prints nothing at all', () => {
  const home = sandbox();
  writeFileSync(join(home, '.claude', 'orchestrate', 'profile.json'), JSON.stringify({ tier: 'pro' }));
  const out = run('guard-agent.mjs', {
    hook_event_name: 'PreToolUse', tool_name: 'Agent', session_id: 'pro1', cwd: home,
    tool_input: { subagent_type: 'orch-planner', model: 'fable', prompt: 'TASK: 9-9-0007\nplan it' },
  }, home);
  assert.equal(out.stdout.trim(), '', 'whether to spend on Fable here is the user\'s call, not a hook\'s');
  assert.equal(out.status, 0);
  const state = JSON.parse(readFileSync(join(home, '.claude', 'orchestrate', 'sessions', 'pro1.json'), 'utf8'));
  assert.equal(state.dispatches[0].model, 'fable', 'but it is still recorded');
  assert.equal(state.dispatches[0].task, '9-9-0007');
});

test('guard: a dispatch that names no model is recorded as inherited', () => {
  const home = sandbox();
  const out = run('guard-agent.mjs', {
    hook_event_name: 'PreToolUse', tool_name: 'Agent', session_id: 'inh', cwd: home,
    tool_input: { subagent_type: 'Explore', prompt: 'sweep the repo' },
  }, home);
  assert.equal(out.stdout.trim(), '');
  const state = JSON.parse(readFileSync(join(home, '.claude', 'orchestrate', 'sessions', 'inh.json'), 'utf8'));
  assert.equal(state.dispatches[0].model, 'inherit', 'the meter says inherited rather than guessing');
});

test('ledger: a stop carrying only an agent_id is not a return', () => {
  const home = sandbox();
  const repo = fixtureRepo();
  // This filed twenty-one of the orchestrator's own messages into one run
  // before the check tightened. agent_id alone does not prove a subagent
  // returned; only agent_type does.
  const out = run('ledger.mjs', {
    hook_event_name: 'SubagentStop', session_id: 'idonly', cwd: repo.dir,
    agent_id: 'abc123', last_assistant_message: 'Still waiting on the three researchers.',
  }, home);
  assert.equal(out.stdout.trim(), '');
  assert.equal(existsSync(join(repo.runDir, 'returns')), false);

  // A real return, with a type, still lands.
  run('ledger.mjs', {
    hook_event_name: 'SubagentStop', session_id: 'idonly2', cwd: repo.dir,
    agent_id: 'abc124', agent_type: 'orch-researcher', last_assistant_message: GOOD_RETURN,
  }, home);
  assert.deepEqual(readdirSync(join(repo.runDir, 'returns')), ['001-orch-researcher.md']);
});
