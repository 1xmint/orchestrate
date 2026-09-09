// tier.test.mjs — the shared helpers every hook imports. These are small, but
// each one is read by a hook that runs on every prompt or every dispatch, so a
// wrong answer here is wrong everywhere.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isWritten, latestRun, selfModel, shortModel, strongerThan, applyLimits, mapTier, today, sanitizeId } from './tier.mjs';

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
