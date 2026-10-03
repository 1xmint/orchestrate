#!/usr/bin/env node
// statusline.mjs — the one place Claude Code reports live plan usage.
//
// No hook receives rate limits; the main status line does, on every assistant
// message, locally and at no token cost. So this is a status line: it prints a
// short footer for the user and saves the numbers to ~/.claude/orchestrate/
// quota.json, which the dispatch guard, the router and the persist loop read.
// A plugin may not install a status line itself, so installing it is a one-time
// yes from the user.
//
// If the user already had a status line, it keeps running: its command is
// saved at install and run first with the same input, and its output printed
// above this one.
//
//   (stdin JSON)                        status line mode
//   node statusline.mjs --install       set statusLine in ~/.claude/settings.json
//   node statusline.mjs --uninstall     put back what was there before
//
// Status line mode never fails and never prints an error: a broken footer is
// worse than a missing number.

import { readFileSync, existsSync, mkdirSync, unlinkSync, spawnSync, statSync } from './lib/node.mjs';
import { join, dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { HOME, DIR, readJson, writeJsonAtomic, sessionAccount, findKeys } from './lib/tier.mjs';
import { writeStatusCapacity } from './lib/context-scan.mjs';
import { QUOTA_PATH, snapshotFrom, resetClock } from './lib/quota.mjs';
import { readSettings, backupSettings, writeSettings, commandFor } from './lib/settings.mjs';

export const WRAP_PATH = join(DIR, 'statusline-wrap.json');
const SELF = fileURLToPath(import.meta.url);

const pct = w => (w ? `${Math.round(w.pct)}%` : null);

export function footer(snap) {
  const parts = [];
  if (snap.model) parts.push(snap.model);
  if (snap.contextPct != null) parts.push(`context ${Math.round(snap.contextPct)}%`);
  if (snap.fiveHour) parts.push(`5h ${pct(snap.fiveHour)}${snap.fiveHour.resetsAt ? ` (resets ${resetClock(snap.fiveHour.resetsAt)})` : ''}`);
  if (snap.week) parts.push(`wk ${pct(snap.week)}`);
  return parts.join(' · ');
}

// Which Claude org this session runs on, as lib/install.mjs `currentAccount`
// answers it (the desktop app's own record of the session first, else
// ~/.claude.json), without parsing ~/.claude.json on every draw: the footer is
// drawn after every message, and that file grows to megabytes (about 40 ms more
// per draw at 5 MB). What the file names is kept in the plugin's own folder,
// keyed by the file's size and modified time, and read again only when either
// moves. A file that does not parse is not remembered, so the next draw tries
// again.
export const ACCOUNT_CACHE_PATH = join(DIR, 'account-org.json');
export function accountOrg({ cfgPath = join(HOME, '.claude.json'), cachePath = ACCOUNT_CACHE_PATH, hostSession = process.env.CLAUDE_CODE_HOST_SESSION_ID, read = readJson } = {}) {
  const session = sessionAccount(hostSession);
  if (session && session.orgUuid) return session.orgUuid;
  let st;
  try { st = statSync(cfgPath); } catch { return null; }
  const key = `${st.size}:${st.mtimeMs}`;
  const kept = readJson(cachePath);
  if (kept && kept.key === key) return typeof kept.org === 'string' ? kept.org : null;
  const cfg = read(cfgPath);
  if (!cfg) return null;
  const found = findKeys(cfg, ['organizationUuid']).organizationUuid;
  const org = typeof found === 'string' && found ? found : null;
  try { writeJsonAtomic(cachePath, { key, org }); } catch {}
  return org;
}

export function isOurs(statusLine) {
  return Boolean(statusLine && /orchestrate\/scripts\/statusline\.mjs/.test(String(statusLine.command || '').replace(/\\/g, '/')));
}

// The status line command names this file, and a plugin install keeps each
// version in a folder of its own (~/.claude/plugins/cache/<marketplace>/<plugin>/
// <version>/), so after an update the footer went on running the version it was
// installed from. Claude Code's record of what is installed
// (~/.claude/plugins/installed_plugins.json, read the same way by profile.mjs
// and diagnose.mjs) names the folder in use. When this file sits in the plugin
// cache and that folder holds another copy, this returns that copy's path, and
// the footer runs it. A script install, a copy that is already the current one,
// or a record that cannot be read: null, and this copy runs.
export function currentCopy(self = SELF, pluginsFile = join(HOME, '.claude', 'plugins', 'installed_plugins.json')) {
  try {
    if (!/[\\/]\.claude[\\/]plugins[\\/]cache[\\/]/.test(String(self))) return null;
    const rec = readJson(pluginsFile);
    const found = [];
    for (const [key, installs] of Object.entries((rec && rec.plugins) || {})) {
      if (String(key).split('@')[0] !== 'orchestrate' || !Array.isArray(installs)) continue;
      for (const i of installs) {
        const p = i && typeof i.installPath === 'string' ? join(i.installPath, 'skills', 'orchestrate', 'scripts', 'statusline.mjs') : '';
        if (p && existsSync(p)) found.push({ p, user: i.scope === 'user' });
      }
    }
    const pick = found.find(f => f.user) || found[0];
    return pick && resolvePath(pick.p) !== resolvePath(self) ? pick.p : null;
  } catch { return null; }
}

// Whether the status line command runs this very file.
const slashes = s => String(s || '').replace(/\\/g, '/');
const namesSelf = statusLine => slashes(statusLine && statusLine.command).includes(slashes(SELF));

function render(payload) {
  let input = null;
  try { input = JSON.parse(payload); } catch {}
  const out = [];
  const wrap = readJson(WRAP_PATH);
  if (wrap && wrap.command) {
    try {
      const r = spawnSync(wrap.command, { input: payload, encoding: 'utf8', shell: true, timeout: 4000 });
      if (r.stdout && r.stdout.trim()) out.push(r.stdout.replace(/\s+$/, ''));
    } catch {}
  }
  if (input && typeof input === 'object') {
    let account = null;
    try { account = accountOrg(); } catch {}
    const snap = snapshotFrom(input, Date.now(), account);
    try { mkdirSync(DIR, { recursive: true }); writeJsonAtomic(QUOTA_PATH, snap); } catch {}
    // The window size is a per-session fact for the context reader.
    if (snap.session && snap.contextSize) writeStatusCapacity(snap.session, snap.contextSize);
    const line = footer(snap);
    if (line) out.push(line);
  }
  process.stdout.write(out.join('\n'));
}

export function install(settingsPath = join(HOME, '.claude', 'settings.json')) {
  if (existsSync(settingsPath)) {
    try { JSON.parse(readFileSync(settingsPath, 'utf8')); } catch { return `not installed: ${settingsPath} is not valid JSON, and rewriting it would lose what is in it`; }
  }
  const s = readSettings(settingsPath);
  if (isOurs(s.statusLine) && namesSelf(s.statusLine)) return 'already installed';
  // Installed from another copy (an earlier version's folder, which an update
  // may remove): the command is pointed at this one, and what it wraps is kept.
  if (isOurs(s.statusLine)) {
    const backup = backupSettings(settingsPath, DIR);
    s.statusLine = { ...s.statusLine, command: commandFor(SELF) };
    writeSettings(settingsPath, s);
    return `updated to run this copy${backup ? ` (backup: ${backup})` : ''}`;
  }
  const had = Boolean(s.statusLine && s.statusLine.command);
  if (had) writeJsonAtomic(WRAP_PATH, { command: s.statusLine.command, previous: s.statusLine, savedAt: new Date().toISOString() });
  else { try { unlinkSync(WRAP_PATH); } catch {} }
  const backup = backupSettings(settingsPath, DIR);
  s.statusLine = { type: 'command', command: commandFor(SELF), padding: 0 };
  writeSettings(settingsPath, s);
  return `installed${backup ? ` (backup: ${backup})` : ''}${had ? '; your previous status line still runs first' : ''}`;
}

export function uninstall(settingsPath = join(HOME, '.claude', 'settings.json')) {
  const s = readSettings(settingsPath);
  if (!isOurs(s.statusLine)) return 'not installed';
  backupSettings(settingsPath, DIR);
  const wrap = readJson(WRAP_PATH);
  if (wrap && wrap.previous) s.statusLine = wrap.previous;
  else delete s.statusLine;
  writeSettings(settingsPath, s);
  try { unlinkSync(WRAP_PATH); } catch {}
  return 'removed';
}

if (process.argv[1] && resolvePath(process.argv[1]) === SELF) {
  const arg = process.argv[2];
  if (arg === '--install') console.log(install());
  else if (arg === '--uninstall') console.log(uninstall());
  else {
    // The current install's copy runs in this process as its own main: it reads
    // the input, draws and exits. A copy that fails to load leaves this one to
    // draw.
    const other = currentCopy();
    if (other) {
      try { process.argv[1] = other; await import(pathToFileURL(other).href); } catch {}
      process.argv[1] = SELF;
    }
    let payload = '';
    try { payload = readFileSync(0, 'utf8'); } catch {}
    try { render(payload); } catch {}
  }
  process.exit(0);
}
