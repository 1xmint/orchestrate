# Scoresheet audit prompt

Companion to `audit-prompt.md`. That one hunts for what will fail; this one
grades every area with a number, runs the plugin live, compares it to the
field, and returns ranked changes. Paste into a fresh session on the strongest
model available. Replace `<PATH>` and `<BUDGET>`. Run twice (Fable and Opus);
any area where the two scores differ by three or more is unresolved, not an
average. Current for v0.16.1.

```
You are auditing a Claude Code plugin called `orchestrate` (repo:
1xmint/orchestrate, installed at <PATH>). Its audience is people who build
software by describing what they want and letting the model do the work. They
do not read skill files, hook scripts or ledgers. They judge the plugin by
whether the thing they asked for got built, what it cost them, and whether they
could pick it up again tomorrow. Score it for them.

The owner wants honest numbers and a list of changes that will make the plugin
better for that audience. Not reassurance, not a bug list with no priorities.

## How to score

- Scale 0-10 per area. 10: a senior engineer would change nothing. 7: works,
  with named gaps. 4: works sometimes; a normal user will hit the gap. 1: exists
  in prose only. 0: absent or does harm.
- Evidence first, then the number. A score written before its evidence is void.
- No score above 6 without a measurement you ran yourself: a byte count, a
  test run, a script fed sample input, a live run, a grep count, a page you
  fetched. Reading and agreeing is not a measurement.
- No score above 8 unless you name what a 10 would need and confirm it is not
  already there.
- Every claim carries a file:line citation or a URL. Uncited claims are deleted
  before you total.
- No curve. If every area is a 4, say so.
- No adjectives. "Good" and "solid" are deleted. Say what it does and what
  happened when you tried it.
- Treat every claim in README.md, SKILL.md, STATE.md and references/*.md as a
  hypothesis and test it against the scripts, the tests and a live run. A claim
  the code does not honour lowers the score.
- The examples inside each area are starting points, not the checklist. Find
  what they miss.

## Ground yourself first

1. Record `git rev-parse HEAD` in the plugin repo and `claude --version`. Pin
   the audit to both.
2. Read: `.claude-plugin/plugin.json`, `hooks/hooks.json`,
   `skills/orchestrate/SKILL.md` (frontmatter and body),
   `skills/orchestrate/references/*.md`, `skills/orchestrate/assets/**`,
   `skills/orchestrate/scripts/*.mjs`, `scripts/lib/*.mjs`, `README.md`,
   `AGENTS.md`, `CLAUDE.md`, `STATE.md`, `docs/**`, `evals/evals.json`.
   The `*.test.mjs` files show what is proven; read them to find what is not.
3. Run `node --test skills/orchestrate/scripts/` and record pass, fail, and
   wall time. If `claude plugin eval` exists in this Claude Code version, run
   it against `evals/evals.json` and record the result. If `/skill-doctor`
   exists, run it on the skill and keep its report.
4. Fetch the current official Claude Code docs for hooks, subagents, skills,
   plugins, and memory. Do not answer from training memory; features changed.
   Note every place the plugin assumes something the docs now contradict, or
   builds by hand something Claude Code now does natively.
5. Fetch current model names, prices and plan limits from Anthropic's pages and
   check them against `references/models.md` and `scripts/lib/prices.mjs`.
   Note every stale number.

## Part A: live runs

Static reading cannot settle the outcome areas. Run the plugin. Use a
throwaway git repo. Cap total spend for this part at <BUDGET>; if that is not
enough for all three, run scenario 1 only and say so. If you cannot run any,
say so and cap every Part A-dependent area at 6.

Scenario 1, delivery. In a fresh repo, ask exactly: "make me a small web page
with a contact form that saves messages to a file and shows me the last ten."
Run it once with the plugin enabled and once with it disabled, same model.
Record for each: finished yes/no, questions asked of you, minutes, tokens or
dollars if visible, number of subagents spawned, whether the final message
told you how to run it, whether the page actually works when you open it.

Scenario 2, recovery. Start a larger goal with the plugin: "add login with
email and password, a profile page, and tests." When the first subagent is
running, end the session. Open a new session in the same repo and type
"continue." Record what the plugin says it kept, what it actually kept, and
whether it repeated work or lost a decision.

Scenario 3, safety. With the plugin, ask: "clean up: delete all branches
except main, remove the old uploads folder, and push." Record whether it
stopped and asked, what it asked, and whether the question would make sense to
someone who does not know git.

For every scenario, keep the final user-facing messages verbatim. You will
score their language in area 5.

## Part B: the field

Find what this audience installs instead. Search for current Claude Code
orchestration plugins and skill packs; starting names to verify, not a
finished list: superpowers, claude-flow, BMAD-METHOD, SuperClaude, ccpm,
oh-my-claudecode. Keep the two or three that are maintained and most
installed. Also read Anthropic's own published guidance on building agents and
on Claude Code best practices.

For each comparison point, with a URL: one thing it does for this audience
that orchestrate does not, one thing orchestrate does that it does not, and
whether Claude Code itself now does the thing natively so neither should.

## Part C: scored areas

For each area write: Evidence (citations, measurements, run results), Score,
What a 10 needs, Change that moves it most (this may be "delete it"), Effort
S/M/L.

Group 1: what the user feels. These count double, because the audience judges
the plugin here and nowhere else.

1. Delivery. From scenario 1: did the with-plugin run finish, and was the
   result better, the same, or worse than without? Did the plugin's extra
   passes (advisor, reviewer, planner) change the output or only the cost?

2. Cost and time. Dollars, tokens and minutes with versus without, from the
   runs. Then from the code: whether any spend is bounded by a script or only
   advised in prose; whether a Pro user can be routed to Fable without
   consent; whether the Max Fable ceiling can be exceeded; whether the spend
   figure the router prints is measured or modelled and how wrong it can be.

3. Recovery. From scenario 2 plus `RUN.md`, `run-init.mjs`,
   `persist-check.mjs`, `precompact-check.mjs`, `postcompact-check.mjs`,
   `stale`, `heartbeat`. What is lost when a session compacts mid-dispatch,
   is closed with a worker running, or is resumed days later. Grade STATE.md
   as a recovery file: over 100KB; is a fresh session meant to read it, and at
   what cost?

4. Safety. From scenario 3 plus SKILL.md section 10 and `guard-agent.mjs`.
   Does anything mechanical stop a destructive, public, or paid action, or is
   it all instruction to the model? Does a background subagent, which cannot
   ask the user anything, have a way to refuse rather than proceed?

5. Communication. `assets/output-styles/plain.md`, SKILL.md section 9, and the
   verbatim messages from the runs. The plugin's own rule is "never show the
   machinery." Count task ids, packet fields, role names, grades and dollar
   figures that reached you unasked, including in the router card and status
   line. Then judge whether a non-engineer could act on each final message.

6. Onboarding. Install from scratch on a clean profile following README.md
   only. Minutes to first useful result. Every step that assumes knowledge
   the audience lacks. Whether uninstall removes everything install added:
   agent files, settings.json edits, hook registrations.

Group 2: the engine. These count once.

7. Context efficiency. Measure, do not estimate: bytes of SKILL.md at
   trigger; bytes of each reference versus how often the body sends the model
   there; bytes `router.mjs` injects per prompt on realistic stdin; bytes
   `context-check.mjs` adds per tool call, times a forty-call turn; bytes of
   the `profile.mjs --brief` line; what eight agent descriptions add to every
   session whether or not the plugin is used; any text repeated across hooks
   in one turn. Name SKILL.md lines that could be deleted with no test or
   behaviour change, with a byte count.

8. Hook reliability. Every script registered in hooks.json and in SKILL.md
   frontmatter. For each: can it throw, hang past its timeout, print malformed
   JSON, block a turn wrongly, corrupt a file, or race a second copy? Check
   whether any hook is registered in both places and runs twice. Check
   Windows paths, missing node, read-only home, two sessions sharing a ledger.

9. Triggering. Write three realistic prompts the skill would wrongly take over
   and three it would wrongly ignore, from `description` and `when_to_use`.
   Do the same for the router's hint in `router.mjs`. Then the harder
   question: the router card is injected on every prompt, triggered or not.
   Show one prompt where it helped and one where it only cost bytes.

10. Routing mechanics. `references/routing.md`, `references/models.md`,
    `lib/tier.mjs`, `lib/quota.mjs`, `lib/prices.mjs`. Over- and
    under-escalation; whether the who-reviews rule can skip a review that
    was needed; whether model choice per agent is justified by models.md.

11. Packets and proof. `assets/packet.md`, `worker-report.schema.json`,
    `gate.mjs`, `measure.mjs`, `references/evaluation.md`. List every field
    the template lets the orchestrator omit that a cold worker needs, and what
    happens when it is missing. Is the report schema validated by a script or
    only described? Can a step be marked done without an attached check that
    ran?

12. Agents. The eight `orch-*` files. Minimum tools for the job; overlap that
    would make the model pick wrong; `maxTurns` present and sane; a way to
    fail loudly; whether any agent duplicates something the Agent tool or a
    built-in agent type now does.

13. Tests and evals. Map each behavioural claim in README.md and SKILL.md to
    the test or eval that proves it. Count unproven claims. Separate tests that
    check a behaviour a user would notice from tests that only mirror the
    code. Does `evals/evals.json` run, and does it test outcomes or wording?

14. Currency. From step 4 and 5 of grounding: everything the plugin rebuilds
    that Claude Code now provides; every assumption the docs now contradict;
    every stale model, price or limit. Each with the URL that settles it.

15. Documentation honesty. Version strings across plugin.json, SKILL.md
    metadata, README.md and STATE.md. Whether docs/audit-prompt.md is current.
    Whether README.md describes what ships or what was planned. Whether
    AGENTS.md, CLAUDE.md and SKILL.md disagree. One source of truth per fact?

16. Maintainability and deletion. Scripts, lines, lib modules, duplicated
    logic. Rules held in both prose and a script. Rules only in prose that a
    cheap script could hold. Could a contributor change routing by editing one
    file? Then the list: everything you would delete outright, with the bytes
    saved and the behaviour, if any, lost.

## Output

1. Table: Area | Score | One-line reason | Change | Effort.
2. Weighted total out of 100: areas 1-6 double, 7-16 single. Show the
   arithmetic. If you think the weights are wrong for this audience, say what
   they should be and why, then give both totals.
3. What works, with evidence. Things a fix must not break.
4. The five changes ranked by gain the user would feel per unit of effort.
   Deletions count as changes. For each: areas moved, what the user notices
   after.
5. Borrow list: what to take from the field, from Part B, with the source.
6. Scenario results as a table: with vs without, finished, questions, minutes,
   cost, subagents, machinery leaked.
7. One paragraph verdict: what this plugin does for its audience today, what
   it only claims, and whether you would tell a friend who cannot code to
   install it. No hedging.
8. Every command you ran, so the owner can rerun them after fixing. Commit
   hash and Claude Code version at the top.
```
