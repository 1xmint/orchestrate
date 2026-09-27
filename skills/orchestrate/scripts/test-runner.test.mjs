// test-runner.test.mjs — scripts/test.mjs (the top-level "Test it" command)
// finds the same files by walking node:fs, so it works the same in a
// PowerShell host as in bash, where `find` and `$(...)` do not exist.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { relative, resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { collectTestFiles } from '../../../scripts/test.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

test('collectTestFiles finds this very file and evals/no-machinery.test.mjs', () => {
  const files = collectTestFiles(ROOT).map(f => relative(ROOT, f).replace(/\\/g, '/'));
  assert.ok(files.includes('skills/orchestrate/scripts/test-runner.test.mjs'),
    'collectTestFiles did not find its own test file under skills/');
  assert.ok(files.includes('evals/no-machinery.test.mjs'),
    'collectTestFiles did not find evals/no-machinery.test.mjs');
  assert.ok(files.every(f => f.endsWith('.test.mjs')), 'every collected file ends in .test.mjs');
});

test('scripts/test.mjs --help lists files and exits 0 without running anything', () => {
  const result = spawnSync(process.execPath, [join(ROOT, 'scripts', 'test.mjs'), '--help'], { encoding: 'utf8' });
  assert.equal(result.status, 0, `expected exit 0, got ${result.status}: ${result.stderr}`);
  assert.match(result.stdout, /\d+ test files/);
  assert.doesNotMatch(result.stdout, /^(✔|✖|ℹ tests)/m, 'a --help run must not execute the test suite itself');
});
