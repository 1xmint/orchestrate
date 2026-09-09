# Models: what each one is for, and when it is overkill

Prices and windows below are Anthropic's first-party API rates, cached 2026-06-24.
They move. Re-check the pricing page before a run that will spend heavily. On a
Max plan you are not paying these dollars, you are spending a share of a weekly
window, so read the ratios rather than the numbers.

This file exists so the manager reasons about a model instead of looking one up
in a table. `routing.md` says which role gets which model; this says why.

## The four

| Model | Window | In / Out per 1M | Effort | The one-line reason to pick it |
|---|---|---|---|---|
| Fable 5.1 | 1M | $10 / $50 | low–max, thinking always on | The most capable model available. For work that is hard to check and expensive to get wrong |
| Opus 5 | 1M | $5 / $25 | low–max | The default for judgment: planning, grading, deciding. Half Fable's price |
| Sonnet 5 | 1M | $2 / $10 | low–max | The default for bounded work with a strong oracle. A quarter of Fable |
| Haiku 4.5 | **200K** | $1 / $5 | **none: effort errors** | Reading, sweeping, extracting. Cheapest, and the only one you cannot tune |

Two facts in that table catch people out.

**Haiku's window is 200K, not 1M.** Every other current model holds a million
tokens. So a sweep that would fit anywhere else can overflow Haiku, and the
failure looks like a bad answer rather than an error. Before sending a wide read
to Haiku, ask whether the material fits in a fifth of what the others hold. If
it does not, split the sweep or send it to Sonnet.

**Haiku takes no effort setting at all.** Passing one is an error, not a hint.
So Haiku is the one model you cannot ask to think harder; if it is not enough,
the answer is a different model, not a different setting.

## Effort

Five levels: `low`, `medium`, `high`, `xhigh`, `max`. The API default is `high`.
`xhigh` is Claude Code's default and is documented as the best setting for most
coding and agentic work.

What it actually changes: how much the model thinks before acting, and with it
the shape of its output. **Lower effort produces fewer and more consolidated
tool calls, less preamble, and terser confirmations.** Higher effort produces
more thorough work and more of everything else.

- `low` — subagents doing simple work, classification, high-volume routes.
- `medium` — the cost-saving step down from `high`, where quality holds.
- `high` — the sweet spot for quality against tokens. Minimum for anything
  intelligence-sensitive.
- `xhigh` — long-horizon agentic work and hard coding. Between `high` and `max`.
- `max` — only when correctness matters more than cost, and only once
  measurement shows headroom left at `xhigh`. Otherwise it over-thinks.

Which workloads repay higher effort is a property of the work, not a preference.
Coding and long-horizon agentic work respond strongly. Chat, classification and
high-volume routes usually do not and are fine at `low`.

## Never go overkill

Four tests, in order. The first one that answers settles it.

1. **Is there an oracle?** If a test, a type checker, a schema or an exact spec
   can prove the answer wrong, a smaller model plus that oracle beats a larger
   model without it. Bounded change with strong tests: Sonnet.
2. **Can the work be checked at all?** If nothing but a human reading it can
   tell whether it is right, that is where the capable model earns its price:
   an adversarial audit, an ambiguous plan across modules, sources that
   disagree. This is the Fable case, and it is rare.
3. **Has a smaller model already failed on evidence?** Escalate on a failed
   attempt, never on a feeling that a task looks hard. `routing.md` has the
   fixed trigger list.
4. **Try lower effort on the better model before a cheaper model.** Lower effort
   on a current model often matches or beats the previous generation at high
   effort, and one model means one cache. Caches are model-scoped, so every
   model switch throws away the cached prefix and pays to re-read it.

And the rule that settles arguments: **judge cost per finished task, not per
request.** A cheap call that needs three retries is not cheap. This is why the
skill escalates on evidence and never on habit.

**Verification instructions are model-specific, and neither direction carries.**
On Opus 5, never add "double-check" or "re-verify": it verifies its own work
already, and the instruction costs tokens with no gain in quality. On Fable 5.1
at low effort the risk runs the other way — it answers current facts from memory
— so it is worth saying that recognising a name is not knowing its current
state. Never move either instruction to a different model without checking which
way that model fails. `docs/research/0004-loops-and-stopping.md` (e) has both
measurements.

## Context sweet spots

The window is not the constraint people think it is. A million tokens is only
useful if you are willing to pay to re-read them, because every later turn reads
the whole conversation again from cache.

- **Haiku, 200K.** Anything wide goes to Sonnet instead, or gets split.
- **The others, 1M.** The practical limit is what you are willing to re-read,
  not the ceiling. A subagent that fills its window is usually a task that
  should have been two tasks.
- **Give a wide read to a subagent, not to the conversation.** The subagent's
  context dies with it; the conversation's is re-read on every later turn. This
  is the whole reason this skill dispatches.
- **A model switch mid-run costs the whole cache.** Pick at the start.

## The manager's own model and effort

The manager is this conversation. It cannot set its own model or effort: the
user picks both when they start the conversation, before the manager exists. So
the manager's job is to notice when the setting is wrong for the work and say
so, once, with the fix.

| Plan | Model | Effort |
|---|---|---|
| Pro $20 | Sonnet | high |
| Max 5x $100 | Opus | high |
| Max 20x $200 | Opus | high |

The reasoning, which is the part that survives a new plan appearing:

- **A manager takes many short turns.** Effort multiplies across every one of
  them, while a worker takes one long turn and stops. So depth belongs in the
  workers. The planner and debugger agent files are already `xhigh`; that is
  where it is spent.
- **`high`, not `xhigh`, and never `max`.** `xhigh` is documented for
  long-horizon agentic tasks, which is the worker profile, not the manager's.
  `max` is for when measurement shows headroom at `xhigh`, and nobody has
  measured that for an orchestrator.
- **`high`, not `medium`, though this one is judgment.** Lower effort gives
  terser output and fewer tool calls, which this skill wants everywhere else.
  But the manager's core turns are grading a return and deciding what happens
  next, and those are intelligence-sensitive. Waste at `high` shows up in
  `/usage` this week; a shallow grade shows up as rework in three weeks.
- **Fable never manages.** It is the deep single-shot role. Its cost multiplied
  across a hundred manager turns buys nothing that `high` on Opus does not.
- **Set both once, at the start.** Changing model or effort mid-run rebuilds the
  whole prompt cache on Opus and Sonnet, so the switch costs more than the
  setting saves. Fable 5.1 is the exception: it keeps the cache across an effort
  change.

Nobody has published a measurement of effort on a multi-turn orchestrator. The
model rows are the plan defaults; the `high` row is reasoning, and it is marked
as reasoning on purpose.

**Saying it, and saying it once.** The router raises this on the first prompt
where it can actually see the model, which on a fresh session is prompt 2: the
first prompt is sent before any assistant record exists. Say it to the user in
one paragraph with the exact click, and give them two outs: switch now, or keep
it and say why. Then record the answer — `profile.mjs --set manager=accept` when
they take the recommendation, `--set manager=<model>/<effort> --why "…"` when
they keep what they have — and the router goes quiet for that plan. A tier
change re-opens it, because the recommendation changes with the tier. If they
want it permanent, `profile.mjs --set-default model=opus effort=high` writes the
default for *new* sessions into `~/.claude/settings.json`; the running
conversation still changes only with the picker.

**Cost is not a reason to stay low.** A manager turn is mostly cached re-reads
of a long conversation, so Opus at high costs little more per turn than Sonnet
does. The thing that actually costs money is a shallow grade that sends a task
round again. A nearly-spent window or a deliberately cheap session is a real
reason; agree with it, and say what you will do differently — a manager below
the table plans by dispatching `orch-planner` rather than inline, and dispatches
a reviewer whenever it is at or below the author.

**Effort does not reach everything.** `Explore` and `general-purpose` inherit
the session's effort; the six `orch-*` role files set their own and ignore it.
Haiku ignores effort entirely.

## Price tags

A dispatch should never be a surprise. Every one of them gets a price before it
happens, in list-price dollars, which is the same unit `/usage` computes its
Session figure in. The guard prints it, `lib/prices.mjs` works it out, and once
the ledger has priced two runs of the same role and model the tag stops being a
guess and says `measured here, n=2`.

Until then, the starting table. **Every number here is reasoned, not measured**,
from the per-million prices above and one observation of a real fan-out:

| Role | Fable | Opus | Sonnet | Haiku |
|---|---|---|---|---|
| `orch-researcher` | $10 | $5 | $1.50 | — |
| `orch-planner` | $8 | $4 | $1.20 | — |
| `orch-debugger` | $8 | $4 | $1.50 | — |
| `orch-reviewer` | $6 | $3 | $1 | — |
| `orch-implementer` | — | $4 | $1.50 | — |
| `orch-browser` | — | $3 | $1 | — |
| `Explore` | — | — | $0.50 | $0.10 |

A week of a plan, in the same unit, so a share can be worked out at all: Pro
about $30, Max 5x about $150, Max 20x about $600. That rests on **one
observation**, made 2026-09-09: three Fable researchers read 20.5M, 9.0M and
7.3M mostly-cached input tokens, which prices at roughly $36, and Josh reported
that fan-out as about a quarter of a Max 5x week. Everything else is that number
scaled by what the plans cost. It is a starting point, not a measurement, and
`profile.mjs --set week=<dollars>` replaces it with a real one.

List price is not what a subscription is billed. It is the only unit in which a
subscription dispatch can be priced at all, and it is the unit the host already
shows the user, so it is the one used here. Say so whenever a figure is printed.

## Sources

Model IDs, windows, prices and effort behaviour: the bundled `claude-api`
reference, cached 2026-06-24, read 2026-09-09. Effort guidance and the
cost-per-finished-task rule: the same file's Thinking & Effort section. Plan
inclusions: `routing.md`, checked 2026-09-08.
