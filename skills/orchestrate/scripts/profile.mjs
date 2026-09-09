#!/usr/bin/env node
// profile.mjs — what the orchestrator needs to know before its first dispatch.
//
// Prints: host, plan tier (and where that came from), which agent CLIs are on
// PATH and whether they are signed in, whether the six orch-* agents are
// installed, and the current run folder state. Spends no model quota. Never
// prints tokens, account ids, or emails.
//
//   node profile.mjs                  human-readable, ~8 lines
//   node profile.mjs --json           machine-readable
//   node profile.mjs --set tier=max5  persist an override (pro|max5|max20|team|api|unknown)
//   node profile.mjs --clear          remove the override

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOME = homedir();
const IS_WIN = process.platform === 'win32';
const OVERRIDE_PATH = join(HOME, '.claude', 'orchestrate', 'profile.json');
const TIERS = new Set(['pro', 'max5', 'max20', 'team', 'api', 'unknown']);
const AGENT_NAMES = ['orch-planner', 'orch-implementer', 'orch-researcher', 'orch-browser', 'orch-reviewer', 'orch-debugger'];

const args = process.argv.slice(2);
const wantJson = args.includes('--json');

function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

// ---- overrides --------------------------------------------------------------
function loadProfile() {
  return readJson(OVERRIDE_PATH) || {};
}

function saveProfile(patch) {
  const merged = { ...loadProfile(), ...patch };
  mkdirSync(dirname(OVERRIDE_PATH), { recursive: true });
  writeFileSync(OVERRIDE_PATH, JSON.stringify(merged, null, 2) + '\n');
  return merged;
}

// --set-default model=<alias> effort=<level>: the only thing here that writes
// outside orchestrate's own folder. It is the *default for new sessions*, which
// is what settings.json means; the running conversation still changes only with
// the picker. Every other key in the file survives byte for byte.
const defIdx = args.findIndex(a => a === '--set-default');
if (defIdx >= 0) {
  const kvd = {};
  for (const a of args.slice(defIdx + 1)) {
    const m = /^(model|effort)=(\S+)$/.exec(a);
    if (m) kvd[m[1]] = m[2].toLowerCase();
  }
  if (!kvd.model && !kvd.effort) {
    console.error('usage: --set-default model=<opus|sonnet|haiku|fable> [effort=<low|medium|high|xhigh>]');
    process.exit(2);
  }
  // `max` is not accepted in either key by the host, so writing it would leave
  // every new session refusing to start rather than starting deep. Checked for
  // both keys before the backup is taken: `setKeys` throws on either, and
  // catching it here is the difference between one clear line and a raw stack
  // trace beside a stray backup file.
  if (kvd.effort === 'max' || kvd.model === 'max') {
    console.error('max is not accepted in model or effortLevel in settings.json; use the picker for a single session');
    process.exit(2);
  }
  const { setKeys, readSettings, backupSettings, writeSettings } = await import('./lib/settings.mjs');
  const settingsPath = join(HOME, '.claude', 'settings.json');
  const s = readSettings(settingsPath);
  const backup = backupSettings(settingsPath, join(HOME, '.claude', 'orchestrate'));
  setKeys(s, { model: kvd.model, effortLevel: kvd.effort });
  writeSettings(settingsPath, s);
  const said = [kvd.model ? `model ${kvd.model}` : null, kvd.effort ? `effort ${kvd.effort}` : null].filter(Boolean).join(', ');
  console.log(`saved as the default for new sessions: ${said} (${settingsPath}${backup ? `; backup ${backup}` : ''})`);
  console.log('this conversation changes only with the picker.');
  process.exit(0);
}

const setIdx = args.findIndex(a => a === '--set' || a.startsWith('--set='));
if (setIdx >= 0) {
  const kv = (args[setIdx].startsWith('--set=') ? args[setIdx].slice('--set='.length) : (args[setIdx + 1] ?? '')).trim();

  // The manager setup question, answered once. `accept` records that the user
  // took the recommendation, a pair records what they chose instead, and `ask`
  // clears it. A tier change re-opens the question on its own, because the
  // recommendation changes with the tier.
  const mgr = /^manager=(.+)$/.exec(kv);
  if (mgr) {
    const v = mgr[1].trim().toLowerCase();
    const whyIdx = args.findIndex(a => a === '--why');
    const why = whyIdx >= 0 ? String(args[whyIdx + 1] || '').slice(0, 300) : null;
    if (v === 'ask') {
      const prof = loadProfile();
      delete prof.manager;
      mkdirSync(dirname(OVERRIDE_PATH), { recursive: true });
      writeFileSync(OVERRIDE_PATH, JSON.stringify(prof, null, 2) + '\n');
      console.log('manager setup choice cleared; the router will raise it once more');
      process.exit(0);
    }
    const tierNow = detectTier().tier;
    if (v === 'accept') {
      saveProfile({ manager: { accepted: true, tier: tierNow, setAt: new Date().toISOString(), why } });
      console.log(`recorded: the recommendation was taken, on ${tierNow}. The router will not raise it again on this tier.`);
      process.exit(0);
    }
    const pair = /^(fable|opus|sonnet|haiku)(?:\/(low|medium|high|xhigh|max))?$/.exec(v);
    if (!pair) {
      console.error('usage: --set manager=<model>[/<effort>] | accept | ask   [--why "<text>"]');
      process.exit(2);
    }
    saveProfile({ manager: { model: pair[1], effort: pair[2] || null, tier: tierNow, setAt: new Date().toISOString(), why } });
    console.log(`manager setup recorded: ${pair[1]}${pair[2] ? '/' + pair[2] : ''} on ${tierNow}${why ? ` — ${why}` : ''}`);
    process.exit(0);
  }

  // The week anchor, in list-price dollars, so a price tag can say what share
  // of a week a dispatch is on this user's plan.
  const wk = /^week=(\d+(?:\.\d+)?)$/.exec(kv);
  if (wk) {
    saveProfile({ weekDollars: Number(wk[1]), weekSetAt: new Date().toISOString() });
    console.log(`week anchor saved: $${wk[1]} of list-price spend per week`);
    process.exit(0);
  }

  const m = /^tier=(\w+)$/.exec(kv);
  if (!m || !TIERS.has(m[1])) {
    console.error(`usage: --set tier=<${[...TIERS].join('|')}> | manager=<model>[/<effort>]|accept|ask | week=<dollars>`);
    process.exit(2);
  }
  saveProfile({ tier: m[1], tierSource: 'user', setAt: new Date().toISOString() });
  console.log(`tier override saved: ${m[1]} (${OVERRIDE_PATH})`);
  process.exit(0);
}
if (args.includes('--clear')) {
  mkdirSync(dirname(OVERRIDE_PATH), { recursive: true });
  writeFileSync(OVERRIDE_PATH, JSON.stringify({ tier: 'unknown', tierSource: 'cleared', setAt: new Date().toISOString() }, null, 2) + '\n');
  console.log('tier override cleared; automatic detection applies');
  process.exit(0);
}

// ---- host -------------------------------------------------------------------
function detectHost() {
  const keys = Object.keys(process.env);
  if (keys.some(k => /^CLAUDE(CODE|_CODE_|_SESSION|_PROJECT|_EFFORT)/.test(k))) return 'claude-code';
  if (keys.some(k => /^CODEX_/.test(k))) return 'codex';
  return 'claude-code (assumed: no host env vars found)';
}

// ---- tier -------------------------------------------------------------------
function mapTier(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const s = raw.toLowerCase();
  if (/max[_-]?20x|max20/.test(s)) return 'max20';
  if (/max[_-]?5x|max5/.test(s)) return 'max5';
  if (/\bmax\b/.test(s)) return 'max5'; // unversioned "max": assume the smaller Max
  if (/enterprise|team/.test(s)) return 'team';
  if (/\bpro\b|claude_pro|_pro_/.test(s)) return 'pro';
  return null;
}

// The tier keys live under a nested account object whose shape has changed
// between versions, so look for them anywhere in the file, shallowly.
function findKeys(obj, names, depth = 0, out = {}) {
  if (!obj || typeof obj !== 'object' || depth > 6) return out;
  for (const [k, v] of Object.entries(obj)) {
    if (names.includes(k) && v != null && !(k in out)) out[k] = v;
    else if (v && typeof v === 'object') findKeys(v, names, depth + 1, out);
  }
  return out;
}

function detectTier() {
  const override = readJson(OVERRIDE_PATH);
  if (override && override.tier && override.tier !== 'unknown' && TIERS.has(override.tier)) {
    return { tier: override.tier, source: `user override set ${String(override.setAt).slice(0, 10)} (${OVERRIDE_PATH})` };
  }
  const cfg = readJson(join(HOME, '.claude.json'));
  if (cfg) {
    const found = findKeys(cfg, ['userRateLimitTier', 'organizationRateLimitTier', 'seatTier']);
    for (const key of ['userRateLimitTier', 'organizationRateLimitTier', 'seatTier']) {
      const t = mapTier(found[key]);
      if (t) return { tier: t, source: `~/.claude.json ${key}="${found[key]}"` };
    }
  }
  if (process.env.ANTHROPIC_API_KEY) return { tier: 'api', source: 'ANTHROPIC_API_KEY is set' };
  return { tier: 'unknown', source: 'no signal; ask the user once, then --set tier=...' };
}

// ---- providers --------------------------------------------------------------
function onPath(cmd) {
  const exts = IS_WIN ? (process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';').map(e => e.toLowerCase()).concat(['']) : [''];
  const dirs = (process.env.PATH || '').split(IS_WIN ? ';' : ':').filter(Boolean);
  for (const d of dirs) {
    for (const e of exts) {
      const p = join(d, cmd + e);
      try { if (statSync(p).isFile()) return p; } catch {}
    }
  }
  return null;
}

// Resolve the executable ourselves. A .cmd/.bat shim (npm installs on
// Windows) needs a shell, and then the safe form is one command string; a
// real .exe or a POSIX binary is spawned directly with an args array.
function run(cmd, cmdArgs, timeoutMs) {
  const p = onPath(cmd);
  if (!p) return { status: null, out: 'not on PATH', timedOut: false };
  const needsShell = IS_WIN && /\.(cmd|bat)$/i.test(p);
  const q = a => (/[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a);
  const opts = {
    encoding: 'utf8', timeout: timeoutMs, windowsHide: true,
    env: { ...process.env, NO_COLOR: '1', CI: '1' }, stdio: ['ignore', 'pipe', 'pipe'],
  };
  try {
    const r = needsShell
      ? spawnSync(`"${p}" ${cmdArgs.map(q).join(' ')}`, { ...opts, shell: true })
      : spawnSync(p, cmdArgs, { ...opts, shell: false });
    const out = ((r.stdout || '') + (r.stderr || '')).replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
    return { status: r.status, out, timedOut: Boolean(r.error && r.error.code === 'ETIMEDOUT') };
  } catch (e) { return { status: null, out: String(e), timedOut: false }; }
}

function probeAuth(name) {
  // Each probe is a status command that spends no quota.
  switch (name) {
    case 'claude': {
      const r = run('claude', ['auth', 'status'], 8000);
      if (r.timedOut) return 'auth: timed out';
      const jsonLines = r.out.trim().split('\n').filter(l => /^[\s{}"]/.test(l)).join('\n');
      try { const j = JSON.parse(jsonLines); return j.loggedIn ? 'signed in' : 'not signed in'; } catch {}
      return /logged\s*in:?\s*true|signed in/i.test(r.out) ? 'signed in' : 'not signed in';
    }
    case 'codex': {
      const r = run('codex', ['login', 'status'], 8000);
      if (r.timedOut) return 'auth: timed out';
      return r.status === 0 && /logged in/i.test(r.out) && !/not logged in/i.test(r.out) ? 'signed in' : 'not signed in';
    }
    case 'opencode': {
      const r = run('opencode', ['auth', 'list'], 8000);
      if (r.timedOut) return 'auth: timed out';
      const lines = r.out.split('\n').map(l => l.trim()).filter(l => l && !/no credentials|^(auth|credentials|stored|┌|└|─)/i.test(l));
      return r.status === 0 && lines.length > 0 ? 'credentials listed' : 'no credentials';
    }
    default:
      return 'installed';
  }
}

function detectProviders() {
  const out = {};
  for (const name of ['claude', 'codex', 'opencode', 'gemini', 'aider']) {
    const p = onPath(name);
    out[name] = p ? { installed: true, auth: probeAuth(name) } : { installed: false, auth: 'not on PATH' };
  }
  return out;
}

// Probing five CLIs costs up to 40 s of wall clock, so the answer is cached for
// a day. `--brief` only ever reads the cache; it must never block the skill.
const PROVIDER_CACHE = join(HOME, '.claude', 'orchestrate', 'providers.json');
const CACHE_MS = 24 * 60 * 60 * 1000;

function cachedProviders() {
  const c = readJson(PROVIDER_CACHE);
  if (!c || !c.at || Date.now() - Date.parse(c.at) > CACHE_MS) return null;
  return c.providers || null;
}

function cacheProviders(providers) {
  try {
    mkdirSync(dirname(PROVIDER_CACHE), { recursive: true });
    writeFileSync(PROVIDER_CACHE, JSON.stringify({ at: new Date().toISOString(), providers }, null, 2) + '\n');
  } catch {}
}

// ---- skills as a toolkit ----------------------------------------------------
// A step that an installed skill already does should be routed to it rather
// than re-derived, so the plan needs to know their names. Names only: a skill's
// body is loaded by invoking it, not by listing it.
function detectSkills(repoRoot) {
  const names = new Set();
  const scan = dir => {
    try {
      for (const n of readdirSync(dir)) {
        if (n.startsWith('.')) continue;
        if (existsSync(join(dir, n, 'SKILL.md'))) names.add(n);
      }
    } catch {}
  };
  scan(join(HOME, '.claude', 'skills'));
  if (repoRoot) scan(join(repoRoot, '.claude', 'skills'));
  // Installed plugins only. `plugins/marketplaces` is a catalogue of what could
  // be installed, so listing it would offer the model skills it cannot invoke.
  try {
    const plugins = join(HOME, '.claude', 'plugins');
    for (const p of readdirSync(plugins)) {
      if (p === 'marketplaces' || p.endsWith('.json')) continue;
      scan(join(plugins, p, 'skills'));
    }
  } catch {}
  return [...names].sort();
}

// ---- agents installed -------------------------------------------------------
function detectAgents() {
  const dir = join(HOME, '.claude', 'agents');
  const present = AGENT_NAMES.filter(n => existsSync(join(dir, n + '.md')));
  return { installed: present.length, expected: AGENT_NAMES.length, missing: AGENT_NAMES.filter(n => !present.includes(n)), dir };
}

// ---- repo + runs ------------------------------------------------------------
function findRepoRoot(start) {
  let d = resolve(start);
  for (let i = 0; i < 40; i++) {
    if (existsSync(join(d, '.git'))) return d;
    const parent = dirname(d);
    if (parent === d) return null;
    d = parent;
  }
  return null;
}

function detectRuns(root) {
  const base = join(root || process.cwd(), '.orchestrator', 'runs');
  if (!existsSync(base)) return { dir: base, count: 0, latest: null };
  const runs = readdirSync(base).filter(n => existsSync(join(base, n, 'RUN.md'))).sort();
  return { dir: base, count: runs.length, latest: runs.length ? runs[runs.length - 1] : null };
}

// ---- prices -----------------------------------------------------------------
// What things have actually cost on this machine, so a price tag before a
// dispatch is a measurement rather than a table. Still no running total: a
// counter reads as an allowance and invites spending up to it.
function pricesLine(tier) {
  try {
    const costsPath = join(HOME, '.claude', 'orchestrate', 'costs.jsonl');
    let rows = [];
    try {
      rows = readFileSync(costsPath, 'utf8').split('\n').filter(Boolean)
        .map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    } catch {}
    const by = new Map();
    for (const r of rows) {
      if (!r.role || !r.model || !Number.isFinite(Number(r.dollars))) continue;
      const k = `${r.role.replace(/^orch-/, '')}/${r.model}`;
      const v = by.get(k) || { n: 0, sum: 0 };
      v.n++; v.sum += Number(r.dollars);
      by.set(k, v);
    }
    const top = [...by.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 6)
      .map(([k, v]) => `${k} $${(v.sum / v.n).toFixed(1)} (${v.n})`);
    const profile = readJson(join(HOME, '.claude', 'orchestrate', 'profile.json')) || {};
    const w = Number(profile.weekDollars);
    const week = Number.isFinite(w) && w > 0
      ? `a week here is about $${w} of list price (you set that)`
      : { pro: 30, max5: 150, max20: 600, team: 30 }[tier]
        ? `a week is roughly $${{ pro: 30, max5: 150, max20: 600, team: 30 }[tier]} of list price (one observation; --set week=<dollars> to correct it)`
        : 'no week anchor for this plan';
    return `prices measured here: ${top.length ? top.join(', ') : 'none yet; models.md has the starting table'} · ${week}`;
  } catch { return 'prices measured here: unavailable'; }
}

// ---- output -----------------------------------------------------------------
const brief = args.includes('--brief');
const skillDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const host = detectHost();
const tier = detectTier();
const agents = detectAgents();
const repo = findRepoRoot(process.cwd());
const runs = detectRuns(repo);
const skills = detectSkills(repo);

// --brief is injected into SKILL.md with `!`…``, where a slow or failing
// command would abort the invocation. So: cache only, no probes, no network,
// and every path exits 0.
if (brief) {
  try {
    const p = cachedProviders();
    const prov = p
      ? Object.entries(p).filter(([, v]) => v.installed).map(([n, v]) => `${n} ${v.auth}`).join(', ') || 'none on PATH'
      : 'not probed today (run profile.mjs for the full picture)';
    // No spend counter here on purpose. A running total reads as an allowance
    // and invites spending it; the tier is what the model actually reasons
    // from, and measure.mjs reports what a finished run cost.
    const included = { max5: 'Opus, Sonnet, Haiku and Fable', max20: 'Opus, Sonnet, Haiku and Fable', pro: 'Opus, Sonnet and Haiku; Fable costs credits, so ask first', team: 'Opus, Sonnet and Haiku; Fable costs credits, so ask first', api: 'all, billed per token; ask before Fable' }[tier.tier] || 'unknown, ask the user once';
    console.log(`orchestrate: tier ${tier.tier} · host ${host.split(' ')[0]} · node ${process.version} · agents ${agents.installed}/${agents.expected}${agents.missing.length ? ` (missing ${agents.missing.join(', ')})` : ''}`);
    console.log(`repo ${repo || 'none (no worktree isolation)'} · runs ${runs.count}${runs.latest ? ` · latest ${runs.latest}` : ''}`);
    console.log(`this plan includes: ${included}`);
    console.log(`providers: ${prov}`);
    console.log(`skills on disk (route a step to one instead of re-deriving it; your own listing may have more): ${skills.length ? skills.join(', ') : 'none'}`);
    console.log(pricesLine(tier.tier));
  } catch {}
  process.exit(0);
}

const providers = detectProviders();
cacheProviders(providers);

const result = { host, tier: tier.tier, tierSource: tier.source, providers, agents, repo, runs, skills, skillDir, node: process.version, platform: process.platform };

if (wantJson) {
  console.log(JSON.stringify(result, null, 2));
} else {
  const provLine = Object.entries(providers).map(([n, v]) => `${n}: ${v.installed ? v.auth : 'not on PATH'}`).join(' · ');
  console.log(`host: ${host}`);
  console.log(`tier: ${tier.tier}  (${tier.source})`);
  console.log(`providers: ${provLine}`);
  console.log(`agents: ${agents.installed}/${agents.expected} orch-* files in ${agents.dir}${agents.missing.length ? ' — missing: ' + agents.missing.join(', ') + ' (run scripts/install-agents.mjs)' : ' (a running session lists newly installed ones after a short delay)'}`);
  console.log(`repo: ${repo || 'not in a git repo (worktree isolation unavailable)'}`);
  console.log(`runs: ${runs.count} under ${runs.dir}${runs.latest ? ' — latest: ' + runs.latest : ''}`);
  console.log(`skills: ${skills.length ? skills.join(', ') : 'none installed'}`);
  if (tier.tier === 'unknown') console.log('next: ask the user which plan (Pro $20 / Max 5x $100 / Max 20x $200 / API-Team-other), then: node scripts/profile.mjs --set tier=<pro|max5|max20|team|api>');
  if (tier.tier === 'pro' || tier.tier === 'team' || tier.tier === 'api') console.log(`note: on ${tier.tier}, Fable is not included and costs the user real money. Recommend it when a task warrants it, say what it would cost and what the alternatives are, and let the user choose.`);
}
