#!/usr/bin/env node
// install.mjs — put the skill where the desktop apps read it.
//
//   node scripts/install.mjs             -> ~/.claude/skills/orchestrate and ~/.agents/skills/orchestrate, then the role agents
//   node scripts/install.mjs --no-codex  -> skip ~/.agents
//   node scripts/install.mjs --no-agents -> skip role agents
//
// Copies are clean (the target folder is replaced), so a file removed from the
// source does not linger in the install.

import { existsSync, rmSync, cpSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'skills', 'orchestrate');
const HOME = homedir();
const targets = [join(HOME, '.claude', 'skills', 'orchestrate')];
if (!process.argv.includes('--no-codex')) targets.push(join(HOME, '.agents', 'skills', 'orchestrate'));

for (const t of targets) {
  mkdirSync(dirname(t), { recursive: true });
  if (existsSync(t)) rmSync(t, { recursive: true, force: true });
  cpSync(SRC, t, { recursive: true });
  console.log(`installed -> ${t}`);
}
if (!process.argv.includes('--no-agents')) {
  const r = spawnSync(process.execPath, [join(SRC, 'scripts', 'install-agents.mjs')], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}
