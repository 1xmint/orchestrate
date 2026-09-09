#!/usr/bin/env node
// guard-agent.mjs — a PreToolUse hook on the Agent tool. Two jobs, both
// mechanical: keep credentials out of packets, and record every dispatch so the
// ledger and `measure.mjs` can report what actually ran.
//
// It has no opinion about which model a task deserves. It used to: it capped
// Fable at three dispatches a day and rewrote the model past that. That was
// wrong twice over. A count answers "how many have you done" when the only
// question worth asking is "is this task worth it", and a cap reads as an
// allowance, so it invites spending up to it. This file's own reference already
// said dispatch counts are a poor proxy for tokens.
//
// Model choice is the manager's judgment, with the user's plan in front of it
// and the user asked whenever the right model is not included in that plan.
// references/routing.md holds the reasoning. A number cannot do that job, so
// this file no longer pretends to.
//
// Registered by `node scripts/install.mjs --with-hook`. Reads the hook payload
// on stdin, prints one JSON object or nothing, always exits 0.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DIR, readJson, loadSession, saveSession, detectTier, PROFILE_PATH } from './lib/tier.mjs';
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

// Deny, or pass. There is no third answer: this hook never rewrites a dispatch
// and never blocks one over its model.
export function decide(input) {
  const ti = (input && input.tool_input) || {};
  const prompt = String(ti.prompt || '');

  if (CRED.test(prompt)) {
    return { kind: 'deny', reason: 'the packet contains something that looks like a credential; remove it and refer to it by name instead' };
  }
  return { kind: 'pass' };
}

function emit(obj) {
  process.stdout.write(JSON.stringify(obj));
}

// A price, said once, before the spend. Measured from this machine's own past
// runs when there are any; labelled reasoned when there are not.
//
// It carries NO `permissionDecision`. `allow` alongside `additionalContext` is
// documented and would work, and it would also auto-approve every dispatch and
// take away the user's permission prompt — a silent change to a default nobody
// asked to change. The guard's answer stays deny-or-pass; the tag is only
// information travelling next to a pass.
export function tagFor(ti) {
  try {
    const role = String(ti.subagent_type || 'claude');
    const model = String(ti.model || 'inherit');
    return priceTag(role, model, readCosts(), detectTier().tier, readJson(PROFILE_PATH));
  } catch { return ''; }
}

function main() {
  let payload = '';
  try { payload = readFileSync(0, 'utf8'); } catch {}
  let input = null;
  try { input = JSON.parse(payload); } catch { return; }
  if (!input || input.tool_name !== 'Agent') return;

  const ti = input.tool_input || {};
  const model = String(ti.model || '').toLowerCase();
  const prompt = String(ti.prompt || '');

  // The hook can be registered twice (skill frontmatter plus settings.json).
  // The same payload within a few seconds is the same dispatch: act once.
  const sig = `${input.session_id || ''}|${ti.subagent_type || ''}|${model}|${prompt.length}|${prompt.slice(0, 200)}`;
  try {
    const seenPath = join(DIR, 'last-dispatch.json');
    const seen = readJson(seenPath);
    const now = Date.now();
    if (seen && seen.sig === sig && now - seen.ts < 5000) return;
    mkdirSync(DIR, { recursive: true });
    writeFileSync(seenPath, JSON.stringify({ sig, ts: now }) + '\n');
  } catch {}

  const d = decide(input);
  recordDispatch(input, ti);

  if (d.kind === 'deny') {
    emit({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: `orchestrate guard: ${d.reason}` } });
    return;
  }
  const tag = tagFor(ti);
  if (tag) emit({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: `orchestrate guard: ${tag}` } });
}

// One line per dispatch in the session state, for the ledger and the meter.
// Never throws; a missing session file just means no router ran here.
function recordDispatch(input, ti) {
  try {
    const id = input.session_id;
    if (!id) return;
    const state = loadSession(id) || { v: 1, session_id: id, cwd: input.cwd || '', started: new Date().toISOString(), prompts: 0, cardSent: false, muted: false, hints: [], limits: [] };
    state.dispatches = Array.isArray(state.dispatches) ? state.dispatches : [];
    if (state.dispatches.length > 200) state.dispatches = state.dispatches.slice(-200);
    state.dispatches.push({
      at: new Date().toISOString(),
      agent: String(ti.subagent_type || 'claude'),
      // `inherit` means the packet named no model, so the subagent ran on
      // whatever the session was on. The meter reports it that way rather than
      // guessing.
      model: String(ti.model || 'inherit'),
      task: (/^\s*TASK:\s*(\S+)/m.exec(String(ti.prompt || '')) || [])[1] || null,
    });
    state.lastDispatchAt = state.dispatches[state.dispatches.length - 1].at;
    saveSession(state);
  } catch {}
}

// Only when run as a hook, not when a test imports the pure functions above.
if (process.argv[1] && resolvePath(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch {}
  process.exit(0);
}
