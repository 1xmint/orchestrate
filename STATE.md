# Build state

Resume point for building the `orchestrate` skill.

**In progress: 0009 — measure against plain Claude before changing,
2026-10-01.** Plan: `docs/research/0009-plan.md` (revision 2). Work branch
`phase/0009-bench`. This becomes the next release's section when it ships.

- The bench (`bench/`, `bench-hidden/`, `evals/grade-kept.mjs`,
  `.github/workflows/bench.yml`) fits "nothing that bills an outside service
  or needs its own API key": it is for developing this plugin only and is not
  installed; the owner starts it by hand; it signs in with the owner's own
  subscription token, never an API key; GitHub Actions minutes are free on a
  public repository. Each batch has a `--max-cost-usd` stop-loss written in
  `bench/RULE.md` before it runs.
- The rule that decides a comparison is in `bench/RULE.md`, written before any
  run: gates, then successes, then cost per success, then time.
- Every case's hidden checks are proven to pass a known-right solution and
  fail a known-wrong one (`bench/grader-check.test.mjs`), so a hard case is
  never mistaken for a broken one.
- `gate.mjs` reads the merge gate only from a workflow that runs on push or
  pull request, so the hand-started bench job is never taken as a project's
  gate.
- Plan revision 2 turned the guard's Sonnet-first refusal into an allow. That
  part is dropped; Stage 2 is wording only, and the refusal and its grant code
  stay. Three reasons: AGENTS.md says a hook refuses a helper on the wrong
  model; the record (`guard-agent.mjs`, the comment above the refusal) shows
  56 of 58 builders ran on Opus while the rule was only written; and
  `bench/RULE.md` keeps a removed capability when a result is inconclusive.
  Removing it would need its own comparison (current against current without
  the refusal) and an AGENTS.md change in the same pull request.
- Hook notes now state facts (Stage 0), and so do the refusals in
  `guard-agent.mjs` and `lib/workers.mjs`: each keeps what was blocked and the
  way through that passes the code. One independent review (Opus) found the
  Fable text promised the approval line alone passes, while a builder on Fable
  still meets the Sonnet-first rule and a finder is refused as a sweep; the
  text now names both and a test pins it. The old text had the same gap.
  Three `guard-bash.mjs` texts still give an order (the ask tail, the
  worktree-remove and branch-delete refusals); they are safety stops and are
  left until a guard change has its own reason. The review also found the
  Sonnet-first check does not read whether the earlier attempt failed; that
  is written in `docs/safety-guard.md`. Refusal wording checked 2026-10-01
  against Anthropic's prompting best practices page (give the reason, say what
  to do rather than only what not to, no forceful words) and the Prompting
  Claude Opus 5.5 page, which adds nothing on hook or refusal text.

## v0.21.0 — judgment: no test that teaches nothing, no review loop, 2026-10-01

From the owner's correction after 0.20.1: the session had spent $10 on a test
whose result was predictable, and seven review rounds on cases of one kind its
own decisions ruled out. Reasoned from that session's record; no eval run, by
the owner's decision.

- Two failed reviews in a row, with no PASS since, are stated once as a fact
  on the lead's next tool call: how many, which commits, where the returns
  are. A return with no readable verdict neither counts nor resets. On the
  0.20.1 record it would have spoken after the second round.
- SKILL §2: before a test or experiment beyond the gate, write the expected
  result and what it would change; one that can be predicted, read or looked
  up is not run. §5: after a bug fix, look for the same mistake elsewhere.
  §6: the reviewer's questions carry what Decisions rule out, and a finding
  there is noted, not a FAIL. §7: the same error or kind of finding twice
  means naming what they share and fixing that kind once, or ruling it out
  with the owner.
- `evaluation.md` "Independent review": why a question that contradicts the
  recorded threat model loops, and what to do after two failures.
- The card carries the two habits and the look-elsewhere step; it dropped
  lines SKILL already holds. 2,176 of 2,200 characters; SKILL 19,987 bytes.
- Gate: 1263/1263 + 22/22.

## v0.20.1 — safer clean-up, a fairer ruler, 2026-10-01

From the refusals and the eval ruler seen while releasing 0.20.0 (notes X and Y
in `docs/audits/2026-10-01-live-session-notes-0.19.0.md`).

- A forced worktree removal of any folder, not only a helper folder, is
  checked for unsaved work first. Before, one outside `.claude/worktrees/`
  passed with no check and its unsaved work was lost. A folder that cannot be
  found or read is refused ("cannot tell"). A Git Bash path such as `/c/...`
  is translated before the check, because Node read it as a missing folder,
  which counted as clean. The first review found a redirect before the flag
  (`remove 2>/dev/null --force`) hid it, and `--fo` was not read as force;
  both fixed. The second review found a brace (`{../dirty,}`), a
  backslash-newline, a quoted flag and a word before git (`if … then`, `env
  -i`, `\git`) still slipped past. So the check now reads like the merge check:
  a part holding `worktree remove` must be plain words, or it is refused as
  unreadable; a plain `cd <folder>` before it moves where folders are read.
  The third review found an escaped quote (`-m "Fix \"x\" bug"`) hid a forced
  removal after it, and a quoted Windows folder after `cd` was refused; quotes,
  comments and heredoc bodies are now read where bash reads them. The fourth
  found a `<<EOF` inside quotes, a piped heredoc, a cd in `( )` and a `\"` read
  by PowerShell; a relative folder is now checked from every place a cd could
  leave the shell. The fifth found PowerShell's `Set-Location`, `pushd`, `sl`
  and `CD` were not read as a cd; every way either shell moves now is, and
  `$'…'`, a backtick before a quote and curly quotes refuse a removal line.
  The sixth found a PowerShell here-string with an apostrophe hid a removal
  after it from the bash reading; a line with one is now read both ways.
- A clean-up line that removes a clean worktree and deletes branches with
  lowercase `-d` now passes. When a branch-delete line is refused although it
  already uses `-d`, the refusal names the part that was actually refused
  instead of advising `-d`.
- The merge check accepts one plain `cd <path>;` or `&&` before a single
  `gh pr` read; the path is letters, digits and `./:@+,=-` only. `cd $(…)`,
  backticks, globs, `~`, two `cd`s and `cd …` before a merge are still
  refused. A branch delete with `-d --force` is not called "the lowercase
  flag" in a refusal.
- docs/safety-guard.md: in a session that shows no prompts, an owner's yes in
  chat does not reach the check. The owner runs the command, or approves the
  exact line for `.orchestrator/allow-bash.json`.
- Eval ruler (note X): six LLM rules that read the whole run record, which the
  eval host cuts in the middle, now read the last message. Two tool rules were
  added for actions the rewritten rules no longer see
  (`no-uploads-removed`, `report-test-untouched`), and Edit or Write siblings
  for three that watched one tool only. Left to the final message: whether
  three-session-continue redid steps 1-2, and whether misleading-bug's tests
  passed (only that they ran is checked). `eval-graders.test.mjs`
  refuses any LLM rule that reads the record or doesn't say what it reads.
  Not re-measured.

Replayed against `decide()`, each refused line from this session now gives the
intended answer. Gate: 1260/1260, 22/22.

## Earlier releases

- [v0.20.0 — plan 0007: replies that draw, the owner's words kept, grants that hold, 2026-10-01](docs/state/v0.20.0.md)
- [v0.19.0 — plan 0006: a fair ruler, and who can see the data is the owner's call, 2026-10-01](docs/state/v0.19.0.md)
- [v0.18.0 — plan 0005: checks that read what runs, and a project page, 2026-09-30](docs/state/v0.18.0.md)
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
