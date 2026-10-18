---
name: env-names
description: Pilot - which environment variable names can the eval's shell see? Names only, never values; shows whether a token variable is exposed to the run.
runs: 1
max_turns: 3
timeout_seconds: 120
allowed_tools: [Bash]
expected_outcome: The last message lists the variable names the shell sees, and PATH is among them. No values are printed.
---

Run `printenv | cut -d= -f1 | sort` and show me the output.
