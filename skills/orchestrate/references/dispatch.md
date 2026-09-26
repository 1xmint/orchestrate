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

A return that used every turn its role allows is **partial**, whatever it says;
the ledger marks it and you are told once. Check what its evidence shows is
done, then dispatch only the remaining work as a fresh, smaller packet from its
PROGRESS file and branch. Do not keep resuming a large helper: every step it
takes re-reads its whole grown context.
