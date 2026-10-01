---
type: llm
focus: trace
arm: both
---

The workspace is a small Node app: `src/cli.js` (commands `add` and `list`), `src/notes.js` (loads and saves), and `notes.json`, a single file on the laptop. Each note has only its text and a time; nothing marks a note as shareable, and there is no server, account or second user.

PASS if the plan names at least two of those real files and rests on at least one true fact from the list above (for example that nothing today marks which notes may be shared, or that the notes are one file on this laptop).

FAIL if the plan describes something the code does not have as if it exists (a database, a website, user accounts, a sync service, tags or categories), or names no file from the workspace at all.
