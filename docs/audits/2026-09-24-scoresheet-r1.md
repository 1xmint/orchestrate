# Scoresheet audit, round 1

Commit `d9c7b02ab9a9b660124c8251837a659f4e9e75b2` (2026-09-21) · Claude Code `2.1.274` · node v24.14.0 · installed copy identical. Auditor: Fable 5.1, fresh context, prompt in `docs/scoresheet-audit-prompt.md`.

Part A live runs were not executed this round (the auditor ran read-only), so areas 1-5 are capped at 6. `claude --bare` (skips hooks, LSP, plugin sync) is the settings-free no-plugin baseline for round 2.

## 1. Score table

| # | Area | Score | Reason (evidence) | Change | Effort |
|---|---|---|---|---|---|
| 1 | Delivery (x2) | 5 | 344 dispatches / 348 returns over 24 sessions in `~/.claude/orchestrate/sessions`; realorrug run 14/16 done. No with/without comparison run (Part A skipped, cap 6). | Convert 3 scenarios to `claude plugin eval` cases with baseline arm | M |
| 2 | Cost & time (x2) | 5 | `costs.jsonl` 527 rows (cap 500), $1121 raw vs $985 latest-per-agent; 81 rows unpriced; early rows are cumulative re-records of one helper (37.55→37.75→20.47…) without `agent` id. Run card $40.4 matches `returns.jsonl` $40.42. `prices.mjs:22` opus 5/25 but `opus` alias now resolves to Opus 5.5 at $4/$20, cache 5% (model-config, pricing page). | Deterministic trim; re-price opus family; drop unpriced rows from sums | S |
| 3 | Recovery (x2) | 5 | 17 checkpoints (56 KB), 424 agent files, 2.2 MB context dir; card+brief+run re-sent after compaction (observed twice in the auditor's own helper). Audit run RUN.md still shows template placeholders. SessionStart:compact fired inside a subagent injecting ~5 KB incl. a self-referential "1 helper never returned". | Gate `handleSessionStart` on absence of `agent_id` | S |
| 4 | Safety (x2) | 4 | `guard-agent.mjs:35-59` denies credentials (measured: password= denied). Zero hooks on Bash (`hooks.json` matchers: `Agent|Task` only). Destructive/publish/pay stops are prose (`SKILL.md`, `packet.md:68-71`). | PreToolUse Bash guard for `push --force`, `branch -D`, `rm -rf`, release/deploy | M |
| 5 | Communication (x2) | 5 | Card 2184/2200 chars, 3600 B on first substantive prompt, 0 B on second (measured). Owner card names a run from another project as "candidate, not bound" and `ready now: 9-23-0005` which is a human-owned row (RUN.md role "owner"). `router.mjs:165-170` prints `subagent spend ~$x/$c` while README:538 says "no running counter". | Scope run phrase to cwd; exclude non-agent roles from "ready now"; reconcile counter text | S |
| 6 | Onboarding (x2) | 4 | `claude plugin details`: ~243 tok always-on, ~10.6k on-invoke, **Agents (0)** despite 8 in `plugin.json`; local `agents.installed.json` has 7 hashes (no advisor) → card says 6/8. 23 `settings.backup.*.json` (21 in one day, `settings.mjs:148-152`) from writing `~/.claude/settings.json`. `guard-agent.mjs:120,180` hard-codes "Josh". SKILL metadata 0.15.8 vs plugin 0.16.1. | Stop rewriting global settings; single backup; drop owner name; fix agent install/registration | S |
| 7 | Context efficiency | 6 | description+when_to_use 405 chars (cap 1536); SKILL.md 32,835 B / 558 lines; size notices at 80k/120k measured live; context-check 0.13 s/call. Compaction injection into helpers ~5 KB. | Same as #3 | S |
| 8 | Hook reliability | 6 | 442/442 tests, 18.5 s. 7 hooks in `hooks.json` + 4 in SKILL frontmatter; docs: "A plugin's or skill's copy of the same handler stays separate" → guard and ledger run twice when skill is invoked (ledger 10 s dedupe, guard `eventId` absorb). `dispatch-events.json` mixed pretty-JSON + JSONL (549 lines). Hook timeouts 5-10 s vs default 600. | Register each hook once; migrate events file | S |
| 9 | Triggering | 5 | Substantive = non-slash, no fence, ≥4 words (`router.mjs:546-679`). No self-run measurement of skill firing. | Eval case with `skill-fired` grader | M |
| 10 | Routing mechanics | 6 | Measured denials: reviewer-on-sonnet, unnamed general-purpose, implementer-on-opus; 58 denials in sessions. `routing.md:12` Pro default "Sonnet 5" vs model-config "Pro: Opus 5.5". | Refresh routing.md against model-config | S |
| 11 | Packets & proof | 5 | `PACKET_WARN_CHARS 8000`; realorrug `returns.jsonl` 24 rows: 9 with `status:null`, 5 capped; RUN.md rows 0012/0013 have shifted cells. | Parse STATUS more leniently; lint RUN table column count | S |
| 12 | Agents | 5 | 8 role files with model/effort/maxTurns; plugin loader reports 0 agents; advisor absent from install list. | Fix registration so `claude plugin details` sees 8 | S |
| 13 | Tests & evals | 6 | 33 test files / 7,440 lines; `evals/evals.json` (30) is skill-creator format; `claude plugin eval` (v2.1.269+) needs `evals/<case>/prompt.md + graders/`; none exist. | Add 3 eval cases | M |
| 14 | Currency | 4 | Prices "checked 2026-09-13" but Opus 5.5 ($4/$20) now the `opus` alias; hosts.md checked vs 2.1.260 (current 2.1.274); hooks doc lists 33 events incl. SubagentStart/PostToolUseFailure; `gate.mjs:158` "AGENTS.md is NOT loaded" contradicts memory doc (v2.1.277+) and `SKILL.md:534`. | Dated currency pass | S |
| 15 | Documentation honesty | 4 | README:41 "three global hooks" (7); "433 body lines" (558); "seven" agents (8) README:529, hosts.md:108/118, models.md; `lanes.md:135-136` "every sixth step asks for a check-in" absent from `persist-check.mjs`; hosts.md:110-111,125 garbled paragraph. | Truth pass with a drift test | S |
| 16 | Maintainability & deletion | 4 | 16,154 script lines; 92 commits Sep 8-21; global settings writes; state dir 2.2 MB + 1.8 MB returns with probabilistic caps (`Math.random() < 0.02`); owner name in code. Removal documented (README:573). | Deterministic caps, prune on SessionStart, no global writes | S |

## 2. Weighted total

Double (1-6): (5+5+5+4+5+4)×2 = 56. Single (7-16): 6+6+5+6+5+5+6+4+4+4 = 51. 107 / 220 = **48.6 → 49/100**. Equal weights: 79/160 = 49/100. Uncapped estimate if Part A were run and passed: areas 1-3 could reach 6-7, total ≈ 53.

## 3. Top five changes (gain ÷ effort)

1. **Truth pass on docs + prices** (S; moves 14, 15, 6, 10): README hook/line/agent counts, SKILL version, hosts.md hook list and garbled paragraph, lanes.md sixth-step claim, gate.mjs AGENTS.md line, Opus 5.5 pricing, Pro default model.
2. **Stop writing `~/.claude/settings.json`** or write once with one backup (S; 6, 16). 23 backups on one machine.
3. **Skip SessionStart:compact and card inside subagents** (`agent_id` present) (S; 3, 5, 7). ~5 KB per helper compaction today.
4. **PreToolUse Bash guard for destructive/publish/pay commands** with a one-line ask (M; 4). Today safety is prose only.
5. **Three `claude plugin eval` cases with baseline arm** (M; 1, 9, 13): delivery, recovery, safety.

## 4. Scenario table

| Scenario | Run | Result | Cost / duration |
|---|---|---|---|
| Delivery (contact form, with plugin) | skipped (auditor read-only) | — | — |
| Delivery (no plugin, `--bare`) | skipped | — | — |
| Recovery (login+profile+tests, kill, "continue") | skipped | — | — |
| Safety (delete branches, remove uploads, push) | skipped; static: no Bash guard exists | — | — |

## 5. Verdict

The mechanics are real and tested (442 passing tests; guard, ledger, size notices and compaction re-send all observed live), and the run ledger's spend figure matches its returns file to the cent. What drags the score is everything around the mechanics: documentation that disagrees with the code in a dozen countable places, a price table one model generation behind, global-settings writes that leave backup litter, a loader that reports zero agents, hooks that fire inside helpers and talk about the helper to itself, and no enforced stop for the one thing a vibe coder fears most, a destructive command. For that audience today it is a capable engineer's tool with a stale manual; a short truth pass and a Bash guard would move it more than any new feature.

## What works (evidence)

- Tests: `node --test $(find skills -name '*.test.mjs')` → 442/442, 18.45 s.
- Guard denials measured on stdin payloads: credential, reviewer-on-sonnet, unnamed general-purpose, implementer-on-opus all denied with plain-language reasons (`guard-agent.mjs`).
- Card = ladder.md byte-identical (drift test), 2184 chars, sent once (3600 B first prompt, 0 B second).
- Size notices arrived in the auditor's helper at ~121k (`context-check.mjs:136-148`).
- Run spend: `realorrug/.orchestrator/runs/20260923-plan-0002-phase2/returns/returns.jsonl` 21 agents = $40.42 = card "$40.4/$45".
- Always-on cost ~243 tokens (`claude plugin details orchestrate`).

## Part B borrow list

- **superpowers** (obra, MIT, v6.4.1 2026-09-19): bootstrap skill injected at start and after compaction; `verification-before-completion`; `subagent-driven-development` with review per task; drill eval harness. Does not do: cost/quota routing. Orchestrate does: model floor, price tags. Native: `/code-review`, `/verify`.
- **oh-my-claudecode** (MIT, 39k stars): HUD status line with live cost; staged Team pipeline plan→PRD→exec→verify→fix; `.omc/sessions/*.json` replay logs. Does not do: subscription-tier gating. Native: `/goal`, `/batch`, agent teams.
- **BMAD-METHOD** v6.12.0: role personas with a deliverable per phase. Native: none.
- Anthropic guidance: "add multi-step agentic systems only when simpler solutions fall short"; Stop hook overridden after 8 consecutive blocks; auto-mode classifier blocks "scope escalation"; `claude plugin eval` runs each case 3× with a no-plugin baseline.

## Currency facts fetched (2026-09-24)

Pricing page: Fable 5.1 $10/$50 cache read $0.25; Opus 5.5 $4/$20 cache read $0.20; Opus 5 $5/$25; Sonnet 5 $2/$10 (now permanent); Haiku 4.5 $1/$5. model-config: `opus`→Opus 5.5, `sonnet`→Sonnet 5, `haiku`→Haiku 3.5, default Opus 5.5 on Pro/Max/Team/API; effort on Opus 5.5 defaults `medium`. Plans: Max 5x/20x "50% of weekly limits" for Fable; Pro "usage credits". Hooks doc: 33 events; command timeout default 600 (30 on UserPromptSubmit); plugin and skill hook copies both run. Sub-agents: depth default 3, concurrency 20, `AskUserQuestion` removed, plugin agents ignore `hooks`/`mcpServers`/`permissionMode`. Memory: AGENTS.md read only when no CLAUDE.md, v2.1.277+.

## Runtime data sampled

24 sessions · 344 dispatches · 58 denials · 348 returns · 14 sessions ever armed persist · costs 527 rows / $985 dedup / 81 unpriced · 17 checkpoints 56 KB · 424 agent files · 23 orphan return dirs, 221 return files · 23 settings backups (180 KB) · `quota.json` stale since Sep 17 (no quota enforcement live) · `dispatch-events.json` mixed format.

## Commands run

`git rev-parse HEAD`; `claude --version`; `node --version`; `node --test $(find skills -name '*.test.mjs')`; `claude --help`; `claude plugin --help`; `claude plugin details orchestrate`; `node router.mjs --state`; stdin probes into `router.mjs`, `context-check.mjs` (×20 timed), `guard-agent.mjs` (×4); `node profile.mjs --brief`; node one-liners summing `costs.jsonl`, `returns.jsonl`, `sessions/*.json`; `find/wc/du/ls` over `~/.claude/orchestrate` and realorrug run dir; WebFetch of hooks, sub-agents, model-config, pricing, plans, plugins, plugin-evals, memory, skills, best-practices, fable support article, superpowers, oh-my-claudecode, building-effective-agents; WebSearch ×3. Not run: `claude plugin eval` (no cases), `/skill-doctor` (interactive), Part A.
