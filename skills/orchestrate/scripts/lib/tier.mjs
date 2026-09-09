// lib/tier.mjs — the one copy of what every orchestrate hook needs: paths under
// ~/.claude/orchestrate, plan-tier detection, the Fable counter, the latest run
// ledger for a repo, installed role agents, and small safe file helpers.
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

// A session's cwd is often not the repo. Josh's sessions start in the folder
// that *contains* his repos, so `findRepoRoot(cwd)` returns null and every hook
// that looked for a run from cwd found nothing: the router said "open run: none
// in this repo" while a run was open one directory down, and `profile --brief`
// said "runs 0". run-init records the run it just created here, and every
// reader tries this pointer before falling back to cwd.
export function rememberActiveRun(root, runMd) {
  try { writeJsonAtomic(ACTIVE_RUN_PATH, { v: 1, root, runMd, at: new Date().toISOString() }); } catch {}
}

function activeRunRoot() {
  const p = readJson(ACTIVE_RUN_PATH);
  return p && p.root && existsSync(join(p.root, '.orchestrator', 'runs')) ? p.root : null;
}

// The newest run under <root>/.orchestrator/runs that has a RUN.md. `open` is
// true when a task row still carries a non-final glyph. Pickup lines come from
// the "## Pickup" section; template placeholders count as empty.
export function latestRun(root) {
  const found = latestRunUnder(root);
  if (found) return found;
  // cwd knew nothing. Fall back to the run the last run-init recorded, but only
  // when cwd is not itself a repo with runs, so a session working in repo B is
  // never shown repo A's ledger.
  const remembered = activeRunRoot();
  return remembered && remembered !== root ? latestRunUnder(remembered) : null;
}

function latestRunUnder(root) {
  try {
    const base = join(root || process.cwd(), '.orchestrator', 'runs');
    if (!existsSync(base)) return null;
    const runs = readdirSync(base).filter(n => existsSync(join(base, n, 'RUN.md'))).sort();
    if (!runs.length) return null;
    const runId = runs[runs.length - 1];
    const runMd = join(base, runId, 'RUN.md');
    const st = statSync(runMd);
    const text = readFileSync(runMd, 'utf8');
    const rows = text.split('\n').filter(l => /^\|\s*\d+-\d+-\d{4}\s*\|/.test(l));
    const open = rows.some(l => OPEN_GLYPHS.test(l));
    const pickup = {};
    const m = /## Pickup\s*\n([\s\S]*?)(?:\n## |\s*$)/.exec(text);
    if (m) {
      for (const line of m[1].split('\n')) {
        const kv = /^(Pickup prompt|Pickup confidence|Resume risk):\s*(.*)$/.exec(line.trim());
        if (kv && isWritten(kv[2])) pickup[kv[1]] = kv[2].trim();
      }
    }
    return { runId, dir: join(base, runId), runMd, root: root || process.cwd(), mtimeMs: st.mtimeMs, open, rows: rows.length, pickup };
  } catch { return null; }
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
