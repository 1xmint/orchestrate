# Handoff

`orchestrate` v0.7.4 is built, tested, packaged and tagged. v0.6.0 gave the
conversation a team; v0.7.0 puts a senior engineer in front of it. The setup
question now actually gets asked, a question gets a depth call before it gets an
answer, every claim has to name what it rests on with two independent checks
that say so when it does not, and every dispatch arrives with a price on it.
Repo: `C:\Users\Josh\Desktop\GitHub\orchestrate` (public,
github.com/1xmint/orchestrate, branch main). There is no unfinished build step.

## If you are picking this up cold

Read `STATE.md` first. Its v0.7.0 section names what changed, what was measured
rather than assumed, what stays reasoned, and two defects found while building
that were deliberately left for their own task. The plan it was built from is
`C:\Users\Josh\.claude\plans\you-are-the-senior-kind-mango.md`; its facts were
checked against the live docs on 2026-09-09 and do not need re-deriving.

Then run the tests, which need no quota and no network:

```
node --test "skills/orchestrate/scripts/**/*.test.mjs"
```

189 pass. Anything red is a regression, not a starting point.

Two offline commands are worth knowing, because both answer questions people
otherwise guess at:

```
node skills/orchestrate/scripts/turn-check.mjs --replay-week
node skills/orchestrate/scripts/measure.mjs --latest --dollars
```

The first says how often the research floor would fire on the last week of real
transcripts; it must stay under one a day, and it is at 0.14. The second prices
a finished session at list price and counts how often either check sent a turn
back.

## What is installed on this machine

**As a plugin, not a script copy.** `orchestrate@orchestrate`, user scope,
enabled, from the marketplace at `1xmint/orchestrate`. The skill, the six role
agents, the Plain output style and the four hooks all come from the plugin, and
`claude plugin list` reports the version. There is exactly one copy, under
`~/.claude/plugins/cache/orchestrate/orchestrate/<version>/`.

The old script install was removed on 2026-09-09: `~/.claude/skills/orchestrate`,
`~/.agents/skills/orchestrate`, the six loose `~/.claude/agents/orch-*.md`, and
the four orchestrate hook entries in `~/.claude/settings.json`. The pre-existing
`memory-write-gate.mjs` entry was left alone. A pre-switch backup is at
`~/.claude/orchestrate/settings.backup.pre-plugin-switch.json`.

`~/.claude/settings.json` also carries `extraKnownMarketplaces.orchestrate` with
`autoUpdate: true`. The docs only document that key for managed settings, so
whether the host honours it in user settings is **unverified**; the documented
path is `/plugin` → Marketplaces → orchestrate → Enable auto-update.

`~/.claude/orchestrate/active-run.json` points the hooks at the open run. It is
now load-bearing rather than a fallback: `latestRun` prefers it when it names a
run under the repo it was asked about.

To undo it all: `claude plugin uninstall orchestrate@orchestrate`, then
`claude plugin marketplace remove orchestrate`.

## What is open

Nothing is blocking, and nothing needs a decision.

- **The reply check is on in orchestrate sessions and off everywhere else.**
  Nobody has measured how often a Sonnet reader asks for a basis that was
  already in the reply. After a week under one block a day,
  `install.mjs --with-reply-check` becomes the default.
- **Auto-update is set but unconfirmed.** Ten seconds in `/plugin` settles it.
- **The field verdict of `docs/research/0001` has never been re-tested.** It is
  the one claim in this repo with a known expiry.

Two defects that were open in earlier drafts of this file are fixed: the
worktree failure (the folder was really `Desktop\Github`; renamed to `GitHub` on
2026-09-09, and a worktree now resolves to the path it was asked for) and
`latestRun` picking the wrong run among same-day runs.

The signal that matters is still Josh's own use. If the skill spends without
asking, downgrades without saying, blocks a turn that was fine, or explains
something badly, that is the bug report, and it is worth more than any test here.

## Non-negotiables, if you change anything

Zero npm dependencies, Node 18 or newer, Windows, macOS and Linux paths. Never
print secrets. Never run `claude auth login` or touch credentials. The router
stays global in `settings.json`, never in skill frontmatter, because it must
fire before the skill is ever invoked. `updatedInput` only works alongside
`permissionDecision: "allow"`, and the guard must never emit `allow` at all:
doing so would auto-approve every dispatch and take away the user's own
permission prompt. Every hook exits 0 and prints nothing on any error. Every
Stop hook blocks once per thing and honours `stop_hook_active`, because the host
overrides a Stop hook after eight consecutive blocks. Do not install the project
kit into Josh's live repos without asking.
