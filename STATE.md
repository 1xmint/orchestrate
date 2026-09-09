# Build state

Resume point for building the `orchestrate` skill.

## v0.7.3 — the wrong-run bug was corrupting ledgers, 2026-09-09

`latestRun` sorted run folders by name. Folders are `<YYYYMMDD>-<slug>`, so that
only orders runs from different days; two opened on the same day fell back to
comparing slugs. It was filed as a small labelling bug. It was not.

Because the ledger writes whichever run it is handed, the reviewer's two returns
for this build were filed into the *closed* `20260909-vibe-coder-audit` run, and
its rows 9-9-0001 and 9-9-0003 were flipped from ✅ done back to 🔍 review with
their attempt counts and evidence overwritten. A closed run silently reopened
with someone else's evidence in it. Both returns have been moved to
`20260909-v07-senior-engineer/returns/` and both rows restored from that run's
own return files.

There were **three** copies of the run sort: `lib/tier.mjs`, and its own in
`profile.mjs`, which kept naming the closed run in the profile line even after
the first fix landed. `profile.mjs` asks `lib/tier.mjs` now, the same way it
already does for the agent count.

Two sorts were tried and both were wrong. By name reproduces the bug. By
modified time hands back whichever run was written last, which is the *same*
wrong run, because the bug itself had just written to it. The fix is the one
signal recorded when a run is opened and never moved afterwards: the
`active-run.json` pointer `run-init` already writes. It wins when it names a run
under the repo being asked about; creation time, then name, breaks any remaining
tie.

## v0.7.2 — the plugin install, which had never worked, 2026-09-09

Josh asked for automatic updates so he would never fall behind. Answering that
meant actually installing the plugin, and the moment anyone did, three defects
surfaced that no test could have caught because none of them exist until a real
host reads the manifest.

1. **There was no marketplace manifest.** The README had told people to run
   `/plugin marketplace add 1xmint/orchestrate` since v0.6.0, and the repo had
   no `.claude-plugin/marketplace.json`. That command could only ever fail. The
   "one-command install" the README calls the short path had never worked for
   anybody, which is also why auto-update was unreachable: there was no
   marketplace to enable it on.
2. **`plugin.json` declared `agents` as a directory string** where the schema
   takes a list of files. `claude plugin validate` rejects the whole manifest
   for it.
3. **`plugin.json` declared `hooks: "./hooks/hooks.json"`.** That file loads
   automatically, so naming it too is a duplicate load and the host refuses the
   entire plugin: "Duplicate hooks file detected". Only a real install shows
   this; validation passes either way.

Then a fourth, caused by fixing the first three: **a plugin install reported
`agents 0/6`.** The host registers the six role agents from the plugin's own
folder and copies nothing into `~/.claude/agents`, and `agentsInstalled()`
counted only loose files. It would have told the model to run
`install-agents.mjs`, creating a second set that shadows the plugin's. It now
looks in both places and says which one it found, and `profile.mjs` no longer
keeps a second copy of that rule.

`claude plugin validate . --strict` passes, the plugin installs and loads, and
187 tests cover all four so none can come back. 0.7.0 and 0.7.1 are tagged but
should not be installed; 0.7.2 is the first release whose plugin actually loads.

### The folder rename could not be done from inside Claude

The worktree failure was diagnosed to its root: the folder on disk is
`C:\Users\Josh\Desktop\Github` with a lowercase h, every Claude session uses
`GitHub`, Windows accepts both, git reports the real one, and the Agent tool
compares the two strings and refuses the worktree. Not a bug in git or in this
skill, and nothing in the skill can fix it.

The rename is blocked while Claude runs: its own filesystem MCP servers are
rooted at that folder (`mcp-server-filesystem C:\Users\Josh\Desktop\GitHub`,
four of them) and hold it open. An attempt was made and failed at step one,
changing nothing. A guarded two-step script for a moment when Claude is closed
is in this session's scratchpad as `fix-github-casing.ps1`; it puts the original
name back if the second step fails.

### What this machine is on now

The script install is gone: `~/.claude/skills/orchestrate`,
`~/.agents/skills/orchestrate`, the six loose `orch-*.md`, and the four
orchestrate hook entries in `settings.json` were all removed, leaving
`memory-write-gate.mjs` untouched. There is one copy now, from the plugin cache.
`extraKnownMarketplaces.orchestrate.autoUpdate` is set to `true` in user
settings; the docs only document that key for managed settings, so whether the
host honours it there is unverified — the `/plugin` Marketplaces tab is the
path that is documented to work.

## v0.7.0 — the senior engineer in the chair, 2026-09-09

Plan: `C:\Users\Josh\.claude\plans\you-are-the-senior-kind-mango.md`, grounded
2026-09-09 against `main @ 019bd5e` and the live docs for the desktop app's
2.1.260. Seven reflexes, each with a mechanism rather than more prose. 148 tests
became 185, green at every commit.

### What changed

**The setup conversation now happens.** `managerAdvice` was computed only on the
card turn, and on a fresh session the card goes out on prompt 1, before any
assistant record exists, so `self` was always null and the advice had never
fired for anybody. It has its own `adviceSent` flag now, fires on the first
prompt where the model is actually visible (prompt 2 on a fresh session), names
the click for the host it is on (`selfModel` reads `entrypoint`), and goes quiet
for good once `profile.mjs --set manager=accept|<model>/<effort>|ask` records the
answer. A tier change re-opens it, because the recommendation changes with the
tier. `--set-default model=… effort=…` writes the two keys into
`~/.claude/settings.json` for new sessions and refuses `max`, which the host does
not accept in either key.

**A question gets a depth call before an answer.** Five rows in `ladder.md`,
keyed on what can be observed about the question rather than on how sure the
model feels: settled, one current fact, inherited across a set, design judgment,
checkable by a command. Rung 3.7 is new in the router, tested last of the
question rungs and gated on `heads === 0`, so neither a research question nor a
build request carrying "or should we use the helper" is taken for a judgment.
The card gained one line and its cap moved from 1,400 to 1,550; the body is 1,546.

**Every claim carries its basis, and two checks say so when it does not.**
- The Plain style gained Anthropic's Opus 5 scope paragraph verbatim, a basis
  rule, and a working-out-loud section that resolves the contradiction research
  0001 found between "say what you are about to do" and "do not narrate". It
  ships `force-for-plugin: true` (Josh's decision), so a plugin install turns the
  voice on and disabling the plugin turns it off. 3,846 bytes against a 4,500 cap.
- SKILL.md §9 shrank to the six rules that survive with the style off, and
  `assets.test.mjs` checks those six against both files.
- The reply check: a `type: "prompt"` Stop hook on Sonnet, prompt in
  `assets/reply-check.txt`, copied verbatim into SKILL.md frontmatter. It reads
  only the reply, so it is a fresh instance that never saw the reasoning behind
  it. `install.mjs --with-reply-check` registers it globally; off by default.
- The floor in `turn-check.mjs`: deterministic, for the one shape a reply-reader
  cannot catch — a set-shaped recommendation answered from fewer than two
  sources, with a recommendation in the reply.

**Money.** `lib/prices.mjs` prices anything in list-price dollars, the unit
`/usage` computes its own Session figure in. The ledger appends every finished
dispatch to `~/.claude/orchestrate/costs.jsonl` (capped at 500 lines) and puts
the figure in the RUN.md evidence cell. The guard tags every dispatch before it
runs. `profile.mjs --brief` prints what roles have cost here;
`measure.mjs --dollars` prices a finished session. The thresholds are 5% of a
week to say it and 25% to ask, in `routing.md`. No counter anywhere.

**Also**: a `Shape` line on every run (tasks, parallelism, models, price, why not
smaller); one bounded interview round before a goal larger than a sitting; the
router deduped on prompt id *and* text so a mid-turn message is not dropped;
`docs/research/0004-loops-and-stopping.md` in the repo with its findings folded
into `evaluation.md` §6 and §9, `lanes.md` and `models.md`.

### Measured, not assumed

| What | Number | How |
|---|---|---|
| the floor, unnarrowed | 5.57 fires a day | `turn-check.mjs --replay-week` over 51 transcripts |
| the floor, as shipped | 0.14 a day (1 in 7 days) | the same, and the single fire is the exact 0003 question |
| the card body | 1,546 chars | asserted at 1,550 |
| the Plain style | 3,846 bytes | asserted at 4,500 |
| this build session | $42.56 at list price, ~28% of a Max 5x week | `measure.mjs --latest --dollars` |
| tests | 185 | `node --test "skills/orchestrate/scripts/**/*.test.mjs"` |

The floor's narrowing is worth recording because the first version would have
been unshippable. `research && setShape` alone fired on pasted plans and handoff
documents: long text containing "recommended" and "for each", answered with a
"should". Three narrowings fixed it — it must be a question, not a paste, under
60 words, and not a host notification — and the 0003 case still fires.

### Facts settled by probe, not assumed

- **Skill frontmatter accepts `prompt` hooks.** The hooks doc's "Hooks in skills
  and agents" says all hook events are supported there and all five types;
  agent *files* are the ones limited to command and http. So the reply check
  ships session-scoped from SKILL.md rather than global-only.
- **Hook output is an `attachment` record**, not user-role text:
  `{"type":"attachment","attachment":{"hookEvent":"…","content":["…"]}}`. A
  mid-turn message is `{"type":"attachment","attachment":{"type":"queued_command",
  "prompt":"…"}}`. `measure.mjs` read only user records and so reported **0
  router injections on a transcript holding 4**. Fixed, with a test.
- **The transcript shape of a *blocked* Stop was not observed.** No main-session
  transcript on this machine holds one. Both counters therefore match a fixed
  prefix at the start of a record, not a record shape. They also had to be
  tightened: matching the prefix anywhere counted this plan document, which
  quotes both reasons verbatim, as two blocks that never happened.

### The over-verification audit (plan step 3d)

Grepped every shipped text for `double-check|re-verify|verify your|check again|
make sure|be thorough|to be safe`. **Two hits, zero removals.** Both already
argue against over-verification: `evaluation.md` citing the Opus 5 guidance, and
the new `ladder.md` row telling the model not to re-verify what is settled. The
skill was already clean of the pattern; the audit is recorded so nobody re-runs it.

### What is still reasoned rather than measured

- Every price in the `models.md` starting table, and every week anchor. The week
  rests on **one observation** and is labelled that way everywhere it is printed.
  `profile.mjs --set week=<dollars>` replaces it with a real one.
- `high` rather than `xhigh` for the manager. Unchanged from v0.6.0, still
  reasoning, still marked as reasoning.
- The 5% and 25% thresholds. Judgment, chosen so the first fires often enough to
  be informative and the second rarely enough not to nag.
- The reply check's block rate. It ships in orchestrate sessions first for
  exactly this reason: nobody has measured how often a Sonnet reader asks for a
  basis that was already there. Global after one measured week under one block a
  day (Josh's decision 2, §8 of the plan).
- **The field verdict of `docs/research/0001` was not re-tested.** It said
  orchestrate was not the best drop-in a vibe coder could install that day. The
  plugin path closed one of its two gaps in v0.6.0; the other was "has never run
  its own loop", and this build is one session of one person, not a customer's run.

### What the review caught (task 9-9-0003, Opus, FAIL)

Three code findings, all applied. Worth recording because the first was the
release's own rule turned into its opposite, and no test I wrote had caught it:

1. **Rung 3.7 was tested before 3.6 and 3.5**, so a judgment word — the
   commonest way to *phrase* a research question — stole both. "which model
   should we use for each tier?" came back as an opinion instead of a
   researcher dispatch, and that clause is literally what the `setShape` regex
   was written to catch. The root cause went one level deeper than the order:
   rung 3.6 required a *research* word as well as the set shape, so that
   question could never have reached it. 3.6 now takes a research word **or** a
   judgment word, 3.7 is tested last, and the floor uses the same test so the
   hint and the block cannot disagree. Re-measured after widening: still 0.14
   fires a day.
2. **The week share printed a bare percentage.** `weekDollars` carried the "one
   observation" label but nothing printed it, so the guard's price tag and
   `measure.mjs` both showed a hard percentage against an anecdote —
   confident-and-unfounded, which is the shape this release exists to stop.
   `weekShare` now carries the basis every time it prints.
3. **`--set-default model=max` threw a raw stack trace** after writing a stray
   backup. Both keys are checked before the backup is taken.

A fourth finding was recorded and not treated as a blocker: the evaluator sees
only the reply, so a correct short answer drawn from a file read earlier in the
same turn ("what's our retry limit?" → "Three.") has no basis in its own text
and would be sent back. Inside orchestrate the Plain style forces a basis line
and covers it. Globally it does not, which is the reason the global
registration ships off by default until a week of it has been measured.

### Found while building, not fixed here

- **`latestRun` picks the alphabetically last run folder, not the newest.** Two
  runs created on the same day are ordered by slug, so `20260909-v07-senior-engineer`
  lost to `20260909-vibe-coder-audit` and every hook pointed at the older one all
  build. Filed as its own task; the fix is to sort by RUN.md mtime.
- **Worktree isolation refuses in this checkout.** `git` resolves the repo path
  with different casing (`Github` vs `GitHub`), so the Agent tool rejects the
  worktree as a `core.worktree` redirect. That is why the one planned
  `orch-implementer` dispatch for the floor was done inline instead.

### Deliberately not built, with the reason

A Haiku pre-classifier on `UserPromptSubmit` (still returns only ok/reason). A
spend cap or a running counter (v0.5.0's reasoning stands: a counter reads as an
allowance). Skill-frontmatter `model`/`effort` for the manager (it lasts one turn
and thrashes the prompt cache). An agent-type hook as the default reply check
(the host calls agent hooks experimental; the prompt hook is the production
shape and the agent hook, which could also read the turn's transcript and judge
whether the reply answered what was asked, is the upgrade path the day that
label goes). A rewrite of SKILL.md into a next-action loop (more instructions
lower compliance — research 0003). Re-running the field audit (quota).

## v0.4.0 — 2026-09-09, complete

Plan: `C:\Users\Josh\.claude\plans\i-want-you-to-eager-boole.md` (grounded
2026-09-08 against Claude Code 2.1.266 docs; the desktop app runs 2.1.260).
Step numbers below are its section 8.

| step | what | status |
|---|---|---|
| 1 | reference drift fixes; `ladder.md`; `lanes.md` | done, 60beeaa |
| 2 | `router.mjs` + `lib/tier.mjs` + tests; `install.mjs --with-router/--with-hook` with merge, dedupe by basename, backup, `{{SKILL_DIR}}` templating | done, 36b0f60 + 6ec6d87 |
| 3 | `guard-agent.mjs` v2 (downgrade, not deny), `ledger.mjs` (SubagentStop), `return-check.mjs`, `turn-check.mjs`; agent files gain `hooks:` and, on two roles, `memory: user` | done, a6f54dd |
| 4 | `profile.mjs --brief` with a 24 h provider cache and the skills line; `gate.mjs`; `run-init.mjs` prefills the GATE block; SKILL.md v0.4; the who-reviews rule; the manager's own model in the router | done, 4f5dee4 |
| 5 | `install.mjs --project` (gate.json, exclude, a 12-line rules file, the `@AGENTS.md` fix) + fixture tests + one `--dry-run` on notelocus | done, b8ec326 |
| 6 | `measure.mjs`, `router.mjs --cost`, the loading checklist in the README | done, 26ac889 |
| 7 | `package.mjs --spec`, README, version 0.4.0, STATE, HANDOFF, tag | done |

Proof, all at zero model quota:

- The unit suite, `node --test "skills/orchestrate/scripts/**/*.test.mjs"`, green at every commit (98 at the v0.4.0 tag, 124 after the audit pass).
- The installer's merge run against a copy of the real `~/.claude/settings.json`
  in the test suite, and then for real: the `memory-write-gate.mjs` entry is
  untouched, every non-hook key is identical, and a backup exists under
  `~/.claude/orchestrate/`.
- The installed router answered a live payload with the card and the correct
  `/orchestrate` hint.
- `measure.mjs` run on a real transcript of this build session.
- `install.mjs --project --dry-run` on the real notelocus checkout: it reports
  the pytest and ruff gate and the missing `CLAUDE.md`, and writes nothing.

## v0.6.0 — a plugin, model intelligence, and the question that started it, 2026-09-09

Three Fable rounds ran, and Josh was right that it should have been one. Their
findings, applied. The token cost was 668,057 across the three.

**The verdict on the product.** Not the best drop-in for a vibe coder today, and
the reason was the install: a terminal, git, Node and a hand-edited settings.json
against a competitor installed from the desktop plugin browser in one click. The
repo is a Claude Code plugin now and needed no files moved. One token,
`${CLAUDE_PLUGIN_ROOT}/skills/orchestrate`, serves both paths: a plugin host
expands it, `install.mjs` replaces it. The plugin path runs plain `node` and so
needs it on PATH; the script path still pins the interpreter, and the README
says which to use when.

**Model intelligence, which was missing entirely.** `routing.md` had a lookup
table, not reasoning. `references/models.md` now carries what each of the four
models is for, the five effort levels and what lower effort does to output
shape, four ordered tests for never going overkill, and context sweet spots. Two
facts in it were written down nowhere and change behaviour: Haiku's window is
200K, a fifth of the others, so a sweep that fits anywhere else can overflow it
silently; and effort does not work on Haiku at all, so it is the one model that
cannot be asked to think harder.

**The manager's own setup.** It cannot set its own model or effort, because the
user picks both before the conversation exists. So the router compares them
against the plan and says the fix once, then never again: silent when right,
silent when it cannot tell, and `xhigh` tolerated while `max` is called the
worker profile. Pro is Sonnet at high; both Max tiers are Opus at high. Not
`xhigh`, which is documented for long single agentic tasks, and never Fable,
whose cost multiplied across a hundred manager turns buys nothing.

**Why the manager answered too fast.** Root cause was compliance with detection
dead three ways: the question arrived mid-turn and the router never saw it; the
prompt-id guard would have dropped it anyway; and "also is there…" has no
question mark, so it read as a statement. All three fixed, and a research
question that spans a set of cases is now its own rung whose hint says dispatch,
because "fetch one source if it settles it" hands the depth call to the model,
which is the judgment models are worst at. `ladder.md` carries the three-part
test. A Stop-time gate was designed and not built: its false-positive rate is
unmeasured, and a gate that fires on ordinary questions trains you to ignore it.

**Over-verification**, which the audit caught: SKILL.md sent every gate run to a
subagent while `evaluation.md` said filter first, and the subagent version also
contradicts Anthropic's Opus 5 guidance. The manager runs the gate itself now
and delegates when the output is long or the suite is slow. Two reviewers became
one, with a second only when the first verdict is itself in doubt.

Also fixed, both found by using the thing: the ledger filed twenty-one of the
orchestrator's own messages as agent returns, because `agent_id` alone was
accepted as proof a subagent had returned; and `router.mjs` read stdin at import
time, so importing it hung and every test of it had to spawn a child.

148 tests. `docs/research/0001`, `0002` and `0003` hold the full findings with
every URL dated.

## v0.5.1 — how to talk, moved where it binds, 2026-09-09

Josh, on the section v0.5.0 added: it could be better, especially "never call
something remaining work", "don't print a number you can't act on" and "say it
once". He was right. Those were prohibitions with no test inside them, so they
read as agreeable and change nothing.

A research round moved the whole thing. Claude Code has **output styles**: a
markdown file with frontmatter that is added to the system prompt itself and
re-stated during the conversation, applying to every turn of every session
rather than only while a skill is loaded. It also ships a built-in **Concise**
style (v2.1.237+) that leads with the result and drops the narration, which is
most of Josh's complaint, free, and worth trying first.

`assets/output-styles/plain.md` now carries the rules, is copied to
`~/.claude/output-styles/` by the installer, and is deliberately left switched
off: selecting a style changes every session the user has, so it is theirs to
turn on. `keep-coding-instructions: true` keeps Claude Code's engineering
instructions, so it changes how Josh is spoken to and nothing about how the work
is done. `SKILL.md` §9 states the same rules for when the style is off and for
hosts like Codex that have none; a test asserts the two agree.

Every rule now contains its own test. Three came from the research rather than
from taste: name a technical term once and reuse it, because stripping it out
leaves the reader unable to read anyone else on the subject; draw comparisons
from everyday life rather than from other technology; and carry the proof with
every claim, because the 2025 study of professional agent users found that
developers reject narrative summaries and verify instead. Brevity never applies
to an error, a warning, or a confirmation before something irreversible.

Sources: code.claude.com/docs/en/output-styles, nngroup.com on plain language
for experts, arxiv 2512.14012 on professional agent use.

## v0.5.0 — the manager judges the model, 2026-09-09

Josh: "a hard cap on fable helpers doesnt make any sense... id rather have the
manager judge what is appropriate." He is right, and the repo already held the
admission: `routing.md` said dispatch counts are a poor proxy for tokens while
`guard-agent.mjs` counted dispatches anyway.

**The cap is gone, not raised.** No number replaces it. The guard keeps two
jobs, deny a credential and record a dispatch, and has no opinion about which
model a task deserves. Deleted with the cap: the caps table, the daily counter
file, the opt-in file and its flag, the `updatedInput` downgrade, and the spend
total from both the router card and the profile line. A running total is the
cap in another costume. `measure.mjs` reports what a finished run cost, which
is a fact rather than a budget.

**What replaces it is judgment with the facts in front of it.** `routing.md`
gains "Choosing the model, and when the choice is the user's": pick the model
the task needs, then check whether this plan includes it. Included, dispatch.
Not included, it is the user's money and their call, so recommend it, price it,
offer the alternatives, and let them choose. There is a worked example in the
shape of the $20 case. Neither failure is allowed: no quiet downgrade to dodge
asking, no quiet spending to dodge asking. "When Fable earns its cost" gives
the judgment its criteria. The rule holds for a plan tier that does not exist
yet.

**SKILL.md §9, how to talk to the user.** Josh has had to ask for a plain
explanation several times, including in the session that built v0.4.1, whose
report listed four "open items" that were not work and a counter he could not
act on. Every line of the new section is a rule somebody had to ask for out
loud: answer the question first, one idea per sentence, nothing is "remaining
work" unless the user must do something, no number they cannot act on, say it
once, explain rather than define. Explaining to someone fifteen and sharp is
the default, not a mode.

Three tests hold the line: the guard returns only pass or deny on every tier
and model, no shipped file states a numeric Fable allowance, and the skill
still tells the manager to ask. 136 pass.

## v0.4.1 — the fresh-context Fable audit, 2026-09-09

The one step the v0.3 plan reserved and the v0.4 plan deferred: run
`references/audit-prompt.md` as a Fable subagent against the built skill, apply
what survives. The prompt was refreshed for v0.4 first, because it still
described v0.3 and would have sent the auditor after the wrong artifact.

Dispatch: `orch-reviewer` on Fable, one of three Fable dispatches allowed today,
recorded by the guard and by `.orchestrator/runs/20260909-fable-audit/RUN.md`.

That dispatch is also the first real end-to-end proof of the hooks. The guard
counted it and wrote the session state; the return check, the resume injection
and the deny path were exercised live against the installed copy.

### Six defects found while the audit ran

Each proved on disk before it was fixed, each with the test that would have
caught it:

| # | Defect | Why it mattered |
|---|---|---|
| A | `ledger.mjs` had no dedupe, and the recommended install registers it twice | one dispatch wrote two return files and counted as two attempts |
| B | `profile.mjs` read the Fable counter by UTC date; the guard writes it by local date | "fable 0/3 today" for four hours every evening while the cap was spent |
| C | `install-project.mjs` recursed with an unchanged argument to reach its line budget | unreachable today, a non-terminating loop the moment the fixed part grows |
| D | a half-filled Pickup leaked the template into the resume line | "confidence high \| medium \| low" injected into a resumed session |
| E | `evals/evals.json` was not valid JSON | the eval loop could never have loaded it; "never run" had a second cause |
| F | `router.mjs --cost` had its own transcript parser and counted tool results | it reported six router injections where the meter correctly reported none |

### The audit's own twelve, all resolved

Verdict: **ship-with-fixes**. Its first finding was the one that mattered and
neither of us had seen it: every hook resolved the run from the session's cwd,
and Josh's sessions start in the folder that *contains* his repos, so the whole
mechanical layer was silently inert there. `run-init` now records the run under
`~/.claude/orchestrate` and every reader falls back to that pointer; a repo with
its own runs is never overridden. Proved live from the parent directory.

| # | Finding | Resolution |
|---|---|---|
| 1 | hooks blind when cwd is above the repo | active-run pointer, tested both ways |
| 2 | the return check's budget keyed on the role, not the invocation | keys on `agent_id`, old keys pruned |
| 3 | the reviewer's instructions and its own Stop hook demanded different shapes | one schema everywhere, `VERDICT` carries pass or fail |
| 4 | four credential shapes unknown; Fable spent by inheritance; the deny message handed over the opt-in command | all three fixed |
| 5 | attempts bumped per stop; `updateRow` split on every pipe | cells addressed from the ends; identity required |
| 6 | `risky` drove both "ask first" and "needs a reviewer" | split into two regexes |
| 7 | bare filenames not counted as paths; "continue" dropped before the resume rule | both fixed |
| 8 | `when_to_use` hijacked release notes and dev servers | rewritten |
| 9 | bare `node` fails in a GUI-launched app | the installer writes the interpreter's absolute path |
| 10 | no `PARALLEL` field; a false claim about where a downgrade is visible | field added; the ledger records the model actually used |
| 11 | every dispatch pulled 11 KB of `contracts.md` to copy a 4 KB template | `assets/packet.md` |
| 12 | the SubagentStop payload was documented, never observed | observed and recorded in `hosts.md` |

One claim of its own was wrong: it said this very return would never be saved.
The ledger saved it and moved the row, because the stop's `cwd` was the repo
even though the session's was not. Its line numbers had also moved, because the
checkout advanced while it read.

Tests went from 98 to 136, and the two scripts that had no coverage at all,
`run-init.mjs` and `install-agents.mjs`, now have theirs. `smoke.mjs` stays
untested on purpose: it exists to spend a little provider quota, so a test
would spend quota on every run.

One plan item is declined rather than built: the optional PreToolUse(Bash)
filter that would append a failures-only tail to test runners. Appending a pipe
replaces the runner's exit status with the filter's, so a failing gate would
read as passing; rewriting a user's shell command to save a few hundred tokens
is not worth that failure mode. `evaluation.md` §2 already has the orchestrator
write the filter itself, in the command it runs.

### Left for Josh

1. **The five loading checks** in the README, in one fresh desktop session.
   They need a session this build cannot open, and they are the only claims in
   the README that a test does not already cover.
2. **A real orchestration**, then `measure.mjs --latest`. Until then the
   efficiency numbers in the plan's section 2a are reasoned estimates from
   documented figures, not measurements. The script is ready and free.
3. **`subagent_type: fork`** is documented but absent from this session's agent
   list. `lanes.md` marks the fork rung "documented, unverified here". One
   one-line haiku dispatch would settle it.
4. **Dynamic workflows** are not exposed as a tool here, so the skill hands
   Josh the one-line prompt to type. Re-check after a desktop update.

### Not built, on purpose

The Haiku per-turn classifier (Josh chose off; the mechanism does not exist:
a `type: prompt` hook on `UserPromptSubmit` can only return ok/reason).
Baseline-versus-skill metered sessions, the skill-creator eval loop, and a
dogfood goal: Josh's own use is the dogfood.

## v0.3.0 and earlier — 2026-09-08

Repo skeleton, references, six role agents, the RUN.md template, the first
scripts, SKILL.md, a cold-reader pass (15 findings applied) and a
fresh-context Fable audit (17 findings, the mechanical ones applied).
Deliberately not applied then: a per-run absolute Fable cap (a per-day cap in
the hook replaced it), moving the task table out of RUN.md, and marking every
host assumption unverified line by line.

Pickup prompt: v0.6.0 is tagged. Nothing is open. Two things are unverified
because they need a fresh session: whether the plugin actually installs from
the marketplace, and whether the router card appears on a first prompt.
Pickup confidence: high
Resume risk: none
