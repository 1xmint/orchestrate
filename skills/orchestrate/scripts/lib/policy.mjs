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
    windowFraction: 0.75,
    // A known window size, when the user wants to state one; otherwise it is
    // read from the status line for the session, or left unknown.
    window: null,
    // A measurement older than this is not current.
    staleMs: 12 * 3600 * 1000,
    // After this many compactions in one session, a full conversation is
    // advised to start fresh from its checkpoint instead of compacting again.
    freshAfterCompactions: 2,
    // Say the measured size once per this much growth (0 turns it off).
    tickEvery: 25000,
    // Written once into settings.json by orchestrate; "off" opts out.
    autocompactDefault: 200000,
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
    // A dispatch with no transcript activity for this long no longer counts
    // as running, however long ago it was dispatched.
    staleMin: 10,
    // Each helper's own size budget in tokens: at warnAt and again at returnAt
    // the hook gives it one line of facts (size, turn, calls since its last
    // edit, progress file). Keyed by normalized role name; "default" is the
    // fallback for any role with no entry of its own.
    size: Object.freeze({
      default: Object.freeze({ warnAt: 80000, returnAt: 120000 }),
      'orch-coordinator': Object.freeze({ warnAt: 150000, returnAt: 200000 }),
    }),
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
// A {warnAt, returnAt} pair, valid only when warnAt < returnAt; an invalid or
// missing pair falls back to that role's own defaults, not the generic one.
const sizePair = (entry, fallback) => {
  if (!entry || typeof entry !== 'object') return { ...fallback };
  const warnAt = posNum(entry.warnAt, fallback.warnAt);
  const returnAt = posNum(entry.returnAt, fallback.returnAt);
  return warnAt < returnAt ? { warnAt, returnAt } : { ...fallback };
};
const autocompact = (v, d) => {
  if (v === 'off') return 'off';
  const m = /^(\d+)(k)?$/i.exec(String(v));
  return m && Number(m[1]) > 0 ? Number(m[1]) * (m[2] ? 1000 : 1) : d;
};

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
      windowFraction: frac > 0 && frac <= 1 ? frac : D.context.windowFraction,
      window: c.window == null ? null : posNum(c.window, null),
      staleMs: posNum(c.staleMs, D.context.staleMs),
      freshAfterCompactions: Math.floor(posNum(c.freshAfterCompactions, D.context.freshAfterCompactions)),
      tickEvery: c.tickEvery === 0 ? 0 : posNum(c.tickEvery, D.context.tickEvery),
      autocompactDefault: autocompact(c.autocompactDefault, D.context.autocompactDefault),
    },
    workers: {
      maxConcurrent: Math.floor(posNum(w.maxConcurrent, D.workers.maxConcurrent)),
      browserConcurrent: Math.floor(posNum(w.browserConcurrent, D.workers.browserConcurrent)),
      nested: ['deny', 'allow', 'coordinator'].includes(w.nested) ? w.nested : D.workers.nested,
      generalPurpose: w.generalPurpose === 'allow' ? 'allow' : 'deny',
      staleMin: posNum(w.staleMin, D.workers.staleMin),
      size: (() => {
        const userSize = w.size && typeof w.size === 'object' ? w.size : {};
        const out = {};
        for (const role of new Set([...Object.keys(D.workers.size), ...Object.keys(userSize)])) {
          const fallback = D.workers.size[role] || D.workers.size.default;
          out[role] = sizePair(userSize[role], fallback);
        }
        return out;
      })(),
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

// A role's token budget: warnAt to write progress and keep going, returnAt to
// start no new work and return PARTIAL. Pure; a role with no entry of its own
// gets "default". Strips a plugin prefix such as "orchestrate:" from the role name.
export function sizeBudget(role, policy = loadPolicy()) {
  const key = String(role || '').replace(/^[\w-]+:/, '');
  const size = (policy && policy.workers && policy.workers.size) || DEFAULT_POLICY.workers.size;
  return size[key] || size.default;
}

// `context.compactAt=180000` style edits, validated against the defaults' keys.
export function setPolicyValue(profile, dotted, raw) {
  const [section, key, ...rest] = String(dotted || '').split('.');
  // A size budget is set per role and field: workers.size.<role>.warnAt|returnAt.
  if (section === 'workers' && key === 'size') {
    const [role, field] = rest;
    if (rest.length !== 2 || !/^[\w-]+$/.test(role) || !['warnAt', 'returnAt'].includes(field) || !(Number(raw) > 0)) {
      throw new Error(`policy key "${dotted}" takes the form workers.size.<role>.warnAt or .returnAt with a positive token count`);
    }
    const out = profile && typeof profile === 'object' ? profile : {};
    out.policy = out.policy && typeof out.policy === 'object' ? out.policy : {};
    out.policy.v = POLICY_V;
    const w = out.policy.workers = out.policy.workers && typeof out.policy.workers === 'object' ? out.policy.workers : {};
    const size = w.size = w.size && typeof w.size === 'object' ? w.size : {};
    size[role] = { ...(size[role] && typeof size[role] === 'object' ? size[role] : {}), [field]: Number(raw) };
    return out;
  }
  const extra = rest.length > 0;
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
