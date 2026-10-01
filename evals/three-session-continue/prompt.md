---
name: three-session-continue
description: Ability - pick up where earlier sessions left off from the files and history alone. Three earlier sessions are seeded as commits plus docs/plan.md; the third left markDone half-written and not wired up. The prompt is one word.
tags: [three-session-continue]
runs: 3
max_turns: 20
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill, Bash, Write, Edit]
expected_outcome: Without asking what to continue, the assistant works out from the plan and the history that the next step is finishing "mark a todo done" by wiring the half-written function, does it, and says what it did and what comes next. It does not redo steps 1 and 2 or start steps 4 or 5 first.
---

continue
