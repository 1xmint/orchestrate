// persist-check.test.mjs — the work-conserving Stop hook loop: the pure scan
// and decision functions, plus the hook process's stdin/stdout contract.
//   node --test skills/orchestrate/scripts/persist-check.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanTurn, persistDecision, shortGoal, errorKey, endMessage, PERSIST_STEP_CAP } from './persist-check.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const HOOK = join(HERE, 'persist-check.mjs');

function run(input, home = mkdtempSync(join(tmpdir(), 'orch-persist-home-'))) {
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: { ...process.env, HOME: home, USERPROFILE: home },
  });
  return { stdout: r.stdout, status: r.status };
}

// ---- pure: scanTurn -----------------------------------------------------------

const line = rec => JSON.stringify(rec) + '\n';

test('scanTurn sees a work tool call as progress and an assistant question as "asked"', () => {
  const tail = line({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Edit' }, { type: 'text', text: 'Should I proceed?' }] } });
  const scan = scanTurn(tail);
  assert.equal(scan.progressed, true);
  assert.equal(scan.asked, true);
});

test('scanTurn recognizes the goal-met phrasing and a denied dispatch from a tool result', () => {
  const goalMet = scanTurn(line({ type: 'assistant', message: { content: [{ type: 'text', text: 'The goal is met, everything works.' }] } }));
  assert.equal(goalMet.goalMet, true);
  const denied = scanTurn(line({ type: 'user', message: { content: [{ type: 'tool_result', is_error: true, content: 'orchestrate guard: denied' }] } }));
  assert.equal(denied.denied, true);
});

test('scanTurn ignores a line that fails to parse and one with no recognizable shape', () => {
  const scan = scanTurn('not json\n' + line({ type: 'other' }));
  assert.equal(scan.progressed, false);
  assert.equal(scan.tools, 0);
});

// ---- pure: persistDecision -----------------------------------------------------

test('persistDecision stops once the same error repeats', () => {
  const rec = { errors: ['boom at #'] };
  const d = persistDecision({ rec, scan: { progressed: true, denied: false, errors: ['boom at #'], asked: false, goalMet: false } });
  assert.equal(d.kind, 'stop');
  assert.match(d.why, /same error came back twice/);
});

test('persistDecision stops at the step cap and continues below it when work happened', () => {
  const atCap = persistDecision({ rec: { steps: PERSIST_STEP_CAP }, scan: { progressed: true, denied: false, errors: [], asked: false, goalMet: false } });
  assert.equal(atCap.kind, 'stop');
  const below = persistDecision({ rec: { steps: 1 }, scan: { progressed: true, denied: false, errors: [], asked: false, goalMet: false } });
  assert.equal(below.kind, 'continue');
  assert.match(below.why, /step 2 of/);
});

test('persistDecision stops when the last step did no visible work', () => {
  const d = persistDecision({ rec: {}, scan: { progressed: false, denied: false, errors: [], asked: false, goalMet: false } });
  assert.equal(d.kind, 'stop');
  assert.match(d.why, /no visible work/);
});

// ---- shortGoal / errorKey / endMessage -----------------------------------------

test('shortGoal collapses whitespace and truncates a long goal with an ellipsis', () => {
  assert.equal(shortGoal('  a   goal  '), 'a goal');
  assert.equal(shortGoal('x'.repeat(100)).endsWith('...'), true);
});

test('errorKey blurs numbers and paths so the same error survives a changed line number', () => {
  const a = errorKey('Error at line 42 in C:\\repo\\foo.js');
  const b = errorKey('Error at line 99 in C:\\repo\\foo.js');
  assert.equal(a, b);
});

test('endMessage names why the loop stopped and how to restart it', () => {
  assert.match(endMessage('the step cap'), /the step cap.*keep going/s);
});

// ---- hook process: stdin/stdout contract ---------------------------------------

test('a malformed JSON payload exits 0 and writes nothing to stdout', () => {
  const r = spawnSync(process.execPath, [HOOK], { input: 'not json at all', encoding: 'utf8', env: { ...process.env, HOME: mkdtempSync(join(tmpdir(), 'orch-persist-home-')) } });
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), '');
});

test('a helper\'s own Stop (agent_id present) is silent, never blocked with the lead\'s loop text', () => {
  const r = run({ hook_event_name: 'Stop', session_id: 's1', agent_id: 'helper-1', transcript_path: '' });
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), '');
});

test('an unarmed session with no bound run and no transcript is silent', () => {
  const r = run({ hook_event_name: 'Stop', session_id: 'unbound-session', transcript_path: '' });
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), '');
});
