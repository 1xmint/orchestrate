// lib/recover.test.mjs — what to say when work may have been lost: dispatches
// with no return seen yet, plans nobody has touched in days, and the facts a
// compaction drops. Tested directly against the pure functions rather than
// through a spawned router process (router.test.mjs keeps those).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  stillRunningNative, unreturned, unreturnedNote, STALE_SEEN_PATH, staleNote, compactionFact, cappedNote,
} from './recover.mjs';

test('lib/recover.mjs exports exactly the names this concern owns', async () => {
  const mod = await import('./recover.mjs');
  assert.deepEqual(Object.keys(mod).sort(), [
    'STALE_SEEN_PATH', 'cappedNote', 'compactionFact', 'staleNote', 'stillRunningNative', 'unreturned', 'unreturnedNote',
  ].sort());
});

test('unreturned excludes a dispatch runningNative still counts as alive, and softens the wording for the rest', () => {
  const state = {
    dispatches: [
      { agent: 'orch-implementer', task: '9-1-0001', at: '2026-09-01T00:00:00Z' },
      { agent: 'orch-researcher', task: '9-1-0002', at: '2026-09-01T00:05:00Z' },
    ],
    returned: [],
  };
  // runningNative still sees 9-1-0001 as alive; it has nothing to say about
  // 9-1-0002 (it may be alive too — runningNative just can't tell from here).
  const native = [{ provider: 'claude', role: 'orch-implementer', task: '9-1-0001', at: state.dispatches[0].at, agentId: 'a1', parent: null }];

  const list = unreturned(state, { native });
  assert.equal(list.length, 1, 'the one runningNative still sees alive is excluded');
  assert.equal(list[0].task, '9-1-0002');

  const note = unreturnedNote(state, { native });
  assert.match(note, /has not reported back/);
  // No role names and no task ids — those are for the ledger, not the note.
  assert.doesNotMatch(note, /orch-researcher|orch-implementer|9-1-0001|9-1-0002/);
  // Softened wording: not a settled "never returned" verdict.
  assert.doesNotMatch(note, /never returned/i);

  // With no runningNative cross-check at all, both are still listed (the
  // check only narrows the list; it is not required for the note to fire).
  const noteNoNative = unreturnedNote(state);
  assert.equal((noteNoNative.match(/has not reported back/g) || []).length, 2, 'both are still listed');
});

test('stillRunningNative never throws on malformed input', () => {
  assert.deepEqual(stillRunningNative({}, {}), []);
  assert.deepEqual(stillRunningNative(null, {}), []);
});

test('compactionFact states how many helpers were sent and when the advisor last was', () => {
  assert.match(compactionFact({ dispatches: [] }), /0 helpers sent so far; orch-advisor last sent: never\./);
  assert.match(compactionFact({ dispatches: [{ agent: 'orch-advisor' }] }), /1 helper sent so far; orch-advisor last sent: the most recent helper\./);
});

test('staleNote has nothing to say with no repo root', () => {
  assert.equal(staleNote(null), '');
});

test('staleNote reports a plan untouched for two days or more, once per plan', () => {
  const repo = mkdtempSync(join(tmpdir(), 'orch-stale-repo-'));
  const runDir = join(repo, '.orchestrator', 'runs', '20260101-old-plan');
  mkdirSync(runDir, { recursive: true });
  const runMd = join(runDir, 'RUN.md');
  writeFileSync(runMd, [
    '# Run 20260101-old-plan', '',
    '| id | phase | role · model | task | acceptance evidence | attempts | result |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    '| 1-1-0001 | 📋 planned | implementer · sonnet | do it | — | 0 | — |', '',
  ].join('\n'));
  const old = new Date(Date.now() - 5 * 86400000);
  utimesSync(runMd, old, old);
  const seenPath = join(mkdtempSync(join(tmpdir(), 'orch-stale-seen-')), 'stale-announced.json');
  const first = staleNote(repo, seenPath);
  assert.match(first, /\[orchestrate · plans\] set aside a plan/);
  assert.match(first, /20260101-old-plan/);
  assert.equal(staleNote(repo, seenPath), '', 'said once per plan on this machine');
});

test('STALE_SEEN_PATH sits under the orchestrate state directory', () => {
  assert.match(STALE_SEEN_PATH, /stale-announced\.json$/);
});

test('cappedNote is re-exported unchanged from lib/workers.mjs', async () => {
  const { cappedNote: fromWorkers } = await import('./workers.mjs');
  assert.equal(cappedNote, fromWorkers);
});
