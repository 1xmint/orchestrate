# Build state

Resume point for building the `orchestrate` skill.

## v0.20.0 — plan 0007: replies that draw, the owner's words kept, grants that hold, 2026-10-01

From the first live run of 0.19.0 (notes A-X in
`docs/audits/2026-10-01-live-session-notes-0.19.0.md`; plan in
docs/research/0007-next-phase.md).

- Replies explain in flowing sentences and draw a real diagram when a picture
  helps, instead of arrows in text (measured: docs/research/0007-eval-explain.md).
- The run goal and the save point keep the owner's own words, so a resumed
  session works toward what was asked, not a paraphrase of it.
- A model the owner names for every helper ("use opus for all of them") covers
  the whole run; a question, or a sentence that splits the work across models,
  grants nothing.
- The merge check reads words where bash splits them: brace groups bash leaves
  alone stay text, quoted or escaped separators stay in their word, and a
  heredoc body is read on its own, so writing a file of code is no longer
  refused and a merge hidden in braces still is. Three independent reviews.
- Hook lines: the dispatch line gives size and price, in plan mode only this
  session's plan file counts as a checkpoint, and the run template is shorter.
- A new case, `side-question-goal`: a side question mid-fix must not replace
  the fix, and its answer must come from the repo.

- A helper gets the lead's tools, no more: what the lead cannot run, it is not
  sent to run (SKILL §6). With no shell, helper sends fell from 3/3 to 0/3 in
  side-question-goal; three-session-continue shows no change (1/3 either way).
- Grader fixes in side-question-goal: a regex on the file where an LLM judge
  passed untouched code (note V); two rules read the last message, not the run
  record. Six rules in other cases still read the record (note X).
- Dropped to make room: SKILL's "Never `Write` a whole file you could `Edit`.
  Never `Read` back a file you just wrote." The card carries it at session
  start and after a summary; the build for other hosts has no card and loses
  it (note W).

Measured in docs/research/0007-eval-release.md ($10.03 of $15): on five cases
against no plugin, every grader is level within one run of three; the plugin
costs about a third more per run. Two earlier leads (drawing, plan questions)
did not hold at three runs a side. Note X names judges that read a record with
its middle cut out.

## Earlier releases

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
