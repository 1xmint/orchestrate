# 0001 — Is `orchestrate` the best drag-and-drop agentic setup a vibe coder could install today?

Task 9-9-0001. Researcher: orch-researcher on Fable 5.1. Written 2026-09-09 against
`main @ 234b1e3`, tag v0.5.1. Every external claim below carries the URL and the date it
was read; every repo claim carries a path and line. Grades follow `references/evaluation.md`
§3: PROVED, CHECKED, CONDITIONAL, OBSERVED, SPECULATION, REFUTED, GAP.

## Verdict

**No, not today.** For the vibe coder as defined (describe a goal, have the hard parts
delegated, steer), the best drop-in on 2026-09-09 is one of two things, depending on
appetite:

- **Zero install:** Claude Code's own plan mode + `/goal` + auto mode + `/effort
  ultracode` (dynamic workflows) + the built-in Concise or Proactive output style. Users
  who left the frameworks say this out loud: "Plan mode became enough and I prefer to
  steer Claude Code myself ... they burn 10x more tokens" (gtirloni,
  https://news.ycombinator.com/item?id=47418626, read 2026-09-09); "The creators use a
  simple /goal, which suggests latest models have gotten past needing Superpowers"
  (jannyfer, https://news.ycombinator.com/item?id=48739459, read 2026-09-09).
- **One-command add-on:** obra/superpowers, `/plugin install
  superpowers@claude-plugins-official` (https://github.com/obra/superpowers, read
  2026-09-09), 283,855 stars, pushed 2026-09-08 (GitHub API,
  https://api.github.com/repos/obra/superpowers, read 2026-09-09). Installable from the
  desktop app's plugin browser without a terminal
  (https://code.claude.com/docs/en/desktop, "You can install plugins from the desktop app
  without using the terminal", read 2026-09-09).

`orchestrate` loses on the word "install", not on the ideas. It needs a terminal, git,
Node 18, a placeholder clone URL, a settings.json merge, and a hand-edited JSON key to get
the promised voice. It has 0 stars and was created today (GitHub API,
https://api.github.com/repos/1xmint/orchestrate, `created_at 2026-09-09T01:38:20Z`, read
2026-09-09). And its central loop, plan → dispatch → grade → integrate, has never been run
end to end on a real goal (`STATE.md:179-181`: "A real orchestration, then
`measure.mjs --latest`. Until then the efficiency numbers ... are reasoned estimates").

What it does that nothing in the field does in one place (CHECKED, from the files): route
the model by the user's plan and ask before spending money the plan does not include
(`references/routing.md:47-82`); refuse a packet carrying a credential
(`scripts/guard-agent.mjs:29-53`); a ledger on disk with a pickup line that survives a
dead session (`assets/RUN.md:39-43`, `scripts/turn-check.mjs`); a return schema enforced by
a Stop hook (`scripts/return-check.mjs`); a free cost meter (`scripts/measure.mjs`); zero
dependencies. Those are real advantages once the install and the proof exist. They are
not advantages a vibe coder can reach today.

## The three changes that would most improve it

1. **Ship it as a Claude Code plugin.** Plugins carry skills, agents, hooks and output
   styles ("Plugins can also ship output styles in an `output-styles/` directory",
   https://code.claude.com/docs/en/output-styles, read 2026-09-09) and install with one
   command or from the desktop plugin browser, which shows "A **Context cost** estimate"
   and "A **Will install** section listing the plugin's commands, agents, skills, hooks"
   before installing (https://code.claude.com/docs/en/discover-plugins, read 2026-09-09).
   Add `.claude-plugin/plugin.json` and a `marketplace.json`, keep `scripts/install.mjs`
   as the no-marketplace fallback, and do not set `force-for-plugin` (Plain stays off by
   Josh's decision). Caveat: plugin hooks still need `node` on PATH; the desktop
   troubleshooting page says restart the app when "Claude can't find tools like `npm`,
   `node`" (https://code.claude.com/docs/en/desktop, read 2026-09-09). The absolute-path
   templating in `lib/settings.mjs` is the right answer and a plugin cannot do it, so
   state that trade-off in the README rather than hide it.
2. **Run one real orchestration, publish `measure.mjs` numbers, and cut the verification
   rules Anthropic now says cost tokens for nothing.** `SKILL.md:150-152` says "have
   `Explore` run the verification commands ... never run a suite in this conversation",
   and `references/evaluation.md:78-80` demands two fresh-context reviewers plus the
   orchestrator's own read for high-risk work. Anthropic's Opus 5 guide (the model this
   skill puts the manager on) says: "If your prompt contains explicit verification
   instructions ('include a final verification step for any non-trivial task,' 'use a
   subagent to verify'), remove them: instructions like these cause over-verification on
   Claude Opus 5, and removing them reduces wasted tokens with no loss in quality" and "do
   not use subagents to verify or double-check your own work"
   (https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5,
   read 2026-09-09). Keep the independent reviewer for the risky classes (the Claude Code
   best-practices page still recommends an adversarial review subagent,
   https://code.claude.com/docs/en/best-practices, read 2026-09-09; the two Anthropic pages
   disagree and I say so below). Drop the Explore-runs-the-gate rule in favour of the
   filtered command `evaluation.md:17-20` already describes, and make the second reviewer
   opt-in.
3. **Make the default posture proactive and the first run question-free.** The built-in
   Proactive style is defined as "Claude executes immediately, makes reasonable assumptions
   instead of pausing for routine decisions, and prefers action over planning"
   (https://code.claude.com/docs/en/output-styles, read 2026-09-09). That sentence is the
   vibe loop, and Plain does not contain it; a user can select only one style, so Plain
   should absorb it. Then rewrite Plain's rules as positive examples, because "Positive
   examples of the communication style you want tend to be more effective than
   instructions about what not to do" (Opus 5 guide, above); seven of Plain's rules are
   "Do not" sentences (`assets/output-styles/plain.md:27-31,35-41`). Finally, replace the
   README's five manual loading checks (`README.md:96-112`) with one self-check the skill
   runs on its first invocation, so the only thing a first run asks for is the goal.

## Method

Read every file the packet named (`README.md`, `skills/orchestrate/SKILL.md`,
`references/*.md`, `assets/*`, `scripts/*.mjs`, `STATE.md`); there is no `docs/` directory
and no `SKILL.md` at the repo root (Glob, 2026-09-09). Then searched and fetched primary
pages for eleven alternatives, the Claude Code docs the cost and prompting judgments rest
on, Anthropic's two prompting guides, three Hacker News threads, one arXiv framework study,
and one independent audit. Reddit is blocked to this agent's fetcher (WebSearch error:
"The following domains are not accessible to our user agent: ['reddit.com']",
2026-09-09), so first-hand user complaints come from Hacker News and dated blog posts.
No shell tool was available in this session, so `wc -c` was not run; sizes are line counts
from the Read and Grep tools with byte estimates marked as such.

## 1. The drop-in claim: where a fresh vibe coder stalls

Taken literally, a person with a new machine, the Claude desktop app, and a goal.

**Stall 1: the clone line has no URL and needs three tools the app did not install.**
`README.md:15` reads `git clone <this repo> orchestrate`. The desktop app requires only
"Git for Windows" on first run (https://code.claude.com/docs/en/desktop, read 2026-09-09);
Node is not part of Claude Desktop, and `scripts/install.mjs:41-44` exits with "orchestrate
needs Node 18 or newer" without it. The `.skill` zip path (`README.md:127-132`) still ends
in "run `node .../install-agents.mjs` once". Compare: superpowers, BMAD and oh-my-claudecode
all install from inside the app with `/plugin` (sources in §3). CHECKED.

**Stall 2: nothing tells them it worked.** The proof of install is five manual checks
(`README.md:98-109`): read a `[orch-router · once per session]` line in the transcript,
look for a file under `~/.claude/orchestrate/sessions/`, confirm a profile line at the top
of `/orchestrate`, inspect `settings.json`. A plugin install ends with "Plugin is now
active." (https://code.claude.com/docs/en/discover-plugins, read 2026-09-09). Whether a
UserPromptSubmit hook's `additionalContext` is even visible to the user in the desktop
transcript is not stated in the docs I read; the context-window page says only that "That
field enters Claude's context" (https://code.claude.com/docs/en/context-window, read
2026-09-09). GAP on visibility; CHECKED on the burden.

**Stall 3: the promised voice needs a hand-edited JSON file.** `README.md:53-65` says to
add `{ "outputStyle": "Plain" }` to `~/.claude/settings.json`. In the desktop app
"`/config` opens Settings → Claude Code. Text after the command is ignored"
(https://code.claude.com/docs/en/desktop, read 2026-09-09), and the output-styles page
says for Desktop "set the `outputStyle` field in a settings file"
(https://code.claude.com/docs/en/output-styles, read 2026-09-09). A vibe coder editing
`settings.json` by hand is one stray comma from breaking every session. The terminal CLI
and VS Code have a menu; Josh's host does not. CHECKED.

Honourable mentions: the tier question on first run (`SKILL.md:59-61`, four plan names and
prices) is the first thing a new user is asked and is only skipped when `~/.claude.json`
carries a rate-limit tier key (`scripts/profile.mjs:85-100`); and outside a git repo the
profile line says "none (no worktree isolation)" (`scripts/profile.mjs:267`), which a
vibe coder cannot act on.

## 2. The vibe loop: does it delegate, or does it make the user a project manager?

Mostly it delegates. The manager writes the packets, grades the returns, and asks only
about "money, public surfaces, credentials, destructive or irreversible actions, or a
genuine strategic fork" (`SKILL.md:188-190`). That is the right rule and it is stated
once. The places it does the wrong thing for this user:

- **It hands the user three of its own best moves to type.** `references/lanes.md:19-23`:
  "the orchestrator writes the exact one-line prompt into its report and the ledger ...
  and the user types it" (dynamic workflow); `lanes.md:30` "User-typed command; hand the
  user the line" (`/batch`); `lanes.md:55` "the user types `/goal …`". Two of these are
  host limits, confirmed live: the `ultracode` keyword "is an opt-in only in a prompt you
  type yourself" (https://code.claude.com/docs/en/workflows, read 2026-09-09). `/goal` is
  "a wrapper around a session-scoped prompt-based Stop hook"
  (https://code.claude.com/docs/en/goal, read 2026-09-09), and this skill already
  registers a Stop hook (`SKILL.md:31-34`, `turn-check.mjs`), so a "keep going until the
  done-when evidence exists" check could live there without asking the user to type
  anything. CHECKED that the hand-backs exist; SPECULATION that the Stop hook can fully
  replace `/goal` (it cannot run a model judgment without a `type: prompt` hook, which
  `lanes.md:76-81` correctly says returns only ok/reason).
- **The verification rule spends the user's plan on ceremony Anthropic says to remove.**
  `SKILL.md:150-152` and `evaluation.md:78-80`, quoted in change 2 above, versus the Opus 5
  guide. For a Max 5x user whose weekly window is shared across every subagent
  (`routing.md:21-23`; confirmed by https://code.claude.com/docs/en/costs, "Running several
  sessions or subagents at once multiplies token usage", read 2026-09-09) this is the
  rule most likely to end a run at a usage limit. CHECKED.
- **The ledger the user reads is written in PM dialect.** `assets/RUN.md:24-29` uses ids
  `M-D-NNNN`, a "rubric" column and eight phase glyphs (📋 🔨 🔍 ✅ 🧱 ◐ ⛔ ✖). `SKILL.md:194`
  says "Write to someone fifteen and sharp"; the one artifact that survives the session
  does not. CHECKED.
- **The loop is unproven.** The only real dispatch recorded is the audit reviewer
  (`STATE.md:111-118`). No planner, implementer, merge or report has run. So the claim in
  `README.md:3-7` ("works out the plan, picks the agent and model ... verifies
  independently, and reports in plain words") is a design, not an observation. GAP.

What it gets right that the field gets wrong for this user: the manager decides model
choice with the plan in front of it and asks only when money is at stake
(`routing.md:55-82`); the field either has no tier awareness (superpowers, BMAD, GSD) or
routes by task size with no notion of what the plan includes (oh-my-claudecode, §3).

## 3. Against the field

Star counts are from the GitHub API on 2026-09-09 unless marked; secondary sources
disagree with them (a directory page put superpowers at 40.9k, read 2026-09-09; the API
says 283,855, and the API is the primary).

| Alternative | Install today | What it does better than orchestrate | What orchestrate does better |
|---|---|---|---|
| **obra/superpowers** 283,855★, pushed 2026-09-08 (API). Brainstorm → plan → "Dispatches fresh subagent per task with two-stage review" → TDD (README, read 2026-09-09) | `/plugin install superpowers@claude-plugins-official`; also Cursor, Gemini CLI, Copilot CLI, Codex-adjacent hosts (README) | One command, official marketplace, ten hosts, auto-activating skills, a community of 25,402 forks | No plan-tier routing, no ask-before-spend, no credential guard, no disk ledger with a pickup line. Brainstorming asks "Only one question per message" (skills/brainstorming/SKILL.md, read 2026-09-09). Users: "too overzealous" (whalesalad), "It fills up context windows with garbage and adds insane turns" (arcticfox), "I wish I could turn it on selectively" (tmach32), HN threads above |
| **ruvnet/ruflo (claude-flow)** 71,770★ | `npx ruflo@latest init wizard`, npm (README, read 2026-09-09) | Nothing for a vibe coder. Independent audit: "~290 out of 300+ MCP tools are stubs", "adds ~15,000-25,000 tokens/session of overhead" (https://github.com/hesreallyhim/awesome-claude-code/issues/1338 and https://gist.github.com/roman-rr/ed603b676af019b8740423d2bb8e4bf6, read 2026-09-09) | Everything, including honesty: this repo labels its own numbers as estimates |
| **BMAD-METHOD** 52,826★ | `npx skills add bmad-code-org/BMAD-METHOD` or `/plugin marketplace add bmad-code-org/bmad-plugins`; needs Node, npm, uv (README, read 2026-09-09) | Cross-host, web bundles, 117 contributors; one of six frameworks in the only peer-reviewed comparison (arXiv 2606.04967, submitted 2026-06-03, read 2026-09-09) | Zero deps; no agile role play. That paper's own finding: "No framework strongly covers all six dimensions" and the frameworks share "over-reliance on generated artifacts, community extension fragility, platform dependence" |
| **GSD / gsd-core** original 64,568★ archived 2026-05-31; gsd-core 9.3k★ (page, read 2026-09-09) | `npx @opengsd/gsd-core@latest` | 14 runtimes; phases discuss/plan/execute/verify/ship in fresh-context subagents; `.planning/` files, the same idea as `RUN.md` | Pulumi (updated 2026-08-28, read 2026-09-09): "Overkill for small tasks", "more ceremony than the other two". sigbottle (HN 47418626): "burned literally a weeks worth of the 20$ claude subscription" for ~500 lines. Ownership changed hands; the original author "is no longer involved" |
| **oh-my-claudecode** 39,064★, pushed 2026-09-09 | `/plugin marketplace add …/oh-my-claudecode` then `/plugin install`, or `npm i -g`; then `/omc-setup`; tmux for team mode (README, read 2026-09-09) | The closest shape to Josh's ask: `/autopilot "build a REST API for managing tasks"`; "Smart model routing" haiku/sonnet/opus; "Analytics & cost tracking" | Its "saves 30-50% on tokens" is a self-claim with no method shown; routing is by task, not by what the user's plan includes; no ask-before-spend; two dependencies |
| **claude-task-master** 28,062★, pushed 2026-04-28 | `npm install -g task-master-ai`, MCP config, at least one API key, a PRD (README, read 2026-09-09) | A task database that 13 IDEs can read | It is not an orchestrator; five setup steps and a PRD before the first task |
| **buildermethods/agent-os v3** 5.4k★ | (not in the page excerpt) | Evidence, not a competitor: v3 "retired" its orchestration, "as today's frontier models handle spec implementation well on their own—this is the recommended approach in 2026+" (https://buildermethods.com/agent-os/migration via search, read 2026-09-09) | This is the strongest argument against building an orchestration layer at all in 2026 |
| **Roo Code Orchestrator mode** (VS Code) | built in | Zero install in its host | "By default, you must approve the creation and completion of each subtask" (https://roocodeinc.github.io/Roo-Code/features/boomerang-tasks, updated 2026-05-15, read 2026-09-09): the user is the message bus |
| **Cursor subagents** | built in | Per-subagent model incl. `claude-opus-5[effort=high,context=300k]`; subagent trees since 2.5 (https://cursor.com/docs/subagents, read 2026-09-09) | "Cursor doesn't automatically orchestrate multi-step goals" (same page) |
| **Cline** | built in | SDK "includes agent teams and subagents natively" (https://cline.bot/blog/introducing-cline-sdk-the-upgraded-agent-runtime, 2026-05-13, read 2026-09-09) | Subagents are read-only researchers (search summary, read 2026-09-09; OBSERVED, not fetched from docs) |
| **AGENTS.md** 60,000+ repos (https://agents.md, read 2026-09-09) | a file | Universal context format across 20+ tools | Not an orchestrator; this skill already reads it into packets (`references/contracts.md:3-9`) |
| **Gas Town** (Yegge; Kilo cloud GA 2026-05-19) | heavy | "colonies of 20-30 parallel AI coding agents" (SD Times via search, read 2026-09-09) | Not for one person on a Max plan |
| **Claude Code itself** 2.1.260 | none | Plan mode; `/goal` ("Evaluation tokens ... typically negligible"); `/effort ultracode` ("Claude plans a workflow for each substantive task"); agent view; `/batch`; `/code-review`; Proactive and Concise styles; auto mode. All https://code.claude.com/docs (read 2026-09-09) | Tier-aware model choice, ask-before-spend, credential guard, disk ledger, measured cost |

**Honest answer to "is this the best one":** no. Superpowers is the best packaged add-on
for most vibe coders because it is one command and auto-activates; the host's own plan
mode + `/goal` is the best for the ones who, like the HN posters, found frameworks
"dramatically over-engineered" (ramoz, 47418626). `orchestrate` would be the best fit for
Josh specifically, a Max 5x desktop user who wants delegation with money asked about and
work that survives a dead session, once it installs in one command and has run its loop
once. Today it is a prototype with better ideas than the field and no users.

## 4. The output style question

The docs draw the line cleanly: "Output styles change how Claude responds, not what
Claude knows" and "styles don't change how subagents respond"
(https://code.claude.com/docs/en/output-styles, read 2026-09-09). So no style can improve
the code the implementers write; it can only change what the manager says to Josh. The
question is which words, and whether any evidence ties words to outcomes.

- **Concise** (v2.1.237+): "leads with the result, skips preamble and narration, and keeps
  responses short by default, while doing the engineering work as thoroughly as in the
  Default style" and "always keeps the complete content of error reports, security
  warnings, and confirmations for destructive actions" (same page). Plain restates all of
  that (`plain.md:14-16, 27-31, 51-53`).
- **Proactive**: "executes immediately, makes reasonable assumptions instead of pausing for
  routine decisions" (same page). Neither Concise nor Plain has this. For a vibe coder it
  is the more important half.
- **Plain adds** proof with every claim, one-term-once, everyday comparisons, "what is
  left means what they must do", explain-not-define. The proof rule has support:
  Anthropic's best-practices page says "Have Claude show evidence rather than asserting
  success ... Reviewing evidence is faster than re-running the verification yourself"
  (https://code.claude.com/docs/en/best-practices, read 2026-09-09). The STATE.md citation
  of arXiv 2512.14012 for "developers reject narrative summaries and verify instead" is
  stronger than the paper's abstract, which says only that developers "retain their
  agency ... out of insistence on fundamental software quality attributes"
  (https://arxiv.org/abs/2512.14012, read 2026-09-09). CONDITIONAL on the paper body,
  which I did not read.
- **Evidence on outcomes:** none found that a communication style changes coding
  results. What exists is about length: "Constrained-CoT ... improves inference time,
  accuracy, and conciseness" (search summary of the ScienceDirect paper, read 2026-09-09,
  OBSERVED not fetched), and Anthropic's own statement that on Opus 5 "Length is now a
  prompting problem" and "A short conciseness instruction is effective" (Opus 5 guide,
  read 2026-09-09). The same guide recommends "Before your first tool call, say in one
  sentence what you're about to do", which Plain forbids (`plain.md:28`: "Do not narrate
  what you are about to do"). Two rules, one from each side; for a user watching a
  30-minute run the one-sentence opener is the cheaper mistake.

**Answer:** neither as shipped. Concise for Josh this week (a menu item on the CLI, one
key on desktop, maintained by Anthropic). Plain wins only after it absorbs the Proactive
clause, keeps the one-sentence opener, and is rewritten as positive examples (change 3).
Token count is a rounding error either way: a style is part of the cached system prompt
and "prompt caching reduces this cost after the first request" (output-styles page).

## 5. Token efficiency, with numbers

Sizes measured by line (Read/Grep, 2026-09-09); bytes are estimates at ~55 bytes per line
because no shell was available for `wc -c`. README figures agree where they exist
(`README.md:163` "150 body lines", `SKILL.md:136` "4 KB").

| File | Lines (total / non-empty) | Est. bytes | Est. tokens | When paid |
|---|---|---|---|---|
| `SKILL.md` | 244 / 206 | ~13.5 KB | ~3,400 | on `/orchestrate`, then every later turn of that session; after `/compact` only "the first 5,000 tokens of each" invoked skill survive (https://code.claude.com/docs/en/skills, read 2026-09-09) |
| `SKILL.md` description + when_to_use | 13 lines | ~970 chars | ~240 | every turn of every session, orchestrating or not; the listing cap is "1,536 characters" and the whole listing gets "1% of the model's context window" (skills page) |
| six `orch-*` descriptions | ~200 chars each | ~1.2 KB | ~300 | every turn of every session (sub-agents page warns at "the 15,000-token limit", read 2026-09-09) |
| router card + state line | `ladder.md:38-48` caps it at 1,400 chars | ~1.4 KB | ~350 | once per session, then re-read from cache; "Zero, unless the hook returns output" (https://code.claude.com/docs/en/features-overview, read 2026-09-09) |
| `assets/packet.md` | 105 / 82 | ~4.2 KB | ~1,050 | once per orchestration when read |
| `references/contracts.md` | 270 / 209 | ~11 KB | ~2,800 | only when opened; still carries the full template a second time at lines 27-103 |
| `references/routing.md` | 235 / 187 | ~13 KB | ~3,300 | only when opened |
| per dispatch, subagent side | agent file ~1.5 KB + project CLAUDE.md copy (docs example: 1,800 tokens) + git status + filled packet ~5 KB | | ~3,000-4,000 | every dispatch; subagent cache TTL "five minutes even on a subscription" (https://code.claude.com/docs/en/prompt-caching, read 2026-09-09) |

The standing cost of having it installed is therefore roughly 550 tokens per turn of
every session (descriptions + agent roster), all cached. Against the field that is cheap:
ruflo's audited overhead is "~15,000-25,000 tokens/session"; GSD ships "69 commands and 24
agents" whose descriptions all sit in the listing (search summary, read 2026-09-09,
OBSERVED). I could not measure superpowers' or oh-my-claudecode's listing cost from here;
SPECULATION that this skill's shape is the cheapest of the group, CHECKED that it follows
the two documented rules (hooks cost nothing unless they emit; skills cost a description
until invoked).

The waste is in the run, not the install:

1. **The multiplier is real and the README never says it.** "multi-agent systems use
   about 15× more tokens than chats" (Anthropic,
   https://www.anthropic.com/engineering/multi-agent-research-system, read 2026-09-09);
   "Three subagents on one task is roughly four times the token spend of a single-thread
   session" (https://youcanbuildthings.com/articles/claude-code-subagents-token-usage/,
   2026-05-30, read 2026-09-09); "burn 10x more tokens" (gtirloni, HN). A Max 5x user
   should read that number before the first run.
2. **Verification by subagent** (`SKILL.md:150-152`) spawns a fresh Explore per gate run
   where a filtered Bash costs "a few hundred tokens" (`evaluation.md:17-21`; the docs'
   own filter-hook example, https://code.claude.com/docs/en/costs, read 2026-09-09).
3. **Two reviewers plus the manager's read** for the risky class
   (`evaluation.md:78-82`) is three passes; Opus 5 "reviews code with high precision and
   recall" (Opus 5 guide), so one reviewer on Opus is the documented sweet spot.
4. **§9 lives twice.** `SKILL.md:192-234` (43 lines, ~2.3 KB) duplicates `plain.md` inside
   the skill body, paid on every orchestration turn even when the style is on. Keep the
   pointer, drop the copy, and let hosts without styles read `plain.md` from the packet.
5. **`contracts.md` still holds the template it was split from** (lines 27-103), ~4 KB of
   duplicate whenever it is opened.
6. **Three attempts per task** (`SKILL.md:175-176`) with escalation is the right ladder,
   but nothing shows the user the running cost until `measure.mjs` after the fact; the
   `/workflows` view in the host shows "each agent's token usage as the run progresses"
   (workflows page). A one-line "this run has dispatched N agents on M models so far" in
   the state change report would not be a cap and would not be decoration.

`routing.md:14` says Pro includes Claude Code; a secondary source claimed it was removed
on 2026-04-22 (ofox.ai via search). The primary says "With Pro and Max plans, you now have
access to ... Claude Code" (https://support.claude.com/en/articles/11145838, "updated over
3 weeks ago", read 2026-09-09). `routing.md` stands; the secondary is wrong or stale.

## 6. Packet quality against current published guidance

Three primaries, read 2026-09-09:

- Anthropic multi-agent post: "Each subagent needs an objective, an output format,
  guidance on the tools and sources to use, and clear task boundaries."
- Claude Code best practices: "The most useful specs are self-contained: they name the
  files and interfaces involved, state what is out of scope, and end with an end-to-end
  verification step that proves the feature works." And on reviewers: "Tell the reviewer
  to flag only gaps that affect correctness or the stated requirements, and treat the rest
  as optional."
- Opus 5 guide: "performs best when given the complete task specification up front and
  left to run"; "Deliver what was asked, at the scope intended"; "If your review prompt
  says 'only report high-severity issues' or 'be conservative,' the model may follow that
  instruction literally and report less; ask it to report everything and filter in a
  separate pass instead."

`assets/packet.md` matches the first two on every field: OBJECTIVE, RETURN (format),
SKILLS TO USE and VERIFY LIVE (sources), NOT IN SCOPE + allowed/forbidden files
(boundaries), DONE WHEN + VERIFICATION COMMANDS (end-to-end proof), PATTERNS TO FOLLOW
(examples). `orch-implementer.md:22-23` carries the scope clause. CHECKED: the packet is
ahead of most of the field, which briefs subagents in one line.

Where it is behind or in conflict:

1. **The reviewer instruction sits on the losing side of an Anthropic disagreement.**
   `packet.md:101-103` and `contracts.md:139-141`: "Flag only gaps that affect correctness
   or the stated requirements" matches the Claude Code page and contradicts the Opus 5
   page. Both are Anthropic, both current. The Opus 5 page is model-specific and newer in
   spirit; the fix that satisfies both is "report everything, then label each finding
   correctness / requirement / optional", which is what `FINDINGS` already asks for by
   shape. Say so in the packet.
2. **No tools line.** The multi-agent post's "guidance on the tools ... to use" has no
   field; the agent file's `tools:` list is the only tool guidance. A one-line `TOOLS`
   field ("rg over cat; gh for the remote; never the browser") is cheap.
3. **BUDGET names a cap the agent cannot see** (`packet.md:72-75`). The Opus 5 guide
   points at deterministic caps (`CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS`,
   `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`, 2.1.217+) rather than prose. Concurrency is not
   spend, so this does not reopen the no-cap decision; it is a place where a number does
   work that prose cannot.
4. **The verification fields are right; the orchestrator's use of them is not** (§2,
   change 2).

## 7. What we did not think to ask

Questions a vibe coder would ask that the packet did not:

- What will one goal cost me, in plan terms, and can it eat my week?
- Can I walk away, and how do I stop it?
- What if it breaks my project?
- Does it work when my project has no tests?
- Why do I need six agents; can it just use one?

The two most worth answering now:

**"What will one goal cost me?"** Nobody has measured this skill; the field says a
multi-agent run costs 4× to 15× a single conversation (sources in §5). On Max 5x the
window is "a rolling five-hour window plus a weekly window, shared across the Claude app,
Cowork and Claude Code" (`routing.md:21-22`; the costs page, read 2026-09-09, says the
same for Team seats). So a run that dispatches a Fable planner, three Sonnet implementers,
an Opus reviewer and three Explore gate runs is, by the youcanbuildthings arithmetic, on
the order of five to eight conversations' worth. Josh's own memory (2026-09-09) records
that one session in a loop can drain a day. The honest pre-run line is: "This will cost
about N conversations' worth of your weekly window; `/usage` shows where you stand; say
stop at any time." The skill has every input for that sentence and never says it.

**"Can I walk away, and how do I stop it?"** Walk away: partly. `RUN.md`'s Pickup line and
the router's resume injection (`router.mjs:308-328`) mean a dead session resumes. But
"Permission prompts a background agent raises surface in the main session"
(`hosts.md:19-20`), so an unattended run stops at the first ask unless the session is in
auto mode; and the keep-working lane is `/goal`, which the user must type
(`lanes.md:55`). Since 2.1.234 the host will also "continue your session automatically
when a claude.ai usage limit resets" (https://code.claude.com/docs/en/whats-new/2026-w34,
read 2026-09-09), which the docs here do not mention. Stop: nothing in `SKILL.md`,
`README.md` or `lanes.md` says how to stop a run. The host offers Esc, `/tasks` to "check
on, attach to, or stop" background work (https://code.claude.com/docs/en/agents, read
2026-09-09), and `router off` mutes only the router (`router.mjs:263`). A vibe coder
needs one sentence: "Press Esc; type `/tasks` to stop a worker; the ledger keeps what was
finished." It should be in the first report of every run.

## Sources disagreeing, stated rather than smoothed

- Superpowers stars: API 283,855 vs a directory's 40.9k. API wins (primary, dated).
- Claude Code on Pro: `routing.md` and the support article say included; ofox.ai says
  removed 2026-04-22. Primary wins.
- Subagent verification: Claude Code best-practices page recommends an adversarial review
  subagent; Opus 5 guide says do not use subagents to verify your own work. Both Anthropic.
  Resolution used here: independent reviewer for risky classes only, never a subagent to
  run the gate.
- Narration: Plain forbids "what you are about to do"; Opus 5 guide asks for one sentence
  before the first tool call. Resolution: keep the one sentence.

## Not verified

- Byte sizes: no shell in this session; line counts are exact, bytes are estimates.
- Whether a UserPromptSubmit `additionalContext` line is visible to the user in the
  desktop transcript (README loading check 1).
- The body of arXiv 2512.14012 (abstract only).
- Cline's subagent constraints and GSD's model profiles (search summaries only; the GSD
  page fetched was the archived repo).
- Whether plugin hooks can reference the interpreter by absolute path the way
  `install.mjs` does; the plugins reference page was not fetched.
- Any of the token multipliers on this skill itself: `measure.mjs` has not run on a real
  orchestration (`STATE.md:179-181`).

## Stop condition

Met: the obligation asked for a verdict, three changes, and six named alternatives with
better/worse. Another search on the same questions could not change the verdict; only a
real run with `measure.mjs` could, and that is not research.

Confidence: high on the verdict and the install stalls (primary docs and files); medium on
the token table (estimates, no shell); medium on the style answer (no outcome evidence
exists on either side). What would change it: a plugin build that installs in one command
from the desktop browser, plus one measured orchestration showing the run costs less than
the 4-15× the field reports.
