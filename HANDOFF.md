# Handoff

`orchestrate` v0.7.2 is built, tested, packaged and tagged. v0.6.0 gave the
conversation a team; v0.7.0 puts a senior engineer in front of it. The setup
question now actually gets asked, a question gets a depth call before it gets an
answer, every claim has to name what it rests on with two independent checks
that say so when it does not, and every dispatch arrives with a price on it.
Repo: `C:\Users\Josh\Desktop\GitHub\orchestrate` (public,
github.com/1xmint/orchestrate, branch main). There is no unfinished build step.

## If you are picking this up cold

Read `STATE.md` first. Its v0.7.0 section names what changed, what was measured
rather than assumed, what stays reasoned, and two defects found while building
that were deliberately left for their own task. The plan it was built from is
`C:\Users\Josh\.claude\plans\you-are-the-senior-kind-mango.md`; its facts were
checked against the live docs on 2026-09-09 and do not need re-deriving.

Then run the tests, which need no quota and no network:

```
node --test "skills/orchestrate/scripts/**/*.test.mjs"
```

187 pass. Anything red is a regression, not a starting point.

Two offline commands are worth knowing, because both answer questions people
otherwise guess at:

```
node skills/orchestrate/scripts/turn-check.mjs --replay-week
node skills/orchestrate/scripts/measure.mjs --latest --dollars
```

The first says how often the research floor would fire on the last week of real
transcripts; it must stay under one a day, and it is at 0.14. The second prices
a finished session at list price and counts how often either check sent a turn
back.

## What is installed on this machine

- `~/.claude/skills/orchestrate` and `~/.agents/skills/orchestrate`, with
  `{{SKILL_DIR}}` and the interpreter path substituted. **These still hold
  v0.6.0**: v0.7.0 has not been installed, only built and packaged. Run
  `node scripts/install.mjs --with-router --with-hook` to update them.
- Six `orch-*` agents in `~/.claude/agents`, each with its own return-check hook.
- `~/.claude/settings.json`: `router.mjs` on UserPromptSubmit and SessionStart,
  `guard-agent.mjs` on PreToolUse(Agent), `ledger.mjs` on SubagentStop, each
  naming the interpreter by absolute path. The pre-existing
  `memory-write-gate.mjs` entry is untouched; backups of every previous version
  are in `~/.claude/orchestrate/`.
- `~/.claude/orchestrate/active-run.json`, which points the hooks at the open
  run. Without it a session started above the repo sees no run at all.

To undo it all: restore that backup over `~/.claude/settings.json`, delete
`~/.claude/skills/orchestrate`, `~/.agents/skills/orchestrate` and the six
`~/.claude/agents/orch-*.md`.

## What is open

Two things, both small, both filed rather than done because they are outside
what v0.7.0 was asked to change:

1. **`latestRun` picks the alphabetically last run folder, not the newest.** Two
   runs created on the same day are ordered by slug. Every hook pointed at the
   wrong run for the whole of this build. The fix is to sort by RUN.md mtime.
2. **Worktree isolation refuses in this checkout.** `git` resolves the repo path
   with different casing, so the Agent tool rejects the worktree it made. Any
   dispatch with `isolation: "worktree"` fails here until that is sorted.

And one thing waiting on use rather than on work: the reply check ships on in
orchestrate sessions and off everywhere else, because nobody has measured how
often a Sonnet reader asks for a basis that was already in the reply. After a
week under one block a day, `install.mjs --with-reply-check` becomes the default.

The signal that matters is still Josh's own use. If the skill spends without
asking, downgrades without saying, blocks a turn that was fine, or explains
something badly, that is the bug report, and it is worth more than any test here.

## Non-negotiables, if you change anything

Zero npm dependencies, Node 18 or newer, Windows, macOS and Linux paths. Never
print secrets. Never run `claude auth login` or touch credentials. The router
stays global in `settings.json`, never in skill frontmatter, because it must
fire before the skill is ever invoked. `updatedInput` only works alongside
`permissionDecision: "allow"`, and the guard must never emit `allow` at all:
doing so would auto-approve every dispatch and take away the user's own
permission prompt. Every hook exits 0 and prints nothing on any error. Every
Stop hook blocks once per thing and honours `stop_hook_active`, because the host
overrides a Stop hook after eight consecutive blocks. Do not install the project
kit into Josh's live repos without asking.
