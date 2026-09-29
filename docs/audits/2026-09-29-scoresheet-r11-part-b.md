# Scoresheet r11, part B (task 9-29-0092b) - PARTIAL: stopped on the size notice before any probe ran

Commit audited: f9d5086. Areas: 2 Cost, 7 Context, 8 Hooks, 10 Routing, 11 Packets, 12 Agents.
No live run was made. No probe was run. Paths are written `<repo>`, `<home>`, `<temp>`.

This helper stopped at its 13th step, when the plugin's size note read "~81k of ~120k budget".
The brief says to stop at once on that note, so it did. Everything below is from reading the code
at f9d5086, tagged [read]. The scoring rule allows no score above 6 without a measurement, and
asks for a probe behind every verdict, so no area is scored and no verdict is given here.

## 1. Score rows

| Area | r11 score | r10 score | Evidence | Control |
|------|-----------|-----------|----------|---------|
| 2 Cost | not scored | 9 | No measurement taken this round. | plugin controls |
| 7 Context | not scored | 9 | No byte counts taken this round. By decision the after-compaction card stays, so 10 is closed there. | plugin controls |
| 8 Hooks | not scored | 9 | [read] `hooks/hooks.json`: 9 entries, 8 scripts, timeouts 5 to 15 s. No timing or bad-input probe run. | plugin controls |
| 10 Routing | not scored | 9 | No dispatch probe run. | plugin controls |
| 11 Packets | not scored | 9 | No return probe run. | plugin controls |
| 12 Agents | not scored | 9 | Role files not opened. | plugin controls |

## 2. Verification rows

| Finding | Mechanism at f9d5086 | Proof | Verdict |
|---------|----------------------|-------|---------|
| First-helper wait lets helpers sent together through (r16 fault 4) | [read] `guard-agent.mjs:702-719` `firstHelperRefusal`: refuses each dispatch while the lead's last message names no model, stores the refused call ids, stops after three, and never refuses once a dispatch is on record. Test at `guard-agent.test.mjs:266`. | none run by this helper | not probed (built, not seen live, per the brief) |
| Same, weak spot | [read] `guard-agent.mjs:712`: the word "model" alone counts as naming a model, so "I will update the data model" would pass the wait. | none run | not probed; worth one probe |
| Same, weak spot | [read] the three calls are sent one after another in the test. Helpers sent together run the hook at the same moment; whether the stored list survives that is untested. | none run | not probed; worth one probe |
| Leftover note raised as a stop error and miscounted (r16 fault 3) | [read] `context-check.mjs:272-286` raises it on a tool call, once, only when no helper is working; `turn-check.mjs:209-233` counts folders and branches apart from what git lists. Test at `turn-check.test.mjs:349-361` asserts the stop path prints nothing. | none run | not probed (built, not seen live) |
| Known limit: no window reported, size line shows no total | [read] `lib/context-advice.mjs:240-241`: the "of N" part is printed only when `reportedWindow` returns a value. | none run | consistent with the code as read; not probed |
| Known limit: review hold assumes the reviewer's dispatch is on record first | [read] `turn-check.mjs:124-145` `reviewHoldDecision` clears a hold only from dispatch rows already in the session state. | none run | consistent with the code as read; not probed |

## 3. Smallest change per area under 10

Not answered: no area was scored. Round 10's own list for these areas is at
`docs/audits/2026-09-28-scoresheet-r10.md` lines 54-64.

## 4. Part C answers

Item 3, helpers run out of room. This helper is a second data point, and it followed the split
file's reading rules. Steps taken: 13. Text read: the split file (4.7 KB), the parent brief
(11 KB), live r16 cut to 900 characters a line (about 9 KB), six r10 rows cut to 500, about 60
lines of the audit prompt, and about 250 lines of source and tests. That is roughly 60 KB, or
about 15k to 20k tokens, yet the note read 81k. So most of the room was taken before the first
read: by the helper's own starting text and the list of tools the host gives it. The first attempt
(85k after 15 steps) blamed wide tables; this run shows wide tables are only part of it.
What this means for the plugin:
- A budget of about 120k leaves a helper on this machine perhaps 40k to 50k of working room. An
  audit of six areas with probes does not fit in that, however carefully it reads.
- Smallest change in the plugin's texts: the brief template should ask the lead to size a task
  against the working room left after the helper's starting load, not against the whole budget,
  and to split a job whose required reading alone is over about 30 KB.
- Smallest change as a mechanism: the first size note a helper receives could state the size it
  started at, so the lead can see the fixed load in the helper's progress file.
- Not checked: the exact starting size. This helper saw only one size note, at step 13.

Item 4 (proof that a new test fails on old code) and the "fix this on the frontend" question:
not answered. The role files, SKILL.md, routing.md and evaluation.md were not opened.

## 5. Commands run

- `git checkout -b task/0092b-audit f9d5086`
- `node scripts/package.mjs --both` then `node scripts/test.mjs`, output to `<temp>/o92b/test.log`: [measured] 1097 tests, 1097 pass, 0 fail, 103 s. This is the one measurement taken. It shows the plugin's own tests pass at f9d5086; it is not a probe of any finding above.
- `grep -n -E "^\| (2|7|8|10|11|12) \|" docs/audits/2026-09-28-scoresheet-r10.md | cut -c1-500`
- `sed -n '21,42p;119,125p;150,190p' docs/scoresheet-audit-prompt.md`
- `cut -c1-900 docs/audits/2026-09-29-live-runs-r16.md`
- `grep -n` and `sed -n` over `guard-agent.mjs` (576-600, 655-735), `turn-check.mjs` (64-166, 200-252), `context-check.mjs` (268-290), `lib/context-advice.mjs` (225-256), `router.mjs` (80-100), `guard-agent.test.mjs` (1-70, 240-300), `turn-check.test.mjs` (348-362, 603-640), `hooks/hooks.json`

## For whoever continues

Probes to run first, in this order, each one small:
1. Three dispatches at the same moment (not one after another) with a lead message naming no model; then a fourth.
2. A lead message that says "data model" and names no real model.
3. `context-check.mjs` on a tool call with two returned helpers and their folders in a real throwaway repo: the note once, then silence; `turn-check.mjs` on a stop: silence.
4. Size line with and without a reported window.
5. `reviewHoldDecision` with the reviewer row present, absent, and failed.
Then byte counts for area 7 and timings for area 8. Give each area pair its own helper.
