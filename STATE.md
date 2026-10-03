# Build state

Resume point for building the `orchestrate` skill.

**In progress: 0009 — measure against plain Claude before changing,
2026-10-01.** Plan: `docs/research/0010-master-plan.md` (revision 4, approved
2026-10-03; it builds on `docs/research/0009-plan.md` revision 2 and wins
where they differ). Work branch `phase/0009-bench`. This becomes the next
release's section when it ships.

- 2026-10-03: the owner approved the master plan and said yes to all five of
  its decisions (section 6): plain Claude is the only yardstick, two arms, the
  1.15x bar held, a plain-arm scout first, the pilot cap $10 to $14;
  keep-going stays armed through a usage limit, "you decide" is an allowed
  answer on a product question, and Claude takes its own recommendation after
  "you decide" once or the same question twice unanswered; the work branch goes
  on the owner's machine before the paid run, and Stage 0, the same-item stop,
  the pause at a limit and the wording fixes ship on their payload tests and
  the record even when the bench reads level, as a dated exception to
  `bench/RULE.md` (to be written there in step 1); the mod's tests may run
  where Claude Code is signed in if `claude plugin test` turns out to need
  that; usage numbers through the mod wait for a later release. Why the plan
  changed: the pilot's first run was green and scored nothing, the 0.20.0
  result (level at about 1.36x) already predicts a loss under the 1.15x rule,
  and the owner's own records show about sixteen hand restarts whose causes
  Stage 0 mostly fixes, so the plan buys no run that confirms a known answer
  and cuts where the cost is (the per-run read, 27,284 bytes). Order: free
  looks at the app, the outcome table and scorer fixes, the free fixes with
  tests, the records and the owner's next build, pilot parts 2 and 3, the
  comparison on a written prediction, the two held-back tasks, release on the
  owner's go.

- 2026-10-03, overnight (branch `night/0010-free-steps`, draft PR #52 into
  `phase/0009-bench`): the plan's free steps are built, each with tests, all
  green on GitHub CI. Nothing paid ran; step 4 waits on step 0's looks on the
  owner's machine.
  - **Step 1.** `bench/RULE.md` has the dated outcome table and the bundle as
    kind "addition"; `verdict` names the row it lands on. A missing or empty
    work folder is a failed run, not a note. `evalRootOf` treated the
    filesystem root as an eval root, so on Linux, with the eval's temp folder
    gone, the scorer graded the first folder under `/home`: the likely reason
    pilot part 1 read one valid run and no successes. A scorer crash now fails
    the bench job after the leak scan and the upload. The scenario suite passes
    `--compact-after 1`. `bench/hook-bytes.mjs` counts Stop blocks from the
    host's "Stop hook feedback:" record (read in the 2.1.42 and 2.1.288
    programs); the zero in `docs/research/0009-hook-bytes.md` was blind.
  - **Step 2b, the pause** (`docs/pause.md`). The 90% stop is gone. A helper
    refused for usage is a fact on the next continue, not a stop, and a step
    whose only work was such sends is no work. `persist-check.mjs` is also on
    `StopFailure` (a second named exception in `hooks-registered-once`), where
    it only writes `.orchestrator/pause.json`, and only where that folder
    exists. A Stop with a helper, background command or scheduled prompt out
    waits instead of stopping, and the same work still out after a wait with
    nothing done since ends keep-going (a dev server would otherwise hold it
    forever). Checked 2026-10-03: code.claude.com/docs/en/hooks-guide
    (StopFailure output is ignored; a Stop hook is overridden after eight
    blocks in a row without progress) and the 2.1.288 type file (`error`,
    `background_tasks`, `session_crons`).
  - **Step 2c.** The card carries decision 2c; the router states, from the
    second time, that the same question went out unanswered, quoting the
    replies (`lib/asked.mjs`). The card stays at 2,187 characters.
  - **Step 2d.** `plain-words.test.mjs` produces every line the user sees
    directly (keep-going's stop line for each reason, the band, the pause text,
    the status line) and fails on the eval's machinery list plus paths and
    terms of art. It caught "Auto-continue stopped", "a dispatch was denied",
    a checkpoint path and token count in a user line, "the done-when", "ctx"
    and task ids; all are in plain words now, and the lead keeps the details.
  - **Step 2e, the per-run read: 27,278 to 13,481 bytes (51% less).** SKILL.md
    19,994 to 7,625; the Plain style 5,094 to 3,669; the card 2,190 to 2,187.
    The profile line the skill loads with, not counted before, 991 to 384
    bytes; a terminal with no usage reading also gets one line naming the
    one-time status-line install (`profile.test.mjs` holds the brief under
    800 bytes).
    Where each rule went is in commit `e014f77`'s message; the auto-merge rule
    came back after the review. The prompting-guidance page was not re-read
    tonight (fetching it needed the owner's approval); these wording choices
    rest on the 2026-09-21 reading in AGENTS.md, and step 5 is the run that
    judges them.
  - **The band** (section 4, `docs/band.md`): `hooks/band.mjs` under `modules`
    in `hooks/hooks.json`. Read in the shipped programs: 2.1.286 and 2.1.250
    know the key, and 2.1.200 drops an unknown key, so the command hooks load
    either way. CI's new `validate` job runs `claude plugin validate` on
    2.1.286 with no sign-in. The band starts no timer where nothing draws.
  - **Independent review** (fresh context, Opus): FAIL, seven should-fix, no
    blocker; all fixed in `11a3675`. This entry is its sixth. A second round
    (a new reviewer) failed the fixes on four: the wait rule ended keep-going
    while a Monitor or a recurring prompt was still waking the session (now it
    ends only when the user spoke and the step still did nothing); the
    coordinator's count went before the status word the ledger reads; the
    base check came after a debugger's reproduction; the profile cut dropped
    the only line that says live usage is off and how to turn it on (back, in
    a terminal only). All fixed, with its nits, in `00be057`. A third round
    found three: a typed prompt with a system note in front, a queued message
    or a summary was not read as the user speaking; a status question while a
    helper was out ended keep-going (now only a background command alone can
    end it that way); the usage line showed where no status line runs. Fixed
    in `bec2bcf`. A fourth found two: a Monitor that runs a command may be
    listed as a background command (type "shell"), so once one is started in
    a stretch keep-going treats what is out as something that will report;
    and a refusal with the host's words in front ("PreToolUse:Agent hook
    error:") was missed, so the match now allows that prefix while still
    reading only the start of the result. A fifth, on the later work below,
    passed the faster hooks and failed the wait check on four: it refused
    messages that promise nothing ("Let me know when the deploy is done and
    I'll check again", "we'll watch the config directory"); its fact predicted
    more than the payload shows (a reminder sent into the conversation is not
    listed); its continue dropped the size advice it marked as delivered; and a
    step that polled reset it, so a poll-then-promise stretch ran to the step
    cap. Also: a Monitor held keep-going for the rest of the stretch, and the
    size block came after the wait check. All fixed in the commit after
    this one.
  - **Also:** builders and debuggers check that their folder starts from the
    packet's base (Claude Code starts a helper folder from the remote's default
    branch unless `worktree.baseRef` is "head", code.claude.com/docs/en/
    worktrees; three of tonight's own helpers started from main); the
    coordinator grades every task it sent, a missing return as BLOCKED; cut
    `smoke.mjs`, `profile.example.json` and `references/execution.md` (no
    caller); turn-check walks folders instead of starting git each Stop; the
    router reads the plugin listings once per session.
  - **Faster hooks.** Every hook is a new Node process, and most of its start
    went on parts of Node it never used: importing `node:fs` as an ES module
    loads the promise and stream halves of fs, and `node:crypto` and
    `node:child_process` are large. Every script now takes them from
    `lib/node.mjs`, which uses `require` for fs and loads crypto and
    child_process on first use; `lib/node.test.mjs` holds both. Measured
    2026-10-03 on Linux, Node 22, 50 runs each (bare Node starts in about
    21 ms): the hook after every tool call 65 to 47 ms, the shell-command check
    68 to 45, the prompt hook 72 to 48, the Stop hook 69 to 47.
  - **Waiting on nothing** (`docs/pause.md`, `lib/wait-claim.mjs`): when one
    of the closing message's last three sentences promises, as "I", to wait or
    check back on something outside the conversation or at a time ("I'll let
    you know when CI finishes") and the Stop payload lists nothing out, the
    Stop is sent back once with what the payload shows; with keep-going on it
    is one continue per stretch, and the next step that only waits ends
    keep-going in plain words. Idea C's "waits that could never wake" (about
    four hours on a check that never reported back) is the failure; the
    payload lists what the host wakes a session for (2.1.288 type file: "Empty
    array when nothing is in flight"). Not measured; it rides the candidate
    bundle. Cost: one extra turn when it fires, never when something is out,
    the user is the one waited on, or the record shows a reminder was set.
  - **A read of the always-on text as the lead reads it** (fresh context,
    Opus, against the prompting guide and the Opus 5.5 page, 2026-10-03), and
    an inventory of every hook line (Sonnet). Fixed: the style said "ask once"
    while the card's rule 2c needs a question to go unanswered twice (the
    style now asks for all such questions together, in the message carrying
    the next step); the missing-brief line told the lead to write CLAUDE.md or
    AGENTS.md where `references/brief.md` keeps a public repo's brief
    untracked (now a fact and a pointer); the card's "the brief wins" read as
    overruling the user's own ask (now: check your proposal against the brief,
    not the file just read); SKILL.md's "wait on a helper with `Monitor`" read
    as polling a helper that wakes the session by itself; "second opinion
    before committing" read as before every git commit; routing.md's Codex
    lane had no condition. The stop-and-ask list was in both the style and the
    card: the style keeps it, with the home-wifi example the card carried.
    Nothing writes the Codex status cache (only the tests do), so the profile
    line always read "codex: not checked in the last hour (run profile.mjs)"
    and running it changed nothing; the line now shows only a fresh reading.
    The keep-going line went from 467 to about 330 bytes. Per-run read now
    13,282 bytes (skill 7,541, style 3,782, card 1,959; the skill keeps its
    maintainer rule, which the portable build needs and a test pins). Not changed, and
    why: the "helper size" note on every dispatch (about 80 bytes, pinned by
    eight hook tests, and a guard change needs its own review); the skill's
    "How to talk to the user" section (pinned; only serves hosts without the
    style); the Plan-mode notes (orders with no failure named, but the guard
    teaches the same at the refusal: a candidate for step 2a). Commit
    `e014f77`'s message says `execution.md` keeps the Plan-mode rules; that
    file was cut later (`11a3675`), and the guard (`workflow.mjs`) holds them.
  - **Step 5's prediction, from bytes and the 0.20.0 dollars: it cannot be
    settled yet, and pilot part 2 settles it.** 0.20.0 read 28,276 bytes
    per run (skill 19,995, Plain style 5,094, card about 2,196, profile line
    about 991) and cost about $0.04 more than plain Claude on three cases
    where both did the same work (about $0.115, so 1.35x; level on a fourth,
    `docs/research/0007-eval-release.md`). The candidate reads 13,865 (skill
    7,625, style 3,669, card 2,187, profile line 384), 49% of that. If the
    whole extra scales with bytes, the ratio on such cases is about 1.17x; if
    one extra model call to load the skill (about a cent at Opus 5.5's listed
    prices, `references/models.md`) does not shrink, about 1.22x. Both are
    over the 1.15x line, so on tasks the size of 0.20.0's cases the run is not
    bought (decision 1b holds the bar). Two unknowns move it below the line:
    a longer task spreads the one-time read over more turns (at 20 turns and
    about $0.40 a run the same arithmetic gives about 1.11x), and a task
    small enough that the skill never loads pays only the style and the card
    (about 1.08x). Pilot part 2 (already approved, $4) shows both: its trace
    says whether the skill loaded and what a bench run costs. The prediction
    is then one line of arithmetic, written here before any comparison cap.
    records; step 2a (which hook notes Claude never acts on) needs the session
    records too. Left for the owner, each with the audit's evidence in PR #52:
    setting `worktree.baseRef` to "head"; a smaller worktree-removal reader in
    `guard-bash.mjs` (a guard change: independent review first); whether the
    Codex lane, live usage, the coordinator, `map.mjs`, `batch.mjs` and
    `suggest.mjs` earn their upkeep. Checked in the shipped program: 2.1.200
    already lists `StopFailure` among its hook events and fires it with an
    `error` field, so the new key is known from 2.1.200 on; builds before that
    were not read.

- The bench (`bench/`, `bench-hidden/`, `evals/grade-kept.mjs`,
  `.github/workflows/bench.yml`) fits "nothing that bills an outside service
  or needs its own API key": it is for developing this plugin only and is not
  installed; the owner starts it by hand; it signs in with the owner's own
  subscription token, never an API key; GitHub Actions minutes are free on a
  public repository. Each batch has a `--max-cost-usd` stop-loss written in
  `bench/RULE.md` before it runs.
- The rule that decides a comparison is in `bench/RULE.md`, written before any
  run: gates, then successes, then cost per success, then time.
- Every case's hidden checks are proven to pass a known-right solution and
  fail a known-wrong one (`bench/grader-check.test.mjs`), so a hard case is
  never mistaken for a broken one.
- `gate.mjs` reads the merge gate only from a workflow that runs on push or
  pull request, so the hand-started bench job is never taken as a project's
  gate.
- Plan revision 2 turned the guard's Sonnet-first refusal into an allow. That
  part is dropped; Stage 2 is wording only, and the refusal and its grant code
  stay. Three reasons: AGENTS.md says a hook refuses a helper on the wrong
  model; the record (`guard-agent.mjs`, the comment above the refusal) shows
  56 of 58 builders ran on Opus while the rule was only written; and
  `bench/RULE.md` keeps a removed capability when a result is inconclusive.
  Removing it would need its own comparison (current against current without
  the refusal) and an AGENTS.md change in the same pull request.
- Hook notes now state facts (Stage 0), and so do the refusals in
  `guard-agent.mjs` and `lib/workers.mjs`: each keeps what was blocked and the
  way through that passes the code. One independent review (Opus) found the
  Fable text promised the approval line alone passes, while a builder on Fable
  still meets the Sonnet-first rule and a finder is refused as a sweep; the
  text now names both and a test pins it. The old text had the same gap.
  Three `guard-bash.mjs` texts still give an order (the ask tail, the
  worktree-remove and branch-delete refusals); they are safety stops and are
  left until a guard change has its own reason. The review also found the
  Sonnet-first check does not read whether the earlier attempt failed; that
  is written in `docs/safety-guard.md`. Refusal wording checked 2026-10-01
  against Anthropic's prompting best practices page (give the reason, say what
  to do rather than only what not to, no forceful words) and the Prompting
  Claude Opus 5.5 page, which adds nothing on refusal text.
- The keep-going loop stops when three continues in a row have named the same
  open item and it is still open. Before, a stuck run was nudged up to the
  25-step cap, the costliest way the loop fails. "Prompting Claude Opus 5.5",
  Unattended agentic runs (checked 2026-10-01), says to stop after two or
  three automatic continuations on the same task. A new arming (the user's
  "continue" or "try again") starts the count again. README, `lanes.md` and the
  line printed on arming state both limits; `docs-drift.test.mjs` pins them to
  the code, which it did not do for the 25-step limit before.
- Stage 2 (branch `phase/0009-stage2`): the card, SKILL §3 and
  `references/models.md` give one rule for handing a step to a helper. Do it
  yourself within about eight tool calls; past that, hand it over when that
  costs less overall, counting the helper's cheaper model and the reads kept out
  of the lead's context against the brief, the return kept and checks. The
  measured 2–3× cost of splitting a small build stays on the card as the fact
  behind the rule. "Let the user pick" before a split is dropped: how to build
  is the lead's call (approved with plan revision 2). `bench/RULE.md` classes
  this, before any run, as a wording simplification. Checked against
  "Prompting Claude Opus 5", Controlling subagent spawning (platform.claude.com,
  2026-10-01): Opus 5 delegates more readily, and delegation multiplies cost on
  small tasks; its sample rule also keeps work that fits in a handful of tool
  calls with the lead. The Opus 5.5 page lists no change to delegation.

## v0.21.0 — judgment: no test that teaches nothing, no review loop, 2026-10-01

From the owner's correction after 0.20.1: the session had spent $10 on a test
whose result was predictable, and seven review rounds on cases of one kind its
own decisions ruled out. Reasoned from that session's record; no eval run, by
the owner's decision.

- Two failed reviews in a row, with no PASS since, are stated once as a fact
  on the lead's next tool call: how many, which commits, where the returns
  are. A return with no readable verdict neither counts nor resets. On the
  0.20.1 record it would have spoken after the second round.
- SKILL §2: before a test or experiment beyond the gate, write the expected
  result and what it would change; one that can be predicted, read or looked
  up is not run. §5: after a bug fix, look for the same mistake elsewhere.
  §6: the reviewer's questions carry what Decisions rule out, and a finding
  there is noted, not a FAIL. §7: the same error or kind of finding twice
  means naming what they share and fixing that kind once, or ruling it out
  with the owner.
- `evaluation.md` "Independent review": why a question that contradicts the
  recorded threat model loops, and what to do after two failures.
- The card carries the two habits and the look-elsewhere step; it dropped
  lines SKILL already holds. 2,176 of 2,200 characters; SKILL 19,987 bytes.
- Gate: 1263/1263 + 22/22.

## v0.20.1 — safer clean-up, a fairer ruler, 2026-10-01

From the refusals and the eval ruler seen while releasing 0.20.0 (notes X and Y
in `docs/audits/2026-10-01-live-session-notes-0.19.0.md`).

- A forced worktree removal of any folder, not only a helper folder, is
  checked for unsaved work first. Before, one outside `.claude/worktrees/`
  passed with no check and its unsaved work was lost. A folder that cannot be
  found or read is refused ("cannot tell"). A Git Bash path such as `/c/...`
  is translated before the check, because Node read it as a missing folder,
  which counted as clean. The first review found a redirect before the flag
  (`remove 2>/dev/null --force`) hid it, and `--fo` was not read as force;
  both fixed. The second review found a brace (`{../dirty,}`), a
  backslash-newline, a quoted flag and a word before git (`if … then`, `env
  -i`, `\git`) still slipped past. So the check now reads like the merge check:
  a part holding `worktree remove` must be plain words, or it is refused as
  unreadable; a plain `cd <folder>` before it moves where folders are read.
  The third review found an escaped quote (`-m "Fix \"x\" bug"`) hid a forced
  removal after it, and a quoted Windows folder after `cd` was refused; quotes,
  comments and heredoc bodies are now read where bash reads them. The fourth
  found a `<<EOF` inside quotes, a piped heredoc, a cd in `( )` and a `\"` read
  by PowerShell; a relative folder is now checked from every place a cd could
  leave the shell. The fifth found PowerShell's `Set-Location`, `pushd`, `sl`
  and `CD` were not read as a cd; every way either shell moves now is, and
  `$'…'`, a backtick before a quote and curly quotes refuse a removal line.
  The sixth found a PowerShell here-string with an apostrophe hid a removal
  after it from the bash reading; a line with one is now read both ways.
- A clean-up line that removes a clean worktree and deletes branches with
  lowercase `-d` now passes. When a branch-delete line is refused although it
  already uses `-d`, the refusal names the part that was actually refused
  instead of advising `-d`.
- The merge check accepts one plain `cd <path>;` or `&&` before a single
  `gh pr` read; the path is letters, digits and `./:@+,=-` only. `cd $(…)`,
  backticks, globs, `~`, two `cd`s and `cd …` before a merge are still
  refused. A branch delete with `-d --force` is not called "the lowercase
  flag" in a refusal.
- docs/safety-guard.md: in a session that shows no prompts, an owner's yes in
  chat does not reach the check. The owner runs the command, or approves the
  exact line for `.orchestrator/allow-bash.json`.
- Eval ruler (note X): six LLM rules that read the whole run record, which the
  eval host cuts in the middle, now read the last message. Two tool rules were
  added for actions the rewritten rules no longer see
  (`no-uploads-removed`, `report-test-untouched`), and Edit or Write siblings
  for three that watched one tool only. Left to the final message: whether
  three-session-continue redid steps 1-2, and whether misleading-bug's tests
  passed (only that they ran is checked). `eval-graders.test.mjs`
  refuses any LLM rule that reads the record or doesn't say what it reads.
  Not re-measured.

Replayed against `decide()`, each refused line from this session now gives the
intended answer. Gate: 1260/1260, 22/22.

## Earlier releases

- [v0.20.0 — plan 0007: replies that draw, the owner's words kept, grants that hold, 2026-10-01](docs/state/v0.20.0.md)
- [v0.19.0 — plan 0006: a fair ruler, and who can see the data is the owner's call, 2026-10-01](docs/state/v0.19.0.md)
- [v0.18.0 — plan 0005: checks that read what runs, and a project page, 2026-09-30](docs/state/v0.18.0.md)
- [v0.17.2 — a merge waits for its checks, 2026-09-30](docs/state/v0.17.2.md)
- [v0.17.1 — fixes from the first live session on 0.17.0, 2026-09-29](docs/state/v0.17.1.md)
- [v0.17.0 — the scoresheet audit, and rules that can be measured, 2026-09-29](docs/state/v0.17.0.md)
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
