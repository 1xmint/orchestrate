# Execution details: worktrees and Plan mode

## Worktrees

A single worker needs a worktree only to protect an existing checkout or
because the task requires it — otherwise read-only work does not need one.

## Plan mode

In Plan mode, helpers only read and return findings inline: no implementation,
no worktrees, no progress files, and only the lead keeps the plan. Once
approved, execute it without restarting discovery unless new evidence changes
the approach.
