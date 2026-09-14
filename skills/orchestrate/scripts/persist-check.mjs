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
import { join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DIR, readJson, writeJsonAtomic, sanitizeId, loadSession, saveSession, readTail } from './lib/tier.mjs';
import { readQuota, resetClock, PERSIST_STOP_FIVE_HOUR } from './lib/quota.mjs';
import { sampleContext, markAnnounced, markTicked, checkpointPath, contextEpoch, hasCheckpoint, thresholds, switchAdvice } from './lib/context.mjs';

// Blunt caps, because no published diminishing-returns rule exists
// (docs/research/0004 (b)). The check-in is a line for the human to glance at,
// not a model judging a model (deleted once as "certain cost, zero benefit",
// STATE.md v0.8.0). Context size is not judged here: transcript bytes survive
// compaction, so a byte threshold kept warning about a conversation that had
// already been compacted. The shared reader (lib/context.mjs) decides, and its
// notice rides along only when its advice changes.
export const PERSIST_STEP_CAP = 25;
export const PERSIST_CHECKIN_EVERY = 6;
export const PERSIST_SCAN_CAP = 262144;

const WORK_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit', 'Bash', 'PowerShell', 'Agent', 'Task']);

export const shortGoal = g => { const s = String(g || '').replace(/\s+/g, ' ').trim(); return s.length > 80 ? `${s.slice(0, 77)}...` : s; };

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
  for (const line of String(tail || '').split('\n')) {
    if (!line.trim()) continue;
    let rec;
    try { rec = JSON.parse(line); } catch { continue; }
    const msg = rec && rec.message;
    const content = msg && Array.isArray(msg.content) ? msg.content : null;
    if (rec.type === 'assistant' && content) {
      for (const b of content) {
        if (b && b.type === 'tool_use' && b.name) tools.push(b.name);
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
  return { progressed, denied, errors, asked, goalMet, tools: tools.length };
}

// Continue or stop, from the scan and the loop's own record. Pure: returns the
// next record rather than writing it.
export function persistDecision({ rec = {}, scan, contextNotice = '', contextAdvice = null, contextReading = null, goal = '', quota = null }) {
  const steps = (Number(rec.steps) || 0) + 1;
  const seen = new Set(rec.errors || []);
  const repeat = scan.errors.find((e, i) => seen.has(e) || scan.errors.indexOf(e) !== i);
  const out = { ...rec, steps, errors: [...new Set([...(rec.errors || []), ...scan.errors])].slice(-20) };
  const g = shortGoal(goal);
  const stop = why => ({ rec: out, kind: 'stop', why });

  if (contextAdvice && (contextAdvice.action === 'compact' || contextAdvice.action === 'investigate' || contextAdvice.action === 'hard')) {
    const path = checkpointPath(contextReading && contextReading.session, contextReading);
    const n = contextReading && contextReading.tokens != null ? `~${Math.round(contextReading.tokens / 1000)}k` : 'high';
    return stop(`context is ${n}: write the checkpoint at ${path}, then ${switchAdvice(contextReading, contextAdvice)}`);
  }
  if (quota && quota.fiveHour && quota.fiveHour.pct >= PERSIST_STOP_FIVE_HOUR) return stop(`the 5-hour usage window is at ${Math.round(quota.fiveHour.pct)}% (resets ${resetClock(quota.fiveHour.resetsAt)})`);
  if (scan.denied) return stop('a dispatch was denied (budget, credential or usage limit)');
  if (repeat) return stop(`the same error came back twice: ${repeat}`);
  if (scan.asked) return stop('the last message asks the user something');
  if (scan.goalMet) return stop('the last message says the goal is met');
  if (steps > PERSIST_STEP_CAP) return stop(`${PERSIST_STEP_CAP} auto-continued steps`);
  if (!scan.progressed) return stop('the last step did no visible work (no edit, command or dispatch)');

  let why = `orchestrate: still working toward "${g}". The last step did real work and nothing says it is finished or blocked, so do the next step now instead of ending the turn. Name the step as you start it. If you are waiting on CI, a build or a background agent, watch it with Monitor and do other independent work meanwhile; the result wakes you, so there is nothing to sit and wait for. If the goal is met, say so plainly; if you need a decision from the user, ask it — either one ends this loop.`;
  if (steps % PERSIST_CHECKIN_EVERY === 0) why += ` Check-in (step ${steps} of at most ${PERSIST_STEP_CAP}): in one line, tell the user what the last few steps did, so they can catch drift from the goal. They can say "persist off" to stop this.`;
  if (contextNotice) why += ` ${contextNotice}`;
  return { rec: out, kind: 'continue', why };
}

const STORE = () => join(DIR, 'persist-checks.json');

function emitBlock(reason) {
  process.stdout.write(JSON.stringify({ decision: 'block', reason }));
}

export function check(input) {
  const state = loadSession(input.session_id);
  const p = state && state.persist;

  const path = STORE();
  const store = readJson(path) || {};
  const key = sanitizeId(input.session_id || 'nosession');
  let ctx = null;
  try { ctx = input.transcript_path ? sampleContext({ transcriptPath: input.transcript_path, session: input.session_id || null, announce: false }) : null; } catch { ctx = null; }
  // This is deliberately outside auto-continue: reaching the compaction line
  // is unsafe even for an ordinary Stop. A block is once per epoch, and an
  // active Stop hook must not block itself again.
  if ((!p || !p.armed) && !input.stop_hook_active && ctx && ctx.reading && ctx.reading.tokens != null) {
    const epoch = contextEpoch(ctx.reading);
    const rec = store[key] || {};
    const at = thresholds(ctx.reading).compactAt;
    if (ctx.reading.tokens >= at && !hasCheckpoint(input.session_id || null, ctx.reading) && rec.contextBlockedFor !== epoch) {
      store[key] = { ...rec, contextBlockedFor: epoch, checkedAt: new Date().toISOString() };
      try { writeJsonAtomic(path, store); } catch {}
      return { rec: store[key], kind: 'continue', why: `orchestrate: context is ~${Math.round(ctx.reading.tokens / 1000)}k: write the checkpoint at ${checkpointPath(input.session_id || null, ctx.reading)}, then ${switchAdvice(ctx.reading, ctx.advice)}` };
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
  const dec = persistDecision({ rec, scan: scanTurn(tail), contextNotice: ctx ? ctx.notice : '', contextAdvice: ctx ? ctx.advice : null, contextReading: ctx ? ctx.reading : null, goal: p.goal, quota: readQuota() });
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
}

if (process.argv[1] && resolvePath(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch {}
  process.exit(0);
}
