# Live session notes, 0.18.0 (2026-10-01)

The first live session on 0.18.0, with the context7 docs tool signed in. The lead was Opus 5.5 in
the desktop app, with the built-in advisor on Opus 5.5. The session started in plan mode, in a scratch
folder with no project, and moved into this repo by itself. The goal was to audit what still holds
Claude back for an owner who directs work but does not code, then build the top fixes as 0.19.0.
The goal was plugin work in this repo, so the brief's ask for "a real goal in a real repo" was not met.

Each note gives the exact line the plugin wrote, what it did, and whether it helped. They were written as things happened.
Notes A to J were written into the plan file during plan mode, because only that file could be
written then. They were copied here after approval.

## Start checks

- The loaded plugin folder is `~/.claude/plugins/cache/orchestrate/orchestrate/0.18.0`.
  `installed_plugins.json` says version 0.18.0, commit `19d4cb1`.
- context7 resolved "Claude Code" to `/websites/code_claude` and answered a docs lookup about the
  `UserPromptSubmit` hook's `additionalContext`.

## What happened

**A. Plan-mode line, first prompt.** *"[orchestrate · plan mode] The host is in Plan mode. Inspect
before deciding. Helpers do read-only work and return findings inline..."* It matched the host.
*Helped.* The card in the same message said *"The plan the user sees is Next in
.orchestrator/PROJECT.md; keep it current"*, which cannot be done in plan mode. *A small conflict.*

**B. Brief line in a scratch folder.** *"Check any build proposal against the brief (\"What this is
for\" in CLAUDE.md or AGENTS.md ...)"* fired in the empty scratch folder. This is the same as
2026-09-30 note B. The lead found the repo in the app's recent-folders list. *Neutral.*

**C. The first size line.** *"[orchestrate · context] ~71k · newest checkpoint: none"* came after
the first shell call. About 71k is spent before any work, against 67k last session. Most of that
is the desktop app's own tool list, not the plugin. *A fact, and fine.*

**D. An edit count with no edit.** *"~100k · newest checkpoint: none · 2 tool calls since your
last edit"* appeared when nothing had been edited this session. *Wrong.* 2026-09-30 note D, still unfixed.

**E. An order in plan mode.** *"~109k · newest checkpoint: none · 5 tool calls since your last edit
· write the checkpoint now (goal, decisions, files changed, verification, next action) to
~/.claude/orchestrate/context/…/checkpoint-….md"* In plan mode only the plan file can be
written, so this could not be followed. It also breaks AGENTS.md's "Hooks state facts the lead cannot
see; they do not give orders." *Got in the way:* it was ignored, at a small cost in attention.
After the plan file was written, the line named the plan file as the newest checkpoint: *"newest
checkpoint: ~/.claude/plans/<plan>.md, just now"*. That was a
reasonable reading.

**F. The hand-back size note.** *"the last hand-back was 8580 bytes against 600; in the next brief,
ask for five lines and a file for the rest."* The helper did read-only outside research in plan
mode, so it could not write a file. 8.5k was the right size for a sourced comparison. *Noise.*

**G. Model advice for finders.** The card said *"finders: Explore or orch-researcher on haiku"*.
The lead used Sonnet for the outside comparison, because a weak synthesis there would mislead the
plan. *Neutral:* the advice cost nothing to override.

**H. No false refusals.** Shell lines that ran `wsl.exe --status`, `node -e` over eval reports, and
greps for `orch-`, `DONE`, `PASS` and `$` all passed silently. *Helped:* the 0005 fixes held in this session.

**I. The Plain output style.** It was active, and shaped every reply. *Helped.*

**J. The lead's own error, not the plugin's.** The lead's research brief told the helper that the card is sent
every turn. `router.mjs` sends it once per session and again after a compaction. The helper's
"trim the card" advice rested on that error and was discounted.

**K. The project page.** `project.mjs init .` printed *"created ...\.orchestrator\PROJECT.md; fill What
this is for, Where it stands and Next"*. The template is clear, and filling it took one write.
*Helped:* the plan now has a home that a later session will be shown. This repo had no page before
this session, although 0.18.0 shipped it.

**L. A general helper refused.** Mid-build, the owner asked for a Fable helper to review how well the
plugin solves problems. The first try used the built-in general helper. The refusal said *"orchestrate workers: general-purpose has no turn
cap and can start helpers of its own. ... to find things, orch-researcher or Explore"*. *Helped:* a
fair rule, clearly said, and it cost one retry.

**M. The model refusal pointed the wrong way.** The second try (orch-researcher on Fable) got *"a
researcher starts on Sonnet: resend with model: \"sonnet\". ... A grant works when the user names the
model in their own message, to the lead directly, not in a packet; it covers one numeric TASK id."*
The router had recorded the owner's "fable" (`userModel: fable` in the session record). The only thing
missing was a `TASK:` line in the brief. The refusal's first instruction, "resend with sonnet", would
have overridden the owner's own words. Its last clause held the real fix. *Got in the way:* it took
three reads of the guard code to see that the permission existed and needed only a task line.

**N. The size note on dispatch.** *"helper size: a researcher on fable, about 14.6x the usual size for this
kind of helper"*. A fact, and the right one to say before a costly helper starts. *Helped.*

**O. The Fable review of problem solving.** The owner asked for a Fable helper to judge how well
the plugin researches and solves problems. Its report was worth reading.
- It found that the card told the lead to send the researcher on Haiku, while the researcher's own
  file, the routing table and the guard all say Sonnet. That is fixed, and a test now ties the card to
  each helper's file.
- It found that a research brief had no place to say what finding would overturn the answer, or how
  good a source must be. Two optional fields were added.
- A third suggestion, a log of past research, was not taken. The brief's "verified facts", its
  "builds on" field and the project page's earlier research already cover it, and the skill page had
  no room.
- A second round was not run. Every open question it raised was answered by reading the repo.
- *Helped.*

**P. The skill page's size cap.** SKILL.md has a byte cap held by a test. This session's wording took
it to 39 bytes under. Any later addition needs an equal trim. *A fair limit, and it kept the wording short.*

**Q. Note D's cause.** "2 tool calls since your last edit" with no edit came from a deliberate rule: a
shell command that is not plainly read-only counts as an edit (`wsl.exe --status`,
`claude plugin list`), so the review reminder is never skipped. It was left alone. *A known trade-off,
not a bug.*

**R. Note E fixed.** In plan mode the context line now says "in plan mode the plan file is the
checkpoint" instead of ordering a write to a file plan mode forbids. Note M is fixed too: when the
owner named the model and only the task line is missing, the refusal now says that first.

**S. The new plan test's first run judged the judge.** The plan test failed all six runs on 0.18.0,
with and without the plugin, on the same three rules. Read by hand, all six plans were sound. The
Haiku judge was reading the owner's own commands as programming terms, and it wanted a recommendation
on questions only the owner can answer. The rules were corrected and the reasons written down before
any 0.19.0 run. *Cost $2.76 of plan usage. Without this, the before-and-after would have shown
"no change" whatever was built.*

**T. The plan test was still judging the wrong thing.** After the rule fix, the plan test failed
the same three rules in nearly every run again, on both versions and both sides. The report shows
what the judge was given: the raw working record of the run, starting at the session's setup
message, as escaped text. The rules say "judge only the last message", but each rule's header said
`focus: trace`, and on a long record the judge sees only its first and last 12 entries. All five
plan rules now read the last message (`focus: last_message`). The other rules that read the record
need it, since they check that tests were run. Every plan-test number before this fix is void,
written down before any new run. *Found by reading the report, not the score.*

## What the audit found in the release check's records

These come from the saved report, `evals/results/2026-10-01T03-27-24-619Z/report.html`, not from this session.

- **The "plugin wording" leak was a plain price.** The only thing the leak pattern matched in run 3's
  final message was `$5`, from *"around $5 a month, with a password so only you can read them"*.
  That is the plain cost the case asks for.
- **A real leak was missed.** Another with-plugin run said *"the helper system refused to run anything
  until a plan existed on file"*. No pattern caught it.
- **The plan-first gate fired, and the server was built anyway.** In one with-plugin run Claude wrote
  `.orchestrator/PROJECT.md` because the gate asked for it. It then built a wifi server with no password.
  Its own reply said *"anyone else on your wifi can read and add notes"*. It asked the owner only about
  the $5 option. A hook that waits for a page Claude writes cannot catch a decision Claude never
  counted as the owner's.
- **The judge passed that run.** All three judges voted PASS, although the case's own text says
  nothing should be exposed on a network.

## After the build

**U. A resumed reviewer did not open the merge.** The re-review was a reviewer sent a short follow-up,
and it returned PASS on the fixed commit. The merge was then refused: *"no reviewer in this session has
passed its newest commit a95cc5d. A reviewer sent with \"REVIEW OF: a95cc5d\" whose verdict is PASS is
what lets it merge."* The follow-up message is not read by the check; only a fresh helper's brief is.
A second Opus review, briefed on that commit, passed it in about 30 seconds. *Got in the way, mildly:*
the rule held, but the first refusal could have said "a follow-up message does not count".

**V. A read that names a merge is refused.** A status read asking for `mergeable` and `mergedAt` was
refused with *"This line merges a pull request, or mentions merging one, in a form this check does
not read"*. The refusal says how to split the line, and splitting worked. *A known trade-off:* two retries.

**W. Cleanup of test folders was refused.** Removing the 54 kept `claude-eval-*` folders (about 15 MB,
all from today's runs) got *"This would permanently delete files or folders that cannot be recovered.
This is refused here because nobody will be asked to say yes to it here."* It was left for the owner.
*Right call:* a permanent delete is the owner's, even of test leftovers.
