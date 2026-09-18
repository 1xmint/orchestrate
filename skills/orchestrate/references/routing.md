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

## Codex routing

Codex is the worker lane until its shared allowance runs out. Ask for the Codex
tier once, when the first Codex dispatch is considered and the profile has none,
then store it with `profile.mjs --set codex.tier=plus|pro5|pro20`.

| Task | Codex model / effort | Claude after Codex is out |
|---|---|---|
| mechanical edits, renames, extraction, run a suite and report, sweeps | `gpt-5.6-luna` low–medium | `Explore` haiku / implementer sonnet |
| bounded implementation with an oracle (tests, types) | `gpt-5.6-terra` medium; high on retry | implementer sonnet |
| hard bounded coding, a failure that resisted one attempt | `gpt-5.6-sol` high–xhigh | debugger opus |
| cross-vendor review of a Claude-authored risky change | `gpt-5.6-sol` high | reviewer opus; never the author's vendor |
| hard to check and expensive to get wrong | `gpt-6-astra` high–xhigh; user's approval each time | planner or reviewer fable, with the same approval rule |
| planner, browser, anything needing this session's MCP tools or permissions | Claude, as today | — |

Always pass the model and effort on the worker command. Codex effort is a real
per-dispatch lever. When a check justifies escalation, start a fresh run one
model step up: Luna → Terra → Sol → Astra. Carry only a three-line note saying
what failed. Astra still needs the user's approval for that dispatch.

The models share one five-hour and weekly allowance, but draw on it at different
rates. These are the messages-per-five-hours ranges recorded 2026-09-14:

| Codex tier | Astra | Sol | Terra | Luna |
|---|---:|---:|---:|---:|
| Plus | 5–45 | 10–100 | 25–200 | 250–2,000 |
| Pro 5x | 25–225 | 50–500 | 125–1,000 | 1,250–10,000 |
| Pro 20x | 100–900 | 200–2,000 | 500–4,000 | 5,000–40,000 |

There is no scriptable remaining-allowance read. Learn exhaustion from the
worker error and its reset time. The default model is in transition, so always
pass `-m` through `codex-worker.mjs --model <id>`.

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

## Saying the price

The guard prints a price tag on every dispatch that names a model: list-price
dollars, either measured from this machine's own past runs or labelled as
reasoned. A dispatch that names no model gets no tag, because nothing knows what
it will run on.

**List price is not what a subscription is billed.** It is the unit `/usage`
already shows the user for a session, and it is the only unit a dispatch can be
priced in at all. Say so whenever you print a figure.

There used to be a rule here: mention the price over 5% of a week, ask over 25%.
Both numbers divided by a weekly dollar figure that rested on one observation, so
the percentage looked like a measurement and was not. Both are gone, and so is
the weekly figure.

What is left is judgment. Say a price, once, before the spend, when it is large
enough to change what the user would want. Ask first when the spend is theirs
rather than the plan's. **Never a running total**: a counter reads as an
allowance and invites spending up to it. `measure.mjs --latest --dollars` says
what a finished run actually cost, when that can change the next decision.

## Routing table

Quota first, on every plan: executors start on Sonnet with a step cap, and a
task moves up only after it fails a check on Sonnet. The evidence for starting
cheap: running at a lower setting and re-running only the failures passed ~93%
of tasks at half the cost of running everything at the default (Anthropic,
optimizing-for-cost-and-intelligence). A cheap attempt is bounded by its step
cap; an uncapped expensive one is not. The guard enforces the executor rows.

| Role | Pro | Max 5x | Max 20x |
|---|---|---|---|
| Orchestrator | the session's model | same | same |
| `orch-planner` | opus | opus; fable when ambiguous, cross-module or multi-sitting | same as Max 5x |
| `orch-implementer` | sonnet | sonnet | sonnet |
| `Explore` (`model: haiku`) | haiku | haiku | haiku |
| `orch-researcher` | sonnet | sonnet | sonnet |
| `orch-browser` | sonnet | sonnet | sonnet |
| `orch-reviewer` | opus | opus | opus; fable for security, release, public, money |
| `orch-debugger` | opus | opus | opus; fable after Opus is stuck |
| `orch-coordinator` | opus | opus | opus |
| any Fable dispatch | **the user's call each time** | judge each on its merits | judge each on its merits |

Pass it on the `Agent` call (`model: sonnet | opus | haiku | fable`).

**Claude effort is not a per-call lever; the role files set it, at or below `high`**
(`models.md`). The old pins went the wrong way — planner and debugger at
`xhigh` — and were removed; the current ones exist to spend less than a session
at `xhigh` would. The model is the per-call lever, and it overrides the file.

**Host facts worth knowing.** A `/model` switch mid-session rebuilds the whole
prompt cache; an effort change on Fable 5.1 keeps it (2.1.260+), a model switch
never does. Subagent requests get a 5-minute cache TTL by default against one
hour for the main conversation, so a long agent waiting on a build re-reads its
prefix; `subagentPromptCacheTtl: "1h"` (2.1.242+) extends it, at a higher
billing rate whose effect on plan usage is undocumented, which is why the
default is left alone.

## Who reviews

Review is bought for a reason, not scheduled. Dispatch `orch-reviewer` when
being wrong here would be expensive and hard to see:

- an authorisation or security boundary;
- money moving;
- a destructive or irreversible change to data;
- a compatibility contract other people consume;
- architectural uncertainty you could not resolve yourself.

A cosmetic change on a public page is not one of these, and neither is "the
author was a smaller model than me". That rule used to be here, and it created
reviewers by arithmetic on model names — a comparison that says nothing about
whether this change is risky.

Two rules stay absolute. **Never review your own edits**: dispatch. And a
reviewer weaker than the author produces a PASS you cannot bank, so a reviewer
is never weaker than the author.

Give the reviewer the concrete risk and the acceptance criteria. A reviewer
asked to look for gaps will find some in any change.

## Escalation triggers (fixed list)

Escalate the *author* one step (sonnet → opus → fable), naming the trigger in
the ledger, as a fresh dispatch carrying a three-line note of what failed —
never by resuming the failed agent — when:

1. one attempt failed on a complete packet (not a context gap);
2. two competent results disagree;
3. the agent reports a conceptual block rather than a missing fact;
4. the user names a model in their own message — for the task they named it
   for, not for the run: it grants the first task id that uses it, and a
   different task id is refused and starts back on the ladder.

A reviewer disagreeing is not on that list. A FAIL with a concrete finding is a
fix packet on the same model; a FAIL you cannot act on is a question for the
user, not a more expensive retry.

De-escalate below the table only by naming the oracle that makes it safe: a
strong deterministic test, a type-checked interface, an exact spec.

## Other external CLIs

Codex is the supported worker lane described above. It uses a separate allowance
and, for review, another vendor's blind spots. Use it only when `profile.mjs`
shows it installed and authenticated. On an allowance or auth error, stop using
it until the recorded reset. Never write a key or token anywhere.

- `scripts/codex-worker.mjs` handles the worktree, timeout, structured report,
  usage-limit detection and Claude fallback packet. Do not hand-roll
  `codex exec` for a worker task.
- `opencode run "<prompt>"` with `-m <provider/model>`; `opencode models`.
- `claude -p "<prompt>" --model <alias> --output-format json` needs the CLI
  itself logged in; the desktop app's login does not carry over.

The other CLIs are optional for a tiebreak. They cannot use this session's
permissions or MCP tools.

## Sources

- https://claude.com/pricing — plans, included models, "50% of weekly limits"
- https://support.claude.com/en/articles/15424964-claude-fable-models-on-your-plan
- https://support.claude.com/en/articles/11145838-using-claude-code-with-your-pro-or-max-plan
- https://code.claude.com/docs/en/model-config — aliases, defaults by plan, effort
- https://code.claude.com/docs/en/costs — `/usage`, limit messages
- https://code.claude.com/docs/en/sub-agents — agent frontmatter, per-call model
