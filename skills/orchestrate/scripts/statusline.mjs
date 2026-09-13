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

import { readFileSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HOME, DIR, readJson, writeJsonAtomic } from './lib/tier.mjs';
import { QUOTA_PATH, snapshotFrom, resetClock } from './lib/quota.mjs';
import { readSettings, backupSettings, writeSettings, commandFor } from './lib/settings.mjs';

export const WRAP_PATH = join(DIR, 'statusline-wrap.json');
const SELF = fileURLToPath(import.meta.url);

const pct = w => (w ? `${Math.round(w.pct)}%` : null);

export function footer(snap) {
  const parts = [];
  if (snap.model) parts.push(snap.model);
  if (snap.contextPct != null) parts.push(`ctx ${Math.round(snap.contextPct)}%`);
  if (snap.fiveHour) parts.push(`5h ${pct(snap.fiveHour)}${snap.fiveHour.resetsAt ? ` (resets ${resetClock(snap.fiveHour.resetsAt)})` : ''}`);
  if (snap.week) parts.push(`wk ${pct(snap.week)}`);
  return parts.join(' · ');
}

export function isOurs(statusLine) {
  return Boolean(statusLine && /orchestrate\/scripts\/statusline\.mjs/.test(String(statusLine.command || '').replace(/\\/g, '/')));
}

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
    const snap = snapshotFrom(input);
    try { mkdirSync(DIR, { recursive: true }); writeJsonAtomic(QUOTA_PATH, snap); } catch {}
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
  if (isOurs(s.statusLine)) return 'already installed';
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
    let payload = '';
    try { payload = readFileSync(0, 'utf8'); } catch {}
    try { render(payload); } catch {}
  }
  process.exit(0);
}
