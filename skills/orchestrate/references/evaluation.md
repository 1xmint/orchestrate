# Evaluation: judging what comes back

An agent's report is evidence, not a verdict. Grade from artifacts you inspected
and commands you ran or had run for you.

## Check the return

Schema complete, `RESTATED` matches the objective, `STATUS` supported by the
body, `CHANGED` inside the allowed files. No `EVIDENCE` means `Failed`. A
`RESTATED` that drifts means the packet was unclear: fix the packet, not the
agent. A forbidden file changed is a `FAIL` whatever the outcome, because the
next task assumed it was stable.

## Verify

Run the packet's verification commands in the real worktree, output cut to what
decides it (`… 2>&1 | tail -20`, or a failures-only filter). Then `git diff
--stat` and `--name-only` against the base, and compare what the agent claimed
against what the tree shows. Hand the run to `Explore` on haiku only when the
filtered output is still long or the suite is slow. The ledger already saved the
full return under `<run dir>/returns/`; read that file, not the conversation.

The gate is in `<repo>/.orchestrator/gate.json`, written by `scripts/gate.mjs`
from, in order: the repo's `AGENTS.md` or `CLAUDE.md` build-and-test lines; a
`justfile` or `Makefile`; `package.json` scripts; `Cargo.toml`; `pyproject.toml`;
the CI workflow. Run exactly those. If none was found, propose the smallest one
and record it in the ledger.

## Grade

`ledger.mjs` pre-fills the row: 🔍 for a `DONE` claim, ◐ for `PARTIAL`, ⛔ for
`BLOCKED`, plus attempts, the saved return path and token usage. It never writes
✅. You do, after checking, because a `DONE` claim is a claim.

Every task lands in exactly one state:

- **Done**: verified by you or a reviewer, never only by its author.
- **Built-unverified**: the change exists; the runtime or visual proof does not.
- **Partial**: some rubric items pass; each failing item is listed.
- **Blocked**: a named external boundary (credential, money, publish, a
  destructive action, a decision only the user owns).
- **Failed**: a required check failed; the literal error is kept.

Claims inside a report grade too: `PROVED` (a command or type holds it),
`CHECKED` (inspected once), `CONDITIONAL(on what)`, `OBSERVED` (seen, not
reproduced), `SPECULATION`. Only the first two count toward Done.

Hold each property at the cheapest rung that holds it: a type or a tool
restriction, then one mechanical check, then a test for a behaviour, then prose.
Never test what a type already guarantees.

Then the drift check: a "while I was here" refactor, a changed default, an added
dependency, a test weakened to pass. Any of those is a `FAIL` with a named
revert, even when the main change is good.

## Independent review

Required for security, auth, payments, a public surface, a schema or default
change, an irreversible action, a cross-module architecture change, or two
competent results that disagree. `orch-reviewer`, read-only, on a model no
weaker than the author's. Give it the objective, the packet, the diff and the
evidence, not your summary of them.

One reviewer, not two. A second is warranted only when the first verdict is
itself in doubt. A conditional pass is a `FAIL` with the exact edit named. An
unavailable reviewer is reported, never silently skipped. Your own read is a
check in addition to the reviewer, never instead of it.

Findings are numbered so a fix packet can be scoped to them. Only correctness
and the stated requirements count; the rest is reported as optional.

## When it is not right

| Failure class | How to tell | Response |
|---|---|---|
| Context gap | agent guessed something the packet could have stated | add the fact; resend to the same model |
| Capability gap | complete packet, wrong or shallow result, restatement was right | escalate one model step |
| Too big | partial result, budget exhausted, many files | split into tracer bullets; dispatch the thinnest slice |
| Environment block | missing tool, credential, service down | fix the environment or report the boundary; do not retry |
| Ambiguity | restatement differs from objective | rewrite the objective; ask only if two readings are both plausible |
| Overreach | forbidden files, widened scope, changed defaults | revert the overreach; resend with a tighter NOT IN SCOPE |

Never resend the same packet. Three attempts per task, then stop and report with
the evidence and the failure class. When a failed attempt left useful work,
repair from the diff rather than starting over.

## When a loop is worth another round

Evidence and citations: `docs/research/0004-loops-and-stopping.md`.

- **A round needs an external judge**: a test, a command, or a reviewer with its
  own criteria. Self-critique with no outside signal is unreliable and can make
  an answer worse.
- **A reviewer's FAIL that contradicts the author escalates the author**, it
  does not resend. A confidently wrong model resists correct feedback.
- **No progress in three rounds, or the same error twice, ends the loop** with
  the evidence.
- **A loop making no tool call for several turns is stopped.**
- **A second research wave needs something measurable that could change.**
- **The run is done when the done-when evidence exists and has been seen.** A
  limit reached ends it cleanly at a written ledger, not mid-dispatch.

`models.md` has the rule on verification instructions, which points in opposite
directions on different models and must never be carried across a switch.

## Integrate

Merge in dependency order. Focused gates per branch, the full gate at the merge
point. Resolve conflicts by intent, not by picking a side. `gh pr merge --auto`
where branch protection exists, instead of watching CI.

## Preserving work

- Changes you did not make are someone else's work. Never reset, clean, stash or
  checkout over them.
- Label a suspect artifact `bad-stale-<name>` and keep it. Do not delete it.
- A dead or hung agent is relaunched for its remainder only. Check the
  worktree's file times and `git log` first: a harness notification that a
  wrapper stopped is not proof the work stopped.
- Unpushed commits in a worktree are invisible to recovery, which is why packets
  say "push after each unit".

## Research results

Graded by source distance and counterexample search, not by confidence.
`REFEREED`, `REFUTED`, `GAP` are valid grades. A renamed obstacle is not
progress.

`RUN.md` on disk is enough state. Graph checkpointing earns its overhead only
with genuinely independent parallel tracks, real branching, or a partial run
worth recovering. The day the flat file stops being enough will show up as a
recovery that cannot be done from it.
