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
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { DIR, readJson, writeJsonAtomic, sanitizeId, sessionRun, loadSession } from './lib/tier.mjs';
import { pickupSection, pickupHash, shouldBlock } from './turn-check.mjs';
import { readContext } from './lib/context-scan.mjs';
import { checkpointPath, contextEpoch, hasCheckpoint } from './lib/context-advice.mjs';
import { modeOf } from './lib/modes.mjs';

const STORE = () => join(DIR, 'precompact-checks.json');

// PreCompact only documents the top-level `decision: 'block'` + `reason`
// (docs/research/0039); `permissionDecision` is not documented for this
// event, so nothing else rides along.
function emit(reason) {
  process.stdout.write(JSON.stringify({ decision: 'block', reason }));
}

// No absolute machine path in anything the user reads. When `path` sits
// inside the project (`cwd` is a prefix of it), returns it relative to `cwd`
// with forward slashes; otherwise returns null, so the caller falls back to
// naming the location in words — a temp-dir or home-dir path tells a reader
// nothing they can act on and can leak the machine's account name.
export function relativeLocation(path, cwd) {
  if (!path) return null;
  const norm = p => String(p).replace(/\\/g, '/').replace(/\/+$/, '');
  const p = norm(path);
  const c = cwd ? norm(cwd) : '';
  if (c && (p === c || p.toLowerCase().startsWith(`${c.toLowerCase()}/`))) {
    return p.slice(c.length + 1);
  }
  return null;
}

// Names a path under the plugin's own home-directory folder relative to
// home, with a leading `~` and forward slashes — e.g.
// `~/.claude/orchestrate/context/<session>/checkpoint-<id>.md`. Never a
// drive letter or account name, unlike the real absolute path. Returns null
// if `path` is not actually under home (nothing to shorten).
export function homeRelativeLocation(path) {
  if (!path) return null;
  const norm = p => String(p).replace(/\\/g, '/').replace(/\/+$/, '');
  const p = norm(path);
  const h = norm(homedir());
  if (h && (p === h || p.toLowerCase().startsWith(`${h.toLowerCase()}/`))) {
    return `~${p.slice(h.length)}`;
  }
  return null;
}

// Pure enough to test without a host: given what the run and the session
// state say, should this PreCompact be blocked, and with what message. `null`
// means let it through.
export function decide({ run, lastDispatchAt, prev, cwd = null }) {
  if (!run || !run.open) return null;
  if (!lastDispatchAt) return null; // direct work has no ledger to keep current
  const text = readFileSync(run.runMd, 'utf8');
  const hash = pickupHash(text);
  const d = shouldBlock({ pickupHash: hash, section: pickupSection(text), lastDispatchAt, prev });
  if (!d.block) return { block: false, hash };
  const rel = relativeLocation(run.runMd, cwd);
  const where = rel || "the run file this plugin is tracking for this session, under the plugin's own folder in your home directory";
  return {
    block: true,
    hash,
    reason: `orchestrate: about to compact with a Pickup line that has not moved since the last dispatch, in ${where}. Before this turn ends: one sentence that continues from here, its confidence and the resume risk — the compacted context will only know what Pickup says.`,
  };
}

export function unboundDecision({ session, reading, prev = {}, checkpoint = false, cwd = null }) {
  const epoch = contextEpoch(reading);
  if (checkpoint || prev.blockedFor === epoch) return { block: false, epoch };
  const path = checkpointPath(session, reading);
  const rel = relativeLocation(path, cwd) || homeRelativeLocation(path);
  const where = rel || "the checkpoint file this plugin keeps for this session, under the plugin's own folder in your home directory";
  return {
    block: true, epoch,
    reason: `orchestrate: write a checkpoint first (the goal, decisions made, files changed, verification, and the next action), then compaction proceeds. Save it to ${where}.`,
  };
}

function main() {
  let payload = '';
  try { payload = readFileSync(0, 'utf8'); } catch {}
  let input = null;
  try { input = JSON.parse(payload); } catch { return; }
  if (!input || typeof input !== 'object') return;
  // A subagent compacting its own transcript is not the lead's Pickup line to
  // demand — `agent_id` on the payload (hooks doc, "common input fields")
  // marks the call as coming from inside a subagent.
  if (input.agent_id) return;

  const run = sessionRun(input.session_id);
  const state = loadSession(input.session_id) || {};
  const path = STORE();
  const store = readJson(path) || {};
  const key = sanitizeId(`${input.session_id || 'nosession'}-${(run && run.runId) || 'norun'}`);
  const rec = store[key] || {};

  let d;
  try {
    if (run) d = decide({ run, lastDispatchAt: state.lastDispatchAt || null, prev: rec, cwd: input.cwd || null });
    else {
      const reading = readContext(input.transcript_path, { session: input.session_id || null });
      const bound = (state && state.run && state.run.runMd) || null;
      const checkpoint = hasCheckpoint(input.session_id || null, reading, { runMd: bound, permissionMode: modeOf(input) });
      d = unboundDecision({ session: input.session_id || null, reading, prev: rec, checkpoint, cwd: input.cwd || null });
    }
  } catch { return; }
  if (!d) return;

  store[key] = d.block ? { ...rec, hash: d.hash, blockedFor: d.epoch || d.hash } : { ...rec, hash: d.hash };
  try { writeJsonAtomic(path, store); } catch {}

  if (d.block) emit(d.reason);
}

// Only when run as a hook, not when a test imports the pure functions above.
if (process.argv[1] && resolvePath(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch {}
  process.exit(0);
}
