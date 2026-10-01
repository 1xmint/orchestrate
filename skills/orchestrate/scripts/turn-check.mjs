#!/usr/bin/env node
// turn-check.mjs — the session's Stop hook and management heartbeat, registered
// from SKILL.md's frontmatter so it is live only while the skill is in play.
// Idle and Pickup below are for a coordinated run this session has explicitly
// bound; the review hold is not — it reads a task's own return, which lands
// in session state whether or not a run is bound, so it checks regardless.
//
// Three pulses, in priority order, at most one block per Stop:
//   1. idle — two or more tasks are unblocked and nothing new was dispatched;
//      start them or say why you are waiting. Said once per unblocked set.
//   2. review — a task tagged for independent review came back done with none
//      sent. Said once per task, cleared by a reviewer dispatch or a closing
//      message that says the review was skipped and why.
//   3. pickup — a run whose Pickup is older than the last dispatch cannot be
//      resumed, so the next session would start blind.
//
// It never asks for more research, more testing or a better answer: a Stop hook
// that demands improvement after the work is finished is a loop with no exit
// condition, and the one that used to live here (a source-count floor under
// set-shaped recommendations) fired on two failed fetches as readily as on two
// real sources.

import { readFileSync, existsSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DIR, readJson, writeJsonAtomic, sanitizeId, sessionRun, loadSession } from './lib/tier.mjs';

export function pickupSection(runMdText) {
  const m = /## Pickup\s*\n([\s\S]*?)(?:\n## |\s*$)/.exec(String(runMdText || ''));
  return m ? m[1].trim() : '';
}

export function pickupHash(runMdText) {
  return createHash('sha256').update(pickupSection(runMdText)).digest('hex').slice(0, 16);
}

// A Pickup section still holding its template placeholders is not written.
export function pickupWritten(section) {
  const prompt = /Pickup prompt:\s*(.*)/.exec(section || '');
  if (!prompt) return false;
  const v = prompt[1].trim();
  return Boolean(v) && !/^<.*>$/.test(v);
}

// Hash comparison, not timestamps: a clock is not a fact here (a hook rewrites
// files under the run, and a dispatch time and a file write are not comparable).
// `prev` is what this hook recorded the last time it ran for this run.
//   no dispatch this session                     -> quiet, there is nothing to record
//   the Pickup is still the template placeholder -> block, it was never written
//   the hash changed since the last check        -> quiet, the lead wrote it
//   the hash is unchanged and a dispatch has
//     happened since the last check              -> block once
export function shouldBlock({ pickupHash: hash, section, lastDispatchAt, prev = {} }) {
  if (!lastDispatchAt) return { block: false, why: 'no dispatch this session' };
  if (prev.blockedFor === hash) return { block: false, why: 'already blocked once for this text' };
  if (!pickupWritten(section)) return { block: true, why: 'Pickup has never been written' };
  if (prev.hash !== hash) return { block: false, why: 'Pickup changed since the last check' };
  if (!prev.checkedAt || Date.parse(lastDispatchAt) > Date.parse(prev.checkedAt)) {
    return { block: true, why: 'Pickup has not changed since the last dispatch' };
  }
  return { block: false, why: 'no dispatch since the last check' };
}

// A task's own returned row (ledger.mjs's SubagentStop, session state
// `returned`) carries `reviewGated: true` when it came back DONE tagged for
// independent review with no reviewer return yet. Resolved either by a
// reviewer dispatch this session recorded with `reviewOf` naming the same
// task (guard-agent.mjs's recordDispatch), or by the lead's own closing
// message saying the review was skipped, in its own words, near "review".
// Blocks at most once per task: a task already in `blockedFor` from a prior
// Stop is left alone whether or not it was ever resolved, the same "ask
// once" shape as the Pickup check below — a Stop hook that re-blocks a task
// the lead already saw once is a loop with no exit.
const SKIP_EXPLAINED = /\bskip(?:ped|ping)?\b[^.\n]{0,80}\breview\b|\breview\b[^.\n]{0,80}\bskip(?:ped|ping)?\b/i;

// A brief with no task id has no id for the ledger to hold it on, so its own
// return never carries reviewGated. It is held here instead, keyed on the id of
// the dispatch call (toolUseId), which the dispatch record and the return share:
// a return for a dispatch flagged for review, that came back DONE, is held until
// a reviewer's REVIEW OF names that id, or, when it is the only such return
// still open, until a reviewer is dispatched after it. With two or more open,
// only the explicit id clears one; nothing is guessed. A reviewer's own return
// is never held, and a dispatch that was not flagged is never held.
// A reviewer is known by its role alone. A session file written before 0.17.2
// can hold a builder's dispatch with reviewOf (its brief quoted a review), and
// that builder is not a look.
const isReviewerRow = d => Boolean(d && /reviewer/i.test(String(d.agent || '')));

// The verdict that stands for one reviewer dispatch: the newest on file for its
// ids, in file order (`returned` is append-only). A follow-up SendMessage to the
// same reviewer shares the dispatch's ids but may be about other work, so a
// PASS naming other work under REVIEW OF is skipped, and a PASS that names no
// work cannot undo a FAIL: only a PASS naming the same work can. A FAIL always
// counts, whatever it names: a mistyped id must not hide one.
const standingVerdict = (d, returned) => {
  let last = null;
  for (const r of Array.isArray(returned) ? returned : []) {
    if (!r || !r.verdict) continue;
    if (!((r.toolUseId && d.toolUseId && r.toolUseId === d.toolUseId) || (r.agentId && d.agentId && r.agentId === d.agentId))) continue;
    if (r.verdict !== 'FAIL' && r.reviewOf && d.reviewOf && r.reviewOf !== d.reviewOf) continue;
    if (last && last.verdict === 'FAIL' && r.verdict !== 'FAIL' && !(r.reviewOf && r.reviewOf === d.reviewOf)) continue;
    last = r;
  }
  return last;
};
const reviewFailed = (d, returned) => (standingVerdict(d, returned) || {}).verdict === 'FAIL';
const looksAt = (ds, returned, id) => ds.filter(x => x && x.reviewOf === id && isReviewerRow(x));

// Several reviewers of the same work. One still running (no reply on file, sent
// within six hours, the bound anyHelperRunning uses) is a look. One that replied
// with no verdict that stands (capped, no OUTCOME, a PASS naming other work) is
// neither a pass nor a fail. Otherwise the newest standing verdict decides, so a
// fresh reviewer's FAIL after another's PASS holds. `fail` is the FAIL that
// stands, whose time keys the ask-once memory: a second FAIL after a PASS is
// news and is said again.
const sameHelper = (r, d) => Boolean(r && ((r.toolUseId && d.toolUseId && r.toolUseId === d.toolUseId) || (r.agentId && d.agentId && r.agentId === d.agentId)));
const judgeLooks = (looks, returned, now = Date.now()) => {
  const rs = Array.isArray(returned) ? returned : [];
  let newest = null;
  for (const d of looks) {
    const v = standingVerdict(d, rs);
    if (!v) {
      if (!rs.some(r => sameHelper(r, d)) && !(Date.parse(d.at) < now - 6 * 3600 * 1000)) return { passed: true, fail: null };
      continue;
    }
    if (!newest || rs.indexOf(v) > rs.indexOf(newest)) newest = v;
  }
  return newest && newest.verdict === 'FAIL' ? { passed: false, fail: newest } : { passed: Boolean(newest), fail: null };
};
const failKey = (id, fail) => (fail && fail.at ? `${id}:failed@${fail.at}` : `${id}:failed`);

// A dispatch of this session with no return yet, sent within the last six
// hours (an older one is a helper that died without a return, not one working).
export function anyHelperRunning({ dispatches, returned, now }) {
  const rs = Array.isArray(returned) ? returned : [];
  const t0 = Number.isFinite(now) ? now : Date.now();
  return (Array.isArray(dispatches) ? dispatches : []).some(d => d && (d.toolUseId || d.agentId)
    && !(Date.parse(d.at) < t0 - 6 * 3600 * 1000)
    && !rs.some(r => r && ((r.toolUseId && d.toolUseId && r.toolUseId === d.toolUseId) || (r.agentId && d.agentId && r.agentId === d.agentId))));
}

function freeFormOpen(returned, dispatches, now) {
  const ds = Array.isArray(dispatches) ? dispatches : [];
  const out = [];
  for (const r of Array.isArray(returned) ? returned : []) {
    if (!r || r.task || r.status !== 'DONE') continue;
    // A helper's stop event carries its agent id but not the dispatch call's id,
    // so a return with no toolUseId is matched on the agent id both rows share.
    const d = r.toolUseId
      ? ds.find(x => x && x.toolUseId === r.toolUseId)
      : (r.agentId ? ds.find(x => x && x.agentId === r.agentId) : null);
    if (!d || !d.toolUseId || d.task || !d.review || isReviewerRow(d)) continue;
    const looks = looksAt(ds, returned, d.toolUseId);
    const judged = judgeLooks(looks, returned, now);
    if (judged.passed) continue;
    out.push({ id: d.toolUseId, at: Date.parse(r.at), sentAt: Date.parse(d.at), failed: looks.length > 0, fail: judged.fail });
  }
  return out;
}

export function reviewHoldDecision({ returned, dispatches, lastMessage, blockedFor, now }) {
  const t0 = Number.isFinite(now) ? now : Date.now();
  const already = new Set(Array.isArray(blockedFor) ? blockedFor : []);
  const gated = (Array.isArray(returned) ? returned : []).filter(r => r && r.reviewGated && r.task);
  const skipSaid = SKIP_EXPLAINED.test(String(lastMessage || ''));
  for (const r of gated) {
    const looks = looksAt(Array.isArray(dispatches) ? dispatches : [], returned, r.task);
    const judged = judgeLooks(looks, returned, t0);
    if (judged.passed || skipSaid) continue;
    const failed = looks.length > 0;
    const key = failed ? failKey(r.task, judged.fail) : r.task;
    if (already.has(key)) continue;
    return { block: true, task: r.task, failed, noVerdict: failed && !judged.fail, blockedFor: [...already, key] };
  }
  const open = freeFormOpen(returned, dispatches, t0);
  for (const f of open) {
    const key = f.failed ? failKey(f.id, f.fail) : f.id;
    if (already.has(key) || skipSaid) continue;
    const later = !f.failed && open.length === 1 && (Array.isArray(dispatches) ? dispatches : []).some(d => d && isReviewerRow(d) && !(d.reviewOf && dispatches.some(x => x && x.toolUseId === d.reviewOf)) && !reviewFailed(d, returned) && Date.parse(d.at) > (Number.isFinite(f.sentAt) ? f.sentAt : f.at));
    if (later) continue;
    return { block: true, task: f.id, freeForm: true, failed: Boolean(f.failed), noVerdict: Boolean(f.failed) && !f.fail, blockedFor: [...already, key] };
  }
  return { block: false, task: null, blockedFor: [...already] };
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

// What git reports now: the folders it lists and the helper branches it lists.
export function gitHelperState(cwd) {
  const git = args => execFileSync('git', args, { cwd, encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] });
  let known = [], branches = [];
  try { known = git(['worktree', 'list', '--porcelain']).split('\n').filter(l => l.startsWith('worktree ')).map(l => l.slice(9).trim()); } catch {}
  try { branches = git(['branch', '--list', '--format=%(refname:short)', 'worktree-agent-*']).split('\n').map(x => x.trim()).filter(Boolean); } catch {}
  return { known, branches };
}

// The whole check for one session: null when nothing is left.
export function leftoverNote({ cwd, returned, dispatches }) {
  if (!cwd || !Array.isArray(returned) || !returned.some(r => r && r.agentId) || anyHelperRunning({ dispatches, returned })) return null;
  const { known, branches } = gitHelperState(cwd);
  const c = leftoverHelpers({ cwd, returned, merged: mergedBranches(cwd), exists: existsSync, clean: folderIsClean, known, branches });
  return c.folders + c.branches ? { ...c, text: leftoverText(c) } : null;
}

// Helper branches whose work is really in the current branch: the branch has at
// least one commit of its own (its reflog records a commit, merge or pick) and
// the current branch contains it. A helper branch that never committed sits at
// the tip it was cut from, which `--merged` lists too, so that alone is not enough.
export function mergedBranches(cwd) {
  const git = args => execFileSync('git', args, { cwd, encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] });
  try {
    const names = git(['branch', '--merged', 'HEAD', '--format=%(refname:short)']).split('\n').map(x => x.trim()).filter(n => /^worktree-agent-[A-Za-z0-9]+$/.test(n));
    return names.filter(n => {
      try { return git(['reflog', 'show', '--format=%gs', `refs/heads/${n}`]).split('\n').some(l => /^(commit|merge|cherry-pick|rebase)/.test(l.trim())); } catch { return false; }
    });
  } catch { return []; }
}

// A helper folder with nothing unsaved in it (no changed or new files).
export function folderIsClean(dir) {
  try { return execFileSync('git', ['-C', dir, 'status', '--porcelain'], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).trim() === ''; } catch { return false; }
}

const STORE = () => join(DIR, 'turn-checks.json');

function emitBlock(reason) {
  process.stdout.write(JSON.stringify({
    decision: 'block',
    reason,
    hookSpecificOutput: { hookEventName: 'Stop', decision: 'block', reason },
  }));
}

// Threshold for the idle nudge. Turns are counted per session-run here rather
// than read from the transcript, so this stays cheap on every Stop.
export const IDLE_READY_MIN = 2;

// The nudge this Stop deserves, if any, computed before the Pickup check.
// Pure but for advancing the turn counter it carries in `rec`, so it can be
// tested without files. Priority is deliberate: start unblocked work before
// nagging about Pickup.
export function heartbeatDecision({ run, rec }) {
  const prev = rec || {};
  const turns = (Number(prev.turns) || 0) + 1;
  const out = { ...prev, turns };

  // Unblocked tasks sitting while the lead waits on one is the "you're right, I
  // had three things I could have been doing" failure, said once per ready set.
  const ready = (run && run.ready) || [];
  const readyKey = ready.slice().sort().join(',');
  if (ready.length >= IDLE_READY_MIN && prev.readyBlockedFor !== readyKey) {
    out.readyBlockedFor = readyKey;
    const shown = ready.slice(0, 4).join(', ') + (ready.length > 4 ? ` +${ready.length - 4} more` : '');
    return { rec: out, kind: 'idle', why: `${ready.length} tasks are unblocked (${shown}) and nothing new has been dispatched this turn. A background dispatch hands control straight back, so start the ones that can run at once — or say plainly why you are waiting.` };
  }

  return { rec: out, kind: null };
}

function checkHeartbeat(input) {
  // Idle and Pickup honesty are only for a run this session was explicitly
  // bound to: an unbound session is doing direct work, and direct work has no
  // ledger to keep current, and an open run this session never claimed is not
  // its to be nagged about. The review hold below is different — it reads a
  // task's own `returned` row, which ledger.mjs writes to session state on
  // every SubagentStop whether or not a run is bound, so it runs regardless.
  const run = sessionRun(input.session_id);
  const bound = run && run.open;

  const path = STORE();
  const store = readJson(path) || {};
  const key = sanitizeId(`${input.session_id || 'nosession'}-${bound ? run.runId : 'unbound'}`);
  const rec = store[key] || {};
  let updated = { ...rec, checkedAt: new Date().toISOString() };

  if (bound) {
    // Idle first, advancing the turn counter either way.
    const hb = heartbeatDecision({ run, rec });
    updated = { ...hb.rec, checkedAt: new Date().toISOString() };
    if (hb.kind) {
      store[key] = updated;
      try { writeJsonAtomic(path, store); } catch {}
      return emitBlock(`orchestrate: ${hb.why}`);
    }
  }

  const state = loadSession(input.session_id) || {};

  // Then the review hold: a task tagged for independent review (money, auth,
  // destructive data, a shared contract — guard-agent.mjs) that came back
  // DONE with none sent. Once per task, same "ask once" shape as Pickup below.
  const rh = reviewHoldDecision({
    returned: state.returned,
    dispatches: state.dispatches,
    lastMessage: input.last_assistant_message,
    blockedFor: rec.reviewBlockedFor,
  });
  if (rh.block) {
    updated.reviewBlockedFor = rh.blockedFor;
    store[key] = updated;
    try { writeJsonAtomic(path, store); } catch {}
    if (rh.noVerdict) return emitBlock('orchestrate: the independent look came back with no verdict; send it again.');
    if (rh.failed) return emitBlock('orchestrate: the independent look found a problem; fix it and have it looked at again.');
    if (rh.freeForm) return emitBlock(`orchestrate: a brief flagged for independent review returned done with none sent. Dispatch orch-reviewer with REVIEW OF: ${rh.task}, or tell the user it was skipped and why.`);
    return emitBlock(`orchestrate: task ${rh.task} was tagged for independent review; it returned done with none sent. Dispatch orch-reviewer with REVIEW OF: ${rh.task}, or tell the user it was skipped and why.`);
  }
  if (rh.blockedFor.length) updated.reviewBlockedFor = rh.blockedFor;

  // Helper folders and branches left behind are not raised here: the note goes
  // to the lead on its next tool call (context-check.mjs), so a closing message
  // is never followed by an error notice.

  if (!bound) { store[key] = updated; try { writeJsonAtomic(path, store); } catch {} return; }

  // Then Pickup honesty, only after a dispatch, only for the run this session
  // drives, exactly as before.
  const lastDispatchAt = state.lastDispatchAt || null;
  if (!lastDispatchAt) { store[key] = updated; try { writeJsonAtomic(path, store); } catch {} return; }

  const text = readFileSync(run.runMd, 'utf8');
  const hash = pickupHash(text);
  const section = pickupSection(text);
  const d = shouldBlock({ pickupHash: hash, section, lastDispatchAt, prev: rec });
  updated = { ...updated, hash };

  if (!d.block) { store[key] = updated; try { writeJsonAtomic(path, store); } catch {} return; }

  updated.blockedFor = hash;
  store[key] = updated;
  try { writeJsonAtomic(path, store); } catch {}

  emitBlock(`orchestrate: ${d.why}. Before this turn ends, update the Pickup section of ${run.runMd}: one sentence that continues from here, its confidence, and the resume risk. Also set the phase glyph on any row you graded. That section is the only thing the next session reads first.`);
}

function main() {
  let payload = '';
  try { payload = readFileSync(0, 'utf8'); } catch {}
  let input = null;
  try { input = JSON.parse(payload); } catch { return; }
  if (!input || typeof input !== 'object') return;
  if (input.stop_hook_active === true) return;

  checkHeartbeat(input);
}

// Only when run as a hook, not when a test imports the pure functions above.
if (process.argv[1] && resolvePath(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch {}
  process.exit(0);
}
