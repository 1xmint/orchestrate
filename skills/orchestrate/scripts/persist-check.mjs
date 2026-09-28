#!/usr/bin/env node
// persist-check.mjs — the work-conserving loop. A Stop hook, registered in the
// plugin's hooks.json (not the skill's frontmatter) because the case it exists
// for is a session doing direct "keep coding until it's done" work, which
// usually never loads the skill, so a frontmatter hook would never fire there.
//
// A session is armed when the user asked, in plain words, to keep going toward
// a goal (router.mjs sets state.persist on "keep going", "until it's done",
// "execute the plan"). While armed, a Stop is refused with the next step, so
// the model does not hand back a turn with executable work still in front of
// it. For everyone else it reads one small session file and exits.
//
// It is biased to STOP. It continues only while the last step did visible work,
// and every stop is keyed on something observable from outside the model's own
// view of itself, because the model is worst at judging its own state
// (docs/research/0003, 0004). Parallelism is not the point; the quota waste is
// the idle turn re-reading the whole conversation, not the work.
//
//   stop when: a dispatch was denied · the same error came back twice · the last
//   message asks the user something · the last message says the goal is met ·
//   the step cap · a step that did no work.
//
// Never blocks twice in one Stop, never exits non-zero, never fails the Stop on
// its own errors.

import { readFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DIR, readJson, writeJsonAtomic, sanitizeId, loadSession, saveSession, readTail } from './lib/tier.mjs';
import { readQuota, resetClock, PERSIST_STOP_FIVE_HOUR } from './lib/quota.mjs';
import { checkpointPath, contextEpoch, hasCheckpoint, thresholds, switchAdvice } from './lib/context-advice.mjs';
import { sampleContext, markAnnounced, markTicked } from './lib/context-store.mjs';
import { modeOf } from './lib/modes.mjs';
import { classifyClaim, lastAssistantText, contradicts, countedPaths } from './lib/commit-claim.mjs';

// Blunt caps, because no published diminishing-returns rule exists
// (docs/research/0004 (b)). The check-in is a line for the human to glance at,
// not a model judging a model (deleted once as "certain cost, zero benefit",
// STATE.md v0.8.0). Context size is not judged here: transcript bytes survive
// compaction, so a byte threshold kept warning about a conversation that had
// already been compacted. The shared reader (lib/context-advice.mjs) decides, and its
// notice rides along only when its advice changes.
export const PERSIST_STEP_CAP = 25;
export const PERSIST_SCAN_CAP = 262144;

const WORK_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit', 'Bash', 'PowerShell', 'Agent', 'Task']);
// The subset of WORK_TOOLS whose file is named in the tool call itself, so
// "what the last step changed" can be said without opening anything.
const FILE_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit']);

export const shortGoal = g => { const s = String(g || '').replace(/\s+/g, ' ').trim(); return s.length > 80 ? `${s.slice(0, 77)}...` : s; };

// The first line under a bound run's RUN.md Goal heading, or null when there
// is none to read. Read fresh each time: RUN.md is the source of truth, not a
// copy pinned at arm time.
export function runGoalLine(runMd) {
  if (!runMd) return null;
  let text;
  try { text = readFileSync(runMd, 'utf8'); } catch { return null; }
  const m = /## Goal\s*\n([\s\S]*?)(?:\n## |\s*$)/.exec(text);
  const first = m ? m[1].split('\n').map(l => l.trim()).find(l => l && !/^<.*>$/.test(l)) : null;
  return first || null;
}

const textOf = c => typeof c === 'string' ? c
  : Array.isArray(c) ? c.map(b => (b && typeof b.text === 'string') ? b.text : (b && typeof b.content !== 'undefined') ? textOf(b.content) : '').join('\n')
  : '';

// The first line of an error, with numbers and paths blurred, so "the same
// error" survives a changed line number or temp directory.
export const errorKey = s => String(s || '').split('\n').map(l => l.trim()).find(Boolean)?.replace(/\d+/g, '#').replace(/[A-Za-z]:?[\\/][^\s'"]+/g, '<path>').slice(0, 160) || '';

// What the transcript slice since the last Stop shows. Parses JSONL records and
// skips anything that does not parse (the slice can start mid-line). Only the
// assistant's own words can say "done" or ask a question, so the user's goal
// text and this hook's own block reasons never trip either check.
export function scanTurn(tail) {
  const tools = [];
  const errors = [];
  let denied = false;
  let lastText = '';
  let lastChange = null;
  for (const line of String(tail || '').split('\n')) {
    if (!line.trim()) continue;
    let rec;
    try { rec = JSON.parse(line); } catch { continue; }
    const msg = rec && rec.message;
    const content = msg && Array.isArray(msg.content) ? msg.content : null;
    if (rec.type === 'assistant' && content) {
      for (const b of content) {
        if (b && b.type === 'tool_use' && b.name) {
          tools.push(b.name);
          if (FILE_TOOLS.has(b.name) && b.input && typeof b.input.file_path === 'string') lastChange = b.input.file_path;
        }
        if (b && b.type === 'text' && b.text && b.text.trim()) lastText = b.text;
      }
    } else if (rec.type === 'user' && content) {
      for (const b of content) {
        if (!b || b.type !== 'tool_result') continue;
        const t = textOf(b.content);
        if (/orchestrate (budget|guard|quota):/.test(t)) denied = true;
        if (b.is_error) { const k = errorKey(t); if (k) errors.push(k); }
      }
    }
  }
  const progressed = tools.some(n => WORK_TOOLS.has(n));
  const tailText = lastText.trim().replace(/[\s*_`)\]]+$/, '');
  const asked = /\?$/.test(tailText);
  const goalMet = /\b(goal (is )?(met|complete|completed|achieved|reached)|all (the )?(steps|tasks|todos|items) (are )?(done|complete|finished)|nothing (left|more) to do|everything (is|in the plan is) (done|complete|finished))\b/i.test(lastText);
  return { progressed, denied, errors, asked, goalMet, tools: tools.length, lastChange };
}

// Continue or stop, from the scan and the loop's own record. Pure: returns the
// next record rather than writing it. `goal` is already-resolved text (the
// bound run's Goal line, or '' when there is none) — this function does not
// read files.
export function persistDecision({ rec = {}, scan, contextNotice = '', contextAdvice = null, contextReading = null, goal = '', quota = null, workCalls = null }) {
  const steps = (Number(rec.steps) || 0) + 1;
  const seen = new Set(rec.errors || []);
  const repeat = scan.errors.find((e, i) => seen.has(e) || scan.errors.indexOf(e) !== i);
  const out = { ...rec, steps, errors: [...new Set([...(rec.errors || []), ...scan.errors])].slice(-20) };
  const g = shortGoal(goal);
  const stop = why => ({ rec: out, kind: 'stop', why });

  if (contextAdvice && (contextAdvice.action === 'compact' || contextAdvice.action === 'investigate')) {
    const path = checkpointPath(contextReading && contextReading.session, contextReading);
    const n = contextReading && contextReading.tokens != null ? `~${Math.round(contextReading.tokens / 1000)}k` : 'high';
    return stop(`the conversation is getting long (${n} tokens tracked): save a checkpoint first, then ${switchAdvice(contextReading, contextAdvice)} Save the checkpoint to ${path}.`);
  }
  if (quota && quota.fiveHour && quota.fiveHour.pct >= PERSIST_STOP_FIVE_HOUR) return stop(`the 5-hour usage window is at ${Math.round(quota.fiveHour.pct)}% (resets ${resetClock(quota.fiveHour.resetsAt)})`);
  if (scan.denied) return stop('a dispatch was denied (budget, credential or usage limit)');
  if (repeat) return stop(`the same error came back twice: ${repeat}`);
  if (scan.asked) return stop('the last message asks the user something');
  if (scan.goalMet) return stop('the last message says the goal is met');
  if (steps > PERSIST_STEP_CAP) return stop(`reached the limit of ${PERSIST_STEP_CAP} auto-continued steps in a row`);
  if (!scan.progressed) return stop('the last step did no visible work (no edit, command or dispatch)');

  const parts = [];
  if (g) parts.push(`"${g}"`);
  parts.push(`step ${steps} of ${PERSIST_STEP_CAP}`);
  if (Number.isFinite(workCalls) && workCalls >= 100) parts.push(`${workCalls} work calls since your last dispatch`);
  if (scan.lastChange) parts.push(`last edited ${scan.lastChange}`);
  let why = `orchestrate: ${parts.join(' · ')}`;
  if (contextNotice) why += ` ${contextNotice}`;
  return { rec: out, kind: 'continue', why };
}

const STORE = () => join(DIR, 'persist-checks.json');

// `git status --porcelain`, parsed to a count and up to three file names, with
// the plugin's own untracked folders (.claude/, .orchestrator/) left out. Any
// failure (no git on PATH, cwd not inside a repo, the 3s timeout) is a silent
// skip: this check only ever fires when it can be sure of the repo's state.
function gitPorcelain(cwd) {
  try {
    const r = spawnSync('git', ['status', '--porcelain'], { cwd, timeout: 3000, encoding: 'utf8' });
    if (r.error || r.status !== 0 || typeof r.stdout !== 'string') return null;
    const files = countedPaths(r.stdout.split('\n').map(l => l.trimEnd()).filter(Boolean).map(l => l.slice(3).trim()));
    return { count: files.length, files: files.slice(0, 3) };
  } catch { return null; }
}

// Commits made since the session's recorded starting HEAD, or null when
// there is no startHead to compare against (an older session, or a cwd that
// was not a repo on its first prompt) — the caller treats null as unknown.
function commitsSince(cwd, startHead) {
  if (!startHead) return null;
  try {
    const r = spawnSync('git', ['rev-list', '--count', `${startHead}..HEAD`], { cwd, timeout: 3000, encoding: 'utf8' });
    if (r.error || r.status !== 0 || typeof r.stdout !== 'string') return null;
    const n = parseInt(r.stdout.trim(), 10);
    return Number.isFinite(n) ? n : null;
  } catch { return null; }
}

function commitClaimReason(claim, git, commitsSinceStart) {
  if (claim === 'not-committed') {
    const commitNote = commitsSinceStart ? ` and ${commitsSinceStart} commit${commitsSinceStart === 1 ? '' : 's'} since this session started` : '';
    return `Before you finish: your last message says nothing is committed, but git status shows a clean tree${commitNote}. Tell the user exactly what is committed and what is not, from git status, then finish.`;
  }
  const names = git.files.length ? ` (${git.files.join(', ')})` : '';
  return `Before you finish: your last message says the work is committed, but git status shows ${git.count} file${git.count === 1 ? '' : 's'} not committed${names}. Say which files are not committed, then finish.`;
}

// Checks the closing message's claim about `git commit` against what the
// repo actually shows. Independent of the auto-continue loop above — an
// ordinary Stop with no persist armed gets this too — and never blocks the
// same claim twice in one session (docs/audits/2026-09-27-live-runs-r6.md,
// docs/audits/2026-09-27-scoresheet-r6.md top-five item 1 and row 11).
function checkCommitClaim(input, state) {
  if (input.stop_hook_active || !input.cwd) return null;
  const tail = input.transcript_path ? readTail(input.transcript_path, PERSIST_SCAN_CAP) : '';
  const text = lastAssistantText(tail);
  if (!text) return null;
  const claim = classifyClaim(text);
  if (!claim || claim === 'mixed') return null;
  const git = gitPorcelain(input.cwd);
  if (!git) return null;
  const commitsSinceStart = commitsSince(input.cwd, state && state.startHead);
  if (!contradicts(claim, git.count, commitsSinceStart)) return null;
  const claimHash = createHash('sha256').update(text).digest('hex').slice(0, 16);
  if (state && state.commitClaimBlocked === claimHash) return null;
  const st = state || { session_id: input.session_id };
  st.commitClaimBlocked = claimHash;
  try { saveSession(st); } catch {}
  return commitClaimReason(claim, git, commitsSinceStart);
}

function emitBlock(reason) {
  process.stdout.write(JSON.stringify({ decision: 'block', reason }));
}

// Shown to the user, never blocks: the loop is over, and why, in one line.
export function endMessage(why) {
  return `Auto-continue stopped: ${why}. Say "keep going" to start it again.`;
}

function emitSystemMessage(message) {
  process.stdout.write(JSON.stringify({ systemMessage: message }));
}

export function check(input) {
  // A subagent's own Stop is not the lead's auto-continue loop — `agent_id`
  // on the payload (hooks doc, "common input fields") marks a call that fires
  // inside a subagent. Refusing a helper's own Stop with the lead's goal text
  // would be both wrong (the helper does not own that loop) and pure noise
  // read back into a context that did not ask for it.
  if (input && input.agent_id) return null;
  const state = loadSession(input.session_id);
  const p = state && state.persist;

  const path = STORE();
  const store = readJson(path) || {};
  const key = sanitizeId(input.session_id || 'nosession');
  const bound = (state && state.run && state.run.runMd) || null;
  let ctx = null;
  try { ctx = input.transcript_path ? sampleContext({ transcriptPath: input.transcript_path, session: input.session_id || null, announce: false, runMd: bound, permissionMode: modeOf(input) }) : null; } catch { ctx = null; }
  // Independent of auto-continue and everything below it: an ordinary Stop
  // with nothing armed gets this too.
  const commitClaimReasonText = checkCommitClaim(input, state);
  if (commitClaimReasonText) return { kind: 'continue', why: commitClaimReasonText };
  // This is deliberately outside auto-continue: reaching the compaction line
  // is unsafe even for an ordinary Stop. A block is once per epoch, and an
  // active Stop hook must not block itself again.
  if ((!p || !p.armed) && !input.stop_hook_active && ctx && ctx.reading && ctx.reading.tokens != null) {
    const epoch = contextEpoch(ctx.reading);
    const rec = store[key] || {};
    const at = thresholds(ctx.reading).compactAt;
    const checkpoint = hasCheckpoint(input.session_id || null, ctx.reading, { runMd: bound, permissionMode: modeOf(input) });
    if (ctx.reading.tokens >= at && !checkpoint && rec.contextBlockedFor !== epoch) {
      store[key] = { ...rec, contextBlockedFor: epoch, checkedAt: new Date().toISOString() };
      try { writeJsonAtomic(path, store); } catch {}
      return { rec: store[key], kind: 'continue', why: `orchestrate: context is ~${Math.round(ctx.reading.tokens / 1000)}k: write a checkpoint first, then ${switchAdvice(ctx.reading, ctx.advice)} Save the checkpoint to ${checkpointPath(input.session_id || null, ctx.reading)}.` };
    }
    return null;
  }
  if (!p || !p.armed) return null;
  // A new arming starts a fresh count; the scan starts where the arming did.
  let rec = store[key] || {};
  if (rec.armedAt !== p.armedAt) rec = { armedAt: p.armedAt, lastSize: Number(p.sizeAtArm) || 0 };

  let size = 0;
  try { if (input.transcript_path) size = statSync(input.transcript_path).size; } catch {}
  const from = Math.min(Number(rec.lastSize) || 0, size);
  // Exactly the bytes since the last check: any floor here re-reads the previous
  // step's work and counts it again, which is a loop that never sees "no work".
  const tail = input.transcript_path && size > from ? readTail(input.transcript_path, Math.min(size - from, PERSIST_SCAN_CAP)) : '';
  // Sampled without announcing: the notice is only delivered if this Stop is
  // refused, and the store is marked as announced only then.
  const workCalls = state && state.workCalls && Number.isFinite(state.workCalls.count) ? state.workCalls.count : null;
  const dec = persistDecision({ rec, scan: scanTurn(tail), contextNotice: ctx ? ctx.notice : '', contextAdvice: ctx ? ctx.advice : null, contextReading: ctx ? ctx.reading : null, goal: runGoalLine(bound) || p.goal || '', quota: readQuota(), workCalls });
  if (dec.kind === 'continue' && ctx && ctx.notice) { try { markAnnounced(input.session_id || null, null, ctx.advice.key); if (ctx.tick) markTicked(input.session_id || null, null, ctx.tick); } catch {} }

  store[key] = { ...dec.rec, lastSize: size, checkedAt: new Date().toISOString() };
  try { writeJsonAtomic(path, store); } catch {}

  if (dec.kind === 'stop') {
    state.persist = { ...p, armed: false, endedAt: new Date().toISOString(), endReason: dec.why };
    try { saveSession(state); } catch {}
  }
  return dec;
}

function main() {
  let payload = '';
  try { payload = readFileSync(0, 'utf8'); } catch {}
  let input = null;
  try { input = JSON.parse(payload); } catch { return; }
  if (!input || typeof input !== 'object') return;
  // stop_hook_active is deliberately not an early exit here: a loop that keeps a
  // turn alive is exactly a Stop hook that fires again after its own block. The
  // step cap and the no-work stop are what end it.
  const dec = check(input);
  if (dec && dec.kind === 'continue') emitBlock(dec.why);
  else if (dec && dec.kind === 'stop' && dec.why) emitSystemMessage(endMessage(dec.why));
}

if (process.argv[1] && resolvePath(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch {}
  process.exit(0);
}
