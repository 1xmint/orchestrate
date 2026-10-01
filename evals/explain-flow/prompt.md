---
name: explain-flow
description: Ability - explain how something works so a non-programmer can follow it. The owner of a small club site asks how logging in works and whether Google sign-in would change much. The reply must connect its reasons instead of listing clipped facts, define each technical word where it first appears, show the login as a small picture (a table or sketch, never Mermaid), and recommend with a cost.
tags: [explain-flow]
runs: 3
max_turns: 15
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill]
expected_outcome: An explanation in flowing prose that a non-programmer can follow - the form sends email and password, the password is checked against a scrambled copy in users.json, the site then hands the browser a ticket (a cookie) that lets it into the members page until the server restarts - with one small table or text sketch of those steps in order. On Google - the password check is what changes, the ticket and members page stay; a recommendation and what it costs. No code changed.
---

I don't write code. Can you explain how logging in works on this site, and whether adding "sign in with Google" would change much? Don't change anything yet.
