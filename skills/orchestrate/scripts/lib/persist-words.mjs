// lib/persist-words.mjs — the one place router.mjs still reads wording: an
// explicit ask to keep going toward a goal, telling that apart from a prompt
// the host or another session wrote rather than the user, and the line said
// while auto-continue is armed. Split out because it is a self-contained
// concern with its own regexes, not because it shares code with the rest.

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

export const GOAL_CAP = 600;

export function persistLine(persist) {
  if (!persist || !persist.armed) return '';
  const g = String(persist.goal || '').replace(/\s+/g, ' ').trim();
  return `auto-continue is on toward: "${g.length > GOAL_CAP ? `${g.slice(0, GOAL_CAP - 3)}...` : g}". A Stop is refused while each step does real work; it ends when you say the goal is met, ask the user something, a dispatch is denied, the same error repeats, a step does nothing, or after 25 steps. Waiting on CI or an agent: Monitor it and keep doing independent work. "persist off" turns it off.`;
}
