# Eval run, 2026-09-24: could not run on this machine

Command tried (from the repo root, Claude Code 2.1.274):

```
claude plugin eval --ablation with-without --scaffold --allow-tools Bash Write Edit --model sonnet --case delivery-contact-form
```

Result: both arms (with the plugin, without it) refused to start, cost $0, 0 turns.
The full error:

```
A shell tool (Bash or PowerShell) was granted but this machine cannot confine it
(no sandbox backend on this platform, or it is not installed), so the run was
refused rather than run unconfined — drop the shell grant, or on Linux/macOS
install the backend. Sandbox required but unavailable: sandbox is enabled but
the Windows sandbox is not active on this session (feature gate off).
Error: sandbox required but unavailable ... sandbox.failIfUnavailable is set —
refusing to start
```

## What this shows

All three cases under `evals/` need a shell: the delivery case checks the page
with curl, the recovery and safety cases use git. On Windows the eval runner
will not hand a shell to the model without an operating-system sandbox, and
that sandbox is not available here. So the eval layer cannot produce a "with
plugin beats no plugin" number on this machine. It can on Linux or macOS with
the sandbox backend installed, or in a CI job on Linux.

The other two cases were not attempted; they would fail the same way.

## Not verified

- Whether the cases pass their graders anywhere: no run has completed yet.
- Whether a Write/Edit-only case (no shell grant) runs on Windows: not tried,
  because none of the current cases can be graded without a shell.

Raw output: `.orchestrator/runs/20260924-audit-to-ten/evals-before/` (git-ignored).
