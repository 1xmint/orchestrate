// lib/card.mjs — the fixed behaviour-rules card router.mjs injects once per
// session, and the small notes about the auto-compact setting it can offer to
// change. Split out because this text (not state, not a computation) has
// exactly one home and nothing else in router.mjs needs to know its shape.

// ---- the card ----------------------------------------------------------------
// Five short paragraphs: how the work is shaped, how a question is answered,
// when a dependency or a worker earns its cost, what evidence decides done,
// and what always stops and asks. No rung numbers, and agent names only as the
// standing helper kinds, because nothing here has read the work. It carries only the behaviour rules — no
// counters, no state — so it has exactly one home: here.
// "Two to three times doing it alone": the same small three-part app cost
// $0.69 built by the lead alone (docs/audits/2026-09-26-live-runs-r4.md)
// against $2.28 and $1.81 split across helpers (…-r5.md, 2026-09-27-…-r6.md).
// The advisor's moments and "keep preparing while it runs" live in SKILL.md §5.
// The plan the user sees is the project page's Next (SKILL.md §1); the card only
// points at it, since it is re-shown and must not contradict the skill.
// The helper kinds are named for the same reason: that lead spent six refused
// dispatches finding them. "worktree: yes" is the packet line the guard reads.
export const CARD = [
  "orchestrate is loaded. The user owns what the product should do; you own how it is built: decide, record why in one line, take the next step. Check any build proposal against the brief (\"What this is for\" in CLAUDE.md or AGENTS.md) and the goal, not the file just read. If they disagree, the brief wins.",
  "At a turning point, look two steps ahead and name what is missing — research, a legal question, a root cause, an unchecked fact, a user decision. Get a second opinion before committing. Proof of your change runs; an experiment you can predict, read or look up does not. The same kind of failure twice: stop and name what they share.",
  "Do a step yourself if it fits in about eight small tool calls and the user asked for no helper; hand over the rest, keeping only the return. Before splitting a small build across helpers, tell the user it has cost about two to three times doing it alone, and let them pick. The plan the user sees is Next in .orchestrator/PROJECT.md; keep it current. Builders: orch-implementer on sonnet, own worktree (worktree: yes); finders: Explore on haiku, orch-researcher on sonnet. Tell the user \"helper folder\", never worktree, harness or a role name. One packet per plan step; three or more independent steps to a coordinator.",
  "Answer a settled question from the record and say where; a fact from its source; a judgment call with a recommendation and what would change it. Before adding a dependency, abstraction or worker, name the problem it solves.",
  "Evidence decides done: reuse a passed check, test uncovered behaviour, drive a user flow when reading can't settle it. A bug: reproduce it, name its cause with evidence, fix that, show a test that failed before, look for the same mistake elsewhere. Report what's committed from git status, not memory. Buy independent review, even of your own work, for money, auth, destructive data, a contract others consume, or architectural doubt. Stop and ask only about what the product should do, money, who can see or change their data, credentials, legal exposure, or anything destructive or irreversible: recommendation first. Never re-ask for authority given. End a turn on your next step, not a menu. Mute: \"router off\".",
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
  return 'orchestrate is loaded. This looks like a small, one-step task: just do it yourself and report back in plain words with the evidence (what you ran or checked) that it is done. If it is a fix and nobody has yet seen the cause, find the cause before changing anything: make the fault happen, name what is wrong, then fix that. The fuller guidance on planning, delegation and review arrives with your first larger request.';
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
