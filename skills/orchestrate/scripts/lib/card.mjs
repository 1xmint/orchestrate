// lib/card.mjs — the fixed behaviour-rules card router.mjs injects once per
// session, and the small notes about the auto-compact setting it can offer to
// change. Split out because this text (not state, not a computation) has
// exactly one home and nothing else in router.mjs needs to know its shape.

// ---- the card ----------------------------------------------------------------
// Five short paragraphs: how the work is shaped, how a question is answered,
// when a dependency or a worker earns its cost, what evidence decides done,
// and what always stops and asks. No rung numbers and no agent names, because
// nothing here has read the work. It carries only the behaviour rules — no
// counters, no state — so it has exactly one home: here.
export const CARD = [
  "orchestrate is loaded. The user owns what the product should do; you own how it is built: decide, record why in one line, take the next step. Before you propose building anything, check it against what this project is for — the brief (\"What this is for\" in the project's CLAUDE.md or AGENTS.md, and the documents it names) and the goal, not the file you just read. Where they disagree, the brief wins until the user changes it.",
  "At a turning point, look two steps ahead and name what is missing — research, a legal or licence question, a root cause under the symptom, an unchecked fact, a decision that is the user's. Then send orch-advisor your proposal before you commit; its description lists the moments. While it runs, keep preparing whatever does not hang on its answer.",
  "Your context is for judgment. Do a step yourself when it fits in about eight tool calls with small outputs; hand over anything larger and keep only the return. One packet per plan step; three or more independent steps go to orch-coordinator. Change a file with Edit rather than rewriting it, trust a write that did not error, and filter long output before it reaches you. Open a run ledger with a budget when tracks run at once or the work outlives this session.",
  "Answer a settled question from the record and say where; a question about the world from the source that settles it; a judgment call with a recommendation and what would change it. Before adding a dependency, an abstraction or another worker, name the problem it solves now.",
  "Evidence decides done: reuse a check that passed, test real uncovered behaviour, drive a user flow when reading cannot settle it. When you report, say what is committed and what is not, read from git status, not from memory. Buy independent review for money, auth, destructive data, a contract others consume, or architectural doubt you could not resolve. Stop and ask only about what the product should do, money, a public surface, credentials, legal exposure, or something destructive or irreversible: recommendation first. Authority already given is not asked for again. End a turn on the step you are taking, not a menu. Mute this card: type \"router off\".",
].join('\n');

// 1,550 until 0.16.0: the new card measured 2,184, and the cap is that
// rounded up to the next 50. It is paid once per session and once per
// compaction, against a compaction that frees 100k or more.
export const CARD_CAP = 2200;

export function cardBody() {
  return CARD;
}

// A one-sentence prompt with no build word in it ("fix the typo in the
// README") does not need five paragraphs of behaviour rules: the full card
// still arrives on the first request big enough to need it. Kept well under
// SHORT_CARD_CAP so a small ask stays small.
export const SHORT_CARD_CAP = 600;

export function shortCard() {
  return 'orchestrate is loaded. This looks like a small, one-step task: just do it yourself and report back in plain words with the evidence (what you ran or checked) that it is done. The fuller guidance on planning, delegation and review arrives with your first larger request.';
}

// One line in plain words for the write `autocompact on` (or `autocompact
// <N>k`) makes: what changed, that it starts next session, and how to undo
// it. No raw settings path — the user does not need one to act on this.
export function compactNote(compact) {
  const amount = compact.value % 1000 ? compact.value : `${compact.value / 1000}k`;
  const backupClause = compact.backup
    ? 'A copy of your old settings was saved in the orchestrate settings folder first.'
    : 'No earlier settings file existed, so there was nothing to back up.';
  return `Claude Code's auto-compact setting was changed to ${amount} tokens; it takes effect from your next session. ${backupClause} To undo it, type \`autocompact off\`.`;
}

// The one-time tip: offered once, plain words, never a write on its own. Said
// after the state line so it reads as a footnote, not a demand.
export function autocompactTip(value) {
  const amount = value % 1000 ? value : `${value / 1000}k`;
  return `Tip: this plugin works best with Claude Code's auto-compact set to ${amount} tokens. Type \`autocompact on\` to set it (it starts from your next session and \`autocompact off\` undoes it), or ignore this and nothing changes.`;
}

// What `autocompact off` reports: the key is gone (or was already gone) and
// whether a backup of the file exists.
export function autocompactOffNote(result) {
  if (!result.removed) return "Claude Code's auto-compact setting was already off; nothing to undo.";
  const backupClause = result.backup
    ? 'A copy of your old settings was saved in the orchestrate settings folder first.'
    : 'No earlier settings file existed, so there was nothing to back up.';
  return `Claude Code's auto-compact setting was removed; it takes effect from your next session. ${backupClause}`;
}
