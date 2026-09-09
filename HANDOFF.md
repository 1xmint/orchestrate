# Handoff

`orchestrate` v0.4.0 is built, tested, installed and tagged. Repo:
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

98 pass. Anything red is a regression, not a starting point.

## What is installed on this machine

- `~/.claude/skills/orchestrate` and `~/.agents/skills/orchestrate`, v0.4.0,
  with `{{SKILL_DIR}}` already substituted.
- Six `orch-*` agents in `~/.claude/agents`, each with its own return-check
  Stop hook.
- `~/.claude/settings.json`: `router.mjs` on UserPromptSubmit and SessionStart,
  `guard-agent.mjs` on PreToolUse(Agent), `ledger.mjs` on SubagentStop. The
  pre-existing `memory-write-gate.mjs` entry is untouched; a backup of the
  previous file is in `~/.claude/orchestrate/`.

To undo it all: restore that backup over `~/.claude/settings.json`, delete
`~/.claude/skills/orchestrate`, `~/.agents/skills/orchestrate` and the six
`~/.claude/agents/orch-*.md`.

## The four open items

They are open because they need a fresh session, a real goal, or a tool this
session does not have. None of them blocks anything.

1. The five loading checks in the README, in one fresh desktop session.
2. A real orchestration, then `measure.mjs --latest`, which turns the
   efficiency estimates into measurements for free.
3. Whether `subagent_type: fork` exists here (one one-line haiku dispatch).
4. Whether the Workflow tool has appeared after a desktop update.

## Non-negotiables, if you change anything

Zero npm dependencies, Node 18 or newer, Windows, macOS and Linux paths. Never
print secrets. Never run `claude auth login` or touch credentials. The router
stays global in `settings.json`, never in skill frontmatter, because it must
fire before the skill is ever invoked. `updatedInput` only works alongside
`permissionDecision: "allow"`. Every hook exits 0 and prints nothing on any
error. Do not install the project kit into Josh's live repos without asking.
