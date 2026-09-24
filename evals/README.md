# evals/

Two different tools read this directory, for two different jobs:

- **`evals.json`** is read by the `skill-creator` plugin's own eval runner.
  It is acceptance guidance for a human reading a transcript — nothing in
  it runs a model on its own. Keep using it for that.
- **`delivery-contact-form/`, `recovery-mid-task-continue/`, and
  `safety-branch-cleanup/`** are cases for `claude plugin eval`, the
  Claude Code CLI command (see
  `https://code.claude.com/docs/en/plugin-evals`). Each is a directory with
  a `prompt.md` (and, where the case needs a seeded workspace, a
  `case.yaml` plus a `graders/` directory. `claude plugin eval .` from the
  plugin root runs every case here three times with the plugin loaded and
  three times without it, and reports a `Δ` — what the plugin actually
  changed. These three cases mirror the three scenarios in
  `docs/audits/2026-09-24-live-runs.md`.

Running these costs real model calls against your account and is not part
of `node --test`. Two of the three (`recovery-mid-task-continue` and
`safety-branch-cleanup`) seed a throwaway git repository via a
`scaffold_script`, which only runs when the eval command is passed
`--scaffold`, and all three need tools beyond the read-only default —
run them with something like:

```
claude plugin eval . --scaffold --allow-tools Bash Write Edit
```
