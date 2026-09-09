# Handoff: finish `orchestrate` v0.4 (paste this into an Opus 5 session)

You are finishing the `orchestrate` Claude Code skill, v0.4. Repo:
`C:\Users\Josh\Desktop\GitHub\orchestrate` (public, github.com/1xmint/orchestrate, branch
main). The approved plan is `C:\Users\Josh\.claude\plans\i-want-you-to-eager-boole.md`; read
it once, fully. Do not re-derive its grounding: every fact in it was checked against the live
docs on 2026-09-08 and the desktop app runs Claude Code 2.1.260.

## State on 2026-09-09

- Step 1 done and pushed (commit 60beeaa): `references/` fixed for drift; new `ladder.md`
  (holds the router card between ```card fences) and `lanes.md`.
- Step 2 half done, pushed as WIP (36b0f60): `scripts/lib/tier.mjs` (shared paths, tier walk,
  Fable counter, latest run, session state) and `scripts/router.mjs` with
  `scripts/router.test.mjs`. `node --test "skills/orchestrate/scripts/**/*.test.mjs"` → 16/16
  pass. Not done in step 2: `scripts/install.mjs --with-router` (merge into
  `~/.claude/settings.json`, back up first, dedupe by script basename, keep Josh's
  `memory-write-gate.mjs` entry, refuse without Node ≥ 18).
- Steps 3–7 not started. v0.3.0 remains installed and working at `~/.claude/skills/orchestrate`.

## Three additions Josh asked for on 2026-09-09 (fold into steps 3–4)

1. **Skills as a toolkit.** `profile.mjs --brief` lists installed skill names (`~/.claude/skills`,
   `<repo>/.claude/skills`, plugin skills under `~/.claude/plugins`) in one line, so the plan can
   route a step to an existing skill. The packet gets a `SKILLS TO USE` field ("invoke `/x`
   through the Skill tool for step N"); subagents can invoke any installed skill. Role agents may
   preload one with `skills:` only when every run of that role needs it.
2. **The manager knows its own model.** The router's state line gains `you: <model> @ <effort>`,
   read from the transcript tail (`message.model` on the last assistant record, top-level
   `effort`). Add a "who reviews" rule to `routing.md` and one line to SKILL.md §6: when the
   manager is strictly above the author (Opus manager, Sonnet author) and the class is not risky,
   the manager reviews the diff itself (it already holds the goal and the packet; cheaper than a
   reviewer dispatch); when the manager is at or below the author, or the class is risky, dispatch
   `orch-reviewer` on a model ≥ the author; the manager never reviews its own edits. Objective
   order stays: first-time-right, then total quota including rework, then wall clock.
3. **Discuss vs act.** "What do you think of this idea" is rung 1 (answer/discuss) and the router
   stays silent; add that fixture to `router.test.mjs` so it is proven, not assumed.

## Remaining steps (commit and push after each; no subagents; zero quota)

2. `install.mjs --with-router` + `--with-hook` (guard, ledger) with merge/dedupe/backup; template
   `{{SKILL_DIR}}` into the installed SKILL.md and agent files as a forward-slash absolute path.
3. `guard-agent.mjs` v2: past the Max cap → `permissionDecision: "allow"` + `updatedInput`
   (`model: opus`) + `additionalContext` naming the downgrade; records dispatches in the session
   state. `ledger.mjs` on **SubagentStop** (not PostToolUse: background returns arrive as task
   notifications): saves `last_assistant_message` to `<run>/returns/NNN-<agent_type>.md`, sums
   usage from `agent_transcript_path`, updates the `RUN.md` row keyed by the `TASK:` line
   (🔍 for DONE, ◐ PARTIAL, ⛔ BLOCKED; never ✅). `return-check.mjs` as each agent file's
   `hooks: Stop` (becomes SubagentStop): block up to twice when RESTATED/STATUS/EVIDENCE missing
   or > 60 lines; output `{"decision":"block","reason":…}` and the same inside
   `hookSpecificOutput`. `turn-check.mjs` on Stop from SKILL.md frontmatter: block once per return
   when the Pickup section hash is unchanged since the last return. Agent files: `hooks:` on all
   six, `memory: user` on reviewer and researcher. Tests for each.
4. `profile.mjs --brief` (≤ 3 s, exit 0 always, no probes; full run caches probes 24 h in
   `~/.claude/orchestrate/providers.json`) plus the skills line; `gate.mjs` → `.orchestrator/gate.json`
   (AGENTS.md/CLAUDE.md, justfile, Makefile, package.json, Cargo.toml, pyproject, CI);
   `run-init.mjs` pastes the GATE block under Facts; SKILL.md v0.4 ≤ 150 lines, first body line
   `` !`node "${CLAUDE_SKILL_DIR}/scripts/profile.mjs" --brief` ``, frontmatter hooks for guard,
   ledger (SubagentStop), turn-check (Stop); `when_to_use:`; the "who reviews" line.
5. `install.mjs --project <repo>` (gate.json, exclude, `.claude/rules/orchestrate.md` ≤ 12 lines,
   the `@AGENTS.md` suggestion) + fixture tests + one `--dry-run` on
   `C:\Users\Josh\Desktop\GitHub\notelocus`. Do not install into live repos.
6. `measure.mjs <transcript.jsonl>` (usage fields: `input_tokens`, `cache_creation_input_tokens`,
   `cache_read_input_tokens`, `output_tokens` on assistant records; Agent `tool_use` blocks;
   top-level `timestamp`, `sessionId`, `effort`); loading checklist for Josh in README.
7. `package.mjs` (Claude Code zip with hooks; `--spec` zip without `hooks`/`when_to_use` and
   without the injection line); README; version 0.4.0; STATE.md; this file; tag v0.4.0; push.

## Non-negotiables

Zero npm dependencies, Node ≥ 18, Windows/macOS/Linux paths. Never print secrets. Never run
`claude auth login` or touch credentials. Router stays global (settings.json), never in skill
frontmatter. `updatedInput` needs `permissionDecision: "allow"`. Every hook exits 0 and prints
nothing on any error. Use the Write tool for files over ~6 KB (the Bash tool truncates near 8 KB).
Talk to Josh plainly, one recommendation per decision; ask only about money, public surfaces,
credentials, destructive actions. Do not install the project kit into his repos and do not run
dogfood goals; unit tests and one fresh-session loading check are the proof.

## Verify before tagging

`node --test "skills/orchestrate/scripts/**/*.test.mjs"` all green; `node scripts/install.mjs
--with-router --with-hook` then confirm `~/.claude/settings.json` still has the memory-write-gate
entry and the backup exists; a fresh desktop session shows the router card on the first prompt
and nothing on the second; `/orchestrate` shows the profile line without a Bash turn.
