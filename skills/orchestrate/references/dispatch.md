# Dispatch details: coordinator, Codex workers, second opinion, hand-off, the guard

## The coordinator in full

Send a wave to `orch-coordinator` when it has at least three independent
tasks with `OWNS` and `DONE WHEN` already filled in, or when one plan step
has independent parts you would otherwise dispatch one by one. It dispatches
bounded workers, grades each return, integrates branches in dependency order,
runs the gate once, and returns one summary with evidence paths. Do not use
it for one task. The lead keeps one packet and one return for the wave and
can grade another return while it runs. The coordinator still re-reads its
own context, at a real but modest cost per wave, roughly neutral on quota.

## Setting up the Agent call

`subagent_type` the role, `model` from the table, `isolation: "worktree"` for
concurrent repo work, `run_in_background: true` unless the next step needs
the result, `prompt` the packet. Only `orch-coordinator` may dispatch a
child, and only the bounded roles the guard allows. Other role agents cannot
dispatch. Built-in `general-purpose` has no turn cap, so while the role
agents are installed the guard sends you to the capped role instead.

A helper's own folder starts from the remote's default branch, not from the
branch you are on, unless the user's `worktree.baseRef` setting is `"head"`
(code.claude.com/docs/en/worktrees, checked 2026-10-03). So the packet's WHERE
names the base as `branch @ sha` from `git rev-parse HEAD`, and the builder
and debugger move onto it before their first change. Changing that setting is
the user's call: it is in their settings, and it changes every worktree they
make.

## The FOR line and the top of a return

Every author packet carries `FOR:`, what the whole job is for and what done
looks like to the user, in one or two lines of your own plain words. It comes
from the run's goal when there is one; otherwise from the user's request as you
would say it. A helper that knows only its own file cannot tell the user what
its work meant.

A helper hands back five lines only, under 600 B: OUTCOME, PROOF, NOT CHECKED,
NEEDS A DECISION, FULL REPORT; the long report stays in its file. Read them; tell the user OUTCOME in terms of their
goal. Anything a helper did outside its allowed files, or any file it wrote
outside its own folder, belongs under NEEDS A DECISION, never at the bottom.
OUTCOME opens with DONE, PARTIAL or BLOCKED. The file holds the parsed labels
(TASK, STATUS, CHANGED, EVIDENCE, NOT VERIFIED).

## Codex workers

Codex for workers until it runs out; Claude for judgment and for what Codex
cannot reach. Planner work, browser work, and anything needing this session's
MCP tools or permissions stays on Claude.

Write the worker packet under `<run dir>/packets/`. Start this command in the
background, always naming the model and effort:

`node "${CLAUDE_SKILL_DIR}/scripts/codex-worker.mjs" run --packet <file> --repo <dir> --task <id> --run <run dir> --model <id> --effort <level> [--approved]`

`gpt-6-astra` needs the user's approval for every dispatch; `--approved` records
that approval. Monitor the process until it exits. Then read
`<run dir>/workers/<task>/report.json`, grade it against `DONE WHEN`, commit the
worktree branch, and merge it. A partial or failed return gets only the
unfinished work in its next packet. Once Codex reports anything other than a
clean success — unavailable, auth-failed, blocked or quota-exhausted — use the
Claude fallback in `routing.md`; do not try Codex again in the same wave. Never
send a Claude helper into a worktree a Codex worker still holds. The guard
refuses it.

## The packet template

`assets/packet.md` is the template. Four fields always — the task and its
objective, the context and decisions it needs, the scope boundaries, the
evidence that means done — and the rest only when they apply. With a map, add
MAP and the `tests-for` lines for the files in scope: finding its way was a fifth
of what past helpers read. A field that stops nothing is cost with no benefit.

## Continuing an agent: SendMessage vs. a fresh dispatch

A dispatch's result carries the agent's id; keep it. To continue that agent
with a short delta — a reviewer's finding for the implementer that produced it —
`SendMessage` the id while its cache is warm: within about five minutes of its
last step, for two or three more steps. After that, or for anything longer,
dispatch fresh with the diff, the finding and its PROGRESS file: a cold resume
re-writes the agent's whole grown context at full price (`models.md`). Start
fresh too when the model must change or the earlier attempt would bias it.

**Second opinion.** For work that is hard to check and expensive to get
wrong, send a second model the first's written findings: packet field
`BUILDS ON: <path>`, with "read it, judge where it is thin or wrong, go
deeper there, do not repeat; return agreed / disputed / added". Reserve it
for that kind of work — it doubles the cost of the task.

**Hand-off.** Between rounds, dispatch fresh from a written brief: a round-1
agent can be compacted before round 2, and only a file survives that. Inside
the warm window, first `SendMessage` it "write your hand-off to `<file>`:
keep x, y, z".

## Do not wait on a background dispatch when other work is ready

This is not a reason to split work up more finely: it is only the case where
the plan already settled that two things are independent, and waiting anyway
costs quota and buys nothing. The router names the ready ids when there are
any. If the right answer really is to wait, wait.

## The guard's refusals

The guard refuses, with the exact retry, an executor above Sonnet before a real
attempt at the same task, an `Explore` without a cheap named model, a fork of a
large conversation, Fable on a plan without it, any new helper near the user's
usage limit, a helper starting a helper, a third concurrent worker, and in Plan
mode any helper that could write, a worktree or a PROGRESS line. A refusal
costs one step; send what it says.

## Partial returns

A return that used every turn is **partial**, whatever it says; the ledger
marks it and you are told once. Check what its evidence shows is done. If
what is left is small, `SendMessage` the agent's id while its cache is warm
(about five minutes), the same move as any other continue. Otherwise dispatch
only the remaining work as a fresh, smaller packet from its PROGRESS file and
branch: a cold resume re-reads its whole grown context at full price.

The cap stops the helper mid-call with no report, so work that lives only in
its working tree is at risk of being left uncommitted. A packet for a code
change says so up front: commit each piece as its check passes, and stop
adding at about three quarters of the step cap to make the gate green, commit
and return. What a helper committed is recovered from its worktree in one
step; what it left unstaged is recovered by hand.

## Before you send

- Classify first. A fix whose cause nobody has named is a fault-finding task
  (`orch-debugger`); it becomes a build only once the cause is written down.
- Pilot one. Before sending several helpers on the same kind of task, send one
  and read its return: a brief that fails then fails once, not five times.
- Few, with room. Every helper pays a fixed starting cost before its first
  read, so a few helpers with room to finish beat many small ones. Use the
  cheapest model that can do the task; routine probing is not judgment.
- A finish line. When a run opens, write under "Done when" what ends the work
  if the measure stalls or the judge disagrees with itself.
- A check that checks. Before sending a checking task, write for each item the
  input that makes it come up; an item with no such input is reported as not
  checked.
