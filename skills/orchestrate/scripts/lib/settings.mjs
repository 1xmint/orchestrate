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

// The interpreter is written in by absolute path, not as bare `node`. A desktop
// app launched from the dock or Start menu inherits the OS login environment,
// not a shell's, so a Node installed by nvm, Homebrew, fnm or volta is not on
// its PATH. With a bare `node` every hook here would fail silently and the
// skill's `!` injection would abort the invocation outright.
export function commandFor(scriptPath, node = process.execPath) {
  return `"${toPosix(node)}" "${toPosix(scriptPath)}"`;
}

// The basename of the script a hook command runs, or '' when we cannot tell.
export function commandBasename(command) {
  const m = /([A-Za-z0-9_.-]+\.mjs)/.exec(String(command || ''));
  return m ? basename(m[1]) : '';
}

// The interpreter path also ends in an executable name, never in .mjs, so the
// basename match above still finds the script and dedupe is unaffected.

// Remove every hook whose command names one of `basenames`, from every event
// array. Groups left with no hooks are dropped; untouched groups keep their
// object identity so a diff of the file shows only our lines.
// A prompt hook carries no script name, so a re-run of the installer would have
// stacked a second copy of it beside the first. It is recognised by the first
// line of its prompt instead, which is why `assets/reply-check.txt` starts with
// a line no other text would start with.
export function stripOurs(settings, basenames, promptFirstLines = []) {
  const names = new Set(basenames);
  const firsts = promptFirstLines.map(s => String(s).split('\n')[0].trim()).filter(Boolean);
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
        const isPrompt = h && h.type === 'prompt' && typeof h.prompt === 'string';
        const hit = isPrompt
          ? firsts.some(f => h.prompt.trim().startsWith(f))
          : names.has(commandBasename(h && h.command));
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

// The old name, kept so nothing that imported it breaks.
export const stripByBasename = (settings, basenames) => stripOurs(settings, basenames, []);

// Two shapes now. A command hook runs a script; a prompt hook hands its text to
// a Claude model and reads back {"ok": ...}. Both live in the same event arrays,
// so both go through here and both are stripped by `stripOurs` on a re-run.
export function addHook(settings, event, matcher, command, timeout, entry) {
  settings.hooks = settings.hooks || {};
  settings.hooks[event] = settings.hooks[event] || [];
  const hook = entry && entry.type === 'prompt'
    ? { type: 'prompt', prompt: entry.prompt, ...(entry.model ? { model: entry.model } : {}) }
    : { type: 'command', command };
  if (timeout) hook.timeout = timeout;
  const group = matcher ? { matcher, hooks: [hook] } : { hooks: [hook] };
  settings.hooks[event].push(group);
}

// What each flag registers. `scriptsDir` is where the *installed* copy lives.
export function registrations(scriptsDir, { router = false, guard = false, replyCheck = null } = {}) {
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
  if (replyCheck) {
    out.push({ event: 'Stop', matcher: null, type: 'prompt', prompt: replyCheck, model: 'sonnet', timeout: 30 });
  }
  return out;
}

// The whole merge, on a parsed settings object. Returns a report.
export function applyRegistrations(settings, entries) {
  const basenames = [...new Set(entries.map(e => commandBasename(e.command)).filter(Boolean))];
  const prompts = entries.filter(e => e.type === 'prompt').map(e => e.prompt);
  const removed = stripOurs(settings, basenames, prompts);
  for (const e of entries) addHook(settings, e.event, e.matcher, e.command, e.timeout, e);
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

// Top-level keys, merged into a settings file without touching anything else in
// it. Used by `profile.mjs --set-default` for the model and effort a *new*
// session starts on. `max` is refused: the host does not accept it in either
// key, and a settings file it rejects is worse than one that says nothing.
export function setKeys(settings, { model, effortLevel } = {}) {
  if (String(effortLevel).toLowerCase() === 'max' || String(model).toLowerCase() === 'max') {
    throw new Error('max is not accepted in model or effortLevel');
  }
  if (model) settings.model = String(model);
  if (effortLevel) settings.effortLevel = String(effortLevel);
  return settings;
}
