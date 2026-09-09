# 0002: What model and effort the orchestrating conversation should run at

Task 9-9-0002. Researcher: Fable 5.1. All sources read 2026-09-09. Host in
scope: Claude Code desktop app 2.1.260 on a Claude subscription.

**Grade: CONDITIONAL.** The mechanics (what effort does, how it is set,
what it does to the cache, how subagents inherit it) are PROVED from
Anthropic's own docs. The choice of level for a many-short-turn manager is
JUDGMENT: no published measurement of effort levels on a dispatch-and-grade
workload exists, and I say so below rather than dress reasoning up as data.

## The answer

| Plan | Manager model | Manager effort | Why, in one line |
|---|---|---|---|
| Pro $20 | Sonnet | high | Sonnet is the plan default and the Pro window is small; Sonnet's `medium` is documented as "comparable to Sonnet 4.6 at high", so the judgment turns need `high`; Opus is spent on planner/reviewer/debugger dispatches instead. |
| Max 5x $100 | Opus | high | Opus is the plan default; `high` is the model default and the level Anthropic says to start at; step down to `medium` only on runs that are mostly dispatch and grading against strong gates, and measure with `measure.mjs`. |
| Max 20x $200 | Opus | high | Same as 5x. The bigger allowance buys more Fable dispatches, not a deeper manager: `xhigh` is documented for "long-running agentic and coding tasks (over 30 minutes)", which is the worker profile, not the manager's. |

Two things fall out of that table that a vibe coder should hear first:

1. **On every tier the table is the plan default.** Pro defaults to Sonnet,
   Max defaults to Opus, and every model defaults to `high`. A fresh install
   is already correct. The only work is to check that nothing overrode it
   (see "How to set it" and the local observation about this machine).
2. **Never `xhigh` or `max` for the manager, on any tier.** Not because they
   are bad, but because the design already sends depth to `orch-planner`
   and `orch-debugger` at `xhigh` (E19), and because on Opus and Sonnet an
   effort change mid-session throws the prompt cache away (E9), so "bump it
   for the migration" costs a full re-read of the conversation.

## Where this is evidence and where it is judgment

- Evidence: what each level does, the per-model recommendations, the
  effort-with-tools behaviour, cache invalidation rules, inheritance rules,
  plan defaults, the exact clicks and keys. Every one is quoted below with
  its URL.
- Evidence, but from Anthropic's own orchestration examples rather than a
  measurement: Anthropic's API "orchestration mode" runs the lead at `xhigh`
  on Opus 5 and lets subagents inherit it (E12); Claude Code's `ultracode`
  is the same idea in-product and its docs say to "drop back with `/effort
  high` when you return to routine work" (E13). Those are the vendor's
  "spend whatever it takes" modes, and they say so.
- Judgment: that a dispatch-and-grade manager sits at `high` rather than
  `medium` on Max. The two nearest published measurements (E22, E23) are
  single-agent coding sweeps on Opus 4.7, not a manager, and one of them is
  three tasks. The 2025 Anthropic multi-agent paper (E21) shows an Opus lead
  with Sonnet workers beat a single Opus by 90.2% but never varies effort.
  **Nobody has measured effort on a multi-turn orchestrator.**

## Evidence log

Each entry: source, date read, the sentence it rests on.

- **E1** Claude Code model-config, effort table.
  https://code.claude.com/docs/en/model-config — 2026-09-09.
  "`high` — Balances token usage and intelligence. The default on every model
  except Opus 4.7." "`xhigh` — Deeper reasoning at higher token spend."
  "`max` — Can improve performance on demanding tasks but may show
  diminishing returns and is prone to overthinking. Test before adopting
  broadly." "`medium` — Reduces token usage for cost-sensitive work that can
  trade off some intelligence." Also: "The effort scale is calibrated per
  model, so the same level name does not represent the same underlying value
  across models."
- **E2** Same page, defaults by plan. "Pro and Team Standard: defaults to
  Sonnet 5." "Anthropic API, Max, Team Premium, Enterprise…: defaults to
  Opus 5."
- **E3** Same page, resolution order with `ultracode` off: (1) explicit
  choice (`CLAUDE_CODE_EFFORT_LEVEL`, `--effort`, `/effort`); (2) a
  model-default hold on Fable 5 / Opus 4.8 / Opus 4.7 only ("Opus 5 and
  Fable 5.1 have no such hold"); (3) "Your settings: the level you saved for
  the model or an `effortLevel` key"; (4) the model default, `high`.
- **E4** Same page, how to set it. "`/effort`: run `/effort` with no
  arguments to open an interactive slider, `/effort` followed by a level
  name to set it directly… once you confirm the cache warning, if Claude
  Code shows one, Claude Code applies the new level to the next request in
  the turn." "In `/model`: use left/right arrow keys to adjust the effort
  slider when selecting a model." "`--effort` flag." "Settings: set a
  per-model level in `modelSettings`, or set `effortLevel` to `low`,
  `medium`, `high`, or `xhigh` as the default for models without one. `max`
  isn't accepted in either key." "When you set `low`, `medium`, `high`, or
  `xhigh` in an interactive session on your machine, Claude Code saves the
  level and applies it in later sessions. It saves the level per model,
  under the `modelSettings` key." "`/model` saves your choice as the default
  for new sessions by writing the `model` field in your user settings."
- **E5** Same page, one-turn depth without changing effort. "Include
  `ultrathink` anywhere in your prompt to request deeper reasoning on that
  turn without changing your session effort setting… The effort level sent
  to the API is unchanged."
- **E6** Same page, frontmatter. "Frontmatter effort applies when that skill
  or subagent is active, overriding the session level but not the
  environment variable."
- **E7** Claude Code sub-agents, `effort` field.
  https://code.claude.com/docs/en/sub-agents — 2026-09-09.
  "`effort` | No | Effort level when this subagent is active. Overrides the
  session effort level. Default: inherits from session."
- **E8** Claude Code agent-teams. https://code.claude.com/docs/en/agent-teams
  — 2026-09-09. "Teammates inherit the lead's effort level." (Teams are CLI
  only and off by default; noted for completeness.)
- **E9** Claude Code prompt-caching, effort and models.
  https://code.claude.com/docs/en/prompt-caching — 2026-09-09.
  "Effort level: on most models, each effort level has its own cache, so
  changing effort mid-session recomputes the entire request. On Fable 5.1
  with an API key or a Claude subscription, the cache stays intact by
  default." "Before v2.1.260, changing effort on Fable 5.1 with an API key or
  a Claude subscription also invalidated the cache." "Each model has its own
  cache. Switching with `/model` means the next request reads the entire
  conversation history with no cache hits." Tip: "Pick your model and effort
  level at the top of a session." TTL table: main conversation one hour on a
  subscription within plan usage; subagents five minutes.
  *This settles the packet's open question: in Claude Code, only Fable 5.1
  keeps the cache across an effort change. Opus 5 and Sonnet 5 do not, even
  though the API supports per-message effort on Opus 5 (E11).*
- **E10** API effort page, level table and tool-use behaviour.
  https://platform.claude.com/docs/en/build-with-claude/effort — 2026-09-09.
  "`xhigh` — Extended capability for long-horizon work… Long-running agentic
  and coding tasks (over 30 minutes) with token budgets in the millions."
  "`high` — Complex reasoning, difficult coding problems, agentic tasks."
  "`medium` — Balanced approach with moderate token savings. Agentic tasks
  that require a balance of speed, cost, and performance." "`low` — Simpler
  tasks that need the best speed and lowest costs, such as subagents."
  "Effort is a behavioral signal, not a strict token budget. At lower effort
  levels, Claude still thinks on sufficiently difficult problems, but thinks
  less." "Lower effort also means fewer and terser tool calls." Higher effort
  "may: Make more tool calls; Explain the plan before taking action; Provide
  detailed summaries of changes."
- **E11** Same page, per-model. Opus 5: "Start with `high`, the default…
  step up to `xhigh` for demanding coding and agentic work, or to `max` when
  a task justifies unconstrained token spending, and use `low` and `medium`
  liberally as your primary control for token cost and response time
  wherever your evals show quality holds." Sonnet 5: "Medium effort:
  Cost-saving step-down from the default. Comparable to Claude Sonnet 4.6 at
  high effort." "Xhigh effort: For the hardest coding and agentic tasks."
  Fable 5.1: "Start with `high`, the default." Opus 4.7 (older, but the only
  place the behaviour is spelled out): "At lower effort levels, the model
  scopes its work to what was asked rather than doing more than requested.
  If you observe shallow reasoning on complex problems… raise effort." Mid-
  conversation: "On Claude Fable 5.1, Claude Mythos 5.1, and Claude Opus 5,
  use a per-message effort change, which keeps the prompt cache. On other
  models… starts the cache over." Best practice 5: "Hold top-level effort
  constant within cached conversations."
- **E12** Anthropic API example, "Build an orchestration mode".
  https://platform.claude.com/docs/en/build-with-claude/mid-conversation-effort-example
  — 2026-09-09. Constants `MODEL = "claude-opus-5"`, `EFFORT = "xhigh"`;
  "Subagents inherit the main loop's effort level"; standing consent text:
  "Orchestration mode is on: optimize for the most exhaustive, correct
  answer rather than the fastest one." Note: "The fan-out itself multiplies
  token usage… so reserve the mode for work that justifies the cost."
- **E13** Claude Code workflows / ultracode.
  https://code.claude.com/docs/en/workflows — 2026-09-09.
  "Ultracode is a Claude Code setting that combines `xhigh` reasoning effort
  with automatic workflow orchestration." "This applies to every task in the
  session, so each request uses more tokens and takes longer than at lower
  effort levels." "Drop back with `/effort high` when you return to routine
  work."
- **E14** Anthropic blog, model and effort in Claude Code (2026-07-07).
  https://claude.com/blog/claude-model-and-effort-level-in-claude-code —
  2026-09-09. "For most tasks you should use the model's default effort
  level." "Pick a higher effort level if Claude got it wrong by skipping a
  file, not running the tests, or not double-checking its work." "Pick a
  larger model when the problem is genuinely hard… subtle bugs, unfamiliar
  domains, or architecture decisions."
- **E15** Prompting Claude Opus 5.
  https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5
  — 2026-09-09. "Code review and bug-finding: … Accuracy holds at lower
  effort settings, which supports a fast pass at review time and a more
  thorough pass later." "Efficiency at lower effort: `low` and `medium`
  effort produce strong quality at a fraction of the tokens and latency of
  higher settings." "Claude Opus 5 delegates to subagents more readily than
  prior models… Do not delegate work you can finish yourself in a handful of
  tool calls." "The effort parameter controls how much the model thinks
  rather than how much it says."
- **E16** Prompting Claude Fable 5.1, "Consider all effort levels".
  https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5-1
  — 2026-09-09. "At `low`, Claude Fable 5.1 is often competitive with Claude
  Opus and Claude Sonnet models on cost per task while scoring higher, so
  include it in the comparison wherever you'd otherwise run a smaller model
  at a higher effort level." Also: "At `low` effort, Claude Fable 5.1 is
  less likely… to call a search or retrieval tool, and more likely to answer
  from memory."
- **E17** Steering thinking.
  https://platform.claude.com/docs/en/build-with-claude/thinking-steering-and-cost
  — 2026-09-09. "`high` (default) — Claude almost always thinks." "`medium`
  — Claude uses moderate thinking. May skip thinking for simple queries."
  "`xhigh` — Claude always thinks deeply with extended exploration." Per-
  message steering: "An agent harness, for example, can append the
  encouraging phrase on planning steps and the suppressing phrase on routine
  confirmations, without… changing any request parameters between turns."
- **E18** Prices. Opus 5 "$5 USD per million input tokens and $25 USD per
  million output tokens"
  (https://platform.claude.com/docs/en/models/opus-5/whats-new-opus-5,
  2026-09-09). Sonnet 5 "$2 per million input tokens and $10 per million
  output tokens"
  (https://platform.claude.com/docs/en/models/sonnet-5/whats-new-sonnet-5,
  2026-09-09). Opus 5 whats-new also: "Effort matters more… converts
  additional effort into better results more reliably than any earlier Opus
  model."
- **E19** This repo. `skills/orchestrate/assets/agents/orch-planner.md:5`
  `effort: xhigh`; `orch-debugger.md:5` `effort: xhigh`; implementer,
  researcher, reviewer, browser `effort: high`. `references/routing.md:139`:
  "The orchestrator's own model is chosen at session start, not mid-run."
- **E20** Desktop app. https://code.claude.com/docs/en/desktop — 2026-09-09.
  "Model: pick a model from the dropdown next to the send button. You can
  change this during the session." Shortcuts: "Cmd Shift I — Open model
  menu", "Cmd Shift E — Open effort menu". "Settings in `~/.claude.json` and
  `~/.claude/settings.json` are shared." Help Center
  https://support.claude.com/en/articles/8664678-change-the-model-effort-and-thinking-settings
  (2026-09-09): "Click the model name next to the send button. Click
  'Effort.' Choose a level." "changes apply starting with Claude's next
  response."
- **E21** Anthropic engineering, multi-agent research system (2025-06-13).
  https://www.anthropic.com/engineering/multi-agent-research-system —
  2026-09-09. "Claude Opus 4 as the lead agent and Claude Sonnet 4
  subagents… outperformed single-agent Claude Opus 4 by 90.2%." "token usage
  by itself explains 80% of the variance." No effort variable.
- **E22** Towards AI, "I Tested All 5 Effort Levels of Claude Opus 4.7 on
  the Same 12 Coding Problems" (2026-04-20).
  https://pub.towardsai.net/i-tested-all-5-effort-levels-of-claude-opus-4-7-2f335c626786
  — page returned 403 on 2026-09-09; the search snippet gives "per-task cost…
  can swing by 2.7x depending on which tier you pick, for gains that are
  sometimes 12 points and sometimes 0.3." Single-agent coding, Opus 4.7.
- **E23** DataCamp, Opus 4.7 effort benchmark (2026-04-21).
  https://www.datacamp.com/tutorial/opus-4-7-project — 2026-09-09. Three
  sequential coding tasks, 18 runs; "the `max` runs… averaged around 300
  thinking tokens per task, well below the 20,000 limit." Too small and not
  a manager.
- **E24** Anthropic, Introducing Claude Sonnet 5 (2026-06-30).
  https://www.anthropic.com/news/claude-sonnet-5 — 2026-09-09. "It provides
  substantially improved cost efficiency at medium effort; its higher-effort
  performance can match Opus 4.8 on some tasks." (Cost-performance curves on
  BrowseComp and OSWorld-Verified, single agent.)
- **E25** Anthropic, Introducing Claude Opus 5 (2026-07-24).
  https://www.anthropic.com/news/claude-opus-5 — 2026-09-09. "Even at its
  lowest effort setting, Opus 5 passes more tasks than any other model"
  (Zapier AutomationBench).
- **E26** Claude Code costs. https://code.claude.com/docs/en/costs —
  2026-09-09. "you can reduce costs by lowering the effort level with
  `/effort` or in `/model`." "Sonnet handles most coding tasks well and
  costs less than Opus. Reserve Opus for complex architectural decisions or
  multi-step reasoning."

## 1. The workload

`SKILL.md` describes the manager turn by turn. Sorting its turns by whether
they need reasoning depth or only instruction-following:

Instruction-following (most turns): open the ledger (§1), write Facts
verbatim (§2), fill the packet template "every field, every time" (§5), run
the mechanical checks on a return ("schema complete; RESTATED matches the
objective; BRANCH and WORKTREE present; CHANGED only in allowed files", §6),
keep `RUN.md` current (§8), talk plainly (§9). §4 is explicit that the
manager should not read wide or run suites: "your context is the scarce
resource" and "never run a suite in this conversation" (§6).

Reasoning turns (few, but they are the job): choose the model per task and
justify it (§0: "Nothing mechanical decides which model a task deserves; that
is yours"); plan inline "when the goal is clear and fits one sitting" (§3);
the drift check and the grade (§6: "Evaluate like a reviewer, not a
recipient"); name the failure class and pick the ladder rung (§7). And §3
already routes the hard planning away: "send it to `orch-planner` when it is
ambiguous, crosses modules, or is bigger."

What the docs say about those two kinds of turn:

- Lower effort gives "fewer and terser tool calls" and skips "preamble"
  (E10). That is the behaviour §4 and §9 ask of the manager.
- Review "accuracy holds at lower effort settings" on Opus 5 (E15). Grading
  a return is review.
- Higher effort makes the model "explain the plan before taking action" and
  "provide detailed summaries" (E10), which §9 forbids ("do not narrate what
  you are about to do").
- Judgment failures are the model's job, not effort's: raise effort when
  Claude "skipped a file, not running the tests, not double-checking";
  choose a larger model for "architecture decisions" (E14).

So: the manager's failure modes (wrong routing, a grade that lets drift
through, a mis-planned slice) are model-lever failures, and its cost
pressures (many turns on a long cached context) are effort-lever pressures.
That is why the table moves the model up before it moves effort up.

## 2. Uniform effort, or "set it low and dispatch the hard turns"?

The skill's design argues for the second. The docs make it the only sane
option on Opus and Sonnet, because effort cannot vary mid-session for free:

- On Opus 5 and Sonnet 5 in Claude Code, a mid-session effort change
  "recomputes the entire request" (E9). On a manager whose context is the
  whole run, that is the most expensive turn you can buy.
- Only Fable 5.1 keeps the cache across an effort change (E9). The API
  supports it on Opus 5 too (E11), but Claude Code does not use it there.

So effort is a per-session constant, chosen at the top. Where does the depth
for a hard turn come from? Three levers, in the order the design prefers:

1. **Dispatch it.** `orch-planner` and `orch-debugger` carry `effort: xhigh`
   in their files (E19), and frontmatter effort "overrides the session
   effort level" (E7). A manager at `high` or `medium` dispatching a planner
   at `xhigh` is exactly the vendor's own pattern with the sign flipped:
   depth in the worker, not the loop.
2. **`ultrathink` in the prompt.** One-turn deeper reasoning "without
   changing your session effort setting" and with "the effort level sent to
   the API unchanged" (E5), so the cache survives. Josh can type it on the
   turn where the manager plans inline.
3. **Raise session effort** and eat the cache rebuild. Last resort, and
   only at a natural break.

Is the design in tension with the effort setting? Only if the manager sat at
`xhigh`: then every packet-filling and ledger turn "always thinks deeply
with extended exploration" (E17) and the dispatch design is paying twice
for depth. At `high` or `medium` there is no tension: adaptive thinking
still "thinks on sufficiently difficult problems" (E10), and the truly hard
work leaves the conversation.

One inheritance hazard the design must know about: subagents with no
`effort:` line "inherit from session" (E7). The six `orch-*` agents set it,
so they are immune. `Explore` and `general-purpose` do not, so they run at
whatever the manager runs at. At `medium` that is fine for a sweep. At
`low` (which this machine's settings currently force; see below) a
`general-purpose` fallback used before the `orch-*` files are installed
(SKILL.md §0) would do writing work at `low`.

## 3. The three tiers

See the table at the top. The reasoning per row:

**Pro.** Sonnet is the default (E2) and the Pro window is shared with the
app. Sonnet 5 at `medium` is "comparable to Claude Sonnet 4.6 at high"
(E11), which is a step below what the grading turns deserve, so `high`.
Opus is included on Pro and the router already sends it the judgment roles;
running the manager on Opus too would spend the Pro window at 2.5x per
token (E18) on every turn of a long context. *Judgment:* if a Pro user finds
the manager mis-grading, the fix is `/model opus` at a session start, not
`/effort xhigh` on Sonnet, per E14.

**Max 5x.** Opus is the default (E2). `high` is the model default and the
documented starting point (E11, E14). `medium` is documented as "strong
quality at a fraction of the tokens" on Opus 5 (E15) and is what Josh runs;
the honest position is that nobody has measured `medium` against `high` for
this workload, and the tie-breaker for a *shipped default* is which mistake
is visible: wasted tokens at `high` show up in `/usage`; a shallow grade at
`medium` shows up weeks later as rework. Ship `high`; name `medium` as the
step-down for dispatch-heavy runs with strong gates; let `measure.mjs`
be the eval.

**Max 20x.** Same. The extra allowance changes how many Fable planner and
reviewer dispatches a run can afford (routing.md's "50% of the weekly
limit" rule), not what a packet-filling turn needs. `xhigh` is for
"long-running agentic and coding tasks (over 30 minutes)" (E10): one
worker's whole life, not one manager turn.

**The Fable-as-manager decision.** The packet says challenge only with
evidence. There is one piece: Fable 5.1 is the only model where a mid-run
effort change keeps the cache (E9), and its docs say that at `low` it is
"often competitive with Claude Opus and Claude Sonnet models on cost per
task while scoring higher" (E16). So a Fable manager at `low` that bumps to
`high` on judgment turns is technically possible without cache loss. Against
it: Fable draws on the 50% weekly cap that routing.md reserves for planner,
reviewer and debugger; Fable at `low` is "more likely to answer from
memory" (E16), which fights SKILL.md §2; and there is no measurement. I do
not recommend reopening the decision. I record it so the next person knows
the lever exists.

## 4. The crux: weaker model at higher effort, or stronger at lower?

Evidence on the trade, all single-agent:

- Sonnet 5 at high effort "can match Opus 4.8 on some tasks" (E24). Note:
  4.8, not 5.
- Opus 5 "even at its lowest effort setting… passes more tasks than any
  other model" on an automation benchmark (E25).
- Fable 5.1 at `low` beats Opus and Sonnet on cost per task while scoring
  higher (E16).
- Anthropic's rule of thumb: effort fixes diligence failures; model fixes
  hard-problem failures (E14).

Price of the trade for a manager specifically (*judgment*, from E18 and the
cache TTL rules in E9): a manager turn is a short output on a long, cached
input. Effort scales the thinking (output) side; model scales every token
including the cached re-reads. Opus 5 is 2.5x Sonnet 5 per token on both
sides. So "Opus at medium" and "Sonnet at high" are not far apart in cost on
a manager, and the newer, stronger model wins the judgment turns. On Max,
where Opus is included, that decides it: Opus. On Pro, the window decides
it: Sonnet, and reach for Opus by dispatch.

What is *not* known: whether Opus at `medium` grades returns as well as
Opus at `high` on this skill's packets. E15 says review accuracy "holds at
lower effort" on Opus 5, which is the closest published sentence and is
about review, which is most of what the manager does with a return.

## 5. What changes the answer

- **A run that is mostly dispatch and grading** (the design's normal case):
  `medium` on Opus is defensible and cheaper; the returns are checked by
  gates and reviewers, not by the manager's own depth. Set it at session
  start; do not flip mid-run.
- **A run where the manager does the work itself** (SKILL.md §4's "one
  file, a few minutes, short output: do it yourself", stretched): `high`,
  and if it keeps stretching, that is a routing failure, not an effort
  problem; dispatch.
- **A migration or architecture run**: the manager stays where it is and
  sends the plan to `orch-planner` at `xhigh` (already in the file). Typing
  `ultrathink` on the one inline-planning turn is the cache-safe way to get
  more depth in the conversation.
- **Fable 5.1 in the chair** (not recommended): effort becomes a free
  per-turn lever (E9).
- **A new model generation**: E1 says level names are "calibrated per
  model", and E11 says to "run a fresh effort sweep" after a model change.
  Re-check this document when Opus 5 or Sonnet 5 is replaced.

## 6. How to set it (the friction)

Desktop app, Code tab (E20):

1. Click the model name next to the send button and pick the model
   (`Cmd`/`Ctrl` `Shift` `I` opens the same menu).
2. Click **Effort** in that menu and pick **High** (`Cmd`/`Ctrl` `Shift`
   `E` opens it directly). It applies from the next reply.

CLI, one session: `claude --model opus --effort high` (Pro: `--model
sonnet`). Persistent, `~/.claude/settings.json`:

```json
{ "model": "opus", "effortLevel": "high" }
```

`/model` and `/effort` inside a session save the same two things (E4).
Pick both at the top of a session; switching either mid-run rebuilds the
cache on Opus and Sonnet (E9).

### The two README sentences

> Before you start a run, click the model name next to the send button in
> the Claude Code desktop app and pick **Opus** on a Max plan or **Sonnet**
> on Pro, then click **Effort** and pick **High** (or, in a terminal, start
> with `claude --model opus --effort high`).
>
> Set both once at the start and leave them: changing the model or the
> effort in the middle of a run makes Claude re-read the whole conversation
> on the next turn, which is slow and spends your usage for nothing.

### Local observation (this machine, 2026-09-09)

`C:\Users\Josh\.claude\settings.json` contains `"model": "sonnet"` (line 5)
and `"effortLevel": "low"` (line 63), and no `modelSettings` key. By the
resolution order in E3, any CLI session on this machine that does not set
effort explicitly runs at **`low`** on **Sonnet**, and every subagent
without its own `effort:` line inherits `low`. That contradicts the packet's
"Josh currently runs the manager on Opus at medium effort"; the desktop
picker may be overriding per session, or the packet fact is stale. Either
way, the settings file is the thing a fresh session reads. Not changed here
(forbidden file); reported so it can be.

## Not verified

- *Judgment:* `high` over `medium` for an Opus manager on Max. No published
  measurement of effort on a multi-turn dispatch-and-grade loop exists;
  E22 and E23 are single-agent coding sweeps on an older model.
- *Judgment:* the relative cost argument in §4 (cached input dominates a
  manager turn). It follows from E9 and E18 but was not measured on a run;
  `measure.mjs` can measure it.
- Not found: a live statement of how much faster Opus consumes the Pro or
  Max window than Sonnet. The support article
  (https://support.claude.com/en/articles/11145838-using-claude-code-with-your-pro-or-max-plan,
  2026-09-09) does not say. The 2.5x is API list price (E18), not plan
  usage.
- Not found: whether the desktop app's Effort menu persists across
  sessions the way the CLI's `/effort` does (E4 documents the CLI; the Help
  Center article says only "changes apply starting with Claude's next
  response").
- Not found: any Anthropic guidance on effort for the *lead* in a
  cost-aware multi-agent setup other than the two "spend it all" modes
  (E12, E13).

## Stop condition

Stopped because another search could not change the table: the mechanics
are settled by primary docs, and the one open question (medium vs high for
the manager) has no published answer to find. It has a local answer to
build: run the same class of run at both levels and compare `measure.mjs`
and the rework count in `RUN.md`.

Confidence: high on the mechanics and the "no `xhigh`/`max` for the
manager" rule; medium on `high` over `medium` for Opus on Max. What would
change it: one measured comparison of grading quality and rework at
`medium` versus `high` on this skill's own runs, or Anthropic publishing a
cost-aware orchestrator effort recommendation.
