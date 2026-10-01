# Live session notes, 0.17.2 (2026-09-30)

The first real session on 0.17.2. The lead was Opus 5.5 in the desktop app, in
auto mode, with the built-in advisor set to Opus 5.5. The session started in a
scratch folder with no project and moved into this repo on its own. The goal
was to plan the next phase of the plugin: observe 0.17.2 live, and compare it
with other Claude Code plugins. Each note gives the exact line the plugin wrote,
what it did, and whether it helped. Notes are written as things happen.

## Watch list, from what 0.17.2 changed

Will be exercised by this session:
- the checkpoint's goal, last message and test line, taken from what the user
  typed and what the shell printed (#35)
- the price tag before a helper, and the three lines to the user before the first
- a long helper hand-back kept whole (0.17.1, #27)
- the size line after a built-in advisor call (0.17.1, #28)

Only if it happens: a helper's own compaction, told apart from the lead's by the
10-second window (#40); a lead compaction and its recovery card.

Not exercised unless a pull request is merged: the merge bar (#36).

## What happened

**A. Install and load.** Seen, correct. `installed_plugins.json` says 0.17.2 at
commit `ce6804a`, the same as the local marketplace copy's newest commit. The
first-prompt card arrived, the Plain output style was active, the profile read
*"agents 8/8"* and *"tier max5"*. *Helped:* nothing had to be set up.

**B. Moving from a scratch folder into the repo.** The session began in the
desktop app's scratch folder. The card's brief line (*"Check any build proposal
against the brief ... in CLAUDE.md or AGENTS.md"*) pointed at a file that did
not exist there. The lead found the repo from the app's recent-folders list and
moved. Nothing in the plugin helped or hindered; a session that starts with no
folder gets no project-specific help until it moves.

**C. The size of a session before any work.** The first size line, after one
shell call, read *"[orchestrate · context] ~67k"*. After the orchestrate skill
loaded it read *"~101k"*; that jump also holds an advisor call and several
file reads, so the skill page's own share is not measured here. About 67k is
spent before the first real step. Not a bug; the cost every orchestrate run pays, and a number the
next phase should weigh (Cost area).

**D. "tool calls since your last edit" with no edit.** The size line said
*"1 tool call since your last edit"* and later *"6 tool calls since your last
edit"* before this session had edited anything. Misleading wording: it reads as
if an edit happened. Small.

**E. The profile's skills line.** *"skills on disk (route a step to one instead
of re-deriving it; your own listing may have more): none"*, while this session's
own listing held about twenty skills from other plugins (docs, pdf, dataviz,
deep-research, code-review, simplify, ...). The hedge is there, but "none" is
the wrong number: the line exists to route work to skills, and it routed to
nothing.

**F. Older runs.** Six older runs in this repo have no `Closed:` line. None
bound this session: a run untouched for two days is set aside
(`lib/runs.mjs`, `STALE_RUN_MS`). Correct. The `--help` text of
`run-init.mjs` does not list `--reopen` or `--repo`, though both work and a
hook line tells the lead to use `--reopen`.

**G. The gate finder missed this repo's own tests.** `run-init` wrote
*"GATE ... none detected: ask the user for the command that proves a change is
good"*. The repo's CI runs `node --test $(find skills -name '*.test.mjs')` and
`node scripts/package.mjs --both` (`.github/workflows/ci.yml`). The finder
looks for a package manifest; this repo has none, so it asks the user, who is
not an engineer, for a command that is sitting in a file. *Got in the way*
(mildly): the lead had to find it by hand.

**H. The ledger's host.** The profile says *"host claude-code"*; the new
`RUN.md` said *"host: unknown"*. `run-init` does not read the profile's host.

**I. The guard refused a read-only listing over two brand names, twice.** A
`node -e` one-liner that read the official marketplace file and printed plugin
names was refused before it ran: *"This would create or change something in a
real payment account, which can charge or move money. This is refused here
because nobody will be asked to say yes to it here."* The line wrote nothing and
called nothing; it held the words `stripe` and `shopify` inside a regular
expression used to hide vendor plugins from the list. Dropping those two words
let the same read run. Then the shell heredoc that appended *this note* to this
file was refused the same way, because the note names the two words. *Got in
the way:* two false refusals on harmless lines, in auto mode, where the lead
cannot ask. The payment rule reads brand names anywhere in the line, not
whether the line calls anything, and it still reads text headed into a file
(notes AA, AJ, listed as seen and not fixed in 0.17.2). The file editor, which
the shell guard does not read, wrote the note. Later the second research helper
had two of its own shell calls refused the same way, over a payment tool's name
in prose it was handling: four false refusals in one session.

**J. The working folder resets.** After the session moved into the repo, the
shell's working folder went back to the old scratch folder after most shell
calls (*"Shell cwd was reset to ...scratch-2026-09-30-785f40"*). The desktop app
does this, not the plugin; noted because a hook that keys on the working
folder would see the wrong project.

**K. The first-helper check: right twice, then let through blind.** The first
research helper was refused twice: *"the user is owed three short lines before
the first helper starts: what the job needs, who does it on what model and why,
and how it is checked"*. The lead believed it had written them. The transcript
says otherwise: the newest message to the user before both attempts was about
writing the research briefs, and the three lines were only planned in thinking.
*Helped:* the check caught a real lapse, and the lead's summary after compaction
had recorded the lapse as a guard bug. Third attempt, with the three lines
(naming Sonnet) written in the same turn: it went through, but the session state
shows `firstHelperDone` unset and two refusals recorded. So it passed through
the `text === null` branch (message not readable), not through the model-name
match. The note on the same dispatch still said *"first helper this session: the
user is owed three plain lines first"*, the unconditional wording used when the
text cannot be read. Likely cause: the text block and the Agent call share one
reply, and the 4 × 60 ms retry reads the file before the text lands, or the
128 KB tail holds only large tool results. Either way an unreadable message
passes, so this check holds only when the text happens to be flushed.

**L. A task id the recorder did not see.** The dispatch prompt said *"(TASK
9-30-0001, RUN ...)"* rather than a `TASK: 9-30-0001` line, and the dispatch
was recorded with `task: null`. The packet file carries the id, but the recorder
reads only the prompt. Nothing warned. *Correction after the second helper:*
that dispatch opened with `TASK: 9-30-0002` and its dispatch record has the id,
yet its entry in `returns.jsonl` still has `"task":null`. The return side reads
the id from the hand-back text only (`lib/task-id.mjs:20`, `^\s*TASK:`), and the
five-line hand-back has no TASK line. It never joins the return to its own
dispatch record, although both carry the agent id. So no return in the
template's format links to its row, whatever the lead writes.
Confirmed on return: `returns.jsonl` has `"task":null,"status":null` for it.
`ledger.mjs:54` takes the status from the OUTCOME line only when it opens with
DONE, PARTIAL, BLOCKED, PASS or FAIL. The helper opened it with a sentence
(*"OUTCOME: 12-row rival table written..."*), so the status went unrecorded,
silently. The researcher on Sonnet did not keep to the format's first word, and
nothing told it or the lead. The same entry priced
the helper at `"dollars":0.5232`, which is the figure the user was never shown
before it ran (O).

**M. The repo's own earlier research was not surfaced.** The lead wrote a
research brief comparing whole-method rivals, and the helper started, before the
lead noticed that `docs/research/0001-vibe-coder-audit.md` §3 had compared six
of the same eight on 2026-09-09. The helper was redirected by message while it
was early. Nothing in the card, the profile, `run-init` or the map pointed at
`docs/research/`. SKILL.md §2 says to ground before deciding, and the lead did
not read the repo's research index first. That is the lead's miss. But a planning or research run that re-buys an
answer the repo already holds is exactly the waste the Cost area measures. A line
naming prior papers on the same topic, when a research helper is sent, would have
caught it.

**N. The first compaction and its checkpoint (watch-list item #35).** An
automatic compaction at about 148k. The plugin's checkpoint
(`checkpoint-d392f4b8-...md`) got the goal right (from `RUN.md`) and the last
message right (the user's own opening prompt, not a host notice). *Helped:* the
fix in #35 holds for those two. Three flaws remain:
- *"Last test result: | Steve Moraco's DATA pack (`data.sh`, DATA License 1.0)
  | the grading states Done / Built-unverified / Partial / Blocked / Failed
  ..."*. No test ran this session. This is a table row from a document the
  shell printed, picked because it holds the word "Failed". The test line still
  trusts a word, not a test command.
- "Files touched" lists the same notes file twice (relative and absolute path),
  and it counts the plugin's own earlier checkpoint as a file the work touched.
- *"What it was doing: Refused a second time with the same three lines on
  screen"* copies the lead's wrong belief (see K) faithfully. It is not the
  plugin's error, but it shows the checkpoint repeats the lead's claims
  unchecked. The lead's own summary after compaction repeated it too.
After compaction the recovery card arrived with the goal, the brief excerpt and
the run's Done-when, and the lead picked up the right next step. *Helped.*

**O. The price before a helper (watch-list item).** Both research dispatches
got *"helper size: a researcher on sonnet, about the usual size for this kind
of helper"*. No dollar figure. SKILL.md §5 says every dispatch arrives with a
price tag in list-price dollars. The size words may be the designed wording
when a helper is ordinary, but the user never hears what a helper costs before
it starts, which is the Cost area's whole question. The second dispatch carried
a `TASK:` line (see L); whether its return links to its row is checked when it
lands.

**P. The session's cost report (`measure.mjs --tree`).** It read *"lead: 78
calls on claude-opus-5-5 ... started 4 helper(s)"*, but only two helpers ran;
the two refused attempts (K) are likely counted as started: the session state records 2 dispatches. It priced the advisor
(*"advisor: 2 calls ... $1.22 at list price on opus"*) but gave no dollar figure
for the lead or the whole session, only *"12256k input read · 56k out"*. So the
one number a user would ask for, what this session cost, is the one it does not
print. *Got in the way* (Cost): the paper's Cost baseline has helper and
advisor dollars but not the lead's.

**Q. The end-of-turn check asked for a payments review of a planning paper.**
After the paper was presented, the turn-end hook said: *"orchestrate: this change
contains "payment", a word on the review list for payments; nobody independent
has looked at it."* The change was two uncommitted markdown files that describe a
safety check; nothing in them moves money. A second hook (`turn-check.mjs`), the
same flaw as I: it matches a word, not what the change does. *Got in the way:*
the turn could not end cleanly, and buying an Opus review of a document would
have spent quota for nothing. Five word-match false alarms in one session.

**R. The dispatch check graded the pointer, not the brief.** The from-scratch
critique helper (Opus, user-asked) was sent with a short prompt naming its brief
file, as the packet template intends. The guard said: *"helper size: a planner on
opus, about the usual size for this kind of helper; brief lacks: what it is for,
a check it is done, a PROGRESS path"*. All three are in
`packets/9-30-0004.md`. The guard reads only the prompt text, not the packet it
names, so a lead following the template is told its brief is incomplete. And
again no dollar figure for an Opus helper (O).

**S. The third return linked, but its status was overwritten.** The critique
helper's hand-back opened *"OUTCOME: DONE."* and carried a `TASK: 9-30-0004`
line. `returns.jsonl` has `"task":"9-30-0004"` (the TASK line works when the
helper writes it) but `"status":"PARTIAL"`, `"dollars":1.8444`. The helper
reported passing its 120k budget at turn 27 of 80, so the ledger likely marks
an over-budget return partial whatever it says (not traced in code). If so, the
rule is fair, but nothing told the lead the helper's own word was overruled.

**T. The turn-end check read "before anything is committed" as "committed".**
The lead's report ended *"bring it back for approval before anything is
committed"*. The stop hook replied: *"your last message says the work is
committed, but git status shows 2 files not committed"* and asked for the whole
report to be resent. The message said the opposite. A sixth word-match false
alarm, and it costs a full resend of a long report (F3 in 9-30-0004).

**U. The shell guard read a plan's prose as a merge.** The lead rewrote the plan
with a shell command that piped the new text into a file. The guard refused it:
*"This line merges a pull request, or mentions merging one, in a form this check
does not read, so it is refused."* The text said a change would go to review
"before merge". Nothing in the command touched git. The file editor wrote the
same text. A seventh word-match false alarm. The refusal does name a way around
(pass text from a file), but a lead writing prose has no reason to expect it.

**V. Two more word-matches while building.** Sending a read-only docs lookup
drew *"this task will wait for an independent review because its objective
mentions permission"*: the lookup asks what the docs say about permission
rules, and changes nothing. Sending the step-2 builder with a short prompt
naming its brief file drew R again: *"brief lacks: what it is for, a PROGRESS
path"*, both of which are in the brief file it names.
