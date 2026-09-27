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
import { createHash } from 'node:crypto';
import { readJson, writeJsonAtomic, findRepoRoot, DIR, sanitizeId } from './lib/tier.mjs';

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
// The tail every "ask" reason ends with. A headless run (no one who can type
// "yes") gets this stripped off in `decide()` below and replaced with the
// two real ways forward; a repeat of the same command in the same session
// gets this kept but the whole reason prefixed "Asked already: " instead of
// asked fresh, so a model that cannot get an answer stops and reports back
// rather than sending the same command again.
const ASK_TAIL = 'Say yes to continue. If nobody can answer here, stop and tell the user what you were about to run instead of trying again.';
const ASK_TAIL_RE = / Say yes to continue\. If nobody can answer here, stop and tell the user what you were about to run instead of trying again\.$/;

// Command-line database clients this guard watches for a destructive drop or
// truncate. Matched by name only (word-boundaried), so `mongodb` in an
// unrelated path does not trip `mongo`.
const DB_TOOL_RE = /\b(psql|mysql|sqlite3|mongosh|mongo|redis-cli)\b/i;
// `drop database|table|schema` or `truncate`, wherever they sit on the
// command line — including inside a `-c`/`-e`/`--eval` string, since this
// tests the whole command text, not just flags. Requires whitespace between
// `drop` and its object, so a file name like `drop_table.sql` never matches.
const DROP_TRUNCATE_RE = /\b(drop\s+(database|table|schema)|truncate)\b/i;

// Whether the command line destroys data in a database: one of the watched
// CLI tools paired with drop/truncate anywhere on the line, or one of the
// specific destructive shapes (a JS call inside a mongosh/mongo --eval, a
// redis-cli flush, or a named ORM/migration command) that do not use the
// word "drop" or "truncate" themselves. Not a shell parser — it reads the
// whole command string, which is why `cat migrations/drop_table.sql` and
// `grep -r "drop table" src` (no database CLI tool present) stay silent.
function isDataStoreDestroy(cmd) {
  if (DB_TOOL_RE.test(cmd) && DROP_TRUNCATE_RE.test(cmd)) return true;
  if (/\bdropDatabase\s*\(\s*\)/.test(cmd)) return true;
  if (DB_TOOL_RE.test(cmd) && /\.drop\s*\(\s*\)/.test(cmd)) return true;
  if (/\bredis-cli\b/i.test(cmd) && /\b(flushall|flushdb)\b/i.test(cmd)) return true;
  if (/\bprisma\s+migrate\s+reset\b/i.test(cmd)) return true;
  if (/\bprisma\s+db\s+push\b/i.test(cmd) && /--force-reset\b/i.test(cmd)) return true;
  if (/\brails\s+db:(drop|reset)\b/i.test(cmd)) return true;
  if (/\bknex\s+migrate:rollback\b/i.test(cmd) && /--all\b/i.test(cmd)) return true;
  if (/\bdropdb\b/i.test(cmd)) return true;
  return false;
}

// Whether the command line ends processes by name rather than by one known
// id: `taskkill /IM node.exe` (also `//IM` from a POSIX shell on Windows and
// `-IM`), `pkill`, `killall`, a `kill -9`/`-KILL` whose target is anything
// but plain process ids (a `$(pgrep …)`, a backtick, `-1` for everything), and
// PowerShell's `Stop-Process -Name` or a `Get-Process | Stop-Process` pipe.
// `taskkill /PID 123`, `kill -9 12345` and `Stop-Process -Id 5` name one
// process the caller already knows and pass. A helper stopping the test
// server it started has a pid for it; a name kills every program by that
// name on the machine, other people's servers and sessions included.
function isProcessKill(cmd) {
  if (/\btaskkill\b/i.test(cmd) && /(^|\s)(\/\/?|-)im\b/i.test(cmd)) return true;
  if (/\b(pkill|killall)\b/.test(cmd)) return true;
  const k = /\bkill\s+(?:-9|-KILL|-SIGKILL|-s\s+(?:SIG)?KILL)\b\s*(.*)$/i.exec(cmd);
  if (k) {
    const targets = k[1].trim().split(/\s+/).filter(Boolean);
    if (targets.length && !targets.every(t => /^\d+$/.test(t))) return true;
  }
  if (/\bStop-Process\b/i.test(cmd) && /\s-(Process)?Name\b/i.test(cmd)) return true;
  if (/\bGet-Process\b/i.test(cmd) && /\|\s*Stop-Process\b/i.test(cmd)) return true;
  return false;
}

const RULES = [
  {
    name: 'branch-delete-remote',
    test: cmd => /\bgit\s+push\b/.test(cmd) && (/--delete\b/.test(cmd) || /(^|\s):[^\s:][^\s]*/.test(cmd)),
    reason: `This would permanently delete a branch on the shared remote, which anyone else using it would lose. ${ASK_TAIL}`,
  },
  {
    name: 'push-force',
    test: cmd => /\bgit\s+push\b/.test(cmd) && /(--force(-with-lease)?\b|(^|\s)-f\b)/.test(cmd),
    reason: `This would overwrite the history of a shared branch, which can erase other people’s work. ${ASK_TAIL}`,
  },
  {
    name: 'branch-delete-local',
    test: cmd => /\bgit\s+branch\b.*\s(-D|-d|--delete|--force-delete)(\s|$)/.test(cmd) || /\bgit\s+branch\s+(-D|-d|--delete|--force-delete)\b/.test(cmd),
    reason: `This would permanently delete a branch. ${ASK_TAIL}`,
  },
  {
    name: 'git-rm-recursive',
    test: cmd => /\bgit\s+rm\b/.test(cmd) && /\s-\w*r\w*\b/.test(cmd),
    reason: `This would remove tracked files and folders from the project. ${ASK_TAIL}`,
  },
  {
    name: 'git-clean',
    test: cmd => /\bgit\s+clean\b/.test(cmd) && /\s-\w*f\w*\b/.test(cmd),
    reason: `This would permanently delete files that are not tracked by git, with no way to undo it. ${ASK_TAIL}`,
  },
  {
    name: 'npm-publish',
    test: cmd => /\bnpm\s+publish\b/.test(cmd) || /\byarn\s+publish\b/.test(cmd) || /\bpnpm\s+publish\b/.test(cmd),
    reason: `This would publish a new version of this package for anyone to install. ${ASK_TAIL}`,
  },
  {
    name: 'gh-release',
    test: cmd => /\bgh\s+release\s+create\b/.test(cmd),
    reason: `This would publish a new release of this project. ${ASK_TAIL}`,
  },
  {
    name: 'deploy',
    test: cmd => (/\bvercel\b/.test(cmd) && /--prod\b/.test(cmd)) || /\bfly\s+deploy\b/.test(cmd) || /\bwrangler\s+(publish|deploy)\b/.test(cmd) || /\bnetlify\s+deploy\b.*--prod\b/.test(cmd),
    reason: `This would deploy this project to its live, public address. ${ASK_TAIL}`,
  },
  {
    name: 'stripe',
    test: cmd => /\bstripe\b/.test(cmd) && !/\bstripe\s+(login|logout|config|version|--version|-v|help|listen|status|samples|open)\b/.test(cmd),
    reason: `This would create or change something in a real payment account, which can charge or move money. ${ASK_TAIL}`,
  },
  {
    name: 'data-store-destroy',
    test: cmd => isDataStoreDestroy(cmd),
    reason: `This would permanently delete data in a database, which cannot be undone. ${ASK_TAIL}`,
  },
  {
    name: 'process-kill',
    test: cmd => isProcessKill(cmd),
    reason: `This would end every running program with that name on this machine, not only the one you started, including other people’s servers and sessions. ${ASK_TAIL}`,
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
  return { name: 'rm-recursive', reason: `This would permanently delete files or folders that cannot be recovered. ${ASK_TAIL}` };
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
  return { name: 'ps-remove-recursive', reason: `This would permanently delete files or folders that cannot be recovered. ${ASK_TAIL}` };
}

// Per-session memory of which exact commands have already gotten an "ask"
// decision, so the second identical retry (a headless model that cannot see
// the answer, or a script that just resends the same call) is told it was
// already asked instead of being asked again as if for the first time. One
// small JSON file per session under the plugin's own state dir; missing,
// unreadable, or malformed reads as "nothing asked yet" — never as an error.
function askLogPath(sessionId) {
  return resolvePath(DIR, 'ask-log', `${sanitizeId(sessionId)}.json`);
}

function hashCommand(cmd) {
  return createHash('sha1').update(cmd).digest('hex');
}

export function wasAskedBefore(sessionId, command) {
  if (!sessionId) return false;
  const data = readJson(askLogPath(sessionId));
  if (!data || !Array.isArray(data.asked)) return false;
  return data.asked.includes(hashCommand(command));
}

export function recordAsked(sessionId, command) {
  if (!sessionId) return;
  const path = askLogPath(sessionId);
  const data = readJson(path) || { asked: [] };
  if (!Array.isArray(data.asked)) data.asked = [];
  const hash = hashCommand(command);
  if (!data.asked.includes(hash)) data.asked.push(hash);
  try { writeJsonAtomic(path, data); } catch {}
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
    return { kind: 'deny', reason: `${hit.reason.replace(ASK_TAIL_RE, '')} A background helper cannot ask, so this is refused: report back to the lead instead of retrying.` };
  }
  if (ctx.headless) {
    // Nobody can answer a question in this mode, so "say yes" would be a
    // lie: name the mode in plain words and the two real ways forward.
    const mode = ctx.mode ? `${ctx.mode} mode` : 'this mode';
    return { kind: 'deny', reason: `${hit.reason.replace(ASK_TAIL_RE, '')} You are in ${mode}, where nobody can say yes, so this is refused: run it yourself in a normal session, or add the exact command to .orchestrator/allow-bash.json.` };
  }
  // A real interactive user who already said yes is not blocked by this: the
  // host applies their answer before the hook ever sees the next call. This
  // only catches the case the packet measured — the same command sent again
  // in the same session before anyone answered the first ask.
  if (ctx.sessionId && wasAskedBefore(ctx.sessionId, cmd)) {
    return { kind: 'ask', reason: `Asked already: ${hit.reason}` };
  }
  if (ctx.sessionId) recordAsked(ctx.sessionId, cmd);
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
  // `bypassPermissions`, `auto`, and `dontAsk` are the permission_modes where
  // nobody sees an interactive prompt at all — an "ask" would just sit there
  // with no one to answer it. A plain `-p` run that never sets one of these
  // is not distinguishable from an ordinary session in this payload, so it
  // still gets "ask" — see docs/safety-guard.md.
  const mode = input.permission_mode;
  const headless = !subagent && (mode === 'bypassPermissions' || mode === 'auto' || mode === 'dontAsk');

  const d = decide(command, { cwd: input.cwd, subagent, headless, mode, sessionId: input.session_id });
  if (d.kind === 'pass') return;
  emit({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: d.kind, permissionDecisionReason: d.reason } });
}

if (process.argv[1] && resolvePath(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch {}
  process.exit(0);
}
