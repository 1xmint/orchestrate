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
import { spawnSync } from 'node:child_process';
import { resolve as resolvePath, basename, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { readJson, writeJsonAtomic, findRepoRoot, DIR, sanitizeId, loadSession } from './lib/tier.mjs';
import { mentionsMerge, mergeRefusal, ghView, REVIEW_PATHS } from './lib/merge-bar.mjs';
import { paymentLine, withoutFileText } from './lib/shell-run.mjs';

export { REVIEW_PATHS };

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

// The lead's clean-up of finished helper worktrees: remove each worktree
// folder, then delete its now-unreferenced branch. Passes only when the whole
// line is commands joined by `&&` or `;`, each one of:
//   git worktree remove [-f|--force] <path>...   every path under .claude/worktrees/, no ..,
//                                     no folder with uncommitted changes (worktreeRemoveRule)
//   git worktree list                 read-only
//   git branch -d|--delete <name>...  worktree-agent-<hex> or task/<slug> only
// with at least one branch delete. A path may be quoted. The folder half may
// be forced because a folder with uncommitted changes is refused first; the
// branch half has no force flag: git refuses -d on an unmerged branch by
// itself. Anything else (a -D, a path
// elsewhere, a pipe, another kind of command) fails the match and falls
// through to the ordinary branch-delete rule below, unchanged.
const CLEANUP_BRANCH_RE = /^(?:worktree-agent-[0-9a-f]+|task\/[A-Za-z0-9._-]+)$/;
// Any branch name for the small delete: git refuses it while work is unmerged,
// so the name does not matter. Never a flag, never shell syntax.
const SMALL_DELETE_NAME_RE = /^[A-Za-z0-9._\/@+-]+$/;
const isSmallDeleteName = n => SMALL_DELETE_NAME_RE.test(n) && !n.startsWith('-');
const unquote = t => (/^(["']).*\1$/.test(t) ? t.slice(1, -1) : t);

// Options git takes before its command word (`git -C <folder> worktree remove`).
// Every rule reads the line with these taken out, so the word order cannot
// step round a check. `-C` also moves where a relative path is read from.
const GIT_GLOBALS_RE = /\bgit((?:\s+(?:-C\s+(?:"[^"]*"|'[^']*'|\S+)|-c\s+\S+|--(?:git-dir|work-tree|namespace|exec-path|config-env)(?:=|\s+)\S+|--no-pager|--paginate|-p|-P|--no-replace-objects|--bare|--literal-pathspecs|--no-optional-locks))+)(?=\s)/g;
export const plainGit = cmd => String(cmd || '').replace(GIT_GLOBALS_RE, 'git');
function gitFolders(seg) {
  const out = [];
  for (const m of String(seg).matchAll(GIT_GLOBALS_RE)) {
    for (const c of m[1].matchAll(/-C\s+("[^"]*"|'[^']*'|\S+)/g)) out.push(unquote(c[1]));
  }
  return out;
}

const FORCE_FLAGS = new Set(['-f', '-ff', '--force']);
// Git takes a long option by any unambiguous start: --fo is --force.
const isForce = a => FORCE_FLAGS.has(a) || /^--f(o(r(c(e)?)?)?)?$/.test(a);
const isHelperPath = p => !p.split('/').includes('..') && p.includes('.claude/worktrees/');

// Git Bash spells a drive as /c/rest; Node on Windows would read that as
// C:\c\rest, a folder that is not there. Translate it to C:/rest on win32
// only. Pure, so it can be tested with a platform argument.
export function gitBashPath(p, platform = process.platform) {
  const m = platform === 'win32' ? /^\/([a-zA-Z])(\/.*)?$/.exec(String(p)) : null;
  return m ? `${m[1].toUpperCase()}:${m[2] || '/'}` : String(p);
}

// Whether the folder holds work git has not saved: 'clean', 'dirty', or
// 'unknown' (git could not read it). A folder that is not there is 'clean'
// only when the caller says so (helper folders); otherwise it is 'unknown'.
function worktreeState(folder, missingIsClean) {
  if (!existsSync(folder)) return missingIsClean ? 'clean' : 'unknown';
  try {
    const r = spawnSync('git', ['status', '--porcelain'], { cwd: folder, encoding: 'utf8', timeout: 15000 });
    if (r.status !== 0) return 'unknown';
    return String(r.stdout || '').trim() !== '' ? 'dirty' : 'clean';
  } catch { return 'unknown'; }
}

// Removing a helper folder under .claude/worktrees/ (forced or not), or any
// other folder removed with force, alone or in a chain, passes only when the
// folder has no uncommitted changes. A forced removal of a folder that is
// missing or unreadable cannot be told apart from lost work, so it is refused.
// Read the way the merge check is, because every attempt to follow the shell's
// spellings lost to one more spelling: a part holding the words `worktree
// remove` must be plain, or it is refused as unreadable. Plain is git, its -C,
// -c and --no-pager options, worktree remove, --force (any start of it, quoted
// or not) and folders, each word plain or simply quoted. A brace, $, a
// backtick, a backslash, a redirect other than to /dev/null or &1, or anything
// before git (if, then, !, env, sudo, VAR=) is not. A plain `cd <folder>` part
// moves where later relative folders are read from.
const SAFE_REDIRECT_RE = /(^|\s)(?:\d?>{1,2}|&>)\s*(?:\/dev\/null|&\d)(?=[\s;&|)]|$)/g;
// The line in parts, split at ; & | ( ) or a newline outside quotes, each part
// its words: { value, plain }, read where bash reads them. Inside double quotes
// a backslash is kept before anything but " \ $ ` or a newline (C:\repo). A #
// starting a word is a comment to the end of its line. A backslash-newline
// outside quotes joins the lines. A heredoc (<<WORD outside quotes and
// comments) has its body skipped as text, unless its line pipes or starts a
// shell (cat <<X | bash, bash <<X): then the body is read as command lines.
// A << inside (( )) is a shift, not a heredoc. `unclear` is a quote left
// unclosed or a \" inside double quotes, which PowerShell, unlike bash, reads
// as a backslash and the end of the quote; after either, this cannot tell
// where a command starts.
const SHELL_WORD_RE = /^(?:.*[\/\\])?(?:(?:ba|da|z|k)?sh|pwsh|powershell|cmd)(?:\.exe)?$|^(?:eval|source|\.|xargs|exec)$/i;
const HEREDOC_RE = /^<<(-?)[ \t]*(["']?)([A-Za-z_][\w.-]*)\2/;
function lineParts(text) {
  const parts = [];
  let words = [], value = '', plain = true, started = false, q = '', escapedQuote = false;
  let pending = [], lineRuns = false, arith = 0;
  const endWord = () => {
    if (started) { words.push({ value, plain }); if (SHELL_WORD_RE.test(value)) lineRuns = true; }
    value = ''; plain = true; started = false;
  };
  const endPart = () => { endWord(); if (words.length) parts.push(words); words = []; };
  // From just after a heredoc's line, the index of the newline that ends its
  // last body, or -1 when a body has no end line (then it is not a heredoc).
  const skipBodies = from => {
    let p = from;
    for (const h of pending) {
      for (;;) {
        if (p > text.length) return -1;
        let end = text.indexOf('\n', p);
        if (end < 0) end = text.length;
        let line = text.slice(p, end).replace(/\r$/, '');
        if (h.dash) line = line.replace(/^\t+/, '');
        p = end + 1;
        if (line === h.word) break;
      }
    }
    return p - 1;
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (q === '"' && c === '\\' && /["\\$`\n]/.test(text[i + 1] ?? '')) {
        plain = false;
        if (text[i + 1] === '"') escapedQuote = true;
        if (text[++i] !== '\n') value += text[i];
      } else if (c === q) q = '';
      else { if (q === '"' && /[$`]/.test(c)) plain = false; value += c; }
      continue;
    }
    if (c === '\\' && /^\r?\n/.test(text.slice(i + 1, i + 3))) { i += text[i + 1] === '\r' ? 2 : 1; continue; }
    if (c === '#' && !started) { while (i + 1 < text.length && text[i + 1] !== '\n') i++; continue; }
    if (c === '(' && text[i + 1] === '(') arith++;
    if (c === ')' && text[i + 1] === ')' && arith) arith--;
    if (!arith && c === '<' && text[i - 1] !== '<' && text[i + 1] === '<' && text[i + 2] !== '<') {
      const m = HEREDOC_RE.exec(text.slice(i));
      if (m) pending.push({ dash: Boolean(m[1]), word: m[3] });
    }
    if (c === '|') lineRuns = true;
    if (c === '"' || c === "'") { q = c; started = true; continue; }
    if (c === '\n') {
      endPart();
      if (pending.length && !lineRuns) { const end = skipBodies(i + 1); if (end >= 0) i = end; }
      pending = []; lineRuns = false;
      continue;
    }
    if (/[;&|()]/.test(c)) { endPart(); continue; }
    if (/\s/.test(c)) { endWord(); continue; }
    // Inside a word, a backslash is kept as written (C:\repo\x); at the start
    // of one (\git, \-f), or before a space, quote or separator, it is not plain.
    if (c === '\\') {
      const next = text[i + 1];
      if (!started || next === undefined || /[\s"';&|()\\]/.test(next)) { plain = false; if (next !== undefined) value += text[++i]; }
      else value += c;
      started = true;
      continue;
    }
    if (!/[\w./:=,@#+%-]/.test(c)) plain = false;
    value += c; started = true;
  }
  if (q) plain = false;
  endPart();
  return { parts, unclear: Boolean(q) || escapedQuote };
}
const GIT_WORD_RE = /^(?:.*\/)?git(?:\.exe)?$/i;
// The folders and force of a plain `git … worktree remove …`, or null when the
// part is not that in plain words.
function readWorktreeRemove(words) {
  if (!words.every(w => w.plain) || !GIT_WORD_RE.test(words[0].value)) return null;
  const dirs = [];
  let i = 1;
  for (; i < words.length && words[i].value !== 'worktree'; i++) {
    const v = words[i].value;
    if (v === '-C' && i + 1 < words.length) dirs.push(words[++i].value);
    else if (v === '-c' && i + 1 < words.length) i++;
    else if (v !== '--no-pager') return null;
  }
  if (words[i + 1]?.value !== 'remove') return null;
  let forced = false;
  const paths = [];
  for (const { value } of words.slice(i + 2)) {
    if (isForce(value)) forced = true;
    else if (value.startsWith('-')) return null;
    else paths.push(value);
  }
  return { dirs, forced, paths };
}
// Quotes bash and PowerShell read differently: $'…' (bash ends it only at an
// unescaped '), a backtick before a quote (PowerShell's escape) and curly
// quotes (PowerShell's quotes, plain letters to bash).
const MIXED_QUOTE_RE = /\$'|`["']|[‘-‟]/;
// Every word bash or PowerShell uses to move the shell to another folder.
const CD_WORD_RE = /^(?:cd|chdir|pushd|popd|sl|set-location|push-location|pop-location)$/i;
// A cd is not followed to one place: a cd inside ( ), after ;, or into a
// folder that is not there leaves the shell where it was. So a relative folder
// is checked from the starting folder and from every place a plain cd could
// have moved to: changes in any of them refuse, and a folder found in none
// counts as not there.
function worktreeRemoveRule(cmd, cwd) {
  const text = String(cmd).replace(SAFE_REDIRECT_RE, '$1 ');
  const { parts, unclear } = lineParts(text);
  if ((unclear || MIXED_QUOTE_RE.test(text)) && /worktree\s+remove/i.test(text)) {
    return { name: 'worktree-remove-unreadable', reason: `This line removes a worktree folder, but it has a quote that is never closed, or one that bash and PowerShell read differently (\\" inside double quotes, $'…', a backtick before a quote, or a curly quote), so this check cannot tell where the removal starts or whether work that was never saved to git would be lost. Written plainly, git worktree remove <folder>, alone or joined with ; or &&, it is checked and passes when the folder is clean. ${ASK_TAIL}` };
  }
  let bases = [cwd || process.cwd()], cdUnread = '';
  for (const words of parts) {
    // A plain cd <folder> (or pushd, Set-Location, sl …) as a part's first
    // word adds a place; any other folder change (if cd x, Set-Location -Path
    // x, popd) cannot be followed.
    // A removal part is read as one even when a folder in it is named cd.
    const at = words.findIndex((w, k) => w.value.toLowerCase() === 'worktree' && words[k + 1]?.value.toLowerCase() === 'remove');
    const moves = words.findIndex(w => CD_WORD_RE.test(w.value));
    if (at < 0 && moves >= 0) {
      if (moves === 0 && words.length === 2 && words[1].plain && words[1].value !== '-' && !/^pop/i.test(words[0].value)) {
        try {
          const moved = bases.map(b => resolvePath(b, gitBashPath(words[1].value)));
          bases = [...new Set([...bases, ...moved])];
        } catch { cdUnread = words.map(w => w.value).join(' '); }
      } else cdUnread = words.map(w => w.value).join(' ');
      continue;
    }
    if (at < 0) continue;
    const r = readWorktreeRemove(words);
    if (!r) {
      const said = words.map(w => w.value).join(' ');
      const shown = said.length > 60 ? `${said.slice(0, 60)}…` : said;
      return { name: 'worktree-remove-unreadable', reason: `This removes a worktree folder, but not in plain words this check can read ("${shown}"), so it cannot tell whether work that was never saved to git would be lost. Written plainly, git worktree remove <folder>, alone or joined with ; or &&, it is checked and passes when the folder is clean. ${ASK_TAIL}` };
    }
    const dirs = r.dirs.map(f => gitBashPath(f));
    for (const raw of r.paths) {
      const path = normSlashes(raw);
      const helper = isHelperPath(path.toLowerCase());
      if (!helper && !r.forced) continue;
      const forced = r.forced;
      const what = helper ? 'the helper folder' : 'the folder';
      // An absolute folder, or an absolute -C, does not depend on any cd.
      const absolute = [...dirs, gitBashPath(path)].some(p => isAbsolute(p));
      if (cdUnread && !absolute) {
        const shown = cdUnread.length > 60 ? `${cdUnread.slice(0, 60)}…` : cdUnread;
        return { name: 'worktree-remove-unknown', reason: `This would ${forced ? 'force-delete' : 'delete'} ${what} ${path}, but the cd before it ("${shown}") is not in plain words this check can follow, so it cannot tell which folder that is or whether it holds work that was never saved to git. Use the folder's full path, or a plain cd <folder>. ${ASK_TAIL}` };
      }
      const states = [];
      for (const b of bases) {
        let folder;
        try { folder = resolvePath(b, ...dirs, gitBashPath(path)); } catch { states.push('unknown'); continue; }
        states.push(existsSync(folder) ? worktreeState(folder, false) : 'missing');
      }
      const state = states.includes('dirty') ? 'dirty'
        : states.includes('unknown') ? 'unknown'
          : states.includes('clean') ? 'clean'
            : helper ? 'clean' : 'unknown';
      if (state === 'dirty') {
        return { name: 'worktree-remove-dirty', reason: `This would delete ${what} ${path}, which still has changes that were never saved to git. ${ASK_TAIL}` };
      }
      if (state === 'unknown') {
        return { name: 'worktree-remove-unknown', reason: `This would ${forced ? 'force-delete' : 'delete'} ${what} ${path}, and this check cannot tell whether it holds work that was never saved to git (the folder is not there under that name, or git could not read it). ${ASK_TAIL}` };
      }
    }
  }
  return null;
}

// Throwing away every unsaved edit at once (`git reset --hard`, `git checkout
// -- .`, `git restore .`) is stopped only when there are edits to lose: git
// keeps no copy of work that was never committed. A clean folder, or a
// discard that names single files, passes.
function hasUnsavedEdits(folder) {
  try {
    const r = spawnSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: folder, encoding: 'utf8', timeout: 15000 });
    return r.status === 0 && String(r.stdout || '').trim() !== '';
  } catch { return false; }
}
function discardAllRule(cmd, cwd) {
  for (const seg of cmd.split(/&&|;|\|\|/)) {
    const t = plainGit(seg).trim().split(/\s+/);
    if (t[0] !== 'git') continue;
    const rest = t.slice(2).map(unquote);
    const whole = (t[1] === 'reset' && rest.includes('--hard'))
      || ((t[1] === 'checkout' || t[1] === 'restore') && rest.some(a => a === '.' || a === ':/') && !rest.includes('--staged'));
    if (!whole) continue;
    let folder;
    try { folder = resolvePath(cwd || process.cwd(), ...gitFolders(seg)); } catch { continue; }
    if (hasUnsavedEdits(folder)) {
      return { name: 'discard-unsaved', reason: `This would throw away every change in this folder that was never saved to git, with no way to get it back. ${ASK_TAIL}` };
    }
  }
  return null;
}

function isSafeWorktreeCleanupChain(cmd) {
  if (/[|<>`$(){}]|(?<!&)&(?!&)/.test(cmd)) return false;
  let deletes = 0;
  for (const seg of cmd.split(/&&|;/)) {
    const t = seg.trim().split(/\s+/);
    if (t[0] !== 'git') return false;
    if (t[1] === 'worktree' && t[2] === 'list' && t.length === 3) continue;
    if (t[1] === 'worktree' && t[2] === 'remove' && t.length > 3) {
      for (const raw of t.slice(3)) {
        if (isForce(unquote(raw))) continue;
        if (unquote(raw).startsWith('-')) return false;
      }
      continue;
    }
    if (t[1] === 'branch' && (t[2] === '-d' || t[2] === '--delete') && t.length > 3) {
      if (!t.slice(3).map(unquote).every(isSmallDeleteName)) return false;
      deletes++;
      continue;
    }
    return false;
  }
  return deletes > 0;
}

// The small delete of helper branches (`git branch -d`, which git itself refuses
// while the work is unmerged) may sit anywhere in a chain, as long as every
// other part of the chain would pass on its own. Each delete part must be
// plain: helper or task branch names only, no shell tricks.
const CHAIN_META_RE = /[|<>`$(){}]|(?<!&)&(?!&)/;
const CHAIN_TRICKS_RE =/[`<>]|\$\(|(?<!&)&(?!&)/;
const segmentsOf = cmd => cmd.split(/&&|;|\|\|/).map(s => s.trim()).filter(Boolean);
// `2>&1` only folds error text into the normal output; it writes nothing and
// hides nothing, so it never decides whether a delete is safe.
const withoutStderrJoin = cmd => cmd.replace(/\s2>&1(?=\s|;|&|\||$)/g, '');
// A delete flag inside a cluster of short flags (-df, -fd, -dr) is still a
// delete; -df is the forced one. Read only within the `git branch` part, so a
// later command's own -d flag is not taken for it.
const CLUSTERED_DELETE_RE = /\bgit\s+branch\b[^|;&]*\s-[a-zA-Z]*[dD][a-zA-Z]*(?=\s|$)/;
const isBranchDeleteSeg = seg => /\bgit\s+branch\b/.test(seg) && (/\s(-D|-d|--delete|--force-delete)(\s|$)/.test(seg) || CLUSTERED_DELETE_RE.test(seg));
// A filter that only reads what it is given. Its words are plain flags, names
// or quoted text with nothing the shell would run, so it can neither write a
// file nor start another command.
const READ_ONLY_FILTER_RE = /^(?:tail|head|wc|cat|grep)(?:\s+(?:[-\w.,:=/+]+|'[^'$`\\]*'|"[^"$`\\]*"))*$/;
// The delete part with one trailing pipe into a read-only filter taken off:
// what the delete does is the same with or without it.
function withoutReadOnlyTail(seg) {
  const i = seg.indexOf('|');
  if (i < 0) return seg;
  const rest = seg.slice(i + 1).trim();
  return rest.includes('|') || !READ_ONLY_FILTER_RE.test(rest) ? seg : seg.slice(0, i).trim();
}
function isPlainBranchDelete(seg, flags) {
  const own = withoutReadOnlyTail(seg);
  const t = own.split(/\s+/);
  return t[0] === 'git' && t[1] === 'branch' && flags.includes(t[2]) && t.length > 3 && !/[|<>`$(){}&]/.test(own)
    && t.slice(3).map(unquote).every(isSmallDeleteName);
}
// The shell syntax that follows an otherwise plain delete, from its first
// symbol on, or '' when the delete is not plain even without it.
function syntaxAfterPlainDelete(seg) {
  const i = seg.search(/[|<>`$(){}&]/);
  if (i < 0) return '';
  return isPlainBranchDelete(seg.slice(0, i).trim(), ['-d', '--delete']) ? seg.slice(i).trim() : '';
}
// Whether a part passes on its own (no rule of this guard stops it).
function segmentPasses(seg) {
  return !(RULES.find(r => r.test(seg)) || rmRule(seg) || psRemoveRule(seg));
}
function chainRestIsSafe(raw, flags) {
  const cmd = withoutStderrJoin(raw);
  const segs = segmentsOf(cmd);
  if (segs.length < 2 || CHAIN_TRICKS_RE.test(cmd)) return false;
  let deletes = 0;
  for (const seg of segs) {
    if (isBranchDeleteSeg(seg)) {
      if (!isPlainBranchDelete(seg, flags)) return false;
      deletes++;
    } else if (/^git\s+worktree\s+remove\b/.test(seg)) {
      // A plain folder removal of any path is part of the safe shape: the
      // unsaved-work check (worktreeRemoveRule) runs before this one.
      const t = seg.split(/\s+/);
      if (t.length < 4 || CHAIN_META_RE.test(seg)) return false;
      for (const raw of t.slice(3)) {
        if (isForce(unquote(raw))) continue;
        if (unquote(raw).startsWith('-')) return false;
      }
    } else if (!segmentPasses(seg)) return false;
  }
  return deletes > 0;
}
const isSafeBranchDeleteInChain = cmd => chainRestIsSafe(cmd, ['-d', '--delete']);
// A chain that is safe apart from a forced (-D) branch delete.
const isChainSafeExceptForcedDelete = cmd => chainRestIsSafe(cmd, ['-D', '--force-delete']);

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
    // One shape passes: the whole command is `git branch -d` (or --delete) of
    // helper worktree branches only, the ones Claude Code itself names
    // worktree-agent-<hex>. Git refuses -d while a branch is unmerged, so that
    // cleanup cannot lose work. -D, and -d of any other name, still ask.
    // A second shape also passes: that same delete chained after removing the
    // worktree folder it belonged to — see isSafeWorktreeCleanupChain above.
    test: raw => {
      const cmd = withoutStderrJoin(raw);
      return (/\bgit\s+branch\b.*\s(-D|-d|--delete|--force-delete)(\s|$)/.test(cmd) || /\bgit\s+branch\s+(-D|-d|--delete|--force-delete)\b/.test(cmd) || CLUSTERED_DELETE_RE.test(cmd))
        && !isPlainBranchDelete(cmd.trim(), ['-d', '--delete'])
        && !isSafeWorktreeCleanupChain(cmd)
        && !isSafeBranchDeleteInChain(cmd);
    },
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
    // Only a line that RUNS a payment action: a payment CLI as a command word,
    // a web call to a payment API host, or run code loading a payment SDK.
    // The brand word in a grep pattern, a regex or file text is not one
    // (lib/shell-run.mjs; live notes I and Q).
    name: 'payment',
    test: cmd => paymentLine(cmd),
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
// asking. `ctx.cwd` resolves relative delete targets; `ctx.subagent` (a
// helper nobody can answer) and `ctx.headless` change deny-vs-ask, never
// which commands match.
function decideOne(command, ctx = {}) {
  const asSent = String(command || '').replace(/\s+/g, ' ').trim();
  if (!asSent) return { kind: 'pass' };

  // A line that mentions a merge (lib/merge-bar.mjs) runs only in its one
  // readable shape and above the bar, in every mode: the bar is a fact gh can
  // read, not a question for whoever is present. Read from the line as sent,
  // since a newline separates commands too. An error here, in reading the line
  // or checking the bar, refuses it. `ctx.mentionsMerge` is for tests.
  let merges;
  try {
    merges = (ctx.mentionsMerge || mentionsMerge)(withoutFileText(String(command)));
  } catch (e) {
    return { kind: 'deny', reason: `Checking whether this line merges a pull request failed (${String((e && e.message) || e).slice(0, 120)}), so it is refused. Nothing was run.` };
  }
  if (merges) {
    let why;
    try {
      why = mergeRefusal(String(command), {
        cwd: ctx.cwd || process.cwd(),
        ghView: ctx.ghView || ghView,
        session: () => { try { return ctx.session || (ctx.sessionId && loadSession(ctx.sessionId)) || {}; } catch { return {}; } },
      });
    } catch (e) {
      why = `This line merges a pull request, and checking it failed (${String((e && e.message) || e).slice(0, 120)}), so it is refused. Nothing was run.`;
    }
    return why ? { kind: 'deny', reason: why } : { kind: 'pass' };
  }
  const cmd = plainGit(asSent);

  let hit = worktreeRemoveRule(String(command), ctx.cwd) || discardAllRule(asSent, ctx.cwd) || RULES.find(r => r.name !== 'payment' && r.test(cmd)) || (paymentLine(String(command)) && RULES.find(r => r.name === 'payment')) || rmRule(cmd, ctx.cwd) || psRemoveRule(cmd, ctx.cwd);
  if (!hit) return { kind: 'pass' };

  // Every branch delete in the line is the lowercase kind, so another part is
  // what stopped it: name that part, not the delete that was already right.
  if (hit.name === 'branch-delete-local') {
    const segs = segmentsOf(withoutStderrJoin(cmd));
    if (segs.filter(isBranchDeleteSeg).every(s => isPlainBranchDelete(s, ['-d', '--delete']))) {
      const other = segs.filter(s => !isBranchDeleteSeg(s))
        .map(s => RULES.find(r => r.name !== 'branch-delete-local' && r.test(s)) || rmRule(s, ctx.cwd) || psRemoveRule(s, ctx.cwd))
        .find(Boolean);
      if (other) hit = other;
    }
    // Every delete is the small kind apart from what follows it: name that part.
    if (hit.name === 'branch-delete-local') {
      const after = segs.filter(isBranchDeleteSeg).map(syntaxAfterPlainDelete);
      const extra = after.find(Boolean);
      if (extra && after.every(Boolean)) {
        const shown = extra.length > 40 ? `${extra.slice(0, 40)}…` : extra;
        hit = { name: 'branch-delete-syntax', reason: `The branch delete itself is the small kind; what is refused is the "${shown}" after it, which this check does not read through. The same delete with nothing after it passes. ${ASK_TAIL}` };
      }
    }
  }
  if (hit.name === 'branch-delete-syntax' && (ctx.subagent || ctx.headless)) {
    return { kind: 'deny', reason: `${hit.reason.replace(ASK_TAIL_RE, '')} Nothing was run.` };
  }

  // A branch delete that nobody can approve: say in plain words what is refused
  // and what works instead, with nothing about modes or files to repeat.
  if (hit.name === 'branch-delete-local' && (ctx.subagent || ctx.headless)) {
    const allLower = segmentsOf(withoutStderrJoin(cmd)).filter(isBranchDeleteSeg).every(s => /\s(-d|--delete)(\s|$)/.test(s) && !/\s(-D|--force-delete)(\s|$)/.test(s) && !/\s-[a-zA-Z]*D[a-zA-Z]*(\s|$)/.test(s) && !s.split(/\s+/).map(unquote).some(w => isForce(w) || /^-[a-zA-Z]*f[a-zA-Z]*$/.test(w)));
    if (allLower) {
      const parts = segmentsOf(withoutStderrJoin(cmd));
      const part = parts.find(s => isBranchDeleteSeg(s) ? !isPlainBranchDelete(s, ['-d', '--delete']) : !segmentPasses(s)) || String(command).trim();
      const shown = part.length > 60 ? `${part.slice(0, 60)}…` : part;
      return { kind: 'deny', reason: `The branch delete already uses the lowercase flag, so that is not what is refused. What this check does not pass is: "${shown}". Run the rest on its own, or leave this part and tell the user. Nothing was run.` };
    }
    const small = 'Deleting with the lowercase flag works for any branch that has been merged: git branch -d <name>. Git itself refuses it if the work was never merged.';
    return { kind: 'deny', reason: (isChainSafeExceptForcedDelete(cmd)
      ? `The helper folders can be removed, but the forced branch delete cannot. ${small}`
      : `This branch delete is refused, because it can throw away work that was never merged. ${small}`) };
  }

  if (ctx.subagent || ctx.headless) {
    // Nobody will be asked (a helper, or a session set to run without asking),
    // so "say yes" would be a lie; "nobody is present" was wrong too, since
    // the user may be watching an auto-mode session. Say so in
    // plain words and give the way that works, naming no mode and no file for
    // anyone to repeat. The project's own approved-commands list still works;
    // it is documented, not named in a refusal.
    const why = hit.reason.replace(ASK_TAIL_RE, '');
    if (hit.name === 'worktree-remove-dirty') {
      return { kind: 'deny', reason: `${why} This is refused here because nobody will be asked to say yes to it here. Save what is needed first: commit the changes inside that folder, or copy the files into the main folder and commit them there. Then remove the folder without force. Or leave the folder where it is and tell the user it is there.` };
    }
    if (ctx.subagent) {
      return { kind: 'deny', reason: `${why} The question cannot be answered here, so this is refused: report back what you were about to run instead of retrying.` };
    }
    return { kind: 'deny', reason: `${why} This is refused here because nobody will be asked to say yes to it here. Nothing was run. Leave it and tell the user what you were about to run, or ask them to run it themselves in a normal session.` };
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

// One place where every refusal is finished: a line of several parts that is
// refused because of one part says, in one plain sentence, that none of it ran.
export function decide(command, ctx = {}) {
  const d = decideOne(command, ctx);
  if (d.kind !== 'deny') return d;
  const parts = String(command || '').split(/&&|;|\|/).filter(x => x.trim());
  return parts.length > 1 ? { ...d, reason: d.reason.replace(' Nothing was run.', '') + ' Nothing in this line ran.' } : d;
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

// Permission modes in which a person sees and answers prompts, including a
// helper's prompt surfaced in the main session.
const ANSWERABLE_MODES = new Set(['default', 'acceptEdits', 'plan']);

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

  // The approved-commands list never lifts the merge bar: Claude can write that
  // file itself, so it cannot be what vouches for a merge. A check that throws
  // counts as a merge, and decide() then refuses the line.
  if (isAllowed(command, input.cwd)) {
    let merges = true;
    try { merges = mentionsMerge(withoutFileText(command)); } catch {}
    if (!merges) return;
  }

  // `bypassPermissions`, `auto`, and `dontAsk` are the permission_modes where
  // nobody sees an interactive prompt at all — an "ask" would just sit there
  // with no one to answer it. A plain `-p` run that never sets one of these
  // is not distinguishable from an ordinary session in this payload, so it
  // still gets "ask" — see docs/safety-guard.md.
  const mode = input.permission_mode;
  // The host surfaces a background helper's permission prompt in the main
  // session, so in a mode where a person answers prompts the helper gets the
  // same "ask" the main session would. In any other mode, or when the mode is
  // missing, nobody can say yes and the helper is refused.
  const subagent = Boolean(input.agent_id) && !ANSWERABLE_MODES.has(mode);
  const headless = !subagent && (mode === 'bypassPermissions' || mode === 'auto' || mode === 'dontAsk');

  const d = decide(command, { cwd: input.cwd, subagent, headless, mode, sessionId: input.session_id });
  if (d.kind === 'pass') return;
  emit({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: d.kind, permissionDecisionReason: d.reason } });
}

if (process.argv[1] && resolvePath(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch {}
  process.exit(0);
}
