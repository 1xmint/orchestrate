// lib/quota.mjs — the user's live plan usage, as the host last reported it.
//
// No hook receives rate limits; only the main status line does. statusline.mjs
// writes what it is given to quota.json, and everything else reads it here. A
// snapshot older than ten minutes is treated as absent: the status line reruns
// on every assistant message, so an old file means it is not installed, not
// that usage stood still.

import { join } from 'node:path';
import { existsSync, statSync } from './node.mjs';
import { DIR, readJson, currentAccount, readTail } from './tier.mjs';

export const QUOTA_PATH = join(DIR, 'quota.json');
export const QUOTA_FRESH_MS = 10 * 60 * 1000;

// Stop starting helpers here: a helper started near the wall is the one that
// gets cut off mid-edit, and the host's own auto-continue resumes after reset.
export const HELPER_STOP_FIVE_HOUR = 80;
export const HELPER_STOP_WEEK = 90;
// Say "go serial and cheap" from here.
export const CAUTION_FIVE_HOUR = 60;
// No line here stops the lead's keep-going: where the host waits and resumes at
// a limit, that stop turned the loop off just before the host's own resume
// (docs/pause.md). A helper refused at the lines above is a fact it states.

const win = w => w && Number.isFinite(Number(w.used_percentage))
  ? { pct: Number(w.used_percentage), resetsAt: Number(w.resets_at) || null }
  : null;

// The shape statusline.mjs stores, from the host's status line JSON. Version 2
// names the provider, the account and the session it came from: plan usage is
// per provider account, and a snapshot that cannot say whose it is must not
// stop anyone's work. Context size is per session and is kept apart from it
// (lib/context-scan.mjs), never in this file.
export const QUOTA_V = 2;

export function snapshotFrom(statusJson, now = Date.now(), account = null) {
  const s = statusJson || {};
  const rl = s.rate_limits || {};
  const cw = s.context_window || {};
  return {
    v: QUOTA_V,
    provider: 'claude',
    account: account || null,
    session: typeof s.session_id === 'string' ? s.session_id : null,
    at: now,
    fiveHour: win(rl.five_hour),
    week: win(rl.seven_day),
    contextPct: Number.isFinite(Number(cw.used_percentage)) ? Number(cw.used_percentage) : null,
    contextSize: Number.isFinite(Number(cw.context_window_size)) ? Number(cw.context_window_size) : null,
    model: (s.model && (s.model.display_name || s.model.id)) || null,
    effort: (s.effort && (s.effort.level || s.effort)) || null,
  };
}

// For enforcement: fresh, identified as Claude plan usage for a known account,
// and not another account's. `account` is the caller's current account when it
// is known; `undefined` looks it up.
export function readQuota(now = Date.now(), path = QUOTA_PATH, account = undefined) {
  const q = readJson(path);
  if (!q || !Number.isFinite(Number(q.at)) || now - Number(q.at) > QUOTA_FRESH_MS) return null;
  if (!q.fiveHour && !q.week) return null;
  if (q.provider !== 'claude' || !q.account) return null;
  let mine = account;
  if (mine === undefined) { try { mine = currentAccount().org; } catch { mine = null; } }
  if (mine && mine !== q.account) return null;
  return q;
}

export function resetClock(epochSeconds) {
  if (!epochSeconds) return 'its reset';
  const d = new Date(epochSeconds * 1000);
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

// Only the host's own limit messages count: they arrive as assistant records
// with the model "<synthetic>". Matching the phrase anywhere in the tail
// counted a research report that quoted it, and told the lead the user had hit
// two limits they had not. "Today" means today: the set resets with the date.
export function limitsFromTail(tail) {
  const found = new Set();
  for (const l of String(tail || '').split('\n')) {
    if (!l.includes('<synthetic>') && !l.includes('isApiErrorMessage')) continue;
    let o; try { o = JSON.parse(l); } catch { continue; }
    const m = o && o.type === 'assistant' && o.message;
    if (!m || !(m.model === '<synthetic>' || o.isApiErrorMessage)) continue;
    const text = (Array.isArray(m.content) ? m.content : []).map(b => (b && b.text) || '').join(' ');
    for (const hit of text.matchAll(/hit your (Opus|Sonnet|Haiku|Fable) limit/gi)) found.add(hit[1].toLowerCase());
    if (/hit your (session|weekly) limit/i.test(text)) found.add('session');
  }
  return found;
}

export function scanLimits(transcriptPath, state) {
  try {
    const day = new Date().toISOString().slice(0, 10);
    if (state.limitsDay !== day || state.limitsV !== 2) { state.limits = []; state.limitsDay = day; state.limitsV = 2; state.limitsScanMtime = null; }
    if (!transcriptPath || !existsSync(transcriptPath)) return state.limits;
    const mt = statSync(transcriptPath).mtimeMs;
    if (state.limitsScanMtime === mt) return state.limits;
    const found = new Set([...state.limits, ...limitsFromTail(readTail(transcriptPath, 65536))]);
    state.limitsScanMtime = mt;
    return [...found];
  } catch { return state.limits || []; }
}
