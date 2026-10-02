import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  readRuns, workspaceOf, validity, pairVoid, runHidden, execUsd, falseDone,
  summarize, table, verdict, evalRootOf,
} from './grade-kept.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(here, 'fixtures', 'aggregate-synthetic.json'), 'utf8'));

// A row builder: one valid, correct run unless told otherwise.
let n = 0;
const row = (o = {}) => ({ case: 'c1', arm: 'a', index: n++ % 3, cost: 1, seconds: 100, error: null, graders: {}, valid: true, correct: true, ...o });
const rowsOf = (arm, c, ok, total = 3, extra = {}) => Array.from({ length: total }, (_, i) => ({ case: c, arm, index: i, cost: 1, seconds: 100, error: null, graders: {}, valid: true, correct: i < ok, ...extra }));

// A fake file system over a set of directories, with forward-slash paths.
const fakeFs = dirs => {
  const set = new Set(dirs);
  return {
    isDir: p => set.has(p),
    list: p => [...set].filter(d => d.startsWith(`${p}/`) && !d.slice(p.length + 1).includes('/')).map(d => d.slice(p.length + 1)),
  };
};

test('readRuns: one row per run, arms labelled, unstarted runs padded in', () => {
  const rows = readRuns(fixture, { arm: 'branch' });
  assert.equal(rows.length, 6);
  assert.deepEqual([...new Set(rows.map(r => r.arm))].sort(), ['branch', 'no-plugin']);
  const first = rows[0];
  assert.equal(first.case, 'alpha');
  assert.equal(first.cost, 0.5);
  assert.equal(first.seconds, 40);
  assert.equal(first.graders['keeps-tests'], true);
  assert.equal(first.tracePath, '/tmp/claude-eval-AAAA/out/trace.jsonl');
  assert.equal(rows.filter(r => r.unstarted).length, 2);
});

test('workspaceOf: POSIX and Windows-style trace paths find the same layout', () => {
  const posix = fakeFs(['/tmp/claude-eval-X', '/tmp/claude-eval-X/out', '/tmp/claude-eval-X/home', '/tmp/claude-eval-X/home/cwd', '/tmp/claude-eval-X/home/.claude']);
  assert.equal(workspaceOf('/tmp/claude-eval-X/out/trace.jsonl', posix), '/tmp/claude-eval-X/home/cwd');
  const win = fakeFs(['C:/Temp/claude-eval-Y', 'C:/Temp/claude-eval-Y/out', 'C:/Temp/claude-eval-Y/home', 'C:/Temp/claude-eval-Y/home/cwd']);
  assert.equal(workspaceOf('C:\\Temp\\claude-eval-Y\\out\\trace.jsonl', win), 'C:/Temp/claude-eval-Y/home/cwd');
  assert.equal(evalRootOf('C:\\Temp\\claude-eval-Y\\out\\trace.jsonl', win), 'C:/Temp/claude-eval-Y');
});

test('workspaceOf: tolerates another layout and returns null when nothing is there', () => {
  const other = fakeFs(['/k/run1', '/k/run1/out', '/k/run1/workspace']);
  assert.equal(workspaceOf('/k/run1/out/trace.jsonl', other), '/k/run1/workspace');
  const odd = fakeFs(['/k/run2', '/k/run2/home', '/k/run2/home/.cache', '/k/run2/home/project']);
  assert.equal(workspaceOf('/k/run2/out/trace.jsonl', odd), '/k/run2/home/project');
  assert.equal(workspaceOf('/k/none/out/trace.jsonl', fakeFs([])), null);
  assert.equal(workspaceOf(null), null);
});

test('validity: machine faults void; timeouts, turn limits and wrong results do not', () => {
  const base = { error: null, unstarted: false };
  assert.equal(validity({ ...base, error: 'timed out after 120s' }).valid, true);
  assert.equal(validity({ ...base, error: 'reached max turns (60)' }).valid, true);
  assert.equal(validity({ ...base }).valid, true);
  assert.deepEqual(validity({ ...base, error: "You've hit your usage limit" }), { valid: false, reason: 'usage limit' });
  assert.equal(validity({ ...base, error: 'Invalid API key / credential rejected' }).reason, 'credential rejected');
  assert.equal(validity({ ...base, error: 'scaffold script exited 1' }).reason, 'scaffold failed');
  assert.equal(validity({ ...base, error: 'exit 1: cannot spawn' }).reason, 'runner crash');
  assert.equal(validity({ unstarted: true }).reason, 'left unstarted');
  assert.equal(validity({ ...base }, '{"cmd":"cat bench-hidden/x/must.json"}').valid, false);
  assert.equal(validity({ ...base }, '{"cmd":"ls /plugin-copy/bench/"}').valid, false);
  assert.equal(validity({ ...base }, '{"cmd":"ls src/benchmark.js"}').valid, true);
});

test('validity: only what a tool was asked to open counts as reading the hidden tests', () => {
  const base = { error: null, unstarted: false };
  const rec = o => JSON.stringify(o);
  const use = (input, parent = null) => rec({ type: 'assistant', parent_tool_use_id: parent, message: { content: [{ type: 'text', text: 'see bench-hidden in the notes' }, { type: 'tool_use', name: 'Bash', input }] } });
  const quiet = [
    rec({ type: 'system', subtype: 'init', cwd: '/w/home/cwd', plugins: [{ path: '/r/bench/copy' }] }),
    rec({ type: 'user', message: { content: [{ type: 'tool_result', content: 'README mentions bench-hidden/' }] } }),
    use({ command: 'node --test test/' }),
    rec({ type: 'result', subtype: 'success', result: 'done; nothing read from bench/' }),
  ];
  assert.equal(validity(base, quiet.join('\n')).valid, true, 'start-up, tool output, prose and the final message do not void');
  assert.equal(validity(base, [...quiet, use({ file_path: '/r/bench-hidden/x/x.test.mjs' })].join('\n')).valid, false);
  assert.equal(validity(base, [...quiet, use({ command: 'cat ../bench/x/graders/a.md' }, 'toolu_1')].join('\n')).valid, false, 'a helper reading counts too');
});

test('a usage-limit run voids its pair in the other arm, and nothing else', () => {
  const rows = pairVoid([
    row({ arm: 'x', index: 0, valid: false, voidReason: 'usage limit' }),
    row({ arm: 'y', index: 0 }),
    row({ arm: 'y', index: 1 }),
    row({ arm: 'x', index: 1 }),
  ]);
  assert.equal(rows[1].valid, false);
  assert.equal(rows[1].voidReason, 'pair of a voided run');
  assert.equal(rows[2].valid, true);
  assert.equal(rows[3].valid, true);
  const s = summarize(rows);
  assert.equal(s.x.valid, 1);
  assert.equal(s.y.valid, 1);
});

test('runHidden: a hidden test passes and fails on a copy, and never changes the workspace', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'gk-'));
  try {
    const ws = join(tmp, 'ws');
    mkdirSync(ws);
    writeFileSync(join(ws, 'answer.txt'), '42');
    const hid = join(tmp, 'hidden', 'c1');
    mkdirSync(hid, { recursive: true });
    writeFileSync(join(hid, 'ok.test.mjs'), `import {test} from 'node:test'; import assert from 'node:assert/strict'; import {readFileSync, writeFileSync} from 'node:fs'; import {join} from 'node:path';
test('answer', () => { assert.equal(readFileSync(join(process.env.BENCH_WS,'answer.txt'),'utf8'), '42'); writeFileSync(join(process.env.BENCH_WS,'scratch.txt'),'x'); });`);
    writeFileSync(join(hid, 'bad.test.mjs'), `import {test} from 'node:test'; import assert from 'node:assert/strict'; import {readFileSync} from 'node:fs'; import {join} from 'node:path';
test('answer', () => { assert.equal(readFileSync(join(process.env.BENCH_WS,'answer.txt'),'utf8'), '43'); });`);
    writeFileSync(join(hid, 'must.json'), JSON.stringify({ hidden: ['ok.test.mjs'], graders: ['keeps-tests'], timeoutSeconds: 30 }));
    const pass = runHidden(ws, hid, { 'keeps-tests': true, 'claims-done': true });
    assert.equal(pass.hiddenPass, true);
    assert.equal(pass.correct, true);
    // The test wrote into its copy only.
    assert.equal(readdirSync(ws).includes('scratch.txt'), false);
    // A deciding grader that failed makes the run incorrect even when the tests pass.
    assert.equal(runHidden(ws, hid, { 'keeps-tests': false }).correct, false);
    // A failing hidden test.
    writeFileSync(join(hid, 'must.json'), JSON.stringify({ hidden: ['ok.test.mjs', 'bad.test.mjs'], graders: [], timeoutSeconds: 30 }));
    const fail = runHidden(ws, hid, {});
    assert.equal(fail.hiddenPass, false);
    assert.equal(fail.correct, false);
    assert.deepEqual(fail.tests.map(t => t.ok), [true, false]);
    // No workspace is a failure, not a crash.
    assert.equal(runHidden(join(tmp, 'missing'), hid, {}).correct, false);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});


test('execUsd: prices every transcript under the eval root at list price', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'gk-'));
  try {
    const root = join(tmp, 'claude-eval-Z');
    const proj = join(root, 'config', 'projects', 'slug');
    mkdirSync(proj, { recursive: true });
    mkdirSync(join(root, 'out'));
    const rec = { type: 'assistant', message: { id: 'm1', model: 'claude-opus-5-5', usage: { input_tokens: 1000000, output_tokens: 0 }, content: [] } };
    writeFileSync(join(proj, 'sess.jsonl'), JSON.stringify(rec) + '\n');
    const r = execUsd(join(root, 'out', 'trace.jsonl'));
    assert.equal(r.transcripts, 1);
    assert.ok(Math.abs(r.dollars - 4) < 1e-9);
    assert.equal(execUsd(join(tmp, 'nowhere', 'out', 'trace.jsonl')).dollars, null);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('falseDone: claims done while not correct', () => {
  assert.equal(falseDone({ graders: { 'claims-done': true }, correct: false }), true);
  assert.equal(falseDone({ graders: { 'claims-done': true }, correct: true }), false);
  assert.equal(falseDone({ graders: { 'claims-done': false }, correct: false }), false);
});

test('a timeout counts as a failure and its cost stays in the spend', () => {
  const rows = [row({ arm: 'a', index: 0, cost: 2, correct: true }), row({ arm: 'a', index: 1, cost: 3, correct: false, error: 'timed out after 60s' })];
  const s = summarize(rows).a;
  assert.equal(s.valid, 2);
  assert.equal(s.successes, 1);
  assert.equal(s.spend, 5);
  assert.equal(s.perSuccess, 5);
  const v = validity({ error: 'timed out after 60s', unstarted: false });
  assert.equal(v.valid, true);
});

test('execUsd, when measured, replaces the eval cost in the spend', () => {
  const s = summarize([row({ cost: 9, execUsd: 2 })]).a;
  assert.equal(s.spend, 2);
});

test('an arm with zero successes shows n/a per success and totals still print', () => {
  const rows = [...rowsOf('inc', 'c1', 3), ...rowsOf('cand', 'c1', 0)];
  const md = table(rows);
  assert.match(md, /\| cand \| c1 \| 3\/3 \| 0 \| \$3\.00 \| n\/a \|/);
  assert.match(md, /\*\*inc\*\* \| \*\*total\*\* \| 3\/3 \| 3 \| \$3\.00 \| \$1\.00 \|/);
});

test('0/3 vs 3/3 on one case counts for the arm that solved it', () => {
  const inc = [...rowsOf('inc', 'easy', 3), ...rowsOf('inc', 'hard', 0)];
  const cand = [...rowsOf('cand', 'easy', 3), ...rowsOf('cand', 'hard', 3)];
  const s = summarize([...inc, ...cand]);
  assert.equal(s.inc.successes, 3);
  assert.equal(s.cand.successes, 6);
  // All valid spend, including the failed case, over all successes.
  assert.equal(s.inc.perSuccess, 2);
  assert.equal(s.cand.perSuccess, 1);
  const v = verdict(s.inc, s.cand);
  assert.equal(v.result, 'clear-win');
});

const arm = (successes, o = {}) => ({ valid: 9, successes, spend: successes * 1, perSuccess: successes ? 1 : null, medianSeconds: 100, falseDone: 0, cases: { c1: { successes: Math.min(successes, 3) } }, ...o });

test('verdict: gates come first', () => {
  const v = verdict(arm(6), arm(9, { falseDone: 1 }));
  assert.equal(v.result, 'clear-loss');
  assert.match(v.reasons.join(' '), /false "done"/);
  assert.equal(verdict(arm(6), arm(9), { safetyStopRemoved: true }).result, 'clear-loss');
});

test('verdict: fewer total successes loses', () => {
  assert.equal(verdict(arm(7), arm(6)).result, 'clear-loss');
});

test('verdict: a per-case shortfall asks for confirmation, and loses if still short', () => {
  const inc = arm(6, { cases: { c1: { successes: 3 }, c2: { successes: 3 } } });
  const cand = arm(6, { cases: { c1: { successes: 2 }, c2: { successes: 4 } } });
  const v = verdict(inc, cand);
  assert.equal(v.result, 'inconclusive');
  assert.deepEqual(v.needsConfirmation, ['c1']);
  const again = verdict(inc, cand, { confirmed: true });
  assert.equal(again.result, 'clear-loss');
  assert.deepEqual(again.needsConfirmation, []);
});

test('verdict: cost per success at 0.85 wins, at 1.15 loses, between is inconclusive', () => {
  assert.equal(verdict(arm(6), arm(6, { perSuccess: 0.85 })).result, 'clear-win');
  assert.equal(verdict(arm(6), arm(6, { perSuccess: 1.15 })).result, 'clear-loss');
  const mid = verdict(arm(6), arm(6, { perSuccess: 1.0 }));
  assert.equal(mid.result, 'inconclusive');
  assert.equal(mid.needsReason, false);
});

test('verdict: two more successes is a win without a cost win; one more is inconclusive', () => {
  assert.equal(verdict(arm(6), arm(8)).result, 'clear-win');
  assert.equal(verdict(arm(6), arm(7)).result, 'inconclusive');
});

test('verdict: more than 25% slower sets needsReason without turning a win into a loss', () => {
  const v = verdict(arm(6), arm(8, { medianSeconds: 126 }));
  assert.equal(v.result, 'clear-win');
  assert.equal(v.needsReason, true);
  assert.equal(verdict(arm(6), arm(8, { medianSeconds: 125 })).needsReason, false);
});

test('verdict: no successes in either arm is inconclusive, not a crash', () => {
  const v = verdict(arm(0), arm(0));
  assert.equal(v.result, 'inconclusive');
});

test('combine: legs downloaded apart are voided in pairs across arms and judged by the rule', async () => {
  const { combine, findRows } = await import('./grade-kept.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'combine-'));
  try {
    const leg = (name, rows) => { mkdirSync(join(dir, `bench-${name}`, 'graded'), { recursive: true }); writeFileSync(join(dir, `bench-${name}`, 'graded', 'rows.json'), JSON.stringify(rows)); };
    leg('none', rowsOf('no-plugin', 'c1', 1));
    leg('current', rowsOf('current', 'c1', 2));
    const proposed = rowsOf('proposed', 'c1', 3);
    proposed[2] = { ...proposed[2], valid: false, voidReason: 'usage limit' };
    leg('proposed', proposed);
    const found = findRows(dir);
    assert.equal(found.length, 3);
    const c = combine(found.map(p => JSON.parse(readFileSync(p, 'utf8'))), { incumbent: 'current', candidate: 'proposed' });
    assert.deepEqual(c.rows.filter(r => r.index === 2).map(r => r.valid), [false, false, false], 'run 3 is voided in every arm');
    assert.equal(c.summary.current.valid, 2);
    assert.equal(c.summary.proposed.successes, 2);
    assert.equal(c.verdict.result, 'inconclusive', 'equal successes and equal cost decide nothing');
    assert.match(c.markdown, /Against no plugin \(reported, not deciding\):\n- current: /);
    assert.equal(combine([rowsOf('current', 'c1', 1)], { incumbent: 'current', candidate: 'proposed' }).verdict, null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
