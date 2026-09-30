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

**7. Money or sign-in work held for review.** Not seen. Nothing in this
session touched money or sign-in.

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

## Not about the plugin, but seen

The app started the session in a folder of its own and asked the user to
approve moving to the repo folder. Starting the chat by picking the repo folder
in the app avoids that prompt. The session's working folder also flipped
between the two once mid-session, so commands here use full paths.
