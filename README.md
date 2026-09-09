# orchestrate

A skill that turns one Claude Code conversation into an autonomous technical
project manager. You say what you want done. It works out the plan, picks the
agent and model for each part according to your Claude plan (Pro, Max 5x, Max
20x), writes each agent's brief, judges what comes back, retries or escalates
when something is off, verifies independently, and reports in plain words.

The skill lives in `skills/orchestrate/`. Everything else in this repo is for
building and testing it.

## Install

This repo is a Claude Code plugin. That is the short path:

```
/plugin marketplace add 1xmint/orchestrate
/plugin install orchestrate
```

It brings the skill, the six role agents, the output style and the three global
hooks in one step. **It needs `node` on your PATH**, because the hooks shell out
to Node; if you launched the desktop app from the dock or Start menu and your
Node came from nvm, fnm or Homebrew, it may not be there. If the hooks seem
inert, use the script below instead, which writes Node's absolute path in.

The script path, which also works with no plugin support and pins the
interpreter:

```bash
git clone https://github.com/1xmint/orchestrate
cd orchestrate
node scripts/install.mjs --with-router --with-hook
```

That copies the skill to `~/.claude/skills/orchestrate/` (and to
`~/.agents/skills/orchestrate/` for Codex, skip with `--no-codex`), installs
six role agents into `~/.claude/agents/`, and registers the hooks below in
`~/.claude/settings.json`. Both are picked up by a running session within a
minute or so; a new session sees them at once. Type `/orchestrate <your
goal>`, or just describe a multi-part goal; the skill triggers on its own.

`settings.json` is merged, never replaced: your own hooks survive byte for
byte, a backup is written to `~/.claude/orchestrate/settings.backup.<time>.json`
before the first change, and a second run replaces our entries rather than
stacking them. `--dry-run` says what would happen and changes nothing.

### What the hooks do

| Hook | When | What it holds |
|---|---|---|
| `router.mjs` | every prompt, and on resume or compact | once a session, the cost-ordered ladder of moves plus the local state the model cannot see: plan tier, your own model, an open run, agents installed, a family limit hit today. After that, silence unless something changed. Turn it off for a session by typing `router off` |
| `guard-agent.mjs` | before every Agent dispatch | blocks any brief carrying something shaped like a credential, and records every dispatch so the ledger and the meter can report what ran. It has no opinion about which model a task deserves: that is the manager's judgment, and when the right model is not included in your plan it asks you rather than spending or downgrading quietly |
| `ledger.mjs` | when a subagent stops | saves the full return under the run folder, sums its token usage, and moves its row in `RUN.md` to review, partial or blocked |
| `return-check.mjs` | each role agent's own stop | refuses a return that is missing RESTATED, STATUS or EVIDENCE, or runs past 60 lines. Twice, then it gives up |
| `turn-check.mjs` | when a turn ends with a run open | blocks once when `RUN.md`'s Pickup line has not moved since the last dispatch, so a session that dies is still resumable |

Only the router and the guard are global. `return-check.mjs` is declared in
each agent file, and the ledger and turn check also come from the skill's own
frontmatter, so they are live whenever the skill is.

First run: the skill reads your plan tier from your local Claude config. If it
cannot, it asks once and remembers:

```bash
node ~/.claude/skills/orchestrate/scripts/profile.mjs --set tier=max5
```

## It asks you once

You pick the conversation's model and effort before this skill exists, so it
cannot set them for you. It does not need you to remember this table, either: on
the first message where it can see what it is running on, it says what you are
on, what your plan deserves, and the exact click. You switch, or you say why you
are keeping it, and it records your answer and never asks again on that plan.

| Your plan | Model | Effort |
|---|---|---|
| Pro, $20 | Sonnet | high |
| Max 5x, $100 | Opus | high |
| Max 20x, $200 | Opus | high |

In the desktop app, click the model name next to the send button, then the
effort next to it. In a terminal, start with `claude --model opus --effort high`.

To make it the default for every new session:

```
node skills/orchestrate/scripts/profile.mjs --set-default model=opus effort=high
```

That writes two keys into `~/.claude/settings.json` and backs up the file first.
It changes what new sessions start on; the conversation you are in still changes
only with the picker.

Why `high` and not higher, on every plan: the conversation takes many short
turns, and effort multiplies across all of them, while a worker takes one long
turn and stops. So depth is spent on the dispatched agents instead, where the
planner and debugger already run at `xhigh`. And why to set it once: changing the
model or effort mid-run makes Claude re-read the whole conversation on the next
turn, which costs more than the setting saves.

`skills/orchestrate/references/models.md` has the rest: what each of the four
models is good and bad at, why Haiku's context window is a fifth of the others,
and the four tests for never reaching for a bigger model than the job needs.

## Make it talk like a person

The install copies an output style called **Plain** to
`~/.claude/output-styles/plain.md` and leaves it switched off. An output style
is the strongest place to put "how to talk": it edits the system prompt itself,
so it applies to every turn of every session rather than only while a skill is
loaded. Turning one on changes all your sessions, so that stays your call. Add
this to `~/.claude/settings.json`, or to a project's
`.claude/settings.local.json`, and start a new session:

```json
{ "outputStyle": "Plain" }
```

Plain answers first, proves every claim with a path or a command, names a
technical word once and then reuses it, compares things to everyday life rather
than to other technology, and explains rather than defines. It never shortens an
error, a warning, or a confirmation. It keeps Claude Code's engineering
instructions, so it changes how you are talked to and nothing about how the work
is done.

If you only want shorter answers, Claude Code ships a built-in **Concise** style
that leads with the result and drops the narration. Try that first. The same
rules live in `SKILL.md` §9 for the times the style is off, and for hosts like
Codex that have no output styles at all.

## Drop it into one repo

```bash
node scripts/install.mjs --project /path/to/repo --dry-run
```

Four things, and it tells you about each: `.orchestrator/gate.json` with the
build, test and lint commands it found; `.orchestrator/` added to
`.git/info/exclude` so the ledger is never committed; a
`.claude/rules/orchestrate.md` of twelve lines or fewer, which every session in
that repo loads; and, when the repo has an `AGENTS.md` and no `CLAUDE.md`, the
one-line fix printed for you to apply. Claude Code reads only `CLAUDE.md`, so
without that line nothing in `AGENTS.md` reaches a session or a subagent.

Drop `--dry-run` to apply it. The rules file is tracked, so commit or delete
it; a rules file this installer did not write is left alone.

## Check it loaded (one fresh session, no quota)

After installing, open a new Claude Code session and check these five things.
Nothing here dispatches an agent.

1. The first prompt of the session shows a `[orch-router · once per session]`
   line naming your tier, your own model, and whether a run is open here.
2. The second prompt shows nothing. If it does, the classification changed or
   the state changed; both are legitimate, silence is the default.
3. `~/.claude/orchestrate/sessions/` has a file named for the session id.
4. `/orchestrate` shows an `orchestrate: tier … · agents 6/6` line at the top
   of the skill, with no Bash turn before it. That is the injected profile.
5. `~/.claude/settings.json` still has whatever hooks you had before, and
   `~/.claude/orchestrate/` holds a `settings.backup.*.json`.

Then, after `/compact` or resuming, the router prints the open run and its
Pickup line and nothing else.

## Measure a real run

```bash
node ~/.claude/skills/orchestrate/scripts/measure.mjs --latest
```

Reads the transcript Claude Code already wrote and prints what the turns cost
(fresh input, cache read, cache write, output), how many dispatches went to
which models, how long the packets and returns were, and what the router's own
injections cost once and cumulatively. No quota, no network. The efficiency
claims in this repo stay estimates until you run this on a real orchestration;
the script exists so that costs nothing.

## Install from the .skill file (no git)

`orchestrate.skill` is a zip. Unzip it so that
`~/.claude/skills/orchestrate/SKILL.md` exists, then run
`node ~/.claude/skills/orchestrate/scripts/install-agents.mjs` once for the
role agents. Build both zips with `node scripts/package.mjs --both`.

`orchestrate-spec.skill` is the portable build for hosts that read the skill
spec but not Claude Code's extensions, such as claude.ai and Codex. It drops
the `hooks` and `when_to_use` frontmatter and the injected profile line, and
says plainly that nothing is enforcing the rules there. It is weaker, not
wrong: every rule the hooks hold is also stated in the body.

## What it needs

- Claude Code (desktop app or CLI) on a Pro, Max, Team or API account.
- Node 18 or newer for the helper scripts. They spend no model quota, make no
  network calls, and have no dependencies.
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
  SKILL.md              the skill (150 body lines; stays in context)
  references/           ladder, routing, contracts, evaluation, lanes, hosts, provenance
  scripts/              router, guard, ledger, return-check, turn-check, gate,
                        profile, run-init, measure, install-agents, install-project
  assets/               RUN.md template, packet template, six role agents, the Plain output style
.claude-plugin/          plugin manifest, so /plugin install works
hooks/hooks.json         the three global hooks, for the plugin path
evals/                  test prompts for the skill-creator loop
scripts/install.mjs     installs the skill, agents and hooks
scripts/package.mjs     builds the two .skill zips
STATE.md                build progress and resume point
```

## Test it

```bash
node --test "skills/orchestrate/scripts/**/*.test.mjs"
```

No quota, no network, no dependencies. They cover the router's emission policy
on fixture prompts, the guard's rewrite and deny paths, the ledger's parsing
and its dedupe against the double registration, the two stop hooks' block
counts, gate detection on three fixture repo layouts, the project kit, the
installer's merge against a copy of a real `settings.json`, both package
builds, and the eval file's shape. The run prints the count; anything red is a
regression.

## Provenance

The ideas are borrowed and credited in
`skills/orchestrate/references/borrowed.md`.
