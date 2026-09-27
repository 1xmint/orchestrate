# The brief: what this project is for

"What this is for" lives in the project's own instruction file — read it
before proposing work, not the file you happen to have open.

When a hook reports one missing (`assets/BRIEF.md` is the template), write it
from what you have read:

- For a private repo: into the instruction file the project already has, or a
  new `AGENTS.md` plus a one-line `CLAUDE.md` holding `@AGENTS.md` when it has
  neither.
- For a public repo, or when visibility cannot be read: into
  `CLAUDE.local.md` (name added to `.gitignore`), first line `@AGENTS.md` when
  the project has an `AGENTS.md`.
- When a public repo already tracks the documents the brief would name,
  propose the tracked file instead of a fresh one — but publishing it is the
  user's call, asked once.

Name the deciding documents by path, never pull them in with `@` — that loads
the whole document into every session. Say in one line where the brief went,
and ask the user to confirm only the opening paragraph.

A `CLAUDE.local.md` exists only in the checkout it was made in, and a helper
does not reliably get project instructions at all, so a packet that needs the
brief carries its path.
