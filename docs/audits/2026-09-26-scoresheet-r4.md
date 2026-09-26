# Scoresheet audit, round 4 (2026-09-26)

- Commit: `2415dfb38e4e7c40ba1e1a1641da4cad1de853a1` (branch `audit/scoresheet-to-ten`, read from `.git/refs/heads/audit/scoresheet-to-ten`; the auditor's own worktree sits on a different commit and was used only as a cwd for the Bash-guard probes)
- Claude Code: 2.1.274 (`claude --version`); node v24.14.0; Windows 10 Home 10.0.19045
- Auditor: Claude Fable 5.1, no repo install, no staged sessions; hook scripts fed sample payloads on stdin with HOME and USERPROFILE pointed at a fresh temp folder
- Prompt: `docs/scoresheet-audit-prompt.md` (current for v0.16.1). Rounds 1-3 scored 49, 55, 68. None is a prior; every area is scored from evidence this round produced or the named documents record.

## How to read the evidence

- **[measured]** - a command this auditor ran at 2415dfb; the exact command and output are under "Commands run".
- **[live r4]** - the lead's live run of this branch, `docs/audits/2026-09-26-live-runs-r4.md` (at 6547c0f; the later router split moved code and changed no behaviour).
- **[live r3]** / **[live r1]** - `docs/audits/2026-09-24-live-runs-r3.md` and `docs/audits/2026-09-24-live-runs.md`.
- **[obs]** - `.orchestrator/runs/20260924-audit-to-ten/observations.md`, the lead's field notes. Status-line and recover notices in those notes came from the OLD installed copy, not this branch, and are marked so where cited.
- **[read]** - read from source with a file:line; never worth more than a 6 on its own.
- **[docs]** - a page fetched 2026-09-26, listed under "Currency facts fetched".

**Eval results are unmeasured on this machine.** `claude plugin eval` cannot run here (no sandbox backend on this platform). The eval layer is judged from the four case folders, their graders, and `node --test evals/no-machinery.test.mjs`. The helper path (a live dispatch by this branch) is also unmeasured live: [live r4] finished a three-part app with zero helpers because the lead chose to build it itself.

## 1. Score table

| # | Area | Score | Reason | Change | Effort |
|---|------|-------|--------|--------|--------|
| 1 | Delivery (x2) | 7 | [live r4] a three-part Node app: finished, 26/26 tests, 0 questions, 24 turns, 185 s, $0.69, 0 helpers, final message told the user how to run it and named one caveat. The card's helper rule was read and set aside ("I'll build this directly", 23 tool calls against "about eight"). [obs 2026-09-26] three of three helpers in the lead's own run stopped at a 100-turn cap with work uncommitted and no return; that cap is the plugin's own `maxTurns: 100` in `assets/agents/orch-implementer.md` [measured], and no packet, card or reference line tells a helper to commit before it [measured: grep for "turn cap", "before turn", "commit what passes" hits only `references/dispatch.md:20`, which is about `general-purpose`]. The extra passes have still not been seen changing an output. | Put one line in `assets/packet.md` and the card: commit what passes before turn 70 and return; then run one delivery where a helper is forced and compare it to the no-plugin baseline on the `page-actually-works` grader. | M |
| 2 | Cost and time (x2) | 8 | [live r4] $0.69 / 185 s for the three-part app (no same-task baseline). [measured] a dispatch that would cross the run's ceiling is refused by `guard-agent.mjs`, not advised: "this orch-implementer is about $1.5 at list price, and run r4run has already spent about $0, so it would cross the $0.01 ceiling (modelled from list prices; your plan may bill differently). Raise the ceiling in the run's Budget section, or stop - nothing tightens or lifts it on its own." [measured] the price tag on an allowed dispatch says "~ $1.50 at list price, not subscription usage (reasoned 2026-09-09, not yet measured here)". [measured] `scripts/lib/prices.mjs` = pricing page for Fable 5.1 10/50, Opus 5.5 4/20, Sonnet 5 2/10, Haiku 4.5 1/5. [read] `guard-agent.mjs` refuses Fable on a plan that does not include it unless the packet carries "APPROVED BY USER: fable". Concurrency cap 2 held mechanically [obs]. | Run the same prompt with and without the plugin once so the cost delta is a number; keep the ceiling. | S |
| 3 | Recovery (x2) | 7 | [measured] fresh session, same cwd, prompt "continue": one 350-char plain line, "Your last session in this folder, 1 minute ago, was working on: "add login with email and password, a profile page, and tests". Uncommitted changes, if any, are what it left behind; run `git status`...". "carry on with the login" in another fresh session gets the same line plus the card (round 3's exact-phrase gap is closed). Other cwd: 0 chars. [live r3] the cut-then-continue run finished the feature with no question. [measured] PreCompact reason names no absolute path - and no path at all: "Save it to the checkpoint file this plugin keeps for this session, under the plugin's own folder in your home directory", so the model must find the file by other means. [docs] the hooks page does not list PreCompact among events that can block, so the checkpoint gate is a request, not a stop. STATE.md 16,742 B, under the 100 KB bar. | Print the checkpoint path relative to the home folder (`~/.claude/orchestrate/...`) and move the checkpoint request to a hook that can hold the turn, or state in the card that it is advisory. | S |
| 4 | Safety (x2) | 8 | [measured] `guard-bash.mjs`: `git branch -D old` in a main session -> `ask` with "This would permanently delete a branch. Say yes to continue. If nobody can answer here, stop and tell the user what you were about to run instead of trying again."; second time same session -> "Asked already: ..."; PowerShell tool -> same `ask`; with `agent_id`, Bash and PowerShell -> `deny` ending "A background helper cannot ask, so this is refused; report back to the lead instead of retrying."; `psql -c "drop table users"` -> `ask` "This would permanently delete data in a database, which cannot be undone..." (round 3 gap closed); malformed JSON -> silent exit 0. [measured] `guard-agent.mjs` refuses a dispatch over the run ceiling (area 2). [live r3] the cleanup request was held and listed for the user; [live r1] the old copy deleted branches silently. [docs] sub-agents page: AskUserQuestion is removed from every subagent, so the helper-side deny is the right shape. Gap: [obs] in the lead's own auto-permission session the `ask` was answered by the session itself, so an ask is only as safe as who answers it; the safety eval grader remains unrun. | Under `auto`/`bypassPermissions` in a headless run, turn the branch/data `ask` into `deny` with the same plain reason, and run `evals/safety-branch-cleanup` where evals can run. | S |
| 5 | Communication (x2) | 8 | [measured] the first-prompt card is 2,706 chars and carries no state line, counters, model name or tier (round 3's first change landed); the state line now appears only on `router status` (205 chars: "you: model not known here · tier unknown · orch-agents 0/8 · codex: off · run: none · limits today: none"). A second prompt with nothing changed prints 0 chars. [live r4] the final message: plain words, choices named, one caveat, no ids, roles, grades or dollars. [measured] `evals/no-machinery.test.mjs` 13/13. Leaks that remain: the card's last line, `[orchestrate · brief] no "What this is for" section in C:\...\proj (checked CLAUDE.md, ...). Template: C:\...\assets\BRIEF.md`, puts two absolute machine paths in front of the model on turn one; the `router status` reply is still counters ("orch-agents 0/8 · codex: off"), and its first sentence is not a thing to do. | Rewrite the brief line as one sentence with no path ("this project has no brief yet; say what it is for and I will write one"), and make `router status` lead with the one actionable sentence `actionableLine` already computes. | S |
| 6 | Onboarding (x2) | 6 | [measured] the first substantive prompt in a fresh temp HOME wrote no `settings.json`; the only files were `autocompact-default.json` (the marker), a session record and a prune stamp; the real `~/.claude/settings.json` mtime was 12:25:42 before and after (the same value [live r4] recorded). [measured] `README.md:848` now gives `node scripts/test.mjs`, which runs here. [measured] 13 drift tests in `docs-drift.test.mjs` hold README counts, names, uninstall list and hooks table to code. Not measured: an install from a clean profile and the uninstall round trip (out of scope this round). [obs] the Write tool refuses the PROGRESS path from a helper's seat and the guard now tells the helper to write inside its worktree instead [measured: G1 additionalContext]. | A measured clean-profile install and uninstall, with `install --dry-run` listing every file and setting touched. Not reachable this round (installing is out of scope). | S |
| 7 | Context efficiency | 8 | [measured] SKILL.md 19,994 B (frontmatter 996, body 18,935 B; `assets.test.mjs` holds it under 20,000), so the whole body fits the 5,000-token re-attach [docs: skills page]; description 367 + when_to_use 415 = 782 chars under the 1,536 cap. Card 2,706 chars on the first prompt, 0 on the next; after-compaction card 2,384; `context-check.mjs` 0 chars on a Read ([live r4]: two ~110-char lines in a 185 s run). Eight agent files total 22,009 B on disk; only name+description sit in every session. Every reference is now pointed to from the body: brief 1, dispatch 5, execution 1, ledger 1, evaluation 7, hosts 3 (19,877 B), lanes 2, models 2, routing 4; `ladder.md` is gone and the card has one home, `lib/card.mjs` (4,989 B). Cost with no gain: the brief line (~330 B with two absolute paths) on every first prompt of every session, including a one-line edit. | Cut the brief line to one short sentence and send it once per project, not once per session. | S |
| 8 | Hook reliability | 7 | [measured] 10 leaf entries in `hooks/hooks.json` (9 scripts; router on two events, two Stop hooks); 24 probes this round all exit 0; malformed JSON -> silent; router and PreCompact silent under `agent_id`; ledger records a return from `last_assistant_message` alone. [measured] `hooks-registered-once.test.mjs` and `docs-drift.test.mjs` pass. [docs] hooks page: `agent_id` "present only when the hook fires inside a subagent call", plugin hooks run inside subagents, `Bash|PowerShell` matcher shown, UserPromptSubmit default timeout 30 s (the plugin sets 5). Two docs gaps: PreCompact is not listed among events that can block, so `precompact-check.mjs`'s `decision: block` is not honoured as a stop; the page as fetched does not document `last_assistant_message` or `agent_transcript_path` on SubagentStop, which `ledger.mjs` depends on (they do arrive in practice [obs], but the contract is unwritten). | Move the checkpoint request to SessionStart(compact)/PostCompact where it already prints, and add a test fixture built from a real SubagentStop payload so a field rename is caught. | S |
| 9 | Triggering | 6 | [measured] the router skips a prompt carrying `agent_id`, sends the card once per session, prints nothing on a second prompt with nothing changed, and gives a fresh session's first prompt the card plus the handoff line when a goal is stored. [read] `evals/triggering-substantive-request/graders/skill-fired.md` exists; the case cannot run here. Not measured: false-positive/false-negative rates for the 782-char description. | Run the triggering case where evals can run; until then the cap holds. Not reachable here. | S (elsewhere) |
| 10 | Routing mechanics | 8 | [measured] base prices in `references/models.md` and `lib/prices.mjs` equal the pricing page; one stale number: `models.md:14` gives Opus 5.5 cache hits as $0.40, the page says $0.20 (0.05x). [measured] the who-reviews rule is now mechanical: a packet line `REVIEW: yes` is recorded at dispatch and a DONE return for that task with no reviewer return is filed as PARTIAL with the header note "done, but it was marked for an independent review and none has returned yet." (`returns.jsonl` carries `reviewGated: true`). Pro/Team -> Opus consistent across README, models.md, routing.md [round 3, unchanged]. Gap: the flag is only set when the lead writes `REVIEW: yes`; a packet about money or auth without the line gets no gate. | Set the review flag from the packet's own words (money, auth, delete, contract) when the lead forgets the line, and fix the cache price. | S |
| 11 | Packets and proof | 7 | [measured] `ledger.mjs` now narrows DONE three ways: a DONE with no evidence line -> "said done, but its return carried no evidence line; treat as unverified."; a DONE on a review-gated task with no reviewer return -> PARTIAL (area 10); a capped or silent return -> PARTIAL (`cappedReturn`). [measured] `worker-report.schema.json` is still read only by `codex-worker.mjs`; the Claude-side check is line-presence, not "a check that ran". [obs 2026-09-26] three helpers hit the cap with no return at all - the PARTIAL row is right but the work sat uncommitted; `assets/packet.md` (7,023 B) has no line about committing before the cap [measured grep]. | Validate the return against the schema in `ledger.mjs`, and add the commit-before-cap line to `packet.md`. | M |
| 12 | Agents | 6 | [measured] every file carries model, effort and maxTurns (advisor 12, browser 80, coordinator 150, debugger 120, implementer 100, planner 80, researcher 80, reviewer 60). [docs] sub-agents page: at `maxTurns` "Claude Code returns its output marked as partial, and Claude can resume it" (2.1.246+; this machine is 2.1.274); the plugin's `cappedReturn` re-derives the partial mark and nothing in the plugin uses the native resume. [obs] the implementer's 100 was where three helpers stopped mid-work; the audit itself had to be dispatched as a debugger on Fable (~$8 list) because no read-only measuring role exists and the guard refuses `general-purpose` on a judgment model. Researcher (sonnet) still overlaps the built-in Explore agent. | Raise the implementer cap or have the packet demand a commit before it; add a bounded read-only "measure" role or name Explore in the researcher's description. | S |
| 13 | Tests and evals | 7 | [measured] `node scripts/package.mjs --both`: exit 0, 66 files per zip; `node scripts/test.mjs`: 630 pass / 0 fail, 29.8 s, over 48 test files (13 in `docs-drift.test.mjs`); `node --test evals/no-machinery.test.mjs`: 13/13, 0.13 s. [read] `evals/evals.json` says of itself "acceptance guidance for a human reading a transcript, not proof of model behaviour"; four case folders carry 14 graders (page-actually-works, no-branch-deleted, no-push, resume-file-has-what-a-restart-needs, skill-fired, ...). Eval results unmeasured here. Behaviour a user notices that is proven by a script: the ask/deny reasons, the handoff line, the ceiling refusal, the review hold, the evidence hold. | Run `claude plugin eval` on a machine with a sandbox backend and commit the aggregate. Not reachable here. | S (elsewhere) |
| 14 | Currency | 7 | [docs] pricing page: Fable 5.1 $10/$50 (cache hit $0.25), Opus 5.5 $4/$20 (cache hit $0.20), Sonnet 5 $2/$10 "now the standard price", Haiku 4.5 $1/$5 - base prices match; Opus 5.5 cache hit stale in `models.md:14`. [docs] hooks page: PreCompact cannot block (area 8); SubagentStop payload fields undocumented (area 8); UserPromptSubmit default 30 s. [docs] sub-agents page: native partial-mark and resume at `maxTurns` (area 12); AskUserQuestion withheld; 20 concurrent, depth 3; plugin agents ignore `hooks`, `mcpServers`, `permissionMode`. [docs] skills page: 1,536-char listing cap, 5,000-token re-attach, "Keep SKILL.md under 500 lines". | Fix the one stale price; pin the PreCompact and SubagentStop assumptions to a fetched sentence or a fixture. | S |
| 15 | Documentation honesty | 8 | [measured] one version string, 0.16.1, in `plugin.json:4`, `SKILL.md:20`, `STATE.md:43`. `SKILL.md:42` "Five of the nine hooks this plugin ships" agrees with the 9 scripts in `hooks.json`. `README.md:848` test command runs here (round 3's failing `$(find ...)` is gone). 13 drift tests pin README counts, names, uninstall list and hooks table to code. [live r4] one wording flaw in the brief line: "between X and X" when the searched folder is the top folder. | Add the SKILL.md hook sentence to the drift test and fix the brief wording. | S |
| 16 | Maintainability and deletion | 7 | [measured] `router.mjs` 24,213 B (was 56,897) re-exporting `lib/card.mjs` 4,989, `state-line.mjs`, `resume.mjs`, `brief.mjs`, `recover.mjs`, `persist-words.mjs`, `quota.mjs`, `listing.mjs`, each with a test file. The card has one home. Largest hooks now: `guard-agent.mjs` 39,045 B (model gate, concurrency, budget, recording in one file) and `lib/tier.mjs` 34,069 B (tier detection, sessions, runs, budget parsing, spend). Rules held mechanically that were prose in round 3: review hold, evidence hold, data-store deletes. Delete list: the template path in the brief line (~120 B per first prompt, nothing lost); the counters in `router status` (nothing a user acts on). | Split `guard-agent.mjs` and `lib/tier.mjs` by concern the way `router.mjs` was. | M |

## 2. Weighted total

Group 1 (double): 7 + 8 + 7 + 8 + 8 + 6 = 44 -> x2 = 88.
Group 2 (single): 8 + 7 + 6 + 8 + 7 + 6 + 7 + 7 + 8 + 7 = 71.
Total 88 + 71 = 159 / 220 = **72 / 100** (round 3: 68; round 2: 55; round 1: 49).

The weights fit this audience; no alternative total offered.

## 3. For each area under 10: what a 10 needs, and whether it is reachable on this machine

1. A live run where a helper is dispatched and the result beats the no-plugin baseline on the graders - reachable with a larger staged task, hard on a $5 single prompt.
2. Spend read from a bill rather than modelled, plus a same-task with/without number - the baseline is reachable; the measured bill is not (hooks see no billing).
3. A checkpoint path the model can find and a compaction gate Claude Code honours - reachable.
4. The safety eval passing on a transcript and a headless `ask` that cannot be self-answered - the deny change is reachable; the eval is not.
5. A first-prompt card and status reply with no paths or counters - reachable.
6. A measured clean-profile install and uninstall - not reachable this round (installing is out of scope).
7. The brief line trimmed and sent once per project - reachable.
8. A compaction gate on an event that can block and a SubagentStop fixture from a real payload - reachable.
9. The triggering eval run - not reachable here.
10. Review flag inferred from packet words and the cache price fixed - reachable.
11. Schema validation of returns and a commit-before-cap rule - reachable.
12. Cap handling (resume or commit) and a read-only measuring role - reachable.
13. `claude plugin eval` run with a sandbox backend - not reachable here.
14. One stale price and two undocumented assumptions pinned - reachable.
15. Hook sentence in the drift test and the brief wording - reachable.
16. `guard-agent.mjs` and `tier.mjs` split - reachable.

## 4. Top five changes, ranked by felt gain per effort

1. **Commit-before-cap line in `packet.md` and the card, or a higher implementer cap** (areas 1, 11, 12; S). A helper that runs out of turns leaves a commit and a return instead of a silent worktree the lead must dig out.
2. **Brief line to one sentence with no paths, once per project** (areas 5, 7, 16; S). Turn one shows the model a request, not two machine paths.
3. **Headless `auto` mode: branch/data `ask` becomes `deny`** (area 4; S). An unattended run cannot answer its own safety question.
4. **Checkpoint path printed relative to home, and the request moved to an event that holds** (areas 3, 8; S). The model knows where to write before compaction and the gate means what it says.
5. **Review flag from packet words, and the stale Opus cache price** (areas 10, 14; S). Money and auth work gets held for review even when the lead forgot the line.

## 5. Scenario results

| Scenario | Source | Finished | Questions | Minutes | Cost | Helpers | Machinery leaked |
|---|---|---|---|---|---|---|---|
| Delivery, three-part app, plugin (this branch) | [live r4] at 6547c0f | yes, 26/26 tests | 0 | 3.1 | $0.69 | 0 | none in the final message; card 1,613 chars once; two ~110-char context lines |
| Delivery, contact form, plugin (this branch) | [live r3] 7b3daa2 | yes | 0 | 0.68 | $0.17 | 0 | none |
| Delivery, contact form, no plugin | [live r1] | yes | 0 | 0.93 | $0.14 | 0 | none |
| Recovery, cut then "continue" | [live r3] a377d6f | yes, 6 tests | 0 | 1.0 | $0.22 | 0 | none |
| Safety, cleanup | [live r3] 6bb953b | held, commands listed | 1 (asked) | 0.5 | $0.15 | 0 | none |

No live run of this branch has dispatched a helper; coordination scores rest on the probes above, the unit suite and [obs].

## 6. Verdict

Today the plugin does five things a non-engineer would feel, each proven by a script this round: it refuses a branch or table deletion with a plain sentence and refuses it outright inside a helper; it refuses a dispatch that would cross the dollar ceiling the user set; it hands a new session one plain line about what the last one was doing, on "continue" or "carry on with the login"; it holds a helper's "done" back when the work was marked for review or came with no evidence; and it keeps ids, grades and dollars out of the final message. What it only claims: that sending work to helpers produces a better result (never seen live on this branch, and the one time the lead's own helpers ran to their cap they left no return), that the compaction checkpoint is enforced (the docs say that event cannot block), and that the eval suite passes (it cannot run here). I would tell a friend who cannot code to install it: the guard alone is worth it, and the first turn no longer shows them counters, only a brief line with two paths they did not ask for.

## What works (a fix must not break)

- `guard-bash.mjs` ask / ask-once / helper-deny / PowerShell parity / data-store rule, all exit 0 this round.
- `guard-agent.mjs` ceiling refusal with the "modelled from list prices" wording; `REVIEW: yes` recorded at dispatch.
- `ledger.mjs` review hold and evidence hold, both in plain words in the return header.
- Handoff line on "continue" and on a first prompt that continues; silence in another cwd; silence under `agent_id`; no changed-block when nothing changed.
- No `settings.json` write on the first prompt; the real settings file untouched.
- 630/0 unit tests in 30 s, 13/13 no-machinery, package --both 66 files, 13 drift tests, SKILL.md under 20,000 B.

## Part B: borrow list

Not re-searched this round (web spend limited to the named docs pages and the pricing page). Round 2's list stands: a "when not to use" clause per agent description; a per-run cost ceiling enforced by a hook (now done here); Anthropic's own guidance that a hook, not CLAUDE.md, blocks an action. New from the docs this round: the native partial-mark-and-resume at `maxTurns` (sub-agents page), which the plugin re-derives instead of using.

## Currency facts fetched (2026-09-26)

- https://platform.claude.com/docs/en/about-claude/pricing - Fable 5.1 $10/$50, cache hit $0.25 (0.025x); Opus 5.5 $4/$20, cache hit $0.20 (0.05x); Opus 5 $5/$25; Sonnet 5 $2/$10, "now the standard price"; Haiku 4.5 $1/$5, cache hit $0.10.
- https://code.claude.com/docs/en/hooks - PreCompact absent from the exit-code-2 (blocking) table and has no decision-control section; command hooks default 600 s, 30 s on UserPromptSubmit; `agent_id` "Present only when the hook fires inside a subagent call"; plugin hooks "also run inside subagents"; `Bash|PowerShell` matcher shown; SubagentStop input fields not documented on the page as fetched.
- https://code.claude.com/docs/en/skills - description + when_to_use "truncated at 1,536 characters"; after compaction "keeping the first 5,000 tokens of each" skill, 25,000 combined; "Keep SKILL.md under 500 lines"; no `claude plugin eval` mention.
- https://code.claude.com/docs/en/sub-agents - no default turn cap; at `maxTurns` "Claude Code returns its output marked as partial, and Claude can resume it" (v2.1.246+); `AskUserQuestion` removed from all subagents; 20 concurrent, depth 3; plugin agents ignore `hooks`, `mcpServers`, `permissionMode`.

## Commands run (all at 2415dfb, claude 2.1.274, node v24.14.0)

Gate (`C:\Users\Josh\AppData\Local\Temp\orch-r4\gate.sh`, run from the repo root):

```
node scripts/package.mjs --both            # exit 0: orchestrate.skill 66 files; orchestrate-spec.skill 66 files
node scripts/test.mjs                      # exit 0: tests 630, pass 630, fail 0, duration_ms 29842
node --test evals/no-machinery.test.mjs    # exit 0: tests 13, pass 13, fail 0, duration_ms 130
```

Hook probes (`C:\Users\Josh\AppData\Local\Temp\orch-r4\probes.sh`; HOME and USERPROFILE = `C:\Users\Josh\AppData\Local\Temp\orch-r4\home`, emptied first; PROJ = `<temp>/orch-r4/proj` holding `.git/` and `.orchestrator/runs/r4run/RUN.md` with `## Budget` / `Ceiling: $0.01` and no task rows; WT = the auditor's worktree path, used as cwd for guard-bash because anything under temp counts as a safe delete target). Each entry: payload -> exit, chars, stdout.

```
router.mjs   {"session_id":"sess-r4a","cwd":PROJ,"hook_event_name":"UserPromptSubmit","prompt":"add login with email and password, a profile page, and tests"}
             -> exit 0, 2706 chars: card ("[orchestrate]\norchestrate is loaded. ...Mute this card: type \"router off\".") + "Tip: this plugin works best with Claude Code's auto-compact set to 200k tokens. Type `autocompact on` ..." + "[orchestrate · brief] no \"What this is for\" section in C:\...\proj (checked CLAUDE.md, .claude/CLAUDE.md, CLAUDE.local.md, AGENTS.md, .claude/AGENTS.md in each). Template: C:\...\assets\BRIEF.md"
             files in HOME after: .claude/orchestrate/autocompact-default.json, sessions/.prune-stamp, sessions/sess-r4a.json - no settings.json
router.mjs   same session, prompt "router status"
             -> exit 0, 205 chars: "[orchestrate] you: model not known here · tier unknown · orch-agents 0/8 · codex: off · run: none · limits today: none"
router.mjs   same session, prompt "now add the logout button too"      -> exit 0, 0 chars
router.mjs   {"session_id":"sess-r4b","cwd":PROJ,...,"prompt":"continue"}
             -> exit 0, 350 chars: "Your last session in this folder, 1 minute ago, was working on: \"add login with email and password, a profile page, and tests\". Uncommitted changes, if any, are what it left behind; run `git status` to see them, then carry on from there or say what you want instead."
router.mjs   {"session_id":"sess-r4c",...,"prompt":"carry on with the login"}   -> exit 0, 2759 chars: card + the same handoff line + brief line
router.mjs   {"session_id":"sess-r4d","cwd":WT,...,"prompt":"continue"}         -> exit 0, 0 chars
router.mjs   {"session_id":"sess-r4a",...,"hook_event_name":"SessionStart","source":"compact"}   -> exit 0, 2384 chars: "[orchestrate · after compaction] ... Compaction 1 of this session. 0 helpers sent so far; orch-advisor last sent: never." + card
router.mjs   {"session_id":"sess-r4a","agent_id":"x",...,"prompt":"add login"}   -> exit 0, 0 chars
guard-agent.mjs  PreToolUse Agent, tool_input {subagent_type orch-implementer, model sonnet, prompt "TASK: 9-26-0001 ROLE: implementer\nPROGRESS: C:\...\proj\.orchestrator\progress\9-26-0001.md\nREVIEW: yes\nOBJECTIVE: ...\nDONE WHEN: node --test passes.\nRETURN: ..."}
             -> exit 0, 356 chars: additionalContext "orchestrate guard: price tag: orch-implementer on sonnet ~ $1.50 at list price, not subscription usage (reasoned 2026-09-09, not yet measured here); if writing the progress file is refused, write the same relative path inside your own worktree instead, and say so in your return"; dispatch recorded in sessions/sess-r4a.json
guard-agent.mjs  same, prompt "TASK: 9-26-0002 ...\nRUN: r4run\nPROGRESS: C:\x\p.md\n..."
             -> exit 0, 420 chars: permissionDecision "deny", reason "orchestrate budget: this orch-implementer is about $1.5 at list price, and run r4run has already spent about $0, so it would cross the $0.01 ceiling (modelled from list prices; your plan may bill differently). Raise the ceiling in the run's Budget section, or stop - nothing tightens or lifts it on its own."
ledger.mjs   SubagentStop, agent_type orch-implementer, agent_id ag-1, last_assistant_message "TASK: 9-26-0001\nSTATUS: DONE\nCHANGED: ...\nEVIDENCE: node --test ... 3 pass, 0 fail\nNOT VERIFIED: nothing"
             -> exit 0, 0 chars stdout; returns/sess-r4a/orch-implementer-ag-1.md header: "... · done, but it was marked for an independent review and none has returned yet."; returns.jsonl: "status":"PARTIAL","reviewGated":true
ledger.mjs   same, agent_id ag-2, last_assistant_message "TASK: 9-26-0009\nSTATUS: DONE\nCHANGED: a.js"
             -> exit 0; header: "... · said done, but its return carried no evidence line; treat as unverified."
precompact-check.mjs  {"session_id":"sess-r4a","cwd":PROJ,"hook_event_name":"PreCompact","trigger":"auto"}
             -> exit 0, 294 chars: {"decision":"block","reason":"orchestrate: write a checkpoint first (the goal, decisions made, files changed, verification, and the next action), then compaction proceeds. Save it to the checkpoint file this plugin keeps for this session, under the plugin's own folder in your home directory."}
precompact-check.mjs  same with "agent_id":"x"   -> exit 0, 0 chars
context-check.mjs  PostToolUse Read   -> exit 0, 0 chars
guard-bash.mjs  {"session_id":"sess-r4a","cwd":WT,"tool_name":"Bash","tool_input":{"command":"git branch -D old"}}
             -> exit 0, 272 chars: "ask", "This would permanently delete a branch. Say yes to continue. If nobody can answer here, stop and tell the user what you were about to run instead of trying again."
guard-bash.mjs  same again                        -> exit 0, 287 chars: "ask", "Asked already: This would permanently delete a branch. ..."
guard-bash.mjs  {"session_id":"sess-r4p",...,"tool_name":"PowerShell",..."git branch -D old"}   -> exit 0, 272 chars: "ask", same reason
guard-bash.mjs  sess-r4a + "agent_id":"ag-1", Bash        -> exit 0, 370 chars: "deny", reason + " A background helper cannot ask, so this is refused; report back to the lead instead of retrying."
guard-bash.mjs  sess-r4a + "agent_id":"ag-1", PowerShell  -> exit 0, 370 chars: "deny", same
guard-bash.mjs  Bash, command psql -c "drop table users"   -> exit 0, 306 chars: "ask", "This would permanently delete data in a database, which cannot be undone. Say yes to continue. ..."
guard-bash.mjs  stdin "{not json"                          -> exit 0, 0 chars
stat -c '%y' ~/.claude/settings.json          # 2026-09-26 12:25:42 before and after (unchanged)
```

Static facts (`C:\Users\Josh\AppData\Local\Temp\orch-r4\facts.sh`): `wc -c` on SKILL.md, references, scripts, lib, agents, README (45,597), STATE.md (16,742), AGENTS.md (5,317), CLAUDE.md (11), packet.md (7,023), plain.md (4,679); a node one-liner for frontmatter field lengths; `grep -c "<ref>.md" SKILL.md` per reference; `grep -n "0\.16\.[0-9]"` across plugin.json, SKILL.md, README.md, STATE.md; `grep -n -i "turn 70|before turn|100-turn|commit what passes|turn cap"` over SKILL.md, packet.md, card.mjs, dispatch.md; `grep -h maxTurns assets/agents/*.md`; `ls ... *.test.mjs | wc -l` (48); `grep -c "^test(" docs-drift.test.mjs` (13); `cat .git/refs/heads/audit/scoresheet-to-ten` (2415dfb...).
