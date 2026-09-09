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

## Sources

Model IDs, windows, prices and effort behaviour: the bundled `claude-api`
reference, cached 2026-06-24, read 2026-09-09. Effort guidance and the
cost-per-finished-task rule: the same file's Thinking & Effort section. Plan
inclusions: `routing.md`, checked 2026-09-08.
