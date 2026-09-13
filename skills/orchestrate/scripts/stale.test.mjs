// stale.test.mjs — a plan nobody has touched in two days is set aside: not
// bound, not reported, not filed into, said once, and brought back on request.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const TIER = new URL('./lib/tier.mjs', import.meta.url).href;
const ROUTER = new URL('./router.mjs', import.meta.url).href;

function repoWith(runs) {
  const dir = mkdtempSync(join(tmpdir(), 'orch-stale-'));
  mkdirSync(join(dir, '.git'));
  for (const { id, phase, ageDays } of runs) {
    const runDir = join(dir, '.orchestrator', 'runs', id);
    mkdirSync(runDir, { recursive: true });
    const md = join(runDir, 'RUN.md');
    writeFileSync(md, `# Run ${id}\n\n## Tasks\n\n| id | phase | role · model | task | evidence | attempts | result |\n|---|---|---|---|---|---|---|\n| 9-9-0001 | ${phase} | implementer · sonnet | note that 📋 appears in this text | x | 0 | — |\n`);
    const t = new Date(Date.now() - ageDays * 86400000);
    utimesSync(md, t, t);
  }
  return dir;
}

function inHome(code) {
  const home = mkdtempSync(join(tmpdir(), 'orch-stale-home-'));
  mkdirSync(join(home, '.claude', 'orchestrate', 'sessions'), { recursive: true });
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', env: { ...process.env, HOME: home, USERPROFILE: home } });
  if (r.status !== 0) throw new Error(r.stderr);
  return JSON.parse(r.stdout.trim());
}

test('open means the phase cell, and an untouched open plan is stale', () => {
  const repo = repoWith([
    { id: '20260909-old', phase: '🔍 review', ageDays: 4 },
    { id: '20260913-live', phase: '🔨 running', ageDays: 0 },
    { id: '20260913-done', phase: '✅ done', ageDays: 0 },
  ]);
  const out = inHome(`
    const t = await import(${JSON.stringify(TIER)});
    const all = t.runsUnder(${JSON.stringify(repo)});
    console.log(JSON.stringify({
      all: all.map(r => [r.runId, r.open, r.stale]),
      open: t.openRunsUnder(${JSON.stringify(repo)}).map(r => r.runId),
      resolved: t.resolveRun('s1', ${JSON.stringify(repo)}).run?.runId ?? null,
    }));
  `);
  assert.deepEqual(out.all.find(r => r[0] === '20260913-done'), ['20260913-done', false, false], 'a glyph in the task text is not an open phase');
  assert.deepEqual(out.all.find(r => r[0] === '20260909-old'), ['20260909-old', true, true]);
  assert.deepEqual(out.open, ['20260913-live']);
  assert.equal(out.resolved, '20260913-live', 'the live plan binds, not the abandoned one');
});

test('an automatic binding to a stale plan lapses; an explicit recent one holds', () => {
  const repo = repoWith([{ id: '20260909-old', phase: '⛔ blocked', ageDays: 4 }]);
  const md = join(repo, '.orchestrator', 'runs', '20260909-old', 'RUN.md');
  const out = inHome(`
    const t = await import(${JSON.stringify(TIER)});
    const run = t.readRun(${JSON.stringify(md)}, ${JSON.stringify(repo)});
    const s = { v: 1, session_id: 'auto', run: { root: ${JSON.stringify(repo)}, runId: run.runId, runMd: ${JSON.stringify(md)}, boundAt: new Date(Date.now() - 4 * 86400000).toISOString() } };
    t.saveSession(s);
    t.bindSessionRun('explicit', run);
    console.log(JSON.stringify({ auto: t.sessionRun('auto')?.runId ?? null, explicit: t.sessionRun('explicit')?.runId ?? null }));
  `);
  assert.equal(out.auto, null);
  assert.equal(out.explicit, '20260909-old');
});

test('the router says once which plans it set aside, and reopen brings one back', () => {
  const repo = repoWith([{ id: '20260909-old', phase: '🔍 review', ageDays: 4 }]);
  const md = join(repo, '.orchestrator', 'runs', '20260909-old', 'RUN.md');
  const out = inHome(`
    const r = await import(${JSON.stringify(ROUTER)});
    const first = r.staleNote(${JSON.stringify(repo)});
    const second = r.staleNote(${JSON.stringify(repo)});
    console.log(JSON.stringify({ first, second }));
  `);
  assert.match(out.first, /set aside a plan .*20260909-old \(untouched 4 days, 0\/1 done\)/);
  assert.match(out.first, /--reopen <id>/);
  assert.equal(out.second, '', 'said once');

  const before = statSync(md).mtimeMs;
  const r = spawnSync(process.execPath, [join(HERE, 'run-init.mjs'), '--reopen', '20260909-old', '--repo', repo], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /reopened 20260909-old/);
  assert.ok(statSync(md).mtimeMs > before);
});
