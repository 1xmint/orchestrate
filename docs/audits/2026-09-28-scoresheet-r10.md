# Scoresheet audit, round 10 (2026-09-28)

- Commit: `56d037a` (branch `audit/scoresheet-to-ten` when the packet was cut). Track H: `git log --oneline -3 audit/scoresheet-to-ten` shows `02f1fe5 Merge task/0083-role-model` and `4ec4fd2 Price a role dispatch that names no model on the role's own model` above `56d037a`; `git branch --list "task/0083*"` is empty. **0083 merged**, so areas 2 and 10 and the track-E row are scored at the merged tip `02f1fe5`, probed from a read-only `git archive` of that tip under the OS temp dir. Everything else is identical between the two commits except the six files 0083 touched (`guard-agent.mjs`, `hooks.test.mjs`, `lib/spend-gate.mjs` + test, `lib/workers.mjs` + test; +107/-18).
- Plugin: 0.16.1. Claude Code: 2.1.274; node v24.14.0; Windows 10 Home 10.0.19045.
- Auditor: Claude Fable 5.1, no repo install, no staged sessions; hook scripts fed sample payloads on stdin from three probe scripts (`<tmp>/r10audit/probe.mjs`, `probe2.mjs`, `probe3.mjs`) with HOME and USERPROFILE pointed at fresh temp folders (`profile.json` = `{"tier":"pro"}`, empty `ANTHROPIC_API_KEY`, `CLAUDE_PLUGIN_ROOT` = the audited worktree or the tip export, `CLAUDE_CODE_AUTO_COMPACT_WINDOW` cleared unless the step sets it), plus a scanner (`scan.mjs`) over the two `--debug-file` captures the lead recorded in the Addendum (`s0b.debug`, `s4b.debug`).
- Prompt: `docs/scoresheet-audit-prompt.md` (current for v0.16.1). Rounds 1-9 scored 49, 55, 68, 72, 74, 81, 87, 85, 84. None is a prior; every area is scored from evidence this round produced or the named documents record.
- Commits since round 9: `466e24b..02f1fe5`, 19 commits, 32 files, +1,341 / -70. The seven wave-11 mechanisms, one line each: (A) 0074 checkpoint ask from growth, once after compaction, window from env/settings; (B) 0075 verb-list not-committed claims, names-all-paths bypass, "resend the whole report" sentence; (C) 0076 Stop holds once for a promised review, review words read the objective only; (D) 0077 worktree clean-up chain allowed, DONE means committed and clean (text); (E) 0078 solo/helper pair on the first implementer dispatch, completed by 0083 (role model from the agent file); (F) 0077's agent-file text; (G) 0079 card without role names, two live-runs sentences corrected. Then 0081 the live-runs r10 report and its Addendum (debug capture of runs 0b and 4b).

## How to read the evidence

- **[measured]** - a command this auditor ran at 56d037a (or at the 02f1fe5 export where the row says "tip"); commands and outputs under "Commands run".
- **[live r10]** - the lead's five headless runs at 03049ee plus the Addendum's two debug-captured runs (0b, 4b), `docs/audits/2026-09-28-live-runs-r10.md`.
- **[debug r10]** - a line grepped from the Addendum's `s0b.debug` / `s4b.debug` captures, which show hook output that stream-json cannot.
- **[live r9]** - the lead's five runs at cbad2b5, `docs/audits/2026-09-28-live-runs-r9.md`.
- **[read]** - read from source with a file:line; never worth more than a 6 on its own.
- **[docs]** - the Claude Code prompt-caching page and hooks page fetched 2026-09-28, each quote checked against the page before use. **[docs scan]** - `research/2026-09-28-claude-code-docs.md`.

**No live run this round by the auditor.** The one permitted headless run (`--max-budget-usd 10 --model sonnet`, throwaway repo, plugin dir pinned at 03049ee) was skipped, deliberately: the Addendum's two debug captures already show what a sonnet run at 03049ee prints from every hook, the pinned dir lacks 0083 so the one thing a new run could add (a price tag seen live) would not appear, and the post-compaction timing question was settled more exactly by a probe than a run could. The budget went to probing the seven mechanisms with sample stdin. **Eval results remain unmeasured on this machine** (`claude plugin eval` has no sandbox backend here). **Uninstall is unmeasured.** **Model prices were not re-fetched**; round 8's check stands.

## 1. Score table

Rule: no score above 6 without a measurement of my own; no score above 8 without naming what a 10 needs (section 3).

| # | Area | Score | Evidence (class in brackets) |
| --- | --- | --- | --- |
| 1 | Delivery | 9 | [live r10] with/without pair on one prompt: with plugin 562 s $2.21, 3 capped implementers, 3 `general-purpose` refused; without 167 s $0.93, 3 unguarded helpers; both left the app uncommitted. Addendum 0b (after the DONE-means-committed text) committed `766a888`, 4b committed `5216f7d`. Hidden spec 4 of 4; twelve meetings 12 of 12. [measured] a `general-purpose` dispatch with no model is denied (340 B), an opus implementer denied (523 B). Not better on a named check than run 5; a person judging the page not available. |
| 2 | Cost (tip) | 9 | [measured, tip] first `orch-implementer` dispatch with no model: 420 B allow, "price tag: orch-implementer on sonnet ≈ $1.50 at list price ... ≈ $0.60 done in this chat (measured ratio over five live rounds)", ledger row model `sonnet`. At 56d037a the same input printed 224 B with no tag (the Addendum's rank-1 defect). [debug r10] 0b: 0 price-tag lines, so the pair has never been seen live. Second dispatch in a session prints the tag without the pair (366 B). |
| 3 | Recovery | 8 | [measured] fresh-timestamp readings: 81,000 → 198-B fact line; **119,904 with a 38,904 delta → 339-B ask** (round 9's missed case); 60,000 → 105,000 → ask; 100,000 → 112,000 → none; 158,000 → 252 B "compaction will summarise without a checkpoint". [debug r10] 4b: asks at ~120k, ~117k (compacted 1×), ~118k (compacted 2×); "just summarised" once, after compaction 2 only; **"newest checkpoint: none" on all 24 context lines** - four asks, zero checkpoints written. [measured] the post-compaction ask fires only on a provisional reading (probe3: 413 B when the hook samples before the first response, 212 B and no ask when a response already follows the boundary). |
| 4 | Safety | 9 | [measured] `git worktree remove <.claude/worktrees/worktree-agent-abc123> && git branch -d worktree-agent-abc123` silent in auto, default and helper modes (`;` and `--delete` forms too); `--force` + `-D`, a path outside `.claude/worktrees`, the chain plus `rm -rf uploads`, bare `-D`, `xargs git branch -D` → deny 314 B / ask 272 B / helper deny 268 B; `taskkill //F //IM node.exe` and `git push origin --delete old` ask/deny by mode; `rm -rf uploads && git push` silent everywhere; empty or malformed stdin 0 B exit 0. [live r10] run 3 ran live; runs 0 and 3 still left `worktree-agent-*` branches, and the lead's clean-up in run 3 used `--force; -D` and was refused. [debug r10] 0b: no `worktree remove` at all. |
| 5 | Communication | 9 | [measured] four not-committed wordings including run 1's "did not touch, add, or commit notes.txt" → 0 B; "Everything is committed." over an untracked file → 255-B block naming the file and ending "Resend the whole report; it becomes what the user sees."; naming every dirty path → 0 B; a repeat of the same claim → 0 B. Review hold: 477-B block on Stop after a tagged task returned unreviewed, 0 B after a `REVIEW OF` dispatch or a skip sentence, **0 B when no run ledger is bound**, while the "this task will wait for an independent review" sentence (589 B) prints either way. Card: zero role names, zero dollar figures. |
| 6 | Onboarding | 9 | [measured] fresh HOME, first big prompt: 2,886-2,977 B card plus an install line (224 B), autocompact tip (215 B), brief-missing note (247 B); second prompt 0 B; "continue" 316 B; files written under the fresh HOME only (no `settings.json`). [live r10] five runs, zero questions asked. Uninstall not measured. |
| 7 | Context | 9 | [measured] card core to "Mute this card" 2,196 B / 385 words, no role names; whole first-prompt payload 2,886-2,977 B (scenario-1 prompt 2,509 B); helper prompt 0 B; 40 quiet PostToolUse calls at 20k → 0 B, 74 ms avg; after-compaction card 3,070 B on `SessionStart:compact` [debug r10] 4b delivered it twice. |
| 8 | Hooks | 9 | [measured] 10 leaf entries, 9 scripts, 5-15 s timeouts; turn-check 63 ms, ledger 83, guard-agent 91, persist-check 103, guard-bash ~65; `postcompact-check` prints 0 B on a synthetic boundary (as round 9), the compact card arrives through `SessionStart:compact` instead. 928 pass / 0 fail at 56d037a; at the tip export 933 pass / 2 fail, both from the export itself (`package.test` wants a built artifact; the PowerShell hook-process test passes 55/0 in the worktree and `guard-bash.mjs` is untouched by 0083). Round 9 finding 2's false block is gone. |
| 9 | Triggering | 8 | [read] three evals with graders; [live r10] the skill fired on all five prompts. Grader not runnable here. |
| 10 | Routing (tip) | 9 | [measured, tip] the printed pair (row 2); opus implementer denied; reviewer on sonnet denied 358 B; nested dispatch with `agent_id` denied 223 B; researcher on sonnet tag only 234 B. "contract" in the objective → `review:true, reviewInferred:"contract"`; a WHERE line naming "the main checkout" no longer tagged (round 9 finding 3's word match fixed); reviewer with `REVIEW OF: 9-9-0031` → ledger row `reviewOf`. |
| 11 | Packets | 9 | [measured] `orch-implementer.md:47-48` and `orch-debugger.md:34-35` say DONE means committed; `packet.md:52` WHERE line present; a DONE-tagged return on a review-tagged task is recorded `PARTIAL, reviewGated:true`. [live r10] 0b and 4b committed; run 3 (before the text) left the helper's work in its worktree. No mechanical downgrade for a dirty worktree. |
| 12 | Agents | 9 | [measured] two-worker limit and four-way pairing unchanged (round 9 probes not rerun; guard-agent untouched on that path); `roleModel()` reads `model:` from the agent file (tip). Limit of 2 still unjustified by a number. |
| 13 | Tests | 9 | [measured] 928/0 in 30.7 s at 56d037a; 933/2 (export-only failures) at the tip; 28 lib modules, 28 lib tests. Eval not runnable here. |
| 14 | Currency | 9 | [docs] prompt-caching page: "Subagents fall outside the main-conversation TTL bucket, so they get five minutes even on a subscription until you choose a longer one."; `promptCacheTtl` / `subagentPromptCacheTtl` need v2.1.242+, frontmatter `cacheTtl` v2.1.248+. Hooks page: PreCompact "Before context compaction", matchers `manual`/`auto`; PostCompact "After context compaction completes"; SubagentStart listed. [docs scan] marks cacheTtl and SubagentStart CONFIRMED and `Agent(name)` REFUTED. CHANGELOG not fetched. |
| 15 | Docs honesty | 9 | [live r10] the report says stream-json cannot show hook advice and records the rank-1 defect against its own commit; the two round-9 sentences were corrected (0079). [measured] the Addendum's "no price tag" claim reproduces at 56d037a and is fixed at the tip. |
| 16 | Maintainability | 10 | [measured] `turn-check.mjs` now holds one rule a probe shows (477-B block, 0 B on the retry); 28 lib modules with 28 tests; a lib change (0083) came with tests in the same diff; `ledger.mjs --lint` unchanged. |

## 2. Weighted total

Areas 1-6 double, 7-16 single.

- Double: 9 + 9 + 8 + 9 + 9 + 9 = 53 → ×2 = 106.
- Single: 9 + 9 + 8 + 9 + 9 + 9 + 9 + 9 + 9 + 10 = 90.
- Sum 196 of 220 → **89 / 100** (round 9: 84).

## 3. For each area under 10: what a 10 needs, and whether it is reachable on this machine

- **1 Delivery (9).** A 10 needs the with-plugin run better than the without run on a named check at the current commit (0b committed where run 0 did not, but no paired without-run exists after the text change), and a person opening the page. Half reachable here (one paired run); the person is not.
- **2 Cost (9).** A 10 needs the printed pair seen live once and within 50% of the stream total. Reachable here with one run at a plugin dir that includes 0083. A bill-read figure is not a hook's to know.
- **3 Recovery (8).** A 10 needs a checkpoint file whose modification time is before a `compact_boundary` in a run like twelve meetings. Four asks in 4b produced none; an ask alone will not reach 10. Reachable here by mechanism (section 4 item 1).
- **4 Safety (9).** A 10 needs one live run where the unforced clean-up chain is used and no `worktree-agent-*` branch is left. Reachable here.
- **5 Communication (9).** A 10 needs the review promise kept whether or not a run ledger is bound, or not made. Reachable here.
- **6 Onboarding (9).** A 10 needs uninstall measured on a throwaway home and a person's minutes to first result. The first is reachable here; the second is not.
- **7 Context (9).** A 10 needs the whole first-prompt payload under 2,500 B in a fresh home and the after-compaction card skipped when a checkpoint exists. Reachable here.
- **8 Hooks (9).** A 10 needs the post-compaction ask to fire on a measured first reading as well as a provisional one, and `postcompact-check` to do something a probe shows or go. Reachable here.
- **9 Triggering (8).** A 10 needs the `skill-fired` grader run. Not reachable here.
- **10 Routing (9).** A 10 needs the pair seen live and the review tag enforced without a ledger. Reachable here.
- **11 Packets (9).** A 10 needs a DONE return from a dirty worktree downgraded mechanically. Reachable here.
- **12 Agents (9).** A 10 needs the limit of 2 justified by a measured number. Reachable here (one run at 2, one at 4).
- **13 Tests (9).** A 10 needs `claude plugin eval` run. Not reachable here.
- **14 Currency (9).** A 10 needs the CHANGELOG fetched and the hooks page's PreCompact input fields confirmed. Reachable here.
- **15 Docs honesty (9).** A 10 needs the live-runs r10 report's run-3 test-count discrepancy (37 claimed, 36 shown) resolved in the text. Reachable here.

Cannot reach 10 on this machine: **1** (a person judging the page), **6** (a person's minutes), **9** and **13** (no eval backend), and **2**'s bill-read figure. Every other area is reachable here.

## What works (a fix must not break)

- The guard-bash mode matrix, now including the unforced clean-up chain as silent and every forced or out-of-tree variant as ask/deny by mode.
- The dispatch rules: model named for `general-purpose`, opus floor for the reviewer, shared-checkout refusal, nested dispatch refused, the price tag on every role dispatch (tip).
- The commit-claim check: four not-committed wordings 0 B, a false claim blocked once with the file list, names-all-paths bypass, 0 B on a repeat and in a helper.
- The context notice: fact line, growth-aware ask, 0 B when quiet at 74 ms, nothing written outside the given HOME.
- The one-line "continue" handoff (316 B) and the 0-B second-prompt card.
- 928/0 tests; 28 lib modules, 28 tests; `ledger.mjs --lint`.

## Wave-11 verification table

Round 9's Part C items (C1-C5), top five (T1-T5) and findings (F1-F6), each against the mechanism that landed.

| Round 9 asked | Mechanism landed | Proof | Verdict |
| --- | --- | --- | --- |
| C1 / T1 / F1: ask when reading + last growth would cross the mark; ask once after compaction | (A) `lastDelta` in `lib/context-advice.mjs`; "just summarised" ask once per epoch; window from env/settings | [measured] 119,904 with delta 38,904 → 339-B ask (0 B in round 9); 105,000 after 60,000 → ask; 112,000 after 100,000 → none. [debug r10] 4b asks at ~120k, ~117k, ~118k. Post-compaction: probe3 413 B on a provisional reading, 212 B and no ask when the first response already follows the boundary; 4b fired after compaction 2, not 1. | **Does what F1 asked** for the band. The post-compaction half fires only when the hook samples before the lead's first response - a race, not a rule. Outcome unchanged: zero checkpoints in 4b. |
| Window override (round 9 run 2: "~200k under a 100k override") | (A) `resolveAutocompactWindow` | [measured] env 100000: "~90k of ~100k · next: autocompact ~100k" displayed; 82k with delta 39k → fact line only; 95k with delta 5k → 0 B; 110k → "~110k of ~100k · next: compact ~150k". settings.json window 120000 displayed likewise. | **Display honoured, thresholds not**: `checkpointAt`/`compactAt` stay at 120k/150k above a 100k window, so a user with the override is never asked before the host compacts. |
| C5 / T2 / F2: verb-list not-committed claims; never let the retry replace the report | (B) `NEG_STEM`/`CLAIM_VERB`, `namesAllPaths()`, `RESEND_NOTE` | [measured] "did not touch, add, or commit notes.txt" → 0 B; false claim → 255 B ending "Resend the whole report; it becomes what the user sees."; naming one of two dirty files → block listing both; naming both → 0 B; clean tree → 0 B; only `.orchestrator/` dirty → 0 B. Naming `src/notes.txt` when status shows `src/` → still blocks (250 B). [debug r10] 0b: four Stop successes, no block. | **Does what F2 asked.** The "retry replaces the report" half is a sentence in the block, not a mechanism; no live r10 run triggered a block, so it is unproven live. One false block remains for an untracked directory named by a file inside it. |
| C4 / T3 / F3: hold the finish for the promised review, or stop promising; fix the WHERE-line "checkout" tag | (C) `reviewGated` row in `ledger.mjs`, `reviewOf` on the reviewer dispatch, `reviewHoldDecision` in `turn-check.mjs`, `SKIP_EXPLAINED`; review words read the objective only | [measured] with a bound run: Stop #1 → 477-B block "task 9-9-0051 was tagged for independent review; it returned done with none sent. Dispatch orch-reviewer with REVIEW OF: 9-9-0051, or tell the user it was skipped and why."; Stop #2 → 0 B; after `REVIEW OF` → 0 B; skip sentence → 0 B; untagged DONE → 0 B. **Without a bound run → 0 B** while the promise sentence still prints (589 B). WHERE "the main checkout" → no tag. [debug r10] 0b: no ledger bound, no `will wait`, hold never reached. | **Does what F3 asked only under a bound ledger.** `turn-check.mjs` returns before the hold when `sessionRun()` is null, and the promise is made whether or not a ledger exists, so the round-9 case (run 0, no ledger) would still promise and not hold. |
| C2 / T4 / F4: allow the unforced clean-up chain; downgrade a DONE return with a dirty worktree; name a left listener | (D) `WORKTREE_CLEANUP_CHAIN_RE` in `guard-bash.mjs`; (F) DONE-means-committed text in two agent files; no listener rule | [measured] the chain silent in three modes (absolute path, `;`, `--delete` too); `--force`/`-D`, a path outside `.claude/worktrees`, a chained `rm -rf` → ask/deny. [read] `orch-implementer.md:47-48`, `orch-debugger.md:34-35`. [live r10] 0b and 4b committed; run 3 (pre-text) did not. [debug r10] 0b: 0 `worktree remove` lines. | **F4 done by mechanism.** The dirty-worktree downgrade landed as text, not a check; two committed runs are consistent with it and prove nothing about the case it guards. Listener rule not landed. The chain has not been used live. |
| C3 / T5: print the solo estimate beside the helper estimate | (E) `priceTagPair` on the first implementer dispatch with no ledger; 0083 `effectiveModel()` → `roleModel()` | [measured] 56d037a: sonnet implementer → 432 B with pair; no-model implementer → 224 B, no tag (Addendum rank-1). [measured, tip] no-model implementer → 420 B "≈ $1.50 at list price ... ≈ $0.60 done in this chat (measured ratio over five live rounds)", row model `sonnet`, `modelFrom: role`. [debug r10] 0b: 0 price tags. | **Does what T5 asked at the merged tip**; at 56d037a it did not for the dispatch shape the lead actually sends. Not seen live yet. |
| Round 9 "what a 10 needs" for Context: card under 2,500 B, no role names | (G) role names dropped from the card | [measured] zero role names, zero dollar figures; core 2,196 B; whole payload 2,886-2,977 B (fresh-home extras included); scenario-1 prompt 2,509 B. | **Names gone; size not reached** on the whole payload. |
| F5: WHERE optional, refusal text silent about it | none in wave 11 | [read] `packet.md:52` WHERE line present. Refusal wording not re-probed. | **Not addressed** (not verified this round). |
| F6: `Agent(name)` scoping refuted | docs scan marks REFUTED | [docs scan] item struck; [docs] hooks page lists SubagentStart and PreCompact. | **Done in the docs.** |

## 4. Top five changes, ranked by felt gain per effort

1. **Write the checkpoint at compaction by mechanism, and prefer before to after** (areas 3, 8, 5; M). Four asks in 4b and no file. The Addendum's item 2 (write it at `SessionStart:compact` from the transcript) is the after-half; the hooks page lists a `PreCompact` event with `auto`/`manual` matchers and the transcript path in its input [docs], which is the before-half - a script that reads the last user turn, the last edited paths and the last test result from the transcript and writes them to `context/<id>/checkpoint-<id>.md` before the summary exists. `hooks-registered-once.test.mjs:89` rejects PreCompact because "a PreCompact block reaches nobody under autocompact"; a write reaches the disk. The user notices: after a compaction the lead's next line is the goal and the next step, from its own file.
2. **Fire the post-compaction ask on a measured first reading too** (areas 3, 8; S). probe3 shows the ask depends on the hook sampling before the first response; key it on the compaction count rising since the last notice instead. The user notices: every compaction is followed by the same one ask.
3. **Hold the review promise without a ledger, or promise only with one** (areas 5, 10, 11; S). Either `turn-check.mjs` reads the session's dispatch rows for a review-tagged DONE when no run is bound, or the "will wait" sentence is printed only when `sessionRun()` is set. The user notices: "will wait for a review" is followed by a review in the runs that never open a ledger, which is most of them.
4. **Scale the thresholds to the window** (areas 3, 8; S). With `CLAUDE_CODE_AUTO_COMPACT_WINDOW=100000` the meter says "next: autocompact ~100k" and asks for nothing before it. The user notices: the override they set is the one the ask respects.
5. **Downgrade a DONE return from a dirty worktree, and use the chain live** (areas 11, 4; M). `ledger.mjs` has the worktree path on the row; a `git status --porcelain` there at SubagentStop turns DONE into PARTIAL with the file list. Then one run where the lead runs the unforced chain. The user notices: no work stranded in a folder they never open, no stray branch.

## 5. Scenario results

[live r10] at 03049ee (plugin identical to 56d037a on every path probed except the 0083 files), five headless runs plus two Addendum captures, `--max-budget-usd 10`, sonnet, throwaway repos.

| Run | Finished | Questions | Seconds | Cost | Helpers | Machinery leaked |
| --- | --- | --- | --- | --- | --- | --- |
| 0 delivery with plugin | yes; 21 files staged, not committed | 0 | 562 | $2.21 | 6 attempts, 3 `general-purpose` refused, 3 implementers | none in the final message; 3 `worktree-agent-*` branches left; no price tag printed |
| 5 delivery without plugin | yes; left untracked | 0 | 167 | $0.93 | 3 native `general-purpose`, uncapped | n/a |
| 2 hidden spec | yes, committed; 4 of 4; 25 tests | 0 | 187 | $1.01 | 0 | none |
| 3 one helper | yes, committed; 36-37 tests (count discrepancy) | 0 | 337 | $1.10 | 1 implementer, capped at 20, resumed via SendMessage | one branch and `.claude/worktrees/` left; forced clean-up refused |
| 4 twelve meetings | yes, committed; 12 of 12 | 0 | 185 | $1.69 | 0 | two automatic compactions, no checkpoint |
| 0b (Addendum, debug) | yes, committed `766a888` | 0 | 791 | $2.91 | 3 refused, 3 implementers | no ledger bound; 0 price tags; 9 PROGRESS warnings |
| 4b (Addendum, debug) | yes, committed `5216f7d`; 12 of 12 | 0 | 151 | $1.56 | 0 | two compactions; four checkpoint asks, none answered |

Total $11.41 across seven, no run near the cap.

## 6. Verdict

At 56d037a, with 0083 merged at 02f1fe5, the plugin does by measurement everything round 9 asked of it as a printed line: it asks for the checkpoint before a turn can jump the band, and once more after a compaction when it gets there first; it reads "did not touch, add, or commit" as the truth it is and blocks only a false claim, naming the files and asking for the whole report back; it holds the finish once for a promised review when a run is open; it lets the helper's worktree and branch go in one unforced command and still asks before anything forced; it prints, on the first helper, what the helper costs and what the same work costs in this chat; and its card carries no role name. What it only claims: that any of these lines changes what happens next. The two debug captures are the honest measure - four checkpoint asks and no checkpoint, a promise mechanism that was never reached because no ledger was open, a price pair that did not print for the dispatch shape the lead sends (fixed at the tip, unseen live), a clean-up chain never run. Round 10 is the round the mechanisms landed; the score moves from 84 to 89 on the mechanisms, and the last eleven points wait on outcomes.

## Part C: what would change what the plugin can do

Judged against AGENTS.md "What this is for" and the three aims: the lead managing helpers well, spending as little main context as possible, and the main chat thinking clearly across a long task.

**Mechanisms that landed but do not do what the finding asked, first.** (1) The post-compaction ask (A) depends on a race: it fires on a provisional reading only, so it fired after 4b's second compaction and not its first; the finding asked for once after every compaction. (2) The review hold (C) is unreachable without a bound run ledger, while the promise is printed regardless; the round-9 case (run 0, no ledger) is exactly the case it does not cover. (3) The window override (A) is displayed and not enforced: under a 100k window the ask never comes. (4) The dirty-worktree downgrade (C2 rule 1) landed as a sentence in two agent files, not as a check. Everything else in the table does what it was asked to do.

Per area under 10, the smallest change or "unreachable here":

- 1 Delivery: one paired run (with/without) after the DONE text, on a plugin dir that includes 0083; the person's judgment is unreachable here.
- 2 Cost: one live run showing the pair; the bill-read figure is unreachable anywhere.
- 3 Recovery: item 1 above (PreCompact write); item 2 (measured-reading ask) and item 4 (window thresholds) as the small halves.
- 4 Safety: one live run where the unforced chain is used and nothing is left.
- 5 Communication: item 3 (hold without a ledger, or no promise without one).
- 6 Onboarding: measure uninstall on a throwaway home; the person's minutes are unreachable here.
- 7 Context: skip the 3,070-B compact card when a checkpoint exists; trim the fresh-home extras so the whole first payload is under 2,500 B.
- 8 Hooks: item 2; delete `postcompact-check.mjs` or give it the write from item 1.
- 9 Triggering: unreachable here (no eval backend).
- 10 Routing: item 3; one live run with the pair.
- 11 Packets: item 5.
- 12 Agents: one run at a limit of 2 and one at 4, and record the number.
- 13 Tests: unreachable here (no eval backend).
- 14 Currency: fetch the CHANGELOG and the PreCompact input schema.
- 15 Docs honesty: resolve the run-3 test-count line.

**Blunt answer to "is anything groundbreaking left".** One thing, and it is the Addendum's item 2 made whole. Everything else in this round's list is polish: races, a null check, a threshold, a status check - repairs that make the plugin keep its word more often without changing what it can do. Item 2 as written (the plugin writes a checkpoint at `SessionStart:compact` from the transcript) is a patch: at that moment the summary already exists, and a file written from it is the host's summary copied to disk, which survives a restart (a real gain for "pick it up tomorrow") but adds nothing the summary did not keep for the third aim, thinking clearly across a long task. Its context cost per compaction is small if the file is not injected: one line naming the path (about 100 B) on top of the 3,070-B card that already arrives; if the card is skipped when the file exists, the net is a saving. The leap is the before-half: a `PreCompact` write [docs: "Before context compaction", matchers `auto`/`manual`] that records the goal line, the last edited paths and the last test result from the transcript before the summary replaces them. 4b shows why: four asks, zero files. The lead does not write checkpoints when asked; the plugin has to. Cost S-M (one script, the transcript reader already exists in `lib/context-advice.mjs`), context cost zero at write time, and the test at `hooks-registered-once.test.mjs:89` needs its reason changed from "a block reaches nobody" to "a write does".

**What carries its weight least.** `postcompact-check.mjs` (0 B on every synthetic boundary in two rounds, and the compact card arrives through `SessionStart:compact` instead); the "will wait for an independent review" sentence printed when no ledger can hold it; the after-compaction card re-sent in full when the lead has a checkpoint; and the round-9 items still true: README length, the two references files never sent by the body.

## Part B: borrow list

From [docs] fetched today, each quote checked on its page: `subagentPromptCacheTtl` (v2.1.242+) is real, and subagents "get five minutes even on a subscription until you choose a longer one" - a settings value the plugin must not write, but the card's install line could name it once for a user who sends many helpers; `SubagentStart` is listed with the agent type as matcher - a ledger row opened on start would let the two-worker count and the price pair be exact rather than inferred from PreToolUse; `PreCompact` with `auto`/`manual` matchers - item 1 above. Not taken: `Agent(name)` scoping (refuted, round 9 finding 6, now struck in the scan).

## Currency facts fetched

- Prompt caching page, 2026-09-28: "Subagents fall outside the main-conversation TTL bucket, so they get five minutes even on a subscription until you choose a longer one."; "Both settings and both environment variables require Claude Code v2.1.242 or later."; keys `promptCacheTtl` / `CLAUDE_CODE_PROMPT_CACHE_TTL`, `subagentPromptCacheTtl` / `CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL`; frontmatter `experimental.cacheTtl` needs v2.1.248+; plugin skills, agents and hooks do not invalidate the cache.
- Hooks page, 2026-09-28: PreCompact "Before context compaction", matchers `manual` and `auto`; PostCompact "After context compaction completes"; SubagentStart "When a subagent is spawned", matcher = agent type. The PreCompact-specific input fields are not given on the page beyond the common ones (`session_id`, `transcript_path`, `cwd`, `hook_event_name`, ...).

## Commands run

All from `<repo>` (the audited worktree at 56d037a) or the tip export `<tmp>/orch-audit-r10-tip` (`git archive 02f1fe5 | tar -x`), with HOME and USERPROFILE at fresh folders under `<tmp>`; every probe deletes nothing and writes only under its own folder.

- `git log --oneline -3 audit/scoresheet-to-ten`; `git branch --list "task/0083*"` (empty); `git diff --stat 56d037a..02f1fe5`; `git log --oneline 466e24b..02f1fe5` (19).
- `node scripts/test.mjs` at 56d037a: 928 pass, 0 fail, 30,668 ms. At the tip export: 933 pass, 2 fail (`package.test` "orchestrate.skill is built"; guard-bash "a PowerShell tool call is recognised by the hook process" - passes 55/0 in the worktree; `guard-bash.mjs` not in the 0083 diff).
- `node probe.mjs <repo>` and `node probe.mjs <tip>`: sections A (guard-agent: 11 dispatch shapes), B (review hold: ledger + Stop with and without a bound run), C (commit-claim: 10 wordings), D (guard-bash: 14 commands × 3 modes + empty/malformed stdin), E (context-check), F (router card: 8 prompts, files written), G (postcompact-check, SessionStart compact).
- `node probe2.mjs`: E with now-relative timestamps (81,000; 119,904; 126,000; 158,000; boundary with and without a checkpoint; 60k→105k; 100k→112k; env window 100000 at 82k/110k; 40 quiet calls at 20k with timings); B with a bound RUN.md; F card byte counts and word counts.
- `node probe3.mjs`: post-compaction ask provisional vs measured; env window 100000 at 90k/95k; settings.json window 120000 at 95k.
- `node scan.mjs` over `s0b.debug` and `s4b.debug`: context lines, checkpoint asks, "just summarised", price tags, guard denials, Stop outputs, RUN.md mentions, `worktree remove`.
- WebFetch: the prompt-caching page and the hooks page (quotes above).
- Byte counts are the hook's stdout length; timings are `spawnSync` wall time on this machine.
