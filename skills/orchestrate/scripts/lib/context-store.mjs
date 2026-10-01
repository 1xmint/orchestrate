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
import { writeCompactionSnapshot } from './compaction-snapshot.mjs';
import {
  CONTEXT_V, CONTEXT_DIR, SCAN_MAX, idPart,
  scanSlice, stepEditCounter, anyEdit, toReading, readContext, statusCapacity, readRange,
} from './context-scan.mjs';
import { contextEpoch, adviseContext, contextNotice, contextTick, postCompactionAskDue } from './context-advice.mjs';

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
export function sampleContext({ transcriptPath, session = null, agent = null, policy = loadPolicy(), now = Date.now(), force = false, dir = CONTEXT_DIR, announce = true, runMd = null, permissionMode = null, settingsPath = null, env = undefined } = {}) {
  const p = storePath(session, agent, dir);
  const prev = readStore(p);
  let size = 0;
  try { size = transcriptPath ? statSync(transcriptPath).size : 0; } catch { size = 0; }
  const capacity = policy.context.window || statusCapacity(session, { dir, now, staleMs: policy.context.staleMs });
  const opts = { session, agent, transcript: transcriptPath || null, capacity, now, staleMs: policy.context.staleMs };

  let reading;
  let editCounter;
  let sawEdit = false;
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
    sawEdit = anyEdit(scan.toolUses);
  } else {
    // First sample, a rewritten or truncated file, or a jump too large to read
    // incrementally: nothing earlier is known, so the count starts fresh from
    // whatever this wider read can see.
    reading = readContext(transcriptPath, { session, agent, capacity, now, policy });
    editCounter = stepEditCounter(0, reading.toolUses);
    sawEdit = anyEdit(reading.toolUses);
  }
  const edited = Boolean((prev && prev.edited) || sawEdit);

  // Count compactions this store has seen: a new epoch is one more. A first
  // read sees only the last boundary, so the count can start low, never high.
  const before = prev && prev.reading ? prev.reading : null;
  const epoch = contextEpoch(reading);
  const isNew = epoch !== 'none' && (!before || contextEpoch(before) !== epoch);
  reading.compactions = (before ? Number(before.compactions) || 0 : 0) + (isNew ? 1 : 0);

  // The growth from the previous reading to this one, in the same epoch only
  // (a fresh epoch has nothing to compare against): what adviseContext uses to
  // catch a turn that would otherwise skip clean over the checkpoint band.
  const prevTokens = !isNew && before && before.state === 'measured' && Number.isFinite(before.tokens) ? before.tokens : null;
  reading.lastDelta = prevTokens != null && reading.state === 'measured' && Number.isFinite(reading.tokens)
    ? Math.max(0, reading.tokens - prevTokens)
    : 0;

  // The host runs the compaction hooks before it appends the boundary record,
  // so they cannot write the note for the summary they follow. This is the
  // first read that sees the boundary: write it here. The writer returns on an
  // existing file before it reads the transcript, so later calls cost one
  // existence check. Lead only; never throws.
  if (!agent && reading.compaction && transcriptPath) {
    try {
      writeCompactionSnapshot({
        session, reading, transcriptPath,
        ctx: { dir, runMd, runDir: runMd ? dirname(runMd) : undefined },
      });
    } catch { /* the notice below then says there is no checkpoint yet */ }
  }

  // The size this transcript was first seen at, kept for good: a helper's size
  // budget is an allowance above it (lib/policy.mjs sizeBudget).
  const sized = reading.state === 'measured' || reading.state === 'provisional';
  const baseline = prev && Number.isFinite(prev.baseline) ? prev.baseline
    : (sized && Number.isFinite(reading.tokens) && reading.tokens > 0 ? reading.tokens : null);

  const prevAsked = prev && Number.isFinite(prev.askedAfterCompactions) ? prev.askedAfterCompactions : 0;
  // Nothing edited yet: there is no "last edit" to count calls from, so the
  // fact is left out rather than read as 8 calls since an edit that never was.
  const noticeCtx = { policy, session, editCounter: edited ? editCounter : null, dir, now, runMd, permissionMode, settingsPath, env, askedAfterCompactions: prevAsked };
  const advice = adviseContext(reading, policy, noticeCtx);
  const lastKey = prev ? prev.advisedKey || null : null;
  const changed = advice.key !== lastKey;
  // The post-compaction ask fires on the compaction count, not on `changed`
  // alone (the epoch is already part of `advice.key`, so the two agree in
  // practice, but checking it directly keeps the once-per-compaction promise
  // even if that ever stops being true).
  const askDue = postCompactionAskDue(reading, advice, noticeCtx);
  let notice = (changed || askDue) ? contextNotice(reading, advice, noticeCtx) : '';
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
    offset: offset || 0, size: sz || 0, reading: clean, editCounter, edited, baseline,
    advisedKey: announce && changed ? advice.key : lastKey,
    tickKey: announce && ticked ? tick.key : lastTick,
    askedAfterCompactions: announce && askDue ? (Number(reading.compactions) || 0) : prevAsked,
    sampledAt: new Date(now).toISOString(),
  });
  return { reading: clean, advice, changed, notice, tick: ticked ? tick.key : null, editCounter, edited, baseline };
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

// Lives in context-scan.mjs, below both this module and tier.mjs, so tier.mjs
// can read a number without importing this module (which now reaches
// recover.mjs through the snapshot writer, and recover.mjs imports tier.mjs).
export { lastMeasuredTokens } from './context-scan.mjs';
