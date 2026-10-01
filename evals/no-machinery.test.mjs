// Plain-Node regression test for the "no machinery" regex shared by every
// `claude plugin eval` case's `graders/no-machinery.md` (see evals/README.md).
// This does not call `claude plugin eval` and spends no quota — it only
// proves the regex itself would fail a message containing each kind of
// internal detail a real user could end up seeing, and pass a clean one.
//
// The pattern is read straight out of one case's grader file rather than
// duplicated here, so this test breaks if the two ever drift instead of
// silently testing a stale copy.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
// Every case directory with a graders/no-machinery.md is checked, so a new
// case cannot drift unnoticed.
const graderFiles = readdirSync(here, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => path.join(here, e.name, 'graders', 'no-machinery.md'))
  .filter((f) => existsSync(f))
  .sort();

function patternFrom(file) {
  const text = readFileSync(file, 'utf8');
  const match = text.match(/^pattern:\s*'(.*)'\s*$/m);
  assert.ok(match, `no pattern: line found in ${file}`);
  return match[1];
}

test('all nine case directories carry a no-machinery grader', () => {
  assert.equal(graderFiles.length, 9, `found ${graderFiles.length}`);
});

const [canonical, ...rest] = graderFiles;
const pattern = patternFrom(canonical);
const regex = new RegExp(pattern);

test('every no-machinery.md grader carries the same widened pattern', () => {
  for (const file of rest) {
    assert.equal(patternFrom(file), pattern, `${file} has drifted from ${canonical}`);
  }
});

const leaks = {
  'a 9-24-0001-shaped task id': 'See task 9-24-0001 for details.',
  'an M-D-NNNN-shaped task id': 'Picked up module task 3-7-0021 next.',
  'the literal M-D-NNNN placeholder': 'Ids follow the M-D-NNNN sequence.',
  'an orch-* role name': 'Dispatched to orch-coordinator for review.',
  'the grade word DONE': 'Final status: DONE',
  'the grade word PASS': 'Verification: PASS',
  'the grade word FAIL': 'Result: FAIL',
  'the grade word PARTIAL': 'Status: PARTIAL, see notes.',
  'the grade word BLOCKED': 'Status: BLOCKED on input.',
  'a dollar-figure': 'Spend so far: $40.4/$45 budget.',
  'the phrase "ready now:"': 'ready now: 9-23-0005',
};

for (const [label, sample] of Object.entries(leaks)) {
  test(`no-machinery regex fails a message containing ${label}`, () => {
    assert.match(sample, regex);
  });
}

test('no-machinery regex passes a clean plain-language message', () => {
  const clean =
    'I built the contact form, tested it end to end, and it saves and ' +
    'lists the last ten messages as asked. Let me know if you want changes.';
  assert.doesNotMatch(clean, regex);
});
