// ledger.test.mjs — deterministic caps, unpriced rows never counted as free,
// lenient STATUS parsing, and a malformed RUN.md row refused rather than
// written. Audit r1 areas 2 and 11 (docs/audits/2026-09-24-scoresheet-r1.md).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendCost, sumCosts, parseReturn, lintRunRow, lintLedger, evidenceDowngrade, NO_EVIDENCE_NOTE, reviewDowngrade, NO_REVIEW_NOTE } from './ledger.mjs';

function tmpFile() {
  const dir = mkdtempSync(join(tmpdir(), 'orch-ledger-'));
  return join(dir, 'costs.jsonl');
}

test('the costs cap is deterministic: 600 appends never leave more than 500 rows', () => {
  const path = tmpFile();
  for (let i = 0; i < 600; i++) {
    appendCost({ at: new Date().toISOString(), role: 'implementer', model: 'sonnet', priced: true, dollars: 0.01 }, path);
    const rows = readFileSync(path, 'utf8').split('\n').filter(Boolean);
    assert.ok(rows.length <= 500, `row ${i}: ${rows.length} rows, cap is 500`);
  }
  const rows = readFileSync(path, 'utf8').split('\n').filter(Boolean);
  assert.equal(rows.length, 500);
});

test('a sum over costs skips rows with no known model and says how many', () => {
  const rows = [
    { dollars: 1.5 },
    { dollars: null },
    { dollars: 2.25 },
    { dollars: null },
    {},
  ];
  const { total, skipped } = sumCosts(rows);
  assert.equal(total, 3.75);
  assert.equal(skipped, 3);
});

test('sumCosts on an all-unpriced set totals zero and skips every row', () => {
  const { total, skipped } = sumCosts([{ dollars: null }, { dollars: null }]);
  assert.equal(total, 0);
  assert.equal(skipped, 2);
});

test('STATUS parses leniently: colon, dash, and case', () => {
  assert.equal(parseReturn('TASK: 9-1-0001\nstatus: done\n').status, 'DONE');
  assert.equal(parseReturn('TASK: 9-1-0001\nSTATUS - DONE\n').status, 'DONE');
  assert.equal(parseReturn('TASK: 9-1-0001\nSTATUS – partial\n').status, 'PARTIAL');
});

test('STATUS is read wherever it falls in the return, including line 5', () => {
  const text = 'TASK: 9-1-0001\nRUN: r1\nsome notes\nmore notes\nSTATUS: DONE\nEVIDENCE: x\n';
  assert.equal(parseReturn(text).status, 'DONE');
});

test('a well-formed RUN.md row passes the lint unchanged', () => {
  const header = '| id | phase | role · model | task | evidence | attempts | result |';
  const row = '| 9-9-0001 | 🔨 running | implementer · sonnet | do the thing | x | 0 | — |';
  const r = lintRunRow(header, row);
  assert.equal(r.ok, true);
  assert.equal(r.cells.length, 7);
});

// A small ledger in the real layout: task table, then the sections below it.
const HEAD = '| id | phase | blocks on | owns | role · model | task | acceptance evidence | attempts | result |\n|---|---|---|---|---|---|---|---|---|';
const ledger = (rows, below = '') =>
  `# Run r\n\n## Tasks\n\n${HEAD}\n${rows.join('\n')}\n\nPhases: ...\n\n## Decisions\n- a decision\n${below}\n## Pickup\n\nPickup prompt: x\n`;
const row = (id, phase, blocks = '—') => `| ${id} | ${phase} | ${blocks} | a.mjs | implementer · sonnet | t | e | 0 | — |`;

test('lintLedger: a clean ledger prints nothing', () => {
  const text = ledger([row('9-1-0001', '✅ done 2026-01-01'), row('9-1-0002', '⏳ dispatched 2026-01-02', '0001')]);
  assert.deepEqual(lintLedger(text), []);
});

test('lintLedger: a task row pasted below the table is named with its line', () => {
  const text = ledger([row('9-1-0001', '✅ done 2026-01-01')], row('9-1-0002', '✅ done 2026-01-01') + '\n');
  const p = lintLedger(text);
  assert.equal(p.length, 1);
  assert.match(p[0], /9-1-0002 sits outside the task table \(line \d+\)/);
});

test('lintLedger: a row with the wrong column count inside the table is named', () => {
  const short = '| 9-1-0003 | ✅ done | implementer · sonnet | base abc, worktree | ~$2 | wave-9.md |';
  const p = lintLedger(ledger([row('9-1-0001', '✅ done 2026-01-01'), short]));
  assert.equal(p.length, 1);
  assert.match(p[0], /9-1-0003 has 6 columns, the table header has 9/);
});

test('lintLedger: a row still dispatched days after the newest row is named', () => {
  const p = lintLedger(ledger([row('9-1-0001', '⏳ dispatched 2026-01-01'), row('9-1-0002', '✅ done 2026-01-04')]));
  assert.equal(p.length, 1);
  assert.match(p[0], /9-1-0001 still says "⏳ dispatched 2026-01-01", 3 days older/);
});

test('lintLedger: a dispatched row a later done row blocks on is named, whatever its age', () => {
  const p = lintLedger(ledger([row('9-1-0001', '⏳ dispatched'), row('9-1-0002', '✅ done', '0001')]));
  assert.equal(p.length, 1);
  assert.match(p[0], /9-1-0001 still says "⏳ dispatched" but 9-1-0002, which blocks on it, is done/);
});

test('lintLedger: a row dispatched the same day as the newest row is not stale', () => {
  assert.deepEqual(lintLedger(ledger([row('9-1-0001', '⏳ dispatched 2026-01-04'), row('9-1-0002', '✅ done 2026-01-04')])), []);
});

test('a row with a shifted or missing cell is refused, naming the task id', () => {
  const header = '| id | phase | role · model | task | evidence | attempts | result |';
  const shifted = '| 9-9-0002 | 🔨 running | implementer · sonnet | do the thing | x | 0 |';
  const r = lintRunRow(header, shifted);
  assert.equal(r.ok, false);
  assert.match(r.reason, /9-9-0002/);
  assert.match(r.reason, /6 columns.*7/);
});

test('evidenceDowngrade: DONE with an evidence line is left DONE, no note', () => {
  const text = 'TASK: 9-1-0001\nSTATUS: DONE\nEVIDENCE: node --test lib/x.test.mjs — 4 pass\n';
  const r = evidenceDowngrade('DONE', text);
  assert.equal(r.status, 'DONE');
  assert.equal(r.note, null);
});

test('evidenceDowngrade: DONE with no evidence line is downgraded to PARTIAL with the note', () => {
  const text = 'TASK: 9-1-0001\nSTATUS: DONE\nCHANGED: lib/x.mjs\n';
  const r = evidenceDowngrade('DONE', text);
  assert.equal(r.status, 'PARTIAL');
  assert.equal(r.note, NO_EVIDENCE_NOTE);
  assert.match(r.note, /no evidence line/);
});

test('evidenceDowngrade never touches a return that is already PARTIAL', () => {
  const text = 'TASK: 9-1-0001\nSTATUS: PARTIAL\nNOT VERIFIED: the gate\n';
  const r = evidenceDowngrade('PARTIAL', text);
  assert.equal(r.status, 'PARTIAL');
  assert.equal(r.note, null);
});

test('evidenceDowngrade never touches a return that is already BLOCKED', () => {
  const r = evidenceDowngrade('BLOCKED', 'TASK: 9-1-0001\nSTATUS: BLOCKED\nQUESTIONS: which file\n');
  assert.equal(r.status, 'BLOCKED');
  assert.equal(r.note, null);
});

test('evidenceDowngrade never upgrades: a null status stays null', () => {
  const r = evidenceDowngrade(null, 'no fields at all');
  assert.equal(r.status, null);
  assert.equal(r.note, null);
});

test('parseReturn reads REVIEW OF: as the reviewed task id, its first token', () => {
  const r = parseReturn('TASK: 9-1-0099\nREVIEW OF: 9-1-0034 on agent/x @ abc123, worktree /r/w\nSTATUS: DONE\nVERDICT: PASS\n');
  assert.equal(r.reviewOf, '9-1-0034');
  assert.equal(r.task, '9-1-0099');
});

test('parseReturn: no REVIEW OF line reads as null', () => {
  assert.equal(parseReturn('TASK: 9-1-0001\nSTATUS: DONE\n').reviewOf, null);
});

test('a return whose TASK line is prose ("TASK: build the login page") is not filed under its first word', () => {
  const r = parseReturn('TASK: build the login page\nSTATUS: DONE\nEVIDENCE: it loads\n');
  assert.equal(r.task, null);
  assert.notEqual(r.task, 'build');
});

test('reviewDowngrade: a REVIEW: yes task marked DONE with no reviewer return yet is downgraded to PARTIAL with the note', () => {
  const r = reviewDowngrade('DONE', true, '9-1-0034', []);
  assert.equal(r.status, 'PARTIAL');
  assert.equal(r.note, NO_REVIEW_NOTE);
});

test('reviewDowngrade: a REVIEW: yes task marked DONE with a matching reviewer return already in the index stays DONE', () => {
  const rows = [{ reviewOf: '9-1-0034', status: 'DONE', verdict: 'PASS' }];
  const r = reviewDowngrade('DONE', true, '9-1-0034', rows);
  assert.equal(r.status, 'DONE');
  assert.equal(r.note, null);
});

test('reviewDowngrade: a reviewer return for a different task id does not satisfy the gate', () => {
  const rows = [{ reviewOf: '9-1-0099' }];
  const r = reviewDowngrade('DONE', true, '9-1-0034', rows);
  assert.equal(r.status, 'PARTIAL');
});

test('reviewDowngrade: no REVIEW flag leaves DONE unchanged, reviewer return or not', () => {
  assert.equal(reviewDowngrade('DONE', false, '9-1-0034', []).status, 'DONE');
  assert.equal(reviewDowngrade('DONE', false, '9-1-0034', []).note, null);
});

test('reviewDowngrade never touches PARTIAL or BLOCKED, and never upgrades', () => {
  assert.equal(reviewDowngrade('PARTIAL', true, '9-1-0034', []).status, 'PARTIAL');
  assert.equal(reviewDowngrade('PARTIAL', true, '9-1-0034', []).note, null);
  assert.equal(reviewDowngrade('BLOCKED', true, '9-1-0034', []).status, 'BLOCKED');
  assert.equal(reviewDowngrade(null, true, '9-1-0034', []).status, null);
});

test('reviewDowngrade: a review inferred from the objective\'s own words names the word in the note', () => {
  const r = reviewDowngrade('DONE', true, '9-1-0034', [], 'payment');
  assert.equal(r.status, 'PARTIAL');
  assert.equal(r.note, "done, but its objective mentions payment, so it waits for an independent review that has not returned yet.");
});

test('reviewDowngrade: no reviewInferred word falls back to the plain NO_REVIEW_NOTE', () => {
  const r = reviewDowngrade('DONE', true, '9-1-0034', []);
  assert.equal(r.note, NO_REVIEW_NOTE);
});
