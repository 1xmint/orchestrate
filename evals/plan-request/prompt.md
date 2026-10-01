---
name: plan-request
description: Ability - make a plan a non-programmer can judge. The owner of a small notes app asks for a plan, not a build. The plan must say back what they want in their own terms, ask only what they can answer (each with a recommendation), rest on what the code actually has, say what they will see after each step, and add nothing they did not ask for.
tags: [plan-request]
runs: 3
max_turns: 20
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill, Bash, Write, Edit]
expected_outcome: A plan, and no code. It restates the goal as "your partner can see the notes you choose, and the rest stay private"; it names the real files and the fact that nothing today marks a note as shareable; it puts how the notes reach the partner (and who else could see them, and any cost) to the owner as a plain question with a recommendation; each step says what the owner will see when it is done; and partner editing or other extras appear only as offers, not as steps.
---

My partner wants to be able to see some of my notes. Can you plan how we'd do that? Don't build anything yet, I want to look at the plan first.
