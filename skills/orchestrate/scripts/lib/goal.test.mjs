// goal.test.mjs — the two-line goal note, read back as one bounded fact.
//   node --test skills/orchestrate/scripts/lib/goal.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readGoal, goalLine, goalDue, markShown, clipWords, SHOWN_CAP, NOTE_CAP, EVERY } from './goal.mjs';

const B = s => Buffer.byteLength(s, 'utf8');

function project(note) {
  const d = mkdtempSync(join(tmpdir(), 'orch-goal-'));
  if (note != null) {
    mkdirSync(join(d, '.orchestrator'), { recursive: true });
    writeFileSync(join(d, '.orchestrator', 'goal.md'), note);
  }
  return d;
}

function ledger(dir, goal, done) {
  const p = join(dir, 'RUN.md');
  writeFileSync(p, `# Run\n\n## Goal\n\n${goal}\n\n## Done when\n\n${done}\n\n## Pickup\n\nx\n`);
  return p;
}

test('with a ledger the line is the ledger Goal and Done when', () => {
  const d = project(null);
  const runMd = ledger(d, 'Finish the tidy command so notes stop piling up.', 'pytest passes and no note is lost');
  const g = readGoal({ cwd: d, runMd, state: { prompts: 3, goal: 'first words here now' } });
  assert.equal(g.source, 'ledger');
  assert.equal(g.text, 'Finish the tidy command so notes stop piling up. Done looks like: pytest passes and no note is lost');
});

test('a long ledger Goal is clipped at a word boundary, and the shown line stays within 350 bytes', () => {
  const d = project(null);
  const runMd = ledger(d, 'alpha bravo charlie '.repeat(40), 'delta echo foxtrot '.repeat(20));
  const g = readGoal({ cwd: d, runMd, state: { prompts: 0 } });
  const line = goalLine(g);
  assert.ok(B(line) <= SHOWN_CAP, `${B(line)} bytes`);
  assert.match(line, /Done looks like: /);
  assert.match(line, /…/);
  assert.doesNotMatch(line.replace(/…/g, ''), /\b(alph|brav|charli|delt|ech|foxtro)\b/, 'never mid-word');
});

test('with a note and no ledger the line is the note', () => {
  const d = project('Ship the invoice export.\nDone: the accountant can open it.\n');
  const g = readGoal({ cwd: d, state: { prompts: 0 } });
  assert.equal(g.source, 'note');
  assert.equal(g.text, 'Ship the invoice export. Done looks like: Done: the accountant can open it.');
});

test('the project page\'s "What this is for" comes before an old goal.md; a blank page falls through', () => {
  const d = project('Old note line.\nOld done.\n');
  writeFileSync(join(d, '.orchestrator', 'PROJECT.md'), '## What this is for\n\nA notes app for a bakery.\n\n## Next\n');
  const g = readGoal({ cwd: d, state: { prompts: 1 } });
  assert.equal(g.source, 'project');
  assert.equal(g.text, 'A notes app for a bakery.');
  writeFileSync(join(d, '.orchestrator', 'PROJECT.md'), '## What this is for\n\n<one or two lines…>\n');
  assert.equal(readGoal({ cwd: d, state: { prompts: 1 } }).source, 'note');
});

test('with neither, the first request is shown as not confirmed', () => {
  const d = project(null);
  const g = readGoal({ cwd: d, state: { prompts: 2, goal: 'add a json flag to the status command' } });
  assert.equal(g.source, 'first-request');
  assert.match(goalLine(g), /first request, not confirmed: add a json flag/);
});

test('nothing at all returns null and prints nothing', () => {
  const d = project(null);
  assert.equal(readGoal({ cwd: d, state: { prompts: 0 } }), null);
  assert.equal(readGoal({}), null);
  assert.equal(goalLine(null), '');
});

test('a note over the cap is clipped, not refused', () => {
  const d = project(`${'one two three '.repeat(20)}\n${'four five six '.repeat(20)}\n`);
  const g = readGoal({ cwd: d, state: { prompts: 0 } });
  assert.equal(g.source, 'note');
  assert.ok(B(g.text.replace(' Done looks like: ', ' ')) <= NOTE_CAP + 2);
  assert.ok(B(goalLine(g)) <= SHOWN_CAP);
});

test('an unreadable note falls through to the next source without throwing', () => {
  const d = project(null);
  // goal.md is a directory: reading it fails.
  mkdirSync(join(d, '.orchestrator', 'goal.md'), { recursive: true });
  const g = readGoal({ cwd: d, state: { prompts: 0, goal: 'a first request of some words' } });
  assert.equal(g.source, 'first-request');
});

test('a note is as old as its file, however new the session; only the first request is aged in prompts', () => {
  const d = project('One.\nTwo.\n');
  const week = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  utimesSync(join(d, '.orchestrator', 'goal.md'), week, week);
  const g = readGoal({ cwd: d, state: { prompts: 0 } });
  assert.equal(g.age.unit, 'minutes');
  assert.match(goalLine(g), /\(written 7 days ago\)$/);
  const hour = new Date(Date.now() - 3 * 3600 * 1000);
  utimesSync(join(d, '.orchestrator', 'goal.md'), hour, hour);
  assert.match(goalLine(readGoal({ cwd: d, state: { prompts: 40 } })), /\(written 3 hours ago\)$/);
  const f = readGoal({ cwd: mkdtempSync(join(tmpdir(), 'goal-none-')), state: { prompts: 6, goal: 'fix the export' } });
  assert.deepEqual(f.age, { unit: 'prompts', n: 6 });
});

test('clipWords ends at a word boundary with an ellipsis, and leaves short text alone', () => {
  assert.equal(clipWords('short text', 50), 'short text');
  const c = clipWords('the quick brown fox jumps over the lazy dog', 20);
  assert.ok(B(c) <= 20);
  assert.match(c, /^the quick brown…$/);
});

test('the counter fires at the tenth prompt and resets when shown', () => {
  const state = { prompts: 0 };
  let fired = [];
  for (let i = 1; i <= 25; i++) {
    if (goalDue(state)) { fired.push(i); markShown(state, 1); }
    state.prompts++;
  }
  assert.deepEqual(fired, [EVERY, 2 * EVERY]);
});
