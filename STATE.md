# Build state

Resume point for building the `orchestrate` skill.

## v0.17.1 — fixes from the first live session on 0.17.0, 2026-09-29

The first live session on 0.17.0 (the plugin's own repo, notes in
`docs/audits/2026-09-29-live-session-notes.md`) found these, each fixed with a
test that fails on the old code:

- A finished run can be closed (`run-init.mjs --close <id> --reason`), so it
  stops binding every new session. (#26)
- A long helper hand-back is kept in full; default helper effort is documented. (#27)
- The size reading after a built-in advisor call counted both models' input,
  about double; it now reads the main model's own steps. (#28)
- The card names the built-in advisor first for a second opinion. (#29)
- The pre-dispatch check reads brief labels in any case ("For:", "Done when:"). (#30)
- File changes made through the shell count as edits; notes files and
  `git checkout` no longer trip the review alarm. (#31)
- The built-in advisor's tokens are counted in cost totals at the advisor
  model's own rate, and a total says when an unpriced advisor is left out. (#32)
- A refused shell line names the part that stopped it, not a lowercase branch
  delete that was already right. (#33)
- A helper past its size budget is told so in words ("past the ~120k budget"),
  not "~121k of ~120k", which read live as still inside it.
- The skill says the built-in advisor is not an independent review: it watched
  the edits being made.

Seen and not fixed: a helper's own compaction reached the lead's after-compaction
card because the host sent no agent id (a Claude Code gap, to report); the
compaction count is one high as a result. The built-in advisor is not treated as
an independent review: in this session it had seen the cost change and a
reviewer still found three mislabels.

## v0.17.0 — the scoresheet audit, and rules that can be measured, 2026-09-29

A scored audit (`docs/scoresheet-audit-prompt.md`, report
`docs/audits/2026-09-24-scoresheet-r1.md`) put the plugin at 49/100 for its
audience, with the first five areas capped at 6 because nothing had been run
live. The user asked for every area at 10 and for the project rules to serve
long-term development, so `AGENTS.md` changed on 2026-09-24:

- "Not doing: staged runs" became "not doing: unmeasured staged runs". The
  user-felt claims (delivery, cost, recovery, safety) are now measured with
  `claude plugin eval` against a no-plugin baseline and with the audit's live
  scenarios, each under a written spend cap. Tests still need no quota; evals
  are the separate, budgeted layer. `claude plugin eval --help` works on
  Claude Code 2.1.274 (STATE.md v0.14-era note that it refused is stale).
  The eval runs themselves need a sandbox backend: on Windows without WSL
  every graded run exits "A shell tool (Bash or PowerShell) was granted but
  this machine cannot confine it (no sandbox backend on this platform)" at
  $0. Run the evals on Linux, macOS or WSL; until then the live runs in
  `docs/audits/2026-09-24-live-runs-r3.md` are the measured substitute.
- New always-true lines: doc numbers are generated or pinned by a drift test,
  one version string in `plugin.json`; every hook registered once in
  `hooks/hooks.json` and silent inside helpers; limits held by hooks or
  removed tools, not prose; install/uninstall leave the machine as found, with
  no person's name in the code; `STATE.md` keeps two releases and archives
  the rest under `docs/state/`.
- The scoresheet audit joined the deciding documents: the newest report is
  the roadmap, and an area that drops needs a decision here saying why.

Guidance re-checked 2026-09-24 against the same pages listed below plus
https://code.claude.com/docs/en/hooks (a plugin's and a skill's copy of one
handler both run, which is why "registered once" is a rule now).

Six waves of fixes followed on branch `audit/scoresheet-to-ten`, each
re-scored by a fresh Fable audit: 49 (r1), 55 (r2), 68 (r3), 72 (r4, in
`docs/audits/2026-09-26-scoresheet-r4.md`). What changed, in order: a docs
truth pass and install hygiene; hooks silent inside helpers and every hook
registered once; a deterministic ledger; the Bash guard; three eval cases and
a no-machinery check on hook text; live scenario runs
(`docs/audits/2026-09-2{4,6}-live-runs-r{3,4}.md`: a real project built
end to end for under a dollar, tests passing, no machinery shown); the router
split into small tested parts (card, state line, resume, brief, recover,
limits scan, plugin-fit report); a checkpoint before compaction; the review
gate; and, in wave 6, the guard refusing destructive commands in every mode
where nobody can answer, the pre-compaction line naming its checkpoint path,
reviews inferred from an objective that mentions money, auth or destructive
data, the Opus cache-read price at its current $0.20, and the brief-missing
line as one plain sentence shown once per project.

Four things the audit cannot measure on this machine, so they stay short of
10 until someone runs them elsewhere: `claude plugin eval` (no sandbox
backend on Windows without WSL), a triggering eval, a clean-profile install,
and a spend figure read from the bill rather than from token counts. The
round-4 report names each with the reason. The live run in round 4 also
showed the lead building directly instead of sending a helper; the card rule
is followed by the model, not enforced, and that stays a known gap.

Round 8's live runs (`docs/audits/2026-09-27-live-runs-r8.md`) reached the
paths the earlier rounds never did. Three changes came out of it. A helper's
turns are counted per segment, since the last user message that carries text,
because Claude Code itself tells the lead to message a capped background
helper and a resumed helper's transcript then holds two segments; the
whole-transcript count had marked a finished return partial. The resume rule
now says one thing everywhere: message the helper while its cache is warm if
what is left is small, otherwise a fresh smaller packet. And the command guard
lets the lead delete its own helper's worktree branch with the unforced
`git branch -d`, which git refuses while the branch is unmerged, so nothing
can be lost; the forced delete, and deleting any other branch, still ask.

The context reader now lives only in its three modules (`lib/context-scan.mjs`,
`lib/context-advice.mjs`, `lib/context-store.mjs`), each with its own test
file; the `lib/context.mjs` re-export file is gone and every caller imports
the module that owns the name.

The PreCompact block is gone (`precompact-check.mjs` and its test deleted,
unregistered from `hooks/hooks.json` and the script install, which now also
removes an older install's entry). Round 8 showed its reason reached nobody
under automatic compaction, and under a manual `/compact` it showed the user
an order. The context notice asks instead, where the lead reads it: at the
checkpoint line with no checkpoint for this compaction epoch, it says to
write one now and names the path, once per epoch; at the compact line with
none, it says compaction will summarise without one.

The post-compaction ask (above) fires correctly but is only an ask: a live
run this round sent it four times and the lead wrote no checkpoint. Asking
again was not going to fix that, so the plugin now writes its own checkpoint
at compaction, from the transcript, into the same path the ask already checks
(`lib/compaction-snapshot.mjs`, called from `postcompact-check.mjs` on the
lead side and from `router.mjs` at `SessionStart:compact`) — idempotent, so a
file the lead already wrote is left alone. It writes after the boundary, not
before: a compaction does not remove the transcript file, verified on a real
session transcript this round (tens of thousands of lines, dozens of
`compact_boundary` records, every earlier turn still present), so reading
the turns just before the newest boundary needs no new hook event and no time
window. The compacted line in the router now only names the checkpoint's
path, never its text.

**What a user will meet that 0.16.1 did not have.**

- Before the first helper of a session starts, the user is told three short
  things: what the job needs, who does it on what model and why, and how it
  is checked. A helper sent before those lines is refused, up to three times.
- A helper hands back five lines under 600 bytes (what happened, the proof,
  what was not checked, what needs a decision, where the full report is).
  The detail stays in a file.
- Work that touches money, sign-in, destructive data or a shared contract is
  held at the end of a turn until a review has looked at it, or the lead has
  said in words why it skipped one. A failed review keeps the hold.
- When helpers have returned and their folders or branches are still there,
  one note says how many are left. It arrives on a tool call, once, never as
  a stop error.
- At compaction the plugin writes its own checkpoint from the conversation,
  so the session after a summary has one whether or not the lead wrote it.
- The command guard stops a command that would destroy work in every mode
  where nobody can answer, says once that nothing in the line ran, and lets
  routine tidy-up (a merged helper branch, a clean helper folder) through
  first try.

**The final pass, 2026-09-29.** Round 11 of the audit was stopped part way
(`docs/audits/2026-09-29-scoresheet-r11.md`): five areas scored, eleven not,
because each auditing helper ran out of room before it could probe. What it
did find was fixed directly:

- The guard reads a git line with its leading options removed, so
  `git -C . worktree remove --force` meets the same check as the plain form.
- `git reset --hard`, `git checkout -- .` and `git restore .` are stopped
  only when the folder holds edits that were never saved to git.
- A quoted branch name passes the small delete. A refused line of several
  parts says once that nothing ran.
- The bare word "model" no longer counts as naming one.
- A request of two or three words that holds a build or fix word gets a
  card. A period inside a file name is not the end of a sentence. The short
  card says to find the cause before fixing.
- The builder and fault-finder roles ask for proof that a new test fails on
  the code as it was. Every role file says the size note is not a stop order
  below the budget.
- The run template has a "Stops anyway when" line. `references/dispatch.md`
  has a "Before you send" list: classify first, pilot one helper, few helpers
  with room, and for a checking task the input that makes each item come up.

**Built and tested, not yet seen in a real session:** everything in the final
pass, the size note, and a failed review keeping its hold.

**Known limits.** The risky-word check matches whole words only. The leftover
count includes helpers that made no commit. A forced folder removal outside
the helper-folder area is not checked. A folder git cannot read counts as
holding unsaved work. With no window reported, the size line shows no total.
The review hold assumes the reviewer's dispatch was recorded first. The
first-helper wait depends on the lead's last message being readable. A helper
cannot save, compact and carry on; a job larger than its room must be split.
The three largest hook scripts (`guard-agent.mjs`, `ledger.mjs`,
`router.mjs`) hold rules added one fault at a time, and moving them into
small modules is about a day of work, not done. Currency was not re-checked
this round. The eval and grader runs cannot run on Windows without WSL.

**A lesson about the method.** The score moved 87, 85, 84, 89 across four
rounds while fixes landed: the scorer's own spread was as large as a round's
gain. Live runs found the faults a user would meet; repeated scoresheets
mostly re-measured. A run whose measure is a judge needs a written stop rule
before it starts, which is why the run template now asks for one.

## Earlier releases

- [v0.16.1 — a review that can stop the merge, 2026-09-21](docs/state/v0.16.1.md)
- [v0.16.0 — from work dispatcher to engineering partner, 2026-09-21](docs/state/v0.16.0.md)
- [v0.15.8 — a scoped model grant, an outbox, honest Codex state, and helper compactions made visible, 2026-09-18](docs/state/v0.15.8.md)
- [v0.15.7 — the lead hears facts, not orders, 2026-09-14](docs/state/v0.15.7.md)
- [v0.15.6 — tests pin behaviour, not numbers, 2026-09-14](docs/state/v0.15.6.md)
- [v0.15.5 — one number per idea, 2026-09-14](docs/state/v0.15.5.md)
- [v0.15.4 — the checkpoint check accepts a real checkpoint, 2026-09-14](docs/state/v0.15.4.md)
- [v0.15.3 — helpers hear facts, not orders, 2026-09-14](docs/state/v0.15.3.md)
- [v0.15.2 — helpers do compact, 2026-09-14](docs/state/v0.15.2.md)
- [v0.15.1 — helper size budgets, capped helpers free their slot, 2026-09-14](docs/state/v0.15.1.md)
- [v0.15.0 — the lead keeps judgment, workers carry the bulk, 2026-09-14](docs/state/v0.15.0.md)
- [v0.14.0 — a repo map helpers read before searching, 2026-09-14](docs/state/v0.14.0.md)
- [v0.13.1 — usage-limit entries expire, and the sandbox retry, 2026-09-14](docs/state/v0.13.1.md)
- [v0.13.0 — accurate context, bounded workers, Codex with Claude fallback, 2026-09-14](docs/state/v0.13.0.md)
- [v0.12.0 — quota first, 2026-09-13](docs/state/v0.12.0.md)
- [v0.11.0 — most coherent, reliable, Claude-native, 2026-09-10](docs/state/v0.11.0.md)
- [v0.10.0 — manage to a budget, not just work, 2026-09-10](docs/state/v0.10.0.md)
- [v0.9.0 — a senior engineer, not a process, 2026-09-09](docs/state/v0.9.0.md)
- [v0.8.0 — cut it down to judgment, 2026-09-09](docs/state/v0.8.0.md)
- [v0.7.3 — the wrong-run bug was corrupting ledgers, 2026-09-09](docs/state/v0.7.3.md)
- [v0.7.2 — the plugin install, which had never worked, 2026-09-09](docs/state/v0.7.2.md)
- [v0.7.0 — the senior engineer in the chair, 2026-09-09](docs/state/v0.7.0.md)
- [v0.4.0 — 2026-09-09, complete](docs/state/v0.4.0.md)
- [v0.6.0 — a plugin, model intelligence, and the question that started it, 2026-09-09](docs/state/v0.6.0.md)
- [v0.5.1 — how to talk, moved where it binds, 2026-09-09](docs/state/v0.5.1.md)
- [v0.5.0 — the manager judges the model, 2026-09-09](docs/state/v0.5.0.md)
- [v0.4.1 — the fresh-context Fable audit, 2026-09-09](docs/state/v0.4.1.md)
- [v0.3.0 and earlier — 2026-09-08](docs/state/v0.3.0-and-earlier.md)
