// ledger.test.mjs — deterministic caps, unpriced rows never counted as free,
// lenient STATUS parsing, and a malformed RUN.md row refused rather than
// written. Audit r1 areas 2 and 11 (docs/audits/2026-09-24-scoresheet-r1.md).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendCost, sumCosts, parseReturn, lintRunRow, evidenceDowngrade, NO_EVIDENCE_NOTE } from './ledger.mjs';

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
