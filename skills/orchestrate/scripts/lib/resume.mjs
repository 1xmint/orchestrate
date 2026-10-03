// lib/resume.mjs — bounded excerpts of a run or a checkpoint for a session
// that has lost the thread (resumed, compacted, or picking up someone else's
// ledger), and the "does this prompt mean carry on?" check that decides when
// to show one. Split out because all of it answers the same question: what
// was this session doing, and how much of it is safe to hand back.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { CONTEXT_DIR } from './context-scan.mjs';
import { sanitizeId } from './tier.mjs';
import { formatAgo } from './handoff.mjs';
import { pickupSection, pickupWritten } from './runs.mjs';

// A bounded excerpt of what the run is for, for a session that has lost the
// thread: resumed, compacted, or picking up someone else's ledger. Outcome,
// constraints, current approach and the Pickup line — never the task history,
// which is long, mostly finished, and already on disk.
export const RESUME_CAP = 1200;

// Cuts `text` to at most `cap` characters (plus the trailing `...`), ending at
// the last newline or sentence-ending `.`/`!`/`?` at or before the cut point —
// never past it — so a resumed or compacted session never picks the excerpt
// back up mid-word. Falls back to the raw character cut only when no such
// boundary exists anywhere in the kept window.
export function boundaryCut(text, cap) {
  const budget = cap - 3;
  const window = text.slice(0, budget);
  let cut = window.lastIndexOf('\n');
  const sentenceEnd = /[.!?](?=\s|$)/g;
  let m;
  while ((m = sentenceEnd.exec(window))) cut = Math.max(cut, m.index + 1);
  const body = cut < 0 ? window : window.slice(0, cut);
  return `${body.replace(/\s+$/, '')}...`;
}

// One reader for "a section of this markdown file, capped". `sections` is a
// list of either a heading name (`"## <name>"`, the run-ledger shape) or
// `{ pattern }`, a regex whose capture group 1 is the section body, for a
// heading whose wording is not fixed (the brief's "## What this is for").
// `intro` (default true) prefixes a named section's body with `name: `, the
// way the run excerpt reads; the brief excerpt wants the body alone.
export function sectionExcerpt(md, sections, cap = RESUME_CAP, { intro = true } = {}) {
  const text = String(md || '');
  const section = spec => {
    const name = typeof spec === 'string' ? spec : spec.name;
    const re = (spec && spec.pattern) || new RegExp(`## ${name}\\s*\\n([\\s\\S]*?)(?:\\n## |\\s*$)`);
    const m = re.exec(text);
    if (!m) return '';
    const body = m[1].split('\n').filter(l => l.trim() && !/^<.*>$/.test(l.trim())).join('\n').trim();
    if (!body) return '';
    return intro && name ? `${name}: ${body}` : body;
  };
  const parts = sections.map(section).filter(Boolean);
  let out = parts.join('\n');
  if (out.length > cap) out = boundaryCut(out, cap);
  return out;
}

export function resumeExcerpt(runMd, cap = RESUME_CAP) {
  let text = '';
  try { text = readFileSync(runMd, 'utf8'); } catch { return ''; }
  return sectionExcerpt(text, ['Goal', 'Done when', 'Constraints and non-goals', 'Approach', 'Decisions', 'Pickup'], cap);
}

// A brand-new session that opens with one of these (the whole trimmed prompt,
// nothing else) means "tell me what I was doing", not "start counting steps
// toward a goal" — though it may still do that too (persistIntent matches
// "keep going" on its own).
export const CONTINUE_WORD = /^(continue|keep going|resume|pick up where we left off|where were we|what'?s next|carry on)$/i;

// A short lead phrase that opens a "pick up where we left off" prompt, not
// necessarily the whole prompt (CONTINUE_WORD is the exact-match case; this is
// the looser "starts with" case for a prompt that says a little more).
const CONTINUE_LEAD = /^(continue|keep going|carry on|resume|go on|pick up( where we left off)?|where were we|what'?s next|status|what were we doing)\b/i;

// A "?"-only prompt that asks where things stand without any of the lead
// words above ("where are we?", "what's left?").
const STATUS_QUESTION = /^(where are we|where('?s| is) (this|it|that)|what'?s (left|the status)|how far did we get|what'?s going on|how'?s it going)\s*\??$/i;

// A build verb followed by another word means the prompt names a new goal,
// even when it opens with a continue-word ("continue and add a login page").
// This is the one signal that overrides an otherwise-matching lead phrase.
export const NEW_GOAL_VERB = /\b(build|add|make|fix|create|write|implement|change|remove|update|refactor)\b\s+\S/i;

// True for a prompt that means "tell me what I was doing / keep doing it",
// false the moment it also names a new goal. CONTINUE_WORD is the strict
// exact-match subset of this; everything else here is looser on purpose,
// because a fresh session's first words are rarely typed exactly.
export function continueIntent(text) {
  const raw = String(text || '').trim();
  if (!raw) return false;
  const stripped = raw.replace(/[.!?]+$/, '').trim();
  if (CONTINUE_WORD.test(stripped)) return true;
  if (STATUS_QUESTION.test(raw)) return true;
  if (!CONTINUE_LEAD.test(stripped)) return false;
  if (NEW_GOAL_VERB.test(stripped)) return false;
  const words = stripped.split(/\s+/).filter(Boolean);
  return words.length < 12;
}

// The newest checkpoint file this previous session wrote, if any — same
// layout lib/context-advice.mjs reads from.
export function latestCheckpointFor(sessionId) {
  try {
    const dir = join(CONTEXT_DIR, sanitizeId(sessionId));
    const paths = readdirSync(dir).filter(n => /^checkpoint-.*\.md$/.test(n)).map(n => join(dir, n));
    return paths.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0] || null;
  } catch { return null; }
}

// One line naming what the previous session in this folder was doing and
// where to look for what it left behind: a run's Pickup section when one is
// written, else that session's own checkpoint file, else plain `git status`.
export function handoffLine(prev, ctx) {
  const ago = formatAgo(Date.now() - Date.parse(prev.lastSeen));
  let tail = 'Uncommitted changes, if any, are what it left behind (`git status` lists them).';
  let runText = '';
  if (ctx && ctx.run && ctx.run.runMd) {
    try { runText = readFileSync(ctx.run.runMd, 'utf8'); } catch { runText = ''; }
  }
  if (runText && pickupWritten(pickupSection(runText))) {
    tail = `The Pickup section of ${ctx.run.runMd} has what it left off at.`;
  } else {
    const cp = latestCheckpointFor(prev.session_id);
    if (cp) tail = `${cp} has what it left off at.`;
  }
  return `Your last session in this folder, ${ago} ago, was working on: "${prev.goal}". ${tail}`;
}

export function checkpointExcerpt(session, cap = RESUME_CAP) {
  try {
    const dir = join(CONTEXT_DIR, String(session || 'nosession').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 120));
    const paths = readdirSync(dir).filter(n => /^checkpoint-.*\.md$/.test(n)).map(n => join(dir, n));
    const path = paths.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
    if (!path) return '';
    const text = readFileSync(path, 'utf8').trim();
    return text.length > cap ? boundaryCut(text, cap) : text;
  } catch { return ''; }
}
