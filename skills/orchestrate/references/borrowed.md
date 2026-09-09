# Where the ideas came from

This skill is new text, but few of its ideas are new. Provenance, so that a
reader can go to the source and so credit lands where it belongs.

| Source | Taken (in our words) | Left behind |
|---|---|---|
| Anthropic, *How we built our multi-agent research system* (2025) | orchestrator plus workers with isolated contexts beats one strong model; hand off artifacts and receipts, never raw context | — |
| A retired personal skill, `agent-orchestrator` (2026-08) | the objective order: first-time-right, then total quota including rework, then wall clock; the dispatch contract fields; never trust a self-report; a fixed list of escalation triggers; repair from the diff instead of restarting | a coded supervisor and an events file; the host now notifies on completion |
| An earlier human-transport role system (`head` / `manager` / `super` / `agent`, 2026) | the checkpoint with a pickup prompt, a pickup confidence and a resume risk; a stop-and-ask condition in every packet; "restate the task" at the top of a return | the doctrine library; the human as message bus |
| [mattpocock/skills](https://github.com/mattpocock/skills) (MIT) | tracer-bullet tickets with blocking edges; the diagnosing-bugs loop (reproduce, minimise, hypothesise, instrument, fix); two-axis review, standards and spec, by separate agents; compact handoffs; writing for agents | interview-until-resolved; this skill asks fewer questions and attaches a recommendation to each |
| [DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail) (MIT) | the decision ladder for the orchestrator's own actions: does it need to exist, is it already here, is it one line; lazy about the solution, never about the reading | the plugin and hook machinery |
| [myshell-tools](https://www.npmjs.com/package/myshell-tools) | never fabricate a quota number; one quality knob derived from the plan; a different vendor's review as a separate lane; the advisor stance over the order-taker stance | the terminal app, broker, journal and protocol; the host provides the transport now |
| Steve Moraco's DATA pack (`data.sh`, DATA License 1.0) | the grading states Done / Built-unverified / Partial / Blocked / Failed and the claim grades PROVED / CHECKED / CONDITIONAL / OBSERVED / SPECULATION; two independent fresh-context reviewers for high-risk work, with the orchestrator's own read as a third check; a conditional pass is a fail; decide in-scope technical questions yourself and escalate only authority, spend, publish, credential, irreversible; relaunch a dead worker for its remainder only; label suspect artifacts `bad-stale-*`; a task table with stable dated ids and a rubric written before the work; the research source obligation; the cold-context comprehension trial; the lesson that an agent launched from the wrong directory loses every repo instruction | the fitness-product doctrine, video tutorial gates, Replit publishing, the fixed vendor routing, the byte-hash receipt schema |
| Josh's working rules (from his memory notes) | plain talk with a recommendation on every decision; prove rather than measure, at the cheapest rung that holds; push as you go; the three conditions for parallel work; stop when the user raises cost | — |
| Gloaguen et al., *Evaluating AGENTS.md* (ICLR 2026 workshop) | context files give no success lift and cost 20%+, and agents obey them at 1.6–2.5× baseline, so every line in SKILL.md has to change behaviour | — |

Attribution required by the DATA License 1.0 for ideas drawn from the DATA
materials: "DATA License, Version 1.0" — https://data.sh . No DATA text is
reproduced here; the techniques are restated for a product with its own
purpose, which that license's resale carve-out permits.
