// tier.test.mjs — the shared helpers every hook imports. These are small, but
// each one is read by a hook that runs on every prompt or every dispatch, so a
// wrong answer here is wrong everywhere.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isWritten, selfModel, shortModel, strongerThan, applyLimits, mapTier, today, sanitizeId, seenRecently, recordSeen, trimLog, isUnderRoot, writtenLine } from './tier.mjs';

// ---- append-only seen-log (R4: dispatch-events.json under concurrent writers) --

test('recordSeen never reads before it writes, so two ids never collide', () => {
  const dir = mkdtempSync(join(tmpdir(), 'orch-seenlog-'));
  const path = join(dir, 'events.jsonl');
  const now = 1_000_000_000_000;
  recordSeen(path, 'a', now);
  recordSeen(path, 'b', now + 1);
  assert.equal(seenRecently(path, 'a', now + 2, 86400000), true);
  assert.equal(seenRecently(path, 'b', now + 2, 86400000), true);
  assert.equal(seenRecently(path, 'c', now + 2, 86400000), false);
});

test('two events landing at the same moment are both recorded (the bug a single slot had)', () => {
  // The defect this replaces: one {sig, ts} object, so a second concurrent
  // write clobbered the first's record before it could be checked. An
  // append-only log has no slot to clobber.
  const dir = mkdtempSync(join(tmpdir(), 'orch-seenlog-'));
  const path = join(dir, 'events.jsonl');
  const now = 1_000_000_000_000;
  const firstSeenBefore = seenRecently(path, 'dispatch-1', now, 86400000);
  recordSeen(path, 'dispatch-1', now);
  const secondSeenBefore = seenRecently(path, 'dispatch-2', now, 86400000);
  recordSeen(path, 'dispatch-2', now);
  assert.equal(firstSeenBefore, false, 'neither had been seen yet');
  assert.equal(secondSeenBefore, false, 'recording the first did not consume the slot the second needed');
  // A genuine repeat of the first, after the second was recorded in between,
  // is still caught — the exact case the global slot got wrong.
  assert.equal(seenRecently(path, 'dispatch-1', now + 1, 86400000), true);
});

test('seenRecently respects the TTL and ignores anything malformed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'orch-seenlog-'));
  const path = join(dir, 'events.jsonl');
  const now = 1_000_000_000_000;
  recordSeen(path, 'stale', now - 90_000_000);
  writeFileSync(path, 'not json\n', { flag: 'a' });
  recordSeen(path, 'fresh', now);
  assert.equal(seenRecently(path, 'stale', now, 86400000), false, 'older than the TTL is not a repeat');
  assert.equal(seenRecently(path, 'fresh', now, 86400000), true);
  assert.equal(seenRecently(path, 'missing-file-entirely', now), false);
});

test('trimLog drops the oldest lines and leaves a short log untouched', () => {
  const dir = mkdtempSync(join(tmpdir(), 'orch-seenlog-'));
  const path = join(dir, 'events.jsonl');
  for (let i = 0; i < 10; i++) recordSeen(path, `k${i}`, 1000 + i);
  trimLog(path, 4);
  const kept = require_lines(path);
  assert.equal(kept.length, 4);
  assert.deepEqual(kept.map(l => JSON.parse(l).id), ['k6', 'k7', 'k8', 'k9']);

  const untouched = join(dir, 'short.jsonl');
  recordSeen(untouched, 'only-one', 1000);
  trimLog(untouched, 4);
  assert.equal(require_lines(untouched).length, 1, 'nothing to trim is not an error');

  trimLog(join(dir, 'does-not-exist.jsonl'), 4); // must not throw
});

function require_lines(path) {
  return readFileSync(path, 'utf8').split('\n').filter(Boolean);
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

test('the manager\'s own model comes from the last assistant record in the tail', () => {
  const dir = mkdtempSync(join(tmpdir(), 'orch-self-'));
  const p = join(dir, 't.jsonl');
  writeFileSync(p, [
    JSON.stringify({ type: 'assistant', effort: 'low', message: { model: 'claude-sonnet-5' } }),
    JSON.stringify({ type: 'user', message: { content: 'hi' } }),
    JSON.stringify({ type: 'assistant', effort: 'high', entrypoint: 'claude-desktop', message: { model: 'claude-opus-5' } }),
    JSON.stringify({ type: 'queue-operation', operation: 'enqueue' }),
  ].join('\n') + '\n');
  // The session's own CLAUDE_EFFORT beats the transcript; pin it so the result
  // does not depend on who runs the tests.
  const savedEffort = process.env.CLAUDE_EFFORT;
  try {
    delete process.env.CLAUDE_EFFORT;
    assert.deepEqual(selfModel(p), { model: 'opus', effort: 'high', entrypoint: 'claude-desktop' }, 'the newest record wins, host and all');
    process.env.CLAUDE_EFFORT = 'medium';
    assert.equal(selfModel(p).effort, 'medium', 'the environment wins over the transcript');
  } finally {
    if (savedEffort === undefined) delete process.env.CLAUDE_EFFORT; else process.env.CLAUDE_EFFORT = savedEffort;
  }
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

test('isUnderRoot: same branch of the tree either way round, never an unrelated path', () => {
  assert.equal(isUnderRoot('/a', '/a'), true, 'the same folder');
  assert.equal(isUnderRoot('/a/sub', '/a'), true, 'cwd below root');
  assert.equal(isUnderRoot('/a', '/a/sub'), true, 'cwd above root');
  assert.equal(isUnderRoot('/b', '/a'), false, 'unrelated paths');
  assert.equal(isUnderRoot('/a-other', '/a'), false, 'a name prefix is not containment');
  assert.equal(isUnderRoot(null, '/a'), false);
});

test('dates are local, and ids are safe to use as filenames', () => {
  const d = new Date(2026, 8, 9, 23, 30);
  assert.equal(today(d), '2026-09-09', 'local calendar date, not UTC');
  assert.equal(mapTier('claude_max_5x'), 'max5');
  assert.equal(mapTier('MAX'), 'max5', 'unversioned max is assumed to be the smaller one');
  assert.equal(mapTier('anything else'), null);
  assert.equal(sanitizeId('a/b\\c:d'), 'a_b_c_d');
});

// ---- writtenLine: a line someone wrote, not the run template's own ----------

test('writtenLine refuses the run template\'s own lines and keeps real ones', () => {
  // The template's lines (review of the hook fixes, 2026-10-03): a "continue"
  // armed toward these words when they counted as written.
  for (const t of [
    '', '   ', '- <evidence that would prove it, one line each; a command, a file, a page state>',
    'Why it matters: <what the user gets when it is done>', '<~N fresh sessions>',
    'When it ends, met or dropped: say which and why', '{{GOAL}}', 'Goal: {{GOAL}}',
    'Pickup confidence: high | medium | low', '- Status: open | done', 'Why it matters:',
  ]) assert.equal(writtenLine(t), false, JSON.stringify(t));
  for (const t of [
    '- `pytest -q` passes', 'Why it matters: notes stop piling up',
    'Run `rg TODO | wc -l` and get 0', 'The page renders <Header /> with the new logo',
    'Spec: <https://example.com/spec>', '1. the export button downloads a CSV',
    'Check: `a | b` prints ok', 'Either the build passes or we roll back | noted in STATE.md as the plan',
  ]) assert.equal(writtenLine(t), true, JSON.stringify(t));
});
