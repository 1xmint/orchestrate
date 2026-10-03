// lib/tier.mjs — the one copy of what every orchestrate hook needs: paths under
// ~/.claude/orchestrate, the session-to-run binding a hook writes through, and
// small safe file helpers. Plan-tier and installed-agent detection now live in
// lib/install.mjs, and run lookup in lib/runs.mjs; both are re-exported below
// so every existing importer keeps working unchanged.
// No network, no child processes, never throws to a caller (returns null instead).

import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync, renameSync, readdirSync, statSync, unlinkSync, rmdirSync, openSync, readSync, closeSync } from './node.mjs';
import { homedir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { lastMeasuredTokens } from './context-scan.mjs';

export const HOME = homedir();
export const DIR = join(HOME, '.claude', 'orchestrate');
export const SESSIONS_DIR = join(DIR, 'sessions');
export const PROFILE_PATH = join(DIR, 'profile.json');
export const TIERS = ['pro', 'max5', 'max20', 'team', 'api', 'unknown'];

export function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

export function writeJsonAtomic(path, obj) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n');
  // On Windows a rename can fail while another process holds the target open
  // (a reader, an antivirus scan): the error still reaches the caller, but the
  // temporary file does not stay behind.
  try { renameSync(tmp, path); } catch (e) { try { unlinkSync(tmp); } catch {} throw e; }
}

export function today(d = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
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

// True when `cwd` and `root` sit on the same branch of the folder tree — one
// contains the other, either way round, or they are the same folder.
// Case-insensitive and slash-normalised so a Windows drive letter or backslash
// path still matches. This is what keeps the machine-wide "last run opened"
// pointer from naming a run in a project the current session has nothing to
// do with, while still finding it for the ordinary case of a session started
// in the folder that contains the repo (cwd above root) or inside it (cwd
// below root).
export function isUnderRoot(cwd, root) {
  if (!cwd || !root) return false;
  const norm = p => resolve(String(p)).replace(/\\/g, '/').toLowerCase();
  const a = norm(root);
  const b = norm(cwd);
  if (a === b) return true;
  return b.startsWith(`${a}/`) || a.startsWith(`${b}/`);
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

// A section line someone filled in, as opposed to the template's own (assets/
// RUN.md): not blank, not an angle-bracket placeholder on its own, after a list
// marker or after a "Label:" ("Why it matters: <...>", "- <evidence ...>"), not
// the template's list of alternatives, not a {{TOKEN}} nobody replaced, and not
// the template's fixed instruction line. A line that was only checked for being
// wholly "<...>" let an untouched run pass as having a finish line, and a
// one-word "continue" armed 25 steps toward the template's own words
// (whole-file review of the router, 2026-10-03).
const TEMPLATE_FIXED = [/^When it ends, met or dropped:/i];
export function writtenLine(line) {
  let v = String(line == null ? '' : line).trim();
  if (!v) return false;
  v = v.replace(/^(?:[-*]|\d+\.)\s+/, '');
  if (TEMPLATE_FIXED.some(re => re.test(v))) return false;
  if (/\{\{[A-Z_]+\}\}/.test(v)) return false;
  const label = /^([A-Za-z][\w ,'()-]{0,40}):\s*(.*)$/.exec(v);
  const value = (label ? label[2] : v).trim();
  if (!value) return false;
  // The template's placeholders are prose in angle brackets ("<what the user
  // gets ...>", "<~N fresh sessions>", "<N>"); a component (<Header />,
  // <Button onClick={go}>) or a link (<https://...>) in a real line is not one.
  if (/^<[^>]*>\W*$/.test(value) && !/^<(?:https?:\/\/|\/?[A-Z][a-z]\w*(?:\s*\/?>|\s+[\w-]+=))/.test(value)) return false;
  // The template's list of one-word alternatives after its own label
  // ("Pickup confidence: high | medium | low"); a shell pipe ("npm test |
  // grep pass") or prose with a bar in it is a real line (independent review
  // of the hook-fix batch, 2026-10-03).
  if (label && /^\s*\w+(?:\s*\|\s*\w+){2,}\s*$/.test(value)) return false;
  return true;
}

// Per-key, TTL-pruned, size-bounded "have I seen this before" store — the
// shape both the dispatch guard and the return ledger need for their own
// dedupe. One global {sig, ts} slot used to serve this job in each hook; two
// events landing at the same moment overwrote each other's slot, so whichever
// wrote second could mask a genuine repeat of the first. Keying by event id
// instead means two different events never collide, and each is pruned on its
// own TTL rather than sharing one clock. This form is a read-modify-write
// (via `writeJsonAtomic`), which is safe from corruption — the rename is
// atomic — but not from a lost update if two processes race it; `markSeen`
// stays the right shape for return dedupe (lower concurrency: one stop at a
// time is the common case). For the dispatch guard, where up to 20 concurrent
// subagents are a documented, ordinary case, `seenRecently`/`recordSeen`
// below avoid the read-modify-write entirely.
export function markSeen(store, id, now = Date.now(), ttl = 86400000, max = 400) {
  const out = {};
  for (const [k, v] of Object.entries(store || {})) {
    const at = Number(v && v.at);
    if (Number.isFinite(at) && now - at < ttl) out[k] = { at };
  }
  const seen = Boolean(out[id]);
  out[id] = { at: now };
  const keys = Object.keys(out);
  if (keys.length > max) {
    for (const k of keys.sort((a, b) => out[a].at - out[b].at).slice(0, keys.length - max)) delete out[k];
  }
  return { seen, store: out };
}

// Append-only alternative to `markSeen`, for a store several processes can
// write to at once. `recordSeen` never reads before it writes, so a
// concurrent writer can only ever add its own line — nothing to race and
// nothing to lose. `seenRecently` scans for a match inside the TTL window;
// the scan is only ever as large as the log was last trimmed to, so it stays
// cheap. Trimming (`trimLog`) is the one read-modify-write left, kept rare and
// safe to skip on any given call: at worst the file grows a little past `max`
// until the next trim lands, never a lost or corrupted record.
export function seenRecently(path, id, now = Date.now(), ttl = 86400000) {
  let lines = [];
  try { lines = readFileSync(path, 'utf8').split('\n').filter(Boolean); } catch { return false; }
  for (const line of lines) {
    let rec; try { rec = JSON.parse(line); } catch { continue; }
    if (rec && rec.id === id && now - Number(rec.at) < ttl) return true;
  }
  return false;
}

export function recordSeen(path, id, now = Date.now()) {
  try { mkdirSync(dirname(path), { recursive: true }); appendFileSync(path, JSON.stringify({ id, at: now }) + '\n'); } catch {}
}

export function trimLog(path, max = 400) {
  try {
    const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean);
    if (lines.length > max) writeFileSync(path, lines.slice(-max).join('\n') + '\n');
  } catch {}
}

export function sanitizeId(s) {
  return String(s || 'unknown').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 120);
}

export function sessionPath(sessionId) {
  return join(SESSIONS_DIR, `${sanitizeId(sessionId)}.json`);
}

// Load, change and write the session file in one step under its lock, for a
// change that appends to a list another hook may append to at the same moment
// (a dispatch row, a return row): a merge by top-level key would keep only one
// of two such appends (review of the hook fixes, 2026-10-03). `init` makes the
// state when there is no file yet; without it nothing is written. `fn` must
// not save the session itself, and returns false when it changed nothing (then
// nothing is written). Returns what `fn` returns, or null.
export function updateSession(sessionId, fn, init = null) {
  const path = sessionPath(sessionId);
  try {
    return withFileLock(path, () => {
      let s = readJson(path);
      if (!s || typeof s !== 'object' || Array.isArray(s)) {
        if (!init) return null;
        s = init();
      }
      const r = fn(s);
      if (r === false) return false;   // nothing changed: nothing written
      s.updated = new Date().toISOString();
      writeJsonAtomic(path, s);
      return r === undefined ? null : r;
    });
  } catch { return null; }
}

// One session's entry in a file that keeps an entry for every session (the
// Stop hooks' loop and turn records). Each Stop read the whole file and wrote
// it back, so two sessions stopping at once lost one's entry (the loop's step
// count, the "said once" marks), and with one entry per session it grew on
// every session and was read whole at every Stop. A write takes the file's
// lock, re-reads it, sets this entry and keeps the `max` newest.
export const STORE_MAX = 200;
export function putEntry(path, key, value, max = STORE_MAX) {
  withFileLock(path, () => {
    const read = readJson(path);
    const store = read && typeof read === 'object' && !Array.isArray(read) ? read : {};
    store[key] = { ...value, t: Date.now() };
    const keys = Object.keys(store);
    if (keys.length > max) {
      const at = k => Number(store[k] && store[k].t) || Date.parse(store[k] && store[k].checkedAt) || 0;
      for (const k of keys.sort((a, b) => at(b) - at(a)).slice(max)) delete store[k];
    }
    writeJsonAtomic(path, store);
  });
}

// What a hook loaded, per top-level key, so its save writes back only what it
// changed (saveSession).
const LOADED = new WeakMap();
const snapshot = state => new Map(Object.entries(state).map(([k, v]) => [k, JSON.stringify(v)]));

export function loadSession(sessionId) {
  const s = readJson(sessionPath(sessionId));
  if (s && typeof s === 'object' && !Array.isArray(s)) LOADED.set(s, snapshot(s));
  return s;
}

// A short, best-effort lock beside a file: a directory, since making one is
// atomic everywhere. A lock older than two seconds is a hook that died holding
// it. Gives up waiting after a fifth of a second and goes ahead unlocked: a
// hook must not hang on another.
const NAP = new Int32Array(new SharedArrayBuffer(4));
export function withFileLock(path, fn) {
  const lock = `${path}.lock`;
  const until = Date.now() + 200;
  let held = false;
  for (let tries = 0; !held && tries < 100; tries++) {
    try { mkdirSync(lock); held = true; break; } catch (e) {
      if (e && e.code === 'ENOENT') { try { mkdirSync(dirname(path), { recursive: true }); } catch { break; } continue; }
      if (!e || e.code !== 'EEXIST') break;
      try { if (Date.now() - statSync(lock).mtimeMs > 2000) { rmdirSync(lock); continue; } } catch {}
      if (Date.now() > until) break;
      Atomics.wait(NAP, 0, 0, 5);
    }
  }
  try { return fn(); } finally { if (held) { try { rmdirSync(lock); } catch {} } }
}

// Several hooks write this file at once: the hook after every tool call, the
// one that files a helper's return, the dispatch guard, the Stop hooks.
// Writing the whole object back lost a write another hook made in between: a
// helper's return row vanished in about one race in four (whole-file review,
// 2026-10-03). So a save takes the lock, reads the file as it is now, and
// writes back only the top-level keys this hook changed since it loaded them
// (every key, for a state it did not load), keeping the rest as they are.
export function saveSession(state) {
  state.updated = new Date().toISOString();
  const path = sessionPath(state.session_id);
  const before = LOADED.get(state);
  withFileLock(path, () => {
    const fresh = readJson(path);
    let out = state;
    if (fresh && typeof fresh === 'object' && !Array.isArray(fresh)) {
      out = { ...fresh };
      for (const [k, v] of Object.entries(state)) if (!before || before.get(k) !== JSON.stringify(v)) out[k] = v;
      if (before) for (const k of before.keys()) if (!(k in state)) delete out[k];
    }
    writeJsonAtomic(path, out);
  });
  LOADED.set(state, snapshot(state));
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
  // Hooks are handed the session's effort in their environment; it beats a
  // transcript record, which lags a change by one step.
  const envEffort = typeof process.env.CLAUDE_EFFORT === 'string' && process.env.CLAUDE_EFFORT ? process.env.CLAUDE_EFFORT : null;
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i].trim();
    if (!l || l[0] !== '{') continue;
    let o; try { o = JSON.parse(l); } catch { continue; }
    // A limit or error message is written as model "<synthetic>": not a model.
    const model = o && o.message && typeof o.message.model === 'string' && o.message.model !== '<synthetic>' ? o.message.model : null;
    if (!model) continue;
    return {
      model: shortModel(model),
      effort: envEffort || (typeof o.effort === 'string' ? o.effort : null),
      // Which host this is, so the advice can name the actual click rather than
      // a slash command the desktop app does not have.
      entrypoint: typeof o.entrypoint === 'string' ? o.entrypoint : null,
    };
  }
  return null;
}

// How many tokens the conversation re-reads on each step right now. One reader
// owns this (lib/context-store.mjs): the input side of the last real response after
// the last compaction, or null when that is not currently known. It used to
// walk past compaction boundaries and report a pre-compaction size.
export function lastContextTokens(transcriptPath) {
  return lastMeasuredTokens(transcriptPath);
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

// ---- re-exported from the split-out modules, so every existing importer of
// lib/tier.mjs keeps working unchanged. ----------------------------------------
export { mapTier, findKeys, sessionAccount, currentAccount, detectTier, routerSettings, pluginAgentDir, agentsInstalled, AGENT_NAMES } from './install.mjs';
export {
  OPEN_GLYPHS, ACTIVE_RUN_PATH, STALE_RUN_MS, rememberActiveRun, runIdOf, activeRunPointer,
  readyTasks, returnedTasks, ungradedReturns, hasBlocksColumn, runSpend, parseBudget, readRun,
  runsUnder, openRunsUnder, staleRunsUnder, latestRun, bindSessionRun, sessionRun, resolveRun,
} from './runs.mjs';
