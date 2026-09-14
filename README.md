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
| `guard-agent.mjs` | before every Agent dispatch | blocks any brief carrying something shaped like a credential, and records every dispatch so the ledger and the meter can report what ran. It refuses, with the exact retry: a helper starting its own helpers; built-in `general-purpose` (no turn cap) while the capped role agents are installed; a third worker while two are running across Claude and Codex, or a second browser task; in Plan mode, any helper that could write, a worktree or a progress file; a Claude helper aimed at a worktree a live Codex worker holds; a coding, research or browser helper above Sonnet before a cheaper attempt at the same task; a search helper with no cheap model named; a copy of a conversation already past ~100k measured tokens; Fable on a plan where it costs credits; and any new helper once the 5-hour window is at 80% or the week at 90% |
| `context-check.mjs` | after each tool call | reads only what the conversation added since last time and says something only when the advice changes: prepare a checkpoint, recommend compacting or a fresh conversation at the next safe point, or look for what stayed large after a compaction. It also notices when the app enters or leaves Plan mode, and when a helper stopped at its turn cap. Inside a helper it records that helper's size and says nothing |
| `persist-check.mjs` | when a turn ends | only after you said to keep going until done: continues the goal without waiting for you, and stops on a question, a refusal, the same error twice, 25 steps, or 90% of the 5-hour window. It no longer warns about transcript size; the context reader's advice rides along when it changes |
| `ledger.mjs` | when a subagent stops | saves the full return under the run this session is bound to, prices it, and records which run and task it belongs to in `returns/returns.jsonl`. It does not touch the task rows: two returns landing together each rewrote the whole file, and the second erased the first |
| `turn-check.mjs` | when a turn ends | one rule, and only for a run this session is bound to: it asks once for the Pickup line when that line has not moved since the last dispatch, so a session that dies is still resumable |
| `precompact-check.mjs` | just before the conversation is compacted | the same Pickup rule as `turn-check.mjs`, fired one moment earlier: a long session can auto-compact mid-turn, and a stale Pickup line does not just age, it is gone. Asks once per unwritten line, then lets compaction proceed either way so it can never block the very thing that frees up context |

The router, the guard and the ledger are global, registered once from the
plugin's own `hooks/hooks.json` so they run whether or not the skill is
currently in play — **for a plugin install.** `guard-agent.mjs` and
`ledger.mjs` are also named in `SKILL.md`'s frontmatter, which means a plugin
install registers each of those two twice — see "A hook registered in two
places runs twice" in `references/hosts.md` for why that is safe: both are
keyed to be idempotent. **A script install (`--with-hook`) additionally
registers the turn check in `settings.json`** with the interpreter's absolute
path pinned in, the same way it pins the other two; only there does it not
depend on `node` being on the launching app's PATH.

Two hooks that used to be here are gone in v0.9.0. One refused a subagent's
return over its shape, spending a real model turn to buy a restatement or a
line count. The other blocked a turn when a recommendation had been answered
from fewer than two source-reading calls, which two failed fetches satisfied
and one authoritative document did not. Neither is something a hook can judge.

### If it has your plan wrong

Your plan decides what orchestrate lets helpers spend. On Pro it is strictest,
and on Max it allows Fable and more room before stopping.

**It works out the plan per Claude account.**
- **In a terminal**, it reads the plan from `~/.claude.json`, which is refreshed
  when you sign in. Switching accounts there needs nothing from you.
- **In the Claude app**, it first checks which account the session runs on. The
  app can be signed in to a different account than the terminal. On one machine
  the file described a Pro account used for a day, while the app ran on Max 5x.
  - If the file describes the app's account, it uses the file's plan.
  - If not, it does not borrow the other account's plan. It asks you once, and
    remembers the answer for that account. After that, switching back and forth
    between accounts picks the right plan on its own.

Check what it read and where from:

```bash
node skills/orchestrate/scripts/profile.mjs
```

Set it for the account you are on (`pro`, `max5` for the $100 plan, `max20` for
the $200 plan, `team`, or `api`):

```bash
node skills/orchestrate/scripts/profile.mjs --set tier=max5
```

`--clear` forgets the setting for this account and goes back to detecting it.
Your other choices, such as paid plugins, stay. From a plugin install the scripts live under
`~/.claude/plugins/cache/orchestrate/orchestrate/<version>/skills/orchestrate/scripts/`,
and from a script install under `~/.claude/skills/orchestrate/scripts/`.

### Live usage: terminal sessions only

Orchestrate can see how much of your 5-hour and weekly limits you have used, and
act on it:
- at 60% of the 5-hour window, it works one step at a time on cheaper models;
- at 80% of the 5-hour window, or 90% of the week, it stops starting helpers;
- at 90% of the 5-hour window, it stops continuing on its own.

Claude Code gives those numbers to exactly one place: the status line, the bar
under the prompt in a terminal. A plugin is not allowed to install a status line
itself, so this is a one-time step you choose:

```bash
node skills/orchestrate/scripts/statusline.mjs --install
```

It backs up `~/.claude/settings.json` first. If you already had a status line,
yours keeps running, with the usage shown after it. `--uninstall` puts back what
was there.

**The Claude desktop app does not run status lines.** On one machine the status
line was installed and working when run by hand, yet the desktop app never ran
it once in hours of use. So in the desktop app the usage stops above never fire.
Orchestrate still stops when an actual limit message arrives, and helpers on
Sonnet with step caps keep usage low either way.

A usage reading counts only when it names the provider and the account it came
from. One from another account, or an old file that cannot say whose it is, is
ignored rather than allowed to stop your work.

### How big the conversation is, and when to compact

Every step re-reads the whole conversation, so its size is the biggest cost there
is. Orchestrate measures it from the last model response after the last
compaction: fresh input plus cache reads plus cache writes. Transcript file size
is not used, because compaction keeps the file.

- At **120k tokens** it asks the model to write a checkpoint: the goal,
  decisions, changed files, test results, what is left, and the next step.
- At **150k**, or 75% of a smaller window when the window is known, it
  recommends a change at the next safe point: **compact** if the same task
  continues, a **fresh conversation** if the task changes or a finished phase
  will resume from saved files. You make the switch.
- Right after a compaction it says nothing until a response measures the new
  size. If that size is still large, it says to look for what is being restored
  every step (instruction files, plugin and tool listings, big tool output)
  instead of compacting again.
- No measurement, or one older than 12 hours, shows as **unknown**, never 0%.

See it for any session, including helpers it recorded:

```bash
node skills/orchestrate/scripts/context.mjs --latest
node skills/orchestrate/scripts/context.mjs --session <session id> --json
```

### Change the numbers

```bash
node skills/orchestrate/scripts/profile.mjs --policy
node skills/orchestrate/scripts/profile.mjs --policy context.compactAt=180000 workers.maxConcurrent=3
```

Keys: `context.checkpointAt`, `context.compactAt`, `context.windowFraction`,
`context.window`, `context.staleMs`, `workers.maxConcurrent`,
`workers.browserConcurrent`, `workers.nested` (`deny`/`allow`),
`workers.generalPurpose` (`deny`/`allow`), `workers.staleMin`, `codex.enabled`,
`codex.model`, `codex.effortImplement`, `codex.effortHard`, `codex.timeoutMin`.
They are stored under `policy` in `~/.claude/orchestrate/profile.json`; an older
version ignores that key. `profile.mjs --host` shows which Claude Code engine the
running app has, read from its own transcript rather than the terminal CLI,
which can be a different version.

## Plugins that make it better, and ones that cost you

**Every installed plugin is re-read on every step of every session**, whether
the work needs it or not. It is like carrying every tool you own to every job.
On one machine, 35 plugins added ~14k tokens to every step. They also pushed
307 of 356 skills down to a bare name with no description, so Claude could not
tell when the useful ones applied. Fewer plugins means less usage and better
choices. Orchestrate tells you once which of yours look unrelated to your work,
and again when you add one.

**Worth adding.** All four are free and in Anthropic's official catalog:

| Plugin | What it gives | Why it helps quota or quality |
|---|---|---|
| A language-server plugin for your language: `typescript-lsp`, `pyright-lsp`, `rust-analyzer-lsp`, `gopls-lsp`, … | Claude can jump to a definition, list every caller, and see type errors right after an edit | Answers "where is this used" without reading file after file, and catches a broken edit before a build or test run. Adds no skills to the per-step list. Needs the language server itself installed (for TypeScript: `npm i -g typescript-language-server typescript`; for Rust: `rustup component add rust-analyzer`) |
| `context7` | Current documentation for the library version you actually use | Fewer attempts written against an old API and then fixed. Works with no account; a free key only raises its rate limit |
| `frontend-design` | One skill for web pages that look designed rather than generated | Only if you build web front ends |
| `session-report` | A local HTML report of where your tokens went, by session, helper and prompt | Built from the files already on your disk; the report itself costs no usage. Useful to bring numbers to a planning session |

Install from a terminal with `/plugin install <name>@claude-plugins-official`,
or from the Claude app under Customize → Plugins → Discover.

**For web pages, use what is built in first.** A page fetch comes back already
summarised, web search is included in your plan, and the browser handles pages
that need JavaScript. Scraping plugins (Bright Data, Firecrawl, Tavily, Exa,
Nimble, TinyFish, Zyte) bill their own service by the request. Orchestrate never
uses a paid one unless you allow it. If you already pay for one and want it
used, name it once:

```bash
node skills/orchestrate/scripts/profile.mjs --set allowPaid=brightdata-plugin
```

`--set denyPaid=<plugin>` takes it back, and `--set paidServices=never|ask|free`
sets the rule for every other paid plugin (default: ask once per job).

**Leave these out when orchestrate is on.** They run their own multi-helper
workflows for the same jobs, so you would pay for the work twice:
`superpowers`, `feature-dev`, `code-review` and `pr-review-toolkit` (several
review helpers per review), `ralph-loop` (the same job as orchestrate's keep-going
loop), and `code-simplifier` (Claude Code's built-in `/simplify` covers it).

**`security-guidance`** is on by default in Claude Code. Its warnings while
editing are free: pattern checks run on your machine. Its reviews at the end of
each turn and on every commit and push call Opus whenever it finds credentials.
On one machine every review was skipped for lack of credentials, so they
cost nothing there. To make sure only the free warnings ever run, add this to
`~/.claude/settings.json` under `"env"`: `"ENABLE_CODE_SECURITY_REVIEW": "0"`.

Business plugins (sales, finance, legal, HR, marketing, bio research, ads,
market data) are fine if that is your work. For a coding session they are pure
per-step cost. Remove them in the Claude app under Customize → Plugins → Yours.
Plugins added there live in your Claude account and do not show in `/plugin`.

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
`router.mjs`, `guard-agent.mjs`, `ledger.mjs`, `turn-check.mjs`,
`precompact-check.mjs`, `persist-check.mjs` or `context-check.mjs`. Your own
hooks sit in the same arrays, so read before you cut; a backup from before the
first install is in `~/.claude/orchestrate/`.

`~/.claude/orchestrate/` itself holds your plan tier, what past dispatches cost
and which run each session was on. Nothing in it affects a session once the
skill is gone, and deleting it loses the answers you gave. Keep it unless you
want them gone.

Per repo, `node scripts/install.mjs --project <repo>` also wrote
`.orchestrator/`, a line in `.git/info/exclude` and
`.claude/rules/orchestrate.md`. Those are local to that repo and safe to delete.

### Try a new version, and roll it back

The marketplace entry auto-updates from `main`, so a merged release installs
itself at the next session. To try a branch first, without touching the
installed copy (terminal only; the app cannot pass the flag):

```bash
git -C /path/to/orchestrate checkout release/v0.13.0
```

```bash
claude --plugin-dir /path/to/orchestrate
```

Once it is merged, `claude plugin marketplace update orchestrate` followed by
`claude plugin update orchestrate@orchestrate` fetches it without waiting, and
takes effect in a new session. To roll back:

1. Right away, on this machine: `claude plugin disable orchestrate@orchestrate`.
2. For everyone: revert the release's merge on `main` and push; auto-update
   installs the previous version again. Earlier versions stay in
   `~/.claude/plugins/cache/orchestrate/orchestrate/`.
3. Data: v0.13.0 only adds files — `~/.claude/orchestrate/context/`,
   `~/.claude/orchestrate/workers/`, and a `policy` key in `profile.json`.
   Older versions ignore all three, and deleting them is safe.
4. A script install: rerun the old version's `scripts/install.mjs`; it replaces
   this plugin's hook entries by script name instead of stacking them, but it
   does not know `context-check.mjs`, so delete that one entry by hand.

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

`--tree` covers the whole session: the lead, every helper, helpers started by
helpers, the models that actually ran, how large each request's context was,
retries, and Codex worker runs and hand-offs. Each model call is counted once
even when the host wrote it several times. On one real session it showed a
built-in helper that made 274 calls, reached 683k context and started six helpers
of its own. List-price dollars are not what a subscription bills, and no script
here turns them into a percentage of your plan.
The efficiency claims in this repo
stay estimates until you run this on a real orchestration; the script exists so
that costs nothing.

Each agent's row also says how much it read and searched before its first edit,
and how many tokens later steps spent re-reading that. Across 81 helpers on one
machine, that finding-the-way came to about a fifth of everything they read:
16% for implementers, 35% for read-only helpers.

## Give helpers a map of the repo

```bash
node ~/.claude/skills/orchestrate/scripts/map.mjs build
```

A helper starts knowing nothing about the repo, so it searches, and everything
it reads stays in its memory for the rest of its work. The map is a short page
it reads first instead: the folders and what each is for, the most-used files,
the entry points, the check commands, and which tests cover which file. It is
written to `.orchestrator/map/`, which git is told to ignore. Starting a run
builds it, and any question to it rebuilds it after a new commit, rescanning only
changed files. On this repo that takes a fraction of a second.

It answers three questions in a line each: `who-uses <file or function>`,
`deps <file>` and `tests-for <files>`. Briefs for helpers and Codex workers point
at it. It finds imports by reading the text, for JavaScript, TypeScript, Python,
Rust and Go, so it misses imports built at run time and macros. It is a starting
point, and helpers still read the code before relying on it. A language-server
plugin (see "Plugins that make it better") gives exact answers where one is
installed.

Graphify and similar code-graph tools are not needed and not installed. Their
own hooks and instructions get re-read on every step. The one independent
measurement found showed a graph agent answering slightly worse than plain
searching, while using about a tenth of the tokens.

## Report a problem

```bash
node ~/.claude/skills/orchestrate/scripts/diagnose.mjs
```

One snapshot of how orchestrate sees this machine and this session: the
version in this copy and the installed one, the host and engine version it
detected, the policy in force, which hooks your settings file registers, the
context report, the agent-tree meter, Codex's login state and live workers,
whether a fresh Claude usage snapshot exists, and the code tools: whether the repo
map is fresh, which language servers are ready, and which of the repo's
languages have none. It reads only; it changes no
settings and no stored readings. Your home folder is written as `~`, and it
holds no credentials, emails, prompts or file contents, so the output can be
pasted into an issue as it is. `--session <id>` or a transcript path picks
another session, `--no-codex` skips asking Codex, and `--json` gives the same
as JSON for a before/after comparison.

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
own.** Codex is optional (below).

## Codex workers (optional)

If Codex is installed and signed in with ChatGPT, the lead can send bounded
coding work and independent reviews to it, so Claude's usage goes to leading:

```bash
node skills/orchestrate/scripts/codex-worker.mjs status
node skills/orchestrate/scripts/codex-worker.mjs run --packet task.md --repo . --role implement
```

- It runs `codex exec` with your saved login — no API key — on the model in
  your Codex config, at medium effort for bounded work and high for hard work
  and reviews.
- Code changes happen in their own git worktree next to the repo; reviews are
  read-only. Codex's own multi-agent features are turned off, and its normal
  sandbox, approvals and repository instructions stay on.
- It stops a worker after 20 minutes and keeps whatever it did.
- It never reads your Codex credentials; it asks `codex login status`.
- If Codex says its usage limit is reached, it stops using Codex for that run,
  keeps the diff, and writes a packet for Claude covering only the unfinished
  part. Sign-in failures, throttling, permission errors, timeouts, bad output
  and failing tests are each reported as what they are. If Claude is also near
  its limit, it saves the checkpoint and says both are unavailable.
- Two workers at once across Claude and Codex, and never both in one worktree.

The CLI is found on `PATH`, or inside the Codex desktop app on Windows, or at
`ORCH_CODEX_BIN`. Turn the lane off with `profile.mjs --policy codex.enabled=false`.

## Codex and the ChatGPT desktop app as a host

The same folder loads from `~/.agents/skills/orchestrate/` and is invoked as
`$orchestrate` or `@orchestrate`. The instructions apply and the plain-speech
rules travel with them. Dispatch there would use Codex's own subagents, which
this version has never run, so treat that host as documentation rather than a
supported path. See `skills/orchestrate/references/hosts.md`.

## Layout

```
skills/orchestrate/
  SKILL.md              the skill (403 body lines; stays in context)
  references/           ladder, routing, evaluation, lanes, hosts, models
  scripts/              router, guard, ledger, turn-check, precompact-check, persist-check,
                        context-check, context, codex-worker, gate, profile, run-init,
                        measure, diagnose, map, install-agents, install-project, batch
  scripts/lib/          context (the one context reader), policy, workers, modes, host,
                        quota, tier, settings, prices, listing, template
  assets/               RUN.md template, packet template, worker report schema, six role
                        agents, the Plain output style
.claude-plugin/          plugin manifest, so /plugin install works
hooks/hooks.json         the global hooks, for the plugin path
evals/                  test prompts for the skill-creator loop
scripts/install.mjs     installs the skill, agents and hooks
scripts/package.mjs     builds the two .skill zips
STATE.md                build progress and resume point
```

## Test it

```bash
node --test $(find skills -name '*.test.mjs')
```

No quota, no network, no dependencies. They cover the router's emission policy
on fixture prompts, the guard's deny path and its refusal to be talked out of it
by a repeat, the ledger's parsing and its attribution of a return to the right
run, the Pickup check, which tasks are ready and which returns are still owed a
grade, gate detection on three fixture repo layouts, the project kit, the
installer's merge against a copy of a real `settings.json`, both package builds,
and the eval file's shape. Since v0.13.0 they also cover the context reader on
fixture transcripts (compaction, retained history, null usage, restored context,
duplicate and half-written records, concurrent sessions, a long-session replay),
the worker rules (nested helpers, Plan mode, concurrency, worktree locks, capped
returns, a replay of the 274-call helper), and the Codex adapter against a fake
Codex CLI (success, usage limit before and after edits, bad output, sign-in
errors, throttling, timeout and the hand-off to Claude). The run prints the
count; anything red is a regression.

## Provenance

The ideas are borrowed and credited in
`docs/borrowed.md`.
