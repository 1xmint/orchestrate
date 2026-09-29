// lib/goal.mjs — what this work is for, in the user's words, kept in view.
//
// The lead writes a two-line note (`<project>/.orchestrator/goal.md`: what it is
// for; what done looks like) on the first real request and rewrites it when the
// user changes the goal. This file only reads it, and never guesses one. The
// plugin shows it back as one fact after a compaction, on resume, and on every
// tenth prompt since it was last shown; on any other prompt it adds nothing.
//
// Sources, best first: the open run's Goal and Done when ('ledger'), the note
// ('note'), the session's pinned first request ('first-request', labelled as
// not confirmed). Nothing at all is null. Nothing here throws.

import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { sectionExcerpt } from './resume.mjs';
import { loadSession } from './tier.mjs';

export const NOTE_CAP = 300;   // bytes, both lines together
export const SHOWN_CAP = 350;  // bytes, the whole shown line
export const EVERY = 10;       // user prompts between showings
export const NOTE_REL = join('.orchestrator', 'goal.md');

const PREFIX = '[orchestrate · goal] ';
const DONE = ' Done looks like: ';
const bytes = s => Buffer.byteLength(s, 'utf8');
const flat = s => String(s || '').replace(/\s+/g, ' ').trim();

// At most `cap` bytes, cut at a word boundary and ended with "…"; never
// mid-word (a single word longer than the cap is the one exception).
export function clipWords(text, cap) {
  const t = flat(text);
  if (bytes(t) <= cap) return t;
  const room = cap - bytes('…');
  let cut = '';
  for (const ch of t) { if (bytes(cut + ch) > room) break; cut += ch; }
  const rest = t.slice(cut.length);
  // The cut fell mid-word unless the next character is a space.
  const mid = rest.length > 0 && !/^\s/.test(rest);
  const sp = cut.lastIndexOf(' ');
  const body = mid && sp > 0 ? cut.slice(0, sp) : cut;
  return `${body.replace(/[\s,;:.\-–—]+$/, '')}…`;
}

function mtimeOf(path) { try { return statSync(path).mtimeMs; } catch { return null; } }

// The note's two lines, capped at NOTE_CAP bytes in total. An over-long note is
// clipped, not refused. Unreadable or empty: null.
function readNote(dirs) {
  for (const d of dirs) {
    if (!d) continue;
    const path = join(d, NOTE_REL);
    let raw;
    try { raw = readFileSync(path, 'utf8'); } catch { continue; }
    const lines = raw.split(/\r?\n/).map(flat).filter(Boolean);
    if (!lines.length) continue;
    let one = lines[0], two = lines[1] || '';
    if (bytes(one) + bytes(two) > NOTE_CAP) {
      one = clipWords(one, bytes(two) ? Math.max(60, NOTE_CAP - Math.min(bytes(two), 100)) : NOTE_CAP);
      two = two ? clipWords(two, Math.max(0, NOTE_CAP - bytes(one))) : '';
    }
    return { one, two, mtime: mtimeOf(path) };
  }
  return null;
}

function readLedger(runMd) {
  if (!runMd) return null;
  let md;
  try { md = readFileSync(runMd, 'utf8'); } catch { return null; }
  const goal = flat(sectionExcerpt(md, ['Goal'], 4000, { intro: false }));
  if (!goal) return null;
  const done = flat(sectionExcerpt(md, ['Done when'], 4000, { intro: false }));
  return { one: goal, two: done, mtime: mtimeOf(runMd) };
}

// Age: a note or a ledger is as old as its file, so a note written last week
// says so however new the session is. Only the first request, which has no
// file, is aged in user prompts.
function ageOf(state, key, mtime) {
  if (key !== 'first' && mtime) return { unit: 'minutes', n: Math.max(0, Math.round((Date.now() - mtime) / 60000)) };
  if (state && typeof state.prompts === 'number') {
    const now = state.prompts;
    if (!state.goalMark || state.goalMark.key !== key) state.goalMark = { key, prompts: key === 'first' ? 0 : now };
    return { unit: 'prompts', n: Math.max(0, now - state.goalMark.prompts) };
  }
  return null;
}

// `state`: the session's record when the caller has it in hand (the router does,
// and saves it); otherwise it is loaded read-only from `session`.
export function readGoal({ cwd, root, session, runMd, state } = {}) {
  try {
    let st = state;
    if (!st && session) { try { st = loadSession(session); } catch { st = null; } }
    const src = readLedger(runMd);
    if (src) {
      const one = clipWords(src.one, 180), two = src.two ? clipWords(src.two, 80) : '';
      return { text: two ? `${one}${DONE}${two}` : one, source: 'ledger', age: ageOf(st, `l:${src.mtime}`, src.mtime) };
    }
    const note = readNote([cwd, root]);
    if (note) {
      return { text: note.two ? `${note.one}${DONE}${note.two}` : note.one, source: 'note', age: ageOf(st, `n:${note.mtime}`, note.mtime) };
    }
    const first = st && flat(st.goal);
    if (first) return { text: `first request, not confirmed: ${first}`, source: 'first-request', age: ageOf(st, 'first', null) };
  } catch { /* fall through */ }
  return null;
}

function ageWords(age) {
  if (!age) return '';
  if (age.unit === 'minutes') {
    if (age.n < 1) return 'written just now';
    if (age.n < 60) return `written ${age.n} min ago`;
    const h = Math.round(age.n / 60);
    if (h < 24) return `written ${h} hour${h === 1 ? '' : 's'} ago`;
    const d = Math.round(h / 24);
    return `written ${d} day${d === 1 ? '' : 's'} ago`;
  }
  return age.n === 0 ? 'written this prompt' : `written ${age.n} prompt${age.n === 1 ? '' : 's'} ago`;
}

// The shown form, as one fact and never an order; 350 bytes or fewer.
export function goalLine(goal) {
  if (!goal || !goal.text) return '';
  const a = ageWords(goal.age);
  const tail = a ? ` (${a})` : '';
  return `${PREFIX}${clipWords(goal.text, SHOWN_CAP - bytes(PREFIX) - bytes(tail))}${tail}`;
}

// True on the tenth user prompt since the goal was last shown. `state.prompts`
// counts the prompts already handled, so the one being handled is prompts + 1.
export function goalDue(state) {
  const shown = (state && state.goalShownAt) || 0;
  return ((state && state.prompts) || 0) + 1 - shown >= EVERY;
}

// Marks the goal as shown at the current prompt count (`ahead` = 1 when the
// prompt being handled has not been counted yet).
export function markShown(state, ahead = 0) {
  if (state) state.goalShownAt = (state.prompts || 0) + ahead;
}
