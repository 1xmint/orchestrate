# Fresh-context audit prompt

Run this as a `fable` subagent on a Max plan (or paste it into a fresh chat on
the strongest model available) after a draft of the skill exists. It is
pre-filled so the auditor spends its effort on judgment rather than
re-discovery. Replace `<path>`.

```
You are auditing a Claude Code skill called `orchestrate` before it ships. Be
brutal and specific. Do not restate the design back; find what will fail.

Facts you can rely on (verified 2026-09-08; do not re-derive):
- Skill folder: <path>. Read SKILL.md, references/*.md, assets/agents/*.md,
  scripts/*.mjs.
- Host: Claude Code. Dispatch is the Agent tool (per-call model:
  sonnet|opus|haiku|fable; isolation: worktree; background by default;
  SendMessage resumes a named agent). Role agents live in ~/.claude/agents
  with model/effort/tools/maxTurns frontmatter. Effort cannot be set per call.
- Plans: Pro includes Opus/Sonnet/Haiku and Fable bills usage credits; Max 5x
  and 20x include Fable up to 50% of the weekly limit; limits are shared across
  the Claude app and Claude Code. No API exposes remaining usage to a session.
- Only spec frontmatter is portable (name, description, license,
  compatibility, metadata, allowed-tools). Codex loads the same folder from
  ~/.agents/skills.
- Prior art already mined: a retired agent-orchestrator skill, a human-transport
  role library, mattpocock/skills, ponytail, myshell-tools, the DATA pack. Do
  not suggest re-reading them.

Judge, in this order, with file:line citations and a concrete failure
scenario for each finding:
1. Rules that are prose but should be mechanical (a tool restriction, a
   script, a schema field). Name the cheapest rung that would hold each.
2. Places where a cold subagent will fail because the packet template lets
   the orchestrator omit something it needed.
3. Routing mistakes: any path where Pro spends money on Fable without consent;
   any way the Fable ceiling on Max can be blown; over- or under-escalation.
4. Over-triggering: three realistic prompts this description would wrongly
   hijack. Under-triggering: three it would wrongly ignore.
5. Context growth: what in the loop makes the main conversation bloat, and
   the fix.
6. Anything that assumes training knowledge instead of grounding at use.
7. What to delete. Every SKILL.md line costs tokens on every turn; name lines
   that do not change behaviour.

Output: a ranked list, most damaging first, each item at most five lines with
the fix. Then a one-paragraph verdict: ship, ship-with-fixes, or rebuild, and
why. No praise.
```
