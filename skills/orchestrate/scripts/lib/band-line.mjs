// lib/band-line.mjs — the one line the band shows, and the shape of the record it
// is read from. Pure, and it imports nothing: the band mod (hooks/band.mjs) runs
// in an environment with no Node, and `claude plugin validate` refuses a bare
// import such as node:fs, so everything the mod and the hooks must agree on lives
// in this one file and the hooks' file helpers (lib/band.mjs) build on it.
// docs/band.md says what the band shows and where each line comes from.
//
// The record is `<project root>/.orchestrator/band.json`:
//   { session, kind: 'working' | 'needs' | 'idle', text, at }
// The hooks write it; the mod only reads it. Nothing here throws.

export const BAND_KINDS = ['working', 'needs', 'idle'];
export const BAND_TEXT_CAP = 100;
// A record another session wrote (or this session under another id) is shown for
// this long after it was written, and not after: see `bandLine`.
export const OTHER_SESSION_MS = 30 * 60 * 1000;
export const OTHER_SESSION_TAG = '(another session) ';
export const WAITING_TEXT = 'waiting on a helper or background command';

// One line, spaces collapsed, at most `cap` characters. The user's own words
// are cut at the end, never reworded.
export function bandClip(text, cap = BAND_TEXT_CAP) {
  const t = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  return t.length > cap ? `${t.slice(0, cap - 3).trimEnd()}...` : t;
}

// A run's task ids (9-8-0001) are the ledger's, not the user's: a line they see
// names the task by its words. Every full id is taken out, and the spaces closed.
export function withoutTaskIds(text) {
  return String(text == null ? '' : text)
    // "(blocked on 10-3-0001)" names only ids: say what it means instead.
    .replace(/\(blocked on [\d\s,\-–and]+\)/gi, '(waiting on another step)')
    .replace(/\b\d{1,2}-\d{1,2}-\d{4}\b:?/g, ' ').replace(/\s+/g, ' ').trim();
}

const idOf = s => (s == null || s === '' ? null : String(s));

// The record for one state. Pure. An unknown kind is idle, and an idle record
// carries no text. `since`, given only for a wait, is when the waiting began:
// `at` stays the time of the write, so the other-session age check still
// reads how fresh the record is.
export function bandRecord({ session = null, kind, text = '', now = new Date(), since = null } = {}) {
  const k = BAND_KINDS.includes(kind) ? kind : 'idle';
  const rec = { session: idOf(session), kind: k, text: k === 'idle' ? '' : bandClip(text), at: new Date(now).toISOString() };
  if (since != null && k === 'working' && Number.isFinite(Date.parse(since))) rec.since = new Date(since).toISOString();
  return rec;
}

// A record from the file's text; null when it is not one.
export function parseBand(text) {
  let rec;
  try { rec = JSON.parse(text); } catch { return null; }
  if (!rec || typeof rec !== 'object' || Array.isArray(rec)) return null;
  if (!BAND_KINDS.includes(rec.kind) || typeof rec.text !== 'string' || typeof rec.at !== 'string') return null;
  const out = { session: idOf(rec.session), kind: rec.kind, text: rec.text, at: rec.at };
  if (typeof rec.since === 'string') out.since = rec.since;
  return out;
}

// The pause record (docs/pause.md), read the way lib/pause.mjs reads it: a
// record that is cleared, or is not one, is no pause. A test holds the two
// readers to the same answer.
const PAUSE_KINDS = ['usage_limit', 'api_error'];
export function parsePauseText(text) {
  let rec;
  try { rec = JSON.parse(text); } catch { return null; }
  if (!rec || typeof rec !== 'object' || Array.isArray(rec)) return null;
  if (!PAUSE_KINDS.includes(rec.kind) || typeof rec.at !== 'string' || typeof rec.text !== 'string') return null;
  if (rec.cleared) return null;
  return { session: idOf(rec.session), kind: rec.kind, text: rec.text, at: rec.at };
}

// The line, or '' when there is nothing to say. `pause` and `band` are parsed
// records or null; `session` is the id the caller knows the session by.
//
// Whose record it is. The hooks write the id the host gives them, the mod reads
// the id `$.session.id()` gives it, and nobody has checked that the two are the
// same string. So a record is shown in three cases:
//   - the ids are equal, or either side has none: it is this session's;
//   - the ids differ and the record is under OTHER_SESSION_MS old: shown with
//     "(another session)" in front, so a mismatch shows the line rather than
//     hiding it, and a second session in the same folder is told apart;
//   - the ids differ and the record is older: not shown, since a session that
//     died mid-turn would otherwise leave "Working on" in every later session.
// Order: a pause, then a question waiting for the user, then the work.
export function bandLine({ pause = null, band = null, session = null, now = Date.now() } = {}) {
  const mine = idOf(session);
  const tagFor = rec => {
    if (!rec) return null;
    const theirs = idOf(rec.session);
    if (mine == null || theirs == null || theirs === mine) return '';
    const age = now - Date.parse(rec.at);
    // A minute of slack for two clocks that disagree; a NaN age is never shown.
    return age >= -60000 && age <= OTHER_SESSION_MS ? OTHER_SESSION_TAG : null;
  };
  const p = pause && !pause.cleared ? tagFor(pause) : null;
  if (p !== null) {
    const said = bandClip(pause.text);
    if (said) return `${p}${said}`;
  }
  const b = tagFor(band);
  if (b === null) return '';
  const said = bandClip(band.text);
  if (!said) return '';
  if (band.kind === 'needs') return `${b}Needs you: ${said}`;
  if (band.kind === 'working') {
    const waited = said === WAITING_TEXT ? waitedFor(band.since || band.at, now) : '';
    return `${b}Working on: ${said}${waited ? `, ${waited} so far` : ''}`;
  }
  return '';
}

// How long a wait has gone on since the Stop that started it: the answer to
// "is it stuck?" without typing (about four hours on a check that never
// reported back is in the owner's record). Nothing under a minute, whole
// minutes after that, hours from sixty minutes. It counts from the record's
// `since` (the first of a run of waits) or else its `at`; during a turn the
// session was woken for, it still counts until the next Stop or prompt
// rewrites the record (docs/band.md).
export function waitedFor(at, now) {
  const ms = Number(now) - Date.parse(at);
  if (!Number.isFinite(ms) || ms < 60000) return '';
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}

// What a Stop leaves for the band, from facts the hook already has. Pure.
//   continued  the Stop was refused, so the turn goes on
//   question   the last message's closing question, or null
//   waiting    the loop passed the Stop because a helper or command is still out
//   open       the next open item (run or project page), or ''
//   goal       the session's goal in the user's words, or ''
// A turn that goes on is work whatever the last message said; a question the user
// has to answer comes before a wait; anything else is idle.
export function bandAtStop({ continued = false, question = null, waiting = false, open = '', goal = '' } = {}) {
  if (continued) return { kind: 'working', text: open || goal || '' };
  if (question) return { kind: 'needs', text: question };
  if (waiting) return { kind: 'working', text: WAITING_TEXT };
  return { kind: 'idle', text: '' };
}
