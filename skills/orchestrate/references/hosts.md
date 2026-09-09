# Hosts: the mechanics under the skill

Checked 2026-09-08 against code.claude.com/docs; the desktop app bundled Claude Code 2.1.260,
the CLI on PATH was 2.1.209. Built and tested on Claude Code; Codex loads the same folder but
its dispatch path is documented, not exercised.

## Claude Code (desktop app or CLI)

**Dispatch** is the `Agent` tool: `subagent_type` (a role agent, or `Explore` /
`general-purpose`), `model` (`sonnet | opus | haiku | fable`; overrides the agent file), `prompt`
(the packet), `isolation: "worktree"`, `run_in_background` (default true), `description` (3–5
words the user sees). There is **no per-call effort**; effort comes from the agent file.

**Background is the default** in an interactive session and the caller cannot ask for the
foreground. A background subagent keeps every MCP tool and these built-in tools: Read, Grep,
Glob, Bash, PowerShell, Edit, Write, NotebookEdit, WebFetch, WebSearch, TodoWrite, Skill,
ToolSearch, EnterWorktree, ExitWorktree, Monitor, TaskStop, SendMessage, Artifact. Every
subagent, foreground or background, loses AskUserQuestion, EnterPlanMode, ExitPlanMode,
ScheduleWakeup, TaskOutput, Workflow. So an agent can never ask the user: the packet's STOP AND
REPORT conditions are how it hands a decision back. Permission prompts a background agent
raises surface in the main session.

**Returns.** A background agent's call returns at once ("agent launched"); its result arrives
later as a task notification in a user turn, not as the tool result. Hooks that need the return
text hang off `SubagentStop` (`last_assistant_message`, `agent_transcript_path`, `agent_type`,
`agent_id`), not `PostToolUse`. Only the final text comes back; long output belongs in files.

**Nesting** is allowed to three layers below the main conversation
(`CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`); `Agent` is removed only at the depth limit. This skill's
rule that only the orchestrator dispatches is *policy*, kept because nested dispatch hides cost
and returns from the ledger. Up to 20 concurrent subagents by default.

**Resume** a named agent with `SendMessage`; `Explore` and `Plan` are one-shot. Named subagents
also see a roster of each other and can message each other. Caution: with agent teams enabled
(`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`), a named subagent launches as a teammate; this skill
leaves the variable unset.

**What a subagent loads**: its own system prompt (not the main one), the packet, every
CLAUDE.md level the main session loads (**not `AGENTS.md`**; a repo wanting both puts
`@AGENTS.md` in CLAUDE.md), a git status snapshot, the full text of skills in its `skills:`
field, and the sibling roster. Not loaded: the conversation, files already read, the main
session's auto memory. `Explore` and `Plan` skip CLAUDE.md and git status, which is why they
start small. A `fork` inherits the whole conversation instead.

**Agent files** live in `~/.claude/agents/<name>.md` (all projects) or `.claude/agents/` (one
repo, wins). Fields used here: `name`, `description`, `model`, `effort`, `tools`,
`disallowedTools`, `maxTurns`, `isolation`, `color`, `memory` (`user` → `~/.claude/agent-memory/
<name>/`, `project`, `local`), `hooks` (`Stop` in an agent file becomes `SubagentStop` for that
agent). `install-agents.mjs` installs the six and substitutes the skill's absolute path into
their hook commands. New agent files appear in a running session after a minute or two; a new
session sees them at once.

**Skill files** load from `~/.claude/skills/<name>/SKILL.md` or `.claude/skills/`. Descriptions
of all skills sit in context every turn (the listing gets ~1% of the context window; a
description plus `when_to_use` is cut at 1,536 characters); the body loads on invocation and
stays in history. Frontmatter `hooks` register when the skill is invoked and last the session
(`once: true` runs a hook one time). `` !`command` `` in the body runs at invocation and injects
the output; a failing command aborts the invocation. `${CLAUDE_SKILL_DIR}` is substituted in
the body. `/skill-doctor` reports unused skills and their per-turn cost.

**Hooks this skill uses**: `UserPromptSubmit` and `SessionStart` (router, global),
`PreToolUse` on `Agent` (guard: deny, or `permissionDecision: allow` + `updatedInput` to
downgrade the model), `SubagentStop` (ledger; and the return check from each agent file),
`Stop` (turn check). Hook `additionalContext` and skill invocations append as messages, so the
prompt cache is not broken. Command hooks cannot run tools or slash commands; a `type: prompt`
hook (Haiku) returns only `ok`/`reason`.

**A hook registered in two places runs twice.** `settings.json` and a skill's frontmatter are
separate registrations, and both fire on the same event; the platform does not deduplicate them.
Any hook with a side effect therefore has to be idempotent itself. `guard-agent.mjs` and
`ledger.mjs` each key on a signature of the payload within a few seconds and act once, which is
why the same install can register them globally and from the skill without double-counting a
Fable dispatch or writing a return file twice.

**Auto mode** (the default on Pro/Max/Team): a classifier reviews each subagent's task at spawn,
its actions, and its return; `permissionMode` in agent files is ignored; PreToolUse denies still
apply; a hook that returns `allow` approves the call.

**Cache**: model switch, fast mode, MCP connect/disconnect (non-deferred tools), plugin MCP,
denying a whole tool, output style, compaction, upgrade rebuild the prefix. Changing effort on
Fable 5.1 on a subscription keeps the cache (2.1.260+). Subagents get a 5-minute TTL by default
even on a subscription; `subagentPromptCacheTtl: "1h"` (2.1.242+) extends it and the API bills
1-hour writes higher.

**Usage**: `/usage` shows plan bars plus attribution to skills, subagents and MCP servers;
`/context` shows what is loaded; `/skill-doctor` the skills' cost. A per-family limit ("hit your
Opus limit") leaves other families working; a session or weekly limit stops everything until the
reset. Task tools (TaskCreate/List) are off by default on Sonnet 5 and Fable, so the on-disk
`RUN.md` is the ledger.

**Not exposed here**: the Workflow tool (checked 2026-09-08 in the desktop session); see
`lanes.md`. `subagent_type: fork` is documented but unverified in this session.

**One browser pane** per session; browser tasks run one at a time.

**Worktrees** need a git repo; the worktree is removed when the agent made no changes, so packets
name an absolute run dir in the main checkout.

## Codex CLI and the ChatGPT desktop app

Skills load from `~/.agents/skills/<name>/` (user) and `.agents/skills/` in a repo, invoked as
`$orchestrate` or `@orchestrate`, or automatically when the description matches. Only the spec
frontmatter is read (`name`, `description`, `license`, `compatibility`, `metadata`,
`allowed-tools`); `package.mjs --spec` writes a zip with only those fields and without the
injection line. Dispatch there uses Codex's own subagents or `codex exec`; the packet, return
schema, ledger and evaluation rules apply unchanged; paste the role notes from `contracts.md`
into the packet. Not exercised.

## claude.ai and Cowork

No subagents. The skill degrades to: profile if scripts can run, understand, ground, plan, then
do the tasks in order in the same conversation with the same evidence discipline. Say so at the
start.
