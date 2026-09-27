// lib/runs.mjs — run lookup, split out of lib/tier.mjs: reading a run's RUN.md,
// which tasks are ready or owed a grade, the session-to-run binding a hook
// writes through, and the machine-wide "last run opened" pointer.
// No network, no child processes, never throws to a caller (returns null instead).

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { readJson, writeJsonAtomic, isWritten, isUnderRoot, findRepoRoot, loadSession, saveSession } from './tier.mjs';

export const OPEN_GLYPHS = /📋|🔨|🔍|◐|⛔/;

// Computed locally rather than imported as `DIR` from tier.mjs: tier.mjs
// re-exports this module, so importing its `DIR` here would make this file's
// own top-level evaluation depend on tier.mjs's top-level evaluation finishing
// first, and in a cycle the importing side always runs first (a TDZ
// `ReferenceError` on `DIR`). Same value either way — `join(homedir(), '.claude', 'orchestrate')`.
export const ACTIVE_RUN_PATH = join(homedir(), '.claude', 'orchestrate', 'active-run.json');

// The last run `run-init` opened on this machine. It is a *hint* for a session
// whose cwd is not inside a repo at all — sessions that start in the folder
// that contains the repos, where `findRepoRoot(cwd)` is null and nothing else
// can name a run. It is never authority for a write. When it was, a hook wrote
// one repository's subagent return into another repository's ledger, because
// "newest run on this machine" and "the run this session is working on" are not
// the same thing. Writes resolve a run from the session binding, or from a
// single unambiguous open run inside the current repo, and from nothing else.
export function rememberActiveRun(root, runMd) {
  try { writeJsonAtomic(ACTIVE_RUN_PATH, { v: 1, root, runMd, at: new Date().toISOString() }); } catch {}
}

export function runIdOf(runMd) {
  return String(runMd || '').replace(/[\\/]RUN\.md$/i, '').split(/[\\/]/).pop() || null;
}

export function activeRunPointer() {
  const p = readJson(ACTIVE_RUN_PATH);
  if (!p || !p.root || !p.runMd || !existsSync(p.runMd)) return null;
  const run = readRun(p.runMd, p.root);
  return run && run.stale ? null : run;
}

// A cell, counted from the left. Task and acceptance text are free-form and can
// contain a pipe, so anything read from the right shifts the moment one does.
// id, phase, blocks-on and owns all sit to the left of the free text for that
// reason.
const cellAt = (line, i) => {
  const c = String(line || '').split('|');
  return c[i] == null ? '' : c[i].trim();
};

// Which planned tasks could start right now. Answering this needs the
// dependency edges, and until v0.9.0 the table had no column for them: the
// skill asked for "what it blocks on" and the template dropped it, so nobody
// could tell a ready task from a blocked one. A ledger written before that
// column existed has no edges to read, so it reports nothing rather than
// guessing that every planned row is ready.
//
// Satisfied means done. A blocker still carrying an open glyph has not landed,
// and one marked ✖ failed never will, so neither releases what waits on it.
// 🧱 built-unverified is deliberately not enough: the artifact exists but
// nothing has checked it, and a task built on an unchecked one inherits the
// doubt. Loosening that is one glyph if it proves too strict in practice.
// A `blocks on` cell can name the short id alone (`0005`) instead of the full
// `9-18-0005`: same task, less to type in a table read every step. The task
// column always carries the full id, so a blocker is matched under both.
const shortId = id => {
  const m = /-(\d+)$/.exec(String(id || '').trim());
  return m ? m[1] : String(id || '').trim();
};

export function readyTasks(rows, header) {
  const cols = String(header || '').split('|').map(s => s.trim().toLowerCase());
  const blocksAt = cols.indexOf('blocks on');
  if (blocksAt < 0) return [];
  // A row whose "role · model" cell names a human, not an agent — "owner" is
  // the only such row the template writes — is never something a lead starts
  // by dispatching. Without this, a plan with an owner row still 📋 planned
  // told the lead it was ready to hand off, which it never was.
  const roleAt = cols.indexOf('role · model');

  const phaseOf = new Map();
  for (const r of rows) {
    const id = cellAt(r, 1);
    phaseOf.set(id, cellAt(r, 2));
    const short = shortId(id);
    if (short !== id) phaseOf.set(short, cellAt(r, 2));
  }

  // A blocker nobody wrote a row for is nothing to wait for.
  const landed = id => {
    if (!phaseOf.has(id)) return true;
    return /✅/.test(phaseOf.get(id));
  };

  const out = [];
  for (const r of rows) {
    if (!/📋/.test(cellAt(r, 2))) continue;
    if (roleAt >= 0 && /^owner\b/i.test(cellAt(r, roleAt))) continue;
    const blockers = cellAt(r, blocksAt).split(/[,\s]+/).filter(s => s && !/^[—-]$/.test(s));
    if (blockers.every(landed)) out.push(cellAt(r, 1));
  }
  return out;
}

// The task ids the ledger hook has filed a return for. One small append-only
// line per return, written by `ledger.mjs`.
export function returnedTasks(dir) {
  const ids = [];
  try {
    const text = readFileSync(join(dir, 'returns', 'returns.jsonl'), 'utf8');
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      let o; try { o = JSON.parse(line); } catch { continue; }
      if (o && o.task) ids.push(String(o.task));
    }
  } catch {}
  return ids;
}

// A return came back and nobody has looked at it. The hook stopped writing task
// rows in v0.9.0, because two returns landing together each rewrote the whole
// file and the second erased the first. That made the row honest — it is set
// when someone has actually judged the return — and it made it depend on the
// lead remembering, which is where this repo's own research says things fail.
//
// It matters more than it looks, because `readyTasks` reads these same rows. A
// row still saying 🔨 after its work came back hides a finished task, and
// everything waiting on it stays invisible.
//
// 📋 and 🔨 are the only two phases that mean untouched-since-dispatch. ◐ and ⛔
// are grades the lead chose; ✅, 🧱 and ✖ are final.
export function ungradedReturns(rows, returned) {
  const want = new Set((returned || []).filter(Boolean).map(String));
  if (!want.size) return [];
  const out = [];
  for (const r of rows) {
    const id = cellAt(r, 1);
    if (!want.has(id) || out.includes(id)) continue;
    if (/📋|🔨/.test(cellAt(r, 2))) out.push(id);
  }
  return out;
}

// True when the task table has a machine-readable `blocks on` column. When it
// does not but there are planned rows, readiness cannot be computed, and the
// caller should say so rather than report an empty (and misleading) "nothing
// ready". That is the difference between "no task is ready" and "I cannot see
// the edges": the second is a fixable ledger problem, not a state of the plan,
// and the run that cost 20% of a plan hit exactly this — the model wrote the
// edges as prose and the parser silently saw nothing.
export function hasBlocksColumn(header) {
  return String(header || '').split('|').map(s => s.trim().toLowerCase()).indexOf('blocks on') >= 0;
}

// What the run has spent on subagents so far, in list-price dollars, summed from
// the returns the ledger has already priced (returns/returns.jsonl). The lead
// conversation's own cost is not here — no hook sees it — so this is subagent
// spend, which is what the dispatch-time gate needs. Null when nothing priced.
// One line per agent counts, the last one (each line is that agent's cumulative
// total), and an unpriced line is unknown rather than $0.
export function runSpend(dir) {
  let sum = null;
  try {
    const text = readFileSync(join(dir, 'returns', 'returns.jsonl'), 'utf8');
    const last = new Map();
    let n = 0;
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      let o; try { o = JSON.parse(line); } catch { continue; }
      if (!o) continue;
      last.set(o.agentId || `line-${n++}`, o);
    }
    for (const o of last.values()) {
      if (o.dollars == null) continue;
      const d = Number(o.dollars);
      if (Number.isFinite(d)) sum = (sum || 0) + d;
    }
  } catch {}
  return sum;
}

// The budget of record, read from the run's "## Budget" section. `ceiling` is a
// list-price dollar cap the dispatch gate enforces, or null for no dollar gate.
// The user sets this once at run start; the gate never invents a tighter one, so
// the guardrail is the user's threshold rather than the tool's mood.
export function parseBudget(text) {
  const m = /## Budget\s*\n([\s\S]*?)(?:\n## |\s*$)/.exec(String(text || ''));
  const out = { ceiling: null, raw: null };
  if (!m) return out;
  out.raw = m[1].split('\n').filter(l => l.trim() && !/^<.*>$/.test(l.trim())).join('\n').trim() || null;
  const c = /Ceiling:\s*\$?\s*([\d.]+)/i.exec(m[1]);
  if (c) out.ceiling = Number(c[1]);
  return out;
}

// One run, read from its RUN.md. `open` is true while a task row still carries
// a non-final glyph. Pickup lines come from the "## Pickup" section; template
// placeholders count as empty.
export function readRun(runMd, root) {
  try {
    const st = statSync(runMd);
    const text = readFileSync(runMd, 'utf8');
    const lines = text.split('\n');
    const rows = lines.filter(l => /^\|\s*\d+-\d+-\d{4}\s*\|/.test(l));
    const header = lines.find(l => /^\|\s*id\s*\|/i.test(l)) || '';
    const dir = dirname(runMd);
    const ready = readyTasks(rows, header);
    const ungraded = ungradedReturns(rows, returnedTasks(dir));
    const plannedExist = rows.some(r => /📋/.test(cellAt(r, 2)));
    const edgesMissing = plannedExist && !hasBlocksColumn(header);
    const budget = parseBudget(text);
    const spend = runSpend(dir);
    // The phase cell, not the whole row: a task description that mentions a
    // glyph is not an open task.
    const open = rows.some(l => OPEN_GLYPHS.test(cellAt(l, 2)));
    const done = rows.filter(l => /✅/.test(cellAt(l, 2))).length;
    // A plan nobody has touched in two days is not the work in front of this
    // session. It stays on disk, and `run-init --reopen` makes it live again.
    // Only RUN.md counts as touched: a lead working a plan writes its rows and
    // Pickup. A return filed into it does not count, because an automatic
    // binding files returns into abandoned plans, and counting those kept this
    // repo's four-day-old plan alive.
    const lastActivity = st.mtimeMs;
    const stale = open && Date.now() - lastActivity > STALE_RUN_MS;
    const pickup = {};
    const m = /## Pickup\s*\n([\s\S]*?)(?:\n## |\s*$)/.exec(text);
    if (m) {
      for (const line of m[1].split('\n')) {
        const kv = /^(Pickup prompt|Pickup confidence|Resume risk):\s*(.*)$/.exec(line.trim());
        if (kv && isWritten(kv[2])) pickup[kv[1]] = kv[2].trim();
      }
    }
    return { runId: runIdOf(runMd), dir, runMd, root: root || dirname(dirname(dir)), mtimeMs: st.mtimeMs, lastActivity, open, stale, rows: rows.length, done, ready, ungraded, edgesMissing, budget, spend, pickup };
  } catch { return null; }
}

// Every run under one repo, oldest first. Ordered by when the run folder was
// created, not by name and not by modified time: run folders are created once,
// while RUN.md is rewritten constantly, and a name sort only separates runs from
// different days.
export function runsUnder(root) {
  try {
    const base = join(root || process.cwd(), '.orchestrator', 'runs');
    if (!existsSync(base)) return [];
    return readdirSync(base)
      .filter(n => existsSync(join(base, n, 'RUN.md')))
      .map(n => {
        let m = 0;
        try { const s = statSync(join(base, n)); m = s.birthtimeMs || s.mtimeMs; } catch {}
        return { n, m };
      })
      .sort((a, b) => (a.m - b.m) || (a.n < b.n ? -1 : a.n > b.n ? 1 : 0))
      .map(x => readRun(join(base, x.n, 'RUN.md'), root))
      .filter(Boolean);
  } catch { return []; }
}

export const STALE_RUN_MS = 48 * 3600 * 1000;

// Open and live. A stale run is neither bound, reported, budgeted nor filed
// into; it is listed by `staleRunsUnder` so the router can say once that it
// was set aside.
export function openRunsUnder(root) {
  return runsUnder(root).filter(r => r.open && !r.stale);
}

export function staleRunsUnder(root) {
  return runsUnder(root).filter(r => r.stale);
}

// The newest run under this repo, or null. No cross-repo fallback: a caller
// that has no repo asks `resolveRun` and gets candidates it must choose from.
export function latestRun(root) {
  const all = runsUnder(root);
  if (!all.length) return null;
  const p = readJson(ACTIVE_RUN_PATH);
  // Within the same repo the pointer still breaks a tie, because two runs
  // opened on the same day can share a creation millisecond.
  if (p && p.root && String(p.root).toLowerCase() === String(root || '').toLowerCase()) {
    const id = runIdOf(p.runMd);
    const hit = all.find(r => r.runId === id);
    if (hit) return hit;
  }
  return all[all.length - 1];
}

// ---- session ↔ run binding --------------------------------------------------
// The association a hook writes through. A run belongs to the session that
// opened or resumed it, and to no other; `--session-id` on run-init and
// `bindSessionRun` are the only two ways it is set.

export function bindSessionRun(sessionId, run) {
  if (!sessionId || !run || !run.runMd) return null;
  const state = loadSession(sessionId) || { v: 1, session_id: sessionId, started: new Date().toISOString() };
  state.session_id = sessionId;
  state.run = { root: run.root, runId: run.runId || runIdOf(run.runMd), runMd: run.runMd, boundAt: new Date().toISOString(), explicit: true };
  try { saveSession(state); } catch { return null; }
  return state.run;
}

// A binding to a stale run holds only when someone bound it on purpose
// recently; an automatic binding to an abandoned plan is what put this
// session's helper return into a four-day-old ledger.
export function sessionRun(sessionId) {
  const state = loadSession(sessionId);
  const r = state && state.run;
  if (!r || !r.runMd || !existsSync(r.runMd)) return null;
  const run = readRun(r.runMd, r.root);
  if (run && run.stale && !(r.explicit && Date.now() - Date.parse(r.boundAt || 0) < STALE_RUN_MS)) return null;
  return run;
}

// Which run, if any, this session may act on.
//   { run, candidates, how }
// `run` is set only when the answer is unambiguous. Otherwise `candidates`
// carries what a resume would have to choose between, and the caller says so
// rather than guessing. `forWrite` refuses the machine-wide pointer outright.
export function resolveRun(sessionId, cwd, { forWrite = false } = {}) {
  const bound = sessionRun(sessionId);
  if (bound) return { run: bound, candidates: [bound], how: 'bound to this session' };

  const root = findRepoRoot(cwd);
  if (root) {
    const open = openRunsUnder(root);
    if (open.length === 1) return { run: open[0], candidates: open, how: 'the one open run in this repo' };
    if (open.length > 1) return { run: null, candidates: open, how: `${open.length} open runs in this repo` };
    return { run: null, candidates: [], how: 'no open run in this repo' };
  }

  if (!forWrite) {
    const p = activeRunPointer();
    // The pointer is a hint for a session with no repo above it, not authority
    // to name a run in a folder it has nothing to do with. A session started
    // above one project must not see another project's run because that one
    // happened to be the last one opened on the machine.
    if (p && isUnderRoot(cwd, p.root)) return { run: null, candidates: [p], how: 'no repo above the working directory; this is the last run opened on this machine, and it is not bound to this session' };
  }
  return { run: null, candidates: [], how: 'no repo above the working directory' };
}
