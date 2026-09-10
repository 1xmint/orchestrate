# Models: what each one is for

First-party API rates and windows, cached 2026-06-24. They move; re-check before
a run that will spend heavily. On a Max plan you are not paying these dollars,
you are spending a share of a weekly window, so read the ratios.

## The four

| Model | Window | In / Out per 1M | Effort | Pick it for |
|---|---|---|---|---|
| Fable 5.1 | 1M | $10 / $50 | low–max, thinking always on | work that is hard to check and expensive to get wrong |
| Opus 5 | 1M | $5 / $25 | low–max | judgment: planning, grading, deciding. Half Fable's price |
| Sonnet 5 | 1M | $2 / $10 | low–max | bounded work with a strong oracle. A quarter of Fable |
| Haiku 4.5 | **200K** | $1 / $5 | **none: effort errors** | reading, sweeping, extracting |

Two things in that table catch people out. **Haiku's window is 200K, not 1M**, so
a sweep that fits anywhere else can overflow it, and the failure looks like a bad
answer rather than an error. **Haiku takes no effort setting**: passing one is an
error, so if Haiku is not enough the answer is a different model, not a different
setting.

## Effort

Five levels: `low`, `medium`, `high`, `xhigh`, `max`. The API default is `high`;
`xhigh` is Claude Code's default and is documented as best for most coding and
agentic work. It changes how much the model thinks before acting, and with it the
shape of the output: **lower effort gives fewer, more consolidated tool calls,
less preamble, terser confirmations.**

- `low` — simple subagent work, classification, high-volume routes.
- `medium` — the cost-saving step down from `high`, where quality holds.
- `high` — the sweet spot. Minimum for anything intelligence-sensitive.
- `xhigh` — long-horizon agentic work and hard coding.
- `max` — only when correctness matters more than cost, and only once
  measurement shows headroom left at `xhigh`. Otherwise it over-thinks.

Which workloads repay effort is a property of the work, not a preference. Coding
and long-horizon agentic work respond strongly; chat and classification do not.

Every agent inherits the session's effort, including the six `orch-*` roles.
Haiku ignores effort entirely. The role files used to pin their own — planner
and debugger at `xhigh` — which quietly overrode the level the user chose and
spent their quota at it. If a role genuinely needs more thinking than the
session is set to, that is a thing to say to the user, not to set behind them.

## Choosing between them

Four questions, in order; the first that answers settles it.

1. **Is there an oracle?** A test, type checker, schema or exact spec that can
   prove the answer wrong. A smaller model plus an oracle beats a larger model
   without one.
2. **Can the work be checked at all?** If only a human reading it can tell
   whether it is right, that is where the capable model earns its price. This is
   the Fable case, and it is rare.
3. **Has a smaller model already failed, on evidence?** Escalate on a failed
   attempt, never on a feeling that a task looks hard.
4. **Try lower effort on the better model before a cheaper model.** Caches are
   model-scoped, so every switch throws away the cached prefix.

The rule that settles arguments: **judge cost per finished task, not per
request.** A cheap call that needs three retries is not cheap.

**Verification instructions are model-specific, and neither direction carries.**
On Opus 5, never add "double-check" or "re-verify": it verifies its own work
already and the instruction costs tokens with no gain. On Fable 5.1 at low effort
the risk runs the other way — it answers current facts from memory — so it is
worth saying that recognising a name is not knowing its current state. Never move
either instruction to a different model without checking which way that model
fails. Both measurements: `docs/research/0004-loops-and-stopping.md` (e).

## Context

A million tokens is only useful if you are willing to pay to re-read them, since
every later turn reads the whole conversation again from cache. So the practical
limit is what you will re-read, not the ceiling. Give a wide read to a subagent,
whose context dies with it, rather than to the conversation, whose context is
re-read on every later turn. That is the whole reason this skill dispatches. A
subagent that fills its window was usually a task that should have been two.

## If the user asks what to run the lead on

Answer this when they ask. Do not raise it yourself, and never ask them to
change it mid-run: the skill used to inject that advice unprompted, which is a
session interrupting the user about the user's own settings.

| Plan | Model | Effort |
|---|---|---|
| Pro $20 | Sonnet | high |
| Max 5x $100 | Opus | high |
| Max 20x $200 | Opus | high |

Why, in the part that survives a new plan appearing: a lead takes many short
turns and effort multiplies across all of them, while a worker takes one long
turn and stops. `max` needs a measurement nobody has made for a multi-turn lead.
Fable never leads: its cost across a hundred short turns buys nothing `high` on
Opus does not.

Cost is not a reason to stay low. A lead's turn is mostly cached re-reads, so
Opus at high costs little more per turn than Sonnet; what costs money is a
shallow grade that sends a task round again.

Changing either mid-run rebuilds the whole prompt cache on Opus and Sonnet.
Fable 5.1 is the exception: it keeps the cache across an effort change.
`profile.mjs --set-default model=opus effort=high` sets the default for *new*
sessions; the running conversation changes only with the picker.

Nobody has published a measurement of effort on a multi-turn lead. The model
rows are the plan defaults; the `high` column is reasoning, marked as reasoning
on purpose.

## Price tags

Every dispatch gets a price before it happens, in list-price dollars — the same
unit `/usage` computes its Session figure in. The guard prints it,
`lib/prices.mjs` works it out, and once the ledger has priced two runs of the
same role and model the tag says `measured here, n=2` instead of guessing.

Until then, this table. **Every number is reasoned, not measured**, from the
per-million prices above and one observation of a real fan-out:

| Role | Fable | Opus | Sonnet | Haiku |
|---|---|---|---|---|
| `orch-researcher` | $10 | $5 | $1.50 | — |
| `orch-planner` | $8 | $4 | $1.20 | — |
| `orch-debugger` | $8 | $4 | $1.50 | — |
| `orch-reviewer` | $6 | $3 | $1 | — |
| `orch-implementer` | — | $4 | $1.50 | — |
| `orch-browser` | — | $3 | $1 | — |
| `Explore` | — | — | $0.50 | $0.10 |

There is no weekly figure here any more, and so no "% of your week" on a price
tag. The one that used to be printed — Pro about $30, Max 5x about $150, Max 20x
about $600 — came from a single observation on 2026-09-09 scaled by what the
plans cost. A percentage computed from that reads like a measurement, and a
reader has no way to tell it is not one.

List price is not what a subscription is billed. It is the only unit a
subscription dispatch can be priced in, and the unit the host already shows the
user. Say so whenever a figure is printed.

A model nobody named is not priced. An inherited model used to be priced as
Sonnet, which is a number invented about a dispatch whose model was unknown.

## Sources

Model IDs, windows, prices and effort behaviour: the bundled `claude-api`
reference, cached 2026-06-24, read 2026-09-09. Plan inclusions: `routing.md`,
checked 2026-09-08.
