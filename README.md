# orchestrate

A skill that turns one Claude Code conversation into an autonomous technical
project manager. You say what you want done. It works out the plan, picks the
agent and model for each part according to your Claude plan (Pro, Max 5x, Max
20x), writes each agent's brief, judges what comes back, retries or escalates
when something is off, verifies independently, and reports in plain words.

The skill lives in `skills/orchestrate/`. Everything else in this repo is for
building and testing it.

## Install (Claude Code, desktop app or CLI)

```bash
git clone <this repo> orchestrate
cd orchestrate
node scripts/install.mjs
```

That copies the skill to `~/.claude/skills/orchestrate/` (and to
`~/.agents/skills/orchestrate/` for Codex, skip with `--no-codex`) and
installs six role agents into `~/.claude/agents/`. Both are picked up by a
running session within a minute or so; a new session sees them at once.
Type `/orchestrate <your goal>`, or just describe a multi-part goal; the
skill triggers on its own.

The money rules are automatic. When the skill is invoked it registers a small
hook on the Agent tool for the rest of the session (declared in SKILL.md's
frontmatter, nothing to configure). The hook blocks a Fable dispatch on Pro,
API, Team or unknown plans unless you opt in for the day, caps Fable at 3
dispatches a day on Max 5x (6 on Max 20x), and blocks any agent brief that
contains something shaped like a credential. `node scripts/install.mjs
--with-hook` registers the same hook globally instead, for sessions that
never invoke the skill; you do not need both.

Two consequences of the frontmatter hook: the `.skill` file will not upload
to claude.ai (that field is Claude Code-only, and claude.ai has no subagents
anyway), and Codex ignores it.

First run: the skill reads your plan tier from your local Claude config. If it
cannot, it asks once and remembers:

```bash
node ~/.claude/skills/orchestrate/scripts/profile.mjs --set tier=max5   # pro | max5 | max20 | team | api
```

## What it needs

- Claude Code (desktop app or CLI) on a Pro, Max, Team or API account.
- Node 18 or newer for the four helper scripts (they spend no model quota).
- A git repo when you want agents to work in isolated worktrees; outside a
  repo the skill still runs, without isolation.

Optional: Codex, opencode, gemini or aider on your PATH and signed in. The
skill uses them only as extra hands for cross-vendor review or as a separate
quota pool, and only after a smoke test.

## Codex and the ChatGPT desktop app

The same folder loads from `~/.agents/skills/orchestrate/` and is invoked as
`$orchestrate` or `@orchestrate`. The instructions apply; the dispatch path
there uses Codex's own subagents and has not been exercised in this version.
See `skills/orchestrate/references/hosts.md`.

## Layout

```
skills/orchestrate/
  SKILL.md              the skill (short; stays in context)
  references/           routing by plan, packet contracts, evaluation, hosts, provenance, audit prompt
  scripts/              profile.mjs, install-agents.mjs, run-init.mjs, smoke.mjs
  assets/               RUN.md ledger template, six role agents
evals/                  test prompts for the skill-creator loop
scripts/install.mjs     installs the skill and agents
STATE.md                build progress and resume point
```

## Provenance

The ideas are borrowed and credited in
`skills/orchestrate/references/borrowed.md`.
