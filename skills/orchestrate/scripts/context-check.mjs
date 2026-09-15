#!/usr/bin/env node
// context-check.mjs — a PostToolUse hook: sample context at tool boundaries.
//
// The router only runs when the user types, and a long autonomous stretch can
// grow the conversation by hundreds of thousands of tokens between prompts. So
// this samples at each tool boundary, reading only the bytes added since the
// last sample (lib/context.mjs), and says something only when the advice
// changes: checkpoint, compact at the next safe boundary, or investigate a
// conversation that stayed large after compaction. It also notices a change of
// permission mode (lib/modes.mjs), which is how Plan-mode approval reaches the
// lead mid-turn.
//
// Inside a helper (`agent_id` present) it records that helper's own context
// under its own key and measures it against that role's size budget
// (lib/policy.mjs): a plain-words notice at warnAt to write progress and keep
// going, and at returnAt to start no new work and return PARTIAL. The
// coordinator hears the same two thresholds in its own words.
//
// Most calls read one small file, see too little growth, and exit. Never
// blocks, never exits non-zero, never fails the tool call.

import { readFileSync, statSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sampleContext, agentTranscriptPath, markAnnounced, storedAdvisedKey } from './lib/context.mjs';
import { modeNote } from './lib/modes.mjs';
import { cappedNote, helperFiles, nativeAgent, roleMaxTurns, transcriptTurns } from './lib/workers.mjs';
import { loadSession, saveSession, routerSettings } from './lib/tier.mjs';
import { loadPolicy, sizeBudget } from './lib/policy.mjs';

// The progress-file fact, in the order a reader needs it: no path at all,
// a path that has not been written yet, or a path with how long ago it was
// last written. Never reads the filesystem itself — `minutesAgo` is resolved
// by the caller, since only it knows what "now" and "the file's mtime" mean
// for this run.
function progressFact(progress) {
  if (!progress || !progress.path) return 'none given';
  if (progress.minutesAgo == null) return `progress file: ${progress.path}, not written yet`;
  const m = Math.max(0, Math.round(progress.minutesAgo));
  return `progress file: ${progress.path}, written ${m < 1 ? 'just now' : `${m} min ago`}`;
}

// A helper's own size budget, measured against its role: one line of facts,
// no orders — the helper decides what to do with them. Pure: `tokens` is null
// unless the size is measured or provisional (contextTick's own test of
// `reading.state`), `budget` is that role's {warnAt, returnAt}, `announced` is
// the last key this helper already heard (`null` after neither), `turn` and
// `maxTurns` are dropped from the line together when either is unknown, and
// `progress` is `{ path, minutesAgo }` or null. Returns `{ key, text }` or
// null when there is nothing to say. `size-return` outranks `size-warn`: a
// helper that jumps straight past returnAt hears only the return notice, and
// each key is said once. The same shape fires at both thresholds — at
// returnAt the numbers just say the budget is the smaller one.
export function helperSizeNotice({ role, tokens, budget, announced = null, turn = null, maxTurns = null, callsSinceEdit = null, progress = null } = {}) {
  if (!budget || tokens == null || !Number.isFinite(tokens)) return null;
  const n = Math.round(tokens / 1000);
  let key = null;
  let at = null;
  if (tokens >= budget.returnAt) { key = 'size-return'; at = budget.returnAt; }
  else if (tokens >= budget.warnAt) { key = 'size-warn'; at = budget.warnAt; }
  if (!key || key === announced) return null;
  const parts = [`~${n}k of ~${Math.round(at / 1000)}k budget`];
  if (Number.isFinite(turn) && Number.isFinite(maxTurns)) parts.push(`turn ${turn} of ${maxTurns}`);
  if (Number.isFinite(callsSinceEdit)) parts.push(`${callsSinceEdit} tool call${callsSinceEdit === 1 ? '' : 's'} since your last edit`);
  parts.push(progressFact(progress));
  return { key, text: `[orchestrate · size] ${parts.join(' · ')}` };
}

export function check(input) {
  if (!input || typeof input !== 'object' || !input.session_id) return '';
  const session = input.session_id;
  const agent = input.agent_id ? String(input.agent_id) : null;
  if (agent) {
    const t = input.agent_transcript_path || agentTranscriptPath(input.transcript_path, agent);
    if (t) {
      const sample = sampleContext({ transcriptPath: t, session, agent, announce: false });
      const state = loadSession(session) || {};
      const owner = nativeAgent(Array.isArray(state.dispatches) ? state.dispatches : [], helperFiles(input.transcript_path), agent);
      const role = owner ? owner.role : 'default';
      const reading = sample.reading;
      const tokens = reading && (reading.state === 'measured' || reading.state === 'provisional') ? reading.tokens : null;
      const budget = sizeBudget(role, loadPolicy());
      const announced = storedAdvisedKey(session, agent);
      const maxTurns = roleMaxTurns(owner ? owner.dispatch.agent : role);
      const turn = transcriptTurns(t);
      const progressPath = owner && owner.dispatch ? owner.dispatch.progress : null;
      let progress = null;
      if (progressPath) {
        progress = { path: progressPath, minutesAgo: null };
        try { progress.minutesAgo = (Date.now() - statSync(progressPath).mtimeMs) / 60000; } catch {}
      }
      const notice = helperSizeNotice({ role, tokens, budget, announced, turn, maxTurns, callsSinceEdit: sample.editCounter, progress });
      if (notice) markAnnounced(session, agent, notice.key);
      return notice ? notice.text : '';
    }
    return '';
  }
  if (!routerSettings().enabled) return '';
  const out = [];
  if (input.transcript_path) {
    const r = sampleContext({ transcriptPath: input.transcript_path, session });
    if (r.notice) out.push(r.notice);
  }
  const state = loadSession(session);
  if (state) {
    const before = state.mode || null;
    const note = modeNote(state, input);
    if (note) out.push(note);
    const capped = cappedNote(state);
    if (capped) out.push(capped);
    if ((state.mode || null) !== before || capped) { try { saveSession(state); } catch {} }
  }
  return out.join('\n');
}

function main() {
  let payload = '';
  try { payload = readFileSync(0, 'utf8'); } catch {}
  let input = null;
  try { input = JSON.parse(payload); } catch { return; }
  const text = check(input);
  if (text) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: text } }));
}

if (process.argv[1] && resolvePath(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch {}
  process.exit(0);
}
