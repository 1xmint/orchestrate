// lib/tier.mjs — the one copy of what every orchestrate hook needs: paths under
// ~/.claude/orchestrate, plan-tier detection, run lookup and the session-to-run
// binding a hook writes through, installed role agents, and small safe file
// helpers.
// No network, no child processes, never throws to a caller (returns null instead).

import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, readdirSync, statSync, unlinkSync, openSync, readSync, closeSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname, resolve } from 'node:path';

export const HOME = homedir();
export const DIR = join(HOME, '.claude', 'orchestrate');
export const SESSIONS_DIR = join(DIR, 'sessions');
export const PROFILE_PATH = join(DIR, 'profile.json');
export const TIERS = ['pro', 'max5', 'max20', 'team', 'api', 'unknown'];
export const AGENT_NAMES = ['orch-planner', 'orch-implementer', 'orch-researcher', 'orch-browser', 'orch-reviewer', 'orch-debugger'];
export const OPEN_GLYPHS = /📋|🔨|🔍|◐|⛔/;

export function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

export function writeJsonAtomic(path, obj) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n');
  renameSync(tmp, path);
}

export function today(d = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function mapTier(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const s = raw.toLowerCase();
  if (/max[_-]?20x|max20/.test(s)) return 'max20';
  if (/max[_-]?5x|max5/.test(s)) return 'max5';
  if (/\bmax\b/.test(s)) return 'max5';
  if (/enterprise|team/.test(s)) return 'team';
  if (/\bpro\b|claude_pro|_pro_/.test(s)) return 'pro';
  return null;
}

// The tier keys sit under a nested account object whose shape has changed
// between versions, so look for them anywhere in the file, shallowly.
export function findKeys(obj, names, depth = 0, out = {}) {
  if (!obj || typeof obj !== 'object' || depth > 6) return out;
  for (const [k, v] of Object.entries(obj)) {
    if (names.includes(k) && v != null && !(k in out)) out[k] = v;
    else if (v && typeof v === 'object') findKeys(v, names, depth + 1, out);
  }
  return out;
}

export function detectTier() {
  const override = readJson(PROFILE_PATH);
  if (override && override.tier && override.tier !== 'unknown' && TIERS.includes(override.tier)) {
    return { tier: override.tier, source: `user override set ${String(override.setAt || '').slice(0, 10)} (${PROFILE_PATH})` };
  }
  const cfg = readJson(join(HOME, '.claude.json'));
  if (cfg) {
    const found = findKeys(cfg, ['userRateLimitTier', 'organizationRateLimitTier', 'seatTier']);
    for (const key of ['userRateLimitTier', 'organizationRateLimitTier', 'seatTier']) {
      const t = mapTier(found[key]);
      if (t) return { tier: t, source: `~/.claude.json ${key}="${found[key]}"` };
    }
  }
  if (process.env.ANTHROPIC_API_KEY) return { tier: 'api', source: 'ANTHROPIC_API_KEY is set' };
  return { tier: 'unknown', source: 'no signal; ask the user once, then --set tier=...' };
}

export function routerSettings() {
  const p = readJson(PROFILE_PATH);
  const r = (p && p.router) || {};
  return { enabled: r.enabled !== false, haiku: r.haiku === true };
}

// A plugin install does not copy agent files into ~/.claude/agents; the host
// registers them from the plugin's own folder. Counting only the loose copies
// therefore reported "agents 0/6 (missing …)" on a working plugin install, and
// sent the model off to run install-agents.mjs, which would have created a
// second set that then shadowed the plugin's. Look in both places.
function pluginAgentDir() {
  const base = join(HOME, '.claude', 'plugins', 'cache');
  try {
    for (const market of readdirSync(base)) {
      for (const plugin of readdirSync(join(base, market))) {
        for (const version of readdirSync(join(base, market, plugin))) {
          const d = join(base, market, plugin, version, 'skills', 'orchestrate', 'assets', 'agents');
          if (existsSync(join(d, `${AGENT_NAMES[0]}.md`))) return d;
        }
      }
    }
  } catch {}
  return null;
}

export function agentsInstalled() {
  const dir = join(HOME, '.claude', 'agents');
  const loose = AGENT_NAMES.filter(n => existsSync(join(dir, `${n}.md`)));
  if (loose.length === AGENT_NAMES.length) {
    return { installed: loose.length, expected: AGENT_NAMES.length, missing: [], dir, source: 'files' };
  }
  const pdir = pluginAgentDir();
  if (pdir) {
    const viaPlugin = AGENT_NAMES.filter(n => loose.includes(n) || existsSync(join(pdir, `${n}.md`)));
    return {
      installed: viaPlugin.length,
      expected: AGENT_NAMES.length,
      missing: AGENT_NAMES.filter(n => !viaPlugin.includes(n)),
      dir: pdir,
      source: 'plugin',
    };
  }
  return { installed: loose.length, expected: AGENT_NAMES.length, missing: AGENT_NAMES.filter(n => !loose.includes(n)), dir, source: 'files' };
}

export function findRepoRoot(start) {
  if (!start) return null;
  let d = resolve(start);
  for (let i = 0; i < 40; i++) {
    if (existsSync(join(d, '.git'))) return d;
    const parent = dirname(d);
    if (parent === d) return null;
    d = parent;
  }
  return null;
}

// A Pickup value the orchestrator never replaced. Two shapes count as unwritten:
// the angle-bracket placeholder, and the template's own list of alternatives
// ("high | medium | low"), which otherwise leaks into the resume line as
// "confidence high | medium | low" and reads as nonsense.
export function isWritten(value) {
  const v = String(value == null ? '' : value).trim();
  if (!v) return false;
  if (/^<.*>$/.test(v)) return false;
  if (/^[^|]{1,20}(\s*\|\s*[^|]{1,20})+$/.test(v)) return false;
  return true;
}

export const ACTIVE_RUN_PATH = join(DIR, 'active-run.json');

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
  return readRun(p.runMd, p.root);
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
export function readyTasks(rows, header) {
  const cols = String(header || '').split('|').map(s => s.trim().toLowerCase());
  const blocksAt = cols.indexOf('blocks on');
  if (blocksAt < 0) return [];

  const phaseOf = new Map();
  for (const r of rows) phaseOf.set(cellAt(r, 1), cellAt(r, 2));

  // A blocker nobody wrote a row for is nothing to wait for.
  const landed = id => {
    if (!phaseOf.has(id)) return true;
    return /✅/.test(phaseOf.get(id));
  };

  const out = [];
  for (const r of rows) {
    if (!/📋/.test(cellAt(r, 2))) continue;
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
    const ready = readyTasks(rows, header);
    const ungraded = ungradedReturns(rows, returnedTasks(dirname(runMd)));
    const open = rows.some(l => OPEN_GLYPHS.test(l));
    const pickup = {};
    const m = /## Pickup\s*\n([\s\S]*?)(?:\n## |\s*$)/.exec(text);
    if (m) {
      for (const line of m[1].split('\n')) {
        const kv = /^(Pickup prompt|Pickup confidence|Resume risk):\s*(.*)$/.exec(line.trim());
        if (kv && isWritten(kv[2])) pickup[kv[1]] = kv[2].trim();
      }
    }
    const dir = dirname(runMd);
    return { runId: runIdOf(runMd), dir, runMd, root: root || dirname(dirname(dir)), mtimeMs: st.mtimeMs, open, rows: rows.length, ready, ungraded, pickup };
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

export function openRunsUnder(root) {
  return runsUnder(root).filter(r => r.open);
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
  state.run = { root: run.root, runId: run.runId || runIdOf(run.runMd), runMd: run.runMd, boundAt: new Date().toISOString() };
  try { saveSession(state); } catch { return null; }
  return state.run;
}

export function sessionRun(sessionId) {
  const state = loadSession(sessionId);
  const r = state && state.run;
  if (!r || !r.runMd || !existsSync(r.runMd)) return null;
  return readRun(r.runMd, r.root);
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
    if (p) return { run: null, candidates: [p], how: 'no repo above the working directory; this is the last run opened on this machine, and it is not bound to this session' };
  }
  return { run: null, candidates: [], how: 'no repo above the working directory' };
}

export function sanitizeId(s) {
  return String(s || 'unknown').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 120);
}

export function sessionPath(sessionId) {
  return join(SESSIONS_DIR, `${sanitizeId(sessionId)}.json`);
}

export function loadSession(sessionId) {
  return readJson(sessionPath(sessionId));
}

export function saveSession(state) {
  state.updated = new Date().toISOString();
  writeJsonAtomic(sessionPath(state.session_id), state);
}

export function pruneSessions(maxAgeDays = 7) {
  try {
    if (!existsSync(SESSIONS_DIR)) return 0;
    const cutoff = Date.now() - maxAgeDays * 86400000;
    let n = 0;
    for (const f of readdirSync(SESSIONS_DIR)) {
      const p = join(SESSIONS_DIR, f);
      try { if (statSync(p).mtimeMs < cutoff) { unlinkSync(p); n++; } } catch {}
    }
    return n;
  } catch { return 0; }
}

// Last `bytes` of a file, for scanning a transcript tail without reading it all.
export function readTail(path, bytes = 65536) {
  try {
    const st = statSync(path);
    const start = Math.max(0, st.size - bytes);
    const len = st.size - start;
    const buf = Buffer.alloc(len);
    const fd = openSync(path, 'r');
    try { readSync(fd, buf, 0, len, start); } finally { closeSync(fd); }
    return buf.toString('utf8');
  } catch { return ''; }
}

// Which model and effort the *manager* is running on. The orchestrator cannot
// see its own model, and the routing rule for who reviews a diff depends on it:
// a manager strictly above the author can review the diff itself instead of
// paying for a reviewer dispatch. Read from the last assistant record in the
// transcript tail; unknown is a normal answer.
export function selfModel(transcriptPath) {
  const tail = readTail(transcriptPath, 65536);
  if (!tail) return null;
  const lines = tail.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i].trim();
    if (!l || l[0] !== '{') continue;
    let o; try { o = JSON.parse(l); } catch { continue; }
    const model = o && o.message && typeof o.message.model === 'string' ? o.message.model : null;
    if (!model) continue;
    return {
      model: shortModel(model),
      effort: typeof o.effort === 'string' ? o.effort : null,
      // Which host this is, so the advice can name the actual click rather than
      // a slash command the desktop app does not have.
      entrypoint: typeof o.entrypoint === 'string' ? o.entrypoint : null,
    };
  }
  return null;
}

// `claude-opus-5` and `claude-sonnet-5-20260101` are both "opus"/"sonnet" here;
// the family is what the routing rule turns on.
export function shortModel(id) {
  const s = String(id).toLowerCase();
  for (const f of ['fable', 'opus', 'sonnet', 'haiku']) if (s.includes(f)) return f;
  return s.slice(0, 24);
}

export const FAMILY_ORDER = ['fable', 'opus', 'sonnet', 'haiku'];

// Strictly stronger, by the ladder the routing rules use.
export function strongerThan(a, b) {
  const ia = FAMILY_ORDER.indexOf(String(a || '').toLowerCase());
  const ib = FAMILY_ORDER.indexOf(String(b || '').toLowerCase());
  if (ia < 0 || ib < 0) return false;
  return ia < ib;
}

// One step down the family ladder for every family named in `limits`.
export function applyLimits(model, limits) {
  let m = String(model || '').toLowerCase();
  const set = new Set((limits || []).map(s => String(s).toLowerCase()));
  for (let i = 0; i < FAMILY_ORDER.length && set.has(m); i++) {
    const idx = FAMILY_ORDER.indexOf(m);
    m = FAMILY_ORDER[Math.min(idx + 1, FAMILY_ORDER.length - 1)];
    if (idx === FAMILY_ORDER.length - 1) break;
  }
  return m;
}

// The manager model and effort the user settled on, once, for a tier. The
// router asks the question at most once per tier and then remembers the answer
// here, so an answered question never comes back. Shape:
//   manager: { model, effort, tier, setAt, why, accepted }
// `accepted: true` means the user took the recommendation rather than naming a
// pair; a tier change re-opens the question either way.
export function managerChoice() {
  const p = readJson(PROFILE_PATH);
  const m = p && p.manager;
  if (!m || typeof m !== 'object') return null;
  return m;
}
