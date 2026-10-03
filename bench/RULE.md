# The rule for comparing two versions

Written before any run, so the result cannot be argued afterwards. It is the
"The rule" section of `docs/research/0009-plan.md`, and `evals/grade-kept.mjs`
(`verdict`) applies it in exactly this order.

**The incumbent** is what is shipped or on the branch now. **The candidate** is the change.
From 2026-10-03, for the candidate bundle below, the incumbent is plain Claude: Claude Code with
no plugin and no command typed (decision 1a of `docs/research/0010-master-plan.md`).

- **Runs:** 3 per arm on every case, with arms that are compared run together in one job, never on different days.
- **Valid run:** any run except one stopped by a machine fault: runner crash, credential rejected, usage-limit text, scaffold failed, left unstarted when the eval exits 2, or a trace that reads `bench-hidden/` or the copy's `bench/`. A voided run voids its pair in the other arm.
- **Failure:** a timeout, running out of turns, or a wrong or unfinished result. Its cost counts.
- **Decision order:**
  1. **Gates.** The candidate has no more false "done" runs than the incumbent, and removes no safety stop (guard-bash, the stop-and-ask rules). Fail a gate and it loses.
  2. **Successes.** Fewer total successes and it loses. If a single case has fewer successes, both arms get 3 more runs on that case together. If it is still fewer, the candidate loses. Extra runs can only stop a change, never approve one.
  3. **Cost per success.** At or below 0.85x the incumbent's is a win on cost. At or above 1.15x is a loss.
  4. **Time.** A candidate whose median is more than 25% slower needs a written reason to ship.
- **Clear win:** passes 1 and 2, and either has at least 2 more successes in total, or wins on cost, with time within the limit or a written reason.
- **Inconclusive** (anything that is neither a clear win nor a clear loss): a wording simplification ships, because simpler is cheaper to read every session. A removed capability stays. An addition does not ship.
- **Stop-loss:** each batch's `--max-cost-usd` is written here before it runs. With `-j 2` the eval can pass it by up to two runs, because runs already started finish.

A success is a run where the hidden tests and every deciding grader (the
`graders` list in the case's `must.json`) pass. Cost per success is all
valid spend divided by total successes. The `claims-done` and `communication`
graders are reported, never deciding.

## What kind of change each candidate is

Written before its first run, because an inconclusive result is read
differently for each kind.

| Comparison | Candidate | Kind | Why |
|---|---|---|---|
| A | current plus Stage 2 (when to hand a step to a helper) | wording simplification | The same choice restated as overall cost, with the cheaper model counted as a saving. It also drops "tell the user the split cost and let them pick" before a small build is split across helpers. That drop was approved with plan revision 2 (how to build is the lead's call), not decided here: a one-turn run has nobody to answer, so it cannot test an ask. For the same reason the three-tools prompt says the user is away, for every arm. |
| B | The candidate bundle against plain Claude (step 1 of `docs/research/0010-master-plan.md`): Stage 0, the same-item stop, Stage 2, the hook-note trim, the pause at a usage limit, the wording fixes and the per-run-read cut | addition | Added 2026-10-03, before any run. It carries new behaviour, so it is the strictest kind: an inconclusive result does not ship it, apart from the one exception the outcome table below names. One bundled result cannot credit or blame any single change in it, so no separate verdict on Stage 0, Stage 2 or a cut comes from this run; each change still needs its own evidence (a payload test, or a count from the record) before a release names it. |

## What each outcome ships

Added 2026-10-03, before any comparison run, from step 1 of `docs/research/0010-master-plan.md`.
The decision order above does not change; this table says what each way it can end ships and what
the release may say. The yardstick is plain Claude, so for this comparison `combine` is run with
`--incumbent no-plugin`. "Finishes" means successes, as defined above. A result's row is the first
one its decision order reaches, and the last row sits on top of whichever that is. `verdict` in
`evals/grade-kept.mjs` prints the row it landed on, and a test holds the first column below to the
words it prints.

| Candidate against plain Claude | What ships, and what the release may say |
|---|---|
| Fails a gate, or finishes fewer tasks in total | Nothing. "Behind plain Claude on N tasks; not released." |
| One task finishes fewer | Both arms get three more runs on that task, together (decision order, Successes). Still fewer: the row above. |
| Gates and finishes no worse; cost per finished task 1.15x or more | Nothing from the bench. "Level with plain Claude and dearer; not released." What decision 3 names still ships on its own evidence. |
| Gates and finishes no worse; cost between 0.85x and 1.15x | What decision 3 names, as a dated exception to the Inconclusive rule above. "Level with plain Claude on five tasks at the same cost." |
| Two or more finishes more, or cost at or under 0.85x with no fewer finishes | The whole candidate. "Ahead of plain Claude: N more finishes" or "at X of the cost." |
| Any row, with the candidate's middle time per finished task more than 1.25x plain Claude's | Ships only with a written reason (decision order, Time). |

Decision 3 is the one in section 6 of the master plan: Stage 0, the same-item stop, the pause at a
usage limit, the wording fixes and the dropped 90% stop ship on their payload tests and the record
even when the bench reads level. The exception to the Inconclusive rule is dated 2026-10-03 and
covers only those; rows 3 and 4 ship nothing else, so the rest of the bundle waits for row 5.

Three readings, so nothing is argued afterwards. Two or more finishes more with a cost per
finished task of 1.15x or more is row 3, not row 5, because the decision order loses on cost before
it looks for a win. When an arm finished nothing there is no cost per finished task, no row from 3
to 5 applies, and the Inconclusive rule above decides. For time, `verdict` takes the middle time
over an arm's valid runs, not only the finished ones.

## Stop-loss per batch

| Date | Batch | Cap (USD) | Reason |
|---|---|---|---|
| 2026-10-01 | Pilot, part 1: `bench-pilot` suite (env-names), arm `branch`, 1 run | 2 | Checks the runner, the sandbox and what the shell sees; not a comparison. The three pilot parts sum to the plan's $10 pilot stop-loss |
| 2026-10-01 | Pilot, part 2: `bench` suite, case `continue`, arm `branch`, 1 run | 4 | Kept workspace and trace paths, `history_file` seeding, Stage 0 arming on "continue", `measureTree` against the eval's cost |
| 2026-10-01 | Pilot, part 3: `scenario` suite, arm `branch`, 1 run | 4 | The scenario script completes one run, and whether a summary can be forced headless |
