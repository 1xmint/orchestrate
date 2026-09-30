// lib/context-scan.mjs — turns transcript bytes into one measurement.
//
// The context reader is three modules, and every hook, the router and the
// on-demand report read context through them, so they cannot disagree:
//   lib/context-scan.mjs    transcript scanning: text in, a reading out (this file)
//   lib/context-advice.mjs  what to do about a reading, and how to say it
//   lib/context-store.mjs   the on-disk record per session/agent, and paths
//
// Two earlier signals are gone. Transcript bytes: compaction keeps the file,
// so a size warning kept firing after the context had shrunk to a summary.
// The last usage record anywhere in the tail: a scan that walked past a
// compaction boundary reported a 311k reading after a 17k summary.
//
// What counts as a measurement: the input side of the most recent real model
// response (uncached input plus cache reads plus cache writes), which is what
// the next step re-reads. Cumulative session totals are never context.
//
// States:
//   measured     a response after the last compaction carried usage
//   provisional  a compaction happened and no response has reported usage since;
//                the boundary's own post-compaction figure is shown, not trusted
//   unknown      nothing current: no usage, null usage, or a stale reading
//
// No network, no child processes, never throws. Everything here is either a pure
// function over transcript text, or a read of the transcript file itself and
// of the small per-session "what did the status line last report" file. It
// does not touch the on-disk store (lib/context-store.mjs) or advice
// (lib/context-advice.mjs); those import from here, not the other way round.

import { readFileSync, writeFileSync, mkdirSync, renameSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { loadPolicy } from './policy.mjs';

export const CONTEXT_V = 1;
export const CONTEXT_DIR = join(homedir(), '.claude', 'orchestrate', 'context');

// Initial tail window, the window after which an unseen compaction is treated
// as too far back to matter, and the most any single read takes.
export const SCAN_START = 262144;
export const SCAN_ENOUGH = 2 * 1024 * 1024;
export const SCAN_MAX = 16 * 1024 * 1024;
// Responses after a compaction that still count as "immediately after".
export const JUST_COMPACTED_RESPONSES = 3;

export const fin = v => v != null && v !== '' && Number.isFinite(Number(v));
export const idPart = s => String(s || 'unknown').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 120);

export function readRange(path, start, end) {
  const len = Math.max(0, end - start);
  if (!len) return '';
  const buf = Buffer.alloc(len);
  const fd = openSync(path, 'r');
  try { readSync(fd, buf, 0, len, start); } finally { closeSync(fd); }
  return buf.toString('utf8');
}

// The input side of one response, or null when the record carries no usable
// numbers. A usage object whose three input fields are all null or absent is
// not a measurement of zero.
//
// A response that called a server tool such as the advisor lists its steps
// under `iterations`, and the top-level fields add every main-model step
// together: two steps of ~100k read as ~200k. The context is what the last
// own step read; an advisor step's read is the advisor's context, not ours.
export function inputSide(usage) {
  if (!usage || typeof usage !== 'object') return null;
  const own = Array.isArray(usage.iterations) ? usage.iterations.filter(i => i && i.type === 'message') : [];
  if (own.length) return inputSide({ ...own[own.length - 1], iterations: undefined });
  const f = ['input_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens'];
  if (!f.some(k => fin(usage[k]))) return null;
  return f.reduce((s, k) => s + (fin(usage[k]) ? Number(usage[k]) : 0), 0);
}

export function isBoundary(rec) {
  return Boolean(rec && rec.type === 'system' && rec.subtype === 'compact_boundary');
}

// Forward scan of a slice of JSONL. `partialHead` drops the first line, which
// starts mid-record whenever the slice does not start at byte 0. A trailing
// line with no newline is a write in progress: it is not consumed, and
// `consumed` stops before it so the next sample reads it whole.
export function scanSlice(text, { partialHead = false, lead = true } = {}) {
  const s = String(text || '');
  const lastNl = s.lastIndexOf('\n');
  const complete = lastNl >= 0 ? s.slice(0, lastNl + 1) : '';
  const out = {
    consumed: Buffer.byteLength(complete, 'utf8'),
    compaction: null, usage: null, responses: 0, sawBoundary: false,
    host: null, skipped: 0, toolUses: [],
  };
  const lines = complete.split('\n');
  if (partialHead) lines.shift();
  const ids = new Set();
  const seenTools = new Set();
  let anon = 0;
  let anonTool = 0;
  for (const line of lines) {
    if (!line.trim()) continue;
    let rec; try { rec = JSON.parse(line); } catch { out.skipped++; continue; }
    if (!rec || typeof rec !== 'object') continue;
    if (typeof rec.version === 'string') out.host = { version: rec.version, entrypoint: typeof rec.entrypoint === 'string' ? rec.entrypoint : (out.host && out.host.entrypoint) || null };
    if (isBoundary(rec)) {
      const m = rec.compactMetadata || {};
      out.sawBoundary = true;
      out.compaction = {
        at: rec.timestamp || null,
        uuid: rec.uuid || null,
        trigger: m.trigger || null,
        preTokens: fin(m.preTokens) ? Number(m.preTokens) : null,
        postTokens: fin(m.postTokens) ? Number(m.postTokens) : null,
      };
      out.usage = null; out.responses = 0; ids.clear();
      continue;
    }
    // The lead's own context never includes a helper's sidechain records.
    if (lead && rec.isSidechain === true) continue;
    if (rec.type !== 'assistant') continue;
    const msg = rec.message;
    if (!msg || msg.model === '<synthetic>') continue;
    // Tool calls this response made, in the order it made them, each counted
    // once even if the record is duplicated by streaming.
    for (const b of Array.isArray(msg.content) ? msg.content : []) {
      if (!b || b.type !== 'tool_use' || !b.name) continue;
      const toolId = b.id || `tool-anon-${anonTool++}`;
      if (seenTools.has(toolId)) continue;
      seenTools.add(toolId);
      out.toolUses.push(b.name);
    }
    const tokens = inputSide(msg.usage);
    if (tokens == null) continue;
    // Streaming writes one response as several records under one id; each
    // copy carries the same input side, so the id counts once.
    const id = msg.id || `anon-${anon++}`;
    if (!ids.has(id)) { ids.add(id); out.responses++; }
    out.usage = { tokens, responseId: msg.id || null, model: typeof msg.model === 'string' ? msg.model : null, at: rec.timestamp || null };
  }
  return out;
}

// Tool names that count as an edit for the "tool calls since your last edit"
// counter: anything that changes a file. Reading, searching and dispatching
// helpers do not reset it.
export const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

// Step a running "tool calls since the last edit" count over one slice's tool
// uses, in order: an edit tool resets it to 0, anything else adds one. Pure,
// so an incremental read and a full read use it the same way.
export function stepEditCounter(count, toolUses) {
  let c = Number.isFinite(count) ? count : 0;
  for (const name of toolUses || []) c = EDIT_TOOLS.has(name) ? 0 : c + 1;
  return c;
}

// The window size the host reported for this session through the status line,
// when that is installed and recent. Optional: nothing depends on it.
export function statusCapacity(session, { dir = CONTEXT_DIR, now = Date.now(), staleMs } = {}) {
  if (!session) return null;
  try {
    const s = JSON.parse(readFileSync(join(dir, `status-${idPart(session)}.json`), 'utf8'));
    if (!s || s.session !== session || !fin(s.size) || !fin(s.at)) return null;
    if (staleMs && now - Number(s.at) > staleMs) return null;
    return Number(s.size);
  } catch { return null; }
}

export function writeStatusCapacity(session, size, { dir = CONTEXT_DIR, now = Date.now() } = {}) {
  if (!session || !fin(size) || Number(size) <= 0) return false;
  try {
    mkdirSync(dir, { recursive: true });
    const p = join(dir, `status-${idPart(session)}.json`);
    const tmp = `${p}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify({ v: CONTEXT_V, session, size: Number(size), at: now }));
    renameSync(tmp, p);
    return true;
  } catch { return false; }
}

// Build a reading from a scan result, the previous stored reading, and the
// clock. `continued` says the scan covered only the bytes after `prev`.
export function toReading(scan, { prev = null, continued = false, session = null, agent = null, transcript = null, capacity = null, now = Date.now(), staleMs = loadPolicy().context.staleMs, compactionUnseen = false } = {}) {
  let compaction = scan.compaction;
  let usage = scan.usage;
  let responses = scan.responses;
  let host = scan.host;
  if (continued && prev && !scan.sawBoundary) {
    compaction = prev.compaction || null;
    if (!usage && prev.usage) usage = prev.usage;
    responses = prev.responsesSinceCompaction == null ? null : prev.responsesSinceCompaction + scan.responses;
    host = host || prev.host || null;
  } else if (!scan.sawBoundary && compactionUnseen) {
    responses = null;
  }
  let state = 'unknown';
  let tokens = null;
  let source = 'none';
  let stale = false;
  if (usage) {
    const age = usage.at ? now - Date.parse(usage.at) : null;
    stale = age != null && Number.isFinite(age) && age > staleMs;
    if (!stale) { state = 'measured'; tokens = usage.tokens; source = 'response-usage'; }
  } else if (compaction) {
    state = 'provisional';
    tokens = compaction.postTokens;
    source = 'compact-boundary';
  }
  return {
    v: CONTEXT_V,
    session, agent, transcript,
    state, tokens, source, stale,
    lastTokens: usage ? usage.tokens : null,
    capacity: capacity || null,
    pct: tokens != null && capacity ? Math.round((tokens / capacity) * 1000) / 10 : null,
    responseId: usage ? usage.responseId : null,
    model: usage ? usage.model : null,
    measuredAt: usage ? usage.at : null,
    usage: usage || null,
    compaction: compaction || null,
    responsesSinceCompaction: compaction ? responses : (compactionUnseen ? null : responses),
    host: host || null,
    readAt: new Date(now).toISOString(),
  };
}

// A full read of one transcript: widen the tail until a compaction boundary is
// found, the window is large enough that an earlier compaction no longer
// matters, or the whole file has been read.
export function readContext(transcriptPath, { session = null, agent = null, capacity, now = Date.now(), policy = loadPolicy() } = {}) {
  const cap = capacity !== undefined ? capacity : (policy.context.window || statusCapacity(session, { now, staleMs: policy.context.staleMs }));
  const base = { session, agent, transcript: transcriptPath || null, capacity: cap, now, staleMs: policy.context.staleMs };
  let size = 0;
  try { size = transcriptPath ? statSync(transcriptPath).size : 0; } catch { size = 0; }
  if (!size) return { ...toReading({ compaction: null, usage: null, responses: 0, sawBoundary: false, host: null }, base), offset: 0, size: 0 };
  let window = Math.min(SCAN_START, size);
  let scan;
  for (;;) {
    const start = Math.max(0, size - window);
    let text = '';
    try { text = readRange(transcriptPath, start, size); } catch { text = ''; }
    scan = scanSlice(text, { partialHead: start > 0, lead: !agent });
    const all = start === 0;
    if (scan.sawBoundary || all || (scan.usage && window >= SCAN_ENOUGH) || window >= SCAN_MAX) {
      const unseen = !scan.sawBoundary && !all;
      const reading = toReading(scan, { ...base, compactionUnseen: unseen });
      return { ...reading, offset: start + scan.consumed, size, toolUses: scan.toolUses };
    }
    window = Math.min(size, window * 4);
  }
}

// Compatibility for callers that only want a number: the measured input side,
// or null when the reading is provisional or unknown.
export function lastMeasuredTokens(transcriptPath, opts = {}) {
  const r = readContext(transcriptPath, opts);
  return r.state === 'measured' ? r.tokens : null;
}
