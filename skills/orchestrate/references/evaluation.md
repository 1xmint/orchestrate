# Evaluation: judging what comes back, and what to do when it is not right

An agent's report is evidence, not a verdict. The orchestrator grades from
inspected artifacts and commands it ran or had run on its behalf.

## 1. Receipt check (thirty seconds, before anything else)

1. The return follows the schema. No `EVIDENCE` section means `Failed`.
2. `RESTATED` matches the objective. If not, the packet was unclear; fix the
   packet, not the agent.
3. `STATUS` is one of `DONE | PARTIAL | BLOCKED`, and the body supports it.
4. `CHANGED` lists only allowed files. A forbidden file changed is a `FAIL`
   regardless of outcome, because the next task assumed it was stable.

## 2. Verify

Filter first, delegate second. Run the packet's verification commands in the
real worktree with the output cut to what decides the result: `… 2>&1 | tail
-20`, or a failures-only filter (`grep -A 5 -E '(FAIL|ERROR|error:)' | head
-100`). That costs a few hundred tokens in this conversation. Only when the
filtered output is still long, or the suite is slow, hand the run to `Explore`
on haiku (it has Bash and cannot edit) and take back the last 20 lines. Then
`git diff --stat` and `git diff --name-only` against the base. Compare what the
agent claimed with what the tree shows. The ledger hook has already saved the
agent's full return under `<run dir>/returns/`; read that file, not the
conversation, when you need the whole thing.

The gate comes from `<repo>/.orchestrator/gate.json`, written by
`scripts/gate.mjs` when the ledger is created (sources, in order: the repo's
`AGENTS.md` or `CLAUDE.md` build-and-test lines; a `justfile` or `Makefile`;
`package.json` scripts; `Cargo.toml`; `pyproject.toml`; the CI workflow under
`.github/workflows`). Run exactly those commands. If the script found no gate,
propose the smallest one, record it in the ledger, and use it for the rest of
the run.

## 3. Grade

The ledger hook pre-fills the row when a return lands: phase 🔍 for a `DONE`
claim, ◐ for `PARTIAL`, ⛔ for `BLOCKED`, the attempt count, the path of the
saved return, and the agent's token usage. It never writes ✅. You do, after
the check below; a `DONE` claim is a claim.

Every task lands in exactly one state:

- **Done**: integrated and verified by the orchestrator or a reviewer, never
  only by its author.
- **Built-unverified**: the change exists; the runtime or visual proof does not.
- **Partial**: some rubric items pass; each failing item is listed.
- **Blocked**: a named external boundary stops it (credential, money, publish,
  destructive action, a decision only the user owns).
- **Failed**: a required check failed; the literal error is kept.

Grade claims inside a report too: `PROVED` (a command or type holds it),
`CHECKED` (inspected once), `CONDITIONAL(on what)`, `OBSERVED` (seen, not
reproduced), `SPECULATION`. Only `PROVED` and `CHECKED` count toward Done.

Prove, do not measure: hold each property at the cheapest rung that holds it.
A type or a tool restriction first; one mechanical check second; a test only
for a behaviour; prose last. Do not ask an agent to test what a type already
guarantees.

## 4. Drift check

Does the result move the goal, with no silent scope change? Common drift:
a "while I was here" refactor, a changed default, a dependency added, a test
weakened to pass. Any of these is a `FAIL` with a named revert, even when the
main change is good.

## 5. Independent review

Required when any of these is true: security, auth, payments, a public
surface, a schema or default change, an irreversible action, a cross-module
architecture change, or two competent results disagree. Use `orch-reviewer`
with read-only tools and, where the tier allows, a different model from the
author. Give the reviewer the objective, the author's packet, the diff, and
the evidence, not your summary of them.

For the highest-risk class (security, auth, payments, public, irreversible),
use two reviewers with fresh context. Both must `PASS` on the same commit. A
conditional pass is a `FAIL` with the exact edit named. An unavailable reviewer
is reported and the gate stays open; it is never silently skipped. Your own
read is a third check, not a substitute.

Reviewers judge two axes: does it meet the objective; does it meet the repo's
standards. Findings are numbered so a fix packet can be scoped to them. A
reviewer asked to find gaps will find some; only correctness and the stated
requirements count, the rest is optional and is reported as such.

When a research or audit result must be cross-checked at scale (many files,
many sources), a dynamic workflow does the cross-check without any of it
entering this conversation; hand the user the one-line prompt from `lanes.md`.

## 6. When it is not right: name the failure, then act

| Failure class | How to tell | Response |
|---|---|---|
| Context gap | agent guessed something the packet could have stated | add the fact; resend to the same model |
| Capability gap | complete packet, wrong or shallow result, restatement was right | escalate one model step (see routing) |
| Too big | partial result, budget exhausted, many files | split into tracer bullets; dispatch the thinnest slice |
| Environment block | missing tool, credential, service down | fix the environment or report the boundary; do not retry |
| Ambiguity | restatement differs from objective | rewrite the objective; one question to the user only if two readings are both plausible |
| Overreach | forbidden files, widened scope, changed defaults | revert the overreach from the diff; resend with a tighter NOT IN SCOPE |

Never resend the same packet. Three attempts per task, then stop and report
with the evidence and the failure class. When a failed attempt left useful
work, repair from the diff rather than starting over.

## 7. Integrate

Merge into the integration branch in dependency order. Run focused gates per
branch and the full gate at the merge point. Resolve conflicts by intent, not
by picking a side. Use `gh pr merge --auto` where branch protection exists
instead of watching CI.

## 8. Preserving work

- Treat changes you did not make as someone else's work. Never reset, clean,
  stash or checkout over them.
- Label a suspect artifact `bad-stale-<name>` and keep it; do not delete it.
- A dead or hung agent is relaunched for its remainder only. Before concluding
  it is dead, check the worktree's file times and `git log`; a harness
  notification that a wrapper stopped is not proof the work stopped.
- Unpushed commits in a worktree are invisible to recovery. Packets say
  "push after each unit" for this reason.

## 9. Research results

A research answer is graded by its source distance and its counterexample
search, not by its confidence. `REFEREED`, `REFUTED`, `GAP` are valid grades.
A renamed obstacle is not progress. Before a second research wave, name the
measurable thing that could change; if nothing could, stop.
