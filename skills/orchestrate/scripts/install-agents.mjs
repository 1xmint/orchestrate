#!/usr/bin/env node
// install-agents.mjs — copy the six orch-* role agents into ~/.claude/agents.
//
// Idempotent. A target that matches what we last installed is refreshed
// silently. A target the user edited since (its hash differs from our record)
// is left alone unless --force is given, so local tuning survives upgrades.
//
//   node install-agents.mjs            install or refresh
//   node install-agents.mjs --force    overwrite user-edited files too
//   node install-agents.mjs --dry-run  say what would happen

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOME = homedir();
const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'agents');
const DST = join(HOME, '.claude', 'agents');
const RECORD = join(HOME, '.claude', 'orchestrate', 'agents.installed.json');
const force = process.argv.includes('--force');
const dryRun = process.argv.includes('--dry-run');

const sha = s => createHash('sha256').update(s).digest('hex');
let record = {};
try { record = JSON.parse(readFileSync(RECORD, 'utf8')); } catch {}

if (!existsSync(SRC)) { console.error(`no agent sources at ${SRC}`); process.exit(2); }
if (!dryRun) { mkdirSync(DST, { recursive: true }); mkdirSync(dirname(RECORD), { recursive: true }); }

const files = readdirSync(SRC).filter(f => f.endsWith('.md'));
let installed = 0, refreshed = 0, kept = 0, unchanged = 0;
for (const f of files) {
  const src = readFileSync(join(SRC, f), 'utf8');
  const srcHash = sha(src);
  const dstPath = join(DST, f);
  if (!existsSync(dstPath)) {
    if (!dryRun) writeFileSync(dstPath, src);
    record[f] = srcHash; installed++;
    console.log(`installed  ${f}`);
    continue;
  }
  const cur = readFileSync(dstPath, 'utf8');
  const curHash = sha(cur);
  if (curHash === srcHash) { record[f] = srcHash; unchanged++; continue; }
  const userEdited = Boolean(record[f]) && record[f] !== curHash;
  if (userEdited && !force) {
    kept++;
    console.log(`kept       ${f}  (edited locally since install; use --force to overwrite)`);
    continue;
  }
  if (!dryRun) writeFileSync(dstPath, src);
  record[f] = srcHash; refreshed++;
  console.log(`refreshed  ${f}${userEdited ? '  (forced over local edits)' : ''}`);
}
if (!dryRun) writeFileSync(RECORD, JSON.stringify(record, null, 2) + '\n');
console.log(`${dryRun ? '[dry-run] ' : ''}${installed} installed, ${refreshed} refreshed, ${unchanged} unchanged, ${kept} kept -> ${DST}`);
