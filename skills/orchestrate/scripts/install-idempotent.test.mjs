// install-idempotent.test.mjs — the script install, run twice into a throwaway
// home: every hook this plugin registers appears exactly once per event, the
// user's own hook survives, and the copied skill carries the new scripts.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const INSTALL = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'scripts', 'install.mjs');

test('installing twice registers each hook once and keeps the user\'s own', () => {
  const home = mkdtempSync(join(tmpdir(), 'orch-install-'));
  mkdirSync(join(home, '.claude'), { recursive: true });
  const mine = { matcher: 'Write', hooks: [{ type: 'command', command: 'node "/x/memory-write-gate.mjs"' }] };
  writeFileSync(join(home, '.claude', 'settings.json'), JSON.stringify({ hooks: { PreToolUse: [mine] }, effortLevel: 'low' }, null, 2));
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  const once = () => spawnSync(process.execPath, [INSTALL, '--with-router', '--with-hook', '--no-agents', '--no-codex'], { encoding: 'utf8', env });

  const a = once();
  assert.equal(a.status, 0, a.stderr);
  const first = readFileSync(join(home, '.claude', 'settings.json'), 'utf8');
  const b = once();
  assert.equal(b.status, 0, b.stderr);
  assert.match(b.stdout, /8 stale orchestrate entries removed, 8 registered/);
  const s = JSON.parse(readFileSync(join(home, '.claude', 'settings.json'), 'utf8'));
  assert.deepEqual(s, JSON.parse(first), 'the second install changes nothing');

  const pairs = [];
  for (const [ev, groups] of Object.entries(s.hooks)) for (const g of groups) for (const h of g.hooks) {
    const m = /([\w-]+\.mjs)/.exec(h.command || '');
    if (m && m[1] !== 'memory-write-gate.mjs') pairs.push(`${ev}:${m[1]}`);
  }
  assert.equal(new Set(pairs).size, pairs.length, `no hook twice: ${pairs.join(', ')}`);
  assert.ok(pairs.includes('PostToolUse:context-check.mjs'));
  assert.deepEqual(s.hooks.PreToolUse[0], mine, 'the user\'s hook is untouched');
  assert.equal(s.effortLevel, 'low');
  const skill = join(home, '.claude', 'skills', 'orchestrate');
  for (const f of ['scripts/context-check.mjs', 'scripts/codex-worker.mjs', 'scripts/lib/context.mjs', 'assets/worker-report.schema.json']) {
    assert.ok(existsSync(join(skill, f)), `${f} is installed`);
  }
});
