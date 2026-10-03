// lib/helper-leftovers.mjs — which helpers are still running, and which helper
// folders and branches are left behind once they have all returned.
//
// Split out of turn-check.mjs because context-check.mjs runs after every tool
// call of every session and needs only these two answers, once per helper
// return. Importing turn-check.mjs for them loaded the whole Stop hook and its
// imports on every call. turn-check.mjs re-exports everything here, so its own
// importers (and its tests) are unchanged.

// child_process is loaded on first use (lib/node.mjs): git is asked only once
// per helper return, and this file is imported by a hook that runs on every
// tool call.
import { existsSync, realpathSync, execFileSync } from './node.mjs';
import { join, resolve as resolvePath } from 'node:path';

// A dispatch of this session with no return yet, sent within the last six
// hours (an older one is a helper that died without a return, not one working).
export function anyHelperRunning({ dispatches, returned, now }) {
  const rs = Array.isArray(returned) ? returned : [];
  const t0 = Number.isFinite(now) ? now : Date.now();
  return (Array.isArray(dispatches) ? dispatches : []).some(d => d && (d.toolUseId || d.agentId)
    && !(Date.parse(d.at) < t0 - 6 * 3600 * 1000)
    && !rs.some(r => r && ((r.toolUseId && d.toolUseId && r.toolUseId === d.toolUseId) || (r.agentId && d.agentId && r.agentId === d.agentId))));
}

// Helper folders and branches left behind. A helper that works in its own
// worktree leaves a folder `<cwd>/.claude/worktrees/agent-<id>` and a branch
// `worktree-agent-<id>`. Both stay unless someone removes them, and the person
// who asked is never told. Counts what git reports now, for this session's
// helpers: a folder counts only if git still lists it and it is on disk (a
// folder git no longer knows is not counted); a branch counts only if it still
// exists. A folder or branch counts when its work is merged, or (a folder, and
// its branch with it) the helper returned and the folder holds nothing unsaved.
// Removes nothing.
//   known: folder paths git lists; branches: helper branch names git lists.
export function leftoverHelpers({ cwd, returned, merged, exists, clean, known, branches }) {
  const seen = new Set();
  let folders = 0, branchCount = 0, foldersMerged = 0;
  const norm = p => { let r = String(p); try { r = realpathSync(r); } catch { r = resolvePath(r); } r = r.replace(/\\/g, '/').replace(/\/+$/, ''); return process.platform === 'win32' ? r.toLowerCase() : r; };
  const knownSet = new Set((known || []).map(norm));
  for (const r of Array.isArray(returned) ? returned : []) {
    const id = r && r.agentId ? String(r.agentId) : '';
    if (!id || seen.has(id) || !/^[A-Za-z0-9]+$/.test(id)) continue;
    seen.add(id);
    const dir = join(String(cwd), '.claude', 'worktrees', `agent-${id}`);
    const isMerged = (merged || []).includes(`worktree-agent-${id}`);
    let folder = false;
    if (exists(dir) && knownSet.has(norm(dir)) && (isMerged || (typeof clean === 'function' && clean(dir)))) { folder = true; folders++; if (isMerged) foldersMerged++; }
    if ((branches || []).includes(`worktree-agent-${id}`) && (isMerged || folder)) branchCount++;
  }
  return { folders, branches: branchCount, allMerged: foldersMerged === folders };
}

// The note's words, by what is really left: folders only, branches only, or both.
export function leftoverText({ folders, branches }) {
  const fw = `${folders} helper ${folders === 1 ? 'folder' : 'folders'}`;
  const what = folders && branches ? `${fw} and ${branches} ${branches === 1 ? 'branch' : 'branches'}`
    : folders ? fw : `${branches} helper ${branches === 1 ? 'branch' : 'branches'}`;
  return `${what} ${folders + branches === 1 ? 'is' : 'are'} still here`;
}

// The git look runs inside hooks with a five-second limit, one of them after
// every tool call, and a slow repository with several helper folders took all
// of it: the hook was killed before it could note that it had looked, so it
// looked again on the next call (whole-file review, 2026-10-03). All the git
// calls of one look share LOOK_MS; a call with no time left is skipped, as a
// failed one is.
const LOOK_MS = 1500;
let until = null;
const gitOut = (args, cwd) => {
  const left = until == null ? 5000 : until - Date.now();
  if (left < 50) throw new Error('no time left for git');
  return execFileSync('git', args, { cwd, encoding: 'utf8', timeout: Math.min(5000, left), stdio: ['ignore', 'pipe', 'ignore'] });
};

// What git reports now: the folders it lists and the helper branches it lists.
export function gitHelperState(cwd) {
  const git = args => gitOut(args, cwd);
  let known = [], branches = [];
  try { known = git(['worktree', 'list', '--porcelain']).split('\n').filter(l => l.startsWith('worktree ')).map(l => l.slice(9).trim()); } catch {}
  try { branches = git(['branch', '--list', '--format=%(refname:short)', 'worktree-agent-*']).split('\n').map(x => x.trim()).filter(Boolean); } catch {}
  return { known, branches };
}

// The whole check for one session: null when nothing is left.
export function leftoverNote({ cwd, returned, dispatches }) {
  if (!cwd || !Array.isArray(returned) || !returned.some(r => r && r.agentId) || anyHelperRunning({ dispatches, returned })) return null;
  until = Date.now() + LOOK_MS;
  try {
    const { known, branches } = gitHelperState(cwd);
    const c = leftoverHelpers({ cwd, returned, merged: mergedBranches(cwd), exists: existsSync, clean: folderIsClean, known, branches });
    return c.folders + c.branches ? { ...c, text: leftoverText(c) } : null;
  } finally { until = null; }
}

// Helper branches whose work is really in the current branch: the branch has at
// least one commit of its own (its reflog records a commit, merge or pick) and
// the current branch contains it. A helper branch that never committed sits at
// the tip it was cut from, which `--merged` lists too, so that alone is not enough.
export function mergedBranches(cwd) {
  const git = args => gitOut(args, cwd);
  try {
    const names = git(['branch', '--merged', 'HEAD', '--format=%(refname:short)']).split('\n').map(x => x.trim()).filter(n => /^worktree-agent-[A-Za-z0-9]+$/.test(n));
    return names.filter(n => {
      try { return git(['reflog', 'show', '--format=%gs', `refs/heads/${n}`]).split('\n').some(l => /^(commit|merge|cherry-pick|rebase)/.test(l.trim())); } catch { return false; }
    });
  } catch { return []; }
}

// A helper folder with nothing unsaved in it (no changed or new files).
export function folderIsClean(dir) {
  try { return gitOut(['-C', dir, 'status', '--porcelain']).trim() === ''; } catch { return false; }
}
