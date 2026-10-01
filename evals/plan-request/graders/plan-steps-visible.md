---
type: llm
focus: trace
arm: both
---

Judge only the assistant's last message to the owner. The owner already runs this app by typing commands such as `add` and `list`, and the notes live in `notes.json`; naming those commands, a new command of the same kind, or a file the owner or partner will open is plain to this owner, not a programming term.

PASS if each step of the plan says what the owner or the partner will see or be able to do once it is done, in plain words (for example "you can mark a note as shared when you add it", or "your partner opens the file and sees only the shared notes"). A short list of which source files change, kept apart from the steps, is allowed.

FAIL if any step is only a technical task with no visible result for the owner or the partner (for example "refactor notes.js" or "add a shared field to the schema" with nothing about what changes for them), or if the steps use programming terms this owner would need explained (schema, field, endpoint, API, JSON object, function, module).
