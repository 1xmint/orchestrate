# Build state

Resume point for building the `orchestrate` skill.

## v0.17.2 — a merge waits for its checks, 2026-09-30

The second live session on the plugin's own repo (0.17.1; notes items Q–AL in
`docs/audits/2026-09-29-live-session-notes.md`) found these, each fixed with a
test that fails on the old code:

- **A pull request merges only once it clears a bar**, in every mode: every
  check on its newest commit has passed, and a change to the plugin's own
  safety checks has a reviewer's PASS naming that same commit. The merge must
  name the commit (`--match-head-commit`), so nothing can slip in between the
  check and the merge. `--auto` and the raw API routes are refused, and checks
  that cannot be read refuse rather than pass. (#36)
- Which lines count as a merge is blunt on purpose: four review rounds each
  found a new way to spell one, so the check now flattens the line to its
  letters and refuses any that say merge next to gh or a GitHub address. The
  price is a few harmless lines refused, listed in `docs/safety-guard.md`;
  plain reads (`gh pr view`) and a plain `git merge` pass. (#36)
- Only a reviewer's own hand-back counts as a review; a builder quoting
  "PASS" no longer gets a verdict. (#36)
- The dispatch gate no longer reads `git checkout` as payment work; a refusal
  in auto mode no longer says "nobody is present"; three wrong or unneeded
  hook lines are gone. (#36)
- The checkpoint's goal, last message and test line are taken from what the
  user typed and what the shell printed, not from host notices or file reads;
  the compaction count comes from the transcript. (#35)
- The audit prompts no longer claim a version, and a test keeps it so. (#37)

Seen and not fixed: a merge from a script, a variable, a gh alias or a command
name built from pieces; `git push origin HEAD:main`, which skips pull requests;
a project with no automatic checks never clears the bar, so its user merges by
hand; the branch-delete rule still reads text headed into a file (notes AA,
AJ). A helper's own compaction still reaches the lead's card when the host
sends no agent id (a Claude Code gap, to report).

## v0.17.1 — fixes from the first live session on 0.17.0, 2026-09-29

The first live session on 0.17.0 (the plugin's own repo, notes in
`docs/audits/2026-09-29-live-session-notes.md`) found these, each fixed with a
test that fails on the old code:

- A finished run can be closed (`run-init.mjs --close <id> --reason`), so it
  stops binding every new session. (#26)
- A long helper hand-back is kept in full; default helper effort is documented. (#27)
- The size reading after a built-in advisor call counted both models' input,
  about double; it now reads the main model's own steps. (#28)
- The card names the built-in advisor first for a second opinion. (#29)
- The pre-dispatch check reads brief labels in any case ("For:", "Done when:"). (#30)
- File changes made through the shell count as edits; notes files and
  `git checkout` no longer trip the review alarm. (#31)
- The built-in advisor's tokens are counted in cost totals at the advisor
  model's own rate, and a total says when an unpriced advisor is left out. (#32)
- A refused shell line names the part that stopped it, not a lowercase branch
  delete that was already right. (#33)
- A helper past its size budget is told so in words ("past the ~120k budget"),
  not "~121k of ~120k", which read live as still inside it.
- The skill says the built-in advisor is not an independent review: it watched
  the edits being made.
- A review that failed and then passed on a follow-up to the same reviewer
  no longer makes the stop hook say the review found a problem, when the pass
  names the same work. The reviewer's first line now says which work it judged
  ("OUTCOME: PASS (REVIEW OF: <id>)"); a pass about other work, or naming
  none, leaves the fail standing.
- A second fail after a pass is said again, and a fresh reviewer's fail holds
  even if another reviewer passed the same work.
- A hand-back names reviewed work only when its opening line is a PASS or FAIL
  verdict, so a builder quoting a review anywhere is not taken for one, and a
  look that came back with no verdict no longer counts as reviewed (the stop
  hook says "came back with no verdict; send it again"). A second
  reviewer counts as still looking only while it has not replied and was sent
  within six hours.
- The "this change touches ..." stop line is said once per risky edit; it no
  longer comes back as the chat grows.

Seen and not fixed: a helper's own compaction reached the lead's after-compaction
card because the host sent no agent id (a Claude Code gap, to report); the
compaction count is one high as a result. The built-in advisor is not treated as
an independent review: in this session it had seen the cost change and a
reviewer still found three mislabels.

## Earlier releases

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
