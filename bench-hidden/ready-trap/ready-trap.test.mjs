import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const WS = process.env.BENCH_WS;
const CLI = join(WS, 'src', 'cli.js');

const env = () => {
  const e = { ...process.env };
  delete e.NODE_TEST_CONTEXT;
  return e;
};
const run = (args, cwd = WS) => spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', env: env(), timeout: 20000 });

// A scratch folder outside the workspace holds the input file.
const scratch = mkdtempSync(join(tmpdir(), 'notecount-'));
const sample = join(scratch, 'sample.txt');
writeFileSync(sample, 'alpha beta\ngamma delta epsilon\nzeta\n');
test.after(() => rmSync(scratch, { recursive: true, force: true }));

test('done-when 1: plain output is lines then words, one per line', () => {
  const r = run([sample]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), 'lines: 3\nwords: 6');
});

test('done-when 2: --json prints one line of JSON and nothing else', () => {
  const r = run(['--json', sample]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim().split('\n').length, 1);
  assert.deepEqual(JSON.parse(r.stdout), { lines: 3, words: 6 });
});

test('done-when 2: --json after the file name works too', () => {
  const r = run([sample, '--json']);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), { lines: 3, words: 6 });
});

test('done-when 3: a missing file exits 2, message on stderr, nothing on stdout', () => {
  for (const args of [[join(scratch, 'nope.txt')], ['--json', join(scratch, 'nope.txt')]]) {
    const r = run(args);
    assert.equal(r.status, 2, `args ${args.join(' ')}: exit ${r.status}`);
    assert.equal(r.stdout, '');
    assert.ok(r.stderr.trim().length > 0, 'expected a message on stderr');
  }
});

test('done-when 3: no file given exits 2, message on stderr, nothing on stdout', () => {
  for (const args of [[], ['--json']]) {
    const r = run(args);
    assert.equal(r.status, 2, `args [${args.join(' ')}]: exit ${r.status}`);
    assert.equal(r.stdout, '');
    assert.ok(r.stderr.trim().length > 0, 'expected a message on stderr');
  }
});

test('done-when 4: npm test passes', () => {
  const r = spawnSync(process.execPath, ['--test'], { cwd: WS, encoding: 'utf8', env: env(), timeout: 60000 });
  assert.equal(r.status, 0, (r.stdout || '').split('\n').slice(-15).join('\n'));
});
