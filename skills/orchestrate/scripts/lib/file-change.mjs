// lib/file-change.mjs — did this tool call change a file, and which ones?
// Pure text functions: no file access, no child processes.
//
// Three places ask this (turn-check's unreviewed-risk fact, context-scan's
// "tool calls since your last edit" counter, compaction-snapshot's changed
// files list). In auto mode a lead changes files mostly through the shell
// (sed -i, heredocs, redirection, tee, mv/cp/rm, git apply, PowerShell
// Set-Content), so a list of the Edit/Write tools alone misses most of the work.
//
// The rule is eager, like the review word list: a shell command that is not
// clearly read-only counts as a change, because a change wrongly counted costs
// one extra reminder and a change wrongly missed skips the review silently.
// `paths` is filled in only where the command names them; `exact` says every
// change the call makes is in `paths` (so "all of them are prose files" is a
// safe thing to conclude).

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const SHELL_TOOLS = new Set(['Bash', 'PowerShell']);

export function isShellTool(name) { return SHELL_TOOLS.has(name); }

// Prose by extension, never by folder name: a user's repo has its own layout.
export function isProsePath(p) { return /\.(md|mdx|txt|rst)$/i.test(String(p || '')); }

// Split a command into segments of tokens. Splits on unquoted && || ; | and
// newlines; an unquoted > or >> (with an optional leading fd number, or &>)
// becomes a {redirect} token so a quoted ">" is never mistaken for one.
// Quotes are dropped from the token text. Heredoc bodies are taken out first
// (they are the written content, not commands) and put back into the source
// text of the segment that owns them. Each segment is {toks, text}.
function segments(command) {
  const bodies = [];
  const HEREDOC = /<<-?[ \t]*(['"]?)([A-Za-z_]\w*)\1([^\n]*)(\n[\s\S]*?(?:\n[ \t]*\2[ \t]*(?=\n|$)|$))/g;
  const src = String(command || '').replace(HEREDOC, (m, q, tag, rest, body) => `<<${tag}\u0001${bodies.push(body) - 1}\u0001${rest}`);
  const back = t => t.replace(/\u0001(\d+)\u0001/g, (m, n) => bodies[Number(n)]);
  const out = []; let seg = []; let word = ''; let has = false; let quoted = false; let start = -1; let subs = [];
  const endWord = () => { if (has) seg.push({ t: word, q: quoted }); word = ''; has = false; quoted = false; };
  const endSeg = end => { endWord(); if (seg.length) out.push({ toks: seg, text: back(src.slice(start, end)), subs }); seg = []; start = -1; subs = []; };
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (start < 0 && !/[ \t\r\n;|]/.test(ch) && !(ch === '&' && src[i + 1] === '&')) start = i;
    // $(...) and `...` stay inside their word, and what they run is read as
    // commands of its own (so `n=$(grep ...)` is an assignment, not a command).
    if ((ch === '$' && src[i + 1] === '(' && src[i + 2] !== '(') || ch === '`') {
      let end = i + 1;
      if (ch === '`') { end = src.indexOf('`', i + 1); if (end < 0) end = src.length; subs.push(back(src.slice(i + 1, end))); } else {
        for (let d = 0; end < src.length; end++) {
          if (src[end] === '(') d++; else if (src[end] === ')' && --d === 0) break;
        }
        subs.push(back(src.slice(i + 2, end)));
      }
      word += src.slice(i, end + 1); has = true; i = end; continue;
    }
    if (ch === '\'' || ch === '"') {
      const close = ch === '"' ? src.indexOf('"', i + 1) : src.indexOf('\'', i + 1);
      const end = close < 0 ? src.length : close;
      word += src.slice(i + 1, end); has = true; quoted = true; i = end; continue;
    }
    // A backslash escapes only a space or quote; elsewhere it is a Windows path separator.
    if (ch === '\\' && /[ '"]/.test(src[i + 1] || '')) { word += src[++i]; has = true; continue; }
    if (ch === ' ' || ch === '\t' || ch === '\r') { endWord(); continue; }
    if (ch === '\n' || ch === ';') { endSeg(i); continue; }
    if (ch === '|') { endSeg(i); if (src[i + 1] === '|') i++; continue; }
    if (ch === '&') {
      if (src[i + 1] === '&') { endSeg(i); i++; continue; }
      if (src[i + 1] === '>') { endWord(); i++; seg.push({ redirect: true }); if (src[i + 1] === '>') i++; continue; }
      word += ch; has = true; continue;
    }
    if (ch === '>') {
      if (has && !quoted && /^\d+$/.test(word)) { word = ''; has = false; } else endWord();
      if (src[i + 1] === '>') i++;
      if (src[i + 1] === '&') { i++; while (i + 1 < src.length && /[\w-]/.test(src[i + 1])) i++; continue; } // 2>&1: no file
      seg.push({ redirect: true }); continue;
    }
    word += ch; has = true;
  }
  endSeg(src.length);
  return out;
}

const NULLISH = /^(\/dev\/null|nul|\$null)$/i;
// Words that come before a command, and shell grammar that is not a command:
// skipped, so `do gh pr checks $p` is read as gh. A `for ...` or `case ...` head
// names no command at all (see segmentChange).
const WRAPPERS = new Set(['sudo', 'time', 'nohup', 'command', 'env', 'builtin', 'exec', 'nice',
  'if', 'then', 'else', 'elif', 'fi', 'while', 'until', 'do', 'done', 'esac', '{', '}']);

// Commands that only read (a redirect on the line still makes it a write).
const READ_ONLY = new Set([
  'grep', 'egrep', 'fgrep', 'rg', 'ag', 'cat', 'head', 'tail', 'less', 'more', 'ls', 'dir', 'tree', 'wc', 'echo', 'printf', 'pwd', 'cd',
  'sort', 'cut', 'tr', 'diff', 'cmp', 'stat', 'file', 'which', 'where', 'type', 'printenv', 'date', 'sleep', 'true', 'false', 'test', '[',
  'du', 'df', 'ps', 'whoami', 'basename', 'dirname', 'realpath', 'readlink', 'jq', 'column', 'nl', 'md5sum', 'sha256sum', 'sha1sum', 'hostname', 'uname',
  'get-content', 'get-childitem', 'gci', 'select-string', 'test-path', 'write-output', 'write-host', 'get-item', 'get-location', 'measure-object',
  'get-command', 'get-date', 'get-process', 'resolve-path', 'gc', 'sls', 'ls', 'pwd',
]);
const GIT_READ = new Set([
  'status', 'diff', 'log', 'show', 'remote', 'rev-parse', 'ls-files', 'blame', 'describe', 'grep', 'shortlog', 'reflog', 'cat-file', 'ls-tree',
  'merge-base', 'rev-list', 'show-ref', 'fetch', 'add', 'commit', 'push', 'tag', 'branch', 'config', 'worktree', 'stash', 'diff-tree', 'name-rev', 'for-each-ref', 'check-ignore', 'version', 'help',
]);
const PS_WRITE = new Set(['set-content', 'add-content', 'out-file', 'new-item', 'remove-item', 'move-item', 'copy-item', 'clear-content', 'rename-item', 'sc', 'ac', 'ni', 'ri', 'mi', 'cpi', 'rni', 'del', 'erase', 'rd', 'copy', 'move', 'ren', 'md', 'mkdir', 'tee-object']);

// What an inline node script would have to call to change a file or run a program.
const NODE_WRITES = /writeFile|appendFile|writeSync|createWriteStream|\.(?:rm|rmSync|unlink|unlinkSync|rename|renameSync|copyFile|copyFileSync|cp|cpSync|mkdir|mkdirSync|rmdir|rmdirSync|truncate|truncateSync|symlink|link|chmod)\(|\bopen(?:Sync)?\(|child_process|\bexec\w*\(|\bspawn\w*\(/;

const isOpt =t => t.q === false && /^-/.test(t.t);

// One segment (tokens, no separators) -> { changes, paths, exact }.
function segmentChange(seg, text) {
  const paths = [];
  let exact = true; let changes = false;
  // Redirection: the token after each redirect is the file written.
  const words = [];
  for (let i = 0; i < seg.length; i++) {
    if (seg[i].redirect) {
      const target = seg[i + 1] && !seg[i + 1].redirect ? seg[i + 1].t : null;
      i++;
      if (target == null) { changes = true; exact = false; continue; }
      if (NULLISH.test(target)) continue;
      changes = true; paths.push(target);
    } else words.push(seg[i]);
  }
  while (words.length && (/^[A-Za-z_]\w*=/.test(words[0].t) || WRAPPERS.has(words[0].t))) words.shift();
  if (!words.length || words[0].t === 'for' || words[0].t === 'case') return { changes, paths, exact };
  const cmd = words[0].t.replace(/^.*[\\/]/, '').replace(/\.(exe|cmd|bat)$/i, '').toLowerCase();
  const args = words.slice(1);
  const opts = args.filter(isOpt).map(a => a.t);
  const plain = args.filter(a => !isOpt(a)).map(a => a.t);
  const unsure = () => { changes = true; exact = false; };
  const writes = list => { changes = true; for (const p of list) paths.push(p); if (!list.length) exact = false; };

  if (cmd === 'bash' || cmd === 'sh' || cmd === 'zsh' || cmd === 'powershell' || cmd === 'pwsh') {
    const at = args.findIndex(a => /^-(c|command)$/i.test(a.t));
    if (at >= 0 && args[at + 1]) {
      const inner = commandChange(args[at + 1].t);
      if (inner.changes) { changes = true; paths.push(...inner.paths); if (!inner.exact) exact = false; }
      return { changes, paths, exact, text: inner.text };
    }
    unsure(); return { changes, paths, exact };
  }
  if (cmd === 'sed' || cmd === 'perl') {
    if (opts.some(o => /^-[a-zA-Z]*i|^--in-place/.test(o))) {
      // The script is the first plain word, or one per -e/-f; the rest are files.
      const scripts = args.filter(a => isOpt(a) && /^-[a-zA-Z]*[ef]$|^--(expression|file)$/.test(a.t)).length;
      writes(plain.filter(p => p !== '').slice(Math.max(1, scripts)));
    } else if (cmd === 'perl') unsure();
    return { changes, paths, exact };
  }
  if (cmd === 'awk' || cmd === 'gawk') {
    if (opts.includes('-i') || plain.some(p => /system\(|print[^;]*>|\|\s*"/.test(p))) unsure();
    return { changes, paths, exact };
  }
  if (cmd === 'sort') { if (opts.some(o => /^-[a-zA-Z]*o|^--output/.test(o))) unsure(); return { changes, paths, exact }; }
  if (cmd === 'tee') { writes(plain.filter(p => !NULLISH.test(p))); return { changes, paths, exact }; }
  if (cmd === 'find') {
    if (opts.some(o => /^-(delete|exec|execdir|ok|okdir|fprint|fprintf|fls)$/.test(o))) unsure();
    return { changes, paths, exact };
  }
  if (cmd === 'mv' || cmd === 'cp' || cmd === 'rm' || cmd === 'rmdir' || cmd === 'mkdir' || cmd === 'touch' || cmd === 'ln' || cmd === 'install' || cmd === 'truncate' || cmd === 'unlink' || cmd === 'chmod' || cmd === 'chown') {
    writes(cmd === 'chmod' || cmd === 'chown' ? plain.slice(1) : plain);
    return { changes, paths, exact };
  }
  if (cmd === 'git') {
    let i = 0;
    while (i < args.length && isOpt(args[i])) i += /^-[Cc]$/.test(args[i].t) ? 2 : 1;
    const sub = args[i] ? args[i].t : '';
    const rest = args.slice(i + 1);
    const restPlain = rest.filter(a => !isOpt(a)).map(a => a.t);
    const restOpts = rest.filter(isOpt).map(a => a.t);
    if (sub === 'checkout' || sub === 'restore') {
      const dd = rest.findIndex(a => a.t === '--');
      if (dd >= 0) writes(rest.slice(dd + 1).map(a => a.t)); else unsure();
      return { changes, paths, exact };
    }
    if (sub === 'rm' || sub === 'mv') { writes(restPlain); return { changes, paths, exact }; }
    if (GIT_READ.has(sub)) {
      // Forms of these that do touch the working tree.
      if (sub === 'stash' && !(restPlain[0] === 'list' || restPlain[0] === 'show')) unsure();
      else if (sub === 'branch' && restOpts.some(o => /^-[dDmMcC]$|^--(delete|move|copy)/.test(o))) unsure();
      return { changes, paths, exact };
    }
    unsure(); // apply, reset, clean, merge, pull, rebase, switch, cherry-pick, ...
    return { changes, paths, exact };
  }
  if (cmd === 'node' || cmd === 'npm' || cmd === 'npx') {
    // node --test / --check / -v, npm test / ls / view only read or run checks.
    if (opts.some(o => /^--(test|check|version)$|^-[cv]$/.test(o)) && cmd === 'node') return { changes, paths, exact };
    // An inline script (-e, -p, or `node -` with a heredoc) that calls nothing
    // that writes or runs a program only reads.
    if (cmd === 'node' && opts.some(o => /^(-e|-p|--eval|--print|-)$/.test(o)) && !NODE_WRITES.test(text)) return { changes, paths, exact };
    if (cmd === 'npm' && /^(test|t|ls|list|view|outdated|audit|--version|-v)$/.test(plain[0] || '')) return { changes, paths, exact };
    unsure(); return { changes, paths, exact };
  }
  if (cmd === 'gh') {
    // Only these put files on disk; create, edit, api and the rest talk to GitHub.
    if (/^(pr:checkout|repo:clone|run:download|release:download)$/.test(`${plain[0]}:${plain[1]}`)) unsure();
    return { changes, paths, exact };
  }
  if (PS_WRITE.has(cmd)) {
    // -Path / -FilePath / -LiteralPath / -Destination, else the first plain word.
    const named = [];
    args.forEach((a, k) => { if (isOpt(a) && /^-(path|filepath|literalpath|destination)$/i.test(a.t) && args[k + 1]) named.push(args[k + 1].t); });
    writes(named.length ? named : plain.slice(0, 1));
    return { changes, paths, exact };
  }
  if (READ_ONLY.has(cmd)) return { changes, paths, exact };
  unsure();
  return { changes, paths, exact };
}

function commandChange(command) {
  const paths = []; const texts = []; let changes = false; let exact = true;
  for (const seg of segments(command)) {
    for (const sub of seg.subs) {
      const s = commandChange(sub);
      if (!s.changes) continue;
      changes = true; paths.push(...s.paths); if (!s.exact) exact = false;
      texts.push(s.text);
    }
    const r = segmentChange(seg.toks, seg.text);
    if (!r.changes) continue;
    changes = true; paths.push(...r.paths); if (!r.exact) exact = false;
    texts.push(r.text != null ? r.text : seg.text);
  }
  return { changes, paths, exact, text: texts.join('\n') };
}

// name + input of one tool_use block -> { changes, paths, exact }.
export function fileChange(name, input) {
  const i = input || {};
  if (EDIT_TOOLS.has(name)) {
    const p = [i.file_path, i.notebook_path, i.path].find(x => typeof x === 'string' && x);
    return { changes: true, paths: p ? [p] : [], exact: Boolean(p) };
  }
  if (SHELL_TOOLS.has(name) && typeof i.command === 'string') {
    const r = commandChange(i.command);
    // A command that names no file it writes (the eager guess) is not "exact".
    // `text` is the source of only the pieces that write (heredoc bodies kept),
    // for matching words against what was written, not what was searched for.
    return { changes: r.changes, paths: r.paths, exact: r.changes ? r.exact && r.paths.length > 0 : true, text: r.text };
  }
  return { changes: false, paths: [], exact: true };
}
