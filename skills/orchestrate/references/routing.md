# Routing: which model and effort for which task, by plan

Checked 2026-09-08 against the sources at the bottom. Plans, prices and model
names move. Before the first dispatch of a run that will spend heavily (a Fable
planning pass, a batch of Opus implementers), re-open the pricing page and the
"Fable models on your plan" article and correct this file where they disagree.
Prose about live availability is evidence, not authority.

## The facts that drive routing

| Plan | Included models | Fable | Default model in Claude Code |
|---|---|---|---|
| Free | Sonnet, Haiku (app only) | no | no Claude Code |
| Pro ($20/mo) | Opus, Sonnet, Haiku | **not included**: bills usage credits (real money). Interactive sessions show a consent prompt once; `-p` and SDK runs bill without asking | Sonnet 5 |
| Max 5x ($100/mo) | Opus, Sonnet, Haiku, Fable | included **up to 50% of the weekly limit**; past that, usage credits or switch model | Opus 5 |
| Max 20x ($200/mo) | same | same 50% rule on a four-times-larger allowance | Opus 5 |
| Team standard seat | like Pro | usage credits | Sonnet 5 |
| Team premium, Enterprise premium | like Max | 50% rule | Opus 5 |
| API key / Console | all | pay per token. List prices on 2026-06-24 per million tokens in/out: Fable 5.1 $10/$50, Opus 5 $5/$25, Sonnet 5 $2/$10, Haiku 4.5 $1/$5 | Opus 5 |

Limits on Pro and Max: a rolling five-hour window plus a weekly window, shared
across the Claude app, Cowork and Claude Code. Every subagent this skill
launches draws from the same pool as the conversation. Two error shapes matter:

- "You've hit your Opus limit" (or Sonnet, or Fable): a per-family limit. Other
  families still work. Move that family's roles one family down for the rest
  of the run, note it in the ledger, tell the user.
- "You've hit your session limit" or "weekly limit": nothing works until the
  reset time in the message. Write the ledger, stop cleanly, report the reset
  time. Do not quietly shrink the plan of work to fit.

No API exposes remaining usage to a session. `/usage` shows it to the human,
`/usage-credits` shows credit spend. When a run on a small plan is about to fan
out widely, ask the user to glance at `/usage` first.

## Tier detection

`scripts/profile.mjs` reads `~/.claude.json` and maps `organizationRateLimitTier`,
`userRateLimitTier` and `seatTier` (values look like `default_claude_max_5x`)
to `pro | max5 | max20 | team | unknown`, unless the user saved an override with
`--set tier=…`. A missing signal is `unknown`, never a guess, because a guess
of a paid tier on a Pro account spends money on Fable. On `unknown`, ask once
with the four choices and save the answer. An API-key session is `api`:
dollars rather than a window; use the Max 5x column and tell the user what a
Fable dispatch costs before making one.

## Effort

`low | medium | high | xhigh | max`. Default is `high`.

- `low`: mechanical or tightly scoped work, cheap subagents.
- `medium`: where quality holds and cost matters.
- `high`: the floor for anything needing judgment.
- `xhigh`: coding and long agentic tasks on Opus 5, Sonnet 5 and Fable. It
  usually lowers total tokens by avoiding rework.
- `max`: correctness over time; can over-think routine work.

A subagent's effort comes from its agent file (`effort:`) and cannot be set per
call, so each role agent carries the effort that fits its role. The model can
be set per call and overrides the file.

## Routing table

Pick the smallest model whose chance of a first-time-right result clears the
task's bar. Then minimise total quota including rework. Then wall clock. A
cheap model that fails once and is retried costs more than the right model
once. A strong model that takes an hour loses to one that clears the same bar
in ten minutes.

| Role (agent) | Pro | Max 5x | Max 20x |
|---|---|---|---|
| Orchestrator brain | the session's model, unchanged | same | same |
| Planner, architect, audit (`orch-planner`) | opus | fable for ambiguous, cross-module or multi-sitting goals, otherwise opus | fable |
| Implementer, bounded (`orch-implementer`) | sonnet | sonnet; opus when the task spans several files or a shared contract | opus |
| Mechanical, scan, extract (`Explore` with `model: haiku`) | haiku | haiku | haiku |
| Researcher (`orch-researcher`) | sonnet | sonnet; opus to reconcile conflicting sources | opus |
| Browser operator (`orch-browser`) | sonnet | sonnet | opus |
| Independent reviewer (`orch-reviewer`) | opus | opus | fable for security, release, public surfaces or money; otherwise opus |
| Debug escalation (`orch-debugger`) | opus | fable | fable |
| Fable ceiling per run | **none unless the user opts in for this run** | at most a third of dispatches | at most half |

Pass the model on the `Agent` call (`model: sonnet | opus | haiku | fable`). The
Fable ceiling counts rows in the ledger's model column; the main conversation
may itself be on Fable, which is why Max 5x stops at a third.

## Escalation triggers (fixed list)

Escalate one step (sonnet → opus → fable) only when one of these holds, and
write which one in the ledger:

1. one attempt failed on a packet that was complete (not a context gap);
2. security, auth, payments, a public surface, a schema or default change, or
   anything irreversible;
3. the task crosses module boundaries or changes an architecture;
4. two competent results disagree;
5. the agent reports a conceptual block rather than a missing fact;
6. the user asks.

De-escalate below the table only by naming the oracle that makes it safe: a
strong deterministic test, a type-checked interface, an exact spec.

Routing fails in two directions: everything to the strongest model (waste), or
hard work left on a cheap model that returns confident and wrong (rework). The
fixed list plus independent verification guards both.

## External CLIs (optional lane)

Codex, opencode, gemini and aider are separate quota pools and, for review, a
different vendor's blind spots. Use one only when `profile.mjs` shows it
installed **and** authenticated. Before relying on it for real work, run
`scripts/smoke.mjs <provider>` once; it spends a tiny amount of that quota.
On any quota, auth or "try again at" error, drop the provider for the rest of
the run and do not retry it. Never write a key or token anywhere.

Invocation shapes (confirm with `--help`; flags change):

- `codex exec` with the prompt on stdin; `-m <model>`; `--json` for machine
  output; `codex login status` reports auth.
- `opencode run "<prompt>"` with `-m <provider/model>`; `opencode models`
  lists what the account can reach.
- `claude -p "<prompt>" --model <alias> --output-format json` needs the CLI
  itself to be logged in (`claude auth status`); the desktop app's login does
  not carry over.

Good uses: a cross-vendor read-only review of risky work; a second opinion when
two Claude results disagree; overflow when a Claude family limit is hit. Poor
uses: anything that needs this session's permissions, MCP tools or worktrees.

## Sources

- https://claude.com/pricing — plans, included models, "50% of weekly limits"
- https://support.claude.com/en/articles/15424964-claude-fable-models-on-your-plan
- https://support.claude.com/en/articles/11145838-using-claude-code-with-your-pro-or-max-plan
- https://code.claude.com/docs/en/model-config — aliases, defaults by plan, effort, `CLAUDE_CODE_SUBAGENT_MODEL`
- https://code.claude.com/docs/en/costs — `/usage`, limit messages, subagent cost advice
- https://code.claude.com/docs/en/sub-agents — agent frontmatter, per-call model override
