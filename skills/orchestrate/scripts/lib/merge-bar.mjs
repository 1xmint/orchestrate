// merge-bar.mjs — the bar a pull request clears before Claude merges it:
// every check on its newest commit has passed and, when it changes one of the
// plugin's own safety checks, a reviewer in this session passed that same
// commit. guard-bash.mjs refuses a merge below the bar, in every mode, and the
// project's approved-commands list does not lift it.
//
// It does not try to read every way a merge can be spelled; a shell has too
// many. Instead any line that mentions a merge anywhere, quotes and comments
// included, is caught, and only one shape of it can pass: gh pr merge with a
// number, alone on its line, naming the full id of the newest commit with
// --match-head-commit. GitHub itself then refuses the merge if that commit is
// no longer the newest, so nothing that runs between the check and the merge
// can swap in an unchecked one. Out of scope, and docs/safety-guard.md says
// so: a command word built from a variable or $(…), a script file, node -e,
// a gh alias, a GraphQL query read from a file, and a push straight to the
// base branch.

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
  'skills/orchestrate/scripts/lib/review-of.mjs',
  'skills/orchestrate/scripts/lib/review-of.test.mjs',
  'skills/orchestrate/scripts/lib/review-words.mjs',
  'skills/orchestrate/scripts/lib/review-words.test.mjs',
];

// Whether a line mentions merging a pull request anywhere: `pr merge` (with
// flags between them), the REST merge route, or the GraphQL mutations. Quotes,
// backticks and backslashes are taken out first, so none of them can split the
// words apart.
export function mentionsMerge(line) {
  // A backslash-newline joins two halves of a word in the shell, and braces
  // expand into words (`{merge,}`), so both go before the quotes do.
  const t = String(line || '').replace(/\\\r?\n/g, '').replace(/[{},]/g, '').replace(/["'`\\]/g, '').toLowerCase();
  return /\bpr\s+(?:-\S*(?:\s+[^\s-]\S*)?\s+)*merge\b/.test(t)
    || /pulls\/\d+\/merge\b/.test(t)
    || /\b(?:mergepullrequest|enablepullrequestautomerge|enqueuepullrequest)\b/.test(t);
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
    return `This line merges a pull request, or mentions merging one, in a form this check does not read, so it is refused. A merge runs only as one command: ${SHAPE}. If the line only mentions a merge (a commit message, a note), put that text in a file and pass the file, for example git commit -F msg.txt. Nothing was run.`;
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
