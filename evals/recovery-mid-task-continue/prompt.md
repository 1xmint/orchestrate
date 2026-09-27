---
name: recovery-mid-task-continue
description: Scenario 2 (recovery) from docs/audits/2026-09-24-live-runs.md, seeded variant. The turn cap is set low on purpose to cut the run off mid-task, the way a killed session would — the case then grades whether enough was left behind on disk for a later session to pick the work back up without re-reading the whole thing.
tags: [recovery]
runs: 3
max_turns: 8
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill, Bash, Write, Edit]
expected_outcome: The run gets cut off before finishing (max_turns is deliberately tight). What matters is what is left on disk — a next session should be able to tell, without asking the user again, what the goal was, what "done" means, and what to do next.
---

In this project, add login with email and password, a profile page, and tests.
