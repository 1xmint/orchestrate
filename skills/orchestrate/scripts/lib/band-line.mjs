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
// The pause record's promise (lib/pause.mjs writes it, for the usage limit with
// keep-going armed). It is true only of the session that wrote it, so a pause
// shown to another session is shown without it.
export const KEEP_GOING_CLAUSE = '; keep-going stays on';

// One line, spaces collapsed, at most `cap` characters. The user's own words
// are cut at the end, never reworded.
export function bandClip(text, cap = BAND_TEXT_CAP) {
  const t = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  return t.length > cap ? `${t.slice(0, cap - 3).trimEnd()}...` : t;
}

// A run's task ids are the ledger's, not the user's: a line they see names the
// task by its words. A task id is M-D-NNNN, the run's month and day and then a
// counter written with four digits from 0001 (batch.mjs `pad4`,
// references/ledger.md), so its last part starts with 0. A date the user wrote
// in the same shape ("the 10-3-2026 release notes") has a year there, and is
// left as typed.
const TASK_ID = '(?:1[0-2]|0?[1-9])-(?:3[01]|[12]\\d|0?[1-9])-0\\d{3}';
const BLOCKED_ON_IDS = new RegExp(`\\(blocked on (?:${TASK_ID}|[\\s,–]|and)+\\)`, 'gi');
const TASK_IDS = new RegExp(`\\b${TASK_ID}\\b:?`, 'g');
export function withoutTaskIds(text) {
  return String(text == null ? '' : text)
    // "(blocked on 10-3-0001)" names only ids: say what it means instead.
    .replace(BLOCKED_ON_IDS, '(waiting on another step)')
    .replace(TASK_IDS, ' ').replace(/\s+/g, ' ').trim();
}

const idOf = s => (s == null || s === '' ? null : String(s));

// The record for one state. Pure. An unknown kind is idle, and an idle record
// carries no text. `since`, given only for a wait, is when the waiting began:
// `at` stays the time of the write, so the other-session age check still
// reads how fresh the record is. `hold`, given only by a Stop hook that refused
// the Stop, names that Stop (lib/band.mjs `stopKey`), so the other Stop hook
// running beside it leaves the line alone.
export function bandRecord({ session = null, kind, text = '', now = new Date(), since = null, hold = null } = {}) {
  const k = BAND_KINDS.includes(kind) ? kind : 'idle';
  const rec = { session: idOf(session), kind: k, text: k === 'idle' ? '' : bandClip(text), at: new Date(now).toISOString() };
  if (since != null && k === 'working' && Number.isFinite(Date.parse(since))) rec.since = new Date(since).toISOString();
  if (hold && k === 'working') rec.hold = String(hold);
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
  if (typeof rec.hold === 'string') out.hold = rec.hold;
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
// `working` is whether a turn of this session is running right now (the band's
// slot says so, `isWorking`); false hides this session's own "Working on" line,
// since a turn the user stopped with Esc ends with no Stop to rewrite it. Left
// out (a host that does not say), the line shows as written. A wait is written
// at a Stop, between turns, and shows either way.
//
// Whose record it is. The hooks write the id the host gives them, the mod reads
// the id `$.session.id()` gives it, and nobody has checked that the two are the
// same string. So a record is this session's own when the ids are equal or
// either side has none; a record with another id is another session's (or this
// one's under another id, or from before a /clear), shown with "(another
// session)" in front and only while it is at most OTHER_SESSION_MS old, since a
// session that died mid-turn would otherwise leave its line in every later
// session.
//
// Order: this session's own pause, then this session's own line (a question
// waiting for the user, then the work), and only when this session has nothing
// of its own to say, another session's pause and then its line. Another
// session's pause is shown without its keep-going promise, which holds only for
// the session that wrote it.
export function bandLine({ pause = null, band = null, session = null, now = Date.now(), working } = {}) {
  const mine = idOf(session);
  const own = rec => mine == null || idOf(rec.session) == null || idOf(rec.session) === mine;
  // A minute of slack for two clocks that disagree; a NaN age is never shown.
  const recent = rec => { const age = now - Date.parse(rec.at); return age >= -60000 && age <= OTHER_SESSION_MS; };
  const p = pause && !pause.cleared ? pause : null;

  if (p && own(p)) { const said = bandClip(p.text); if (said) return said; }
  if (band && own(band)) { const said = recordLine(band, '', now, working); if (said) return said; }
  if (p && !own(p) && recent(p)) {
    const said = bandClip(String(p.text).split(KEEP_GOING_CLAUSE).join(''));
    if (said) return `${OTHER_SESSION_TAG}${said}`;
  }
  if (band && !own(band) && recent(band)) return recordLine(band, OTHER_SESSION_TAG, now);
  return '';
}

function recordLine(band, tag, now, working) {
  const said = bandClip(band.text);
  if (!said) return '';
  if (band.kind === 'needs') return `${tag}Needs you: ${said}`;
  if (band.kind === 'working') {
    const wait = said === WAITING_TEXT;
    if (!wait && working === false) return '';
    const waited = wait ? waitedFor(band.since || band.at, now) : '';
    return `${tag}Working on: ${said}${waited ? `, ${waited} so far` : ''}`;
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

// What a real prompt leaves for the band, from facts the router already has.
// Pure. The band answers "what is Claude doing right now".
//   request  the prompt's own words when it asks for something (a new request,
//            a question, "keep going until <goal>"), else ''
//   resumes  the prompt only resumes: "continue", "keep going", "go ahead",
//            "try again", or it newly armed keep-going on a goal already pinned
//   open     the next open item (run or project page), or ''
//   goal     the session's goal in the user's words, or ''
// A new request wins over stored text; a prompt that only resumes names the
// stored next item, else the goal; anything else (a thank-you, an "ok", a
// question about where things stand) names nothing, so an older item is never
// claimed as what Claude is on now.
export function bandAtPrompt({ request = '', resumes = false, open = '', goal = '' } = {}) {
  if (request) return { kind: 'working', text: request };
  if (resumes) return { kind: 'working', text: open || goal || '' };
  return { kind: 'working', text: '' };
}

// What a Stop leaves for the band, from facts the hook already has. Pure.
//   continued  the Stop was refused, so the turn goes on
//   question   the last message's closing question, or null
//   waiting    the loop passed the Stop because a helper or command is still out
//   turn       what the turn that goes on is about (lib/band.mjs `turnText`)
// A turn that goes on is work whatever the last message said; a question the user
// has to answer comes before a wait; anything else is idle.
export function bandAtStop({ continued = false, question = null, waiting = false, turn = '' } = {}) {
  if (continued) return { kind: 'working', text: turn || '' };
  if (question) return { kind: 'needs', text: question };
  if (waiting) return { kind: 'working', text: WAITING_TEXT };
  return { kind: 'idle', text: '' };
}
