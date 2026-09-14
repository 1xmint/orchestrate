#!/usr/bin/env node
// codex-worker.mjs — run one bounded task on Codex, through the ChatGPT login
// already saved on this machine, and hand anything unfinished back to Claude.
//
// Claude stays the lead. This adapter is how the lead gets a second
// subscription's worth of bounded coding and independent review without an API
// key or a paid dependency: `codex exec` with an explicit argument array, the
// task packet on stdin, JSONL events on stdout, and a structured final report
// (assets/worker-report.schema.json).
//
//   node codex-worker.mjs run --packet <file|-> --repo <dir> [--role implement|review|debug]
//        [--model <id>] [--effort minimal|low|medium|high|xhigh] [--approved]
//        [--hard] [--task <id>] [--run <run dir>] [--worktree <dir>] [--base <ref>]
//        [--timeout-min 20] [--session <id>] [--json]
//   node codex-worker.mjs status [--json]     binary, login, model, live workers, exhausted accounts
//
// What it guarantees:
//   - writers run in their own git worktree; reviewers run read-only
//   - Codex's own multi-agent features are disabled: the lead schedules
//   - the normal sandbox, approvals and repository instructions stay on
//   - two workers at once across Claude and Codex (policy workers.maxConcurrent)
//   - no two providers in one worktree: a live worker's registry entry is the lock
//   - a 20-minute timeout (policy codex.timeoutMin); partial work is kept
//   - an explicit quota-exhaustion error stops Codex for this run, without
//     probing the account again; a timeout is never read as exhaustion
//   - after any stop, the process has exited before its diff is saved and a
//     Claude packet for only the unfinished part is written
//
// Exit codes: 0 done · 3 needs a follow-up (partial, checks failed, timeout,
// throttled, malformed) · 4 hand to Claude (quota, login, Codex unavailable,
// permission) · 5 both providers unavailable · 2 usage.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, createWriteStream, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname, resolve, basename, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPolicy } from './lib/policy.mjs';
import {
  packetFromMarkdown, newReport, registerWorker, unregisterWorker, runningExternal, runningNative,
  helperFiles, lockHolder, concurrencyDecision, markExhausted, exhaustedFor, accountKey, WORKERS_DIR,
} from './lib/workers.mjs';
import { loadSession } from './lib/tier.mjs';
import { build as buildMap, status as mapStatus } from './map.mjs';
import { readQuota, HELPER_STOP_FIVE_HOUR, HELPER_STOP_WEEK } from './lib/quota.mjs';

const SELF = fileURLToPath(import.meta.url);
export const SCHEMA_PATH = resolve(dirname(SELF), '..', 'assets', 'worker-report.schema.json');
export const EXIT = { done: 0, followUp: 3, fallback: 4, blocked: 5, usage: 2 };
export const ASTRA = 'gpt-6-astra';
export const CODEX_EFFORTS = ['minimal', 'low', 'medium', 'high', 'xhigh'];

// ---- finding Codex ------------------------------------------------------------

// ORCH_CODEX_BIN, then PATH, then the Codex app's bundled CLI (Windows), newest.
export function findCodex(env = process.env) {
  if (env.ORCH_CODEX_BIN) return existsSync(env.ORCH_CODEX_BIN) ? env.ORCH_CODEX_BIN : null;
  const names = process.platform === 'win32' ? ['codex.exe', 'codex'] : ['codex'];
  for (const dir of String(env.PATH || env.Path || '').split(delimiter).filter(Boolean)) {
    for (const n of names) { const p = join(dir, n); try { if (statSync(p).isFile()) return p; } catch {} }
  }
  const local = env.LOCALAPPDATA ? join(env.LOCALAPPDATA, 'OpenAI', 'Codex', 'bin') : null;
  if (local) {
    let best = null;
    let dirs = [];
    try { dirs = readdirSync(local); } catch {}
    for (const d of dirs) {
      const p = join(local, d, 'codex.exe');
      try { const st = statSync(p); if (!best || st.mtimeMs > best.m) best = { p, m: st.mtimeMs }; } catch {}
    }
    if (best) return best.p;
  }
  return null;
}

// A script path (a fake used by tests) runs under this Node.
function command(bin, args) {
  return /\.(mjs|cjs|js)$/i.test(bin) ? { file: process.execPath, args: [bin, ...args] } : { file: bin, args };
}

export function codexHome(env = process.env) {
  return env.CODEX_HOME || join(homedir(), '.codex');
}

// The model Codex will use when none is named: config.toml's top-level `model`.
export function configuredModel(env = process.env) {
  try {
    const toml = readFileSync(join(codexHome(env), 'config.toml'), 'utf8');
    for (const line of toml.split('\n')) {
      if (/^\s*\[/.test(line)) break;
      const m = /^\s*model\s*=\s*"([^"]+)"/.exec(line);
      if (m) return m[1];
    }
  } catch {}
  return null;
}

// Signed in, and which login, without reading any credential: Codex answers
// `login status` itself. The account key is a hash of where the login lives and
// how it signs in, which separates two Codex homes on one machine.
export function loginStatus(bin, env = process.env) {
  if (!bin) return { ok: false, text: 'Codex CLI not found', account: null };
  const c = command(bin, ['login', 'status']);
  const r = spawnSync(c.file, c.args, { encoding: 'utf8', env, timeout: 20000, windowsHide: true });
  const text = `${r.stdout || ''}${r.stderr || ''}`.trim();
  const ok = r.status === 0 && /logged in/i.test(text) && !/not logged in/i.test(text);
  const how = (/using (\w[\w ]*)/i.exec(text) || [])[1] || 'unknown';
  return { ok, text: text.split('\n')[0] || `exit ${r.status}`, account: ok ? accountKey(`${codexHome(env)}|${how.toLowerCase()}`) : null };
}

// ---- classifying a stop ---------------------------------------------------------

// Read only from what ended the run (error events, a failed turn, stderr on a
// non-zero exit), never from the agent's own messages, which may be about code
// that mentions rate limits. Quota comes first because a usage-limit message
// can also carry a 429.
export function classifyFailure(text) {
  const t = String(text || '');
  if (!t.trim()) return null;
  if (/usage limit|usage_limit|quota (exceeded|exhausted)|insufficient_quota|exceeded your (current )?quota|out of credits|purchase more credits/i.test(t)) return 'quota-exhausted';
  if (/not logged in|login required|please (log|sign) in|unauthori[sz]ed|\b401\b|invalid[_ ]api[_ ]key|could not be refreshed|token (has )?expired|authentication (failed|required)/i.test(t)) return 'auth-failed';
  if (/\b429\b|too many requests|rate[ -]?limit|overloaded|\b50[234]\b|temporarily unavailable|stream disconnected|connection reset/i.test(t)) return 'throttled';
  if (/sandbox (denied|violation)|permission denied|\bEACCES\b|\bEPERM\b|operation not permitted|approval (was )?(denied|rejected)/i.test(t)) return 'permission-denied';
  return null;
}

// JSONL events into what the report needs. Unparseable lines are counted, not
// fatal: a worker killed mid-write leaves a partial last line.
export function parseEvents(text) {
  const out = { usage: { input: 0, cached: 0, output: 0, reasoning: 0 }, turns: 0, errors: [], failed: false, threadId: null, skipped: 0, lastAgentText: null };
  for (const line of String(text || '').split('\n')) {
    if (!line.trim()) continue;
    let e; try { e = JSON.parse(line); } catch { out.skipped++; continue; }
    if (!e || typeof e !== 'object') continue;
    const type = String(e.type || '');
    if (type === 'thread.started' && e.thread_id) out.threadId = e.thread_id;
    if (type === 'turn.completed') {
      out.turns++;
      const u = e.usage || {};
      out.usage.input += Number(u.input_tokens) || 0;
      out.usage.cached += Number(u.cached_input_tokens) || 0;
      out.usage.output += Number(u.output_tokens) || 0;
      out.usage.reasoning += Number(u.reasoning_output_tokens) || 0;
    }
    if (type === 'turn.failed') { out.failed = true; out.errors.push(String((e.error && (e.error.message || e.error.code)) || e.message || 'turn failed')); }
    if (type === 'error') out.errors.push(String(e.message || (e.error && e.error.message) || 'error'));
    if (type === 'item.completed' && e.item && e.item.type === 'agent_message' && typeof e.item.text === 'string') out.lastAgentText = e.item.text;
  }
  return out;
}

const STATUSES = new Set(['done', 'partial', 'blocked']);

// The structured final report, or null when it is missing or the wrong shape.
export function parseFinal(text) {
  let o = null;
  const s = String(text || '').trim();
  if (!s) return null;
  try { o = JSON.parse(s); } catch {
    const m = /\{[\s\S]*\}/.exec(s);
    if (m) { try { o = JSON.parse(m[0]); } catch { o = null; } }
  }
  if (!o || typeof o !== 'object' || !STATUSES.has(o.status) || typeof o.summary !== 'string') return null;
  return {
    status: o.status,
    summary: o.summary,
    changed: Array.isArray(o.changed) ? o.changed.map(String) : [],
    checks: Array.isArray(o.checks) ? o.checks.filter(c => c && typeof c === 'object').map(c => ({ command: String(c.command || ''), result: ['pass', 'fail', 'not-run'].includes(c.result) ? c.result : 'not-run', evidence: String(c.evidence || '') })) : [],
    remaining: Array.isArray(o.remaining) ? o.remaining.map(String) : [],
    notes: typeof o.notes === 'string' ? o.notes : '',
  };
}

// Pure: the status of a finished run from everything observed.
export function decideStatus({ timedOut = false, exitCode = null, events, stderr = '', final = null }) {
  if (timedOut) return { status: 'timeout', why: 'the time limit ran out; the worker was stopped' };
  const errText = [...(events ? events.errors : [])].join('\n');
  const failedRun = exitCode !== 0 || (events && events.failed);
  const cls = classifyFailure(errText) || (failedRun ? classifyFailure(stderr) : null);
  if (cls && (failedRun || cls === 'quota-exhausted')) return { status: cls, why: (errText || stderr).split('\n').map(l => l.trim()).find(Boolean) || cls };
  if (failedRun) return { status: 'failed', why: (errText || stderr).split('\n').map(l => l.trim()).find(Boolean) || `exit ${exitCode}` };
  if (!final) return { status: 'malformed', why: 'the final message was not the structured report' };
  // A check the sandbox stopped from running (a test runner denied spawning a
  // process, say) did not fail: it was not verified. Seen on the first real
  // acceptance run, where `node --test` hit spawn EPERM inside the sandbox and
  // passed 3/3 outside it. Those go back to the lead to rerun, not to a fixer.
  const failed = final.checks.filter(c => c.result === 'fail');
  const blocked = failed.filter(c => classifyFailure(c.evidence) === 'permission-denied').map(c => c.command);
  const real = failed.filter(c => !blocked.includes(c.command));
  if (real.length) return { status: 'checks-failed', why: real.map(c => c.command).join('; '), blocked };
  return { status: final.status, why: final.summary.split('\n')[0], blocked };
}

// What the lead should do next, by status.
export const HAND_TO_CLAUDE = new Set(['quota-exhausted', 'auth-failed', 'permission-denied', 'unavailable']);
export const FOLLOW_UP = new Set(['partial', 'checks-failed', 'timeout', 'throttled', 'malformed', 'failed', 'blocked']);

// ---- git -------------------------------------------------------------------------

function git(cwd, args) {
  const r = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || '').trim(), raw: r.stdout || '' };
}

export function ensureWorktree({ repo, worktree, task, base = 'HEAD' }) {
  const top = git(repo, ['rev-parse', '--show-toplevel']);
  if (!top.ok) return { ok: false, why: `${repo} is not a git repository` };
  if (worktree) {
    if (!existsSync(worktree)) return { ok: false, why: `worktree ${worktree} does not exist` };
    return { ok: true, path: resolve(worktree), created: false };
  }
  const root = resolve(top.out);
  const path = join(`${root}-worktrees`, String(task).replace(/[^A-Za-z0-9_.-]/g, '_'));
  if (existsSync(path)) return { ok: true, path, created: false };
  mkdirSync(dirname(path), { recursive: true });
  const branch = `codex/${String(task).replace(/[^A-Za-z0-9_.-]/g, '_')}`;
  const add = git(root, ['worktree', 'add', '-b', branch, path, base]);
  if (!add.ok) return { ok: false, why: `git worktree add failed: ${add.err.split('\n')[0]}` };
  return { ok: true, path, created: true, branch };
}

// Everything the worker left, saved after it has exited.
export function saveDiff(worktree, checkpoint) {
  const diff = git(worktree, ['diff', 'HEAD']);
  const names = git(worktree, ['diff', 'HEAD', '--name-only']);
  const untracked = git(worktree, ['ls-files', '--others', '--exclude-standard']);
  const changed = names.ok ? names.out.split('\n').filter(Boolean) : [];
  const extra = untracked.ok ? untracked.out.split('\n').filter(Boolean) : [];
  const diffPath = join(checkpoint, 'diff.patch');
  try { writeFileSync(diffPath, diff.raw); } catch {}
  return { changedFiles: changed, untracked: extra, diffPath, edited: changed.length + extra.length > 0 };
}

// ---- the worker prompt and the Claude handoff ---------------------------------------

// Codex loads only AGENTS.md, so it starts colder than a Claude helper. When the
// repo has a map, the worker is told to read it before searching.
// A repo with no map gets none here: building one is run-init's or the user's
// call, not a side effect of starting a worker.
export function mapNote(repo, { build: doBuild = buildMap, status: doStatus = mapStatus } = {}) {
  try {
    let s = doStatus(repo);
    if (s.state === 'missing') return null;
    if (s.state !== 'fresh') { doBuild(repo); s = doStatus(repo); }
    if (s.state !== 'fresh' || !s.mdPath) return null;
    // --repo lets the queries answer from the saved map inside Codex's sandbox,
    // where the script cannot start git to find the repo itself.
    return { mdPath: s.mdPath, repo: resolve(repo), script: fileURLToPath(new URL('./map.mjs', import.meta.url)) };
  } catch { return null; }
}

export function workerPrompt(packetText, { role, worktree, progress, map = null }) {
  const rules = [
    '',
    '---',
    'Worker rules (added by the orchestrate adapter):',
    `- You are one bounded worker. Work only inside ${worktree}. Do not start other agents or delegate any part of this task.`,
    role === 'review'
      ? '- Read only: do not modify any file. Review against the objective and acceptance checks above and report findings with file:line.'
      : '- Make the change, run the acceptance checks you can run locally, and leave the changes uncommitted in the worktree; the lead reviews and commits.',
    ...(map ? [`- Before searching, read ${map.mdPath}: folders, most-imported files, entry points and checks. For who imports a file or which tests cover it, run \`node "${map.script}" who-uses <file> --repo "${map.repo}"\` or \`tests-for <file> --repo "${map.repo}"\`; grep for text. The map is found in the text, so confirm by reading before you rely on it.`] : []),
    ...(progress ? [`- Keep a short progress note at ${progress} as you go (done so far, what is left), so an interruption loses nothing.`] : []),
    '- Do not wait on CI or other remote jobs.',
    '- If the sandbox stops a check from running at all (for example spawn EPERM), report that check as not-run with the error as its evidence; it is not a failure of your change.',
    '- Your final message is the JSON report: status (done, partial or blocked), a short summary, the files changed, every check with its command, result and output tail, the remaining work, and notes.',
  ];
  return `${String(packetText || '').trimEnd()}\n${rules.join('\n')}\n`;
}

export function claudeRoleFor(role, hard) {
  if (role === 'review') return { subagentType: 'orchestrate:orch-reviewer', model: 'opus' };
  if (role === 'debug' || hard) return { subagentType: 'orchestrate:orch-debugger', model: 'opus' };
  return { subagentType: 'orchestrate:orch-implementer', model: 'sonnet' };
}

export function fallbackPacket({ packet, report, role, hard, checkpoint }) {
  const who = claudeRoleFor(role, hard);
  const ev = report.evidence || {};
  const final = ev.final || null;
  const changed = [...(ev.changedFiles || []), ...(ev.untracked || [])];
  const lines = [
    `TASK: ${packet.taskId || 'task'}-claude  ROLE: ${who.subagentType.replace(/^orchestrate:orch-/, '')}`,
    ...(packet.run ? [`RUN: ${packet.run}`] : []),
    '',
    'OBJECTIVE',
    packet.objective || '(see the original packet below)',
    '',
    'CONTEXT',
    `- A Codex worker started this task and stopped: ${report.status} (${report.why || 'no detail'}). The process has exited.`,
    changed.length
      ? `- Its changes are already in ${report.worktree}: ${changed.slice(0, 20).join(', ')}${changed.length > 20 ? ` and ${changed.length - 20} more` : ''}. The diff is saved at ${ev.diffPath}. Check them, keep what is right, and do not redo them.`
      : '- It left no changes in the worktree.',
    ...(final && final.summary ? [`- It reported: ${final.summary.split('\n')[0]}`] : []),
    ...(final && final.remaining.length ? [`- It listed as remaining: ${final.remaining.join('; ')}`] : []),
    ...(ev.progressPath && existsSync(ev.progressPath) ? [`- Its progress note: ${ev.progressPath}`] : []),
    '',
    'SCOPE',
    `in: only the unfinished part of: ${(packet.scope && packet.scope.in) || 'the original scope'}`,
    `out: ${(packet.scope && packet.scope.out) ? `${packet.scope.out}; ` : ''}anything the saved diff already did correctly`,
    '',
    ...(report.worktree && role !== 'review' ? [`WHERE: worktree ${report.worktree} (already exists; work in it, do not create another)`, ''] : []),
    'DONE WHEN (evidence)',
    ...((packet.acceptance && packet.acceptance.length) ? packet.acceptance.map(a => `- ${a}`) : ['- the acceptance checks in the original packet pass']),
    '',
    `PROGRESS: ${join(checkpoint, 'progress-claude.md')}`,
    '',
    `Original packet: ${join(checkpoint, 'packet.md')}`,
  ];
  return { text: lines.join('\n') + '\n', ...who };
}

// ---- running one worker ----------------------------------------------------------

function killTree(child) {
  if (!child || child.exitCode != null) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
  else { try { process.kill(-child.pid, 'SIGTERM'); } catch { try { child.kill('SIGTERM'); } catch {} } }
}

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');

export function claudeAvailable(quota = readQuota()) {
  if (!quota) return { ok: true, why: 'no current Claude usage reading, so it is not ruled out' };
  if (quota.fiveHour && quota.fiveHour.pct >= HELPER_STOP_FIVE_HOUR) return { ok: false, why: `the Claude 5-hour window is at ${Math.round(quota.fiveHour.pct)}%` };
  if (quota.week && quota.week.pct >= HELPER_STOP_WEEK) return { ok: false, why: `the Claude weekly limit is at ${Math.round(quota.week.pct)}%` };
  return { ok: true, why: 'Claude usage is below the helper limits' };
}

export async function runWorker(opts, deps = {}) {
  const env = deps.env || process.env;
  const policy = deps.policy || loadPolicy();
  const workersDir = deps.workersDir || WORKERS_DIR;
  const now = () => new Date().toISOString();
  const role = ['implement', 'review', 'debug'].includes(opts.role) ? opts.role : 'implement';
  const hard = Boolean(opts.hard) || role === 'debug';
  const packetText = String(opts.packetText || '');
  const packet = packetFromMarkdown(packetText, { runtime: 'codex', role, taskId: opts.task || null, run: opts.run ? basename(resolve(opts.run)) : null });
  if (opts.task) packet.taskId = String(opts.task);
  if (!packet.taskId) packet.taskId = `codex-${stamp()}`;
  const checkpoint = opts.checkpoint || (opts.run ? join(resolve(opts.run), 'workers', packet.taskId) : join(workersDir, 'checkpoints', `${packet.taskId}-${stamp()}`));
  mkdirSync(checkpoint, { recursive: true });
  writeFileSync(join(checkpoint, 'packet.md'), packetText);
  const report = newReport(packet, { runtime: 'codex', role, checkpoint, startedAt: now() });
  const session = opts.session || env.CLAUDE_CODE_SESSION_ID || null;
  report.session = session;
  const scope = packet.run ? `run:${packet.run}` : session ? `session:${session}` : `day:${now().slice(0, 10)}`;
  const finish = (fields, code) => {
    Object.assign(report, fields, { endedAt: now() });
    if (HAND_TO_CLAUDE.has(report.status) || (FOLLOW_UP.has(report.status) && report.evidence && report.evidence.edited === false && report.status !== 'blocked')) {
      const claude = claudeAvailable(deps.quota !== undefined ? deps.quota : readQuota());
      const fb = fallbackPacket({ packet, report, role, hard, checkpoint });
      const fbPath = join(checkpoint, 'fallback-claude.md');
      writeFileSync(fbPath, fb.text);
      report.fallback = { path: fbPath, subagentType: fb.subagentType, model: fb.model, claudeAvailable: claude.ok, claudeWhy: claude.why };
      if (HAND_TO_CLAUDE.has(report.status) && !claude.ok) {
        report.next = `Both providers are unavailable (${report.status}; ${claude.why}). The checkpoint is saved at ${checkpoint}. Stop and tell the user; resume from ${fbPath} when either resets.`;
        code = EXIT.blocked;
      } else if (HAND_TO_CLAUDE.has(report.status)) {
        report.next = `Hand the unfinished part to Claude: dispatch ${fb.subagentType} with model "${fb.model}" and the packet in ${fbPath}.`;
        code = EXIT.fallback;
      }
    }
    const rerun = report.evidence && report.evidence.blockedChecks && report.evidence.blockedChecks.length
      ? ` Its sandbox blocked ${report.evidence.blockedChecks.join('; ')}, so run ${report.evidence.blockedChecks.length === 1 ? 'that' : 'those'} yourself in the worktree before trusting the result.`
      : '';
    if (!report.next) {
      report.next = report.status === 'done'
        ? `Review the diff${report.worktree ? ` in ${report.worktree}` : ''} against the acceptance checks, then integrate.${rerun}`
        : `Continue only the remaining work from ${checkpoint} (report.json, diff.patch${report.fallback ? `, ${basename(report.fallback.path)}` : ''}); do not rerun the whole task.`;
    }
    writeFileSync(join(checkpoint, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    // One line per finished run, for the meter's agent tree (measure.mjs --tree).
    try {
      mkdirSync(workersDir, { recursive: true });
      appendFileSync(join(workersDir, 'reports.jsonl'), JSON.stringify({ at: report.endedAt, session, taskId: report.taskId, role, status: report.status, checkpoint, fallback: Boolean(report.fallback), model: report.model || null, usage: (report.evidence && report.evidence.usage) || null }) + '\n');
    } catch {}
    return { report, code };
  };

  // Model and effort are per run; the policy only fills in what the dispatch left out.
  if (opts.effort && !CODEX_EFFORTS.includes(opts.effort)) return finish({ status: 'blocked', why: `--effort must be one of ${CODEX_EFFORTS.join(', ')}`, evidence: { edited: false } }, EXIT.usage);
  const model = opts.model || policy.codex.model || null;
  if (model === ASTRA && !opts.approved && !/^\s*APPROVED BY USER:\s*astra\b/im.test(packetText)) {
    return finish({ status: 'blocked', why: `${ASTRA} needs the user's yes for this task: pass --approved or put "APPROVED BY USER: astra" in the packet`, evidence: { edited: false } }, EXIT.usage);
  }

  if (!policy.codex.enabled) return finish({ status: 'unavailable', why: 'Codex workers are turned off (policy codex.enabled=false)', evidence: { edited: false } }, EXIT.fallback);
  const bin = deps.bin !== undefined ? deps.bin : findCodex(env);
  if (!bin) return finish({ status: 'unavailable', why: 'the Codex CLI was not found (set ORCH_CODEX_BIN, or install Codex)', evidence: { edited: false } }, EXIT.fallback);

  const login = loginStatus(bin, env);
  if (!login.ok) return finish({ status: 'auth-failed', why: `Codex is not signed in: ${login.text}`, evidence: { edited: false } }, EXIT.fallback);
  report.account = login.account;
  const exhausted = exhaustedFor({ provider: 'codex', account: login.account, scope }, workersDir);
  if (exhausted) return finish({ status: 'quota-exhausted', why: `Codex hit its usage limit earlier in this ${scope.split(':')[0]} (${exhausted.at}); not trying the account again${exhausted.resetsAt ? ` before ${exhausted.resetsAt}` : ''}`, evidence: { edited: false, skipped: true, resetsAt: exhausted.resetsAt || null } }, EXIT.fallback);

  // Two at once, across providers.
  const external = runningExternal(workersDir);
  let native = [];
  if (session && !deps.skipNative) {
    try {
      const { findSessionTranscript } = await import('./lib/context.mjs');
      const state = loadSession(session) || {};
      native = runningNative(state.dispatches || [], { returned: state.returned || [], files: helperFiles(findSessionTranscript(session)), staleMin: policy.workers.staleMin });
    } catch { native = []; }
  }
  const busy = concurrencyDecision(`codex-${role}`, { native, external, policy });
  if (busy) return finish({ status: 'blocked', why: busy, evidence: { edited: false } }, EXIT.followUp);

  const wt = role === 'review'
    ? { ok: true, path: resolve(opts.worktree || opts.repo), created: false }
    : ensureWorktree({ repo: resolve(opts.repo), worktree: opts.worktree, task: packet.taskId, base: opts.base || 'HEAD' });
  if (!wt.ok) return finish({ status: 'blocked', why: wt.why, evidence: { edited: false } }, EXIT.followUp);
  report.worktree = wt.path;
  packet.worktree = wt.path;
  const holder = lockHolder(wt.path, external);
  if (holder) return finish({ status: 'blocked', why: `another worker (${holder.task}, pid ${holder.pid}) is running in ${wt.path}`, evidence: { edited: false } }, EXIT.followUp);

  const progressPath = role === 'review' ? null : join(checkpoint, 'progress.md');
  const effort = opts.effort || (hard || role === 'review' ? policy.codex.effortHard : policy.codex.effortImplement);
  const lastMessagePath = join(checkpoint, 'last-message.json');
  const args = [
    'exec', '--json',
    '--disable', 'multi_agent', '--disable', 'multi_agent_v2',
    '-s', role === 'review' ? 'read-only' : 'workspace-write',
    '-C', wt.path,
    ...(model ? ['-m', model] : []),
    '-c', `model_reasoning_effort="${effort}"`,
    '--output-schema', deps.schemaPath || SCHEMA_PATH,
    '-o', lastMessagePath,
    ...(progressPath ? ['--add-dir', checkpoint] : []),
    '-',
  ];
  report.model = model || configuredModel(env);
  report.effort = effort;

  const eventsPath = join(checkpoint, 'events.jsonl');
  const stderrPath = join(checkpoint, 'stderr.log');
  const timeoutMs = Math.round((Number(opts.timeoutMin) || policy.codex.timeoutMin) * 60000);
  const started = Date.now();
  const c = command(bin, args);
  const child = spawn(c.file, c.args, { cwd: wt.path, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, detached: process.platform !== 'win32' });
  registerWorker({ provider: 'codex', role, taskId: packet.taskId, pid: process.pid, childPid: child.pid, worktree: wt.path, startedAt: report.startedAt, session, run: packet.run, checkpoint }, workersDir);

  let timedOut = false;
  const events = createWriteStream(eventsPath);
  const errs = createWriteStream(stderrPath);
  let stdoutText = '';
  let stderrText = '';
  child.stdout.on('data', d => { events.write(d); if (stdoutText.length < 32 * 1024 * 1024) stdoutText += d.toString('utf8'); });
  child.stderr.on('data', d => { errs.write(d); if (stderrText.length < 1024 * 1024) stderrText += d.toString('utf8'); });
  const timer = setTimeout(() => { timedOut = true; killTree(child); }, timeoutMs);
  const onSignal = () => { timedOut = true; killTree(child); };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  child.stdin.on('error', () => {});
  child.stdin.end(workerPrompt(packetText, { role, worktree: wt.path, progress: progressPath, map: deps.map !== undefined ? deps.map : mapNote(resolve(opts.repo || wt.path)) }));

  // The worker has exited before anything below looks at its work.
  const exit = await new Promise(res => child.on('close', (code, signal) => res({ code, signal })));
  clearTimeout(timer);
  process.removeListener('SIGINT', onSignal);
  process.removeListener('SIGTERM', onSignal);
  await Promise.all([new Promise(r => events.end(r)), new Promise(r => errs.end(r))]);
  unregisterWorker(packet.taskId, workersDir);

  const parsed = parseEvents(stdoutText);
  let lastMessage = '';
  try { lastMessage = readFileSync(lastMessagePath, 'utf8'); } catch { lastMessage = parsed.lastAgentText || ''; }
  const final = parseFinal(lastMessage);
  const decided = decideStatus({ timedOut, exitCode: exit.code, events: parsed, stderr: stderrText, final });
  const diff = role === 'review' ? { changedFiles: [], untracked: [], diffPath: null, edited: false } : saveDiff(wt.path, checkpoint);

  if (decided.status === 'quota-exhausted') markExhausted({ provider: 'codex', account: login.account, scope, message: decided.why }, workersDir);

  const evidence = {
    exitCode: exit.code, signal: exit.signal, timedOut, durationMs: Date.now() - started,
    usage: parsed.usage, turns: parsed.turns, errors: parsed.errors.slice(-5), unreadableEvents: parsed.skipped,
    threadId: parsed.threadId, final, blockedChecks: decided.blocked || [], ...diff, progressPath,
    eventsPath, stderrPath, lastMessagePath,
  };
  const code = decided.status === 'done' ? EXIT.done : HAND_TO_CLAUDE.has(decided.status) ? EXIT.fallback : EXIT.followUp;
  return finish({ status: decided.status, why: decided.why, evidence }, code);
}

// ---- status ----------------------------------------------------------------------

export function status({ env = process.env, workersDir = WORKERS_DIR } = {}) {
  const bin = findCodex(env);
  const login = bin ? loginStatus(bin, env) : { ok: false, text: 'Codex CLI not found', account: null };
  let exhausted = [];
  try { exhausted = (JSON.parse(readFileSync(join(workersDir, 'provider-state.json'), 'utf8')).exhausted || []).slice(-10).map(e => ({ ...e, active: !!exhaustedFor(e, workersDir) })); } catch {}
  return { bin, login: { ok: login.ok, text: login.text }, model: loadPolicy().codex.model || configuredModel(env), running: runningExternal(workersDir), exhausted, policy: loadPolicy().codex };
}

function parseArgs(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { o._.push(a); continue; }
    const k = a.slice(2);
    if (['json', 'hard', 'approved'].includes(k)) o[k] = true;
    else { o[k] = argv[i + 1]; i++; }
  }
  return o;
}

function humanReport(r) {
  const L = [`codex worker ${r.taskId}: ${r.status}${r.why ? ` — ${r.why}` : ''}`];
  const ev = r.evidence || {};
  if (r.worktree) L.push(`  worktree: ${r.worktree}`);
  if (ev.changedFiles || ev.untracked) L.push(`  changed: ${[...(ev.changedFiles || []), ...(ev.untracked || [])].join(', ') || 'nothing'}`);
  if (ev.final && ev.final.checks.length) for (const c of ev.final.checks) L.push(`  check ${c.result}: ${c.command}`);
  if (ev.usage) L.push(`  codex tokens: ${ev.usage.input} in (${ev.usage.cached} cached) / ${ev.usage.output} out, ${Math.round((ev.durationMs || 0) / 1000)} s`);
  L.push(`  checkpoint: ${r.checkpoint}`);
  L.push(`next: ${r.next}`);
  return L.join('\n');
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const cmd = o._[0];
  if (cmd === 'status') {
    const s = status();
    if (o.json) { console.log(JSON.stringify(s, null, 2)); return 0; }
    console.log(`codex: ${s.bin || 'not found'}`);
    console.log(`login: ${s.login.text}`);
    console.log(`model: ${s.model || 'unknown'} (effort ${s.policy.effortImplement} for bounded work, ${s.policy.effortHard} for hard work and review)`);
    console.log(`running: ${s.running.length ? s.running.map(w => `${w.task} (pid ${w.pid})`).join(', ') : 'none'}`);
    if (s.exhausted.length) console.log(`usage limit hit: ${s.exhausted.map(e => `${e.scope} at ${e.at}${e.active ? '' : ' (lifted)'}`).join('; ')}`);
    return 0;
  }
  if (cmd !== 'run' || !o.packet || !o.repo) {
    console.error('usage: codex-worker.mjs run --packet <file|-> --repo <dir> [--role implement|review|debug] [--model <id>] [--effort <level>] [--approved] [--hard] [--task <id>] [--run <run dir>] [--worktree <dir>] [--base <ref>] [--timeout-min N] [--session <id>] [--json]\n       codex-worker.mjs status [--json]');
    return EXIT.usage;
  }
  const packetText = o.packet === '-' ? readFileSync(0, 'utf8') : readFileSync(o.packet, 'utf8');
  const { report, code } = await runWorker({ ...o, packetText, timeoutMin: o['timeout-min'], role: o.role });
  console.log(o.json ? JSON.stringify(report, null, 2) : humanReport(report));
  return code;
}

if (process.argv[1] && resolve(process.argv[1]) === SELF) {
  main().then(code => process.exit(code), e => { console.error(String(e && e.stack || e)); process.exit(1); });
}
