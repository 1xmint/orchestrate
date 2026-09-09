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
import { findRepoRoot, latestRun, readJson } from './lib/tier.mjs';

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
    verdict: /^\s*(PASS|FAIL)\b/m.test(t) ? (/^\s*(PASS|FAIL)\b/m.exec(t)[1]) : null,
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

export function formatUsage(u) {
  const k = n => (n >= 1000 ? `${Math.round(n / 100) / 10}k` : String(n));
  return `${k(u.input + u.cacheRead + u.cacheWrite)} in / ${k(u.output)} out, ${u.turns} turns`;
}

// Task ids are `M-D-NNNN`, but an agent can echo anything on the TASK line, so
// the id is escaped before it becomes part of a pattern.
const escapeId = id => String(id).replace(/[^A-Za-z0-9_-]/g, c => `\\${c}`);

// Replace the row whose second column-ish id matches, keeping every other row
// and the rest of the file byte-for-byte. Returns the new text, or null when no
// row matched (the caller then appends).
export function updateRow(runMd, id, cells) {
  const lines = runMd.split('\n');
  const idRe = new RegExp(`^\\|\\s*${escapeId(id)}\\s*\\|`);
  for (let i = 0; i < lines.length; i++) {
    if (!idRe.test(lines[i])) continue;
    const cols = lines[i].split('|');
    // | id | phase | role · model | task | rubric | attempts | evidence |
    if (cols.length >= 9) {
      if (cells.phase) cols[2] = ` ${cells.phase} `;
      if (cells.attempts != null) cols[6] = ` ${cells.attempts} `;
      if (cells.evidence) cols[7] = ` ${cells.evidence} `;
      lines[i] = cols.join('|');
      return lines.join('\n');
    }
  }
  return null;
}

export function bumpAttempts(runMd, id) {
  const idRe = new RegExp(`^\\|\\s*${escapeId(id)}\\s*\\|`, 'm');
  const line = (runMd.split('\n').find(l => idRe.test(l)) || '');
  const cols = line.split('|');
  const n = Number((cols[6] || '').trim());
  return Number.isFinite(n) ? n + 1 : 1;
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

function main() {
  let payload = '';
  try { payload = readFileSync(0, 'utf8'); } catch {}
  let input = null;
  try { input = JSON.parse(payload); } catch { return; }
  if (!input || typeof input !== 'object') return;

  const text = String(input.last_assistant_message || '');
  if (!text.trim()) return;
  const agent = String(input.agent_type || input.subagent_type || 'agent').replace(/[^A-Za-z0-9_-]/g, '_');
  const r = parseReturn(text);
  const usage = sumUsage(input.agent_transcript_path);

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
        const evidence = `${r.verdict ? `${r.verdict} · ` : ''}${formatUsage(usage)} · returns/${file.split(/[\\/]/).pop()}`;
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
