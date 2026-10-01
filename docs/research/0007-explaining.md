# 0007: explaining the way the owner says ChatGPT does (2026-10-01)

Question: what would make Claude, running with orchestrate, draw a picture when
it helps and explain in prose that flows, instead of clipped sentences?

Marking: **[S]** sourced (link given), **[O]** observed in the lead's own
session or in this repo, **[I]** inferred (my reasoning, not stated by a source),
**[M]** from memory, not fetched this session.

## Answer

The kill condition does not fire: two hosts can show a real diagram, but only
by opt-in paths, and one of them is not documented. So the recommendation is
tiered. Draw with whatever picture tool the session actually has, otherwise a
text sketch in a code block, and loosen one rule ("one idea per sentence") that
plausibly makes prose choppy. Nothing needs host detection.

## 1. Rendering by host

| Host | Markdown tables | Mermaid block | Inline visual tool (SVG/HTML beside reply) | Artifacts (published HTML page) |
|---|---|---|---|---|
| Terminal CLI | Yes. Changelog: "caps the width of Claude's prose in wide terminals while tables and code blocks keep the full width" (v2.1.282) and a table-indent fix (v2.1.286). [S] https://code.claude.com/docs/en/changelog | No evidence anywhere; a terminal cannot draw it, so it shows as a code block. [I] | No. [I] (not documented; a terminal has no surface for it) | Yes, on Pro/Max/Team/Enterprise with `/login` and the Anthropic API: "Surface: Claude Code CLI, or the Claude desktop app version 1.13576.0 or later." Opens the user's browser. Pressing `Ctrl+]` reopens it. [S] https://code.claude.com/docs/en/artifacts |
| Desktop app, Code tab | Not stated in the docs. [I] likely, same engine | No: shows as plain text (owner confirmed 2026-10-01). [O] | Yes: `mcp__visualize__show_widget` drew a real flow chart beside the reply (2026-10-01). [O] Not in any Claude Code doc I read, so I cannot say every owner has it. Also: "Click an HTML, PDF, image, or video path in the chat to open it" in the Browser pane. [S] https://code.claude.com/docs/en/desktop (so writing an `.svg` or `.html` file and naming its path is a documented picture route) | Yes (same availability table as the CLI). [S] artifacts page above |
| VS Code extension | Likely: the screen-reader section says it "reads tables cell by cell". [S] https://code.claude.com/docs/en/vs-code | Unknown. [GAP] | Not documented. [GAP] | Not listed: the artifact surface row names only the CLI, the desktop app and Claude Tag. [S] artifacts page; so treat as no. [I] |
| claude.ai/code (web, cloud session) | Not stated. [GAP] | Not stated. [GAP] | Not stated. [GAP] | Not listed in the surface row. [S] artifacts page. Cloud sessions are the CLI engine inside a VM, so it may work; unverified. [I] |

Mermaid counterexample to flag: the output-styles page ships an example style
"Diagrams first" that says "start with a Mermaid diagram showing the structure"
[S] https://code.claude.com/docs/en/output-styles, but no page I read says which
surface draws Mermaid. Do not rely on Mermaid. A fenced Mermaid block that does
not render is worse than a text sketch: the owner sees code.

Artifact cost: "a styled page is more token-intensive than the same content as
terminal text", and "Prefer SVG, or HTML and CSS, for diagrams over embedded
raster images". [S] artifacts page. So drawing has a real output-token cost on
a quota-scarce user. Artifacts also open a browser tab and need a signed-in
plan, so they are for pictures worth keeping, not for a quick sketch.

### Can a hook or the style tell which host it is in?

- Documented: only `CLAUDE_CODE_REMOTE=true` marks a cloud session. The env-vars
  page "does not provide variables to distinguish between CLI, desktop, VS Code".
  `CLAUDE_CODE_ENTRYPOINT` is not documented there. [S] https://code.claude.com/docs/en/env-vars
- This repo already reads the entrypoint, from the transcript record or from
  `CLAUDE_CODE_ENTRYPOINT`, and `CLAUDE_CODE_DESKTOP_APP_VERSION`:
  `skills/orchestrate/scripts/lib/host.mjs` (`hostCapabilities`), with a test
  fixture value `claude-desktop`. [O] Values for VS Code and web are not
  known. [GAP] Those variables are undocumented, so they could change.
- Conclusion [I]: do not add host detection. The model already sees its own tool
  list. The rule "if you have a tool that shows a picture beside your reply, use
  it" needs no hook, costs no bytes per turn beyond the rule, and cannot drift
  when a host changes. It also follows "hooks state facts, they do not give
  orders" in AGENTS.md.

Plain-text fallback that works on every host [I]: a short sketch in a code block
(monospace keeps the alignment), or a small table.

    you -> browser -> server -> database
                          |
                          +--> Google (new: sign-in check)

## 2. Anthropic's current guidance

- Output styles are instructions, not guarantees: "An output style gives Claude
  instructions to follow. It doesn't guarantee that something always happens".
  A style's instructions are sent "with every request" (so each byte costs every
  turn, cached after the first). [S] https://code.claude.com/docs/en/output-styles
- Match the prompt to the output: "The formatting style used in your prompt may
  influence Claude's response style... removing markdown from your prompt can
  reduce the volume of markdown in the output." [S]
  https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices
  Applied to us [I]: `plain.md` is itself a stack of bold-led bullets, so it
  may nudge bullet-shaped replies. Not tested.
- Positive framing beats prohibition: "Instead of: 'Do not use markdown'. Try:
  'Your response should be composed of smoothly flowing prose paragraphs.'" [S]
  same page. Applied [I]: "One idea per sentence" and "Say it once" are
  prohibitions on shape; the fix states the shape wanted.
- The same page's sample prompt warns "NEVER output a series of overly short
  bullet points" and asks for "readable, flowing text that guides the reader
  naturally through ideas rather than fragmenting information into isolated
  points". [S] Same page also says reserve lists for "truly discrete items".
- Models differ: Fable 5.1 "uses bold less and is less likely to reach for
  headers, lists", and its prose can be "denser than Claude Fable 5's: sentences
  run longer and there are fewer paragraph breaks"; the suggested fix defines
  "mannered prose" and says "say what you mean. When a literal phrase is
  available, use it." [S]
  https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5-1
  Sonnet 5.5 and the general page: latest models are "more conversational:
  slightly more fluent and colloquial, less machine-like" and "less verbose". [S]
  Meaning [I]: a base model already leans conversational, so a rule that forces
  one-idea sentences may be fighting the default. The right fix removes the
  force, not adds a new one.
- I found no Anthropic page that tells a model when to draw a diagram in chat.
  Only the artifacts page ("a good candidate is anything easier to see than to
  read as text, such as an annotated diff, a chart, or a set of options to
  compare"). [S] https://code.claude.com/docs/en/artifacts

## 3. What makes explanations land (only what changes a rule)

I could not fetch the plain-language guide pages (digital.gov returned an index
and a 404), so this section is from memory and should not be cited as sourced.

- Plain-language guidance asks for a *mix* of sentence lengths with an average
  near 20 words, not all short ones. A run of 5-word sentences reads as
  clipped. [M] Changes a rule: replace "one idea per sentence" with "one main
  idea, joined by because/so".
- Explain by cause ("because", "so") because novices need the link between
  facts, not the facts. [M, I] Changes a rule: same one.
- Mayer's multimedia principles [M]: words plus a picture beat words alone
  (multimedia); a picture next to its words, not separated (contiguity); drop
  decoration that carries no information (coherence); label parts directly on
  the picture. Changes a rule: draw only when the picture carries the structure,
  put labels on it, and keep it beside the sentence that explains it. Also
  Mayer's segmenting and signalling: break a long process into steps and mark
  what to look at.
- UX writing: lead with the point, then give the reason. Already in `plain.md`
  ("Lead with the answer"). No change.

## 4. `plain.md` and SKILL.md section 9, rule by rule

Read in full: `skills/orchestrate/assets/output-styles/plain.md` (4,699 bytes)
and `skills/orchestrate/SKILL.md` section 9. [O]

Plausibly choppy [I]:
1. `plain.md` "**One idea per sentence.** Use the short word where it is exact."
   The strongest suspect. Taken literally, every causal link ("X is slow
   because Y") is two ideas, so the model splits and drops the link.
2. "**Say it once.** No repeating their question back, no closing summary."
   Needed (stops padding), but "once" can read as "never connect back". Keep;
   do not touch.
3. Final paragraph: "Brevity is for your own prose, never for the evidence."
   Tells the model prose should be brief, which pushes terseness. Mild.
4. "Answering a question": answer, then the two or three deciding things, then
   what was checked, then what would change your mind. A fixed skeleton, and a
   skeleton reads as a form, not as talking. Mild; the content is a real
   guard (sources and limits), so keep it.
5. Style-matching effect (section 2): the file is bullet-heavy. Unproven.

Must stay, each prevents a real failure:
- "Lead with the answer"; "Agreement is not a deliverable" and "never open by
  praising the question" (flattery); "Say it once... no closing summary"
  (padding); "Nothing to say is a valid turn" (noise); "Never show the
  machinery" (task ids, grades); "Recommend, and say what it costs" (menu of
  options); "Name a term once... say what it means" (jargon); "Keep the full
  text of an error" (hidden evidence). SKILL.md section 9 is the short copy of
  the same rules and has no choppy-causing line. [I] Section 9 needs no change.
- "Compare to everyday life" supports flow and is the nearest thing to a
  teaching rule already there. Keep.

Nothing in either file mentions pictures, tables or diagrams: grep for
"diagram", "picture", "table" in `plain.md` finds only the sentence "Not a
table of options with no answer in it" in SKILL.md section 9, which is an
anti-options rule, not an anti-picture rule. [O] (A model could read that
as discouraging tables; the wording is fine, but note it.)

## 5. Proposed wording (net +461 bytes, under the 600 cap)

Before (66 bytes, `plain.md`, "Every message" list):

    - **One idea per sentence.** Use the short word where it is exact.

After (527 bytes, two bullets in its place):

    - **Plain sentences that connect.** Short words, one main idea to a sentence, but carry the reasoning with "because", "so" and "which means", so it reads like a person explaining, not a list of facts.
    - **Draw it when the shape is the point:** steps in order, who talks to whom, before and after, or a choice between options. If you have a tool that shows a picture beside your reply, use it; otherwise a short sketch in a code block or a small table. Never for one fact or two steps. Say in a sentence what the picture shows.

AGENTS.md checklist:
- Failure prevented: a non-coding owner gets a wall of clipped facts and no
  picture for a flow or a comparison, and cannot follow the logic.
- Cost per turn: about 460 added bytes, roughly 115 input tokens, cached after
  the first request [S, output-styles page: caching reduces it]. Drawing adds
  output tokens only on turns that qualify; an artifact is more costly than text
  [S, artifacts page]. The text sketch costs about what the paragraph it
  replaces would.
- Wording: positive framing ("carry the reasoning with"), one example per idea,
  no new prohibition shouting. Consistent with the Anthropic notes in section 2.
  Not yet re-checked against the newest page on the day of merge. [I]
- Not changed: SKILL.md (no headroom needed), hooks, card.

Optional second step, only if the eval below shows bullet-shaped replies: rewrite
the "Every message" list in `plain.md` as two short paragraphs, to match prompt
style to output style. Do not do it first; it is a bigger edit.

## 6. Trigger rule: when to draw

Draw when all of these hold [I, from Mayer principles plus the artifacts page's
"easier to see than to read"]:
1. The point is a shape: an order of steps across more than one actor, a
   before and after, a layout, or a choice with two or more options compared on
   the same traits.
2. The prose version would take more than about four sentences or force the
   reader to hold three or more named parts in their head.
3. The owner is deciding or learning, not just being told a result.

Pick the cheapest form that works:
- Text sketch or small table in the reply: the default.
- Visual tool beside the reply (if the session has one): when layout or colour
  carries meaning, such as a flow with branches.
- Artifact: only when asked, or when the picture should be kept or shared. It
  opens a browser tab and needs a signed-in plan.
- Mermaid: do not use unless the owner has said it renders for them.

Do not draw when: one fact answers it; fewer than three parts; the picture only
repeats the sentence above it; the content is a list of steps with no
branching (a numbered list is clearer); an error or other text the owner must
copy exactly; the reply is a status report. A picture that adds nothing costs
tokens and quota and the owner's attention.

## 7. Eval idea for `claude plugin eval`

The repo's evals use graders with named rules and FAIL clauses, a Haiku judge
by default, runs against a no-plugin baseline, and a written spend cap
(`docs/research/0006-eval-0.19.0.md`, `evals/`). [O] I did not read the eval
file schema in `evals/evals.json`, so the case below states what to grade, not
the exact JSON.

Case name: `explain-flow`. Fixture: a small folder with a login that checks a
password against a database, and a README. Two prompts in the same case:

- Prompt A (should draw): "I don't write code. Explain how login works in this
  project, and whether adding 'sign in with Google' would change much."
- Prompt B (should not draw): "Which port does the dev server listen on?"

What the judge reads: the final reply text, plus the list of tool calls (so a
visual tool or an Artifact call counts as a picture).

Pass rule, all must hold:
- A has a picture: a visual or Artifact tool call, or a fenced text sketch or
  table with at least three labelled parts and a visible order or relation.
- A's prose connects: at least two sentences use a reason word (because, so,
  which means, since), and fewer than a third of its sentences are under six
  words.
- A defines each technical word (session, token, database) in plain words where
  it first appears, and shows no task ids or role names (existing no-machinery
  grader).
- A names a recommendation and its cost (existing rule).
- B has no picture and answers in the first sentence.
- Fence check: no Mermaid block unless a tool rendered it.

Fails if: a picture on B; a picture on A that only repeats a sentence; a Mermaid
block; the clipped pattern (many fragments with no reason words); a picture
with unlabelled boxes.

Baseline comparison: run the same two prompts with no plugin and with the plugin
before and after the wording change, three runs each as in 0006, and compare
pass rates. Expected [I]: baseline Claude may already draw tables unprompted, so
the case may show little difference on A; the sharper signal is B (no
over-drawing) and the connective-word count. If both arms pass, the change is
not worth its bytes and should be dropped. Spend cap to write down before
running; the 0006 six-run case cost about $2.76, so roughly $6 for this one
[S, 0006 doc, extrapolated by me].

## 8. Not verified

- Whether tables, Mermaid or `show_widget`-style tools render in the VS Code
  extension and on claude.ai/code. No doc says.
- Whether other owners' desktop sessions have a visual tool like
  `mcp__visualize__show_widget`; I only know the lead's did.
- Whether `plain.md`'s bullet style actually shifts replies toward bullets.
- Plain-language and Mayer claims are from memory.
- I did not run any eval or any live session; no spend.

Confidence: CONDITIONAL. Strong on what the docs say and do not say; weaker on
the cause of the choppiness, which is a reading of the rules, not a measured
effect. A baseline run of the eval above would settle it.
