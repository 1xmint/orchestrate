#!/usr/bin/env node
// install.mjs — put the skill where the desktop apps read it, and register the
// hooks that carry the mechanical rules.
//
//   node scripts/install.mjs                     ~/.claude/skills/orchestrate, ~/.agents/..., role agents
//   node scripts/install.mjs --with-router        + the per-message router in ~/.claude/settings.json
//   node scripts/install.mjs --with-hook          + the Agent money guard and the SubagentStop ledger
//   node scripts/install.mjs --no-codex           skip ~/.agents
//   node scripts/install.mjs --no-agents          skip the role agents
//   node scripts/install.mjs --project <repo>     drop the project kit into one repo (see below)
//   node scripts/install.mjs --dry-run            say what would happen, change nothing
//
// Copies of the skill are clean (the target folder is replaced), so a file
// removed from the source does not linger. settings.json is *merged*: every
// entry that is not ours survives byte-for-byte, and a backup is written first.

import { existsSync, rmSync, cpSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  registrations, applyRegistrations, readSettings, writeSettings, backupSettings, nodeMajor, toPosix,
} from '../skills/orchestrate/scripts/lib/settings.mjs';
import { templateTree } from '../skills/orchestrate/scripts/lib/template.mjs';

// The interpreter, quoted and forward-slashed, for the templated hook commands
// and the skill's injected profile line. A GUI-launched desktop app has no
// shell PATH, so a bare `node` there resolves to nothing.
const nodeCmd = () => JSON.stringify(process.execPath.split(String.fromCharCode(92)).join('/'));

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'skills', 'orchestrate');
const HOME = homedir();
const argv = process.argv.slice(2);
const has = f => argv.includes(f);
const valueOf = f => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };
const dryRun = has('--dry-run');
const say = (...a) => console.log(`${dryRun ? '[dry-run] ' : ''}${a.join(' ')}`);

if (nodeMajor() < 18) {
  console.error(`orchestrate needs Node 18 or newer; this is ${process.version}`);
  process.exit(2);
}

// ---- the project kit takes over entirely -----------------------------------
if (has('--project')) {
  const repo = valueOf('--project');
  const kit = join(SRC, 'scripts', 'install-project.mjs');
  const args = [kit, repo || '', ...(dryRun ? ['--dry-run'] : [])].filter(Boolean);
  const r = spawnSync(process.execPath, args, { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}

// ---- the skill itself -------------------------------------------------------
const CLAUDE_SKILL = join(HOME, '.claude', 'skills', 'orchestrate');
const targets = [CLAUDE_SKILL];
if (!has('--no-codex')) targets.push(join(HOME, '.agents', 'skills', 'orchestrate'));

for (const t of targets) {
  if (!dryRun) {
    mkdirSync(dirname(t), { recursive: true });
    if (existsSync(t)) rmSync(t, { recursive: true, force: true });
    cpSync(SRC, t, { recursive: true });
    const changed = templateTree(t, { SKILL_DIR: t, NODE: nodeCmd() });
    if (changed.length) say(`templated {{SKILL_DIR}} in ${changed.length} file(s)`);
  }
  say(`installed -> ${t}`);
}

// ---- hooks in ~/.claude/settings.json --------------------------------------
const wantRouter = has('--with-router');
const wantGuard = has('--with-hook');
if (wantRouter || wantGuard) {
  const settingsPath = join(HOME, '.claude', 'settings.json');
  const scriptsDir = join(CLAUDE_SKILL, 'scripts');
  const entries = registrations(scriptsDir, { router: wantRouter, guard: wantGuard });
  const settings = readSettings(settingsPath);
  const before = JSON.stringify(settings);
  const report = applyRegistrations(settings, entries);
  if (!dryRun) {
    const backup = backupSettings(settingsPath, join(HOME, '.claude', 'orchestrate'));
    if (backup) say(`backed up settings -> ${toPosix(backup)}`);
    writeSettings(settingsPath, settings);
  }
  say(`settings ${toPosix(settingsPath)}: ${report.removed} stale orchestrate entr${report.removed === 1 ? 'y' : 'ies'} removed, ${report.added} registered (${report.basenames.join(', ')})`);
  say('takes effect in new sessions');
  if (dryRun && before === JSON.stringify(settings)) say('no change needed');
}

// ---- role agents ------------------------------------------------------------
if (!has('--no-agents')) {
  const args = [join(SRC, 'scripts', 'install-agents.mjs'), ...(dryRun ? ['--dry-run'] : [])];
  const r = spawnSync(process.execPath, args, { stdio: 'inherit', env: { ...process.env, ORCH_SKILL_DIR: CLAUDE_SKILL } });
  process.exit(r.status ?? 1);
}
