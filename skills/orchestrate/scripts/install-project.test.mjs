// install-project.test.mjs — the project kit on three fixture trees, plus the
// rules-file size budget it must never exceed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { plan, rulesFile, neverDoRules, RULES_REL } from './install-project.mjs';
import { detect } from './gate.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, 'install-project.mjs');

function repo(files, withGit = true) {
  const dir = mkdtempSync(join(tmpdir(), 'orch-proj-'));
  for (const [rel, content] of Object.entries(files)) {
    const p = join(dir, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content);
  }
  if (withGit) spawnSync('git', ['init', '-q', dir], { encoding: 'utf8' });
  return dir;
}

const run = (dir, ...args) => spawnSync(process.execPath, [SCRIPT, dir, ...args], { encoding: 'utf8' });

test('a Python repo: gate.json, the exclude line, and a rules file inside budget', () => {
  const dir = repo({
    'pyproject.toml': '[tool.pytest.ini_options]\n\n[tool.ruff]\n',
    'AGENTS.md': '# notelocus\n\n- Never delete a note file; move it to the trash folder instead.\n- Do not write outside the notes directory.\n',
  });
  const r = run(dir);
  assert.equal(r.status, 0, r.stderr);

  const g = JSON.parse(readFileSync(join(dir, '.orchestrator', 'gate.json'), 'utf8'));
  assert.equal(g.gate.find(c => c.kind === 'test').cmd, 'pytest -q');

  const rules = readFileSync(join(dir, RULES_REL), 'utf8');
  assert.ok(rules.trimEnd().split('\n').length <= 12, 'rules load every session, so they stay short');
  assert.match(rules, /pytest -q/);
  assert.match(rules, /\/orchestrate/);
  assert.match(rules, /Never delete a note file/, "the repo's own prohibition is quoted, not paraphrased");

  const excl = readFileSync(join(dir, '.git', 'info', 'exclude'), 'utf8');
  assert.match(excl, /^\.orchestrator\/$/m);
  assert.match(r.stdout, /AGENTS\.md and no CLAUDE\.md/);
  assert.match(r.stdout, /@AGENTS\.md/);
  assert.equal(existsSync(join(dir, 'CLAUDE.md')), false, 'a tracked file is never added without being asked');
});

test('a Cargo workspace: the gate comes from the manifest, and a second run changes nothing', () => {
  const dir = repo({ 'Cargo.toml': '[workspace]\nmembers=["a"]\n', 'CLAUDE.md': 'be careful\n' });
  assert.equal(run(dir).status, 0);
  const first = readFileSync(join(dir, RULES_REL), 'utf8');
  assert.match(first, /cargo test/);

  const again = run(dir);
  assert.match(again.stdout, /already current/);
  assert.match(again.stdout, /already excluded/);
  assert.equal(readFileSync(join(dir, RULES_REL), 'utf8'), first);
  assert.doesNotMatch(again.stdout, /AGENTS\.md and no CLAUDE\.md/);
});

test('a package.json project: --dry-run writes nothing at all', () => {
  const dir = repo({ 'package.json': JSON.stringify({ scripts: { test: 'vitest run', lint: 'eslint .' } }) });
  const r = run(dir, '--dry-run');
  assert.equal(r.status, 0);
  assert.match(r.stdout, /npm run test/);
  assert.equal(existsSync(join(dir, '.orchestrator', 'gate.json')), false);
  assert.equal(existsSync(join(dir, RULES_REL)), false);
  assert.doesNotMatch(readFileSync(join(dir, '.git', 'info', 'exclude'), 'utf8'), /orchestrator/);
});

test("someone else's rules file is left alone unless forced", () => {
  const dir = repo({ 'package.json': '{}' });
  mkdirSync(dirname(join(dir, RULES_REL)), { recursive: true });
  writeFileSync(join(dir, RULES_REL), 'my own rules\n');
  assert.match(run(dir).stdout, /left alone/);
  assert.equal(readFileSync(join(dir, RULES_REL), 'utf8'), 'my own rules\n');
  run(dir, '--force');
  assert.match(readFileSync(join(dir, RULES_REL), 'utf8'), /installed by the orchestrate skill/);
});

test('--with-claude-md writes the import, and only then', () => {
  const dir = repo({ 'AGENTS.md': 'Never force-push.\n', 'package.json': '{}' });
  run(dir);
  assert.equal(existsSync(join(dir, 'CLAUDE.md')), false);
  run(dir, '--with-claude-md');
  assert.equal(readFileSync(join(dir, 'CLAUDE.md'), 'utf8'), '@AGENTS.md\n');
});

test('the rules file stays inside budget even when the repo states many prohibitions', () => {
  const many = Array.from({ length: 9 }, (_, i) => `- Never do the ${i}th forbidden thing in this repository, ever.`).join('\n');
  const g = detect(repo({ 'Cargo.toml': '[package]\nname="x"\n' }, false));
  const text = rulesFile(g, neverDoRules(many));
  assert.ok(text.trimEnd().split('\n').length <= 12, `rules are ${text.trimEnd().split('\n').length} lines`);
  assert.match(text, /A change is not done until the gate has run/);
});

test('never-do detection takes prohibitions and nothing else', () => {
  assert.deepEqual(neverDoRules('- Never force-push to main under any circumstances.'), ['Never force-push to main under any circumstances.']);
  assert.deepEqual(neverDoRules('We should probably avoid force-pushing.'), [], 'a suggestion is not a rule');
  assert.deepEqual(neverDoRules('Never.'), [], 'too short to carry a rule');
  assert.equal(neverDoRules(`${'x'.repeat(200)}`).length, 0);
  assert.equal(neverDoRules(null).length, 0);
});

test('a repo with no gate says so instead of inventing one', () => {
  const dir = repo({ 'README.md': 'hi\n' });
  const r = run(dir);
  assert.match(readFileSync(join(dir, RULES_REL), 'utf8'), /Gate: not detected\. Ask what command proves/);
  assert.match(r.stdout, /none detected/);
});

test('plan() reports what it would do without touching the tree', () => {
  const dir = repo({ 'pyproject.toml': '[tool.mypy]\n', 'AGENTS.md': 'Never commit secrets to this repository.\n' });
  const p = plan(dir);
  assert.equal(p.needsClaudeMd, true);
  assert.match(p.rules, /mypy \./);
  assert.equal(existsSync(join(dir, '.orchestrator')), false);
});

test('a directory that is not a repo still gets a gate and says why there is no exclude', () => {
  const dir = repo({ 'package.json': JSON.stringify({ scripts: { build: 'tsc' } }) }, false);
  const r = run(dir);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /not a git repo/);
  assert.ok(existsSync(join(dir, '.orchestrator', 'gate.json')));
});

test('a missing directory is an error the user can act on', () => {
  const r = spawnSync(process.execPath, [SCRIPT, join(tmpdir(), 'orch-not-here-999')], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /no such directory/);
});

test('the twelve-line budget truncates and always terminates, even absurdly', () => {
  const g = { at: '2026-09-09', gate: [], standards: [], agentsNotLoaded: false };
  // The fixed part is well inside the budget today, so this can only be reached
  // if someone grows it. It must truncate, not recurse forever.
  const text = rulesFile(g, []);
  assert.ok(text.trimEnd().split('\n').length <= 12);
  const many = rulesFile({ ...g, gate: [{ kind: 'test', cmd: 'x' }] }, ['Never a.', 'Never b.', 'Never c.']);
  assert.ok(many.trimEnd().split('\n').length <= 12);
  assert.match(many, /`x`/, 'the gate survives truncation; the quoted rules are what gets cut');
});
