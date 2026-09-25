#!/usr/bin/env node
// guard-bash.mjs — a PreToolUse hook on the Bash tool and the PowerShell
// tool (Windows hosts route shell commands through PowerShell instead of
// Bash; both tools carry the command text in the same `tool_input.command`
// field, so one hook and one `decide()` cover both). It never rewrites a
// command; it only decides whether one should run at all.
//
// A small, fixed list of shell commands throw away something a person cannot
// get back — a shared branch, a folder of files, a published package, a live
// deployment, or real money — and none of that is stopped by anything else in
// this plugin. This hook is the one mechanical backstop for that short list.
// Everything not on the list passes through with no output at all, including
// the loud, ordinary stuff (`npm test`, `rm -rf node_modules`, a push to a
// feature branch): a hook that talks on every command trains a person to
// stop reading it.
//
// Reads the hook payload on stdin, prints one JSON object or nothing, always
// exits 0 — a hook that crashes or prints malformed JSON degrades the whole
// session, so any internal error here is treated the same as "nothing to
// say", never as a reason to fail the command through or block it.
//
// See docs/safety-guard.md for what is stopped, how a user allows a specific
// command going forward, and how to add a new pattern.

import { readFileSync, existsSync } from 'node:fs';
import { resolve as resolvePath, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { readJson, findRepoRoot } from './lib/tier.mjs';

// Reproducible or already-ephemeral folders: losing one costs a re-run of a
// build tool, not real work. Named by their last path segment only, so
// `packages/app/node_modules` still matches.
const SAFE_DELETE_NAMES = new Set([
  'node_modules', 'dist', 'build', 'out', 'coverage',
  '.cache', '.next', '.nuxt', '.turbo', '.parcel-cache',
  'target', '__pycache__', '.pytest_cache', '.tox', '.venv', 'venv',
  'tmp', 'temp',
]);

function normSlashes(p) {
  return String(p).replace(/\\/g, '/');
}

// Whether deleting `target` (as typed on the command line, resolved against
// `cwd`) is the ordinary, reproducible kind of delete rather than the kind
// that loses real work: a well-known build/dependency folder by name, or
// anything already inside the OS temp directory.
export function isSafeDeleteTarget(target, cwd) {
  const t = String(target || '').trim();
  if (!t || t === '/' || t === '~') return false;
  const base = basename(t.replace(/[\\/]+$/, ''));
  if (SAFE_DELETE_NAMES.has(base)) return true;
  let resolved;
  try { resolved = resolvePath(cwd || process.cwd(), t); } catch { return false; }
  const tmp = resolvePath(tmpdir());
  const r = normSlashes(resolved).toLowerCase();
  const tmpNorm = normSlashes(tmp).toLowerCase();
  return r === tmpNorm || r.startsWith(`${tmpNorm}/`);
}

// The bare arguments to `rm`/`git rm` — flags (anything starting with `-`)
// stripped out. Good enough for the shapes this guard needs to reason about;
// it is not a shell parser and does not try to be.
function targets(afterCommand) {
  return afterCommand.split(/\s+/).filter(a => a && !a.startsWith('-'));
}

// One entry per stopped shape. `reason` is the plain sentence a person who
// has never used git or a CLI can act on: what would happen, and how to let
// it through. `test` sees the whole command string, already collapsed to
// single spaces. Order matters only in that the first match wins; the list
// is short enough that overlaps do not matter in practice.
const RULES = [
  {
    name: 'branch-delete-remote',
    test: cmd => /\bgit\s+push\b/.test(cmd) && (/--delete\b/.test(cmd) || /(^|\s):[^\s:][^\s]*/.test(cmd)),
    reason: 'This would permanently delete a branch on the shared remote, which anyone else using it would lose. Say yes to continue.',
  },
  {
    name: 'push-force',
    test: cmd => /\bgit\s+push\b/.test(cmd) && /(--force(-with-lease)?\b|(^|\s)-f\b)/.test(cmd),
    reason: 'This would overwrite the history of a shared branch, which can erase other people’s work. Say yes to continue.',
  },
  {
    name: 'branch-delete-local',
    test: cmd => /\bgit\s+branch\b.*\s(-D|-d|--delete|--force-delete)(\s|$)/.test(cmd) || /\bgit\s+branch\s+(-D|-d|--delete|--force-delete)\b/.test(cmd),
    reason: 'This would permanently delete a branch. Say yes to continue.',
  },
  {
    name: 'git-rm-recursive',
    test: cmd => /\bgit\s+rm\b/.test(cmd) && /\s-\w*r\w*\b/.test(cmd),
    reason: 'This would remove tracked files and folders from the project. Say yes to continue.',
  },
  {
    name: 'git-clean',
    test: cmd => /\bgit\s+clean\b/.test(cmd) && /\s-\w*f\w*\b/.test(cmd),
    reason: 'This would permanently delete files that are not tracked by git, with no way to undo it. Say yes to continue.',
  },
  {
    name: 'npm-publish',
    test: cmd => /\bnpm\s+publish\b/.test(cmd) || /\byarn\s+publish\b/.test(cmd) || /\bpnpm\s+publish\b/.test(cmd),
    reason: 'This would publish a new version of this package for anyone to install. Say yes to continue.',
  },
  {
    name: 'gh-release',
    test: cmd => /\bgh\s+release\s+create\b/.test(cmd),
    reason: 'This would publish a new release of this project. Say yes to continue.',
  },
  {
    name: 'deploy',
    test: cmd => (/\bvercel\b/.test(cmd) && /--prod\b/.test(cmd)) || /\bfly\s+deploy\b/.test(cmd) || /\bwrangler\s+(publish|deploy)\b/.test(cmd) || /\bnetlify\s+deploy\b.*--prod\b/.test(cmd),
    reason: 'This would deploy this project to its live, public address. Say yes to continue.',
  },
  {
    name: 'stripe',
    test: cmd => /\bstripe\b/.test(cmd) && !/\bstripe\s+(login|logout|config|version|--version|-v|help|listen|status|samples|open)\b/.test(cmd),
    reason: 'This would create or change something in a real payment account, which can charge or move money. Say yes to continue.',
  },
];

// `rm -rf`/`rm -fr`/etc: not a fixed pattern above, because whether it is
// safe depends on *what* it deletes, not just the flags. Checked after the
// fixed rules so a `git rm -r` (already covered) is not double-counted.
function rmRule(cmd, cwd) {
  const m = /\brm\s+(-\w*r\w*f\w*|-\w*f\w*r\w*)\s+(.+)$/.exec(cmd) || /\brm\s+(-\w*r\w*)\s+(.+)$/.exec(cmd);
  if (!m) return null;
  const list = targets(m[2]);
  if (!list.length) return null;
  const unsafe = list.some(t => !isSafeDeleteTarget(t, cwd));
  if (!unsafe) return null;
  return { name: 'rm-recursive', reason: 'This would permanently delete files or folders that cannot be recovered. Say yes to continue.' };
}

// The PowerShell equivalent of `rm -rf`: `Remove-Item` (or one of its
// aliases `rm`, `del`, `ri`, `rmdir`) with both a recurse flag
// (`-Recurse` or `-r`) and `-Force` present, in either order — that
// combination is what makes the delete both cross directories and skip the
// "are you sure" prompt PowerShell otherwise shows. Same
// safe-target/OS-temp-dir exception as the Bash rule.
function psRemoveRule(cmd, cwd) {
  const m = /\b(Remove-Item|rm|del|ri|rmdir)\b(.*)$/i.exec(cmd);
  if (!m) return null;
  const rest = m[2];
  const hasRecurse = /(^|\s)-r(ecurse)?\b/i.test(rest);
  const hasForce = /(^|\s)-f(orce)?\b/i.test(rest);
  if (!hasRecurse || !hasForce) return null;
  const list = targets(rest);
  if (!list.length) return null;
  const unsafe = list.some(t => !isSafeDeleteTarget(t, cwd));
  if (!unsafe) return null;
  return { name: 'ps-remove-recursive', reason: 'This would permanently delete files or folders that cannot be recovered. Say yes to continue.' };
}

// Deny, ask, or pass — the pure decision, given the command string and who is
// asking. `ctx.cwd` resolves relative delete targets; `ctx.subagent` and
// `ctx.headless` change deny-vs-ask, never which commands match.
export function decide(command, ctx = {}) {
  const cmd = String(command || '').replace(/\s+/g, ' ').trim();
  if (!cmd) return { kind: 'pass' };

  const hit = RULES.find(r => r.test(cmd)) || rmRule(cmd, ctx.cwd) || psRemoveRule(cmd, ctx.cwd);
  if (!hit) return { kind: 'pass' };

  if (ctx.subagent) {
    return { kind: 'deny', reason: `${hit.reason} A background helper cannot ask, so this is refused; report back to the lead instead of retrying.` };
  }
  if (ctx.headless) {
    return { kind: 'deny', reason: hit.reason };
  }
  return { kind: 'ask', reason: hit.reason };
}

// A project's own list of commands its user has already approved, so the
// same question is not asked forever. See docs/safety-guard.md for the file
// shape. Missing, unreadable, or malformed reads as "nothing allowed" —
// never as an error, and never as "allow everything".
export function loadAllowList(cwd) {
  const root = findRepoRoot(cwd) || cwd;
  if (!root) return [];
  const path = resolvePath(root, '.orchestrator', 'allow-bash.json');
  if (!existsSync(path)) return [];
  const data = readJson(path);
  return data && Array.isArray(data.allow) ? data.allow.map(String) : [];
}

// Whether the user has already approved this exact command (trimmed,
// whitespace-collapsed) for this project. Prefix matching would let one
// approval quietly cover a command the user never saw, so this is exact.
export function isAllowed(command, cwd) {
  const cmd = String(command || '').replace(/\s+/g, ' ').trim();
  return loadAllowList(cwd).some(p => String(p).replace(/\s+/g, ' ').trim() === cmd);
}

function emit(obj) {
  process.stdout.write(JSON.stringify(obj));
}

function main() {
  let payload = '';
  try { payload = readFileSync(0, 'utf8'); } catch {}
  let input = null;
  try { input = JSON.parse(payload); } catch { return; }
  if (!input || (input.tool_name !== 'Bash' && input.tool_name !== 'PowerShell')) return;

  const ti = input.tool_input || {};
  const command = String(ti.command || '');
  if (!command) return;

  if (isAllowed(command, input.cwd)) return;

  const subagent = Boolean(input.agent_id);
  // `bypassPermissions` is the one permission_mode the hooks doc documents
  // that means nobody sees an interactive prompt at all; a plain `-p` run
  // that never sets it is not distinguishable from an ordinary session in
  // this payload, so it still gets "ask" — see docs/safety-guard.md.
  const headless = !subagent && input.permission_mode === 'bypassPermissions';

  const d = decide(command, { cwd: input.cwd, subagent, headless });
  if (d.kind === 'pass') return;
  emit({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: d.kind, permissionDecisionReason: d.reason } });
}

if (process.argv[1] && resolvePath(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch {}
  process.exit(0);
}
