// lib/next-open.test.mjs — what a run still has open: nextOpen, runTasks and
// runOpenWork. Namespace import so a missing export fails each test alone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as runs from './runs.mjs';

const HEAD = ['| id | phase | blocks on | owns | role · model | task | acceptance evidence | attempts | result |', '|---|---|---|---|---|---|---|---|---|'];
const row = (id, phase, task, blocks = '—', result = '—') => `| ${id} | ${phase} | ${blocks} | src/x.ts | implementer · sonnet | ${task} | exit 0 | 0 | ${result} |`;
const runText = ({ rows = [], pickup = '', doneWhen = '- tests pass' } = {}) => [
  '# Run', '', '## Goal', '', 'Ship it.', '', '## Done when', '', doneWhen, '',
  '## Tasks', '', ...HEAD, ...rows, '', '## Pickup', '', pickup, '', '## Verified vs inherited', '',
].join('\n');
const PROJECT = '# P\n\n## What this is for\n\nx\n\n## Next\n\n1. wire the login page\n2. later thing\n';

test('done tasks are skipped; the first task not done is next', () => {
  const t = runText({ rows: [row('9-1-0001', '✅ done', 'first'), row('9-1-0002', '🔨 running', 'second'), row('9-1-0003', '📋 planned', 'third')] });
  const n = runs.nextOpen(t, null);
  assert.equal(n.state, 'open');
  assert.match(n.text, /9-1-0002 second/);
  assert.doesNotMatch(n.text, /first/);
});

test('a blocked task reads "blocked on" its blocker', () => {
  const t = runText({ rows: [row('9-1-0001', '⛔ blocked', 'deploy it', '9-1-0000')] });
  const n = runs.nextOpen(t, null);
  assert.match(n.text, /9-1-0001 deploy it \(blocked on 9-1-0000\)/);
});

test('Pickup is used only when newer than the last task change', () => {
  const rows = [row('9-1-0001', '🔨 running', 'first task', '—', 'started 2026-09-10')];
  const newer = runs.nextOpen(runText({ rows, pickup: 'Pickup prompt: dispatch 9-1-0002 now\nUpdated: 2026-09-12' }), null);
  assert.equal(newer.source, 'pickup');
  assert.match(newer.text, /dispatch 9-1-0002 now/);
  const older = runs.nextOpen(runText({ rows, pickup: 'Pickup prompt: dispatch 9-1-0002 now\nUpdated: 2026-09-08' }), null);
  assert.equal(older.source, 'task');
  assert.match(older.text, /first task/);
  const undated = runs.nextOpen(runText({ rows: [row('9-1-0001', '🔨 running', 'first task')], pickup: 'Pickup prompt: dispatch 9-1-0002 now' }), null);
  assert.equal(undated.source, 'task', 'a run with no dates to compare ignores Pickup');
});

// Pickup is the lead's note to its next session; the band reads the rows
// instead (whole-file review: the note reached the user as written).
test('with pickup off, a newer Pickup is passed over for the first task not done', () => {
  const rows = [row('9-1-0001', '🔨 running', 'first task', '—', 'started 2026-09-10')];
  const t = runText({ rows, pickup: 'Pickup prompt: dispatch 9-1-0002 now\nUpdated: 2026-09-12' });
  assert.equal(runs.nextOpen(t, null).source, 'pickup', 'as before for the loop');
  const n = runs.nextOpen(t, null, { pickup: false });
  assert.equal(n.source, 'task');
  assert.match(n.text, /^9-1-0001 first task$/);
});

test('with no tasks, the first item of the project page Next is next', () => {
  const n = runs.nextOpen(runText({ rows: [] }), PROJECT);
  assert.equal(n.state, 'open');
  assert.equal(n.source, 'project');
  assert.equal(n.text, 'wire the login page');
  assert.equal(runs.nextOpen('', PROJECT).text, 'wire the login page', 'no run at all still reads the project page');
});

test('every task done is its own state, not filler', () => {
  const n = runs.nextOpen(runText({ rows: [row('9-1-0001', '✅ done', 'a'), row('9-1-0002', '✅ done', 'b')] }), PROJECT);
  assert.equal(n.state, 'all-done');
  assert.equal(n.text, runs.ALL_DONE_TEXT);
  assert.equal(runs.nextOpen('', '').state, 'none');
});

test('runOpenWork reports the Done when and how many tasks are not done', () => {
  const w = runs.runOpenWork(runText({ rows: [row('9-1-0001', '✅ done', 'a'), row('9-1-0002', '📋 planned', 'b')] }));
  assert.equal(w.notDone, 1);
  assert.equal(w.total, 2);
  assert.match(w.doneWhen, /tests pass/);
  assert.equal(runs.runOpenWork(runText({ doneWhen: '<what done looks like>', rows: [row('9-1-0001', '📋 planned', 'a')] })).doneWhen, '', 'a placeholder is not a Done when');
  assert.equal(runs.runOpenWork(runText({ rows: [row('9-1-0001', '✅ done', 'a')] })).notDone, 0);
});
