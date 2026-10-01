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

const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh', 'pwsh', 'powershell', 'cmd']);
const LANGS = new Set(['node', 'nodejs', 'python', 'python3', 'py', 'ruby', 'deno', 'bun', 'php', 'perl', 'tsx', 'ts-node']);
const WRAPPERS = new Set(['env', 'sudo', 'npx', 'exec', 'command', 'time', 'nohup', 'nice', 'xargs', 'doas', 'bunx', 'pnpx']);
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
      while (w.length && (w[0].startsWith('-') || /^[A-Za-z_][A-Za-z0-9_]*=/.test(w[0]))) w = w.slice(1);
      continue;
    }
    break;
  }
  return w;
}

// Split a line into what runs and what is only data. Each heredoc body is
// either attached to its command as code (when that command is a shell or an
// interpreter reading stdin) or dropped (cat > f, tee, anything else).
// Returns { line, code: [{ kind: 'shell'|'lang', text }] }.
export function splitHeredocs(text) {
  const lines = String(text || '').split('\n');
  const kept = [];
  const code = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = /<<-?\s*(['"]?)([A-Za-z_][\w.-]*)\1/.exec(line);
    kept.push(line);
    if (!m) continue;
    const end = m[2];
    const body = [];
    let j = i + 1;
    for (; j < lines.length; j++) {
      if (lines[j].replace(/^\t+/, '').trim() === end) break;
      body.push(lines[j]);
    }
    const head = segments(line.slice(0, m.index)).pop() || '';
    const cmd = base(commandOf(head)[0]);
    if (SHELLS.has(cmd)) code.push({ kind: 'shell', text: body.join('\n') });
    else if (LANGS.has(cmd)) code.push({ kind: 'lang', text: body.join('\n') });
    i = j;
  }
  return { line: kept.join('\n'), code };
}

// Text that only goes into a file: `echo …  > f`, `printf … >> f`. Returns the
// segment unchanged when it is anything else.
export function isTextToFile(seg) {
  const w = commandOf(seg);
  const b = base(w[0]);
  return (b === 'echo' || b === 'printf' || b === 'cat' || b === 'tee' || b === 'write-output' || b === 'set-content' || b === 'add-content' || b === 'out-file')
    && (b === 'tee' || /(^|[^>&0-9])>>?\s*\S/.test(seg) || /^(set-content|add-content|out-file)$/.test(b));
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
      const k = w.findIndex(x => /^(-c|-lc|-ic|-command|\/c)$/i.test(x));
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

// The line with text bound for files removed: heredoc bodies not fed to an
// interpreter, and echo/printf/tee segments that write to a file. Used by the
// merge bar so prose that mentions merging is not read as a merge (note U).
export function withoutFileText(text) {
  const { line, code } = splitHeredocs(text);
  const kept = segments(line).filter(seg => !isTextToFile(seg));
  const subs = [...line.matchAll(/\$\(([^()]*)\)|`([^`]*)`/g)].map(m => m[1] ?? m[2]);
  return [...kept, ...code.map(c => c.text), ...subs].join('\n');
}
