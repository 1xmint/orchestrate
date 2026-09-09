# Handoff: paste this into a fresh Fable 5.1 session

You are picking up the `orchestrate` Claude Code skill, built on 2026-09-08.
Read before acting: `C:\Users\Josh\Desktop\GitHub\orchestrate\STATE.md`, then
the plan at `C:\Users\Josh\.claude\plans\i-want-you-to-abundant-crab.md`
(sections 1, 6, 13, 14, 16). Do not re-derive what they record.

What exists: public repo https://github.com/1xmint/orchestrate (main, v0.3.0);
installed at `~/.claude/skills/orchestrate` and `~/.agents/skills/orchestrate`;
six `orch-*` agents in `~/.claude/agents`; a guard hook that self-registers from
SKILL.md frontmatter and holds the Fable and credential rules. Two reviews were
applied (a cold-reader pass and a fresh-context Fable audit); the items left
open are listed at the bottom of STATE.md.

Josh's standing rules for this work: talk plainly, one recommendation per
decision; minimal dogfooding, the real test is his own use; spend agents only
when they help; never run `claude auth login` or touch credentials for him;
ask before anything public, paid or destructive.

Known limits to keep in mind, not to re-litigate: effort is fixed per agent
file (Claude Code cannot set it per call); model choice is a tier table plus
fixed triggers, not learned; Codex support is loading-only; the `.skill` zip
does not upload to claude.ai because of the `hooks` key.

First thing to do in the new session: run
`node ~/.claude/skills/orchestrate/scripts/profile.mjs`, then ask Josh what he
wants next, offering these in order: (1) use it for real on one of his goals
and fix what breaks; (2) description optimisation once the CLI is logged in;
(3) any item from STATE.md's open list.
