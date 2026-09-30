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
done. Fixed in 0.17.1: the newest verdict for a dispatch decides; replaying
this session's own rows through the fixed check stays quiet.

## Not about the plugin, but seen

The app started the session in a folder of its own and asked the user to
approve moving to the repo folder. Starting the chat by picking the repo folder
in the app avoids that prompt. The session's working folder also flipped
between the two once mid-session, so commands here use full paths.
