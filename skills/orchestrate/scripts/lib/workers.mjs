// lib/workers.mjs — who is working right now, across providers, and what the
// worker contract looks like.
//
// Workers are native Claude helpers (dispatched through the Agent tool, seen by
// guard-agent.mjs) and external Codex workers (started by codex-worker.mjs).
// The concurrency limit counts both, because both spend the user's attention
// and both can edit the same files.
//
// A native helper counts as running when it was dispatched, has not returned,
// and is still showing signs of life: dispatched moments ago, or its own
// transcript was written recently. Return records alone are not enough — older
// sessions recorded none, and a helper the user refused at the permission
// prompt never returns — so a silent helper stops counting on its own.
//
// An external worker counts while its process is alive. Its registry entry is
// also the lock on its worktree: no native helper is sent into a worktree a
// live Codex process holds.

import { existsSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname, basename, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { loadPolicy } from './policy.mjs';

export const WORKERS_V = 1;
export const WORKERS_DIR = join(homedir(), '.claude', 'orchestrate', 'workers');
export const JUST_DISPATCHED_MS = 5 * 60 * 1000;
export const SILENT_MS = 10 * 60 * 1000;

const readJson = p => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
function writeJsonAtomic(p, obj) {
  mkdirSync(dirname(p), { recursive: true });
  const tmp = `${p}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n');
  renameSync(tmp, p);
}

export const roleOf = a => String(a || 'general-purpose').replace(/^[\w-]+:/, '');

// Helper transcripts for a session, keyed by the tool call that started them.
export function helperFiles(leadTranscript) {
  const out = new Map();
  if (!leadTranscript) return out;
  const dir = join(dirname(leadTranscript), basename(leadTranscript, '.jsonl'), 'subagents');
  let names = [];
  try { names = readdirSync(dir); } catch { return out; }
  for (const n of names) {
    if (!n.endsWith('.meta.json')) continue;
    const meta = readJson(join(dir, n));
    if (!meta || !meta.toolUseId) continue;
    const agentId = n.replace(/^agent-/, '').replace(/\.meta\.json$/, '');
    let mtimeMs = null;
    try { mtimeMs = statSync(join(dir, `agent-${agentId}.jsonl`)).mtimeMs; } catch {}
    out.set(meta.toolUseId, { agentId, mtimeMs, meta });
  }
  return out;
}

// Pure: which dispatch records still count as running.
export function runningNative(dispatches, { returned = [], files = new Map(), now = Date.now(), staleMin = loadPolicy().workers.staleMin } = {}) {
  const back = new Set((returned || []).map(r => r && r.agentId).filter(Boolean));
  const loose = (returned || []).filter(r => r && !r.agentId).map(r => ({ ...r, used: false }));
  const out = [];
  for (const d of dispatches || []) {
    if (!d || !d.at) continue;
    const age = now - Date.parse(d.at);
    if (!Number.isFinite(age) || age > staleMin * 60000) continue;
    const f = d.toolUseId ? files.get(d.toolUseId) : null;
    if (f && back.has(f.agentId)) continue;
    // A return with no agent id, matched in order by role and task.
    const role = roleOf(d.agent);
    const hit = loose.find(r => !r.used && roleOf(r.agent) === role && (!d.task || !r.task || r.task === d.task) && Date.parse(r.at || 0) >= Date.parse(d.at));
    if (hit) { hit.used = true; continue; }
    const alive = age < JUST_DISPATCHED_MS || (f && f.mtimeMs != null && now - f.mtimeMs < SILENT_MS);
    if (alive) out.push({ provider: 'claude', role, task: d.task || null, at: d.at, agentId: f ? f.agentId : null });
  }
  return out;
}

// Helpers that stopped at their turn cap, from the ledger's return records,
// said once each (marks them shown on the state object passed in). A capped
// return is partial whatever it claims; the recovery is a fresh, smaller packet
// for what is left, never resuming the stopped helper, which re-reads its whole
// large context on every further step.
export function cappedNote(state) {
  const list = (state && Array.isArray(state.returned) ? state.returned : []).filter(r => r && r.capped && !r.cappedShown);
  if (!list.length) return '';
  for (const r of list) r.cappedShown = true;
  const shown = list.slice(-4).map(r => `${r.agent}${r.task ? ` ${r.task}` : ''} (${r.turns} turns${r.progress ? `, progress ${r.progress}` : ''})`).join('; ');
  return `[orchestrate · partial] stopped at the turn cap, so partial: ${shown}. Check what its evidence shows is done, then send only the remaining work as a fresh, smaller packet from its progress file and branch. Do not resume the stopped helper.`;
}

// ---- external workers --------------------------------------------------------

export const activeDir = (dir = WORKERS_DIR) => join(dir, 'active');

export function pidAlive(pid) {
  const n = Number(pid);
  if (!Number.isInteger(n) || n <= 0) return false;
  try { process.kill(n, 0); return true; } catch (e) { return Boolean(e && e.code === 'EPERM'); }
}

const normPath = p => {
  const r = resolve(String(p || '')).replace(/\\/g, '/').replace(/\/+$/, '');
  return process.platform === 'win32' ? r.toLowerCase() : r;
};

export function registerWorker(entry, dir = WORKERS_DIR) {
  const id = String(entry.taskId || 'task').replace(/[^A-Za-z0-9_.-]/g, '_');
  const p = join(activeDir(dir), `${id}.json`);
  writeJsonAtomic(p, { v: WORKERS_V, ...entry, worktree: entry.worktree ? resolve(entry.worktree) : null, registeredAt: new Date().toISOString() });
  return p;
}

export function unregisterWorker(taskId, dir = WORKERS_DIR) {
  try { unlinkSync(join(activeDir(dir), `${String(taskId).replace(/[^A-Za-z0-9_.-]/g, '_')}.json`)); } catch {}
}

// Live external workers. Entries whose process has gone are removed: a crashed
// adapter must not hold a lock or a concurrency slot forever.
export function runningExternal(dir = WORKERS_DIR, alive = pidAlive) {
  const out = [];
  let names = [];
  try { names = readdirSync(activeDir(dir)); } catch { return out; }
  for (const n of names) {
    if (!n.endsWith('.json')) continue;
    const p = join(activeDir(dir), n);
    const e = readJson(p);
    if (!e) continue;
    if (!alive(e.pid) && !alive(e.childPid)) { try { unlinkSync(p); } catch {} continue; }
    out.push({ provider: e.provider || 'codex', role: e.role || null, task: e.taskId || null, at: e.startedAt || e.registeredAt, worktree: e.worktree || null, pid: e.pid });
  }
  return out;
}

// A live external worker whose worktree appears in this packet text.
export function lockedWorktreeIn(text, external) {
  let t = String(text || '').replace(/\\/g, '/');
  if (process.platform === 'win32') t = t.toLowerCase();
  return (external || []).find(w => w.worktree && t.includes(normPath(w.worktree))) || null;
}

export function lockHolder(worktree, external) {
  const target = normPath(worktree);
  return (external || []).find(w => w.worktree && normPath(w.worktree) === target) || null;
}

// ---- the concurrency rule (pure) ----------------------------------------------

export function concurrencyDecision(role, { native = [], external = [], policy = loadPolicy() } = {}) {
  const all = [...native, ...external];
  const r = roleOf(role);
  const list = xs => xs.map(w => `${w.provider === 'claude' ? w.role : `${w.provider} ${w.role || 'worker'}`}${w.task ? ` ${w.task}` : ''}`).join(', ');
  if (r === 'orch-browser') {
    const b = all.filter(w => roleOf(w.role) === 'orch-browser');
    if (b.length >= policy.workers.browserConcurrent) return `browser work is serial and ${list(b)} is still using the browser. Wait for it to return, then send this one.`;
  }
  if (all.length >= policy.workers.maxConcurrent) {
    return `${all.length} worker${all.length === 1 ? ' is' : 's are'} already running (${list(all)}), and the limit is ${policy.workers.maxConcurrent} across Claude and Codex. Do this step yourself if it is small, or wait for a return (watch it with Monitor and do independent work meanwhile). A worker silent for 10 minutes stops counting.`;
  }
  return null;
}

// ---- provider state -----------------------------------------------------------
// Quota exhaustion is remembered per provider, per account, per run (or per
// session when there is no run), so an exhausted account is not probed again
// for the same run and a different account or run is unaffected.

export const providerStatePath = (dir = WORKERS_DIR) => join(dir, 'provider-state.json');

export function accountKey(raw) {
  return raw ? createHash('sha256').update(String(raw)).digest('hex').slice(0, 12) : null;
}

// When the limit lifts, from the provider's own message: "try again at 2:31 PM"
// (the next such clock time) or "try again in 3 days 4 hours". Null when the
// message names no time; then the block lasts for the whole run.
export function parseResetTime(message, now = Date.now()) {
  const t = String(message || '');
  const at = /try again at (\d{1,2})(?::(\d{2}))?\s*([AaPp][Mm])?/.exec(t);
  if (at) {
    let h = Number(at[1]) % (at[3] ? 12 : 24);
    if (at[3] && /p/i.test(at[3])) h += 12;
    const d = new Date(now);
    d.setHours(h, Number(at[2] || 0), 0, 0);
    if (d.getTime() <= now) d.setDate(d.getDate() + 1);
    return d.getTime();
  }
  const inPart = /try again in ([^.]+)/i.exec(t);
  if (inPart) {
    const unit = { day: 86400000, hour: 3600000, minute: 60000, min: 60000, second: 1000, sec: 1000 };
    let ms = 0;
    for (const m of inPart[1].matchAll(/(\d+(?:\.\d+)?)\s*(day|hour|minute|min|second|sec)s?/gi)) ms += Number(m[1]) * unit[m[2].toLowerCase()];
    return ms > 0 ? now + ms : null;
  }
  return null;
}

export function markExhausted({ provider, account, scope, message = '', now = Date.now() }, dir = WORKERS_DIR) {
  if (!provider || !account || !scope) return false;
  const p = providerStatePath(dir);
  const s = readJson(p) || { v: WORKERS_V, exhausted: [] };
  s.v = WORKERS_V;
  s.exhausted = (Array.isArray(s.exhausted) ? s.exhausted : []).filter(e => !(e.provider === provider && e.account === account && e.scope === scope)).slice(-50);
  const resets = parseResetTime(message, now);
  s.exhausted.push({ provider, account, scope, at: new Date(now).toISOString(), resetsAt: resets ? new Date(resets).toISOString() : null, message: String(message).slice(0, 300) });
  writeJsonAtomic(p, s);
  return true;
}

// Unidentified entries (no account or scope) are ignored rather than enforced,
// and so is an entry whose stated reset time has passed.
export function exhaustedFor({ provider, account, scope }, dir = WORKERS_DIR, now = Date.now()) {
  if (!provider || !account || !scope) return null;
  const s = readJson(providerStatePath(dir));
  const list = s && Array.isArray(s.exhausted) ? s.exhausted : [];
  return list.find(e => e && e.provider === provider && e.account && e.scope && e.account === account && e.scope === scope && !lifted(e, now)) || null;
}

// An entry written before resetsAt existed works its reset out from the saved
// message and the time it was recorded.
function lifted(e, now) {
  let reset = e.resetsAt ? Date.parse(e.resetsAt) : null;
  if (e.resetsAt === undefined && Number.isFinite(Date.parse(e.at))) reset = parseResetTime(e.message, Date.parse(e.at));
  return Number.isFinite(reset) && reset <= now;
}

// ---- the provider-neutral packet and report -------------------------------------

export const REPORT_STATUSES = ['done', 'partial', 'blocked', 'checks-failed', 'quota-exhausted', 'auth-failed', 'throttled', 'permission-denied', 'timeout', 'malformed', 'failed'];

// A markdown packet (assets/packet.md) read into the neutral shape. Anything
// absent stays absent.
export function packetFromMarkdown(md, defaults = {}) {
  const t = String(md || '');
  const line = re => { const m = re.exec(t); return m ? m[1].trim() : null; };
  const section = name => {
    // A section runs to the next header line ("CONTEXT", "DONE WHEN (evidence)"),
    // the next field line ("PROGRESS: ..."), or the end of the packet.
    const m = new RegExp(`(?:^|\\n)${name}[^\\n]*\\n([\\s\\S]*?)(?=\\n[A-Z][A-Z ]{2,}(?: \\([^)\\n]*\\))?[ \\t]*(?:\\n|$)|\\n[A-Z][A-Z ]*:\\s|$)`).exec(t);
    return m ? m[1].trim() : '';
  };
  const bullets = s => s.split('\n').map(l => l.replace(/^\s*[-*]\s*/, '').trim()).filter(Boolean);
  const scope = section('SCOPE');
  return {
    v: WORKERS_V,
    taskId: line(/^\s*TASK:\s*(\S+)/m) || defaults.taskId || null,
    run: line(/^\s*RUN:\s*(\S+)/m) || defaults.run || null,
    runtime: defaults.runtime || null,
    role: defaults.role || (line(/ROLE:\s*(\S+)/) || null),
    objective: section('OBJECTIVE') || null,
    scope: {
      in: (/^in:\s*(.+)$/mi.exec(scope) || [])[1] || null,
      out: (/^out:\s*(.+)$/mi.exec(scope) || [])[1] || null,
    },
    worktree: defaults.worktree || null,
    acceptance: bullets(section('DONE WHEN')),
    text: t,
  };
}

export function newReport(packet, fields = {}) {
  return {
    v: WORKERS_V,
    taskId: packet.taskId || null,
    run: packet.run || null,
    runtime: packet.runtime || null,
    role: packet.role || null,
    scope: packet.scope || null,
    worktree: packet.worktree || null,
    acceptance: packet.acceptance || [],
    status: 'failed',
    evidence: {},
    checkpoint: null,
    startedAt: null,
    endedAt: null,
    ...fields,
  };
}
