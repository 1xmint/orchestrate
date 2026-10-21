// What a shell line actually RUNS, as opposed to the words it contains.
//
// The payment rule used to refuse any line with the word "stripe" in it, so a
// grep pattern, a regex in a test, or prose written into a file was refused as
// if it moved money (live notes I, Q, 2026-09-30). These helpers read the line
// the way a shell would, well enough to tell a command word from text:
// segments split on unquoted ; && || | & and newlines, heredoc bodies kept only
// when they are fed to an interpreter, and `bash -c "…"`, `env`, `sudo`, `npx`
// unwrapped. They lean towards reading more as code, never less: `$(…)` and
// backticks are read wherever they appear.
//
// The parser does not model every shell shape, so for the payment rule and the
// merge check it only ever NARROWS a check on a plain line (plainLine below):
// every segment a search, a read, or text going into a file, and no construct
// it cannot follow. Any other line is read word by word, as before (review
// 9-30-0004: `cat <<EOF | bash`, `for … do`, `timeout`, `eval` all slipped
// past a parser that guessed). The guard's other rules read every line
// command by command through commandsIn, at the end of this file, which leans
// the same way: what a shell is handed is read as commands, and a line that
// starts a shell reads what it writes.

const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh', 'pwsh', 'powershell', 'cmd']);
const LANGS = new Set(['node', 'nodejs', 'python', 'python3', 'py', 'ruby', 'deno', 'bun', 'php', 'perl', 'tsx', 'ts-node']);
const WRAPPERS = new Set(['env', 'sudo', 'npx', 'exec', 'command', 'time', 'nohup', 'nice', 'xargs', 'doas', 'bunx', 'pnpx', 'timeout', 'watch', 'parallel']);
// Wrapper flags that take the next word as their value.
const WRAPPER_ARG_FLAGS = { nice: /^-n$/, sudo: /^-[ugCDhpRrT]$/, xargs: /^-[nIPLEsd]$/, env: /^-[uC]$/, timeout: /^-[sk]$/, watch: /^-n$/, doas: /^-[uC]$/ };
// Plain-line allowlist: commands that search or read and cannot run text.
// Not sed, awk, find or xargs: each has a way to run a command.
const READERS = new Set(['grep', 'egrep', 'fgrep', 'rg', 'select-string', 'sls', 'findstr', 'cat', 'head', 'tail', 'wc', 'ls', 'pwd', 'cd', 'mkdir', 'echo', 'printf', 'type', 'get-content', 'write-output']);
const GIT_READ_RE = /^(grep|log|show|diff|status|blame|add)$/;
// A file git or rg reads its settings from, or a `.git` folder or gitdir file.
const RUN_CONFIG_RE = /(^|[\\/])\.git($|[\\/])|gitattributes|gitconfig|ripgreprc|(^|[\\/])\.config[\\/]git($|[\\/])/i;
const FETCHERS = new Set(['curl', 'wget', 'http', 'https', 'xh', 'invoke-webrequest', 'invoke-restmethod', 'iwr', 'irm']);

// Payment services' API hosts: a web call to one of these is a payment action.
export const PAYMENT_HOSTS_RE = /\b(api\.stripe\.com|api(-m)?\.(sandbox\.)?paypal\.com|api\.braintreegateway\.com|connect\.squareup(sandbox)?\.com|api\.lemonsqueezy\.com|(sandbox-)?api\.paddle\.com|api\.razorpay\.com|checkout(-test)?\.adyen\.com|api\.mollie\.com|api\.gocardless\.com)\b/i;
// Loading a payment SDK in code that is being run.
const PAYMENT_SDK_RE = /require\(\s*['"](stripe|@paypal\/[\w-]+|braintree|square|razorpay|@mollie\/api-client)['"]\s*\)|\bfrom\s+['"](stripe|@paypal\/[\w-]+|braintree|square|razorpay)['"]|^\s*(import|from)\s+(stripe|braintree|squareup|razorpay|paypalrestsdk)\b/m;
// Stripe CLI subcommands that read or configure, never charge.
const STRIPE_SAFE_RE = /^(login|logout|config|version|--version|-v|help|--help|-h|listen|status|samples|open|completion|logs)$/;

const base = w => String(w || '').replace(/^.*[\\/]/, '').replace(/\.(exe|cmd|bat)$/i, '').toLowerCase();

// Split on unquoted separators. Quotes and escapes are honoured; heredoc
// bodies must already be handled by the caller.
export function segments(text) {
  const out = [];
  let cur = '', q = null;
  const s = String(text || '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      cur += c;
      if (c === '\\' && q === '"' && i + 1 < s.length) { cur += s[++i]; continue; }
      if (c === q) q = null;
      continue;
    }
    if (c === '\\' && i + 1 < s.length) { cur += c + s[++i]; continue; }
    if (c === '"' || c === "'") { q = c; cur += c; continue; }
    if (c === ';' || c === '\n' || c === '|' || c === '&') {
      if (c === '&' && (s[i - 1] === '>' || s[i + 1] === '>')) { cur += c; continue; } // 2>&1, &>
      out.push(cur); cur = '';
      if ((c === '|' || c === '&') && s[i + 1] === c) i++;
      continue;
    }
    cur += c;
  }
  out.push(cur);
  return out.map(x => x.trim()).filter(Boolean);
}

// Words of one segment, quotes removed.
export function words(seg) {
  const out = [];
  let cur = '', q = null, has = false;
  for (let i = 0; i < seg.length; i++) {
    const c = seg[i];
    if (q) {
      if (c === q) { q = null; continue; }
      if (c === '\\' && q === '"' && i + 1 < seg.length) { cur += seg[++i]; continue; }
      cur += c; continue;
    }
    if (c === '"' || c === "'") { q = c; has = true; continue; }
    if (c === '\\' && i + 1 < seg.length) { cur += seg[++i]; has = true; continue; }
    if (/\s/.test(c)) { if (cur || has) out.push(cur); cur = ''; has = false; continue; }
    cur += c; has = true;
  }
  if (cur || has) out.push(cur);
  return out;
}

// The command word and its arguments once leading VAR=x assignments and
// wrappers (env, sudo, npx …, with their own flags) are peeled off.
export function commandOf(seg) {
  let w = words(seg);
  for (let guard = 0; guard < 8 && w.length; guard++) {
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w[0])) { w = w.slice(1); continue; }
    const b = base(w[0]);
    if (WRAPPERS.has(b)) {
      w = w.slice(1);
      while (w.length && (w[0].startsWith('-') || /^[A-Za-z_][A-Za-z0-9_]*=/.test(w[0]))) {
        w = w.slice(WRAPPER_ARG_FLAGS[b] && WRAPPER_ARG_FLAGS[b].test(w[0]) ? 2 : 1);
      }
      if (b === 'timeout' && w.length && /^\d/.test(w[0])) w = w.slice(1); // the duration
      continue;
    }
    break;
  }
  return w;
}

// Split a line into what runs and what is only data. Each heredoc body is
// either attached to its command as code (when that command is a shell or an
// interpreter reading stdin) or dropped (cat > f, tee, anything else).
// Returns { line, code: [{ kind: 'shell'|'lang', text }], bodies: [{ text,
// toFile }] }; toFile is true only when the body's reader writes it to a file
// (`cat > f <<EOF`, `tee f <<EOF`), never when it is piped on.
export function splitHeredocs(text) {
  const lines = String(text || '').split('\n');
  const kept = [];
  const code = [];
  const bodies = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const at = unquotedHeredoc(line);
    kept.push(line);
    if (at < 0) continue;
    const m = /^<<-?\s*(['"]?)([A-Za-z_][\w.-]*)\1/.exec(line.slice(at));
    if (!m) continue;
    const end = m[2];
    const body = [];
    let j = i + 1;
    for (; j < lines.length; j++) {
      if (lines[j].replace(/^\t+/, '').trim() === end) break;
      body.push(lines[j]);
    }
    const head = segments(line.slice(0, at)).pop() || '';
    const cmd = base(commandOf(head)[0]);
    if (SHELLS.has(cmd)) code.push({ kind: 'shell', text: body.join('\n') });
    else if (LANGS.has(cmd)) code.push({ kind: 'lang', text: body.join('\n') });
    // The whole segment holding the marker, so `cat <<EOF > f` counts as a file.
    const rest = line.slice(at + m[0].length);
    const own = `${head} ${/^\s*[;&|]/.test(rest) ? '' : segments(rest)[0] || ''}`;
    // An unquoted marker means the shell still expands $( ) and backticks in the body.
    bodies.push({ text: body.join('\n'), toFile: isTextToFile(own) && TEXT_CMDS.has(base(plainWords(own)[0])), expands: !m[1] });
    i = j;
  }
  return { line: kept.join('\n'), code, bodies };
}

// Index of the first `<<` outside quotes that is not `<<<`, or -1.
function unquotedHeredoc(line) {
  let q = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '\\' && q === '"') i++; else if (c === q) q = null; continue; }
    if (c === '\\') { i++; continue; }
    if (c === '"' || c === "'") { q = c; continue; }
    if (c === '<' && line[i + 1] === '<' && line[i + 2] !== '<' && line[i - 1] !== '<') return i;
  }
  return -1;
}

// Text that only goes into a file: `echo …  > f`, `printf … >> f`. Returns the
// segment unchanged when it is anything else.
const TEXT_CMDS = new Set(['echo', 'printf', 'cat', 'tee', 'write-output', 'set-content', 'add-content', 'out-file']);
export function isTextToFile(seg) {
  const w = commandOf(seg);
  const b = base(w[0]);
  // `>&1` sends to another stream, not a file.
  return TEXT_CMDS.has(b)
    && (b === 'tee' || /(^|[^>&0-9])>>?\s*[^\s&]/.test(seg) || /^(set-content|add-content|out-file)$/.test(b));
}

// The files a text command writes: what follows `>` or `>>`, tee's file
// arguments, and every argument of the PowerShell writers.
function textTargets(seg, b) {
  const out = [];
  let q = null;
  for (let i = 0; i < seg.length; i++) {
    const c = seg[i];
    if (q) { if (c === '\\' && q === '"') i++; else if (c === q) q = null; continue; }
    if (c === '\\') { i++; continue; }
    if (c === '"' || c === "'") { q = c; continue; }
    if (c !== '>') continue;
    while (seg[i + 1] === '>') i++;
    const t = words(seg.slice(i + 1))[0];
    if (t !== undefined) out.push(t);
  }
  if (b === 'tee' || /^(set-content|add-content|out-file)$/.test(b)) out.push(...words(seg).slice(1).filter(x => !/^-/.test(x)));
  return out;
}

// Words with leading VAR=x assignments removed, wrappers kept.
function plainWords(seg) {
  const w = words(seg);
  let k = 0;
  while (k < w.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(w[k])) k++;
  return w.slice(k);
}

// Text with quoted spans blanked, for constructs that only count unquoted.
function unquotedText(s) {
  let out = '', q = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '\\' && q === '"') { i++; out += '  '; continue; } if (c === q) q = null; out += ' '; continue; }
    if (c === '\\') { i++; out += '  '; continue; }
    if (c === '"' || c === "'") { q = c; out += ' '; continue; }
    out += c;
  }
  return out;
}

// Shapes the parser does not follow. `$(…)` and backticks run even inside
// double quotes, so those are looked for anywhere.
function unmodelled(s) {
  if (/\$\(|`|<\(|>\(|<<<|\$'/.test(s)) return true;
  const u = unquotedText(s).replace(/\d?>&\d?-?(?=\s|$)/g, m => (m === '2>&1' ? '' : m));
  return /[(){}!]|>&/.test(u);
}

// One segment of a plain line: a pure assignment, a search or read, text to
// a file, a git read, or a stripe subcommand that never charges.
function plainSegment(seg) {
  const all = words(seg);
  const w = plainWords(seg);
  if (!w.length) return true;
  if (w.length !== all.length) return false; // `PAGER=… git log` runs the assignment
  const b = base(w[0]);
  // Text into git's or rg's own settings is not inert: a git read on the same
  // line runs what it names (core.fsmonitor, a textconv, a filter). Only where
  // it lands counts, so a note that mentions .git/hooks stays plain; a `cd`
  // into a .git folder makes a bare `>> config` land there.
  // Any redirect counts (`1>`, `&>`), whatever the command.
  if (textTargets(seg, b).some(t => RUN_CONFIG_RE.test(t))) return false;
  if (TEXT_CMDS.has(b) && isTextToFile(seg)) return true;
  if (b === 'cd' && w.slice(1).some(t => RUN_CONFIG_RE.test(t))) return false;
  // rg runs a program for --pre and --hostname-bin; git grep for -O, which
  // groups with other short flags (-iO) and takes any long prefix (--open).
  if (b === 'rg' && w.some(x => /^--(pre|hostname-bin|hyperlink)/.test(x))) return false;
  if (READERS.has(b)) return true;
  if (b === 'git') return GIT_READ_RE.test(w[1] || '') && !(w[1] === 'grep' && w.some(x => /^-[^-]*O|^--(no-)?o/.test(x)));
  if (b === 'stripe') return STRIPE_SAFE_RE.test(w[1] || '') && (!/^-/.test(w[1]) || w.length === 2);
  if (b === 'node') return w.length === 3 && /^(-e|-p|--eval|--print)$/.test(w[1]) && pureInline(w[2]);
  return false;
}

// Inline node code that can only touch local files and print (note I): its
// only require is fs, path or a relative .json, and nothing that reaches a
// process, the network or dynamic code.
const INLINE_IO_RE = /child_process|\bexec|spawn|\bfork\b|fetch|https?\b|\bnet\b|\bdgram\b|\btls\b|request|axios|undici|import\s*\(|\bimport\b|\beval\b|Function|\bprocess\.(binding|dlopen|env)\b|worker_threads|\bvm\b|\bmodule\b|globalThis|\bglobal\b|\[\s*['"]/;
function pureInline(code) {
  const s = String(code || '');
  if (INLINE_IO_RE.test(s)) return false;
  for (const m of s.matchAll(/\brequire\b(\s*\(\s*(['"])([^'"]*)\2\s*\))?/g)) {
    if (!m[1] || !/^((node:)?(fs|path)|\.{1,2}\/[\w./-]+\.json)$/.test(m[3])) return false;
  }
  return true;
}

// A line the parser can vouch for: nothing it cannot follow, every heredoc
// written to a file, every segment on the allowlist.
export function plainLine(text) {
  const { line, bodies } = splitHeredocs(String(text || ''));
  if (unmodelled(line)) return false;
  if (bodies.some(b => !b.toFile || (b.expands && /\$\(|`/.test(b.text)))) return false;
  const segs = segments(line);
  // A git read or rg runs what its settings name, and a path can be spelled
  // into `.git` endlessly (`"$D"it`, `$_`, `.gi?`, `.\.git`, `.git.`), so with
  // one on the line, any write at all makes the line not plain, wherever it
  // lands. Writing nowhere (`2>&1`, `/dev/null`, `nul`) is not a write; `$null`
  // is, since in bash it is a variable the line itself can set.
  const reads = segs.some(s => {
    const w = plainWords(s);
    const b = base(w[0] || '');
    return b === 'rg' || (b === 'git' && GIT_READ_RE.test(w[1] || ''));
  });
  if (reads && (bodies.some(b => b.toFile) || segs.some(writes))) return false;
  return segs.every(plainSegment);
}

// Does this segment write a file: a redirect or text writer's target, a
// folder made, git's own `--output` (git takes `--ou` for it), inline node,
// which can reach fs, or the payment CLI, whose `config --set` writes a file?
function writes(seg) {
  const w = plainWords(seg);
  const b = base(w[0] || '');
  if (textTargets(seg, b).some(t => !/^(&\d?-?|\/dev\/null|nul)$/i.test(t))) return true;
  if (b === 'mkdir' || b === 'node' || b === 'stripe') return true;
  return b === 'git' && w.some(x => /^--ou/.test(x));
}

// Does this line act on a payment account? What it runs (runsPayment), or,
// on any line that is not plain, the brand word or a payment API host anywhere
// (a host reached through a script file, `curl -K`, or `wsl`/`ssh`).
export function paymentLine(text) {
  const s = String(text || '');
  if (runsPayment(s)) return true;
  return (/\bstripe\b/i.test(s) || PAYMENT_HOSTS_RE.test(s)) && !plainLine(s);
}

// Every piece of shell that would run, flattened: the top-level segments,
// shells' heredoc bodies, `bash -c "…"` strings and `$(…)`/backtick contents,
// recursively. Interpreter code (node -e, python heredocs) is returned apart.
export function runnable(text, depth = 0) {
  const out = { shell: [], lang: [] };
  if (depth > 4) return out;
  const { line, code } = splitHeredocs(text);
  for (const c of code) {
    if (c.kind === 'lang') out.lang.push(c.text);
    else merge(out, runnable(c.text, depth + 1));
  }
  for (const m of line.matchAll(/\$\(([^()]*)\)|`([^`]*)`/g)) merge(out, runnable(m[1] ?? m[2], depth + 1));
  for (const seg of segments(line)) {
    const w = commandOf(seg);
    const b = base(w[0]);
    if (SHELLS.has(b)) {
      const k = w.findIndex(x => /^(-[a-z]*c|-command|\/c)$/i.test(x));
      if (k >= 0 && w[k + 1] != null) merge(out, runnable(w.slice(k + 1).join(' '), depth + 1));
    }
    if (LANGS.has(b)) {
      const k = w.findIndex(x => /^(-e|-c|--eval|-p|--print|-r|-E)$/.test(x));
      if (k >= 0 && w[k + 1] != null) out.lang.push(w[k + 1]);
    }
    out.shell.push(seg);
  }
  return out;
}
function merge(a, b) { a.shell.push(...b.shell); a.lang.push(...b.lang); }

// Does this line actually run a payment action? A payment CLI as a command
// word, a web call to a payment API host, or interpreter code that loads a
// payment SDK or calls such a host.
export function runsPayment(text) {
  const { shell, lang } = runnable(text);
  for (const seg of shell) {
    const w = commandOf(seg);
    const b = base(w[0]);
    if (b === 'stripe') {
      const sub = w.slice(1).find(x => !x.startsWith('--api-key') && !x.startsWith('--project-name')) || '';
      if (!STRIPE_SAFE_RE.test(sub)) return true;
    }
    if (FETCHERS.has(b) && w.slice(1).some(x => PAYMENT_HOSTS_RE.test(x))) return true;
  }
  return lang.some(code => PAYMENT_SDK_RE.test(code) || PAYMENT_HOSTS_RE.test(code));
}

// ---- Every command a line runs, word by word -------------------------------
//
// guard-bash.mjs reads its rules for destructive commands one command at a
// time, on what commandsIn returns: each command the line runs, as its words
// ({ value, quoted }) with the quotes taken off. The line splits where the
// shell splits it: ; & && | || and newlines, ( ), and a { or } standing as a
// word (a bash group or a PowerShell script block; a list such as {a,b} stays
// in its word). A redirection (>out, 2>/dev/null, 2>&1, <in, 2>$null) is not a
// word, and a comment is skipped. Quoted text is one word whatever it says, and
// a heredoc body is text. What does run is read as commands of its own: $(…),
// backticks and <(…), anywhere but inside single quotes or a quoted heredoc
// body; the string handed to a shell (bash, sh, zsh … -c, pwsh -Command,
// powershell -c, cmd /c), wherever the shell word stands (sudo, xargs, docker
// exec, find -exec); and what eval and ssh host are given. When any command on
// the line starts a shell (bash x.sh, | sh, source x.sh, ./x.sh), heredoc
// bodies, here-strings (<<<) and echo or printf text are read as commands too:
// what they write or feed may be the script that shell runs. A PowerShell
// here-string (@'…'@) is text.
//
// Like the rest of this file it is not a full shell parser. It is built to read
// what Claude writes by mistake, not a line built to slip past it.

const SH_RE = /^(?:ba|da|z|k|a|fi)?sh$/;
// Commands whose words are a search pattern, text to show, or a name to look
// up: nothing in them runs. $(…) inside them is still read.
const DATA_CMDS = new Set(['grep', 'egrep', 'fgrep', 'zgrep', 'rg', 'ag', 'ack', 'findstr', 'select-string', 'sls', 'echo', 'printf', 'write-output', 'write-host', 'man', 'which', 'whereis', 'type', 'help', 'get-help', 'get-command']);
const SAYERS = new Set(['echo', 'printf', 'write-output']);
const ASSIGN_RE = /^[A-Za-z_][A-Za-z0-9_]*=/;
const HEREDOC_AT_RE = /^<<(-?)[ \t]*(["']?)([A-Za-z_][\w.-]*)\2/;
export const PS_HERE_STRING_RE = /@(["'])[ \t]*\r?\n[\s\S]*?\r?\n[ \t]*\1@/g;

const firstAt = words => { let k = 0; while (k < words.length && !words[k].quoted && ASSIGN_RE.test(words[k].value)) k++; return k; };

// A search, a text echo or a name lookup: `git grep` counts, after git's own
// options.
export function isDataCommand(words) {
  const k = firstAt(words);
  const b = base(words[k] && words[k].value);
  if (DATA_CMDS.has(b)) return true;
  if (b !== 'git') return false;
  let j = k + 1;
  while (j < words.length && words[j].value.startsWith('-')) j += /^(-C|-c|--git-dir|--work-tree|--namespace|--exec-path|--config-env)$/.test(words[j].value) ? 2 : 1;
  return Boolean(words[j]) && words[j].value === 'grep';
}

export function commandsIn(text) {
  const src = String(text || '').replace(PS_HERE_STRING_RE, "''");
  const first = readAll(src, false, 0);
  return first.some(startsShell) ? readAll(src, true, 0) : first;
}

function readAll(text, bodiesRun, depth) {
  const ctx = { out: [], bodiesRun };
  scan(String(text), 0, false, ctx);
  const all = [];
  for (const words of ctx.out) {
    all.push(words);
    if (depth < 4) for (const inner of handedOn(words, bodiesRun)) all.push(...readAll(inner, bodiesRun, depth + 1));
  }
  return all;
}

// A command that starts a shell, so the files and text the line writes may run:
// a shell anywhere in it, source or ., or a script run by its path (./x.sh).
function startsShell(words) {
  if (isDataCommand(words)) return false;
  const k = firstAt(words);
  if (words[k] && (/^(source|\.)$/.test(words[k].value) || /\.(sh|bash|zsh|ps1)$/i.test(words[k].value))) return true;
  return words.some(w => !w.quoted && (SH_RE.test(base(w.value)) || /^(pwsh|powershell|cmd)$/.test(base(w.value))));
}

// The text a command hands on to be run as shell: a shell's -c string, the rest
// after pwsh -Command or cmd /c, what eval and ssh host are given, and, once
// the line starts a shell, what echo or printf writes.
function handedOn(words, bodiesRun) {
  const v = words.map(w => w.value);
  if (isDataCommand(words)) {
    const k = firstAt(words);
    return bodiesRun && SAYERS.has(base(v[k])) ? [v.slice(k + 1).join(' ')] : [];
  }
  const out = [];
  for (let k = 0; k < v.length; k++) {
    if (words[k].quoted) continue;
    const b = base(v[k]);
    if (b === 'eval') { out.push(v.slice(k + 1).join(' ')); break; }
    if (b === 'ssh') {
      let j = k + 1;
      while (j < v.length && v[j].startsWith('-')) j += /^-[BbcDEeFIiJLlmOoPpQRSWw]$/.test(v[j]) ? 2 : 1;
      if (j + 1 < v.length) out.push(v.slice(j + 1).join(' '));
      break;
    }
    const at = b === 'cmd' ? v.findIndex((x, m) => m > k && /^\/[ck]$/i.test(x))
      : b === 'pwsh' || b === 'powershell' ? v.findIndex((x, m) => m > k && /^-(c|co|com|comm|comma|comman|command)$/i.test(x)) : -1;
    if (at > k) { out.push(v.slice(at + 1).join(' ')); break; }
    if (!SH_RE.test(b)) continue;
    for (let j = k + 1; j < v.length && /^[-+]/.test(v[j]) && v[j] !== '--'; j++) {
      if (/^-[A-Za-z]*c[A-Za-z]*$/.test(v[j])) { if (j + 1 < v.length) out.push(v[j + 1]); break; }
      if (/^[-+]o$/.test(v[j])) j++;
    }
  }
  return out;
}

// Reads `s` from `i` into commands on ctx.out. Nested (inside $( or <( ), it
// stops at the ) that closes it and returns that index. Substitutions nested
// past 40 deep are left unread, so no line can exhaust the stack.
function scan(s, i, nested, ctx) {
  ctx.nest = (ctx.nest || 0) + 1;
  try { return ctx.nest > 40 ? s.length : scanFrom(s, i, nested, ctx); } finally { ctx.nest--; }
}
function scanFrom(s, i, nested, ctx) {
  // drop: the next word is a redirection's target ('target'), or a
  // here-string's text ('stdin'), read as commands once the line starts a shell.
  let words = [], w = null, drop = false, pending = [], depth = 0;
  const word = () => (w ||= { value: '', quoted: false });
  const endWord = () => {
    if (w && !drop) words.push(w);
    if (w && drop === 'stdin' && ctx.bodiesRun) scan(w.value, 0, false, ctx);
    if (w) drop = false;
    w = null;
  };
  const endCmd = () => { endWord(); drop = false; if (words.length) ctx.out.push(words); words = []; };
  // A file number before a redirection (2>, PowerShell's *>) is not a word.
  const fd = () => { if (w && !w.quoted && /^(\d+|\*)$/.test(w.value)) w = null; else endWord(); };
  for (; i < s.length; i++) {
    const c = s[i], n = s[i + 1];
    if (c === '\\') {
      if (n === '\n') { i++; continue; }
      if (n === '\r' && s[i + 2] === '\n') { i += 2; continue; }
      // Inside a word a backslash stays as written (C:\work\src); before a
      // space, quote or separator, or at a word's start, it escapes.
      if (n !== undefined && (!w || /[\s"'`;&|()<>{}$\\#]/.test(n))) { word().value += n; w.quoted = true; i++; continue; }
      word().value += c; continue;
    }
    if (c === "'") { let j = s.indexOf("'", i + 1); if (j < 0) j = s.length; word().value += s.slice(i + 1, j); w.quoted = true; i = j; continue; }
    if (c === '"') { const at = word(); at.quoted = true; i = dquote(s, i + 1, at, ctx); continue; }
    if (c === '`') {
      const j = closingTick(s, i + 1);
      if (j < 0) { word().value += c; continue; }
      scan(s.slice(i + 1, j).replace(/\\`/g, '`'), 0, false, ctx); word().value += '$(…)'; i = j; continue;
    }
    if (c === '$' && n === '(') {
      if (s[i + 2] === '(') { i = arithEnd(s, i + 3); word().value += '$((…))'; continue; }
      i = scan(s, i + 2, true, ctx); word().value += '$(…)'; continue;
    }
    if (c === '$' && n === '{') {
      const j = braceEnd(s, i + 1);
      if (j < 0) { word().value += '${'; i++; continue; }
      word().value += s.slice(i, j + 1); i = j; continue;
    }
    if (c === '$' && n === "'") {
      let j = i + 2;
      while (j < s.length && s[j] !== "'") j += s[j] === '\\' ? 2 : 1;
      word().value += s.slice(i + 2, j); w.quoted = true; i = j; continue;
    }
    if (c === '#' && !w) { while (i + 1 < s.length && s[i + 1] !== '\n') i++; continue; }
    if (c === '\n') { endCmd(); if (pending.length) { i = heredocBodies(s, i + 1, pending, nested, ctx) - 1; pending = []; } continue; }
    if (/\s/.test(c)) { endWord(); continue; }
    if (c === ';') { endCmd(); continue; }
    if (c === '&') {
      if (n === '>') { endWord(); i += s[i + 2] === '>' ? 2 : 1; drop = 'target'; continue; }
      endCmd(); if (n === '&') i++; continue;
    }
    if (c === '|') { endCmd(); if (n === '|' || n === '&') i++; continue; }
    if (c === '(') {
      if (!w && n === '(') { i = arithEnd(s, i + 2); continue; }
      endCmd(); depth++; continue;
    }
    if (c === ')') { endCmd(); if (nested && !depth) return i; if (depth) depth--; continue; }
    if (c === '<' || c === '>') {
      if (n === '(') { endWord(); i = scan(s, i + 2, true, ctx); word().value += '<(…)'; continue; }
      if (c === '<' && n === '#') { const j = s.indexOf('#>', i + 2); i = j < 0 ? s.length : j + 1; continue; }
      const here = c === '<' && n === '<' && s[i + 2] !== '<' && HEREDOC_AT_RE.exec(s.slice(i));
      if (here) { fd(); pending.push({ dash: Boolean(here[1]), quoted: Boolean(here[2]), word: here[3] }); i += here[0].length - 1; continue; }
      // A redirection and its target, or a here-string (<<<), are not words.
      fd();
      if (c === '<' && n === '<' && s[i + 2] === '<') { i += 2; drop = 'stdin'; continue; }
      let j = i + 1;
      if ((c === '>' && (n === '>' || n === '|')) || (c === '<' && n === '>')) j++;
      if (s[j] === '&' && /[\d-]/.test(s[j + 1] ?? '')) { j++; while (/[\d-]/.test(s[j] ?? '')) j++; i = j - 1; continue; }
      if (s[j] === '&') j++;
      i = j - 1; drop = 'target'; continue;
    }
    if (c === '{') {
      const j = braceEnd(s, i);
      // A PowerShell hashtable (@{…}), {} (find -exec's slot) and a brace list
      // or range ({a,b}, {1..3}) stay in their word.
      const inner = j < 0 ? '' : s.slice(i + 1, j);
      if (j > 0 && ((w && w.value.endsWith('@')) || j === i + 1 || (!/\s/.test(inner) && /,|\.\./.test(inner)))) { word().value += s.slice(i, j + 1); i = j; continue; }
      endCmd(); continue;
    }
    if (c === '}') { endCmd(); continue; }
    word().value += c;
  }
  endCmd();
  return i;
}

// Inside double quotes: \ escapes " \ $ ` and a newline; $(…) and backticks run.
function dquote(s, j, w, ctx) {
  for (; j < s.length; j++) {
    const c = s[j];
    if (c === '"') return j;
    if (c === '\\' && /["\\$`\n]/.test(s[j + 1] ?? '')) { if (s[j + 1] !== '\n') w.value += s[j + 1]; j++; continue; }
    if (c === '`') {
      const k = closingTick(s, j + 1);
      if (k >= 0) { scan(s.slice(j + 1, k).replace(/\\`/g, '`'), 0, false, ctx); w.value += '$(…)'; j = k; continue; }
    }
    if (c === '$' && s[j + 1] === '(') {
      j = s[j + 2] === '(' ? arithEnd(s, j + 3) : scan(s, j + 2, true, ctx);
      w.value += '$(…)'; continue;
    }
    w.value += c;
  }
  return s.length;
}

// The bodies of the heredocs started on the line just ended, from `p`; returns
// where the next line starts. A body is text, read as commands when the line
// starts a shell; an unquoted one still runs its $(…) and backticks.
function heredocBodies(s, p, pending, nested, ctx) {
  for (const h of pending) {
    const lines = [];
    while (p < s.length) {
      let e = s.indexOf('\n', p);
      if (e < 0) e = s.length;
      const line = s.slice(p, e).replace(/\r$/, '');
      const bare = h.dash ? line.replace(/^\t+/, '') : line;
      if (bare === h.word) { p = e + 1; break; }
      // In $( ), bash also ends a body at its word followed by the closing ).
      if (nested && bare.startsWith(h.word) && /^\s*\)/.test(bare.slice(h.word.length))) { p += line.indexOf(h.word) + h.word.length; break; }
      lines.push(line);
      p = e + 1;
    }
    const body = lines.join('\n');
    if (ctx.bodiesRun) scan(body, 0, false, ctx);
    else if (!h.quoted) substitutions(body, ctx);
  }
  return Math.min(p, s.length);
}

function substitutions(text, ctx) {
  for (let j = 0; j < text.length; j++) {
    const c = text[j];
    if (c === '\\') { j++; continue; }
    if (c === '`') { const k = closingTick(text, j + 1); if (k >= 0) { scan(text.slice(j + 1, k).replace(/\\`/g, '`'), 0, false, ctx); j = k; } continue; }
    if (c === '$' && text[j + 1] === '(') j = text[j + 2] === '(' ? arithEnd(text, j + 3) : scan(text, j + 2, true, ctx);
  }
}

function closingTick(s, j) {
  for (; j < s.length; j++) {
    if (s[j] === '\\') j++;
    else if (s[j] === '`') return j;
  }
  return -1;
}
// The ) that closes $(( … )) or (( … )), counted from just inside it.
function arithEnd(s, j) {
  for (let d = 2; j < s.length; j++) {
    if (s[j] === '(') d++;
    else if (s[j] === ')' && --d === 0) return j;
  }
  return s.length;
}
// The } that closes the { at `i`, looked for within 256 characters, or -1.
// What has to stay one word (${name}, {a,b}, {}) is short; a longer group
// read as a separator only splits the line in more places.
function braceEnd(s, i) {
  let d = 0, q = '';
  for (let j = i; j < s.length && j < i + 256; j++) {
    const c = s[j];
    if (q) { if (c === q) q = ''; continue; }
    if (c === '"' || c === "'") q = c;
    else if (c === '{') d++;
    else if (c === '}' && --d === 0) return j;
  }
  return -1;
}

// The line with text bound for files removed, on a plain line only: heredoc
// bodies written to a file and echo/printf/tee segments that write to one.
// Any other line comes back whole. Used by the merge bar so prose that
// mentions merging is not read as a merge (note U).
export function withoutFileText(text) {
  const s = String(text || '');
  if (!plainLine(s)) return s;
  const { line } = splitHeredocs(s);
  // A search or read on a plain line runs nothing, so its pattern is text too.
  return segments(line).filter(seg => !isTextToFile(seg) && !READERS.has(base(plainWords(seg)[0]))).join('\n');
}
