// Proof that the hidden checks tell a right answer from a wrong one, with no
// network and no model. For every case in bench/ and bench-final/ it builds the
// starting workspace the way the eval does (runs the case's scaffold script in
// an empty folder), then checks three things:
//   - the starting workspace fails the hidden tests (nothing is done yet);
//   - bench-hidden/<case>/right/ laid over it passes them;
//   - bench-hidden/<case>/wrong/ laid over a fresh copy fails at least one.
// Hidden tests read the workspace from BENCH_WS and pass when `node --test
// <file>` exits 0.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function findBash() {
  const candidates = process.platform === 'win32'
    ? [
        join(process.env.ProgramFiles || 'C:\\Program Files', 'Git', 'bin', 'bash.exe'),
        join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Git', 'bin', 'bash.exe'),
        join(process.env.LOCALAPPDATA || '', 'Programs', 'Git', 'bin', 'bash.exe'),
        'bash',
      ]
    : ['bash'];
  for (const c of candidates) {
    if (c !== 'bash' && !existsSync(c)) continue;
    const r = spawnSync(c, ['-c', 'echo ok'], { encoding: 'utf8' });
    if (r.status === 0 && r.stdout.trim() === 'ok') return c;
  }
  return null;
}
const BASH = findBash();

const cleanEnv = () => {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  return env;
};

function caseDirs() {
  const out = [];
  for (const base of ['bench', 'bench-final']) {
    const dir = join(ROOT, base);
    if (!existsSync(dir)) continue;
    for (const n of readdirSync(dir, { withFileTypes: true })) {
      if (n.isDirectory() && existsSync(join(dir, n.name, 'case.yaml'))) out.push({ name: n.name, dir: join(dir, n.name) });
    }
  }
  return out;
}

function buildStart(c, tmp) {
  const ws = join(tmp, 'start');
  mkdirSync(ws, { recursive: true });
  const home = join(tmp, 'home');
  mkdirSync(home, { recursive: true });
  const script = join(c.dir, 'fixture-seed.sh').replace(/\\/g, '/');
  const r = spawnSync(BASH, [script], {
    cwd: ws,
    encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: home, USERPROFILE: home, TMPDIR: tmp, TERM: 'dumb', GIT_CONFIG_GLOBAL: join(home, '.gitconfig'), GIT_CONFIG_NOSYSTEM: '1' },
    timeout: 120000,
  });
  assert.equal(r.status, 0, `scaffold failed: ${r.stderr}`);
  return ws;
}

function runHidden(hiddenDir, files, ws, timeoutSeconds) {
  const results = files.map((f) => spawnSync(process.execPath, ['--test', join(hiddenDir, f)], {
    cwd: hiddenDir,
    encoding: 'utf8',
    env: { ...cleanEnv(), BENCH_WS: ws },
    timeout: timeoutSeconds * 1000,
  }));
  return { pass: results.every((r) => r.status === 0), tail: results.map((r) => (r.stdout || '').split('\n').slice(-25).join('\n')).join('\n') };
}

const cases = caseDirs();

test('there are cases to check', () => {
  assert.ok(cases.length >= 7, `found only ${cases.length} cases`);
});

for (const c of cases) {
  test(`${c.name}: files in place`, () => {
    const hidden = join(ROOT, 'bench-hidden', c.name);
    const must = JSON.parse(readFileSync(join(hidden, 'must.json'), 'utf8'));
    assert.ok(Array.isArray(must.hidden) && must.hidden.length > 0);
    assert.ok(Array.isArray(must.graders));
    assert.ok(Number.isInteger(must.timeoutSeconds));
    for (const f of must.hidden) assert.ok(existsSync(join(hidden, f)), `missing hidden test ${f}`);
    for (const g of [...must.graders, 'claims-done', 'communication']) assert.ok(existsSync(join(c.dir, 'graders', `${g}.md`)), `missing grader ${g}`);
    assert.ok(existsSync(join(c.dir, 'prompt.md')));
    assert.ok(existsSync(join(hidden, 'right')) && existsSync(join(hidden, 'wrong')));
    const yaml = readFileSync(join(c.dir, 'case.yaml'), 'utf8');
    assert.match(yaml, /max_turns: 60/);
    assert.match(yaml, /timeout_seconds: 1800/);
    // Nothing in the visible case folder may name the hidden folder.
    for (const f of readdirSync(c.dir, { recursive: true })) {
      const p = join(c.dir, f);
      if (/\.(md|yaml|sh|jsonl)$/.test(p)) {
        assert.doesNotMatch(readFileSync(p, 'utf8'), /bench-hidden|BENCH_WS/, `${f} mentions the hidden checks`);
      }
    }
  });

  test(`${c.name}: start fails, right passes, wrong fails`, { skip: BASH ? false : 'bash is not installed, so the scaffold scripts cannot run' }, () => {
    const hidden = join(ROOT, 'bench-hidden', c.name);
    const must = JSON.parse(readFileSync(join(hidden, 'must.json'), 'utf8'));
    const tmp = mkdtempSync(join(tmpdir(), `bench-${c.name}-`));
    try {
      const start = buildStart(c, tmp);
      const rightWs = join(tmp, 'right');
      const wrongWs = join(tmp, 'wrong');
      cpSync(start, rightWs, { recursive: true });
      cpSync(join(hidden, 'right'), rightWs, { recursive: true });
      cpSync(start, wrongWs, { recursive: true });
      cpSync(join(hidden, 'wrong'), wrongWs, { recursive: true });

      const s = runHidden(hidden, must.hidden, start, must.timeoutSeconds);
      assert.equal(s.pass, false, 'the starting workspace must fail the hidden tests');
      const r = runHidden(hidden, must.hidden, rightWs, must.timeoutSeconds);
      assert.equal(r.pass, true, `the known-right workspace must pass:\n${r.tail}`);
      const w = runHidden(hidden, must.hidden, wrongWs, must.timeoutSeconds);
      assert.equal(w.pass, false, 'the known-wrong workspace must fail at least one hidden test');
    } finally {
      rmSync(tmp, { recursive: true, force: true, maxRetries: 3 });
    }
  });
}
