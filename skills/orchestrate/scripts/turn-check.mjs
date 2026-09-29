#!/usr/bin/env node
// turn-check.mjs — the session's Stop hook and management heartbeat, registered
// from SKILL.md's frontmatter so it is live only while the skill is in play.
// Idle and Pickup below are for a coordinated run this session has explicitly
// bound; the review hold is not — it reads a task's own return, which lands
// in session state whether or not a run is bound, so it checks regardless.
//
// Three pulses, in priority order, at most one block per Stop:
//   1. idle — two or more tasks are unblocked and nothing new was dispatched;
//      start them or say why you are waiting. Said once per unblocked set.
//   2. review — a task tagged for independent review came back done with none
//      sent. Said once per task, cleared by a reviewer dispatch or a closing
//      message that says the review was skipped and why.
//   3. pickup — a run whose Pickup is older than the last dispatch cannot be
//      resumed, so the next session would start blind.
//
// It never asks for more research, more testing or a better answer: a Stop hook
// that demands improvement after the work is finished is a loop with no exit
// condition, and the one that used to live here (a source-count floor under
// set-shaped recommendations) fired on two failed fetches as readily as on two
// real sources.

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DIR, readJson, writeJsonAtomic, sanitizeId, sessionRun, loadSession } from './lib/tier.mjs';

export function pickupSection(runMdText) {
  const m = /## Pickup\s*\n([\s\S]*?)(?:\n## |\s*$)/.exec(String(runMdText || ''));
  return m ? m[1].trim() : '';
}

export function pickupHash(runMdText) {
  return createHash('sha256').update(pickupSection(runMdText)).digest('hex').slice(0, 16);
}

// A Pickup section still holding its template placeholders is not written.
export function pickupWritten(section) {
  const prompt = /Pickup prompt:\s*(.*)/.exec(section || '');
  if (!prompt) return false;
  const v = prompt[1].trim();
  return Boolean(v) && !/^<.*>$/.test(v);
}

// Hash comparison, not timestamps: a clock is not a fact here (a hook rewrites
// files under the run, and a dispatch time and a file write are not comparable).
// `prev` is what this hook recorded the last time it ran for this run.
//   no dispatch this session                     -> quiet, there is nothing to record
//   the Pickup is still the template placeholder -> block, it was never written
//   the hash changed since the last check        -> quiet, the lead wrote it
//   the hash is unchanged and a dispatch has
//     happened since the last check              -> block once
export function shouldBlock({ pickupHash: hash, section, lastDispatchAt, prev = {} }) {
  if (!lastDispatchAt) return { block: false, why: 'no dispatch this session' };
  if (prev.blockedFor === hash) return { block: false, why: 'already blocked once for this text' };
  if (!pickupWritten(section)) return { block: true, why: 'Pickup has never been written' };
  if (prev.hash !== hash) return { block: false, why: 'Pickup changed since the last check' };
  if (!prev.checkedAt || Date.parse(lastDispatchAt) > Date.parse(prev.checkedAt)) {
    return { block: true, why: 'Pickup has not changed since the last dispatch' };
  }
  return { block: false, why: 'no dispatch since the last check' };
}

// A task's own returned row (ledger.mjs's SubagentStop, session state
// `returned`) carries `reviewGated: true` when it came back DONE tagged for
// independent review with no reviewer return yet. Resolved either by a
// reviewer dispatch this session recorded with `reviewOf` naming the same
// task (guard-agent.mjs's recordDispatch), or by the lead's own closing
// message saying the review was skipped, in its own words, near "review".
// Blocks at most once per task: a task already in `blockedFor` from a prior
// Stop is left alone whether or not it was ever resolved, the same "ask
// once" shape as the Pickup check below — a Stop hook that re-blocks a task
// the lead already saw once is a loop with no exit.
const SKIP_EXPLAINED = /\bskip(?:ped|ping)?\b[^.\n]{0,80}\breview\b|\breview\b[^.\n]{0,80}\bskip(?:ped|ping)?\b/i;

// A brief with no task id has no id for the ledger to hold it on, so its own
// return never carries reviewGated. It is held here instead, keyed on the id of
// the dispatch call (toolUseId), which the dispatch record and the return share:
// a return for a dispatch flagged for review, that came back DONE, is held until
// a reviewer's REVIEW OF names that id, or, when it is the only such return
// still open, until a reviewer is dispatched after it. With two or more open,
// only the explicit id clears one; nothing is guessed. A reviewer's own return
// is never held, and a dispatch that was not flagged is never held.
const isReviewerRow = d => Boolean(d && (d.reviewOf || /reviewer/i.test(String(d.agent || ''))));

function freeFormOpen(returned, dispatches) {
  const ds = Array.isArray(dispatches) ? dispatches : [];
  const out = [];
  for (const r of Array.isArray(returned) ? returned : []) {
    if (!r || r.task || r.status !== 'DONE') continue;
    // A helper's stop event carries its agent id but not the dispatch call's id,
    // so a return with no toolUseId is matched on the agent id both rows share.
    const d = r.toolUseId
      ? ds.find(x => x && x.toolUseId === r.toolUseId)
      : (r.agentId ? ds.find(x => x && x.agentId === r.agentId) : null);
    if (!d || !d.toolUseId || d.task || !d.review || isReviewerRow(d)) continue;
    if (ds.some(x => x && x.reviewOf === d.toolUseId)) continue;
    out.push({ id: d.toolUseId, at: Date.parse(r.at) });
  }
  return out;
}

export function reviewHoldDecision({ returned, dispatches, lastMessage, blockedFor }) {
  const already = new Set(Array.isArray(blockedFor) ? blockedFor : []);
  const gated = (Array.isArray(returned) ? returned : []).filter(r => r && r.reviewGated && r.task);
  const skipSaid = SKIP_EXPLAINED.test(String(lastMessage || ''));
  for (const r of gated) {
    if (already.has(r.task)) continue;
    const reviewed = (Array.isArray(dispatches) ? dispatches : []).some(d => d && d.reviewOf === r.task);
    if (reviewed || skipSaid) continue;
    return { block: true, task: r.task, blockedFor: [...already, r.task] };
  }
  const open = freeFormOpen(returned, dispatches);
  for (const f of open) {
    if (already.has(f.id) || skipSaid) continue;
    const later = open.length === 1 && (Array.isArray(dispatches) ? dispatches : []).some(d => d && !d.reviewOf && /reviewer/i.test(String(d.agent || '')) && Date.parse(d.at) > f.at);
    if (later) continue;
    return { block: true, task: f.id, freeForm: true, blockedFor: [...already, f.id] };
  }
  return { block: false, task: null, blockedFor: [...already] };
}

const STORE = () => join(DIR, 'turn-checks.json');

function emitBlock(reason) {
  process.stdout.write(JSON.stringify({
    decision: 'block',
    reason,
    hookSpecificOutput: { hookEventName: 'Stop', decision: 'block', reason },
  }));
}

// Threshold for the idle nudge. Turns are counted per session-run here rather
// than read from the transcript, so this stays cheap on every Stop.
export const IDLE_READY_MIN = 2;

// The nudge this Stop deserves, if any, computed before the Pickup check.
// Pure but for advancing the turn counter it carries in `rec`, so it can be
// tested without files. Priority is deliberate: start unblocked work before
// nagging about Pickup.
export function heartbeatDecision({ run, rec }) {
  const prev = rec || {};
  const turns = (Number(prev.turns) || 0) + 1;
  const out = { ...prev, turns };

  // Unblocked tasks sitting while the lead waits on one is the "you're right, I
  // had three things I could have been doing" failure, said once per ready set.
  const ready = (run && run.ready) || [];
  const readyKey = ready.slice().sort().join(',');
  if (ready.length >= IDLE_READY_MIN && prev.readyBlockedFor !== readyKey) {
    out.readyBlockedFor = readyKey;
    const shown = ready.slice(0, 4).join(', ') + (ready.length > 4 ? ` +${ready.length - 4} more` : '');
    return { rec: out, kind: 'idle', why: `${ready.length} tasks are unblocked (${shown}) and nothing new has been dispatched this turn. A background dispatch hands control straight back, so start the ones that can run at once — or say plainly why you are waiting.` };
  }

  return { rec: out, kind: null };
}

function checkHeartbeat(input) {
  // Idle and Pickup honesty are only for a run this session was explicitly
  // bound to: an unbound session is doing direct work, and direct work has no
  // ledger to keep current, and an open run this session never claimed is not
  // its to be nagged about. The review hold below is different — it reads a
  // task's own `returned` row, which ledger.mjs writes to session state on
  // every SubagentStop whether or not a run is bound, so it runs regardless.
  const run = sessionRun(input.session_id);
  const bound = run && run.open;

  const path = STORE();
  const store = readJson(path) || {};
  const key = sanitizeId(`${input.session_id || 'nosession'}-${bound ? run.runId : 'unbound'}`);
  const rec = store[key] || {};
  let updated = { ...rec, checkedAt: new Date().toISOString() };

  if (bound) {
    // Idle first, advancing the turn counter either way.
    const hb = heartbeatDecision({ run, rec });
    updated = { ...hb.rec, checkedAt: new Date().toISOString() };
    if (hb.kind) {
      store[key] = updated;
      try { writeJsonAtomic(path, store); } catch {}
      return emitBlock(`orchestrate: ${hb.why}`);
    }
  }

  const state = loadSession(input.session_id) || {};

  // Then the review hold: a task tagged for independent review (money, auth,
  // destructive data, a shared contract — guard-agent.mjs) that came back
  // DONE with none sent. Once per task, same "ask once" shape as Pickup below.
  const rh = reviewHoldDecision({
    returned: state.returned,
    dispatches: state.dispatches,
    lastMessage: input.last_assistant_message,
    blockedFor: rec.reviewBlockedFor,
  });
  if (rh.block) {
    updated.reviewBlockedFor = rh.blockedFor;
    store[key] = updated;
    try { writeJsonAtomic(path, store); } catch {}
    if (rh.freeForm) return emitBlock(`orchestrate: a brief flagged for independent review returned done with none sent. Dispatch orch-reviewer with REVIEW OF: ${rh.task}, or tell the user it was skipped and why.`);
    return emitBlock(`orchestrate: task ${rh.task} was tagged for independent review; it returned done with none sent. Dispatch orch-reviewer with REVIEW OF: ${rh.task}, or tell the user it was skipped and why.`);
  }
  if (rh.blockedFor.length) updated.reviewBlockedFor = rh.blockedFor;

  if (!bound) { store[key] = updated; try { writeJsonAtomic(path, store); } catch {} return; }

  // Then Pickup honesty, only after a dispatch, only for the run this session
  // drives, exactly as before.
  const lastDispatchAt = state.lastDispatchAt || null;
  if (!lastDispatchAt) { store[key] = updated; try { writeJsonAtomic(path, store); } catch {} return; }

  const text = readFileSync(run.runMd, 'utf8');
  const hash = pickupHash(text);
  const section = pickupSection(text);
  const d = shouldBlock({ pickupHash: hash, section, lastDispatchAt, prev: rec });
  updated = { ...updated, hash };

  if (!d.block) { store[key] = updated; try { writeJsonAtomic(path, store); } catch {} return; }

  updated.blockedFor = hash;
  store[key] = updated;
  try { writeJsonAtomic(path, store); } catch {}

  emitBlock(`orchestrate: ${d.why}. Before this turn ends, update the Pickup section of ${run.runMd}: one sentence that continues from here, its confidence, and the resume risk. Also set the phase glyph on any row you graded. That section is the only thing the next session reads first.`);
}

function main() {
  let payload = '';
  try { payload = readFileSync(0, 'utf8'); } catch {}
  let input = null;
  try { input = JSON.parse(payload); } catch { return; }
  if (!input || typeof input !== 'object') return;
  if (input.stop_hook_active === true) return;

  checkHeartbeat(input);
}

// Only when run as a hook, not when a test imports the pure functions above.
if (process.argv[1] && resolvePath(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch {}
  process.exit(0);
}
