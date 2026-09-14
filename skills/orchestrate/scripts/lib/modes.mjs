// lib/modes.mjs — what the host's actual permission mode means for the work.
//
// Hooks read `permission_mode` from every payload. They never pretend to change
// it: entering Plan mode is the user's switch in the app, and a hook that says
// "you are now planning" without the host agreeing would only mislead. What a
// hook can do is notice the mode the host reports and say, once per change,
// what that mode asks of the lead and its helpers.

export const MODES = new Set(['default', 'plan', 'acceptEdits', 'auto', 'dontAsk', 'bypassPermissions']);

export const PLAN_NOTE = '[orchestrate · plan mode] The host is in Plan mode. Inspect before deciding. Helpers do read-only work and return findings inline: no implementation, no worktrees, no progress files. Only you maintain the plan. Produce one grounded plan: scope, decisions, dependencies, and acceptance checks.';

export const APPROVED_NOTE = '[orchestrate · plan approved] Plan mode has ended. If the plan was approved, execute it as written. Do not restart discovery unless new evidence changes the approach.';

export function modeOf(input) {
  const m = input && typeof input.permission_mode === 'string' ? input.permission_mode : null;
  return m && MODES.has(m) ? m : null;
}

// The note for a change of mode, and the mode to remember. An unreported mode
// changes nothing, so a host that omits the field is never told it left Plan.
export function modeTransition(prevMode, mode) {
  if (!mode || mode === prevMode) return { note: '', mode: prevMode || mode || null };
  if (mode === 'plan') return { note: PLAN_NOTE, mode };
  if (prevMode === 'plan') return { note: APPROVED_NOTE, mode };
  return { note: '', mode };
}

// Applies the transition to a session state object in place.
export function modeNote(state, input) {
  if (!state) return '';
  const t = modeTransition(state.mode || null, modeOf(input));
  state.mode = t.mode;
  return t.note;
}
