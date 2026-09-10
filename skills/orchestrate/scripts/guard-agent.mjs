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
import { DIR, readJson, writeJsonAtomic, sanitizeId, loadSession, saveSession, detectTier, PROFILE_PATH, sessionRun } from './lib/tier.mjs';
import { priceTag } from './lib/prices.mjs';
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

// Per session and per event, not one global "last dispatch". Two sessions
// dispatching at the same moment used to overwrite each other's single slot, so
// whichever wrote second was recorded twice and the first not at all.
export function markSeen(store, id, now = Date.now(), ttl = EVENT_TTL_MS, max = EVENTS_MAX) {
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

function seenBefore(id) {
  try {
    const { seen, store } = markSeen(readJson(EVENTS_PATH) || {}, id);
    writeJsonAtomic(EVENTS_PATH, store);
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

function main() {
  let payload = '';
  try { payload = readFileSync(0, 'utf8'); } catch {}
  let input = null;
  try { input = JSON.parse(payload); } catch { return; }
  if (!input || input.tool_name !== 'Agent') return;

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
