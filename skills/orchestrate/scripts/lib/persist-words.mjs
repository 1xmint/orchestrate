// lib/persist-words.mjs — the one place router.mjs still reads wording: an
// explicit ask to keep going toward a goal, telling that apart from a prompt
// the host or another session wrote rather than the user, and the line said
// while auto-continue is armed. Split out because it is a self-contained
// concern with its own regexes, not because it shares code with the rest.

import { NEW_GOAL_VERB } from './resume.mjs';

// ---- persistence intent -----------------------------------------------------
// Kept deliberately narrow: an explicit ask to keep going toward a goal,
// never the shape of the work. A false arm is cheap, because persist-check.mjs
// stops on the first step that does no work. A question never arms it, and
// "persist off" turns it off for the session.
export const PERSIST_INTENT = /\b(keep (going|coding|working|building|at it)|don'?t stop|until (it'?s |it is |they'?re |the [\w-]+( [\w-]+)? (is|are) |everything is |all (of it |of them )?(is |are )?)?(done|finished|complete|working|green|passing|shipped|live)\b|(execute|implement|carry out|work through|finish) (the|this|that|my) (whole |full |entire |rest of the )?(plan|roadmap|spec|checklist|task list|todo list|backlog)|finish (it|everything|all of it|the rest)\b|build (out )?the (whole|entire|full) )/i;

// A prompt the host or another Claude session wrote, not the user typing:
// a background task's completion notice, a helper's hand-back, or a message
// relayed from another session. The text is the only signal the hook payload
// carries for this. Checked against the first non-blank line, because a
// hand-back's own marker line ("[Subagent hand-back]") sometimes follows an
// opening `<agent-message ...>` tag rather than starting the prompt.
// Seen live: a finished helper's hand-back became the persist goal.
const SYNTHETIC_OPEN = /^\s*(\[SYSTEM NOTIFICATION - NOT USER INPUT\]|<task-notification>|<agent-message|\[Subagent hand-back\]|Another Claude session sent a message|<ci-monitor-event>)/i;

export function syntheticPrompt(text) {
  const lines = String(text || '').split('\n').map(l => l.trim()).filter(Boolean);
  const first = lines[0] || '';
  const second = lines[1] || '';
  return SYNTHETIC_OPEN.test(first) || /^\[Subagent hand-back\]/i.test(second);
}

export function persistIntent(text) {
  const t = String(text || '').trim();
  if (!t || /\?\s*$/.test(t)) return false;
  return PERSIST_INTENT.test(t);
}

// ---- resume, retry and status prompts ---------------------------------------
// Three short intents that are not an "until done" ask. The owner restarted
// work by hand about twelve times with "continue", "resume" or "try again" and
// none of those armed keep-going.
//   status  whats left, where are we, status: never arms, "?" or not.
//   resume  continue, resume, carry on, pick up, go on, keep going, proceed,
//           go ahead: arms only
//           when the router's gate finds an open run (see router.mjs).
//   retry   try again: restores keep-going only if it was on before the stop.
// A resume or retry is 12 words or fewer, names no new goal, and has no word
// that says to hold back.
const STATUS_WORDS = /^(what'?s left|whats left|where are we|status)$/i;
// "proceed" and "go ahead" are how a plan is most often approved; they arm
// nothing without an open run, as for the rest.
const RESUME_WORDS = /\b(continue|resume|carry on|pick up|go on|keep going|keep at it|proceed|go ahead)\b/i;
const RETRY_WORDS = /\btry again\b/i;
const HOLD_BACK = /\b(don'?t|do not|stop|wait|hold|pause|no)\b/i;
const RESUME_MAX_WORDS = 12;

export function promptIntent(text) {
  const t = String(text || '').trim().replace(/[.!?\s]+$/, '').trim();
  if (!t) return null;
  if (STATUS_WORDS.test(t)) return 'status';
  if (t.split(/\s+/).length > RESUME_MAX_WORDS || HOLD_BACK.test(t) || NEW_GOAL_VERB.test(t)) return null;
  if (RETRY_WORDS.test(t)) return 'retry';
  if (RESUME_WORDS.test(t)) return 'resume';
  return null;
}

// True when the prompt is only the ask to keep going ("continue until
// complete"), which names no goal of its own, so it must not be saved as one.
export function barePersistPhrase(text) {
  const rest = String(text || '').replace(PERSIST_INTENT, ' ')
    .replace(/\b(continue|keep going|go on|carry on|resume|please|ok|okay|yes|and|just|now|work|working|the|it|its|it's|until|is|are|done|complete|finished)\b/gi, ' ')
    .replace(/[^\w]+/g, '');
  return rest === '';
}

export const GOAL_CAP = 600;

export function persistLine(persist) {
  if (!persist || !persist.armed) return '';
  const g = String(persist.goal || '').replace(/\s+/g, ' ').trim();
  const lead = g ? `auto-continue is on toward: "${g.length > GOAL_CAP ? `${g.slice(0, GOAL_CAP - 3)}...` : g}"` : 'auto-continue is on; no goal is recorded (the prompt named none and no open run has one)';
  // Said at arming and after each resume or summary while armed. What the hook
  // weighs inside "no work" (a helper refused for usage, a background command
  // out) is the hook's to judge, not the lead's to act on, so it is not spelled
  // out here (prompt review, 2026-10-03: 467 bytes to about 360).
  return `${lead}. A Stop is refused while each step does real work. It ends when you say the goal is met or ask the user something, or on a helper refused by the budget or the credential check, the same error twice, a step that does no work while nothing is out, three continues on the same open item, or 25 steps. A usage limit does not end it. "persist off" turns it off.`;
}
