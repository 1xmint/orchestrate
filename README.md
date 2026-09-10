# orchestrate

A skill that makes one Claude Code conversation behave like a dependable senior
engineer. You say what you want. It works out what you actually want, picks an
approach and tells you the tradeoff, does the work — delegating only the parts
where delegating buys something — proves the result with evidence rather than a
claim, and reports in plain words.

It is deliberately not a process. There is no ladder of rungs, no rule that a
step count means an agent, and nothing that reads your wording and tells the
model what to do. Those existed in earlier versions and cost more than they
bought. What is left is a small set of safeguards for the failures a hook can
actually catch, and judgment for everything else.

The skill lives in `skills/orchestrate/`. Everything else in this repo is for
building and testing it.

## Install

This repo is a Claude Code plugin. That is the short path.

**In a terminal**, type these into Claude Code:

```
/plugin marketplace add 1xmint/orchestrate
/plugin install orchestrate@orchestrate
```

**In the desktop app** there is no `/plugin` command; it is a terminal-only
command and typing it there does nothing. Either use the plugin UI — the **+**
button next to the prompt box, then **Plugins**, then **Add plugin**, or the
Plugins section of the app's settings — or run these in any terminal and restart
Claude:

```bash
claude plugin marketplace add 1xmint/orchestrate
claude plugin install orchestrate@orchestrate --scope user
```

Either way it brings the skill, the six role agents, the output style and the
three global hooks in one step.

**A fresh install is not always live in the session you ran it from.** From
inside Claude Code, the install summary tells you which case you are in: either
`Plugin is now active.`, or `Run /reload-plugins to activate.` A `claude plugin`
command run in a shell never loads into an open session, so there you either
start a new session or type `/reload-plugins` in the one you have. If the reload
warns that it would re-read the conversation, run `/reload-plugins --force`.

**It needs `node` on your PATH**, because the hooks call Node by name. If you
launched the desktop app from the dock or Start menu and your Node came from
nvm, fnm or Homebrew, it may not be there. If the hooks seem inert, use the
script below instead, which writes Node's absolute path in.

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

## Use it

**There is nothing to learn.** Describe what you want. The skill triggers itself
on work with several parts, and stays out of the way on everything else. Typing
`/orchestrate <goal>` forces it, but you rarely need to.

What you get back depends on the size of the thing, and that is the whole point.

**A small change stays small.**

> Rename the button on the settings page from "Sync now" to "Refresh".

It makes the edit and tells you. No plan, no agents, no ledger, no questions.
This is most work, and the plugin's main job here is to not get in the way.

**A real change gets evidence, not a claim.**

> Add a `--json` flag to the status command so it prints the same data as one
> JSON object, with tests, and don't change the human output.

It reads the code, makes the change, runs your project's own test and lint
commands, and reports what passed with the output. If it could not verify
something, it says so rather than calling it done.

**Work with several tracks gets a ledger.**

> Port the CLI to the new config format and rewrite the docs site build. They
> don't touch the same files.

Now it writes `.orchestrator/runs/<date>-<slug>/RUN.md` in your repo: the goal,
what "done" looks like, the constraints, and a task table. Each worker gets its
own git worktree so they cannot collide. You can read that file at any time, and
if the session dies you can open a new one and say "continue".

**Work that is expensive to get wrong gets a second pair of eyes.**

> Our login route lets an expired token through if the clock skews. Fix it.

An authorisation boundary is one of the few things that always gets an
independent review. A cosmetic change to a public page does not.

### What you will see while it works

While a run is open, the first message of each session carries one line of state:

```
[orchestrate] you: opus @ high effort · tier max5 · orch-agents 6/6 · run: 20260909-tidy (bound to this session) · 1 return to grade: 9-9-0001 · ready now: 9-9-0003 · limits today: none
```

Read it left to right. What you are running on, which plan, whether the six role
agents are installed, which run this session owns, then two things worth acting
on: **returns to grade** is finished work waiting for someone to judge it, and
**ready now** is a task whose blockers have all landed, so nothing should be
sitting idle. After that first line it stays quiet until one of those facts
changes.

### When it will stop and ask you

Four things, and only these: money, a public surface, credentials, and anything
destructive or irreversible. It asks once, with a recommendation first, and
permission you have already given for a piece of work is not asked for twice.

Everything else it decides and tells you, including which files to touch and
whether something needs a test.

### Configure it

You need none of this to start. These are the keys worth knowing once you have
used it for a while, in `~/.claude/settings.json`:

```json
{
  "model": "opus",
  "effortLevel": "high",
  "env": {
    "FORCE_AUTOUPDATE_PLUGINS": "1"
  },
  "enabledPlugins": {
    "orchestrate@orchestrate": true
  },
  "extraKnownMarketplaces": {
    "orchestrate": {
      "source": { "source": "github", "repo": "1xmint/orchestrate" },
      "autoUpdate": true
    }
  }
}
```

- **`model` and `effortLevel`** seed what a *new* session starts on. They do not
  govern a session you are already in: the picker wins, and `effortLevel` is
  written by the picker rather than read by it, so the value sitting in the file
  is usually a record of the last thing you chose. On a machine here the file
  read `opus` at `low` while the live session ran `opus` at `high`, and the
  session was right. The recommendation per plan is under
  [What to run it on](#what-to-run-it-on); the skill will not change either key
  and will not nag you about them.
- **`FORCE_AUTOUPDATE_PLUGINS`** only matters if you also set
  `DISABLE_AUTOUPDATER=1` to pin Claude Code itself. That switch stops plugin
  updates too, and this one lets them through again.
- **`autoUpdate`** on the marketplace entry is what the plugin manager writes
  when you enable auto-update in its UI. It is off by default for third-party
  marketplaces like this one.

`enabledPlugins` and `extraKnownMarketplaces` are written for you by the
install. You should not need to type them.

### What the hooks do

| Hook | When | What it holds |
|---|---|---|
| `router.mjs` | every prompt, and on resume or compact | once a session, the local state the model cannot see: plan tier, your own model, the run this session is bound to, agents installed, a family limit hit today, plus a short card on how work gets shaped. While a run is open it also names the returns still waiting to be graded and the tasks whose blockers have all landed, so a session stops waiting on one agent when there is work it could start. On resume it brings back the run's goal, constraints and next step. After that, silence unless one of those facts changes. Turn it off for a session by typing `router off` |
| `guard-agent.mjs` | before every Agent dispatch | blocks any brief carrying something shaped like a credential, and records every dispatch so the ledger and the meter can report what ran. It has no opinion about which model a task deserves: that is the manager's judgment, and when the right model is not included in your plan it asks you rather than spending or downgrading quietly |
| `ledger.mjs` | when a subagent stops | saves the full return under the run this session is bound to, prices it, and records which run and task it belongs to in `returns/returns.jsonl`. It does not touch the task rows: two returns landing together each rewrote the whole file, and the second erased the first |
| `turn-check.mjs` | when a turn ends | one rule, and only for a run this session is bound to: it asks once for the Pickup line when that line has not moved since the last dispatch, so a session that dies is still resumable |

Only the router and the guard are global. The ledger and the turn check come
from the skill's own frontmatter, so they are live whenever the skill is.

Two hooks that used to be here are gone in v0.9.0. One refused a subagent's
return over its shape, spending a real model turn to buy a restatement or a
line count. The other blocked a turn when a recommendation had been answered
from fewer than two source-reading calls, which two failed fetches satisfied
and one authoritative document did not. Neither is something a hook can judge.

First run: the skill reads your plan tier from your local Claude config. If it
cannot, it asks once and remembers:

```bash
node ~/.claude/skills/orchestrate/scripts/profile.mjs --set tier=max5
```

## Stay up to date

**Recommended: update by hand when you want to.** Two commands, they work in any
terminal on any host, and there is no UI to hunt through. Refresh the catalogue
first, because the update reads from your local copy of it:

```bash
claude plugin marketplace update orchestrate
```

```bash
claude plugin update orchestrate@orchestrate
```

An update lands on disk but does not enter a session that is already running.
Start a new one, or type `/reload-plugins` in the open one.

Check which version you ended up on:

```bash
claude plugin list
```

### Why not just turn auto-update on

You can, but there is no command for it, and the obvious route does not exist on
every host:

- Claude Code leaves auto-update **off** for third-party marketplaces, which is
  what `1xmint/orchestrate` is. It is on by default only for Anthropic's own.
- The toggle lives in the plugin manager, and `claude plugin marketplace` has no
  flag for it.
- **`/plugin` is a terminal-only command. It does nothing in the desktop app**,
  so the usual "run `/plugin`, go to Marketplaces, Enable auto-update" does not
  work there. In the desktop app you go through the plugin UI instead: the **+**
  button next to the prompt box, then **Plugins**, or the Plugins section of the
  app's own settings.

If you want it on and you are in a terminal, `/plugin` then **Marketplaces**
then `orchestrate` then **Enable auto-update**. After that Claude Code refreshes
and updates in the background shortly after each session starts, with a delay of
up to ten minutes so the running session keeps what it launched with.

There is also an `"autoUpdate": true` key on the marketplace entry in
`~/.claude/settings.json`, which is what the plugin manager writes when you use
that toggle. [Configure it](#configure-it) shows where it sits in the file. It is
**undocumented for user settings** and unverified here, so it is worth knowing
about but not worth relying on.

To turn auto-updating off again, set that key to `false`, or use the same toggle
in the plugin manager. The `DISABLE_AUTOUPDATER` environment variable also works
but is blunter: it stops Claude Code updating itself as well. Setting
`FORCE_AUTOUPDATE_PLUGINS=1` alongside it keeps plugin updates while pinning
Claude Code.

To remove the plugin entirely, see [Remove it](#remove-it).

A new version only reaches you when the `version` field in `plugin.json` is
bumped, which is what a release here does.

**If you installed with the script instead of as a plugin, none of this
applies.** A script install is a copy on your disk with nothing watching it, and
this skill makes no network calls by design, so it cannot check for itself. Your
options are to re-run the installer when you want the latest, or to switch to
the plugin install above and let the host handle it. To see what you are on:

```bash
grep version ~/.claude/skills/orchestrate/SKILL.md
```

## What to run it on

You pick the conversation's model and effort before this skill exists, so it
cannot set them for you.

**It no longer offers an opinion unless you ask.** Until v0.9.0 it did: on the
first message where it could see what it was running on, it told you what your
plan deserved and the exact click to get there. That is a session interrupting
you about your own settings, on a turn you started for some other reason, and it
came out of the same pass that removed everything else here that spoke without
being asked. Ask, and you get the table below. Do not ask, and it works at
whatever you chose.

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
turn and stops. And why to set it once: changing the model or effort mid-run
makes Claude re-read the whole conversation on the next turn, which costs more
than the setting saves.

The dispatched agents inherit whatever you chose. They used to pin their own —
the planner and debugger at `xhigh` — which quietly overrode your setting and
spent your quota at a level you never picked. That went in v0.9.0 too.

`skills/orchestrate/references/models.md` has the rest: what each of the four
models is good and bad at, why Haiku's context window is a fifth of the others,
and the four tests for never reaching for a bigger model than the job needs.

## Make it talk like a person

There is an output style called **Plain**, and which path you installed by
decides whether it is on:

- **Installed as a plugin**, Plain is on in every session without you choosing
  it. Disabling the plugin turns it off.
- **Installed by script**, it is copied to `~/.claude/output-styles/plain.md`
  and left off, because turning a style on changes all your sessions and that
  is your call. Add `{ "outputStyle": "Plain" }` to `~/.claude/settings.json`,
  or to a project's `.claude/settings.local.json`, and start a new session.

An output style is the strongest place to put "how to talk": it edits the system
prompt itself, so it applies to every turn rather than only while a skill is
loaded.

Plain answers first, says what a claim rests on, delivers what was asked at the
scope asked, names a technical word once and then reuses it, and explains rather
than defines. It never shortens an error, a warning, or a confirmation. It keeps
Claude Code's engineering instructions, so it changes how you are talked to and
nothing about how the work is done.

If you only want shorter answers, Claude Code ships a built-in **Concise** style
that leads with the result and drops the narration. Try that first. The seven
rules that matter most live in `SKILL.md` §9 for the times the style is off, and
for hosts that have no output styles at all.

## What one goal costs

Every dispatch that names a model arrives with a price on it, in list-price
dollars — the same unit `/usage` computes its Session figure in. **List price is
not what a subscription is billed.** A dispatch that names no model gets no
price, because nothing knows what it will run on. There is no running counter,
because a counter reads as an allowance and invites spending up to it.

v0.9.0 removed the "% of your week" that used to travel with each price, and the
two thresholds built on it (say it over 5%, ask over 25%). The weekly figure
they divided by — Pro about $30, Max 5x about $150, Max 20x about $600 — came
from **one observation** on 2026-09-09, and a percentage computed from that
reads like a measurement when it is not one. What is left is judgment: say a
price once, before the spend, when it is big enough to change what you would
want; ask first when the money is yours rather than the plan's.

A finished run's real cost is `measure.mjs --latest --dollars`, after the fact,
where it can change the next decision instead of nagging about this one.

## Stop it

`Esc` stops the current turn. `/tasks` stops a running worker. Whatever finished
before you stopped is already in the ledger, so nothing is lost by stopping.

## Remove it

To switch it off without removing anything:

```bash
claude plugin disable orchestrate@orchestrate
```

That is also how you turn off the Plain voice, which a plugin install applies
without anybody selecting it. `claude plugin enable orchestrate@orchestrate`
puts it back.

To remove it properly:

```bash
claude plugin uninstall orchestrate@orchestrate
```

Removing the marketplace with `claude plugin marketplace remove orchestrate`
also uninstalls it, so you do not need both.

**A script install has no uninstaller**, so it comes off by hand. Four paths,
then one file you edit rather than delete:

```bash
rm -rf ~/.claude/skills/orchestrate ~/.agents/skills/orchestrate ~/.claude/agents/orch-*.md ~/.claude/output-styles/plain.md
```

Then open `~/.claude/settings.json` and delete the hook entries naming
`router.mjs`, `guard-agent.mjs`, `ledger.mjs` or `turn-check.mjs`. Your own
hooks sit in the same arrays, so read before you cut; a backup from before the
first install is in `~/.claude/orchestrate/`.

`~/.claude/orchestrate/` itself holds your plan tier, what past dispatches cost
and which run each session was on. Nothing in it affects a session once the
skill is gone, and deleting it loses the answers you gave. Keep it unless you
want them gone.

Per repo, `node scripts/install.mjs --project <repo>` also wrote
`.orchestrator/`, a line in `.git/info/exclude` and
`.claude/rules/orchestrate.md`. Those are local to that repo and safe to delete.

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

1. The first prompt of the session shows an `[orchestrate]` line naming your
   tier, your own model, the agents installed, and the run this session is
   bound to if there is one.
2. The second prompt shows nothing. Silence is the default, and the only thing
   that breaks it is one of those facts changing.
3. `~/.claude/orchestrate/sessions/` has a file named for the session id.
4. `/orchestrate` shows an `orchestrate: tier … · agents 6/6` line at the top
   of the skill, with no Bash turn before it. That is the injected profile.
5. `~/.claude/settings.json` still has whatever hooks you had before, and
   `~/.claude/orchestrate/` holds a `settings.backup.*.json`.

Then, after `/compact` or resuming, it prints the run's goal, what done looks
like, the constraints, the decisions already made and the Pickup line. That
block is what a session needs back; the task history stays on disk.

## Measure a real run

```bash
node ~/.claude/skills/orchestrate/scripts/measure.mjs --latest
```

Reads the transcript Claude Code already wrote and prints what the turns cost
(fresh input, cache read, cache write, output), how many dispatches went to
which models, how long the packets and returns were, how often the Pickup check
sent a turn back, and what the router's own injections cost once and
cumulatively. Add `--dollars` for the list-price figure. No quota, no network.
The efficiency claims in this repo
stay estimates until you run this on a real orchestration; the script exists so
that costs nothing.

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

That is the whole list. **It needs no other agent CLI and no API key of its
own.** `scripts/smoke.mjs` can check whether Codex, opencode or a signed-in
`claude` CLI answers, and `references/routing.md` sketches using one as a
separate quota pool, but nothing in the skill depends on any of them and that
lane has not been exercised. Treat it as a note, not a feature.

## Codex and the ChatGPT desktop app

The same folder loads from `~/.agents/skills/orchestrate/` and is invoked as
`$orchestrate` or `@orchestrate`. The instructions apply and the plain-speech
rules travel with them. Dispatch there would use Codex's own subagents, which
this version has never run, so treat that host as documentation rather than a
supported path. See `skills/orchestrate/references/hosts.md`.

## Layout

```
skills/orchestrate/
  SKILL.md              the skill (275 body lines; stays in context)
  references/           ladder, routing, evaluation, lanes, hosts, models
  scripts/              router, guard, ledger, turn-check, gate,
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
on fixture prompts, the guard's deny path and its refusal to be talked out of it
by a repeat, the ledger's parsing and its attribution of a return to the right
run, the Pickup check, which tasks are ready and which returns are still owed a
grade, gate detection on three fixture repo layouts, the project kit, the
installer's merge against a copy of a real `settings.json`, both package builds,
and the eval file's shape. The run prints the count; anything red is a
regression.

## Provenance

The ideas are borrowed and credited in
`docs/borrowed.md`.
