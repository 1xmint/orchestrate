# The ladder: which move for which message

One source for three readers: SKILL.md points here, `scripts/router.mjs` injects the card
below once per session, and a maintainer edits only this file. Cheapest rung first. Climb on
evidence — the cheaper rung failed, or cannot hold the property — never on habit.

| Rung | Use when | What it costs |
|---|---|---|
| 1 Answer from context | the answer is already in the conversation or in one small file | no tools |
| 2 Inline edit | one file, minutes, short output; the diff fits one sentence | a few hundred tokens |
| 3 Script or CLI, output filtered | the job is mechanical: gate discovery, a grep, a status check; `gh`, `git`, `cargo`, project scripts; pipe through `head`, `tail -20`, `--json` + a filter | ~100–300 tokens, no model reasoning |
| 4 Skill | a procedure that should play out in this thread (`/code-review`, a repo's own skills) | the skill body, once, then it stays in history |
| 5 `Explore` on haiku | a read-only sweep of more than ~3 files, or output you will not reference again | ~0.4–2k tokens back; Explore skips CLAUDE.md so it starts small |
| 6 Role agent in a worktree | a bounded change with a gate; anything that writes; anything needing isolation | a packet in, ≤ 40 lines back; background by default |
| 6+ `/orchestrate` | several rung-6 tasks that need a plan, a ledger and independent review | the skill body plus one packet per task |
| 7 `fork` | the worker needs this whole conversation and a packet would be longer than it is | reads the parent's cache; every fork turn costs what a main turn costs |
| 8 Dynamic workflow | more than ~5 similar agents, per-file migrations, research that must be cross-checked | intermediate results never enter context; Claude Code warns at 25 agents or 1.5M tokens |
| 9 `/batch` | one mechanical instruction across many files, each in its own worktree with a PR | 5–30 subagents |
| 10 Agent team | competing hypotheses that must argue with each other | ~7x the tokens of one session; experimental; off by default |

Orthogonal moves, at any rung:

- **Ask one question**, with a recommendation, only for money, public surfaces, credentials,
  destructive or irreversible actions, or a genuine strategic fork.
- **Plan first** when the diff takes more than a sentence to describe or crosses modules.
- **Keep working until evidence exists**: `/goal <condition>`, which the user types, or a Stop
  hook. Not repeated prompts.
- **Wait without polling**: Monitor for a process or log, ScheduleWakeup or `/loop` for a
  cadence, CronCreate for a one-off, a Routine for work outside any session. Never a sleep loop.
- **Browser**: one pane, one task at a time, `orch-browser`.
- **MCP** only where no CLI does the job; load its tools through ToolSearch when needed.
- **Memory**: auto memory for durable learnings; `RUN.md` for run state; the ledger before
  `/compact` or `/clear`.

## Questions: the depth call

The ladder above is for tasks. A question gets its own decision first, made on what can be
observed about the question rather than on how sure you feel about the answer. Confidence is
the thing that fails here.

| The question is | The move |
|---|---|
| already settled in this conversation, the run's Facts or Decisions, `STATE.md`, or a file you read | answer from it and say where; do not re-derive it and do not re-verify it |
| a current fact one source settles: a version, a price, a flag, a line of a doc | fetch that source, cite it, and say in one line what it does not settle. A name you recognise is not a fact you know: search it as the user wrote it |
| a recommendation others will inherit — a default, a config value, a table, a README line — or one spanning a set of cases, that no command or test can prove wrong | dispatch `orch-researcher` with a source obligation. **A table from one search is never an answer** |
| a design judgment ("is this a good idea", "should we", "which is better") | the goal as you read it, the two or three things that decide it, a recommendation, what you checked, and what would change it. A table of options with no recommendation is not an answer |
| checkable by a command (does it build, does the test pass, how many files) | run the command with filtered output. Never reason about what a command can answer |

Row three is the one that gets skipped, so it has a test rather than a feeling:
dispatch when the answer will be **inherited by others or spans a set of cases**,
**and** no command or test could prove it wrong. If only "it asks for a current
fact" holds, one primary source is enough.

## Router card

`scripts/router.mjs` extracts the fenced `card` block below, prepends one dynamic state line
(tier, agents installed, your own model, open run, limits hit today), and injects the result on
the first substantive prompt of a session. Keep it under 1,550 characters; every character is
paid on every later turn of that session. `router.test.mjs` asserts the cap.

```card
Take the cheapest rung that clears the bar; climb only on evidence, never on habit:
1 answer from context · 2 inline edit (one file, minutes) · 3 script/CLI with filtered output (rg|head, --json|jq, tail -20) · 4 skill · 5 Explore(haiku) sweep when >3 files · 6 orch-* role agent in a worktree, background, packet per packet.md · 6+ several of those with a ledger = /orchestrate · 7 fork only when the task needs this conversation · 8 dynamic workflow when many parallel agents or results must stay out of context · 9 /batch for one mechanical change across many files, PR each · 10 agent team: experimental, ~7x tokens, off.
Questions: settled → answer and cite where · one current fact → fetch that source · inherited or across cases → orch-researcher · design judgment → the goal, the two or three deciders, a recommendation, what would change it.
Orthogonal: ask ONE question, only for money, public surfaces, credentials, destructive or irreversible actions, or a strategic fork, always with a recommendation · plan mode first when the approach is open or crosses modules · "keep going until green" = /goal or a Stop hook, not repeated prompts · waiting = Monitor / ScheduleWakeup / CronCreate / /loop, never a sleep loop · browser tasks one at a time (one pane) · MCP only where no CLI exists.
Money: pick the model the task needs, then check the plan; not included means the user's money and their call: recommend it, price it, offer the alternatives. A wrong model costs quota; a wrong rung costs your context. Mute: type "router off".
```
