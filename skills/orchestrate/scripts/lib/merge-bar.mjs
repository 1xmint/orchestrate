// merge-bar.mjs — the bar a pull request clears before Claude merges it:
// every check on its newest commit has passed and, when it changes one of the
// plugin's own safety checks, a reviewer in this session passed that same
// commit. guard-bash.mjs refuses a merge below the bar, in every mode, and the
// project's approved-commands list does not lift it.
//
// It does not try to read every way a merge can be spelled; a shell has too
// many. Instead any line whose letters say merge next to gh or a GitHub
// address is caught (mentionsMerge), quotes and comments included, and only
// one shape of it can pass: gh pr merge with a number, alone on its line,
// naming the full id of the newest commit with --match-head-commit. GitHub
// itself then refuses the merge if that commit is no longer the newest, so
// nothing that runs between the check and the merge can swap in an unchecked
// one. Out of scope, and docs/safety-guard.md says so: a word built from a
// variable, $(…), escape codes or a file-name pattern (mer?e), a script file,
// node -e, a gh alias, a GraphQL query read from a file, and merging branches
// without a pull request.

import { spawnSync } from 'node:child_process';

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
  'skills/orchestrate/scripts/lib/shell-run.mjs',
  'skills/orchestrate/scripts/lib/review-of.mjs',
  'skills/orchestrate/scripts/lib/review-of.test.mjs',
  'skills/orchestrate/scripts/lib/shell-run.test.mjs',
  'skills/orchestrate/scripts/live-misfires.test.mjs',
];

// Whether a line may merge a pull request. Deliberately blunt, because every
// attempt to read the shell's spellings exactly lost to one more spelling: the
// line is flattened to its letters and digits, and it counts when those
// contain "merge" (or "enqueuepullrequest", the merge queue) and the line also
// names gh as a word, or holds "pulls" or "graphql" (the REST and GraphQL
// addresses). Brace expansion ({merge,}, {m..m}) is expanded first, and a
// backslash-newline joined. A plain read of one pull request, or a plain git
// merge, passes: see readsOnly and plainGitMerge. Each step is linear in the
// line and expansion stops at 400 steps, so a long line cannot run the hook
// out of time.
export function mentionsMerge(line) {
  if (readsOnly(line) || plainGitMerge(line)) return false;
  const text = String(line || '').replace(/\\\r?\n/g, '').replace(/["'`$]/g, '');
  const expanded = expandBraces(text, { calls: 0 });
  const forms = (expanded || [text]).map(f => f.toLowerCase());
  const flat = forms.map(f => f.replace(/[^a-z0-9]/g, '')).join(' ');
  // Braces this cannot expand can hide letters between the ones that stay, but
  // not move a letter out of its shell word: the shell expands braces inside
  // one word, and the first copy of a word is made of letters written in it.
  // So then the line counts when one word holds m, e, r, g, e in order (or
  // enqueuepullrequest) and one holds g then h (or pulls, or graphql), with
  // anything between. A g ending one word beside an h starting the next is not
  // gh, which is what refused ordinary scripts before. A word with no brace in
  // it is not changed by expansion, so it must spell the word outright.
  if (!expanded) {
    const words = text.toLowerCase().split(/[\s;&|()<>]+/);
    const holds = (w, n) => {
      if (/[{}]/.test(w)) return inOrder(w, n);
      return n === 'gh' ? namesGh(w) : w.replace(/[^a-z0-9]/g, '').includes(n);
    };
    const has = (...needles) => needles.some(n => words.some(w => holds(w, n)));
    return has('merge', 'enqueuepullrequest') && has('gh', 'pulls', 'graphql');
  }
  const says = flat.includes('merge') || flat.includes('enqueuepullrequest');
  return says && (forms.some(namesGh) || flat.includes('pulls') || flat.includes('graphql'));
}

// Whether some expansion of `word` could bring the letters of `needle`
// together: they appear in order, and between two of them is only
// punctuation, or a brace or comma, which a choice can cut through. A letter
// or digit with no brace or comma beside it is written in the same choice as
// its neighbours and is always there: grantCheck never becomes gh.
function inOrder(word, needle) {
  // At each needle position: 0 nothing but punctuation since the last letter
  // matched, 1 a letter or digit and no brace yet, 2 a brace or comma seen.
  let states = new Set(['0:2']);
  for (const c of word) {
    const next = new Set();
    for (const st of states) {
      const [i, s] = st.split(':').map(Number);
      if (c === needle[i] && s !== 1) { if (i + 1 === needle.length) return true; next.add(`${i + 1}:0`); }
      next.add(`${i}:${/[{},]/.test(c) ? 2 : /[a-z0-9]/.test(c) && s !== 2 ? 1 : s}`);
    }
    states = next;
  }
  return false;
}

// Any word that is gh once quotes, braces and backslashes are gone, or whose
// last path part is gh (C:\…\gh.exe, /usr/bin/gh). Words split at = : ! as
// well (--split-string=gh, -FilePath:gh, alias.m=!gh), and a short flag glued
// on the front is dropped (-Sgh).
const GH = /^gh(?:\.exe)?$/;
function namesGh(text) {
  return text.split(/[\s;&|()<>=:!]+/).some(w => {
    const bare = w.replace(/[{},\\]/g, '');
    return GH.test(bare) || GH.test(bare.replace(/^-[a-z0-9]+?(?=gh)/, '')) || GH.test(w.replace(/[{},]/g, '').split(/[\\/]/).pop());
  });
}

// The shell's brace expansion: each {a,b}, {x..y} or {x..y..step} group gives
// one copy of the line per choice, innermost group first, done before letters
// are lowercased so a range such as {Z..a} holds what bash's would. A group
// bash leaves as it is ({x}, {...base}, {a..b..c}) stays text, with its braces
// masked so the group around it still expands: g{h,{x}} is gh and g{x} to
// bash, and reading the outer group as text hid the gh. Null when that makes
// more than 64 copies.
const OPEN = '\u0001', CLOSE = '\u0002';
function expandBraces(text, budget) {
  if (++budget.calls > 400) return null;
  let m, items = 'text';
  while ((m = /\{([^{}]*)\}/.exec(text)) && (items = braceItems(m[1])) === 'text') {
    text = text.slice(0, m.index) + OPEN + m[1] + CLOSE + text.slice(m.index + m[0].length);
  }
  if (!m) return [text.replaceAll(OPEN, '{').replaceAll(CLOSE, '}')];
  if (!items) return null;
  const head = text.slice(0, m.index), tail = text.slice(m.index + m[0].length);
  const out = [];
  for (const item of items) {
    const sub = expandBraces(head + item + tail, budget);
    if (!sub || out.push(...sub) > 64) return null;
  }
  return out;
}
// The choices in one group, 'text' when bash would leave it as written, or
// null when it is a range too long to list.
function braceItems(inner) {
  if (inner.includes(',')) return inner.split(',');
  const r = /^(-?\d+|[a-zA-Z])\.\.(-?\d+|[a-zA-Z])(?:\.\.(-?\d+))?$/.exec(inner);
  const num = r && /\d/.test(r[1]);
  if (!r || num !== /\d/.test(r[2])) return 'text';
  const a = num ? Number(r[1]) : r[1].charCodeAt(0), b = num ? Number(r[2]) : r[2].charCodeAt(0);
  const step = Math.max(1, Math.abs(Number(r[3] || 1))), dir = a <= b ? 1 : -1;
  if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b) || Math.abs(b - a) / step > 64) return null;
  const list = [];
  for (let i = a; dir > 0 ? i <= b : i >= b; i += dir * step) list.push(num ? String(i) : String.fromCharCode(i));
  return list;
}

// A plain read of pull requests, alone on its line: gh pr view, checks, list,
// status or diff, optionally with -R owner/repo, every word made only of
// letters, digits and . / : = , @ # + - _ (so no quotes, braces, $ or
// separators). Such a line runs one gh read and nothing else, so
// `gh pr view 36 --json mergeable` passes.
const READS = new Set(['view', 'checks', 'list', 'status', 'diff']);
function readsOnly(line) {
  const text = String(line || '').trim();
  if (!text || /[\r\n]/.test(text)) return false;
  const words = text.split(/\s+/);
  if (!GH.test(words[0].toLowerCase()) || !words.every(w => /^[\w./:=,@#+-]+$/.test(w))) return false;
  let i = 1;
  const skipRepo = () => {
    for (;;) {
      if (words[i] === '-R' || words[i] === '--repo') i += 2;
      else if (/^(?:-R|--repo=)\S+$/.test(words[i] || '')) i += 1;
      else return;
    }
  };
  skipRepo();
  if (words[i] !== 'pr') return false;
  i += 1;
  skipRepo();
  return READS.has(words[i]);
}

// A plain git merge, alone on its line, with the same plain words minus @ (a
// PowerShell splat). It runs git and nothing else, whatever the branch is
// called, so `git merge feature/graphql-schema` passes.
function plainGitMerge(line) {
  const text = String(line || '').trim();
  if (!text || /[\r\n]/.test(text)) return false;
  const words = text.split(/\s+/);
  return /^git(?:\.exe)?$/i.test(words[0]) && words[1] === 'merge' && words.every(w => /^[\w./:=,#+-]+$/.test(w));
}

const METHODS = new Set(['--merge', '-m', '--squash', '-s', '--rebase', '-r']);
const SHA = /^[0-9a-f]{40}$/i;
const REPO = /^[\w.-]+\/[\w.-]+$/;

// The one merge that can pass, read from the whole line: `gh pr merge <number>`
// with at most a way of merging, --delete-branch, -R owner/repo and
// --match-head-commit <id>, alone on its line. Anything else is null.
export function readMerge(line) {
  const t = String(line || '').trim();
  if (!t || /[\r\n]/.test(t)) return null;
  const w = t.split(/\s+/);
  if (!w.every(x => /^[\w./:=-]+$/.test(x))) return null;
  if (!/^gh(?:\.exe)?$/i.test(w[0]) || w[1] !== 'pr' || w[2] !== 'merge') return null;
  const out = { number: null, repo: null, sha: null, method: null, deleteBranch: false, disableAuto: false };
  for (let i = 3; i < w.length; i++) {
    const a = w[i];
    const eq = /^(--repo|--match-head-commit)=(.+)$/.exec(a);
    if (/^\d+$/.test(a) && !out.number) out.number = a;
    else if (METHODS.has(a) && !out.method) out.method = a;
    else if ((a === '-d' || a === '--delete-branch') && !out.deleteBranch) out.deleteBranch = true;
    else if (a === '--disable-auto' && !out.disableAuto) out.disableAuto = true;
    else if (eq && eq[1] === '--repo' && !out.repo) out.repo = eq[2];
    else if (eq && eq[1] === '--match-head-commit' && !out.sha) out.sha = eq[2];
    else if ((a === '-R' || a === '--repo') && !out.repo && w[i + 1]) out.repo = w[++i];
    else if (a === '--match-head-commit' && !out.sha && w[i + 1]) out.sha = w[++i];
    else return null;
  }
  if (!out.number || (out.repo && !REPO.test(out.repo))) return null;
  if (out.disableAuto) return out.method || out.deleteBranch || out.sha ? null : out;
  return out;
}

const SHAPE = 'gh pr merge <number> --merge --match-head-commit <the full 40-character id of its newest commit>, alone on its line, with -R owner/repo for another project';

// Why a line that mentions a merge cannot run, or null when it clears the bar.
// `opts.ghView` and `opts.session` stand in for gh and this session's state.
export function mergeRefusal(line, { cwd = process.cwd(), ghView: view = ghView, session } = {}) {
  const m = readMerge(line);
  if (!m) {
    const t = String(line || '').replace(/["'`\\]/g, '').toLowerCase();
    if (/pulls\/\d+\/merge\b|\b(?:mergepullrequest|enablepullrequestautomerge)\b/.test(t)) return belowBar({ kind: 'api' });
    if (/\bpr\s+merge\b[^\n]*--auto\b/.test(t)) return belowBar({ kind: 'merge', auto: true });
    return `This line merges a pull request, or mentions merging one, in a form this check does not read, so it is refused. A merge runs only as one command: ${SHAPE}. If the line only mentions a merge (a commit message, a note), put that text in a file and pass the file, for example git commit -F msg.txt. A read such as gh pr view 36 --json mergeable passes on its own line with no quotes, and anything else in the line can run on a line of its own. Nothing was run.`;
  }
  if (m.disableAuto) return null;
  const target = { selector: m.number, repo: m.repo };
  const read = view(target, cwd);
  const head = String((read && read.ok && read.data && read.data.headRefOid) || '');
  const got = read && read.ok && !SHA.test(head) ? { ok: false, error: 'gh gave no id for its newest commit' } : read;
  const why = belowBar({ kind: 'merge', auto: false, target }, got, got && got.ok ? session() : {});
  if (why) return why;
  if (String(m.sha || '').toLowerCase() === head.toLowerCase()) return null;
  const exact = ['gh pr merge', m.number, m.method || '--merge', m.deleteBranch ? '--delete-branch' : '', m.repo ? `-R ${m.repo}` : '', `--match-head-commit ${head}`].filter(Boolean).join(' ');
  const named = m.sha ? `names ${m.sha.slice(0, 12)}, which is not the full id of its newest commit` : 'does not name the commit it merges';
  return `Pull request ${m.number} clears the bar on its newest commit ${head.slice(0, 7)}, but this merge ${named}. Run exactly this, alone on its line, so GitHub refuses it if a newer commit arrives first: ${exact}. Nothing was run.`;
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
