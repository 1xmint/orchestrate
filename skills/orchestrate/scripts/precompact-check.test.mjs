// precompact-check.test.mjs — the wording precompact-check.mjs emits: no
// machine path in anything the user reads, and only the two keys PreCompact
// actually documents (docs/research/0039).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decide, unboundDecision, relativeLocation } from './precompact-check.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const script = join(HERE, 'precompact-check.mjs');

function sandbox() {
  const home = mkdtempSync(join(tmpdir(), 'orch-home-'));
  mkdirSync(join(home, '.claude', 'orchestrate'), { recursive: true });
  return home;
}

function run(payload, home) {
  const r = spawnSync(process.execPath, [script], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, HOME: home, USERPROFILE: home, ANTHROPIC_API_KEY: '' },
  });
  return { stdout: r.stdout, json: r.stdout.trim() ? JSON.parse(r.stdout) : null };
}

function fixtureRepo(opts = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'orch-repo-'));
  mkdirSync(join(dir, '.git'), { recursive: true });
  const runId = opts.runId || '20260909-fixture';
  const runDir = join(dir, '.orchestrator', 'runs', runId);
  mkdirSync(runDir, { recursive: true });
  const runMd = join(runDir, 'RUN.md');
  writeFileSync(runMd, `# Run ${runId}

## Goal

Ship the flag.

## Tasks

| id | phase | role · model | task | acceptance evidence | attempts | result |
|---|---|---|---|---|---|---|
| 9-9-0001 | 🔨 running | implementer · sonnet | add the flag | the test passes | 0 | — |

## Pickup

Pickup prompt: ${opts.pickup ?? '<one sentence that continues from here>'}
Pickup confidence: high
Resume risk: none
`);
  return { dir, runDir, runId, runMd };
}

function bind(home, sessionId, repo) {
  const dir = join(home, '.claude', 'orchestrate', 'sessions');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${sessionId}.json`), JSON.stringify({
    v: 1, session_id: sessionId,
    run: { root: repo.dir, runId: repo.runId, runMd: repo.runMd, boundAt: new Date().toISOString() },
  }));
}

test('relativeLocation: a path inside cwd comes back relative, with forward slashes', () => {
  assert.equal(relativeLocation('/home/user/proj/.orchestrator/runs/x/RUN.md', '/home/user/proj'), '.orchestrator/runs/x/RUN.md');
  assert.equal(relativeLocation('C:\\Users\\me\\proj\\a\\b.md', 'C:\\Users\\me\\proj'), 'a/b.md');
});

test('relativeLocation: a path outside cwd, or no cwd at all, comes back null', () => {
  assert.equal(relativeLocation('/home/other/x.md', '/home/user/proj'), null);
  assert.equal(relativeLocation('/home/user/proj/x.md', null), null);
  assert.equal(relativeLocation(null, '/home/user/proj'), null);
});

test('decide(): a run inside cwd names it as a repo-relative path, no drive letter, no "Users"', () => {
  const repo = fixtureRepo({ runId: 'x' });
  const run = { open: true, runMd: repo.runMd };
  const d = decide({ run, lastDispatchAt: new Date().toISOString(), prev: {}, cwd: repo.dir });
  assert.equal(d.block, true);
  assert.match(d.reason, /\.orchestrator\/runs\/x\/RUN\.md/);
  assert.doesNotMatch(d.reason, /[A-Za-z]:[\\/]/, 'no drive letter');
  assert.doesNotMatch(d.reason, /\bUsers\b/, 'no account name');
});

test('decide(): a run outside cwd (or no cwd given) names no path at all', () => {
  const repo = fixtureRepo({ runId: 'x' });
  const other = mkdtempSync(join(tmpdir(), 'orch-other-'));
  const run = { open: true, runMd: repo.runMd };
  const d = decide({ run, lastDispatchAt: new Date().toISOString(), prev: {}, cwd: other });
  assert.equal(d.block, true);
  assert.doesNotMatch(d.reason, /[A-Za-z]:[\\/]|\bUsers\b/, 'no machine path of any kind');
  assert.match(d.reason, /run file this plugin is tracking/);
});

test('unboundDecision(): outside the project, the checkpoint is named home-relative, no drive letter, no account name', () => {
  const reading = { compaction: { uuid: 'e1' } };
  const d = unboundDecision({ session: 's', reading, prev: {}, checkpoint: false, cwd: '/home/user/proj' });
  assert.equal(d.block, true);
  assert.match(d.reason, /~\/\.claude\/orchestrate\/context\/.+checkpoint-.+\.md/);
  assert.doesNotMatch(d.reason, /[A-Z]:\\|\/Users\//);
});

test('the emitted JSON on a real block has exactly the keys decision and reason', () => {
  const home = sandbox();
  const repo = fixtureRepo();
  bind(home, 'spc-keys', repo);
  const sessions = join(home, '.claude', 'orchestrate', 'sessions');
  const state = JSON.parse(readFileSync(join(sessions, 'spc-keys.json'), 'utf8'));
  state.lastDispatchAt = new Date().toISOString();
  writeFileSync(join(sessions, 'spc-keys.json'), JSON.stringify(state));

  const out = run({ hook_event_name: 'PreCompact', session_id: 'spc-keys', cwd: repo.dir, trigger: 'auto' }, home);
  assert.equal(out.json.decision, 'block');
  assert.deepEqual(Object.keys(out.json).sort(), ['decision', 'reason']);
});
