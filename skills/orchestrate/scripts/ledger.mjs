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
import { join, dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { DIR, sanitizeId, loadSession, saveSession, resolveRun, runsUnder, findRepoRoot, seenRecently, recordSeen, trimLog } from './lib/tier.mjs';
import { dollars, family, normalizeRole } from './lib/prices.mjs';
import { roleMaxTurns } from './lib/workers.mjs';
import { checkReturn } from './lib/report.mjs';
import { addSuggestion } from './suggest.mjs';
export { roleMaxTurns };

// Lenient on purpose, and it stays lenient: a return that got the shape almost
// right is still the work. Anything absent is reported as absent, never
// corrected and never sent back to be rewritten.
export function parseReturn(text) {
  const t = String(text || '');
  const field = re => { const m = re.exec(t); return m ? m[1].trim() : null; };
  // Lenient on the separator too: "STATUS:", "STATUS -", "status —" and plain
  // case variation all named the field; a return that used a dash instead of
  // a colon still said what it said. `exec` on a pattern without `g` returns
  // the first match in the string, so the first STATUS-shaped line anywhere
  // in the return is the one read, wherever it falls.
  const status = (field(/^\s*STATUS\s*[:\-–—]\s*(DONE|PARTIAL|BLOCKED)\b/im) || '').toUpperCase() || null;
  const lines = t.trim() ? t.trim().split('\n').length : 0;
  return {
    task: field(/^\s*TASK:\s*(\S+)/im),
    run: field(/^\s*RUN:\s*(\S+)/im),
    status,
    evidence: /^\s*EVIDENCE:\s*\S/im.test(t),
    lines,
    branch: field(/^\s*BRANCH:\s*(.+)$/im),
    changed: field(/^\s*CHANGED:\s*(.+)$/im),
    // One line, optional: what the plugin could have done to make the task
    // easier. Read only by suggest.mjs, on request — never injected anywhere.
    suggest: field(/^\s*SUGGEST:\s*(.+)$/im),
    // `VERDICT: PASS` is the schema; a bare leading PASS/FAIL is what older
    // reviewer instructions produced, and is still read.
    verdict: (/^\s*VERDICT:\s*(PASS|FAIL)\b/im.exec(t) || /^\s*(PASS|FAIL)\b/m.exec(t) || [])[1] || null,
    // A reviewer's own return names the task it reviewed under "REVIEW OF:"
    // (packet.md's Reviewer packet RETURN schema), the task id its own first
    // token. This is how a reviewer return is told from any other return —
    // never TASK, which on a reviewer return names the reviewer's own task id.
    reviewOf: field(/^\s*REVIEW OF:\s*(\S+)/im),
  };
}

// Assistant records in a transcript carry `message.usage`. Sum the four fields
// that a subscription bills against; absent fields count as zero.
//
// The host writes one API call as several records, one per content block, each
// carrying a copy of the call's usage under the same `message.id`. Adding every
// record counted a helper's re-reads 1.4× and a long session's 2.8×. So each id
// counts once, from its last record (the earlier ones carry partial output
// counts). The model is read here too: the transcript knows what actually ran,
// and the dispatch record only knows what was asked for.
export function sumUsage(transcriptPath) {
  const totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, turns: 0 };
  try {
    if (!transcriptPath || !existsSync(transcriptPath)) return totals;
    const byId = new Map();
    let anon = 0;
    let model = null;
    for (const line of readFileSync(transcriptPath, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      let o; try { o = JSON.parse(line); } catch { continue; }
      const m = o && o.message;
      const u = m && m.usage;
      if (!u) continue;
      if (typeof m.model === 'string' && m.model !== '<synthetic>') model = m.model;
      byId.set(m.id || `anon-${anon++}`, u);
    }
    for (const u of byId.values()) {
      totals.turns++;
      totals.input += Number(u.input_tokens) || 0;
      totals.output += Number(u.output_tokens) || 0;
      totals.cacheRead += Number(u.cache_read_input_tokens) || 0;
      totals.cacheWrite += Number(u.cache_creation_input_tokens) || 0;
    }
    if (model) totals.model = model;
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

export function costLine(role, model, usage, agentId = null) {
  const fam = family(model);
  const d = dollars(usage, model);
  return {
    at: new Date().toISOString(),
    role: normalizeRole(role || 'claude'),
    model: fam || String(model || 'unknown'),
    priced: Boolean(fam),
    ...(agentId ? { agent: String(agentId) } : {}),
    input: usage.input, output: usage.output, cacheRead: usage.cacheRead, cacheWrite: usage.cacheWrite,
    dollars: d == null ? null : Number(d.toFixed(4)),
  };
}

// One row per agent: the last one written. A helper can stop more than once
// (an older version of this hook restarted it by answering its stop), and each
// stop wrote the agent's cumulative total again, so summing rows counted the
// same work two to nine times. Rows from before `agent` was recorded are kept.
export function latestPerAgent(rows) {
  const last = new Map();
  const loose = [];
  for (const r of rows || []) {
    if (r && r.agent) last.set(r.agent, r);
    else if (r) loose.push(r);
  }
  return [...loose, ...last.values()];
}

// R1: this used to read the whole file, push one line, and write the whole
// file back. Two returns landing together each read the same starting
// content, so whichever wrote second silently discarded the first's cost
// line — the read-all/write-all shape the index beside it (`appendIndex`)
// already avoided. `appendFileSync` is one line, not a read-modify-write, so
// a concurrent writer can only ever add its own line.
//
// Trimming to `COSTS_MAX` used to run on a random 2% of calls, which left the
// cap itself probabilistic: a session could log hundreds of rows past 500
// before the coin landed. The cap is a promise about the file's size, so it
// is kept every time — trimming after every append rather than gambling on
// it. A concurrent writer can still land a line between this trim's read and
// its write, but the next append's trim cleans that up; the file never grows
// unbounded, it just occasionally sits a line or two over `COSTS_MAX` for a
// moment.
export function appendCost(row, path = COSTS_PATH) {
  try {
    mkdirSync(DIR, { recursive: true });
    appendFileSync(path, JSON.stringify(row) + '\n');
    trimLog(path, COSTS_MAX);
  } catch {}
  return row;
}

// A sum over cost rows that never treats "no known model" as "$0": a row
// without a price is skipped rather than counted as free, and the caller is
// told how many rows contributed nothing, so a low total is never mistaken
// for a cheap run when it is really an unpriced one.
export function sumCosts(rows) {
  let total = 0, skipped = 0;
  for (const r of rows || []) {
    if (r && typeof r.dollars === 'number' && Number.isFinite(r.dollars)) total += r.dollars;
    else skipped++;
  }
  return { total: Number(total.toFixed(4)), skipped };
}

export function readCosts(path = COSTS_PATH) {
  try {
    return latestPerAgent(readFileSync(path, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean));
  } catch { return []; }
}

// A helper that used every turn it was allowed stopped because of the cap, not
// because it finished, whatever its last message claims. Its return is partial:
// the lead continues only what is left, from its evidence and progress file.
export function cappedReturn(turns, cap, parsedStatus) {
  const capped = cap != null && Number(turns) >= cap;
  return { capped, status: capped ? 'PARTIAL' : (parsedStatus || null), claimed: parsedStatus || null };
}

export const NO_EVIDENCE_NOTE = 'said done, but its return carried no evidence line; treat as unverified.';

// A DONE return with no evidence line is recorded as unverified, not as
// done: `checkReturn` reads the return itself (lib/report.mjs), so whether
// it is caught does not depend on what parseReturn already extracted. Never
// called for a status other than DONE — a PARTIAL or BLOCKED return, whether
// it started that way or was just downgraded by `cappedReturn` above, is
// left alone: this only ever narrows DONE, never touches anything else.
export function evidenceDowngrade(status, text) {
  if (status !== 'DONE') return { status, note: null };
  const check = checkReturn(text);
  if (check.evidence) return { status, note: null };
  return { status: 'PARTIAL', note: NO_EVIDENCE_NOTE };
}

export const NO_REVIEW_NOTE = 'done, but it was marked for an independent review and none has returned yet.';

// A task's packet can ask for independent review (packet.md: REVIEW: yes).
// A DONE return for such a task is recorded PARTIAL, with a note, until a
// reviewer return naming this task under "REVIEW OF:" exists in the run's own
// returns index. Only ever narrows DONE, the same shape as evidenceDowngrade:
// a PARTIAL or BLOCKED return is left exactly as it was, and this never
// upgrades a status once downgraded — a later reviewer return does not rewrite
// an earlier PARTIAL filing, it only lets the *next* DONE return through.
export function reviewDowngrade(status, reviewFlagged, task, indexRows) {
  if (status !== 'DONE' || !reviewFlagged || !task) return { status, note: null };
  const reviewed = (indexRows || []).some(row => row && row.reviewOf === task);
  if (reviewed) return { status, note: null };
  return { status: 'PARTIAL', note: NO_REVIEW_NOTE };
}

// The run's own returns index, read fresh for each SubagentStop so a reviewer
// return that landed earlier in the same run is seen. Missing or unreadable
// reads as no prior returns, never as a crash.
export function readReturnsIndex(dir) {
  try {
    const p = join(dir, INDEX_NAME);
    if (!existsSync(p)) return [];
    return readFileSync(p, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}

// What this helper's PostCompact hook (postcompact-check.mjs) already left
// behind in this run's returns.jsonl, as one fact for the lead: how many
// times it compacted mid-task and where the last kept summary is — nothing
// when it never compacted. Read straight from the index rather than a
// separate counter, same reasoning as postcompact-check.mjs's own count.
export function compactFact(dir, agentId) {
  if (!agentId) return null;
  try {
    const idx = join(dir, INDEX_NAME);
    if (!existsSync(idx)) return null;
    let n = 0, last = null;
    for (const line of readFileSync(idx, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      let o; try { o = JSON.parse(line); } catch { continue; }
      if (o && o.kind === 'compact' && o.agentId === agentId) { n++; last = o.file; }
    }
    if (!n) return null;
    return `compacted ${n}× mid-task; kept: ${last}`;
  } catch { return null; }
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

// A markdown table row split into its cells, the header and border rows
// dropped by whoever calls this (there is nothing here that tells a header
// from a data row). Leading/trailing pipes are optional and do not count as
// cells.
function tableCells(line) {
  const t = String(line || '').trim().replace(/^\|/, '').replace(/\|$/, '');
  return t.split('|').map(c => c.trim());
}

// A RUN.md task row is refused, not silently written, when it does not have
// one cell per header column. Two returns racing to append a row have been
// seen to land a cell short or a cell shifted — evidence in the wrong column
// reads as a different fact entirely, and nobody notices until the count is
// wrong too. Returns the row unchanged when it is well-formed, or a reason
// naming the task id (from the row's own first cell, since a malformed row is
// exactly the case where nothing else has parsed the id yet) when it is not.
export function lintRunRow(headerLine, rowLine) {
  const header = tableCells(headerLine);
  const row = tableCells(rowLine);
  if (row.length !== header.length) {
    const id = row[0] || 'unknown task';
    return { ok: false, reason: `row for ${id} has ${row.length} column${row.length === 1 ? '' : 's'}, the table header has ${header.length}: refused, not written` };
  }
  return { ok: true, cells: row };
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
    const sig = createHash('sha256').update(`${input.session_id || ''}|${agent}|${input.agent_id || ''}|${text}`).digest('hex').slice(0, 32);
    const now = Date.now();
    const seen = seenRecently(SEEN_RETURNS_PATH, sig, now, DEDUPE_MS);
    recordSeen(SEEN_RETURNS_PATH, sig, now);
    trimLog(SEEN_RETURNS_PATH, SEEN_RETURNS_MAX);
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

  let text = String(input.last_assistant_message || '');

  // Only a subagent's stop is a return, and only `agent_type` proves it is one.
  // `agent_id` does not: stops that are not subagent returns arrive carrying an
  // id and no type, and accepting those filed twenty-one of the lead's own
  // messages under returns/ in one session. An unnamed return is not a return.
  const agentType = input.agent_type || input.subagent_type;
  if (!agentType) return;
  const agent = String(agentType).replace(/[^A-Za-z0-9_-]/g, '_');

  // A helper stopped at its turn cap usually ends on a tool call, so it has no
  // final message. It has still stopped: record it, or it keeps its worker slot
  // until the silence rule gives up on it.
  const silent = !text.trim();
  if (silent) text = '(stopped with no final message)\n';

  // The recommended install registers this hook twice: once globally in
  // settings.json, and once from SKILL.md's frontmatter while the skill is in
  // play. Both fire on the same stop. Act once.
  if (alreadyHandled(input, agent, text)) return;

  const r = parseReturn(text);
  if (r.suggest) { try { addSuggestion(r.suggest, { source: r.task || r.run || null }); } catch {} }
  const usage = sumUsage(input.agent_transcript_path);
  const cap = cappedReturn(usage.turns, roleMaxTurns(agentType), r.status);
  r.status = silent && !cap.capped ? 'PARTIAL' : cap.status;
  const noEvidence = evidenceDowngrade(r.status, text);
  r.status = noEvidence.status;
  const dispatch = dispatchFor(input.session_id, r.task);
  const asked = dispatch && dispatch.model !== 'inherit' ? dispatch.model : '';
  const ranModel = usage.model || asked || 'inherit';
  const agentId = input.agent_id || input.tool_use_id || null;
  const cost = appendCost(costLine(agent, ranModel === 'inherit' ? '' : ranModel, usage, agentId));

  const { run, how, candidates } = resolveReturnRun(input, r, dispatch);
  const dir = run ? join(run.dir, 'returns') : orphanDir(input.session_id);
  const file = join(dir, returnFilename(agent, input, text));
  const priced = cost.dollars == null ? 'unpriced (no model named)' : `$${cost.dollars.toFixed(2)} at list price`;

  // A task flagged REVIEW: yes at dispatch (guard-agent.mjs's recordDispatch)
  // cannot be filed DONE until a reviewer return naming it under "REVIEW OF:"
  // already exists in this run's own returns index. Read before this return is
  // indexed, so this return's own reviewOf (if it is itself a reviewer return)
  // never counts as reviewing itself.
  const review = reviewDowngrade(r.status, Boolean(dispatch && dispatch.review), r.task, readReturnsIndex(dir));
  r.status = review.status;

  try {
    mkdirSync(dir, { recursive: true });
    const capNote = cap.capped ? ` · stopped at its ${usage.turns}-turn cap: PARTIAL${cap.claimed && cap.claimed !== 'PARTIAL' ? ` (it said ${cap.claimed})` : ''}` : '';
    const evidenceNote = noEvidence.note ? ` · ${noEvidence.note}` : '';
    const reviewNote = review.note ? ` · ${review.note}` : '';
    const compact = compactFact(dir, agentId);
    const compactNote = compact ? ` · ${compact}` : '';
    const header = `<!-- ${new Date().toISOString()} · ${agent} · ${describeDispatch(dispatch) || 'model unknown'} · ${formatUsage(usage)} · ${priced}${capNote}${evidenceNote}${reviewNote}${compactNote} -->\n\n`;
    writeFileSync(file, header + text + (text.endsWith('\n') ? '' : '\n'));
  } catch { return; }

  appendIndex(dir, {
    at: new Date().toISOString(),
    session: input.session_id || null,
    run: run ? run.runId : null,
    task: r.task || null,
    agent,
    agentId,
    ...(dispatch && dispatch.parent ? { parent: dispatch.parent } : {}),
    model: ranModel,
    status: r.status || null,
    ...(cap.capped ? { capped: true, claimed: cap.claimed } : {}),
    ...(noEvidence.note ? { noEvidence: true } : {}),
    ...(review.note ? { reviewGated: true } : {}),
    ...(r.reviewOf ? { reviewOf: r.reviewOf } : {}),
    verdict: r.verdict || null,
    evidence: r.evidence,
    file,
    dollars: cost.dollars,
  });

  // What came back, against this session's dispatch records, so the router can
  // say which helpers never returned after a usage limit stopped them.
  try {
    const state = input.session_id && loadSession(input.session_id);
    if (state) {
      state.returned = Array.isArray(state.returned) ? state.returned.slice(-199) : [];
      state.returned.push({ at: new Date().toISOString(), agent: normalizeRole(agentType), agentId: input.agent_id ? String(input.agent_id) : null, task: r.task || null, status: r.status || null, ...(dispatch && dispatch.parent ? { parent: dispatch.parent } : {}), ...(cap.capped ? { capped: true, turns: usage.turns, progress: dispatch && dispatch.progress ? dispatch.progress : null } : {}), ...(noEvidence.note ? { noEvidence: true } : {}) });
      saveSession(state);
    }
  } catch {}

  // Deliberately silent. SubagentStop context is delivered into the helper that
  // stopped, not to the lead: a note here made the helper answer it, stop again,
  // and get filed again — nine times over for one planner. The lead already
  // receives the return as a task notification, and the file is on disk.
}

// Only when run as a hook, not when a test imports the pure functions above.
if (process.argv[1] && resolvePath(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch {}
  process.exit(0);
}
