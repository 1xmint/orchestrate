# Handoff

`orchestrate` v0.5.1 is built, tested, installed and tagged. The v0.4 plan is
complete, the fresh-context Fable audit it deferred has run and every finding
is resolved, and the Fable cap that survived both has been removed: choosing a
model is the manager's judgment now, and the user is asked whenever the model
it wants is not included in their plan. Repo:
`C:\Users\Josh\Desktop\GitHub\orchestrate` (public, github.com/1xmint/orchestrate,
branch main). There is no unfinished build step. `STATE.md` is the record of
what shipped and what is deliberately not in it.

## If you are picking this up cold

Read `STATE.md` first: it names every step, its commit, and the four things
left for Josh. The plan it was built from is
`C:\Users\Josh\.claude\plans\i-want-you-to-eager-boole.md`; its facts were
checked against the live docs on 2026-09-08 and do not need re-deriving.

Then run the tests, which need no quota and no network:

```
node --test "skills/orchestrate/scripts/**/*.test.mjs"
```

136 pass. Anything red is a regression, not a starting point.

## What is installed on this machine

- `~/.claude/skills/orchestrate` and `~/.agents/skills/orchestrate`, v0.5.1,
  with `{{SKILL_DIR}}` and the interpreter path already substituted.
- Six `orch-*` agents in `~/.claude/agents`, each with its own return-check
  Stop hook.
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

## Nothing is open

There is no unfinished step and no chore waiting for Josh. Two things happen on
their own the next time he works: the router card either appears at the top of a
session or it does not, and `measure.mjs --latest` will report what a real run
cost whenever he is curious. Neither is a task.

The signal that matters now is his own use. If the skill spends without asking,
downgrades without saying, or explains something badly, that is the bug report,
and it is worth more than any test in here.

## Non-negotiables, if you change anything

Zero npm dependencies, Node 18 or newer, Windows, macOS and Linux paths. Never
print secrets. Never run `claude auth login` or touch credentials. The router
stays global in `settings.json`, never in skill frontmatter, because it must
fire before the skill is ever invoked. `updatedInput` only works alongside
`permissionDecision: "allow"`. Every hook exits 0 and prints nothing on any
error. Do not install the project kit into Josh's live repos without asking.
