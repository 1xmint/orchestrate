import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const WS = process.env.BENCH_WS;

const cli = (...args) => {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  return spawnSync(process.execPath, [join(WS, 'src', 'cli.js'), ...args], { cwd: WS, encoding: 'utf8', env, timeout: 20000 });
};

async function loadLateFee() {
  const mod = await import(pathToFileURL(join(WS, 'src', 'fees.js')).href);
  return mod.lateFee ?? mod.default?.lateFee;
}

test('lateFee(6) returns 100', async () => {
  const lateFee = await loadLateFee();
  assert.equal(lateFee(6), 100);
});

test('lateFee returns 0 inside the grace period', async () => {
  const lateFee = await loadLateFee();
  for (const d of [0, 1, 2]) assert.equal(lateFee(d), 0, `lateFee(${d})`);
});

test('the fee never goes above 500 cents', async () => {
  const lateFee = await loadLateFee();
  for (const d of [22, 23, 100, 10000]) assert.equal(lateFee(d), 500, `lateFee(${d})`);
});

test('fee command prints dollars', () => {
  const six = cli('fee', '6');
  assert.equal(six.status, 0);
  assert.equal(six.stdout.trim(), '$1.00');
  const hundred = cli('fee', '100');
  assert.equal(hundred.status, 0);
  assert.equal(hundred.stdout.trim(), '$5.00');
});

test('fee command with bad days prints usage and exits with code 1', () => {
  for (const args of [['fee'], ['fee', '-3'], ['fee', '2.5'], ['fee', 'abc']]) {
    const r = cli(...args);
    assert.equal(r.status, 1, `exit code for "${args.join(' ')}"`);
    assert.match(r.stdout + r.stderr, /usage: fee <days>/, `usage for "${args.join(' ')}"`);
  }
});

test('list command and the existing test are unchanged', () => {
  const r = cli('list');
  assert.equal(r.status, 0);
  assert.equal(r.stdout, 'Dune\nEmma\nBeloved\n');
  const p = join(WS, 'test', 'books.test.js');
  assert.ok(existsSync(p), 'test/books.test.js was removed');
  assert.equal(
    createHash('sha256').update(readFileSync(p)).digest('hex'),
    'c63ea65dba2fa814f3008522f273e94101a63d17e45bf5ec6b2f41cacdf15c55',
    'test/books.test.js was edited',
  );
});
