# The ledger: ceiling, context advice, tracer bullets, resuming

`node "${CLAUDE_SKILL_DIR}/scripts/run-init.mjs" <slug> --repo <the repo the goal is about> --goal "…" --tier <t> --session-id <this session's id>`
writes `<repo>/.orchestrator/runs/<date>-<slug>/RUN.md`, prefills Facts with the
repo's detected gate, and binds the run to this session so a hook's write lands
in the right ledger. Keep its headings; a resuming session looks for them.

Fill the sections above the task table before the first dispatch: the outcome
and why it matters, the evidence that would prove it, the constraints and what
you are deliberately not doing, and the current approach with the next
deliverable.

## Ceiling (optional)

A run has **no dollar ceiling by default**, and the dispatch guard then refuses
nothing over cost and nobody is asked for a budget. On a subscription nothing
is billed in dollars; what runs out is the session and weekly allowance, so
spend by judgment (a large step says why it is worth its size), not by a cap.
Set one only on pay-per-use billing, or when the user asks for a limit: pass
`--budget <n>` (list-price dollars) or write `Ceiling: $n` in the Budget
section, and `Ceiling: none` switches it off again. A set ceiling is enforced
exactly as before: the guard refuses a subagent that would cross it and asks,
never invents a tighter one, and raising it in the ledger lets the next
dispatch through. Link to the repo's own documents rather than copying them.

## Relay, not marathon

A run this size is a **relay across fresh sessions, not one marathon.** A long
conversation re-reads its whole self on every turn, and that re-read is the
largest cost there is — bigger than any subagent. Do a wave or two, keep the
Pickup line honest, and hand off: a fresh session resumes from the ledger and
starts with a small, cheap context. Context advice (below) owns the handoff
call, since it is measured rather than guessed from a turn count;
`--max-budget-usd` at launch and `CLAUDE_CODE_GOAL_CHECKIN_MINUTES` are the
host's own levers if the user wants a hard cap or fewer idle `/goal`
check-ins.

## Context advice

Context advice comes from one reader (`scripts/context.mjs` for a report, the
hooks for notices), measured from the last model response after the last
compaction, and said only when it changes. At **120k** prepare a checkpoint; at
**150k**, or 75% of a known smaller window, recommend a change at the next safe
boundary. The checkpoint comes first: the goal, decisions, changed files,
verification results, outstanding work and the next action, written where a
later session finds them. Then recommend **compact** when the same task
continues, or a **fresh conversation** when the task changes or a finished
phase resumes from saved files; after two compactions in one session the
notice says fresh. The user makes the switch. Talk about size only from the
latest measured number (the short size lines carry it, and `router status`
prints it), never from memory or a summary. A notice to investigate means the context was
still large right after compaction: look at restored instructions, plugin and
tool listings and carried tool output rather than recommending compaction
again. A size shown as unknown is unknown, not small.

## Tracer bullets

Plan as tracer bullets: the thinnest slice that works end to end, then the
slices that widen it. Each row carries an id (`M-D-NNNN`), an owner, what it
blocks on, the files it owns, and the evidence that decides it. Fill the
`blocks on` and `owns` columns: they are what lets a session tell a ready task
from a blocked one, and a row missing them is a task nobody can pick up but you.
Parallel tasks each own their own files: an agent cannot see the other
worktrees, so a shared file becomes a merge conflict after both are done.

## Resuming

Read the latest `RUN.md` once, continue from its Pickup line, do not re-plan,
do not re-read it whole later. An unbound session claims a run with
`run-init.mjs --bind <RUN.md> --session-id <id>`.
