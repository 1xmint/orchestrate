// tier.test.mjs — the shared helpers every hook imports. These are small, but
// each one is read by a hook that runs on every prompt or every dispatch, so a
// wrong answer here is wrong everywhere.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { isWritten, latestRun, selfModel, shortModel, strongerThan, applyLimits, mapTier, today, sanitizeId, findRepoRoot } from './tier.mjs';

const TIER = new URL('./tier.mjs', import.meta.url).href;

// Run a snippet against this module with a HOME of its own. The active-run
// pointer lives under the real ~/.claude/orchestrate, so a test that wrote it
// in process would repoint the developer's own machine at a temp directory.
function inFakeHome(code) {
  const home = mkdtempSync(join(tmpdir(), 'orch-fakehome-'));
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
    encoding: 'utf8', env: { ...process.env, HOME: home, USERPROFILE: home },
  });
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stdout.trim();
}

test('a Pickup value is written only when it is neither a placeholder nor the template list', () => {
  assert.equal(isWritten('dispatch 9-9-0002 once 0001 lands'), true);
  assert.equal(isWritten('high'), true);
  assert.equal(isWritten('<one sentence that continues from here>'), false);
  assert.equal(isWritten(''), false);
  assert.equal(isWritten(null), false);
  // The template's own alternatives, which used to leak into the resume line
  // as "confidence high | medium | low, risk none | mild | serious".
  assert.equal(isWritten('high | medium | low'), false);
  assert.equal(isWritten('none | mild | serious'), false);
  // A real sentence that happens to contain a pipe is still written.
  assert.equal(isWritten('run `rg foo | head` then continue at step three of the plan'), true);
});

test('a half-filled Pickup section yields no confidence or risk at all', () => {
  const repo = mkdtempSync(join(tmpdir(), 'orch-tier-'));
  const dir = join(repo, '.orchestrator', 'runs', '20260909-x');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'RUN.md'), [
    '# Run', '', '## Tasks', '',
    '| id | phase | role · model | task | rubric | attempts | evidence |',
    '|---|---|---|---|---|---|---|',
    '| 9-9-0001 | 🔨 running | implementer · sonnet | x | y | 0 | — |', '',
    '## Pickup', '',
    'Pickup prompt: continue at step three',
    'Pickup confidence: high | medium | low',
    'Resume risk: none | mild | serious', '',
  ].join('\n'));

  const run = latestRun(repo);
  assert.equal(run.open, true);
  assert.equal(run.pickup['Pickup prompt'], 'continue at step three');
  assert.equal(run.pickup['Pickup confidence'], undefined, 'an unedited template line is not an answer');
  assert.equal(run.pickup['Resume risk'], undefined);
});

test('the manager\'s own model comes from the last assistant record in the tail', () => {
  const dir = mkdtempSync(join(tmpdir(), 'orch-self-'));
  const p = join(dir, 't.jsonl');
  writeFileSync(p, [
    JSON.stringify({ type: 'assistant', effort: 'low', message: { model: 'claude-sonnet-5' } }),
    JSON.stringify({ type: 'user', message: { content: 'hi' } }),
    JSON.stringify({ type: 'assistant', effort: 'high', message: { model: 'claude-opus-5' } }),
    JSON.stringify({ type: 'queue-operation', operation: 'enqueue' }),
  ].join('\n') + '\n');
  assert.deepEqual(selfModel(p), { model: 'opus', effort: 'high' }, 'the newest record wins');
  assert.equal(selfModel(join(dir, 'absent.jsonl')), null);
  assert.equal(selfModel(''), null);

  assert.equal(shortModel('claude-opus-5'), 'opus');
  assert.equal(shortModel('claude-fable-5-1'), 'fable');
  assert.equal(shortModel('claude-haiku-4-5-20251001'), 'haiku');
  assert.equal(shortModel('some-other-model'), 'some-other-model');
});

test('the family ladder decides who is stronger, and a limit steps a family down', () => {
  assert.equal(strongerThan('opus', 'sonnet'), true);
  assert.equal(strongerThan('fable', 'opus'), true);
  assert.equal(strongerThan('sonnet', 'opus'), false);
  assert.equal(strongerThan('opus', 'opus'), false, 'equal is not stronger');
  assert.equal(strongerThan('opus', 'nonsense'), false, 'an unknown model never wins by default');
  assert.equal(strongerThan(null, 'sonnet'), false);

  assert.equal(applyLimits('opus', ['opus']), 'sonnet');
  assert.equal(applyLimits('opus', []), 'opus');
  assert.equal(applyLimits('haiku', ['haiku']), 'haiku', 'the bottom of the ladder has nowhere to go');
});

test('dates are local, and ids are safe to use as filenames', () => {
  const d = new Date(2026, 8, 9, 23, 30);
  assert.equal(today(d), '2026-09-09', 'local calendar date, not UTC');
  assert.equal(mapTier('claude_max_5x'), 'max5');
  assert.equal(mapTier('MAX'), 'max5', 'unversioned max is assumed to be the smaller one');
  assert.equal(mapTier('anything else'), null);
  assert.equal(sanitizeId('a/b\\c:d'), 'a_b_c_d');
});

test('a session whose cwd is above the repo still finds the open run', () => {
  const parent = mkdtempSync(join(tmpdir(), 'orch-parent-'));
  const repo = join(parent, 'therepo');
  const dir = join(repo, '.orchestrator', 'runs', '20260909-x');
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(repo, '.git'), { recursive: true });
  writeFileSync(join(dir, 'RUN.md'), [
    '# Run', '', '## Tasks', '',
    '| id | phase | role · model | task | rubric | attempts | evidence |',
    '|---|---|---|---|---|---|---|',
    '| 9-9-0001 | 🔨 running | implementer · sonnet | x | y | 0 | — |', '',
    '## Pickup', '', 'Pickup prompt: carry on at step two', '',
  ].join('\n'));

  // This is the layout Josh actually works in: the session starts in the folder
  // that contains his repos, so findRepoRoot(cwd) is null and every hook that
  // asked cwd found nothing.
  assert.equal(findRepoRoot(parent), null);

  // The pointer lives under the real home, so this half runs in a child with a
  // fake one; otherwise the suite would repoint the developer's own machine.
  const before = inFakeHome(`
    const { latestRun } = await import(${JSON.stringify(TIER)});
    console.log(JSON.stringify(latestRun(${JSON.stringify(parent)})));
  `);
  assert.equal(before, 'null', 'without the pointer, nothing is found');

  const after = JSON.parse(inFakeHome(`
    const { latestRun, rememberActiveRun } = await import(${JSON.stringify(TIER)});
    rememberActiveRun(${JSON.stringify(repo)}, ${JSON.stringify(join(dir, 'RUN.md'))});
    console.log(JSON.stringify(latestRun(${JSON.stringify(parent)})));
  `));
  assert.ok(after, 'the pointer run-init wrote is the fallback');
  assert.equal(after.runId, '20260909-x');
  assert.equal(after.pickup['Pickup prompt'], 'carry on at step two');
});

test('the pointer never shows one repo the ledger of another', () => {
  const a = mkdtempSync(join(tmpdir(), 'orch-a-'));
  const b = mkdtempSync(join(tmpdir(), 'orch-b-'));
  for (const [root, id] of [[a, '20260909-a'], [b, '20260909-b']]) {
    const d = join(root, '.orchestrator', 'runs', id);
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, 'RUN.md'), `# Run\n\n## Tasks\n\n| id | phase | r | t | u | a | e |\n|---|---|---|---|---|---|---|\n| 9-9-0001 | 🔨 running | x | y | z | 0 | — |\n`);
  }
  const out = JSON.parse(inFakeHome(`
    const { latestRun, rememberActiveRun } = await import(${JSON.stringify(TIER)});
    rememberActiveRun(${JSON.stringify(a)}, 'ignored');
    console.log(JSON.stringify({ b: latestRun(${JSON.stringify(b)}).runId, a: latestRun(${JSON.stringify(a)}).runId }));
  `));
  assert.equal(out.b, '20260909-b', 'a repo with its own runs is never overridden by the pointer');
  assert.equal(out.a, '20260909-a');
});
