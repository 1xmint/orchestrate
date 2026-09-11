#!/usr/bin/env node
// precompact-check.mjs — a PreCompact hook: the one unguarded hole in the
// relay design (SKILL.md §4). A long lead can auto-compact mid-run with a
// stale Pickup line, and the compacted context has no way back to where the
// run actually was — router.mjs's SessionStart:compact handler can only
// resurface what Pickup actually says. This is the write-side companion to
// that read-side resume: it fires one lifecycle point before turn-check.mjs's
// Stop check would, catching the case where compaction lands mid-turn rather
// than between two Stops.
//
// Same question as turn-check.mjs's Stop check, same answer, reused rather
// than re-implemented: is the Pickup line still honest given what has
// happened since it was last read. It never blocks a genuinely current
// Pickup, and — this matters more here than at Stop — it never blocks twice
// for the same unwritten text. PreCompact commonly fires because context is
// already low; refusing compaction forever over a Pickup line nobody is
// going to write risks the context overflow this hook exists to prevent, not
// just a stale line. One warning, then compaction proceeds regardless.
//
// It never fails the compaction attempt on its own errors.

import { readFileSync } from 'node:fs';
import { join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DIR, readJson, writeJsonAtomic, sanitizeId, sessionRun, loadSession } from './lib/tier.mjs';
import { pickupSection, pickupHash, shouldBlock } from './turn-check.mjs';

const STORE = () => join(DIR, 'precompact-checks.json');

function emit(reason) {
  process.stdout.write(JSON.stringify({
    decision: 'block',
    reason,
    hookSpecificOutput: { hookEventName: 'PreCompact', permissionDecision: 'deny', permissionDecisionReason: reason },
  }));
}

// Pure enough to test without a host: given what the run and the session
// state say, should this PreCompact be blocked, and with what message. `null`
// means let it through.
export function decide({ run, lastDispatchAt, prev }) {
  if (!run || !run.open) return null;
  if (!lastDispatchAt) return null; // direct work has no ledger to keep current
  const text = readFileSync(run.runMd, 'utf8');
  const hash = pickupHash(text);
  const d = shouldBlock({ pickupHash: hash, section: pickupSection(text), lastDispatchAt, prev });
  if (!d.block) return { block: false, hash };
  return {
    block: true,
    hash,
    reason: `orchestrate: about to compact with a Pickup line that has not moved since the last dispatch, in ${run.runMd}. Before this turn ends: one sentence that continues from here, its confidence and the resume risk — the compacted context will only know what Pickup says.`,
  };
}

function main() {
  let payload = '';
  try { payload = readFileSync(0, 'utf8'); } catch {}
  let input = null;
  try { input = JSON.parse(payload); } catch { return; }
  if (!input || typeof input !== 'object') return;

  const run = sessionRun(input.session_id);
  const state = loadSession(input.session_id) || {};
  const path = STORE();
  const store = readJson(path) || {};
  const key = sanitizeId(`${input.session_id || 'nosession'}-${(run && run.runId) || 'norun'}`);
  const rec = store[key] || {};

  let d;
  try { d = decide({ run, lastDispatchAt: state.lastDispatchAt || null, prev: rec }); } catch { return; }
  if (!d) return;

  store[key] = d.block ? { ...rec, hash: d.hash, blockedFor: d.hash } : { ...rec, hash: d.hash };
  try { writeJsonAtomic(path, store); } catch {}

  if (d.block) emit(d.reason);
}

// Only when run as a hook, not when a test imports the pure functions above.
if (process.argv[1] && resolvePath(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch {}
  process.exit(0);
}
