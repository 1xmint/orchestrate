#!/usr/bin/env node
// ledger.mjs — a SubagentStop hook. It writes the run ledger so the model does
// not have to remember to.
//
// SubagentStop, not PostToolUse(Agent): a background dispatch returns as a task
// notification, and PostToolUse never fires for it. SubagentStop fires either
// way, and its payload carries the agent's own transcript, which is where the
// token usage lives.
//
// On every subagent stop:
//   1. save the full return to <run dir>/returns/NNN-<agent_type>.md;
//   2. sum the agent's usage from its transcript;
//   3. update the RUN.md row whose id matches the return's `TASK:` line —
//      phase 🔍 review for DONE, ◐ for PARTIAL, ⛔ for BLOCKED. Never ✅: only
//      the orchestrator marks a task done, and only on evidence it checked.
//
// It never blocks, never fails a stop, and prints `additionalContext` only when
// the return is missing the fields the orchestrator needs to grade it.

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { findRepoRoot, latestRun, readJson, loadSession, DIR } from './lib/tier.mjs';
import { dollars, family } from './lib/prices.mjs';

export const PHASE = { DONE: '🔍 review', PARTIAL: '◐ partial', BLOCKED: '⛔ blocked' };

// Lenient on purpose: an agent that got the shape almost right should still be
// recorded. Anything missing is reported, not corrected.
export function parseReturn(text) {
  const t = String(text || '');
  const field = re => { const m = re.exec(t); return m ? m[1].trim() : null; };
  const status = (field(/^\s*STATUS:\s*(DONE|PARTIAL|BLOCKED)\b/im) || '').toUpperCase() || null;
  const lines = t.trim() ? t.trim().split('\n').length : 0;
  const missing = [];
  const task = field(/^\s*TASK:\s*(\S+)/im);
  const restated = field(/^\s*RESTATED:\s*(.+)$/im);
  const evidence = /^\s*EVIDENCE:\s*\S/im.test(t);
  if (!task) missing.push('TASK');
  if (!restated) missing.push('RESTATED');
  if (!status) missing.push('STATUS');
  if (!evidence) missing.push('EVIDENCE');
  return {
    task, status, restated, evidence, lines,
    branch: field(/^\s*BRANCH:\s*(.+)$/im),
    changed: field(/^\s*CHANGED:\s*(.+)$/im),
    // `VERDICT: PASS` is the schema; a bare leading PASS/FAIL is what a reviewer
    // written to the older instruction produces, and is still read.
    verdict: (/^\s*VERDICT:\s*(PASS|FAIL)\b/im.exec(t) || /^\s*(PASS|FAIL)\b/m.exec(t) || [])[1] || null,
    missing, overLong: lines > 60,
  };
}

// Assistant records in a transcript carry `message.usage`. Sum the four fields
// that a subscription bills against; absent fields count as zero.
export function sumUsage(transcriptPath) {
  const totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, turns: 0 };
  try {
    if (!transcriptPath || !existsSync(transcriptPath)) return totals;
    for (const line of readFileSync(transcriptPath, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      let o; try { o = JSON.parse(line); } catch { continue; }
      const u = o && o.message && o.message.usage;
      if (!u) continue;
      totals.turns++;
      totals.input += Number(u.input_tokens) || 0;
      totals.output += Number(u.output_tokens) || 0;
      totals.cacheRead += Number(u.cache_read_input_tokens) || 0;
      totals.cacheWrite += Number(u.cache_creation_input_tokens) || 0;
    }
  } catch {}
  return totals;
}

// Every finished dispatch, priced, one line each. This is the only place a
// price becomes a measurement rather than a guess: the guard's tag before a
// dispatch is a forecast, and it reads its averages from this file.
//
// Capped at 500 lines. It is a rolling record of what things cost here, not an
// archive, and an unbounded append in a hook is a slow leak.
export const COSTS_PATH = join(DIR, 'costs.jsonl');
export const COSTS_MAX = 500;

export function costLine(role, model, usage) {
  const fam = family(model);
  return {
    at: new Date().toISOString(),
    role: String(role || 'claude'),
    model: fam,
    input: usage.input, output: usage.output, cacheRead: usage.cacheRead, cacheWrite: usage.cacheWrite,
    dollars: Number(dollars(usage, fam).toFixed(4)),
  };
}

export function appendCost(row, path = COSTS_PATH) {
  try {
    mkdirSync(DIR, { recursive: true });
    let lines = [];
    try { lines = readFileSync(path, 'utf8').split('\n').filter(Boolean); } catch {}
    lines.push(JSON.stringify(row));
    if (lines.length > COSTS_MAX) lines = lines.slice(-COSTS_MAX);
    writeFileSync(path, lines.join('\n') + '\n');
  } catch {}
  return row;
}

export function readCosts(path = COSTS_PATH) {
  try {
    return readFileSync(path, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}

export function formatUsage(u) {
  const k = n => (n >= 1000 ? `${Math.round(n / 100) / 10}k` : String(n));
  return `${k(u.input + u.cacheRead + u.cacheWrite)} in / ${k(u.output)} out, ${u.turns} turns`;
}

// Task ids are `M-D-NNNN`, but an agent can echo anything on the TASK line, so
// the id is escaped before it becomes part of a pattern.
const escapeId = id => String(id).replace(/[^A-Za-z0-9_-]/g, c => `\\${c}`);

// | id | phase | role · model | task | rubric | attempts | evidence |
//
// The three cells this hook owns are addressed from the ends, never by counting
// from the left. Task and rubric are free text written by a human or an agent,
// and one unescaped pipe in either shifts every later index: before this, a
// rubric of "exit 0 | 41 passed" put the attempt count into the rubric cell and
// left evidence empty, silently, on the row the orchestrator grades from.
const PHASE_COL = 2;        // id and phase come before any free text
const EVIDENCE_FROM_END = 2;
const ATTEMPTS_FROM_END = 3;

function rowCells(line) {
  const cols = line.split('|');
  return cols.length >= 9 ? cols : null;
}

export function updateRow(runMd, id, cells) {
  const lines = runMd.split('\n');
  const idRe = new RegExp(`^\\|\\s*${escapeId(id)}\\s*\\|`);
  for (let i = 0; i < lines.length; i++) {
    if (!idRe.test(lines[i])) continue;
    const cols = rowCells(lines[i]);
    if (!cols) continue;
    if (cells.phase) cols[PHASE_COL] = ` ${cells.phase} `;
    if (cells.attempts != null) cols[cols.length - ATTEMPTS_FROM_END] = ` ${cells.attempts} `;
    if (cells.evidence) cols[cols.length - EVIDENCE_FROM_END] = ` ${cells.evidence} `;
    lines[i] = cols.join('|');
    return lines.join('\n');
  }
  return null;
}

export function bumpAttempts(runMd, id) {
  const idRe = new RegExp(`^\\|\\s*${escapeId(id)}\\s*\\|`, 'm');
  const cols = rowCells(runMd.split('\n').find(l => idRe.test(l)) || '');
  const n = cols ? Number((cols[cols.length - ATTEMPTS_FROM_END] || '').trim()) : NaN;
  return Number.isFinite(n) ? n + 1 : 1;
}

// What the guard recorded for this task in the session state. Returns
// "opus (asked for fable)" when the guard moved it, the model alone otherwise,
// and null when there is nothing to say.
export function describeDispatch(d) {
  if (!d || !d.model) return null;
  return d.requested && d.requested !== d.model ? `${d.model} (asked for ${d.requested})` : d.model;
}

function dispatchedModel(sessionId, task) {
  try {
    const state = loadSession(sessionId);
    const list = (state && Array.isArray(state.dispatches) ? state.dispatches : []).filter(d => !task || d.task === task);
    return describeDispatch(list[list.length - 1]);
  } catch { return null; }
}

function nextReturnNumber(dir) {
  try {
    const n = readdirSync(dir).filter(f => /^\d{3}-/.test(f)).length;
    return String(n + 1).padStart(3, '0');
  } catch { return '001'; }
}

function emit(text) {
  if (text) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SubagentStop', additionalContext: text } }));
}

export const DEDUPE_MS = 10000;

// True when this exact stop was already recorded, by this hook, a moment ago.
// Keyed on the return itself, so a genuine retry minutes later still counts.
// Any failure here answers false: a duplicate row is better than a lost one.
export function isRepeat(prev, sig, now, windowMs = DEDUPE_MS) {
  return Boolean(prev && prev.sig === sig && now - Number(prev.ts) < windowMs);
}

function alreadyHandled(input, agent, text) {
  try {
    const sig = createHash('sha256').update(`${input.session_id || ''}|${agent}|${text}`).digest('hex').slice(0, 32);
    const path = join(DIR, 'last-return.json');
    const now = Date.now();
    if (isRepeat(readJson(path), sig, now)) return true;
    mkdirSync(DIR, { recursive: true });
    writeFileSync(path, JSON.stringify({ sig, ts: now }) + '\n');
  } catch {}
  return false;
}

function main() {
  let payload = '';
  try { payload = readFileSync(0, 'utf8'); } catch {}
  let input = null;
  try { input = JSON.parse(payload); } catch { return; }
  if (!input || typeof input !== 'object') return;

  const text = String(input.last_assistant_message || '');
  if (!text.trim()) return;

  // Only a subagent's stop is a return, and only `agent_type` proves it is one.
  // `agent_id` does not: stops that are not subagent returns arrive carrying an
  // id and no type, and accepting those filed twenty-one of the orchestrator's
  // own messages under returns/ in one session, each one also posting a "grade
  // this Failed" note back into the conversation. An unnamed return is not a
  // return.
  const agentType = input.agent_type || input.subagent_type;
  if (!agentType) return;
  const agent = String(agentType).replace(/[^A-Za-z0-9_-]/g, '_');

  // The recommended install registers this hook twice: once globally in
  // settings.json, and once from SKILL.md's frontmatter while the skill is in
  // play. Both fire on the same stop. Without this, one dispatch writes two
  // return files and counts as two attempts. Same payload within ten seconds
  // is the same stop: act once.
  if (alreadyHandled(input, agent, text)) return;
  const r = parseReturn(text);
  const usage = sumUsage(input.agent_transcript_path);
  const ranModel = dispatchedModel(input.session_id, r.task) || agent;
  const cost = appendCost(costLine(agent, ranModel, usage));

  const root = findRepoRoot(input.cwd) || input.cwd || process.cwd();
  const run = latestRun(root);
  const notes = [];

  if (run) {
    try {
      const returnsDir = join(run.dir, 'returns');
      mkdirSync(returnsDir, { recursive: true });
      const file = join(returnsDir, `${nextReturnNumber(returnsDir)}-${agent}.md`);
      const header = `<!-- ${new Date().toISOString()} · ${agent} · ${formatUsage(usage)} · ${r.lines} lines -->\n\n`;
      writeFileSync(file, header + text + (text.endsWith('\n') ? '' : '\n'));
      notes.push(`return saved to ${file}`);

      if (r.task) {
        const md = readFileSync(run.runMd, 'utf8');
        const phase = PHASE[r.status] || '🔍 review';
        // The model the guard actually dispatched on, which is not always the
        // one the packet named: past the daily cap the guard rewrites fable to
        // opus, and the agent's own return still echoes the packet.
        const ran = dispatchedModel(input.session_id, r.task);
        const evidence = `${r.verdict ? `${r.verdict} · ` : ''}${ran ? `${ran} · ` : ''}${formatUsage(usage)} · $${cost.dollars.toFixed(2)} · returns/${file.split(/[\\/]/).pop()}`;
        const next = updateRow(md, r.task, { phase, attempts: bumpAttempts(md, r.task), evidence });
        if (next) { writeFileSync(run.runMd, next); notes.push(`RUN.md row ${r.task} → ${phase}`); }
        else notes.push(`no RUN.md row for ${r.task}: write the row before the next dispatch`);
      }
    } catch {}
  }

  const problems = [];
  if (r.missing.length) problems.push(`the return is missing ${r.missing.join(', ')}`);
  if (r.overLong) problems.push(`the return is ${r.lines} lines (the cap is 40)`);
  if (!r.task) problems.push('no TASK line, so no ledger row could be keyed');

  if (problems.length) {
    emit(`orchestrate ledger: ${problems.join('; ')}. Grade this return Failed or re-dispatch with the schema restated; do not mark the task done on it. ${notes.join('. ')}`);
  } else if (notes.length && r.status !== 'DONE') {
    emit(`orchestrate ledger: ${notes.join('. ')}. STATUS ${r.status}: decide retry, escalate or ask before moving on.`);
  }
}

// Only when run as a hook, not when a test imports the pure functions above.
if (process.argv[1] && resolvePath(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch {}
  process.exit(0);
}
