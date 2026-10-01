# Next session: watch the 0005 build live, audit what is left, rerun the comparison

Written 2026-09-30 at the end of the build session for plan 0005
(docs/research/0005-next-phase.md). The build is on branch `phase/0005-reaim`,
not pushed, not released. The state of each step is in "What is built" below;
read it before trusting any line of this file about a step.

## 1. Put the build in place (the owner's call)

The installed plugin comes from GitHub main (`~/.claude/plugins/known_marketplaces.json`
→ `1xmint/orchestrate`), which is still 0.17.2. A live session sees the new
build only after one of these, each the owner's decision:

- **Push the branch and open a draft pull request**, then install from it. The
  public route; it publishes the work.
- **Add this checkout as a local catalog** and install from it, from a terminal:
  `claude plugin marketplace add C:/Users/Josh/Desktop/GitHub/orchestrate`,
  then install `orchestrate` from that catalog. Nothing is published. Undo by
  removing the catalog and reinstalling from GitHub.

Either way, start a fresh session afterwards: a plugin installed mid-session is
not live in that session.

Then check that the session runs this build, before watching anything. The
build still says version 0.17.2, so an install can quietly reuse the cached
0.17.2 copy. Also, a local catalog has the same name as the GitHub one, and
that may clash. The check: the loaded plugin's
`skills/orchestrate/scripts/project.mjs` exists (0.17.2 has no such file), and
`node <that scripts dir>/install-project.mjs --dry-run` prints "Alongside
orchestrate". If either fails, stop: a watch of the old build measures nothing.

## 2. Watch it live

Same form as docs/audits/2026-09-30-live-session-notes.md: one note per thing
the plugin did, the exact line it wrote, what it did, and whether it helped.
Use a real goal in a real repo, not this one, if the owner has one.

Watch list, from what 0005 changed:
- **Project page.** The first helper that can write waits for
  `.orchestrator/PROJECT.md` with a filled Next. Does the lead clear it in one
  step and carry on? Does the page stay current, and does the three-turn note
  fire only when it lagged? Is it re-shown after a compaction and on "continue"?
- **False alarms gone.** Lines like the ones in live notes I, Q, R, T, U, V
  should pass silently: brand words in a grep or a file being written, prose
  about merging, a short prompt that names its brief file, a docs lookup that
  says "permission". Count any refusal that fires on words rather than on what
  runs.
- **Real dangers still stop.** Only if they come up naturally. Do not stage a
  payment or a merge to test the guard.
- **Records.** Return and dispatch joined, the OUTCOME flag, the checkpoint's
  test line, the gate read from CI, lead dollars in `measure.mjs` (step 3).
- **Diagnose first** (step 5, if built): on a bug, does the lead reproduce and
  name the cause with evidence before fixing, and report "cause: … evidence: …"?

## 3. Audit what is left

Run docs/scoresheet-audit-prompt.md as a fresh-context audit after the live
notes are written, with the new notes in its Part A. Ask it the same question
the owner asked before plan 0005: what, if rebuilt from scratch, would make
Claude itself work better for someone who does not code, not what would tidy
the plugin.

## 4. Rerun the comparison

Rerun the five cases from step 1 on the new build and compare against
docs/research/0005-baseline-0.17.2.md (raw numbers in evals/results/, kept out
of git). Same command per case:

    claude plugin eval evals --case <name> --trust-plugin --no-publish \
      --allow-tools Write Edit --scaffold

`misleading-bug` and `failed-check-report` need a shell. On this Windows
machine `claude plugin eval` refuses any shell grant ("Sandbox required but
unavailable"), so those two need Linux, macOS or WSL with the sandbox backend.
Run more than one pass per arm before reading a difference: the baseline was
one pass, and a 2-to-1 judge vote can flip.

## What is built

Filled in at the end of the build session; see the run ledger
`.orchestrator/runs/20260930-build-0005/RUN.md` (local, not in git) for detail.
Full gate on the branch at the end: 1229 pass, 0 fail; `evals/no-machinery` 14/0.

- **Step 0, docs answers**: done. docs/research/0005-step0-answers.md: what survives a
  compaction and on permission rules a plugin can ship.
- **Step 1, ability tests**: done. Five cases in `evals/`; the baseline is in
  docs/research/0005-baseline-0.17.2.md. Two cases were not run (no shell
  sandbox on Windows).
- **Step 2, checks read what runs**: on the branch, but its review did not
  pass cleanly. 0ed8ca8 was committed before its first review, and that review
  FAILED. Fix 19f1112 was reviewed twice. The first re-review was cut off by a
  safety classifier. The narrower re-review the owner chose then FAILED on two
  options that run a program (`rg --hostname-bin`, `git grep -O` grouped or
  shortened). Fix 2 (560de4b) closes both. Its first review FAILED on one test
  line that the old code already refused. That line was swapped, and all six new
  lines were run against the old and the new code. The second review PASSED,
  and the fix was merged as c1691ca. Optional notes from the reviewers, not
  acted on: `git add -e`, textconv and external diff set by config, `rg -z`,
  `RIPGREP_CONFIG_PATH`, `curl -K`.
  Nobody has done the open-ended hunt for new ways past the guard. Do it
  before a release.
- **Step 3, records right**: done (f5988be), each fix with its test.
- **Step 4, project page and visible plan**: done. Independent review PASS
  of 0fd416a, merged b8a1eea. `.orchestrator/PROJECT.md` (60-line cap) is
  created by `install-project.mjs` or `project.mjs init`. The first writing
  helper waits until its Next is filled. A Stop note fires after three edit
  turns without a page update. The page is re-shown after compaction and on
  "continue". Not checked: case-sensitive git (Linux, WSL), where turn-check
  passes a lowercased path to `git check-ignore`.
- **Step 5, diagnose first**: done (f48f62f). The routine is in the card,
  SKILL.md §5 and the plain style. It adds about 52 tokens always on (cap 100).
  Its ability test (misleading-bug) was not run: it needs a shell sandbox.
- **Step 6, alongside list**: done. README 86fceeb, installer output 782f65a.
