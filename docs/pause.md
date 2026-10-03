# When a session pauses

Five things can leave a session waiting. For each, on each screen: who writes
the pause record, what wakes the session, what the band shows, and how many
times the host may wake it. Written before the code (0010 master plan, step 2b).
"Unchecked" means the pages named under "Facts" do not say. The band is the
status line the plan's section 4 describes. It is built (`docs/band.md`) but has
not been seen on a screen, so its column entries say what it reads, not what has
been seen.

| Pause | Terminal | Desktop | Headless |
|---|---|---|---|
| **Usage limit** | **Record:** `persist-check.mjs` on `StopFailure`, to `.orchestrator/pause.json`. Whether a subscription limit arrives there as `rate_limit` is unchecked, so every error kind is written.<br>**Wakes:** the host's own carry-on after the reset.<br>**Band:** "Paused for the usage limit", no clock unless one is known.<br>**Host wakes:** at most twice (the plan cites the interactive-mode page; not re-read here). | **Record:** the same hook; that `StopFailure` fires on this screen is unchecked.<br>**Wakes:** the "Auto-continue when limits reset" tick on the session-limit card (not the weekly one) retries the interrupted turn; its default is not stated.<br>**Band:** the same line; drawing on this screen is unseen until plan step 0.<br>**Host wakes:** unchecked. | **Record:** the same hook, where hooks run; unchecked for `StopFailure` in a headless run.<br>**Wakes:** nothing in this plugin; whether the host retries is unchecked.<br>**Band:** nothing is drawn.<br>**Host wakes:** unchecked. |
| **Helper out of turns** | **Record:** none; `ledger.mjs` files the helper's return.<br>**Wakes:** nothing is asleep; the return reaches the lead.<br>**Band:** nothing.<br>**Host wakes:** not applicable. | Same as Terminal. | Same as Terminal. |
| **Background command still running** | **Record:** none. `persist-check.mjs` reads the Stop payload's `background_tasks` and `session_crons`; if either lists something, the "no visible work" stop does not fire, the Stop passes and keep-going stays armed. It waits again each time that work wakes the session (a helper landing, a Monitor line, a scheduled prompt); it ends keep-going only when nothing but background commands is out, none of them appeared with a Monitor started in this stretch (one that runs a command may be listed as a background command, so what first appears at the Stop after it is held while it is still listed), the user spoke since, and the step still did nothing, as with a dev server that never reports.<br>**Wakes:** the background work finishing, or the scheduled prompt firing.<br>**Band:** "Working on: waiting on a helper or background command" while keep-going is armed (`docs/band.md`); the draw is unseen.<br>**Host wakes:** unchecked. | Same as Terminal. | Same as Terminal. |
| **A summary (compaction)** | **Record:** none; the session file keeps keep-going armed and `router.mjs` re-sends the goal at the `compact` session start.<br>**Wakes:** nothing is asleep; unchecked whether the host wakes anything.<br>**Band:** nothing.<br>**Host wakes:** unchecked. | Same as Terminal. | Same as Terminal. |
| **Waiting on nothing** | **Record:** none. One of the closing message's last three sentences promises, in the first person, to wait, watch or check back on something outside the conversation or at a time ("I'll let you know when CI finishes", "I'll check back in a few minutes"), and the Stop payload's `background_tasks` and `session_crons` are both present and empty (`lib/wait-claim.mjs`). `persist-check.mjs` refuses that Stop once with what the payload shows: it lists no helper, background command, Monitor or scheduled prompt that would wake the session. With keep-going on it is one continue per stretch, and the next step that only waits ends keep-going ("the last step only waited, and nothing was running that would wake this session"); without it, once per message, after the size check. Left alone: a sentence that waits on the user ("let me know when", "your go-ahead"), a message that ends on a question, a Stop a hook already refused, a payload without the two lists, and a record that shows a scheduling tool (a reminder sent into the conversation is not in the lists).<br>**Wakes:** only what the payload does not list, such as a reminder sent from outside; CI on GitHub or a deploy elsewhere wakes nothing.<br>**Band:** "Working on" while the refused Stop's turn goes on, then nothing.<br>**Host wakes:** not applicable. | Same as Terminal. | Same as Terminal; a headless run ends at its last Stop either way. |

## The pause record

`<project root>/.orchestrator/pause.json`, where the project root is the git
root of the payload's `cwd`, or `cwd` itself outside a repository. One record
per project; a later pause replaces it.

```json
{ "kind": "usage_limit", "error": "rate_limit", "at": "2026-10-03T09:00:00.000Z",
  "session": "<session id>", "text": "Paused for the usage limit; keep-going stays on." }
```

- `kind` is `usage_limit` for `rate_limit` and `api_error` for every other kind
  or an unknown one. `error` is the value the host sent, or `unknown`.
- `text` says "keep-going stays on" only when the session is armed. An unarmed
  session gets the same sentence without that clause.
- Only `persist-check.mjs` writes it, and only at `StopFailure`. Inside a helper
  (`agent_id` on the payload) it writes nothing. The host ignores what a hook
  prints at `StopFailure`, so the hook cannot refuse anything there; it never
  touches the keep-going state.
- `lib/pause.mjs` holds the reader (`readPause`). The band's mod cannot import it,
  because it reads with `node:fs` and a mod may import only its own files by
  relative path; `lib/band-line.mjs` has `parsePauseText`, which reads the file the
  same way, and a test holds the two to the same answer. The band reads the file
  and never writes it.

**Cleared** at the next ordinary Stop of the same session and at the next
prompt of the same session. Both places already run every turn:
`persist-check.mjs` at every Stop and `router.mjs` at every prompt, so nothing
new is registered and no timer is needed. A record from another session in the
same project is left alone. Clearing marks the record (`cleared`, `clearedBy`)
instead of deleting it, so the first real limit on a machine leaves a file that
says which error kind arrived; `readPause` treats a marked record as absent.

## Keep-going through a limit

- The plugin's own stop at 90% of the 5-hour window is gone. Where the host
  waits and resumes, that stop turned keep-going off just before the host's
  resume, so the resumed turn landed on a job that no longer continued.
- A helper refused for usage (the "orchestrate quota:" refusal, for the 5-hour
  window or the week) no longer turns keep-going off. The next
  continue says helpers are refused and that this session can still work. A
  budget or credential refusal still stops: those are safety stops.
- The host's own cap on a Stop hook's blocks (under "Facts") is separate from
  this plugin's caps on keep-going.

## Facts

Checked 2026-10-03 against code.claude.com/docs/en/hooks-guide and
code.claude.com/docs/en/hooks:

- `StopFailure` fires when the turn ends due to an API error. Its matcher values
  are `rate_limit`, `overloaded`, `authentication_failed`,
  `oauth_org_not_allowed`, `account_on_hold`, `billing_error`,
  `invalid_request`, `model_not_found`, `server_error`, `max_output_tokens`,
  `cloud_credential_error` and `unknown`.
- At `StopFailure`, output and exit code are ignored, except `terminalSequence`.
- Stop hooks do not fire on user interrupts; API errors fire `StopFailure`
  instead.
- Claude Code overrides a Stop hook after it blocks eight times in a row without
  progress (the hooks guide, "Stop hook hits the block cap");
  `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP` raises it.

Not on those pages, read from the SDK type file that ships with Claude Code's
plugin-authoring skill (2026-10-03): the `StopFailure` payload carries `error`,
and optionally `error_details` and `last_assistant_message`; the `Stop` payload
may carry `background_tasks` and `session_crons`. Every one is read defensively:
an absent field means unknown, never empty, and only a non-empty list counts as
work being out. The SDK type also lists `verification_required`, which the
hooks pages do not; it is written like any other kind.

From the 0010 master plan (the errors page was fetched 2026-10-02; the
interactive-mode page is cited there, not re-read): a terminal session carries
on by itself after a limit, at most twice; the Desktop app has the
session-limit tick above.

## Still unchecked

- Whether a subscription limit arrives at `StopFailure` as `rate_limit`. The
  record answers it the first time a limit lands.
- Whether `StopFailure` fires on the Desktop app and in headless runs.
- How many times the Desktop host may wake a session, and the tick's default.
