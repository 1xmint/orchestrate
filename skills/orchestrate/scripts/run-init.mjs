#!/usr/bin/env node
// run-init.mjs — create the ledger for one goal, or bind this session to one.
//
//   node run-init.mjs <slug> [--repo <path>] [--goal "text"] [--tier max5]
//                     [--host claude-code] [--providers "..."] [--session-id <id>]
//   node run-init.mjs --bind <path to RUN.md> --session-id <id>
//   node run-init.mjs --close <run id> [--reason "goal met"]   (--reopen undoes it)
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

import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync, utimesSync, readdirSync, statSync } from './lib/node.mjs';
import { spawnSync } from './lib/node.mjs';
import { homedir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detect, block } from './gate.mjs';
import { build as buildMap } from './map.mjs';
import { rememberActiveRun, bindSessionRun, readRun, loadSession } from './lib/tier.mjs';
import { findSessionTranscript } from './lib/context-store.mjs';
import { ownerTextOf } from './lib/compaction-snapshot.mjs';
import { clipWords } from './lib/goal.mjs';

// The newest `~/.claude/plans/*.md` touched after `sinceMs`, or null. Without
// a session-start time there is nothing to compare against, so this returns
// null rather than guess at how old is too old.
function freshPlanFile(sinceMs) {
  if (sinceMs == null) return null;
  try {
    let best = null;
    for (const f of readdirSync(join(homedir(), '.claude', 'plans'))) {
      if (!f.endsWith('.md')) continue;
      const p = join(homedir(), '.claude', 'plans', f);
      const st = statSync(p);
      if (st.mtimeMs > sinceMs && (!best || st.mtimeMs > best.mtimeMs)) best = { path: p, mtimeMs: st.mtimeMs };
    }
    return best ? best.path : null;
  } catch { return null; }
}

// The owner's own words, from this session's transcript: the newest message
// they typed and, when that is a short reply ("yes, go ahead"), the longest of
// the few before it as well. A Goal written only in the lead's words drifts
// from what was asked (live note Q). No transcript, no quote.
const QUOTE_CAP = 1200;
function ownerWords(sessionId) {
  const p = findSessionTranscript(sessionId);
  if (!p) return [];
  let text;
  try { text = readFileSync(p, 'utf8'); } catch { return []; }
  const said = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let rec;
    try { rec = JSON.parse(line); } catch { continue; }
    const t = ownerTextOf(rec).replace(/\s+/g, ' ').trim();
    if (t) said.push(t);
  }
  if (!said.length) return [];
  const words = t => t.split(' ').length;
  const newest = said[said.length - 1];
  if (words(newest) >= 12) return [newest];
  const earlier = said.slice(-5, -1).sort((a, b) => b.length - a.length)[0];
  return earlier && words(earlier) > words(newest) ? [earlier, newest] : [newest];
}

function goalText(opts) {
  const quoted = opts['session-id'] ? ownerWords(opts['session-id']) : [];
  if (!quoted.length) return opts.goal || '<goal in the user\'s words, then the objective in yours>';
  const q = quoted.map(t => `"${clipWords(t, QUOTE_CAP)}"`).join(' Then: ');
  return `The owner's words, quoted from the session: ${q}\n\nThe lead's reading: ${opts.goal || '<the objective in yours>'}`;
}

// The session's own start time, when `--session-id` names one this process
// can see. No id, no recorded start: null, and the Plan line is left off
// rather than compared against an arbitrary window.
function sessionStartMs(sessionId) {
  if (!sessionId) return null;
  const state = loadSession(sessionId);
  const t = state && state.started ? Date.parse(state.started) : NaN;
  return Number.isFinite(t) ? t : null;
}

// The host the Profile line names: --host, else the stored profile's host, else
// what profile.mjs reads from the environment, else unknown. profile.mjs prints
// "host claude-code" from the same variables, so the ledger no longer says
// "unknown" next to it.
function hostFor(opts, stored, env) {
  if (opts && opts.host) return opts.host;
  if (stored && typeof stored.host === 'string' && stored.host.trim()) return stored.host.trim();
  const keys = Object.keys(env || {});
  if (keys.some(k => /^CLAUDE(CODE|_CODE_|_SESSION|_PROJECT|_EFFORT)/.test(k))) return 'claude-code';
  if (keys.some(k => /^CODEX_/.test(k))) return 'codex';
  return 'unknown';
}

const USAGE = [
  'usage: run-init.mjs <slug> [--repo <path>] [--goal "text"] [--tier t] [--host h] [--providers "p"] [--session-id id]',
  '       run-init.mjs --bind <RUN.md> --session-id <id>',
  '       run-init.mjs --close <run id> [--reason "why"] [--repo <path>]',
  '       run-init.mjs --reopen <run id or RUN.md> [--repo <path>] [--session-id id]   (undoes --close, or wakes a run set aside as stale)',
].join('\n');
if (process.argv.slice(2).some(a => a === '--help' || a === '-h')) { console.log(USAGE); process.exit(0); }

const CLOSED_LINE = /^Closed:.*(\r?\n){0,2}/m;
const args = process.argv.slice(2);
const positional = [];
const opts = {};
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--')) { opts[args[i].slice(2)] = args[i + 1] ?? ''; i++; }
  else positional.push(args[i]);
}

// Reopen mode: a plan set aside as stale (untouched for two days) becomes live
// again. Touching RUN.md is the whole mechanism; nothing else records staleness.
if (opts.reopen) {
  const id = opts.reopen;
  const base = join(findRepoRoot(opts.repo || process.cwd()) || process.cwd(), '.orchestrator', 'runs');
  const runMd = /RUN\.md$/i.test(id) ? resolve(id) : join(base, id, 'RUN.md');
  if (!existsSync(runMd)) { console.error(`no RUN.md for ${id} under ${base}`); process.exit(2); }
  const text = readFileSync(runMd, 'utf8');
  if (CLOSED_LINE.test(text)) writeFileSync(runMd, text.replace(CLOSED_LINE, ''));
  const now = new Date();
  utimesSync(runMd, now, now);
  console.log(`reopened ${readRun(runMd).runId}: it is live again for 48 hours of inactivity`);
  if (opts['session-id']) bindSessionRun(opts['session-id'], readRun(runMd));
  process.exit(0);
}

// Close mode: the goal was met or dropped. One `Closed:` line under the title
// is the whole record; a closed run is never bound or reported again, even
// with blocked rows left in it, until --reopen removes the line.
if (opts.close) {
  const id = opts.close;
  const base = join(findRepoRoot(opts.repo || process.cwd()) || process.cwd(), '.orchestrator', 'runs');
  const runMd = /RUN\.md$/i.test(id) ? resolve(id) : join(base, id, 'RUN.md');
  if (!existsSync(runMd)) { console.error(`no RUN.md for ${id} under ${base}`); process.exit(2); }
  const text = readFileSync(runMd, 'utf8').replace(CLOSED_LINE, '');
  const line = `Closed: ${new Date().toISOString().slice(0, 10)} — ${(opts.reason || 'goal met').replace(/\s+/g, ' ').trim()}`;
  writeFileSync(runMd, /^# .*$/m.test(text) ? text.replace(/^(# .*)$/m, `$1\n\n${line}`) : `${line}\n\n${text}`);
  const runId = readRun(runMd).runId;
  console.log(`closed ${runId}; --reopen ${runId} makes it live again`);
  process.exit(0);
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
  console.error(USAGE);
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
  // A function, so a "$&" in the owner's words is not read as a pattern.
  .replaceAll('{{GOAL}}', () => goalText(opts))
  .replaceAll('{{TIER}}', opts.tier || 'unknown')
  .replaceAll('{{HOST}}', hostFor(opts, (() => { try { return JSON.parse(readFileSync(join(homedir(), '.claude', 'orchestrate', 'profile.json'), 'utf8')); } catch { return null; } })(), process.env))
  .replaceAll('{{PROVIDERS}}', opts.providers || 'unknown')
  .replaceAll('{{BUDGET}}', opts.budget ? `$${String(opts.budget).replace(/^\$/, '')} at list price` : 'none')
  .replaceAll('{{ID_PREFIX}}', idPrefix);

// The host's own plan file, when the user was in Plan mode this session and
// wrote one: a `Plan:` line so the run and the plan point at each other, and
// the checkpoint check (lib/context-advice.mjs) can treat a fresh plan as a real
// checkpoint. No fresh plan file, no line.
const plan = freshPlanFile(sessionStartMs(opts['session-id']));
const withPlan = plan ? body.replace('\n## Done when', `\nPlan: ${plan}\n\n## Done when`) : body;

// The gate is the same four commands on every run of this repo, so it is
// detected once and pasted under Facts, ready for the first packet.
let gateBlock = '';
try {
  const g = detect(root);
  mkdirSync(join(root, '.orchestrator'), { recursive: true });
  writeFileSync(join(root, '.orchestrator', 'gate.json'), JSON.stringify(g, null, 2) + '\n');
  gateBlock = block(g);
} catch {}

// The repo map, after gate.json so its Checks section can quote it. A packet
// points at map.md; a folder that is not a git checkout simply has none.
let mapLine = '';
try {
  const { md } = buildMap(root);
  mapLine = `MAP: ${join(root, '.orchestrator', 'map', 'map.md')} (${md.length} chars; any map.mjs query rebuilds it when HEAD moves)`;
} catch {}

const facts = [gateBlock, mapLine].filter(Boolean).join('\n');
const withGate = facts
  ? withPlan.replace('## Facts learned while grounding\n', `## Facts learned while grounding\n\n\`\`\`\n${facts}\n\`\`\`\n`)
  : withPlan;

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
