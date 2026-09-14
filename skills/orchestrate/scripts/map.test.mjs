// map.test.mjs — the repo map: what it finds, what it caches, when it is stale,
// and that it stays small enough to put in front of every helper.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scan, purposeOf, build, status, load, whoUses, deps, testsFor, findFile, MD_CAP } from './map.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const git = (cwd, ...args) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'orch-map-'));
  const put = (p, text) => { mkdirSync(dirname(join(root, p)), { recursive: true }); writeFileSync(join(root, p), text); };
  put('src/app.mjs', '#!/usr/bin/env node\n// app.mjs — starts the service and wires the store in.\nimport { open } from \'./lib/store.mjs\';\nimport fs from \'node:fs\';\n\nexport function start() {\n  return open();\n}\n');
  put('src/lib/store.mjs', '// The one place rows are read and written.\nexport function open() {\n  return {};\n}\n');
  put('test/app.test.mjs', 'import { start } from \'../src/app.mjs\';\nstart();\n');
  put('src/lib/store.test.mjs', 'import \'./nothing.mjs\';\n');
  put('pkg/__init__.py', '');
  put('pkg/util.py', '"""Helpers for parsing dates."""\n\ndef parse(s):\n    return s\n');
  put('pkg/api.py', 'from .util import parse\n\nclass Api:\n    pass\n');
  put('tests/test_util.py', 'from pkg.util import parse\n');
  put('README.md', '# fixture\n');
  git(root, 'init', '-q');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'one');
  return { root, put };
}

test('scan finds imports and symbols with their lines, per language', () => {
  const js = scan('import a from "./a.mjs";\nimport {\n  b,\n} from \'./b.js\';\nconst c = require("./c");\nexport async function go() {}\nclass K {}\n', 'js');
  assert.deepEqual(js.imports, [['./a.mjs', 1], ['./b.js', 4], ['./c', 5]]);
  assert.deepEqual(js.symbols, [['go', 'function', 6], ['K', 'class', 7]]);
  const py = scan('import os, pkg.x\nfrom ..core import y\n\ndef f():\n    pass\n', 'py');
  assert.deepEqual(py.imports, [['..core', 2], ['os', 1], ['pkg.x', 1]]);
  assert.deepEqual(py.symbols, [['f', 'def', 4]]);
  const rs = scan('mod store;\nuse crate::store::Row;\npub fn run() {}\nfn main() {}\n', 'rs');
  assert.deepEqual(rs.imports, [['mod:store', 1], ['crate::store::Row', 2]]);
  assert.equal(rs.entry, true);
  const go = scan('package main\nimport (\n  "fmt"\n  "example.com/m/store"\n)\nfunc main() {}\n', 'go');
  assert.deepEqual(go.imports.map(x => x[0]), ['fmt', 'example.com/m/store']);
});

test('purpose is the first sentence of the leading comment, without the file name', () => {
  assert.equal(purposeOf('#!/usr/bin/env node\n// run.mjs — start one run and write its ledger,\n// then print the id.\n'), 'start one run and write its ledger, then print the id.');
  assert.equal(purposeOf('"""Helpers for parsing dates."""\n'), 'Helpers for parsing dates.');
  assert.equal(purposeOf('const x = 1;\n// late comment\n'), null);
});

test('build links imports, tests and entry points, and writes a capped map.md', () => {
  const { root } = fixture();
  const { map, md } = build(root);
  assert.deepEqual(map.files['src/app.mjs'].imports, [['src/lib/store.mjs', 3]], 'node:fs is a package, not an edge');
  assert.deepEqual(map.files['pkg/api.py'].imports, [['pkg/util.py', 1]]);
  assert.deepEqual(map.importers['pkg/util.py'].map(x => x[0]).sort(), ['pkg/api.py', 'tests/test_util.py']);
  const tests = Object.fromEntries(map.testsFor['src/app.mjs']);
  assert.equal(tests['test/app.test.mjs'], 'imports it at line 1');
  assert.equal(Object.fromEntries(map.testsFor['src/lib/store.mjs'])['test/app.test.mjs'], 'through src/app.mjs');
  assert.equal(Object.fromEntries(map.testsFor['src/lib/store.mjs'])['src/lib/store.test.mjs'], 'name pairs with it');
  assert.ok(Object.fromEntries(map.testsFor['pkg/util.py'])['tests/test_util.py']);
  assert.equal(map.files['src/app.mjs'].entry, true);
  assert.ok(md.length <= MD_CAP);
  assert.match(md, /^# Repo map \([0-9a-f]{7}, \d{4}-\d{2}-\d{2}\)/);
  assert.match(md, /src\/lib\/store\.mjs — 1 importers — The one place rows are read and written\./);
  assert.match(md, /not a compiled view/);
  assert.equal(readFileSync(join(root, '.orchestrator', 'map', 'map.md'), 'utf8'), md);
});

test('a rebuild scans only new blobs, and a commit makes the map stale until a query rebuilds it', () => {
  const { root, put } = fixture();
  assert.equal(build(root).map.counts.scanned, 8);
  assert.equal(build(root).map.counts.scanned, 0);
  assert.equal(status(root).state, 'fresh');
  put('src/lib/store.mjs', '// Rows.\nimport { parse } from \'./parse.mjs\';\nexport function open() {}\n');
  put('src/lib/parse.mjs', 'export function parse() {}\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'two');
  assert.equal(status(root).state, 'stale');
  const map = load(root);
  assert.equal(map.counts.scanned, 2);
  assert.equal(status(root).state, 'fresh');
  assert.deepEqual(whoUses(map, 'parse.mjs', root), ['src/lib/store.mjs:2']);
});

test('queries: a file, a symbol, and a name the map does not have', () => {
  const { root } = fixture();
  const map = load(root);
  assert.deepEqual(whoUses(map, 'store.mjs', root), ['src/app.mjs:3']);
  const sym = whoUses(map, 'open', root);
  assert.equal(sym[0], 'src/lib/store.mjs:2  defines function open');
  assert.ok(sym.includes('src/app.mjs:3  import { open } from \'./lib/store.mjs\';'));
  assert.ok(sym.includes('src/app.mjs:7  return open();'));
  assert.deepEqual(deps(map, 'src/app.mjs'), ['src/app.mjs:3  src/lib/store.mjs']);
  assert.match(whoUses(map, 'nope', root)[0], /grep for text/);
  assert.match(testsFor(map, ['README.md'])[0], /no single file/);
  assert.equal(findFile(map, './src/app.mjs'), 'src/app.mjs');
});

test('on this repo, the map agrees with the imports grep finds for lib/workers.mjs', () => {
  const root = resolve(HERE, '..', '..', '..');
  if (git(root, 'rev-parse', '--git-dir').status !== 0) return;
  const { map } = build(root, { write: false });
  const importers = (map.importers['skills/orchestrate/scripts/lib/workers.mjs'] || []).map(x => x[0]).sort();
  for (const f of ['codex-worker.mjs', 'context-check.mjs', 'guard-agent.mjs', 'router.mjs', 'workers.test.mjs', 'codex-worker.test.mjs']) {
    assert.ok(importers.includes(`skills/orchestrate/scripts/${f}`), `${f} imports lib/workers.mjs`);
  }
  const tests = testsFor(map, ['skills/orchestrate/scripts/lib/workers.mjs']).join('\n');
  assert.match(tests, /workers\.test\.mjs/);
  assert.match(tests, /codex-worker\.test\.mjs/);
});

test('the CLI builds and answers from any folder inside the repo', () => {
  const { root } = fixture();
  const cli = (...a) => spawnSync(process.execPath, [join(HERE, 'map.mjs'), ...a], { cwd: join(root, 'src', 'lib'), encoding: 'utf8' });
  const b = cli('build');
  assert.equal(b.status, 0, b.stderr);
  assert.match(b.stdout, /map: 8 code files/);
  assert.equal(cli('tests-for', 'app.mjs').stdout.trim(), 'test/app.test.mjs  (imports it at line 1)');
  assert.match(cli('status').stdout, /^map: fresh/);
  assert.equal(cli('who-uses').status, 2);
});

test('building the map never shows up as a change in git', () => {
  const { root } = fixture();
  build(root);
  build(root);
  assert.equal(git(root, 'status', '--porcelain').stdout, '');
  const excl = readFileSync(join(root, '.git', 'info', 'exclude'), 'utf8');
  assert.equal(excl.match(/^\.orchestrator\/$/gm).length, 1, 'added once, not per build');
});
