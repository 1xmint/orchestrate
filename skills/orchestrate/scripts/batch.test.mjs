// batch.test.mjs — WS5's fan-out lane: one spec and a file list turned into N
// per-file packets and task rows, each task owning exactly one file so N
// worktrees can run at once with no merge conflict.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nextTaskNumber, idPrefixFromRunMd, buildBatch } from './batch.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, 'batch.mjs');

const RUN_WITH_TASKS = `# Run 20260910-rename

## Tasks

| id | phase | blocks on | owns | role · model | task | acceptance evidence | attempts | result |
|---|---|---|---|---|---|---|---|---|
| 9-10-0001 | ✅ done | — | src/a.ts | implementer · sonnet | ground the rename | reviewed | 1 | done |
| 9-10-0003 | 📋 planned | — | src/c.ts | implementer · sonnet | placeholder | ev | 0 | — |
`;

test('idPrefixFromRunMd reads the prefix from an existing row', () => {
  assert.equal(idPrefixFromRunMd(RUN_WITH_TASKS), '9-10');
  assert.equal(idPrefixFromRunMd('# Run\n\nnothing here'), null);
});

test('nextTaskNumber continues after the highest id already in the table, not the row count', () => {
  // 0002 is missing (used elsewhere or never written); the next batch must not
  // reuse it or 0003, which is already taken.
  assert.equal(nextTaskNumber(RUN_WITH_TASKS, '9-10'), 4);
  assert.equal(nextTaskNumber('# Run\n\n## Tasks\n', '9-10'), 1, 'an empty table starts at 1');
});

test('buildBatch: one task per file, each owning exactly its own file', () => {
  const { tasks, waves } = buildBatch({
    idPrefix: '9-10', startAt: 4, spec: 'rename getUser to fetchUser',
    doneWhen: 'npm test', files: ['a.ts', 'b.ts', 'c.ts'], concurrency: 20,
  });
  assert.equal(tasks.length, 3);
  assert.deepEqual(tasks.map(t => t.id), ['9-10-0004', '9-10-0005', '9-10-0006']);
  for (const t of tasks) {
    assert.match(t.row, new RegExp(`^\\| ${t.id} \\| 📋 planned \\| — \\| ${t.file} \\|`));
    assert.match(t.packet, new RegExp(`TASK: ${t.id}`));
    assert.match(t.packet, new RegExp(`OWNS: ${t.file}$`, 'm'));
    assert.match(t.packet, /in: /);
    // Every other file in the batch is explicitly out of scope for this one.
    assert.match(t.packet, /out: any other file/);
  }
  assert.deepEqual(waves, [['9-10-0004', '9-10-0005', '9-10-0006']], 'under the concurrency cap, one wave');
});

test('buildBatch: waves split at the concurrency cap', () => {
  const files = Array.from({ length: 25 }, (_, i) => `f${i}.ts`);
  const { waves } = buildBatch({ idPrefix: '9-10', startAt: 1, spec: 'x', files, concurrency: 20 });
  assert.equal(waves.length, 2);
  assert.equal(waves[0].length, 20);
  assert.equal(waves[1].length, 5);
});

test('buildBatch: RUN: travels in the packet only when a run id is given', () => {
  const withRun = buildBatch({ idPrefix: '9-10', startAt: 1, spec: 'x', files: ['a.ts'], runId: '20260910-rename' });
  assert.match(withRun.tasks[0].packet, /^RUN: 20260910-rename$/m);
  const withoutRun = buildBatch({ idPrefix: '9-10', startAt: 1, spec: 'x', files: ['a.ts'] });
  assert.doesNotMatch(withoutRun.tasks[0].packet, /^RUN:/m);
});

test('buildBatch refuses to guess a missing spec, files, or id prefix', () => {
  assert.throws(() => buildBatch({ idPrefix: '9-10', spec: 'x', files: [] }), /--files/);
  assert.throws(() => buildBatch({ idPrefix: '9-10', files: ['a.ts'] }), /--spec/);
  assert.throws(() => buildBatch({ spec: 'x', files: ['a.ts'] }), /idPrefix/);
});

test('CLI: --dry-run prints every packet and writes nothing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'orch-batch-'));
  const runMd = join(dir, 'RUN.md');
  writeFileSync(runMd, RUN_WITH_TASKS);
  const r = spawnSync(process.execPath, [SCRIPT, runMd, '--spec', 'rename getUser to fetchUser', '--files', 'src/x.ts,src/y.ts', '--dry-run'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /2 task\(s\), 1 wave\(s\)/);
  assert.match(r.stdout, /9-10-0004/);
  assert.match(r.stdout, /9-10-0005/);
  assert.match(r.stdout, /-- packet 9-10-0004/);
  assert.equal(existsSync(join(dir, 'batch')), false, 'a dry run writes nothing to disk');
});

test('CLI: without --dry-run, one packet file per task is written under the run dir', () => {
  const dir = mkdtempSync(join(tmpdir(), 'orch-batch-'));
  const runMd = join(dir, 'RUN.md');
  writeFileSync(runMd, RUN_WITH_TASKS);
  const r = spawnSync(process.execPath, [SCRIPT, runMd, '--spec', 'add the header', '--files', 'a.ts,b.ts', '--concurrency', '1'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /2 task\(s\), 2 wave\(s\) at concurrency 1/);
  const batchDirs = readdirSync(join(dir, 'batch'));
  assert.equal(batchDirs.length, 1);
  const packets = readdirSync(join(dir, 'batch', batchDirs[0]));
  assert.equal(packets.length, 2);
  const first = readFileSync(join(dir, 'batch', batchDirs[0], packets.sort()[0]), 'utf8');
  assert.match(first, /TASK: 9-10-000[45]/);
  assert.match(first, /add the header/);
});

test('CLI with no arguments prints usage and exits non-zero rather than guessing', () => {
  const r = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /usage: batch\.mjs/);
});
