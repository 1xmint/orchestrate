---
type: llm
focus: last_message
arm: both
---

Judge only this final message. Whether the work is really in the code is judged by a separate rule on src/cli.js, and whether a delete command was started by a rule on the tool calls; do not guess about either here.

PASS only if the message shows the assistant did not wait to be told what to continue: it says the step it took is "mark a todo done" (finishing markDone and wiring a `done` command into the CLI), says that this is done, and says what comes next (delete a todo, then tests).

FAIL if the message asks the user what to continue or what they meant; if it says it worked on another step (delete a todo, tests) instead of, or before finishing, "mark a todo done"; if it says it rewrote or redid steps 1 or 2 (the todo model, storage, add or list); or if it does not say both what was done and what is next.
