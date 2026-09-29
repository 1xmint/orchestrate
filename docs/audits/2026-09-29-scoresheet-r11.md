# Scoresheet audit, round 11 (2026-09-29) - PARTIAL

Status: **PARTIAL, and the last round.** Five areas are scored. Eleven are not,
and no total is given, because a total over five areas would not be comparable
with round 10's 89.

Commit audited: `f9d5086`, plugin 0.16.1, 80 commits after round 10. The fixes
this round led to are in 0.17.0 and were not re-scored.

## Why it is partial

The audit was sent to one helper, then to three, then to five. Each stopped on
its size note before it had probed most of its areas. Two of them measured why:
a helper with a budget of about 120k starts with most of that already taken by
its own starting text and tool list, leaving perhaps 40k to 50k of working
room. An audit of five or six areas with probes does not fit, however
carefully it reads. The five smallest helpers returned nothing at all.

## Scores

| # | Area | r11 | r10 | Source |
|---|------|-----|-----|--------|
| 4 | Safety | 8 | 9 | part A |
| 9 | Triggering | 7 | 8 | part C |
| 13 | Tests | 8 | 9 | part C |
| 15 | Documentation honesty | 7 | 9 | part C |
| 16 | Maintainability | 8 | 10 | part C |

Not scored: 1 Delivery, 2 Cost, 3 Recovery, 5 Communication, 6 Onboarding,
7 Context, 8 Hooks, 10 Routing, 11 Packets, 12 Agents, 14 Currency.

The lower numbers come mostly from measuring different things than round 10
did, not from the plugin getting worse. The exceptions are real: the written
account had fallen 80 commits behind the code, and three hook scripts had
grown.

## The parts

- [First attempt](2026-09-29-scoresheet-r11-part-0.md): one helper, stopped after the
  required reading; no area scored.
- [Part A](2026-09-29-scoresheet-r11-part-a.md): Safety, with 41 commands
  probed in three modes.
- [Part B](2026-09-29-scoresheet-r11-part-b.md): no probes run; code read
  only; a list of probes worth running first.
- [Part C](2026-09-29-scoresheet-r11-part-c.md): Triggering, Tests,
  Documentation honesty, Maintainability, and the judgment on the method.

## What was done about each finding

| Finding | In 0.17.0 |
|---------|-----------|
| `git -C . worktree remove --force` skips the unsaved-work check | fixed: leading git options are removed before any rule reads the line |
| `git reset --hard` and `git checkout -- .` pass unasked | fixed: stopped only when the folder holds unsaved edits |
| A quoted branch name is refused by the small delete | fixed |
| A refused line says twice that nothing ran | fixed |
| The bare word "model" passes the first-helper wait | fixed |
| Helpers sent at the same moment may slip the wait | probed: all three refused; a test now holds it |
| Three-word build or fix requests get no card | fixed |
| A period in a file name counts as a sentence end | fixed |
| A fix request is told "just do it yourself" | the short card now says to find the cause first |
| No finish line when the measure is a judge | the run template asks for one |
| A check that tests nothing | `references/dispatch.md`, "Before you send" |
| The written account trails the code | STATE.md and README.md updated; version raised to 0.17.0 |
| Three large hook scripts | not done; about a day of work |
| Currency not probed | not done |
| Recovery note lists returned helpers as never returned | not probed at f9d5086; seen in a session running the installed 0.16.1 |

All fixes are built and tested. None has been seen in a real session yet.
