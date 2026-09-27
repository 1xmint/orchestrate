// context.test.mjs — the one reader of "how big is this conversation right
// now": the pure scan/reading pipeline, the advice it produces, and one
// file-backed round trip through sampleContext.
//   node --test skills/orchestrate/scripts/lib/context.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  inputSide, isBoundary, scanSlice, stepEditCounter, toReading, thresholds,
  adviseContext, contextEpoch, sampleContext, readContext, storedContext,
} from './context.mjs';
import { loadPolicy } from './policy.mjs';

const policy = () => loadPolicy(null);

// ---- inputSide ----------------------------------------------------------------

test('inputSide sums the three input-token fields', () => {
  assert.equal(inputSide({ input_tokens: 10, cache_read_input_tokens: 5, cache_creation_input_tokens: 2 }), 17);
});

test('inputSide is null when usage carries none of the three fields, not zero', () => {
  assert.equal(inputSide({ output_tokens: 40 }), null);
  assert.equal(inputSide(null), null);
});

// ---- isBoundary -----------------------------------------------------------------

test('isBoundary recognizes only a system compact_boundary record', () => {
  assert.equal(isBoundary({ type: 'system', subtype: 'compact_boundary' }), true);
  assert.equal(isBoundary({ type: 'system', subtype: 'other' }), false);
  assert.equal(isBoundary(null), false);
});

// ---- scanSlice ------------------------------------------------------------------

const assistantLine = (usage, id = 'r1') => JSON.stringify({ type: 'assistant', message: { id, model: 'claude-sonnet-4-5', usage } }) + '\n';

test('scanSlice counts one response per distinct message id and sums its input side', () => {
  const text = assistantLine({ input_tokens: 100 }, 'r1') + assistantLine({ input_tokens: 200 }, 'r1');
  const scan = scanSlice(text);
  assert.equal(scan.responses, 1, 'a streamed duplicate of the same id counts once');
  assert.equal(scan.usage.tokens, 200, 'the last-seen usage for that id wins');
});

test('scanSlice resets usage and the response count at a compaction boundary', () => {
  const text = assistantLine({ input_tokens: 100 }) + JSON.stringify({ type: 'system', subtype: 'compact_boundary', compactMetadata: { preTokens: 500, postTokens: 20 } }) + '\n' + assistantLine({ input_tokens: 30 }, 'r2');
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
  const partial = '{"type":"assistant","message":';
  const scan = scanSlice(complete + partial);
  assert.equal(scan.consumed, Buffer.byteLength(complete, 'utf8'), 'the partial trailing line is not counted as consumed');
});

// ---- stepEditCounter --------------------------------------------------------------

test('stepEditCounter resets to 0 on an edit tool and otherwise counts up', () => {
  assert.equal(stepEditCounter(3, ['Read', 'Grep']), 5);
  assert.equal(stepEditCounter(3, ['Read', 'Edit', 'Grep']), 1, 'Edit resets, then Grep adds one');
});

test('stepEditCounter treats a non-finite starting count as 0', () => {
  assert.equal(stepEditCounter(NaN, ['Read']), 1);
});

// ---- toReading / thresholds / adviseContext -------------------------------------

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

test('thresholds caps compactAt to a fraction of a known capacity, and derives checkpointAt from it', () => {
  const p = { context: { compactAt: 150000, checkpointAt: 120000, windowFraction: 0.5 } };
  const t = thresholds({ capacity: 100000 }, p);
  assert.equal(t.compactAt, 50000, 'min(150000, 100000*0.5)');
  assert.equal(t.checkpointAt, 40000, 'min(120000, compactAt*0.8)');
});

test('adviseContext is "unknown" with no measurement, "compact" at or above the line, else "none"', () => {
  assert.equal(adviseContext(null, policy()).action, 'unknown');
  const big = toReading({ compaction: null, usage: { tokens: 999999, at: new Date().toISOString() }, responses: 5, sawBoundary: false, host: null });
  assert.equal(adviseContext(big, policy()).action, 'compact');
  const small = toReading({ compaction: null, usage: { tokens: 1000, at: new Date().toISOString() }, responses: 5, sawBoundary: false, host: null });
  assert.equal(adviseContext(small, policy()).action, 'none');
});

test('adviseContext flags "investigate" when a provisional reading is already at the compact line', () => {
  const r = toReading({ compaction: { at: new Date().toISOString(), postTokens: 999999 }, usage: null, responses: 0, sawBoundary: true, host: null });
  assert.equal(adviseContext(r, policy()).action, 'investigate');
});

test('contextEpoch is "none" before any compaction and the boundary uuid after one', () => {
  assert.equal(contextEpoch(null), 'none');
  assert.equal(contextEpoch({ compaction: { uuid: 'abc' } }), 'abc');
});

// ---- file-backed: readContext and sampleContext ---------------------------------

function makeTranscript(dir, lines) {
  const p = join(dir, 'session.jsonl');
  writeFileSync(p, lines.join(''));
  return p;
}

test('readContext on a freshly written transcript measures the last response', () => {
  const dir = mkdtempSync(join(tmpdir(), 'orch-ctx-'));
  const p = makeTranscript(dir, [assistantLine({ input_tokens: 4000 }, 'a'), assistantLine({ input_tokens: 8000 }, 'b')]);
  const r = readContext(p, { session: 's1', policy: policy() });
  assert.equal(r.state, 'measured');
  assert.equal(r.tokens, 8000);
});

test('sampleContext reads incrementally: a second sample only scans the bytes appended since the first', () => {
  const home = mkdtempSync(join(tmpdir(), 'orch-ctx-home-'));
  const ctxDir = join(home, 'context');
  mkdirSync(ctxDir, { recursive: true });
  const tdir = mkdtempSync(join(tmpdir(), 'orch-ctx-'));
  const p = makeTranscript(tdir, [assistantLine({ input_tokens: 1000 }, 'a')]);
  const first = sampleContext({ transcriptPath: p, session: 's1', policy: policy(), dir: ctxDir });
  assert.equal(first.reading.tokens, 1000);
  const stored1 = storedContext('s1', null, ctxDir);
  assert.equal(stored1.tokens, 1000);
  writeFileSync(p, [assistantLine({ input_tokens: 1000 }, 'a'), assistantLine({ input_tokens: 5000 }, 'b')].join(''));
  const second = sampleContext({ transcriptPath: p, session: 's1', policy: policy(), dir: ctxDir });
  assert.equal(second.reading.tokens, 5000);
});
