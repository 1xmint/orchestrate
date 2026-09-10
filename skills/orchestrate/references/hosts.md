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

Observed 2026-09-09 on a real background dispatch, not read from the docs: the payload carried
`last_assistant_message`, `agent_type` and `agent_transcript_path`, and `cwd` was the repo rather
than the session's own working directory. Two other stops in the same session arrived with a
`last_assistant_message` and **no** agent field at all, so `ledger.mjs` requires an agent identity
before it treats a stop as a return; without that check the lead's own messages were being
filed under `returns/`.

**Nesting** is allowed to three layers below the main conversation
(`CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`); `Agent` is removed only at the depth limit. This skill's
rule that only the lead dispatches is enforced in the role files themselves
(`disallowedTools: Agent`, or a tool allowlist without it), because a nested dispatch hides both
its cost and its return from the ledger. Up to 20 concurrent subagents by default.

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
repo, wins). Fields used here: `name`, `description`, `model`, `tools`,
`disallowedTools`, `maxTurns`, `isolation`, `color`, `memory` (`user` → `~/.claude/agent-memory/
<name>/`, `project`, `local`), `hooks` (`Stop` in an agent file becomes `SubagentStop` for that
agent). `install-agents.mjs` installs the six and substitutes the skill's absolute path into
their paths. New agent files appear in a running session after a minute or two; a new
session sees them at once.

**Skill files** load from `~/.claude/skills/<name>/SKILL.md` or `.claude/skills/`. Descriptions
of all skills sit in context every turn (the listing gets ~1% of the context window; a
description plus `when_to_use` is cut at 1,536 characters); the body loads on invocation and
stays in history. Frontmatter `hooks` register when the skill is invoked and last the session
(`once: true` runs a hook one time). `` !`command` `` in the body runs at invocation and injects
the output; a failing command aborts the invocation. `${CLAUDE_SKILL_DIR}` is substituted in
the body. `/skill-doctor` reports unused skills and their per-turn cost.

**Hooks this skill uses**: `UserPromptSubmit` and `SessionStart` (router, global),
`PreToolUse` on `Agent` (guard: deny only; it never rewrites a dispatch), `SubagentStop`
(ledger), `Stop` (the Pickup check). The role agents carry no hooks of their own: the one they
had rejected a finished return over its shape, which spends a model turn to buy formatting.
Hook `additionalContext` and skill invocations append as messages, so the prompt cache is not
broken. Command hooks cannot run tools or slash commands; a `type: prompt`
hook (Haiku) returns only `ok`/`reason`.

**A hook registered in two places runs twice.** `settings.json` and a skill's frontmatter are
separate registrations, and both fire on the same event; the platform does not deduplicate them.
Any hook with a *side effect* therefore has to be idempotent itself. `guard-agent.mjs` keys on
`session_id` + `tool_use_id` (a payload digest where the host sends no id) and `ledger.mjs` on a
digest of the return, so the same install can register both globally and from the skill without
counting one dispatch twice or writing a return file twice.

**A decision is not a side effect, and must not be deduplicated.** The guard used to skip the
whole invocation on a repeat, which meant a packet denied for carrying a credential passed on an
immediate identical retry. Decide first, then suppress only what would otherwise happen twice.

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

**Documented, unverified in this build; one probe each is the check**: the Workflow tool
(checked 2026-09-08 in the desktop session), `subagent_type: fork`, and `SendMessage` — the
last is named in the Agent tool's own description and in every launch result, but three
ToolSearch queries and `ListAgents` found no way to reach a running subagent with it on
2026-09-09. Until one of those probes runs, a packet delta to a live agent is not a move here.
See `lanes.md`.

**Hooks, as of 2026-09-09.** A `prompt` hook hands its text to a model (a fast one by default;
`model` picks another) with `$ARGUMENTS` replaced by the hook input JSON, and reads back
`{"ok": true}` or `{"ok": false, "reason": "…"}`. On `Stop` the reason is fed back so Claude
keeps working, unless the answer also sets `"impossible": true`. All hook events are supported
in skill and subagent frontmatter, and all five types — including `prompt` — may be registered
there (code.claude.com/docs/en/hooks, "Hooks in skills and agents", read 2026-09-09). A skill's
hooks register on invocation and keep running for the rest of the session; a subagent's are
removed when it finishes, and its `Stop` becomes `SubagentStop`. Claude Code overrides a Stop
hook after eight consecutive blocks with no progress, so every Stop hook here blocks once per
thing and honours `stop_hook_active`. Agent-type hooks are labelled experimental. This skill
registers no prompt or agent hook at all: it had one, a second model reading every reply, and
it was deleted in v0.8.0 after firing zero times in about 1,800 turns.

**How hook output reaches the transcript.** Injected context is its own record:
`{"type": "attachment", "attachment": {"hookEvent": "<Event>", "hookName": "<Event>",
"content": ["…"], "toolUseID": "hook-…"}}`. It is *not* a user-role message, which
`measure.mjs` assumed until 2026-09-09; reading only user records reported zero router
injections on a transcript that held four. A message typed mid-turn is
`{"type": "attachment", "attachment": {"type": "queued_command", "prompt": "…"}}`. The
transcript shape of a *blocked* Stop was not observed, so both counters match on a fixed
prefix rather than on a record shape.

**Plugins cannot set** `model`, `effortLevel`, `outputStyle` or permissions; a plugin's own
`settings.json` takes only `agent` and `subagentStatusLine`, and there is no plugin level in the
settings precedence order. `max` is not accepted in `effortLevel` or `modelSettings`. What a
plugin *can* do to the voice is `force-for-plugin: true` in an output style, which applies the
style whenever the plugin is enabled and overrides the user's own `outputStyle`; disabling the
plugin is the way off.

**In plan mode a subagent inherits the write restriction.** Observed 2026-09-09: a researcher
dispatched from plan mode could write only to a sibling of the plan file; a Stop hook then
blocked it repeatedly for returning the wrong shape, and the ledger filed four returns and
counted four attempts for one piece of work. That hook is gone — it is the clearest case there
was of a check that spends real money to enforce formatting — but the write restriction is
not. From plan mode, dispatch only read-only tasks whose packet says "return the findings
inline, write nothing", or name the plan file's own sibling as the output path.

**`CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`** is the host's mechanical form of "only the
the lead dispatches", alongside `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS`. Whether the count
includes the manager's own level is unverified, so nothing here sets it; one dispatch under a
known value settles it.

**One browser pane** per session; browser tasks run one at a time.

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
