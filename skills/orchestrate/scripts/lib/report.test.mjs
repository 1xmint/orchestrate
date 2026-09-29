// lib/report.test.mjs — a DONE return without an evidence line is caught
// before it reaches the ledger; a malformed return never throws. Audit r3
// area 11 (docs/audits/2026-09-24-scoresheet-r3.md).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkReturn, schemaFieldNames } from './report.mjs';

test('DONE with a test-file evidence line is ok', () => {
  const text = 'TASK: 9-1-0001\nSTATUS: DONE\nCHANGED: lib/x.mjs\nEVIDENCE: node --test lib/x.test.mjs — 4 pass\n';
  const r = checkReturn(text);
  assert.equal(r.ok, true);
  assert.deepEqual(r.missing, []);
  assert.equal(r.evidence, true);
  assert.equal(r.status, 'DONE');
});

test('DONE with a count as evidence is ok', () => {
  const text = 'TASK: 9-1-0001\nSTATUS: DONE\nEVIDENCE: 550 pass / 0 fail\n';
  assert.equal(checkReturn(text).evidence, true);
});

test('DONE with a file:line as evidence is ok', () => {
  const text = 'TASK: 9-1-0001\nSTATUS: DONE\nEVIDENCE: fixed the off-by-one at router.mjs:119\n';
  assert.equal(checkReturn(text).evidence, true);
});

test('DONE with a path as evidence is ok', () => {
  const text = 'TASK: 9-1-0001\nSTATUS: DONE\nEVIDENCE: log at .orchestrator/runs/r1/log.txt\n';
  assert.equal(checkReturn(text).evidence, true);
});

test('DONE with no EVIDENCE section at all is missing evidence', () => {
  const text = 'TASK: 9-1-0001\nSTATUS: DONE\nCHANGED: lib/x.mjs\n';
  const r = checkReturn(text);
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing, ['evidence']);
  assert.equal(r.evidence, false);
});

test('DONE with an EVIDENCE line that is just prose is missing evidence', () => {
  const text = 'TASK: 9-1-0001\nSTATUS: DONE\nEVIDENCE: looks good to me\n';
  const r = checkReturn(text);
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing, ['evidence']);
});

test('DONE whose only proof is under PROOF: is not marked unverified', () => {
  const text = 'OUTCOME: done\nPROOF: node --test lib/x.test.mjs gave 4 pass, 0 fail\nNOT CHECKED: nothing\nTASK: 9-1-0001\nSTATUS: DONE\n';
  const r = checkReturn(text);
  assert.equal(r.ok, true);
  assert.equal(r.evidence, true);
});

test('an empty PROOF:, or one that says none, is not evidence, and a path in another field is not either', () => {
  for (const proof of ['PROOF:\nNOT CHECKED: see lib/x.mjs', 'PROOF: none\nNOT CHECKED: lib/x.mjs:4', 'PROOF: None.\n']) {
    const r = checkReturn(`OUTCOME: done\n${proof}\nTASK: 9-1-0001\nSTATUS: DONE\n`);
    assert.deepEqual(r.missing, ['evidence'], proof);
  }
});

test('DONE with a blank EVIDENCE line is missing evidence', () => {
  const text = 'TASK: 9-1-0001\nSTATUS: DONE\nEVIDENCE:\nNOT VERIFIED: nothing\n';
  const r = checkReturn(text);
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing, ['evidence']);
});

test('PARTIAL with no evidence is not flagged for evidence', () => {
  const text = 'TASK: 9-1-0001\nSTATUS: PARTIAL\nNOT VERIFIED: the gate\n';
  const r = checkReturn(text);
  assert.equal(r.ok, true);
  assert.deepEqual(r.missing, []);
});

test('BLOCKED with no evidence is not flagged for evidence', () => {
  const text = 'TASK: 9-1-0001\nSTATUS: BLOCKED\nQUESTIONS: which file owns this\n';
  const r = checkReturn(text);
  assert.equal(r.ok, true);
  assert.deepEqual(r.missing, []);
});

test('missing TASK is reported', () => {
  const r = checkReturn('STATUS: DONE\nEVIDENCE: node --test x.test.mjs\n');
  assert.ok(r.missing.includes('task'));
});

test('missing STATUS is reported', () => {
  const r = checkReturn('TASK: 9-1-0001\nEVIDENCE: node --test x.test.mjs\n');
  assert.ok(r.missing.includes('status'));
});

test('an EVIDENCE section stops at the next field label, not the whole return', () => {
  const text = 'TASK: 9-1-0001\nSTATUS: DONE\nEVIDENCE: nothing useful here\nNOT VERIFIED: node --test x.test.mjs would have been evidence but is in the wrong section\n';
  const r = checkReturn(text);
  assert.equal(r.evidence, false);
});

test('malformed and empty returns never throw', () => {
  assert.doesNotThrow(() => checkReturn(''));
  assert.doesNotThrow(() => checkReturn(undefined));
  assert.doesNotThrow(() => checkReturn(null));
  assert.doesNotThrow(() => checkReturn(12345));
  assert.doesNotThrow(() => checkReturn('garbage\nwith\nno fields at all'));
  assert.equal(checkReturn(null).ok, false);
});

test('schema field names are read from the shipped schema, not hardcoded twice', () => {
  const { top, checks } = schemaFieldNames();
  // packet.md's return: TASK, STATUS, CHANGED, EVIDENCE, NOT VERIFIED,
  // QUESTIONS, SUGGEST. The codex schema names the same facts as: status,
  // changed, checks[].evidence, remaining, notes, suggestion.
  assert.ok(top.includes('status'));
  assert.ok(top.includes('changed'));
  assert.ok(top.includes('remaining'));
  assert.ok(top.includes('notes'));
  assert.ok(top.includes('suggestion'));
  assert.ok(checks.includes('evidence'));
});
