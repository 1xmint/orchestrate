// context-scan.test.mjs — transcript text in, a reading out: the input-side
// sum, the compaction boundary, the incremental line handling, and a full
// readContext over a transcript fixture with and without a boundary.
//   node --test skills/orchestrate/scripts/lib/context-scan.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  inputSide, isBoundary, scanSlice, stepEditCounter, toReading, readContext,
  statusCapacity, writeStatusCapacity,
} from './context-scan.mjs';
import { loadPolicy } from './policy.mjs';

const policy = () => loadPolicy(null);
const assistantLine = (usage, id = 'r1') => JSON.stringify({ type: 'assistant', message: { id, model: 'claude-sonnet-4-5', usage } }) + '\n';
const boundaryLine = (pre, post, uuid = 'b1') => JSON.stringify({ type: 'system', subtype: 'compact_boundary', uuid, timestamp: new Date().toISOString(), compactMetadata: { preTokens: pre, postTokens: post } }) + '\n';

// ---- inputSide / isBoundary ---------------------------------------------------

test('inputSide sums the three input-token fields', () => {
  assert.equal(inputSide({ input_tokens: 10, cache_read_input_tokens: 5, cache_creation_input_tokens: 2 }), 17);
});

test('inputSide is null when usage carries none of the three fields, not zero', () => {
  assert.equal(inputSide({ output_tokens: 40 }), null);
  assert.equal(inputSide(null), null);
});

test('isBoundary recognizes only a system compact_boundary record', () => {
  assert.equal(isBoundary({ type: 'system', subtype: 'compact_boundary' }), true);
  assert.equal(isBoundary({ type: 'system', subtype: 'other' }), false);
  assert.equal(isBoundary(null), false);
});

// ---- scanSlice ------------------------------------------------------------------

test('scanSlice counts one response per distinct message id and sums its input side', () => {
  const text = assistantLine({ input_tokens: 100 }, 'r1') + assistantLine({ input_tokens: 200 }, 'r1');
  const scan = scanSlice(text);
  assert.equal(scan.responses, 1, 'a streamed duplicate of the same id counts once');
  assert.equal(scan.usage.tokens, 200, 'the last-seen usage for that id wins');
});

test('scanSlice resets usage and the response count at a compaction boundary', () => {
  const text = assistantLine({ input_tokens: 100 }) + boundaryLine(500, 20) + assistantLine({ input_tokens: 30 }, 'r2');
  const scan = scanSlice(text);
  assert.equal(scan.sawBoundary, true);
  assert.equal(scan.compaction.preTokens, 500);
  assert.equal(scan.usage.tokens, 30, 'only the response after the boundary counts');
  assert.equal(scan.responses, 1);
});

test('scanSlice skips a helper\'s sidechain records when reading the lead\'s own context', () => {
  const text = JSON.stringify({ type: 'assistant', isSidechain: true, message: { id: 'x', usage: { input_tokens: 999 } } }) + '\n';
  assert.equal(scanSlice(text, { lead: true }).usage, null);
  assert.equal(scanSlice(text, { lead: false }).usage.tokens, 999, 'a helper reading its own transcript is not filtered');
});

test('scanSlice leaves a trailing line with no newline unconsumed, for the next incremental read', () => {
  const complete = assistantLine({ input_tokens: 10 });
  const scan = scanSlice(complete + '{"type":"assistant","message":');
  assert.equal(scan.consumed, Buffer.byteLength(complete, 'utf8'), 'the partial trailing line is not counted as consumed');
});

// ---- stepEditCounter ------------------------------------------------------------

test('stepEditCounter resets to 0 on an edit tool and otherwise counts up', () => {
  assert.equal(stepEditCounter(3, ['Read', 'Grep']), 5);
  assert.equal(stepEditCounter(3, ['Read', 'Edit', 'Grep']), 1, 'Edit resets, then Grep adds one');
});

test('stepEditCounter treats a non-finite starting count as 0', () => {
  assert.equal(stepEditCounter(NaN, ['Read']), 1);
});

// ---- toReading ------------------------------------------------------------------

test('toReading reports "measured" from fresh usage and "provisional" from a compaction alone', () => {
  const measured = toReading({ compaction: null, usage: { tokens: 1000, at: new Date().toISOString(), responseId: 'r1' }, responses: 1, sawBoundary: false, host: null });
  assert.equal(measured.state, 'measured');
  const provisional = toReading({ compaction: { at: new Date().toISOString(), postTokens: 300 }, usage: null, responses: 0, sawBoundary: true, host: null });
  assert.equal(provisional.state, 'provisional');
  assert.equal(provisional.tokens, 300);
});

test('toReading marks a stale measurement as unknown rather than measured', () => {
  const old = new Date(Date.now() - 24 * 3600000).toISOString();
  const r = toReading({ compaction: null, usage: { tokens: 1000, at: old }, responses: 1, sawBoundary: false, host: null }, { staleMs: 3600000 });
  assert.equal(r.state, 'unknown');
  assert.equal(r.stale, true);
});

test('toReading computes the percentage of a known capacity', () => {
  const r = toReading({ compaction: null, usage: { tokens: 50000, at: new Date().toISOString() }, responses: 1, sawBoundary: false, host: null }, { capacity: 200000 });
  assert.equal(r.pct, 25);
});

// ---- readContext over a transcript fixture --------------------------------------

function fixture(lines) {
  const p = join(mkdtempSync(join(tmpdir(), 'orch-scan-')), 'session.jsonl');
  writeFileSync(p, lines.join(''));
  return p;
}

test('readContext without a compaction boundary measures the last response and has no compaction', () => {
  const p = fixture([assistantLine({ input_tokens: 4000 }, 'a'), assistantLine({ input_tokens: 8000, cache_read_input_tokens: 2000 }, 'b')]);
  const r = readContext(p, { session: 's1', capacity: null, policy: policy() });
  assert.equal(r.state, 'measured');
  assert.equal(r.tokens, 10000);
  assert.equal(r.compaction, null);
  assert.equal(r.responsesSinceCompaction, 2);
});

test('readContext with a compaction boundary reads only the responses after it', () => {
  const p = fixture([assistantLine({ input_tokens: 311000 }, 'a'), boundaryLine(311000, 17000, 'b-uuid'), assistantLine({ input_tokens: 19000 }, 'b')]);
  const r = readContext(p, { session: 's1', capacity: null, policy: policy() });
  assert.equal(r.state, 'measured');
  assert.equal(r.tokens, 19000, 'the pre-compaction 311k is not reported');
  assert.equal(r.compaction.postTokens, 17000);
  assert.equal(r.responsesSinceCompaction, 1);
});

test('readContext right after a boundary, with no response since, is provisional at the boundary figure', () => {
  const p = fixture([assistantLine({ input_tokens: 311000 }, 'a'), boundaryLine(311000, 17000)]);
  const r = readContext(p, { session: 's1', capacity: null, policy: policy() });
  assert.equal(r.state, 'provisional');
  assert.equal(r.tokens, 17000);
});

test('readContext on a missing file is unknown, and never throws', () => {
  const r = readContext(join(tmpdir(), 'orch-scan-does-not-exist.jsonl'), { capacity: null, policy: policy() });
  assert.equal(r.state, 'unknown');
  assert.equal(r.size, 0);
});

// ---- status-line capacity ---------------------------------------------------------

test('writeStatusCapacity and statusCapacity round-trip in a temp dir, and a stale record is ignored', () => {
  const dir = mkdtempSync(join(tmpdir(), 'orch-scan-status-'));
  assert.equal(writeStatusCapacity('s1', 200000, { dir, now: 1000 }), true);
  assert.equal(statusCapacity('s1', { dir, now: 2000 }), 200000);
  assert.equal(statusCapacity('s1', { dir, now: 1000 + 60000, staleMs: 1000 }), null);
  assert.equal(statusCapacity('other', { dir }), null);
  assert.equal(writeStatusCapacity('s1', 0, { dir }), false, 'a zero size is not written');
});

import { advisorSteps, advisorTotals } from './context-scan.mjs';

const REAL_ADVISOR_USAGE = {
  iterations: [
    { type: 'message', cache_read_input_tokens: 101674 },
    { type: 'advisor_message', model: 'claude-opus-5-5', input_tokens: 108419, output_tokens: 14312 },
    { type: 'message', cache_read_input_tokens: 103443, cache_creation_input_tokens: 2239 },
  ],
};

test('advisorSteps reads only the advisor steps of a real record, with absent fields as zero', () => {
  assert.deepEqual(advisorSteps(REAL_ADVISOR_USAGE), [
    { model: 'claude-opus-5-5', input: 108419, output: 14312, cacheRead: 0, cacheWrite: 0 },
  ]);
});

test('advisorSteps is empty without iterations, and advisorTotals groups by model', () => {
  assert.deepEqual(advisorSteps({ input_tokens: 5, output_tokens: 1 }), []);
  assert.deepEqual(advisorSteps(null), []);
  const t = advisorTotals([REAL_ADVISOR_USAGE, REAL_ADVISOR_USAGE]);
  assert.equal(t.length, 1);
  assert.equal(t[0].calls, 2);
  assert.equal(t[0].input, 216838);
});

// ---- shell edits reset the counter ---------------------------------------------------

const toolLine = (name, input, id) => JSON.stringify({ type: 'assistant', message: { id, model: 'claude-sonnet-5', content: [{ type: 'tool_use', id: `tu-${id}`, name, input }] } }) + '\n';

test('a shell write resets the tool-calls-since-edit counter; a read-only shell command does not', () => {
  const text = toolLine('Read', { file_path: 'a' }, 1) + toolLine('Bash', { command: "sed -i 's/a/b/' src/x.ts" }, 2) + toolLine('Bash', { command: 'grep -rn payment src' }, 3) + toolLine('Read', {}, 4);
  assert.equal(stepEditCounter(0, scanSlice(text).toolUses), 2, 'the sed resets it, then grep and Read add two');
  const readOnly = toolLine('Read', {}, 1) + toolLine('Bash', { command: 'grep -rn payment src' }, 2) + toolLine('Bash', { command: 'git status' }, 3);
  assert.equal(stepEditCounter(0, scanSlice(readOnly).toolUses), 3);
});

test('stepEditCounter still takes plain tool names', () => {
  assert.equal(stepEditCounter(4, ['Bash', 'Edit', 'Read']), 1);
});
