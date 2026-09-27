# Scoresheet audit, round 5 (2026-09-26)

- Commit: `40ba545ed6197a288d057a51cdabcbe8714c6b7c` (branch `audit/scoresheet-to-ten`, read from `.git/refs/heads/audit/scoresheet-to-ten`; the auditor's own worktree sits on an older commit and was used only as a cwd for the Bash-guard probes)
- Claude Code: 2.1.274; node v24.14.0; Windows 10 Home 10.0.19045
- Auditor: Claude Fable 5.1, no repo install, no staged sessions; hook scripts fed sample payloads on stdin with HOME and USERPROFILE pointed at fresh temp folders (`home`, `home2`), `profile.json` = `{"tier":"pro"}`, empty `sessions/`, empty `ANTHROPIC_API_KEY`
- Prompt: `docs/scoresheet-audit-prompt.md` (current for v0.16.1). Rounds 1-4 scored 49, 55, 68, 72. None is a prior; every area is scored from evidence this round produced or the named documents record.

## How to read the evidence

- **[measured]** - a command this auditor ran at 40ba545; the exact command and output are under "Commands run".
- **[live r5]** - the lead's live run of this branch with the helper path forced, `docs/audits/2026-09-26-live-runs-r5.md` (at b52b6af; 40ba545 changed two agent files after it).
- **[live r4]** - `docs/audits/2026-09-26-live-runs-r4.md`, the same app built by the lead alone.
- **[obs]** - `.orchestrator/runs/20260924-audit-to-ten/observations.md`, the lead's field notes. Status-line and recover notices in those notes came from the OLD installed copy, not this branch, and are marked so where cited.
- **[read]** - read from source with a file:line; never worth more than a 6 on its own.
- **[docs]** - a page fetched 2026-09-26, listed under "Currency facts fetched".

**Eval results are unmeasured on this machine.** `claude plugin eval` cannot run here (no sandbox backend on this platform). The eval layer is judged from the four case folders, their 14 graders, and `node --test evals/no-machinery.test.mjs`. The one live number that changed since round 4 is the helper path: [live r5] forced it and it finished, at three times the cost of the lead building alone.

Two findings this round that no earlier round recorded, both [measured]:

1. **Zero-usage returns poison the price estimate.** After two returns with no usage figures were filed in a fresh HOME, the price tag for the next dispatch became "≈ $0.00 at list price, not subscription usage (measured here, n=2)" and a $0.01 run ceiling was **not** enforced. In a second fresh HOME with no returns, the same dispatch was refused on the ceiling. `lib/prices.mjs:115-125` averages whatever rows exist; a row with $0 counts as a measurement.
2. **The refusal of an uncapped helper depends on all eight role files being installed.** `guard-agent.mjs:286` refuses `general-purpose` only when `agentsInstalled().installed >= 8` (files under `<HOME>/.claude/agents`). In a temp HOME with none installed the dispatch was allowed with "price tag: general-purpose on sonnet — no figure yet"; after copying the eight files in, the same payload was refused with the sentence [live r5] saw. A partial install falls back silently.

## 1. Score table

| # | Area | Score | Reason | Change | Effort |
|---|------|-------|--------|--------|--------|
| 1 | Delivery (x2) | 7 | [live r5] the three-part app with helpers forced: finished, 27/27 tests, 4 commits, 0 questions, 717 s, $2.28, three parallel builders, final message free of machinery. [live r4] the same app by the lead alone: 185 s, $0.69, 23 tool calls. The helper path cost 115 lead calls, about 30 of them recovering from helpers that wrote into the shared checkout or `/tmp` because the lead told them to; 40ba545 makes the two writing helpers refuse that instruction [read `assets/agents/orch-implementer.md:17-23`, `orch-debugger.md:29-33`] but no run since has exercised it. Delivered both ways; the plugin's own path is the slower and dearer one today. | Measure the helper path once more after 40ba545 and record calls spent recovering. | M |
| 2 | Cost and time (x2) | 7 | [measured] a dispatch that would cross the run ceiling is refused in a fresh HOME: "this orch-implementer is about $1.5 at list price, and run r5run has already spent about $0, so it would cross the $0.01 ceiling (modelled from list prices; your plan may bill differently). Raise the ceiling in the run's Budget section, or stop — nothing tightens or lifts it on its own." (418 chars, exit 0). [measured] the same dispatch after two zero-usage returns: tag "≈ $0.00 ... (measured here, n=2)", no refusal - finding 1 above. [live r5] $2.28 / 717 s against $0.69 / 185 s alone; the price tag was shown at each dispatch. Base prices match the pricing page [docs], including the Opus 5.5 cache figure round 4 flagged (`references/models.md:14` now $0.20). | Ignore rows with zero usage when averaging, or fall back to the reasoned figure when the measured mean is $0. | S |
| 3 | Recovery (x2) | 7 | [measured] fresh session, same cwd, prompt "continue": one 350-char plain line naming the last goal and telling the user to run `git status`; other cwd: silent; a fresh session's first prompt in the same cwd: card only, 2,183 chars. [measured] PreCompact returns `{"decision":"block","reason":"... Save it to ~/.claude/orchestrate/context/sess-r5a/checkpoint-sess-r5a.md."}` - relative to home, no absolute path; silent under `agent_id`; SessionStart `compact` re-sends the card (2,379 chars). [docs] hooks page: exit code 2 is not honoured for PreCompact; whether the JSON `decision: block` holds is not documented and not measured here. [obs 2026-09-26] helpers stopped at their turn cap with no return; [docs] sub-agents page says a capped helper returns partial output and can be resumed (2.1.246+; this machine is 2.1.274). [read] the writing helpers commit before their cap (`orch-implementer.md:53-54`, ~75 steps). | Record one real cap event under 40ba545: does the partial return reach the ledger, and does the resume work. | M |
| 4 | Safety (x2) | 8 | [measured] `guard-bash.mjs`, `git branch -D old`, 16 cells: default in a main session -> `ask` ("This would permanently delete a branch. Say yes to continue. If nobody can answer here, stop and tell the user what you were about to run instead of trying again."); auto, dontAsk and bypassPermissions in a main session -> `deny` naming the mode ("You are in auto mode, where nobody can say yes, so this is refused: run it yourself in a normal session, or add the exact command to .orchestrator/allow-bash.json."); any mode inside a helper -> `deny` ("A background helper cannot ask, so this is refused; report back to the lead instead of retrying."); PowerShell identical to Bash. Asked twice -> "Asked already: ...". `psql ... DROP TABLE` -> ask; `git push origin --delete` in auto -> deny "on the shared remote"; `ls`, malformed JSON and a delete under the temp folder -> silent. [live r5] the guard fired inside a helper on `rm -rf` and on the lead's headless branch delete. One flaw: the helper refusal still carries "Say yes to continue" before the sentence saying nobody can. | Drop the "Say yes" clause from the helper and headless variants. | S |
| 5 | Communication (x2) | 8 | [measured] first-prompt card 2,651 chars: the card, one auto-compact tip, and one brief sentence ("This project has no "What this is for" section in its CLAUDE.md or AGENTS.md. Add one ... the plugin's assets folder has a BRIEF.md template.") with no paths; no counters, model name or tier. Second prompt: 0 chars, no `[orchestrate · changed]`. `router status`: 196 chars, "you: model not known here · tier pro · orch-agents 0/8 · codex: off · run: none · limits today: none" - a state line whose first sentence is a counter, not an action. [live r5] final message: how to run it, no machinery. | Make the first sentence of `router status` an action ("Nothing is running; send a prompt to start a run"), counters after. | S |
| 6 | Onboarding (x2) | 7 | [measured] the first prompt in a fresh HOME wrote no `settings.json`; files were `autocompact-default.json`, `brief-missing.json`, a session record, a prune stamp and a context file. The brief sentence appears once per project (absent in the third session, same cwd). [docs] memory page: `AGENTS.md` loads as project instructions when no `CLAUDE.md` is present, so the plugin's brief look-up matches what Claude Code reads. [measured] finding 2: with fewer than eight role files installed the uncapped-helper refusal is off and nothing says so. Install and uninstall are not measured (out of scope). | On the first card, if `agentsInstalled().installed < 8`, say so in one sentence and name the install command. | S |
| 7 | Context efficiency | 8 | [measured] SKILL.md 19,994 B (frontmatter 1,003, body 18,934 B, about 4,700 tokens) fits the 5,000-token re-attach [docs: skills page]; description 367 + when_to_use 415 = 782 chars under the 1,536 cap; eight agent descriptions total 2,229 chars, far under the 15,000-token warning [docs: sub-agents page]. Card 2,651 / 0 / 2,183 chars over three sessions; guard advice 169-354 chars. `references/hosts.md` is 19,877 B and named three times in SKILL.md; `lib/` totals 287,103 B. | Trim `hosts.md` or split it so the part a lead reads is under 8 KB. | S |
| 8 | Hook reliability | 7 | [measured] 10 leaf entries in `hooks/hooks.json` (9 scripts); 60 probes this round all exit 0; malformed JSON silent; router, PreCompact and PostCompact silent under `agent_id`. [measured] `router status` took 4,606 ms on its first call in a session against the 5 s timeout set in `hooks.json` (732 / 152 / 801 ms after); `guard-agent.mjs` 100-442 ms against 10 s. [docs] PreCompact ignores exit code 2, so the compaction gate rests on the JSON `decision` field alone. Finding 1: the price average trusts a $0 row. | Raise the router timeout to 15 s (docs default on UserPromptSubmit is 30 s) and add a test that a zero-usage row does not lower the mean. | S |
| 9 | Triggering | 7 | [measured] the router sends the card once per session, prints nothing on an unchanged second prompt, skips prompts carrying `agent_id`, is silenced by "router off" (next prompt 0 chars), and gives "continue" the handoff line. "fix the typo in the README" received the full 2,183-char card - no damping for a one-line edit. [live r5] the skill fired on the app request and the helper path was followed when the prompt asked for it. The `skill-fired` grader is unmeasured. | Shorter card (under 600 chars) when the prompt is one short sentence with no build words. | M |
| 10 | Routing mechanics | 8 | [measured] `REVIEW: yes` is recorded at dispatch (`review:true` in the session record); an objective mentioning payment with no REVIEW line is held ("this task will wait for an independent review because its objective mentions payment; to send one, dispatch orch-reviewer on opus with REVIEW OF: 9-26-0002"); "(not auth)" is still inferred as auth (`guard-agent.mjs:396`, by design). Fable on a pro profile -> deny with the "APPROVED BY USER: fable" line; the review role on sonnet -> deny; uncapped helper with no model -> deny; concurrency: a third dispatch in one session refused at 2. Prices in `lib/prices.mjs` equal the page. Finding 1 (zero-usage rows) and finding 2 (install-count gate) are the two holes. | Fix finding 1; have the negation "not X" clear the inferred word. | S |
| 11 | Packets and proof | 7 | [measured] `ledger.mjs` narrows DONE three ways: review-gated with no reviewer return -> PARTIAL with "done, but it was marked for an independent review and none has returned yet."; inferred word -> "its objective mentions payment, so it waits for an independent review that has not returned yet."; no evidence line -> "said done, but its return carried no evidence line; treat as unverified." A prompt with no PROGRESS line gets "no PROGRESS line: a capped return will have nothing to resume from". [live r5] the packet's WHERE field did not hold: the lead wrote "work in the shared checkout" and helpers obeyed; one wrote to `/tmp`. [read] `assets/packet.md:9-11` commit-per-piece rule; 40ba545 moves the worktree rule into the helper files. | Have `guard-agent.mjs` refuse a packet whose WHERE names the shared checkout. | S |
| 12 | Agents | 7 | [measured] every file carries model, effort and maxTurns (advisor 12, browser 80, coordinator 150, debugger 120, implementer 100, planner 80, researcher 80, reviewer 60); descriptions total 2,229 chars. [live r5] three helpers ran in parallel and returned; the command guard fired inside one. [obs 2026-09-26] two helpers ended at the cap with no return. [docs] a capped helper returns partial output and can be resumed with SendMessage (2.1.246+); the default spawn depth is 3 and the plugin caps concurrency at 2 against the host's 20. [read] 40ba545 worktree rule in the two writing roles, unmeasured live. | One live cap event recorded, and `isolation: worktree` in the writing roles' frontmatter instead of prose. | M |
| 13 | Tests and evals | 7 | [measured] `node scripts/package.mjs --both`: exit 0, 66 files per zip; `node scripts/test.mjs`: 656 pass / 0 fail, 27.2 s, 50 test files (13 in `docs-drift.test.mjs`); `node --test evals/no-machinery.test.mjs`: 13/13, 0.1 s. [read] four eval cases, 14 graders; `evals/evals.json` calls itself "acceptance guidance for a human reading a transcript, not proof of model behaviour"; one results folder from 2026-09-24. No test covers finding 1 or finding 2. | Two tests: zero-usage row ignored; uncapped-helper gate with 0 and 8 files installed. | S |
| 14 | Currency | 8 | [docs] pricing page: Fable 5.1 $10/$50 (cache hit $0.25), Opus 5.5 $4/$20 (cache hit $0.20), Opus 5 $5/$25, Sonnet 5 $2/$10 "now the standard price", Haiku 4.5 $1/$5 - all four figures in `lib/prices.mjs` and `models.md` match, the round-4 stale one fixed. [docs] hooks page: SubagentStop carries `agent_id`, `agent_type`, `last_assistant_message` (the ledger reads the last); PreCompact ignores exit code 2. [docs] sub-agents: `fable` is a valid model alias; `isolation: worktree` exists. [read] `docs/audit-prompt.md:6` still says "Current for v0.4.0; the plugin is at v0.16.1". | Pin the PreCompact JSON assumption in a test comment and fix the v0.4.0 line. | S |
| 15 | Documentation honesty | 8 | [measured] one version string, 0.16.1, in `plugin.json:4`, `SKILL.md:20`, `STATE.md:61`; `SKILL.md:42` "Five of the nine hooks this plugin ships" agrees with 9 scripts; `README.md:848` test command runs; 13 drift tests. [live r5] records the 30 recovery calls and the `/tmp` write instead of hiding them. [obs] marks the old-copy status line. Stale: `docs/audit-prompt.md:6`. Undocumented: finding 2 (the install-count gate) appears nowhere in README or SKILL.md. | Document the install-count gate and retire the v0.4.0 line. | S |
| 16 | Maintainability and deletion | 7 | [measured] `guard-agent.mjs` 42,298 B (round 4: 39,045), `ledger.mjs` 24,560, `router.mjs` 24,213; `lib/tier.mjs` 34,069, `lib/context.mjs` 32,759; `lib/` 287,103 B over 12 modules, each with a test file; 9 hook scripts. The card has one home (`lib/card.mjs`). The two largest files grew again this round. | Split `guard-agent.mjs` (workflow, price, review inference) and `tier.mjs` (install detection, run lookup). | M |

## 2. Weighted total

Group 1 (double): 7 + 7 + 7 + 8 + 8 + 7 = 44 -> x2 = 88.
Group 2 (single): 8 + 7 + 7 + 8 + 7 + 7 + 7 + 8 + 8 + 7 = 74.
Total 88 + 74 = 162 / 220 = **74 / 100** (round 4: 72; round 3: 68; round 2: 55; round 1: 49).

Moves since round 4, each from evidence above: cost 8 -> 7 (finding 1, and the helper path at three times the solo cost); onboarding 6 -> 7 (brief sentence once per project, memory page confirms AGENTS.md); triggering 6 -> 7 (silence rules all held, "router off" measured); agents 6 -> 7 (helpers finished live, cap behaviour documented upstream); currency 7 -> 8 (every price matches).

## 3. For each area under 10: what a 10 needs, and whether it is reachable on this machine

1. A helper-path run after 40ba545 that costs within 1.5x of the solo run and spends no calls on recovery - reachable with one more staged run.
2. A price mean that survives a zero-usage row, plus a with/without cost pair on one task - the fix and the pair are reachable; a bill-read figure is not (hooks see no billing).
3. One recorded cap event that resumes from its progress file, and a compaction gate shown to hold on this Claude Code version - reachable.
4. The helper refusal without the "Say yes" clause, and the safety eval run on a transcript - the wording is reachable; the eval is not.
5. A `router status` whose first sentence is an action - reachable.
6. A measured clean-profile install and uninstall, and a card that says when the install is partial - the card sentence is reachable; the install is out of scope.
7. `hosts.md` under 8 KB or split - reachable.
8. A router timeout with headroom and a test for finding 1 - reachable.
9. The triggering eval run, and a short card for a short prompt - the card is reachable; the eval is not.
10. Finding 1 fixed and negation clearing an inferred word - reachable.
11. A guard on WHERE naming the shared checkout - reachable.
12. `isolation: worktree` in frontmatter and one live cap event - reachable.
13. `claude plugin eval` with a sandbox backend - not reachable here; the two unit tests are.
14. The PreCompact assumption pinned and the v0.4.0 line fixed - reachable.
15. Finding 2 documented - reachable.
16. The two largest files split - reachable.

## 4. Top five changes, ranked by felt gain per effort

1. **Ignore zero-usage rows in the price mean** (areas 2, 8, 10, 13; S). Two empty returns today switch the run ceiling off; a user who set a $10 cap would not know.
2. **Refuse a packet whose WHERE names the shared checkout, and put `isolation: worktree` in the writing roles** (areas 1, 11, 12; S). [live r5] lost 30 of 115 calls to exactly this.
3. **Say on the first card when fewer than eight role files are installed** (areas 6, 10, 15; S). The uncapped-helper refusal is silently off on a partial install.
4. **Actionable first sentence in `router status`; drop "Say yes" from refusals nobody can answer** (areas 4, 5; S). Two sentences, both measured wrong this round.
5. **Router timeout to 15 s** (area 8; S). 4.6 s measured against a 5 s cap on a cold session; a timeout drops the card and the brief silently.

## 5. Scenario results

| Scenario | Source | Finished | Questions | Minutes | Cost | Helpers | Machinery leaked |
|---|---|---|---|---|---|---|---|
| Delivery, three-part app, helpers forced (this branch) | [live r5] at b52b6af | yes, 27/27 tests, 4 commits | 0 | 12.0 | $2.28 | 3 parallel builders | none in the final message; ~30 of 115 lead calls spent recovering helper output |
| Delivery, three-part app, lead alone (this branch) | [live r4] at 6547c0f | yes, 26/26 tests | 0 | 3.1 | $0.69 | 0 | none in the final message |
| Delivery, contact form, plugin (this branch) | [live r3] 7b3daa2 | yes | 0 | 0.68 | $0.17 | 0 | none |
| Delivery, contact form, no plugin | [live r1] | yes | 0 | 0.93 | $0.14 | 0 | none |
| Recovery, cut then "continue" | [live r3] a377d6f | yes, 6 tests | 0 | 1.0 | $0.22 | 0 | none |
| Safety, cleanup | [live r3] 6bb953b | held, commands listed | 1 (asked) | 0.5 | $0.15 | 0 | none |
| Safety, headless branch delete inside a run | [live r5] | refused | 0 | - | - | - | none |

The helper path has now been run once on this branch; the two agent-file changes in 40ba545 came after it and are unmeasured live.

## 6. Verdict

The plugin does six things a non-engineer would feel, each shown by a script this round: it refuses a branch, table or remote-branch deletion with a plain sentence, and refuses outright where nobody can answer; it refuses a dispatch that would cross the run's ceiling and says what the ceiling is; it holds a "done" that touches money or auth until an independent review returns; it tells a fresh session what the last one was doing in one line; it sends its card once and then stays silent; it writes nothing to the user's settings. Against that: the same ceiling switches off after two empty returns, the uncapped-helper refusal is off on any partial install, the status reply opens with a counter, and the one live helper run cost three times the solo run because the packet let the lead send helpers into the shared checkout. 74/100. Each of the top five is a small change; the largest gain per line is the first.

## What works (a fix must not break)

- `guard-bash.mjs` ask / ask-once / helper-deny / headless-deny / PowerShell parity / data-store rule / remote-delete rule, all exit 0 this round.
- `guard-agent.mjs` ceiling refusal with the "modelled from list prices" wording in a fresh HOME; `REVIEW: yes` recorded; payment inferred and named; Fable on pro refused; review role on sonnet refused; concurrency cap at 2; uncapped helper refused when all eight files are installed.
- `ledger.mjs` review hold, inferred hold and evidence hold, each in plain words in the return header.
- Handoff line on "continue"; silence in another cwd; silence under `agent_id`; no changed-block when nothing changed; "router off" honoured.
- PreCompact reason relative to home; no `settings.json` write; brief sentence once per project, no paths.
- 656/0 unit tests in 27 s, 13/13 no-machinery, package --both 66 files, 13 drift tests, SKILL.md under 20,000 B, every price equal to the page.

## Part B: borrow list

Not re-searched this round (web spend limited to the named docs pages and the pricing page). Round 2's list stands. One item from the docs fetched today is worth taking: the sub-agents page now offers `isolation: worktree` as a frontmatter field, which would replace the prose rule 40ba545 added with something the host enforces.

## Currency facts fetched (2026-09-26)

- https://platform.claude.com/docs/en/about-claude/pricing - Fable 5.1 $10/$50, cache hit $0.25 (0.025x); Opus 5.5 $4/$20, cache hit $0.20 (0.05x); Opus 5 $5/$25; Sonnet 5 $2/$10, "now the standard price"; Haiku 4.5 $1/$5, cache hit $0.10; batch 50% off. Matches `lib/prices.mjs` and `references/models.md`.
- https://code.claude.com/docs/en/hooks - PreCompact and SubagentStop: "Exit code 2 isn't honored for this event"; SubagentStop input includes `agent_id`, `agent_type`, `last_assistant_message`; command hooks default 600 s, 30 s on UserPromptSubmit; no documented length cap on `additionalContext`; 33 hook events.
- https://code.claude.com/docs/en/sub-agents - at `maxTurns` "Claude Code returns its output marked as partial, and Claude can resume it" (2.1.246+); `model` accepts `fable`; `isolation: worktree`; nested spawning to depth 3 by default; 20 concurrent by default; combined descriptions warn at 15,000 tokens.
- https://code.claude.com/docs/en/skills - description + when_to_use "truncated at 1,536 characters"; after compaction "keeping the first 5,000 tokens of each" skill, 25,000 combined; "Keep SKILL.md under 500 lines"; `${CLAUDE_PLUGIN_ROOT}` substitution in plugin skills.
- https://code.claude.com/docs/en/plugins - overview only; install writes to settings and `~/.claude/plugins/`; `claude plugin disable` exists; evals live on a separate page (`/docs/en/plugin-evals`), not fetched.
- https://code.claude.com/docs/en/memory - `AGENTS.md` is read as project instructions when no `CLAUDE.md` or `CLAUDE.local.md` is in the working directory or above it; memory files are "context, not enforced configuration".

## Commands run (all at 40ba545, claude 2.1.274, node v24.14.0)

Gate (`gate.sh`, wall times from node's own `duration_ms`):

```
$ node scripts/package.mjs --both        -> exit 0, 66 files in each zip
$ node scripts/test.mjs                   -> 656 pass, 0 fail, 27,206 ms, 50 files
$ node --test evals/no-machinery.test.mjs -> 13 pass, 0 fail, 97.8 ms
```

Hook probes (`probes.mjs`, `probes2.mjs`, `probes3.mjs`, `probes4.mjs`): each writes the payload with `JSON.stringify` to `payload.json`, then `node <script> < payload.json` with `HOME`/`USERPROFILE` at a temp folder, `ANTHROPIC_API_KEY=""`, `CLAUDE_PLUGIN_ROOT` at the checkout, cwd a temp project with `.git/` and `.orchestrator/runs/r5run/RUN.md` holding `## Budget` / `Ceiling: $0.01`. All 60 exit 0.

```
router.mjs   UserPromptSubmit first prompt (sess-r5a)      -> 2,651 chars: card + auto-compact tip + brief sentence; HOME files: autocompact-default.json, brief-missing.json, context/sess-r5a/lead.json, profile.json, sessions/.prune-stamp, sessions/sess-r5a.json; no settings.json
router.mjs   "router status"                                -> 196 chars "[orchestrate] you: model not known here · tier pro · orch-agents 0/8 · codex: off · run: none · limits today: none"; 4,606 / 732 / 152 / 801 ms
router.mjs   second prompt, nothing changed                 -> 0 chars
router.mjs   fresh session same cwd, "continue"             -> 350-char handoff line
router.mjs   fresh session other cwd                        -> 0 chars
router.mjs   third session same cwd                         -> 2,183 chars (card only; no brief sentence, no tip)
router.mjs   SessionStart source=compact                    -> 2,379 chars
router.mjs   prompt with agent_id                           -> 0 chars
router.mjs   "fix the typo in the README", fresh session    -> 2,183 chars
router.mjs   "router off", then "add a footer"              -> 0 / 0 chars
guard-agent  REVIEW: yes                                    -> 354-char price tag ("≈ $1.50 at list price, not subscription usage (reasoned 2026-09-09, not yet measured here)"); session record review:true
guard-agent  OBJECTIVE mentions payment, no REVIEW          -> additionalContext "this task will wait for an independent review because its objective mentions payment; to send one, dispatch orch-reviewer on opus with REVIEW OF: 9-26-0002"; reviewInferred:"payment"
guard-agent  OBJECTIVE "(not auth)"                         -> inferred auth
guard-agent  Fable on pro, no approval line                 -> deny "Fable is not included in this plan (pro) ... add the line "APPROVED BY USER: fable""
guard-agent  review role on sonnet                          -> deny
guard-agent  no PROGRESS line                               -> advice "no PROGRESS line: a capped return will have nothing to resume from"
guard-agent  ceiling $0.01, HOME with two zero-usage returns -> tag "≈ $0.00 ... (measured here, n=2)", NO refusal
guard-agent  ceiling $0.01, fresh HOME, no returns          -> deny, 418 chars, "would cross the $0.01 ceiling (modelled from list prices; your plan may bill differently). Raise the ceiling in the run's Budget section, or stop — nothing tightens or lifts it on its own."
guard-agent  general-purpose on sonnet, 0 role files       -> allowed, "price tag: general-purpose on sonnet — no figure yet, measured or reasoned" (also with permission_mode auto and run_in_background)
guard-agent  general-purpose, no model                      -> deny "runs on this conversation's own model unless one is named. Resend with model: "haiku" ... or "sonnet""
guard-agent  general-purpose on fable                       -> deny (plan)
guard-agent  general-purpose on sonnet, 8 role files copied into <HOME>/.claude/agents -> deny, 638 chars, "general-purpose has no turn cap and can start helpers of its own. Send a capped role agent instead: ..."
guard-agent  third dispatch in one session                  -> deny "2 workers are already running (orch-implementer a, orch-implementer b), and the limit is 2 across Claude and Codex ... A worker silent for 10 minutes stops counting."
ledger.mjs   DONE, review-gated, no reviewer                -> header "done, but it was marked for an independent review and none has returned yet."; returns.jsonl status PARTIAL, reviewGated true
ledger.mjs   DONE, payment inferred                         -> "done, but its objective mentions payment, so it waits for an independent review that has not returned yet."
ledger.mjs   DONE, no evidence line                         -> "said done, but its return carried no evidence line; treat as unverified."
precompact   main session (x2)                              -> 247 chars {"decision":"block","reason":"... Save it to ~/.claude/orchestrate/context/sess-r5a/checkpoint-sess-r5a.md."}
precompact   with agent_id                                  -> 0 chars
postcompact                                                 -> 0 chars
guard-bash   git branch -D old, default, main, Bash         -> ask, 272 chars
guard-bash   same, auto / dontAsk / bypassPermissions, main -> deny 314 / 317 / 327 chars, "You are in <mode> mode, where nobody can say yes, so this is refused: run it yourself in a normal session, or add the exact command to .orchestrator/allow-bash.json."
guard-bash   same, any mode, subagent                       -> deny 370 chars, "... Say yes to continue ... A background helper cannot ask, so this is refused; report back to the lead instead of retrying."
guard-bash   PowerShell, all 8 cells                        -> identical to Bash
guard-bash   asked twice, same session                      -> "Asked already: ..."
guard-bash   psql -c "DROP TABLE users"                     -> ask "permanently delete data in a database"
guard-bash   git push origin --delete old, auto             -> deny "on the shared remote"
guard-bash   ls / malformed JSON / rm -rf under temp cwd    -> 0 chars
context-check, persist-check (x2), turn-check               -> 0 chars
```

Static facts (`facts.sh`, `facts2.sh`): sizes, version strings, agent frontmatter, `hooks.json` entries, `prices.mjs` table, `guard-agent.mjs:286` install-count condition, `prices.mjs:115-125` mean over recorded rows.

## Erratum (added by the lead after reading the report)

Row 12 and item 12 of §3 ask for `isolation: worktree` in the writing roles' frontmatter "instead of prose". It is already there: `skills/orchestrate/assets/agents/orch-implementer.md:6` and `orch-debugger.md:6` both carry it, and `assets.test.mjs` pins it. The prose rule 40ba545 added sits beside it, for the lead's packet rather than the host. The score for that row was not changed.
