# Scoresheet r11, first attempt (one helper) - PARTIAL: header and grounding only

Status: **PARTIAL**. The auditor's size notice arrived at turn 7 (about 85k of a 120k budget) after the
required reading alone, before any mechanism was probed. By the brief's rule the work stopped there.
No area is scored in this file. Nothing below is a verdict on the plugin.

## Header

- Commit: `f9d5086` (branch `task/0092-audit-r11` cut from it; `audit/scoresheet-to-ten` and main at the same commit).
- Plugin: 0.16.1 (`.claude-plugin/plugin.json:4`, `skills/orchestrate/SKILL.md:20`).
- Claude Code: 2.1.274. node v24.14.0. Windows 10 Home 10.0.19045.
- Commits since round 10: `git log --format='%h %s' c63be76..f9d5086 --no-merges` lists 80.

## Measured so far

- [measured] `node scripts/test.mjs` at f9d5086, run twice: 1,097 tests, 1,096 pass, 1 fail, 56.5 s
  (63 s wall on the first run). The one failure is "both packaged artifacts exist and the tests are
  not in them": the built artifact is not present in a fresh checkout. Round 10 saw the same failure
  in its export and for the same reason. Round 10 counted 928 tests; 169 were added since.
- [measured] `hooks/hooks.json`: 8 events, 9 leaf entries, 8 scripts (router twice), timeouts 5 to 15 s.
  `PreCompact` is not registered; `PostCompact` is.
- [measured] Bytes: `SKILL.md` 19,992; references total 76,200 across ten files; `README.md` 46,525;
  `STATE.md` 20,620; `AGENTS.md` 5,317.
- [measured] Scripts: 22 non-test scripts, 7,266 lines; 30 lib modules.

## Part C item 3 (helpers run out of room): one live data point from this very audit

This helper was the case in question. Its record:

- 7 turns, 15 tool calls, no source file of the plugin read in full, no stream printed.
- What it read: the brief (127 lines), the audit prompt (226 lines), the round 10 scoresheet
  (172 lines), live r16 (50 lines), live r15 and r14 cut to 700 characters a line, the commit list
  (80 lines cut to 170 characters), two test-file heads.
- The round 10 scoresheet and the live reports are tables whose rows are single lines of 1,000 to
  3,000 characters. Line counts make them look small (172, 131, 140 lines); their size is in the
  width. The scoresheet alone is about 40 KB.
- So the cause, for this helper, is what the brief makes it read before it can start, not the number
  of steps: the required inputs are larger than the room left for the work. This supports the lead's
  guess in the brief ("what they read, not how many steps"). It is one data point, not a survey of
  the four earlier rounds; their records were not opened.
- Smallest change: a brief for an audit of this size names, per input, the section to read (for
  example "round 10: sections 3 and 4 and the verification table only"), or the audit is cut into
  two helpers (areas 1 to 6 with the live reports; areas 7 to 16 with the probes), each writing its
  own half of the report.

## Not done

Every scored section the brief lists: score table, both totals, what works, verification table, top
five, scenario table, verdict, the rest of Part C, the five things the lead saw (items 1, 2, 4, 5),
the "fix this on the frontend" question, the six known limits, the five post-r16 probes. No live run
was made. Live r13, r12 and r11 were not opened.

## Commands run

- `git checkout -b task/0092-audit-r11 f9d5086`
- `git log --format='%h %s' c63be76..f9d5086 --no-merges`
- `node scripts/test.mjs` (twice)
- `claude --version`; `node --version`
- `wc -l` and `wc -c` over the documents named above; `ls` of `hooks`, `scripts`, `skills/orchestrate/**`
