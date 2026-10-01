# 0005: What orchestrate works on next (2026-09-30)

## Answer

The next phase should re-aim orchestrate at what a vibe coder actually feels:
- a project that remembers where it stands across sessions;
- a plan the user can see and correct before quota is spent;
- bugs fixed at their cause, not guessed at.

It is measured by tests of those abilities against Claude with no plugin, not
by counts of the plugin's own machinery. It also removes, rather than refines,
the checks that guess what a command or message means from the words in it.
Those checks raised seven false alarms in the first live session on 0.17.2
(notes I, Q, T, U).

This shape comes from a from-scratch critique, read against the live notes. The
critique is in `research/9-30-0004-from-scratch.md`; its findings are labelled
F1–F8 below. The owner chose this shape on 2026-09-30, over an earlier draft that
only repaired the plugin's own checks. That draft's repairs are folded into
steps 2 and 3.

## How this was made

- Live notes A–U: `docs/audits/2026-09-30-live-session-notes.md`, written as
  things happened, each with the line the plugin printed.
- Three helpers. List prices come from `returns/returns.jsonl` in this run's
  folder.
  - `research/9-30-0001-method-rivals.md`: whole-method rivals. It covers only
    what changed since `docs/research/0001` §3 (2026-09-09). Sonnet, $0.52.
  - `research/9-30-0002-single-job-best.md`: the best plugin for each single
    job. Sonnet, $0.58.
  - `research/9-30-0004-from-scratch.md`: Opus 5.5 at high effort, asked whether
    a rebuild could do better. It formed its view from the code before it read
    the earlier draft. $1.84.
- The lead spot-checked each report against its source: three claims from each
  research report and four from the critique. All matched.
- The second-opinion advisor ran four times. The first two calls cost $1.22;
  the others were not measured.
- Outside repos' dates and licences come from `gh api repos/<r>`, run
  2026-09-30.
- Yardstick: the scoresheet's 16 areas
  (`docs/audits/2026-09-29-scoresheet-r11.md`), filtered by AGENTS.md "What this
  is for", "Always true" and "Not doing". Each step is tagged with the areas it
  moves. There is no full candidate-by-area table (see Decisions in the run
  ledger).

## 1. The plan, in order

Each step names:
- the failure it fixes;
- the evidence that shows it is done;
- a spending cap in list-price dollars.

The caps are set from this session's costs: a Sonnet helper on a bounded job
cost $0.52–$0.58, and an Opus deep read cost $1.84. A step that reaches its cap
stops and comes back with what it has. A change that loosens a check around
money goes to an Opus reviewer, and its pull request stays a draft until the
review passes.

| # | Step | Failure it fixes | Done when (evidence) | Cap | Areas |
|---|---|---|---|---|---|
| 0 | **Check two assumptions first.** (a) Does a file pulled into CLAUDE.md with one `@` line stay in view after compaction? (b) Can Claude Code's own permission "ask" rules cover the irreversible list: force-push or delete of a shared branch, publish, deploy? | Steps 2 and 4 rest on both, and neither has been verified (critique §6) | (a) A scratch repo whose imported file holds a marker still shows the marker after a forced compaction. (b) A scratch settings file asks before each action on the list. Each result cites the current docs. If (a) fails, step 4 re-shows the file through the existing after-compaction hook. If (b) fails, one small hook keeps the list | $1 | Recovery, Safety |
| 1 | **Ability tests against a no-plugin baseline.** Five cases. (1) An ambiguous request with one costly fork: did it ask about that fork, and only that? (2) A bug with a misleading symptom: did it name the real cause before editing? (3) A goal that contradicts the brief: did it push back? (4) A three-session project ending in "continue": did session three know session one's decisions? (5) A report after a failed check: did it say so? | The yardstick measures the plugin's own machinery, so releases improve machinery (F2). Nothing shows whether the plugin makes Claude better at the job | Each case has a written pass/fail rule, fixed before any run. Each case runs three times with the plugin and three times without. A case is graded by a model that did not run it, against that rule. The baseline is recorded before steps 2–5 change anything. If the cap allows only one run per arm, the result is reported as a hint, not proof | $10 | Delivery, Planning, Communication, Recovery |
| 2 | **Stop the misfires by removing checks, not refining them.** (a) The payment rule refuses only a payment tool that actually runs; the turn-end check drops its word list. (b) The "says committed" check compares `git status` with what the message actually claims, not with a word. (c) The first-helper check that reads the transcript goes; step 4 replaces it with a file check. (d) The dispatch check reads the brief file a prompt names, or says nothing. (e) Merge and pull-request wording inside text is no longer read as a merge | Seven false alarms in one session: four refusals in I, plus Q, T and U. A check that passed blind (K). A complete brief graded incomplete (R). Each false alarm costs a whole extra turn (F3) | Every refused or flagged line from this session is replayed as a test, and all now pass silently. Real cases still refuse: a payment tool run, a web call to a payment service, a brand word inside `bash -c "…"`, a force-push to main, a real merge command. The lines of check code removed are counted and reported. An Opus review passes before release | $5 incl. review | Safety, Communication, Cost |
| 3 | **Make the records right.** (a) A return joins its own dispatch by agent id. (b) An OUTCOME line with no status word is flagged. (c) When the ledger overrules a helper's status, it says so. (d) The checkpoint's test line comes only from a command that ran tests. (e) The gate finder reads CI files. (f) RUN.md takes the host from the profile. (g) `measure.mjs` prints the lead's and the session's dollars, and counts only dispatches that ran. (h) Helpers' size budgets count growth past their own first reading. (i) Roles with no Edit tool get no "since your last edit" line. (j) Wording fixes D, E and F | Returns saved with no task or status, silently (L). A status overruled with nothing said (S). A made-up test result (N). A gate asked of the user while it sat in a file (G, H). No dollar figure for the lead (P). Research helpers running out of room on big questions, and AGENTS.md:40-41 contradicting `context-check.mjs` (F7, D) | (a)–(c) Re-indexing this run's three returns links all three, with their statuses shown. (d) Replaying this transcript gives no test line. (e) `run-init` on this repo finds the ci.yml commands. (g) `measure.mjs` prints the lead's dollars and 3 helpers. (i) A read-only helper gets no edit count | $3 | Recovery, Cost, Documentation honesty, Onboarding |
| 4 | **A project file and a plan the user can see.** `.orchestrator/PROJECT.md`, at most 60 lines; a test fails past that. It holds: what the project is for (or a pointer to the brief); where it stands; the next 3–7 steps, each with what the user will be able to see or run; decisions, each with date, reason and what it costs if wrong (newest ten in full, older ones archived); open owner questions; and pointers to earlier research. It is pulled in by one `@` line, depending on step 0's result. The turn-end check holds once if tracked files changed and PROJECT.md did not. The first helper waits until the Next section is filled; this file check replaces the three-line message | No big picture across sessions, so the user re-explains and Claude re-derives (F1). The user sees who does the work, not what the work is (F4). Earlier research nobody brought up (M) | Ability tests 1 and 4 beat the baseline. The plugin's always-on context grows by no more than about 900 tokens, measured. goal.md, the handoff lookup and the three-line rule are retired or folded in | $6 | Recovery, Planning, Communication, Documentation honesty |
| 5 | **Diagnose first.** A four-line routine always in view for the lead: reproduce the bug; name its cause with evidence; fix that cause; show a test that failed before the fix. Fix reports read "cause: … evidence: …". The debugging helper stays for a second attempt | The first fix is a guess the user cannot tell from a diagnosis. The routine only runs inside an expensive helper, after a miss (F5) | Ability test 2 (misleading symptom) passes where the baseline failed. The always-on text grows by no more than 100 tokens | $2 | Delivery, Tests |
| 6 | **A README list of plugins to use alongside orchestrate.** The list is in §3 below. The same list goes in what `install-project.mjs` prints. Nothing is installed for the user, and nothing goes in the card. Any plugin that can bill an outside key carries that warning | The owner said yes on 2026-09-30. Users have no pointer to tools that cover what orchestrate deliberately leaves out | The README section exists, with each plugin's link and licence checked the day it is written | $0.50 | Onboarding, Cost |

Total cap: $27.50 list. Step 1's figure is the least certain, because each case
runs twice. It stops at its cap.

**Why this order.**
- Steps 0 and 1 come first, so the later steps can be shown to help, not
  assumed to.
- Step 2 is cheap, and stops the misfires felt today.
- Step 3 makes the records trustworthy enough to measure with.
- Steps 4 and 5 are the core of the re-aim, and the ability tests judge them.

**Not in this phase.** Each of these waits for an ability-test result:
- Slimming the helper machinery (F6). The coordinator and the Codex path would
  become opt-in, and the model tables would move out of the skill.
- Carrying the rules in one always-on place instead of three that repeat each
  other (F8).

They follow if steps 4 and 5 show the always-on layer can carry the method.

## 2. How it is measured

**The main measure** is step 1's ability tests: each scored with and without
the plugin, before and after the phase.

**Secondary measures** are counts read from files a run already writes, so they
need no helper.

| Area | Count | Source | This session (baseline) |
|---|---|---|---|
| Delivery | Tasks graded done with proof on the first attempt | RUN.md rows, `returns.jsonl` (needs step 3) | 3 of 3 by the lead's grading; 0 recorded correctly by the ledger |
| Cost | List dollars per finished task; context before the first real step | `returns.jsonl`; `measure.mjs` (needs step 3); the first size line | Helpers $0.52, $0.58 and $1.84; about 67k before the first step (C) |
| Recovery | After each compaction: was the next step right, and how many checkpoint fields were wrong | the checkpoint, the next turn | 3 compactions, each picked up the intended next step. Only the first checkpoint was graded: 3 of 5 fields wrong (N) |
| Communication | False alarms per session; silent drops; overruled statuses not said | guard notes, `returns.jsonl` | 7 false alarms; 4 silent null fields; 1 status overruled silently |

Target after the phase:
- The ability tests beat the no-plugin baseline on at least four of the five
  cases.
- No false alarms on the replayed lines.
- No silent drops.
- No made-up test line.

## 3. The comparison

Labels:
- **adopt**: take it in.
- **trial**: borrow the idea, and keep it only if its measure shows it helps.
- **alongside**: tell users it exists; they install it themselves.
- **leave**: not used.

Dates are the last push on GitHub, read 2026-09-30. Anthropic's plugins are
read from disk and have no git history, so they have no date.

### Ideas to trial

| Idea | From | Licence · last change | What it would fix | Measure to keep it | Areas |
|---|---|---|---|---|---|
| A script that walks the user through steps only they can do (secrets, dashboards, CI settings) | mattpocock/skills `wizard` | MIT · 2026-09-29 | Vibe coders stall on credentials and dashboards; today the lead just says "you'll need to…" | Next three runs that need a human-only step: did the user finish it without asking back | Onboarding, Safety |
| Decisions recorded with "cost if wrong" (built in as a field of step 4's project file) | superpowers "Rulings, not stalls" | MIT · 2026-09-27 (v6.4.2 09-25) | Decisions say what and why, not what a wrong call would cost | A resuming session reverses a decision correctly using that field | Documentation honesty |
| Score each review finding 0–100 and drop those under 80; a silent-failure checklist | code-review; pr-review-toolkit (Anthropic, on disk) | on disk, no date | Reviewers can return noise the lead must sift | Findings per review drop without a missed real fault on the next three reviews | Agents, Tests |
| Check that plan, tasks and done-when agree before building | spec-kit `analyze` | MIT · 2026-09-30 (v1.0.13 09-29) | Only needed if plans get long; none did this session | Trial only when a run has more than ten tasks | Delivery, Planning |

### Alongside: the README list (owner said yes, 2026-09-30; step 6)

| Plugin | Licence · last change | Job | Why alongside, not in | Cost to the user |
|---|---|---|---|---|
| ccusage | MIT per its repo text; GitHub field says NOASSERTION · 2026-09-30 | See usage by 5-hour block | Runs locally and reads Claude's own logs. orchestrate's `measure.mjs` covers one session, not the week | none beyond install |
| receipts (Anthropic) | on disk | A plain record of what shipped | Complements the ledger; no model cost | none |
| playwright MCP | Apache-2.0 · 2026-09-28 | Prove a web change works in a real page | No key needed. The browser helper uses whatever browser tool is present | quota per page read; its own docs say the CLI form is cheaper |
| chrome-devtools-mcp | Apache-2.0 · 2026-09-30 | Console and speed problems | No key needed | as above |
| claude-md-management (Anthropic) | on disk | Keep CLAUDE.md honest | A different job from the project file | small |
| security-guidance, model layer off (Anthropic) | on disk | A pattern check on every write | The pattern layer is free. The model layer makes one Opus call per turn, needs Python, and installs `claude_agent_sdk`. **It uses an API key if one is set** (`hooks/llm.py:484` uses the subscription only when no key is set), so it can bill outside the subscription. The README must say so | free with the model layer off; billed if a key is set |

### Leave

| Candidate | Licence · last change | Why |
|---|---|---|
| A read-only danger scan (oh-my-claudecode v5.4.0); security-guidance's pattern layer built into orchestrate | MIT · 2026-09-30; Anthropic, on disk | Both add word-matching checks, the kind of fault this session hit seven times (F3). security-guidance stays on the alongside list for users who want it |
| feature-dev (Anthropic) | on disk | Asks every question at fixed gates; orchestrate separates the owner's questions from engineering questions |
| ralph-loop (Anthropic) | on disk | Re-feeds the same prompt until a promise; burns quota by design |
| SuperClaude | MIT · 2026-09-27 | Always on; needs Serena MCP and a PyPI install |
| ruflo | MIT · 2026-09-30 | Heavy dependencies, recurring security fixes |
| BMAD-METHOD | MIT text · 2026-09-29 | Its mid-build re-plan is already in SKILL.md §1 |
| GSD | original archived 2026-05-31; successor open-gsd/gsd-core · 2026-09-30 | 0001's verdict stands |
| claude-task-master | NOASSERTION · 2026-04-28 | Needs an API key |
| compound-engineering | MIT · 2026-09-30 | A growing pile of lessons, which AGENTS.md "Not doing" rules out. Its "durable bar" (write nothing a reader could recover from the code) is worth one line in step 4's file guidance; no trial needed |
| claude-mem | Apache-2.0 · 2026-09-30 | A background service; the report says it falls back to your subscription after a trial (not verified) |
| claude-remember | NOASSERTION · 2026-09-30 | The report says it calls an API key for each summary and forbids redistribution (not verified) |
| serena | GitHub NOASSERTION; report says GPL-3.0 · 2026-09-30 | A separate server plus `uv`; built-in language servers and `map.mjs` cover the job |
| hookify, session-report, claude-code-setup (Anthropic) | on disk | Covered by orchestrate's own hooks, `measure.mjs` and `install-project.mjs`. claude-code-setup only gives advice; worth naming in onboarding, not installing |
| claude-security | proprietary | Run it when the user asks for a scan; not something to point every user at |

Where orchestrate is already ahead, per the rivals report (9-30-0001):
- choosing models with quota in mind, and asking before spending (superpowers
  only just added a cost line, in v6.4.1);
- a ledger on disk, with no outside server;
- separating the owner's decisions from engineering decisions;
- no pile of lessons.

## Sources disagreeing

- ccusage and serena: the research helper read MIT and GPL-3.0 from each repo's
  licence text, while GitHub's licence field says NOASSERTION for both. The
  label is the same either way.
- BMAD: MIT text in the repo, NOASSERTION in GitHub's field.
- K: after compaction, the lead's summary called the first-helper refusals a
  guard bug. The transcript shows the three lines were never written. The
  transcript wins.
- The earlier draft wanted to make the first-helper check say when it was blind,
  and to trial the danger scan and the secrets pattern check. The critique
  argued against all three. The owner sided with the critique.

## Not verified

- Whether a file pulled in with `@` survives compaction, and whether permission
  "ask" rules can cover the irreversible list. Step 0 checks both before
  anything rests on them.
- The plugin's own share of the ~67k context used before the first step; the
  critique's ~900-token figure for the project file is its estimate.
- Step 1's cost: five cases, each run twice, priced from this session's helper
  costs only.
- Why the third return was recorded as PARTIAL when it said DONE (S). The
  over-budget rule is the likely cause; it was not traced in code.
- The cause of K: the retry may be too short, or the text not yet on disk. A
  likely reading, not reproduced.
- Anthropic's on-disk plugins have no last-change date.
- claude-mem's subscription fallback, and claude-remember's API key and
  redistribution terms, come from the helper's reading; the lead did not open
  them.
- OMC's danger scan and superpowers' diagnosing skill: release notes only.
- Whether 0001's earlier change "cut over-verification rules" landed.
- The lead's own cost this session: `measure.mjs --tree` does not print it (P).
  Its counts: 78 lead calls, 12,256k input read, 56k written, 125 calls in all.

## Stop condition

This paper stops at the plan. Building starts with step 0. The phase stops when
any of these is true:
- steps 0–6 meet their done-when;
- the $27.50 total cap is reached;
- the owner says stop.

If step 0 disproves an assumption, the affected step uses the fallback named in
its row. Whatever is unmet goes into the next paper, with its measure.

## Owner decisions (2026-09-30)

- The phase is re-aimed at the project file, the visible plan, diagnose-first
  fixing and the ability tests, in the order above. This replaces the earlier
  draft, which only fixed the plugin's own checks.
- Yes to telling users about plugins that work alongside orchestrate. It is a
  short list in the README and in the install output. Nothing is installed for
  them, and nothing goes in the card. Any plugin that can bill an outside key is
  flagged.
