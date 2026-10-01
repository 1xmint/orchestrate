# Eval: 0.20.0 release against no plugin

Cap written before any run: $15 list (`eval/rel-cap.md` in the run folder).
Spent: at most $10.03 (runs $5.68, judges $0.86, pilot $2.18 with its judge, false starts $0.03, the stopped explain-flow under $1.28).

Five cases, plugin from this checkout against no plugin, three runs each.
Tools: `Write Edit` only, no shell, as in 0.19.0 (this Windows machine refuses
a shell grant: "sandbox required but unavailable").

## Before the measured runs

- Two false starts, $0.03: one with no tools granted (two shell-only graders
  could never be judged), one with a shell (refused by the sandbox).
- `misleading-bug` dropped: its rules need `node --test` in the record, which a
  run with no shell cannot produce (also unmeasured in 0005 and 0006).
- A pilot of `side-question-goal` ($1.69, `eval/pilot/`) found two problems:
  - **A grader that passed broken code.** `fixed-the-total` was an LLM judge on
    the file and passed the unfixed code 3/3. It is now a regex on the file.
    Five other file-judged graders in other cases are listed in live note V.
  - **Two rules judging the wrong thing.** `answered-and-finished` and
    `tests-run` read the whole run record (`focus: trace`), which is longer on
    the plugin side because it sent helpers, and failed replies that were as
    good as the baseline's. Changed after seeing results to
    `focus: last_message`, the fix 0006 made in `plan-request`. Both sides are
    rerun on the changed rules.
  - **A plugin flaw.** The plugin side sent a helper to run the tests in 3 of 3
    runs, though the session had no shell, so the helper could not either:
    refused each time, $0.30-0.49 and 67-122 s against $0.18 and 25 s. Fixed in
    SKILL §3 at 18:24Z: "A worker has your tools, no more: what you cannot
    run, it cannot." (live note W). `explain-flow` had started two minutes
    before; the other four ran after.

## Results (passes out of 3 runs per grader)

Sources: `eval/rel-<case>.json` in the run folder.

| Case | Grader | No plugin | Plugin |
|---|---|---|---|
| explain-flow | flow-picture | 3 | 2 |
| | flow-connected, flow-google, no-mermaid, no-machinery, no-code-edited | 3 | 3 |
| three-session-continue | continued-the-right-step | 3 | not measured (1) |
| | done-is-wired-up, no-delete-command-yet, no-machinery | 3 | 3 |
| wrong-goal | raised-the-conflict, no-account-code-written, no-machinery | 3 | 3 |
| plan-request | plan-questions | 1 | 1 |
| | plan-no-extra-scope | 3 | 2 |
| | plan-intent, plan-grounded, plan-steps-visible, no-code-*, no-machinery | 3 | 3 |
| side-question-goal | all five | 3 | 3 |

(1) Two plugin runs failed it, but the judge read a record whose middle the
eval host had cut ("[…14 messages elided…]"), and the cut took the edits; the
file rule `done-is-wired-up` shows the work done in all three (live note X).

Cost and time per run (list price, judge excluded):

| Case | No plugin | Plugin |
|---|---|---|
| explain-flow | $0.11-0.12, 27-32 s | $0.15-0.16, 35 s |
| three-session-continue | $0.16-0.17, 22-26 s | $0.20-0.34, 28-81 s |
| wrong-goal | $0.11, 18-22 s | $0.10-0.11, 15-21 s |
| plan-request | $0.11-0.12, 30-31 s | $0.15, 32-34 s |
| side-question-goal | $0.11, 22-23 s | $0.14-0.16, 27-32 s |

Helpers sent to run what nobody in the session could, plugin side:
side-question-goal pilot (before the §3 sentence) 3/3; after it,
side-question-goal 0/3 and three-session-continue 2/3.

### Second placement

After these results the sentence moved from §3 (how big a job must be to hand
off) to §6 (choosing the evidence), where the lead decides how to check its
work: "What you cannot run here, no helper can either: say it is not run and
give the command." Plugin side only, three runs each (`eval/rel2-<case>.json`):

| Case | Helpers sent | Cost, time | Graders |
|---|---|---|---|
| three-session-continue | 1/3 | $0.19-0.20 and 28-34 s; the run that sent one $0.49, 116 s | as before; continued-the-right-step again not measured (cut record) |
| side-question-goal | 0/3 | $0.15-0.17, 28-35 s | all 3/3 except answered-and-finished 2/3 (2) |

(2) The failed reply shows the fix by its numbers ($45 not $40) and answers the
side question from `package.json`, but never says in words that a percent was
taken off as dollars.

Helper sends to do what nobody in the session could: 3/3 before any sentence,
2/6 with it in §3, 1/6 in §6. The §6 placement ships; the flaw is smaller, not
gone.

## What it shows

- **On these five cases 0.20.0 matches plain Claude and does not beat it.**
  Every grader is level within one run of three.
- **Two earlier leads did not hold.** The explain eval earlier today had no
  plugin drawing 0/3; today it drew 3/3, so the drawing rule's gain is no
  longer shown. The plugin's 3/6 against 0/6 on plan questions (0006) is 1/3
  against 1/3 here. Three runs a side cannot tell a real lead from luck.
- **The plugin costs more:** about a third more per run on the cases where
  both sides do the same work ($0.15 against $0.11), from reading its own
  instructions. Where it sent a helper it could not use, up to three times the
  cost and four times the time.
- **The helper flaw was real and is mostly fixed.** The lead said it plainly:
  "I don't have a way to run commands myself here, so I'll have a helper try."
- **Two measuring faults, both biased against the plugin:** an LLM judge that
  passed untouched code (note V), and judges that read a run record with its
  middle cut out (note X). The first is fixed; the second is named, with six
  rules still exposed.
- What 0.20.0 adds that these cases do not test: the run-wide model grant and
  the merge check, each held by tests (1244/1244) and three independent
  reviews, and the owner's words kept in the goal across a restart.

## Not measured

- Root cause on a misleading bug, and an honest report of a failed check: both
  need a shell in the run.
- Whether a drawing tool beside the reply gets used when one exists: the eval
  host has none, so every picture is a table.
- Three runs per side is a small sample: a 2/3 against 3/3 is one run.
