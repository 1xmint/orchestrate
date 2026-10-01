# evals/

Two different tools read this directory, for two different jobs:

- **`evals.json`** is read by the `skill-creator` plugin's own eval runner.
  It is acceptance guidance for a human reading a transcript — nothing in
  it runs a model on its own. Keep using it for that.
- **The ten case directories** (`delivery-contact-form/`,
  `recovery-mid-task-continue/`, `safety-branch-cleanup/`,
  `triggering-substantive-request/`, and the six ability cases
  `costly-fork/`, `misleading-bug/`, `wrong-goal/`,
  `three-session-continue/`, `failed-check-report/`, `plan-request/`) are
  cases for `claude plugin eval`, the Claude Code CLI command (see
  `https://code.claude.com/docs/en/plugin-evals`). Each is a directory with
  a `prompt.md` (and, where the case needs a seeded workspace, a
  `case.yaml` plus a `graders/` directory. `claude plugin eval .` from the
  plugin root runs every case here three times with the plugin loaded and
  three times without it, and reports a `Δ` — what the plugin actually
  changed. The first three cases mirror the three scenarios in
  `docs/audits/2026-09-24-live-runs.md`; `triggering-substantive-request`
  is area 9 (Triggering) from `docs/audits/2026-09-24-scoresheet-r1.md` —
  it asserts the orchestrate skill actually fires on a substantive,
  multi-step prompt via a `tool_used: Skill` grader, which `claude plugin
  eval` treats as a plugin-fired indicator rather than part of the score.
  Every case's `graders/no-machinery.md` shares one widened regex, proven
  against sample leaks by the plain-Node test `evals/no-machinery.test.mjs`
  (`node --test evals/no-machinery.test.mjs`, no quota spent).

Running these costs real model calls against your account and is not part
of `node --test`. Every case with a `case.yaml` seeds a throwaway git repository via a
`scaffold_script`, which only runs when the eval command is passed
`--scaffold`, and they need tools beyond the read-only default —
run them with something like:

```
claude plugin eval . --scaffold --allow-tools Bash Write Edit
```
