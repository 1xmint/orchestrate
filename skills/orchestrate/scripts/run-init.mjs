#!/usr/bin/env node
// run-init.mjs — create the ledger for one goal.
//
//   node run-init.mjs <slug> [--repo <path>] [--goal "text"] [--tier max5] [--host claude-code] [--providers "..."]
//
// Creates .orchestrator/runs/<yyyymmdd>-<slug>/RUN.md from assets/RUN.md,
// fills the placeholders it can, keeps .orchestrator/ out of git through
// .git/info/exclude (local only, never a tracked .gitignore), and prints the
// path. Refuses to overwrite an existing RUN.md.

import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detect, block } from './gate.mjs';
import { rememberActiveRun } from './lib/tier.mjs';

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

// --repo names the repo the goal is about; without it, the ledger lands in the
// repo containing the current directory, which is often the wrong one.
const start = opts.repo ? resolve(opts.repo) : process.cwd();
if (opts.repo && !existsSync(start)) { console.error(`--repo not found: ${start}`); process.exit(2); }
const root = findRepoRoot(start) || start;
const now = new Date();
// Local calendar date everywhere, so the run id, the "started" line and the
// task id prefix agree even late in the evening.
const pad = n => String(n).padStart(2, '0');
const localDate = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
const ymd = localDate.replace(/-/g, '');
const runId = `${ymd}-${slug}`;
const dir = join(root, '.orchestrator', 'runs', runId);
const target = join(dir, 'RUN.md');
if (existsSync(target)) { console.error(`exists: ${target}\nresume it (read its Pickup section) or pick another slug, e.g. ${slug}-2`); process.exit(1); }

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

// The gate is the same four commands on every run of this repo, so it is
// detected once and pasted under Facts, ready for the first packet.
let gateBlock = '';
try {
  const g = detect(root);
  mkdirSync(join(root, '.orchestrator'), { recursive: true });
  writeFileSync(join(root, '.orchestrator', 'gate.json'), JSON.stringify(g, null, 2) + '\n');
  gateBlock = block(g);
} catch {}

const withGate = gateBlock
  ? body.replace('## Facts learned while grounding\n', `## Facts learned while grounding\n\n\`\`\`\n${gateBlock}\n\`\`\`\n`)
  : body;

mkdirSync(dir, { recursive: true });
writeFileSync(target, withGate);

// Point the hooks at this run. A session whose cwd is the folder above the
// repo — which is where Josh's sessions start — would otherwise find nothing.
rememberActiveRun(root, target);

// keep it out of git without touching tracked files. Inside a worktree or a
// submodule `.git` is a file, so ask git where the exclude file really is.
if (existsSync(join(root, '.git'))) {
  const r = spawnSync('git', ['-C', root, 'rev-parse', '--git-path', 'info/exclude'], { encoding: 'utf8', windowsHide: true });
  const rel = (r.stdout || '').trim();
  const excl = rel ? resolve(root, rel) : null;
  try {
    if (!excl) throw new Error('git rev-parse failed');
    mkdirSync(dirname(excl), { recursive: true });
    const cur = existsSync(excl) ? readFileSync(excl, 'utf8') : '';
    if (!/^\.orchestrator\/?$/m.test(cur)) {
      appendFileSync(excl, (cur === '' || cur.endsWith('\n') ? '' : '\n') + '.orchestrator/\n');
    }
  } catch (e) {
    console.error(`warning: could not exclude .orchestrator/ from git (${e.message}); add it to .git/info/exclude by hand so agents do not commit the ledger`);
  }
}
console.log(target);
console.log(`task id prefix: ${idPrefix}-NNNN`);
