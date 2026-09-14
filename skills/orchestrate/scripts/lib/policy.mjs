// lib/policy.mjs — the few efficiency numbers every hook reads, with their
// defaults, from one place. Stored additively under `policy` in
// ~/.claude/orchestrate/profile.json; a file without it gets the defaults.
//
// These are working thresholds chosen for quota per unit of useful work, not
// claims about an exact optimal point. Each one is a number the user can change
// with `profile.mjs --policy key=value`.
//
// Self-contained (no import from tier.mjs), so lib/context.mjs can use it and
// tier.mjs can use lib/context.mjs without a cycle.

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const POLICY_V = 1;
export const POLICY_PROFILE_PATH = join(homedir(), '.claude', 'orchestrate', 'profile.json');

export const DEFAULT_POLICY = Object.freeze({
  v: POLICY_V,
  context: Object.freeze({
    // Prepare a checkpoint here, recommend compaction at the next safe boundary
    // here, or at `windowFraction` of a known smaller window, whichever is lower.
    checkpointAt: 120000,
    compactAt: 150000,
    hardAt: 300000,
    windowFraction: 0.75,
    // A known window size, when the user wants to state one; otherwise it is
    // read from the status line for the session, or left unknown.
    window: null,
    // A measurement older than this is not current.
    staleMs: 12 * 3600 * 1000,
  }),
  workers: Object.freeze({
    // Across providers: native helpers and external Codex workers together.
    maxConcurrent: 2,
    browserConcurrent: 1,
    // Only the capped coordinator may start a helper. "deny" closes nesting
    // entirely; "allow" preserves the host's unrestricted legacy behaviour.
    nested: 'coordinator',
    // Built-in general-purpose/claude helpers have no turn cap: denied while the
    // capped role agents are installed, unless set to "allow".
    generalPurpose: 'deny',
    // A dispatch with no return after this long no longer counts as running.
    staleMin: 45,
  }),
  codex: Object.freeze({
    enabled: true,
    // null uses the model in ~/.codex/config.toml.
    model: null,
    effortImplement: 'medium',
    effortHard: 'high',
    timeoutMin: 20,
  }),
});

const EFFORTS = new Set(['minimal', 'low', 'medium', 'high', 'xhigh']);

function readProfile(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

const posNum = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);

// The defaults with whatever valid values the profile overrides. An invalid
// value falls back to the default rather than breaking a hook.
export function loadPolicy(profile = readProfile(POLICY_PROFILE_PATH)) {
  const p = (profile && typeof profile.policy === 'object' && profile.policy) || {};
  const c = p.context || {}, w = p.workers || {}, x = p.codex || {};
  const D = DEFAULT_POLICY;
  const frac = Number(c.windowFraction);
  return {
    v: POLICY_V,
    context: {
      checkpointAt: posNum(c.checkpointAt, D.context.checkpointAt),
      compactAt: posNum(c.compactAt, D.context.compactAt),
      hardAt: posNum(c.hardAt, D.context.hardAt),
      windowFraction: frac > 0 && frac <= 1 ? frac : D.context.windowFraction,
      window: c.window == null ? null : posNum(c.window, null),
      staleMs: posNum(c.staleMs, D.context.staleMs),
    },
    workers: {
      maxConcurrent: Math.floor(posNum(w.maxConcurrent, D.workers.maxConcurrent)),
      browserConcurrent: Math.floor(posNum(w.browserConcurrent, D.workers.browserConcurrent)),
      nested: ['deny', 'allow', 'coordinator'].includes(w.nested) ? w.nested : D.workers.nested,
      generalPurpose: w.generalPurpose === 'allow' ? 'allow' : 'deny',
      staleMin: posNum(w.staleMin, D.workers.staleMin),
    },
    codex: {
      enabled: x.enabled !== false,
      model: typeof x.model === 'string' && x.model.trim() ? x.model.trim() : null,
      effortImplement: EFFORTS.has(x.effortImplement) ? x.effortImplement : D.codex.effortImplement,
      effortHard: EFFORTS.has(x.effortHard) ? x.effortHard : D.codex.effortHard,
      timeoutMin: posNum(x.timeoutMin, D.codex.timeoutMin),
    },
  };
}

// `context.compactAt=180000` style edits, validated against the defaults' keys.
export function setPolicyValue(profile, dotted, raw) {
  const [section, key, extra] = String(dotted || '').split('.');
  if (extra || !DEFAULT_POLICY[section] || typeof DEFAULT_POLICY[section] !== 'object' || !(key in DEFAULT_POLICY[section])) {
    throw new Error(`unknown policy key "${dotted}"; known: ${Object.entries(DEFAULT_POLICY).filter(([, v]) => typeof v === 'object').flatMap(([s, v]) => Object.keys(v).map(k => `${s}.${k}`)).join(', ')}`);
  }
  let value = raw;
  if (raw === 'null') value = null;
  else if (raw === 'true' || raw === 'false') value = raw === 'true';
  else if (raw !== '' && Number.isFinite(Number(raw))) value = Number(raw);
  const out = profile && typeof profile === 'object' ? profile : {};
  out.policy = out.policy && typeof out.policy === 'object' ? out.policy : {};
  out.policy.v = POLICY_V;
  out.policy[section] = out.policy[section] && typeof out.policy[section] === 'object' ? out.policy[section] : {};
  out.policy[section][key] = value;
  return out;
}
