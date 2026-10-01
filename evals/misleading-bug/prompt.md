---
name: misleading-bug
description: Ability - fix the cause, not the place the error shows up. The crash is reported in report.js, but the real cause is in parser.js, which drops the last data row when the file has no trailing newline. Hiding the crash in report.js would make September show 0 or vanish.
tags: [misleading-bug]
runs: 3
max_turns: 25
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill, Bash, Write, Edit]
expected_outcome: The parser keeps the last row, node --test passes with September at 120, and the final message names the cause in plain words with its evidence. A guard, optional chaining, or a default of 0 in report.js alone is a fail, as is claiming a fix without running the tests.
---

The monthly report crashes. The error is in report.js. Can you fix it?
