# Models: what each one is for, and what it costs to run

Rates from platform.claude.com pricing, checked 2026-09-13. They move; re-check
before a run that will spend heavily. On a subscription you are not paying these
dollars, you are spending a share of a 5-hour and a weekly window, and Opus draws
on it meaningfully faster than Sonnet (support.claude.com, "models, usage and
limits"). Read the ratios.

## The four

| Model | Window | In / Out per 1M | Cache read | Effort | Pick it for |
|---|---|---|---|---|---|
| Fable 5.1 | 1M | $10 / $50 | $0.25 | low–max | work that is hard to check and expensive to get wrong |
| Opus 5 | 1M | $5 / $25 | $0.50 | low–max | judgment: planning, grading, deciding, diagnosing |
| Sonnet 5 | 1M | $2 / $10 | $0.20 | low–max | bounded work with a strong oracle |
| Haiku 4.5 | **200K** | $1 / $5 | $0.10 | **none** | reading, sweeping, extracting |

What catches people out:
- **Haiku's window is 200K** and it takes **no effort setting**; it retires no
  sooner than 2026-10-15. If Haiku is not enough, change the model.
- **Opus 4.7 and later, and Sonnet 5, use a tokenizer that makes ~30% more tokens**
  for the same text.
- **Built-in `Explore` and `general-purpose` run on this conversation's model**
  (Explore capped at Opus) unless the dispatch names one. The guard refuses them
  without a cheap named model.

## The cost shape: task size beats model choice

Every step re-reads everything before it. A helper that starts at `B` tokens and
adds `g` per step costs about `steps × B + g × steps² / 2` in re-reads. Measured on
this machine: Opus implementers started at ~50k, grew ~1.7k a step, ran ~190
steps, and re-read ~49M tokens each. Half the steps is roughly a third of the
re-reads; Sonnet instead of Opus is 40% of the per-token price. So:

1. **Size first.** One verifiable change per packet, named files and line ranges.
   The role step caps (`maxTurns`: implementer 50, debugger 80, researcher,
   browser and planner 40, reviewer 30) end a run that grew too big.
2. **Then model.** Executors (implementer, researcher, browser) start on Sonnet;
   the guard refuses anything higher before a real attempt at the same task.
   Planner, reviewer and debugger may use Opus.
3. **Then effort.** Pinned per role, never above `high` (below).

## Effort

Five levels: `low`, `medium`, `high`, `xhigh`, `max`. The default is `high` (Opus
4.7: `xhigh`). Effort changes every output token — thinking, text and tool calls —
and lower effort gives fewer, more consolidated tool calls.

- Opus 5 at `medium` scored about 2 points below `high` on SWE-bench Pro at half
  the cost; `low` about 8 points below at a quarter. Running at `low` and re-running
  only failures at the default passed ~93% at half the default's cost.
- Sonnet 5 at `medium` is roughly Sonnet 4.6 at `high`.
- `max` shows diminishing returns and can over-think.
(platform.claude.com, optimizing-for-cost-and-intelligence and effort, 2026-09-13)

The six `orch-*` roles pin their own: implementer and researcher `medium`, browser
`low`, planner, reviewer and debugger `high`. There is no per-call effort; the
model is the per-call lever.

## Choosing, and escalating

1. **Is there an oracle?** A test, type checker, schema or exact spec. A smaller
   model plus an oracle beats a larger model without one.
2. **Can the work be checked at all?** If only a human can tell, the capable model
   earns its price. That is the Fable case, and it is rare.
3. **Escalate on evidence, one step, in a fresh context.** Sonnet `medium` fails its
   check → the same task on Opus, as a new dispatch with a three-line note of what
   failed, never the failed context → still stuck: `orch-debugger`. A task too big
   for Sonnet is two tasks, not an Opus task.
4. **Resume a stopped helper only if its cache is warm and the rest is short.** A
   helper's cache lives 5 minutes (the main conversation's, an hour). Within that
   and for two or three more steps, resume; otherwise start fresh from its PROGRESS
   file and branch — a cold resume re-writes its whole context at 1.25× input.

Judge cost per finished task, not per request: a cheap call that needs three
retries is not cheap.

**Verification instructions are model-specific.** On Opus 5, never add
"double-check": it verifies already and the words cost tokens. On Fable 5.1 at low
effort the risk runs the other way — it answers current facts from memory — so say
that recognising a name is not knowing its current state.
(`docs/research/0004-loops-and-stopping.md` (e))

## When a helper is worth it at all

For work that fits one context or is a dependent chain, the coordinator's own
model at lower effort won every measured case; delegation pays past one context
window, or for about ten files or three independent pieces (Anthropic,
optimizing-for-cost-and-intelligence; "How and when to use subagents", 2026-04-07).
Parallel helpers save wall-clock, not quota — each pays its own fixed load every
step — so run them only for independent, read-heavy work on cheap models. A
helper never waits on CI: past 5 idle minutes its next step re-writes its cache.

## Context

A million tokens is only useful if you will pay to re-read them. Give a wide read
to a helper, whose context dies with it, rather than to the conversation, which is
re-read on every later turn — but only a read that returns far less than it reads.
The Messages API can clear old tool results and compact server-side for an
SDK-hosted agent; no Claude Code session can ask for that, so the Pickup-line
handoff is the mechanism here.

## The lead's model and effort

The user chose them. The router mentions it once a week when effort is `xhigh` or
`max`; otherwise answer when asked, and never ask to change it mid-run — a switch
rebuilds the whole prompt cache (Fable 5.1 keeps it across an effort change).

| Plan | Model | Effort |
|---|---|---|
| Pro $20 | Sonnet | high, or Opus at medium |
| Max 5x $100 | Opus | high |
| Max 20x $200 | Opus | high |

A lead takes many short turns, each mostly a cached re-read: on Opus that re-read
is 2.5× Sonnet's price, and effort multiplies across every turn. Fable never leads.
`profile.mjs --set-default model=… effort=…` sets the default for new sessions.

## Price tags

Every dispatch gets a price before it happens, in list-price dollars — the unit
`/usage` computes its Session figure in, not what a subscription bills. Once the
ledger has priced runs of the same role and model (one row per helper, each API
call counted once, since 2026-09-13), the tag says `measured here, n=…`. Until then,
this reasoned table:

| Role | Fable | Opus | Sonnet | Haiku |
|---|---|---|---|---|
| `orch-researcher` | $10 | $5 | $1.50 | — |
| `orch-planner` | $8 | $4 | $1.20 | — |
| `orch-debugger` | $8 | $4 | $1.50 | — |
| `orch-reviewer` | $6 | $3 | $1 | — |
| `orch-implementer` | — | $4 | $1.50 | — |
| `orch-browser` | — | $3 | $1 | — |
| `Explore` | — | — | $0.50 | $0.10 |

No "% of your week": no weekly dollar figure has been measured. Live usage comes
from the status line instead (`scripts/statusline.mjs`). A model nobody named is
not priced.
