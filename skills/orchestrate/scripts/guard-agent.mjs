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
import { join, dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DIR, readJson, sanitizeId, findRepoRoot, loadSession, saveSession, detectTier, sessionRun, seenRecently, recordSeen, trimLog, FAMILY_ORDER, lastContextTokens, agentsInstalled } from './lib/tier.mjs';
import { loadPolicy } from './lib/policy.mjs';
import { reviewOfIn } from './lib/review-of.mjs';
import { roleModel, helperFiles, runningNative, runningExternal, freshCodexOk, providerStatePath, exhaustedFor, WORKERS_DIR } from './lib/workers.mjs';
import { family, normalizeRole, costLabel, estimateDollars, SOLO_RATIO } from './lib/prices.mjs';
import { readCosts } from './ledger.mjs';
import { readProject, projectPath, nextSteps } from './lib/project.mjs';
import { readQuota, resetClock, HELPER_STOP_FIVE_HOUR, HELPER_STOP_WEEK } from './lib/quota.mjs';
import { taskIdIn } from './lib/task-id.mjs';
import { PLAN_READ_ROLES, UNCAPPED, COORDINATOR_CHILD_ROLES, WORKTREE_ISOLATED_ROLES, nestedReason, workflowDecision } from './lib/workflow.mjs';
import { tagFor, runFor, resolveRunObj, overCeiling, budgetDecision, effectiveModel } from './lib/spend-gate.mjs';

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
  '-----BEGIN [A-Z ]*PRIVATE KEY-----',
].join('|'));

// A name followed by a value. The value is judged, not just matched: a line of
// code that reads the secret from somewhere else is not a secret. Quoted, a
// literal of eight or more characters is one unless it is an obvious placeholder.
const ASSIGN = /(?:password|passwd|pwd|secret|api[_-]?key|access[_-]?token)\s*[=:]\s*(["']?)([^\s"'<>]{8,})/gi;
const PLACEHOLDER = /^(?:x+|\*+|\.+|-+|changeme|change_me|placeholder|redacted|example|your[-_]?\w*|\$\{?\w+\}?)$/i;
// A quoted value that says it is made up for a test is not a secret.
const MADE_UP = /test|example|placeholder|dummy|fake|sample|changeme/i;
function looksLikeSecret(quote, raw) {
  const v = raw.replace(/[;,]+$/, '');
  if (/^\$\{?\w+\}?$/.test(v) || PLACEHOLDER.test(v)) return false;
  if (quote) return !(MADE_UP.test(v) || /^(.)\1+$/.test(v));
  if (/^(?:process\.env\b|os\.environ\b|os\.getenv\b)/.test(v)) return false;
  if (/^[A-Za-z_][A-Za-z_.]*$/.test(v)) return false;
  if (/^[A-Za-z_][\w.]*\(/.test(v)) return false;
  return true;
}
function hasCredential(prompt) {
  if (CRED.test(prompt)) return true;
  for (const m of prompt.matchAll(ASSIGN)) if (looksLikeSecret(m[1], m[2])) return true;
  return false;
}

// Deny, or pass. There is no third answer.
export function decide(input) {
  const ti = (input && input.tool_input) || {};
  const prompt = String(ti.prompt || '');

  if (hasCredential(prompt)) {
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
// task; judgment roles (planner, reviewer, debugger) may use Opus, and the two
// verdict roles (reviewer, advisor) may not go below it. Built-in
// sweepers take the lead's model unless told, so they must be told. A fork
// copies the whole conversation into every step it takes. Fable on a plan that
// does not include it spends the user's money. And near the user's plan limit,
// a new helper is the one that gets cut off mid-edit.
// What a helper does, in words a person can read; role ids never go in a note.
const PLAIN_ROLES = { 'orch-implementer': 'a builder', 'orch-reviewer': 'a reviewer', 'orch-researcher': 'a researcher', 'orch-debugger': 'a fault-finder', 'orch-planner': 'a planner', 'orch-advisor': 'an advisor', 'orch-browser': 'a browser helper', 'orch-coordinator': 'a coordinator', Explore: 'a finder', 'general-purpose': 'a general helper', claude: 'a general helper', fork: 'a fork' };
export function plainRole(role) {
  const r = normalizeRole(String(role || 'claude'));
  return PLAIN_ROLES[r] || (/^orch-/.test(r) ? 'a helper' : r);
}
export const EXECUTORS = new Set(['orch-implementer', 'orch-researcher', 'orch-browser']);
export const SWEEPERS = new Set(['Explore', 'general-purpose', 'claude']);
// A verdict from a model weaker than Opus cannot be banked (STATE.md v0.16.1).
export const JUDGES = new Set(['orch-reviewer', 'orch-advisor']);
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
  const id = taskIdIn(p);
  if (id) return id;
  const first = p.split('\n').map(l => l.trim()).find(l => l && !HEADER_LINE.test(l)) || '';
  return first.toLowerCase().replace(/\s+/g, ' ').slice(0, 80);
}

// The packet's own numeric TASK id, or null — what a grant binds to. Distinct
// from taskKey: a grant needs an actual id, never a first-line fallback.
export function numericTaskId(prompt) {
  return taskIdIn(prompt);
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
// A grant the router marked `scope: 'run'` (the user named the family for
// every helper: "however many opus agents you need") allows any dispatch on
// that family, with or without an id, and binds nothing.
export function grantCheck(userModel, f, prompt, boundId = null) {
  if (!userModel || userModel.family !== f) return null;
  if (userModel.scope === 'run') return { allow: true, bind: null };
  const id = numericTaskId(prompt);
  if (!id) return null;
  if (!boundId) return { allow: true, bind: id };
  if (boundId === id) return { allow: true, bind: null };
  return { deny: true, reason: `the user named ${f} for task ${boundId}; this is task ${id} — ask them or start on Sonnet.` };
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
    return { prefix: 'model', reason: `the user named ${grantToClaim.family} for task ${won}; this is task ${grantToClaim.grantBind} — ask them or start on Sonnet.` };
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

  if (JUDGES.has(role) && f && rank(model) > rank('opus')) {
    return { prefix: 'model', reason: `${plainRole(role)} on ${f} gives a verdict nobody can rely on: it exists to catch what the author's model missed. Resend with model: "opus". If Opus is out for now, hold the merge and tell the user; a weaker review is not a pass.` };
  }

  if (SWEEPERS.has(role)) {
    if (!f) return { prefix: 'model', reason: `${plainRole(role)} runs on this conversation's own model unless one is named. Resend with model: "haiku" for a read-only sweep, or "sonnet" if it must reason — or do a small search yourself with Grep and Glob.` };
    if (rank(model) < rank('sonnet')) return { prefix: 'model', reason: `${plainRole(role)} on ${f} is a sweep on a judgment model. Resend with model: "sonnet" or "haiku".` };
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
      // The user named this model and only the id is missing: say that first,
      // not "resend with sonnet", which would override the user's own words.
      if (userModel && userModel.family === f && !userModel.taskId && !numericTaskId(prompt)) {
        return { prefix: 'model', reason: `the user named ${f}; add a TASK: line with a number (e.g. TASK: 1-1-0001) to the packet and resend. The grant covers that one task id.` };
      }
      return { prefix: 'model', reason: `${plainRole(role)} starts on Sonnet: resend with model: "sonnet". Move this task to ${f} only after a Sonnet attempt at the same task fails its check, in a fresh dispatch with a short note of what failed. If the task is too big for Sonnet, split it instead. A grant works when the user names the model in their own message, to the lead directly, not in a packet; it covers one numeric TASK id, or every helper when they said so ("however many opus agents you need").` };
    }
  }
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
export { PLAN_READ_ROLES, UNCAPPED, COORDINATOR_CHILD_ROLES, WORKTREE_ISOLATED_ROLES, workflowDecision } from './lib/workflow.mjs';
export { tagFor, runFor, resolveRunObj, overCeiling, budgetDecision } from './lib/spend-gate.mjs';

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


// Roles that write their own findings to disk mid-task and can be cut off by
// a turn cap or a usage limit before they return: a capped return with no
// PROGRESS line has nothing on disk for a fresh dispatch to resume from. Not
// orch-reviewer (returns a verdict, not partial work) and not orch-coordinator
// (its own packet is the lead's business, not a worker's).
export const AUTHOR_ROLES = new Set(['orch-planner', 'orch-implementer', 'orch-researcher', 'orch-browser', 'orch-debugger']);

// The subset whose capped return is partial work worth resuming from disk, so
// a missing PROGRESS line is worth a warning. orch-researcher and orch-browser
// are left out: their work is short and read-only, a fresh dispatch redoes it
// cheaply, and a live run showed the warning there as noise.
export const RESUME_ROLES = new Set(['orch-planner', 'orch-implementer', 'orch-debugger']);

// A short prompt that only points at a packet file ("Your packet is in
// <path>, lines ..." or "packet: <path>") carries no PROGRESS line itself
// even when the file it names does. Cheapest match first: a bare path token
// that follows the word "packet" up to its extension.
// The path may end a sentence ("...0085.md."), so trailing punctuation is
// left out of the token; the first "packet" in the prompt wins, which is the
// sentence that names the file.
const PACKET_PATH_RE = /\bpacket\b[^\n,]{0,40}?([^\s,]+?\.[A-Za-z0-9]+)(?=[.;:)]?(?:[,\s]|$))/i;

function packetPathFrom(prompt) {
  const m = PACKET_PATH_RE.exec(String(prompt || ''));
  return m ? m[1] : null;
}

// Every brief file a prompt names: the path after "packet", and any path with
// a folder in it ending .md or .txt (".../packets/9-30-0004.md", "brief file
// x/y.md"). Live notes R and V, 2026-09-30: a short prompt naming its brief was
// told it lacked three fields that were all in the file.
const NAMED_FILE_RE = /(?:^|[\s"'`(<])((?:[A-Za-z]:)?[\w.~-]*[\\/][\w.~\\/-]*\.(?:md|txt))(?=[\s"'`),.;:>]|$)/g;
export function namedFiles(prompt) {
  const text = String(prompt || '');
  const out = [];
  const p = packetPathFrom(text);
  if (p) out.push(p);
  // A PROGRESS path is where the helper will write, not a brief to read.
  for (const m of text.replace(/PROGRESS:\s*\S+/g, '').matchAll(NAMED_FILE_RE)) if (!out.includes(m[1])) out.push(m[1]);
  return out.slice(0, 3);
}
// The prompt plus every named file that can be read. unread is true when the
// prompt names a file and none of them could be read: then nothing is said
// about what the brief lacks, since the guard cannot see the brief.
export function briefText(prompt, readFile = readFileSync) {
  const text = String(prompt || '');
  const files = namedFiles(text);
  const read = [];
  for (const p of files) { try { read.push(String(readFile(p, 'utf8'))); } catch {} }
  return { text: [text, ...read].join('\n'), unread: files.length > 0 && read.length === 0 };
}

// A fact, not a denial: Plan mode already forbids a PROGRESS line (its own
// rule above), so this says nothing there. Elsewhere, an author-role packet
// with no PROGRESS line is named as what it is before the dispatch happens,
// since M4's two worst-shaped helpers had none and nothing told the lead.
//
// The prompt text is checked first and is the only check for the common case
// (a PROGRESS line inline): no file is ever opened then. Only when that check
// fails and the prompt names a packet file is that file opened and checked
// too, so a dispatch pointing at a packet on disk is not warned about a line
// that is right there, just not in the short prompt the guard first saw.
export function progressFact(role, prompt, planMode, readFile = readFileSync) {
  if (planMode) return '';
  if (!RESUME_ROLES.has(normalizeRole(role))) return '';
  const text = String(prompt || '');
  // Inline anywhere in the prompt, not only at a line start: a one-paragraph
  // dispatch writes "... at the end). PROGRESS: <path> (...)" mid-line.
  if (/(^|\s)PROGRESS:\s*\S+/.test(text)) return '';
  const brief = briefText(text, readFile);
  if (brief.unread || /(^|\s)PROGRESS:\s*\S+/.test(brief.text)) return '';
  return 'no PROGRESS line: a capped return will have nothing to resume from';
}

// What a building brief lacks, said as one fact in a fixed order: what the job
// is for (the FOR: line), a way to check it is done (DONE WHEN), a PROGRESS
// path. Same roles and same file-reading rule as progressFact, which it builds
// on; a fact, never an order. Replaces the PROGRESS-only sentence in the note.
export function missingFact(role, prompt, planMode, readFile = readFileSync) {
  if (planMode) return '';
  if (!RESUME_ROLES.has(normalizeRole(role))) return '';
  const brief = briefText(prompt, readFile);
  if (brief.unread) return '';
  const has = re => re.test(brief.text);
  const lacks = [];
  // The packet capitals anywhere, or the same label in any case at the start
  // of a line: a brief the lead wrote by hand says "For:" and "Done when:".
  if (!has(/(^|\s)FOR:\s*\S/) && !has(/^[ \t]*(?:for|objective|goal)\s*:\s*\S/im)) lacks.push('what it is for');
  if (!has(/(^|\s)DONE WHEN\b/) && !has(/^[ \t]*done[ -]when\b/im)) lacks.push('a check it is done');
  if (progressFact(role, prompt, planMode, readFile)) lacks.push('a PROGRESS path');
  return lacks.length ? `brief lacks: ${lacks.join(', ')}` : '';
}

// Size as a ruler, in no unit: this helper's estimate over the one its role
// usually is (the same role on the model its own agent file names, measured here
// when there are rows, else reasoned). Null when either figure is missing.
export function sizeRatio(role, model, rows = []) {
  const est = estimateDollars(role, model, rows);
  const usual = roleModel(role) ? estimateDollars(role, roleModel(role), rows) : null;
  return est == null || !usual ? null : est / usual;
}
export function sizePhrase(ratio) {
  if (ratio == null) return '';
  return ratio >= 1.35 ? `about ${Math.round(ratio * 10) / 10}x the usual size for this kind of helper`
    : ratio <= 0.74 ? 'smaller than the usual size for this kind of helper'
    : 'about the usual size for this kind of helper';
}

// A dollar figure is shown only when the run names a ceiling or billing is
// pay-per-use (tier api). Anything else, including a plan nobody could
// identify, is treated as a subscription: no dollars, no refusal, no ask.
export function dollarsShown(run) {
  try { return !!(run && run.budget && run.budget.ceiling != null) || detectTier().tier === 'api'; } catch { return false; }
}

// The dispatch note: a size on a subscription, the list-price estimate (plus a
// size when it is not the usual one) when a ceiling is set or billing is per use.
export function dispatchNote(ti, { pair = false, dollars = false } = {}) {
  try {
    const role = String(ti.subagent_type || 'claude');
    const model = effectiveModel(ti);
    if (!model) return '';
    const ph = sizePhrase(sizeRatio(role, model, readCosts()));
    if (dollars) {
      const t = estimateWording(tagFor(ti, { pair }));
      return ph && !ph.startsWith('about the usual') && t.includes('≈ $') ? `${t}; ${ph}` : t;
    }
    return ph ? `helper size: ${plainRole(role)} on ${family(model)}, ${ph}${pair ? `; a solo build in this chat is about 1/${SOLO_RATIO} of it` : ''}` : '';
  } catch { return ''; }
}

// A price is an estimate made before the work, never money spent. priceTag (in
// lib/prices.mjs) words it as a "price tag"; a live run had the lead repeat that
// to the user as what each helper had cost. Said here as what it is, for this
// one helper, at list price; a tag with no figure is left as it was.
export function estimateWording(tag) {
  const t = String(tag || '');
  if (!t.includes('≈ $')) return t;
  return t.replace(/^price tag: /, 'estimate before work, this helper: ').replace(', not subscription usage', '');
}

// A fact, not an order, said only on an orch-implementer dispatch: Codex was
// last probed inside CODEX_OK_FRESH_MS and answered signed in, and the account
// is not sitting out a usage limit right now. The guard never starts Codex to
// find this out — it only reads what codex-worker already recorded (see
// recordCodexOk in lib/workers.mjs). Stale, never probed, signed out, or
// exhausted all produce the same silence: no line.
export function codexFact(role, dir = WORKERS_DIR, now = Date.now()) {
  if (normalizeRole(role) !== 'orch-implementer') return '';
  const fresh = freshCodexOk(dir, now);
  if (!fresh) return '';
  const state = readJson(providerStatePath(dir));
  const list = state && Array.isArray(state.exhausted) ? state.exhausted : [];
  if (list.some(e => e && e.provider === 'codex' && exhaustedFor(e, dir, now))) return '';
  const hhmm = new Date(fresh.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return `Codex ok at ${hhmm}; Terra medium fits a bounded change with tests`;
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
    const agentsInfo = agentsInstalled();
    m = workflowDecision(input, ti, { policy, installed: agentsInfo.installed, missing: agentsInfo.missing, native, external: runningExternal(), dispatches, files });
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
    emit({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: `orchestrate budget: this ${String(ti.subagent_type || 'dispatch')} is estimated at $${b.est} at list price, and run ${b.runId} has spent about $${b.already}, so it would cross the $${b.ceiling} ceiling (${costLabel()}). Raise the ceiling in the run's Budget section, or stop — nothing tightens or lifts it on its own.` } });
    return;
  }

  // Before the first writing helper: the project page exists and has a next
  // step. A file check only; reading the lead's last message was a word check
  // and is gone. Its prefix is not "orchestrate guard:" because the lead fixes
  // this one itself in one step, so persist-check must not end auto-continue.
  const fhg = firstHelperGate(input);
  if (fhg) {
    if (!repeat) recordDenial(input, ti, 'first helper');
    emit({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: `orchestrate project: ${fhg}` } });
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
  // The solo/helper pair (round-9 audit Part C item 3): read before
  // recordDispatch pushes this dispatch, so "first" means no earlier
  // orch-implementer row, not "no earlier row including this one". Gated to
  // the first orch-implementer dispatch of a session with no run ledger
  // open, once — a later dispatch, or one made once a ledger is open, gets
  // today's tag only.
  let priorDispatches = [];
  try { const s = loadSession(input.session_id) || {}; priorDispatches = Array.isArray(s.dispatches) ? s.dispatches : []; } catch {}
  const isFirstImplementer = normalizeRole(ti.subagent_type) === 'orch-implementer'
    && !priorDispatches.some(row => normalizeRole(row.agent) === 'orch-implementer');
  const openRun = resolveRunObj(input, ti, { forBudget: true });
  const noLedgerOpen = !openRun;
  recordDispatch(input, ti);
  let tag = dispatchNote(ti, { pair: isFirstImplementer && noLedgerOpen, dollars: dollarsShown(openRun) });
  const size = String(ti.prompt || '').length;
  if (size > PACKET_WARN_CHARS) tag = `${tag ? `${tag}; ` : ''}this packet is ${size} characters and is re-read on every step the agent takes; point at path:line ranges instead of pasting content`;
  const pf = missingFact(ti.subagent_type, ti.prompt, input.permission_mode === 'plan');
  if (pf) tag = `${tag ? `${tag}; ` : ''}${pf}`;
  const cf = codexFact(ti.subagent_type);
  if (cf) tag = `${tag ? `${tag}; ` : ''}${cf}`;
  if (asksForPastedContents(ti.prompt)) tag = `${tag ? `${tag}; ` : ''}this brief asks for contents to be pasted back: the hand-back is five lines, so ask for a file path instead`;
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

// A brief that asks for contents or output to come back in the hand-back.
export function asksForPastedContents(prompt) {
  return /\b(exact contents|paste|full output|report back the file)\b/i.test(String(prompt || ''));
}
// The first writing helper of a session in a repo, with no run bound, waits for
// .orchestrator/PROJECT.md to exist with a filled Next step, so the plan the
// user sees is written before work starts. Returns a refusal reason or ''.
// Read-only roles are never held (grounding comes before the plan), and one
// sent first does not use the check up. A file check only: no transcript and
// no message is read. Refusing a repeat is the caller's (recordDenial).
const READ_ONLY_ROLES = new Set(['Explore', 'orch-researcher', 'orch-advisor', 'orch-planner', 'orch-reviewer', 'orch-browser', 'claude-code-guide', 'Plan']);
const canWrite = role => !READ_ONLY_ROLES.has(normalizeRole(role));
export function firstHelperGate(input) {
  try {
    const ti = (input && input.tool_input) || {};
    if (!canWrite(ti.subagent_type)) return '';
    const root = findRepoRoot(input.cwd);
    if (!root) return '';
    const state = loadSession(input.session_id) || {};
    const prior = Array.isArray(state.dispatches) ? state.dispatches : [];
    if (prior.some(d => d && canWrite(d.agent))) return '';
    if (sessionRun(input.session_id)) return '';
    const text = readProject(root);
    if (text != null && nextSteps(text).length) return '';
    const cmd = `node "${join(dirname(fileURLToPath(import.meta.url)), 'project.mjs')}" init "${root}"`;
    return `no project page yet: ${projectPath(root)} ${text == null ? 'is missing' : 'has no filled step under Next'}, and the first helper that can write waits for it. Create it with ${cmd}, then fill Next with 3 to 7 steps, each ending "→ what the user will be able to see or run". This dispatch goes through once Next has a step. This is routine set-up, not news for the user: don't mention it.`;
  } catch { return ''; }
}

// One line per dispatch in the session state, for the ledger. Never throws; a
// missing session file just means no router ran here.
function recordDispatch(input, ti) {
  const isReviewer = /reviewer/i.test(String(ti.subagent_type || ''));
  withSession(input, state => {
    state.dispatches = Array.isArray(state.dispatches) ? state.dispatches : [];
    if (state.dispatches.length > 200) state.dispatches = state.dispatches.slice(-200);
    state.dispatches.push({
      at: new Date().toISOString(),
      agent: String(ti.subagent_type || 'claude'),
      // `inherit` means the packet named no model AND the role has no file of
      // its own (general-purpose, claude, Explore, Plan) — the subagent ran
      // on whatever the session was on, and that is reported, never resolved
      // to a guess. A role with its own agent file (every orch-* role) runs
      // on that file's model whether or not the dispatch named one, so that
      // is what gets recorded; `modelFrom` says which of the three happened.
      model: effectiveModel(ti) || 'inherit',
      modelFrom: ti.model ? 'dispatch' : (effectiveModel(ti) ? 'role' : 'inherit'),
      task: taskIdIn(ti.prompt),
      key: taskKey(ti.prompt),
      // Links this record to the helper's own transcript (subagents/*.meta.json
      // carries the same id), which is how "still running" is judged.
      toolUseId: input.tool_use_id ? String(input.tool_use_id) : null,
      // Where the agent keeps its progress, so work stopped by a usage limit is
      // found from disk rather than by resuming the stopped agent.
      progress: (/^\s*PROGRESS:\s*(\S+)/m.exec(String(ti.prompt || '')) || [])[1] || null,
      run: runFor(input, ti),
      // Marks a task whose packet asked for independent review (money, auth,
      // destructive data, a contract others consume) so ledger.mjs can hold a
      // DONE return back until a reviewer return for this task exists. Only an
      // explicit REVIEW: yes line sets it: a word in the objective is not a
      // risk (live notes Q, V, 2026-09-30).
      ...(!isReviewer && /^\s*REVIEW:\s*yes\b/im.test(String(ti.prompt || '')) ? { review: true } : {}),
      // A reviewer's own packet names the task it reviews under "REVIEW OF:"
      // (packet.md). Recorded on the reviewer's own dispatch row so
      // turn-check.mjs can tell a review was actually sent for a tagged task
      // without re-reading any packet text. Only a reviewer's: a reviewer's
      // report holds a REVIEW OF line, and pasted into a fix builder's brief it
      // made that builder count as a look at the work.
      ...(isReviewer && reviewOfIn(ti.prompt) ? { reviewOf: reviewOfIn(ti.prompt) } : {}),
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
      model: effectiveModel(ti) || 'inherit',
      modelFrom: ti.model ? 'dispatch' : (effectiveModel(ti) ? 'role' : 'inherit'),
      reason,
    });
  });
}

// Only when run as a hook, not when a test imports the pure functions above.
if (process.argv[1] && resolvePath(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch {}
  process.exit(0);
}
