# Next phase after 0.19.0 (draft for the owner to agree)

Evidence: this session only, the first live run of 0.19.0
(`docs/audits/2026-10-01-live-session-notes-0.19.0.md`, notes A-R). One exception, marked where
it appears: note P was found while reading an older session, and the code behind it is unchanged in
0.19.0. Grading rubric: the owner's
ideal-agent personality, each trait turned into something a hook, a test or an eval can see. The
adjectives themselves go into no prompt (Decisions, RUN.md).

## The five steps, in order

### 1. Talk like a person, and draw when the shape is the point (notes K, R) — elegant, calibrated

What the owner sees: replies that flow ("because", "so", "which means") instead of clipped lines,
and a real drawn diagram when the answer is steps, a flow, a before and after, or a choice.

- plain.md: replace "One idea per sentence" with the connected-sentences rule, and add the drawing
  rule from `0007-explaining.md` part 3, amended: "if you have a tool that draws beside your reply,
  use it; never Mermaid" (note R: Mermaid shows as text in the desktop app).
- Held by: the `explain-flow` eval (`0007-explaining.md` part 4): a picture on the login question,
  none on the port question, no Mermaid, under a third of sentences shorter than six words.
- Cap: $6, written before the run.

### 2. Keep the owner's goal in their own words (notes Q, N) — farsighted, calibrated

What the owner sees: the plugin stays on what they asked for, and a correction like note Q's is not
needed.

- `run-init.mjs`: the run's Goal is the owner's message quoted; the lead's reading sits under it,
  labelled as a reading. The card's goal check then compares against the owner's words, not the
  lead's paraphrase.
- The compaction checkpoint records the newest owner message, including one sent mid-turn (note N;
  first find which record type a mid-turn message is stored as).
- Held by: unit tests on run-init output and on the checkpoint builder with a mid-turn record.
  These show the quote is kept, not that drift is caught; the card's goal check is still prose, so
  the step-5 eval adds a drift case (a side task tempting the lead away from the asked goal).

### 3. Authority given once stays given (notes L, M) — autonomous

What the owner sees: "use as many Opus helpers as you need" works for the whole run, without asking
again.

- `router.mjs`: when a model name comes with scope words ("however many", "all", "every", "for this
  run"), record the grant for the bound run, not one task. `guard-agent.mjs` `grantCheck` honours a
  run grant. A plain model name keeps today's per-task rule.
- One line to the owner the first time they ask for an effort level: helpers run at the session's
  effort; it cannot be set per helper (note M).
- Held by: router and guard unit tests for both forms. A guard change, so one independent review on
  Opus before merge (AGENTS.md).

### 4. Hook lines that are true and short (notes E, J, P, D, I) — rigorous

What the owner sees: nothing directly; the lead stops being told wrong things, so it stops learning
to ignore the lines.

- E: "tool calls since your last edit" only after an edit exists.
- J: the dispatch line gives the lead the size and the price; the helper's fallback instruction moves
  into the packet.
- P (found in an older session; the code is unchanged in 0.19.0): in plan mode, a plan file counts as a checkpoint only if this session's transcript names it
  (`planFilePath`), not the newest file in the shared plans folder (`lib/context-advice.mjs:129-138`).
- D: "latest run" means the newest by date.
- I: drop the Budget and Shape boilerplate from the RUN.md template.
- Held by: one unit test per line.

### 5. Measure, release, and watch again

- Gate: `node scripts/package.mjs --both` and the full test run.
- One `claude plugin eval` against the no-plugin baseline for steps 1-4 together, cap $15 written
  first, including `explain-flow`.
- Release as 0.20.0 only when the owner says so (publishing is their call; agreeing to this plan
  is not that). Then the next live session checks notes K, L, N, Q and R again.

## Not covered, and why

The owner also asked for better root-cause finding, seeing and translating the big picture, and
being better than plain Claude in long sessions. This session produced no evidence on root causes
(no bug was chased), and only a little on the other two: step 1 (drawing) serves the big picture,
step 2 (goal in the owner's words, the checkpoint keeping the newest message) serves long sessions.
The next live run should be a real build in this repo with a real bug in it, so those three can be
watched, not guessed at.

## What this does not do

- No study of other repos or older releases (owner, 2026-10-01).
- No personality adjectives pasted into prompts.
- Note A (card in a scratch folder) and note C (stale goal file) cost nothing seen; left alone.

## Cost

About $21 list price in evals ($6 + $15), plus one Opus review of the guard change. Build work runs
on this plan.
