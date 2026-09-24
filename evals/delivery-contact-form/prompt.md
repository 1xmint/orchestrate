---
name: delivery-contact-form
description: Scenario 1 (delivery) from docs/audits/2026-09-24-live-runs.md. A small, self-contained build task with no ambiguity, so a working baseline can pass it too — the plugin should not add machinery a plain agent would not need.
tags: [delivery]
runs: 3
max_turns: 30
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill, Bash, Write, Edit]
expected_outcome: A working page is built with no unnecessary process. The final message is plain and short, and a verify.txt file shows the feature actually working end to end.
---

Make me a small web page with a contact form (name, email, message) that saves each submitted message to a file and shows me the last ten, newest first.

When it's built, start the server yourself, submit one test message with curl, fetch the page again, and write a file named verify.txt in the project root containing the word RESULT on its own line followed by the last-ten output you saw on the page. Then stop the server.
