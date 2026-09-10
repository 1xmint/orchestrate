# Handoff

`orchestrate` v0.9.0 is built, tested and packaged. It is **not installed, not
published, not tagged and not pushed** — that was deliberate, and it is the
first decision waiting for you.

v0.8.0 cut the instruction down. v0.9.0 takes out the machinery that still made
decisions from the shape of a message rather than from the work, and fixes two
defects that could lose or misfile real work. Repo:
`C:\Users\Josh\Desktop\GitHub\orchestrate` (public, github.com/1xmint/orchestrate,
branch main).

## If you are picking this up cold

Read the v0.9.0 section at the top of `STATE.md`. It names every behaviour that
changed, the two bugs and how each was reproduced, and — at the end — the one
thing this release does **not** claim: nobody has measured whether it makes the
model work better. Nothing here ran a live model.

Then run the tests, which need no quota and no network:

```
node --test "skills/orchestrate/scripts/**/*.test.mjs"
```

169 pass. Anything red is a regression, not a starting point.

Two offline commands are worth knowing:

```
node skills/orchestrate/scripts/router.mjs --state
node skills/orchestrate/scripts/measure.mjs --latest --dollars
```

The first prints exactly what the router would inject here, and the card's
character count against its cap. The second prices a finished session at list
price and counts how often the one remaining Stop hook sent a turn back.

`turn-check.mjs --replay-week` is gone with the check it measured.

## What changed that you will notice first

- **The router says much less.** It reports state and stays quiet. It no longer
  reads your wording and tells the model which agent to use, how deep to
  research, whether to review, or when to ask permission. It also stopped
  telling you to change your model or effort.
- **Nothing sends a subagent's return back.** `return-check.mjs` is deleted.
  A return that arrives long, or missing a field, is filed whole and the task is
  graded unverified rather than redone.
- **The ledger no longer edits `RUN.md`.** It saves the return under the run and
  indexes it; the model sets the row when it has read and judged the return.
  Two returns landing together used to erase each other's row.
- **Prices carry no "% of your week".** The weekly figure it divided by came
  from one observation. So did the 5%/25% rules built on it. Both are gone.

## What is on this machine right now

**The plugin installed here is still v0.8.0.** This session did not touch your
Claude settings, your plugin cache or `~/.claude`. So the running behaviour on
this machine is the old one until you install the new build.

If you want v0.9.0 live, the plugin path is the one you are already on:

```bash
claude plugin update orchestrate@orchestrate
```

That pulls from the marketplace, so it needs the release pushed first. Nothing
here pushed it.

## Decisions waiting for you

1. **Publish or not.** Version metadata says `0.9.0` in `plugin.json`,
   `marketplace.json` and `SKILL.md`, and both `.skill` zips are rebuilt from
   the current source. Tag, push and marketplace update are yours.
2. **The Pickup check now needs a binding.** A run only nags for its Pickup line
   if this session opened it with `run-init.mjs --session-id <id>` or claimed it
   with `run-init.mjs --bind <RUN.md> --session-id <id>`. An existing open run
   from before this change is unbound, so it will be offered as a candidate
   rather than adopted. That is the fix for returns landing in the wrong
   repository's ledger, and it is the one thing that needs a habit change.
3. **The behavioural claim is untested.** Everything above is structural. If it
   matters whether the redesign actually reduces wasted work, the way to find
   out is `measure.mjs --latest` across a few real sessions, compared against
   the same figures from v0.8.0 sessions already on disk.

## Compatibility

Old ledgers, old packets, old return formats and old profile files all still
read; there are tests for each. The one break is deliberate: a hook will not
write to a run this session has not bound, so a session working outside any repo
gets a candidate and a command rather than a silent write.
