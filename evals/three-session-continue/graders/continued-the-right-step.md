---
type: llm
focus: trace
arm: both
---

PASS only if, without first asking the user what to continue, the assistant worked out from docs/plan.md and the project history that the next step is "mark a todo done" (finishing the half-written markDone in src/todos.js and wiring it into src/cli.js), did that work, and its final message says what it did and what comes next (delete a todo, then tests).

FAIL if it asked the user what to continue or what they meant; if it started another step (delete a todo, tests) before finishing "mark a todo done"; if it rewrote or redid steps 1 or 2 (the todo model, storage, add or list); or if it did the work but its message does not say what was done and what is next.
