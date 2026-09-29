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

import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DIR, readJson, writeJsonAtomic, sanitizeId, sessionRun, loadSession, readTail } from './lib/tier.mjs';
import { reviewWordMatch } from './lib/review-words.mjs';

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
const isReviewerRow = d => Boolean(d && (d.reviewOf || /reviewer/i.test(String(d.agent || ''))));

function freeFormOpen(returned, dispatches) {
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
    if (ds.some(x => x && x.reviewOf === d.toolUseId)) continue;
    out.push({ id: d.toolUseId, at: Date.parse(r.at), sentAt: Date.parse(d.at) });
  }
  return out;
}

export function reviewHoldDecision({ returned, dispatches, lastMessage, blockedFor }) {
  const already = new Set(Array.isArray(blockedFor) ? blockedFor : []);
  const gated = (Array.isArray(returned) ? returned : []).filter(r => r && r.reviewGated && r.task);
  const skipSaid = SKIP_EXPLAINED.test(String(lastMessage || ''));
  for (const r of gated) {
    if (already.has(r.task)) continue;
    const reviewed = (Array.isArray(dispatches) ? dispatches : []).some(d => d && d.reviewOf === r.task);
    if (reviewed || skipSaid) continue;
    return { block: true, task: r.task, blockedFor: [...already, r.task] };
  }
  const open = freeFormOpen(returned, dispatches);
  for (const f of open) {
    if (already.has(f.id) || skipSaid) continue;
    const later = open.length === 1 && (Array.isArray(dispatches) ? dispatches : []).some(d => d && isReviewerRow(d) && !(d.reviewOf && dispatches.some(x => x && x.toolUseId === d.reviewOf)) && Date.parse(d.at) > (Number.isFinite(f.sentAt) ? f.sentAt : f.at));
    if (later) continue;
    return { block: true, task: f.id, freeForm: true, blockedFor: [...already, f.id] };
  }
  return { block: false, task: null, blockedFor: [...already] };
}

// Work the lead built alone. The hold above only reads a helper's return, so a
// lead that edits sign-in, money or stored personal data itself and finishes
// never meets it. This reads the lead's own transcript (helpers keep theirs
// apart): if the request or an edit it made touches one of the plugin's review
// words (lib/review-words.mjs, the same list that flags a brief) and no
// reviewer has returned since its last edit, it yields one plain fact. Nothing
// is asked for: the host can hold a finish only by blocking it, so the fact is
// the whole reason given, and the key makes it once per set of edits.
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const TOPIC_OF = w => (/^(payments?|billing|invoice|refund|checkout|stripe|pricing?)$/.test(w) ? 'payments'
  : /^(auth|authentication|authorization|login|password|credentials?|token|oauth|permission)$/.test(w) ? 'sign-in'
  : /^(drop table|truncate|delete rows|delete records|purge|migration)$/.test(w) ? 'stored data'
  : 'a shared contract');

function editText(input) {
  const i = input || {};
  const parts = [i.file_path, i.notebook_path, i.new_string, i.content, i.new_source];
  for (const e of Array.isArray(i.edits) ? i.edits : []) parts.push(e && e.new_string);
  return parts.filter(x => typeof x === 'string').join('\n');
}

export function unreviewedRiskFact({ transcriptTail, goal, returned }) {
  let edits = 0; let lastEditAt = 0; let word = null; let lastRiskAt = 0; let lastRiskIdx = -1;
  const lines = String(transcriptTail || '').split('\n');
  lines.forEach((line, idx) => {
    if (!line.includes('"tool_use"')) return;
    let o; try { o = JSON.parse(line); } catch { return; }
    const content = o && o.message && Array.isArray(o.message.content) ? o.message.content : [];
    for (const c of content) {
      if (!c || c.type !== 'tool_use' || !EDIT_TOOLS.has(c.name)) continue;
      edits++;
      const at = Date.parse(o.timestamp) || 0;
      if (at > lastEditAt) lastEditAt = at;
      const w = reviewWordMatch(editText(c.input));
      if (w) { word = w; lastRiskIdx = idx; if (at > lastRiskAt) lastRiskAt = at; }
    }
  });
  if (!edits) return null;
  const goalWord = reviewWordMatch(String(goal || ''));
  if (!word && !goalWord) return null;
  const since = word ? lastRiskAt : lastEditAt;
  const reviewed = (Array.isArray(returned) ? returned : []).some(r => r && /reviewer/i.test(String(r.agent || '')) && (Date.parse(r.at) || 0) >= since);
  if (reviewed) return null;
  const topic = TOPIC_OF(word || goalWord);
  return { topic, key: `${word || goalWord}@${lastRiskIdx}:${edits}`, text: `this change touches ${topic}; nobody independent has looked at it.` };
}

// Helper folders left behind. A helper that works in its own worktree leaves a
// folder `<cwd>/.claude/worktrees/agent-<id>` and a branch `worktree-agent-<id>`.
// After the lead merges, both stay unless someone removes them, and the person
// who asked is never told. Counts this session's helpers whose folder still
// exists and whose branch is already merged into the current one. It only
// counts; it removes nothing.
export function leftoverHelperWorktrees({ cwd, returned, merged, exists, clean }) {
  const seen = new Set();
  for (const r of Array.isArray(returned) ? returned : []) {
    const id = r && r.agentId ? String(r.agentId) : '';
    if (!id || seen.has(id) || !/^[A-Za-z0-9]+$/.test(id)) continue;
    const dir = join(String(cwd), '.claude', 'worktrees', `agent-${id}`);
    if (!exists(dir)) continue;
    // Its work is in the current branch, or the helper returned and the folder
    // holds nothing unsaved (a folder with unsaved edits is never counted).
    if ((merged || []).includes(`worktree-agent-${id}`) || (typeof clean === 'function' && clean(dir))) seen.add(id);
  }
  return seen.size;
}

// Helper branches already merged whose folder is gone: the branch alone is
// still left over, and the person is told the same way. Counts only.
export function leftoverHelperBranches({ cwd, returned, merged, exists }) {
  const seen = new Set();
  for (const r of Array.isArray(returned) ? returned : []) {
    const id = r && r.agentId ? String(r.agentId) : '';
    if (!id || seen.has(id) || !/^[A-Za-z0-9]+$/.test(id)) continue;
    if (!(merged || []).includes(`worktree-agent-${id}`)) continue;
    if (!exists(join(String(cwd), '.claude', 'worktrees', `agent-${id}`))) seen.add(id);
  }
  return seen.size;
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
    if (rh.freeForm) return emitBlock(`orchestrate: a brief flagged for independent review returned done with none sent. Dispatch orch-reviewer with REVIEW OF: ${rh.task}, or tell the user it was skipped and why.`);
    return emitBlock(`orchestrate: task ${rh.task} was tagged for independent review; it returned done with none sent. Dispatch orch-reviewer with REVIEW OF: ${rh.task}, or tell the user it was skipped and why.`);
  }
  if (rh.blockedFor.length) updated.reviewBlockedFor = rh.blockedFor;

  // Risky work the lead did itself and no reviewer has seen: one fact, once per
  // set of edits. Quiet, and no file read beyond the transcript tail, otherwise.
  if (input.transcript_path) {
    const fact = unreviewedRiskFact({ transcriptTail: readTail(input.transcript_path, 1048576), goal: state.goal, returned: state.returned });
    if (fact && rec.riskNotedFor !== fact.key) {
      updated.riskNotedFor = fact.key;
      store[key] = updated;
      try { writeJsonAtomic(path, store); } catch {}
      return emitBlock(`orchestrate: ${fact.text}`);
    }
  }

  // Helper folders and branches still there after their work was merged: one
  // fact with the count, once per count. Nothing is removed. The git call is
  // made only when a returned helper's own folder still exists.
  const cwd = state.cwd || input.cwd;
  const anyHelper = cwd && Array.isArray(state.returned) && state.returned.some(r => r && r.agentId);
  if (anyHelper) {
    const merged = mergedBranches(cwd);
    const f = leftoverHelperWorktrees({ cwd, returned: state.returned, merged, exists: existsSync, clean: folderIsClean });
    const fMerged = leftoverHelperWorktrees({ cwd, returned: state.returned, merged, exists: existsSync });
    const b = leftoverHelperBranches({ cwd, returned: state.returned, merged, exists: existsSync });
    const n = f + b;
    if (n && rec.leftoverNotedFor !== n) {
      updated.leftoverNotedFor = n;
      store[key] = updated;
      try { writeJsonAtomic(path, store); } catch {}
      const what = f && b ? `${f} helper ${f === 1 ? 'folder' : 'folders'} and ${f + b} helper ${f + b === 1 ? 'branch are' : 'branches are'}`
        : f ? `${f} helper ${f === 1 ? 'folder and branch are' : 'folders and branches are'}`
          : `${b} helper ${b === 1 ? 'branch is' : 'branches are'}`;
      return emitBlock(`orchestrate: ${what} still here${fMerged === f ? ' although their work was merged' : ''}; nothing has been removed.`);
    }
  }

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
