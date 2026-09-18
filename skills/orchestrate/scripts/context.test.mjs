// context.test.mjs — the shared context reader against the transcript shapes
// that broke the old one: a compaction that keeps the file, retained history
// with a large pre-compaction reading, null usage, a restored context that is
// still large, streaming duplicates, a half-written line, and two sessions at
// once. Fixtures are built here from the record shapes Claude Code writes
// (type/subtype/compactMetadata, message.id/usage, isSidechain), with no real
// transcript content.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, appendFileSync, readFileSync, mkdirSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  readContext, sampleContext, adviseContext, contextNotice, scanSlice, inputSide, thresholds,
  storedContext, markAnnounced, agentTranscriptPath, contextTick, formatReading, writeStatusCapacity, statusCapacity, checkpointPath,
  stepEditCounter,
} from './lib/context.mjs';
import { loadPolicy, setPolicyValue } from './lib/policy.mjs';
import { persistDecision } from './persist-check.mjs';
import { stepWorkCalls, workCallsFact } from './context-check.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
import { buildReport } from './context.mjs';

const T0 = Date.parse('2026-09-14T10:00:00Z');
const iso = min => new Date(T0 + min * 60000).toISOString();
const NOW = T0 + 120 * 60000;
const policy = loadPolicy({});
const kk = v => `~${Math.round(v / 1000)}k`;
// Words that give orders. The size line states facts only.
const ORDERS = /prepare|save the|recommend|do not|nothing to do|before this turn/i;

let n = 0;
const assistant = (tokens, { min = 0, id = `msg_${++n}`, model = 'claude-opus-5', sidechain = false, usage, tools = [] } = {}) => JSON.stringify({
  type: 'assistant', timestamp: iso(min), isSidechain: sidechain, version: '2.1.270', entrypoint: 'claude-desktop',
  message: {
    id, model, role: 'assistant',
    content: [...tools.map((name, i) => ({ type: 'tool_use', id: `${id}_tool${i}`, name, input: {} })), { type: 'text', text: 'x' }],
    usage: usage !== undefined ? usage : { input_tokens: 2, cache_read_input_tokens: tokens - 1002, cache_creation_input_tokens: 1000, output_tokens: 50 },
  },
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

test('the defaults are checkpoint 120k, compact 150k, on purpose', () => {
  assert.deepEqual(thresholds(null, policy), { checkpointAt: 120000, compactAt: 150000 });
});

test('thresholds: checkpoint and compact from policy, or 75% of a known smaller window', () => {
  const { checkpointAt, compactAt } = thresholds(null, policy);
  const at = (tokens, capacity = null) => adviseContext({ state: 'measured', tokens, capacity, compaction: null, responsesSinceCompaction: null }, policy).action;
  assert.equal(at(checkpointAt - 1000), 'none');
  assert.equal(at(checkpointAt), 'checkpoint');
  assert.equal(at(compactAt), 'compact');
  assert.deepEqual(thresholds({ capacity: 160000 }, policy), { checkpointAt: 96000, compactAt: 120000 });
  assert.equal(at(121000, 160000), 'compact', 'a small known window moves compaction earlier');
  assert.equal(at(121000, 1000000), 'checkpoint', 'a large window does not move it later');
  const custom = loadPolicy(setPolicyValue({}, 'context.compactAt', '200000'));
  assert.equal(adviseContext({ state: 'measured', tokens: 160000, capacity: null, compaction: null }, custom).action, 'checkpoint');
  assert.throws(() => setPolicyValue({}, 'context.nope', '1'), /unknown policy key/);
});

test('there is no escalated "hard" tier past compactAt: a conversation far past it still gets the ordinary compact advice', () => {
  const far = Math.max(thresholds(null, policy).compactAt, policy.context.autocompactDefault) + 100000;
  const reading = { state: 'measured', tokens: far, capacity: null, compaction: { uuid: 'epoch-1' }, responsesSinceCompaction: 4 };
  const advice = adviseContext(reading, policy);
  assert.equal(advice.action, 'compact');
  const text = contextNotice(reading, advice, { policy, dir: mkdtempSync(join(tmpdir(), 'ctx-far-')) });
  assert.match(text, new RegExp(`^\\[orchestrate · context\\] ${kk(far)} of ~\\d+k · newest checkpoint: none$`));
  assert.doesNotMatch(text, /next:/, 'both size events are already behind it');
  assert.doesNotMatch(text, ORDERS);
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

test('stepEditCounter: an edit tool resets the count, anything else adds one', () => {
  assert.equal(stepEditCounter(0, []), 0);
  assert.equal(stepEditCounter(0, ['Read', 'Grep', 'Bash']), 3);
  assert.equal(stepEditCounter(3, ['Read', 'Edit', 'Read', 'Read']), 2, 'the edit resets it, then two more reads');
  assert.equal(stepEditCounter(5, ['Write']), 0);
  assert.equal(stepEditCounter(5, ['MultiEdit', 'NotebookEdit', 'Read']), 1);
  assert.equal(stepEditCounter(NaN, ['Read']), 1, 'a missing count starts at 0');
});

test('sampleContext: the tool-calls-since-last-edit count survives across incremental hook calls without double-counting', () => {
  const { p, store } = file([assistant(50000, { min: 0, tools: ['Read', 'Grep'] })]);
  const s1 = sampleContext({ transcriptPath: p, session: 'edit-1', policy, now: NOW, dir: store });
  assert.equal(s1.editCounter, 2);

  // Only the newly appended bytes are read; the running count adds to what
  // was already stored, it does not recount the first response.
  appendFileSync(p, `${assistant(55000, { min: 1, tools: ['Bash'] })}\n`);
  const s2 = sampleContext({ transcriptPath: p, session: 'edit-1', policy, now: NOW, dir: store });
  assert.equal(s2.editCounter, 3, '2 already stored plus 1 more read, not 1 counted twice');

  // No growth at all: the stored count stands, unchanged.
  const s3 = sampleContext({ transcriptPath: p, session: 'edit-1', policy, now: NOW, dir: store });
  assert.equal(s3.editCounter, 3);

  // An edit resets it to 0, then further reads count from there.
  appendFileSync(p, `${assistant(60000, { min: 2, tools: ['Edit'] })}\n`);
  const s4 = sampleContext({ transcriptPath: p, session: 'edit-1', policy, now: NOW, dir: store });
  assert.equal(s4.editCounter, 0);

  appendFileSync(p, `${assistant(65000, { min: 3, tools: ['Read', 'Read'] })}\n`);
  const s5 = sampleContext({ transcriptPath: p, session: 'edit-1', policy, now: NOW, dir: store });
  assert.equal(s5.editCounter, 2);
});

test('incremental sampling reads only new bytes, resets advice on compaction, and speaks only on change', () => {
  const { checkpointAt: cp, compactAt: ca } = thresholds(null, policy);
  const auto = policy.context.autocompactDefault;
  const past = ca + Math.floor((auto - ca) / 2);
  assert.ok(ca < past && past < auto, 'the compact line comes before autocompact');
  const { p, store } = file([user('start', 0), assistant(cp - 20000, { min: 1 })]);
  const s1 = sampleContext({ transcriptPath: p, session: 'sess-1', policy, now: NOW, dir: store });
  assert.equal(s1.reading.tokens, cp - 20000);
  assert.match(s1.notice, new RegExp(`^\\[orchestrate · context\\] ${kk(cp - 20000)} of ~\\d+k · next: compact ${kk(ca)} · newest checkpoint: none · 0 tool calls since your last edit$`), 'below the thresholds the lead still hears the measured size');
  assert.equal(sampleContext({ transcriptPath: p, session: 'sess-1', policy, now: NOW, dir: store, force: true }).notice, '', 'once per 25k step');

  appendFileSync(p, `${user('x'.repeat(5000), 2)}\n${assistant(cp + 5000, { min: 3 })}\n`);
  const s2 = sampleContext({ transcriptPath: p, session: 'sess-1', policy, now: NOW, dir: store });
  assert.equal(s2.advice.action, 'checkpoint');
  assert.match(s2.notice, new RegExp(`^\\[orchestrate · context\\] ${kk(cp + 5000)} of ~\\d+k · next: compact ${kk(ca)} · newest checkpoint: none`));
  assert.doesNotMatch(s2.notice, ORDERS);

  appendFileSync(p, `${user('y'.repeat(5000), 4)}\n${assistant(cp + 8000, { min: 5 })}\n`);
  const s3 = sampleContext({ transcriptPath: p, session: 'sess-1', policy, now: NOW, dir: store });
  assert.equal(s3.reading.tokens, cp + 8000);
  assert.equal(s3.notice, '', 'the same advice is not repeated');

  appendFileSync(p, `${user('z'.repeat(5000), 6)}\n${assistant(past, { min: 7 })}\n`);
  const s4 = sampleContext({ transcriptPath: p, session: 'sess-1', policy, now: NOW, dir: store });
  assert.equal(s4.advice.action, 'compact');
  assert.match(s4.notice, new RegExp(`^\\[orchestrate · context\\] ${kk(past)} of ~\\d+k · next: autocompact ${kk(auto)} · newest checkpoint: none`));
  assert.doesNotMatch(s4.notice, ORDERS);
  assert.equal(s4.reading.compactions, 0);

  // Compaction keeps the file; the reading and the announced advice start over.
  appendFileSync(p, `${boundary(past, 17000, 8)}\n${summary(8)}\n`);
  const s5 = sampleContext({ transcriptPath: p, session: 'sess-1', policy, now: NOW, dir: store });
  assert.equal(s5.reading.state, 'provisional');
  assert.equal(s5.reading.compactions, 1, 'a new epoch is one more compaction');
  assert.match(s5.notice, new RegExp(`^\\[orchestrate · context\\] ~17k of ~\\d+k · compacted 1× · next: compact ${kk(ca)}`));
  appendFileSync(p, `${user('w'.repeat(5000), 9)}\n${assistant(22000, { min: 10 })}\n`);
  const s6 = sampleContext({ transcriptPath: p, session: 'sess-1', policy, now: NOW, dir: store });
  assert.equal(s6.reading.tokens, 22000);
  assert.equal(s6.advice.action, 'none');

  // Growing again after compaction: checkpoint advice is said again, in the new epoch.
  appendFileSync(p, `${user('v'.repeat(5000), 11)}\n${assistant(40000, { min: 12 })}\n${assistant(60000, { min: 13 })}\n${assistant(80000, { min: 14 })}\n${assistant(cp + 10000, { min: 15 })}\n`);
  const s7 = sampleContext({ transcriptPath: p, session: 'sess-1', policy, now: NOW, dir: store });
  assert.equal(s7.advice.action, 'checkpoint');
  assert.match(s7.notice, new RegExp(`^\\[orchestrate · context\\] ${kk(cp + 10000)} of ~\\d+k · compacted 1× · next: compact ${kk(ca)}`));

  // No growth: nothing is read, and the reading stands. A half-written line
  // is not consumed and does not disturb it.
  const s8 = sampleContext({ transcriptPath: p, session: 'sess-1', policy, now: NOW, dir: store });
  assert.equal(s8.reading.tokens, cp + 10000);
  appendFileSync(p, assistant(cp + 15000, { min: 16 }).slice(0, 60));
  assert.equal(sampleContext({ transcriptPath: p, session: 'sess-1', policy, now: NOW, dir: store }).reading.tokens, cp + 10000);
  appendFileSync(p, assistant(cp + 15000, { min: 16 }).slice(60) + '\n');
  // The completed line is read whole from where the last complete line ended.
  const s9 = sampleContext({ transcriptPath: p, session: 'sess-1', policy, now: NOW, dir: store });
  assert.equal(s9.reading.tokens, cp + 15000);
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
    return { a, notice: contextNotice(r, a, { policy, dir: mkdtempSync(join(tmpdir(), 'ctx-fresh-')) }) };
  };
  const { compactAt } = thresholds(null, policy);
  const big = compactAt + 10000;
  assert.equal(policy.context.freshAfterCompactions, 2);
  const once = at(big, 1);
  assert.equal(once.a.fresh, false);
  assert.match(once.notice, / · compacted 1× · /);
  const twice = at(big, 2);
  assert.equal(twice.a.fresh, true);
  // The line states how many times it was compacted; the choice is the reader's.
  assert.match(twice.notice, / · compacted 2× · /);
  assert.doesNotMatch(twice.notice, ORDERS);
  // No escalated "hard" tier: far past compactAt the line has the same shape.
  const far = Math.max(compactAt, policy.context.autocompactDefault) + 100000;
  assert.match(at(far, 2).notice, new RegExp(`^\\[orchestrate · context\\] ${kk(far)} of ~\\d+k · compacted 2× · newest checkpoint: none$`));
  assert.match(at(far, 0).notice, new RegExp(`^\\[orchestrate · context\\] ${kk(far)} of ~\\d+k · newest checkpoint: none$`));
  const stop = persistDecision({ scan: { errors: [] }, contextAdvice: twice.a, contextReading: { tokens: big, compactions: 2 } });
  assert.match(stop.why, /fresh conversation that resumes from the checkpoint/);
});

test('the size line can be turned off, and only speaks for a measured size', () => {
  const { p, store } = file([assistant(60000, { min: 1 })]);
  assert.equal(sampleContext({ transcriptPath: p, session: 'q', policy: loadPolicy({ policy: { context: { tickEvery: 0 } } }), now: NOW, dir: store }).notice, '');
  const { p: p2, store: s2 } = file([user('hi', 0)]);
  assert.equal(sampleContext({ transcriptPath: p2, session: 'u', policy, now: NOW, dir: s2 }).notice, '', 'no usage yet: nothing to say');
});

test('the size line names the next size event that has not passed yet', () => {
  const { checkpointAt, compactAt } = thresholds(null, policy);
  const auto = policy.context.autocompactDefault;
  assert.ok(compactAt < auto, 'the compact line comes before autocompact');
  const dir = mkdtempSync(join(tmpdir(), 'ctx-next-'));
  const line = tokens => contextTick({ state: 'measured', tokens, capacity: null, compaction: null, compactions: 0 }, policy, { policy, dir }).text;
  assert.match(line(checkpointAt - 10000), new RegExp(` · next: compact ${kk(compactAt)} · `));
  assert.match(line(compactAt - 5000), new RegExp(` · next: compact ${kk(compactAt)} · `));
  assert.match(line(Math.round((compactAt + auto) / 2)), new RegExp(` · next: autocompact ${kk(auto)} · `));
  assert.doesNotMatch(line(auto + 25000), /next:/);
  for (const t of [checkpointAt - 10000, compactAt - 5000, auto + 25000]) assert.doesNotMatch(line(t), ORDERS);
});

test('the size line names the newest checkpoint, its age, and the tool calls since the last edit', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ctx-newest-'));
  const reading = { state: 'measured', tokens: 90000, capacity: 200000, compaction: { uuid: 'e1' }, compactions: 1 };
  const bare = contextTick(reading, policy, { policy, session: 'nc', dir, editCounter: 8, now: NOW }).text;
  assert.match(bare, /^\[orchestrate · context\] ~90k of ~200k · compacted 1× · next: .* · newest checkpoint: none · 8 tool calls since your last edit$/);
  const cp = checkpointPath('nc', reading, dir);
  mkdirSync(join(cp, '..'), { recursive: true });
  writeFileSync(cp, '# checkpoint\n');
  utimesSync(cp, new Date(NOW - 3 * 60000), new Date(NOW - 3 * 60000));
  const withCp = contextTick(reading, policy, { policy, session: 'nc', dir, editCounter: 1, now: NOW }).text;
  assert.ok(withCp.includes(` · newest checkpoint: ${cp}, 3 min ago · 1 tool call since your last edit`), withCp);
});

// ---- work calls since the last dispatch (challenge.md D1) ---------------------

test('stepWorkCalls: counts work tools, resets on a dispatch or a codex-worker Bash/PowerShell, leaves other tools alone', () => {
  assert.equal(stepWorkCalls(5, 'Edit', {}), 6);
  assert.equal(stepWorkCalls(5, 'Write', {}), 6);
  assert.equal(stepWorkCalls(5, 'MultiEdit', {}), 6);
  assert.equal(stepWorkCalls(5, 'NotebookEdit', {}), 6);
  assert.equal(stepWorkCalls(5, 'Read', {}), 6);
  assert.equal(stepWorkCalls(5, 'Grep', {}), 6);
  assert.equal(stepWorkCalls(5, 'Glob', {}), 6);
  assert.equal(stepWorkCalls(5, 'Bash', { command: 'ls' }), 6);
  assert.equal(stepWorkCalls(5, 'PowerShell', { command: 'ls' }), 6);
  assert.equal(stepWorkCalls(5, 'WebFetch', {}), 5, 'not a work tool: unchanged');
  assert.equal(stepWorkCalls(5, 'TodoWrite', {}), 5, 'not a work tool: unchanged');
  assert.equal(stepWorkCalls(5, 'Agent', { prompt: 'go' }), 0);
  assert.equal(stepWorkCalls(5, 'Task', { prompt: 'go' }), 0);
  assert.equal(stepWorkCalls(5, 'Bash', { command: 'node codex-worker.mjs --task 1' }), 0);
  assert.equal(stepWorkCalls(5, 'PowerShell', { command: 'node codex-worker.mjs' }), 0);
  assert.equal(stepWorkCalls(0, 'Edit', {}), 1, 'a missing count starts fresh, not NaN');
});

test('workCallsFact: says the count only on a crossing, never below or between crossings', () => {
  assert.equal(workCallsFact(99, 100), null);
  assert.equal(workCallsFact(100, 100), '100 work calls since your last dispatch');
  assert.equal(workCallsFact(150, 100), null);
  assert.equal(workCallsFact(200, 100), '200 work calls since your last dispatch');
  assert.equal(workCallsFact(0, 100), null, 'a fresh reset says nothing');
  assert.equal(workCallsFact(100, 0), null, 'threshold off');
});

test('replay: a healthy stretch of 83 calls then a dispatch produces zero facts (challenge.md D1 bound)', () => {
  let count = 0;
  let heard = false;
  for (let i = 0; i < 83; i++) {
    count = stepWorkCalls(count, 'Edit', {});
    if (workCallsFact(count, policy.lead.workCallsEvery)) heard = true;
  }
  assert.equal(heard, false);
  assert.equal(count, 83);
  count = stepWorkCalls(count, 'Agent', { prompt: 'go' });
  assert.equal(count, 0);
});

// ---- the lead's own hook, end to end -------------------------------------------
function ctxSandbox() {
  const home = mkdtempSync(join(tmpdir(), 'orch-ctxcheck-'));
  mkdirSync(join(home, '.claude', 'orchestrate', 'sessions'), { recursive: true });
  return home;
}
const wcSessionFile = (home, sid) => join(home, '.claude', 'orchestrate', 'sessions', `${sid}.json`);
function runContextCheck(payload, home) {
  const r = spawnSync(process.execPath, [join(HERE, 'context-check.mjs')], { input: JSON.stringify(payload), encoding: 'utf8', env: { ...process.env, HOME: home, USERPROFILE: home, ANTHROPIC_API_KEY: '' } });
  let json = null;
  try { json = r.stdout.trim() ? JSON.parse(r.stdout) : null; } catch {}
  return json ? json.hookSpecificOutput.additionalContext : '';
}
const setWorkCalls = (home, sid, count) => writeFileSync(wcSessionFile(home, sid), JSON.stringify({ v: 1, session_id: sid, workCalls: { count } }));
const readWorkCalls = (home, sid) => JSON.parse(readFileSync(wcSessionFile(home, sid), 'utf8')).workCalls.count;

test('the lead hears "N work calls since your last dispatch" only on a crossing, and a dispatch resets it', () => {
  const home = ctxSandbox();
  const sid = 'wc-1';
  const edit = { session_id: sid, tool_name: 'Edit', tool_input: { file_path: '/x' } };

  setWorkCalls(home, sid, 98);
  assert.doesNotMatch(runContextCheck(edit, home), /work calls/, 'the 99th: no fact yet');
  assert.equal(readWorkCalls(home, sid), 99);

  assert.match(runContextCheck(edit, home), /^\[orchestrate · context\] 100 work calls since your last dispatch$/, 'the 100th crosses');
  assert.equal(readWorkCalls(home, sid), 100);

  assert.doesNotMatch(runContextCheck(edit, home), /work calls/, '101: none');

  setWorkCalls(home, sid, 199);
  assert.match(runContextCheck(edit, home), /200 work calls since your last dispatch/, 'the 200th crosses');

  // An Agent dispatch resets the count to 0.
  setWorkCalls(home, sid, 83);
  assert.equal(runContextCheck({ session_id: sid, tool_name: 'Agent', tool_input: { subagent_type: 'orch-implementer', prompt: 'go' } }, home), '');
  assert.equal(readWorkCalls(home, sid), 0);

  // A Bash running codex-worker resets it too.
  setWorkCalls(home, sid, 50);
  runContextCheck({ session_id: sid, tool_name: 'Bash', tool_input: { command: 'node codex-worker.mjs --task 1' } }, home);
  assert.equal(readWorkCalls(home, sid), 0);

  // Events with agent_id (a helper's own tool use) never touch the lead's count.
  setWorkCalls(home, sid, 42);
  runContextCheck({ session_id: sid, agent_id: 'a1', tool_name: 'Edit', tool_input: {} }, home);
  assert.equal(readWorkCalls(home, sid), 42);
});
