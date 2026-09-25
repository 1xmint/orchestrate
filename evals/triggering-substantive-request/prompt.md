---
name: triggering-substantive-request
description: Area 9 (Triggering) from docs/audits/2026-09-24-scoresheet-r1.md — "No self-run measurement of skill firing." This prompt is the kind SKILL.md's own description names ("plan and build X" — a multi-step, non-trivial request), so the orchestrate skill should fire on it. The mirror case (a trivial prompt should stay quiet) is a deterministic property of router.mjs's substantive threshold (non-slash, no fence, >=4 words), already covered by the plain-Node tests `the first substantive prompt gets the state line and the card, once` and `non-substantive prompts are silent and do not spend the card` in skills/orchestrate/scripts/router.test.mjs — not repeated here as a model-driven eval because it costs nothing to prove deterministically and a real model call cannot make that logic more or less true.
tags: [triggering]
runs: 3
max_turns: 20
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill, Bash, Write, Edit]
expected_outcome: The assistant invokes the orchestrate skill (directly or namespaced) at least once while working the request, and its final message stays plain language with no internal machinery.
---

Plan and build a small URL-shortener service: pick an approach, implement it, add tests, and write a short usage doc.
