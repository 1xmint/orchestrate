// lib/handoff.mjs — a fresh session's only way to answer "continue what?": the
// last thing a previous session in this same folder said it was working on.
// Pure and read-only: no writes, never throws, so a call site can use it on
// every prompt without a try/catch of its own.

import { readdirSync, readFileSync } from './node.mjs';
import { join } from 'node:path';

// win32 paths differ by case and by slash direction between a session opened
// from PowerShell and one opened from bash in the same folder; normalise both
// away before comparing.
function normCwd(cwd) {
  return String(cwd || '').replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '');
}

// The newest session record under `sessionsDir` that: is not `exceptId` (the
// session asking), was launched in the same folder as `cwd`, has a `goal`
// recorded, and was last seen within `maxAgeMs` of `now` (default 7 days).
// Null when none qualifies or the directory cannot be read.
export function findPreviousSession({ sessionsDir, cwd, exceptId, now = Date.now(), maxAgeMs = 7 * 86400000 }) {
  let files = [];
  try { files = readdirSync(sessionsDir).filter(f => f.endsWith('.json')); } catch { return null; }
  const target = normCwd(cwd);
  let best = null;
  for (const f of files) {
    let rec;
    try { rec = JSON.parse(readFileSync(join(sessionsDir, f), 'utf8')); } catch { continue; }
    if (!rec || !rec.goal || !rec.lastSeen) continue;
    if (exceptId && rec.session_id === exceptId) continue;
    if (normCwd(rec.cwd) !== target) continue;
    const seenAt = Date.parse(rec.lastSeen);
    if (!Number.isFinite(seenAt) || now - seenAt > maxAgeMs) continue;
    if (!best || seenAt > Date.parse(best.lastSeen)) best = rec;
  }
  return best;
}

// "3 minutes", "2 hours", "5 days" — the coarsest unit that reads as at least
// one, for the handoff line's "<N minutes|hours|days> ago".
export function formatAgo(ms) {
  const mins = Math.max(1, Math.round(ms / 60000));
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'}`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'}`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'}`;
}
