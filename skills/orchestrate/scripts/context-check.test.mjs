// context-check.test.mjs — the working-project tracking that briefState (in
// router.mjs) reads back as state.work: learned from the paths a session's
// own tool calls touch, ignoring anything outside the launch folder.
//   node --test skills/orchestrate/scripts/context-check.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathFromToolInput, stepWork } from './context-check.mjs';

function makeRepo() {
  const repo = mkdtempSync(join(tmpdir(), 'orch-work-repo-'));
  mkdirSync(join(repo, '.git'), { recursive: true });
  return repo;
}

test('pathFromToolInput reads the first known key, and only a string', () => {
  assert.equal(pathFromToolInput({ file_path: '/a/b.txt' }), '/a/b.txt');
  assert.equal(pathFromToolInput({ path: '/a/b.txt' }), '/a/b.txt');
  assert.equal(pathFromToolInput({ notebook_path: '/a/b.ipynb' }), '/a/b.ipynb');
  assert.equal(pathFromToolInput({ command: 'ls' }), null);
  assert.equal(pathFromToolInput(null), null);
  assert.equal(pathFromToolInput({ file_path: 123 }), null);
});

test('the working project is learned from touched paths and ignores paths outside the launch folder', () => {
  const repo = makeRepo();
  mkdirSync(join(repo, 'cortex', 'src'), { recursive: true });
  mkdirSync(join(repo, 'other'), { recursive: true });
  writeFileSync(join(repo, 'cortex', 'src', 'a.mjs'), '');
  writeFileSync(join(repo, 'cortex', 'src', 'b.mjs'), '');
  writeFileSync(join(repo, 'other', 'c.mjs'), '');

  let work = null;
  // Two touches inside cortex/src, learning cortex as the working folder.
  work = stepWork(work, repo, join(repo, 'cortex', 'src', 'a.mjs'));
  work = stepWork(work, repo, join(repo, 'cortex', 'src', 'b.mjs'));
  assert.equal(work.root, repo);
  assert.equal(work.dir, join(repo, 'cortex'));

  // A path outside the launch folder entirely (e.g. the plugin cache) is ignored.
  const outside = mkdtempSync(join(tmpdir(), 'orch-outside-'));
  const before = work;
  work = stepWork(work, repo, join(outside, 'x.mjs'));
  assert.equal(work, before, 'a path outside the launch folder leaves state.work unchanged');

  // One touch under `other` does not unseat cortex, which has more touches.
  work = stepWork(work, repo, join(repo, 'other', 'c.mjs'));
  assert.equal(work.dir, join(repo, 'cortex'), 'majority folder still wins');
});

test('a single touch names its own folder, and a touch at the repo root names the root', () => {
  const repo = makeRepo();
  writeFileSync(join(repo, 'top.md'), '');
  const work = stepWork(null, repo, join(repo, 'top.md'));
  assert.equal(work.root, repo);
  assert.equal(work.dir, repo);
});
