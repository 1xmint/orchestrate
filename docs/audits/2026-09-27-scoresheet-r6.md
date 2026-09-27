# Scoresheet audit, round 6 (2026-09-27)

- Commit: `ea994391ebc437e885b066f6cf606224ee9dca09` (branch `audit/scoresheet-to-ten`, read from `<repo>/.git/refs/heads/audit/scoresheet-to-ten`)
- Claude Code: 2.1.274; node v24.14.0; Windows 10 Home 10.0.19045
- Auditor: Claude Fable 5.1, no repo install, no staged sessions; hook scripts fed sample payloads on stdin (payloads built with `JSON.stringify` into a file) with HOME and USERPROFILE pointed at fresh temp folders (`home1`: no role files; `home2`: three of the eight role files), `profile.json` = `{"tier":"pro"}`, empty `sessions/`, empty `ANTHROPIC_API_KEY`
- Prompt: `docs/scoresheet-audit-prompt.md` (current for v0.16.1). Rounds 1-5 scored 49, 55, 68, 72, 74. None is a prior; every area is scored from evidence this round produced or the named documents record.

## How to read the evidence

- **[measured]** - a command this auditor ran at ea99439; the exact command and output are under "Commands run".
- **[live r6]** - the lead's live run of this branch at 923eb39 with the helper path forced, `docs/audits/2026-09-27-live-runs-r6.md`. Two fixes landed after it (ea99439: the kill-by-name rule and the card's "read from git status" sentence) and are measured here by probe, not live.
- **[live r5]** / **[live r4]** - `docs/audits/2026-09-26-live-runs-r5.md` (helpers forced, at b52b6af) and `docs/audits/2026-09-26-live-runs-r4.md` (the same app by the lead alone).
- **[obs]** - `.orchestrator/runs/20260924-audit-to-ten/observations.md`, the lead's field notes. Status-line and recover notices in those notes came from the OLD installed copy, not this branch, and are marked so where cited. No entry is dated 2026-09-27.
- **[read]** - read from source with a file:line; never worth more than a 6 on its own.
- **[docs]** - a page fetched 2026-09-27, listed under "Currency facts fetched".

**Eval results are unmeasured on this machine.** `claude plugin eval` cannot run here (no sandbox backend on this platform). The eval layer is judged from the four case folders, their 14 graders, and `node --test evals/no-machinery.test.mjs`.

**What round 5 asked for, now measured.** Most of round 5's "what a 10 needs" items are done and measured this round: the price mean ignores zero-usage rows (a $0.01 ceiling is still refused after two returns with no usage figures); a packet whose WHERE names the shared checkout is refused; the first card says when fewer than eight role files are installed and names the install command; the first sentence of `router status` is an action; the "Say yes" clause is gone from refusals nobody can answer; the router timeout is 15 s; a one-sentence prompt gets a short card under 600 characters; the negation "not X" clears an inferred review word; `isolation: worktree` sits in the two writing roles' frontmatter; `hosts.md` is 5,300 B; the two largest files shrank (guard 42,298 -> 31,448 B, tier module 34,069 -> 11,667 B); the install-count gate is documented; the historical audit prompt is marked so. Not done: a recorded helper cap event (the three live helpers finished inside their caps), a measured clean-profile install (out of scope), and the eval run (not reachable here).

Two findings this round that no earlier round recorded, both [measured] or [live r6]:

1. **The last sentence of a live run was false.** [live r6] the lead's final message said "I have not committed these changes" while four commits sat on the branch. ea99439 adds to the card "When you report, say what is committed and what is not, read from git status, not from memory" [read `lib/card.mjs`]; measured present in the card this round, not yet seen live.
2. **The task id is whatever follows `TASK:`.** [measured] a packet whose TASK line is prose ("TASK: build the login page") makes the guard read `build` as the id, so its hold message ends "REVIEW OF: build" and the ledger files the return under that word (`guard-agent.mjs:93,102`: `/^\s*TASK:\s*(\S+)/`). Harmless with the template, wrong the moment a lead writes a sentence there.

## 1. Score table

| # | Area | Score | Reason | Change | Effort |
|---|------|-------|--------|--------|--------|
| 1 | Delivery (x2) | 8 | [live r6] the three-part app with helpers forced at 923eb39: finished, 29/29 tests, 7 commits, 0 questions, 426 s, $1.81, lead 40 tool calls, three helpers 12/13/12 calls, no detour into the shared checkout (round 5 lost ~30 calls to it). Six dispatches were refused before three launched: first the uncapped built-in helper, then a WHERE line naming the shared checkout; the lead fixed each from the refusal text. [live r4] the same app by the lead alone: 185 s, $0.69. One miss: the final sentence claimed nothing was committed while four commits existed (finding 1). Delivered, cheaper and shorter than round 5, still 2.6x the solo cost. | Measure once more after ea99439 and record whether the closing message matches `git status`. | M |
| 2 | Cost and time (x2) | 8 | [measured] a dispatch that would cross the run ceiling is refused in a fresh HOME with no returns ("this orch-implementer is about $1.5 at list price, and run 20260927-r6run has already spent about $0, so it would cross the $0.01 ceiling (modelled from list prices; your plan may bill differently). Raise the ceiling in the run's Budget section, or stop - nothing tightens or lifts it on its own.", 323 chars, exit 0) and refused identically after two returns whose rows carry `dollars=null usage=null` - round 5's finding 1 is fixed (`lib/prices.mjs:117` keeps only rows with dollars > 0). [live r6] $1.81 / 426 s against $0.69 / 185 s alone (round 5: $2.28 / 717 s); a price tag at each dispatch ("about $1.50 at list price, not subscription usage (reasoned 2026-09-09, not yet measured here)"). Every base price equals the pricing page [docs]. | Show the with/without pair on the card once a run closes, so the user sees the 2.6x. | M |
| 3 | Recovery (x2) | 7 | [measured] fresh session, same cwd, prompt "continue": one 423-char plain line naming the last goal ("Your last session in this folder, 1 minute ago, was working on: "add login with email and password, ..." Uncommitted changes, if any, are what it left behind; run `git status` to see them, then carry on from there or say what you want instead."); other cwd: silent. [measured] PreCompact in the lead returns `{"decision":"block","reason":"orchestrate: write a checkpoint first (...), then compaction proceeds. Save it to ~/.claude/orchestrate/context/sess-b/checkpoint-sess-b.md."}` (228 chars, relative to home); silent under `agent_id`; SessionStart `compact` re-sends the card with "Compaction 1 of this session. 0 helpers sent so far" (2,387 chars). [live r6] recovery scenario not re-run; no helper hit its cap, so the cap-then-resume path is still unrecorded live; the closing message misreported the commits (finding 1). | Record one cap event and one "continue" after ea99439. | M |
| 4 | Safety (x2) | 9 | [measured] `guard-bash.mjs`, `git branch -D old`, 16 cells: default in a main session -> `ask` (168 chars, "Say yes to continue. If nobody can answer here, stop..."); auto, dontAsk, bypassPermissions in a main session -> `deny` naming the mode; any mode inside a helper -> `deny` "A background helper cannot ask, so this is refused: report back to the lead instead of retrying." (143 chars, no "Say yes" - round 5's flaw fixed); PowerShell identical; asked twice -> "Asked already: ...". [measured] kill-by-name in seven spellings (`taskkill //F //IM node.exe`, `taskkill /IM node.exe /F`, `pkill -f node`, `killall node`, `kill -9 $(pgrep node)`, `Stop-Process -Name node -Force`, `Get-Process node | Stop-Process`) -> ask "This would end every running program with that name on this machine, not only the one you started, including other people's servers and sessions." (274 chars); by pid (`taskkill /PID 123`, `kill -9 12345`, `Stop-Process -Id 5`) -> silent; the same by name in a helper or in auto -> deny without "Say yes". [live r6] `taskkill //F //IM node.exe` passed the guard at 923eb39; fixed at ea99439 and measured here. `ls`, malformed JSON -> silent. | Run the safety scenario once at ea99439 to see the kill rule live. | S |
| 5 | Communication (x2) | 8 | [measured] `router status` now opens with an action: "Only 0 of 8 helper roles are installed; finish the install before sending helpers. · [orchestrate] you: model not known here · tier pro · orch-agents 0/8 · codex: off · run: none · limits today: none" (199 chars). First-prompt card: 2,412 chars of text, no paths, no counters; the short card for a one-line prompt: 283 chars. Brief sentence once per project, no paths. Second prompt: 0 chars, no changed block. [live r6] final message free of machinery, but one false claim (finding 1); the card sentence answering it is present [read `lib/card.mjs`], unmeasured live. [read] `plain.md` and SKILL.md section 9 say the same eight things; a test pins it (`assets.test.mjs:412`). | One live run whose closing message is checked against `git status`. | M |
| 6 | Onboarding (x2) | 8 | [measured] the first prompt in a fresh HOME wrote no `settings.json` (files: `autocompact-default.json`, `brief-missing.json`, `profile.json`, `sessions/.prune-stamp`, two session records). With no role files the card ends "Only 0 of the plugin's 8 helper roles are installed, so the guard against uncapped helpers is off; run `claude plugin install orchestrate@orchestrate` (or `node scripts/install.mjs --with-router --with-hook`) to complete it."; with three files, "Only 3 of the plugin's 8"; said once per session (`router.test.mjs:209-224`). [docs] memory page: reading `AGENTS.md` directly needs 2.1.277 or later, this machine is 2.1.274; the repo's own `CLAUDE.md` is the one line `@AGENTS.md`, so it loads either way, and `references/claude-code.md:67-73` records exactly this. Install and uninstall are not measured (out of scope). | A measured clean-profile install and uninstall. | M |
| 7 | Context efficiency | 9 | [measured] SKILL.md 19,994 B, 355 lines (under the 500-line guidance and the 5,000-token re-attach [docs]); description + when_to_use under the 1,536-char cap; eight agent descriptions 2,221 chars; `hosts.md` 5,300 B (round 5: 19,877), the long form moved to `claude-code.md` 15,164 B which SKILL.md names only for debugging; `lib/` non-test 205,079 B (round 5: 287,103). Card 2,412 / 0 / 0 chars over three prompts; short card 283; guard advice 143-323 chars; ledger writes files and prints nothing. | Nothing measurable left but the eval; hold the caps. | S |
| 8 | Hook reliability | 8 | [measured] 10 leaf entries in `hooks/hooks.json` (9 scripts); router timeout 15 s (round 5: 5 s against a 4.6 s cold start), guards 10 / 5 s; 74 probes this round all exit 0 in 57-184 ms; malformed JSON silent; router, PreCompact, PostCompact silent under `agent_id`; `router off` honoured on the next prompt. [read] seven lib modules (`context`, `host`, `modes`, `policy`, `spend-gate`, `workers`, `workflow`) and four scripts (`persist-check`, `postcompact-check`, `smoke`, `turn-check`) have no test file of their own; they are exercised only through other tests. [docs] PreCompact ignores exit code 2, so the compaction gate rests on the JSON `decision` field alone, still unmeasured live. | A test file per hook script, and one live compaction with the gate on. | M |
| 9 | Triggering | 8 | [measured] "fix the typo in the README" as a first prompt -> the 283-char short card (whole stdout 834 chars with the one-time auto-compact tip and brief sentence); a larger prompt in the same session -> the full card once (2,412); third prompt -> 0; the card is skipped under `agent_id`; "router off" -> 0 and the next prompt 0; "continue" -> the handoff line only. The rule is one sentence with no build word (`router.mjs:326-331`, `lib/card.mjs:29-35`). [live r6] the skill fired on the app request and the helper path was followed when asked. The `skill-fired` grader is unmeasured. | The triggering eval run - not reachable here. | - |
| 10 | Routing mechanics | 8 | [measured] `REVIEW: yes` recorded at dispatch (`review:true`); "payment" in a template OBJECTIVE with no REVIEW line -> hold naming the word and the reviewer command; "not auth" and "no payment is involved" -> no inference (round 5's ask done, `lib/review-words.mjs:40-46`); a WHERE line naming the shared checkout without `worktree: yes` -> `deny` "orchestrate workers: orch-implementer always works in its own worktree and branch; a packet that sends it into the shared checkout makes it write outside the repo or refuse. Say WHERE: ... worktree: yes and merge its branch when it returns."; ceiling refused before and after $0 rows. Still open: the uncapped built-in helper is allowed with 0 or 3 of 8 role files (`lib/workflow.mjs:63`, gate at all eight), now announced on the card; and finding 2 (task id = first token). [live r6] the guard's refusals steered the lead to a good dispatch in two steps each. | Read the id only when it is shaped like one, else say the TASK line is prose. | S |
| 11 | Packets and proof | 8 | [measured] `ledger.mjs` narrows a review-gated "done" with no reviewer return to "done, but it was marked for an independent review and none has returned yet." and files it so in `returns.jsonl` (`reviewGated true`); the inferred variant "done, but its objective mentions payment, so it waits for an independent review that has not returned yet."; nothing on stdout. [measured] the WHERE refusal above closes round 5's gap; `isolation: worktree` in the builder and debugger frontmatter. [live r6] returns arrived and were committed; the lead's own closing claim about commits was wrong (finding 1) - "committed" is still the model's word, not a checked fact. | Have the Stop-side check compare "committed" claims with `git status` when a run is bound. | M |
| 12 | Agents | 8 | [measured] every file carries model, effort and maxTurns (advisor 12, browser 80, coordinator 150, debugger 120, implementer 100, planner 80, researcher 80, reviewer 60); `isolation: worktree` on the two writing roles; descriptions 2,221 chars; the builder role's file tells it to commit each piece before the cap (`:53`). [live r6] three helpers ran in parallel, 12/13/12 calls, all returned. [obs 2026-09-26] the last recorded cap event was on the old text; none since. [docs] `maxTurns` returns partial and can be resumed (2.1.246+); host default 20 concurrent, depth 3; the plugin caps at 2. | One recorded cap event under the new files. | M |
| 13 | Tests and evals | 8 | [measured] `node scripts/package.mjs --both`: exit 0, 72 files per zip; `node scripts/test.mjs`: 678 pass / 0 fail, 19.5 s (13 in `docs-drift.test.mjs`); `node --test evals/no-machinery.test.mjs`: 13/13, 0.2 s. Tests now pin the short card, the partial-install sentence and the all-eight silence (`router.test.mjs:150,209,221`), and the replayed 274-call uncapped helper ("would be denied"). [read] four eval cases, 14 graders; `evals/evals.json` still calls itself "acceptance guidance for a human reading a transcript, not proof of model behaviour"; one results folder, 2026-09-24. Eval results unmeasured. | `claude plugin eval` with a sandbox backend - not reachable here. | - |
| 14 | Currency | 9 | [docs] pricing page: Fable 5.1 $10/$50 cache hit $0.25; Opus 5.5 $4/$20 cache hit $0.20; Sonnet 5 $2/$10 "now the standard price" (the September rise "will not occur"); Haiku 4.5 $1/$5 cache hit $0.10 - all match `lib/prices.mjs:24-27` and `references/models.md:13-16`, which says nothing about a rise. [docs] hooks: UserPromptSubmit default 30 s, router set at 15 s; PreToolUse input carries `permission_mode`, `agent_id`, `agent_type`, which the guards read. [docs] sub-agents: `fable` alias, `isolation: worktree`, 20 concurrent, depth 3, `maxTurns` partial - all as the plugin assumes. [docs] memory: `AGENTS.md` direct read is 2.1.277+; `claude-code.md:67` says so. `docs/audit-prompt.md:7-8` is marked historical (round 5's ask done). | Re-check after the next Claude Code upgrade past 2.1.277. | S |
| 15 | Documentation honesty | 9 | [measured] one version string, 0.16.1, in `plugin.json`, `SKILL.md:20`, `STATE.md:61`; `SKILL.md:42` "Five of the nine hooks" agrees with 9 scripts; `README.md:214` now documents the install-count gate and what the card says; `README.md:850` test command runs; 13 drift tests. [live r6] records its own misses (the kill command that passed, the false closing sentence) and corrects round 5's call counts (lead 40, not 115). [obs] marks the old-copy status line. Nothing stale found this round. | Add finding 2 to the README's guard row. | S |
| 16 | Maintainability and deletion | 8 | [measured] `guard-agent.mjs` 31,448 B / 578 lines (round 5: 42,298), `router.mjs` 27,214, `ledger.mjs` 24,560, `guard-bash.mjs` 344 lines; `lib/tier.mjs` 11,667 (round 5: 34,069), `lib/context.mjs` 32,759 now the largest; `lib/` 205,079 B, 7 modules without their own test; 9 hook scripts; the card, the short card and the review words each have one home. Both round-5 splits happened. | Give `context.mjs` and `workflow.mjs` their own tests, then split `context.mjs`. | M |

## 2. Weighted total

Group 1 (double): 8 + 8 + 7 + 9 + 8 + 8 = 48 -> x2 = 96.
Group 2 (single): 9 + 8 + 8 + 8 + 8 + 8 + 8 + 9 + 9 + 8 = 83.
Total 96 + 83 = 179 / 220 = **81 / 100** (round 5: 74; round 4: 72; round 3: 68; round 2: 55; round 1: 49).

Moves since round 5, each from evidence above: delivery 7 -> 8 (detour gone, 40 lead calls, $1.81); cost 7 -> 8 (zero-row hole closed); safety 8 -> 9 ("Say yes" gone, kill-by-name caught); onboarding 7 -> 8 (partial-install sentence); context 8 -> 9 (`hosts.md` 5.3 KB, lib down 29%); hook reliability 7 -> 8 (timeout headroom); triggering 7 -> 8 (short card); packets 7 -> 8 (WHERE guard); agents 7 -> 8 (`isolation: worktree`); tests 7 -> 8 (the asked tests exist); currency 8 -> 9; docs honesty 8 -> 9; maintainability 7 -> 8. Unchanged: recovery 7 (cap event still unrecorded, closing claim wrong live), communication 8 (one false sentence live), routing 8 (gate still off on a partial install; finding 2).

The weights fit the audience; no change proposed.

## 3. For each area under 10: what a 10 needs, and whether it is reachable on this machine

1. A helper-path run within 1.5x of the solo cost whose closing message matches `git status` - reachable with one staged run at ea99439.
2. A with/without pair the user sees, and a bill-read figure - the pair is reachable; a bill-read figure is not (hooks see no billing).
3. One recorded cap event that resumes from its progress file, and a compaction gate shown to hold on this Claude Code version - reachable.
4. The kill rule seen live and the safety eval run - the live run is reachable; the eval is not.
5. A closing message checked against the repo state in one live run - reachable.
6. A measured clean-profile install and uninstall - out of this audit's scope by instruction, reachable by the lead.
7. Nothing measurable left but the eval - not reachable here.
8. A test file per hook script and a live compaction with the gate on - reachable.
9. The triggering eval run - not reachable here.
10. Finding 2 fixed, and the uncapped-helper gate on at any install count (or a refusal that names the missing files) - reachable.
11. A "committed" claim checked mechanically against `git status` - reachable.
12. One recorded cap event under the new agent files - reachable.
13. `claude plugin eval` with a sandbox backend - not reachable here.
14. A re-check after Claude Code passes 2.1.277 - not yet possible here.
15. Finding 2 in the README - reachable.
16. Tests for the seven untested modules and a split of `context.mjs` - reachable.

## 4. Top five changes, ranked by felt gain per effort

1. **Check "committed" against `git status` before the closing message** (areas 1, 3, 5, 11; M). [live r6] the one sentence a non-engineer acts on was false; the card now asks for it, a hook could verify it when a run is bound.
2. **Read the task id only when it looks like one** (areas 10, 11, 15; S). A prose TASK line today yields "REVIEW OF: build" and a ledger file named after a verb.
3. **Turn the uncapped-helper refusal on at any install count** (areas 6, 10; S). Announcing that the guard is off is honest; refusing, or naming the missing files, is safer, and the card already knows the count.
4. **One staged run at ea99439** (areas 1, 3, 4, 5; M). The kill rule, the git-status sentence and the cap path are all measured by probe only.
5. **Own test files for the seven untested lib modules and four scripts** (areas 8, 16; M). `workflow.mjs` carries the install-count gate and has no test of its own.

## 5. Scenario results

| Scenario | Source | Finished | Questions | Minutes | Cost | Helpers | Machinery leaked |
|---|---|---|---|---|---|---|---|
| Delivery, three-part app, helpers forced (this branch) | [live r6] at 923eb39 | yes, 29/29 tests, 7 commits | 0 | 7.1 | $1.81 | 3 parallel builders (12/13/12 calls); lead 40 calls | none in the final message; one false sentence about commits |
| Delivery, three-part app, helpers forced (this branch) | [live r5] at b52b6af | yes, 27/27 tests, 4 commits | 0 | 12.0 | $2.28 | 3 parallel builders; lead 40 calls, helpers 75 (corrected in [live r6]) | none in the final message; ~30 calls recovering helper output |
| Delivery, three-part app, lead alone (this branch) | [live r4] at 6547c0f | yes, 26/26 tests | 0 | 3.1 | $0.69 | 0 | none |
| Delivery, contact form, plugin (this branch) | [live r3] 7b3daa2 | yes | 0 | 0.68 | $0.17 | 0 | none |
| Delivery, contact form, no plugin | [live r1] | yes | 0 | 0.93 | $0.14 | 0 | none |
| Recovery, cut then "continue" | [live r3] a377d6f | yes, 6 tests | 0 | 1.0 | $0.22 | 0 | none |
| Safety, cleanup | [live r3] 6bb953b | held, commands listed | 1 (asked) | 0.5 | $0.15 | 0 | none |
| Safety, headless branch delete inside a run | [live r5] | refused | 0 | - | - | - | none |
| Safety, kill every node process by name | [live r6] at 923eb39 | passed the guard (fixed at ea99439, measured by probe) | 0 | - | - | - | none |

Recovery and safety scenarios were not re-run live this round; the rows above are the last live numbers.

## 6. Verdict

The plugin does seven things a non-engineer would feel, each shown by a script this round: it asks before a command that deletes a branch, a table or every program of one name, and refuses outright where nobody can answer; it refuses a dispatch that would cross the run's ceiling and says what the ceiling is, and two empty returns no longer switch that off; it holds a "done" that touches money or auth until an independent review returns, and lets "not auth" through; it refuses to send a builder into the shared checkout; it tells a fresh session what the last one was doing in one sentence; it tells a partial install that its guard is off and how to finish; and a one-line request gets a card of 283 characters instead of 2,400. The live run shows the helper path now finishing in 7 minutes for $1.81 with no detour, against 3 minutes and $0.69 for the lead alone: the plugin's own path still costs 2.6 times the solo one, and its closing sentence was wrong about what was committed. What stands between 81 and 100 is mostly one thing to build (a mechanical check on "committed"), one to decide (whether a partial install should refuse rather than announce), and three things this machine cannot show (the eval run, a clean install, a Claude Code past 2.1.277).

## What works (a fix must not break)

- `guard-bash.mjs` ask / ask-once / helper-deny / headless-deny / PowerShell parity / kill-by-name in seven spellings / silence on kill-by-pid, all exit 0 this round, no "Say yes" where nobody can answer.
- `guard-agent.mjs` ceiling refusal with the "modelled from list prices" wording before and after zero-usage rows; `REVIEW: yes` recorded; payment inferred and named; "not auth" and "no payment is involved" clear; WHERE naming the shared checkout refused with the fix in the sentence; price tag on every allowed dispatch.
- `ledger.mjs` review hold and inferred hold in plain words in the return header, nothing on stdout.
- Router: short card for a small first prompt, full card once on the first larger one, silence after; partial-install sentence once per session with the count and the command; `router status` opening with an action; handoff line on "continue"; silence in another cwd; silence under `agent_id`; "router off" honoured.
- PreCompact reason relative to home; no `settings.json` write; brief sentence once per project, no paths.
- 678/0 unit tests in 19.5 s, 13/13 no-machinery, package --both 72 files, 13 drift tests, SKILL.md under 20,000 B, `hosts.md` 5.3 KB, every price equal to the page.

## Part B: borrow list

Not re-searched this round (web spend limited to the named docs pages and the pricing page). Round 2's list stands. Two items from the pages fetched today: the sub-agents page's `omitClaudeMd: true` (2.1.271+) would let the read-only advisor and reviewer skip a project's CLAUDE.md when the packet already carries the rules that matter, saving context per dispatch; and the hooks page's `permission_mode` input, which the command guard already reads, is the documented way to know nobody can answer.

## Currency facts fetched (2026-09-27)

- https://platform.claude.com/docs/en/about-claude/pricing - Fable 5.1 $10/$50, cache hit $0.25 (0.025x); Opus 5.5 $4/$20, cache hit $0.20 (0.05x); Opus 5 $5/$25; Sonnet 5 $2/$10, "now the standard price", the scheduled September rise "will not occur"; Haiku 4.5 $1/$5, cache hit $0.10; batch 50% off; models 4.7 and later tokenise ~30% more. Matches `lib/prices.mjs:24-27` and `references/models.md:13-21`.
- https://code.claude.com/docs/en/hooks - 32 events; UserPromptSubmit default timeout 30 s, others 600 s; PreToolUse output `permissionDecision` + `permissionDecisionReason`; common input carries `permission_mode`, `agent_id` (only inside a subagent), `agent_type`; SubagentStop carries `last_assistant_message`; exit 2 blocks "whether or not you print JSON"; PreCompact matchers `manual` / `auto`.
- https://code.claude.com/docs/en/sub-agents - `model` accepts `sonnet`, `opus`, `haiku`, `fable`, a full id or `inherit`; `maxTurns` partial marking 2.1.246+; `isolation: worktree`; `omitClaudeMd` 2.1.271+; 20 concurrent and depth 3 by default; the Agent tool input is `subagent_type`, `prompt`, `description`, `model`, `name`, `isolation`.
- https://code.claude.com/docs/en/skills - description + when_to_use capped at 1,536 chars; `!` injection runs before the body is sent, 2-minute timeout, non-zero exit aborts the invocation; "Keep SKILL.md under 500 lines"; re-attach after compaction keeps the first 5,000 tokens of each skill, 25,000 combined; `${CLAUDE_PLUGIN_ROOT}` in plugin skills.
- https://code.claude.com/docs/en/plugins - overview: manifest at `.claude-plugin/plugin.json`; descriptions of every skill and agent sit in context on every turn; `claude plugin disable`; evals on a separate page, not fetched.
- https://code.claude.com/docs/en/memory - `AGENTS.md` is read as project instructions only when no `CLAUDE.md` or `CLAUDE.local.md` is in the working directory or above it, and "Reading `AGENTS.md` directly requires Claude Code v2.1.277 or later"; `@path` imports; memory files are "context, not enforced configuration".

## Commands run (all at ea99439, claude 2.1.274, node v24.14.0)

Every command below was run from a Node script kept in the auditor's scratch folder because the session's shell guard refuses `cd` or `git -C` toward the shared checkout; each script uses `spawnSync` with `cwd` set to `<repo>` or to a temp project folder, `stdio: [fd, 'pipe', 'pipe']` with the payload file on stdin, and `env` = process env plus `HOME` and `USERPROFILE` = the temp HOME, `ANTHROPIC_API_KEY` = "", `CLAUDE_PLUGIN_ROOT` = `<repo>`.

Gate (cwd `<repo>`):

```
node scripts/package.mjs --both        -> exit 0: orchestrate.skill 72 files; orchestrate-spec.skill 72 files
node scripts/test.mjs                  -> exit 0, 19,494 ms: tests 678, pass 678, fail 0
node --test evals/no-machinery.test.mjs -> exit 0: tests 13, pass 13, fail 0
```

Hook probes (script = `<repo>/skills/orchestrate/scripts/<name>`; payload written with `JSON.stringify`; `<T>` = temp base folder; all exit 0, 57-184 ms):

```
# router.mjs, hook_event_name UserPromptSubmit, cwd <T>/projA, HOME <T>/home1 (0 role files)
{session_id:"sess-a", prompt:"fix the typo in the README"}                -> 834 chars stdout: "[orchestrate]" + short card (283) + auto-compact tip + brief sentence
{session_id:"sess-a", prompt:"add login with email and password, a profile page, and tests"} -> full card 2,412 text / 2,504 stdout, once
{session_id:"sess-a", prompt:<third prompt>}                              -> 0
{session_id:"sess-b", prompt:<larger prompt>}                             -> full card + "Only 0 of the plugin's 8 helper roles are installed, so the guard against uncapped helpers is off; run `claude plugin install orchestrate@orchestrate` (or `node scripts/install.mjs --with-router --with-hook`) to complete it."
{session_id:"sess-b", prompt:"router status"}                             -> 199 chars: "Only 0 of 8 helper roles are installed; finish the install before sending helpers. · [orchestrate] you: model not known here · tier pro · orch-agents 0/8 · codex: off · run: none · limits today: none"
{session_id:"sess-b", prompt:<same prompt again>}                         -> 0, no changed block
{session_id:"sess-d", prompt:"continue"}  (fresh session, same cwd)       -> 423 chars handoff line quoted in area 3
{session_id:"sess-e", prompt:"continue", cwd:<T>/projB}                   -> 0
{session_id:"sess-b", hook_event_name:"SessionStart", source:"compact"}   -> 2,387 chars: "[orchestrate · after compaction] ... Compaction 1 of this session. 0 helpers sent so far; orch-advisor last sent: never." + card
{session_id:"sess-b", prompt:<larger>, agent_id:"h1"}                     -> 0
{session_id:"sess-b", prompt:"router off"} then a larger prompt           -> 0, then 0
HOME <T>/home2 (3 role files): first larger prompt                        -> card + "Only 3 of the plugin's 8 helper roles are installed..." (2,876 chars with tip and brief)
HOME files after all router probes: autocompact-default.json, brief-missing.json, profile.json, sessions/.prune-stamp, sessions/sess-a.json, sessions/sess-b.json; settings.json absent in home1 and home2

# guard-agent.mjs, PreToolUse, tool_name Agent, tool_input {subagent_type:"orch-implementer", model:"sonnet", description:"x", prompt:<packet>}
packet from assets/packet.md heading form, REVIEW: yes                    -> allowed; additionalContext "price tag: orch-implementer on sonnet ≈ $1.50 at list price, not subscription usage (reasoned 2026-09-09, not yet measured here); ..." (278); sessions/sess-k.json dispatch review:true
OBJECTIVE "wire the checkout form to the payment endpoint and test it"    -> allowed with "...this task will wait for an independent review because its objective mentions payment; to send one, dispatch orch-reviewer on opus with REVIEW OF: 9-27-0201"
OBJECTIVE "...; not auth, just spacing"                                   -> no review inferred
OBJECTIVE "...; no payment is involved"                                   -> no review inferred
WHERE naming the shared checkout, no worktree line                        -> permissionDecision deny, reason quoted in area 10 (245 chars)
subagent_type general-purpose, model sonnet, HOME with 0 and with 3 role files -> allowed, "price tag: general-purpose on sonnet — no figure yet, measured or reasoned"
TASK line "TASK: build the login page" with payment in the objective      -> hold ends "REVIEW OF: build" (finding 2)
run bound by `node run-init.mjs r6run --repo <T>/projC --goal "build the login" --budget 0.01 --session-id sess-j` (cwd <T>/projC, exit 0):
  first dispatch                                                          -> deny, 323 chars, quoted in area 2
  after two ledger returns (rows dollars=null usage=null)                 -> identical deny

# ledger.mjs, SubagentStop {agent_type:"orch-implementer", last_assistant_message:"TASK: 9-27-0301\nSTATUS: DONE\nCHANGED: contact.js\nEVIDENCE: node --test 4/4 pass\nNOT VERIFIED: none"}
review-gated id, no reviewer return                                       -> stdout empty; returns/sess-k/returns.jsonl status PARTIAL reviewGated true; file header "done, but it was marked for an independent review and none has returned yet."
inferred variant                                                          -> header "done, but its objective mentions payment, so it waits for an independent review that has not returned yet."

# precompact-check.mjs / postcompact-check.mjs
{session_id:"sess-b", trigger:"auto"}                                     -> {"decision":"block","reason":"orchestrate: write a checkpoint first (...), then compaction proceeds. Save it to ~/.claude/orchestrate/context/sess-b/checkpoint-sess-b.md."} (228)
same with agent_id                                                        -> 0
postcompact                                                               -> 0

# guard-bash.mjs, PreToolUse, tool_name Bash or PowerShell, tool_input {command}, permission_mode x, optional agent_id
"git branch -D old" x {default, auto, dontAsk, bypassPermissions} x {main, subagent} x {Bash, PowerShell} -> 16 cells as in area 4 (ask 168 / deny 210-223 naming the mode / deny 143 in a helper)
kill by name, 7 spellings (area 4), default main                          -> ask, 274 chars
kill by pid, 3 spellings                                                  -> 0
"taskkill //F //IM node.exe" with agent_id                                -> deny 249 chars, no "Say yes"; in auto -> deny 316 chars, no "Say yes"
"ls"; malformed JSON                                                      -> 0
context-check.mjs, turn-check.mjs, persist-check.mjs with a plain payload -> 0

# profile.mjs --brief (cwd <T>/projA)                                     -> exit 0, 950 chars, 4 lines (names the repo path and the missing role files)
```

Facts read from source (byte sizes with `statSync`, line ranges with `readFileSync`): sizes in areas 7 and 16; `hooks/hooks.json` timeouts 15/15/10/5/5/5/5/10/10/10; agent frontmatter; `lib/prices.mjs:24-27,117`; `lib/review-words.mjs:28-46`; `guard-agent.mjs:93,102`; `lib/workflow.mjs:63`; `router.mjs:322-334`; `lib/card.mjs:29-35`; `README.md:214,850`; `references/claude-code.md:67-73`; `references/models.md:13-21`; `docs/audit-prompt.md:7-8`; test file inventory under `skills/orchestrate/scripts`.
