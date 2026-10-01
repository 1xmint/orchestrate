---
name: explain-port
description: Ability - do not draw when one fact answers it. The owner of a small club site asks one factual question. The answer comes first, in a sentence or two, with no table, sketch or diagram.
tags: [explain-flow]
runs: 3
max_turns: 8
timeout_seconds: 300
allowed_tools: [Read, Glob, Grep, Skill]
expected_outcome: The first sentence says the site listens on port 4321 (the address it prints is http://localhost:4321). No table, no sketch, no diagram, no Mermaid, and no more than a few sentences.
---

Which port does this site run on?
