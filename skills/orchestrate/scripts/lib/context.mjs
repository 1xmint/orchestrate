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
//
// This file is a thin front door: every name it exports is implemented in one
// of three modules that grew out of it once it passed 600 lines —
//   lib/context-scan.mjs    transcript scanning: text in, a reading out
//   lib/context-advice.mjs  what to do about a reading, and how to say it
//   lib/context-store.mjs   the on-disk record per session/agent, and paths
// — so every existing importer keeps working unchanged.

export {
  CONTEXT_V, CONTEXT_DIR, SCAN_START, SCAN_ENOUGH, SCAN_MAX, JUST_COMPACTED_RESPONSES,
  inputSide, isBoundary, scanSlice, EDIT_TOOLS, stepEditCounter,
  statusCapacity, writeStatusCapacity, toReading, readContext,
} from './context-scan.mjs';

export {
  thresholds, contextEpoch, contextEpochStart, checkpointPath, PLANS_DIR, newestCheckpoint, hasCheckpoint,
  adviseContext, switchAdvice, contextNotice, contextTick, formatReading,
} from './context-advice.mjs';

export {
  storePath, findSessionTranscript, agentTranscriptPath, sampleContext,
  storedContext, storedAdvisedKey, markAnnounced, markTicked, lastMeasuredTokens,
} from './context-store.mjs';
