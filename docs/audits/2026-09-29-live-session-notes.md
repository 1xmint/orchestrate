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

**2. The recovery note after a summary.** Seen once (compaction 1).
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

**3. Tidy-up after helpers.** Not seen. The only helper was read-only and had
no helper folder, so there was nothing to tidy.

**4. Discarding unsaved edits.** Seen in part. The lead ran
`git checkout -- run-init.mjs lib/runs.mjs` to throw away a broken rewrite of
two files. The guard let it through, as designed: it stops only a discard of
everything at once (`git reset --hard`, `git checkout -- .`, `git restore .`),
and only when edits exist. *Helped:* it did not block a deliberate fix. The
"everything at once" case was not seen.

**5. A short fix request with a card.** Not seen. The session opened with a
long brief, not a short fix request.

**6. A helper's size note.** Not seen. The researcher finished well inside its
budget.

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
files. Being built on `fix/shell-edits-count`, together with item B.

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
calls since you last changed a file with Edit or Write".

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
advisor's own tokens were not counted in any spend total either; being built
on `fix/count-advisor-spend`.

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

## Not about the plugin, but seen

The app started the session in a folder of its own and asked the user to
approve moving to the repo folder. Starting the chat by picking the repo folder
in the app avoids that prompt. The session's working folder also flipped
between the two once mid-session, so commands here use full paths.
