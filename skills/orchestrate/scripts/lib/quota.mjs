// lib/quota.mjs — the user's live plan usage, as the host last reported it.
//
// No hook receives rate limits; only the main status line does. statusline.mjs
// writes what it is given to quota.json, and everything else reads it here. A
// snapshot older than ten minutes is treated as absent: the status line reruns
// on every assistant message, so an old file means it is not installed, not
// that usage stood still.

import { join } from 'node:path';
import { DIR, readJson } from './tier.mjs';

export const QUOTA_PATH = join(DIR, 'quota.json');
export const QUOTA_FRESH_MS = 10 * 60 * 1000;

// Stop starting helpers here: a helper started near the wall is the one that
// gets cut off mid-edit, and the host's own auto-continue resumes after reset.
export const HELPER_STOP_FIVE_HOUR = 80;
export const HELPER_STOP_WEEK = 90;
// Stop auto-continuing the lead here.
export const PERSIST_STOP_FIVE_HOUR = 90;
// Say "go serial and cheap" from here.
export const CAUTION_FIVE_HOUR = 60;

const win = w => w && Number.isFinite(Number(w.used_percentage))
  ? { pct: Number(w.used_percentage), resetsAt: Number(w.resets_at) || null }
  : null;

// The shape statusline.mjs stores, from the host's status line JSON.
export function snapshotFrom(statusJson, now = Date.now()) {
  const s = statusJson || {};
  const rl = s.rate_limits || {};
  const cw = s.context_window || {};
  return {
    at: now,
    fiveHour: win(rl.five_hour),
    week: win(rl.seven_day),
    contextPct: Number.isFinite(Number(cw.used_percentage)) ? Number(cw.used_percentage) : null,
    model: (s.model && (s.model.display_name || s.model.id)) || null,
    effort: (s.effort && (s.effort.level || s.effort)) || null,
  };
}

export function readQuota(now = Date.now(), path = QUOTA_PATH) {
  const q = readJson(path);
  if (!q || !Number.isFinite(Number(q.at)) || now - Number(q.at) > QUOTA_FRESH_MS) return null;
  if (!q.fiveHour && !q.week) return null;
  return q;
}

export function resetClock(epochSeconds) {
  if (!epochSeconds) return 'its reset';
  const d = new Date(epochSeconds * 1000);
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
