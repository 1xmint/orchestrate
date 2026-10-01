# Step 0 answers (9-30-0001, claude-code-guide, 2026-09-30)

## (a) Does an @-import in CLAUDE.md survive compaction?
- Docs (https://code.claude.com/docs/en/memory.md): "Project-root CLAUDE.md survives compaction: after /compact, Claude re-reads it from disk and re-injects it." Files over 4 MiB are skipped.
- Imports are not named explicitly in that sentence; that they ride along is an inference (imports are expanded when the file is read).
- Decision for step 4: wire PROJECT.md by one @ line in the project-root CLAUDE.md, AND keep the post-compaction hook re-showing PROJECT.md's head as a belt-and-braces until a live session confirms the import is present after a compaction. Verify in the next live session (watch for PROJECT.md content after compaction 1).

## (b) Can a plugin ship permission ask rules?
- Docs (https://code.claude.com/docs/en/permissions.md) list settings files, managed settings, hooks and CLI flags as sources; plugins shipping permissions is not documented. Treat as NO.
- A PreToolUse hook can return permissionDecision "ask" to force a prompt; ask/deny rules still apply in every mode.
- Decision: keep guard-bash.mjs as the one small hook for force-push, shared-branch delete, publish and deploy. Optionally the README can suggest users add `ask` rules to their own settings; not shipped by the plugin.

## (c) claude plugin eval (for step 1)
- Case = dir with prompt.md and/or case.yaml (schema_version "1.1"; context.scaffold_script, context.history_file, add_dirs); graders/<name>.md with type regex|tool_used|tool_order|file_exists|llm|baseline; llm = judge votes PASS 2 of 3; --judge-model overrides.
- context.history_file resumes ONE prior transcript; the prompt becomes the next turn. A "three sessions then continue" case must be seeded as files on disk (scaffold) plus at most one history file.
- --runs n (default 3), --model, --ablation none disables the baseline arm; Δ = with minus without.

## (d) CLAUDE.local.md as the import point for PROJECT.md (lead, 2026-09-30, for step 4)
- Docs (https://code.claude.com/docs/en/memory, "Choose where to put CLAUDE.md files", "When Claude Code reads AGENTS.md"): CLAUDE.local.md is supported, loads alongside CLAUDE.md, and supports @ imports. BUT a CLAUDE.local.md "counts": in a repo with AGENTS.md and no CLAUDE.md, adding one stops Claude reading AGENTS.md (default Project instructions setting).
- Also: "Imports help you organize a long file but don't reduce its context cost."
- Decision for step 4: write no instruction file into the user's repo. The router shows PROJECT.md's head on a session's first prompt, after compaction and on resume. Rejected: CLAUDE.local.md (silently hides AGENTS.md); CLAUDE.md (tracked, the user's call).
