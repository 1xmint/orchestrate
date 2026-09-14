// lib/context.mjs — the one reader of "how big is this conversation right now".
//
// The router, the continuation hook, the dispatch guard, the tool-boundary
// sampler and the on-demand report all read context from here, so they cannot
// disagree. Two earlier signals are gone:
//
//   - Transcript bytes. Compaction keeps the transcript file, so a size warning
//     kept firing after the context had shrunk to a summary.
//   - The last usage record anywhere in the tail. A scan that walked past a
//     compaction boundary reported a 311k reading after a 17k summary.
//
// What counts as a measurement: the input side of the most recent real model
// response — uncached input plus cache reads plus cache writes — which is what
// the next step re-reads. Cumulative session totals are never context.
//
// States:
//   measured     a response after the last compaction carried usage
//   provisional  a compaction happened and no response has reported usage since;
//                the boundary's own post-compaction figure is shown, not trusted
//   unknown      nothing current: no usage, null usage, or a stale reading
//
// Measurements are kept per session and per agent under
// ~/.claude/orchestrate/context/, sampled incrementally from the bytes added
// since the last sample. No network, no child processes, never throws.

import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, statSync, openSync, readSync, closeSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname, basename } from 'node:path';
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

const fin = v => v != null && v !== '' && Number.isFinite(Number(v));
const idPart = s => String(s || 'unknown').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 120);

function readRange(path, start, end) {
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
export function inputSide(usage) {
  if (!usage || typeof usage !== 'object') return null;
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
    host: null, skipped: 0,
  };
  const lines = complete.split('\n');
  if (partialHead) lines.shift();
  const ids = new Set();
  let anon = 0;
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
      return { ...reading, offset: start + scan.consumed, size };
    }
    window = Math.min(size, window * 4);
  }
}

// ---- advice -----------------------------------------------------------------

export function thresholds(reading, policy = loadPolicy()) {
  const c = policy.context;
  let compactAt = c.compactAt;
  if (reading && reading.capacity) compactAt = Math.min(compactAt, Math.floor(reading.capacity * c.windowFraction));
  const checkpointAt = Math.min(c.checkpointAt, Math.floor(compactAt * 0.8));
  return { checkpointAt, compactAt };
}

// What to do about the current size. The key changes only when the advice
// does, and it carries the compaction epoch, so a compaction resets it.
export function adviseContext(reading, policy = loadPolicy()) {
  const epoch = reading && reading.compaction ? (reading.compaction.uuid || reading.compaction.at || 'c') : 'none';
  const key = action => `${epoch}|${action}`;
  if (!reading || reading.state === 'unknown' || reading.tokens == null) {
    return { action: 'unknown', key: key('unknown'), why: reading && reading.stale ? 'the last measurement is stale' : 'no model response has reported usage yet' };
  }
  const { checkpointAt, compactAt } = thresholds(reading, policy);
  const k = n => `${Math.round(n / 1000)}k`;
  if (reading.state === 'provisional') {
    if (reading.tokens >= compactAt) return { action: 'investigate', key: key('investigate'), why: `the compaction summary alone is reported at ${k(reading.tokens)}` };
    return { action: 'none', key: key('provisional'), why: 'compacted; waiting for the next response to measure' };
  }
  const just = reading.compaction && reading.responsesSinceCompaction != null && reading.responsesSinceCompaction <= JUST_COMPACTED_RESPONSES;
  if (just && reading.tokens >= compactAt) return { action: 'investigate', key: key('investigate'), why: `${k(reading.tokens)} right after compaction` };
  if (reading.tokens >= compactAt) return { action: 'compact', key: key('compact'), why: `${k(reading.tokens)} is at or above ${k(compactAt)}` };
  if (reading.tokens >= checkpointAt) return { action: 'checkpoint', key: key('checkpoint'), why: `${k(reading.tokens)} is at or above ${k(checkpointAt)}` };
  return { action: 'none', key: key('none'), why: `${k(reading.tokens)} is below ${k(checkpointAt)}` };
}

const CHECKPOINT_WHAT = 'the goal, decisions made, files changed, verification results, outstanding work, and the next action';

// The short notice for an advice change; empty when there is nothing to say.
export function contextNotice(reading, advice) {
  if (!reading || !advice) return '';
  const k = n => `~${Math.round(n / 1000)}k`;
  const cap = reading.capacity ? ` of a ${Math.round(reading.capacity / 1000)}k window` : '';
  switch (advice.action) {
    case 'checkpoint':
      return `[orchestrate · context] this conversation re-reads ${k(reading.tokens)} tokens${cap} on every step (measured from the last response). Prepare a checkpoint now: write down ${CHECKPOINT_WHAT}, where a later session can find it.`;
    case 'compact':
      return `[orchestrate · context] ${k(reading.tokens)} tokens${cap} per step. At the next safe boundary (no edit half-done, no helper running), save the checkpoint (${CHECKPOINT_WHAT}), then recommend to the user: compact if this same task continues; start a fresh conversation if the task changes or a finished phase will resume from saved files. The user makes the switch.`;
    case 'investigate': {
      const c = reading.compaction || {};
      const was = c.preTokens != null && c.postTokens != null ? ` (compaction took it from ${k(c.preTokens)} to ${k(c.postTokens)})` : '';
      return `[orchestrate · context] still ${k(reading.tokens)} tokens right after compaction${was}. Compacting again will not help: something restored on every step is large. Check CLAUDE.md and memory files, plugin, skill and MCP tool listings, and any large tool output being carried, before recommending anything else.`;
    }
    default:
      return '';
  }
}

// ---- incremental, per session and agent -------------------------------------

export function storePath(session, agent = null, dir = CONTEXT_DIR) {
  return join(dir, idPart(session || 'nosession'), `${agent ? `agent-${idPart(agent)}` : 'lead'}.json`);
}

function readStore(p) {
  try { const o = JSON.parse(readFileSync(p, 'utf8')); return o && o.v === CONTEXT_V ? o : null; } catch { return null; }
}

function writeStore(p, obj) {
  try {
    mkdirSync(dirname(p), { recursive: true });
    const tmp = `${p}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(obj));
    renameSync(tmp, p);
  } catch {}
}

// A session's transcript, found by id under ~/.claude/projects/<project>/.
export function findSessionTranscript(sessionId, base = join(homedir(), '.claude', 'projects')) {
  if (!sessionId || !/^[\w-]{4,120}$/.test(sessionId)) return null;
  let dirs = [];
  try { dirs = readdirSync(base); } catch { return null; }
  for (const d of dirs) {
    const p = join(base, d, `${sessionId}.jsonl`);
    if (existsSync(p)) return p;
  }
  return null;
}

// Where a helper's own transcript lives, when the host does not hand it over:
// <project>/<session>/subagents/agent-<id>.jsonl next to the lead's file.
export function agentTranscriptPath(leadTranscript, agentId) {
  if (!leadTranscript || !agentId) return null;
  const p = join(dirname(leadTranscript), basename(leadTranscript, '.jsonl'), 'subagents', `agent-${agentId}.jsonl`);
  return existsSync(p) ? p : null;
}

// Sample the transcript, reading only what was added since the last sample.
// Returns { reading, advice, changed, notice } where `notice` is non-empty only
// when the advice differs from the last advice this store announced, and
// `announce` records it as announced.
export function sampleContext({ transcriptPath, session = null, agent = null, policy = loadPolicy(), now = Date.now(), force = false, dir = CONTEXT_DIR, announce = true } = {}) {
  const p = storePath(session, agent, dir);
  const prev = readStore(p);
  let size = 0;
  try { size = transcriptPath ? statSync(transcriptPath).size : 0; } catch { size = 0; }
  const capacity = policy.context.window || statusCapacity(session, { dir, now, staleMs: policy.context.staleMs });
  const opts = { session, agent, transcript: transcriptPath || null, capacity, now, staleMs: policy.context.staleMs };

  let reading;
  const sameFile = prev && prev.reading && prev.transcript === (transcriptPath || null);
  if (!force && sameFile && size === prev.size) {
    // Nothing new; the reading stands, with its age recomputed. Any growth at
    // all is read: a compaction record can be a few hundred bytes.
    const nothing = { compaction: null, usage: null, responses: 0, sawBoundary: false, host: null };
    reading = { ...toReading(nothing, { ...opts, prev: prev.reading, continued: true }), offset: prev.offset, size };
  } else if (!force && sameFile && size >= prev.offset && size - prev.offset <= SCAN_MAX) {
    let text = '';
    try { text = readRange(transcriptPath, prev.offset, size); } catch { text = ''; }
    const scan = scanSlice(text, { partialHead: false, lead: !agent });
    reading = { ...toReading(scan, { ...opts, prev: prev.reading, continued: true }), offset: prev.offset + scan.consumed, size };
  } else {
    // First sample, a rewritten or truncated file, or a jump too large to read
    // incrementally.
    reading = readContext(transcriptPath, { session, agent, capacity, now, policy });
  }

  const advice = adviseContext(reading, policy);
  const lastKey = prev ? prev.advisedKey || null : null;
  const changed = advice.key !== lastKey;
  const notice = changed ? contextNotice(reading, advice) : '';
  const { offset, size: sz, ...clean } = reading;
  writeStore(p, {
    v: CONTEXT_V, session, agent, transcript: transcriptPath || null,
    offset: offset || 0, size: sz || 0, reading: clean,
    advisedKey: announce && changed ? advice.key : lastKey,
    sampledAt: new Date(now).toISOString(),
  });
  return { reading: clean, advice, changed, notice };
}

// The stored reading, without sampling. For callers that must not read the
// transcript (a report on another session, a quick status).
export function storedContext(session, agent = null, dir = CONTEXT_DIR) {
  const s = readStore(storePath(session, agent, dir));
  return s ? s.reading : null;
}

// Record which advice was actually delivered. A caller that sampled with
// `announce: false` calls this once the notice really went out; null forgets,
// so the next advice is said again.
export function markAnnounced(session, agent = null, key = null, dir = CONTEXT_DIR) {
  const p = storePath(session, agent, dir);
  const s = readStore(p);
  if (s) writeStore(p, { ...s, advisedKey: key });
}

// Compatibility for callers that only want a number: the measured input side,
// or null when the reading is provisional or unknown.
export function lastMeasuredTokens(transcriptPath, opts = {}) {
  const r = readContext(transcriptPath, opts);
  return r.state === 'measured' ? r.tokens : null;
}

// ---- readable report --------------------------------------------------------

export function formatReading(reading, advice, { now = Date.now() } = {}) {
  const L = [];
  const k = n => (n == null ? 'unknown' : `${Math.round(n / 1000)}k`);
  const age = t => {
    if (!t) return 'time unknown';
    const m = Math.round((now - Date.parse(t)) / 60000);
    return !Number.isFinite(m) ? 'time unknown' : m < 1 ? 'just now' : m < 120 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
  };
  L.push(`context: ${k(reading.tokens)}${reading.capacity ? ` of ${k(reading.capacity)} (${reading.pct}%)` : ''} — ${reading.state}`);
  if (reading.state === 'measured') L.push(`  measured from response ${reading.responseId || '(no id)'}${reading.model ? ` on ${reading.model}` : ''}, ${age(reading.measuredAt)}`);
  if (reading.state === 'provisional') L.push('  from the compaction record only; the next response will measure it');
  if (reading.stale) L.push(`  the last measurement (${k(reading.lastTokens)}, ${age(reading.measuredAt)}) is stale, so it is not used`);
  if (reading.compaction) {
    const c = reading.compaction;
    L.push(`  last compaction: ${age(c.at)}${c.trigger ? `, ${c.trigger}` : ''}${c.preTokens != null ? `, ${k(c.preTokens)} → ${k(c.postTokens)}` : ''}${reading.responsesSinceCompaction != null ? `, ${reading.responsesSinceCompaction} response(s) since` : ''}`);
  } else if (reading.responsesSinceCompaction == null && reading.state !== 'unknown') {
    L.push('  no compaction in the part of the transcript read');
  }
  if (!reading.capacity) L.push('  window size: not known here (install the status line, or set policy context.window)');
  if (reading.host && reading.host.version) L.push(`  host: ${reading.host.entrypoint || 'unknown entrypoint'} ${reading.host.version} (from this transcript)`);
  L.push(`recommended: ${advice.action} — ${advice.why}`);
  return L.join('\n');
}
