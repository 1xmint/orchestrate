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
const setIdx = args.findIndex(a => a === '--set' || a.startsWith('--set='));
if (setIdx >= 0) {
  const kv = args[setIdx].startsWith('--set=') ? args[setIdx].slice('--set='.length) : (args[setIdx + 1] ?? '');
  const m = /^tier=(\w+)$/.exec(kv.trim());
  if (!m || !TIERS.has(m[1])) {
    console.error(`usage: --set tier=<${[...TIERS].join('|')}>`);
    process.exit(2);
  }
  mkdirSync(dirname(OVERRIDE_PATH), { recursive: true });
  writeFileSync(OVERRIDE_PATH, JSON.stringify({ tier: m[1], tierSource: 'user', setAt: new Date().toISOString() }, null, 2) + '\n');
  console.log(`tier override saved: ${m[1]} (${OVERRIDE_PATH})`);
  process.exit(0);
}
if (args.includes('--fable-optin')) {
  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  mkdirSync(dirname(OVERRIDE_PATH), { recursive: true });
  writeFileSync(join(dirname(OVERRIDE_PATH), 'fable-optin.json'), JSON.stringify({ date: today }) + '\n');
  console.log(`Fable opt-in recorded for ${today} (guard-agent.mjs will allow Fable dispatches today)`);
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
    const cap = { max5: 3, max20: 6 }[tier.tier];
    const fable = readJson(join(HOME, '.claude', 'orchestrate', `fable-count-${new Date().toISOString().slice(0, 10)}.json`));
    console.log(`orchestrate: tier ${tier.tier} · host ${host.split(' ')[0]} · node ${process.version} · agents ${agents.installed}/${agents.expected}${agents.missing.length ? ` (missing ${agents.missing.join(', ')})` : ''}`);
    console.log(`repo ${repo || 'none (no worktree isolation)'} · runs ${runs.count}${runs.latest ? ` · latest ${runs.latest}` : ''} · fable ${cap ? `${(fable && fable.count) || 0}/${cap} today` : 'off unless the user opts in'}`);
    console.log(`providers: ${prov}`);
    console.log(`skills on disk (route a step to one instead of re-deriving it; your own listing may have more): ${skills.length ? skills.join(', ') : 'none'}`);
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
  if (tier.tier === 'pro') console.log('note: on Pro, Fable bills usage credits; never dispatch to fable without the user opting in for this run');
}
