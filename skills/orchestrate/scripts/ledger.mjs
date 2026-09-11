#!/usr/bin/env node
// ledger.mjs — a SubagentStop hook. It saves what a subagent returned, prices
// it, and records which run and task it belongs to, so nothing is lost when a
// session ends between a return and the lead reading it.
//
// SubagentStop, not PostToolUse(Agent): a background dispatch returns as a task
// notification, and PostToolUse never fires for it. SubagentStop fires either
// way, and its payload carries the agent's own transcript, which is where the
// token usage lives.
//
// On every subagent stop:
//   1. save the full return under the run's returns/ folder, under a name
//      derived from the agent and the event rather than from a file count;
//   2. sum the agent's usage from its transcript and price it at list price;
//   3. append the association (run, task, agent, model, file) to an index.
//
// It does NOT edit the RUN.md task rows any more. Two returns landing together
// each read the whole file, changed one row and wrote it back, so the second
// write erased the first one's row. The lead updates the row when it consumes
// the return, which is also the only moment anyone has actually graded it.
//
// It never blocks and never fails a stop.

import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { DIR, sanitizeId, loadSession, resolveRun, runsUnder, findRepoRoot, seenRecently, recordSeen, trimLog } from './lib/tier.mjs';
import { dollars, family } from './lib/prices.mjs';

// Lenient on purpose, and it stays lenient: a return that got the shape almost
// right is still the work. Anything absent is reported as absent, never
// corrected and never sent back to be rewritten.
export function parseReturn(text) {
  const t = String(text || '');
  const field = re => { const m = re.exec(t); return m ? m[1].trim() : null; };
  const status = (field(/^\s*STATUS:\s*(DONE|PARTIAL|BLOCKED)\b/im) || '').toUpperCase() || null;
  const lines = t.trim() ? t.trim().split('\n').length : 0;
  return {
    task: field(/^\s*TASK:\s*(\S+)/im),
    run: field(/^\s*RUN:\s*(\S+)/im),
    status,
    evidence: /^\s*EVIDENCE:\s*\S/im.test(t),
    lines,
    branch: field(/^\s*BRANCH:\s*(.+)$/im),
    changed: field(/^\s*CHANGED:\s*(.+)$/im),
    // `VERDICT: PASS` is the schema; a bare leading PASS/FAIL is what older
    // reviewer instructions produced, and is still read.
    verdict: (/^\s*VERDICT:\s*(PASS|FAIL)\b/im.exec(t) || /^\s*(PASS|FAIL)\b/m.exec(t) || [])[1] || null,
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

// Every finished dispatch, priced, one line each, at list price. A model nobody
// named stays unpriced rather than being quietly priced as the cheap one.
//
// Capped at 500 lines. It is a rolling record of what things cost here, not an
// archive, and an unbounded append in a hook is a slow leak.
export const COSTS_PATH = join(DIR, 'costs.jsonl');
export const COSTS_MAX = 500;

export function costLine(role, model, usage) {
  const fam = family(model);
  const d = dollars(usage, model);
  return {
    at: new Date().toISOString(),
    role: String(role || 'claude'),
    model: fam || String(model || 'unknown'),
    priced: Boolean(fam),
    input: usage.input, output: usage.output, cacheRead: usage.cacheRead, cacheWrite: usage.cacheWrite,
    dollars: d == null ? null : Number(d.toFixed(4)),
  };
}

// R1: this used to read the whole file, push one line, and write the whole
// file back. Two returns landing together each read the same starting
// content, so whichever wrote second silently discarded the first's cost
// line — the read-all/write-all shape the index beside it (`appendIndex`)
// already avoided. `appendFileSync` is one line, not a read-modify-write, so
// a concurrent writer can only ever add its own line. Trimming to `COSTS_MAX`
// is still a read-modify-write, so it runs rarely rather than on every call:
// losing that race only delays a trim, never a cost line.
export function appendCost(row, path = COSTS_PATH) {
  try {
    mkdirSync(DIR, { recursive: true });
    appendFileSync(path, JSON.stringify(row) + '\n');
    if (Math.random() < 0.02) trimLog(path, COSTS_MAX);
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

// The model the guard recorded for this task in this session, and nothing else.
// `inherit` means the packet named no model; it is reported as inherited rather
// than resolved to a guess.
export function describeDispatch(d) {
  if (!d || !d.model) return null;
  return d.model === 'inherit' ? 'inherited model' : d.model;
}

function dispatchFor(sessionId, task) {
  try {
    const state = loadSession(sessionId);
    const list = (state && Array.isArray(state.dispatches) ? state.dispatches : []).filter(d => !task || d.task === task);
    return list[list.length - 1] || null;
  } catch { return null; }
}

// A name that is unique per return and stable for one event, derived from who
// returned and which invocation it was. Counting the files in the directory
// gave two concurrent returns the same number, and the second overwrote the
// first.
export function returnFilename(agent, input, text) {
  const who = input && (input.agent_id || input.tool_use_id);
  const id = who
    ? sanitizeId(String(who)).slice(-12)
    : createHash('sha256').update(`${input && input.session_id}|${agent}|${text}`).digest('hex').slice(0, 12);
  return `${agent}-${id}.md`;
}

// Which run this return belongs to: the RUN line the packet gave it, then the
// run recorded against this task at dispatch, then whatever this session is
// bound to or the one unambiguous open run in the repo. Never "the newest run
// on the machine": that is how one repository's return was filed into another
// repository's ledger.
export function resolveReturnRun(input, parsed, dispatch) {
  const root = findRepoRoot(input.cwd) || input.cwd || process.cwd();
  const named = parsed.run || (dispatch && dispatch.run) || null;
  if (named) {
    const hit = runsUnder(root).find(r => r.runId === named);
    if (hit) return { run: hit, how: 'named in the packet' };
    const bound = resolveRun(input.session_id, input.cwd, { forWrite: true });
    if (bound.run && bound.run.runId === named) return { run: bound.run, how: 'named in the packet' };
  }
  const r = resolveRun(input.session_id, input.cwd, { forWrite: true });
  return { run: r.run, how: r.how, candidates: r.candidates };
}

// Where a return goes when no run owns it. Losing it is not an option, and
// guessing a destination is what this release removed, so it is kept per
// session and the note says where.
export function orphanDir(sessionId) {
  return join(DIR, 'returns', sanitizeId(sessionId || 'nosession'));
}

export const INDEX_NAME = 'returns.jsonl';

// The association, appended as one line. Append-only, so two hooks finishing at
// the same moment cannot erase each other the way two RUN.md rewrites did.
export function indexLine(rec) {
  return JSON.stringify(rec);
}

function appendIndex(dir, rec) {
  try {
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, INDEX_NAME), indexLine(rec) + '\n');
  } catch {}
}

function emit(text) {
  if (text) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SubagentStop', additionalContext: text } }));
}

export const DEDUPE_MS = 10000;
export const SEEN_RETURNS_PATH = join(DIR, 'returns-seen.jsonl');
export const SEEN_RETURNS_MAX = 400;

// True when this exact stop was already recorded, by this hook, a moment ago.
// Keyed on the return itself, so a genuine retry minutes later still counts.
// Any failure here answers false: a duplicate row is better than a lost one.
//
// One global {sig, ts} slot used to serve this job: a return recorded here,
// and another return landing in between, overwrote the slot before the first
// could be checked, so a genuine duplicate stop for the first could pass and
// get filed twice — double-counted in costs.jsonl and returns.jsonl, which is
// exactly what the spend gate reads to decide whether a run is still under its
// budget. Up to 20 concurrent subagents finishing near together is a
// documented, ordinary case here, so this is an append-only log rather than a
// read-modify-write store: a concurrent stop only ever adds its own line.
function alreadyHandled(input, agent, text) {
  try {
    const sig = createHash('sha256').update(`${input.session_id || ''}|${agent}|${text}`).digest('hex').slice(0, 32);
    const now = Date.now();
    const seen = seenRecently(SEEN_RETURNS_PATH, sig, now, DEDUPE_MS);
    recordSeen(SEEN_RETURNS_PATH, sig, now);
    if (Math.random() < 0.02) trimLog(SEEN_RETURNS_PATH, SEEN_RETURNS_MAX);
    return seen;
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
  // id and no type, and accepting those filed twenty-one of the lead's own
  // messages under returns/ in one session. An unnamed return is not a return.
  const agentType = input.agent_type || input.subagent_type;
  if (!agentType) return;
  const agent = String(agentType).replace(/[^A-Za-z0-9_-]/g, '_');

  // The recommended install registers this hook twice: once globally in
  // settings.json, and once from SKILL.md's frontmatter while the skill is in
  // play. Both fire on the same stop. Act once.
  if (alreadyHandled(input, agent, text)) return;

  const r = parseReturn(text);
  const usage = sumUsage(input.agent_transcript_path);
  const dispatch = dispatchFor(input.session_id, r.task);
  const ranModel = (dispatch && dispatch.model) || 'inherit';
  const cost = appendCost(costLine(agent, ranModel === 'inherit' ? '' : ranModel, usage));

  const { run, how, candidates } = resolveReturnRun(input, r, dispatch);
  const dir = run ? join(run.dir, 'returns') : orphanDir(input.session_id);
  const file = join(dir, returnFilename(agent, input, text));
  const priced = cost.dollars == null ? 'unpriced (no model named)' : `$${cost.dollars.toFixed(2)} at list price`;

  try {
    mkdirSync(dir, { recursive: true });
    const header = `<!-- ${new Date().toISOString()} · ${agent} · ${describeDispatch(dispatch) || 'model unknown'} · ${formatUsage(usage)} · ${priced} -->\n\n`;
    writeFileSync(file, header + text + (text.endsWith('\n') ? '' : '\n'));
  } catch { return; }

  appendIndex(dir, {
    at: new Date().toISOString(),
    session: input.session_id || null,
    run: run ? run.runId : null,
    task: r.task || null,
    agent,
    model: ranModel,
    status: r.status || null,
    verdict: r.verdict || null,
    evidence: r.evidence,
    file,
    dollars: cost.dollars,
  });

  emit(note({ run, how, candidates, file, parsed: r, usage, priced }));
}

// One line back to the lead: where the return is, what it claims, and the one
// thing to do about it. It never asks for the work to be done again.
export function note({ run, how, candidates, file, parsed, usage, priced }) {
  const parts = [`return saved to ${file} (${formatUsage(usage)}, ${priced})`];
  if (!run) {
    const list = (candidates || []).map(c => c.runMd).join(', ');
    parts.push(`no run owns it (${how})${list ? `; candidates: ${list}` : ''}. Bind this session to the right run before the next dispatch: node scripts/run-init.mjs --bind <RUN.md> --session-id <this session>`);
  }
  const id = parsed.task ? `task ${parsed.task}` : 'no TASK line, so no row is keyed to it';
  const status = parsed.status ? `STATUS ${parsed.status}` : 'no STATUS line';
  const ev = parsed.evidence ? '' : ' with no EVIDENCE section, so it cannot be graded Done from the return alone';
  parts.push(`${id}, ${status}${ev}. Read the file, then set the row yourself.`);
  return `orchestrate ledger: ${parts.join('. ')}`;
}

// Only when run as a hook, not when a test imports the pure functions above.
if (process.argv[1] && resolvePath(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch {}
  process.exit(0);
}
