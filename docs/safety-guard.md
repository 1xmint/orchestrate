# The Bash safety guard

`skills/orchestrate/scripts/guard-bash.mjs` runs before every shell command,
in the main session and inside every helper — whether the command runs
through the Bash tool or, on a Windows host, the PowerShell tool. Both tools
carry the command text the same way, so one guard and one set of patterns
covers both shells. It looks only at a short, fixed list of shapes that
throw away something a person cannot get back — a shared branch, a folder
of files, a published package, a live deployment, or real money — and stops
those. Everything else, including loud everyday commands like `npm test` or
`rm -rf node_modules`, passes through with no output at all.

## What it stops

- `git push --force` / `git push -f` (rewrites a shared branch's history)
- `git push origin --delete <branch>` and the `git push origin :<branch>`
  shorthand (deletes a branch on the shared remote)
- `git branch -D <branch>` and `git branch -d <branch>` (deletes a local
  branch). `-D` and a merged `-d` cannot be told apart without doing the
  merge check the command itself would do, so both are stopped — a plain
  `git branch` (listing branches) is untouched. Git commands work the same
  way in Bash and PowerShell, so this and every other `git ...` shape below
  is stopped in either shell.
- `git rm -r <path>` (removes tracked files from the project)
- `git clean -f`/`-fd` (permanently deletes untracked files, no undo)
- `rm -rf <path>` / `rm -fr <path>` in Bash, and `Remove-Item -Recurse
  -Force <path>` in PowerShell — including PowerShell's own aliases for
  `Remove-Item` (`rm`, `del`, `ri`, `rmdir`) and its short `-r` form of
  `-Recurse` — unless every target is either a well-known, reproducible
  folder (`node_modules`, `dist`, `build`, `out`, `coverage`, `.cache`,
  `.next`, `.nuxt`, `.turbo`, `.parcel-cache`, `target`, `__pycache__`,
  `.pytest_cache`, `.tox`, `venv`, `.venv`, `tmp`, `temp`) or already inside
  the OS temp directory
- `npm publish` / `yarn publish` / `pnpm publish`
- `gh release create`
- `vercel --prod`, `fly deploy`, `wrangler publish`/`deploy`,
  `netlify deploy --prod`
- any `stripe` CLI command other than a read-only one (`login`, `logout`,
  `config`, `version`, `help`, `listen`, `status`, `samples`, `open`)
- dropping or truncating a database: `drop database`/`drop table`/`drop
  schema`/`truncate` on a `psql`, `mysql`, `sqlite3`, `mongosh`, `mongo`, or
  `redis-cli` command line, including inside a `-c`/`-e`/`--eval` string;
  `dropDatabase()`/`.drop()` in a `mongosh`/`mongo` command; `redis-cli
  flushall`/`flushdb`; `prisma migrate reset`; `prisma db push
  --force-reset`; `rails db:drop`/`db:reset`; `knex migrate:rollback --all`;
  `dropdb`. Running a `.sql` file against a database (`psql -f x.sql`,
  `mysql < x.sql`) is **not** stopped on its own — only when the command
  line itself also says drop or truncate.
- ending programs by name rather than by one known process id: `taskkill
  /IM` (also `//IM` and `-IM`), `pkill`, `killall`, a `kill -9`/`-KILL`
  whose target is anything but plain process ids (`$(pgrep node)`, a
  backtick, `-1`), and PowerShell's `Stop-Process -Name`/`-ProcessName` or
  a `Get-Process | Stop-Process` pipe. `taskkill /PID 123`, `kill -9 12345`
  and `Stop-Process -Id 5` name one process the caller already knows and
  are **not** stopped. A name ends every program by that name on the
  machine, other people's servers and sessions included.

Throwing away every unsaved edit at once (`git reset --hard`, `git checkout
-- .`, `git restore .`) is stopped only when the folder holds edits that
were never committed, because git keeps no copy of those. In a clean folder
it passes, and so does a discard that names single files. A commit dropped
by `git reset --hard <older commit>` is not what is guarded here: git keeps
it for weeks and `git reflog` finds it.

Options written before git's command word (`git -C <folder> push --force`)
are taken out before any rule reads the line, so the word order cannot step
round a check.

## What happens when one of these is about to run

- **From the main, interactive session:** the command is held and the
  person is asked one plain sentence — no git jargon, no task ids, no role
  names — with the option to say yes and let it run anyway.
- **From a background helper:** Claude Code surfaces a background helper's
  permission prompt in the main session, so in `"default"`, `"acceptEdits"`
  and `"plan"` the helper gets the same plain question the main session
  would. In any other mode, or when the payload names no mode, nobody can
  say yes, so the guard refuses the command outright, says the question
  cannot be answered here, and tells the helper to report back what it was
  about to run instead of retrying. A hook payload carries `agent_id` only
  when it fires inside a helper's own call; that field is the signal.
- **From a session with nobody able to see an interactive prompt at all:**
  the guard also refuses outright, naming the mode in plain words in the
  reason, rather than asking. Three `permission_mode` values put a session in
  this state: `"bypassPermissions"` (set for
  `--dangerously-skip-permissions`), `"auto"`, and `"dontAsk"` — a session in
  any of these never shows a prompt to anyone, so an "ask" there would either
  hang or, on at least one machine this was checked against, silently pass as
  if nobody had objected. `"default"`, `"plan"`, and `"acceptEdits"` still
  show a prompt, so those keep asking. A plain `claude -p` run that does not
  also set one of the three headless modes is not distinguishable from an
  ordinary interactive session anywhere in the hook payload, so it is not
  treated as headless here; it still gets asked. If that turns out wrong in
  practice, the fix is a better-documented field to key on, not guessing at
  one now.
- **The same command asked twice in one session:** the second identical
  command gets the same "ask" decision, but the reason starts "Asked
  already: " instead of reading like the first time. This is for a model
  that cannot see an answer to its first ask (a headless run, or a helper
  relaying the guard's own wording back as if it were an instruction) and
  would otherwise send the same command again and again; a person who
  already said yes in an interactive session is not affected by this — the
  session applies their answer before the guard ever sees a next call. The
  guard keeps one small file per session under the plugin's own state
  directory to remember what it already asked; a missing or unreadable file
  reads as "nothing asked yet".
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
  can act on: what would happen, ending with "Say yes to continue. If
  nobody can answer here, stop and tell the user what you were about to run
  instead of trying again."

Add a case to `guard-bash.test.mjs` for the new shape, and a case proving
the command it must *not* catch still passes through silently — a rule that
is too broad is exactly as costly as a missing one, just quieter about it.

## The dispatch guard's own review gate

A different guard, `guard-agent.mjs`, holds a task's DONE return back for
independent review not only when its packet says `REVIEW: yes`, but also
when the packet's own OBJECTIVE mentions money, auth, destructive data, or a
shared contract — the word list lives in `REVIEW_WORDS` in that file.
