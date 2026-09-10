#!/usr/bin/env node
// run-init.mjs — create the ledger for one goal, or bind this session to one.
//
//   node run-init.mjs <slug> [--repo <path>] [--goal "text"] [--tier max5]
//                     [--host claude-code] [--providers "..."] [--session-id <id>]
//   node run-init.mjs --bind <path to RUN.md> --session-id <id>
//
// Creates .orchestrator/runs/<yyyymmdd>-<slug>/RUN.md from assets/RUN.md,
// fills the placeholders it can, keeps .orchestrator/ out of git through
// .git/info/exclude (local only, never a tracked .gitignore), and prints the
// path. Refuses to overwrite an existing RUN.md.
//
// `--session-id` is what makes a hook's write safe: it records which session
// owns this run, so a return is filed against the run its own session opened
// rather than against whichever run on the machine is newest. Without it the
// run is still created, and an unbound session can claim it later with --bind.

import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detect, block } from './gate.mjs';
import { rememberActiveRun, bindSessionRun, readRun } from './lib/tier.mjs';

const args = process.argv.slice(2);
const positional = [];
const opts = {};
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--')) { opts[args[i].slice(2)] = args[i + 1] ?? ''; i++; }
  else positional.push(args[i]);
}

// Bind mode: claim an existing run for this session and stop.
if (opts.bind) {
  const runMd = resolve(opts.bind);
  const run = readRun(runMd);
  if (!run) { console.error(`no RUN.md at ${runMd}`); process.exit(2); }
  if (!opts['session-id']) { console.error('--bind needs --session-id: the binding is what tells a hook which run is yours'); process.exit(2); }
  const bound = bindSessionRun(opts['session-id'], run);
  if (!bound) { console.error('could not write the session binding'); process.exit(1); }
  console.log(`bound session ${opts['session-id']} to ${run.runId}`);
  console.log(runMd);
  process.exit(0);
}

const slug = (positional[0] || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
if (!slug) {
  console.error('usage: run-init.mjs <slug> [--goal "text"] [--tier t] [--host h] [--providers "p"] [--session-id id]\n       run-init.mjs --bind <RUN.md> --session-id <id>');
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
  .replaceAll('{{BUDGET}}', opts.budget ? `$${String(opts.budget).replace(/^\$/, '')} at list price` : '<list-price dollars — set this with the user before the first dispatch>')
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

// Two records, and they do different jobs. The session binding is authority:
// a hook writes through it. The machine-wide pointer is only a hint for a
// session whose cwd is not inside any repo, and no write may resolve through it.
if (opts['session-id']) bindSessionRun(opts['session-id'], readRun(target, root));
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
