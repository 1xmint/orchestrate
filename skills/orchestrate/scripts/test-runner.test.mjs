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

// A red CI run names what failed on the check itself: each failing test is one
// GitHub annotation with its file, line and message, escaped so a newline or a
// comma in the message cannot cut the command short.
import { annotation } from '../../../scripts/gh-annotate.mjs';
import { reporterArgs } from '../../../scripts/test.mjs';

test('a failing test becomes one escaped GitHub annotation', () => {
  const line = annotation({
    name: 'adds, then: carries',
    file: join(ROOT, 'skills', 'x.test.mjs'),
    line: 12,
    details: { error: { failureType: 'testCodeFailure', cause: { message: 'expected 1\nactual 2 (100%)' } } },
  }, ROOT);
  assert.equal(line, '::error file=skills/x.test.mjs,line=12,title=adds%2C then%3A carries::expected 1%0Aactual 2 (100%25)\n');
});

test('a parent that failed only because a child failed adds no annotation of its own', () => {
  assert.equal(annotation({ name: 'suite', details: { error: { failureType: 'subtestsFailed', message: '1 subtest failed' } } }, ROOT), null);
});

test('a failure with no file still names the test', () => {
  assert.equal(annotation({ name: 'bare', details: { error: { message: 'boom' } } }, ROOT), '::error title=bare::boom\n');
});

test('the annotation reporter is added on GitHub only', () => {
  assert.deepEqual(reporterArgs({}), []);
  const args = reporterArgs({ GITHUB_ACTIONS: 'true' });
  assert.ok(args.includes('--test-reporter=spec'), 'the readable output stays');
  assert.ok(args.some(a => /^--test-reporter=file:.*gh-annotate\.mjs$/.test(a)), 'the annotation reporter is added');
  assert.equal(args.filter(a => a === '--test-reporter-destination=stdout').length, 2, 'one destination per reporter');
});
