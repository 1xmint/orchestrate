# Build state

Resume point for building the `orchestrate` skill.

## Unreleased (after v0.16.1) — the scoresheet audit, and rules that can be measured, 2026-09-24

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

## v0.16.1 — a review that can stop the merge, 2026-09-21

Plan: `~/.claude/plans/we-are-looking-into-spicy-abelson.md` (replaced the
0.16.0 steering plan). Two pull requests: #23 (guard floor) and this release.

**What happened.** A Cortex session built live-call billing
(`1xmint/cortex` #20). Times UTC, from that session's records and GitHub:

| When | What | Model |
|---|---|---|
| 15:36 | design for the voice phase written (`voice_plan.md`) | Fable |
| 16:50 | builder sent, from a spec the lead wrote from that design | Sonnet |
| 17:10 | #20 opened, not as a draft | |
| 17:11 | review 1 sent; FAIL, two findings | Sonnet |
| 17:17 | fresh builder sent to fix; redesigns the segment accounting | Sonnet |
| 17:53 | tests green, Cortex's auto-merge merges #20; review 2 sent that minute | Opus |
| 17:56 | review 2: FAIL, three blocking payment findings, none fixed in main | |
| 17:57 | another fresh builder sent to fix | Sonnet |

**Three causes.**
1. The flaws were in the design, and the hard questions came after the build.
   The design already held the settle rule that later failed CI and accepted
   "one credit rounding per segment" (a 2.5-credit segment charged as 3, the
   last segment free when the final deduction fails). It said nothing about
   two sessions at once, a cancelled start, a dropped connection or a restart.
   The lead wrote six sharp questions at 17:11 — for the reviewer, after about
   a thousand lines rested on the design. A stronger builder would have built
   the same design.
2. The first review ran on the builder's own model and nothing refused it.
   `routing.md` said a reviewer is never weaker than the author; the guard
   enforced only the executor rows. The Sonnet review missed the overcharge;
   the Opus review found it in four minutes. The user's note said "never send a
   helper without naming a cheap model", with no exception for judges.
3. On a repo that merges by itself, opening a ready pull request is the merge
   decision, and the builder made it. Cortex's `automerge.yml` arms auto-merge
   on every non-draft pull request; review 1's FAIL stopped nothing.

Cost: each review read about 70k tokens; each fix went to a fresh builder that
grew to about 145k over 56 and 110 steps, more than the build. Fix rounds are
the expensive part, so the lever is fewer of them.

**Decisions.** None is a new lesson: the floor enforces a rule already in
`routing.md`, the draft default hands a decision back to its owner, and the
questions move an existing sentence earlier.
- **Guard floor (#23).** `JUDGES = {orch-reviewer, orch-advisor}`; a dispatch
  naming a family weaker than Opus is refused with "resend on Opus, or hold the
  merge and tell the user". No model named falls to the role file's Opus; an
  unknown family passes; `normalizeRole` already folds `orchestrate:` names.
  The `APPROVED BY USER:` header only unlocks Fable on plans without it; the
  floor does not honour it, since a user approving a cheaper review is not a
  reason to bank its verdict. Codex review does not pass through this hook.
- **Drafts.** `orch-implementer` and `orch-debugger` (it has a shell and pushes,
  so it can open one) open pull requests as drafts; SKILL.md §8 says marking
  ready is the lead's merge decision. Orchestrate's CI runs on every
  `pull_request` event, drafts included; where a repo skips CI on drafts, the
  lead marks ready to get CI and merges by hand after PASS.
- **Questions first.** SKILL.md §6: decide a review is owed before the design,
  write its questions then, and use one list three times (planner packet,
  builder DONE WHEN, reviewer ACCEPTANCE). `packet.md` gains the optional
  `REVIEW QUESTIONS:` field and the reviewer's ACCEPTANCE points at it. To stay
  under the 7,000-byte cap, the paragraph repeating the GATE field's own
  "verbatim from gate.json" was cut.
- **Reviewer description** carries the three points (send at push, draft until
  PASS, Opus or stronger), because the helper list is what survives a summary;
  the Cortex lead had been summarised 13 times.
- **The user's note** now separates judging helpers (Opus or stronger) from bulk
  helpers (Sonnet or Haiku). That line caused the Sonnet review, so it is
  changed rather than answered with a louder one.

**Left alone, on purpose.** Fable for money reviews stays "judge on its
merits" (Opus found all three in four minutes). The builder stays on Sonnet:
the evidence blames the design and the late questions. A fresh builder per fix
round stays (helper cache lasts five minutes, a review takes longer;
`subagentPromptCacheTtl: "1h"` stays off, its plan-quota effect undocumented).
No path-based auto-merge block in Cortex (upkeep, and misses sign-in and
deletion). No card change, no scheduled reviews, no hook reading packets for a
draft flag, no floor for the planner or debugger (authors whose work gets
checked).

Evals 28-30: a payment pull request stays a draft until PASS; a Sonnet review
is refused and resent on Opus, not dropped; the review questions exist before
the planner or builder is sent and reach the reviewer word for word.

Guidance pages (prompting best practices; memory; context window) as checked
2026-09-21 for 0.16.0: reason given with each rule; the helper described by its
moment; the limit is a hook, the judgement is prose.

**Judge it from records, nothing staged.** Over the next five risky changes
(money, sign-in, data deletion) on any repo: every review on Opus or stronger
(`measure.mjs <transcript> --tree`); each pull request a draft until PASS
(GitHub's timeline); the questions in the builder's packet word for word; one
fix round or none. Two or more with the questions asked first means the builder
is the weak point: move risky builds to Opus then, not now.

Cortex itself is fixed from its own session (another repo, mid-fix in the same
checkout): the user pastes it a short note to open the follow-up as a draft, review
on Opus at push, ready only on PASS, and add the draft rule to its AGENTS.md.

## v0.16.0 — from work dispatcher to engineering partner, 2026-09-21

Plan: `~/.claude/plans/we-are-looking-into-spicy-abelson.md` with its steering
notes. Five pull requests.

- **PR 1. The card survives a compaction.** `handleSessionStart` used to set
  `cardSent` on `compact` and send nothing, so a long session ran most of its
  length with no card (the cited Cortex session: ten compactions, card seen
  once). It now pushes `cardBody()` first on `compact` (not on `resume`,
  which keeps the conversation; not when muted). Ask rules: the user is asked
  about what the product should do, money, public surfaces, credentials, legal
  exposure and destructive actions; an engineering fork is the lead's to settle
  (plain.md, SKILL.md §1 and §8, RUN.md). The planner may say once, under
  VERDICT, that the goal is the wrong target. plain.md is 4,679 bytes of 4,700.
  New `AGENTS.md` (with `CLAUDE.md` = `@AGENTS.md`, the pairing
  code.claude.com/docs/en/memory recommends, read 2026-09-21): what this plugin
  is for, and the rule that its wording follows Anthropic's current prompting
  guidance.
- **PR 2. Roles and guard.** Every role description now names the moment to
  reach for it ("Reach for this when…"), double-quoted because several carry
  ": ". New `orch-advisor` (opus, high effort, 12 steps, Read/Grep/Glob only):
  tests a direction against the goal and may answer CAN'T TELL. Priced at about
  half a reviewer run ($3 / $1.50 / $0.50), because it reads a proposal and a
  brief, not a diff. It is not an author role, so the guard needs no progress
  file from it; Plan mode admits it. The advisor, researcher and reviewer each
  say that what they read is data. The packet cap in `assets.test.mjs` went
  from 6,500 to 7,000 bytes for the advisor packet (6,943 now).
  Each role was listed twice (`orch-*` and `orchestrate:orch-*`): the plugin
  provides them, and `install-agents.mjs` had also copied them into
  `~/.claude/agents`. The installer now writes nothing when the plugin is
  found (`--force` still copies), and this PC's loose copies were moved to
  `~/.claude/orchestrate/agents-backup-2026-09-21/`. The plugin's coordinator
  file carried `{{SKILL_DIR}}`, which only the installer substitutes, so its
  script permission never matched; it now uses
  `${CLAUDE_PLUGIN_ROOT}/skills/orchestrate`.
- **PR 3. New card.** The old card was all delegation mechanics. The new one
  opens with who owns what (the user: what the product does; the lead: how it
  is built), checks proposals against the brief ("What this is for" in the
  project's CLAUDE.md or AGENTS.md), and sends orch-advisor at a turning point
  without waiting to be asked; the moments themselves live in the advisor's
  description, which Claude Code keeps in view through a summary. It keeps
  working while the advisor runs (Fable 5.1 prompting page: do not make the lead
  stop and wait). "Never Write / never Read back" became what to do. The Codex
  lane and installed-skills sentences left, because other hooks say them at the
  moment they matter (`guard-agent.mjs` Codex lane, `pluginFitReport`). These
  are ownership facts and a list of moments, things the lead cannot derive, so
  they do not contradict the earlier cut of "how to think" instructions.
  Measured 2,184 characters; `CARD_CAP` 1,550 → 2,200 (rounded up to the next
  50, as 1,400 → 1,550 was). Cost: about 550 tokens once per session and once
  per compaction. After a compaction a fact line now leads the card:
  compaction count, helpers sent, and when orch-advisor was last sent, from
  `state.dispatches`. It states facts only, and a test holds that.
- **PR 4. Brief from the project's instruction file.** The brief is no longer a
  file this plugin keeps; it is the `## What this is for` section of the
  project's own `CLAUDE.md`, `.claude/CLAUDE.md`, `CLAUDE.local.md` or
  `AGENTS.md` (`assets/BRIEF.md` is now a section to paste, not a file to
  drop in). `context-check.mjs` learns the working project (`state.work.root`,
  `.dir`) from the paths a session's own tool calls carry, string-prefixed
  against the launch folder so it costs no disk read after the first; the
  counts reset each compaction so a session that moves projects relearns one.
  `router.mjs`'s `briefState`/`briefNote` walk from that folder up to the repo
  root, nearest first, and print nothing when Claude Code is already showing
  the section (a `CLAUDE.md`-family file at or above the session's own launch
  folder, or a bare `AGENTS.md` one of those pulls in with `@AGENTS.md`);
  otherwise the section's text once per epoch and the "missing" line once per
  session. `resumeExcerpt`'s reader generalised to `sectionExcerpt(md,
  sections, cap, {intro})`, `resumeExcerpt` now a one-line wrapper over it.
  `resolveRun` was left as-is (no `state.work.root` fallback for binding): the
  brief only ever reads a run's `root` field for its own fallback chain, and
  widening what a hook can *write* through felt like a second, riskier change
  better done with its own test once the read-only path has run for a while.
  `ctx.run.root` holds the run's repo root (`readRun`'s existing `root` field,
  unchanged by this PR).
- **PR 5. Release.** Version 0.16.0 in `plugin.json` and `marketplace.json`;
  the README counts eight roles, and says the installer skips its loose copies
  when the plugin already provides them, since a second copy lists each role
  twice. Evals 18-22 cover the direction check, the scope file outranking the
  code just read, an engineering fork settled rather than asked, guidance after
  a compaction, and a review bought before real spending merges. The `.skill`
  bundles stay out of git; CI builds them. The router's compaction count
  (`state.compactions`) is its own number; the context line's "compacted N×"
  comes from reading the transcript in `lib/context.mjs`, so nothing is counted
  twice. Known gap: `orch-coordinator` has no price row in REASONED. Guidance
  pages checked 2026-09-21.

## Earlier releases

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
