# How the work gets shaped

One source for two readers: SKILL.md §3 points here, and `scripts/router.mjs`
injects the fenced card below once per session. A maintainer edits only this
file.

There used to be a ten-rung ladder here, and a hook that read each message with
regular expressions and named the rung. It is gone. A pattern in the wording is
not evidence about the work: "should we" is not a reason to research, and the
word "deploy" in a sentence is not a reason to ask permission for an edit. What
is left is the actual work, how much manager context it would consume, and what
it costs to get it wrong.

## The choice

**Direct** — you answer, read, edit and check it yourself when the step fits in
about eight tool calls with small outputs, or about 15k tokens of growth.

The manager's context is for judgment. Everything larger goes to a worker, and
the conversation keeps only its packet and return. Always use a worker to write
or rewrite a file over about 150 lines, change three or more files, run a build
or test suite, or make a large read whose answer is a paragraph.

**Assisted** — one substantial separable task goes to a role agent with a packet.

Worth it when delegation buys something concrete:

| Reason | What it buys |
|---|---|
| isolation | the work happens in a worktree and cannot disturb this checkout |
| parallel progress | two tracks advance at once and neither waits |
| a specialist | a wide read-only sweep on haiku, a browser pane, a debugger's loop |
| independent scrutiny | someone who did not write it decides whether it is right |
| context | a large read whose result is a paragraph; the reading dies with the agent |

Worth it for none of these: a step that stays within the direct-work boundary.

**Coordinated** — a run ledger, ids, dependencies, and returns filed on disk.

Worth it when several independent tracks run at once, or the work must survive
this session ending. A plan gets one packet per step. A wave of three or more
independent steps goes to `orch-coordinator`; one larger task goes to one
worker.

Move to the simpler choice as soon as the reason for the heavier one is gone. A
small high-risk change can take an independent review without becoming a run.

Never `Write` a file you could `Edit`. Never `Read` back a file you just wrote.
Filter command output to what decides the next step.

## Cheaper moves that are not delegation

- **A command beats reasoning about what a command would say.** `rg | head`,
  `git`, `--json` piped through a filter, the project's own scripts. Filter the
  output; a full test log in context costs more than the answer is worth.
- **A skill** when a procedure should play out in this thread.
- **`Explore` on haiku** for a read-only sweep of more than about three files.
  Its 200K window is the real limit, not the 1M the others have.
- **`/batch`, a dynamic workflow, agent teams**: `lanes.md`, including which of
  them this host will actually start.

## Questions

A question about something already settled — in this conversation, the run's
Facts or Decisions, `STATE.md`, or a file you read — is answered from there,
with where, and not worked out again.

A question about the world is answered from the world. Search it, open the
document or the source that settles it, and stop when nothing further could
change the answer. One authoritative source can be enough; several weak ones are
not. Say what you checked, what is from memory, and what would change it.

A question asking for judgment gets a recommendation: the goal as you read it,
the two or three things that decide it, what you would do, and what would change
your mind. A table of options with no answer in it is not an answer.

## Router card

`scripts/router.mjs` extracts the fenced `card` block below, prepends one line
of state (tier, agents installed, your own model, the bound run, limits hit
today), and injects the result on the first substantive prompt of a session.
Keep it under 1,550 characters; every character is paid on every later turn of
that session. `router.test.mjs` asserts the cap.

```card
orchestrate is loaded. Your context is for judgment. Do a step yourself when it fits in about 8 tool calls with small outputs. Everything else goes to a worker, and you keep only its return: writing a file over ~150 lines, changing three or more files, a build or test suite, a read whose answer is a paragraph. Workers run on Codex (codex-worker.mjs --model --effort) until it runs out; Claude workers for what Codex cannot reach. A plan: one packet per step; three or more independent steps go to orch-coordinator. Never Write a file you could Edit, never Read back what you wrote; filter output. Open a run ledger when several tracks run at once or the work outlives this session.
Answer a settled question from the record and say where. Answer a question about the world from the source that settles it. Answer a judgment question with a recommendation and what would change it. An installed skill that does what a built-in tool cannot beats rebuilding it; name it in any packet that needs it.
Before adding a dependency, an abstraction or another worker, name the problem it solves now.
Evidence decides done: reuse a check that passed, test a real uncovered behaviour, drive a user flow when reading cannot settle it. Independent review is for money, auth, destructive data, a contract others consume, or real architectural doubt.
Stop and ask, recommendation first, only for money, a public surface, credentials, or a destructive or irreversible action. Authorisation already given is not asked for twice. Mute this card: type "router off".
```
