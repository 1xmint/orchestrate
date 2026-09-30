# Live session notes, 0.17.0 (2026-09-29)

The first real session on 0.17.0, run on this repo. The lead was Opus 5.5 in the
desktop app, in auto mode. Each note gives the exact line the plugin wrote, what
it did, and whether it helped. The seven items are the handover's list
(`docs/audits/2026-09-29-handover.md`). Other items are things that came up
along the way.

## The handover's seven

**1. The first helper's three lines.** Seen. Before the first helper (a
read-only researcher on Sonnet), the lead wrote the job, who does it on what
model and why, and how it will be checked. Then it sent the helper. The guard
did not have to hold anything back, so the "held back without them" path was
not exercised. *Helped:* writing "I'll open two of its cited pages myself"
committed the lead to a check it then did (the effort and advisor pages,
fetched directly).

**2. The recovery note after a summary.** Seen at every compaction of the lead (four), and once inside a helper (item H).
- The "never returned" bug is gone. The line was *"Compaction 1 of this
  session. 1 helper sent so far; orch-advisor last sent: never."* That is true:
  the one helper had returned, and it was not listed as missing.
- The checkpoint bug is gone. Before the summary the size line said
  *"newest checkpoint: none"*. The first line after it said *"newest
  checkpoint: …\checkpoint-3dc48f64-….md, just now"*.
- *Got in the way:* the `[orchestrate · compacted]` note pasted in the whole
  goal, done-when and constraints of an old run: *"run …\20260924-audit-to-ten\RUN.md
  Goal: Raise every area of the 2026-09-24 scoresheet audit to 10/10 …"*. That
  goal is the scoring work the user had just stopped. It also carries a stale
  dollar cap and a stale branch rule. The cause is item A below. It goes away
  once `--close` (PR #26) is released and the run is closed.
- Seen again at compaction 2, with the same old goal re-injected.
- Seen a third time at compaction 3. The checkpoint the plugin writes on its
  own at a summary carried the same old goal too: *"Goal: Raise every area of
  the 2026-09-24 scoresheet audit to 10/10 …"*. Same cause, same fix.
- *Got in the way:* that checkpoint also said *"Last test result: 11 Last test
  result: ℹ fail 1"* while the suite passed. It had taken the line from the
  lead's own read of an older checkpoint (the `11` is the line number the read
  printed). Suggest taking test lines only from shell command results.

**3. Tidy-up after helpers.** Seen, later in the session, with two builder
helpers that each had a helper folder. It did not go through first try.
- `git worktree unlock` said *"is not locked"*. The lead had assumed a lock.
- `git worktree remove` failed with *"Permission denied"*, twice. Both times the
  lead had just run a command with `cd` into that helper folder, which moved the
  session's working folder there. Windows will not delete a folder something is
  standing in. Git dropped its record of the folder but left it empty on disk.
- The lead then sent one line that removed a folder with `rm -rf`, removed the
  other with `git worktree remove --force`, and deleted a merged branch with
  lowercase `git branch -d`. The guard refused it with *"This branch delete is
  refused, because it can throw away work that was never merged. Deleting with
  the lowercase flag works…"*. The line already used the lowercase flag; the
  part that stopped it was the `rm -rf`. **Fixed** in PR #33: the refusal now
  names the part that stopped it.
- A recursive delete of the two now-empty folders was refused, since nobody
  was present to approve (right). A plain `rmdir` of empty folders removed them.
- A lone lowercase `git branch -d worktree-agent-…` passed both times. *Helped.*
- No leftover-folder note arrived while the two empty folders sat there for
  several turns. The note's count is not tested by this session.

*Suggestion:* when a helper hands back, the lead tidies from the main folder,
never after `cd` into the helper folder. One line in the tidy-up guidance would
cover it.

**4. Discarding unsaved edits.** Seen in part. The lead ran
`git checkout -- run-init.mjs lib/runs.mjs` to throw away a broken rewrite of
two files. The guard let it through, as designed: it stops only a discard of
everything at once (`git reset --hard`, `git checkout -- .`, `git restore .`),
and only when edits exist. *Helped:* it did not block a deliberate fix. The
"everything at once" case was not seen.

**5. A short fix request with a card.** Not seen. The session opened with a
long brief, not a short fix request.

**6. A helper's size note.** Seen in all three helpers, each with a ~120k
budget. Example: *"[orchestrate · size] ~84k of ~120k budget · turn 17 of 100 ·
6 tool calls since your last edit · progress file: none given"*.
- Below the budget, every helper carried on as the note intends. *Helped.*
- At the budget it was missed once. The shell-edits helper was sent a
  follow-up while already near its budget. It got *"~121k of ~120k budget ·
  turn 4 of 100 · … · progress file: none given"* and kept working to ~140k.
  Then the host compacted it automatically at ~150k, and it carried on after
  that. It did hand back good work, but about 30k past the point the note is
  for. The over-budget line gives the numbers and nothing else, so it reads the
  same as the ones below the budget. *Got in the way, mildly.*
- Every note said "progress file: none given", because none of the lead's
  briefs named one. The note has nothing to point the helper at.

*Suggestions:* at or over the budget, have the line say so in words ("over
budget: save, write progress, hand back now"). And when the lead sends a
follow-up to a helper already near its budget, say so at dispatch.

**7. Money or sign-in work held for review.** Seen, as a false alarm. At the
end of a turn the stop check held the finish, saying the change touched money
and nobody independent had looked at it. Nothing touched money. The two
matches were the cost column in `references/models.md` and the git command for
throwing away edits, quoted in item 4 of these notes. *Got in the way, mildly:*
it cost one extra turn, and after a second look the lead finished without a
review. Suggest the stop check skip edits to prose files, known by their
extension (`.md`, `.txt`) rather than their folder, since every repo lays out
folders its own way (notes about money are not money moving), and not count the
git command. A real payment change would still be caught through its code
files. **Fixed** in PR #31, together with item B. A replay of this session's 178 tool calls: the old check raised 5 alarms, all false; the new one raises 2, both real.

Seen twice more, after the replay above. First, a sign-in alarm on a turn that changed nothing: the word "permission" matched in these notes, which quote the Windows error *"Permission denied"*. Replayed on #31, that match is gone. Second, #31 still raises a payments alarm on this session. The cause is a `node -e` script the lead ran to edit these notes; #31 cannot see which file such a script writes, so on purpose it reads the whole script. That trade-off is fair. Suggest the lead edit notes with the edit tool, not a shell script.

## Other things that came up

**A. A finished run bound every new session.** The first prompt carried
*"This session continues the run at …\20260924-audit-to-ten\RUN.md."* That run
was over (the user had stopped the scoring rounds), but one blocked row kept it
"open", and nothing could mark it finished. *Got in the way:* it pointed the
lead at the wrong goal from the first turn. **Fixed** in PR #26: `run-init.mjs
--close <run id> --reason "…"` writes a `Closed:` line; a closed run no longer
binds sessions or has returns filed into it, and `--reopen` undoes it.

**B. "N tool calls since your last edit" counts only Edit and Write.** The size
line said *"7 tool calls since your last edit"* before the lead had edited
anything in the session. Later it said *"22 tool calls since your last edit"*
right after a file was changed with a shell command. *Mostly helpful:* it is a
fair nudge to stop reading and act. The word "edit" misleads. Suggest counting
a shell command that writes into the repo as an edit, or wording it as "tool
calls since you last changed a file with Edit or Write". **Fixed** in PR #31: shell writes now count.

**C. The hand-back note fired because the lead's own brief blocked it.** The
line was *"the last hand-back was 7367 bytes against 600; in the next brief, ask
for five lines and a file for the rest."* The lead had told a read-only
researcher not to write any file, so it had nowhere to put the full report.
*Helped:* the advice was right, and the fault was in the brief. Suggest the
packet template give read-only helpers a default report path outside the repo,
so a brief cannot rule it out by accident. A worse gap sat behind it: the
reviewer, advisor and browser helpers have no tool that writes files, yet were
told to put the long report in one, and the ledger kept only five lines of a long
hand-back. **Fixed** on this branch: the ledger saves the whole hand-back as a
`.full.md` beside the short record, and those three helpers are told the truth.

**D. The size line after every tool call.** Example: *"~119k · compacted 1× ·
last tidy-up at ~144k · newest checkpoint: …, 1 min ago · 15 tool calls since
your last edit"*. It is short, and the jump from ~102k to ~119k after one large
web page was a useful warning to keep big reads out of the main chat.
*Helped.*

**E. The checkpoint nudge.** The line was *"~109k · newest checkpoint: none ·
24 tool calls since your last edit · write the checkpoint now (goal, decisions,
files changed, verification, next action) to …"*. The checkpoint path it named
was then used after the summary (item 2). *Helped.*

**F. The size line doubled after an advisor call.** With the built-in advisor
on, the size line read *"~209k"* and later *"~217k"* when the real size was
about 106k and 95k. A response that calls the advisor lists its steps
separately, and the plugin added the main model's steps together. *Got in the
way:* a doubled number pushes the lead to tidy up or start fresh for no reason.
**Fixed** in PR #28: the size is what the last main-model step read. The
advisor's own tokens were not counted in any spend total either. **Fixed** in
PR #32, which sits on top of #28.

**G. Dispatch-guard false alarms.**
- *"brief lacks: what it is for, a check it is done"* on a brief that had
  `For:` and `Done when:` lines. The guard knew only the capitals. **Fixed** in
  PR #30.
- *"this task will wait for an independent review because its objective
  mentions billing"*. The brief was about counting the advisor's tokens and
  quoted the docs heading "Usage and billing". Twice the same: "payment" in a
  brief whose job was the payment detector itself. Left alone for now. The
  list is eager on purpose, and one extra line costs little.
- *"this brief asks for contents to be pasted back"* on "paste the failing
  line in your report". Borderline, since one line is not a dump. Left alone.

**H. A helper got the lead's after-compaction card.** The shell-edits helper
filled its own context and the host compacted it (02:06Z). The plugin then gave
it *"[orchestrate · after compaction] … Compaction 4 of this session. 3 helpers
sent so far; orch-advisor last sent: never."*, plus the finished run's goal
(item A).
- That card is the lead's: the lead's helper count, the lead's run.
- It also moved the lead's compaction count up by one. At the lead's next real
  compaction the card said *"Compaction 5"*, while the size line on the same
  turn said *"compacted 4×"*. The lead's transcript has four.
- The router already skips a compaction hook that carries a helper id
  (`agent_id`), and the installed 0.17.0 has that line. So the host sent this
  hook from inside the helper with no helper id, although its docs say hooks
  fired inside a helper carry one.
- No checkpoint was written for the helper's compaction, so the hook read the
  lead's transcript. A check on the transcript path would not have caught it
  either.
- *Got in the way, mildly:* a helper told it is the lead with a finished run
  could act on either. This one did not.

*Suggestions:* report the missing helper id to the host. Meanwhile, take the
compaction number from the lead transcript's own records, as the size line
does, rather than a counter any compaction hook can bump.

**I. The stop check does not count the built-in advisor as a second opinion.**
The stop hook said *"a brief flagged for independent review returned done with
none sent. Dispatch orch-reviewer … or tell the user it was skipped and why"*
after the built-in advisor had reviewed the change and asked for a replay
against a real transcript, which was done. The lead told the user it was
skipped and why, as the hook allows. *First read as getting in the way; it
helped.* Later in the session the reviewer found three mislabels in the cost
change (#32) after the built-in advisor had already seen it. The advisor sees
the lead's whole conversation and shares its blind spots, so it is a second
opinion, not an independent review. The stop check is right not to count it.

**J. The guard reads the text inside heredocs and `node -e` scripts.** Two
test scripts that only mentioned `rm -rf` and `git branch -d` as strings were
refused, and so was a commit message body sent through a heredoc. Moving the
text into a file got past it. This is the guard erring towards caution, and a
shell line can hide a real delete in the same places, so it is left as is.

**K. "N tool calls since your last edit" missed shell edits again.** After the
lead changed files with `sed -i` and a heredoc, the line read *"27 tool calls
since your last edit"*. This is item B; it is fixed in PR #31 and not yet
installed.

**L. A passed recheck was read as a failed review.** At the end of the session
the stop hook said *"the independent look found a problem; fix it and have it
looked at again."* The cost fix's review had come back FAIL, the fixes went
back to the same reviewer as a follow-up, and it answered PASS. Both answers
carry one dispatch id, and the check counted any FAIL on that id as failed, so
the later PASS was never seen. *Got in the way:* it asked for work already
done. First fix: the newest verdict for a dispatch decides. The independent
reviewer failed that fix: a follow-up to the same reviewer can be about other
work, so a PASS on change Y would clear its FAIL on change X. Fixed again in
0.17.1: the reviewer's first line names the work it judged, and only a PASS
naming the same work undoes a FAIL. The same review found two older holes that
matter now merging leans on this check: a second FAIL after a PASS was never
said, and one reviewer's PASS outweighed a fresh reviewer's later FAIL. Both
fixed. *The review helped:* it caught a hole in a fix to the review check
itself, which the lead's own tests had passed. A second review failed the
second fix too: any line quoting "REVIEW OF" was read as a review, so a builder
re-sent to fix a problem could pass its own fix, and a second reviewer that
replied without a verdict, or never replied, counted as still looking forever.
Fixed a third time: only a PASS or FAIL line names reviewed work, and "still
looking" means no reply yet and sent within six hours. *The review helped
again*, on the same check. A third review failed it once more: a builder's
report quoting a reviewer's verdict on a lower line still read as a review, and
the ledger counted a look with no verdict as a pass. Fixed a fourth time, this
time by writing every known way to fool the check as tests first: only a
hand-back whose opening line is PASS or FAIL names reviewed work, and only a
PASS counts as reviewed.

**M. The "touches payments" line came back on a later turn.** It fired on a
scratch script that quoted `git checkout` (0.17.1 already strips that phrase;
replaying the session through it gives no alarm). Then it fired again, word for
word, one turn later. Its "said once" memory was keyed on the edit's line number
in the last 1 MB of the transcript plus an edit count, and both move as the chat
grows. *Got in the way.* Fixed in 0.17.1: the key is the risky edit's own
tool-call id.

**N. The stop hook asked for a review that was already running.** Right after
the reviewer was sent, the stop hook said *"this change touches a shared
contract; the change made since the review has not been looked at."* True, but
the look was under way, and the line does not say so. *Slightly in the way:* it
cost one turn saying "the reviewer is working". Fixed for 0.17.2: the line
stays quiet while a reviewer sent after the change has not replied (within six
hours), and it names the word it matched (see Q).

**O. The stop hook asked for a Pickup on a closed run.** It said *"Pickup has
never been written. Before this turn ends, update the Pickup section of
…\20260924-audit-to-ten\RUN.md"*. That run carries `Closed: 2026-09-30`.
*Got in the way:* writing a resume note into a finished run would mislead the
next session, so the lead declined. The installed 0.17.0 still binds a closed
run; 0.17.1 (3ad41bb) drops that binding, so this should not recur after the
update. Check it live on the next session.

**P. The closed run's spending cap blocked a review.** Sending the third
independent review, the helper check said *"it would cross the [amount] ceiling
... Raise the ceiling in the run's Budget section, or stop."* The spending was
counted against the same closed run as O. *Got in the way:* a finished audit's
cap stopped the review that the merge bar needs. The user agreed to a small
raise, noted in that run's Budget line. Same cause as O, so the same 0.17.1
change should end it; check it live next session.

**Why three reviews for one small fix.** The user asked. The fix is to the
check that decides whether a change was reviewed, which is what merging leans
on, so a hole there lets any later change skip review. Each review found a real
hole. The lead's part: it patched each finding as it came instead of writing
the ways the check could be fooled before building, which the plugin's own
advice for reviews ("the questions you wrote before the build") asks for. The
plugin's part: nothing prompted that list for a change to its own safety
check.

## Next session, on 0.17.1 (2026-09-30)

**Stop rules, written before any repeated check.** At most two review rounds
on the same safety check; after a second FAIL, stop and bring the findings to
the user. CI is read when the app says it finished, never polled. A live check
of O, P and the reviewer's first line is looked at once, when it happens.

**O and P, checked live.** The opening context of this session did not bind
the closed run (no "This session continues the run" line), and the first
helper went out with no spending-cap line. *P helped, by staying quiet.* O is
checked at the end of this session's turns.

**Q. The "sign-in" label came from words in comments and notes.** Last
session's *"this change touches sign-in; nobody independent has looked at it"*
was traced back to the edit before each one. Two causes, neither sign-in code:
the notes file quoting *"Permission denied"* from a `git worktree remove`
failure, and a code comment in lib/review-of.mjs, *"the id is the first token
after"*. "permission" and "token" are on the sign-in list. *Got in the way:* a
guessed topic sent the lead looking for sign-in code that did not exist.
Fixing it to name the word that matched, which is a fact, instead of a topic,
which is a guess.

**R. The guard's refusal of several branch names was about a pipe.** The
refused line was `git branch -d <ten names> 2>&1 | tail -12; grep …`. Several
names alone pass on 0.17.1; the `| tail -12` inside the delete part is what
made it refuse, and the message then said *"Deleting with the lowercase flag
works"*, which was the flag already used. *Got in the way:* the advice sent the
lead to change the one thing that was right. This session the guard also
refused a read-only search whose pattern quoted the delete phrase, twice.

**S. The commit check misread "no uncommitted files".** The resend demand on
a clean tree was not caused by *"not written down yet"*: the sentence that
matched was *"has no uncommitted files"*. The check sees "uncommitted" and
ignores the "no" in front of it. *Got in the way:* one wasted resend.

**T. The plugin's own checkpoint, read after this session's compaction.** It
said *"Goal: <local-command-caveat>Caveat: The messages below were generated
by the user while running local commands…"* and *"Last message before
compaction: <system-reminder> The user started this session…"*: the app's own
notices, not the user's words. *"Last test result: 64 // One forward pass of
the transcript…"* is a line of source code from a file read, matched because
the test pattern ignores case and "pass" is a word. The compaction count
("Compaction 1 of this session") was right this time. *Mixed:* the file named
the right session and was written without being asked, but its goal and test
lines would mislead anyone resuming from it.

**U. The first-helper nudge.** The dispatch check said *"first helper this
session: the user is owed three plain lines first"*. At first I noted that
the lines had already been given. The session's own record says otherwise.
The message that sent the first helper held only the call, with no text for
the user. The last text before it was the summary written after the
compaction. So the nudge was true, and the lead had skipped the lines. *Would
have helped, but came too late:* the nudge arrives with the helper already
sent, so it can only prompt the lines after the fact. No code change.

**V. The goal after a compaction was the app's own note.** The card after the
second compaction read *"first request, not confirmed: <system-reminder> The
user started this session without choosing a project folder…"*. That is the
app's folder notice, not anything the user asked. *In the way:* the goal line is
what the lead checks its work against, and here it pointed at nothing.

**W. The hand-back size note.** After the checkpoint helper returned, the
context line said *"the last hand-back was 5393 bytes against 600; in the next
brief, ask for five lines and a file for the rest."* True: the brief had asked
for findings in the return. *Helped a little:* the report was worth reading
whole, but the next brief asks for five lines and a file.

**X. A delete refused as if nobody were there.** Clearing an old scratch folder
of the lead's own, the Bash guard refused with *"This would permanently delete
files or folders… refused here because nobody is present to say yes."* The user
was present; the lead had not been asked anything. *In the way, mildly:* a new
folder name worked around it, but the reason given was wrong about the
session. The refusal itself is right to keep, since a deleted folder cannot be
brought back. The guard says this whenever a session runs in auto mode, where
nobody approves each command. Fixed for 0.17.2: it now says *"nobody will be
asked to say yes to it here"*, which is true in a helper and in auto mode.

**Y. The goal after the third compaction was still the folder notice.** The
card read *"first request, not confirmed: <system-reminder> The user started
this session without choosing a project folder…"* again. This is V, still live
because its fix waits in the unmerged checkpoint pull request. *In the way*, as
in V.

**Z. The context line after each command.** *"~72k · compacted 3× · last
tidy-up at ~147k · newest checkpoint: …, just now"*. Short, true, and it names
the checkpoint file to read after a summary. *Helped a little:* it confirmed a
checkpoint existed without anyone going to look.

**AA. A file write refused as a branch delete.** Saving new guard tests with a
shell heredoc, the Bash guard refused with *"This would permanently delete a
branch on the shared remote… refused here because nobody is present to say
yes."* Nothing was deleting a branch. The text being written held the words
`git push` and `--delete-branch` as test data, and the rule reads the whole
line, including text on its way into a file. *In the way:* the file editor
worked instead, but a commit message that mentions a force push would be
refused the same way. Not fixed in 0.17.2; it needs the rule to tell a command
from text handed to one, which is its own change.

**AB. The goal after the fourth compaction was still the folder notice.** Same
card text as V and Y. The fix is merged now (pull request #35) and reaches the
plugin with 0.17.2; this session still runs the 0.17.1 hooks. *In the way*, as
in V.

**AC. The helper count after a long run of edits.** *"[orchestrate · context]
100 work calls since your last dispatch"*. True. The work was one thread of
small edits and test runs, which a helper would have had to learn from the
start. *Neither:* it changed nothing, and it did not repeat.

**AD. The reviewer's first line on the merge bar.** *"OUTCOME: FAIL (REVIEW OF:
a404154) Two natural lines get past the merge bar: an apostrophe in a comment
hides the merge, and a push in the same line leaves the bar reading the old
commit."* *Helped, a lot:* both were real, and four more findings came with
them. Each was written as a failing test first. The fix stopped trying to read
every spelling of a merge. Any line that mentions one is now held to one shape
that names the exact commit, and GitHub refuses that shape if the commit moved.
The cost is a new false alarm of the AA kind: a commit message containing
"pr merge" is refused, and the refusal says to pass it as a file.

**AE. "Ask for five lines and a file" for a helper that cannot write files.**
After the review came back, the context line said *"the last hand-back was 4644
bytes against 600; in the next brief, ask for five lines and a file for the
rest."* The reviewer has no write tool, so it has no file to put the rest in,
and its findings were the point of sending it. The dispatch guard gave the same
advice when the brief asked for findings to be pasted back. *In the way,
mildly:* followed literally, it would lose the findings. The length check
should skip a helper whose tools cannot write.

**AF. "This change touches sign-in" while a review was already running.** The
stop hook said *"orchestrate: this change touches sign-in; nobody independent
has looked at it."* Nothing touched sign-in. The word list files "permission"
under sign-in, and this change is about the guard's permission prompt. A
reviewer had also been sent minutes earlier and was still working. *Helped the
right way, but mislabelled:* the change did need review. The hook should name
the word that set it off and count a review already under way.

**AG. The goal after the fifth compaction was still the folder notice.** Same
card text as V, Y and AB, for the same reason: this session runs the 0.17.1
hooks. *In the way*, as in V.

**AH. The second review found a hole the first fix left.** Its first line read
*"OUTCOME: FAIL (REVIEW OF: f76eea0). `gh pr -Ro/r merge 36 --merge` merges
with no check, because mentionsMerge misses a flag with its value attached when
it sits before `merge`."* It also found that a backslash at a line end, or
braces (`{merge,}`), split the word so the net missed it. *Helped, a lot:* a
check that shows it has missed something twice needs a third look, and
the stop rule (two rounds, then ask) brought that choice to the user instead of
looping.

**AI. "This change touches payments" from a word in a test.** After the round 1
fix the stop hook said *"orchestrate: this change touches payments; the change
made since the review has not been looked at."* Nothing touched payments; a new
test uses a folder called `billing`. The second half was right, though: the
fix had not been reviewed yet. *Helped the right way, but mislabelled*, as in
AF.

**AJ. The installed guard refused a harmless script.** Writing a check script
through a heredoc was refused as *"This would overwrite the history of a shared
branch"*. Nothing was being pushed. The file's text held `git push` on one
line and `gh api graphql -f query=…` a few lines later, and the push rule read
that later `-f` as a push flag. *In the way*, the same kind as AA. The file
tool did the job.

**AK. The third review found that the second fix opened a hole.** Its first
line read *"Removing braces joins `mutation{` onto the name, so `gh api graphql
-f query="mutation{mergePullRequest(...)}"` now passes; at f76eea0 it was
refused."* It also found brace ranges (`{m..m}erge`), `$'merge'`, and a line
long enough to run the check past the hook's 20-second limit. Three rounds had each found a
new spelling, so the check was redesigned rather than patched again. It now
flattens the line to letters and digits and refuses any line that says merge
next to gh or a GitHub address. The only lines let off are plain reads. The price is
five kinds of harmless line now refused, listed in docs/safety-guard.md.
*Helped, a lot*, and the stop rule worked twice: it brought the "another
round?" question to the user each time instead of looping.

**AL. The fourth review found real merges passing the redesign.** Its first
line read *"decide() lets through `gh pr m{e..e..1}rge 36`, and bash 5.2 runs
that as `gh pr merge 36`, so criterion (a) is met."* Brace ranges with a step
were left unexpanded, and gh glued to a flag (`env -S'gh pr merge 36'`,
`git -c alias.m=!gh …`, `-FilePath:gh`) was not seen as a word. Eight
spellings passed, all confirmed on 8b64472. A line of 100 KB of commas took
7.7 seconds to read, against the comment that said a long line could not
slow the check. Two sentences in the docs were also false. *Helped, a lot*:
every one was real. The stop rule agreed before the round held, so the pull
request stayed a draft and the question went back to the user rather than
into round five.

## Not about the plugin, but seen

The app started the session in a folder of its own and asked the user to
approve moving to the repo folder. Starting the chat by picking the repo folder
in the app avoids that prompt. The session's working folder also flipped
between the two once mid-session, so commands here use full paths.
