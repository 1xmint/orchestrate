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
| API key / Console | all | pay per token; Fable is the most expensive tier by a wide margin, so it is treated like Pro here (off without opt-in). Current prices: the pricing page below | Opus 5 |

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
dollars rather than a window; use the Pro column, and dispatch to Fable only
after the user opts in for the day (`profile.mjs --fable-optin`).

The two Fable rules are held by a hook, not by this text: SKILL.md's
frontmatter registers `guard-agent.mjs` on the Agent tool when the skill is
invoked (`install.mjs --with-hook` does the same globally). It denies a
`model: fable` dispatch on pro/api/team/unknown without today's opt-in and
denies any packet carrying a credential. On Max 5x and Max 20x it caps Fable at
3 and 6 dispatches a day; past the cap it does not stall the run: it rewrites
the call to `opus` (`updatedInput`) and says so in a one-line context note. That
note, at dispatch time, is where you see the downgrade: the agent echoes the
model the packet named, not the one it ran on, so a return can say `fable` for
work an `opus` agent did. `ledger.mjs` writes the model the guard actually used
into the row's evidence cell from the session's dispatch record, and that cell
is the honest answer. Without the hook the same numbers are the rule.

The router (`scripts/router.mjs`, global) reads the same counter and shows
`fable n/3 today` in its hints; it also records a model-family limit seen in
the transcript today and moves that family one step down in every hint.

## Effort (for whoever edits the agent files; not a per-run choice)

A subagent's effort comes from its agent file (`effort:`) and cannot be set
per call. The six role agents already carry what fits: planner and debugger
`xhigh`, the rest `high`. Change a file only with a reason: `low`/`medium`
suit mechanical work; `xhigh` lowers total tokens on coding and long agentic
work by avoiding rework; `max` over-thinks routine tasks. The model is the
per-call lever and overrides the file.

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
| Fable dispatches | **none unless the user opts in for the day** | at most 3 a day | at most 6 a day |

Pass the model on the `Agent` call (`model: sonnet | opus | haiku | fable`).
Dispatch counts are a poor proxy for tokens: a Fable planner or debugger runs
long, and the main conversation may itself be on Fable.

**The orchestrator's own model is chosen at session start, not mid-run.** On
Max 5x the orchestrator belongs on Opus (the plan default) and Fable is spent
on the planner, reviewer and debugger dispatches; on Max 20x either works; on
Pro the session default (Sonnet) orchestrates and Opus does the judgment roles.
A `/model` switch mid-session rebuilds the whole prompt cache, so when the
session is already on Fable, say so once in the first progress note and let the
user decide at a natural break; do not suggest a switch in the middle of a run.
Changing effort on Fable 5.1 keeps the cache (2.1.260+); switching models never does.

Subagent requests get a 5-minute cache TTL by default even on a subscription,
against one hour for the main conversation. A long agent that waits on a build
re-reads its prefix after five idle minutes. `subagentPromptCacheTtl: "1h"`
(2.1.242+) in `~/.claude/settings.json` extends it; the API bills 1-hour cache
writes at a higher rate, and how that lands on plan usage is not documented, so
this skill leaves the default and names the lever here.

## Who reviews

The router's state line names the model *you* are running on (`you: opus @
high effort`), read from the transcript. It is a routing fact, not trivia:

- **You are strictly above the author** (you Opus, the author Sonnet) **and the
  class is not risky** → review the diff yourself. You already hold the goal,
  the packet and the rubric, so a reviewer dispatch buys no independence the
  author did not already lack, and costs a spin-up plus a return.
- **You are at or below the author, or the class is risky** (the list under
  trigger 2 below) → dispatch `orch-reviewer` on a model no weaker than the
  author's. A weaker reviewer produces a PASS you cannot bank.
- **You wrote any of the diff** → always dispatch. Never review your own edits;
  the point of the reviewer is that it did not decide what to write.
- **You cannot tell what you are running on** (`you: unknown model`) → dispatch.

The objective order behind this rule is: first-time-right, then total quota
including rework, then wall clock. Skipping a review that later costs a rework
loop is more expensive than the dispatch it saved, which is why the risky list
is not negotiable and the cheap path applies only above the author.

## Escalation triggers (fixed list)

A bigger *author* is chosen only after evidence; risk selects a *reviewer*.
Escalate the author one step (sonnet → opus → fable), and write which trigger
fired in the ledger, when:

1. one attempt failed on a packet that was complete (not a context gap);
4. two competent results disagree;
5. the agent reports a conceptual block rather than a missing fact;
6. the user asks.

These add an independent reviewer at dispatch time, not a bigger author:

2. security, auth, payments, a public surface, a schema or default change,
   data that moves or is rewritten, anything irreversible;
3. the task crosses module boundaries or changes an architecture (in a
   multi-crate or monorepo workspace that is most tasks; it is a review cue,
   not an opus cue).

De-escalate below the table only by naming the oracle that makes it safe: a
strong deterministic test, a type-checked interface, an exact spec.

Routing fails in two directions: everything to the strongest model (waste), or
hard work left on a cheap model that returns confident and wrong (rework). The
fixed list plus independent verification guards both.

## External CLIs (optional lane)

Codex, opencode, gemini and aider are separate quota pools and, for review, a
different vendor's blind spots. Use one only when `profile.mjs` shows it
installed **and** authenticated ("signed in", or for opencode "credentials
listed"). Most runs never need one; do not smoke-test a provider you have no
dispatch planned for. When a dispatch to it is planned, run
`scripts/smoke.mjs <provider>` once first; it spends a tiny amount of that quota.
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
