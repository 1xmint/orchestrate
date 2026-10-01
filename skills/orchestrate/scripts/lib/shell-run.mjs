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
// The parser does not model every shell shape, so it only ever NARROWS a check
// on a plain line (plainLine below): every segment a search, a read, or text
// going into a file, and no construct it cannot follow. Any other line is read
// word by word, as before (review 9-30-0004: `cat <<EOF | bash`, `for … do`,
// `timeout`, `eval` all slipped past a parser that guessed).

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
