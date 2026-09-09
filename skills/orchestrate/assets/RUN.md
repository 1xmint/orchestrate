# Run {{RUN_ID}}

Started {{DATE}}. The ledger for one goal. Update it at every state change; it
is the resume point if this session ends.

## Goal

{{GOAL}}

## Done when

- <evidence that would prove it, one line each>

## Shape

tasks: <N> · parallel: <M> · models: <which roles on which models> · est. price: $<n> (~<n>% of a week) · why not smaller: <one line>

## Profile

tier: {{TIER}} · host: {{HOST}} · providers: {{PROVIDERS}}

## Facts learned while grounding

- <verbatim fact with path:line or URL, ready to paste into a packet>

## Tasks

| id | phase | role · model | task | rubric (written before dispatch) | attempts | evidence |
|---|---|---|---|---|---|---|
| {{ID_PREFIX}}-0001 | 📋 planned | <role · model> | <replace this placeholder row> | <the measurement that decides it> | 0 | — |

Phases: 📋 planned · 🔨 running · 🔍 review · ✅ done · 🧱 built-unverified · ◐ partial · ⛔ blocked · ✖ failed
Ids: `{{ID_PREFIX}}-NNNN`, counter from 0001 for this run, never reused or changed.

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
