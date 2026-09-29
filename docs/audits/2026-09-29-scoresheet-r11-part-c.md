# Scoresheet r11, part C: upkeep and honesty (task 9-29-0092c) - PARTIAL

Commit audited: f9d5086. Versions: plugin.json 0.16.1, marketplace.json 0.16.1, SKILL.md metadata 0.16.1.
Host CLI on this machine: 2.1.274. No live run was made in this part. No file other than this one was edited.

Status: PARTIAL. The size notice arrived at 80k, so the work stopped as the brief orders. Area 14
(Currency) was not probed and carries no score from this round. The claim-to-test map for area 13
and the deletion list for area 16 were not made. Every number below was measured in this session
unless tagged otherwise.

Tags: [measured] a command run here; [read] a quoted line from a file at f9d5086; [live r16] the r16 report.

## 1. Score rows

| # | Area | Score | r10 | Evidence | Control |
|---|------|-------|-----|----------|---------|
| 9 | Triggering | 7 | 8 | [measured] router fed 12 prompts: three-word requests ("fix login properly", "migrate to postgres") get 0 B; "can you fix this on the frontend" and "broken again, third time now" get the 283 B card saying "small, one-step task: just do it yourself"; a one-file rename gets the full 2,330 B card. Grader not run. | plugin controls the router; the grader run is outside: no sandbox backend on this platform [read STATE.md] |
| 13 | Tests | 8 | 9 | [measured] 1,097 pass, 0 fail, 116 s, after the package build. 30 lib modules, 30 lib test files; 22 scripts, 38 script test files. Claim-to-test map not made this round. Eval cases not run. | plugin controls tests; eval run outside the plugin's control on this machine |
| 14 | Currency | not scored | 9 | Not probed: no docs page was fetched before the size notice. The r10 score is not confirmed by this round. | - |
| 15 | Docs honesty | 7 | 9 | [measured] 80 commits since r10 changed 3,748 lines of scripts and texts; README changed 2 lines, STATE.md 14. README and STATE.md hold 0 mentions of the five-line hand-back, the three lines owed before the first helper, the leftover note, or the review hold. Version strings agree (0.16.1 in three files). | plugin controls |
| 16 | Maintainability | 8 | 10 | [measured] 12,076 lines of non-test script, 14,402 of test. Largest: guard-agent.mjs 800, ledger.mjs 752, router.mjs 629. Since r10: +3,748 / -401 lines in 48 files; turn-check.mjs +256, guard-agent.mjs +235, ledger.mjs +199. Each lib module has a test file. Deletion list not made. | plugin controls |

Totals are left to the joined report. Part C scored areas sum: 9:7 13:8 15:7 16:8, area 14 missing.

Why three areas are lower than r10 when the plugin improved: the r10 rows rested on live firing and
on module counts. This round measured the router's own choices prompt by prompt, and measured how
far the written account trails the code. Those are new measurements, not new faults from the last
fifty commits, except the growth in area 16 and the docs gap in area 15, which are.

## 2. Verification rows

| Finding | Mechanism at f9d5086 | Proof | Verdict |
|---------|----------------------|-------|---------|
| The card is sent on every prompt (scoresheet prompt, area 9) | Sent once, on the first prompt of four words or more; short card for one short sentence with no build word | [measured] "thanks that looks right to me" 283 B; slash prompt 0 B; [read] router.mjs:327, 370-396 | The prompt's premise is out of date; the cost case is now 283 B, once |
| A short card for small work | isSmallPrompt: under 15 words, one sentence, no build word | [measured] four of twelve prompts got it; [read] router.mjs:180-185 | built; misfires on a repeated failure and on a vague fix, see row below |
| A period inside a file name counts as a second sentence | `/[.!?]/` tested on the text before the final mark | [measured] "Please rename the variable foo to bar in src/index.js" got 2,330 B | does not work for file names |
| A request under four words is not "substantive" | word count of 4 at router.mjs:327 | [measured] "fix login properly" 0 B, "migrate to postgres" 0 B | does not work: a migration is named in when_to_use and gets no card |
| The suite passes in a fresh checkout | package build, then test runner | [measured] package exit 0, test exit 0, fail 0 | works |
| A new version reaches an installed copy | [read] README.md:457 "A new version only reaches you when the `version` field in `plugin.json` is" changed | [measured] version is 0.16.1 at f9d5086 and at the last release | every fix since the release is unreleased; an installed copy does not have them |

## 3. For each area under 10

- 9 Triggering (7). Smallest change: in router.mjs, treat a prompt holding a build word or a fix word as substantive whatever its length, ignore a period that sits inside a word, and keep the short card from saying "just do it yourself" when the prompt holds "fix", "broken" or "again". The grader run is unreachable here.
- 13 Tests (8). Smallest change reachable here: the claim-to-test map, which this round did not make. The eval run is unreachable here: the platform has no sandbox backend.
- 14 Currency. Not scored. What it needs is in r10 section 3: the changelog fetched and the hook input fields confirmed. Reachable here; not done.
- 15 Docs honesty (7). Smallest change: a STATE.md "Unreleased" entry that lists the behaviours a user will meet (five-line hand-backs, three lines before the first helper, the review hold, the leftover count, the checkpoint after compaction), and a README paragraph for each that a user sees. Reachable here.
- 16 Maintainability (8). Smallest change: none that is small. The three hook scripts that grew most hold rules added one live fault at a time. A pass that moves each rule into a lib module with its own test, and deletes what a later rule replaced, is reachable here and is a day of work, not a sentence.

## 4. Part C answers

Item 1, no finish line. Real at f9d5086. [read] assets/RUN.md:21-23 has "Done when" with evidence
lines and nothing on what ends the run if that evidence never arrives. The nearest rule is
[read] references/evaluation.md:133 "No progress in three rounds, or the same error twice, ends the
loop", which sits in a reference file, speaks of a fix loop, and is not on the card or in RUN.md.
A grep of SKILL.md, the references, the assets and the card for "finish line", "stall", "what ends"
and "stop rule" returned nothing. Cause: the run template assumes the measure is a fact (a test, a
file), not a judge whose number moves. Smallest change: one line in RUN.md under "Done when":
"Stops anyway when: <what ends the work if the measure stalls or the judge disagrees with itself>",
and one sentence in SKILL.md where the run is opened. A text change, not a mechanism.

Item 2, a check that tests nothing. Real at f9d5086. A grep of the same files for "will trigger"
and "trigger each" returned nothing; [read] assets/packet.md:32-33 asks for "a command and its
expected result" and does not ask what input makes each item come up. [live r16] shows the cost
even after prompts were rewritten: two of nine items "could not be exercised". Cause: the packet
asks what proves the work, not what provokes the behaviour. Smallest change: one line in packet.md
for any checking packet: "For each item checked: the input that makes it come up; an item with no
such input is reported as not checked." A text change.

Is anything large left, or only polish. From what this part measured:

1. The mechanisms that remain to fix in my areas are polish: three router rules, each a few lines.
2. One thing is large and is not code: nothing since 0.16.1 has been released. By README.md:457 an
   installed copy gets none of the eighty commits. The brief for this audit says the steering
   session itself ran the older installed copy. For a person about to use the plugin, the scores in
   all three parts describe f9d5086, not what they have installed, until the version is raised.
3. The written account trails the code by eighty commits. That is a day of writing, not a design problem.

Was the scoring loop wasted motion. In part, yes. What the record in my areas supports: the score
moved 87, 85, 84, 89 while fixes landed, so the scorer's own spread is about as large as a round's
gain, and a number like that cannot tell the user whether a round helped. This round repeats it:
three of my areas score lower than r10 because I measured different things, not because the plugin
got worse. The live runs are what found faults a user would meet (r16 lists five, each with a
quoted line). The repeated scoresheets mostly re-measured. I did not read r11 to r15 in full, so
this is a judgment from r10, r16 and this round, not a count across all rounds.

The "fix this on the frontend" question belongs to part B. One measurement from this part bears on
it: that exact prompt gets the short card, whose text is "just do it yourself"
[measured, read card.mjs:44]. Nothing in the router asks the lead to name a cause first.

## 5. Commands run

- `git checkout -b task/0092c-audit f9d5086`
- `node scripts/package.mjs --both`, then `node scripts/test.mjs`, output to a file under <temp>; pass and fail lines read with grep
- a probe script under <temp> that feeds router.mjs twelve prompts as UserPromptSubmit stdin, each with HOME and USERPROFILE set to a fresh folder under <temp>, and prints exit code and bytes returned
- `grep -n -E "^\| (9|13|14|15|16) \|" docs/audits/2026-09-28-scoresheet-r10.md | cut -c1-500`
- grep of SKILL.md, references, assets and lib/card.mjs for the finish-line and trigger wording
- grep counts in README.md, STATE.md and SKILL.md for nine behaviour phrases
- `git diff --shortstat` and `--stat` from c63be76 to f9d5086; `git log --format=%h c63be76..f9d5086 --no-merges` (80 lines)
- line and file counts with `wc` and `ls`
- `claude --version`; `claude plugin --help` (help text only, no run)

Not checked: area 14 entirely; the claim-to-test map; whether tests mirror code or check what a user
would notice; the deletion list with bytes saved; rules held in both prose and script; whether
docs/audit-prompt.md is current; AGENTS.md against SKILL.md for disagreement; the two eval graders.
