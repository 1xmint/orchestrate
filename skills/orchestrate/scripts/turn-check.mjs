#!/usr/bin/env node
// turn-check.mjs — the session's Stop hook and management heartbeat, registered
// from SKILL.md's frontmatter so it is live only while the skill is in play, and
// only for a coordinated run this session has explicitly bound.
//
// Three pulses, in priority order, at most one block per Stop:
//   1. marathon — a long session re-reads its whole self every turn (the biggest
//      cost of the run this design came from); past a turn threshold it says to
//      write the Pickup line and hand off to a fresh session.
//   2. idle — two or more tasks are unblocked and nothing new was dispatched;
//      start them or say why you are waiting. Said once per unblocked set.
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

const STORE = () => join(DIR, 'turn-checks.json');

function emitBlock(reason) {
  process.stdout.write(JSON.stringify({
    decision: 'block',
    reason,
    hookSpecificOutput: { hookEventName: 'Stop', decision: 'block', reason },
  }));
}

// Thresholds for the two management nudges. Turns are counted per session-run
// here rather than read from the transcript, so this stays cheap on every Stop.
export const MARATHON_FIRST = 150;
export const MARATHON_EVERY = 200;
export const IDLE_READY_MIN = 2;

// The louder of the two nudges this Stop deserves, if any, computed before the
// Pickup check. Pure but for advancing the turn counter it carries in `rec`, so
// it can be tested without files. Priority is deliberate: hand off a marathon
// before doing more work, and start unblocked work before nagging about Pickup.
export function heartbeatDecision({ run, rec }) {
  const prev = rec || {};
  const turns = (Number(prev.turns) || 0) + 1;
  const out = { ...prev, turns };

  // A long conversation re-reads its whole self every turn — 84% of the cost of
  // the run that prompted this design. The vendor's own remedy for a long
  // session is to hand off and resume from disk, which the ledger makes cheap.
  const marathonNext = Number(prev.marathonNext) || MARATHON_FIRST;
  if (turns >= marathonNext) {
    out.marathonNext = turns + MARATHON_EVERY;
    return { rec: out, kind: 'marathon', why: `this session has run about ${turns} turns. A long conversation re-reads its entire self on every turn, and that re-read was the single largest cost of the run this design came from. This is a good stopping point: write the Pickup line, then hand off to a fresh session — it resumes from the ledger and starts with a small, cheap context.` };
  }

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
  // Only a run this session was explicitly bound to. An unbound session is a
  // session doing direct work, and direct work has no ledger to keep current;
  // an open run this session never claimed is not its to be nagged about.
  const run = sessionRun(input.session_id);
  if (!run || !run.open) return;

  const path = STORE();
  const store = readJson(path) || {};
  const key = sanitizeId(`${input.session_id || 'nosession'}-${run.runId}`);
  const rec = store[key] || {};

  // Marathon and idle first, advancing the turn counter either way.
  const hb = heartbeatDecision({ run, rec });
  let updated = { ...hb.rec, checkedAt: new Date().toISOString() };
  if (hb.kind) {
    store[key] = updated;
    try { writeJsonAtomic(path, store); } catch {}
    return emitBlock(`orchestrate: ${hb.why}`);
  }

  // Then Pickup honesty, only after a dispatch, only for the run this session
  // drives, exactly as before.
  const state = loadSession(input.session_id) || {};
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
