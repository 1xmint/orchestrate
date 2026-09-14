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
// under its own key. Ordinary helpers hear nothing; the coordinator is told to
// checkpoint its wave or return a partial handoff at the two thresholds.
//
// Most calls read one small file, see too little growth, and exit. Never
// blocks, never exits non-zero, never fails the tool call.

import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sampleContext, agentTranscriptPath, markAnnounced } from './lib/context.mjs';
import { modeNote } from './lib/modes.mjs';
import { cappedNote, helperFiles, nativeAgent } from './lib/workers.mjs';
import { loadSession, saveSession, routerSettings } from './lib/tier.mjs';

export function coordinatorNotice(sample) {
  if (!sample || !sample.changed || !sample.reading || !sample.advice) return '';
  const size = `~${Math.round(sample.reading.tokens / 1000)}k`;
  if (sample.advice.action === 'checkpoint') {
    return `[orchestrate · coordinator] context is ${size}: write PROGRESS now so every task grade, branch, and evidence path survives.`;
  }
  if (sample.advice.action === 'compact' || sample.advice.action === 'investigate') {
    return `[orchestrate · coordinator] context is ${size}: return PARTIAL now with the handoff; do not dispatch or integrate more work.`;
  }
  return '';
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
      const notice = owner && owner.role === 'orch-coordinator' ? coordinatorNotice(sample) : '';
      if (notice) markAnnounced(session, agent, sample.advice.key);
      return notice;
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
