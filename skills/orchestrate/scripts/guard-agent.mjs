#!/usr/bin/env node
// guard-agent.mjs — a PreToolUse hook on the Agent tool. It holds the money
// rules mechanically, keeps credentials out of packets, and records every
// dispatch so the ledger and the router can see what this session spent.
//
// v2 changes the expensive case. Past the daily Fable cap the hook used to
// deny, which stalled a run mid-plan and cost a human turn to unstick. Now it
// *allows* the dispatch with `updatedInput` rewriting the model to opus, and
// says so in `additionalContext`, so the run continues on the cheaper model and
// the downgrade is visible rather than silent.
//
// Rules:
//   - any model: a packet that looks like it carries a credential is denied.
//   - pro / api / team / unknown tier: model "fable" is denied without an
//     opt-in for today (`node profile.mjs --fable-optin`). There is no safe
//     rewrite here: the user has to decide to spend.
//   - max5 / max20: at most 3 / 6 fable dispatches a day, then rewrite to opus.
//
// Registered by `node scripts/install.mjs --with-hook`. Reads the hook payload
// on stdin, prints one JSON object or nothing, always exits 0.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DIR, FABLE_CAPS, readJson, today, detectTier, optedInToday, loadSession, saveSession,
} from './lib/tier.mjs';

const CRED = /\b(sk-ant-[A-Za-z0-9_-]{8,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/;

export function decide(input, env) {
  const ti = (input && input.tool_input) || {};
  const model = String(ti.model || '').toLowerCase();
  const prompt = String(ti.prompt || '');

  if (CRED.test(prompt)) {
    return { kind: 'deny', reason: 'the packet contains something that looks like a credential; remove it and refer to it by name instead' };
  }
  if (!/fable/.test(model)) return { kind: 'pass' };
  if (env.optedIn) return { kind: 'pass' };

  const tier = env.tier;
  if (tier === 'pro' || tier === 'api' || tier === 'team' || tier === 'unknown') {
    return { kind: 'deny', reason: `tier is ${tier}: Fable bills usage credits (or the tier is unknown). Ask the user; if they opt in for today run: node "${env.skillDir}/scripts/profile.mjs" --fable-optin` };
  }
  const cap = FABLE_CAPS[tier];
  if (cap && env.fableCount >= cap) {
    return {
      kind: 'downgrade',
      model: 'opus',
      reason: `${env.fableCount} Fable dispatches already today on ${tier} (cap ${cap}). Dispatching on opus instead. If Fable is the right call here, opt in for today: node "${env.skillDir}/scripts/profile.mjs" --fable-optin`,
    };
  }
  return { kind: 'count' };
}

function emit(obj) {
  process.stdout.write(JSON.stringify(obj));
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
  const SKILL_DIR = resolvePath(dirname(fileURLToPath(import.meta.url)), '..').split('\\').join('/');

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

  const tier = detectTier().tier;
  const counterPath = join(DIR, `fable-count-${today()}.json`);
  const counter = readJson(counterPath) || { count: 0 };
  const env = { tier, fableCount: Number(counter.count) || 0, optedIn: optedInToday(), skillDir: SKILL_DIR };
  const d = decide(input, env);

  recordDispatch(input, ti, d);

  if (d.kind === 'deny') {
    emit({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: `orchestrate guard: ${d.reason}` } });
    return;
  }
  if (d.kind === 'downgrade') {
    emit({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        permissionDecisionReason: `orchestrate guard: ${d.reason}`,
        updatedInput: { ...ti, model: d.model },
        additionalContext: `orchestrate guard: this dispatch was moved from fable to ${d.model}. ${d.reason} Record the downgrade in the ledger row; judge the return on its evidence, not on the model.`,
      },
    });
    return;
  }
  if (d.kind === 'count') {
    try { mkdirSync(DIR, { recursive: true }); writeFileSync(counterPath, JSON.stringify({ count: env.fableCount + 1, date: today() }) + '\n'); } catch {}
  }
}

// One line per dispatch in the session state, for the ledger and the meter.
// Never throws; a missing session file just means no router ran here.
function recordDispatch(input, ti, d) {
  try {
    const id = input.session_id;
    if (!id) return;
    const state = loadSession(id) || { v: 1, session_id: id, cwd: input.cwd || '', started: new Date().toISOString(), prompts: 0, cardSent: false, muted: false, hints: [], limits: [] };
    state.dispatches = Array.isArray(state.dispatches) ? state.dispatches : [];
    if (state.dispatches.length > 200) state.dispatches = state.dispatches.slice(-200);
    state.dispatches.push({
      at: new Date().toISOString(),
      agent: String(ti.subagent_type || 'claude'),
      model: d.kind === 'downgrade' ? d.model : String(ti.model || 'inherit'),
      requested: String(ti.model || 'inherit'),
      task: (/^\s*TASK:\s*(\S+)/m.exec(String(ti.prompt || '')) || [])[1] || null,
      decision: d.kind,
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
