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
//   node profile.mjs --policy [context.compactAt=150000 workers.maxConcurrent=2 ...]
//   node profile.mjs --host [--json]  the running host's version and capabilities
//   node profile.mjs --set paidServices=never|ask|free
//   node profile.mjs --set allowPaid=<plugin> | denyPaid=<plugin>   a paid plugin allowed by name
//   node profile.mjs --clear          remove the override
//   node profile.mjs --autocompact <tokens|Nk|off> [--dry-run]

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOME = homedir();
const IS_WIN = process.platform === 'win32';
const OVERRIDE_PATH = join(HOME, '.claude', 'orchestrate', 'profile.json');
const TIERS = new Set(['pro', 'max5', 'max20', 'team', 'api', 'unknown']);
const CODEX_TIERS = new Set(['plus', 'pro5', 'pro20']);

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

const autoIdx = args.findIndex(a => a === '--autocompact');
if (autoIdx >= 0) {
  const raw = String(args[autoIdx + 1] || '');
  const { setEnv, readSettings, backupSettings, writeSettings, parseAutocompact, autocompactMarkerPath } = await import('./lib/settings.mjs');
  const tokens = parseAutocompact(raw, { allowOff: true });
  if (tokens == null) { console.error('usage: --autocompact <tokens|Nk|off> [--dry-run]'); process.exit(2); }
  const settingsPath = join(HOME, '.claude', 'settings.json');
  const markerDir = join(HOME, '.claude', 'orchestrate');
  const edit = tokens === 'off' ? 'remove settings.json env.CLAUDE_CODE_AUTO_COMPACT_WINDOW' : `settings.json env.CLAUDE_CODE_AUTO_COMPACT_WINDOW=${tokens}`;
  if (args.includes('--dry-run')) { console.log(tokens === 'off' ? `would ${edit}` : `would write ${edit}`); process.exit(0); }
  const s = readSettings(settingsPath);
  const backup = backupSettings(settingsPath, markerDir);
  if (tokens === 'off') {
    if (s.env && typeof s.env === 'object') delete s.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW;
    mkdirSync(markerDir, { recursive: true });
    writeFileSync(autocompactMarkerPath(markerDir), JSON.stringify({ at: new Date().toISOString(), value: 'off', settingsPath, backup }, null, 2) + '\n');
  } else setEnv(s, { CLAUDE_CODE_AUTO_COMPACT_WINDOW: tokens });
  writeSettings(settingsPath, s);
  console.log(`saved ${edit} (${settingsPath}${backup ? `; backup ${backup}` : ''})`);
  process.exit(0);
}

// --policy [key=value ...]: the efficiency thresholds (lib/policy.mjs). With no
// pair it prints the policy in effect; each pair is validated against the
// defaults' keys, and only `policy` in profile.json is written.
const polIdx = args.findIndex(a => a === '--policy');
if (polIdx >= 0) {
  const { loadPolicy, setPolicyValue } = await import('./lib/policy.mjs');
  const pairs = args.slice(polIdx + 1).filter(a => /^[\w.-]+=/.test(a));
  if (pairs.length) {
    let p = loadProfile();
    try { for (const kv of pairs) { const i = kv.indexOf('='); p = setPolicyValue(p, kv.slice(0, i), kv.slice(i + 1)); } } catch (e) { console.error(String(e.message)); process.exit(2); }
    saveProfile({ policy: p.policy });
    console.log(`policy saved (${OVERRIDE_PATH}): ${pairs.join(', ')}`);
  }
  console.log(JSON.stringify(loadPolicy(loadProfile()), null, 2));
  process.exit(0);
}

// --host: what the running host can do, read from the host itself — its
// environment and its own transcript records — never from `claude --version`,
// which describes whatever terminal CLI is on PATH, not the app running this.
if (args.includes('--host')) {
  const { hostCapabilities } = await import('./lib/host.mjs');
  const h = hostCapabilities();
  console.log(wantJson ? JSON.stringify(h, null, 2) : Object.entries(h).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join('\n'));
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

  // Skills that call an outside service bill that service, not the plan. The
  // user decides once: never use them, ask once per job, or use them freely.
  const paid = /^paidServices=(never|ask|free)$/.exec(kv);
  if (paid) {
    saveProfile({ paidServices: paid[1], paidServicesSetAt: new Date().toISOString() });
    console.log(`paid outside services: ${paid[1]}`);
    process.exit(0);
  }

  // A paid plugin the user bought and wants used, named once; it is allowed
  // whatever the setting above says, and no other paid plugin is.
  const byName = /^(allowPaid|denyPaid)=([\w.@-]+)$/.exec(kv);
  if (byName) {
    const list = new Set(Array.isArray(loadProfile().paidAllowed) ? loadProfile().paidAllowed : []);
    if (byName[1] === 'allowPaid') list.add(byName[2]); else list.delete(byName[2]);
    saveProfile({ paidAllowed: [...list].sort() });
    console.log(`paid plugins allowed by name: ${list.size ? [...list].sort().join(', ') : 'none'}`);
    process.exit(0);
  }

  const codexTier = /^codex\.tier=(\w+)$/.exec(kv);
  if (codexTier) {
    if (!CODEX_TIERS.has(codexTier[1])) {
      console.error(`usage: --set codex.tier=<${[...CODEX_TIERS].join('|')}>`);
      process.exit(2);
    }
    saveProfile({ codex: { ...(loadProfile().codex || {}), tier: codexTier[1], setAt: new Date().toISOString() } });
    console.log(`Codex tier saved: ${codexTier[1]} (${OVERRIDE_PATH})`);
    process.exit(0);
  }

  const m = /^tier=(\w+)$/.exec(kv);
  if (!m || !TIERS.has(m[1])) {
    console.error(`usage: --set tier=<${[...TIERS].join('|')}> | manager=<model>[/<effort>]|accept|ask | paidServices=never|ask|free | allowPaid=<plugin> | denyPaid=<plugin>`);
    process.exit(2);
  }
  // Kept per Claude account, so someone who switches accounts is not left on
  // the other account's plan. Only when no account can be told apart does it
  // fall back to one plan for every session.
  const { org } = currentAccount();
  const at = new Date().toISOString();
  if (org && m[1] !== 'unknown') {
    const prof = loadProfile();
    const plans = { ...(prof.plans || {}), [org]: { tier: m[1], setAt: at } };
    delete prof.tier; delete prof.tierSource; delete prof.setAt;
    mkdirSync(dirname(OVERRIDE_PATH), { recursive: true });
    writeFileSync(OVERRIDE_PATH, JSON.stringify({ ...prof, plans }, null, 2) + '\n');
    console.log(`plan saved for this Claude account (${org.slice(0, 8)}): ${m[1]} (${OVERRIDE_PATH})`);
  } else {
    saveProfile({ tier: m[1], tierSource: 'user', setAt: at });
    console.log(`tier override saved: ${m[1]} (${OVERRIDE_PATH})`);
  }
  process.exit(0);
}
if (args.includes('--clear')) {
  // Only the plan goes back to automatic, for this account and the old
  // one-for-all setting; the paid-service rule, paid plugins allowed by name and
  // the manager answer are separate choices and stay.
  const prof = loadProfile();
  const { org } = currentAccount();
  if (org && prof.plans) delete prof.plans[org];
  delete prof.tier; delete prof.tierSource; delete prof.setAt;
  mkdirSync(dirname(OVERRIDE_PATH), { recursive: true });
  writeFileSync(OVERRIDE_PATH, JSON.stringify(prof, null, 2) + '\n');
  console.log('plan setting cleared; automatic detection applies');
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
// One detector for the whole plugin: lib/tier.mjs. This file used to carry its
// own copy, which fell behind the host's current account fields.

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
const CODEX_STATUS_CACHE = join(HOME, '.claude', 'orchestrate', 'workers', 'codex-status.json');
const CACHE_MS = 24 * 60 * 60 * 1000;
const CODEX_STATUS_MS = 60 * 60 * 1000;

function cachedCodexStatus() {
  const c = readJson(CODEX_STATUS_CACHE);
  return c && c.at && Date.now() - Date.parse(c.at) < CODEX_STATUS_MS ? c : null;
}
function codexBriefLine(c) {
  if (!c) return 'codex: not checked in the last hour (run profile.mjs)';
  if (c.status === 'not-installed') return 'codex: not installed';
  if (c.status === 'not-signed-in') return 'codex: not signed in';
  if (c.status === 'limit') return `codex: limit until ${c.until || 'unknown'}`;
  const tier = ((loadProfile().codex || {}).tier) || 'tier unknown';
  return `codex: ${c.model || 'model unknown'} · ${tier} · ok`;
}

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
// One copy of this rule, in lib/tier.mjs, because it has to know about both
// install paths: loose files in ~/.claude/agents, and a plugin that registers
// them from its own folder without copying anything.
import { agentsInstalled as detectAgents, latestRun, detectTier, currentAccount } from './lib/tier.mjs';
import { normalizeRole } from './lib/prices.mjs';
import { latestPerAgent } from './ledger.mjs';

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

// `latest` is asked of lib/tier.mjs, not worked out again here. This file kept
// its own name sort, which is the bug that filed a subagent's return into a
// closed run: two runs opened on the same day were ordered by slug.
function detectRuns(root) {
  const base = join(root || process.cwd(), '.orchestrator', 'runs');
  if (!existsSync(base)) return { dir: base, count: 0, latest: null };
  const count = readdirSync(base).filter(n => existsSync(join(base, n, 'RUN.md'))).length;
  const run = latestRun(root || process.cwd());
  return { dir: base, count, latest: run ? run.runId : null };
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
      rows = latestPerAgent(readFileSync(costsPath, 'utf8').split('\n').filter(Boolean)
        .map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean));
    } catch {}
    const by = new Map();
    for (const r of rows) {
      if (!r.agent || !r.role || !r.model || r.dollars == null || !Number.isFinite(Number(r.dollars))) continue;
      const k = `${normalizeRole(r.role).replace(/^orch-/, '')}/${r.model}`;
      const v = by.get(k) || { n: 0, sum: 0 };
      v.n++; v.sum += Number(r.dollars);
      by.set(k, v);
    }
    const top = [...by.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 6)
      .map(([k, v]) => `${k} $${(v.sum / v.n).toFixed(1)} (${v.n})`);
    // No weekly anchor. The $30/$150/$600 figures that used to sit here came from
    // one observation, and a per-run Budget ceiling is what the model reasons
    // from now — a threshold the user set, not a plan-wide figure nobody measured.
    return `prices measured here: ${top.length ? top.join(', ') : 'none yet; models.md has the starting table'}`;
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
    console.log(codexBriefLine(cachedCodexStatus()));
    const auto = (readJson(join(HOME, '.claude', 'settings.json')) || {}).env || {};
    if (!auto.CLAUDE_CODE_AUTO_COMPACT_WINDOW) console.log('auto-compact is at the window limit; run `profile.mjs --autocompact 200k`');
    console.log(`repo ${repo || 'none (no worktree isolation)'} · runs ${runs.count}${runs.latest ? ` · latest ${runs.latest}` : ''}`);
    console.log(`this plan includes: ${included}`);
    const paidMode = loadProfile().paidServices || 'ask';
    const paidAllowed = Array.isArray(loadProfile().paidAllowed) ? loadProfile().paidAllowed : [];
    console.log(`skills that call a paid outside service (they need their own API key or credits): ${{ never: 'never use them — the user said so', ask: 'ask the user once per job before using one', free: 'use them when they fit' }[paidMode] || 'ask first'}${paidAllowed.length ? `; except these, which the user allowed by name: ${paidAllowed.join(', ')}` : ''}`);
    // Live usage exists only where the host runs the status line: a terminal.
    // Said as a fact with the one-time command, never installed from here.
    try {
      const { readQuota } = await import('./lib/quota.mjs');
      if (!readQuota()) {
        const desktop = /desktop/i.test(process.env.CLAUDE_CODE_ENTRYPOINT || '');
        const sl = (readJson(join(HOME, '.claude', 'settings.json')) || {}).statusLine;
        const ours = sl && /orchestrate\/scripts\/statusline\.mjs/.test(String(sl.command || '').replace(/\\/g, '/'));
        console.log(desktop
          ? 'live usage: not available in the desktop app (it does not run status lines); usage stops fall back to the host\'s limit messages'
          : ours ? 'live usage: status line installed, no reading in the last 10 minutes'
            : `live usage: off. With the user's yes, once: node "${join(dirname(fileURLToPath(import.meta.url)), 'statusline.mjs')}" --install`);
      }
    } catch {}
    console.log(`providers: ${prov}`);
    console.log(`skills on disk (route a step to one instead of re-deriving it; your own listing may have more): ${skills.length ? skills.join(', ') : 'none'}`);
    console.log(pricesLine(tier.tier));
  } catch {}
  process.exit(0);
}

const providers = detectProviders();
cacheProviders(providers);
try {
  const { status } = await import('./codex-worker.mjs');
  const s = status();
  const active = s.exhausted.find(e => e.provider === 'codex' && e.active);
  const value = !s.bin ? { status: 'not-installed' }
    : !s.login.ok ? { status: 'not-signed-in' }
      : active ? { status: 'limit', until: active.resetsAt ? new Date(active.resetsAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'unknown' }
        : { status: 'ok', model: s.model || 'model unknown' };
  mkdirSync(dirname(CODEX_STATUS_CACHE), { recursive: true });
  writeFileSync(CODEX_STATUS_CACHE, JSON.stringify({ at: new Date().toISOString(), ...value }, null, 2) + '\n');
} catch {}

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
