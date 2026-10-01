# Live session notes, 0.19.0 (2026-10-01)

The first live session on 0.19.0. The lead is Opus 5.5 in the desktop app, with the built-in
advisor on Opus 5.5 and the Plain output style. The session started in a scratch folder with no
project and moved into this repo by itself. The goal: watch how 0.19.0 does, then plan and build
what makes it better for an owner who directs work but does not code, measured against a pasted
description of the ideal agent's personality.

Each note gives the exact line the plugin wrote, what it did, and whether it helped. They are
written as things happen.

## Start checks

- `installed_plugins.json` says 0.19.0, commit `e1db84f`; the loaded folder is
  `~/.claude/plugins/cache/orchestrate/orchestrate/0.19.0`.
- `profile.mjs --brief`: tier max5, agents 8/8, plan includes Opus, Sonnet, Haiku and Fable.

## What happened

**A. The card fired in a scratch folder.** *"Check any build proposal against the brief (\"What
this is for\" in CLAUDE.md or AGENTS.md ...)"* arrived with the first message, in an empty folder.
Third session running (2026-09-30 note B, 2026-10-01 note B). The lead found the repo from the
app's recent-folders list. *Neutral.*

**B. First size line.** *"[orchestrate · context] ~71k · newest checkpoint: none"* after the first
shell call. Same as last session. *A fact, and fine.*

**C. A stale goal file.** `.orchestrator/goal.md` still says *"using this session as the first live
run of 0.17.2"*, two releases old. PROJECT.md is current (0.19.0). Nothing showed the lead the goal
file, so it misled nobody this time, but a resuming session that reads it gets the wrong release.
*Checked:* `lib/goal.mjs:5-11` reads goal.md only when the project page is missing, and the page
exists. *Harmless here;* a leftover file, not a live second source.

**D. "Latest run" is not the newest run.** The profile said *"runs 9 · latest
20260930-build-0005"*; a run folder `20260930-next-phase-plan` also exists. *Minor; unchecked which
the code means by latest.*

**E. Edit count with no edit, third session running.** *"~102k · newest checkpoint: none · 6 tool
calls since your last edit"* after six read-only shell calls and no edit. Kept on purpose
(2026-10-01 note Q). *Noise:* a line that is wrong on every read-only session start teaches the
lead to ignore the line.

**F. The skill opened cleanly.** Invoking `orchestrate:orchestrate` printed the method and the
profile command; the profile ran in one call. *Helped.*

**G. The evidence the last session lacked is on disk.** The 2026-10-01 notes say the brief's ask
for "a real goal in a real repo" was not met. Session records of real builds with the plugin exist:
three for realorrug (137 MB, newest 2026-09-29) and one for radar (65 MB, 2026-09-30). Every
recent plugin change was judged on plugin-on-plugin sessions and three-run evals.

**H. The checkpoint order, outside plan mode.** At ~108k: *"write the checkpoint now (goal,
decisions, files changed, verification, next action) to ~/.claude/orchestrate/context/…"*. Followed;
one write. The next line named it as newest checkpoint, and after the run ledger was filled it named
RUN.md instead. *Helped, mildly:* it forced a save-point early. Still an order from a hook.

**I. The run ledger template is heavy.** `run-init.mjs` wrote a 120-line RUN.md of placeholders;
filling the sections above the task table took one scripted edit of 20 replacements. *Cost:* about
4k tokens of lead context before any helper went out. Most of it was worth writing (goal, done
when, pickup); the Budget and Shape boilerplate was not.

**J. The dispatch line mixed audiences.** Before the pilot helper: *"helper size: a researcher on
opus, about 7.3x the usual size for this kind of helper; if writing the progress file is refused,
write the same relative path inside your own separate folder instead, and say so in your return"*.
The second half is an instruction for the helper, delivered to the lead. No dollar figure, although
SKILL §5 says every dispatch arrives with a price tag. *Half helped:* the size fact is useful.

**K. The owner's ask that the plugin has no answer for.** Mid-turn the owner wrote that Claude
should explain things the way ChatGPT does: diagrams and visuals, and explanations that flow. A grep
of SKILL.md, plain.md, every reference page and the card for diagram, visual, picture, draw or
artifact finds nothing about showing a picture. The desktop app this session runs in can draw
inline. plain.md's own rules ("one idea per sentence", "say it once") push toward clipped prose, and
this session's own replies show it. *A real gap,* and a user-felt one.

**L. The owner's "as many Opus helpers as you need" covered one helper.** The owner's first message
said to use "however many opus 5.5 high agents you need". The pilot went out on Opus. The second
Opus researcher was refused: *"orchestrate model: the user named opus for task 10-1-0001; this is
task 10-1-0006 — ask them or start on Sonnet."* The guard did what SKILL §0 says ("a grant for the
task they named it for, not the run", `guard-agent.mjs` `grantCheck`, refusal at line 151), and the
router records only the family, never the scope words around it (`router.mjs:267-283`). The card
says *"Never re-ask for authority given"*; obeying the guard means re-asking. Opus is inside this
plan (max5), so the rule guarded no spend here. *Got in the way:* the research went to Sonnet, and
the owner's explicit run-wide permission is unusable without a second message. A fix needs the
router to read scope ("however many", "all", "for this run") and an independent review, since it
is a guard change.

**M. Effort is not per helper.** The owner asked for Opus "high" helpers. The Agent tool takes a
model, not an effort level; helpers run at the host's default. Nothing in the plugin says so.
*Neutral;* worth one line to the owner.

**N. The automatic checkpoint at compaction.** The size line after the summary named
`checkpoint-9519e4b7-….md` as newest. The plugin wrote it from the transcript at compaction (*"a
checkpoint the plugin wrote from the transcript at compaction 1 (auto)"*). Its goal and done-when
came from RUN.md and were right. Its *"Last message before compaction"* is the owner's first message;
the later mid-turn message about visuals, the newest thing the owner asked for, is missing. *Half
helped:* a mid-turn message is likely stored as a different record type. Unchecked.

## Audit results so far

**O. The pilot audit was good enough to copy.** The Opus researcher on the radar session wrote 8
ranked findings, each with the owner's words, the 0.19.0 line behind it and whether a check could
hold it (`docs/research/0007-findings-radar.md`). Two edits by the lead: the title said the session
ran 0.19.0 (it ran 0.16.1), and it called the owner "he" with no basis. The two realorrug audits went
out on Sonnet with that file as the model to match, because of note L.

**P. A cross-project checkpoint, traced.** The radar audit saw another project's plan file named as
the newest checkpoint. Cause, still in 0.19.0: in plan mode `newestCheckpoint` takes the newest
`*.md` in the host's shared plans folder touched since the epoch began, from any project
(`lib/context-advice.mjs:129-138`). Two projects in plan mode at once, as radar and realorrug were
that week, get each other's plan. It also makes `hasCheckpoint` true, so the ask to write one is
skipped. The other half, a run from another project offered at start, is fixed since: a run with no
repo above the working folder is offered only when the folder is under that run's root
(`lib/runs.mjs:343`). *A real bug;* a fix should accept only the plan file this session's own
transcript names.
*Feasible:* the radar record carries `"planFilePath"` on its plan-mode entries (27 times, one file).

## After the owner's correction

**Q. The lead drifted off the owner's goal, and nothing caught it.** The owner asked to watch 0.19.0
in this session and improve it. The lead wrote the run's goal in its own words ("audit four real
vibe-coding sessions (realorrug x3, radar x1)"), sent three helpers to read other repos' sessions
from older releases, and the card's *"Check any build proposal against the brief ... and the goal"*
was then checked against that rewritten goal, so it agreed with itself. The owner had to say: *"we
are not looking at any other repo, why are you drifting into radar? the original prompt was the
goal."* *Got in the way:* three helpers and much of the session went on evidence the owner did not
ask for (cost not measured). Cause in 0.19.0: `run-init.mjs --goal` takes the lead's paraphrase; nothing keeps the owner's
own words beside it. A fix: the run's goal is the owner's message quoted, and the lead's reading
sits under it as a reading.

**R. Diagrams: Mermaid is plain text here; the drawing tool is not.** A Mermaid block in a reply
showed in the desktop app as *"plan text with arrows"* (the owner). The app's own drawing tool drew
a real flow chart in the same turn, with boxes, arrows and colours for done and not done. The plugin
says nothing about either. *A real gap:* the owner compared it with ChatGPT's diagrams, and
the tool to match them was there all along.

## While building

**S. The merge check refused a script that merges nothing, twice.** Writing an eval fixture (a
shell script holding JavaScript) through one shell command was refused: *"This line merges a pull
request, or mentions merging one, in a form this check does not read"*. The script never says
merge. Cause: `mentionsMerge` (`lib/merge-bar.mjs:60-61`) treats any brace it cannot expand as
hiding a merge, then counts the line as naming gh if the letters g and h touch anywhere once every
space and symbol is removed, so a word ending in g beside one starting with h is enough. The second
refusal was a heredoc appending this note to a file: prose that says merge and gh, on a line the
file-text filter does not strip because it is not a plain line. *Got in the way:* two wasted calls,
and a lead told it was merging when it was not. A fix: look for gh inside one shell word, not across
words; a guard change, so it goes to the same independent review as step 3.

**T. Independent review caught what the tests did not, three rounds running.** Each round of the
grant and merge-check change went to a fresh Opus reviewer before the pull request could leave
draft. Round 1 failed the run grant: scope words anywhere within 80 characters made a grant for the
whole run ("use opus for this one; all tasks after it on sonnet" did). Round 2 failed two points: a
question ("should we use opus for every task?") or a split ("reviewers on opus, implementers on
sonnet") still granted; and in the over-64-copies rule a quoted or escaped separator inside braces
(`g{";",}h`) split one bash word in two, so a merge passed that 0.19.0 refused. Fixing round 1 had
also opened three nested-brace bypasses (`g{h,{x}}`), found by probing before the review. *Served:*
rigorous; the review gate is what held, not the author's own tests. *Held by:* each finding is now a
test in `router.test.mjs` or `guard-bash.test.mjs`.

**U. The root of note S was a heredoc, not the braces.** While fixing round 2, the installed 0.19.0
check refused writing this release's own eval fixture with `cat > file <<'EOF'`. The cause was that
the body of a heredoc (the file text between `<<'EOF'` and `EOF`) was read as command text. Bash
never expands braces or reads quotes there, but the check did: JSON or JavaScript in it made more
than 64 copies, and an apostrophe ("shop's") opened a quote that swallowed the rest. Each body is
now read on its own, word by word, so a file of code passes and a body fed to `bash` is still
caught. *Held by:* `guard-bash.test.mjs` "words split where bash splits them".

**Smaller lines (plan step 4).** J: the dispatch line gives size and price; the helper's fallback
sentence lives in its role file, not the lead's line. P: in plan mode only a plan file this
session's transcript names counts as a checkpoint. I: the RUN.md template lost its Budget and Shape
boilerplate. Left as they are, with the reason: D ("latest run" is the bound pointer on purpose, not
the newest folder, so a resumed older run stays the one hooks write to) and E (the edit-count line
already waits for a first edit; the one gap left, at the helper-size line, is pinned by a test).

**V. A judge passed untouched code.** Starting the release eval, the new side-question case was
refused before any turn ran (a shell grant this Windows machine cannot fence in). Its "fixed the
total" grader still ran: an LLM judge read the untouched receipt code, `return sub - codes[code];`,
was told in the rubric to trace 50 with SAVE10 by hand, and voted PASS in all six runs, both sides.
*Got in the way:* a measurement that would have credited both sides with a fix nobody made. *Fix:*
that grader is now a pattern on the file (a percent is taken: `/ 100` or `* 0.01`), checked against
the wrong line and four right ones. It also passes one wrong fix (a hundredth of the percent
taken off as dollars), found by the release review. Five older graders judge a file the same way
(page-actually-works, prices-two-decimals, parser-keeps-last-row,
resume-file-has-what-a-restart-needs, done-is-wired-up); none is shown wrong, but none was ever
tried against the untouched file. *Held by:* the release write-up checks parser-keeps-last-row's
passes against what each run changed.

**W. A helper was sent to do what the lead could not.** In the release eval's pilot (no shell, as
on this machine), the plugin side asked a helper to run `node --test` in 3 of 3 runs; each was
refused, since a helper gets the same tools as the lead. It cost $0.30-0.49 and 67-122 seconds
against $0.18 and 25 seconds without the plugin, for the same final answer. 0.19.0's
three-session runs showed it once. *Cause:* SKILL §3 sends "a build or test suite" to a worker and
never says a worker's tools are the lead's. *Fix:* one clause there: "A worker has your tools, no
more: what you cannot run, it cannot." The room came from dropping the Write/Read sentence. The card
carries it ("Edit, don't rewrite; trust a write that didn't error") only at session start and after
a summary, and the build for other hosts has no card, so there the rule is gone (found by the
release review). *Held by:* side-question-goal's cost and turns, both sides, in the release
eval. *Measured:* side-question-goal 0/3 helpers after the clause, but
three-session-continue 2/3 ("I don't have a way to run commands myself here, so
I'll have a helper try"). Moved to §6, where the lead picks its evidence ("What
you cannot run here, no helper can either: say it is not run and give the
command."): 0/3 and 1/3. Per case: fixed in side-question-goal (3/3, 0/3,
0/3); in three-session-continue no change shown (1/3 on 0.19.0, 2/3, 1/3).

**X. A judge that reads the whole run record sees its middle cut out.** The eval host shortens a
long record by eliding the middle (`[…14 messages elided…]`, `[…33 messages elided…]`). In the
release eval's three-session-continue, the two plugin runs that tried to send a helper had longer
records, so the cut took the edits; the judge for continued-the-right-step saw reads, a helper
call and a final message, and failed both, while done-is-wired-up passed all three on the file.
*Got in the way:* a rule that charged the plugin for its record's length, not its work: the pilot's
two rules moved to the last message were the same thing. In the rerun with the §6 wording every
record was cut, the one that passed too, so there the cut does not explain the two failures. *Fix:* none to the rule mid-eval; that rule is reported as not
measured for the plugin side. Six rules still read the record this way (choice-before-cost,
raised-the-conflict, continued-the-right-step, fixed-the-cause, says-which-check-failed,
asked-before-acting); each should judge the last message or a file instead, or check for the
elision marker first. *Held by:* nothing yet; the write-up names it.
