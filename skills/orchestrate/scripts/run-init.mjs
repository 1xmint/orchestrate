#!/usr/bin/env node
// run-init.mjs — create the ledger for one goal.
//
//   node run-init.mjs <slug> [--goal "text"] [--tier max5] [--host claude-code] [--providers "..."]
//
// Creates .orchestrator/runs/<yyyymmdd>-<slug>/RUN.md from assets/RUN.md,
// fills the placeholders it can, keeps .orchestrator/ out of git through
// .git/info/exclude (local only, never a tracked .gitignore), and prints the
// path. Refuses to overwrite an existing RUN.md.

import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const positional = [];
const opts = {};
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--')) { opts[args[i].slice(2)] = args[i + 1] ?? ''; i++; }
  else positional.push(args[i]);
}
const slug = (positional[0] || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
if (!slug) {
  console.error('usage: run-init.mjs <slug> [--goal "text"] [--tier t] [--host h] [--providers "p"]');
  process.exit(2);
}

function findRepoRoot(start) {
  let d = resolve(start);
  for (let i = 0; i < 40; i++) {
    if (existsSync(join(d, '.git'))) return d;
    const p = dirname(d);
    if (p === d) return null;
    d = p;
  }
  return null;
}

const root = findRepoRoot(process.cwd()) || process.cwd();
const now = new Date();
// Local calendar date everywhere, so the run id, the "started" line and the
// task id prefix agree even late in the evening.
const pad = n => String(n).padStart(2, '0');
const localDate = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
const ymd = localDate.replace(/-/g, '');
const runId = `${ymd}-${slug}`;
const dir = join(root, '.orchestrator', 'runs', runId);
const target = join(dir, 'RUN.md');
if (existsSync(target)) { console.error(`exists: ${target}`); process.exit(1); }

const template = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'RUN.md'), 'utf8');
const idPrefix = `${now.getMonth() + 1}-${now.getDate()}`;
const body = template
  .replaceAll('{{RUN_ID}}', runId)
  .replaceAll('{{DATE}}', localDate)
  .replaceAll('{{GOAL}}', opts.goal || '<goal in the user\'s words, then the objective in yours>')
  .replaceAll('{{TIER}}', opts.tier || 'unknown')
  .replaceAll('{{HOST}}', opts.host || 'unknown')
  .replaceAll('{{PROVIDERS}}', opts.providers || 'unknown')
  .replaceAll('{{ID_PREFIX}}', idPrefix);

mkdirSync(dir, { recursive: true });
writeFileSync(target, body);

// keep it out of git without touching tracked files
const gitDir = join(root, '.git');
if (existsSync(gitDir)) {
  const excl = join(gitDir, 'info', 'exclude');
  try {
    mkdirSync(dirname(excl), { recursive: true });
    const cur = existsSync(excl) ? readFileSync(excl, 'utf8') : '';
    if (!/^\.orchestrator\/?$/m.test(cur)) {
      appendFileSync(excl, (cur === '' || cur.endsWith('\n') ? '' : '\n') + '.orchestrator/\n');
    }
  } catch {}
}
console.log(target);
console.log(`task id prefix: ${idPrefix}-NNNN`);
