# 0004 — Loops and stopping: when to keep going, when to stop, when not to re-verify

Task 9-9-0004. Researcher: orch-researcher on Sonnet. All URLs read 2026-09-09
unless marked otherwise. Builds on docs/research/0001 (Opus 5 over-verification
quote, framework survey), 0002 (effort mechanics), 0003 (knows-but-violates,
the Compliance Gap, instruction-count degradation, verbalised confidence) —
none of those sources are re-quoted here as new findings.

## (a) Iterative refinement loops: when they help, when they burn tokens

**Grade: CHECKED, with a genuine unresolved disagreement in the literature.**

The clean split is: self-correction **without** an external signal is
unreliable and sometimes actively harmful; refinement **with** an external
oracle (tests, execution, a tool result) is where the gains are real and
named.

**Made it worse (no external feedback, the counterexample):**
Huang et al., "Large Language Models Cannot Self-Correct Reasoning Yet"
(ICLR 2024, arXiv 2310.01798, read 2026-09-09): "LLMs struggle to
self-correct their responses without external feedback, and at times,
their performance even degrades after self-correction." This is intrinsic
self-correction on reasoning tasks (math, commonsense) — the model critiques
and revises its own answer with no tool, test, or grader in the loop.

**Helped, oracle named (the counter-counterexample):**
Shinn et al., "Reflexion" (arXiv 2303.11366, read 2026-09-09): "Reflexion
agents verbally reflect on task feedback signals, then maintain their own
reflective text in an episodic memory buffer" and explicitly support
"external or internally simulated" feedback sources. On HumanEval (coding,
oracle = code execution / test results), Reflexion reports 91% pass@1 versus
GPT-4's 80% single-pass baseline — an 11-point gain, with the oracle being
the interpreter/test suite, not the model's own opinion of its work.

**The unresolved disagreement:** Madaan et al., "Self-Refine" (arXiv
2303.17651, read 2026-09-09) reports the opposite of Huang et al. using
*only* self-generated feedback (no external oracle): "~20% absolute
improvement" across seven tasks (dialogue, code optimization, sentiment
reversal, etc.) versus single-pass generation, "with human evaluators and
automatic metrics preferring the refined outputs." Both papers are
peer-reviewed (Self-Refine at NeurIPS 2023, Huang et al. at ICLR 2024) and
both use self-feedback with no external oracle. The difference is task type:
Self-Refine's tasks are generation/style tasks with fuzzy, human-judged
quality; Huang et al.'s are reasoning tasks with a single correct answer.
**Stated, not smoothed:** self-feedback-only refinement looks like it helps
on open-ended generation and looks like it hurts on constrained reasoning —
nobody has reconciled this across both papers, and the orchestrator should
not assume either result transfers to the other kind of task.

**A third data point, in between:** Feedback Friction (arXiv 2506.11930,
read 2026-09-09), even with *external, correct* feedback: "solver models
consistently show resistance to feedback" and "high-confidence predictions
remain resistant to external correction" — so external feedback loops raise
the floor but do not close the gap to ceiling performance; a model that is
confidently wrong resists being told so even by a real oracle.

**Vendor guidance on the pattern itself:** Anthropic, "Building effective
agents" (https://www.anthropic.com/engineering/building-effective-agents,
read 2026-09-09), on the evaluator-optimizer workflow: "This workflow is
particularly effective when we have clear evaluation criteria, and when
iterative refinement provides measurable value," conditioned on both "LLM
responses can be demonstrably improved when a human articulates their
feedback" and "the LLM can provide such feedback." No stopping-rule or
diminishing-returns guidance appears on that page for this workflow
specifically (see (b)).

**What this means:** a loop with no external check (tests, a verifier
model with its own criteria, a tool result) is gambling on task type; a
loop anchored to an oracle is the one with a named, measured win. This is
consistent with the skill's own rule (`evaluation.md` §2: "Filter first,
delegate second," gate commands as the check) and with Anthropic's Opus 5
guidance in (e) below.

## (b) Stopping rules that work

**Grade: CHECKED (vendor default), GAP (no measured diminishing-returns
threshold found published).**

Anthropic's baseline rule, stated plainly: "Building effective agents"
(same URL, read 2026-09-09): "The task often terminates upon completion,
but it's also common to include stopping conditions (such as a maximum
number of iterations) to maintain control." That is an attempt cap, not a
diminishing-returns test — Anthropic does not publish a "stop when the
next iteration's expected gain drops below X" rule anywhere I found.

**The cap is real and shipped, but blunt.** Claude Code CLI reference
(https://code.claude.com/docs/en/cli-reference, read 2026-09-09):
`--max-turns`, "Limit the number of agentic turns (print mode only). Exits
with an error when the limit is reached. No limit by default," and
`--max-budget-usd`, "Maximum dollar amount to spend on API calls before
stopping (print mode only). Spend from subagents counts toward the cap ...
Once spend reaches the cap, spawning another subagent fails with 'Budget
limit reached'... requires Claude Code v2.1.217 or later." Both are counts
(turns, dollars), not a measured-gain test.

**Anthropic declined to build smarter loop detection.** GitHub
anthropics/claude-code issue #4277, "Feature Request: Implement Agentic
Loop Detection Service to Prevent Repetitive Actions" (created 2025-07-24,
read 2026-09-09): proposed flagging "the same tool with same arguments...
more than 5 consecutive times" or "the same sentence... more than 10
consecutive times" and halting, explicitly framed as "more intelligent
than the existing `--max-turns` flag, which is a brute-force approach."
**Status: closed as not planned.** The vendor's answer to runaway-loop
detection today is the blunt cap, not pattern detection, and this is a
decision, not an oversight (the request named the exact mechanism and was
declined).

**The community built what Anthropic didn't ship.** frankbria/ralph-claude-code
(https://github.com/frankbria/ralph-claude-code, read 2026-09-09) layers a
circuit breaker on top of the raw Ralph loop: "Open circuit after 3 loops
with no progress or 5 loops with same errors," a dual-condition exit gate
requiring "`completion_indicators >= 2`" (a regex/heuristic over the
model's own text) **and** the model's own "`EXIT_SIGNAL: true`," plus "force
exit after 5 consecutive completion indicators" as a backstop. This is a
diminishing-returns proxy (no progress N times → stop) built by a third
party because the platform doesn't provide one.

**The skill's own rule, for comparison (repo fact, not a new external
finding, per the packet):** `skills/orchestrate/references/evaluation.md`
§6: "Never resend the same packet. Three attempts per task, then stop and
report with the evidence and the failure class." §9: "Before a second
research wave, name the measurable thing that could change; if nothing
could, stop." This "name what could change" test is **not** something I
found stated this way in any vendor doc or paper; it is closer to a value-
of-information stopping rule than anything published. I looked for a
published equivalent (decision-theoretic VoI framing applied to agent
loops) and did not find one in the sources reachable today — **GAP**, not
because it's wrong, but because there is no external validation to cite
for it either way.

**What actually stops runs in the wild, per the record above:** a hard
count (turns or dollars), a text-pattern heuristic over the model's own
narration (not a real understanding of progress), or a human watching
`/usage` and hitting Esc. Nothing found combines "stop when the expected
gain of another iteration is below a threshold" with a live measurement of
that gain — every stopping rule found is a proxy for it.

## (c) Graph/state-machine orchestration vs. a flat on-disk task ledger

**Grade: CHECKED.**

**What checkpointed graph state buys, in the vendor's own words.** LangGraph
persistence docs (https://docs.langchain.com/oss/python/langgraph/persistence,
read 2026-09-09): checkpoints enable "conversation continuity,
human-in-the-loop workflows, time travel, and fault tolerance," letting an
agent "continue a conversation, resume after an interruption, recover from
a failure, or remember information across interactions."

**What it costs, same page:** "Over long conversations, checkpoints
accumulate. This can increase latency and storage costs," with the fix
being manual pruning/retention policy — the state layer is not free to
keep, it needs its own upkeep.

**When the graph earns its cost, a dated secondary source:** JetThoughts,
"Mastering LangGraph" (https://jetthoughts.com/blog/langgraph-workflows-state-machines-ai-agents/,
published 2025-10-15, read 2026-09-09): "For a single agent doing a single
task, LangGraph is overkill — a plain LangChain chain is the right
answer," and "the break-even is somewhere around two agents, three
branching decisions, or any flow where a partial run is more valuable [than
a failed run]," trading "some flexibility for explicit structure." This is
a blog, not a vendor page — labelled as secondary, used only because it
names a concrete break-even threshold that no primary doc supplies.

**Anthropic's own bias against framework weight, stated generally (not
about LangGraph specifically):** "Building effective agents" (same URL as
above, read 2026-09-09): "We suggest that developers start by using LLM
APIs directly: many patterns can be implemented in a few lines of code,"
because frameworks "often create extra layers of abstraction that can
obscure the underlying prompts and responses, making them harder to
debug," and "can also make it tempting to add complexity when a simpler
setup would suffice." The page does not address checkpointing/state
specifically — this is a general framework caution, not a verdict on
LangGraph's persistence layer.

**The flat-ledger side, from a primary community artifact treated as a
design document, not a paper:** humanlayer/12-factor-agents
(https://github.com/humanlayer/12-factor-agents, read 2026-09-09). Factor 3,
"Own your context window": manage the context directly rather than
delegating it to a framework. Factor 12, "Make your agent a stateless
reducer": treat each step as a transformation over one flat data structure
rather than framework-managed internal state. Its stated philosophy is to
take "small, modular concepts... into their existing product" instead of
adopting a heavy orchestration framework wholesale.

**Reconciling the two sides, stated not smoothed:** LangGraph's own docs
and the JetThoughts piece agree state machines pay off once there are
multiple agents, real branching, or partial-completion value worth
recovering — exactly the "fault tolerance, time travel" list. 12-factor-agents
and Anthropic's general framework caution agree that below that
threshold, a framework's state machinery is overhead you maintain (the
"checkpoints accumulate" cost LangGraph names) for a problem a flat file
does not have, because a flat, human-readable ledger already gives
"resume after interruption" for free (it's just a file) without the
prune/retention-policy tax LangGraph's own docs admit to. Nobody's data
settles the exact break-even number; the JetThoughts "two agents, three
branches" figure is one blogger's rule of thumb, not a measurement — graded
OBSERVED, not PROVED.

## (d) What Claude Code users report in 2026: loops and workflow tools

**Grade: OBSERVED (first-hand reports), CHECKED (vendor decisions in the
record).**

**Ralph loops: works with heavy upfront prep, burns tokens without it.**
"A Brief History of Ralph," HN thread (https://news.ycombinator.com/item?id=46682325,
read 2026-09-09). The mechanism, quoted by a commenter: "Ralph is literally
just this: `while :; do cat PROMPT.md | npx --yes @sourcegraph/amp; done`"
(wild_egg). What works: "It works reasonably well so long as you do the
prep upfront and prepare a decent spec and plan" (Veen); one report of
"ran unattended for 24 hours before solving the bug" (jes5199, an
integration-test case). What doesn't: "It does not seem to work any harder
than it did without the ralph loop," with the model prematurely declaring
tasks complete (odie5533) — a stopping-rule failure, not a capability one.
Cost complaint: "an effective way to spend tokens prodigiously"
(realityfactchex); a massive plan file causing "a lot of wasted parsing"
(shanewwarren). The technique's own author: "I don't think anyone serious
would recommend it for serious production systems," calling it "a
fascinating learning exercise in understanding llm context windows"
(dhorthy).

**The gap Anthropic left open, users filled.** As in (b): issue #4277
(loop-detection feature) closed not planned; frankbria/ralph-claude-code
built its own circuit breaker (3-loops-no-progress / 5-loops-same-error)
and dual-condition exit gate because the platform doesn't supply one. Read
together with the HN thread's "premature completion" and "spend tokens
prodigiously" complaints, the pattern is: users doing unattended loops
build their own stopping heuristics because Claude Code's is a blunt count
(`--max-turns`, `--max-budget-usd`), and even those two flags were, per
GitHub issue #16963 (title: "--max-turns CLI option is undocumented in
--help and official documentation," read 2026-09-09), hard to discover for
a period — they are documented now (confirmed live, cli-reference fetch
today), but the discoverability complaint is itself a 2026 user report.

**ultracode: one dated report of a bad outcome, not independently confirmed.**
A secondary blog headline, "Claude's UltraCode Burned 1.7M Tokens With No
Output" (aiproductivity.ai — the page itself returned HTTP 410 Gone on a
direct fetch today, 2026-09-09, so this rests on the WebSearch tool's cached
summary only, not a page I could read myself): the summary describes "a
failure loop" that "keeps consuming tokens while contributing nothing" and
states Anthropic's no-refund policy covers this case. **Grade for this
specific claim: SPECULATION** — the source page is gone and I could not
verify the summary against the original text. It is included because it is
consistent with the mechanism already CHECKED above (no built-in loop
detection, `ultracode` runs every task at `xhigh` per 0001/0002's E13), not
because the number itself is confirmed.

**Agent Teams: still experimental.** Not independently re-confirmed today
beyond what 0002's E8 already established (`https://code.claude.com/docs/en/agent-teams`:
"Teammates inherit the lead's effort level," and 0001 notes teams are "CLI
only and off by default"). No new 2026 user report of agent-teams-specific
cost or failure found that I could trace to a live, fetchable primary or a
dated post I could open — **GAP** on this one sub-item specifically.

**`/goal` and `/batch`: covered in 0001, not re-litigated here.** 0001
already established `/goal` is "a wrapper around a session-scoped
prompt-based Stop hook" and that both `/goal` and `ultracode`'s keyword
"are opt-in only in a prompt you type yourself" — no counter-evidence
found today.

## (e) The over-verification failure

**Grade: PROVED (Anthropic's own current page), CHECKED (independent paper
converges on the same number-shaped claim).**

**Primary, fetched fresh today, full page.** "Prompting Claude Opus 5"
(https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5,
read 2026-09-09), section "Task scope and over-verification": "Claude Opus
5 verifies its own work without being told to. If your prompt contains
explicit verification instructions ('include a final verification step for
any non-trivial task,' 'use a subagent to verify'), remove them:
instructions like these cause over-verification on Claude Opus 5, and
removing them reduces wasted tokens with no loss in quality." Section
"Self-correction": "Claude Opus 5 catches and fixes its own mistakes well
without prompting. Avoid instructing re-checks it already performs
('double-check your answer,' 're-verify before responding'); like
verification instructions, these compound with the model's own behavior
and add cost without improving results." Section "Controlling subagent
spawning": "do not use subagents to verify or double-check your own work"
is the example instruction given for narrow tasks. This is the exact
wording current as of today's fetch; unchanged in substance from what 0001
quoted, confirmed live rather than assumed stale.

**Fable 5.1's page does not carry the same section — a real, dated gap,
not smoothed over.** "Prompting Claude Fable 5.1"
(https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5-1,
read 2026-09-09, full page fetched): there is no "over-verification" or
"self-correction" section at all. The closest analogue is "Keep changes
and tests to what the task asks for," which is about *scope creep*
(fixing nearby bugs, adding extra tests) — not about re-verifying settled
facts or re-checking its own already-correct answer. Fable 5.1's page does
warn the *opposite* direction at low effort: "Search triggering at low
effort" — "Claude Fable 5.1 is less likely... to call a search or
retrieval tool, and more likely to answer from memory" — i.e., Fable 5.1's
documented risk at low effort is *under*-verification, not over-
verification. **Disagreement stated:** the two current Anthropic pages
describe opposite risk profiles for their respective models (Opus 5:
over-checks by default; Fable 5.1 at low effort: under-checks by default).
Both are current (read today); neither supersedes the other — they are
model-specific, and an orchestrator switching models must not carry the
same anti-verification instruction across both without checking which
model is in the chair.

**Independent measurement of the same phenomenon, converging with
Anthropic's claim.** "Self-Verification Dilemma: Experience-Driven
Suppression of Overused Checking in LLM Reasoning" (arXiv 2602.03485,
published 2026-02-03, read 2026-09-09): finds that in long reasoning
traces, "a substantial fraction of reflective steps consist of
self-verification (recheck) that repeatedly confirm intermediate results,"
that these rechecks are "the vast majority... confirmatory rather than
corrective, rarely identifying errors and altering reasoning outcomes,"
and that suppressing the unneeded ones "reduces token usage up to 20.3%
while maintaining the accuracy, and in some datasets even yields accuracy
improvements." This is an independent, dated, peer-reviewable measurement
that matches Anthropic's un-measured claim ("removing them reduces wasted
tokens with no loss in quality") almost exactly, from a different
research group and a different angle (reasoning traces, not agentic coding
tasks). Two independent sources agreeing raises this from a vendor claim to
**PROVED as a general phenomenon** (self-verification is mostly
confirmatory, not corrective, and removable without cost) — though neither
source measures it on an *agentic orchestration loop* specifically, only on
single-turn reasoning traces (2602.03485) or general agentic prompting
guidance (Opus 5 page, no numbers given). CONDITIONAL on: this generalizing
to a multi-turn dispatch-and-grade orchestrator, which nobody has measured.

**"Proving something nobody asked" / "answering a different question":**
these two specific failure shapes are covered by 0003's already-established
sources (instruction-count degradation, arXiv 2510.14842; knows-but-violates,
arXiv 2604.28031) and by the Opus 5 page's own "Task scope" section quoted
above ("Claude Opus 5 can also expand the scope of a task, adding steps
that weren't requested or applying its own judgment about what the task
should be"). Not re-derived here as new findings, per the packet's
instruction not to repeat 0003's sources — cited only to note that (e)'s
third failure shape (scope drift) is the *same* mechanism Opus 5's own page
names, not a separate phenomenon requiring new evidence.

## What this means for a one-conversation orchestrator on a Claude subscription

1. Never add "verify," "double-check," or "use a subagent to verify" to a
   packet for Opus 5 — (e), PROVED twice over, independently.
2. Do the opposite on Fable 5.1 at low effort: nudge it to search, not to
   stop checking — (e), current Fable 5.1 page, dated today.
3. A refinement loop with no external check (test, tool result, real
   grader) is a coin flip by task type; only dispatch a "keep refining"
   loop when an oracle exists — (a), Huang vs. Self-Refine vs. Reflexion.
4. Even with a real oracle, expect resistance on high-confidence wrong
   answers, not a clean fix — (a), Feedback Friction.
5. There is no vendor-published diminishing-returns stopping rule; the
   only shipped stopping tools are blunt counts (`--max-turns`,
   `--max-budget-usd`) — (b), CHECKED.
6. Anthropic declined to build loop-pattern detection; do not assume the
   host will catch a stuck agent — (b), issue #4277 closed not planned.
7. The skill's "name what could change or stop" rule (`evaluation.md` §9)
   has no published external validation either way — treat it as the
   orchestrator's own judgment call, not a proven technique — (b), GAP.
8. Unattended loops (Ralph-style) need a spec and plan written up front or
   they burn tokens without working harder — (d), HN thread quotes.
9. A flat on-disk ledger is enough until there are genuinely independent
   parallel tracks, real branching, or a partial run has value worth
   recovering; below that, graph-checkpoint state is overhead with its own
   accumulation cost — (c), LangGraph docs + 12-factor-agents.
10. Do not carry a verification-off instruction across a model switch
    without re-checking that model's own prompting page — (e), the Opus
    5 / Fable 5.1 disagreement.

## Not verified

- The exact false-positive/negative rate of any stopping heuristic in
  production Claude Code use — no source measures this.
- Whether the "ultracode burned 1.7M tokens" report is accurate; the
  source page is gone (410) and only a search-tool summary was readable.
- Any 2026 first-hand report specific to Agent Teams' cost or failure
  modes beyond the docs already cited in 0002.
- Whether Self-Refine's ~20% gain would hold on reasoning-type tasks
  (its seven benchmarks are generation/style tasks, not the reasoning
  tasks Huang et al. tested) — the two papers were not run on the same
  benchmark suite, so the disagreement in (a) may be partly a
  task-domain artifact rather than a true contradiction; nobody has run
  both methods on both domains to check.
- The LangChain "State of Agent Engineering" 60%-of-incidents statistic
  mentioned by a search-engine synthesis was not traced to a primary
  report; not used as a finding above for that reason.

## Stop condition

Met: every one of (a)-(e) carries at least one primary or independently
converging source with a dated quote, and two genuine disagreements (a:
Self-Refine vs. Huang et al.; e: Opus 5 vs. Fable 5.1 pages) are stated
rather than resolved. Further searching would not change (e)'s grade
(two independent primaries already agree) or (b)'s GAP (the absence of a
published diminishing-returns rule is itself the finding). It could still
change (d)'s Agent Teams gap and the ultracode number, but those are
narrow and do not change the orchestrator guidance in the final section.

Confidence: high on (b) and (e) (primary docs plus a converging paper);
medium on (a) (real, stated disagreement between two peer-reviewed papers,
not resolved); medium on (c) (one dated blog's break-even number is a
rule of thumb, not a measurement); medium-low on (d) (one unconfirmed
secondary claim flagged as SPECULATION, one sub-item left as GAP). What
would change it: a primary Anthropic statement reconciling Fable 5.1's
verification posture with Opus 5's, a working link or archive for the
ultracode report, or any published measurement of a diminishing-returns
stopping rule on a real multi-turn orchestrator.
