// context-check.test.mjs — the working-project tracking that briefState (in
// router.mjs) reads back as state.work: learned from the paths a session's
// own tool calls touch, ignoring anything outside the launch folder; and what
// the hook loads at import, since it runs after every tool call.
//   node --test skills/orchestrate/scripts/context-check.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathFromToolInput, stepWork } from './context-check.mjs';
import * as turnCheck from './turn-check.mjs';
import * as leftovers from './lib/helper-leftovers.mjs';
import * as runs from './lib/runs.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

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

// ---- what the hook loads ------------------------------------------------------
// context-check.mjs runs after every tool call of every session, so what it
// imports is paid each time (about 20 ms for the whole graph on a slow machine).

// The files a module loads at import: every static import and re-export,
// followed. Returns a Map of file -> the files it imports.
function staticGraph(entry) {
  const graph = new Map();
  const todo = [entry];
  while (todo.length) {
    const file = todo.pop();
    if (graph.has(file)) continue;
    const deps = [];
    for (const m of readFileSync(file, 'utf8').matchAll(/^\s*(?:import|export)\b[^'";]*?\bfrom\s*'(\.[^']+)'|^\s*import\s*'(\.[^']+)'/gm)) deps.push(resolve(dirname(file), m[1] || m[2]));
    graph.set(file, deps);
    todo.push(...deps);
  }
  return graph;
}

test('the every-tool-call hook does not load turn-check.mjs or child_process at import', () => {
  // turn-check.mjs is the Stop hook. lib/resume.mjs once imported two small
  // readers from it, which loaded all of it, and child_process with it, on
  // every tool call. git is asked once per helper return, inside
  // lib/helper-leftovers.mjs, which loads child_process only then.
  const graph = staticGraph(join(HERE, 'context-check.mjs'));
  assert.ok(graph.size > 10, 'the walk followed the imports');
  const viaTurnCheck = [...graph].filter(([, deps]) => deps.some(d => d.endsWith('turn-check.mjs'))).map(([f]) => relative(HERE, f));
  assert.deepEqual(viaTurnCheck, [], 'a file in the hook\'s imports imports turn-check.mjs');
  const withChildProcess = [...graph.keys()].filter(f => /from\s*'node:child_process'/.test(readFileSync(f, 'utf8'))).map(f => relative(HERE, f));
  assert.deepEqual(withChildProcess, [], 'a file in the hook\'s imports loads child_process at import');
});

test('turn-check.mjs still exports what moved out of it, as the same functions', () => {
  for (const n of ['anyHelperRunning', 'leftoverHelpers', 'leftoverText', 'gitHelperState', 'leftoverNote', 'mergedBranches', 'folderIsClean']) {
    assert.equal(typeof leftovers[n], 'function', n);
    assert.equal(turnCheck[n], leftovers[n], n);
  }
  for (const n of ['pickupSection', 'pickupWritten']) {
    assert.equal(typeof runs[n], 'function', n);
    assert.equal(turnCheck[n], runs[n], n);
  }
});
