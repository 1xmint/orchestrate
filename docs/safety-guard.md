# The Bash safety guard

`skills/orchestrate/scripts/guard-bash.mjs` runs before every shell command,
in the main session and inside every helper. It looks only at a short,
fixed list of shapes that throw away something a person cannot get back —
a shared branch, a folder of files, a published package, a live deployment,
or real money — and stops those. Everything else, including loud everyday
commands like `npm test` or `rm -rf node_modules`, passes through with no
output at all.

## What it stops

- `git push --force` / `git push -f` (rewrites a shared branch's history)
- `git push origin --delete <branch>` and the `git push origin :<branch>`
  shorthand (deletes a branch on the shared remote)
- `git branch -D <branch>` and `git branch -d <branch>` (deletes a local
  branch). `-D` and a merged `-d` cannot be told apart without doing the
  merge check the command itself would do, so both are stopped — a plain
  `git branch` (listing branches) is untouched.
- `git rm -r <path>` (removes tracked files from the project)
- `git clean -f`/`-fd` (permanently deletes untracked files, no undo)
- `rm -rf <path>` / `rm -fr <path>`, unless every target is either a
  well-known, reproducible folder (`node_modules`, `dist`, `build`, `out`,
  `coverage`, `.cache`, `.next`, `.nuxt`, `.turbo`, `.parcel-cache`, `target`,
  `__pycache__`, `.pytest_cache`, `.tox`, `venv`, `.venv`, `tmp`, `temp`) or
  already inside the OS temp directory
- `npm publish` / `yarn publish` / `pnpm publish`
- `gh release create`
- `vercel --prod`, `fly deploy`, `wrangler publish`/`deploy`,
  `netlify deploy --prod`
- any `stripe` CLI command other than a read-only one (`login`, `logout`,
  `config`, `version`, `help`, `listen`, `status`, `samples`, `open`)

`git reset --hard` with no argument is **not** stopped: on its own it only
discards uncommitted edits in the working copy, never a commit, so there is
nothing here it could take that a `git reflog` could not get back if it
turned out to matter. Everything above it is either irreversible or reaches
outside the local repo.

## What happens when one of these is about to run

- **From the main, interactive session:** the command is held and the
  person is asked one plain sentence — no git jargon, no task ids, no role
  names — with the option to say yes and let it run anyway.
- **From a background helper:** there is nobody there to answer a question,
  so the guard refuses the command outright and tells the helper to report
  back to the lead instead of retrying. A hook payload carries `agent_id`
  only when it fires inside a helper's own call; that field is the signal.
- **From a session with nobody able to see an interactive prompt at all:**
  the guard also refuses outright, with the same plain sentence as the
  reason, rather than asking. The one field the hooks documentation confirms
  for this is `permission_mode: "bypassPermissions"` (set for
  `--dangerously-skip-permissions`) — a session in that mode never shows a
  prompt to anyone, so an "ask" there would either hang or, on at least one
  machine this was checked against, silently pass as if nobody had objected.
  A plain `claude -p` run that does not also set `bypassPermissions` is not
  distinguishable from an ordinary interactive session anywhere in the hook
  payload, so it is not treated as headless here; it still gets asked. If
  that turns out wrong in practice, the fix is a better-documented field to
  key on, not guessing at one now.
- **On malformed or unreadable input:** the guard prints nothing and exits
  0. A hook that crashes or prints broken JSON degrades the whole session,
  which is worse than letting one command through unexamined by this
  particular check — every other safeguard (git itself, the remote's own
  protections, a human reviewing the diff) is still there.

## Letting a specific command through from now on

A project can list commands its own user has already approved in
`.orchestrator/allow-bash.json`, at the repository root:

```json
{
  "allow": [
    "git branch -D old-experiment"
  ]
}
```

Each entry is matched exactly (whitespace collapsed to single spaces) — not
as a prefix or a pattern — so approving one command never quietly covers a
different one nobody saw. There is no wildcard and no way to turn the guard
off entirely from this file; it only ever removes specific, named commands
from the list above.

## Adding a new pattern

Add an entry to the `RULES` array in `guard-bash.mjs` (or extend `rmRule`
for another delete-target rule) with:

- `test(cmd)` — a predicate over the whole command string (already
  whitespace-collapsed and trimmed); and
- `reason` — one plain sentence a person who has never used git or this CLI
  can act on: what would happen, ending with "Say yes to continue."

Add a case to `guard-bash.test.mjs` for the new shape, and a case proving
the command it must *not* catch still passes through silently — a rule that
is too broad is exactly as costly as a missing one, just quieter about it.
