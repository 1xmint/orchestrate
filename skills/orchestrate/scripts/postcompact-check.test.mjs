// postcompact-check.test.mjs — the PostCompact hook that saves a helper's own
// compaction summary under its run's returns/ folder: the pure decide()
// function, the compact-row counter, and the hook process's silent contract.
//   node --test skills/orchestrate/scripts/postcompact-check.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decide, nextCompactN, INDEX_NAME } from './postcompact-check.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const HOOK = join(HERE, 'postcompact-check.mjs');

function run(input, home = mkdtempSync(join(tmpdir(), 'orch-postcompact-home-'))) {
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: { ...process.env, HOME: home, USERPROFILE: home },
  });
  return { stdout: r.stdout, status: r.status, home };
}

// ---- pure: decide -----------------------------------------------------------

test('decide is null for a lead-side PostCompact (no agent_id): not this hook\'s job', () => {
  assert.equal(decide({ compact_summary: 'x' }, { dir: '/some/run' }), null);
});

test('decide is null for an unbound helper session with no resolved run', () => {
  assert.equal(decide({ agent_id: 'helper-1', compact_summary: 'x' }, null), null);
});

test('decide names the file and index it writes for a bound helper', () => {
  const d = decide({ agent_id: 'helper-1', compact_summary: 'the summary text' }, { dir: '/repo/.orchestrator/runs/r1' });
  assert.equal(d.agentId, 'helper-1');
  assert.equal(d.summary, 'the summary text');
  assert.match(d.file, /helper-1-compact-1\.md$/);
});

test('decide treats a non-string compact_summary as an empty summary rather than throwing', () => {
  const d = decide({ agent_id: 'helper-1', compact_summary: undefined }, { dir: '/repo/run' });
  assert.equal(d.summary, '');
});

// ---- nextCompactN -------------------------------------------------------------

test('nextCompactN starts at 1 with no index file, and counts only this agent\'s own rows', () => {
  const dir = mkdtempSync(join(tmpdir(), 'orch-postcompact-dir-'));
  assert.equal(nextCompactN(dir, 'a1'), 1);
  writeFileSync(join(dir, INDEX_NAME), [
    JSON.stringify({ kind: 'compact', agentId: 'a1' }),
    JSON.stringify({ kind: 'compact', agentId: 'a2' }),
    JSON.stringify({ kind: 'return', agentId: 'a1' }),
  ].join('\n') + '\n');
  assert.equal(nextCompactN(dir, 'a1'), 2);
  assert.equal(nextCompactN(dir, 'a2'), 2);
});

// ---- hook process: silent contract --------------------------------------------

test('a malformed JSON payload exits 0 and writes nothing', () => {
  const r = spawnSync(process.execPath, [HOOK], { input: 'not json', encoding: 'utf8', env: { ...process.env, HOME: mkdtempSync(join(tmpdir(), 'orch-postcompact-home-')) } });
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), '');
});

test('a lead-side payload with no agent_id is silent and writes nothing to disk', () => {
  const r = run({ hook_event_name: 'PostCompact', session_id: 's1', compact_summary: 'lead summary' });
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), '');
});

test('a helper payload for a session with no bound run is silent (nothing to file it under)', () => {
  const r = run({ hook_event_name: 'PostCompact', session_id: 'unbound-session', agent_id: 'helper-1', compact_summary: 'x' });
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), '');
});
