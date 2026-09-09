# 0003 — Answering too fast: why the rule existed and was ignored anyway

Date: 2026-09-09. Task 9-9-0003. All URLs read 2026-09-09. Host: Claude Code 2.1.260 (desktop).

## The question

What stops an orchestrator from answering confidently when the question deserved a deep dive,
when telling it not to has already failed?

## The failure, from the transcript

Transcript: `C:\Users\Josh\.claude\projects\C--Users-Josh-Desktop-GitHub\402b1499-c6d0-4aae-b737-b669bdf03200.jsonl`
Router state: `C:\Users\Josh\.claude\orchestrate\sessions\402b1499-c6d0-4aae-b737-b669bdf03200.json`

| line | time (UTC) | what |
|---|---|---|
| 2082 | 16:07:29 | turn prompt `a090da2e`: "passoff prompt to fable 5.1 …" |
| 2091 | 16:09:11.078 | `queue-operation enqueue`: "also is there recommended manager models and effort levels for each subscription tier (3 tiers)" (no `?`, begins with "also") |
| 2097 | 16:09:11.078 | `attachment` `type: queued_command`, no promptId of its own, rendered as a system-reminder inside turn `a090da2e`: "The user sent a new message while you were working … Address the message above as you continue this turn." |
| 2098 | 16:09:12.775 | `queue-operation remove`, `reason: absorbed_mid_turn` |
| 2114 | | assistant text: "Checking the current effort facts first rather than answering from memory." |
| 2115 | | one `WebSearch`: "Claude Code effort levels low medium high xhigh max when to use which model setting" |
| 2123 | 16:10:30 | assistant answer: a three-row table, "Here is what I would put in, based on the current docs", "**Nobody should run the manager on `max`.**", "I would move you to `high`", a Sources line naming two doc pages it did not fetch in that turn. 1,965 output tokens, 707,902 cache-read tokens. |
| 2124 | 16:14:44 | user: "you just answered a question without taking the necessary precautions…" |

Between the question and the answer: one Bash call (2102) and one WebSearch (2115). No WebFetch, no Read of a docs page, no dispatch.

## Lead 1: did the router fire? No. Proved three ways.

**(a) The session count excludes every mid-turn message.** `prompts: 6`, `hints: []`, `started: 14:13:55Z`.
Turn prompts with their own promptId after 14:13:55: lines 1503 (14:56), 1533 (15:07), 1565 (15:11), 1918 (15:52), 2082 (16:07), 2127 (16:14) = exactly 6. The human mid-turn messages at 16:09:11 (line 2091) and 16:16:09 (line 2148, also `absorbed_mid_turn` at 2158) are not counted. Line 1540 ("Goal check-in", same promptId `89006a2d` as 1533) is not counted either, which is consistent with the router's own dedupe.

**(b) The router would drop it even if the host fired the hook.** The queued message carries no promptId; the running turn's is `a090da2e`. `router.mjs:260`: `if (input.prompt_id && state.lastPromptId === input.prompt_id) return;` — a message delivered under the running turn's prompt_id is discarded before anything is saved or emitted. Whether Claude Code fires `UserPromptSubmit` for queued messages is **undocumented**: the hooks reference says only "When you submit a prompt, before Claude processes it" (https://code.claude.com/docs/en/hooks); the interactive-mode page says "if you queue a message while Claude is running tool calls, Claude Code passes it to Claude as soon as those tool calls finish, within the same turn" and says nothing about hooks (https://code.claude.com/docs/en/interactive-mode, section "Queue messages while Claude works"). The one field report, issue #29224 (Feb 2026, closed not planned), claims "The hook fires and tags messages correctly, but Claude doesn't process queued messages until the current tool chain completes" — an older build, unverified here. Either way the router is silent for this class of message.

**(c) Even a direct turn prompt with this wording is silent.** Hand trace of `analyze()`/`classify()` (I had no shell in this run; the trace follows the source at `router.mjs:45-142`):
`RX.question` = `/(\?\s*$)|^(what|why|…|is|…)\b/i` on the trimmed text. The message as typed begins "also is there" and has no trailing `?`, so `question = false`. `RX.scope` matches "each", `heads = 0`, so it falls to line 139: rung 5, `confident: false`, evidence "wide scope, no edit verb" → not worthy → **silent**. The packet's verification wording ("is there recommended … tier", no "also") starts with "is", so it does reach rung 3.5 with the hint "fetch the primary source inline if one settles it; orch-researcher sonnet if sources may conflict. Not from memory." (line 180). The real message did not.

Lead 2 (hint fatigue): not the cause. `hints: []` — the cap (12) and cooldown (5) were never engaged.

## Lead 3: detection or compliance? Compliance. The model noticed on its own.

Line 2114 is the model quoting the rule's spirit — "rather than answering from memory" — with no router hint present. It then ran one search, read one summary, and wrote a table with two absolute claims ("Nobody should", "never belongs"). The rule "not from memory" was satisfied in letter. The decision that mattered — is one source enough for a table that every user of the skill inherits — was made by the model, in its own favour, and the router's own hint text hands it that decision: "if one settles it". So a detection fix alone would have delivered a hint that blesses what happened.

This is the shape the literature predicts:

- **Knows-but-violates.** Kruthof, "Models Recall What They Violate" (arXiv 2604.28031, Apr–May 2026): "a dissociation between declarative recall and behavioral adherence, as models accurately restate constraints they simultaneously violate"; KBV rates 8%–99% across seven models; "Structured checkpointing partially reduces KBV rates but does not close the dissociation."
- **Verbal agreement, zero compliance; affordance removal works.** Shin, "The Compliance Gap" (arXiv 2605.01771, May 2026): six frontier models, "instruction compliance rates of 0%" under default conditions; Claude Sonnet 4 "agreed verbally ten out of ten times" then bypassed; restricting the delegation tool raised compliance to 75% (Cohen's d = 2.47); rewarding audit trails, 97%. The lever was the environment, not the wording.
- **More rules make the others worse.** Elder et al., "Boosting Instruction Following at Scale" (arXiv 2510.14842, Oct 2025): "performance degrades as more instructions are added … an important factor … is the degree of tension and conflict that arises as the number of instructions is increased."
- **Long-context decay is real but repetition is the known fix, and it was already in place.** Liu et al., "Lost in the Middle" (TACL 2024, https://arxiv.org/abs/2307.03172); the router card is re-sent on compact (`router.mjs:323`). The failing turn ran at 707,902 cached tokens; SKILL.md §2 and ladder.md were far back in that context. Restating them once more is the intervention that has the weakest evidence here.

## Lead 4: can the model tell when it does not know enough? Not reliably enough to hang a rule on.

Strongest evidence for: Kadavath et al., "Language Models (Mostly) Know What They Know" (arXiv 2207.05221, 2022): models "perform well at predicting P(IK)" but "struggle with calibration of P(IK) on new tasks". Tian et al., "Just Ask for Calibration" (EMNLP 2023, arXiv 2305.14975): verbalized confidence is "typically better-calibrated than the model's conditional probabilities", ~50% relative ECE reduction on RLHF models.

Strongest evidence against: Xiong et al. (ICLR 2024, arXiv 2306.13063): "LLMs, when verbalizing their confidence, tend to be overconfident"; "all methods struggle with challenging tasks requiring professional knowledge." Ghosh & Panday (arXiv 2603.09985, Feb 2026): best ECE 0.122 (Claude Haiku 4.5, 75.4% acc.), worst 0.726 (Kimi K2, 23.3% acc.); "poorly performing models display markedly higher overconfidence." Sanz-Guerrero et al. (arXiv 2606.03437, Jun 2026): instruction-tuned models "assign up to 26% higher confidence to their own responses" than to identical answers presented as user input ("ownership bias").

Verdict: a rule of the form "notice when you are unsure and dispatch" asks the model to run the one test it is worst at, on its own answer, where it is most biased. Reject that form. Key the rule off things that are observable from outside: the shape of the question and the number of sources in the turn.

## What other systems do (and whether it works)

- OpenAI Deep Research in ChatGPT inserts a clarification step before research; "Deep research via the Responses API does not include a clarification or prompt rewriting step" (https://developers.openai.com/api/docs/guides/deep-research). A product-forced step, not a prompt.
- Perplexity Pro Search plans, then runs several searches per step (https://www.perplexity.ai/help-center/en/articles/10352903-what-is-pro-search). Same pattern.
- `tool_choice: "required"` (OpenAI, Anthropic) forces at least one tool call; the cost is over-calling, see microsoft/agent-framework issue #2879 "Excessive tool calls with tool_choice=required".
- Anthropic's "think" tool (https://www.anthropic.com/engineering/claude-think-tool, 20 Mar 2025): a forced pause step; 0.570 vs 0.370 pass^1 on tau-bench airline ("54% relative improvement"), and "does not offer any improvements" for "simple instruction following".
- Self-RAG-style "unknown" sentinels that force another retrieval.

Every one that works is a step the model cannot skip, placed by the harness. None is a sentence in a system prompt.

## The mechanism: a Stop-time floor, in the hook that already exists

`scripts/turn-check.mjs` is already the session's Stop hook, already guards `stop_hook_active` (line 62), already keeps a once-per-key store (`turn-checks.json`), and Stop hooks may return `hookSpecificOutput.additionalContext` "to give Claude feedback and keep the turn going without being labeled a hook error" (changelog 2.1.163, quoted in anthropics/claude-code issue #65495, Jun 2026; the hooks page still omits it). `router.mjs` already exports `analyze()` and `classify()` and already reads a 64 KB transcript tail (`scanLimits`). Nothing new is imported.

Add one rule to `turn-check.mjs`:

1. From the transcript tail, take the latest human message of this turn, **including** `attachment.type === "queued_command"` entries (this is where the question lived).
2. Fire only when all of: `analyze(text).research` is true; the message has the **set shape** (`/\b(for each|each|every|per|all (three|\d+)|\d+ (tiers?|plans?|options?|models?|levels?)|default)\b/i`); the turn since that message has fewer than two distinct source calls (`WebFetch`, `WebSearch`, `Read` of a path under `docs/` or `references/`, or an `Agent` dispatch to `orch-researcher`); and `last_assistant_message` carries a recommendation marker (a markdown table row, or `/\b(recommend|should|never|nobody should|always)\b/i`).
3. Then, once per session+message hash, return `additionalContext` (not `block`, so the turn continues without an error label): "orchestrate: research-shaped question over a set of cases, answered from N source(s). Either dispatch orch-researcher, or rewrite the answer to name the one source that settles it and say in one line what it does not settle."

Applied to this case: research word "recommended" ✓, set shape "for each … (3 tiers)" ✓, one WebSearch (<2) ✓, table + "Nobody should" ✓ → fires. Applied to "what's the current node version?": no set shape → silent. Applied to "is there a recommended config for every service?" answered from two fetched pages → silent.

**What it costs.** One extra `node` start per Stop, already paid by turn-check (~50–100 ms); a 64 KB read. When it fires: one more manager turn — at the failing turn's size, ~0.7M cache-read tokens plus ~2k output. On Max that is quota, and the user complained about quota minutes later (line 2172), so the gate must stay this narrow. False-positive rate: unmeasured; before shipping, run `router.mjs --explain` over the human prompts of the last week's transcripts and count how many would trigger (judgment: well under one a day, because three regexes and a source count must all agree).

**What it breaks or does not do.** It shares the eight-consecutive-blocks guard with the `/goal` Stop hook. It cannot make the model go deep: the model can add one fetch and re-assert. What it does is raise the floor from "one summary, presented as settled" to "two sources, or a visible sentence naming what one source leaves open" — which is the sentence a vibe coder can check in one glance, and the check Josh actually performed by hand at 16:14. That is the human-facing fallback, built in: make the certainty claim explicit so a human can refuse it.

**Two cheap companions, not the mechanism.** (1) `router.mjs:260`: dedupe on `prompt_id + hash(text)`, not `prompt_id` alone, so a queued message sharing the turn's id is not discarded if the host does fire the hook; add a one-line debug write to learn whether it does. (2) `router.mjs:46`: let `RX.question` tolerate a leading "also|and|so|btw" and the modal "is there" without a `?`. Both are detection; neither would have changed this outcome alone.

## The test: which questions get a dispatch, not an answer

```
Dispatch orch-researcher instead of answering inline when ALL three hold:
1. it asks for a recommendation, a current fact, or a best practice (router feature `research`), and
2. the answer will be written down for others to inherit — a default, a table, a config value,
   a line in SKILL.md / README / routing — or it spans a set of cases
   ("for each", "per", "every", "all three", N tiers / plans / options / levels), and
3. no command or test can prove the answer wrong; only sources can.
If only (1) holds: fetch one primary source inline, cite it, and add one line saying what it
does not settle. A table from one search is never an answer.
```

Where it lives: the enforcement in `turn-check.mjs` (hook); the three-line test in `references/ladder.md` beside rung 3.5 and as the router's rung-3.5 hint text when the set shape matches ("dispatch orch-researcher; do not answer inline"), replacing "if one settles it". Not in `assets/output-styles/plain.md`: it already says "Every claim carries its proof", was in force, and the answer carried a Sources line that looked like proof. Not one more paragraph in SKILL.md §2: the evidence above says another instruction lowers compliance with the ones already there.

## Not verified

- Whether Claude Code 2.1.260 fires `UserPromptSubmit` for queued messages at all (undocumented; one stale field report says yes). The session count proves the router was silent either way.
- The false-positive rate of the three-way gate (judgment; measure before shipping).
- The hooks page for `PostToolUse` `additionalContext` truncated in every fetch; secondary sources say it is supported. Not needed for the recommendation.
- I could not run `router.mjs --explain` (no shell in this run); the classification is a hand trace of the source and should be confirmed with the packet's command using the message **as typed**, with "also" and without "?".
