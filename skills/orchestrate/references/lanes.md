# Lanes beyond a hand dispatch

Facts checked 2026-09-08 against code.claude.com/docs (Claude Code 2.1.260 in the desktop
app). Each lane says when it beats dispatching role agents by hand, what it costs, and how to
start it from this skill. Re-check the "available here" lines after a desktop update.

## Dynamic workflow (`use a workflow …`, `ultracode`)

A JavaScript script that Claude writes and a background runtime executes; it spawns subagents
(`agent()`, `pipeline()`, `parallel()`), keeps intermediate results in script variables, and
returns one result. Up to 16 concurrent agents, 1,000 per run; a `Large workflow` warning at 25
agents or 1.5M projected tokens; resumable in the same session; saveable to `.claude/workflows/`
as a `/name` command. Available on all paid plans; Pro turns it on in `/config`.

Beats hand dispatch when: more than ~5 similar agents; a per-file migration; research whose
findings must be cross-checked before you see them; a plan drafted from several angles.

Available here: **the Workflow tool is not exposed to the model in the desktop session**
(checked 2026-09-08). The keyword and the phrase only start a run when a human types them. So
the lead writes the exact one-line prompt into its report and the ledger, e.g.
`use a workflow to audit every route handler under src/routes/ for missing auth checks, and
adversarially verify each finding before reporting it`, and the user types it. Do not promise
the model can start one.

## `/batch <instruction>`

Splits one change across 5–30 subagents, each in its own worktree, each opening a PR. Beats
hand dispatch for one mechanical instruction over many files (rename, bump, header, import
rewrite). Needs a git repository with a remote. User-typed command; hand the user the line.

## `fork`

A subagent that inherits the parent's whole conversation, tools and cache, so its first request
is a cache read and nothing has to be re-explained. Use it for a short task that needs this
conversation: "verify the diff we just discussed", "answer from what we read". Every fork turn
costs what a main-conversation turn costs, so it loses to a packet as soon as the task is long.
Documented as `subagent_type: fork`; not listed in this session's agent types on 2026-09-08,
so treat it as documented-unverified until one probe succeeds.

## Agent teams (experimental, off)

Teammates are full Claude Code sessions with a shared task list and direct messaging. About 7x
the tokens of one session; enabled only by `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`; not
available under `-p`; while enabled, any *named* subagent becomes a teammate. Use only for
competing hypotheses that must argue with each other, on Max 20x, and only when the user asks.
This skill leaves the variable unset.

## `/goal <condition>`

A session-scoped prompt-based Stop hook: after every turn a small fast model (Haiku by default)
judges the condition against what Claude surfaced in the conversation and Claude keeps working
until it is met or judged impossible. Restored on resume. Evaluation tokens are "typically
negligible". The condition must be provable from output Claude can show: a test result, an exit
code, a file count. User-typed; the lead proposes the exact condition (the run's
done-when evidence, plus "or stop after N turns") and the user types `/goal …`.

An unattended loop beats this skill's own loop only when a done-when and a plan
are written down first. Practitioner reports of Ralph-style unattended running
agree on the shape of the failure: without a spec written up front they stop
early on a premature "done", and they spend tokens prodigiously either way
(`docs/research/0004-loops-and-stopping.md` (d)). So propose `/goal` when the
condition is provable from output, and never as a substitute for the plan.

## Waiting without polling

`Monitor` watches a process, log or WebSocket and wakes Claude on new lines. `ScheduleWakeup`
paces a `/loop`. `CronCreate` schedules a one-off or recurring prompt in this session (restored
on resume). Routines (`RemoteTrigger`) run in the cloud with no session open. A Bash sleep loop
spends a turn per check and is never the answer.

## Side questions

`/btw <question>` (user-typed) answers without entering the conversation history. Point the user
at it for "what does X mean" questions during a run.
