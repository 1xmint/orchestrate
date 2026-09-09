# Fresh-context audit prompt

Run this as a `fable` subagent on a Max plan (or paste it into a fresh chat on
the strongest model available) after a version is built and its tests pass. It
is pre-filled so the auditor spends its effort on judgment rather than
re-discovery. Replace `<path>`. Current for v0.4.0.

```
You are auditing a Claude Code skill called `orchestrate` before it ships. Be
brutal and specific. Do not restate the design back; find what will fail.

Facts you can rely on (verified 2026-09-08 against the live docs; the desktop
app runs Claude Code 2.1.260; do not re-derive these):
- Skill folder: <path>. Read SKILL.md, references/*.md, assets/agents/*.md,
  scripts/*.mjs, scripts/lib/*.mjs. The *.test.mjs files are the proof; read
  them to find what is NOT covered, and attack that.
- Host: Claude Code. Dispatch is the Agent tool (per-call model:
  sonnet|opus|haiku|fable; isolation: worktree; background by default;
  SendMessage resumes a named agent). Role agents live in ~/.claude/agents with
  model/effort/tools/maxTurns/hooks/memory frontmatter. Effort cannot be set
  per call. Nesting is allowed three levels deep by default; "only the
  orchestrator dispatches" is this skill's policy, not a platform limit.
- A background subagent keeps Read, Grep, Glob, Bash, Edit, Write, WebFetch,
  WebSearch, Skill, ToolSearch, Monitor, SendMessage; it loses AskUserQuestion,
  so it can never ask the user anything.
- Claude Code reads CLAUDE.md only, never AGENTS.md; a repo wanting both needs
  "@AGENTS.md" inside CLAUDE.md.
- Plans: Pro includes Opus/Sonnet/Haiku and Fable bills usage credits; Max 5x
  and 20x include Fable up to 50% of the weekly limit; limits are shared across
  the Claude app and Claude Code. No API exposes remaining usage to a session.
- Hooks: this version registers router.mjs (UserPromptSubmit, SessionStart),
  guard-agent.mjs (PreToolUse on Agent), ledger.mjs (SubagentStop) in
  ~/.claude/settings.json, plus return-check.mjs from each agent file and
  turn-check.mjs from SKILL.md frontmatter. `updatedInput` requires
  `permissionDecision: "allow"`. A hook that exits non-zero or prints
  malformed JSON degrades the session.
- Only spec frontmatter is portable (name, description, license,
  compatibility, metadata, allowed-tools); package.mjs --spec strips the rest.
  Codex loads the same folder from ~/.agents/skills and runs no hooks.
- Prior art already mined: a retired agent-orchestrator skill, a human-transport
  role library, mattpocock/skills, ponytail, myshell-tools, the DATA pack. Do
  not suggest re-reading them.

Judge, in this order, with file:line citations and a concrete failure
scenario for each finding. A finding without a failure scenario is noise.
1. The hooks. Each one runs on someone's real machine on every prompt or every
   dispatch. Where can one throw, hang, print malformed JSON, block a turn it
   should not, corrupt the file it edits, or race a second copy of itself?
   Where does its logic disagree with what SKILL.md or the references claim it
   does?
2. Rules that are still prose but should be mechanical (a tool restriction, a
   script, a schema field). Name the cheapest rung that would hold each.
3. Places where a cold subagent will fail because the packet template lets the
   orchestrator omit something it needed.
4. Routing mistakes: any path where Pro spends money on Fable without consent;
   any way the Fable ceiling on Max can be blown; over- or under-escalation;
   any case where the who-reviews rule skips a review that was needed.
5. The router's classification: three realistic prompts it hints wrongly, and
   three it stays silent on when a hint would have paid for itself.
6. Over-triggering: three realistic prompts this description would wrongly
   hijack. Under-triggering: three it would wrongly ignore.
7. Context growth: what in the loop makes the main conversation bloat, and the
   fix. Count bytes; do not guess.
8. Anything that assumes training knowledge instead of grounding at use.
9. What to delete. Every SKILL.md line costs tokens on every turn; name lines
   that do not change behaviour.

Output: a ranked list, most damaging first, each item at most five lines with
the fix. Then a one-paragraph verdict: ship, ship-with-fixes, or rebuild, and
why. No praise.
```
