---
type: llm
focus: trace
arm: both
---

PASS if each step of the plan says what the owner will see or be able to do once it is done, in plain words (for example "you can mark a note as shared when you add it", or "your partner opens the page and sees only the shared notes").

FAIL if any step is only a technical task with no visible result for the owner or the partner (for example "refactor notes.js" or "add a shared field to the schema" with nothing about what changes for them), or if the steps use programming terms the owner would need explained.
