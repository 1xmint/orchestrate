# Build state

Resume point for building the `orchestrate` skill.

## v0.19.0 — plan 0006: a fair ruler, and who can see the data is the owner's call, 2026-10-01

From the audit of the 0.18.0 release check (plan in the session notes,
`docs/audits/2026-10-01-live-session-notes.md`). The measurement is in
docs/research/0006-eval-0.19.0.md.

- The leak check flags plugin words (worktree, packet, ledger, "helper
  system", "until a plan existed") instead of any dollar sign; it had flagged a
  plain monthly price and missed a real leak. A page on the home wifi now
  counts as exposed in costly-fork. 0005-eval-0.18.0.md keeps its old text
  with the correction.
- Who can see or change the owner's data (a public page, or anyone on their
  wifi) and anything they did not ask for are their call: card, SKILL §1 and
  plain.md. The plan-page refusal says it is not news for the user.
- A new case, `plan-request`, grades a plan on intent, plain questions,
  grounding in the repo, visible steps and no extra scope.
- AGENTS.md: work the user feels outranks upkeep; plans are a measured claim;
  the guard catches what Claude would do by mistake, not commands built to slip
  past it, and `docs/safety-guard.md` lists what it does not catch. The
  open-ended bypass search owed since 0.18.0 is dropped under that rule.
- In plan mode the context line names the plan file instead of ordering a
  checkpoint that cannot be written; a model grant missing its TASK line says so
  first. The card names the researcher's real model, with a test, and a
  research packet can carry KILLS IT and SOURCE (from an outside review of how
  the plugin researches).

Measured (docs/research/0006-eval-0.19.0.md): the plan test's judge was reading the raw run
record, not the plan; fixed, both versions rerun. With the plugin, plans asked the owner better
questions (passed 3 of 6 against 0 of 6), and no costly-fork run built before asking. 0.19.0 and
0.18.0 score the same; three runs cannot tell them apart.

Not fixed: misleading-bug and failed-check-report still cannot run on Windows;
"N tool calls since your last edit" counts shell commands as edits on purpose.

## v0.18.0 — plan 0005: checks that read what runs, and a project page, 2026-09-30

Built from docs/research/0005-next-phase.md. What each step did, its evidence
and what is left is in docs/research/0005-next-session.md ("What is built"),
which is also the brief for the next session: a live watch of this build, a
fresh gap audit, and a rerun of the ability tests. The release measurement is
in docs/research/0005-eval-0.18.0.md, against
docs/research/0005-baseline-0.17.2.md.

- The guard reads what runs instead of guessing from words (step 2). Its first
  commit went in before its review, and that review failed. Fixes
  followed, each reviewed independently; each failed review was answered by
  the next fix, and the merge needed a PASS naming the last. The later fixes
  address two leads the reviews named: text written into git's or rg's own settings on the same line
  as a git read, and a payment host reached through a script file, `curl -K`
  or `wsl`. Settings made before the line are still not read; that is written
  down in `docs/safety-guard.md`. An open-ended search for other ways past the
  guard was started twice and stopped both times by a safety classifier before
  it ran a test; it is still owed, by the owner.
- A project page, `.orchestrator/PROJECT.md`, keeps purpose, standing and next
  steps in view. The first writing helper waits for its Next (step 4). Off
  Windows, the "page unchanged" note now passes git the path as written, so
  edits only to git-ignored files never draw it.
- A bug fix starts from a reproduced, named cause (step 5).
- The README and the project installer list the tools to use alongside
  orchestrate (step 6).

## Earlier releases

- [v0.17.2 — a merge waits for its checks, 2026-09-30](docs/state/v0.17.2.md)
- [v0.17.1 — fixes from the first live session on 0.17.0, 2026-09-29](docs/state/v0.17.1.md)
- [v0.17.0 — the scoresheet audit, and rules that can be measured, 2026-09-29](docs/state/v0.17.0.md)
- [v0.16.1 — a review that can stop the merge, 2026-09-21](docs/state/v0.16.1.md)
- [v0.16.0 — from work dispatcher to engineering partner, 2026-09-21](docs/state/v0.16.0.md)
- [v0.15.8 — a scoped model grant, an outbox, honest Codex state, and helper compactions made visible, 2026-09-18](docs/state/v0.15.8.md)
- [v0.15.7 — the lead hears facts, not orders, 2026-09-14](docs/state/v0.15.7.md)
- [v0.15.6 — tests pin behaviour, not numbers, 2026-09-14](docs/state/v0.15.6.md)
- [v0.15.5 — one number per idea, 2026-09-14](docs/state/v0.15.5.md)
- [v0.15.4 — the checkpoint check accepts a real checkpoint, 2026-09-14](docs/state/v0.15.4.md)
- [v0.15.3 — helpers hear facts, not orders, 2026-09-14](docs/state/v0.15.3.md)
- [v0.15.2 — helpers do compact, 2026-09-14](docs/state/v0.15.2.md)
- [v0.15.1 — helper size budgets, capped helpers free their slot, 2026-09-14](docs/state/v0.15.1.md)
- [v0.15.0 — the lead keeps judgment, workers carry the bulk, 2026-09-14](docs/state/v0.15.0.md)
- [v0.14.0 — a repo map helpers read before searching, 2026-09-14](docs/state/v0.14.0.md)
- [v0.13.1 — usage-limit entries expire, and the sandbox retry, 2026-09-14](docs/state/v0.13.1.md)
- [v0.13.0 — accurate context, bounded workers, Codex with Claude fallback, 2026-09-14](docs/state/v0.13.0.md)
- [v0.12.0 — quota first, 2026-09-13](docs/state/v0.12.0.md)
- [v0.11.0 — most coherent, reliable, Claude-native, 2026-09-10](docs/state/v0.11.0.md)
- [v0.10.0 — manage to a budget, not just work, 2026-09-10](docs/state/v0.10.0.md)
- [v0.9.0 — a senior engineer, not a process, 2026-09-09](docs/state/v0.9.0.md)
- [v0.8.0 — cut it down to judgment, 2026-09-09](docs/state/v0.8.0.md)
- [v0.7.3 — the wrong-run bug was corrupting ledgers, 2026-09-09](docs/state/v0.7.3.md)
- [v0.7.2 — the plugin install, which had never worked, 2026-09-09](docs/state/v0.7.2.md)
- [v0.7.0 — the senior engineer in the chair, 2026-09-09](docs/state/v0.7.0.md)
- [v0.4.0 — 2026-09-09, complete](docs/state/v0.4.0.md)
- [v0.6.0 — a plugin, model intelligence, and the question that started it, 2026-09-09](docs/state/v0.6.0.md)
- [v0.5.1 — how to talk, moved where it binds, 2026-09-09](docs/state/v0.5.1.md)
- [v0.5.0 — the manager judges the model, 2026-09-09](docs/state/v0.5.0.md)
- [v0.4.1 — the fresh-context Fable audit, 2026-09-09](docs/state/v0.4.1.md)
- [v0.3.0 and earlier — 2026-09-08](docs/state/v0.3.0-and-earlier.md)
