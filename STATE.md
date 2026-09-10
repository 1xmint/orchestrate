# Build state

Resume point for building the `orchestrate` skill.

## v0.10.0 — manage to a budget, not just work, 2026-09-10

A single "execute the plan" session on this machine burned about 20% of a Max 5x
plan. Measured (`measure.mjs` on session `ea7b6432`): 977 turns, ~18 hours, $276.51
at list price on the lead conversation alone, of which ~84% was the conversation
re-reading its own context every turn (~465M cache-read tokens); another ~$300
across ~20 subagents, implementers averaging $23.60 each. v0.10.0 makes the run
manage itself instead of drifting, structurally (facts and guardrails), not with
more prose — the compliance research in `docs/research/0003` says prose does not
hold under load.

- **Budget of record.** `assets/RUN.md` gains a `## Budget` block with a list-price
  dollar ceiling, seeded by `run-init --budget`; `parseBudget`, `runSpend` and
  `readRun` (in `lib/tier.mjs`) read it and the per-run subagent spend.
- **A spend gate.** `guard-agent.mjs` (`budgetDecision`/`overCeiling`) denies a
  dispatch that would cross the ceiling and asks to raise it or stop. It is a
  PreToolUse deny, so it holds even inside an autonomous `/goal` loop, and it reads
  the live ceiling every time so raising it needs no separate acknowledgement.
- **The readiness signal finally fires.** `router.mjs` shows a run's ready tasks,
  progress and budget even when the session starts above the repo — the reason it
  never showed before (`ctx.run` was null) — and surfaces the missing-`blocks on`-
  column case out loud (`lib/tier.mjs` `edgesMissing`) instead of a silent, empty
  "nothing ready". Proven against the real ledger that hit exactly this.
- **A management heartbeat.** `turn-check.mjs` (`heartbeatDecision`) adds a
  marathon-handoff nudge (~150 turns) and an idle nudge (≥2 tasks unblocked) ahead
  of the existing Pickup check, one block per Stop, by priority.
- **Workers never wait on CI.** The implementer and debugger role files and
  `packet.md` say push and return; the lead reads the async result cheaply.
- **Removed** the resurrected weekly-dollar anchor from `profile.mjs`; the per-run
  Budget ceiling replaces it.
- **CI, at last.** `.github/workflows/ci.yml` runs the offline suite on push and PR
  across Node 18/20/22, gated by one `ci-ok` context, because the marketplace
  auto-updates and a red main would install itself.

Tests: 199 pass (12 new), no network, no quota. Not verified live: whether a Stop
hook can yield a `/goal` loop, `--max-budget-usd` on the desktop app, and
`SendMessage` to a running subagent.


## v0.9.0 — a senior engineer, not a process, 2026-09-09

v0.8.0 cut the instruction down. v0.9.0 removes the machinery that was still
making decisions from the *shape of a message* rather than from the work, and
fixes two defects that could lose or misfile real work.

The rule behind every change: **a hook may hold a fact the model cannot see, or
catch a failure a pattern can genuinely detect. It may not decide how the work
should be done, and it may never spend a model turn to buy a format.**

### Two concrete bugs, fixed

**The credential guard could be bypassed by asking twice.** `guard-agent.mjs`
deduplicated first and decided second, so a packet denied for carrying a
credential, re-sent unchanged within five seconds, was read as "the same
dispatch, already handled" and passed. Re-sending an identical call is exactly
what a model does when a tool call fails. The decision now runs on every
invocation, before anything is deduplicated; only the side effects — the
dispatch record and the price tag — are suppressed for a repeat.

The same file also wrote the first 200 characters of every packet to disk as its
dedupe key. On a packet denied for holding a credential, that wrote the
credential to disk. Event identity is now `session_id` + `tool_use_id` where the
host sends them, and a digest of the whole payload where it does not. Two
packets from the same template no longer collide, two sessions no longer
overwrite each other's single global slot, and denied attempts are recorded
apart from work that actually ran.

**A machine-wide "active run" pointer decided where a return was filed.** When a
session's working directory was not inside a repo, every hook fell back to the
newest run on the machine — which is not the same fact as the run this session
is working on. Observed: a subagent's return filed into a *closed* run in a
different repository, flipping two finished rows back to review.

A run now belongs to the session that opened or claimed it:

- `run-init.mjs --session-id <id>` records the binding when the run is created,
  and `run-init.mjs --bind <RUN.md> --session-id <id>` claims an existing one.
- A packet can carry `RUN:`, and the guard keeps that association on the
  dispatch record.
- The ledger resolves a return from the packet, then the dispatch record, then
  the session binding, then a single unambiguous open run in the current repo.
  Never from the pointer.
- Two open runs in a repo are *candidates*, never a guess.
- A return nothing owns is written to `~/.claude/orchestrate/returns/<session>/`
  and the hook says so, with the command that would bind the right run. Nothing
  is dropped, and nothing is guessed into the wrong ledger.
- Return filenames come from agent and event identity, not from counting the
  files already in the directory, which gave two concurrent returns the same
  number and let the second overwrite the first.

### The router stopped routing

`router.mjs` was a table of regular expressions that read each message, put it
on one of ten rungs, and injected an instruction naming an agent, a research
depth, a reviewer or a permission request. All of that is gone. A pattern in the
wording is not evidence about the work: six files is not a reason to delegate,
"should we" is not a reason to research, and the word "deploy" in a sentence is
not a reason to ask permission for an edit.

What it still does is report what the model cannot see — plan tier, its own
model, installed agents, a family limit hit today, the bound run — and, on
resume or compaction, bring back a bounded excerpt of the run's goal,
constraints, decisions and Pickup line. Then it is quiet until one of those
facts changes. A different wording is not a change of state.

It also no longer tells the user to change their model or effort. That advice
fired unprompted at the start of a session, about the user's own settings.
`models.md` still holds the recommendation, for when they ask.

### Two Stop hooks retired

- **`return-check.mjs` is deleted.** It blocked a subagent from finishing while
  its return lacked a restatement, or ran past 60 lines, or put fields in the
  wrong order. Every trigger was formatting, and every block spent a real model
  turn. In plan mode it spent four on one piece of finished work. Returns are
  now parsed leniently and filed whole; a missing EVIDENCE section makes a task
  unverified, which is a grade, not a re-run.
- **The research floor is gone from `turn-check.mjs`.** It blocked a turn when a
  set-shaped recommendation had been answered from fewer than two source-reading
  calls. Two failed fetches satisfied it. One authoritative document did not.
  Counting requests is not measuring how well something is answered.

The Pickup reminder survives, narrowed to a run this session explicitly bound. A
session doing direct work has no ledger to keep current.

### The ledger stopped writing rows

`ledger.mjs` saves the return, prices it and records the association in
`returns/returns.jsonl`. It no longer edits `RUN.md`: two returns landing
together each read the whole file, changed one row and wrote it back, so the
second erased the first. The lead sets a row when it has read the return, which
is also the only moment anyone has actually judged it.

### Cost stopped inventing numbers

- **No weekly figure.** The "% of your week" on every price tag divided by an
  anchor built from one observation (Pro ~$30, Max 5x ~$150, Max 20x ~$600). A
  percentage computed from that reads like a measurement. Gone, and with it the
  5%/25% thresholds that rested on it. What is left: say a price once, before
  the spend, when it is big enough to change what the user would want.
- **No model, no price.** `family()` used to answer `sonnet` for anything it did
  not recognise, so a dispatch that inherited the session's model was priced as
  the cheap one and reported as measured. Unknown now stays unknown, in the
  guard's tag, in `costs.jsonl` and in `measure.mjs`.

### Smaller interfaces

- **The packet is four fields**: the task and its objective, the context and
  decisions it needs, the scope boundaries, and the evidence that means done.
  Everything else — run, dependencies, worktree, owned files, gate, prior
  attempts — is added only when it applies. "Every field, every time, 'none'
  rather than omitted" made every packet carry a dozen lines that stopped
  nothing on that task.
- **The return is TASK, STATUS, CHANGED, EVIDENCE, NOT VERIFIED**, plus a
  verdict and findings for a review. Older verbose returns still parse.
- **Role agents cannot dispatch.** Enforced with the host's own tool
  restrictions rather than a sentence asking them not to.
- **Role agents no longer pin an effort level.** Planner and debugger were
  `xhigh` and the rest `high`, overriding whatever the user chose for the
  session and spending their quota at it.

### Review is bought, not scheduled

The rule that a manager strictly above the author could read the diff itself,
and otherwise had to dispatch, created reviewers by arithmetic on model names —
a comparison that says nothing about whether a change is risky. Independent
review is now for an authorisation or security boundary, money moving, a
destructive or irreversible data change, a compatibility contract others
consume, or unresolved architectural doubt. The reviewer is given the concrete
risk and the acceptance criteria. Correctness findings decide the verdict;
anything else is optional and must not start a repair loop. A reviewer
disagreeing is no longer a trigger to escalate the author's model.

### The ledger keeps the goal

`RUN.md` gained **Constraints and non-goals** and **Approach** above the task
table, so the four things a resuming session actually needs — the outcome and
why it matters, the evidence that would prove it, what it must respect and is
not doing, and the next deliverable — are in one place. That block is what the
router injects on resume, never the task history.

### The lead can tell a ready task from a blocked one

Josh watched a session sit idle, waiting on one agent, with a finished plan on
the board and a `/goal` loop running: no progress, and quota burning, because an
idle turn in a `/goal` loop still costs a turn.

The cause was a gap between two files. `SKILL.md` told the lead that every task
row carries "what it blocks on" and "the files it owns". The `RUN.md` table had
seven columns and neither of them. The dependency graph was asked for and
dropped, so nothing could answer "what could start right now" and the lead fell
back to the one agent it happened to remember.

- The table gained **`blocks on`** and **`owns`**, both to the left of the free
  text, because everything that reads a row counts from the left and a stray
  pipe in a task description would otherwise shift them.
- `readyTasks()` in `lib/tier.mjs` computes which planned rows have no unlanded
  blocker, from text `readRun()` already parses. No new file read, no new hook.
- The router appends `ready now: <ids>` to the run line it already prints, and
  `stateHash` includes the ready set so the line reprints at the moment a task
  becomes ready. It reports; it never demands. A lead that should wait still can.
- A ledger written before those columns existed has no edges to read, so it
  reports nothing rather than claiming every planned row is ready.

The same line also names **returns that came back and were never graded**, which
closes a gap this release opened. The hook stopped writing rows, so a row is
only right if the lead sets one, and `readyTasks` reads those same rows: a stale
🔨 hides a finished task and everything waiting on it stays invisible. The
router now says how many returns are owed a grade and which, and stops the
moment the row is set. `returnedTasks()` reads the index the ledger already
writes, and `ungradedReturns()` compares it against the rows.

Only `📋` and `🔨` count as ungraded. `◐` and `⛔` are grades the lead chose;
`✅`, `🧱` and `✖` are final.

**This is not a push toward parallelism, and the distinction is the whole
design.** [Anthropic's multi-agent write-up](https://www.anthropic.com/engineering/multi-agent-research-system)
(checked 2026-09-09) warns that "most coding tasks involve fewer truly
parallelizable tasks than research, and LLM agents are not yet great at
coordinating and delegating to other agents in real time", and puts multi-agent
token use at roughly 15x a chat against about 4x for a single agent. Speculative
fan-out on coding work is a bad trade.

What this ships is narrower: the plan already declared these tasks independent,
so starting one is executing a graph rather than guessing at one. Note also that
parallelism is a wall-clock win and not a quota win — the same tokens are spent
either way, and concurrent agents pay slightly more because each re-reads its
own prefix against a five-minute subagent cache. The saving is the idle turns
that stop happening.

### What was measured, and what was not

Measured: 169 unit tests pass, no quota and no network. Both bugs above were
reproduced before the fix, and each is covered by a test that fails against the
old code.

**Not measured: whether any of this makes the model work better.** Nothing here
ran a live model. The claim this release makes is structural — the plugin no
longer creates incentives for work nobody asked for — not behavioural. Passive
measurement from ordinary use (`measure.mjs --latest`) is how that would be
found out, and it has not been run on a v0.9.0 session yet.

### Maintainer rule, now written down

A new permanent hook or instruction needs a concrete failure it prevents, a
reason the existing behaviour cannot cover it, and what it costs on every future
turn. No self-modification, and no growing pile of lessons after every incident:
an instruction that fires on everything to catch one thing costs more than the
thing. It is in `SKILL.md` §10, because that is where it will be read.

## v0.8.0 — cut it down to judgment, 2026-09-09

Josh: we are over-engineering; the manager should ask direct questions and find
out what someone is actually trying to express instead of agreeing with them; it
should feel like a real engineer who tells you what you need to hear; and we are
not taking advantage of Claude's own reasoning, because a manager that saw the
big picture would not need most of this scaffolding.

He was right, and the repo's own research already said so. `docs/research/0003`
found that compliance, not detection, was the failure — the rule existed and was
ignored — and that **adding instructions lowers adherence further**. The response
to that finding had been to add a reply checker, a research floor, a depth-call
table and a money rule.

### The principle

**Keep information the manager cannot derive. Cut instruction that tells a
capable model how to think.**

Information stays: what a plan includes, what the limits mean, what each model
costs, what the host can and cannot do, where the gate comes from, the
failure-class table. Mechanisms stay: the credential guard, the ledger, the
research floor. Instruction goes, and what survives of it is said once.

### What went

- **The reply check.** A second model read every reply and sent the turn back if
  a claim named no evidence. **Zero fires across every session on this machine,
  including 588 turns in one build**, at about half a cent a turn. Certain cost,
  unmeasured benefit, and a model policing a model is the most expensive rung of
  the enforcement ladder. `RETIRED_PROMPTS` in `lib/settings.mjs` removes it from
  anyone who already installed it.
- **`references/contracts.md`, 11.8KB** explaining a 4KB template field by field
  and then restating what each of the six role agents does — while every agent
  file carries its own role rules, where the agent actually reads them. The four
  things it had that the template lacked moved into `assets/packet.md`.
- **`references/borrowed.md` and `references/audit-prompt.md`** left the shipped
  surface for `docs/`. One is attribution for a reader; the other is a
  maintainer's tool that still said "Current for v0.4.0". Neither is instruction.
- **The sermons.** `routing.md` said "pick the smallest model whose chance of a
  first-time-right result clears the bar" three times and carried a 15-line
  worked dialogue for a two-line rule. `evaluation.md` restated `models.md`'s
  verification rule in full rather than pointing at it. `ladder.md` said the
  depth call's third row twice. `SKILL.md` carried `routing.md`'s table.

### What arrived

None of the 105KB told the manager how to *be* with the user. Two rules, in the
output style because that is in the system prompt on every turn:

- **Find out what they actually want.** What they typed is a clue, not the whole
  of it. Ask about the hard part, not the obvious part.
- **Agreement is not a deliverable.** Say the weak thing is weak in the first
  sentence, then say what you would do about it. Never flatter.

Both are in `SPEECH_RULES`, so they are checked against `SKILL.md` and the style
together.

### The numbers

| | before | after |
|---|---|---|
| shipped instruction text | 105,041 bytes | 67,222 bytes |
| files | 11 | 9 |
| tests | 189 | 188 |
| per-turn model calls added by the skill | 1 | 0 |

### What could not be measured, and why

The plan opened with "build the instrument before cutting anything":
`claude plugin eval --ablation with-without` runs the suite with and without the
plugin and reports the delta, which would have answered whether 105KB of
instructions beat plain Claude at all. **It is in early access and refuses on
this account.** The fallback was a manual A/B, six real orchestration runs. Two
things argued against paying for it: a cross-file overlap measurement showed only
**3%** of the prose is duplication, so almost every cut is a judgment call that
three prompts could not settle; and n=3 with a hand-built judge looks rigorous
without being rigorous.

So this cut is not validated by an experiment. It is validated by the principle,
by 188 tests, and by whether the next real run feels better. `HANDOFF.md` already
said the user's own use is the signal that matters more than any test here, and
that is the honest position for this change too.

**The plan's "under 40KB" target was not met, and should not have been.** It was
set before the information-versus-instruction split was measured. Reaching it
would mean deleting `hosts.md` (11KB of host facts a model cannot derive) and the
price tables, which is the opposite of the principle the audit runs on.

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
`docs/audit-prompt.md` as a Fable subagent against the built skill, apply
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
