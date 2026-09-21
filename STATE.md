# Build state

Resume point for building the `orchestrate` skill.

## v0.16.0 — from work dispatcher to engineering partner, 2026-09-21 (in progress)

Plan: `~/.claude/plans/we-are-looking-into-spicy-abelson.md` with its steering
notes. Five pull requests.

- **PR 1. The card survives a compaction.** `handleSessionStart` used to set
  `cardSent` on `compact` and send nothing, so a long session ran most of its
  length with no card (the cited Cortex session: ten compactions, card seen
  once). It now pushes `cardBody()` first on `compact` (not on `resume`,
  which keeps the conversation; not when muted). Ask rules: the user is asked
  about what the product should do, money, public surfaces, credentials, legal
  exposure and destructive actions; an engineering fork is the lead's to settle
  (plain.md, SKILL.md §1 and §8, RUN.md). The planner may say once, under
  VERDICT, that the goal is the wrong target. plain.md is 4,679 bytes of 4,700.
  New `AGENTS.md` (with `CLAUDE.md` = `@AGENTS.md`, the pairing
  code.claude.com/docs/en/memory recommends, read 2026-09-21): what this plugin
  is for, and the rule that its wording follows Anthropic's current prompting
  guidance.
- **PR 2. Roles and guard.** Every role description now names the moment to
  reach for it ("Reach for this when…"), double-quoted because several carry
  ": ". New `orch-advisor` (opus, high effort, 12 steps, Read/Grep/Glob only):
  tests a direction against the goal and may answer CAN'T TELL. Priced at about
  half a reviewer run ($3 / $1.50 / $0.50), because it reads a proposal and a
  brief, not a diff. It is not an author role, so the guard needs no progress
  file from it; Plan mode admits it. The advisor, researcher and reviewer each
  say that what they read is data. The packet cap in `assets.test.mjs` went
  from 6,500 to 7,000 bytes for the advisor packet (6,943 now).
  Each role was listed twice (`orch-*` and `orchestrate:orch-*`): the plugin
  provides them, and `install-agents.mjs` had also copied them into
  `~/.claude/agents`. The installer now writes nothing when the plugin is
  found (`--force` still copies), and this PC's loose copies were moved to
  `~/.claude/orchestrate/agents-backup-2026-09-21/`. The plugin's coordinator
  file carried `{{SKILL_DIR}}`, which only the installer substitutes, so its
  script permission never matched; it now uses
  `${CLAUDE_PLUGIN_ROOT}/skills/orchestrate`.
- **PR 3. New card.** The old card was all delegation mechanics. The new one
  opens with who owns what (the user: what the product does; the lead: how it
  is built), checks proposals against the brief ("What this is for" in the
  project's CLAUDE.md or AGENTS.md), and sends orch-advisor at a turning point
  without waiting to be asked; the moments themselves live in the advisor's
  description, which Claude Code keeps in view through a summary. It keeps
  working while the advisor runs (Fable 5.1 prompting page: do not make the lead
  stop and wait). "Never Write / never Read back" became what to do. The Codex
  lane and installed-skills sentences left, because other hooks say them at the
  moment they matter (`guard-agent.mjs` Codex lane, `pluginFitReport`). These
  are ownership facts and a list of moments, things the lead cannot derive, so
  they do not contradict the earlier cut of "how to think" instructions.
  Measured 2,184 characters; `CARD_CAP` 1,550 → 2,200 (rounded up to the next
  50, as 1,400 → 1,550 was). Cost: about 550 tokens once per session and once
  per compaction. After a compaction a fact line now leads the card:
  compaction count, helpers sent, and when orch-advisor was last sent, from
  `state.dispatches`. It states facts only, and a test holds that.

## v0.15.8 — a scoped model grant, an outbox, honest Codex state, and helper compactions made visible, 2026-09-18

Docs-only step of the orchestration-depth run (packet 9-18-0007; code lives in
sibling packets 9-18-0005/0006). SKILL.md §5 names two recipes that were
already being hand-derived every run: *second opinion* (`BUILDS ON: <path>`,
one model reads another's written findings and goes deeper only where it is
thin or wrong) and *hand-off* (default is a fresh agent per round from a
lead-written brief; within the five-minute warm window `SendMessage` the brief
out, then dispatch fresh — never resume a round cold; this run's own round-1
agent was host-compacted at 143k before round 2, and the file, not the agent,
carried the work forward). SKILL.md §0 and routing.md's escalation trigger 4
now say what a model the user names actually scopes: the task they named it
for, the first numeric id that uses it — not the run, and not a packet line;
`APPROVED BY USER: <model>` stays the separate billing check for a model
outside the plan. SKILL.md §10 gains one line on the suggestions outbox
(`scripts/suggest.mjs add "<text>"`, read only on request, never injected).
hosts.md's nesting facts now carry their source and date (depth 3, 20
concurrent, mid-run `SendMessage` since v2.1.198 — code.claude.com/docs, read
2026-09-18) and say plainly that this skill's own nesting caps are a cost
choice, not the host's limit. assets/packet.md gains `BUILDS ON:` (packet
side) and `SUGGEST:` (return side) in the optional-fields blocks.
turn-check.mjs's `blocks on` column now accepts a short id (`0005`) as well as
the full `9-18-0005`.

Same version, second wave (packets 9-18-0008..0010, built on Claude while
Codex was out of quota; the Codex path is tested with mocks only, not live):

- **Codex tells the truth (0008).** `parseResetTime` reads the dated form
  ("try again at Sep 19th, 2026 11:50 AM") that it used to read as a time
  today, so the router stopped offering Codex hours before its reset. One
  null or timed-out `codex login status` is retried once; a second null is
  `unknown`, not `auth-failed`, and the worker goes on to `codex exec`, which
  fails honestly if really signed out (two false auth-failed reports this run).
  Every report.json names `model` and `effort`, even on an early return.
  Exhaustion is matched per account, not per run, so run B does not re-probe
  what run A already hit. The guard adds one fact line on an implementer
  dispatch when Codex was seen ok recently.
- **Work calls since the last dispatch (0009).** The lead's
  `[orchestrate · context]` line says "N work calls since your last dispatch"
  when N crosses 100, 200, 300, and the auto-continue reason carries it too.
  Reset by an Agent dispatch or a `codex-worker` command. Measured: every bad
  session had a stretch of 101+ work calls between dispatches (523, 637, 201),
  every healthy one stayed at 83 or under. Replaces design D1's once-per-session
  order at 30 calls, which would have fired once and then been silent for 1,800
  calls. A fact, not an order; `policy lead.workCallsEvery` sets the step.
- **A compacted helper's summary is kept (0010).** 36% of recent Sonnet
  implementers were compacted by the host mid-task, on a summary nobody saw.
  New PostCompact hook `postcompact-check.mjs`: inside a helper of a bound run
  it saves `compact_summary` to `<run>/returns/<agent>-compact-<n>.md`, and the
  ledger adds "compacted N× mid-task; kept: <path>" to that helper's saved
  return, so the lead can read it and correct course with one `SendMessage`.
  The lead's own compactions are untouched. Registered in hooks/hooks.json and
  the script install; PreCompact stays frontmatter-scoped as before.

## v0.15.7 — the lead hears facts, not orders, 2026-09-14

Step S2 of the rules-versus-judgment plan. The checkpoint notice, the compact
notice and the size tick are now one line of facts, said at the same moments
as before: `[orchestrate · context] ~165k of ~200k · compacted 1× · next:
autocompact ~200k · newest checkpoint: <path>, 3 min ago · 8 tool calls since
your last edit`. "of" is the known window, else `context.autocompactDefault`;
"next" is the compact line or autocompact, whichever is lower and not yet
passed. `newestCheckpoint()` returns the newest of the candidates
`hasCheckpoint` accepts, and `hasCheckpoint` is now "it is not null", with
the same rules. The "still large after compaction" notice is unchanged.
The auto-continue reason is one line: `orchestrate: "<goal>" · step n of 25 ·
last edited <file>`. The goal is the first line under the bound RUN.md Goal
heading, else the goal given when the loop was switched on. The every-6-steps
check-in paragraph is gone (`PERSIST_CHECKIN_EVERY` removed). Stop and
PreCompact block reasons and when they fire are unchanged.
Replay (run dir replay/s2-lead-line.txt): sessions 059154a1 and e681c7ce,
17 and 35 lines said, zero moments where only one version spoke; context-line
characters 3,383 → 1,838 and 8,152 → 4,711.

## v0.15.6 — tests pin behaviour, not numbers, 2026-09-14

Step S5 of the rules-versus-judgment plan. Threshold, size-budget and quota
tests now derive their inputs from `thresholds()`, `DEFAULT_POLICY` and the
lib/quota.mjs constants; each default has one test that names it on purpose.
New lib/quota.test.mjs covers the 80% five-hour and 90% weekly helper stops,
the 60% caution band, and the 10-minute snapshot freshness. diagnose.mjs now
uses the capped checkpoint line from `thresholds()` instead of the raw policy
value. Drift proof: with `context.checkpointAt` set to 110000 the full suite
fails only "the defaults are checkpoint 120k, compact 150k, on purpose".
Note: raising checkpointAt above 80% of compactAt has no effect, because
`thresholds()` caps it there.

## v0.15.5 — one number per idea, 2026-09-14

Step S4 of the rules-versus-judgment plan. Removed what could not fire or
existed twice:
- `context.hardAt` (300k): autocompact at 200k always came first. A saved
  profile that still sets it loads fine and ignores it; `--policy
  context.hardAt=1` answers "unknown policy key". A user with autocompact off
  still hears the ordinary compact line past compactAt, repeated on growth.
- router.mjs `contextBand` now reads `thresholds()` instead of its own copy
  of 300000/150000/120000.
- turn-check.mjs marathon nudge: it fired only on unmeasured size, which never
  lasts past one response. The idle nudge stays.
- `SILENT_MS` (10 min) folded into `workers.staleMin`, now 10 (was 45). A
  dispatch counts as running while its transcript changed within staleMin,
  however long ago it started; the 45-minute age cutoff is gone, so a long,
  busy worker keeps its slot. The 5-minute just-dispatched grace and the
  turn-cap release stay.

## v0.15.4 — the checkpoint check accepts a real checkpoint, 2026-09-14

Step S3 of the rules-versus-judgment plan. The Stop and PreCompact blocks
used to accept only the plugin's own checkpoint file, so a session with a
written RUN.md Pickup, or a plan file in Plan mode, was still told to write a
checkpoint. hasCheckpoint (lib/context.mjs) now accepts: the plugin file; the
bound run's RUN.md when its Pickup prompt holds real text and the file changed
after the current context began; or, in Plan mode only, a `~/.claude/plans`
file written after that point. run-init.mjs writes a `Plan:` line when a fresh
plan file exists (create path only, not `--bind`). Known gap: `run-init.mjs
--reopen` touches RUN.md without changing it, so an old real Pickup reads as
fresh after it. Replay of the real 161k Plan-mode stop: old check blocked, new
check does not (replay/s3-output.txt in the run dir).

## v0.15.3 — helpers hear facts, not orders, 2026-09-14

Step S1 of the rules-versus-judgment plan. A helper past its size budget now
hears one line: size against the return budget, turn of its cap, tool calls
since its last edit, and its progress file (path and when it was last
written, or "none given"). No instruction is attached. The whole-transcript
turn count is paid only past warnAt. The Agent guard notes a packet with no
PROGRESS line for a role that authors work. Replay of the 2026-09-14
lead-delegates implementers: replay/s1-helper-line.txt in the run dir.

## v0.15.2 — helpers do compact, 2026-09-14

Step S6 of the rules-versus-judgment plan (run `20260914-rules-vs-judgment`,
PLAN.md in its run dir). The v0.15.1 entry below said helpers do not compact;
the docs and one transcript here say they do. Corrected there and added to
references/hosts.md with what a capped helper returns.

## v0.15.1 — helper size budgets, capped helpers free their slot, 2026-09-14

A version bump so installed copies pick up PR #9: the plugin cache refreshes
only on a new version, and `claude plugin update` reported 0.15.0 "already at
the latest" with the old code still installed. PR #9 carried the README made
current, the capped-helper slot fix, helper size budgets with raised turn caps
(all listed under v0.15.0 below), and the size line naming its next step.

## v0.15.0 — the lead keeps judgment, workers carry the bulk, 2026-09-14

Asked: does the plugin waste context, should the lead mostly manage workers,
can the context thresholds be strict, and is Codex used and routed well?

**What one plan step cost.** Session `059154a1` (repo realorrug, "Plan 0001
step 6c", 19:46–20:40) ended at 472k context, 106 model calls, 0 compactions,
0 helpers. Fixed overhead ~53k; orchestrate's own hook text ~1.5k. The rest was
the lead doing bulk work itself: 17 `Write` calls totalling 276k chars (`lib.rs`
written whole twice, 45k + 44k; `main.rs` twice; `tests.rs` 37k), a 64k `Read`
of a file it had just written, `cat` of four Cargo.toml (15k), multi-file `sed`
dumps (10k each). Context went 74k → 159k by response 20 → 470k by response
106. The "compact now" notice fired at 159k and was ignored for ~250 responses:
auto-continue kept the turn alive and only the user can compact. Re-read total
35.0M tokens (34.6M cache reads), 226k output, ≈ $25.57 list at Opus. Same
shape in `7d9adf10` (304k, 0 helpers) and `39341f01` (344k, 0 helpers). A
Sonnet or Codex worker capped at 50 steps near 125k re-reads ~6M tokens at a
fifth to a tenth of the price (≈ $3–4 list); arithmetic, not an A/B.

**Codex before this release:** 7 runs ever, all from the plugin's acceptance
tests. No reference said what any GPT model is good at.

**Cause.** SKILL.md §3, ladder.md and the card said "Direct is most work,
including long work. Six files is not a reason to delegate." True for a task
of a few steps, wrong for "write a new module with tests".

**Decisions (Josh).** Nesting engineered in as one bounded shape (the
coordinator, depth 2). Context line enforced three ways: host auto-compact at
200k, auto-continue stops at the line, a Stop past the line refused once until a
checkpoint exists. Codex is the worker lane until it runs out; Claude workers
only after that or for what Codex cannot reach; no Codex fallback when Claude
is near its limit. Astra needs the user's yes each time. Codex tier is asked
once and stored; `~/.codex/auth.json` is never read.

**Sources (checked 2026-09-14).** code.claude.com/docs/en/model-config,
/commands, /subagents, /costs; openai.com/index/gpt-6-astra (2026-09-03);
developers.openai.com/codex/pricing; help.openai.com article 11369540;
learn.chatgpt.com/docs/non-interactive-mode and config-file/config-reference;
openai/codex release rust-v0.154.0 (2026-09-09). Unresolved: the gpt-5.4
retirement date conflicts between sources; the no-flag default model is in
transition, so the worker always passes `-m`.

**Built** (this section is filled in as each part lands):

- Card and version: the router card carries the delegation rule (1,547 chars);
  `codex-worker.mjs --model --effort --approved`, Astra refused without approval.
- Part C, the coordinator: `assets/agents/orch-coordinator.md` (opus, high,
  maxTurns 40). `guard-agent.mjs workflowDecision` allows a dispatch carrying
  `agent_id` only when the parent's recorded role is `orch-coordinator`, the
  child is implementer/researcher/reviewer/Explore with a model named, and depth
  ≤ 2; anything it cannot attribute is denied. The parent's depth comes from the
  host's `subagents/*.meta.json` `spawnDepth`, confirmed present in all 88 meta
  files on this machine (84 at 1, 4 at 2, those 4 also carry `parentAgentId`).
  `policy.workers.nested` defaults to `coordinator`; the concurrency limit is 3
  while a coordinator is live. Nested returns carry `parent` in the ledger.
- Part B, context discipline: `profile.mjs --autocompact 200k [--dry-run]`
  writes `CLAUDE_CODE_AUTO_COMPACT_WINDOW` through `lib/settings.mjs`;
  `precompact-check.mjs` asks an unbound session for
  `~/.claude/orchestrate/context/<session>/checkpoint-<epoch>.md` once per
  epoch; SessionStart after compaction injects it (1,200 chars); armed
  auto-continue stops on `compact`/`investigate` advice; the plugin-wide Stop
  refuses once per epoch at `compactAt` until the checkpoint exists;
  `policy.context.hardAt` 300k; `ctx` band in the state line.
  **Replay on `059154a1`** (throwaway HOME, unarmed Stop): the transcript cut
  at line 92 → silent; cut at line 93, the first response ≥ 150k → "context is
  ~159k: write the checkpoint …"; full transcript → blocks once at ~473k, the
  second Stop passes; with the checkpoint file present → silent. PreCompact on
  an unbound session → one block naming the path, then passes.
- Part E1: `measure.mjs --growth <transcript>`. On `059154a1` it prints Write
  276,180 input chars, the 63,858-char `Read` of `lib.rs` as the largest
  result, 29,000 chars of hook attachments (all plugins), and $25.57 at Opus:
  the hand measurement, reproduced in one command.
- Part D, Codex as the worker lane: a finished Codex run now writes
  `returns/<task>-codex.md` and a `returns.jsonl` line with model and effort, so
  it is graded like a Claude return; `reports.jsonl` carries both too. A Codex
  limit message with no reset time lifts after five hours instead of holding for
  the run. `profile.mjs --set codex.tier=plus|pro5|pro20` stores the plan (set to
  `plus` here). `profile.mjs` writes a Codex status cache; `--brief` reads it
  (fresh for one hour) and prints `codex: <model> · <plan> · ok`, `limit until
  <time>`, `not signed in`, `not installed`, or `not checked in the last hour`.
  The router state line and its change-detection hash carry `codex: ok|limit|off`.
  On this machine: `--brief` in 130 ms printing `codex: gpt-6-astra · plus · ok`
  (the model shown is Codex's own configured default; dispatches name `-m`).
  The worker returned partial; the lead added `profile.test.mjs` (plan saved,
  bad plan refused, all five line shapes) and moved the agent count to seven.
- Docs: SKILL.md §0 (ask the Codex plan once), §3 (context size decides, not
  file count), §5 (the Codex recipe and "Codex for workers until it runs out;
  Claude for judgment and for what Codex cannot reach", when to use the
  coordinator), §6; ladder.md prose; lanes.md; models.md "The Codex side" and the
  coordinator's cost; routing.md "Codex routing"; hosts.md "Host facts checked
  2026-09-14" with `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH=2` as a backstop;
  README opening, setup note, seven agents. No "Direct. This is most work",
  "Six files is not a reason" or "prefer Codex" remains.
- Auto-compact at 200k is the plugin default (Josh). A plugin's own
  settings.json supports only `agent` and `subagentStatusLine`
  (code.claude.com/docs/en/plugins-reference, checked 2026-09-14), so orchestrate
  writes `CLAUDE_CODE_AUTO_COMPACT_WINDOW=200000` into `~/.claude/settings.json`
  once: the router does it on the first prompt of a plugin install and says so
  in that prompt's context; `install.mjs` does it too (`--no-autocompact` skips).
  It never overwrites a value the user set, takes a backup, and leaves
  `~/.claude/orchestrate/autocompact-default.json` so it never runs again, even
  if the user removes the key. `policy.context.autocompactDefault: off` opts
  out; `profile.mjs --autocompact off` removes the key and keeps it removed.
- Compact or start fresh, from measured size only (Josh). Found when the lead
  told Josh to start a new conversation from a pre-compaction summary number
  (~150k) right after compacting. Three changes:
  - The lead hears the measured size smoothly: one short line per 25k of growth
    and after each compaction (`policy.context.tickEvery`), and the state line
    always carries `ctx ~Nk` once measured, not only at 120k and above.
  - Compact is the default recommendation. The context reader counts
    compactions per session; from `policy.context.freshAfterCompactions` (2) on,
    the compact and hard notices, and the Stop hook's, say start fresh from the
    checkpoint instead. A dead duplicate `compact` branch in `contextNotice`
    that hid the compact-vs-fresh rule is gone.
  - The turn-count "marathon" handoff fires only when the size is unknown; a
    measured size owns that advice, so a just-compacted session is never told to
    hand off. 351/351.
  Takes effect from the next session. Applied on this machine by hand first.
- A size budget for every helper, in tokens (Josh: longer runs are right for an
  agent that manages agents). Found when two Sonnet implementers stopped at their
  50-turn cap near 104k having saved nothing. The host has no token limit for
  subagents (its docs name only `maxTurns`), so the PostToolUse hook is the
  mechanism: at `warnAt` it tells the helper to write its progress file and keep
  going, at `returnAt` to start no new work and return PARTIAL, each once.
  `policy.workers.size`: 80k / 120k by default, orch-coordinator 150k / 200k;
  set per role with `profile.mjs --policy workers.size.<role>.returnAt=160000`,
  and a pair whose warnAt is not below returnAt keeps the role's defaults. Turn
  caps are raised to a backstop: implementer 100, debugger 120, coordinator
  150, researcher, planner and browser 80, reviewer 60 (the implementer cap was
  50 on the 2026-09-14 lead-delegates run). The progress file carries the work
  when a helper stops. 357/357. *Corrected 2026-09-14:* this entry first said
  helpers do not compact. They do: sub-agents.md says "Subagents support
  automatic compaction using the same logic as the main conversation", and one
  helper here did (`agent-ac3ff549f4812ba36.jsonl`, one compact_boundary, 167k
  peak to 63k). The earlier 0 of 89 was only turn caps ending helpers first.

**Found while building.** (1) The Codex sandbox refuses child processes, so
`node --test` fails there with `spawn EPERM`; `--test-isolation=none` runs
single files, and the lead runs the full suite. Every Codex packet says so now.
(2) A Claude helper stopped by its turn limit kept its concurrency slot until
the 10-minute silence rule released it, and a Codex dispatch was refused
meanwhile. (3) The router read a blocks-on cell of short ids (`0001 0002`) as
nothing to wait for; the table needs full ids. (4) A Codex start refused for a
busy slot still wrote a `returns.jsonl` line, so three retries left three
"blocked" returns to grade; only runs where Codex started are recorded now.
(5) Fixed: (2) above. A capped helper ends on a tool call with no final
message, and the ledger dropped any stop without one, so no capped return was
ever recorded. Now that stop is filed as PARTIAL, and a helper whose transcript
used every turn its role allows stops counting at once, even with no record.

**Verification.** Full suite 344/344 on the branch. Hook replays on `059154a1`
above. Worker-lane run on a scratch repo with three failing `slugify` tests:
`codex-worker.mjs run --model gpt-5.6-luna --effort low --run <scratch run>` →
done in 50 s, 86,521 input tokens (49,408 cached), 1,209 output; 3/3 pass when
rerun outside the sandbox; one `returns.jsonl` line with model and effort; the
router's state line in that repo reads `1 return to grade: 9-14-0001`. Astra
without `--approved` is refused before Codex starts. Live acceptance on a real
plan step was skipped for this release (Josh).

**How this release was built.** The lead wrote packets and graded returns; the
code parts ran as Codex workers (terra medium for B, D, E1; sol high for C).

## v0.14.0 — a repo map helpers read before searching, 2026-09-14

Asked: would a persistent codebase map (Graphify was the example) make the
plugin more effective and efficient? 325 tests pass.

**Research (checked 2026-09-14).** Graphify (github.com/safishamsi/graphify,
Python, tree-sitter) publishes memory benchmarks (LOCOMO, LongMemEval), not
coding ones; `graphify claude install` adds a PreToolUse hook and CLAUDE.md text.
The one independent coding measurement (arXiv 2603.27277, Codebase-Memory, Opus
4.6, 31 repos × 12 questions): graph agent 0.83 answer quality vs 0.92 for
grep-and-read, ~1,000 vs ~10,000 tokens and 2.3 vs 4.8 tool calls per question;
loses on macros, dynamic dispatch and text lookups. Claude Code dropped a vector
index early because agentic search worked better (Boris Cherny). TDAD (arXiv
2603.17973, SWE-bench Verified, small Qwen models): a source→test map cut
regressions 6.08% → 1.82%, while "do TDD" instructions alone made it worse
(9.94%). The LSP tool needs only an enabled language-server plugin with its
binary on PATH (plugins reference: `lspServers` / `.lsp.json`).

**Measured first.** `measure --tree` now splits each agent's read/search results
at its first edit and counts what later calls re-read. On the 81 helpers under
`~/.claude/projects/C--Users-Josh-Desktop-GitHub` (≥5 calls each): lookups
before the first edit were **9% of context growth** — under the plan's 15% stop
line — but **21% of all input read** once re-reads are counted (implementers 16%
of 465.8M, read-only helpers 35% of 144.2M, general-purpose 22% of 234.3M); all
lookups 25%. The plan named growth; the decision was taken on re-read cost,
because that is what quota pays for. Implementer context at first edit: median
125k, from a 52k start. Characters ÷ 4 is an estimate.

**Built.**
1. `scripts/map.mjs` — from the git index, no dependencies: files with a
   one-line purpose, import edges with lines (JS/TS, Python, Rust, Go, found in
   text), symbols, entry points, tests per file (imports it / name pairs /
   through one file). Cached per blob; any query rebuilds when HEAD moves.
   `map.md` ≤ 4,000 chars. On this repo: 60 files, 119 edges, 0.3 s cold, 0.1 s
   cached; `who-uses lib/workers.mjs` matched grep exactly (6 importers).
   `.orchestrator/` goes into git's local exclude so the map never reads as a
   change. Tried read-only on `heyvera-current` (849 code files, Rust + TS):
   0.6–0.8 s, 1,640 edges, but archived and reference copies filled the top of
   the page, so archive/legacy/vendor/example/build folders now stay in the
   data and off the page, with a count (407 files there).
2. `run-init` builds the map and names it under Facts.
3. `packet.md`: MAP, TESTS FOR SCOPE, reviewer CALLERS (PROGRESS and the CI note
   tightened to stay under the 6,500-byte cap). SKILL.md §2 and §5.
4. `codex-worker`: when the repo already has a map, the prompt tells Codex to read
   it first; stale is rebuilt, missing is left alone.
5. `diagnose`: map state, language servers ready / disabled / binary missing,
   repo languages with none (e.g. `heyvera-current`: 180 `.rs` files, no Rust
   server), Graphify, code-graph MCP servers by name.

**Acceptance through Codex: no saving shown.** One small implementer packet (add
map state to `codex-worker.mjs status`, with a test), gpt-6-astra at medium, each
run in its own worktree at a512b51. All three finished, and each run's test file
passes 12/12 when run outside the sandbox.

| run | map | input (cached) | output | time | commands (before first edit) |
|---|---|---|---|---|---|
| A | none | 279,521 (240,000) | 2,249 | 109 s | 11 (7) |
| B | map.md + note | 217,159 (177,280) | 2,240 | 123 s | 9 (6) |
| B2 | same, queries fixed | 325,174 (283,776) | 2,480 | 125 s | 11 (8) |

- Both map runs read `map.md` first (3,964 chars). In B, `map.mjs tests-for`
  failed with "not inside a git repository": Codex's sandbox stops Node starting
  git. Fixed in 84dadcd (queries answer from the saved map via `--repo`; the
  note passes it). In B2, Codex did not run a query at all and searched with
  `rg`/`Select-String` as in A.
- B and B2 had the same setup and differ by half; that spread is larger than any
  difference between A and B, so these runs show no effect either way. The task
  was also a poor test of a map: the packet named the files, and the work was
  about `map.mjs` itself, which every run had to read.
- What this leaves standing: the map costs ~4k characters per worker and is
  cheap to build; the case for it is the measured 21% of helper input spent on
  lookups, not these runs. A fair test needs a task where finding the files is
  the hard part, repeated several times per side.

**Not built, and why.** Graphify or an MCP code graph by default (Python install,
another per-step hook and CLAUDE.md, no coding evidence of its own); embeddings
(measured worse for code search by the Claude Code team); tree-sitter (a native
or wasm dependency for a regex scanner's gaps).

## v0.13.1 — usage-limit entries expire, and the sandbox retry, 2026-09-14

- Older usage-limit entries saved before v0.13.0 now expire from the reset time
  in their saved message; `codex-worker.mjs status` marks lifted blocks.
- **Retry of the v0.13.0 acceptance task** after Codex's limit reset at 2:31 PM
  (same scratch repo, three failing `slugify` tests, gpt-6-astra at medium):
  done in 58 s, 121,126 input tokens (78,336 cached), 939 output. Changed only
  `slug.mjs`. The sandbox-blocked `node --test slug.test.mjs` came back
  `not-run` instead of `checks-failed`; Codex found its own way to run the tests
  (`node --test --test-isolation=none`, 3/3 pass), and `git diff --check` passed.
  This confirms the v0.13.0 fix on a real run.

## v0.13.0 — accurate context, bounded workers, Codex with Claude fallback, 2026-09-14

Quality per unit of quota. Claude Desktop stays the lead. 313 tests pass (up from
265 at v0.12.1), on Windows / Node 24 locally; CI runs Node 18/20/22.

**What was wrong, from the records.**
1. `persist-check.mjs` warned whenever the transcript passed 1.5 MB. Compaction
   keeps the file, so the warning never cleared after a compaction.
2. `lastContextTokens` walked back past compaction boundaries: it could report a
   311k reading after a 17k compaction summary, and treated absent usage as 0.
3. Built-in `general-purpose` bypassed the role agents' caps. Replayed from disk
   with the new meter (`measure.mjs --tree`, session 41eecddd): one Sonnet helper
   made 274 calls, reached 683k context and started six helpers of its own
   (four transcripts at depth 2).

**Changes.**
- `lib/context.mjs` is the one reader (router, continuation hook, guard, report,
  tool-boundary sampler). Measurement = input + cache read + cache write of the
  last real response after the last `compact_boundary`; provisional from the
  boundary's `postTokens` until a response reports usage; unknown when missing,
  null or older than 12 h. Per session and per agent under
  `~/.claude/orchestrate/context/`, read incrementally from a byte offset.
  Advice: checkpoint 120k, compact 150k or 75% of a known window, investigate
  when still large within 3 responses of a compaction; said once per change,
  keyed to the compaction epoch. A 13 MB, twice-compacted transcript reads in
  ~0.1 s.
- `context-check.mjs` (PostToolUse) samples at tool boundaries, notices Plan-mode
  entry and exit (`lib/modes.mjs`), and surfaces capped returns.
- Guard (`workflowDecision`): no dispatch when `agent_id` is present (nested); no
  `general-purpose`/`claude` once all six role agents are installed; two workers
  across Claude and Codex, browser serial (`lib/workers.mjs`, alive = dispatched
  <5 min ago or helper transcript written <10 min ago, not returned); Plan mode
  allows only read roles, no worktree, no PROGRESS; no Claude helper into a live
  Codex worktree.
- Ledger marks a return at its role's `maxTurns` as PARTIAL; the router or the
  sampler says once to continue only the remainder in a fresh packet.
- `codex-worker.mjs`: `codex exec --json --disable multi_agent --disable
  multi_agent_v2 -s workspace-write|read-only -C <worktree> -c
  model_reasoning_effort=… --output-schema … -o … -`, packet on stdin, 20-minute
  timeout with tree kill, diff saved after exit, status classified from error
  events and stderr only (quota, auth, throttled, permission, timeout,
  malformed, checks-failed), quota marked per provider+account+run, Claude
  fallback packet for the unfinished part, exit 5 when Claude is also near its
  limit. Sign-in checked with `codex login status`; credentials never read.
- Quota snapshots carry provider, account and session; unidentified or other
  accounts are not enforced. `batch.mjs` defaults to concurrency 2 with grouped
  files (≤15 per task). `profile.mjs --policy` and `--host`. `measure.mjs --tree`
  (per-request context for every agent).
- Codex usage-limit blocks lift at the reset time the message states ("try again
  at 2:31 PM", "in 3 days 4 hours"); with no stated time they hold for the run.
- `diagnose.mjs`: versions, host, policy, settings-file hooks, context report,
  agent tree, Codex state and quota freshness in one read-only snapshot, home
  folder written as ~. Runs in 0.26 s on this session.

**Acceptance on this machine (Desktop engine 2.1.270, Codex CLI 0.154.0-alpha.6.2).**
A scratch repo with three failing `slugify` tests, sent through the adapter.
- Run 1: gpt-6-astra at medium, 55 s, 99,741 input tokens (77,824 cached), 883
  output. The change was correct — 3/3 pass when run outside Codex's sandbox.
  The adapter reported `checks-failed` because the sandbox blocked `node --test`
  with spawn EPERM. Fixed: a check the sandbox would not run is now "not
  verified, rerun it yourself", and the worker prompt says to report it not-run.
- Run 2 hit Codex's real usage limit ("You've hit your usage limit … try again
  at 2:31 PM"). Classified quota-exhausted in 13 s, no edits, marked for the
  session, Claude packet written, exit 4.
- The lead's own measured context grew 379,987 → 386,939 across both runs,
  including reading the reports. This is not an A/B against a Claude helper
  (none was run, to spend no Claude quota on it), so no savings percentage is
  claimed.
- Reference only, not a comparison: `costs.jsonl` holds 69 Claude implementer
  returns from other, larger tasks; the smallest read 21M input tokens over its
  life. Different tasks and tokenizers, so nothing is derived from it.

**Hook replay on live data.** This session's real 3.9 MB transcript and
Desktop-shaped payloads, fed to the new scripts with a throwaway home folder:
context-check measured 116,336 (below 120k, silent); the Plan-mode note on a
`plan` payload, then the approval note when the mode became `acceptEdits`; the
guard refused an implementer in Plan mode and a dispatch carrying `agent_id`;
router and persist-check stayed silent below the thresholds. Nothing was written
outside the throwaway folder.

**Not verified.** The hooks have not run as the installed plugin inside Desktop:
the installed plugin is still 0.12.1 until this merges and auto-updates. Codex quota cannot be probed
before a run by design, so a limit is only learned from a real attempt.

## v0.12.0 — quota first, 2026-09-13

Josh: quota always wins; speed only when it costs little or no extra quota.
Validate by reasoning from evidence and data already on disk, then natural use —
not staged A/B runs. 261 tests pass (up from 221 at v0.11.0).

**What the plugin's own records showed.** Plan detection read "unknown" on a Pro
account. 56 of 58 implementer runs were Opus against a Sonnet default, the bulk
of recorded helper spend; the three largest helpers started each step at 36–59k
tokens, grew to 305–382k, and re-read ~49M tokens each over ~190 API calls. A
research sweep in the planning session itself ran three unnamed-model helpers on
the lead's Opus to ~250–285k tokens each. The meter was wrong four ways (below).

**Correction to numbers quoted during planning.** The host writes one API call as
several records with the same `message.id`; counting records over-states
re-reads 1.4× (a helper) to 2.8× (a long lead session). Output tokens are not
over-stated: the last record of a call carries the full count (the planning note
said 2.3×, from reading the first record). STATE.md v0.10.0's "84% of cost is lead
re-reads" was computed on the old count; its share may hold, its tokens do not.

Changes, one commit each on `feat/persist-loop`:
1. **Helper caps.** Every role pins effort ≤ high (implementer/researcher medium,
   browser low) and `maxTurns` (implementer 50, debugger 80, researcher, browser,
   planner 40, reviewer 30); packets point at line ranges, under ~6k chars.
2. **Model enforced at dispatch.** The guard refuses executors above Sonnet before
   a real attempt at the same task, Explore/general-purpose without a cheap named
   model, a fork of a >100k conversation, Fable off-plan, and any helper at ≥80% of
   the 5-hour window or ≥90% of the week. Replayed over the 46 dispatches on
   record, it refuses 30. Role names normalized, so the budget gate finally
   matches plugin-installed roles (it never fired on a plugin install before).
3. **Meter.** Each API call counted once; model from the helper's transcript;
   one row per agent id; unpriced never $0; Fable 5.1 cache reads at 2.5%. The
   ledger no longer emits SubagentStop context: the host delivers it into the
   helper, which answered and re-stopped (nine times for one planner). measure.mjs
   counts `[orchestrate` injections and queued task-notification returns.
4. **Plan and live usage.** The plan is kept per Claude account. The desktop
   app files each session under `claude-code-sessions/<account>/<org>/` and passes
   `CLAUDE_CODE_HOST_SESSION_ID`, so the org is known without credentials.
   `~/.claude.json` describes only the terminal's last sign-in: here a Pro account
   used for one day, while the app runs on Max 5x. So the order is: a plan
   remembered for this org, then an older global override, then the file when it
   describes this session's account. Otherwise the plan reads unknown with the
   reason, and the user is asked once. `statusline.mjs` is the only channel the
   host gives for live 5-hour/weekly usage. It is installed here and works when
   run by hand, but **the desktop app never ran it** in hours of use: live usage is
   terminal-only. The brief says so and offers the install only outside the
   desktop app. Transcripts record usage only when a limit rejects a request
   (`quotaLimits.status: "rejected"`, 43 records here), never before. 265 tests.
5. **Installed plugins.** A plugin check, said the first time the listings are
   seen and then only for plugins added since: every plugin with its skills,
   per-step tokens, how many skills arrived name-only, sign-in state and a
   paid-service hint, and an instruction to sort them for the user into keep and
   remove. Here: ~14k tokens per step, 356 skills from 35 plugins, **307 skills
   listed by bare name** because too many are installed — so extra plugins also
   hide the useful ones' descriptions. It does not recommend installing anything
   at setup (each plugin is re-read on every step); the lead searches the catalog
   when a task needs what the built-ins cannot do. Desktop-app plugins live in
   the Claude account, not `~/.claude/plugins`, and do not show in `/plugin`.
   Planner/reviewer get `Skill`; the researcher moves to a denylist.
   `paidServices=never|ask|free` (Josh: never), plus `allowPaid=<plugin>` /
   `denyPaid=<plugin>` for a paid plugin a user bought and wants used.
6. **Lead facts without a Stop block.** Limits only from host `<synthetic>`
   records (a quoted research report had reported two false limits); a line at
   150k and 300k per-step context; a weekly note when lead effort is xhigh/max.
7. **Stale plans.** Open but RUN.md untouched 48h: never auto-bound, reported,
   budgeted or filed into; said once; `run-init --reopen <id>`. Only an edit to
   RUN.md counts as activity — a return filed by an automatic binding kept this
   repo's v0.7 plan alive in the first cut.
8. **models.md / routing.md / SKILL.md** rewritten on verified 2026-09-13 facts:
   cost shape `steps × base + growth × steps²/2`, effort evidence, escalation as a
   fresh dispatch, resume only within a helper's 5-minute cache, Sonnet-first
   executors on every plan. Dropped a false claim that an Opus lead turn costs
   little more than Sonnet (its cache re-read is 2.5×).
9. **Recoverable helpers.** PROGRESS files kept current by implementer, debugger,
   researcher and planner; the router lists dispatches that never returned on
   resume, compaction or a usage limit, with their PROGRESS paths.

10. **Plugins in practice.** Josh's account had 34 plugins. 29 were removed and 7
    standalone skills with them, leaving Modern Web Guidance, Data, Design, PDF
    Viewer and Security Guidance. The README now names a short free set: a
    language-server plugin, context7, frontend-design, session-report. It lists
    plugins that duplicate orchestrate's own helper flows. `security-guidance`
    (on by default) calls Opus on every turn end, commit and push whenever it
    finds credentials. Its log here shows every review skipped for lack of them
    (37 turn-end, 31 commit); `ENABLE_CODE_SECURITY_REVIEW=0` keeps only its free
    pattern warnings.

Deliberately not built: a per-tool-call context tripwire (plugin agents cannot
carry hooks; a plugin-wide PreToolUse would start a process on every step of every
session), the OAuth usage endpoint (login token, terms), advisor by default,
forced `CLAUDE_CODE_SUBAGENT_MODEL`. Not moving to Pi. Pi's own subscription
sign-in bills as extra usage (pi.dev/docs/latest/providers). The
`pi-claude-code-provider` package instead drives the installed `claude -p` and
does draw on plan limits today (support.claude.com 15036540, 2026-09-13), but: it
re-sends the whole history as one message per request; `claude -p` was named in
Anthropic's paused plan to move headless use onto a $20/month credit on Pro; the
package has 13 stars; and orchestrate would lose helpers, hooks, skills and the
installed plugins. Revisit if headless use is confirmed on plan limits for good
and a need appears that Claude Code hooks cannot meet.

## Keep going without idling, 2026-09-13 (in v0.12.0)

The stall: "keep coding until it's done" did one turn, started CI or an agent,
and handed back. The only thing that keeps a turn alive is a Stop hook that
refuses the stop, and `turn-check.mjs` fired only for a bound ledger run — and
only while the skill was loaded, which direct work rarely does. So nothing
covered the common case. 232 tests pass (up from 221).

- `persist-check.mjs`, a new plugin-wide Stop hook (in `hooks/hooks.json`, and
  with the router flag on a script install). Armed only by the router on an
  explicit ask ("keep going", "until it's done", "execute the plan"; never a
  question). Continues while each step does real work; stops and disarms on a
  done report, a question to the user, a denied dispatch, a repeated error, a
  step with no work, or 25 steps. Check-in line every 6 steps, cost warning on a
  long session. Unarmed sessions: one small file read, no output.
- Deliberately not in `turn-check.mjs` as first planned: a frontmatter hook is
  dead exactly where the stall happens.
- No PostCompact hook, also a change from the plan: the router's existing
  `SessionStart:compact` handler already restores the run after compaction. It
  now restores the pinned goal verbatim too.
- `Monitor` is the lead's default way to wait (`lanes.md`), matching the worker
  rule.
- Not measured live yet. Owed: one armed run on a small real goal, with
  `measure.mjs --latest --dollars` before and after.

## v0.11.0 — most coherent, reliable, Claude-native, 2026-09-10

Three read-only scouts placed v0.10.0 at or near the front of the field on
design, found it marked three *live* Claude features as unavailable, and named
real but non-catastrophic defects plus two competitive gaps (enforced per-role
tool limits, native mass-edit fan-out). This release works the whole list.
221 tests pass (up from 199), `node --test $(find skills -name '*.test.mjs')`
— the glob form in the old command does not run reliably before Node 21; CI
already used `find` and the docs now agree.

**A real blocker, fixed and proven live.** `SKILL.md`'s injection line
(`!`node "${CLAUDE_SKILL_DIR}/scripts/profile.mjs" --brief`) aborted the whole
skill load if `node` was not on the launching app's PATH — the exact GUI-launch
case the README already warns about, just one line the warning did not reach.
Now `... --brief 2>/dev/null || true`. Proved, not just fixed: the same
command with `PATH` stripped of `node` exits 127 unwrapped and 0 wrapped.
`{{NODE}}`-templating the line instead was considered and rejected — the
plugin install (this skill's primary channel) never runs the templater, so a
literal `{{NODE}}` token would have shipped broken to everyone on that path.
**`turn-check.mjs` was in the same position** for a script install specifically:
`--with-hook` pinned the interpreter for the other two money hooks and simply
never registered the Pickup check at all, so it ran on bare `node` regardless
of which install path someone used. It's the third entry `--with-hook`
registers now, pinned the same way — confirmed on a real (non-dry-run) install
into a temp `HOME`.

**The dispatch tool now has two names to answer to.** `guard-agent.mjs`,
`hooks/hooks.json`, `SKILL.md`'s own matcher and `lib/settings.mjs`'s
registrations all matched only `Agent`; a host that ever renames it to `Task`
would have made every hook — pricing, the credential guard, the budget gate —
silently stop firing. All four now accept `Agent|Task`, and so does
`measure.mjs`'s dispatch counter.

**Three concurrency bugs in the hooks that hold the money rules**, found by
reasoning through what "up to 20 concurrent subagents" (a documented, ordinary
case here) actually does to each store:
- `costs.jsonl` (R1) was read-all/push-one/write-all; two returns landing
  together meant whichever wrote second discarded the first's cost line.
  `appendFileSync` now, one line, with a rare (2% per call) trim pass, so
  losing the trim's own race only delays it, never a record.
- The return ledger's dedupe (R2) was one global `{sig, ts}` slot in
  `last-return.json`; a second, *different* return landing in between could
  overwrite the first's record before it was checked, so a genuine duplicate
  stop for the first could pass and get double-counted in `costs.jsonl` and
  `returns.jsonl` — which `runSpend()` reads to decide whether a run is still
  under budget. An append-only per-signature log (`returns-seen.jsonl`)
  replaces it: a concurrent writer only ever adds its own line.
- The dispatch guard's own event log (R4, `dispatch-events.json`) had the same
  read-modify-write shape under concurrent `PreToolUse` calls. Same fix,
  factored once into `lib/tier.mjs` (`seenRecently`/`recordSeen`/`trimLog`) and
  reused by both hooks; the old object-keyed `markSeen` stays exported from
  `guard-agent.mjs` for anything still importing it, but nothing here calls it
  anymore.
- **The budget gate could enforce a stranger repo's ceiling** (R3): a session
  with no repo above its `cwd` fell back to the machine-wide last-opened-run
  pointer for *everything*, including the spend gate — so a dispatch could be
  denied (or silently allowed) against a completely unrelated repo's budget,
  just because that repo's run happened to be the last one opened anywhere.
  `resolveRunObj(input, ti, { forBudget: true })` now refuses the pointer for
  that one caller; display (`router.mjs`'s "candidate, not bound") already
  hedged it correctly, only the gate was treating it as authoritative.

**F6: the budget gate was inert by default.** `run-init --budget` existed
since v0.10.0; the canonical dispatch command in `SKILL.md §4` never included
it, so a run built by following the skill's own instructions had no ceiling
and the gate never fired. `--budget` is now always in the canonical command,
and the ask is in money words with a recommendation from the plan's own shape
("about $40 in list-price dollars, not what your subscription bills you"),
skipped entirely for a run small enough it would not have been delegated more
than once anyway.

**SendMessage proven as a delta lane, live, 2026-09-10.** Dispatched a
background agent, let it finish, then `SendMessage`'d its raw agent id with a
follow-up — no `ListAgents` lookup needed for a same-session id — and it
resumed from its own transcript and completed cleanly. `hosts.md`, `lanes.md`
and `SKILL.md §5` now state this as a first-class move instead of "documented,
unverified". **`fork` is the opposite finding**: probed the same way
(`subagent_type: "fork"`), and the host refuses it outright —
`Agent type 'fork' not found` — not just absent from a listing. Not offered
as a lane. **The Workflow tool re-confirmed still not exposed** to the model
(absent from every deferred-tool query, 2026-09-10). **A new, grounded fact for
the SDK-hosted path**: server-side context editing and compaction
(`anthropic-beta: context-management-2025-06-27`, `compact-2026-01-12`,
platform.claude.com docs read 2026-09-10) are that path's own answer to the
same "the conversation re-reading itself is the biggest cost" problem this
skill solves by hand with the Pickup relay — named in `models.md`, marked
inferred-not-verified for whether a Claude Code session can reach either.

**A fourth hook, `precompact-check.mjs`** — the one unguarded hole in the
relay design: a long lead can auto-compact mid-turn with a stale Pickup line,
and the compacted context has no way back. Same question as `turn-check.mjs`'s
Stop check, reused rather than re-implemented (`pickupSection`/`pickupHash`/
`shouldBlock` imported, not copied), fired one lifecycle point earlier, and
carrying the same "never block twice for the same unwritten text" safety rule
— PreCompact commonly fires because context is already low, and refusing
forever would risk the overflow this hook exists to prevent. Frontmatter-scoped
like `turn-check.mjs`, and registered by `--with-hook` for a script install.

**Tool scoping tightened, not built from zero.** `orch-planner`, `orch-
researcher` and `orch-reviewer` already carried explicit allowlists that were
already correct (reviewer cannot write at all). `orch-implementer`,
`orch-debugger` and `orch-browser` used a blocklist naming only `Agent`;
each now also denies `SendMessage` and `Artifact` (no worker can message a
sibling around the lead or publish anything), `Monitor` is denied on the two
roles whose own instructions already forbid waiting on an async check, and
`orch-browser` additionally denies `Bash`, `WebFetch` and `WebSearch` so it
cannot reach the network or a shell outside its own browser pane. **One real
finding changed the plan**: a plugin-installed subagent ignores `hooks`,
`mcpServers` and `permissionMode` in its own frontmatter entirely
(code.claude.com/docs/en/sub-agents, read 2026-09-10) — since the plugin path
is this skill's primary channel, per-dispatch `permissionMode` narrowing was
never a real lever here, and `tools`/`disallowedTools` is the only one that
reaches every install path. `hosts.md` and `SKILL.md §10` say so, with the
finding, so nobody tries `permissionMode` again expecting it to work.

**`scripts/batch.mjs`**, the in-model fan-out lane for real parallel
mass-edit. The model cannot reliably start Claude Code's own `/batch` (a
user-typed slash command) or the Workflow tool (not exposed here, confirmed
above), so this is the portable fallback: one spec plus a file list becomes N
per-file packets and N task rows, each `OWNS` exactly one file, grouped into
waves at a concurrency default of 20 (matching the host's own default
concurrent-subagent limit). Costs a real dispatch per file — it is not a
cheaper `/batch`, it is the one that works without depending on either
unreleased-to-the-model feature. Documented in `lanes.md`, pointed to from
`SKILL.md`'s reference list.

**Also fixed**: `router.mjs`'s `FALLBACK_CARD` had silently drifted two
paragraphs behind the real card in `ladder.md` (it only runs when that file
cannot be read, so nothing else exercised it) — now byte-identical, with a
test that would fail on the next drift; the stale `hey-vera` author handle;
`plugin.json`/`marketplace.json` description text still framed as "an
autonomous technical project manager" from before v0.8.0/v0.9.0's "a senior
engineer, not a process" rewrite; `hosts.md`'s "effort comes from the agent
file" corrected to "inherits the session's effort", matching what
`routing.md` and `models.md` already said; the README's hook table, which
called the ledger frontmatter-only when `hooks/hooks.json` also registers it
globally; `models.md`'s price table re-verified live against claude.com/pricing
(unchanged, stamp refreshed); `HANDOFF.md`, entirely v0.8.0/v0.9.0 stale,
deleted — this file is the resume point now. **Checked and found already
correct, not changed**: the "prices are estimates" caveat (both price tables
already carry one, in different but adequate words); SKILL.md §9's supposed
pointer at a removed `/output-style` command (no such reference exists in the
current file).

Not done here: publishing. Version bumped to 0.11.0 in `plugin.json`,
`marketplace.json` and `SKILL.md`; both `.skill` zips rebuilt
(`scripts/package.mjs --both`); everything above committed to a branch and
pushed. Tagging, the marketplace update and enabling auto-update on anyone's
install are Josh's call, not made here — a red main would self-install given
the marketplace's auto-update setting, so the offline suite staying green
(it does, 221/221, Node 18/20/22 via CI) is the gate before that call, not a
substitute for making it.

## v0.10.0 — manage to a budget, not just work, 2026-09-10

A single "execute the plan" session on this machine burned about 20% of a Max 5x
plan. Measured (`measure.mjs` on session `ea7b6432`): 977 turns, ~18 hours, $276.51
at list price on the lead conversation alone, of which ~84% was the conversation
re-reading its own context every turn (~465M cache-read tokens); another ~$300
across ~20 subagents, implementers averaging $23.60 each. v0.10.0 makes the run
manage itself instead of drifting, structurally (facts and guardrails), not with
more prose — the compliance research in `docs/research/0003` says prose does not
hold under load.

- **Budget of record.** `assets/RUN.md` gains a `## Budget` block with a list-price
  dollar ceiling, seeded by `run-init --budget`; `parseBudget`, `runSpend` and
  `readRun` (in `lib/tier.mjs`) read it and the per-run subagent spend.
- **A spend gate.** `guard-agent.mjs` (`budgetDecision`/`overCeiling`) denies a
  dispatch that would cross the ceiling and asks to raise it or stop. It is a
  PreToolUse deny, so it holds even inside an autonomous `/goal` loop, and it reads
  the live ceiling every time so raising it needs no separate acknowledgement.
- **The readiness signal finally fires.** `router.mjs` shows a run's ready tasks,
  progress and budget even when the session starts above the repo — the reason it
  never showed before (`ctx.run` was null) — and surfaces the missing-`blocks on`-
  column case out loud (`lib/tier.mjs` `edgesMissing`) instead of a silent, empty
  "nothing ready". Proven against the real ledger that hit exactly this.
- **A management heartbeat.** `turn-check.mjs` (`heartbeatDecision`) adds a
  marathon-handoff nudge (~150 turns) and an idle nudge (≥2 tasks unblocked) ahead
  of the existing Pickup check, one block per Stop, by priority.
- **Workers never wait on CI.** The implementer and debugger role files and
  `packet.md` say push and return; the lead reads the async result cheaply.
- **Removed** the resurrected weekly-dollar anchor from `profile.mjs`; the per-run
  Budget ceiling replaces it.
- **CI, at last.** `.github/workflows/ci.yml` runs the offline suite on push and PR
  across Node 18/20/22, gated by one `ci-ok` context, because the marketplace
  auto-updates and a red main would install itself.

Tests: 199 pass (12 new), no network, no quota. Not verified live: whether a Stop
hook can yield a `/goal` loop, `--max-budget-usd` on the desktop app, and
`SendMessage` to a running subagent.


## v0.9.0 — a senior engineer, not a process, 2026-09-09

v0.8.0 cut the instruction down. v0.9.0 removes the machinery that was still
making decisions from the *shape of a message* rather than from the work, and
fixes two defects that could lose or misfile real work.

The rule behind every change: **a hook may hold a fact the model cannot see, or
catch a failure a pattern can genuinely detect. It may not decide how the work
should be done, and it may never spend a model turn to buy a format.**

### Two concrete bugs, fixed

**The credential guard could be bypassed by asking twice.** `guard-agent.mjs`
deduplicated first and decided second, so a packet denied for carrying a
credential, re-sent unchanged within five seconds, was read as "the same
dispatch, already handled" and passed. Re-sending an identical call is exactly
what a model does when a tool call fails. The decision now runs on every
invocation, before anything is deduplicated; only the side effects — the
dispatch record and the price tag — are suppressed for a repeat.

The same file also wrote the first 200 characters of every packet to disk as its
dedupe key. On a packet denied for holding a credential, that wrote the
credential to disk. Event identity is now `session_id` + `tool_use_id` where the
host sends them, and a digest of the whole payload where it does not. Two
packets from the same template no longer collide, two sessions no longer
overwrite each other's single global slot, and denied attempts are recorded
apart from work that actually ran.

**A machine-wide "active run" pointer decided where a return was filed.** When a
session's working directory was not inside a repo, every hook fell back to the
newest run on the machine — which is not the same fact as the run this session
is working on. Observed: a subagent's return filed into a *closed* run in a
different repository, flipping two finished rows back to review.

A run now belongs to the session that opened or claimed it:

- `run-init.mjs --session-id <id>` records the binding when the run is created,
  and `run-init.mjs --bind <RUN.md> --session-id <id>` claims an existing one.
- A packet can carry `RUN:`, and the guard keeps that association on the
  dispatch record.
- The ledger resolves a return from the packet, then the dispatch record, then
  the session binding, then a single unambiguous open run in the current repo.
  Never from the pointer.
- Two open runs in a repo are *candidates*, never a guess.
- A return nothing owns is written to `~/.claude/orchestrate/returns/<session>/`
  and the hook says so, with the command that would bind the right run. Nothing
  is dropped, and nothing is guessed into the wrong ledger.
- Return filenames come from agent and event identity, not from counting the
  files already in the directory, which gave two concurrent returns the same
  number and let the second overwrite the first.

### The router stopped routing

`router.mjs` was a table of regular expressions that read each message, put it
on one of ten rungs, and injected an instruction naming an agent, a research
depth, a reviewer or a permission request. All of that is gone. A pattern in the
wording is not evidence about the work: six files is not a reason to delegate,
"should we" is not a reason to research, and the word "deploy" in a sentence is
not a reason to ask permission for an edit.

What it still does is report what the model cannot see — plan tier, its own
model, installed agents, a family limit hit today, the bound run — and, on
resume or compaction, bring back a bounded excerpt of the run's goal,
constraints, decisions and Pickup line. Then it is quiet until one of those
facts changes. A different wording is not a change of state.

It also no longer tells the user to change their model or effort. That advice
fired unprompted at the start of a session, about the user's own settings.
`models.md` still holds the recommendation, for when they ask.

### Two Stop hooks retired

- **`return-check.mjs` is deleted.** It blocked a subagent from finishing while
  its return lacked a restatement, or ran past 60 lines, or put fields in the
  wrong order. Every trigger was formatting, and every block spent a real model
  turn. In plan mode it spent four on one piece of finished work. Returns are
  now parsed leniently and filed whole; a missing EVIDENCE section makes a task
  unverified, which is a grade, not a re-run.
- **The research floor is gone from `turn-check.mjs`.** It blocked a turn when a
  set-shaped recommendation had been answered from fewer than two source-reading
  calls. Two failed fetches satisfied it. One authoritative document did not.
  Counting requests is not measuring how well something is answered.

The Pickup reminder survives, narrowed to a run this session explicitly bound. A
session doing direct work has no ledger to keep current.

### The ledger stopped writing rows

`ledger.mjs` saves the return, prices it and records the association in
`returns/returns.jsonl`. It no longer edits `RUN.md`: two returns landing
together each read the whole file, changed one row and wrote it back, so the
second erased the first. The lead sets a row when it has read the return, which
is also the only moment anyone has actually judged it.

### Cost stopped inventing numbers

- **No weekly figure.** The "% of your week" on every price tag divided by an
  anchor built from one observation (Pro ~$30, Max 5x ~$150, Max 20x ~$600). A
  percentage computed from that reads like a measurement. Gone, and with it the
  5%/25% thresholds that rested on it. What is left: say a price once, before
  the spend, when it is big enough to change what the user would want.
- **No model, no price.** `family()` used to answer `sonnet` for anything it did
  not recognise, so a dispatch that inherited the session's model was priced as
  the cheap one and reported as measured. Unknown now stays unknown, in the
  guard's tag, in `costs.jsonl` and in `measure.mjs`.

### Smaller interfaces

- **The packet is four fields**: the task and its objective, the context and
  decisions it needs, the scope boundaries, and the evidence that means done.
  Everything else — run, dependencies, worktree, owned files, gate, prior
  attempts — is added only when it applies. "Every field, every time, 'none'
  rather than omitted" made every packet carry a dozen lines that stopped
  nothing on that task.
- **The return is TASK, STATUS, CHANGED, EVIDENCE, NOT VERIFIED**, plus a
  verdict and findings for a review. Older verbose returns still parse.
- **Role agents cannot dispatch.** Enforced with the host's own tool
  restrictions rather than a sentence asking them not to.
- **Role agents no longer pin an effort level.** Planner and debugger were
  `xhigh` and the rest `high`, overriding whatever the user chose for the
  session and spending their quota at it.

### Review is bought, not scheduled

The rule that a manager strictly above the author could read the diff itself,
and otherwise had to dispatch, created reviewers by arithmetic on model names —
a comparison that says nothing about whether a change is risky. Independent
review is now for an authorisation or security boundary, money moving, a
destructive or irreversible data change, a compatibility contract others
consume, or unresolved architectural doubt. The reviewer is given the concrete
risk and the acceptance criteria. Correctness findings decide the verdict;
anything else is optional and must not start a repair loop. A reviewer
disagreeing is no longer a trigger to escalate the author's model.

### The ledger keeps the goal

`RUN.md` gained **Constraints and non-goals** and **Approach** above the task
table, so the four things a resuming session actually needs — the outcome and
why it matters, the evidence that would prove it, what it must respect and is
not doing, and the next deliverable — are in one place. That block is what the
router injects on resume, never the task history.

### The lead can tell a ready task from a blocked one

Josh watched a session sit idle, waiting on one agent, with a finished plan on
the board and a `/goal` loop running: no progress, and quota burning, because an
idle turn in a `/goal` loop still costs a turn.

The cause was a gap between two files. `SKILL.md` told the lead that every task
row carries "what it blocks on" and "the files it owns". The `RUN.md` table had
seven columns and neither of them. The dependency graph was asked for and
dropped, so nothing could answer "what could start right now" and the lead fell
back to the one agent it happened to remember.

- The table gained **`blocks on`** and **`owns`**, both to the left of the free
  text, because everything that reads a row counts from the left and a stray
  pipe in a task description would otherwise shift them.
- `readyTasks()` in `lib/tier.mjs` computes which planned rows have no unlanded
  blocker, from text `readRun()` already parses. No new file read, no new hook.
- The router appends `ready now: <ids>` to the run line it already prints, and
  `stateHash` includes the ready set so the line reprints at the moment a task
  becomes ready. It reports; it never demands. A lead that should wait still can.
- A ledger written before those columns existed has no edges to read, so it
  reports nothing rather than claiming every planned row is ready.

The same line also names **returns that came back and were never graded**, which
closes a gap this release opened. The hook stopped writing rows, so a row is
only right if the lead sets one, and `readyTasks` reads those same rows: a stale
🔨 hides a finished task and everything waiting on it stays invisible. The
router now says how many returns are owed a grade and which, and stops the
moment the row is set. `returnedTasks()` reads the index the ledger already
writes, and `ungradedReturns()` compares it against the rows.

Only `📋` and `🔨` count as ungraded. `◐` and `⛔` are grades the lead chose;
`✅`, `🧱` and `✖` are final.

**This is not a push toward parallelism, and the distinction is the whole
design.** [Anthropic's multi-agent write-up](https://www.anthropic.com/engineering/multi-agent-research-system)
(checked 2026-09-09) warns that "most coding tasks involve fewer truly
parallelizable tasks than research, and LLM agents are not yet great at
coordinating and delegating to other agents in real time", and puts multi-agent
token use at roughly 15x a chat against about 4x for a single agent. Speculative
fan-out on coding work is a bad trade.

What this ships is narrower: the plan already declared these tasks independent,
so starting one is executing a graph rather than guessing at one. Note also that
parallelism is a wall-clock win and not a quota win — the same tokens are spent
either way, and concurrent agents pay slightly more because each re-reads its
own prefix against a five-minute subagent cache. The saving is the idle turns
that stop happening.

### What was measured, and what was not

Measured: 169 unit tests pass, no quota and no network. Both bugs above were
reproduced before the fix, and each is covered by a test that fails against the
old code.

**Not measured: whether any of this makes the model work better.** Nothing here
ran a live model. The claim this release makes is structural — the plugin no
longer creates incentives for work nobody asked for — not behavioural. Passive
measurement from ordinary use (`measure.mjs --latest`) is how that would be
found out, and it has not been run on a v0.9.0 session yet.

### Maintainer rule, now written down

A new permanent hook or instruction needs a concrete failure it prevents, a
reason the existing behaviour cannot cover it, and what it costs on every future
turn. No self-modification, and no growing pile of lessons after every incident:
an instruction that fires on everything to catch one thing costs more than the
thing. It is in `SKILL.md` §10, because that is where it will be read.

## v0.8.0 — cut it down to judgment, 2026-09-09

Josh: we are over-engineering; the manager should ask direct questions and find
out what someone is actually trying to express instead of agreeing with them; it
should feel like a real engineer who tells you what you need to hear; and we are
not taking advantage of Claude's own reasoning, because a manager that saw the
big picture would not need most of this scaffolding.

He was right, and the repo's own research already said so. `docs/research/0003`
found that compliance, not detection, was the failure — the rule existed and was
ignored — and that **adding instructions lowers adherence further**. The response
to that finding had been to add a reply checker, a research floor, a depth-call
table and a money rule.

### The principle

**Keep information the manager cannot derive. Cut instruction that tells a
capable model how to think.**

Information stays: what a plan includes, what the limits mean, what each model
costs, what the host can and cannot do, where the gate comes from, the
failure-class table. Mechanisms stay: the credential guard, the ledger, the
research floor. Instruction goes, and what survives of it is said once.

### What went

- **The reply check.** A second model read every reply and sent the turn back if
  a claim named no evidence. **Zero fires across every session on this machine,
  including 588 turns in one build**, at about half a cent a turn. Certain cost,
  unmeasured benefit, and a model policing a model is the most expensive rung of
  the enforcement ladder. `RETIRED_PROMPTS` in `lib/settings.mjs` removes it from
  anyone who already installed it.
- **`references/contracts.md`, 11.8KB** explaining a 4KB template field by field
  and then restating what each of the six role agents does — while every agent
  file carries its own role rules, where the agent actually reads them. The four
  things it had that the template lacked moved into `assets/packet.md`.
- **`references/borrowed.md` and `references/audit-prompt.md`** left the shipped
  surface for `docs/`. One is attribution for a reader; the other is a
  maintainer's tool that still said "Current for v0.4.0". Neither is instruction.
- **The sermons.** `routing.md` said "pick the smallest model whose chance of a
  first-time-right result clears the bar" three times and carried a 15-line
  worked dialogue for a two-line rule. `evaluation.md` restated `models.md`'s
  verification rule in full rather than pointing at it. `ladder.md` said the
  depth call's third row twice. `SKILL.md` carried `routing.md`'s table.

### What arrived

None of the 105KB told the manager how to *be* with the user. Two rules, in the
output style because that is in the system prompt on every turn:

- **Find out what they actually want.** What they typed is a clue, not the whole
  of it. Ask about the hard part, not the obvious part.
- **Agreement is not a deliverable.** Say the weak thing is weak in the first
  sentence, then say what you would do about it. Never flatter.

Both are in `SPEECH_RULES`, so they are checked against `SKILL.md` and the style
together.

### The numbers

| | before | after |
|---|---|---|
| shipped instruction text | 105,041 bytes | 67,222 bytes |
| files | 11 | 9 |
| tests | 189 | 188 |
| per-turn model calls added by the skill | 1 | 0 |

### What could not be measured, and why

The plan opened with "build the instrument before cutting anything":
`claude plugin eval --ablation with-without` runs the suite with and without the
plugin and reports the delta, which would have answered whether 105KB of
instructions beat plain Claude at all. **It is in early access and refuses on
this account.** The fallback was a manual A/B, six real orchestration runs. Two
things argued against paying for it: a cross-file overlap measurement showed only
**3%** of the prose is duplication, so almost every cut is a judgment call that
three prompts could not settle; and n=3 with a hand-built judge looks rigorous
without being rigorous.

So this cut is not validated by an experiment. It is validated by the principle,
by 188 tests, and by whether the next real run feels better. `HANDOFF.md` already
said the user's own use is the signal that matters more than any test here, and
that is the honest position for this change too.

**The plan's "under 40KB" target was not met, and should not have been.** It was
set before the information-versus-instruction split was measured. Reaching it
would mean deleting `hosts.md` (11KB of host facts a model cannot derive) and the
price tables, which is the opposite of the principle the audit runs on.

## v0.7.3 — the wrong-run bug was corrupting ledgers, 2026-09-09

`latestRun` sorted run folders by name. Folders are `<YYYYMMDD>-<slug>`, so that
only orders runs from different days; two opened on the same day fell back to
comparing slugs. It was filed as a small labelling bug. It was not.

Because the ledger writes whichever run it is handed, the reviewer's two returns
for this build were filed into the *closed* `20260909-vibe-coder-audit` run, and
its rows 9-9-0001 and 9-9-0003 were flipped from ✅ done back to 🔍 review with
their attempt counts and evidence overwritten. A closed run silently reopened
with someone else's evidence in it. Both returns have been moved to
`20260909-v07-senior-engineer/returns/` and both rows restored from that run's
own return files.

There were **three** copies of the run sort: `lib/tier.mjs`, and its own in
`profile.mjs`, which kept naming the closed run in the profile line even after
the first fix landed. `profile.mjs` asks `lib/tier.mjs` now, the same way it
already does for the agent count.

Two sorts were tried and both were wrong. By name reproduces the bug. By
modified time hands back whichever run was written last, which is the *same*
wrong run, because the bug itself had just written to it. The fix is the one
signal recorded when a run is opened and never moved afterwards: the
`active-run.json` pointer `run-init` already writes. It wins when it names a run
under the repo being asked about; creation time, then name, breaks any remaining
tie.

## v0.7.2 — the plugin install, which had never worked, 2026-09-09

Josh asked for automatic updates so he would never fall behind. Answering that
meant actually installing the plugin, and the moment anyone did, three defects
surfaced that no test could have caught because none of them exist until a real
host reads the manifest.

1. **There was no marketplace manifest.** The README had told people to run
   `/plugin marketplace add 1xmint/orchestrate` since v0.6.0, and the repo had
   no `.claude-plugin/marketplace.json`. That command could only ever fail. The
   "one-command install" the README calls the short path had never worked for
   anybody, which is also why auto-update was unreachable: there was no
   marketplace to enable it on.
2. **`plugin.json` declared `agents` as a directory string** where the schema
   takes a list of files. `claude plugin validate` rejects the whole manifest
   for it.
3. **`plugin.json` declared `hooks: "./hooks/hooks.json"`.** That file loads
   automatically, so naming it too is a duplicate load and the host refuses the
   entire plugin: "Duplicate hooks file detected". Only a real install shows
   this; validation passes either way.

Then a fourth, caused by fixing the first three: **a plugin install reported
`agents 0/6`.** The host registers the six role agents from the plugin's own
folder and copies nothing into `~/.claude/agents`, and `agentsInstalled()`
counted only loose files. It would have told the model to run
`install-agents.mjs`, creating a second set that shadows the plugin's. It now
looks in both places and says which one it found, and `profile.mjs` no longer
keeps a second copy of that rule.

`claude plugin validate . --strict` passes, the plugin installs and loads, and
187 tests cover all four so none can come back. 0.7.0 and 0.7.1 are tagged but
should not be installed; 0.7.2 is the first release whose plugin actually loads.

### The folder rename could not be done from inside Claude

The worktree failure was diagnosed to its root: the folder on disk is
`C:\Users\Josh\Desktop\Github` with a lowercase h, every Claude session uses
`GitHub`, Windows accepts both, git reports the real one, and the Agent tool
compares the two strings and refuses the worktree. Not a bug in git or in this
skill, and nothing in the skill can fix it.

The rename is blocked while Claude runs: its own filesystem MCP servers are
rooted at that folder (`mcp-server-filesystem C:\Users\Josh\Desktop\GitHub`,
four of them) and hold it open. An attempt was made and failed at step one,
changing nothing. A guarded two-step script for a moment when Claude is closed
is in this session's scratchpad as `fix-github-casing.ps1`; it puts the original
name back if the second step fails.

### What this machine is on now

The script install is gone: `~/.claude/skills/orchestrate`,
`~/.agents/skills/orchestrate`, the six loose `orch-*.md`, and the four
orchestrate hook entries in `settings.json` were all removed, leaving
`memory-write-gate.mjs` untouched. There is one copy now, from the plugin cache.
`extraKnownMarketplaces.orchestrate.autoUpdate` is set to `true` in user
settings; the docs only document that key for managed settings, so whether the
host honours it there is unverified — the `/plugin` Marketplaces tab is the
path that is documented to work.

## v0.7.0 — the senior engineer in the chair, 2026-09-09

Plan: `C:\Users\Josh\.claude\plans\you-are-the-senior-kind-mango.md`, grounded
2026-09-09 against `main @ 019bd5e` and the live docs for the desktop app's
2.1.260. Seven reflexes, each with a mechanism rather than more prose. 148 tests
became 185, green at every commit.

### What changed

**The setup conversation now happens.** `managerAdvice` was computed only on the
card turn, and on a fresh session the card goes out on prompt 1, before any
assistant record exists, so `self` was always null and the advice had never
fired for anybody. It has its own `adviceSent` flag now, fires on the first
prompt where the model is actually visible (prompt 2 on a fresh session), names
the click for the host it is on (`selfModel` reads `entrypoint`), and goes quiet
for good once `profile.mjs --set manager=accept|<model>/<effort>|ask` records the
answer. A tier change re-opens it, because the recommendation changes with the
tier. `--set-default model=… effort=…` writes the two keys into
`~/.claude/settings.json` for new sessions and refuses `max`, which the host does
not accept in either key.

**A question gets a depth call before an answer.** Five rows in `ladder.md`,
keyed on what can be observed about the question rather than on how sure the
model feels: settled, one current fact, inherited across a set, design judgment,
checkable by a command. Rung 3.7 is new in the router, tested last of the
question rungs and gated on `heads === 0`, so neither a research question nor a
build request carrying "or should we use the helper" is taken for a judgment.
The card gained one line and its cap moved from 1,400 to 1,550; the body is 1,546.

**Every claim carries its basis, and two checks say so when it does not.**
- The Plain style gained Anthropic's Opus 5 scope paragraph verbatim, a basis
  rule, and a working-out-loud section that resolves the contradiction research
  0001 found between "say what you are about to do" and "do not narrate". It
  ships `force-for-plugin: true` (Josh's decision), so a plugin install turns the
  voice on and disabling the plugin turns it off. 3,846 bytes against a 4,500 cap.
- SKILL.md §9 shrank to the six rules that survive with the style off, and
  `assets.test.mjs` checks those six against both files.
- The reply check: a `type: "prompt"` Stop hook on Sonnet, prompt in
  `assets/reply-check.txt`, copied verbatim into SKILL.md frontmatter. It reads
  only the reply, so it is a fresh instance that never saw the reasoning behind
  it. `install.mjs --with-reply-check` registers it globally; off by default.
- The floor in `turn-check.mjs`: deterministic, for the one shape a reply-reader
  cannot catch — a set-shaped recommendation answered from fewer than two
  sources, with a recommendation in the reply.

**Money.** `lib/prices.mjs` prices anything in list-price dollars, the unit
`/usage` computes its own Session figure in. The ledger appends every finished
dispatch to `~/.claude/orchestrate/costs.jsonl` (capped at 500 lines) and puts
the figure in the RUN.md evidence cell. The guard tags every dispatch before it
runs. `profile.mjs --brief` prints what roles have cost here;
`measure.mjs --dollars` prices a finished session. The thresholds are 5% of a
week to say it and 25% to ask, in `routing.md`. No counter anywhere.

**Also**: a `Shape` line on every run (tasks, parallelism, models, price, why not
smaller); one bounded interview round before a goal larger than a sitting; the
router deduped on prompt id *and* text so a mid-turn message is not dropped;
`docs/research/0004-loops-and-stopping.md` in the repo with its findings folded
into `evaluation.md` §6 and §9, `lanes.md` and `models.md`.

### Measured, not assumed

| What | Number | How |
|---|---|---|
| the floor, unnarrowed | 5.57 fires a day | `turn-check.mjs --replay-week` over 51 transcripts |
| the floor, as shipped | 0.14 a day (1 in 7 days) | the same, and the single fire is the exact 0003 question |
| the card body | 1,546 chars | asserted at 1,550 |
| the Plain style | 3,846 bytes | asserted at 4,500 |
| this build session | $42.56 at list price, ~28% of a Max 5x week | `measure.mjs --latest --dollars` |
| tests | 185 | `node --test "skills/orchestrate/scripts/**/*.test.mjs"` |

The floor's narrowing is worth recording because the first version would have
been unshippable. `research && setShape` alone fired on pasted plans and handoff
documents: long text containing "recommended" and "for each", answered with a
"should". Three narrowings fixed it — it must be a question, not a paste, under
60 words, and not a host notification — and the 0003 case still fires.

### Facts settled by probe, not assumed

- **Skill frontmatter accepts `prompt` hooks.** The hooks doc's "Hooks in skills
  and agents" says all hook events are supported there and all five types;
  agent *files* are the ones limited to command and http. So the reply check
  ships session-scoped from SKILL.md rather than global-only.
- **Hook output is an `attachment` record**, not user-role text:
  `{"type":"attachment","attachment":{"hookEvent":"…","content":["…"]}}`. A
  mid-turn message is `{"type":"attachment","attachment":{"type":"queued_command",
  "prompt":"…"}}`. `measure.mjs` read only user records and so reported **0
  router injections on a transcript holding 4**. Fixed, with a test.
- **The transcript shape of a *blocked* Stop was not observed.** No main-session
  transcript on this machine holds one. Both counters therefore match a fixed
  prefix at the start of a record, not a record shape. They also had to be
  tightened: matching the prefix anywhere counted this plan document, which
  quotes both reasons verbatim, as two blocks that never happened.

### The over-verification audit (plan step 3d)

Grepped every shipped text for `double-check|re-verify|verify your|check again|
make sure|be thorough|to be safe`. **Two hits, zero removals.** Both already
argue against over-verification: `evaluation.md` citing the Opus 5 guidance, and
the new `ladder.md` row telling the model not to re-verify what is settled. The
skill was already clean of the pattern; the audit is recorded so nobody re-runs it.

### What is still reasoned rather than measured

- Every price in the `models.md` starting table, and every week anchor. The week
  rests on **one observation** and is labelled that way everywhere it is printed.
  `profile.mjs --set week=<dollars>` replaces it with a real one.
- `high` rather than `xhigh` for the manager. Unchanged from v0.6.0, still
  reasoning, still marked as reasoning.
- The 5% and 25% thresholds. Judgment, chosen so the first fires often enough to
  be informative and the second rarely enough not to nag.
- The reply check's block rate. It ships in orchestrate sessions first for
  exactly this reason: nobody has measured how often a Sonnet reader asks for a
  basis that was already there. Global after one measured week under one block a
  day (Josh's decision 2, §8 of the plan).
- **The field verdict of `docs/research/0001` was not re-tested.** It said
  orchestrate was not the best drop-in a vibe coder could install that day. The
  plugin path closed one of its two gaps in v0.6.0; the other was "has never run
  its own loop", and this build is one session of one person, not a customer's run.

### What the review caught (task 9-9-0003, Opus, FAIL)

Three code findings, all applied. Worth recording because the first was the
release's own rule turned into its opposite, and no test I wrote had caught it:

1. **Rung 3.7 was tested before 3.6 and 3.5**, so a judgment word — the
   commonest way to *phrase* a research question — stole both. "which model
   should we use for each tier?" came back as an opinion instead of a
   researcher dispatch, and that clause is literally what the `setShape` regex
   was written to catch. The root cause went one level deeper than the order:
   rung 3.6 required a *research* word as well as the set shape, so that
   question could never have reached it. 3.6 now takes a research word **or** a
   judgment word, 3.7 is tested last, and the floor uses the same test so the
   hint and the block cannot disagree. Re-measured after widening: still 0.14
   fires a day.
2. **The week share printed a bare percentage.** `weekDollars` carried the "one
   observation" label but nothing printed it, so the guard's price tag and
   `measure.mjs` both showed a hard percentage against an anecdote —
   confident-and-unfounded, which is the shape this release exists to stop.
   `weekShare` now carries the basis every time it prints.
3. **`--set-default model=max` threw a raw stack trace** after writing a stray
   backup. Both keys are checked before the backup is taken.

A fourth finding was recorded and not treated as a blocker: the evaluator sees
only the reply, so a correct short answer drawn from a file read earlier in the
same turn ("what's our retry limit?" → "Three.") has no basis in its own text
and would be sent back. Inside orchestrate the Plain style forces a basis line
and covers it. Globally it does not, which is the reason the global
registration ships off by default until a week of it has been measured.

### Found while building, not fixed here

- **`latestRun` picks the alphabetically last run folder, not the newest.** Two
  runs created on the same day are ordered by slug, so `20260909-v07-senior-engineer`
  lost to `20260909-vibe-coder-audit` and every hook pointed at the older one all
  build. Filed as its own task; the fix is to sort by RUN.md mtime.
- **Worktree isolation refuses in this checkout.** `git` resolves the repo path
  with different casing (`Github` vs `GitHub`), so the Agent tool rejects the
  worktree as a `core.worktree` redirect. That is why the one planned
  `orch-implementer` dispatch for the floor was done inline instead.

### Deliberately not built, with the reason

A Haiku pre-classifier on `UserPromptSubmit` (still returns only ok/reason). A
spend cap or a running counter (v0.5.0's reasoning stands: a counter reads as an
allowance). Skill-frontmatter `model`/`effort` for the manager (it lasts one turn
and thrashes the prompt cache). An agent-type hook as the default reply check
(the host calls agent hooks experimental; the prompt hook is the production
shape and the agent hook, which could also read the turn's transcript and judge
whether the reply answered what was asked, is the upgrade path the day that
label goes). A rewrite of SKILL.md into a next-action loop (more instructions
lower compliance — research 0003). Re-running the field audit (quota).

## v0.4.0 — 2026-09-09, complete

Plan: `C:\Users\Josh\.claude\plans\i-want-you-to-eager-boole.md` (grounded
2026-09-08 against Claude Code 2.1.266 docs; the desktop app runs 2.1.260).
Step numbers below are its section 8.

| step | what | status |
|---|---|---|
| 1 | reference drift fixes; `ladder.md`; `lanes.md` | done, 60beeaa |
| 2 | `router.mjs` + `lib/tier.mjs` + tests; `install.mjs --with-router/--with-hook` with merge, dedupe by basename, backup, `{{SKILL_DIR}}` templating | done, 36b0f60 + 6ec6d87 |
| 3 | `guard-agent.mjs` v2 (downgrade, not deny), `ledger.mjs` (SubagentStop), `return-check.mjs`, `turn-check.mjs`; agent files gain `hooks:` and, on two roles, `memory: user` | done, a6f54dd |
| 4 | `profile.mjs --brief` with a 24 h provider cache and the skills line; `gate.mjs`; `run-init.mjs` prefills the GATE block; SKILL.md v0.4; the who-reviews rule; the manager's own model in the router | done, 4f5dee4 |
| 5 | `install.mjs --project` (gate.json, exclude, a 12-line rules file, the `@AGENTS.md` fix) + fixture tests + one `--dry-run` on notelocus | done, b8ec326 |
| 6 | `measure.mjs`, `router.mjs --cost`, the loading checklist in the README | done, 26ac889 |
| 7 | `package.mjs --spec`, README, version 0.4.0, STATE, HANDOFF, tag | done |

Proof, all at zero model quota:

- The unit suite, `node --test "skills/orchestrate/scripts/**/*.test.mjs"`, green at every commit (98 at the v0.4.0 tag, 124 after the audit pass).
- The installer's merge run against a copy of the real `~/.claude/settings.json`
  in the test suite, and then for real: the `memory-write-gate.mjs` entry is
  untouched, every non-hook key is identical, and a backup exists under
  `~/.claude/orchestrate/`.
- The installed router answered a live payload with the card and the correct
  `/orchestrate` hint.
- `measure.mjs` run on a real transcript of this build session.
- `install.mjs --project --dry-run` on the real notelocus checkout: it reports
  the pytest and ruff gate and the missing `CLAUDE.md`, and writes nothing.

## v0.6.0 — a plugin, model intelligence, and the question that started it, 2026-09-09

Three Fable rounds ran, and Josh was right that it should have been one. Their
findings, applied. The token cost was 668,057 across the three.

**The verdict on the product.** Not the best drop-in for a vibe coder today, and
the reason was the install: a terminal, git, Node and a hand-edited settings.json
against a competitor installed from the desktop plugin browser in one click. The
repo is a Claude Code plugin now and needed no files moved. One token,
`${CLAUDE_PLUGIN_ROOT}/skills/orchestrate`, serves both paths: a plugin host
expands it, `install.mjs` replaces it. The plugin path runs plain `node` and so
needs it on PATH; the script path still pins the interpreter, and the README
says which to use when.

**Model intelligence, which was missing entirely.** `routing.md` had a lookup
table, not reasoning. `references/models.md` now carries what each of the four
models is for, the five effort levels and what lower effort does to output
shape, four ordered tests for never going overkill, and context sweet spots. Two
facts in it were written down nowhere and change behaviour: Haiku's window is
200K, a fifth of the others, so a sweep that fits anywhere else can overflow it
silently; and effort does not work on Haiku at all, so it is the one model that
cannot be asked to think harder.

**The manager's own setup.** It cannot set its own model or effort, because the
user picks both before the conversation exists. So the router compares them
against the plan and says the fix once, then never again: silent when right,
silent when it cannot tell, and `xhigh` tolerated while `max` is called the
worker profile. Pro is Sonnet at high; both Max tiers are Opus at high. Not
`xhigh`, which is documented for long single agentic tasks, and never Fable,
whose cost multiplied across a hundred manager turns buys nothing.

**Why the manager answered too fast.** Root cause was compliance with detection
dead three ways: the question arrived mid-turn and the router never saw it; the
prompt-id guard would have dropped it anyway; and "also is there…" has no
question mark, so it read as a statement. All three fixed, and a research
question that spans a set of cases is now its own rung whose hint says dispatch,
because "fetch one source if it settles it" hands the depth call to the model,
which is the judgment models are worst at. `ladder.md` carries the three-part
test. A Stop-time gate was designed and not built: its false-positive rate is
unmeasured, and a gate that fires on ordinary questions trains you to ignore it.

**Over-verification**, which the audit caught: SKILL.md sent every gate run to a
subagent while `evaluation.md` said filter first, and the subagent version also
contradicts Anthropic's Opus 5 guidance. The manager runs the gate itself now
and delegates when the output is long or the suite is slow. Two reviewers became
one, with a second only when the first verdict is itself in doubt.

Also fixed, both found by using the thing: the ledger filed twenty-one of the
orchestrator's own messages as agent returns, because `agent_id` alone was
accepted as proof a subagent had returned; and `router.mjs` read stdin at import
time, so importing it hung and every test of it had to spawn a child.

148 tests. `docs/research/0001`, `0002` and `0003` hold the full findings with
every URL dated.

## v0.5.1 — how to talk, moved where it binds, 2026-09-09

Josh, on the section v0.5.0 added: it could be better, especially "never call
something remaining work", "don't print a number you can't act on" and "say it
once". He was right. Those were prohibitions with no test inside them, so they
read as agreeable and change nothing.

A research round moved the whole thing. Claude Code has **output styles**: a
markdown file with frontmatter that is added to the system prompt itself and
re-stated during the conversation, applying to every turn of every session
rather than only while a skill is loaded. It also ships a built-in **Concise**
style (v2.1.237+) that leads with the result and drops the narration, which is
most of Josh's complaint, free, and worth trying first.

`assets/output-styles/plain.md` now carries the rules, is copied to
`~/.claude/output-styles/` by the installer, and is deliberately left switched
off: selecting a style changes every session the user has, so it is theirs to
turn on. `keep-coding-instructions: true` keeps Claude Code's engineering
instructions, so it changes how Josh is spoken to and nothing about how the work
is done. `SKILL.md` §9 states the same rules for when the style is off and for
hosts like Codex that have none; a test asserts the two agree.

Every rule now contains its own test. Three came from the research rather than
from taste: name a technical term once and reuse it, because stripping it out
leaves the reader unable to read anyone else on the subject; draw comparisons
from everyday life rather than from other technology; and carry the proof with
every claim, because the 2025 study of professional agent users found that
developers reject narrative summaries and verify instead. Brevity never applies
to an error, a warning, or a confirmation before something irreversible.

Sources: code.claude.com/docs/en/output-styles, nngroup.com on plain language
for experts, arxiv 2512.14012 on professional agent use.

## v0.5.0 — the manager judges the model, 2026-09-09

Josh: "a hard cap on fable helpers doesnt make any sense... id rather have the
manager judge what is appropriate." He is right, and the repo already held the
admission: `routing.md` said dispatch counts are a poor proxy for tokens while
`guard-agent.mjs` counted dispatches anyway.

**The cap is gone, not raised.** No number replaces it. The guard keeps two
jobs, deny a credential and record a dispatch, and has no opinion about which
model a task deserves. Deleted with the cap: the caps table, the daily counter
file, the opt-in file and its flag, the `updatedInput` downgrade, and the spend
total from both the router card and the profile line. A running total is the
cap in another costume. `measure.mjs` reports what a finished run cost, which
is a fact rather than a budget.

**What replaces it is judgment with the facts in front of it.** `routing.md`
gains "Choosing the model, and when the choice is the user's": pick the model
the task needs, then check whether this plan includes it. Included, dispatch.
Not included, it is the user's money and their call, so recommend it, price it,
offer the alternatives, and let them choose. There is a worked example in the
shape of the $20 case. Neither failure is allowed: no quiet downgrade to dodge
asking, no quiet spending to dodge asking. "When Fable earns its cost" gives
the judgment its criteria. The rule holds for a plan tier that does not exist
yet.

**SKILL.md §9, how to talk to the user.** Josh has had to ask for a plain
explanation several times, including in the session that built v0.4.1, whose
report listed four "open items" that were not work and a counter he could not
act on. Every line of the new section is a rule somebody had to ask for out
loud: answer the question first, one idea per sentence, nothing is "remaining
work" unless the user must do something, no number they cannot act on, say it
once, explain rather than define. Explaining to someone fifteen and sharp is
the default, not a mode.

Three tests hold the line: the guard returns only pass or deny on every tier
and model, no shipped file states a numeric Fable allowance, and the skill
still tells the manager to ask. 136 pass.

## v0.4.1 — the fresh-context Fable audit, 2026-09-09

The one step the v0.3 plan reserved and the v0.4 plan deferred: run
`docs/audit-prompt.md` as a Fable subagent against the built skill, apply
what survives. The prompt was refreshed for v0.4 first, because it still
described v0.3 and would have sent the auditor after the wrong artifact.

Dispatch: `orch-reviewer` on Fable, one of three Fable dispatches allowed today,
recorded by the guard and by `.orchestrator/runs/20260909-fable-audit/RUN.md`.

That dispatch is also the first real end-to-end proof of the hooks. The guard
counted it and wrote the session state; the return check, the resume injection
and the deny path were exercised live against the installed copy.

### Six defects found while the audit ran

Each proved on disk before it was fixed, each with the test that would have
caught it:

| # | Defect | Why it mattered |
|---|---|---|
| A | `ledger.mjs` had no dedupe, and the recommended install registers it twice | one dispatch wrote two return files and counted as two attempts |
| B | `profile.mjs` read the Fable counter by UTC date; the guard writes it by local date | "fable 0/3 today" for four hours every evening while the cap was spent |
| C | `install-project.mjs` recursed with an unchanged argument to reach its line budget | unreachable today, a non-terminating loop the moment the fixed part grows |
| D | a half-filled Pickup leaked the template into the resume line | "confidence high \| medium \| low" injected into a resumed session |
| E | `evals/evals.json` was not valid JSON | the eval loop could never have loaded it; "never run" had a second cause |
| F | `router.mjs --cost` had its own transcript parser and counted tool results | it reported six router injections where the meter correctly reported none |

### The audit's own twelve, all resolved

Verdict: **ship-with-fixes**. Its first finding was the one that mattered and
neither of us had seen it: every hook resolved the run from the session's cwd,
and Josh's sessions start in the folder that *contains* his repos, so the whole
mechanical layer was silently inert there. `run-init` now records the run under
`~/.claude/orchestrate` and every reader falls back to that pointer; a repo with
its own runs is never overridden. Proved live from the parent directory.

| # | Finding | Resolution |
|---|---|---|
| 1 | hooks blind when cwd is above the repo | active-run pointer, tested both ways |
| 2 | the return check's budget keyed on the role, not the invocation | keys on `agent_id`, old keys pruned |
| 3 | the reviewer's instructions and its own Stop hook demanded different shapes | one schema everywhere, `VERDICT` carries pass or fail |
| 4 | four credential shapes unknown; Fable spent by inheritance; the deny message handed over the opt-in command | all three fixed |
| 5 | attempts bumped per stop; `updateRow` split on every pipe | cells addressed from the ends; identity required |
| 6 | `risky` drove both "ask first" and "needs a reviewer" | split into two regexes |
| 7 | bare filenames not counted as paths; "continue" dropped before the resume rule | both fixed |
| 8 | `when_to_use` hijacked release notes and dev servers | rewritten |
| 9 | bare `node` fails in a GUI-launched app | the installer writes the interpreter's absolute path |
| 10 | no `PARALLEL` field; a false claim about where a downgrade is visible | field added; the ledger records the model actually used |
| 11 | every dispatch pulled 11 KB of `contracts.md` to copy a 4 KB template | `assets/packet.md` |
| 12 | the SubagentStop payload was documented, never observed | observed and recorded in `hosts.md` |

One claim of its own was wrong: it said this very return would never be saved.
The ledger saved it and moved the row, because the stop's `cwd` was the repo
even though the session's was not. Its line numbers had also moved, because the
checkout advanced while it read.

Tests went from 98 to 136, and the two scripts that had no coverage at all,
`run-init.mjs` and `install-agents.mjs`, now have theirs. `smoke.mjs` stays
untested on purpose: it exists to spend a little provider quota, so a test
would spend quota on every run.

One plan item is declined rather than built: the optional PreToolUse(Bash)
filter that would append a failures-only tail to test runners. Appending a pipe
replaces the runner's exit status with the filter's, so a failing gate would
read as passing; rewriting a user's shell command to save a few hundred tokens
is not worth that failure mode. `evaluation.md` §2 already has the orchestrator
write the filter itself, in the command it runs.

### Left for Josh

1. **The five loading checks** in the README, in one fresh desktop session.
   They need a session this build cannot open, and they are the only claims in
   the README that a test does not already cover.
2. **A real orchestration**, then `measure.mjs --latest`. Until then the
   efficiency numbers in the plan's section 2a are reasoned estimates from
   documented figures, not measurements. The script is ready and free.
3. **`subagent_type: fork`** is documented but absent from this session's agent
   list. `lanes.md` marks the fork rung "documented, unverified here". One
   one-line haiku dispatch would settle it.
4. **Dynamic workflows** are not exposed as a tool here, so the skill hands
   Josh the one-line prompt to type. Re-check after a desktop update.

### Not built, on purpose

The Haiku per-turn classifier (Josh chose off; the mechanism does not exist:
a `type: prompt` hook on `UserPromptSubmit` can only return ok/reason).
Baseline-versus-skill metered sessions, the skill-creator eval loop, and a
dogfood goal: Josh's own use is the dogfood.

## v0.3.0 and earlier — 2026-09-08

Repo skeleton, references, six role agents, the RUN.md template, the first
scripts, SKILL.md, a cold-reader pass (15 findings applied) and a
fresh-context Fable audit (17 findings, the mechanical ones applied).
Deliberately not applied then: a per-run absolute Fable cap (a per-day cap in
the hook replaced it), moving the task table out of RUN.md, and marking every
host assumption unverified line by line.

Pickup prompt: v0.6.0 is tagged. Nothing is open. Two things are unverified
because they need a fresh session: whether the plugin actually installs from
the marketplace, and whether the router card appears on a first prompt.
Pickup confidence: high
Resume risk: none
