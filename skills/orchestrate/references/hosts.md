# Hosts: the mechanics under the skill

Checked 2026-09-08 against code.claude.com/docs; the desktop app bundled Claude Code 2.1.260,
the CLI on PATH was 2.1.209. Re-checked 2026-09-10 against code.claude.com/docs/en/sub-agents
for the agent-file frontmatter fields below. Re-checked 2026-09-24 against Claude Code 2.1.274
(scoresheet audit r1); nothing below changed. Built and tested on Claude Code; Codex loads the
same folder but its dispatch path is documented, not exercised.

This is the short form a lead reads. `claude-code.md` holds the rest of the Claude Code
mechanics — hook event details, transcript formats, caching, and everything read only while
debugging the plugin.

## Claude Code (desktop app or CLI)

### Host facts checked 2026-09-14

- **Nesting.** Nesting is on by default: the host allows three subagent layers
  (`CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`) and 20 concurrent subagents
  (`CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS`), and a subagent's own subagents
  inherit its tools minus `Agent` at the last layer
  (code.claude.com/docs/en/sub-agents, read 2026-09-18). Set
  `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH=2` as a host backstop. Whether it
  counts the lead's own level is unverified, so the coordinator guard remains
  the real rail. This skill's own caps — coordinator-only nesting at depth
  one, two children, concurrency two (three with a live coordinator) — are a
  cost choice made here, not a host limit; the host allows much more.

**Dispatch** is the `Agent` tool: `subagent_type` (a role agent, or `Explore` /
`general-purpose`), `model` (`sonnet | opus | haiku | fable`; overrides the agent file), `prompt`
(the packet), `isolation: "worktree"`, `run_in_background` (default true), `description` (3–5
words the user sees). There is **no per-call effort**; each role file pins its own, at or below `high`
(`models.md`), and built-in agents take the session's.

**Background is the default** in an interactive session and the caller cannot ask for the
foreground. A background subagent keeps every MCP tool and these built-in tools: Read, Grep,
Glob, Bash, PowerShell, Edit, Write, NotebookEdit, WebFetch, WebSearch, TodoWrite, Skill,
ToolSearch, EnterWorktree, ExitWorktree, Monitor, TaskStop, SendMessage, Artifact. Every
subagent, foreground or background, loses AskUserQuestion, EnterPlanMode, ExitPlanMode,
ScheduleWakeup, TaskOutput, Workflow. So an agent can never ask the user: the packet's STOP AND
REPORT conditions are how it hands a decision back. Permission prompts a background agent
raises surface in the main session.

**A role's tool scope is a guarantee, not a description.** `orch-planner`,
`orch-researcher`, `orch-reviewer` and `orch-advisor` cannot edit code;
`orch-reviewer` cannot write at all; `orch-implementer`, `orch-debugger` and
`orch-browser` cannot message another agent or publish anything, and the
browser cannot reach the network or a shell outside its own pane. Enforced by
the host's tool restrictions on each agent file, not by an instruction the
agent could ignore — a reviewer's PASS is bankable partly because it was never
able to fix what it found. `orch-coordinator` is the one role with `Agent`; it
may write only under the run directory and may dispatch only the bounded
child roles the guard allows.

**Nesting** is allowed only through `orch-coordinator`. The guard finds the
parent from its dispatch record, allows only `orch-implementer`,
`orch-researcher`, `orch-reviewer` or `Explore` with a named model, refuses a
second coordinator, and caps depth at two. Every nested dispatch records its
parent and counts against the same budget and worker slots. The policy is
`policy.workers.nested=coordinator|deny|allow`, with `coordinator` as the
default. A live coordinator raises the default concurrent slot count to three,
so it can hold one slot while two workers run. Built-in `general-purpose` has no
turn cap; the guard refuses it while the bounded roles are installed.

**`CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH=2`** is the recommended host backstop
for coordinator nesting. Its counting of the lead's own level is unverified, so
the plugin guard still enforces the actual depth-two rule and records the
parent. `policy.workers.nested` chooses `coordinator`, `deny` or `allow`.

**Worktrees** need a git repo; the worktree is removed when the agent made no changes, so packets
name an absolute run dir in the main checkout.

## Codex CLI and the ChatGPT desktop app

Skills load from `~/.agents/skills/<name>/` (user) and `.agents/skills/` in a repo, invoked as
`$orchestrate` or `@orchestrate`, or automatically when the description matches. Only the spec
frontmatter is read (`name`, `description`, `license`, `compatibility`, `metadata`,
`allowed-tools`); `package.mjs --spec` writes a zip with only those fields and without the
injection line. Dispatch there uses Codex's own subagents or `codex exec`; the packet, return
schema, ledger and evaluation rules apply unchanged; paste the role note from the matching `assets/agents/orch-*.md`
into the packet. Not exercised.

## claude.ai and Cowork

No subagents. The skill degrades to: profile if scripts can run, understand, ground, plan, then
do the tasks in order in the same conversation with the same evidence discipline. Say so at the
start.
