#!/usr/bin/env node
// turn-check.mjs — the session's Stop hook, registered from SKILL.md's
// frontmatter so it is live only while the skill is in play.
//
// One rule, and only for a coordinated run this session has explicitly bound:
// a run whose Pickup section is older than the last dispatch cannot be resumed,
// so if this session ends there, the next one starts blind.
//
// It fires at most once per unchanged Pickup, and never for a session that is
// not running a bound coordinated run. It never asks for more research, more
// testing or a better answer: a Stop hook that demands improvement after the
// work is finished is a loop with no exit condition, and the one that used to
// live here (a source-count floor under set-shaped recommendations) fired on
// two failed fetch requests as readily as on two real sources.

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

function checkPickup(input) {
  // Only a run this session was explicitly bound to. An unbound session is a
  // session doing direct work, and direct work has no ledger to keep current.
  const run = sessionRun(input.session_id);
  if (!run || !run.open) return;

  const state = loadSession(input.session_id) || {};
  const lastDispatchAt = state.lastDispatchAt || null;
  if (!lastDispatchAt) return;

  const text = readFileSync(run.runMd, 'utf8');
  const hash = pickupHash(text);
  const section = pickupSection(text);

  const path = STORE();
  const store = readJson(path) || {};
  const key = sanitizeId(`${input.session_id || 'nosession'}-${run.runId}`);
  const rec = store[key] || {};

  const d = shouldBlock({ pickupHash: hash, section, lastDispatchAt, prev: rec });
  store[key] = { ...rec, hash, checkedAt: new Date().toISOString() };

  if (!d.block) { try { writeJsonAtomic(path, store); } catch {} return; }

  store[key].blockedFor = hash;
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

  checkPickup(input);
}

// Only when run as a hook, not when a test imports the pure functions above.
if (process.argv[1] && resolvePath(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch {}
  process.exit(0);
}
