// merge-bar.mjs — the bar a pull request clears before Claude merges it:
// every check on its newest commit has passed and, when it changes one of the
// plugin's own safety checks, a reviewer in this session passed that same
// commit. guard-bash.mjs refuses a merge below the bar, in every mode, and the
// project's approved-commands list does not lift it.
//
// What it reads: `gh pr merge` however it is spelled (a quoted or full-path
// gh, `-R` before `merge`, GH_REPO=, a chain, a pipe, `bash -c`, `pwsh -c`,
// after `cd`), and the raw API routes that merge. What it does not read: a
// merge run from inside a script file, `node -e`, or a gh alias. Those are
// out of scope, and docs/safety-guard.md says so.

import { spawnSync } from 'node:child_process';
import { resolve as resolvePath } from 'node:path';

// The plugin's own safety checks: a change to any of these can switch a check
// off, so it merges only after an independent reviewer passed it. Full repo
// paths, and a test proves each one exists, so a rename cannot drop one.
export const REVIEW_PATHS = [
  'hooks/hooks.json',
  'skills/orchestrate/assets/agents/orch-reviewer.md',
  'skills/orchestrate/scripts/guard-agent.mjs',
  'skills/orchestrate/scripts/guard-agent.test.mjs',
  'skills/orchestrate/scripts/guard-bash.mjs',
  'skills/orchestrate/scripts/guard-bash.test.mjs',
  'skills/orchestrate/scripts/guard-model.test.mjs',
  'skills/orchestrate/scripts/ledger.mjs',
  'skills/orchestrate/scripts/ledger.test.mjs',
  'skills/orchestrate/scripts/turn-check.mjs',
  'skills/orchestrate/scripts/turn-check.test.mjs',
  'skills/orchestrate/scripts/lib/merge-bar.mjs',
  'skills/orchestrate/scripts/lib/review-of.mjs',
  'skills/orchestrate/scripts/lib/review-of.test.mjs',
  'skills/orchestrate/scripts/lib/review-words.mjs',
  'skills/orchestrate/scripts/lib/review-words.test.mjs',
];

// Split a line into the commands it runs, outside quotes: at ; & | newlines,
// and the brackets and backticks that start a command of their own.
function segments(line) {
  const out = [];
  let cur = '', q = null;
  for (const ch of String(line || '')) {
    if (q) { cur += ch; if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
    if (';&|\n\r()`{}'.includes(ch)) { if (cur.trim()) out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

// Words of one command, quotes removed. A backslash is kept as it is, so a
// Windows path reads as written.
function words(seg) {
  const out = [];
  let cur = '', q = null, any = false;
  for (const ch of seg) {
    if (q) { if (ch === q) q = null; else cur += ch; continue; }
    if (ch === '"' || ch === "'") { q = ch; any = true; continue; }
    if (/\s/.test(ch)) { if (cur || any) out.push(cur); cur = ''; any = false; continue; }
    cur += ch;
  }
  if (cur || any) out.push(cur);
  return out;
}

const base = w => String(w || '').split(/[\\/]/).pop().toLowerCase();
const WRAPPERS = new Set(['env', 'command', 'exec', 'nohup', 'time', 'sudo']);
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'bash.exe', 'sh.exe']);
const POWERSHELLS = new Set(['powershell', 'pwsh', 'powershell.exe', 'pwsh.exe']);
const CDS = new Set(['cd', 'chdir', 'pushd', 'set-location', 'push-location', 'sl']);
// gh flags that take the next word as their value, for `pr merge` and `api`.
const VALUE_FLAGS = new Set(['-R', '--repo', '-b', '--body', '-F', '--body-file', '-t', '--subject', '--match-head-commit', '-A', '--author-email', '-X', '--method', '-f', '--field', '--raw-field', '-H', '--header', '--input', '-q', '--jq', '--template', '--hostname', '-p', '--preview', '--cache']);
const FIELD_FLAGS = new Set(['-f', '-F', '--field', '--raw-field', '--input']);
const MERGE_MUTATION = /\b(?:mergePullRequest|enablePullRequestAutoMerge)\b/;

// Read one gh command: a merge, an API merge, or nothing.
function readGh(args, env) {
  const pos = [];
  const flags = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('-') && a.length > 1) {
      const eq = a.indexOf('=');
      if (a.startsWith('--') && eq > 0) flags.push([a.slice(0, eq), a.slice(eq + 1)]);
      else if (VALUE_FLAGS.has(a)) { flags.push([a, args[i + 1] ?? '']); i++; }
      else flags.push([a, true]);
    } else pos.push(a);
  }
  const has = name => flags.some(([f]) => f === name);
  const value = (...names) => { const hit = flags.find(([f]) => names.includes(f)); return hit ? String(hit[1]) : null; };
  if (pos[0] === 'pr' && pos[1] === 'merge') {
    if (has('--disable-auto')) return null;
    return { kind: 'merge', auto: has('--auto'), target: { selector: pos[2] || null, repo: value('-R', '--repo') || env.GH_REPO || null } };
  }
  if (pos[0] === 'api') {
    const endpoint = pos[1] || '';
    if (endpoint === 'graphql') return flags.some(([, v]) => MERGE_MUTATION.test(String(v))) ? { kind: 'api' } : null;
    if (/(?:^|\/)pulls\/\d+\/merge\/?$/.test(endpoint.split('?')[0])) {
      const method = (value('-X', '--method') || (flags.some(([f]) => FIELD_FLAGS.has(f)) ? 'POST' : 'GET')).toUpperCase();
      return method === 'GET' ? null : { kind: 'api' };
    }
  }
  return null;
}

// Every merge a line would run, with the folder it runs in.
export function mergesIn(line, cwd = process.cwd(), depth = 0) {
  const found = [];
  if (depth > 3) return found;
  let here = cwd;
  const env = {};
  for (const seg of segments(line)) {
    let w = words(seg);
    const psRepo = /^\$env:GH_REPO\s*=\s*(.+)$/i.exec(seg);
    if (psRepo) { env.GH_REPO = words(psRepo[1])[0] || null; continue; }
    const local = { ...env };
    while (w.length && (WRAPPERS.has(base(w[0])) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(w[0]))) {
      const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(w[0]);
      if (m && m[1] === 'GH_REPO') local.GH_REPO = m[2];
      w = w.slice(1);
    }
    if (!w.length) continue;
    const cmd = base(w[0]);
    if (CDS.has(cmd)) {
      const to = w.slice(1).filter(x => !/^-/.test(x))[0];
      if (to) here = resolvePath(here, to);
      continue;
    }
    if (SHELLS.has(cmd)) {
      const at = w.findIndex((x, i) => i > 0 && /^-[a-z]*c$/.test(x));
      if (at > 0 && w[at + 1] !== undefined) found.push(...mergesIn(w[at + 1], here, depth + 1));
      continue;
    }
    if (POWERSHELLS.has(cmd)) {
      const at = w.findIndex((x, i) => i > 0 && /^-(?:c|command)$/i.test(x));
      if (at > 0) found.push(...mergesIn(w.slice(at + 1).join(' '), here, depth + 1));
      continue;
    }
    if (/^gh(?:\.exe)?$/.test(cmd)) {
      const hit = readGh(w.slice(1), local);
      if (hit) found.push({ ...hit, cwd: here });
    }
  }
  return found;
}

// `gh pr view` for the checks, files and newest commit of the pull request a
// merge names. Only ever run for a line that merges.
export function ghView(target, cwd) {
  const args = ['pr', 'view', ...(target.selector ? [target.selector] : []), ...(target.repo ? ['--repo', target.repo] : []), '--json', 'headRefOid,statusCheckRollup,files,changedFiles'];
  const r = spawnSync('gh', args, { cwd, encoding: 'utf8', timeout: 12000, windowsHide: true, env: { ...process.env, GH_PROMPT_DISABLED: '1' } });
  if (r.error) return { ok: false, error: r.error.code === 'ETIMEDOUT' ? 'gh took too long to answer' : r.error.message };
  if (r.status !== 0) return { ok: false, error: String(r.stderr || '').trim().split('\n')[0] || `gh exited with ${r.status}` };
  try { return { ok: true, data: JSON.parse(r.stdout) }; } catch { return { ok: false, error: 'gh answered with something that is not JSON' }; }
}

function checkState(c) {
  if (!c || typeof c !== 'object') return 'failed';
  if (c.__typename === 'StatusContext' || ('state' in c && !('status' in c))) {
    const s = String(c.state || '').toUpperCase();
    return s === 'SUCCESS' ? 'passed' : (s === 'PENDING' || s === 'EXPECTED') ? 'running' : 'failed';
  }
  if (String(c.status || '').toUpperCase() !== 'COMPLETED') return 'running';
  return ['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(String(c.conclusion || '').toUpperCase()) ? 'passed' : 'failed';
}

const checkName = c => String((c && (c.name || c.context)) || 'a check');
const listed = names => names.slice(0, 3).join(', ') + (names.length > 3 ? ` and ${names.length - 3} more` : '');
const isReviewer = agent => /reviewer/i.test(String(agent || ''));

// The newest reviewer verdict in this session that names this commit (at
// least 7 characters of it), read from the hand-back or, when the hand-back
// named no work, from the brief that sent that same reviewer.
function reviewerVerdict(session, head) {
  const returned = Array.isArray(session && session.returned) ? session.returned : [];
  const dispatches = Array.isArray(session && session.dispatches) ? session.dispatches : [];
  const sha = String(head || '').toLowerCase();
  let verdict = null;
  for (const row of returned) {
    if (!row || !isReviewer(row.agent)) continue;
    const sent = row.toolUseId ? dispatches.find(d => d && d.toolUseId === row.toolUseId && isReviewer(d.agent)) : null;
    const id = String(row.reviewOf || (sent && sent.reviewOf) || '').toLowerCase();
    if (!/^[0-9a-f]{7,40}$/.test(id) || !sha.startsWith(id)) continue;
    verdict = row.verdict || null;
  }
  return verdict;
}

// Why this merge is below the bar, or null when it clears it.
export function belowBar(merge, view, session) {
  const label = merge.target && merge.target.selector ? `pull request ${merge.target.selector}` : 'the pull request for this branch';
  if (merge.kind === 'api') return 'This would merge a pull request through the raw API, which skips the checks this guard reads before a merge. Use gh pr merge instead. Nothing was run.';
  if (merge.auto) return 'This would switch on automatic merging, which later merges whatever the newest commit is once its checks pass, including a commit nobody checked. Wait for the checks to pass, then merge with gh pr merge. Nothing was run.';
  if (!view || !view.ok) {
    const why = String((view && view.error) || 'no answer').split('\n')[0].slice(0, 200);
    return `This would merge ${label}, but its checks could not be read (${why}), so there is no way to tell whether they passed. Nothing was run.`;
  }
  const data = view.data || {};
  const head = String(data.headRefOid || '');
  const sha7 = head.slice(0, 7) || 'unknown';
  const checks = Array.isArray(data.statusCheckRollup) ? data.statusCheckRollup : [];
  if (!checks.length) return `This would merge ${label}, but no checks have reported on its newest commit ${sha7} yet. They can take a minute to start after a push. If this project has no automatic checks, the user can merge it themselves. Nothing was run.`;
  const failed = checks.filter(c => checkState(c) === 'failed').map(checkName);
  if (failed.length) return `This would merge ${label}, but a check failed on its newest commit ${sha7}: ${listed(failed)}. Nothing was run.`;
  const running = checks.filter(c => checkState(c) === 'running').map(checkName);
  if (running.length) return `This would merge ${label} while its checks are still running on its newest commit ${sha7}: ${listed(running)}. Merge once they have all passed. Nothing was run.`;
  const paths = (Array.isArray(data.files) ? data.files : []).map(f => String((f && f.path) || ''));
  const touched = paths.filter(p => REVIEW_PATHS.includes(p));
  const cut = Number(data.changedFiles) > paths.length;
  if (!touched.length && !cut) return null;
  const verdict = reviewerVerdict(session, head);
  if (verdict === 'PASS') return null;
  const what = touched.length ? `changes the plugin's own safety checks (${listed(touched)})` : 'changes more files than could be read, so it may change the plugin\'s own safety checks';
  const said = verdict ? `the newest reviewer verdict on ${sha7} in this session is ${verdict}` : `no reviewer in this session has passed its newest commit ${sha7}`;
  return `This would merge ${label}, which ${what}, and ${said}. A reviewer sent with "REVIEW OF: ${sha7}" whose verdict is PASS is what lets it merge. Nothing was run.`;
}
