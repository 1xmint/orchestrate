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
// It is registered a second time on StopFailure, the host's moment for a turn
// that ended in an API error (a usage limit among them). The host ignores what
// a hook prints there, so the script only writes the pause record
// (lib/pause.mjs, docs/pause.md) and never touches the keep-going state: where
// the host waits and resumes, the loop is still armed when it does.
//
// It is biased to STOP. It continues only while the last step did visible work,
// and every stop is keyed on something observable from outside the model's own
// view of itself, because the model is worst at judging its own state
// (docs/research/0003, 0004). Parallelism is not the point; the quota waste is
// the idle turn re-reading the whole conversation, not the work.
//
//   stop when: a dispatch was denied by the budget or the credential check · the
//   same error came back twice · the last message asks the user something · the
//   last message says the goal is met · the same open item named three continues
//   in a row · the step cap · a step that did no work while nothing is out.
//
// A usage limit is not a stop. The plugin's own 90% five-hour stop is gone (it
// turned the loop off just before the host's resume), and a helper refused for
// usage is a fact the next continue states, not a reason to end the loop.
//
// After it has printed and decided, it leaves one small record for the band, the
// line above the prompt (lib/band.mjs, docs/band.md): working, a question waiting
// for the user, or idle. That write cannot change what it printed or decided.
//
// Never blocks twice in one Stop, never exits non-zero, never fails the Stop on
// its own errors.

import { readFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DIR, readJson, writeJsonAtomic, sanitizeId, loadSession, saveSession, readTail } from './lib/tier.mjs';
import { pauseRoot, pauseRecord, writePause, clearPause } from './lib/pause.mjs';
import { checkpointPath, contextEpoch, contextEpochStart, hasCheckpoint, thresholds } from './lib/context-advice.mjs';
import { nextOpen, ALL_DONE_TEXT } from './lib/runs.mjs';
import { recordBand, bandAtStop, openItem, sessionGoal, stopQuestion } from './lib/band.mjs';
import { readProject } from './lib/project.mjs';
import { sampleContext, markAnnounced, markTicked } from './lib/context-store.mjs';
import { modeOf } from './lib/modes.mjs';
import { classifyClaim, lastAssistantText, contradicts, countedPaths, namesAllPaths } from './lib/commit-claim.mjs';

// Blunt caps, because no published diminishing-returns rule exists
// (docs/research/0004 (b)). The check-in is a line for the human to glance at,
// not a model judging a model (deleted once as "certain cost, zero benefit",
// STATE.md v0.8.0). Context size is not judged here: transcript bytes survive
// compaction, so a byte threshold kept warning about a conversation that had
// already been compacted. The shared reader (lib/context-advice.mjs) decides, and its
// notice rides along only when its advice changes.
export const PERSIST_STEP_CAP = 25;
// Continues that may name the same open item before the loop stops. A turn
// that ends three times with the same item still open is stuck, and a stuck
// run nudged up to the step cap is the costliest way this loop fails. Anthropic's
// guidance for unattended runs ("Prompting Claude Opus 5.5", checked 2026-10-01)
// says to stop after two or three automatic continuations on the same task.
export const PERSIST_SAME_ITEM_CAP = 3;
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
//
// A dispatch refused by the budget or the credential check is `denied`, a safety
// stop. One refused for usage ("orchestrate quota:") is `quotaRefused` instead:
// the lead can still work without a helper, so it is a fact to state, not a stop.
// It is also kept out of `errors`: three helpers sent in one step and all
// refused would otherwise read as "the same error twice".
export function scanTurn(tail) {
  const tools = [];
  const errors = [];
  let denied = false;
  let quotaRefused = false;
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
        if (/orchestrate (budget|guard):/.test(t)) denied = true;
        const usageRefusal = /orchestrate quota:/.test(t);
        if (usageRefusal) quotaRefused = true;
        if (b.is_error && !usageRefusal) { const k = errorKey(t); if (k) errors.push(k); }
      }
    }
  }
  const progressed = tools.some(n => WORK_TOOLS.has(n));
  const tailText = lastText.trim().replace(/[\s*_`)\]]+$/, '');
  const asked = /\?$/.test(tailText);
  const goalMet = /\b(goal (is )?(met|complete|completed|achieved|reached)|all (the )?(steps|tasks|todos|items) (are )?(done|complete|finished)|nothing (left|more) to do|everything (is|in the plan is) (done|complete|finished))\b/i.test(lastText);
  return { progressed, denied, quotaRefused, errors, asked, goalMet, tools: tools.length, lastChange };
}

// Whether the Stop payload says the host will wake this session later: a helper
// or background command still running, or a scheduled prompt. The docs pages do
// not list `background_tasks` and `session_crons` (the SDK type file does), so
// a field that is absent is unknown, not empty: only a non-empty list counts.
export function workOut(input) {
  const listed = v => Array.isArray(v) && v.length > 0;
  return Boolean(input) && (listed(input.background_tasks) || listed(input.session_crons));
}

// Said on the continue that follows a helper refused for usage. Both limits are
// named because the one refusal covers either (guard-agent.mjs).
export const QUOTA_FACT = "helpers are refused while the plan's usage is past the helper line (the 5-hour window or the week); this session can still work";

// Continue, wait or stop, from the scan and the loop's own record. Pure: returns
// the next record rather than writing it. `goal` is already-resolved text (the
// bound run's Goal line, or '' when there is none) — this function does not
// read files. `outstanding` is true when the Stop payload lists work that will
// wake the session (see workOut); a step that did nothing then is a wait, not
// a stop.
export function persistDecision({ rec = {}, scan, contextNotice = '', contextAdvice = null, contextReading = null, goal = '', workCalls = null, next = null, outstanding = false }) {
  const steps = (Number(rec.steps) || 0) + 1;
  const seen = new Set(rec.errors || []);
  const repeat = scan.errors.find((e, i) => seen.has(e) || scan.errors.indexOf(e) !== i);
  const item = next && next.state === 'open' && next.text ? next.text : null;
  const sameItem = item && rec.lastItem === item ? (Number(rec.sameItem) || 0) + 1 : (item ? 1 : 0);
  const out = { ...rec, steps, errors: [...new Set([...(rec.errors || []), ...scan.errors])].slice(-20), lastItem: item, sameItem };
  const g = shortGoal(goal);
  const stop = why => ({ rec: out, kind: 'stop', why });

  if (contextAdvice && (contextAdvice.action === 'compact' || contextAdvice.action === 'investigate')) {
    return stop(checkpointFact(contextReading));
  }
  if (scan.denied) return stop('a dispatch was denied (budget or credential)');
  if (repeat) return stop(`the same error came back twice: ${repeat}`);
  if (scan.asked) return stop('the last message asks the user something');
  if (scan.goalMet) return stop('the last message says the goal is met');
  if (next && next.state === 'all-done') return stop(ALL_DONE_TEXT);
  if (sameItem > PERSIST_SAME_ITEM_CAP) return stop(`${PERSIST_SAME_ITEM_CAP} continues in a row named the same open item, and it is still open: ${item.length > 120 ? `${item.slice(0, 117)}...` : item}`);
  if (steps > PERSIST_STEP_CAP) return stop(`reached the limit of ${PERSIST_STEP_CAP} auto-continued steps in a row`);
  if (!scan.progressed) {
    // A helper or background command is still out, or a prompt is scheduled: the
    // host wakes this session when it lands, and a stop here would have turned
    // keep-going off before that. The Stop passes unblocked and the loop stays
    // armed. It is neither a continue (an idle turn re-reads the whole
    // conversation for nothing) nor a step, so the counters stand as they were.
    if (outstanding) return { rec: { ...out, steps: Number(rec.steps) || 0, lastItem: rec.lastItem ?? null, sameItem: Number(rec.sameItem) || 0 }, kind: 'wait', why: 'a helper or background command is still out' };
    return stop('the last step did no visible work (no edit, command or dispatch)');
  }

  const parts = [];
  if (g) parts.push(`"${g}"`);
  // The next open item replaces the bare step count: a count alone produced
  // filler steps. Without a run or a project page there is nothing to name,
  // so the count stays as the only fact.
  if (next && next.state === 'open' && next.text) parts.push(`next open item: ${next.text.length > 120 ? `${next.text.slice(0, 117)}...` : next.text}`);
  else parts.push(`step ${steps} of ${PERSIST_STEP_CAP}`);
  if (Number.isFinite(workCalls) && workCalls >= 100) parts.push(`${workCalls} work calls since your last dispatch`);
  if (scan.lastChange) parts.push(`last edited ${scan.lastChange}`);
  if (scan.quotaRefused) parts.push(QUOTA_FACT);
  let why = `orchestrate: ${parts.join(' · ')}`;
  if (contextNotice) why += ` ${contextNotice}`;
  return { rec: out, kind: 'continue', why };
}

// "No checkpoint since <time>; context N of M." The size and the epoch start
// are facts the lead cannot see from inside the conversation.
export function checkpointFact(reading, now = Date.now()) {
  const t = contextEpochStart(reading);
  const since = t != null ? new Date(t).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : 'this conversation began';
  const k = n => `~${Math.round(n / 1000)}k`;
  const used = reading && reading.tokens != null ? k(reading.tokens) : 'an unknown size';
  const at = reading && reading.tokens != null ? thresholds(reading).compactAt : null;
  const path = checkpointPath(reading && reading.session, reading);
  const n = Number(reading && reading.compactions) || 0;
  const compacted = n ? ` Compacted ${n} time${n === 1 ? "" : "s"} already; each summary drops detail.` : "";
  return `No checkpoint since ${since}; context ${used}${at ? ` of ${k(at)}` : ''}. Checkpoints for this conversation are saved at ${path}.${compacted}`;
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
    return { count: files.length, files: files.slice(0, 3), allFiles: files };
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

// Appended to every block reason: the block replaces nothing the lead has
// already said, but a headless caller's `result` is whatever the lead sends
// next, so a one-line reply to this block silently becomes the report the
// user gets (round-9 audit finding 2, live run 1). Under 60 B added.
const RESEND_NOTE = ' A reply to this block becomes the report the user sees.';

function commitClaimReason(claim, git, commitsSinceStart) {
  if (claim === 'not-committed') {
    const commitNote = commitsSinceStart ? ` and ${commitsSinceStart} commit${commitsSinceStart === 1 ? '' : 's'} since this session started` : '';
    return `Your last message says nothing is committed; git status shows a clean tree${commitNote}.${RESEND_NOTE}`;
  }
  const names = git.files.length ? `${git.files.join(', ')}${git.count > git.files.length ? ` and ${git.count - git.files.length} more` : ''}` : `${git.count} file${git.count === 1 ? '' : 's'}`;
  return `Your last message says the work is committed. Uncommitted: ${names}.${RESEND_NOTE}`;
}

// Checks the closing message's claim about `git commit` against what the
// repo actually shows. Independent of the auto-continue loop above — an
// ordinary Stop with no persist armed gets this too — and never blocks the
// same claim twice in one session (docs/audits/2026-09-27-live-runs-r6.md,
// docs/audits/2026-09-27-scoresheet-r6.md top-five item 1 and row 11).
function checkCommitClaim(input, state) {
  if (input.stop_hook_active || !input.cwd) return null;
  // The Stop payload's own last_assistant_message first: it is the closing
  // message itself, with no dependence on the transcript having been flushed.
  // The transcript tail is the fallback for a payload without it.
  let text = typeof input.last_assistant_message === 'string' ? input.last_assistant_message.trim() : '';
  if (!text) text = lastAssistantText(input.transcript_path ? readTail(input.transcript_path, PERSIST_SCAN_CAP) : '');
  if (!text) return null;
  const claim = classifyClaim(text);
  if (!claim || claim === 'mixed') return null;
  const git = gitPorcelain(input.cwd);
  if (!git) return null;
  const commitsSinceStart = commitsSince(input.cwd, state && state.startHead);
  if (!contradicts(claim, git.count, commitsSinceStart)) return null;
  // The message already names every file git status lists (by basename) — it
  // is consistent with the status it describes, whatever claim it also makes,
  // so nothing here contradicts it (round-9 audit finding 2, live run 1).
  if (namesAllPaths(text, git.allFiles)) return null;
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

// The goal shown in a block. Where the router took it from is stored beside it
// (goalSource), so the two never show different goals: one that came from the
// user's own words stays theirs, and only a ledger goal is re-read from the run.
export function persistGoal(p, bound) {
  const own = p && p.goal ? p.goal : '';
  if (p && (p.goalSource === 'prompt' || p.goalSource === 'none')) return own;
  return runGoalLine(bound) || own;
}

// What is open next, from the bound run and the project page; null when
// neither can be read.
function nextFor(state, input) {
  try {
    const run = state && state.run;
    let runText = '';
    if (run && run.runMd) { try { runText = readFileSync(run.runMd, 'utf8'); } catch {} }
    const root = (run && run.root) || input.cwd || null;
    const n = nextOpen(runText, root ? readProject(root) : null);
    return n.state === 'none' ? null : n;
  } catch { return null; }
}

export function check(input) {
  // A subagent's own Stop is not the lead's auto-continue loop — `agent_id`
  // on the payload (hooks doc, "common input fields") marks a call that fires
  // inside a subagent. Refusing a helper's own Stop with the lead's goal text
  // would be both wrong (the helper does not own that loop) and pure noise
  // read back into a context that did not ask for it.
  if (input && input.agent_id) return null;
  // A turn that ended normally is the end of any pause this session recorded at
  // StopFailure. This script already runs at every Stop, so it is the simplest
  // place to clear it; router.mjs does the same at every prompt.
  try { clearPause(pauseRoot(input.cwd), input.session_id, 'stop'); } catch {}
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
      return { rec: store[key], kind: 'continue', why: `orchestrate: ${checkpointFact({ ...ctx.reading, session: ctx.reading.session || input.session_id || null })} This Stop is refused once for it.` };
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
  const dec = persistDecision({ rec, scan: scanTurn(tail), contextNotice: ctx ? ctx.notice : '', contextAdvice: ctx ? ctx.advice : null, contextReading: ctx ? ctx.reading : null, goal: persistGoal(p, bound), workCalls, next: nextFor(state, input), outstanding: workOut(input) });
  if (dec.kind === 'continue' && ctx && ctx.notice) { try { markAnnounced(input.session_id || null, null, ctx.advice.key); if (ctx.tick) markTicked(input.session_id || null, null, ctx.tick); } catch {} }

  store[key] = { ...dec.rec, lastSize: size, checkedAt: new Date().toISOString() };
  try { writeJsonAtomic(path, store); } catch {}

  if (dec.kind === 'stop') {
    state.persist = { ...p, armed: false, endedAt: new Date().toISOString(), endReason: dec.why };
    try { saveSession(state); } catch {}
  }
  return dec;
}

// The StopFailure half: writes the pause record and nothing else. It writes for
// every error kind the host sends, since whether a subscription limit arrives
// as `rate_limit` is unchecked and the first real one should answer it. It does
// not read or change the keep-going state beyond asking whether it is on (for
// the record's wording), and a helper's own StopFailure writes nothing. Returns
// the record written, or null.
export function recordStopFailure(input, now = new Date()) {
  if (!input || input.agent_id) return null;
  const root = pauseRoot(input.cwd);
  if (!root) return null;
  const state = loadSession(input.session_id);
  const armed = Boolean(state && state.persist && state.persist.armed);
  const rec = pauseRecord({ error: input.error, session: input.session_id, now, armed });
  return writePause(root, rec, { create: false }) ? rec : null;
}

// What this Stop leaves for the band (lib/band.mjs, docs/band.md): work, a
// question waiting for the user, or nothing. Run after the hook has printed what
// it prints and decided what it decided, from `dec` as `check` returned it, so it
// can change neither. A helper's own Stop writes nothing. Never throws.
//   a Stop that was refused (the turn goes on)         working: the next open item, else the goal
//   a question the closing message ends on             needs: that question, armed or not
//   a Stop passed because a helper or command is out   working: waiting on it
//   anything else                                      idle
export function recordBandAtStop(input, dec, now = new Date()) {
  try {
    if (!input || input.agent_id) return null;
    const continued = Boolean(dec) && dec.kind === 'continue';
    const state = continued ? loadSession(input.session_id) : null;
    const note = bandAtStop({
      continued,
      question: continued ? null : stopQuestion(input),
      waiting: Boolean(dec) && dec.kind === 'wait',
      open: continued ? openItem(state, input.cwd) : '',
      goal: continued ? sessionGoal(state) : '',
    });
    return recordBand({ cwd: input.cwd, session: input.session_id, kind: note.kind, text: note.text, now });
  } catch { return null; }
}

function main() {
  let payload = '';
  try { payload = readFileSync(0, 'utf8'); } catch {}
  let input = null;
  try { input = JSON.parse(payload); } catch { return; }
  if (!input || typeof input !== 'object') return;
  // The host ignores a hook's output at StopFailure, so nothing is printed there.
  if (input.hook_event_name === 'StopFailure') { recordStopFailure(input); return; }
  // stop_hook_active is deliberately not an early exit here: a loop that keeps a
  // turn alive is exactly a Stop hook that fires again after its own block. The
  // step cap and the no-work stop are what end it.
  const dec = check(input);
  if (dec && dec.kind === 'continue') emitBlock(dec.why);
  else if (dec && dec.kind === 'stop' && dec.why) emitSystemMessage(endMessage(dec.why));
  recordBandAtStop(input, dec);
}

if (process.argv[1] && resolvePath(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch {}
  process.exit(0);
}
