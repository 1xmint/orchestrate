// smoke.test.mjs — smoke.mjs proves an external agent CLI can answer, and
// spends real quota doing it, so this only exercises the paths that never
// reach a provider: no argument, an unknown provider name, and a provider
// whose CLI is not on PATH.
//   node --test skills/orchestrate/scripts/smoke.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, 'smoke.mjs');

// An empty temp directory on PATH so none of claude/codex/opencode resolve,
// whatever is actually installed on the machine running this test.
function emptyPathEnv() {
  const dir = mkdtempSync(join(tmpdir(), 'orch-smoke-path-'));
  return { ...process.env, PATH: dir, Path: dir };
}

test('no provider argument prints usage and exits 2', () => {
  const r = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8', env: emptyPathEnv() });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /usage: smoke\.mjs/);
});

test('an unrecognized provider name prints usage and exits 2, never attempting a spawn', () => {
  const r = spawnSync(process.execPath, [SCRIPT, 'not-a-real-provider'], { encoding: 'utf8', env: emptyPathEnv() });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /usage: smoke\.mjs/);
});

test('a recognized provider not found on PATH exits 2 and says so, without spending any quota', () => {
  const r = spawnSync(process.execPath, [SCRIPT, 'claude'], { encoding: 'utf8', env: emptyPathEnv() });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /claude: not on PATH/);
});

test('each of the three known provider names is recognized (rejected only for missing PATH, not for the name itself)', () => {
  for (const name of ['claude', 'codex', 'opencode']) {
    const r = spawnSync(process.execPath, [SCRIPT, name], { encoding: 'utf8', env: emptyPathEnv() });
    assert.equal(r.status, 2);
    assert.match(r.stderr, new RegExp(`${name}: not on PATH`));
  }
});
