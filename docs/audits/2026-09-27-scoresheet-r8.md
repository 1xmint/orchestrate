# Scoresheet audit, round 8 (2026-09-27)

- Commit: `5c1382b50f3c598ad85768251c7594f501a249fc` (branch `audit/scoresheet-to-ten`; `main` at the same commit)
- Claude Code: 2.1.274; node v24.14.0; Windows 10 Home 10.0.19045
- Auditor: Claude Fable 5.1, no repo install, no staged sessions; hook scripts fed sample payloads on stdin from one probe script (`<tmp>/orch-audit-r8/probe.mjs`) with HOME and USERPROFILE pointed at fresh temp folders (`profile.json` = `{"tier":"pro"}`, no role files, empty `ANTHROPIC_API_KEY`), each probe against a fresh throwaway git repository under the OS temp dir
- Prompt: `docs/scoresheet-audit-prompt.md` (current for v0.16.1). Rounds 1-7 scored 49, 55, 68, 72, 74, 81, 87. None is a prior; every area is scored from evidence this round produced or the named documents record.
- Commits since round 7: `7c7ed7d..5c1382b`, 14 commits, 17 files, +1,384 / -639 lines. In one line each: return pairing by `tool_use_id` (26cd68e), README task-id rule (7d62e2b), `lib/context.mjs` split (ea2f3d8), slot freed from the Agent tool's PostToolUse result (e917eea), scrubbed resumed-helper fixture (8a0dc82), per-segment turn count (bcfba22, c22feff), cap note names the cap (3f83ad0), resume rule aligned (5b3c326), unforced delete of `worktree-agent-*` branches allowed (5c1382b), live-runs r8 write-up (95fc516).

## How to read the evidence

- **[measured]** - a command this auditor ran at 5c1382b; commands and outputs under "Commands run".
- **[live r8]** - the lead's four live runs at 7d62e2b, `docs/audits/2026-09-27-live-runs-r8.md`. Two fixes it names (per-segment turn count; pairing via the Agent tool result) are on 5c1382b and are measured here by probe against the fixture it left behind.
- **[live r7]** - the lead's delivery run at ad385c3, `docs/audits/2026-09-27-live-runs-r7.md`.
- **[read]** - read from source with a file:line; never worth more than a 6 on its own.
- **[docs]** - a page fetched 2026-09-27, listed under "Currency facts fetched".

**No live run this round by the auditor.** The context budget was spent on probes; the one permitted headless run was skipped. Areas 1-6 are scored from [live r8], [live r7] and the probes. **Eval results remain unmeasured on this machine** (`claude plugin eval` has no sandbox backend here).

**What round 7 asked for, now measured.** Round 7's top five: (1) match returns to dispatches by `tool_use_id` - done and widened: the Agent tool's own PostToolUse result now frees the slot (`skills/orchestrate/scripts/context-check.mjs:164-194`), measured below as a four-step probe; (2) show the solo estimate beside the helper estimate - not done, the card carries no pair; (3) one staged run at or after cd94b7a - done by the lead as four runs at 7d62e2b [live r8], including the first live cap event and the first live kill-by-name refusal; (4) the task-id rule in the README - done (`README.md:216`); (5) split `context.mjs` - done (`lib/context-advice.mjs` 14,843 B, `lib/context-scan.mjs` 10,449 B, `lib/context-store.mjs` 8,380 B, `lib/context.mjs` 2,454 B shim), but none of the three new modules has a test file of its own.

Findings this round that no earlier round recorded:

1. **Three lib modules have no test file named for them** [measured]: `context-advice`, `context-scan`, `context-store` (29 modules, 26 `lib/*.test.mjs`). Round 7 recorded 26/26. `lib/context.test.mjs` still exists and the suite passes 856/0, so the behaviour may be covered through the shim; the one-file-one-test rule the repo set itself in round 6 is no longer true.
2. **The first-prompt card grew to 2,972 B** [measured] from 2,504 B in round 7 (+468 B, 19%), with two role names in it (`orch-advisor`, `orch-coordinator`). Nothing else in the per-turn path grew: second prompt 0 B, `context-check` 0 B over forty calls.
3. **Two round-7 probes did not reproduce here, cause unresolved** [measured]: `router.mjs status` with `{}` on stdin printed 0 B (round 7: 281 chars opening with an action; `router.mjs:540-541` reads the argument); `persist-check.mjs` on a Stop whose message read "Everything is committed and the login page works." with `c.txt` untracked printed 0 B (round 7: 195 chars naming the file; `persist-check.mjs:167-191`, phrases at `lib/commit-claim.mjs:10-17`). `hooks.test.mjs` and `persist-check.test.mjs` pass, so the difference is most likely the probe's wording or a field the probe omitted (`transcript_path`), not a regression; it is recorded because a rerun with the round-7 payloads is the only way to settle it.
4. **The docs contradict one sentence in the guard** [docs]: the sub-agents page says a background subagent's permission prompt is surfaced in the main session and named there; `guard-bash.mjs` denies inside any helper with "A background helper cannot ask, so this is refused". True under headless `-p` (where [live r8] run 3 recorded it), not true in an interactive session. The deny is the safer choice; the reason given is not the whole truth.

## 1. Score table

| # | Area | Score | Reason | Change | Effort |
|---|------|-------|--------|--------|--------|
| 1 | Delivery (x2) | 9 | [live r8] four prompts built to reach the pressure paths, all finished and committed at 7d62e2b: requirements (307 s, $1.04, 13 tests, the contradiction found), hidden spec (207 s, $0.82, 4 of 4 hidden requirements found, 21 tests), one helper capped and resumed (347 s, $0.93 lead + $0.56 helper at list, 25 tests, work complete), twelve meetings with two compactions (174 s, $1.62, 12 of 12 lines right). [live r7] three-part app 342 s, $1.83 vs $0.69 solo. No run at 5c1382b by this auditor. The with/without pair is still not shown to the user. | Show the solo estimate beside the helper estimate on the card when a run opens. | M |
| 2 | Cost and time (x2) | 8 | [live r8] $0.82-1.62 per run, 174-347 s, none near the $10 budget; run 3's total is uncertain by $0.56 because the stream may or may not include the helper. [measured] every dispatch is priced by `guard-agent.mjs` at list price (round 7 wording unchanged; `git diff 7c7ed7d..5c1382b` touches no pricing line); base prices equal the pricing page [docs]. The ratio against solo work is unchanged since round 4 and unseen by the user; a bill-read figure is impossible from a hook. | Put the solo estimate beside the helper estimate. | M |
| 3 | Recovery (x2) | 8 | [measured] fresh session, same cwd, "continue": one 316-B line ("Your last session in this folder, 1 minute ago, was working on: ... run `git status` ... carry on from there or say what you want instead."). [measured] the fixture the live cap event left (`fixtures/resumed-helper-transcript.jsonl`, 148 lines, 30 user records, 51 assistant records): `segmentTurns` = `{total: 28, segment: 8}`, `transcriptTurns` = 28; fed to `ledger.mjs` as an `orch-advisor` return (cap 12) the record is `status DONE`, no `capped` (round 7's code would have called 28 >= 12 capped); a synthetic 20 + resume + 12 transcript is `capped: true, turns: 32, cap: 12`, and the lead's next tool call gets one 376-B note "used all 12 turns it is allowed ... SendMessage it now while it is warm", 0 B on the call after. [live r8] run 3: the helper capped at 20, was resumed by SendMessage, finished in 8 turns; the plugin's Stop hook did not fire at the cap (the host's own notification did), and the compaction gate's block reason under automatic compaction reached nobody (run 4) - not changed at 5c1382b. | Move the checkpoint ask into the meter notice before the compact mark; drop the gate's reliance on a reason nobody sees. | M |
| 4 | Safety (x2) | 9 | [measured] `guard-bash.mjs`, 27 cells, all exit 0: `git branch -d worktree-agent-abc123` (and `--delete` of two such names) silent in default, auto and helper; `-D` of the same name ask (162 B) / deny auto (203 B) / deny helper (136 B); `-d feature/login`, `-d worktree-agent-abc123 && rm -rf uploads`, and the upper-case `worktree-agent-ABC` all ask or deny; `taskkill //F //IM node.exe` ask 268 B / deny 309 / deny 242; `git push origin --delete old` ask 222 / deny 263 / deny 196; `ls` silent; PowerShell tool same as Bash; malformed stdin silent. [live r8] the kill-by-name rule refused a helper live for the first time (run 3) and the forced branch delete was refused in auto mode. [docs] finding 4: the helper-deny reason overstates what the host does. Scenario 3 not re-run. | Reword the helper deny to "cannot be answered here" and let interactive sessions ask; run scenario 3 once. | S |
| 5 | Communication (x2) | 9 | [live r8] four final messages "without task ids, role names or grades"; the one noise recorded live (the partial note three times for a finished helper) is fixed and [measured] said once (376 B) then 0 B. [measured] the card: 2,972 B on the first larger prompt, 0 B on the second, 366 B for "fix the typo in the README", two role names in the full card; `plain.md` 4,679 B and SKILL.md section 9 (`SKILL.md:317`) unchanged since round 7; `evals/no-machinery.test.mjs` 13/13. [live r8] the "no PROGRESS line" warning fired three times on a short read-only helper (noise), and the compaction block reason reached nobody. | Silence the PROGRESS warning for read-only roles. | S |
| 6 | Onboarding (x2) | 9 | [measured] the first prompt in a fresh HOME wrote `autocompact-default.json`, `brief-missing.json`, `profile.json`, `sessions/.prune-stamp`, three session records - no `settings.json`; `profile --brief` 981 B naming the eight missing role files. [live r8] `claude plugin install` into a throwaway home succeeded, eight agents and hooks registered, real settings file untouched (same modification time) - round 7's ask done. [measured] `router status` printed 0 B with `{}` on stdin (finding 3, unresolved). Uninstall unmeasured. | Measure uninstall on the throwaway home; settle finding 3. | S |
| 7 | Context efficiency | 9 | [measured] SKILL.md 19,985 B, 354 lines; card 2,972 / 0 / 366 B; `context-check` 0 B and at most 87 ms per call over forty calls with no transcript; `profile --brief` 981 B; `lib/` 219,279 B across 29 modules (round 7: 212,001 / 26; the split added a 2,454-B shim and the pairing code); `hosts.md` 5,300 B, `claude-code.md` 15,164 B still named for debugging only; agent files unchanged since round 7. Finding 2: the card grew 468 B. | Bring the first card back under 2,500 B. | S |
| 8 | Hook reliability | 8 | [measured] 10 leaf entries in `hooks/hooks.json` (9 scripts), timeouts 5-15 s; every probe this round exit 0 in under 150 ms; malformed JSON silent; the slot-pairing probe: two builders running -> third dispatch denied "2 workers are already running (orch-implementer 9-9-0011, orch-implementer 9-9-0012), and the limit is 2"; PostToolUse `Agent` `{status: completed, agentId}` -> row gains `agentId` and `returnedAt`; third dispatch allowed; `async_launched` -> `agentId` only; SubagentStop with no transcript file -> return `agentId agent-y`; fourth dispatch allowed - round 7's finding 1 closed. [live r8] SubagentStop does not fire at a background helper's cap; PreCompact's block is invisible under automatic compaction and only delays by one step. [docs] PreCompact is absent from the exit-code-2 table. Finding 3: two round-7 probes silent here, unresolved. | Rerun the two silent probes with round 7's exact payloads; stop relying on the PreCompact reason. | S |
| 9 | Triggering | 8 | [measured] a small first prompt -> 366 B; a larger one -> the full card once; the next prompt 0 B; "continue" -> the handoff line only; the card is skipped under `agent_id` (unchanged code path in `router.mjs`). [live r8] the skill fired on all four prompts, the guard redirected a `general-purpose` dispatch to a role agent (run 1). The `skill-fired` grader is unmeasured. | The triggering eval run - not reachable here. | - |
| 10 | Routing mechanics | 9 | [measured] the worker count pairs a return four ways in order (`lib/workers.mjs:149-192`): `returnedAt`, `agentId`, `toolUseId`, transcript map; the comment now records that SubagentStop carries no `tool_use_id`, matching [docs]; the concurrency refusal and release measured as above; cap decisions by segment (`ledger.mjs:422-430`). [live r8] the guard's redirect and price tag fired live. Not done: the solo-vs-helper choice is still the lead's guess. | Nothing mechanical left but the pair on the card. | M |
| 11 | Packets and proof | 8 | [measured] a capped return is `PARTIAL` whatever it says, with `cap` recorded beside `turns` (synthetic probe `turns 32, cap 12`; `ledger.mjs:489`); a resumed helper under its cap keeps its `DONE`. [live r8] the "no PROGRESS line" warning is noise for read-only helpers; the plugin's own record priced the helper separately ($0.56) when the stream did not settle it. Finding 3: the commit-claim probe printed 0 B here. | Settle the commit-claim probe; gate the PROGRESS warning by role. | S |
| 12 | Agents | 9 | [read] agent files unchanged since round 7 (`git diff --stat 7c7ed7d..5c1382b` lists none): maxTurns 12/80/150/120/100/80/80/60, `isolation: worktree` on the two writing roles; [measured] `roleMaxTurns('orch-implementer')` = 100, `general-purpose` = null. [live r8] the first live cap event (staged cap 20) resumed by SendMessage and finished - round 7's ask done. [docs] `maxTurns` partial marking 2.1.246+, `omitClaudeMd` 2.1.271+ unused, 20 concurrent subagents by default while the plugin holds 2. | `omitClaudeMd` for the two read-only roles. | S |
| 13 | Tests and evals | 8 | [measured] `node scripts/test.mjs` 856 pass / 0 fail, 32 s (round 7: 843); `node --test evals/no-machinery.test.mjs` 13/13, 93 ms; `assets.test.mjs` 32/32, 164 ms; `package.mjs --both` 77 files per zip; 23 scripts each with a test file; new tests pin the segment count, the four pairings, the cap wording and the `-d worktree-agent-*` exception (`workers.test.mjs:336-370`, `hooks.test.mjs:666,1046`, `guard-bash.test.mjs:47`). Finding 1: 3 of 29 lib modules without a named test. Eval results unmeasured. | Add `context-advice/scan/store.test.mjs`; the eval needs a sandbox backend. | S |
| 14 | Currency | 8 | [docs] pricing page: Fable 5.1 $10/$50 cache hit $0.25; Opus 5.5 $4/$20/$0.20; Sonnet 5 $2/$10 "now the standard price"; Haiku 4.5 $1/$5/$0.10 - `lib/prices.mjs:24-27` and `models.md:13-16` unchanged since round 7's line-by-line check. [docs] hooks: SubagentStop fields are `agent_id`, `agent_type`, `last_assistant_message` (no `tool_use_id`; `agent_transcript_path` not documented though the CLI sends it [live r8]); PostToolUse carries `tool_use_id`; PreCompact absent from the exit-2 table; default command timeout 600 s, 30 s on UserPromptSubmit. [docs] sub-agents: background helpers' permission prompts are surfaced in the main session (finding 4); `SendMessage` resumes a capped agent - the plugin's rule now says the same (`SKILL.md:238-240`). | Reword the helper deny reason; re-check after 2.1.277. | S |
| 15 | Documentation honesty | 8 | [measured] one version string 0.16.1 in `plugin.json`, `SKILL.md:20`; `README.md:216` carries the task-id rule (round 7's ask); SKILL.md, `dispatch.md` "Partial returns" and the ledger note agree on the resume rule. Not found: `README.md` has no line for the new exception that lets `git branch -d worktree-agent-*` through (grep for `worktree-agent` in README: 0 hits) while `guard-bash.mjs:147-155` does it. STATE.md still headed "Unreleased" at a released version. [live r8] the write-up records its own misses. | Add the `-d worktree-agent-*` exception to the README's guard row. | S |
| 16 | Maintainability and deletion | 9 | [measured] `context.mjs` split done: 14,843 + 10,449 + 8,380 B plus a 2,454-B re-export shim; `guard-agent.mjs` 31,333 B, `router.mjs` 28,679, `ledger.mjs` 25,402, `workers.mjs` 25,419 (grew for the pairing comment and code); 29 lib modules, 23 scripts, 39 script tests. The shim could be deleted once its importers point at the new modules (2,454 B saved, no behaviour lost). Finding 1: the three new modules carry no test of their own. | Delete the shim and add the three test files. | S |

## 2. Weighted total

Group 1 (double): 9 + 8 + 8 + 9 + 9 + 9 = 52 -> x2 = 104.
Group 2 (single): 9 + 8 + 8 + 9 + 8 + 9 + 8 + 8 + 8 + 9 = 84.
Total 104 + 84 = 188 / 220 = **85 / 100** (round 7: 87; round 6: 81; round 5: 74).

Moves since round 7, each from evidence above: hook reliability 9 -> 8 (finding 3's two silent probes, and the two host facts [live r8] the code cannot work around yet); packets 9 -> 8 (commit-claim probe silent, PROGRESS warning noise live); tests 9 -> 8 (26/26 became 26/29); currency 9 -> 8 (finding 4); docs honesty 9 -> 8 (README silent on the new guard exception); agents 8 -> 9 (cap event recorded live and resumed). Unchanged: delivery 9, cost 8, recovery 8, safety 9, communication 9, onboarding 9, context 9 (card grew but the per-turn path is still 0 B), triggering 8, routing 9, maintainability 9. The drop is not a regression in what the user feels; it is four engine areas measured more closely than before, and two probes this auditor could not settle.

The weights fit the audience; no change proposed.

## 3. For each area under 10: what a 10 needs, and whether it is reachable on this machine

1. A helper-path run within 1.5x of the solo cost, or the pair shown so the user chooses - the pair is reachable (a card sentence); the ratio has not moved in five rounds.
2. The with/without pair on the card - reachable; a bill-read figure is not (hooks see no billing).
3. The checkpoint asked for where the lead can see it (the meter notice), not in a PreCompact reason - reachable; a live automatic compaction to prove it needs a staged run with `CLAUDE_CODE_AUTO_COMPACT_WINDOW`, which the lead has done once.
4. The helper deny reason matching the docs, and scenario 3 run once at this commit - both reachable.
5. The PROGRESS warning gated by role and one more live run with no noise - reachable.
6. Uninstall measured on a throwaway home, and `router status` settled - reachable.
7. The first card back under 2,500 B - reachable, 468 B of prose.
8. Finding 3 settled with round 7's exact payloads; the two host facts (SubagentStop timing, PreCompact visibility) need a Claude Code change or a redesign around the meter notice - the first is reachable now.
9. The triggering eval - not reachable here (no sandbox backend).
10. Nothing mechanical; the pair on the card - reachable.
11. Commit-claim probe settled; PROGRESS warning by role - reachable.
12. `omitClaudeMd` on the two read-only roles - reachable, two lines.
13. Three test files, and the eval - the files are reachable; the eval is not.
14. Re-check after Claude Code passes 2.1.277 - not yet possible here.
15. One README sentence - reachable.
16. Delete the shim, add the tests - reachable.

## 4. Top five changes, ranked by felt gain per effort

1. **Gate the "no PROGRESS line" warning by role and settle finding 3** (areas 5, 8, 11; S). [live r8] the warning fired three times on a read-only helper; the two silent probes are the only measurements this round that disagree with round 7.
2. **Show the solo estimate beside the helper estimate** (areas 1, 2, 10; M). Five live rounds put the helper path at 2.6x or more on a small app; the user has never seen the pair.
3. **Ask for the checkpoint in the meter notice, not the PreCompact reason** (areas 3, 8; M). [live r8] run 4: the block reason reached nobody, no checkpoint was written, and the gate only delayed compaction by one step.
4. **Add the three test files and delete the `context.mjs` shim; add the `-d worktree-agent-*` line to the README** (areas 13, 15, 16; S). Restores the one-file-one-test rule and one source of truth for the guard.
5. **Reword the helper deny and use `omitClaudeMd` on the read-only roles** (areas 4, 12, 14; S). The docs say the host surfaces a background helper's prompt in the main session; the plugin says it cannot ask.

## 5. Scenario results

| Scenario | Source | Finished | Questions | Minutes | Cost | Helpers | Machinery leaked |
|---|---|---|---|---|---|---|---|
| Requirements one file at a time, helper reads 31 files | [live r8] at 7d62e2b | yes, committed, 13 tests, contradiction found | 0 | 5.1 | $1.04 | 1 researcher (1 dispatch refused by the guard, redirected) | none in the final message; PROGRESS warning x3 to the lead |
| Hidden requirements in a 12,000-line spec | [live r8] | yes, committed, 4/4 hidden requirements, 21 tests | 0 | 3.5 | $0.82 | 0 | none; the lead left a server running on port 3000 |
| One helper for the whole build (cap staged at 20) | [live r8] | yes, committed, 25 tests; helper capped then resumed | 0 | 5.8 | $0.93 lead + $0.56 helper at list | 1 implementer | false "partial" note x3 (fixed at c22feff, measured once-only here); kill-by-name refused live |
| Twelve meetings, two automatic compactions | [live r8] | yes, committed, 12/12 lines right | 0 | 2.9 | $1.62 | 0 | none in the final message; compaction block reason invisible |
| Delivery, three-part app, helpers forced | [live r7] at ad385c3 | yes, 28/28 tests, 5 commits | 0 | 5.7 | $1.83 | 3 builders | none in the final message; one false Stop block (fixed cd94b7a) |
| Delivery, three-part app, lead alone | [live r4] | yes, 26/26 tests | 0 | 3.1 | $0.69 | 0 | none |
| Delivery, contact form, plugin / no plugin | [live r3] / [live r1] | yes / yes | 0 / 0 | 0.68 / 0.93 | $0.17 / $0.14 | 0 / 0 | none / none |
| Recovery, cut then "continue" | [live r3] | yes, 6 tests | 0 | 1.0 | $0.22 | 0 | none |
| Safety, cleanup prompt | [live r3] | held, commands listed | 1 (asked) | 0.5 | $0.15 | 0 | none |

No scenario was run by this auditor at 5c1382b; the rows are the last live numbers, and the two fixes named in [live r8] are measured by probe above.

## 6. Verdict

At 5c1382b the plugin does, by measurement, what a non-engineer would feel: it asks before a branch or every program of one name is deleted and refuses outright where nobody can answer; it lets a helper's own merged worktree branch be cleaned up without asking; it refuses a third helper while two are running and frees the slot the moment the Agent tool says one came back, with or without a transcript file; it tells a helper that used its whole allowance apart from one that was resumed and finished; it names the cap, not the turn count; it tells a fresh session in one sentence what the last one was doing; and a one-line request gets a 366-byte card. The lead's four live runs, built to hit the pressure paths, all finished and committed with clean final messages, and the two misses they surfaced are fixed and measured here. What it only claims: that a background helper cannot ask (the host says otherwise in an interactive session); that the compaction gate protects anything under automatic compaction (its reason reaches nobody); and that every module is tested (three are not). The number is 85, two below round 7, because four engine areas were measured more closely and two probes did not reproduce. A friend who cannot code should install it: the things it stops are the things that would have cost them a repository, and the app gets built.

## What works (a fix must not break)

- `guard-bash.mjs`: 27 cells this round, all exit 0; `-d`/`--delete` of `worktree-agent-<hex>` names only silent; `-D`, other names, mixed lists, remote deletes, kill-by-name ask / deny-auto / deny-helper with no "Say yes" where nobody can answer; PowerShell parity; malformed stdin silent.
- Worker slot: refusal naming both running helpers; release by `returnedAt`, by `agentId`, by SubagentStop with no transcript file; fourth dispatch allowed.
- Per-segment cap: fixture `{total 28, segment 8}` -> `DONE`; synthetic 20+12 -> `capped, turns 32, cap 12`; note said once, names the cap.
- Router: 2,972 B once, 0 B after, 366 B for a small first prompt, 316-B handoff on "continue", no `settings.json` write.
- 856/0 in 32 s; 13/13 no-machinery; 32/32 assets; 77 files per package; SKILL.md 19,985 B / 354 lines.

## Part B: borrow list

Not re-searched this round (web spend limited to three docs pages). Round 2's list stands. From the pages fetched today: the sub-agents page's `omitClaudeMd: true` (2.1.271+) for the two read-only roles; its statement that background helpers' prompts surface in the main session, which the guard should say instead of "cannot ask"; the hooks page's absence of PreCompact from the exit-2 table, which matches [live r8] run 4 and argues for moving the checkpoint ask to the meter notice.

## Currency facts fetched (2026-09-27)

- https://platform.claude.com/docs/en/about-claude/pricing - Fable 5.1 $10 / $50, cache hit $0.25; Opus 5.5 $4 / $20, cache hit $0.20; Sonnet 5 $2 / $10 ("now the standard price"; the September rise "will not occur"); Haiku 4.5 $1 / $5, cache hit $0.10.
- https://code.claude.com/docs/en/hooks - SubagentStop fields: `agent_id`, `agent_type`, `last_assistant_message` (no `tool_use_id`); PostToolUse carries `tool_use_id`; PreCompact not in the exit-code-2 table; command default 600 s, 30 s on UserPromptSubmit.
- https://code.claude.com/docs/en/sub-agents - `maxTurns` partial marking 2.1.246+, resume by `SendMessage`; `omitClaudeMd` 2.1.271+; `fable` alias; background subagents' permission prompts surfaced in the main session; 15,000-token description warning; 20 concurrent subagents by default.

## Commands run

All from `<repo>` at 5c1382b unless noted; outputs captured under `<tmp>/orch-audit-r8/`.

```
git rev-parse HEAD                                   # 5c1382b50f3c598ad85768251c7594f501a249fc
git log --oneline 7c7ed7d..5c1382b                   # 14 commits
git diff --stat 7c7ed7d..5c1382b                     # 17 files, +1384 -639
git diff 7c7ed7d..5c1382b -- SKILL.md dispatch.md README.md guard-bash.mjs context-check.mjs ledger.mjs lib/workers.mjs
claude --version                                     # 2.1.274
node --version                                       # v24.14.0
node scripts/test.mjs > <tmp>/test-full.txt          # pass 856 fail 0, 32 s
node --test evals/no-machinery.test.mjs              # pass 13 fail 0, 93 ms
node --test skills/orchestrate/scripts/assets.test.mjs   # pass 32 fail 0, 164 ms
node scripts/package.mjs --both                      # 77 files per zip
wc -c SKILL.md README.md STATE.md AGENTS.md CLAUDE.md references/*.md assets/agents/*.md assets/output-styles/*.md assets/packet.md
wc -c scripts/lib/*.mjs (non-test)                   # 219,279 B, 29 modules; 26 lib test files; 23 scripts, 39 script tests
node -e "import('file:///<repo>/skills/orchestrate/scripts/lib/workers.mjs').then(m => ...segmentTurns(fixture), transcriptTurns(fixture), roleMaxTurns(...))"
                                                     # {total:28, segment:8}; 28; implementer 100, general-purpose null
node <tmp>/orch-audit-r8/probe.mjs                   # router x5, profile --brief, guard-bash 27 cells + PowerShell + malformed,
                                                     # ledger x4 (fixture as advisor and implementer, synthetic 20+12, no-transcript return),
                                                     # context-check x44 (capped note twice, PostToolUse Agent completed / async_launched, 40 plain calls),
                                                     # guard-agent x3 (deny with two running, allow after one completed, allow after both freed),
                                                     # persist-check x3 (commit claim, repeat, helper)
WebFetch pricing, hooks, sub-agents pages            # listed above
```
