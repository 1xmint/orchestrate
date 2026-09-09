# Hosts: the mechanics under the skill

The instructions are the same everywhere. The way work is dispatched differs
by host. v0.1 is built and tested on Claude Code; Codex loads the same folder
but its dispatch path is documented, not tested.

## Claude Code (desktop app or CLI)

**Dispatch** is the `Agent` tool.

- `subagent_type`: one of the six role agents (`orch-planner`,
  `orch-implementer`, `orch-researcher`, `orch-browser`, `orch-reviewer`,
  `orch-debugger`) once installed, or a built-in (`Explore` for read-only
  sweeps, `general-purpose` when a resumable general agent is wanted).
- `model`: `sonnet | opus | haiku | fable`. Overrides the agent file's default.
  Effort cannot be set per call; it comes from the agent file.
- `isolation: worktree`: the agent works in its own git worktree; its shell
  commands run there; the worktree is removed if it made no changes.
- `run_in_background`: default; keep it unless the very next step needs the
  result and nothing else can proceed.
- `description`: three to five words; it is what the user sees in the task list.

**Resume** a named agent with `SendMessage` (`to: <agent name or id>`). The
built-in `Explore` and `Plan` agents are one-shot and cannot be resumed.

**Background subagents** keep every MCP tool but only a reduced built-in set,
and cannot spawn `Agent` themselves. Nested orchestration does not happen in
the background; the orchestrator is the only layer that dispatches.

**Worktrees** need a git repo. For work outside a repo, dispatch without
isolation and give explicit allowed paths.

**One browser pane** per session. Two browser agents at once will fight over
it. Serialise browser tasks.

**Usage**: `/usage` shows plan usage bars and attribution to subagents; `/status`
shows the account; `/model` and `/effort` change the main conversation's model
and effort. `CLAUDE_CODE_SUBAGENT_MODEL` sets a default subagent model when
none is given; the per-call `model` wins over it unless
`CLAUDE_CODE_SUBAGENT_MODEL_FORCE=true` is set.

**Agent files** live in `~/.claude/agents/<name>.md` (all projects) or
`.claude/agents/` (one repo, which wins). Frontmatter fields used here:
`name`, `description`, `model`, `effort`, `tools`, `disallowedTools`,
`maxTurns`, `isolation`, `color`. `scripts/install-agents.mjs` installs the
six from `assets/agents/`.

**Skill files** load from `~/.claude/skills/<name>/SKILL.md` (personal) or
`.claude/skills/` in a repo. The skill body stays in context for the rest of
the session, so it is written to be short; the references load on demand.

**Permissions** are inherited by subagents from the session. A subagent cannot
grant itself anything the session lacks.

## Codex CLI and the ChatGPT desktop app

Skills load from `~/.agents/skills/<name>/` (user) and `.agents/skills/` in a
repo, and are invoked as `$orchestrate` in the CLI or `@orchestrate` in the
app, or automatically when the description matches. Only the spec frontmatter
fields are read (`name`, `description`, `license`, `compatibility`,
`metadata`, `allowed-tools`), which is why this skill uses no others.

Dispatch there uses Codex's own subagent feature (`multi_agent`, present in
Codex 0.151) or `codex exec` runs launched from a shell. The packet, the
return schema, the ledger and the evaluation rules apply unchanged. The role
agent files are Claude Code-specific; on Codex, paste the role notes from
`contracts.md` into the packet instead. This path has not been exercised.

## claude.ai and Cowork

No subagents. The skill degrades to: profile (if scripts can run), understand,
ground, plan, then do the tasks in order in the same conversation with the
same evidence discipline. Say so to the user at the start so the expectation
of parallel agents is not set.
