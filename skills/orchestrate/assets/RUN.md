# Run {{RUN_ID}}

Started {{DATE}}. The ledger for one goal. The four sections above the task
table are the goal itself: a session that loses everything else can still be
resumed from them, and a task that cannot be traced back to them is not part of
this run.

## Goal

{{GOAL}}

Why it matters: <what the user gets that they do not have now>

## Done when

- <evidence that would prove it, one line each; a command, a file, a page state>

## Constraints and non-goals

- constraint: <something the work must respect: a rule, a budget, a compatibility promise>
- not doing: <the nearby thing this run deliberately leaves alone>

## Approach

Current approach: <how the goal is being reached, in a sentence>
Next deliverable: <the next thing that will exist and be checkable>

## Budget

Ceiling: {{BUDGET}} · sessions: <~N fresh sessions you expect this to take> · set {{DATE}}
Per wave: <optional per-wave estimate, so on-track can be told from runaway>

The run's spend ceiling, agreed with the user once. The dispatch gate refuses a subagent
that would cross it and asks; raise it here to set a new ceiling, and it will not ask again.
Nothing tightens it on its own, so this is the user's threshold, not the tool's. `$` is list
price — the unit `/usage` and `measure.mjs` show, not what a subscription is billed. A run
this size is executed as a relay across fresh sessions, not one marathon: each session does a
wave or two, writes the Pickup line, and hands off, so the conversation never grows into the
thing that costs the most.

## Shape

tasks: <N> · at once: <M> · models: <which roles on which models> · why not smaller: <one line>

## Profile

tier: {{TIER}} · host: {{HOST}} · providers: {{PROVIDERS}}

## Facts learned while grounding

- <verbatim fact with path:line or URL, ready to paste into a packet>

## Tasks

| id | phase | blocks on | owns | role · model | task | acceptance evidence | attempts | result |
|---|---|---|---|---|---|---|---|---|
| {{ID_PREFIX}}-0001 | 📋 planned | — | <globs this task owns> | <role · model> | <replace this placeholder row> | <the evidence that decides it> | 0 | — |

Phases: 📋 planned · 🔨 running · 🔍 review · ✅ done · 🧱 built-unverified · ◐ partial · ⛔ blocked · ✖ failed
Ids: `{{ID_PREFIX}}-NNNN`, counter from 0001 for this run, never reused or changed.

`blocks on` is the ids this task waits for, or `—`. `owns` is the files it
claims, and it is the same list the packet's `OWNS` field carries. Both were
already asked for and had nowhere to go, so a session could not tell which task
was ready and waited on whatever it happened to remember. Keep them in these
columns: everything that reads this table counts from the left, so a stray `|`
in a later cell cannot shift them.

Returns are saved under `returns/` by the ledger hook and listed in
`returns/returns.jsonl`. The hook does not touch the rows above: you set a row
when you have read the return and judged it, because that is the only moment
anyone has.

## Decisions

- {{DATE}} — <decision> — <why> — <alternatives rejected>

## Open questions for the user

- <only what the user owns: money, public surfaces, credentials, destructive actions, strategy>

## Pickup

Pickup prompt: <one sentence that continues from here>
Pickup confidence: high | medium | low
Resume risk: none | mild | serious

## Verified vs inherited

Verified directly: <what this run proved, with the command or file>
Inherited, unverified: <what was assumed from earlier work or the user>
Not run: <what was skipped and why>
