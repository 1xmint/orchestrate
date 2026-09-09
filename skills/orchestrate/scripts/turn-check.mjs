#!/usr/bin/env node
// turn-check.mjs — the session's Stop hook, registered from SKILL.md's
// frontmatter so it is live only while the skill is in play.
//
// Two rules now, both deterministic. No model call, no judgment.
//
//   1. THE FLOOR. A recommendation that spans a set of cases, answered from
//      fewer than two sources, with a recommendation in the reply. This is the
//      one shape a reply-reading evaluator cannot catch: a confident table with
//      a Sources line naming pages that were never fetched looks, from the
//      reply alone, exactly like a well-sourced answer. Only the transcript
//      shows how many sources were actually read.
//   2. THE PICKUP. A run whose Pickup section is older than the last dispatch
//      cannot be resumed. If this session ends there, the next one starts blind.
//
// The floor runs first, and deliberately before the "is there an open run"
// guard: the failure it exists for was a question with no run and no dispatch,
// which every earlier guard returned on.
//
// Offline modes, which spend nothing and write nothing:
//   node turn-check.mjs --replay <transcript.jsonl>   what the floor would have fired on
//   node turn-check.mjs --replay-week                 the same across the last 7 days

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DIR, readJson, writeJsonAtomic, sanitizeId, findRepoRoot, latestRun, loadSession, readTail } from './lib/tier.mjs';
import { analyze } from './router.mjs';

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

// Hash comparison, not timestamps: a clock is not a fact here (the ledger
// rewrites RUN.md, and a dispatch time and a file write are not comparable).
// `prev` is what this hook recorded the last time it ran for this run.
//   no dispatch this session                     -> quiet, there is nothing to record
//   the Pickup is still the template placeholder -> block, it was never written
//   the hash changed since the last check        -> quiet, the orchestrator wrote it
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

// ---- the floor --------------------------------------------------------------

// A reply that recommends. Either a markdown table row, which is how a
// recommendation across a set of cases almost always arrives, or one of the
// words that make a claim about what someone should do.
const RECOMMENDS = /\b(recommend|recommended|should|never|nobody should|always)\b/i;

export function hasRecommendation(reply) {
  const t = String(reply || '');
  if (RECOMMENDS.test(t)) return true;
  return t.split('\n').some(l => { const s = l.trim(); return s.length > 2 && s.startsWith('|') && s.endsWith('|'); });
}

// Pure, so the shape of the rule is testable without a transcript or a child
// process. `sourceCalls` is a count of distinct source-reading calls in the
// turn; `prev` is what this hook already recorded for this question.
export function floorDecision({ text, sourceCalls, reply, prev = {} }) {
  const f = analyze(text || '');
  // Measured before it shipped. `research && setShape` alone fired 5.57 times a
  // day on Josh's last week, almost all of it on pasted plans and handoff
  // documents: long text that happens to contain "recommended" and "for each",
  // answered with a "should". Three narrowings, each with a reason:
  //   - it must be a question. The failure this exists for was a question; a
  //     pasted plan is an instruction, and instructing is not answering.
  //   - it must not be a paste, and must be short enough to be someone asking
  //     rather than someone briefing.
  //   - a task notification is the host talking, not the user.
  // Together they take it to 0.14 a day and the 0003 case still fires.
  if (!f.question || f.paste || f.words > 60) return { block: false, why: 'not a question' };
  if (/^\s*<(task-notification|system-reminder|local-command)/.test(String(text || ''))) {
    return { block: false, why: 'the host talking, not the user' };
  }
  // The same test the router's rung 3.6 uses, so the hint and the floor cannot
  // disagree about what a set-shaped recommendation is. A judgment word counts
  // as well as a research word: "which model should we use for each tier?"
  // carries no research word and is exactly this shape.
  if (!(f.research || f.judgment) || !f.setShape) return { block: false, why: 'not a recommendation across a set of cases' };
  if (Number(sourceCalls) >= 2) return { block: false, why: `answered from ${sourceCalls} sources` };
  if (!hasRecommendation(reply)) return { block: false, why: 'the reply recommends nothing' };
  if (prev.blocked) return { block: false, why: 'already blocked once for this question' };
  return { block: true, why: `answered from ${Number(sourceCalls) || 0} source(s)` };
}

export function floorReason(sourceCalls) {
  return `orchestrate: a recommendation across a set of cases, answered from ${Number(sourceCalls) || 0} source(s). Dispatch orch-researcher, or rewrite the answer to name the one source that settles it and say in one line what it does not settle.`;
}

const SOURCE_TOOLS = new Set(['WebFetch', 'WebSearch']);

// Does one tool_use block count as having gone and looked something up?
function sourceKey(b) {
  const i = (b && b.input) || {};
  if (SOURCE_TOOLS.has(b.name)) return `${b.name}:${i.url || i.query || ''}`;
  if (b.name === 'Agent' && String(i.subagent_type || '') === 'orch-researcher') return `researcher:${String(i.prompt || '').slice(0, 60)}`;
  if (b.name === 'Read' && /(docs|references)[\\/]/i.test(String(i.file_path || ''))) return `read:${i.file_path}`;
  return null;
}

function parseLines(text) {
  const out = [];
  for (const line of String(text || '').split('\n')) {
    const s = line.trim();
    if (!s || s[0] !== '{') continue;
    try { out.push(JSON.parse(s)); } catch {}
  }
  return out;
}

// The user's own words in a record, or null. A tool result is not the user
// talking, and neither is a hook's injected context; a queued command is,
// because a message typed mid-turn is still the user asking.
export function humanText(o) {
  if (!o || typeof o !== 'object') return null;
  const a = o.attachment;
  if (a && typeof a === 'object') {
    // Observed shape, 2026-09-09: { type: "queued_command", prompt, origin,
    // commandMode, timestamp, source_uuid }. The other names are defensive.
    if (a.type === 'queued_command') {
      const v = a.prompt || a.command || a.promptText || a.text;
      return typeof v === 'string' ? v : null;
    }
    return null;
  }
  if (o.type !== 'user') return null;
  const c = o.message && o.message.content;
  if (typeof c === 'string') return c;
  if (!Array.isArray(c)) return null;
  if (c.some(b => b && b.type === 'tool_result')) return null;
  const parts = c.filter(b => b && b.type === 'text' && typeof b.text === 'string').map(b => b.text);
  return parts.length ? parts.join('\n') : null;
}

// The latest human message in a stretch of transcript, and how many distinct
// sources were read after it. `reply` completes the picture but comes from the
// hook payload, not from here.
export function turnFacts(tailText) {
  const records = parseLines(tailText);
  let at = -1;
  for (let i = records.length - 1; i >= 0; i--) {
    if (humanText(records[i]) != null) { at = i; break; }
  }
  if (at < 0) return { text: null, sourceCalls: 0 };
  const keys = new Set();
  for (let i = at + 1; i < records.length; i++) {
    const o = records[i];
    if (o.type !== 'assistant') continue;
    const content = o.message && o.message.content;
    for (const b of Array.isArray(content) ? content : []) {
      if (!b || b.type !== 'tool_use') continue;
      const k = sourceKey(b);
      if (k) keys.add(k);
    }
  }
  return { text: humanText(records[at]), sourceCalls: keys.size };
}

// ---- replay -----------------------------------------------------------------
// Measured before it ships: a check nobody can predict is worse than no check.
// This walks whole transcripts and reports every turn the floor would have
// fired on, without writing to the store and without blocking anything.

export function replayFile(text) {
  const records = parseLines(text);
  const turns = [];
  let current = null;
  const flush = () => { if (current && current.text) turns.push(current); };
  for (const o of records) {
    const h = humanText(o);
    if (h != null) { flush(); current = { text: h, keys: new Set(), reply: '' }; continue; }
    if (!current || o.type !== 'assistant') continue;
    const content = o.message && o.message.content;
    for (const b of Array.isArray(content) ? content : []) {
      if (b && b.type === 'tool_use') { const k = sourceKey(b); if (k) current.keys.add(k); }
      if (b && b.type === 'text' && typeof b.text === 'string') current.reply = b.text;
    }
  }
  flush();
  return turns
    .map(t => ({ text: t.text, d: floorDecision({ text: t.text, sourceCalls: t.keys.size, reply: t.reply }) }))
    .filter(x => x.d.block)
    .map(x => ({ prompt: x.text.replace(/\s+/g, ' ').slice(0, 80), why: x.d.why }));
}

function transcriptsSince(days) {
  const base = join(homedir(), '.claude', 'projects');
  const cutoff = Date.now() - days * 86400000;
  const out = [];
  let dirs = [];
  try { dirs = readdirSync(base).map(n => join(base, n)); } catch { return out; }
  for (const d of dirs) {
    let names = [];
    try { if (!statSync(d).isDirectory()) continue; names = readdirSync(d); } catch { continue; }
    for (const n of names) {
      if (!n.endsWith('.jsonl')) continue;
      const p = join(d, n);
      try { if (statSync(p).mtimeMs >= cutoff) out.push(p); } catch {}
    }
  }
  return out;
}

function replay(paths, days) {
  let total = 0;
  for (const p of paths) {
    let hits = [];
    try { hits = replayFile(readFileSync(p, 'utf8')); } catch { continue; }
    if (!hits.length) continue;
    console.log(`${p}: ${hits.length}`);
    for (const h of hits) console.log(`  ${h.why} — "${h.prompt}"`);
    total += hits.length;
  }
  console.log(`floor would have fired ${total} time(s) across ${paths.length} transcript(s)${days ? ` over ${days} days` : ''}`);
  if (days) console.log(`that is ${(total / days).toFixed(2)} a day; ship it only under one a day`);
}

// ---- the hook ---------------------------------------------------------------
function emitBlock(reason) {
  process.stdout.write(JSON.stringify({
    decision: 'block',
    reason,
    hookSpecificOutput: { hookEventName: 'Stop', decision: 'block', reason },
  }));
}

const STORE = () => join(DIR, 'turn-checks.json');

function checkFloor(input) {
  if (!input.transcript_path || !existsSync(input.transcript_path)) return false;
  const { text, sourceCalls } = turnFacts(readTail(input.transcript_path, 65536));
  if (!text) return false;

  // Keyed on the question, in its own namespace. The Pickup rule keys on
  // session and run; if the two shared a key they would clear each other and
  // whichever ran second would never fire.
  const key = `floor:${createHash('sha256').update(`${input.session_id || ''}${text}`).digest('hex').slice(0, 16)}`;
  const path = STORE();
  const store = readJson(path) || {};
  const prev = store[sanitizeId(key)] || {};

  const d = floorDecision({ text, sourceCalls, reply: input.last_assistant_message, prev });
  if (!d.block) return false;

  store[sanitizeId(key)] = { blocked: true, at: new Date().toISOString() };
  try { writeJsonAtomic(path, store); } catch {}
  emitBlock(floorReason(sourceCalls));
  return true;
}

function checkPickup(input) {
  const root = findRepoRoot(input.cwd) || input.cwd;
  const run = latestRun(root);
  if (!run || !run.open) return;

  const state = loadSession(input.session_id) || {};
  const lastDispatchAt = state.lastDispatchAt || null;
  if (!lastDispatchAt) return;

  const text = readFileSync(run.runMd, 'utf8');
  const hash = pickupHash(text);
  const section = pickupSection(text);

  const path = STORE();
  const store = readJson(path) || {};
  const key = sanitizeId(`${input.session_id || 'nosession'}-${run.runId}`);
  const rec = store[key] || {};

  const d = shouldBlock({ pickupHash: hash, section, lastDispatchAt, prev: rec });
  store[key] = { ...rec, hash, checkedAt: new Date().toISOString() };

  if (!d.block) { try { writeJsonAtomic(path, store); } catch {} return; }

  store[key].blockedFor = hash;
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

  try { if (checkFloor(input)) return; } catch {}
  checkPickup(input);
}

// Only when run as a hook, not when a test imports the pure functions above.
if (process.argv[1] && resolvePath(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  try {
    if (args[0] === '--replay' && args[1]) replay([args[1]], 0);
    else if (args[0] === '--replay-week') replay(transcriptsSince(7), 7);
    else main();
  } catch {}
  process.exit(0);
}
