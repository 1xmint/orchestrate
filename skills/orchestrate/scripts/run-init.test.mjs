// run-init.test.mjs — the script that creates every ledger. It had no test,
// and it is the one file whose output a later session depends on to resume.
//
// smoke.mjs is the only script here with no test on purpose: it exists to spend
// a little of a provider's quota to prove that provider answers, so testing it
// would spend quota on every run of the suite.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { latestRun } from './lib/tier.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, 'run-init.mjs');

function repo(files = {}, withGit = true) {
  const dir = mkdtempSync(join(tmpdir(), 'orch-runinit-'));
  for (const [rel, content] of Object.entries(files)) {
    const p = join(dir, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content);
  }
  if (withGit) spawnSync('git', ['init', '-q', dir], { encoding: 'utf8' });
  return dir;
}

// A fake HOME, because run-init records the run it created under
// ~/.claude/orchestrate so hooks can find it from any cwd. Without this the
// suite would repoint the developer's own machine at a temp directory.
const FAKE_HOME = mkdtempSync(join(tmpdir(), 'orch-runinit-home-'));
const run = (cwd, ...args) => spawnSync(process.execPath, [SCRIPT, ...args], {
  cwd, encoding: 'utf8', env: { ...process.env, HOME: FAKE_HOME, USERPROFILE: FAKE_HOME },
});

test('a ledger is created with the headings a resuming session looks for', () => {
  const dir = repo({ 'pyproject.toml': '[tool.pytest.ini_options]\n' });
  const r = run(dir, 'tidy-finish', '--goal', 'finish tidy', '--tier', 'max5');
  assert.equal(r.status, 0, r.stderr);

  const path = r.stdout.split('\n')[0].trim();
  assert.ok(existsSync(path), 'the first line of output is the path it wrote');
  const md = readFileSync(path, 'utf8');
  for (const h of ['## Goal', '## Done when', '## Profile', '## Facts learned while grounding',
    '## Tasks', '## Decisions', '## Open questions for the user', '## Pickup', '## Verified vs inherited']) {
    assert.ok(md.includes(h), `keeps the heading ${h}`);
  }
  assert.match(md, /finish tidy/);
  assert.match(md, /tier: max5/);
  assert.doesNotMatch(md, /\{\{[A-Z_]+\}\}/, 'no template placeholder survives');
  assert.match(r.stdout, /task id prefix: \d+-\d+-NNNN/);
});

test('the detected gate is prefilled under Facts, and written to gate.json', () => {
  const dir = repo({ 'pyproject.toml': '[tool.pytest.ini_options]\n\n[tool.ruff]\n' });
  const r = run(dir, 'x');
  const md = readFileSync(r.stdout.split('\n')[0].trim(), 'utf8');
  const facts = md.slice(md.indexOf('## Facts'), md.indexOf('## Tasks'));
  assert.match(facts, /GATE \(detected \d{4}-\d\d-\d\d/);
  assert.match(facts, /pytest -q/);
  assert.match(facts, /ruff check \./);
  assert.ok(existsSync(join(dir, '.orchestrator', 'gate.json')));
});

test('a repo with no detectable gate still gets a ledger, and says the gate is unknown', () => {
  const dir = repo({ 'README.md': 'hi\n' });
  const r = run(dir, 'x');
  assert.equal(r.status, 0);
  assert.match(readFileSync(r.stdout.split('\n')[0].trim(), 'utf8'), /none detected: ask the user/);
});

test('the ledger is excluded from git rather than added to a tracked ignore file', () => {
  const dir = repo({ 'package.json': '{}' });
  run(dir, 'x');
  assert.match(readFileSync(join(dir, '.git', 'info', 'exclude'), 'utf8'), /^\.orchestrator\/$/m);
  assert.equal(existsSync(join(dir, '.gitignore')), false, 'a tracked file is never touched');
});

test('the same slug twice refuses rather than overwriting a live ledger', () => {
  const dir = repo({ 'package.json': '{}' });
  assert.equal(run(dir, 'dup').status, 0);
  const second = run(dir, 'dup');
  assert.equal(second.status, 1);
  assert.match(second.stderr, /exists:/);
  assert.match(second.stderr, /resume it \(read its Pickup section\)/);
});

test('--repo puts the ledger in the repo the goal is about, not the current directory', () => {
  const target = repo({ 'Cargo.toml': '[package]\nname="x"\n' });
  const elsewhere = repo({}, false);
  const r = run(elsewhere, 'x', '--repo', target);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.stdout.startsWith(target), 'the ledger lands in the target repo');
  assert.equal(existsSync(join(elsewhere, '.orchestrator')), false);
  assert.match(r.stderr + r.stdout, /^(?!.*--repo not found)/s);

  const missing = run(elsewhere, 'x', '--repo', join(tmpdir(), 'orch-absent-4242'));
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /--repo not found/);
});

test('a slug is required, and a messy one is normalised', () => {
  const dir = repo({ 'package.json': '{}' });
  assert.equal(run(dir).status, 2);
  const r = run(dir, 'Tidy Finish!! v2');
  assert.equal(r.status, 0);
  assert.match(r.stdout.split('\n')[0], /\d{8}-tidy-finish-v2/);
});

test('the new ledger reads back as an open run with an unwritten Pickup', () => {
  const dir = repo({ 'package.json': '{}' });
  run(dir, 'x', '--goal', 'do the thing');
  const found = latestRun(dir);
  assert.ok(found, 'latestRun finds what run-init wrote');
  assert.equal(found.open, true, 'the placeholder row counts as open');
  assert.deepEqual(found.pickup, {}, 'nothing in Pickup is written yet, so nothing is reported');
  assert.equal(readdirSync(join(dir, '.orchestrator', 'runs')).length, 1);
});
