// lib/settings.mjs — the merge that puts orchestrate's hooks into
// ~/.claude/settings.json without disturbing anything else in it.
//
// Rules the installer relies on:
//   - dedupe by the *script basename* inside the command, so re-running the
//     installer never stacks a second copy of the same hook;
//   - every entry the user already has (memory-write-gate.mjs and friends)
//     survives byte-for-byte;
//   - absolute paths, forward slashes, quoted, no shell operators;
//   - a backup of the previous file before the first write.
//
// Pure functions, so the unit test can run the whole merge on a copy of a real
// settings.json without touching the machine.

import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';

export const OUR_SCRIPTS = ['router.mjs', 'guard-agent.mjs', 'ledger.mjs', 'turn-check.mjs'];

export function toPosix(p) {
  return String(p).replace(/\\/g, '/');
}

export function commandFor(scriptPath) {
  return `node "${toPosix(scriptPath)}"`;
}

// The basename of the script a hook command runs, or '' when we cannot tell.
export function commandBasename(command) {
  const m = /([A-Za-z0-9_.-]+\.mjs)/.exec(String(command || ''));
  return m ? basename(m[1]) : '';
}

// Remove every hook whose command names one of `basenames`, from every event
// array. Groups left with no hooks are dropped; untouched groups keep their
// object identity so a diff of the file shows only our lines.
export function stripByBasename(settings, basenames) {
  const names = new Set(basenames);
  let removed = 0;
  const hooks = settings.hooks;
  if (!hooks || typeof hooks !== 'object') return removed;
  for (const event of Object.keys(hooks)) {
    const groups = hooks[event];
    if (!Array.isArray(groups)) continue;
    const kept = [];
    for (const group of groups) {
      if (!group || !Array.isArray(group.hooks)) { kept.push(group); continue; }
      const inner = group.hooks.filter(h => {
        const hit = names.has(commandBasename(h && h.command));
        if (hit) removed++;
        return !hit;
      });
      if (inner.length === group.hooks.length) { kept.push(group); continue; }
      if (inner.length) kept.push({ ...group, hooks: inner });
    }
    if (kept.length) hooks[event] = kept;
    else delete hooks[event];
  }
  return removed;
}

export function addHook(settings, event, matcher, command, timeout) {
  settings.hooks = settings.hooks || {};
  settings.hooks[event] = settings.hooks[event] || [];
  const hook = { type: 'command', command };
  if (timeout) hook.timeout = timeout;
  const group = matcher ? { matcher, hooks: [hook] } : { hooks: [hook] };
  settings.hooks[event].push(group);
}

// What each flag registers. `scriptsDir` is where the *installed* copy lives.
export function registrations(scriptsDir, { router = false, guard = false } = {}) {
  const out = [];
  if (router) {
    const cmd = commandFor(join(scriptsDir, 'router.mjs'));
    out.push({ event: 'UserPromptSubmit', matcher: null, command: cmd, timeout: 5 });
    out.push({ event: 'SessionStart', matcher: 'resume|compact|clear', command: cmd, timeout: 5 });
  }
  if (guard) {
    out.push({ event: 'PreToolUse', matcher: 'Agent', command: commandFor(join(scriptsDir, 'guard-agent.mjs')), timeout: 10 });
    out.push({ event: 'SubagentStop', matcher: null, command: commandFor(join(scriptsDir, 'ledger.mjs')), timeout: 10 });
  }
  return out;
}

// The whole merge, on a parsed settings object. Returns a report.
export function applyRegistrations(settings, entries) {
  const basenames = [...new Set(entries.map(e => commandBasename(e.command)))];
  const removed = stripByBasename(settings, basenames);
  for (const e of entries) addHook(settings, e.event, e.matcher, e.command, e.timeout);
  return { removed, added: entries.length, basenames };
}

export function readSettings(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return {}; }
}

export function backupSettings(path, backupDir, now = new Date()) {
  if (!existsSync(path)) return null;
  mkdirSync(backupDir, { recursive: true });
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const dest = join(backupDir, `settings.backup.${stamp}.json`);
  copyFileSync(path, dest);
  return dest;
}

export function writeSettings(path, settings) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(settings, null, 2) + '\n');
}

export function nodeMajor(version = process.version) {
  const m = /v?(\d+)/.exec(String(version));
  return m ? Number(m[1]) : 0;
}
