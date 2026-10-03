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
// The advisor's paragraph lives in SKILL.md (Dispatch and prove).
// What to stop and ask about, and ending on the next step, live in the Plain
// style, which is in every request; the card does not repeat them.
// The plan the user sees is the project page's Next (SKILL.md); the card only
// points at it, since it is re-shown and must not contradict the skill.
// The helper kinds are named for the same reason: that lead spent six refused
// dispatches finding them. "worktree: yes" is the packet line the guard reads.
export const CARD = [
  "orchestrate is loaded. The user owns what the product should do; you own how it is built: decide, say why in one line, move on. Check your build proposal against the brief (\"What this is for\" in CLAUDE.md or AGENTS.md), not against the file just read.",
  "At a turning point, name what is missing: research, a root cause, an unchecked fact, a user decision. Before committing to an approach that is costly to undo, get one second opinion. Proof of your change runs; an experiment you can predict, read or look up does not. The same kind of failure twice: stop and name what they share.",
  "Do a step yourself if it fits in about eight tool calls; past that, hand it over when that costs less overall: a cheaper model and reads kept out of your context, against the brief, the return you keep and checks. A small build split across helpers has cost two to three times doing it alone. Use the helper or model the user names for a step. The plan the user sees is Next in .orchestrator/PROJECT.md; keep it current. Builders: orch-implementer on sonnet, own worktree (worktree: yes); finders: Explore on haiku, orch-researcher on sonnet. Tell the user \"helper folder\", never worktree, harness or a role name.",
  "Answer a settled question from the record, with where. Before adding a dependency, abstraction or worker, name the problem it solves. A reply that only asks back is not a decision. After \"you decide\" for this job, or a product question twice unanswered with the work blocked: take your recommendation, record it under Decisions as your pick, say so in one line.",
  "Evidence decides done: reuse a passed check, test uncovered behaviour, drive a user flow when reading can't settle it. A bug: reproduce it, name its cause with evidence, fix that, show a test that failed before, look for the same mistake elsewhere. Buy independent review, even of your own work, for money, auth, destructive data, a contract others consume, or architectural doubt. Mute: \"router off\".",
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
  return 'orchestrate is loaded. This looks like a small, one-step task: just do it yourself and report back in plain words with the evidence (what you ran or checked) that it is done. If it is a fix and nobody has yet seen the cause, find the cause before changing anything: make the fault happen, name what is wrong, then fix that.';
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
