# Baseline: 0.17.2 with and without the plugin (2026-09-30)

Plan 0005 step 1. The five cases added in step 1 run against the plugin as
it was **before** plan 0005 (commit ce6804a, version 0.17.2), each case once
with the plugin and once without it (`claude plugin eval`, default
with-without ablation). The next session runs the same cases on the
phase/0005-reaim build and compares against this file.

Command, per case (a brace glob in `--case` is not supported, so one at a time):

    claude plugin eval evals --case <name> --trust-plugin --no-publish \
      --allow-tools Write Edit --scaffold

Raw results are in evals/results/ (kept out of git). Run from a separate checkout detached at ce6804a with the five case folders
copied in. Model in both arms: claude-opus-5 (from the trace's init record).

## Results

| case | with plugin | without | difference | what decided it |
|---|---|---|---|---|
| costly-fork | 1.00, passed | 0.67, failed | +0.33 | Without the plugin, Claude wrote a file holding a network server before offering the cost choice (`no-network-server-built`: "Write called 1x (expected 0..0)"). Both arms passed the judged "choice before cost" rule 2 votes to 1. |
| wrong-goal | 1.00, passed | 1.00, passed | 0 | Both raised the conflict before building anything (3 of 3 judge votes each) and wrote no account code. |
| three-session-continue | 0.75, failed | 0.75, failed | 0 | Both arms found and finished the right step (`done-is-wired-up` passed 3/0 each, and both cite `src/todos.js:17`, so files were read). Both failed `continued-the-right-step` (with: 1 vote of 3; without: 0 of 3). The with-plugin reply named the next step but not the tests after it; the without reply ended "Want me to keep going with item 4?". |
| misleading-bug | not run | not run | — | Needs a shell to run tests; see below. |
| failed-check-report | not run | not run | — | Needs a shell to run tests; see below. |

Cost, list-price dollars including the judge: costly-fork 0.99, wrong-goal
0.41, three-session-continue 0.57; the two refused cases 0.006 and 0.005.
Total about 1.98, inside the step's 10 dollar limit.

## Not run, and why

`misleading-bug` and `failed-check-report` need Bash to run the project's
tests. On this Windows machine `claude plugin eval` refuses any shell grant:

> A shell tool (Bash or PowerShell) was granted but this machine cannot
> confine it (no sandbox backend on this platform, or it is not installed),
> so the run was refused rather than run unconfined — drop the shell grant,
> or on Linux/macOS install the backend. Sandbox required but unavailable:
> sandbox is enabled but the Windows sandbox is not active on this session
> (feature gate off)

The next session on this machine hits the same wall. Those two cases need a
Linux or macOS machine (or WSL with the sandbox backend installed).

## How far to trust this

- One run per arm. A judged rule that splits 2 votes to 1 can flip on a
  rerun. This is a hint, not proof.
- Run after steps 2 and 3 were written, but against the pre-change tree,
  so it measures 0.17.2 only.
- No shell in any arm: neither arm could run code, so "it works" in these
  replies is read, not run.
- `three-session-continue`'s judged rule failed both arms for how the last
  message was worded, after both did the right work. Before trusting a
  difference on it next time, read the two final messages, not only the
  score; the rule may be stricter than the outcome it is meant to check.
