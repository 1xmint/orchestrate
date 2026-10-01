# Eval: replies that connect and draw (0.20.0, step 1)

Cap written before any run: $6 list. Spent: $2.62 (four runs, one of them
refused by the Windows sandbox at $0.06).

## What changed

`plain.md` "One idea per sentence" became "Sentences that connect" and a new
"Draw it when the shape is the point" rule (a tool that draws beside the reply,
else a small table, never Mermaid). After the first measurement the "Answering
a question" paragraph was split: a fact gets one or two sentences, a judgment
gets the full shape.

## Cases

- `evals/explain-flow/`: a non-programmer asks how login works on a small club
  site and whether Google sign-in would change much.
- `evals/explain-port/`: the same site, one factual question. The control that
  catches drawing or padding where none is wanted.

## Results (passes out of 3 runs per grader)

| Grader | No plugin | 0.19.0 wording | First new wording | Final wording |
|---|---|---|---|---|
| flow-picture | 0 | 1 | 3 | 3 |
| flow-connected | 3 | 3 | 3 | 3 |
| flow-google | 1 | 3 | 3 | 3 |
| no-mermaid, no-machinery, no-code-edited | 3 | 3 | 3 | 3 |
| port-plain (fact in one or two sentences) | 3 | not run | 1 | 3 |

Sources: `new.json` (first new wording plus the no-plugin arm), `old.json`
(0.19.0 wording, plugin only), `new2.json` (final wording, plugin only), in the
run's `eval/` folder.

## What it shows

- The drawing rule is what moved: 0 → 1 → 3 pictures. Connected prose already
  passed under 0.19.0, so the rewording of that bullet is kept for the owner's
  ask, not for a measured gain.
- The first wording made the plugin worse than no plugin on a plain fact: it
  answered correctly, then added "I only read the code" and a what-if, because
  the old "Answering a question" rule asked every answer for what was checked
  and what would change the answer. Splitting fact from judgment fixed it
  (1 → 3) without costing explain-flow anything.
- Not measured: whether a drawing tool beside the reply is used when one
  exists. The eval host has none, so every picture was a table.

plain.md stays under its 5100-byte cap (5094) by trimming two clauses that
repeated a neighbouring sentence.
