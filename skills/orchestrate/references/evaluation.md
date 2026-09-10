# Evaluation: judging what comes back

An agent's report is evidence, not a verdict. Grade from artifacts you inspected
and commands you ran or had run for you.

## Read the return

The ledger hook has already saved it whole under `<run dir>/returns/` and added
a line to `returns/returns.jsonl`. Read that file, not the conversation.

Nothing rejects a return for its length or its shape, and nothing sends one back
to be rewritten. A return that arrives verbose, or missing a field, is still the
work; what a missing field costs is certainty, and the answer to that is a grade
of Built-unverified, not a re-run of finished work.

What you do check: does `CHANGED` sit inside the scope the packet gave it, and
does the body support the `STATUS` line. A file outside the scope is a fail
whatever the outcome, because the next task assumed it was stable.

## Prove it, proportionately

The cheapest sufficient evidence is the right one:

- **Reuse what already passed.** Same artifact, same relevant environment, check
  already green: that is evidence, and running it again by ritual buys nothing.
- **Rerun what the change could have broken**, after the change.
- **Add a regression test** when it captures a real behaviour or a real failure
  that nothing else covers. Never test what a type or the compiler already
  proves; hold each property at the cheapest rung that holds it — a type or a
  tool restriction, then one mechanical check, then a test, then prose.
- **Drive a user flow** when reading the code cannot settle whether it works.
- **Run whatever the repo requires to merge**, once, at the integration point.

Filter the output to what decides it (`… 2>&1 | tail -20`, or a failures-only
filter), then `git diff --stat` and `--name-only` against the base, and compare
what was claimed against what the tree shows.

The gate is in `<repo>/.orchestrator/gate.json`, written by `scripts/gate.mjs`
from, in order: the repo's `AGENTS.md` or `CLAUDE.md` build-and-test lines; a
`justfile` or `Makefile`; `package.json` scripts; `Cargo.toml`;
`pyproject.toml`; the CI workflow. If none was found, propose the smallest one
and record it in the ledger.

## Grade

Every task lands in exactly one state:

- **Done**: verified by you or a reviewer, never only by its author.
- **Built-unverified**: the change exists; the runtime or visual proof does not.
- **Partial**: some acceptance items pass; each failing item is listed.
- **Blocked**: a named external boundary (credential, money, publish, a
  destructive action, a decision only the user owns).
- **Failed**: a required check failed; the literal error is kept.

Claims inside a report grade too: `PROVED` (a command or type holds it),
`CHECKED` (inspected once), `CONDITIONAL(on what)`, `OBSERVED` (seen, not
reproduced), `SPECULATION`. Only the first two count toward Done.

You set the row in `RUN.md`. The hook does not, and used to: two returns landing
together each rewrote the whole file and the second erased the first's row.
Setting it yourself is also the only moment anyone has actually judged it.

Then the drift check: a "while I was here" refactor, a changed default, an added
dependency, a test weakened to pass. Any of those is a fail with a named revert,
even when the main change is good.

## Independent review

For the cases where being wrong is expensive and hard to see: an authorisation
or security boundary, money moving, a destructive or irreversible data change, a
compatibility contract other people consume, or architectural uncertainty you
could not resolve. Not for a cosmetic change to a public page, and not because
the author ran on a smaller model than you.

Give the reviewer the concrete risk and the acceptance criteria, not your
summary of the change and not "look for problems". Correctness and the stated
requirements decide the verdict; anything else is reported as optional and does
not, because a reviewer can always find one more improvement and a change that
answers all of them is never finished.

One reviewer, not two. A second is warranted only when the first verdict is
itself in doubt. A conditional pass is a `FAIL` with the exact edit named. An
unavailable reviewer is reported, never silently skipped. Never review your own
edits. After a fix, review the fix, not the whole project again.

## When it is not right

| Failure class | How to tell | Response |
|---|---|---|
| Context gap | agent guessed something the packet could have stated | add the fact; resend to the same model |
| Capability gap | complete packet, wrong or shallow result | escalate one model step |
| Too big | partial result, budget exhausted, many files | split into tracer bullets; dispatch the thinnest slice |
| Environment block | missing tool, credential, service down | fix the environment or report the boundary; do not retry |
| Ambiguity | the agent solved a different problem | rewrite the objective; ask only if two readings are both plausible |
| Overreach | files outside scope, widened scope, changed defaults | revert the overreach; resend with a tighter SCOPE |

Never resend the same packet. Another attempt needs a changed hypothesis,
corrected context, or an actionable finding — not another go at the same one.
Three attempts per task, then stop and report with the evidence and the class.
When a failed attempt left useful work, repair from the diff rather than
starting over.

## When a loop is worth another round

Evidence and citations: `docs/research/0004-loops-and-stopping.md`.

- **A round needs an external judge**: a test, a command, or a reviewer with its
  own criteria. Self-critique with no outside signal is unreliable and can make
  an answer worse.
- **No progress in three rounds, or the same error twice, ends the loop** with
  the evidence.
- **A loop making no tool call for several turns is stopped.**
- **A second research wave needs something measurable that could change.**
- **The run is done when the done-when evidence exists and has been seen.** Then
  stop. Finishing is not a cue to start improving something else.

`models.md` has the rule on verification instructions, which point in opposite
directions on different models and must never be carried across a switch.

## Integrate

Merge in dependency order. Focused checks per branch, the full gate at the merge
point. Resolve conflicts by intent, not by picking a side.

Committing and pushing a worker's branch is durability. Merging, releasing,
tagging and deploying are publication, and they follow the user's authorisation
and the repo's policy — never from the mere existence of a remote. Where they
have authorised a merge and branch protection exists, `gh pr merge --auto`
beats watching CI.

## Preserving work

- Changes you did not make are someone else's work. Never reset, clean, stash or
  checkout over them.
- Label a suspect artifact `bad-stale-<name>` and keep it. Do not delete it.
- A dead or hung agent is relaunched for its remainder only. Check the
  worktree's file times and `git log` first: a harness notification that a
  wrapper stopped is not proof the work stopped.
- Unpushed commits in a worktree are invisible to recovery, which is why packets
  say "push after each unit".
- A return that no run owns is written to `~/.claude/orchestrate/returns/<session>/`
  and named in the hook's note. Nothing is dropped because the attribution was
  ambiguous, and nothing is guessed into the wrong ledger either.

## Research results

Graded by source distance and counterexample search, not by confidence.
`REFEREED`, `REFUTED`, `GAP` are valid grades. A renamed obstacle is not
progress. A count of searches is not a measure of how well something is
answered: two failed fetches are two requests and zero sources.

`RUN.md` on disk is enough state. Graph checkpointing earns its overhead only
with genuinely independent parallel tracks, real branching, or a partial run
worth recovering. The day the flat file stops being enough will show up as a
recovery that cannot be done from it.
