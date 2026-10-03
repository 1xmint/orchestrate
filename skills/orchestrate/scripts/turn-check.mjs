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

import { readFileSync, existsSync } from './lib/node.mjs';
import { execFileSync } from './lib/node.mjs';
import { createHash } from './lib/node.mjs';
import { join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DIR, readJson, writeJsonAtomic, sanitizeId, sessionRun, loadSession, readTail, findRepoRoot } from './lib/tier.mjs';
import { fileChange } from './lib/file-change.mjs';
import { projectPath } from './lib/project.mjs';
import { pickupSection, pickupWritten } from './lib/runs.mjs';

// Where these live now, so a hook that runs on every tool call can use them
// without loading this whole file (lib/helper-leftovers.mjs, and lib/runs.mjs
// for the Pickup text readers). Still exported from here for every importer.
export { anyHelperRunning, leftoverHelpers, leftoverText, gitHelperState, leftoverNote, mergedBranches, folderIsClean } from './lib/helper-leftovers.mjs';
export { pickupSection, pickupWritten };

export function pickupHash(runMdText) {
  return createHash('sha256').update(pickupSection(runMdText)).digest('hex').slice(0, 16);
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

// The project page, kept honest. A turn that edited a tracked file in the repo
// (not under .orchestrator/ or .claude/, not git-ignored) without editing
// .orchestrator/PROJECT.md counts one; any PROJECT.md edit resets the count to
// 0; on the third such turn the Stop says so once and the count restarts.
// It is 3 and not every turn on purpose: a hold at every edit turn is the kind
// of false alarm step 2 removed (live note Q), and a page that lags by two
// turns is still a page worth reading. Never when stop_hook_active (main),
// outside a git repo, or when the repo has no PROJECT.md (the first-helper
// check in guard-agent.mjs is where a missing page is raised).
export const PROJECT_TURNS = 3;

// Case folds only where the file system does; git check-ignore gets this path.
const norm = p => { const r = String(p || '').replace(/\\/g, '/').replace(/\/+$/, ''); return process.platform === 'win32' ? r.toLowerCase() : r; };

// The edits since the last real user message in a transcript tail. A user line
// whose content is only tool results is not a new turn.
export function turnEdits(transcriptTail) {
  let paths = [];
  for (const line of String(transcriptTail || '').split('\n')) {
    if (!line.includes('"type"')) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }
    const content = o && o.message && o.message.content;
    if (o && o.type === 'user') {
      const real = typeof content === 'string' ? content.trim() !== ''
        : Array.isArray(content) && content.some(c => c && c.type === 'text');
      if (real) paths = [];
      continue;
    }
    if (!o || o.type !== 'assistant' || !Array.isArray(content)) continue;
    for (const c of content) {
      if (!c || c.type !== 'tool_use') continue;
      const fc = fileChange(c.name, c.input);
      if (fc.changes) paths.push(...fc.paths);
    }
  }
  return { paths };
}

// Pure: what one Stop does to the count. `ignored(path)` says git-ignored.
export function projectCount({ prev, paths, root, ignored = () => false }) {
  const proj = norm(projectPath(root));
  const r = norm(root);
  const abs = p => (/^([a-z]:)?\//i.test(String(p).replace(/\\/g, '/')) ? norm(p) : norm(`${r}/${p}`));
  const list = (paths || []).map(abs);
  if (list.includes(proj)) return { count: 0, block: false };
  const tracked = list.some(p => p.startsWith(`${r}/`) && !p.startsWith(`${r}/.orchestrator/`) && !p.startsWith(`${r}/.claude/`) && !ignored(p));
  if (!tracked) return { count: Number(prev) || 0, block: false };
  const count = (Number(prev) || 0) + 1;
  return count >= PROJECT_TURNS ? { count: 0, block: true, turns: count } : { count, block: false };
}

function gitIgnored(root, p) {
  try { execFileSync('git', ['check-ignore', '-q', '--', p], { cwd: root, timeout: 5000, stdio: 'ignore' }); return true; } catch { return false; }
}

// Returns the reason to block with, or null. Updates the count either way. When
// another pulse already spoke this Stop (`quiet`), the note waits one Stop.
function checkProject(input, quiet) {
  if (!input.cwd || !input.transcript_path) return null;
  // A walk up the folders, not a `git` process: this runs at every Stop of
  // every session, and only a project with a page goes further. Starting git
  // there cost a process launch each turn (tens of milliseconds on Windows).
  const root = findRepoRoot(input.cwd);
  if (!root || !existsSync(projectPath(root))) return null;
  const { paths } = turnEdits(readTail(input.transcript_path, 1048576));
  const path = STORE();
  const store = readJson(path) || {};
  const key = sanitizeId(`${input.session_id || 'nosession'}-project`);
  const d = projectCount({ prev: (store[key] || {}).count, paths, root, ignored: p => gitIgnored(root, p) });
  const say = d.block && !quiet;
  store[key] = { count: d.block && quiet ? PROJECT_TURNS - 1 : d.count };
  try { writeJsonAtomic(path, store); } catch {}
  return say ? `orchestrate: ${d.turns} turns changed project files and .orchestrator/PROJECT.md did not change; Where it stands / Next may be stale.` : null;
}

const STORE = () => join(DIR, 'turn-checks.json');

let emitted = false;
function emitBlock(reason) {
  emitted = true;
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
    return { rec: out, kind: 'idle', why: `${ready.length} tasks are unblocked (${shown}) and nothing new has been dispatched this turn. A background dispatch hands control straight back.` };
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
    // What clears the hold, stated as a fact: without it the lead guesses.
    // SKIP_EXPLAINED needs "skipped" and "review" in one sentence.
    const clears = `It clears on a passing orch-reviewer with REVIEW OF: ${rh.task}, or a closing line saying why the review was skipped.`;
    if (rh.noVerdict) return emitBlock(`orchestrate: the independent look came back with no verdict. ${clears}`);
    if (rh.failed) return emitBlock(`orchestrate: the independent look found a problem. ${clears}`);
    if (rh.freeForm) return emitBlock(`orchestrate: a brief flagged for independent review returned done with none sent. ${clears}`);
    return emitBlock(`orchestrate: task ${rh.task} was tagged for review and returned done with none sent. ${clears}`);
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

  emitBlock(`orchestrate: ${d.why}. The Pickup section of ${run.runMd} (one sentence that continues from here, its confidence, the resume risk) is the only thing the next session reads first.`);
}

function main() {
  let payload = '';
  try { payload = readFileSync(0, 'utf8'); } catch {}
  let input = null;
  try { input = JSON.parse(payload); } catch { return; }
  if (!input || typeof input !== 'object') return;
  if (input.stop_hook_active === true) return;

  checkHeartbeat(input);
  const note = checkProject(input, emitted);
  if (note) emitBlock(note);
}

// Only when run as a hook, not when a test imports the pure functions above.
if (process.argv[1] && resolvePath(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch {}
  process.exit(0);
}
