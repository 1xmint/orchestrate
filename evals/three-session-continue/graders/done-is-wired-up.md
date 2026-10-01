---
type: llm
focus: { source: file, path: src/cli.js }
arm: both
---

PASS if this file now handles a `done` command that calls markDone from src/todos.js with the todo's id (converted to a number), so `node src/cli.js done 1` would mark todo 1 done.

FAIL if there is no `done` command, if it does not call the todos module's markDone, or if it re-implements marking done inline while leaving markDone unused.
