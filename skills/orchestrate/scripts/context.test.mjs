// context.test.mjs — the shared context reader against the transcript shapes
// that broke the old one: a compaction that keeps the file, retained history
// with a large pre-compaction reading, null usage, a restored context that is
// still large, streaming duplicates, a half-written line, and two sessions at
// once. Fixtures are built here from the record shapes Claude Code writes
// (type/subtype/compactMetadata, message.id/usage, isSidechain), with no real
// transcript content.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, appendFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  readContext, sampleContext, adviseContext, contextNotice, scanSlice, inputSide, thresholds,
  storedContext, markAnnounced, agentTranscriptPath, formatReading, writeStatusCapacity, statusCapacity, checkpointPath,
} from './lib/context.mjs';
import { loadPolicy, setPolicyValue } from './lib/policy.mjs';
import { persistDecision } from './persist-check.mjs';
import { buildReport } from './context.mjs';

const T0 = Date.parse('2026-09-14T10:00:00Z');
const iso = min => new Date(T0 + min * 60000).toISOString();
const NOW = T0 + 120 * 60000;
const policy = loadPolicy({});

let n = 0;
const assistant = (tokens, { min = 0, id = `msg_${++n}`, model = 'claude-opus-5', sidechain = false, usage } = {}) => JSON.stringify({
  type: 'assistant', timestamp: iso(min), isSidechain: sidechain, version: '2.1.270', entrypoint: 'claude-desktop',
  message: { id, model, role: 'assistant', content: [{ type: 'text', text: 'x' }], usage: usage !== undefined ? usage : { input_tokens: 2, cache_read_input_tokens: tokens - 1002, cache_creation_input_tokens: 1000, output_tokens: 50 } },
});
const user = (text, min = 0) => JSON.stringify({ type: 'user', timestamp: iso(min), message: { role: 'user', content: text } });
const boundary = (pre, post, min = 0, uuid = `b${++n}`) => JSON.stringify({ type: 'system', subtype: 'compact_boundary', uuid, timestamp: iso(min), content: 'Conversation compacted', compactMetadata: { trigger: 'auto', preTokens: pre, postTokens: post } });
const summary = min => JSON.stringify({ type: 'user', isCompactSummary: true, timestamp: iso(min), message: { role: 'user', content: 'This session is being continued from a previous conversation. '.repeat(40) } });

function file(lines) {
  const dir = mkdtempSync(join(tmpdir(), 'orch-ctx-'));
  const p = join(dir, 'sess-1.jsonl');
  writeFileSync(p, lines.join('\n') + '\n');
  return { dir, p, store: join(dir, 'store') };
}

test('inputSide: uncached input plus cache reads and writes; all-null usage is not zero', () => {
  assert.equal(inputSide({ input_tokens: 3, cache_read_input_tokens: 150000, cache_creation_input_tokens: 2000, output_tokens: 900 }), 152003, 'output is never context');
  assert.equal(inputSide({ input_tokens: null, cache_read_input_tokens: null, cache_creation_input_tokens: null }), null);
  assert.equal(inputSide(null), null);
  assert.equal(inputSide({ input_tokens: 12 }), 12);
});

test('a compaction boundary ends the scan: an old 311k reading never survives a 17k summary', () => {
  const { p } = file([user('go', 0), assistant(250000, { min: 1 }), assistant(311000, { min: 2 }), boundary(311000, 17000, 3), summary(3)]);
  const r = readContext(p, { now: NOW, policy, capacity: null });
  assert.equal(r.state, 'provisional');
  assert.equal(r.tokens, 17000);
  assert.equal(r.source, 'compact-boundary');
  assert.equal(r.compaction.preTokens, 311000);
  const a = adviseContext(r, policy);
  assert.equal(a.action, 'none', 'nothing to say until a response measures it');
  assert.equal(contextNotice(r, a), '');
});

test('retained history: after compaction the first new response is the measurement', () => {
  const { p } = file([assistant(311000, { min: 1 }), boundary(311000, 17000, 2), summary(2), user('continue', 3), assistant(21000, { min: 4 })]);
  const r = readContext(p, { now: NOW, policy, capacity: null });
  assert.equal(r.state, 'measured');
  assert.equal(r.tokens, 21000);
  assert.equal(r.responsesSinceCompaction, 1);
  assert.equal(adviseContext(r, policy).action, 'none');
});

test('missing or null usage stays unknown, never 0%', () => {
  const { p } = file([user('hi', 0), assistant(0, { min: 1, usage: null }), assistant(0, { min: 2, usage: { input_tokens: null } })]);
  const r = readContext(p, { now: NOW, policy, capacity: 200000 });
  assert.equal(r.state, 'unknown');
  assert.equal(r.tokens, null);
  assert.equal(r.pct, null);
  assert.equal(adviseContext(r, policy).action, 'unknown');
  assert.match(formatReading(r, adviseContext(r, policy), { now: NOW }), /context: unknown/);
});

test('synthetic limit messages and helper sidechain records are not the lead\'s context', () => {
  const { p } = file([
    assistant(90000, { min: 1 }),
    assistant(683000, { min: 2, sidechain: true }),
    JSON.stringify({ type: 'assistant', timestamp: iso(3), message: { model: '<synthetic>', usage: { input_tokens: 0 }, content: [{ type: 'text', text: "You've hit your limit" }] } }),
  ]);
  assert.equal(readContext(p, { now: NOW, policy, capacity: null }).tokens, 90000);
});

test('a stale measurement is not current', () => {
  const { p } = file([assistant(180000, { min: 1 })]);
  const r = readContext(p, { now: T0 + 13 * 3600 * 1000, policy, capacity: null });
  assert.equal(r.state, 'unknown');
  assert.equal(r.stale, true);
  assert.equal(r.lastTokens, 180000);
  assert.equal(adviseContext(r, policy).action, 'unknown');
});

test('thresholds: checkpoint at 120k, compact at 150k, or 75% of a known smaller window', () => {
  const at = (tokens, capacity = null) => adviseContext({ state: 'measured', tokens, capacity, compaction: null, responsesSinceCompaction: null }, policy).action;
  assert.equal(at(119000), 'none');
  assert.equal(at(120000), 'checkpoint');
  assert.equal(at(150000), 'compact');
  assert.deepEqual(thresholds({ capacity: 160000 }, policy), { checkpointAt: 96000, compactAt: 120000 });
  assert.equal(at(121000, 160000), 'compact', 'a small known window moves compaction earlier');
  assert.equal(at(121000, 1000000), 'checkpoint', 'a large window does not move it later');
  const custom = loadPolicy(setPolicyValue({}, 'context.compactAt', '200000'));
  assert.equal(adviseContext({ state: 'measured', tokens: 160000, capacity: null, compaction: null }, custom).action, 'checkpoint');
  assert.throws(() => setPolicyValue({}, 'context.nope', '1'), /unknown policy key/);
});

test('hard context advice is once per compaction epoch and says not to start work', () => {
  const reading = { state: 'measured', tokens: 300000, capacity: null, compaction: { uuid: 'epoch-1' }, responsesSinceCompaction: 4 };
  const advice = adviseContext(reading, policy);
  assert.equal(advice.action, 'hard');
  assert.match(contextNotice(reading, advice), /Do not start new work here/);
  assert.match(checkpointPath('s', reading), /checkpoint-epoch-1\.md$/);
});

test('still large right after compaction: investigate, do not recommend compacting again', () => {
  const { p } = file([assistant(900000, { min: 1 }), boundary(900000, 160000, 2), summary(2), assistant(171000, { min: 3 })]);
  const r = readContext(p, { now: NOW, policy, capacity: null });
  const a = adviseContext(r, policy);
  assert.equal(a.action, 'investigate');
  const text = contextNotice(r, a);
  assert.match(text, /Compacting again will not help/);
  assert.match(text, /CLAUDE\.md|plugin|MCP/);
  // A boundary whose own summary is huge says so before any response.
  const { p: p2 } = file([boundary(900000, 170000, 2)]);
  assert.equal(adviseContext(readContext(p2, { now: NOW, policy, capacity: null }), policy).action, 'investigate');
  // Several responses later it is ordinary growth again.
  const { p: p3 } = file([boundary(900000, 30000, 1), assistant(40000, { min: 2 }), assistant(80000, { min: 3 }), assistant(120000, { min: 4 }), assistant(155000, { min: 5 })]);
  assert.equal(adviseContext(readContext(p3, { now: NOW, policy, capacity: null }), policy).action, 'compact');
});

test('streaming duplicates count as one response; a half-written last line is left for the next read', () => {
  const rec = assistant(50000, { min: 1, id: 'msg_dup' });
  const partial = assistant(52000, { min: 2, id: 'msg_next' }).slice(0, 40);
  const s = scanSlice([boundary(100, 10, 0), rec, rec, rec].join('\n') + '\n' + partial);
  assert.equal(s.responses, 1);
  assert.equal(s.usage.tokens, 50000);
  const whole = Buffer.byteLength([boundary(100, 10, 0), rec, rec, rec].join('\n') + '\n');
  assert.equal(s.consumed, whole, 'the partial line is not consumed');
});

test('incremental sampling reads only new bytes, resets advice on compaction, and speaks only on change', () => {
  const { p, store } = file([user('start', 0), assistant(100000, { min: 1 })]);
  const s1 = sampleContext({ transcriptPath: p, session: 'sess-1', policy, now: NOW, dir: store });
  assert.equal(s1.reading.tokens, 100000);
  assert.match(s1.notice, /~100k tokens per step, measured. Nothing to do until ~120k/, 'below the thresholds the lead still hears the measured size');
  assert.equal(sampleContext({ transcriptPath: p, session: 'sess-1', policy, now: NOW, dir: store, force: true }).notice, '', 'once per 25k step');

  appendFileSync(p, `${user('x'.repeat(5000), 2)}\n${assistant(125000, { min: 3 })}\n`);
  const s2 = sampleContext({ transcriptPath: p, session: 'sess-1', policy, now: NOW, dir: store });
  assert.equal(s2.advice.action, 'checkpoint');
  assert.match(s2.notice, /Prepare a checkpoint/);

  appendFileSync(p, `${user('y'.repeat(5000), 4)}\n${assistant(128000, { min: 5 })}\n`);
  const s3 = sampleContext({ transcriptPath: p, session: 'sess-1', policy, now: NOW, dir: store });
  assert.equal(s3.reading.tokens, 128000);
  assert.equal(s3.notice, '', 'the same advice is not repeated');

  appendFileSync(p, `${user('z'.repeat(5000), 6)}\n${assistant(160000, { min: 7 })}\n`);
  const s4 = sampleContext({ transcriptPath: p, session: 'sess-1', policy, now: NOW, dir: store });
  assert.equal(s4.advice.action, 'compact');
  assert.match(s4.notice, /save the checkpoint .*recommend compacting if this same task continues/);
  assert.equal(s4.reading.compactions, 0);

  // Compaction keeps the file; the reading and the announced advice start over.
  appendFileSync(p, `${boundary(160000, 17000, 8)}\n${summary(8)}\n`);
  const s5 = sampleContext({ transcriptPath: p, session: 'sess-1', policy, now: NOW, dir: store });
  assert.equal(s5.reading.state, 'provisional');
  assert.equal(s5.reading.compactions, 1, 'a new epoch is one more compaction');
  assert.match(s5.notice, /~17k tokens per step, measured from the compaction summary · compacted 1 time this session/);
  appendFileSync(p, `${user('w'.repeat(5000), 9)}\n${assistant(22000, { min: 10 })}\n`);
  const s6 = sampleContext({ transcriptPath: p, session: 'sess-1', policy, now: NOW, dir: store });
  assert.equal(s6.reading.tokens, 22000);
  assert.equal(s6.advice.action, 'none');

  // Growing again after compaction: checkpoint advice is said again, in the new epoch.
  appendFileSync(p, `${user('v'.repeat(5000), 11)}\n${assistant(40000, { min: 12 })}\n${assistant(60000, { min: 13 })}\n${assistant(80000, { min: 14 })}\n${assistant(130000, { min: 15 })}\n`);
  const s7 = sampleContext({ transcriptPath: p, session: 'sess-1', policy, now: NOW, dir: store });
  assert.equal(s7.advice.action, 'checkpoint');
  assert.match(s7.notice, /Prepare a checkpoint/);

  // No growth: nothing is read, and the reading stands. A half-written line
  // is not consumed and does not disturb it.
  const s8 = sampleContext({ transcriptPath: p, session: 'sess-1', policy, now: NOW, dir: store });
  assert.equal(s8.reading.tokens, 130000);
  appendFileSync(p, assistant(135000, { min: 16 }).slice(0, 60));
  assert.equal(sampleContext({ transcriptPath: p, session: 'sess-1', policy, now: NOW, dir: store }).reading.tokens, 130000);
  appendFileSync(p, assistant(135000, { min: 16 }).slice(60) + '\n');
  // The completed line is read whole from where the last complete line ended.
  const s9 = sampleContext({ transcriptPath: p, session: 'sess-1', policy, now: NOW, dir: store });
  assert.equal(s9.reading.tokens, 135000);
});

test('an unannounced sample is said later; markAnnounced records delivery', () => {
  const { p, store } = file([assistant(125000, { min: 1 })]);
  const quiet = sampleContext({ transcriptPath: p, session: 's', policy, now: NOW, dir: store, announce: false });
  assert.match(quiet.notice, /checkpoint/);
  const again = sampleContext({ transcriptPath: p, session: 's', policy, now: NOW, dir: store, force: true });
  assert.match(again.notice, /checkpoint/, 'not marked as said, so it is said');
  const third = sampleContext({ transcriptPath: p, session: 's', policy, now: NOW, dir: store, force: true });
  assert.equal(third.notice, '');
  markAnnounced('s', null, null, store);
  assert.match(sampleContext({ transcriptPath: p, session: 's', policy, now: NOW, dir: store, force: true }).notice, /checkpoint/);
});

test('concurrent sessions and agents keep separate readings', () => {
  const a = file([assistant(140000, { min: 1 })]);
  const b = file([assistant(20000, { min: 1 })]);
  const store = join(a.dir, 'shared-store');
  sampleContext({ transcriptPath: a.p, session: 'A', policy, now: NOW, dir: store });
  sampleContext({ transcriptPath: b.p, session: 'B', policy, now: NOW, dir: store });
  const helper = join(a.dir, 'sess-1', 'subagents');
  mkdirSync(helper, { recursive: true });
  writeFileSync(join(helper, 'agent-abc.jsonl'), assistant(683000, { min: 1, sidechain: true }) + '\n');
  assert.equal(agentTranscriptPath(a.p, 'abc'), join(helper, 'agent-abc.jsonl'));
  sampleContext({ transcriptPath: agentTranscriptPath(a.p, 'abc'), session: 'A', agent: 'abc', policy, now: NOW, dir: store, announce: false });
  assert.equal(storedContext('A', null, store).tokens, 140000);
  assert.equal(storedContext('B', null, store).tokens, 20000);
  assert.equal(storedContext('A', 'abc', store).tokens, 683000, 'a helper\'s own transcript counts its sidechain records');
});

test('window size from the status line is per session and optional', () => {
  const dir = mkdtempSync(join(tmpdir(), 'orch-cap-'));
  assert.equal(statusCapacity('s1', { dir }), null);
  writeStatusCapacity('s1', 200000, { dir, now: NOW });
  assert.equal(statusCapacity('s1', { dir, now: NOW }), 200000);
  assert.equal(statusCapacity('s2', { dir, now: NOW }), null, 'another session\'s window is not this one\'s');
});

test('the continuation hook no longer warns on transcript size', () => {
  const scan = { progressed: true, denied: false, errors: [], asked: false, goalMet: false, tools: 1 };
  const d = persistDecision({ scan, goal: 'g', transcriptSize: 13_000_000 });
  assert.equal(d.kind, 'continue');
  assert.doesNotMatch(d.why, /long|Cost|re-reads a lot/);
});

test('the report: readable and JSON, with freshness and the recommended action', () => {
  const { p } = file([assistant(311000, { min: 1 }), boundary(311000, 17000, 2), summary(2)]);
  const r = buildReport({ transcript: p, now: NOW, policy });
  assert.equal(r.reading.state, 'provisional');
  assert.equal(r.advice.action, 'none');
  const text = formatReading(r.reading, r.advice, { now: NOW });
  assert.match(text, /context: 17k — provisional/);
  assert.match(text, /from the compaction record only/);
  assert.match(text, /311k → 17k/);
  assert.match(text, /host: claude-desktop 2\.1\.270 \(from this transcript\)/);
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(r)));
});

test('host capabilities come from the running host\'s transcript, not the terminal CLI', async () => {
  const { hostCapabilities, compareVersions } = await import('./lib/host.mjs');
  assert.equal(compareVersions('2.1.270', '2.1.209'), 1);
  assert.equal(compareVersions('2.1.196', '2.1.196'), 0);
  const { p } = file([assistant(20000, { min: 1 })]);
  const h = hostCapabilities({ env: { CLAUDE_CODE_ENTRYPOINT: 'cli' }, transcriptPath: p, quotaPath: join(tmpdir(), 'no-quota-here.json') });
  assert.equal(h.engine, '2.1.270');
  assert.equal(h.entrypoint, 'claude-desktop', 'the transcript\'s own record beats the environment');
  assert.equal(h.hookScratchpadDir, true);
  const none = hostCapabilities({ env: {}, transcriptPath: join(tmpdir(), 'missing.jsonl'), quotaPath: join(tmpdir(), 'no-quota-here.json') });
  assert.equal(none.engine, null);
  assert.equal(none.hookPromptId, null, 'unknown engine, unknown capability');
});

// A sanitized replay of the observed long session: a lead that ran to ~1M,
// auto-compacted twice, and kept a 13 MB transcript. The byte warning fired on
// every step after the first compaction; the reader says nothing until usage
// is measured again, then gives ordinary advice.
test('replay: long session with two compactions and a large retained transcript', () => {
  const lines = [];
  let min = 0;
  const filler = 'r'.repeat(20000);
  for (let t = 20000; t <= 990000; t += 10000) { lines.push(user(filler, min++)); lines.push(assistant(t, { min: min++ })); }
  lines.push(boundary(999306, 26039, min++));
  lines.push(summary(min++));
  for (let t = 30000; t <= 990000; t += 15000) { lines.push(user(filler, min++)); lines.push(assistant(t, { min: min++ })); }
  lines.push(boundary(999031, 29275, min++));
  lines.push(summary(min++));
  const { p } = file(lines);
  const size = readFileSync(p).length;
  assert.ok(size > 2_500_000, 'a transcript far past the old 1.5 MB line');
  const now = T0 + (min + 1) * 60000;
  const r = readContext(p, { now, policy, capacity: null });
  assert.equal(r.state, 'provisional');
  assert.equal(r.tokens, 29275);
  assert.equal(adviseContext(r, policy).action, 'none');
  appendFileSync(p, `${assistant(41000, { min: min + 1 })}\n`);
  const r2 = readContext(p, { now: now + 120000, policy, capacity: null });
  assert.equal(r2.tokens, 41000);
  assert.equal(adviseContext(r2, policy).action, 'none');
});

test('compact by default; a fresh conversation only after repeated compactions', () => {
  const at = (tokens, compactions) => {
    const r = { state: 'measured', tokens, capacity: null, compaction: compactions ? { uuid: `c${compactions}` } : null, responsesSinceCompaction: 10, compactions };
    const a = adviseContext(r, policy);
    return { a, notice: contextNotice(r, a) };
  };
  assert.equal(policy.context.freshAfterCompactions, 2);
  const once = at(160000, 1);
  assert.equal(once.a.fresh, false);
  assert.match(once.notice, /recommend compacting if this same task continues/);
  const twice = at(160000, 2);
  assert.equal(twice.a.fresh, true);
  assert.match(twice.notice, /recommend a fresh conversation that resumes from the checkpoint: this one has already been compacted 2 times/);
  assert.match(at(310000, 2).notice, /Do not start new work here.*fresh conversation/);
  assert.match(at(310000, 0).notice, /Do not start new work here.*recommend compacting/);
  const stop = persistDecision({ scan: { errors: [] }, contextAdvice: twice.a, contextReading: { tokens: 160000, compactions: 2 } });
  assert.match(stop.why, /fresh conversation that resumes from the checkpoint/);
});

test('the size line can be turned off, and only speaks for a measured size', () => {
  const { p, store } = file([assistant(60000, { min: 1 })]);
  assert.equal(sampleContext({ transcriptPath: p, session: 'q', policy: loadPolicy({ policy: { context: { tickEvery: 0 } } }), now: NOW, dir: store }).notice, '');
  const { p: p2, store: s2 } = file([user('hi', 0)]);
  assert.equal(sampleContext({ transcriptPath: p2, session: 'u', policy, now: NOW, dir: s2 }).notice, '', 'no usage yet: nothing to say');
});
