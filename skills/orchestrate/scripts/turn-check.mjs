#!/usr/bin/env node
// turn-check.mjs — the session's Stop hook, registered from SKILL.md's
// frontmatter so it is live only while the skill is in play.
//
// It holds one rule: a run whose Pickup section is older than the last dispatch
// cannot be resumed. If this session ends there, the next one starts blind.
// So when a dispatch has happened since the Pickup section last changed, the
// turn is blocked once with the instruction to update it.
//
// Deterministic: a hash of the Pickup section, compared with the hash recorded
// at the last block or the last dispatch. No model call, no judgment. One block
// per return; if the orchestrator ignores it, the turn ends anyway.

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DIR, readJson, writeJsonAtomic, sanitizeId, findRepoRoot, latestRun, loadSession } from './lib/tier.mjs';

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

// Hash comparison, not timestamps: a clock is not a fact here (the ledger
// rewrites RUN.md, and a dispatch time and a file write are not comparable).
// `prev` is what this hook recorded the last time it ran for this run.
//   no dispatch this session                     -> quiet, there is nothing to record
//   the Pickup is still the template placeholder -> block, it was never written
//   the hash changed since the last check        -> quiet, the orchestrator wrote it
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

function main() {
  let payload = '';
  try { payload = readFileSync(0, 'utf8'); } catch {}
  let input = null;
  try { input = JSON.parse(payload); } catch { return; }
  if (!input || typeof input !== 'object') return;
  if (input.stop_hook_active === true) return;

  const root = findRepoRoot(input.cwd) || input.cwd;
  const run = latestRun(root);
  if (!run || !run.open) return;

  const state = loadSession(input.session_id) || {};
  const lastDispatchAt = state.lastDispatchAt || null;
  if (!lastDispatchAt) return;

  const text = readFileSync(run.runMd, 'utf8');
  const hash = pickupHash(text);
  const section = pickupSection(text);

  const path = join(DIR, 'turn-checks.json');
  const store = readJson(path) || {};
  const key = sanitizeId(`${input.session_id || 'nosession'}-${run.runId}`);
  const rec = store[key] || {};

  const d = shouldBlock({ pickupHash: hash, section, lastDispatchAt, prev: rec });
  store[key] = { ...rec, hash, checkedAt: new Date().toISOString() };

  if (!d.block) { try { writeJsonAtomic(path, store); } catch {} return; }

  store[key].blockedFor = hash;
  try { writeJsonAtomic(path, store); } catch {}

  const reason = `orchestrate: ${d.why}. Before this turn ends, update the Pickup section of ${run.runMd}: one sentence that continues from here, its confidence, and the resume risk. Also set the phase glyph on any row you graded. That section is the only thing the next session reads first.`;
  process.stdout.write(JSON.stringify({
    decision: 'block',
    reason,
    hookSpecificOutput: { hookEventName: 'Stop', decision: 'block', reason },
  }));
}

// Only when run as a hook, not when a test imports the pure functions above.
if (process.argv[1] && resolvePath(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch {}
  process.exit(0);
}
