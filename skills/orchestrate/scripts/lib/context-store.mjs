// lib/context-store.mjs — the on-disk record of the last reading per session
// and per agent, under ~/.claude/orchestrate/context/, and the paths used to
// find a transcript in the first place.
//
// This is the store half of the context reader: it samples a transcript
// incrementally (reading only the bytes added since the last sample), keeps
// the running "advice already announced" and "tool calls since the last edit"
// state, and writes it back. The scanning and advice logic it calls live in
// lib/context-scan.mjs and lib/context-advice.mjs; this file only adds the
// reading/writing of records.

import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, statSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { loadPolicy } from './policy.mjs';
import {
  CONTEXT_V, CONTEXT_DIR, SCAN_MAX, idPart,
  scanSlice, stepEditCounter, toReading, readContext, statusCapacity, readRange,
} from './context-scan.mjs';
import { contextEpoch, adviseContext, contextNotice, contextTick } from './context-advice.mjs';

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
export function sampleContext({ transcriptPath, session = null, agent = null, policy = loadPolicy(), now = Date.now(), force = false, dir = CONTEXT_DIR, announce = true, runMd = null, permissionMode = null } = {}) {
  const p = storePath(session, agent, dir);
  const prev = readStore(p);
  let size = 0;
  try { size = transcriptPath ? statSync(transcriptPath).size : 0; } catch { size = 0; }
  const capacity = policy.context.window || statusCapacity(session, { dir, now, staleMs: policy.context.staleMs });
  const opts = { session, agent, transcript: transcriptPath || null, capacity, now, staleMs: policy.context.staleMs };

  let reading;
  let editCounter;
  const prevEditCounter = prev && Number.isFinite(prev.editCounter) ? prev.editCounter : 0;
  const sameFile = prev && prev.reading && prev.transcript === (transcriptPath || null);
  if (!force && sameFile && size === prev.size) {
    // Nothing new; the reading stands, with its age recomputed. Any growth at
    // all is read: a compaction record can be a few hundred bytes.
    const nothing = { compaction: null, usage: null, responses: 0, sawBoundary: false, host: null };
    reading = { ...toReading(nothing, { ...opts, prev: prev.reading, continued: true }), offset: prev.offset, size };
    editCounter = prevEditCounter;
  } else if (!force && sameFile && size >= prev.offset && size - prev.offset <= SCAN_MAX) {
    let text = '';
    try { text = readRange(transcriptPath, prev.offset, size); } catch { text = ''; }
    const scan = scanSlice(text, { partialHead: false, lead: !agent });
    reading = { ...toReading(scan, { ...opts, prev: prev.reading, continued: true }), offset: prev.offset + scan.consumed, size };
    // Incremental: only the new bytes' tool calls are added to the running
    // count, so a call already counted on an earlier read is never counted twice.
    editCounter = stepEditCounter(prevEditCounter, scan.toolUses);
  } else {
    // First sample, a rewritten or truncated file, or a jump too large to read
    // incrementally: nothing earlier is known, so the count starts fresh from
    // whatever this wider read can see.
    reading = readContext(transcriptPath, { session, agent, capacity, now, policy });
    editCounter = stepEditCounter(0, reading.toolUses);
  }

  // Count compactions this store has seen: a new epoch is one more. A first
  // read sees only the last boundary, so the count can start low, never high.
  const before = prev && prev.reading ? prev.reading : null;
  const epoch = contextEpoch(reading);
  const isNew = epoch !== 'none' && (!before || contextEpoch(before) !== epoch);
  reading.compactions = (before ? Number(before.compactions) || 0 : 0) + (isNew ? 1 : 0);

  const noticeCtx = { policy, session, editCounter, dir, now, runMd, permissionMode };
  const advice = adviseContext(reading, policy);
  const lastKey = prev ? prev.advisedKey || null : null;
  const changed = advice.key !== lastKey;
  let notice = changed ? contextNotice(reading, advice, noticeCtx) : '';
  // Between thresholds the lead still hears the measured size, one short line
  // each `tickEvery` of growth and after each compaction, so it never has to
  // guess the size from memory or an old summary.
  const lastTick = prev ? prev.tickKey || null : null;
  const tick = contextTick(reading, policy, noticeCtx);
  const ticked = Boolean(tick.key) && tick.key !== lastTick;
  if (!notice && ticked) notice = tick.text;
  const { offset, size: sz, toolUses, ...clean } = reading;
  writeStore(p, {
    v: CONTEXT_V, session, agent, transcript: transcriptPath || null,
    offset: offset || 0, size: sz || 0, reading: clean, editCounter,
    advisedKey: announce && changed ? advice.key : lastKey,
    tickKey: announce && ticked ? tick.key : lastTick,
    sampledAt: new Date(now).toISOString(),
  });
  return { reading: clean, advice, changed, notice, tick: ticked ? tick.key : null, editCounter };
}

// The stored reading, without sampling. For callers that must not read the
// transcript (a report on another session, a quick status).
export function storedContext(session, agent = null, dir = CONTEXT_DIR) {
  const s = readStore(storePath(session, agent, dir));
  return s ? s.reading : null;
}

// The key last recorded as announced for this store, without sampling: what a
// caller that gates its own notices (a helper's size budget, say) checks
// before deciding whether to speak again.
export function storedAdvisedKey(session, agent = null, dir = CONTEXT_DIR) {
  const s = readStore(storePath(session, agent, dir));
  return s ? s.advisedKey || null : null;
}

// Record which advice was actually delivered. A caller that sampled with
// `announce: false` calls this once the notice really went out; null forgets,
// so the next advice is said again.
export function markAnnounced(session, agent = null, key = null, dir = CONTEXT_DIR) {
  const p = storePath(session, agent, dir);
  const s = readStore(p);
  if (s) writeStore(p, { ...s, advisedKey: key });
}

// Record that a size line was delivered, for a caller that sampled unannounced.
export function markTicked(session, agent = null, tickKey = null, dir = CONTEXT_DIR) {
  const p = storePath(session, agent, dir);
  const s = readStore(p);
  if (s) writeStore(p, { ...s, tickKey });
}

// Compatibility for callers that only want a number: the measured input side,
// or null when the reading is provisional or unknown.
export function lastMeasuredTokens(transcriptPath, opts = {}) {
  const r = readContext(transcriptPath, opts);
  return r.state === 'measured' ? r.tokens : null;
}
