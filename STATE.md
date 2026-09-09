# Build state

Resume point for building the `orchestrate` skill. The plan is at
`C:\Users\Josh\.claude\plans\i-want-you-to-abundant-crab.md`; section numbers
below refer to it.

| step | what | status |
|---|---|---|
| 12.1 | repo skeleton, README, STATE, LICENSE | done 2026-09-08 |
| 12.2 | references: routing, contracts, evaluation, hosts, borrowed, audit-prompt | done 2026-09-08 |
| 12.3 | six role agents + RUN.md template | done 2026-09-08 |
| 12.4 | scripts: profile, install-agents, run-init, smoke; repo install.mjs | done 2026-09-08; fixed nested tier keys, shell spawn warning, local dates |
| 12.5 | SKILL.md (~220 lines, spec-only frontmatter) | done 2026-09-08 |
| 12.6 | install to ~/.claude/skills and ~/.agents/skills; install agents | done 2026-09-08 |
| 12.7 | frontmatter validation (skill-creator quick_validate: valid) | done 2026-09-08 |
| 13 (trimmed) | cold-reader pass (15 findings, applied) and fresh-context Fable audit (17 findings; the mechanical ones applied: guard-agent hook, packet branch/run-dir fields, git-path exclude, browser agent write-locked, prices removed, triggers split into author vs reviewer, verification via Explore, SKILL.md trimmed to v0.2.0) | done 2026-09-08 |
| next | Josh uses it for real and feeds back; optional later: `--with-hook` on his machine, description optimisation (needs `claude auth login`), a private remote | open |

Audit items deliberately not applied: a per-run absolute Fable cap (replaced by
a per-day cap in the hook); moving the task table out of RUN.md; marking every
host assumption unverified line by line (the two that matter are marked in
hosts.md and contracts.md).

Pickup prompt: read this table, open the plan's section 12, continue at the
first row that is not done.
