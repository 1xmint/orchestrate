#!/usr/bin/env node
// guard-agent.mjs — a PreToolUse hook on the Agent tool. Two jobs, both
// mechanical: keep credentials out of packets, and record every dispatch so the
// ledger can report what actually ran.
//
// It never rewrites a dispatch. It does refuse the few model choices the record
// shows cost the most and were never deliberate — see the model rule below.
//
// Order matters here, and it did not used to. Deduplication ran first, so a
// denied packet re-sent unchanged within five seconds was treated as "the same
// dispatch, already handled" and passed. The credential decision now runs on
// every invocation, before anything is deduplicated, and only the side effects
// (the dispatch record, the price tag) are suppressed for a repeat.
//
// A credential match is a safeguard against the obvious mistake, not a security
// boundary: it recognises the shapes below and nothing else.
//
// Reads the hook payload on stdin, prints one JSON object or nothing, always
// exits 0.

import { readFileSync, openSync, writeSync, closeSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DIR, readJson, sanitizeId, loadSession, saveSession, detectTier, PROFILE_PATH, sessionRun, findRepoRoot, runsUnder, openRunsUnder, activeRunPointer, seenRecently, recordSeen, trimLog, FAMILY_ORDER, lastContextTokens, agentsInstalled, AGENT_NAMES } from './lib/tier.mjs';
import { loadPolicy } from './lib/policy.mjs';
import { helperFiles, nativeAgent, runningNative, runningExternal, lockedWorktreeIn, concurrencyDecision } from './lib/workers.mjs';
import { priceTag, estimateDollars, family, normalizeRole } from './lib/prices.mjs';
import { readQuota, resetClock, HELPER_STOP_FIVE_HOUR, HELPER_STOP_WEEK } from './lib/quota.mjs';
import { readCosts } from './ledger.mjs';

// Anything here means the packet is carrying a live secret. The list grew after
// an audit fed it four shapes it did not know: an OpenAI project key, a Google
// API key, a JSON Web Token, and a password in a connection string.
const CRED = new RegExp([
  'sk-ant-[A-Za-z0-9_-]{8,}',
  'sk-(?:proj|live|test)-[A-Za-z0-9_-]{16,}',
  'ghp_[A-Za-z0-9]{20,}',
  'github_pat_[A-Za-z0-9_]{20,}',
  'gh[opsu]_[A-Za-z0-9]{20,}',
  'AKIA[0-9A-Z]{16}',
  'ASIA[0-9A-Z]{16}',
  'AIza[0-9A-Za-z_-]{30,}',
  'xox[baprs]-[A-Za-z0-9-]{10,}',
  'eyJ[A-Za-z0-9_-]{10,}\\.eyJ[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}', // a JWT
  '(?:password|passwd|pwd|secret|api[_-]?key|access[_-]?token)\\s*[=:]\\s*["\']?[^\\s"\'<>]{8,}',
  '-----BEGIN [A-Z ]*PRIVATE KEY-----',
].join('|'));

// Deny, or pass. There is no third answer.
export function decide(input) {
  const ti = (input && input.tool_input) || {};
  const prompt = String(ti.prompt || '');

  if (CRED.test(prompt)) {
    return { kind: 'deny', reason: 'the packet contains something that looks like a credential; remove it and refer to it by name instead' };
  }
  return { kind: 'pass' };
}

// ---- the model rule ----------------------------------------------------------
// The one decision that set most of this machine's recorded helper spend: 56 of
// 58 implementers ran on Opus against a written Sonnet default, and three
// research sweeps ran on the lead's Opus because no model was named. A written
// rule and a price tag did not change it, so this one is enforced. Every deny
// says exactly what to send instead, so it costs one lead step, never the work.
//
// Executors start on Sonnet and move up only after a real attempt at the same
// task; judgment roles (planner, reviewer, debugger) may use Opus. Built-in
// sweepers take the lead's model unless told, so they must be told. A fork
// copies the whole conversation into every step it takes. Fable on a plan that
// does not include it spends the user's money. And near the user's plan limit,
// a new helper is the one that gets cut off mid-edit.
export const EXECUTORS = new Set(['orch-implementer', 'orch-researcher', 'orch-browser']);
export const SWEEPERS = new Set(['Explore', 'general-purpose', 'claude']);
export const FORK_MAX_CONTEXT = 100000;
export const PACKET_WARN_CHARS = 8000;

// What identifies "the same task" across a retry: the packet's TASK id when it
// is an id, else its first real line.
// A packet header line, not the task's own text: skipped when falling back to
// "the first real line", or two packets sharing a header and lacking a
// numeric TASK id would collapse onto the same key.
const HEADER_LINE = /^\s*(APPROVED BY USER|RISK|BUILDS ON)\s*:/i;

export function taskKey(prompt) {
  const p = String(prompt || '');
  const id = (/^\s*TASK:\s*(\S+)/m.exec(p) || [])[1];
  if (id && /\d/.test(id)) return id;
  const first = p.split('\n').map(l => l.trim()).find(l => l && !HEADER_LINE.test(l)) || '';
  return first.toLowerCase().replace(/\s+/g, ' ').slice(0, 80);
}

// The packet's own numeric TASK id, or null — what a grant binds to. Distinct
// from taskKey: a grant needs an actual id, never a first-line fallback.
export function numericTaskId(prompt) {
  const id = (/^\s*TASK:\s*(\S+)/m.exec(String(prompt || '')) || [])[1];
  return id && /\d/.test(id) ? id : null;
}

const rank = m => FAMILY_ORDER.indexOf(family(m) || '');

// Whether a `userModel` record the router wrote (the user naming a family in
// their own prompt) unlocks this dispatch. A grant is spent on the first
// numeric TASK id that uses it, and refuses every other id by name. Pure and
// testable: the caller reads the bound id (from the atomic claim file below,
// never from a read-modify-write on the session record) and passes it in.
//   null              no grant applies (no record, wrong family, no task id)
//   { allow, bind }   allowed; `bind` is the id to claim when not bound yet
//   { deny, reason }  a grant exists but is already spent on another task
export function grantCheck(userModel, f, prompt, boundId = null) {
  if (!userModel || userModel.family !== f) return null;
  const id = numericTaskId(prompt);
  if (!id) return null;
  if (!boundId) return { allow: true, bind: id };
  if (boundId === id) return { allow: true, bind: null };
  return { deny: true, reason: `Josh named ${f} for task ${boundId}; this is task ${id} — ask him or start on Sonnet.` };
}

// Where a grant's claim lives: one file per session+moment-the-user-named-it,
// created exactly once. `fs.openSync(path, 'wx')` fails if the file already
// exists, so two dispatches racing to spend the same grant can both try to
// create it but only one wins; the loser reads back whatever the winner
// wrote. That is what keeps the binding safe from the read-modify-write races
// `seenBefore`'s comment above documents for the session file, and from a
// second task id stealing a grant a first dispatch already claimed.
export const GRANTS_DIR = join(DIR, 'grants');

export function grantPath(session, at) {
  return join(GRANTS_DIR, `${sanitizeId(session)}-${sanitizeId(String(at))}`);
}

// The id currently bound to this session's grant, or null if nothing has
// claimed it yet. `null` must mean "no file" and nothing else: the window
// between a winner's `openSync(..., 'wx')` and its `writeSync` leaves the
// claim file existing but empty for an instant, and a reader that lands in
// that window must not read that as unclaimed — the file existing at all
// means someone has already started (or finished) a claim. So a file that
// exists but is empty reads back as the sentinel below, which never equals a
// real task id and never satisfies `!boundId`, instead of `null`.
const GRANT_PENDING = '(pending)';

export function readGrantId(session, at) {
  let raw;
  try { raw = readFileSync(grantPath(session, at), 'utf8'); } catch { return null; }
  const id = raw.trim();
  return id || GRANT_PENDING;
}

// Claim the grant for `id`, atomically. Returns the id now bound: `id` itself
// when this call is the one that created the claim file, or whatever id a
// concurrent winner already wrote there.
export function claimGrantId(session, at, id) {
  const path = grantPath(session, at);
  try {
    mkdirSync(GRANTS_DIR, { recursive: true });
    const fd = openSync(path, 'wx');
    try { writeSync(fd, String(id)); } finally { closeSync(fd); }
    return String(id);
  } catch {
    return readGrantId(session, at);
  }
}

// The post-claim check main() runs once every other gate has passed: actually
// claim the grant (via `claim`, injectable so a test can force the race
// without a second process) and refuse the dispatch unless it is the one that
// won. Two outcomes both deny: a different task id won the race (name both,
// same message shape as grantCheck's), or the claim came back empty — the
// file existed but was still being written, or the claim itself failed — in
// which case there is nothing to name, so the dispatch is told to retry on
// Sonnet instead of guessing who won.
export function claimOrDeny(session, grantToClaim, claim = claimGrantId) {
  const won = claim(session, grantToClaim.at, grantToClaim.grantBind);
  if (won === grantToClaim.grantBind) return null;
  if (won && won !== GRANT_PENDING) {
    return { prefix: 'model', reason: `Josh named ${grantToClaim.family} for task ${won}; this is task ${grantToClaim.grantBind} — ask him or start on Sonnet.` };
  }
  return { prefix: 'model', reason: `the ${grantToClaim.family} grant could not be claimed; resend with model: "sonnet".` };
}

// Three shapes come back, and a caller that treats any non-null result as a
// denial is wrong now that a grant exists:
//   null                        allowed, nothing to record
//   { prefix, reason }          denied
//   { grantBind, at, family }   allowed, and the caller should claim the
//                               grant for `grantBind` (via claimGrantId)
//                               once every later gate (budget) also passes
export function modelDecision(ti, { tier = 'unknown', dispatches = [], leadContext = null, quota = null, userModel = null } = {}) {
  const role = normalizeRole(ti.subagent_type || 'general-purpose');
  const model = String(ti.model || '');
  const f = family(model);
  const prompt = String(ti.prompt || '');

  if (quota) {
    const h = quota.fiveHour, w = quota.week;
    if (h && h.pct >= HELPER_STOP_FIVE_HOUR) return { prefix: 'quota', reason: `the 5-hour usage window is at ${Math.round(h.pct)}%, so a new helper would likely be cut off mid-task. Finish what is in flight in this conversation, or stop and tell the user it resets at ${resetClock(h.resetsAt)}; Claude Code resumes on its own after the reset.` };
    if (w && w.pct >= HELPER_STOP_WEEK) return { prefix: 'quota', reason: `the weekly limit is at ${Math.round(w.pct)}%. Do not start helpers; finish in this conversation and tell the user where things stand.` };
  }

  if (role === 'fork') {
    if (leadContext != null && leadContext > FORK_MAX_CONTEXT) return { prefix: 'model', reason: `a fork copies this whole conversation (~${Math.round(leadContext / 1000)}k tokens) into every step it takes. Dispatch a named role agent with a short packet instead.` };
    return null;
  }

  if (f === 'fable' && !['max5', 'max20', 'team'].includes(tier) && !/^\s*APPROVED BY USER:\s*fable/mi.test(prompt)) {
    return { prefix: 'model', reason: `Fable is not included in this plan (${tier}) and spends the user's credits. Ask the user first; if they say yes, add the line "APPROVED BY USER: fable" to the packet.` };
  }

  if (SWEEPERS.has(role)) {
    if (!f) return { prefix: 'model', reason: `${role} runs on this conversation's own model unless one is named. Resend with model: "haiku" for a read-only sweep, or "sonnet" if it must reason — or do a small search yourself with Grep and Glob.` };
    if (rank(model) < rank('sonnet')) return { prefix: 'model', reason: `${role} on ${f} is a sweep on a judgment model. Resend with model: "sonnet" or "haiku".` };
    return null;
  }

  if (EXECUTORS.has(role) && f && rank(model) < rank('sonnet')) {
    const key = taskKey(prompt);
    const tried = dispatches.some(d => d && normalizeRole(d.agent) === role && d.key === key && rank(d.model === 'inherit' ? 'sonnet' : d.model) >= rank('sonnet'));
    if (!tried) {
      const g = grantCheck(userModel, f, prompt, userModel && userModel.taskId);
      if (g && g.allow) {
        // The grant is the reason this is allowed. Only here does a bind
        // belong: not for a judgment role (never reaches this branch), and
        // not for an executor a prior Sonnet attempt already cleared (the
        // `tried` branch above returns before this runs). `g.bind` is null
        // once the grant is already bound to this same id, so there is
        // nothing new to claim.
        return g.bind ? { grantBind: g.bind, at: userModel.at, family: f } : null;
      }
      if (g && g.deny) return { prefix: 'model', reason: g.reason };
      return { prefix: 'model', reason: `${role} starts on Sonnet: resend with model: "sonnet". Move this task to ${f} only after a Sonnet attempt at the same task fails its check, in a fresh dispatch with a short note of what failed. If the task is too big for Sonnet, split it instead. A grant works when the user names the model in their own message, to the lead directly, not in a packet; it covers one numeric TASK id.` };
    }
  }
  return null;
}

// ---- the workflow rules ------------------------------------------------------
// Scheduling belongs to the lead. The record that set these: one Sonnet helper
// dispatched as built-in general-purpose (no turn cap) made 274 model calls,
// reached 683k context, and started helpers of its own. Each rule names what to
// send instead.
//
//   nested       only a recorded coordinator may start a capped child
//   plan mode    helpers only read and return findings inline
//   uncapped     general-purpose/claude while capped role agents are installed
//   worktree     a Claude helper aimed at a worktree a live Codex worker holds
//   concurrency  two workers normally, three while a coordinator holds a slot
export const PLAN_READ_ROLES = new Set(['orch-researcher', 'orch-reviewer', 'Explore', 'Plan', 'claude-code-guide']);
export const UNCAPPED = new Set(['general-purpose', 'claude']);
export const COORDINATOR_CHILD_ROLES = new Set(['orch-implementer', 'orch-researcher', 'orch-reviewer', 'Explore']);

const nestedReason = 'this nested dispatch cannot be attributed to a recorded coordinator parent, so it is denied';

export function workflowDecision(input, ti, { policy = loadPolicy(), installed = 0, native = [], external = [], dispatches = [], files = new Map() } = {}) {
  const role = normalizeRole(ti.subagent_type || 'general-purpose');
  const prompt = String(ti.prompt || '');

  if (input && input.agent_id && policy.workers.nested !== 'allow') {
    if (policy.workers.nested === 'deny') {
      return { prefix: 'workers', reason: 'nested dispatches are disabled by policy.workers.nested=deny' };
    }
    const parent = nativeAgent(dispatches, files, input.agent_id);
    if (!parent || parent.depth == null) return { prefix: 'workers', reason: nestedReason };
    if (parent.role !== 'orch-coordinator') return { prefix: 'workers', reason: `only orch-coordinator may dispatch workers; recorded parent ${parent.agentId} is ${parent.role}` };
    if (!COORDINATOR_CHILD_ROLES.has(role)) return { prefix: 'workers', reason: `orch-coordinator may dispatch only orch-implementer, orch-researcher, orch-reviewer, or Explore; ${role} is not allowed` };
    if (!String(ti.model || '').trim()) return { prefix: 'workers', reason: 'a coordinator child must name its model' };
    if (parent.depth + 1 > 2) return { prefix: 'workers', reason: `nested dispatch depth ${parent.depth + 1} exceeds the depth-2 limit` };
  }

  if (input && input.permission_mode === 'plan') {
    if (!PLAN_READ_ROLES.has(role)) return { prefix: 'plan', reason: `the host is in Plan mode, where helpers only read. ${role} can change files. Send orch-researcher, orch-reviewer or Explore (with a model named) and ask for findings returned inline, or do the inspection yourself.` };
    if (ti.isolation === 'worktree' || /^\s*WHERE:.*worktree:\s*yes/mi.test(prompt) || /^\s*worktree:\s*yes/mi.test(prompt)) return { prefix: 'plan', reason: 'the host is in Plan mode: no worktrees. Remove the worktree and ask for read-only findings returned inline.' };
    if (/^\s*PROGRESS:/m.test(prompt)) return { prefix: 'plan', reason: 'the host is in Plan mode: helpers write no progress files. Remove the PROGRESS line and ask for findings returned inline; only the lead maintains the plan.' };
  }

  // Only once all six role agents are present: a partial script install still
  // falls back on general-purpose for a writing role (SKILL.md §0).
  if (UNCAPPED.has(role) && installed >= AGENT_NAMES.length && policy.workers.generalPurpose !== 'allow') {
    return { prefix: 'workers', reason: `${role} has no turn cap and can start helpers of its own. Send a capped role agent instead: orchestrate:orch-implementer (model "sonnet") to change code, orchestrate:orch-researcher or Explore (model "haiku") to find things, orchestrate:orch-reviewer to review. Or do a small task yourself.` };
  }

  const locked = lockedWorktreeIn(prompt, external);
  if (locked) return { prefix: 'workers', reason: `a Codex worker (${locked.task || 'task'}, pid ${locked.pid}) is still running in ${locked.worktree}. Two providers never work in one worktree at once: wait for it to exit, then send only the unfinished part.` };

  const busy = concurrencyDecision(role, { native, external, policy });
  if (busy) return { prefix: 'workers', reason: busy };
  return null;
}

// Which invocation this is. The documented hook payload carries `tool_use_id`
// alongside `session_id`, and that pair identifies one tool call exactly: two
// registrations of this hook see the same pair, and a genuine retry gets a new
// one. A host that sends no id falls back to a digest of the whole relevant
// payload, which is the same thing a byte at a time.
//
// The digest is a hash and never the text. The previous version wrote the first
// 200 characters of the packet into a file on disk to compare against — which,
// on a packet that had just been denied for carrying a credential, wrote the
// credential to disk.
export function eventId(input) {
  const ti = (input && input.tool_input) || {};
  const session = sanitizeId((input && input.session_id) || 'nosession');
  const toolUse = input && (input.tool_use_id || (input.tool_use && input.tool_use.id));
  if (toolUse) return `${session}:${sanitizeId(toolUse)}`;
  const digest = createHash('sha256')
    .update(JSON.stringify({
      a: String(ti.subagent_type || ''),
      m: String(ti.model || ''),
      d: String(ti.description || ''),
      p: String(ti.prompt || ''),
      b: Boolean(ti.run_in_background),
    }))
    .digest('hex').slice(0, 32);
  return `${session}:${digest}`;
}

export const EVENTS_PATH = join(DIR, 'dispatch-events.json');
export const EVENT_TTL_MS = 86400000;
export const EVENTS_MAX = 400;

// Re-exported so a caller that imported the object-keyed form from here still
// gets it; the guard's own dedupe below no longer uses it. Up to 20 concurrent
// subagents is a documented, ordinary case here, and a read-modify-write JSON
// store — even an atomically-renamed one — can lose an update when two of
// those dispatches' PreToolUse hooks race it: whichever writes second wins,
// and the first dispatch's event can vanish from the record. `seenRecently`/
// `recordSeen` (`lib/tier.mjs`) replace it with an append-only log: a
// concurrent writer only ever adds its own line, so there is nothing to race.
export { markSeen } from './lib/tier.mjs';

function seenBefore(id) {
  const now = Date.now();
  try {
    const seen = seenRecently(EVENTS_PATH, id, now, EVENT_TTL_MS);
    recordSeen(EVENTS_PATH, id, now);
    // Trimming is a read-modify-write; done rarely so it is never what a
    // concurrent dispatch races against. Losing this particular race only
    // delays the trim, never a record.
    if (Math.random() < 0.02) trimLog(EVENTS_PATH, EVENTS_MAX);
    return seen;
  } catch { return false; }
}

function emit(obj) {
  process.stdout.write(JSON.stringify(obj));
}

// A price, said once, before the spend. Measured from this machine's own past
// runs when there are any; labelled reasoned when there are not; absent when
// neither exists, including when the packet named no model at all.
//
// It carries NO `permissionDecision`. `allow` alongside `additionalContext` is
// documented and would work, and it would also auto-approve every dispatch and
// take away the user's permission prompt — a silent change to a default nobody
// asked to change.
export function tagFor(ti) {
  try {
    const role = String(ti.subagent_type || 'claude');
    const model = String(ti.model || '');
    if (!model) return '';
    return priceTag(role, model, readCosts(), detectTier().tier, readJson(PROFILE_PATH));
  } catch { return ''; }
}

// Roles that write their own findings to disk mid-task and can be cut off by
// a turn cap or a usage limit before they return: a capped return with no
// PROGRESS line has nothing on disk for a fresh dispatch to resume from. Not
// orch-reviewer (returns a verdict, not partial work) and not orch-coordinator
// (its own packet is the lead's business, not a worker's).
export const AUTHOR_ROLES = new Set(['orch-planner', 'orch-implementer', 'orch-researcher', 'orch-browser', 'orch-debugger']);

// A fact, not a denial: Plan mode already forbids a PROGRESS line (its own
// rule above), so this says nothing there. Elsewhere, an author-role packet
// with no PROGRESS line is named as what it is before the dispatch happens,
// since M4's two worst-shaped helpers had none and nothing told the lead.
export function progressFact(role, prompt, planMode) {
  if (planMode) return '';
  if (!AUTHOR_ROLES.has(normalizeRole(role))) return '';
  if (/^\s*PROGRESS:\s*\S+/m.test(String(prompt || ''))) return '';
  return 'no PROGRESS line: a capped return will have nothing to resume from';
}

// The run this packet belongs to: the `RUN:` line a coordinated packet carries,
// or the run this session is bound to. The ledger resolves a return from this,
// rather than from whichever run on the machine happens to be newest.
export function runFor(input, ti) {
  const named = (/^\s*RUN:\s*(\S+)/m.exec(String(ti.prompt || '')) || [])[1];
  if (named) return named;
  const bound = sessionRun(input.session_id);
  return bound ? bound.runId : null;
}

const round2 = n => Math.round(Number(n) * 100) / 100;

// The run object this dispatch bills against, so the gate can read its budget
// ceiling and spend so far. Resolved the way a return is: the session binding
// first, then a run named in the packet or the one open run in the repo, then
// the machine's last-opened run as a hint for a session working above its repo.
// This is a read, never a write, so the last-opened hint is allowed here where
// it is refused for filing a return — *except* for the budget gate, whose
// caller passes `forBudget: true`. The pointer names whichever run was opened
// last on this whole machine, which can belong to a repo this dispatch has
// nothing to do with; enforcing its ceiling denied dispatches against a
// stranger repo's budget. Everywhere the pointer is shown rather than
// enforced (`router.mjs`'s "candidate, not bound") already hedges it; the gate
// is the one caller that would otherwise have treated it as authoritative.
export function resolveRunObj(input, ti, { forBudget = false } = {}) {
  const bound = sessionRun(input.session_id);
  if (bound) return bound;
  const named = (/^\s*RUN:\s*(\S+)/m.exec(String(ti.prompt || '')) || [])[1];
  const root = findRepoRoot(input.cwd);
  if (root) {
    if (named) { const hit = runsUnder(root).find(r => r.runId === named); if (hit) return hit; }
    const open = openRunsUnder(root);
    if (open.length === 1) return open[0];
  }
  if (forBudget) return null;
  return activeRunPointer();
}

// The pure arithmetic of the gate, so it can be tested without a machine's cost
// history: does spend-so-far plus this dispatch cross the ceiling? Null when
// there is nothing to decide (no ceiling, or no price for this dispatch).
export function overCeiling(already, est, ceiling) {
  if (ceiling == null || est == null) return null;
  const total = (Number(already) || 0) + Number(est);
  return total > ceiling
    ? { already: round2(Number(already) || 0), est: round2(Number(est)), total: round2(total), ceiling }
    : null;
}

// Would this dispatch push the run past its budget ceiling? Null when there is
// nothing to gate on: no model named (so no price), no run resolved, or no
// ceiling set. Otherwise the numbers the deny reason needs.
export function budgetDecision(input, ti, run = resolveRunObj(input, ti, { forBudget: true })) {
  const model = String(ti.model || '');
  if (!model) return null;
  if (!run || !run.budget || run.budget.ceiling == null) return null;
  const est = estimateDollars(String(ti.subagent_type || 'claude'), model, readCosts());
  const over = overCeiling(Number(run.spend) || 0, est, run.budget.ceiling);
  return over ? { runId: run.runId, ...over } : null;
}

function main() {
  let payload = '';
  try { payload = readFileSync(0, 'utf8'); } catch {}
  let input = null;
  try { input = JSON.parse(payload); } catch { return; }
  // The dispatch tool is named `Agent` in every build seen so far; `Task` is
  // matched too so a host that renames it does not silently stop being guarded
  // and priced — the hooks.json/SKILL.md matcher accepts both for the same reason.
  if (!input || (input.tool_name !== 'Agent' && input.tool_name !== 'Task')) return;

  const ti = input.tool_input || {};

  // The credential decision, first, on every invocation. A repeat of a denied
  // request is denied again: the answer cannot depend on how recently the same
  // request was asked.
  const d = decide(input);
  const id = eventId(input);
  const repeat = seenBefore(id);

  if (d.kind === 'deny') {
    if (!repeat) recordDenial(input, ti);
    emit({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: `orchestrate guard: ${d.reason}` } });
    return;
  }

  // The workflow rules, then the model rule, on every invocation for the same
  // reason: a retry of a denied dispatch must be denied again unless it changed.
  // A repeat of this same tool call is not a second worker.
  let m = null;
  try {
    const state = loadSession(input.session_id) || {};
    const policy = loadPolicy();
    const dispatches = Array.isArray(state.dispatches) ? state.dispatches : [];
    const files = helperFiles(input.transcript_path);
    const native = repeat ? [] : runningNative(dispatches, {
      returned: Array.isArray(state.returned) ? state.returned : [],
      files,
      staleMin: policy.workers.staleMin,
    });
    m = workflowDecision(input, ti, { policy, installed: agentsInstalled().installed, native, external: runningExternal(), dispatches, files });
  } catch {
    let unrestricted = false;
    try { unrestricted = loadPolicy().workers.nested === 'allow'; } catch {}
    m = input && input.agent_id && !unrestricted ? { prefix: 'workers', reason: nestedReason } : null;
  }
  if (m) {
    if (!repeat) recordDenial(input, ti, `${m.prefix}: ${m.reason.split('.')[0]}`);
    emit({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: `orchestrate ${m.prefix}: ${m.reason}` } });
    return;
  }
  // A grant the caller should claim once every later gate also passes — never
  // set from a judgment-role dispatch or an executor a prior Sonnet attempt
  // already cleared, since modelDecision only returns this shape from the
  // one branch where the grant is the actual reason a dispatch is allowed.
  let grantToClaim = null;
  try {
    const state = loadSession(input.session_id) || {};
    const userModel = state.userModel || null;
    const boundId = userModel ? readGrantId(input.session_id, userModel.at) : null;
    m = modelDecision(ti, {
      tier: detectTier().tier,
      dispatches: Array.isArray(state.dispatches) ? state.dispatches : [],
      leadContext: normalizeRole(ti.subagent_type) === 'fork' ? lastContextTokens(input.transcript_path) : null,
      quota: readQuota(),
      userModel: userModel ? { ...userModel, taskId: boundId } : null,
    });
    if (m && m.grantBind) { grantToClaim = m; m = null; }
  } catch { m = null; grantToClaim = null; }
  if (m) {
    if (!repeat) recordDenial(input, ti, `${m.prefix}: ${m.reason.split('.')[0]}`);
    emit({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: `orchestrate ${m.prefix}: ${m.reason}` } });
    return;
  }

  // The spend gate, a decision like the credential check: computed every time on
  // the live ceiling, so raising the budget in RUN.md lets the next attempt
  // through with no separate acknowledgement. It holds even inside an autonomous
  // /goal loop, because the loop cannot spend past a PreToolUse deny — the one
  // stop the compliance evidence says actually works.
  const b = budgetDecision(input, ti);
  if (b) {
    emit({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: `orchestrate budget: this ${String(ti.subagent_type || 'dispatch')} is about $${b.est} at list price, and run ${b.runId} has already spent about $${b.already}, so it would cross the $${b.ceiling} ceiling. Raise the ceiling in the run's Budget section, or stop — nothing tightens or lifts it on its own.` } });
    return;
  }

  // Bind only now, after every gate that could still refuse this dispatch has
  // passed — a budget refusal must not burn the grant. The claim is atomic
  // (see claimGrantId): a second dispatch racing this one for the same grant
  // either creates the file first, or reads back the id this one just wrote.
  // claimOrDeny checks who actually won: the loser of that race (or a reader
  // that caught an empty claim file mid-write) must be denied here, the same
  // way every other model denial is — not silently let through.
  if (grantToClaim) {
    const gd = claimOrDeny(input.session_id, grantToClaim);
    if (gd) {
      if (!repeat) recordDenial(input, ti, `${gd.prefix}: ${gd.reason.split('.')[0]}`);
      emit({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: `orchestrate ${gd.prefix}: ${gd.reason}` } });
      return;
    }
  }

  // Past here it is one real dispatch, and the side effects run once for it.
  // This hook can be registered twice (skill frontmatter plus settings.json).
  if (repeat) return;
  recordDispatch(input, ti);
  let tag = tagFor(ti);
  const size = String(ti.prompt || '').length;
  if (size > PACKET_WARN_CHARS) tag = `${tag ? `${tag}; ` : ''}this packet is ${size} characters and is re-read on every step the agent takes; point at path:line ranges instead of pasting content`;
  const pf = progressFact(ti.subagent_type, ti.prompt, input.permission_mode === 'plan');
  if (pf) tag = `${tag ? `${tag}; ` : ''}${pf}`;
  if (tag) emit({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: `orchestrate guard: ${tag}` } });
}

function withSession(input, fn) {
  try {
    const id = input.session_id;
    if (!id) return;
    const state = loadSession(id) || { v: 1, session_id: id, cwd: input.cwd || '', started: new Date().toISOString(), prompts: 0, cardSent: false, muted: false, limits: [] };
    fn(state);
    saveSession(state);
  } catch {}
}

// One line per dispatch in the session state, for the ledger. Never throws; a
// missing session file just means no router ran here.
function recordDispatch(input, ti) {
  withSession(input, state => {
    state.dispatches = Array.isArray(state.dispatches) ? state.dispatches : [];
    if (state.dispatches.length > 200) state.dispatches = state.dispatches.slice(-200);
    state.dispatches.push({
      at: new Date().toISOString(),
      agent: String(ti.subagent_type || 'claude'),
      // `inherit` means the packet named no model, so the subagent ran on
      // whatever the session was on. It is reported that way, never resolved to
      // a guess.
      model: String(ti.model || 'inherit'),
      task: (/^\s*TASK:\s*(\S+)/m.exec(String(ti.prompt || '')) || [])[1] || null,
      key: taskKey(ti.prompt),
      // Links this record to the helper's own transcript (subagents/*.meta.json
      // carries the same id), which is how "still running" is judged.
      toolUseId: input.tool_use_id ? String(input.tool_use_id) : null,
      // Where the agent keeps its progress, so work stopped by a usage limit is
      // found from disk rather than by resuming the stopped agent.
      progress: (/^\s*PROGRESS:\s*(\S+)/m.exec(String(ti.prompt || '')) || [])[1] || null,
      run: runFor(input, ti),
      ...(input.agent_id ? { parent: String(input.agent_id) } : {}),
    });
    state.lastDispatchAt = state.dispatches[state.dispatches.length - 1].at;
  });
}

// Denied attempts are kept apart from dispatched work: a denial is not a
// dispatch, and counting it as one made the ledger claim work that never ran.
// No packet text is stored — the reason a packet was denied is that it held
// something that must not be written down.
function recordDenial(input, ti, reason = 'credential-shaped text in the packet') {
  withSession(input, state => {
    state.denials = Array.isArray(state.denials) ? state.denials : [];
    if (state.denials.length > 50) state.denials = state.denials.slice(-50);
    state.denials.push({
      at: new Date().toISOString(),
      agent: String(ti.subagent_type || 'claude'),
      model: String(ti.model || 'inherit'),
      reason,
    });
  });
}

// Only when run as a hook, not when a test imports the pure functions above.
if (process.argv[1] && resolvePath(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch {}
  process.exit(0);
}
