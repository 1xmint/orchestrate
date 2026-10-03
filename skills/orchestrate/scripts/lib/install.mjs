// lib/install.mjs — install detection, split out of lib/tier.mjs: which plan
// this account is on, and which role agents are installed (loose files or a
// plugin cache). No network, no child processes, never throws to a caller
// (returns null instead).

import { existsSync, readdirSync, statSync } from './node.mjs';
import { join } from 'node:path';
import { HOME, DIR, PROFILE_PATH, TIERS, readJson } from './tier.mjs';

export const AGENT_NAMES = ['orch-planner', 'orch-implementer', 'orch-researcher', 'orch-browser', 'orch-reviewer', 'orch-debugger', 'orch-coordinator', 'orch-advisor'];

export function mapTier(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const s = raw.toLowerCase();
  if (/max[_-]?20x|max20/.test(s)) return 'max20';
  if (/max[_-]?5x|max5/.test(s)) return 'max5';
  if (/(^|[^a-z])max([^a-z]|$)/.test(s)) return 'max5';
  if (/enterprise|team/.test(s)) return 'team';
  if (/\bpro\b|claude_pro|_pro_/.test(s)) return 'pro';
  return null;
}

// The tier keys sit under a nested account object whose shape has changed
// between versions, so look for them anywhere in the file, shallowly.
export function findKeys(obj, names, depth = 0, out = {}) {
  if (!obj || typeof obj !== 'object' || depth > 6) return out;
  for (const [k, v] of Object.entries(obj)) {
    if (names.includes(k) && v != null && !(k in out)) out[k] = v;
    else if (v && typeof v === 'object') findKeys(v, names, depth + 1, out);
  }
  return out;
}

// Which Claude account this session runs on. `~/.claude.json` describes the
// account a terminal `claude` last signed in with, and the Claude app keeps its
// own sign-in: on one machine the file described a Pro account used for a day
// while every desktop session ran on Max 5x. The desktop app names each
// session's account in its own folders (`claude-code-sessions/<account>/<org>/
// <host session id>.json`) and passes the host session id to hooks, so the org
// is known without reading any credential. Terminal sessions have no such
// record, and there the file is the account in use.
function appDirs() {
  const dirs = [];
  if (process.env.APPDATA) dirs.push(join(process.env.APPDATA, 'Claude'));
  dirs.push(join(HOME, 'AppData', 'Roaming', 'Claude'));
  dirs.push(join(HOME, 'Library', 'Application Support', 'Claude'));
  dirs.push(join(process.env.XDG_CONFIG_HOME || join(HOME, '.config'), 'Claude'));
  return [...new Set(dirs)];
}

export function sessionAccount(hostSessionId = process.env.CLAUDE_CODE_HOST_SESSION_ID) {
  if (!hostSessionId || !/^[\w-]{8,80}$/.test(hostSessionId)) return null;
  for (const dir of appDirs()) {
    const base = join(dir, 'claude-code-sessions');
    let accounts; try { accounts = readdirSync(base); } catch { continue; }
    for (const account of accounts) {
      let orgs; try { orgs = readdirSync(join(base, account)); } catch { continue; }
      for (const org of orgs) {
        if (existsSync(join(base, account, org, `${hostSessionId}.json`))) return { accountUuid: account, orgUuid: org };
      }
    }
  }
  return null;
}

const PLAN_KEYS = ['userRateLimitTier', 'organizationRateLimitTier', 'seatTier', 'organizationType'];

// The org this session runs on, and whether ~/.claude.json describes it.
export function currentAccount() {
  const cfg = readJson(join(HOME, '.claude.json'));
  const fileOrg = cfg ? findKeys(cfg, ['organizationUuid']).organizationUuid || null : null;
  const session = sessionAccount();
  const org = (session && session.orgUuid) || fileOrg;
  return { org: org || null, via: session ? 'desktop' : (fileOrg ? 'file' : null), fileOrg, fileDescribesSession: !session || !fileOrg || session.orgUuid === fileOrg, cfg };
}

export function detectTier() {
  const profile = readJson(PROFILE_PATH) || {};
  const acct = currentAccount();
  const plans = profile.plans && typeof profile.plans === 'object' ? profile.plans : {};
  const remembered = acct.org && plans[acct.org];
  if (remembered && remembered.tier !== 'unknown' && TIERS.includes(remembered.tier)) {
    return { tier: remembered.tier, source: `you set it for this Claude account (${acct.org.slice(0, 8)}) on ${String(remembered.setAt || '').slice(0, 10)}`, account: acct.org };
  }
  // A plan set by an older version, before plans were kept per account.
  if (profile.tier && profile.tier !== 'unknown' && TIERS.includes(profile.tier)) {
    return { tier: profile.tier, source: `user override set ${String(profile.setAt || '').slice(0, 10)} (${PROFILE_PATH})`, account: acct.org };
  }
  // `organizationType` ("claude_pro", "claude_max") is where current hosts put
  // the plan; the rate-limit tier can be a generic "default_claude_ai" that says
  // nothing. These fields are undocumented, so the source is always shown, and
  // the credentials file is never read.
  let filePlan = null;
  if (acct.cfg) {
    const found = findKeys(acct.cfg, PLAN_KEYS);
    for (const key of PLAN_KEYS) {
      const t = mapTier(found[key]);
      if (t) { filePlan = { tier: t, source: `~/.claude.json ${key}="${found[key]}"` }; break; }
    }
  }
  if (filePlan && acct.fileDescribesSession) return { ...filePlan, account: acct.org };
  if (!acct.fileDescribesSession) {
    return { tier: 'unknown', account: acct.org, source: `this session runs on a different Claude account (${acct.org.slice(0, 8)}) than ~/.claude.json describes${filePlan ? ` (that one is ${filePlan.tier})` : ''}; ask the user once which plan this account has, then profile.mjs --set tier=<pro|max5|max20|team|api>, which is remembered for this account` };
  }
  if (process.env.ANTHROPIC_API_KEY) return { tier: 'api', source: 'ANTHROPIC_API_KEY is set', account: acct.org };
  return { tier: 'unknown', source: 'no signal; ask the user once, then --set tier=...', account: acct.org };
}

export function routerSettings() {
  const p = readJson(PROFILE_PATH);
  const r = (p && p.router) || {};
  return { enabled: r.enabled !== false, haiku: r.haiku === true };
}

// A plugin install does not copy agent files into ~/.claude/agents; the host
// registers them from the plugin's own folder. Counting only the loose copies
// therefore reported "agents 0/6 (missing …)" on a working plugin install, and
// sent the model off to run install-agents.mjs, which would have created a
// second set that then shadowed the plugin's. Look in both places.
export function pluginAgentDir() {
  const base = join(HOME, '.claude', 'plugins', 'cache');
  // An update leaves the old version's cache directory in place alongside the
  // new one (nothing prunes it), so more than one version can have an agents
  // folder at once. Picking whichever `readdirSync` lists first read a stale
  // pre-update directory missing agents added since, and reported them
  // "missing" on an install that was actually complete. Score every version
  // found and keep the one with the most agent files present, newest
  // directory first on a tie, so a stale partial copy never outranks a
  // complete one.
  let best = null;
  try {
    for (const market of readdirSync(base)) {
      for (const plugin of readdirSync(join(base, market))) {
        for (const version of readdirSync(join(base, market, plugin))) {
          const d = join(base, market, plugin, version, 'skills', 'orchestrate', 'assets', 'agents');
          if (!existsSync(join(d, `${AGENT_NAMES[0]}.md`))) continue;
          const count = AGENT_NAMES.filter(n => existsSync(join(d, `${n}.md`))).length;
          let mtime = 0;
          try { mtime = statSync(d).mtimeMs; } catch {}
          if (!best || count > best.count || (count === best.count && mtime > best.mtime)) {
            best = { dir: d, count, mtime };
          }
        }
      }
    }
  } catch {}
  return best ? best.dir : null;
}

export function agentsInstalled() {
  const dir = join(HOME, '.claude', 'agents');
  const loose = AGENT_NAMES.filter(n => existsSync(join(dir, `${n}.md`)));
  if (loose.length === AGENT_NAMES.length) {
    return { installed: loose.length, expected: AGENT_NAMES.length, missing: [], dir, source: 'files' };
  }
  const pdir = pluginAgentDir();
  if (pdir) {
    const viaPlugin = AGENT_NAMES.filter(n => loose.includes(n) || existsSync(join(pdir, `${n}.md`)));
    return {
      installed: viaPlugin.length,
      expected: AGENT_NAMES.length,
      missing: AGENT_NAMES.filter(n => !viaPlugin.includes(n)),
      dir: pdir,
      source: 'plugin',
    };
  }
  return { installed: loose.length, expected: AGENT_NAMES.length, missing: AGENT_NAMES.filter(n => !loose.includes(n)), dir, source: 'files' };
}
