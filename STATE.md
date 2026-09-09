# Build state

Resume point for building the `orchestrate` skill.

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

## v0.4.1 — the fresh-context Fable audit, 2026-09-09

The one step the v0.3 plan reserved and the v0.4 plan deferred: run
`references/audit-prompt.md` as a Fable subagent against the built skill, apply
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

Pickup prompt: v0.4.1 is tagged; the plan and the audit it deferred are both
complete, and the only things left need a fresh session or a real goal.
Pickup confidence: high
Resume risk: none
