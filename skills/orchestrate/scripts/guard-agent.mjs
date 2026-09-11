#!/usr/bin/env node
// guard-agent.mjs — a PreToolUse hook on the Agent tool. Two jobs, both
// mechanical: keep credentials out of packets, and record every dispatch so the
// ledger can report what actually ran.
//
// It has no opinion about which model a task deserves, and it never rewrites a
// dispatch. Model choice is the lead's judgment with the user's plan in front of
// it; a number cannot do that job, so this file does not try.
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

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DIR, readJson, sanitizeId, loadSession, saveSession, detectTier, PROFILE_PATH, sessionRun, findRepoRoot, runsUnder, openRunsUnder, activeRunPointer, seenRecently, recordSeen, trimLog } from './lib/tier.mjs';
import { priceTag, estimateDollars } from './lib/prices.mjs';
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

  // Past here it is one real dispatch, and the side effects run once for it.
  // This hook can be registered twice (skill frontmatter plus settings.json).
  if (repeat) return;
  recordDispatch(input, ti);
  const tag = tagFor(ti);
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
      run: runFor(input, ti),
    });
    state.lastDispatchAt = state.dispatches[state.dispatches.length - 1].at;
  });
}

// Denied attempts are kept apart from dispatched work: a denial is not a
// dispatch, and counting it as one made the ledger claim work that never ran.
// No packet text is stored — the reason a packet was denied is that it held
// something that must not be written down.
function recordDenial(input, ti) {
  withSession(input, state => {
    state.denials = Array.isArray(state.denials) ? state.denials : [];
    if (state.denials.length > 50) state.denials = state.denials.slice(-50);
    state.denials.push({
      at: new Date().toISOString(),
      agent: String(ti.subagent_type || 'claude'),
      model: String(ti.model || 'inherit'),
      reason: 'credential-shaped text in the packet',
    });
  });
}

// Only when run as a hook, not when a test imports the pure functions above.
if (process.argv[1] && resolvePath(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch {}
  process.exit(0);
}
