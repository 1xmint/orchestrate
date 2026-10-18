// $0, no network: a fake claude scripts the turns. Run: node --test bench/scenarios/resume.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  claimsDone, claudeArgs, decideNext, findQuestion, median, parseCli, parseResult,
  runArm, runHidden, scrub, setupWorkspace, summarize,
} from './resume.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FAKE = join(HERE, 'fixtures', 'fake-claude.mjs');
const FAST_HIDDEN = join(HERE, 'fixtures', 'fake-hidden');
const FAST_RIGHT = join(HERE, 'fixtures', 'fake-right');
const REAL_HIDDEN = join(HERE, '..', '..', 'bench-hidden', 'scenarios', 'resume');
const FIXTURE = join(HERE, 'resume', 'fixture');
const ANSWERS = JSON.parse(readFileSync(join(HERE, 'resume', 'answers.json'), 'utf8'));
const ANSWER_TEXT = ANSWERS.questions[0].answer;
const ASK = 'Before I build the fee command: how much should a late fee be per day, and is there a cap?';
const TOKEN = 'test-token-0123456789abcdef';

// Runs the arm against a scripted fake claude and returns what it did.
function drive(turns, over = {}, { hiddenDir = FAST_HIDDEN, right = FAST_RIGHT } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'resume-test-'));
  writeFileSync(join(dir, 'script.json'), JSON.stringify({ turns }));
  Object.assign(process.env, {
    FAKE_SCRIPT: join(dir, 'script.json'), FAKE_STATE: join(dir, 'state.json'),
    FAKE_LOG: join(dir, 'log.jsonl'), FAKE_RIGHT: right, CLAUDE_CODE_OAUTH_TOKEN: TOKEN,
    ANTHROPIC_API_KEY: 'should-be-removed',
  });
  const opts = {
    ...parseCli(['--no-plugin', '--label', 'arm', '--cap', '100', '--runs', '1', '--out', join(dir, 'out'), '--claude', FAKE]),
    ...over,
  };
  const result = runArm(opts, { hiddenDir });
  let calls = [];
  try { calls = readFileSync(join(dir, 'log.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)); } catch { /* no calls */ }
  return { dir, opts, ...result, calls, jsonl: readFileSync(join(dir, 'out', 'runs.jsonl'), 'utf8'), summary: readFileSync(join(dir, 'out', 'summary.md'), 'utf8') };
}
const cut = { subtype: 'error_max_turns', isError: true, result: '', cost: 1, numTurns: 25, exit: 1 };
const win = { apply: true, result: 'All five parts are done.', cost: 0.5 };

test('hidden checks pass on right/, fail on wrong/ and on the untouched fixture', () => {
  const ws = (solution) => {
    const d = mkdtempSync(join(tmpdir(), 'resume-check-'));
    cpSync(FIXTURE, d, { recursive: true });
    if (solution) cpSync(join(REAL_HIDDEN, solution), d, { recursive: true });
    return d;
  };
  const dirs = { right: ws('right'), wrong: ws('wrong'), fixture: ws(null) };
  try {
    assert.equal(runHidden(dirs.right, REAL_HIDDEN).passed, true, 'right/ passes');
    assert.equal(runHidden(dirs.wrong, REAL_HIDDEN).passed, false, 'wrong/ (no cap) fails');
    assert.equal(runHidden(dirs.fixture, REAL_HIDDEN).passed, false, 'fixture fails');
    // the hidden tests never change the workspace they read
    assert.equal(readFileSync(join(dirs.right, 'package.json'), 'utf8'), readFileSync(join(FIXTURE, 'package.json'), 'utf8'));
    assert.equal(runHidden(dirs.right, REAL_HIDDEN).passed, true);
  } finally { for (const d of Object.values(dirs)) rmSync(d, { recursive: true, force: true }); }
});

test('the planted question is matched when asked, not when it is only reported', () => {
  assert.equal(findQuestion(ASK, ANSWERS.questions)?.id, 'late-fee-rule');
  assert.equal(findQuestion('Done. The late fee is 50 cents a day, capped at $10.00.', ANSWERS.questions), null);
  assert.equal(findQuestion('I built add and list. Continuing with checkout.', ANSWERS.questions), null);
});

test('decideNext answers first, flags a repeat, nudges, then stops at the limit', () => {
  const base = { questions: ANSWERS.questions, nudges: 0, maxNudges: 2 };
  assert.deepEqual(decideNext({ ...base, lastMessage: ASK, answered: new Set() }),
    { action: 'answer', text: ANSWER_TEXT, id: 'late-fee-rule', reAsked: false });
  assert.equal(decideNext({ ...base, lastMessage: ASK, answered: new Set(['late-fee-rule']) }).reAsked, true);
  assert.equal(decideNext({ ...base, lastMessage: '', answered: new Set() }).text, 'continue');
  assert.equal(decideNext({ ...base, nudges: 2, lastMessage: '', answered: new Set() }).action, 'stop');
});

test('small helpers: median, args, parsing, done claim, scrub', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(median([]), null);
  const a = claudeArgs({ prompt: 'hi', resume: 's1', maxTurns: 40, model: 'm', pluginDir: '/p' });
  assert.deepEqual(a.slice(0, 2), ['-p', 'hi']);
  assert.ok(a.includes('--resume') && a.includes('--plugin-dir') && a.includes('--max-turns'));
  assert.equal(claudeArgs({ prompt: 'hi', maxTurns: 1, model: 'm' }).includes('--plugin-dir'), false);
  assert.equal(parseResult('[{"type":"system"},{"type":"result","result":"x"}]').result, 'x');
  assert.equal(parseResult('not json'), null);
  assert.equal(claimsDone('All five parts are done.'), true);
  assert.equal(claimsDone('I built add and list so far.'), false);
  assert.equal(scrub(`a ${TOKEN} b`, [TOKEN]), 'a [redacted] b');
  assert.throws(() => parseCli(['--no-plugin', '--label', 'x', '--out', 'o']), /cap/);
  assert.throws(() => parseCli(['--label', 'x', '--out', 'o', '--cap', '1']), /plugin/);
});

test('two max-turns stops then a pass: two nudges, a resume, costs summed', () => {
  const r = drive([cut, cut, win]);
  const rec = r.records[0];
  assert.equal(rec.success, true);
  assert.equal(rec.nudges, 2);
  assert.equal(rec.reAsked, 0);
  assert.equal(rec.invocations, 3);
  assert.equal(rec.costUsd, 2.5);
  assert.equal(rec.claimsDone, true);
  assert.equal(rec.void, false);
  assert.deepEqual(r.calls.map((c) => c.prompt).slice(1), ['continue', 'continue']);
  assert.equal(r.calls[0].resume, null);
  assert.equal(r.calls[0].maxTurns, '25');
  assert.equal(r.calls[1].resume, 'fake-session-1');
  assert.equal(r.calls[1].maxTurns, '40');
  assert.equal(r.calls[0].pluginDir, null);
  assert.ok(r.calls[0].prompt.includes('late fees'));
  assert.ok(r.calls.every((c) => c.hasToken && !c.hasApiKey), 'token passed through, API key dropped');
  assert.ok(!r.calls[0].cwd.includes('bench-hidden'));
  assert.ok(!r.jsonl.includes(TOKEN) && !r.summary.includes(TOKEN));
  assert.match(r.summary, /\| 1 \| 1 \| \$2\.50 \| \$2\.50 \| 2 \| 0 \|/);
});

test('plugin arm passes --plugin-dir on every turn', () => {
  const r = drive([cut, win], { noPlugin: false, pluginDir: '/some/copy' });
  assert.ok(r.calls.length === 2 && r.calls.every((c) => c.pluginDir === '/some/copy'));
});

test('the answer goes out on the first ask; asking again counts as re-asked', () => {
  const r = drive([
    { result: ASK, cost: 0.1 },
    { result: ASK, cost: 0.1 },
    win,
  ]);
  const rec = r.records[0];
  assert.equal(r.calls[1].prompt, ANSWER_TEXT, 'answered on the first ask');
  assert.equal(r.calls[2].prompt, ANSWER_TEXT, 'answered again on the repeat');
  assert.equal(rec.reAsked, 1);
  assert.equal(rec.nudges, 0);
  assert.deepEqual(rec.answered, ['late-fee-rule']);
  assert.equal(rec.success, true);
});

test('stops after max-nudges when the work never passes', () => {
  const r = drive([cut], { maxNudges: 2 });
  const rec = r.records[0];
  assert.equal(rec.success, false);
  assert.equal(rec.nudges, 2);
  assert.equal(rec.invocations, 3);
  assert.equal(rec.stopReason, 'max-nudges');
  assert.equal(rec.void, false, 'a turn limit is not a machine fault');
  assert.match(r.summary, /\| 1 \| 0 \| \$3\.00 \| n\/a \|/);
});

test('the cap stops new runs once the summed cost reaches it', () => {
  const r = drive([cut, win], { runs: 3, cap: 1.2 });
  assert.equal(r.records.length, 1);
  assert.equal(r.capped, true);
  assert.equal(r.spent, 1.5);
  assert.equal(r.jsonl.trim().split('\n').length, 1);
});

test('without the cap in play, every run is made', () => {
  const r = drive([win], { runs: 2 });
  assert.equal(r.records.length, 2);
  assert.equal(r.capped, false);
});

test('usage-limit text voids the run and the table leaves it out', () => {
  const r = drive([cut, { isError: true, exit: 1, result: "You've hit your usage limit. It resets at 5pm." }]);
  const rec = r.records[0];
  assert.equal(rec.void, true);
  assert.equal(rec.voidReason, 'usage limit reached');
  assert.equal(rec.success, false);
  assert.match(r.summary, /\| 0 \| 0 \| \$0\.00 \| n\/a \|/);
  assert.match(r.summary, /Void runs.*usage limit reached/);
});

test('auth rejection, a crash and non-JSON output void the run', () => {
  assert.equal(drive([{ isError: true, exit: 1, result: 'Invalid token: authentication failed' }]).records[0].voidReason, 'auth rejected');
  assert.equal(drive([{ crash: true }]).records[0].voidReason, 'claude crashed or printed non-JSON');
  assert.equal(drive([{ raw: 'Segmentation noise' }]).records[0].void, true);
});

test('a transcript that mentions bench-hidden voids the run even if the tests pass', () => {
  const r = drive([{ ...win, transcript: 'let me look at ../bench-hidden/scenarios/resume' }]);
  const rec = r.records[0];
  assert.equal(rec.success, true);
  assert.equal(rec.void, true);
  assert.equal(rec.voidReason, 'transcript mentions the hidden checks');
});

test('the hidden directory path in tool output voids the run too', () => {
  const r = drive([{ ...win, raw: JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: `see ${FAST_HIDDEN}`, session_id: 's', total_cost_usd: 0, num_turns: 1 }), apply: false }], {}, {});
  assert.equal(r.records[0].void, true);
});

test('/compact is sent as its own turn and reported honoured only with a boundary in the transcript', () => {
  const honoured = drive([cut, { compactBoundary: true, result: 'compacted' }, win], { compactAfter: 1 });
  assert.deepEqual(honoured.calls.map((c) => c.prompt).slice(1, 2), ['/compact']);
  assert.equal(honoured.records[0].compact, 'honoured');
  assert.equal(honoured.records[0].nudges, 1, 'the compact turn is not a nudge; the next turn is');
  assert.equal(honoured.records[0].success, true);
  const ignored = drive([cut, { result: 'Unknown command' }, win], { compactAfter: 1 });
  assert.equal(ignored.records[0].compact, 'untested');
  assert.match(ignored.summary, /\/compact: untested/);
  assert.equal(drive([cut, win]).records[0].compact, 'off');
});

test('summarize builds one table per arm', () => {
  const rec = (arm, o) => ({ arm, success: true, nudges: 1, reAsked: 0, costUsd: 1, seconds: 10, void: false, compact: 'off', ...o });
  const md = summarize([rec('a', {}), rec('a', { success: false, nudges: 3 }), rec('b', {})]);
  assert.match(md, /## a/);
  assert.match(md, /## b/);
  assert.match(md, /\| 2 \| 1 \| \$2\.00 \| \$2\.00 \| 2 \| 0 \| 10 \|/);
});

test('setupWorkspace copies the fixture and commits it', () => {
  const ws = setupWorkspace(FIXTURE, { ...process.env });
  try {
    assert.equal(readFileSync(join(ws, 'package.json'), 'utf8'), readFileSync(join(FIXTURE, 'package.json'), 'utf8'));
    assert.ok(readFileSync(join(ws, '.git', 'HEAD'), 'utf8').includes('ref:'));
  } finally { rmSync(ws, { recursive: true, force: true }); }
});
