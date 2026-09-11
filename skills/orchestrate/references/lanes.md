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

## `batch` (this skill's own fan-out, `scripts/batch.mjs`)

For real parallel mass-edit — the same mechanical change across many files —
without depending on `/batch` or the Workflow tool, neither of which the model
can start here (above). `scripts/batch.mjs <RUN.md> --spec "…" --files
"a,b,c" [--done-when "…"] [--concurrency 20]` reads the run's own task id
sequence and writes one packet and one task row per file, each `OWNS` exactly
that file so N `orch-implementer` worktrees can run at once with no merge
conflict — the same rule SKILL.md §4 already states for parallel tasks, just
generated rather than typed by hand N times. Default concurrency 20, matching
the host's own default concurrent-subagent limit (`hosts.md`).

Use it for one mechanical instruction applied identically across files: a
rename, a header, an import rewrite, a dependency bump repeated per package.
Not for a change where two files need to see each other — a shared rename
across a type and its call sites is one task owning the whole set, not a
batch. Paste the printed rows into `RUN.md`'s table, then dispatch each
file's packet as its own `orch-implementer` call, in waves of the printed
size; the full gate runs once at the join, same as any other coordinated run
(`SKILL.md §6`).

Portable, not a fast path: it costs a real dispatch per file, same as typing
each packet by hand would. If a future host exposes `/batch` or the Workflow
tool to the model directly, that beats this for the cases `/batch` already
covers (5–30 files, one worktree per file, opens a PR) — check `hosts.md`'s
dated finding before assuming either is still unavailable.

## `fork`

A subagent that inherits the parent's whole conversation, tools and cache, so its first request
is a cache read and nothing has to be re-explained. Use it for a short task that needs this
conversation: "verify the diff we just discussed", "answer from what we read". Every fork turn
costs what a main-conversation turn costs, so it loses to a packet as soon as the task is long.

**Not available here, probed 2026-09-10**: `Agent` with `subagent_type: "fork"` is refused —
`Agent type 'fork' not found` — against the same list `Agent`'s own error names every time. It
is documented elsewhere as `subagent_type: fork`; this build does not expose it. Do not offer it
to the user as a move; re-probe after a host upgrade.

## `SendMessage`, as a delta lane

Resumes a subagent — background or already finished — with a follow-up that reads its existing
transcript instead of starting cold: a cache-warm continuation, not a fresh dispatch. Proven
2026-09-10: a background `Agent` dispatch was let finish, then `SendMessage`'d by its raw
`agentId` with a follow-up instruction, and it resumed and completed cleanly. Use it for the
common reviewer-found-a-problem → implementer-fixes-it loop, or a short second ask of an agent
whose context is worth keeping, in place of a fresh dispatch that reloads CLAUDE.md, the git
snapshot and the packet from nothing. Capture the id from the dispatch result; a *named* agent
(one with a stable `name`, not just an id) can also be reached by that name later in the session.
Loses to a fresh dispatch when the model needs to change, or when the earlier attempt would bias
the next one — same rule as a packet delta by hand.

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
