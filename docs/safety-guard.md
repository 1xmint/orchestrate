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

## What it is for, and what it does not catch

The guard catches what Claude would run by mistake. It is not built to stop a
command written to slip past it: Claude does not disguise commands, and chasing
every spelling of one cost eight review rounds in 0.18.0 for no change a user
could feel. A guard change gets one independent review. What it does not catch
is written here, not chased:

- git or rg settings made by an earlier command, before the line it reads;
- a destructive or paying command spelled in a way none of the shapes below
  name;
- anything a program does after it starts, beyond the words on the line.

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
  `config`, `version`, `help`, `listen`, `status`, `samples`, `open`), run
  directly or through `bash -c`, `$( )`, `env`, `sudo` or `npx`; a web call
  (`curl`, `wget` and the like) to a payment service's API host; or code run
  with `node -e`, `python -c` or a heredoc that loads a payment library. The
  word alone is not a payment only on a line the reader can vouch for whole
  (`plainLine` in `lib/shell-run.mjs`): every part a search or read (`grep`,
  `rg`, `cat`, `ls`, `git log`/`show`/`diff`/`status`/`grep`…), text written
  to a file, a read-only `stripe` command, or a `node -e` that only reads
  local files and prints; and nothing it does not follow (`$( )`, backticks,
  `<( )`, `<<<`, `( )`, `{ }`, `!`, loops, `>&`). Text written into git's or
  rg's own settings is not inert, since a git read then runs it. Where the text
  lands decides this, not what it says: a file inside a `.git` folder, a
  `.git` gitdir file, `.gitattributes`, a gitconfig or `.ripgreprc`, whatever
  command writes it (`>`, `1>>`, `&>`, `tee`). A `cd` into a `.git` folder also
  makes the line not plain. A path can be spelled into `.git` in endless ways
  (`"$D"it`, `$_`, `.gi?`, `.\.git`, `.git.`), so on a line that also has a git
  read or `rg`, any write at all makes the line not plain, wherever it lands:
  a redirect, a text writer, a heredoc to a file, `mkdir`, git's `--output`
  (or a shortened `--ou…`), `node -e`, or the payment CLI, whose `config --set`
  writes a file. Writing nowhere (`2>&1`, `/dev/null`, `nul`) does not count.
  PowerShell's `2>$null` does count: in bash, `$null` is a variable the line
  can set. Without a git read, `cd "$REPO" && grep …` stays plain. Any other line with the word `stripe` or a payment
  API host in it asks: a host reached through a script file, `curl -K` or
  `wsl` asks too. So `grep -n stripe README.md` passes and
  `for c in …; do stripe refunds create …; done` asks. The price: a line that
  only names a host but is not plain also asks, such as
  `git commit -m "move to api.paypal.com"`, `grep -rn api.paypal.com src | sort`
  or `nslookup api.paypal.com`, and so does an `rg` that writes its results to
  a file, such as `rg -n stripe . > out.txt`; in a helper or a headless run,
  that ask is a refusal. A PowerShell line that sends a git read's errors to
  `$null` and also searches for merge wording is refused
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

Removing a git worktree folder (`git worktree remove`) is stopped when the
folder holds changes that were never saved to git. A helper folder under
`.claude/worktrees/` is checked whether or not force is used; a missing
helper folder counts as clean. Any other folder removed with force
(`-f`, `-ff`, `--force`) is checked too, wherever it is, including the Git Bash
spelling of a Windows drive (`/c/path` is read as `C:/path`). If such a folder
is not there under that name, or git cannot read it, the guard cannot tell
whether work would be lost, so it refuses ("can't tell") rather than treating
it as clean. A plain removal without force of a folder outside
`.claude/worktrees/` is left to git, which refuses a folder with changes.
The line must say it in plain words: git, its `-C` folder, `worktree
remove`, the force flag (any start of `--force`, quoted or not) and folders,
alone or joined with `;`, `&&` or a plain `cd <folder>`. A brace, `$`, a
backtick, a leading backslash, a redirect other than to `/dev/null` or `&1`, or
anything in front of git (`if`, `!`, `env`, `sudo`, `eval`) is refused as
unreadable, the same way the merge check works, because each attempt to follow
one more spelling left another open. Quotes are read where bash reads them: a
`#` starting a word is a comment to the end of its line, and a heredoc
(`<<X` outside quotes and comments) has its body skipped as text unless its
line pipes it or starts a shell (`cat <<X | bash`, `bash <<X`). A quote that
cannot be closed (`$'a\'b'`), or a `\"` inside double quotes, which PowerShell
reads differently from bash, refuses a removal line. A relative folder after a
plain `cd` is checked from the starting folder and from where the `cd` leads,
because a `cd` in `( )`, or into a folder that is not there, leaves the shell
where it was. A message that
only quotes the words (`git commit -m "…worktree remove…"`, or a `-F -` heredoc)
is not a removal and passes.

Options written before git's command word (`git -C <folder> push --force`)
are taken out before any rule reads the line, so the word order cannot step
round a check.

## Merging a pull request

A pull request merges only in one shape, and only once it clears a bar, in
every mode, whoever is present. The approved-commands list below does not lift
it, since Claude can write that file itself.

**The shape.** The command is alone on its line and reads

```
gh pr merge <number> --merge --match-head-commit <full 40-character commit id>
```

with `--squash` or `--rebase` in place of `--merge` if wanted, and optionally
`--delete-branch` and `-R owner/repo`. `--match-head-commit` makes GitHub
itself refuse the merge if that commit is no longer the newest, so a push,
a branch switch or another project cannot slip in between the check and the
merge. A merge without it, or with a short or wrong id, is refused with the
exact command to run instead.

**Which lines count.** The check is blunt on purpose, because reading the
shell's spellings exactly kept losing to one more spelling. A line counts
when both of these hold:

- its letters and digits, with everything else taken out, contain `merge` or
  `enqueuepullrequest` (GitHub's merge queue); and
- it names `gh` as a word (also `gh.exe`, or a path ending in either), or its
  letters contain `pulls` or `graphql`, the REST and GraphQL addresses. A
  word also ends at `=`, `:` and `!`, and a short flag glued on the front is
  dropped, so `--split-string=gh`, `-FilePath:gh`, `alias.m=!gh` and `-Sgh`
  all name gh.

Before looking, a backslash at a line end is joined up, quotes, backticks and
`$` are taken out, and brace lists and ranges are expanded the way bash does
(`{merge,}`, `{pr,merge}`, `{m..m}erge`, `{e..e..1}`). A group bash leaves
as written (`{x}`, `{...base}`) stays text, and the group around it still
expands: `g{h,{x}}` is `gh` and `g{x}`. When the braces would make more than
64 copies, the line counts when one shell word holds the letters of `merge`
(or `enqueuepullrequest`) in order and one holds `g` then `h` (or `pulls`,
or `graphql`). Between two of those letters there may be punctuation, or
other letters only across a brace or comma, which a choice can cut through:
the shell expands braces inside a word, so they can pad a word but not join
two, and `grantCheck` never becomes `gh`. A word with no brace must spell
the word outright. Words split where bash splits them, never at a quoted or
escaped separator (`g{";",}h` is one word, and `gh` in one copy), and braces
inside quotes are text. A heredoc's body (the lines after `<<EOF` up to
`EOF`) is not command text: it is never brace-expanded with the line, but
read word by word on its own the same way, so a file of JSON or code written
with `cat <<EOF` passes and a body fed to `bash` is still caught.
Quoted text and comments count too. So a merge inside a chain, a pipe,
`bash -c`, a wrapper such as `timeout`, `env` or `xargs`, `curl` or
`Invoke-RestMethod`, after a `cd`, or behind a comment or heredoc is refused
rather than read.

One exception, on a line the reader can vouch for whole (the same
`plainLine` as the payment rule): text written to a file (`cat > notes.md
<<'EOF'`, `echo … >> NOTES.md`) and the pattern of a search (`grep -rn "gh pr
merge" docs/`) are left out before looking, because nothing on such a line
runs them. Any other line is read whole, as before. A file written in one
step and run in a later, separate step is not seen by this check, the same
as a file written with the Write tool; on one line (`printf … > x.sh && bash
x.sh`) the `bash` makes the line one the reader cannot vouch for, so it is
read whole and refused.

Two kinds of line are let off, each alone on its line with no word holding a
quote, brace, `$` or separator:
- a plain read of pull requests: `gh pr view`, `checks`, `list`, `status` or
  `diff`, optionally with `-R owner/repo`. So `gh pr view 36 --json
  mergeable` passes;
- a plain `git merge`, whatever the branch is called. So `git merge
  feature/graphql-schema` passes.

The cost is that some harmless lines are refused. The refusal names the usual
ways round it (a file for the text, a line of its own for the rest):
- a commit message or note that mentions merging along with gh, pulls or
  graphql (`git commit -m "merge graphql fix"`); pass it as a file: `git
  commit -F msg.txt`;
- a flag word that ends in gh (`-high`, `-through`) in a line that says
  merge;
- a `gh` command and a `git merge` in one line (`gh pr checks 35 && git merge
  main`) — run them on separate lines;
- a `gh pr create` whose title says merge (`--title "Fix merge conflict"`);
- a read of a pull request with quotes in it (`--jq '.mergeable'`). Drop the
  quotes: `--jq .mergeable`.

**The bar**, read with `gh pr view` at the moment of the merge:

- every check on the pull request's newest commit has passed. A check still
  running, a failed check, or no check reported yet is refused. A project with
  no automatic checks at all never clears this, so its user merges by hand;
- when the change touches one of the plugin's own safety checks (the list is
  `REVIEW_PATHS` in `skills/orchestrate/scripts/lib/merge-bar.mjs`, and
  includes `hooks/hooks.json`), a reviewer in this session handed back PASS
  for that same commit, named as `REVIEW OF: <first 7 or more characters of
  the commit>`. The newest verdict on that commit decides, and a push after
  the review needs a new one. A file list too long to read in full counts as
  touching them;
- switching on automatic merging (`--auto`) is always refused: it later
  merges whatever the newest commit is, including one nobody checked;
- merging through the raw API is refused, so the merge goes through the one
  command this check reads;
- when the checks cannot be read (gh missing, signed out, offline, or slower
  than 12 seconds), or checking fails for any other reason, the merge is
  refused, never waved through.

Out of scope, and not caught: a word built from a variable, `$(…)`, escape
codes or a file-name pattern (`mer?e`, whose result depends on the files in
the folder); a command name built from pieces (PowerShell's `& ('g'+'h')`
or `"g$()h"`, cmd's `g^h`); a PowerShell splat (`@args`), which is a
variable too; a merge run from a script file or `node -e`; a gh alias; a
GraphQL query read from a file; and merging branches without a pull request
at all — a push straight to the base branch (`git push origin HEAD:main`),
the `mergeBranch` mutation or the REST route `…/merges`. Settings made before
the line are not read either: a git config, `.gitattributes` or environment
variable already in place can make a plain read run a program (an external
diff, a textconv, `core.fsmonitor`, an editor for `git add -e`,
`RIPGREP_CONFIG_PATH`, a `curl -K` file written earlier, or a link made
earlier that points an ordinary-looking file at `.git/config`). The check
reads only the line in front of it.

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
- **A yes given in chat does not reach a session that shows no prompts:** a
  hook cannot see the conversation, so in a session like that an owner's yes
  typed in chat changes nothing for the guard. The owner runs the command
  themselves, or adds that exact line to `.orchestrator/allow-bash.json`
  (see below). Claude may write a line there only when the owner has
  approved that exact line; Claude never lifts a refusal on its own.
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
independent review when its packet says `REVIEW: yes`. Whether a review is
owed is the lead's judgment, written into the packet; a word in the objective
no longer decides it (live notes Q and V, 2026-09-30: a docs lookup about
permission rules and two markdown files were flagged).
