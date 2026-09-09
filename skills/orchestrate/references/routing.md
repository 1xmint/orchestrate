# Routing: which model for which task, by plan

Facts, not procedure. Checked 2026-09-08 against the sources at the bottom.
Plans and prices move; before a run that will spend heavily, re-open the pricing
page and correct this file where they disagree.

## What each plan includes

| Plan | Included | Fable | Default model |
|---|---|---|---|
| Free | Sonnet, Haiku (app only) | no | no Claude Code |
| Pro ($20/mo) | Opus, Sonnet, Haiku | **not included**: bills usage credits, real money. Interactive sessions prompt once; `-p` and SDK runs bill without asking | Sonnet 5 |
| Max 5x ($100/mo) | Opus, Sonnet, Haiku, Fable | included **up to 50% of the weekly limit**, then credits or switch | Opus 5 |
| Max 20x ($200/mo) | same | same 50% rule, four times the allowance | Opus 5 |
| Team standard seat | like Pro | usage credits | Sonnet 5 |
| Team premium, Enterprise premium | like Max | 50% rule | Opus 5 |
| API key / Console | all | pay per token, Fable most expensive by a wide margin; treat like Pro | Opus 5 |

Limits are a rolling five-hour window plus a weekly one, shared across the
Claude app, Cowork and Claude Code. Every subagent draws from the same pool as
the conversation. Two error shapes, which mean different things:

- **"You've hit your Opus limit"** (or Sonnet, or Fable): per-family. Others
  still work. Move that family's roles one step down for the rest of the run,
  note it in the ledger, tell the user.
- **"You've hit your session limit"** or weekly: nothing works until the reset
  time in the message. Write the ledger, stop cleanly, report the reset time.

No API exposes remaining usage to a session. `/usage` shows it to the human.

## Tier detection

`scripts/profile.mjs` reads `~/.claude.json` and maps `organizationRateLimitTier`,
`userRateLimitTier` and `seatTier` (values look like `default_claude_max_5x`) to
`pro | max5 | max20 | team | unknown`, unless overridden with `--set tier=…`. A
missing signal is `unknown`, never a guess: guessing a paid tier on a Pro account
spends the user's money. An API-key session is `api`.

## Who chooses the model

You do, every time. No hook decides it or rewrites it. There used to be a daily
Fable cap; it was removed because a count answers "how many have you done" when
the question is "is this one worth it".

Two steps. **Which model does the task need?** The table below. **Is it included
in this plan?** The table above. Included, dispatch and say nothing. Not
included, it costs real money and **the choice is theirs, not yours**: say what
you would pick and why, price it, give the alternatives, let them answer.

Never quietly downgrade to dodge asking. Never quietly spend to dodge asking.
They are the same failure.

### When Fable earns its cost

Work that is hard to check and expensive to get wrong: an adversarial audit, an
ambiguous plan crossing modules, a failure that survived a good attempt on Opus,
sources that disagree and must be reconciled.

Not when something else can check the answer: a tight packet with strong tests,
a sweep, an extraction, a mechanical change.

## Say the price before you spend

- **Under ~5% of a week**: go, no ceremony.
- **Over ~5%**: say the price in one line and carry on. A sentence, not a
  question. "Three researchers, about $30, roughly a fifth of your week."
- **Over ~25%**: ask first, recommendation in front of the question.

**Never a running total in the conversation.** A counter reads as an allowance
and invites spending up to it. A price is a forecast said once, before the
spend; `measure.mjs --latest --dollars` says what a finished run actually cost,
when it can change the next decision instead of nagging about this one. The
guard prints a price tag on every dispatch, so the number is already in front of
you. `models.md` has the table it comes from.

## Routing table

Pick the smallest model whose chance of a first-time-right result clears the
task's bar; then total quota including rework; then wall clock. A cheap model
retried costs more than the right one once.

| Role | Pro | Max 5x | Max 20x |
|---|---|---|---|
| Orchestrator | the session's model | same | same |
| `orch-planner` | opus | fable when ambiguous, cross-module or multi-sitting; else opus | fable |
| `orch-implementer` | sonnet | sonnet; opus across several files or a shared contract | opus |
| `Explore` (`model: haiku`) | haiku | haiku | haiku |
| `orch-researcher` | sonnet | sonnet; opus to reconcile conflicts | opus |
| `orch-browser` | sonnet | sonnet | opus |
| `orch-reviewer` | opus | opus | fable for security, release, public, money; else opus |
| `orch-debugger` | opus | fable | fable |
| any Fable dispatch | **the user's call each time** | judge each on its merits | judge each on its merits |

Pass it on the `Agent` call (`model: sonnet | opus | haiku | fable`).

**Effort is not a per-call lever.** It comes from the agent file and cannot be
set per dispatch; the six role files carry planner and debugger at `xhigh`, the
rest at `high`. The model is the per-call lever and overrides the file.

**Host facts worth knowing.** A `/model` switch mid-session rebuilds the whole
prompt cache; an effort change on Fable 5.1 keeps it (2.1.260+), a model switch
never does. Subagent requests get a 5-minute cache TTL by default against one
hour for the main conversation, so a long agent waiting on a build re-reads its
prefix; `subagentPromptCacheTtl: "1h"` (2.1.242+) extends it, at a higher
billing rate whose effect on plan usage is undocumented, which is why the
default is left alone.

## Who reviews

The router's state line names the model you are on, read from the transcript.

- **Strictly above the author and not a risky class** → read the diff yourself.
  A reviewer buys no independence the author did not already lack.
- **At or below the author, or a risky class** (trigger 2 below) → dispatch
  `orch-reviewer` on a model no weaker than the author's. A weaker reviewer
  produces a PASS you cannot bank.
- **You wrote any of the diff** → always dispatch. Never review your own edits.
- **You cannot tell what you are on** → dispatch.

## Escalation triggers (fixed list)

A bigger *author* needs evidence; risk selects a *reviewer*. Escalate the author
one step (sonnet → opus → fable), naming the trigger in the ledger, when:

1. one attempt failed on a complete packet (not a context gap);
4. two competent results disagree;
5. the agent reports a conceptual block rather than a missing fact;
6. the user asks.

These add a reviewer, not a bigger author:

2. security, auth, payments, a public surface, a schema or default change, data
   that moves or is rewritten, anything irreversible;
3. the task crosses module boundaries or changes an architecture.

De-escalate below the table only by naming the oracle that makes it safe: a
strong deterministic test, a type-checked interface, an exact spec.

## External CLIs (optional lane)

Codex, opencode, gemini and aider are separate quota pools and, for review,
another vendor's blind spots. Use one only when `profile.mjs` shows it installed
**and** authenticated. Run `scripts/smoke.mjs <provider>` once before a planned
dispatch. On any quota or auth error, drop that provider for the rest of the run.
Never write a key or token anywhere.

- `codex exec` with the prompt on stdin; `-m <model>`; `--json`; `codex login status`.
- `opencode run "<prompt>"` with `-m <provider/model>`; `opencode models`.
- `claude -p "<prompt>" --model <alias> --output-format json` needs the CLI
  itself logged in; the desktop app's login does not carry over.

Good for a cross-vendor review of risky work, a tiebreak, or overflow when a
family limit is hit. No good for anything needing this session's permissions,
MCP tools or worktrees.

## Sources

- https://claude.com/pricing — plans, included models, "50% of weekly limits"
- https://support.claude.com/en/articles/15424964-claude-fable-models-on-your-plan
- https://support.claude.com/en/articles/11145838-using-claude-code-with-your-pro-or-max-plan
- https://code.claude.com/docs/en/model-config — aliases, defaults by plan, effort
- https://code.claude.com/docs/en/costs — `/usage`, limit messages
- https://code.claude.com/docs/en/sub-agents — agent frontmatter, per-call model
