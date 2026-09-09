#!/usr/bin/env node
// install.mjs — put the skill where the desktop apps read it, and register the
// hooks that carry the mechanical rules.
//
//   node scripts/install.mjs                     ~/.claude/skills/orchestrate, ~/.agents/..., role agents
//   node scripts/install.mjs --with-router        + the per-message router in ~/.claude/settings.json
//   node scripts/install.mjs --with-hook          + the Agent money guard and the SubagentStop ledger
//   node scripts/install.mjs --with-reply-check   + the reply evaluator on Stop, globally (off by default)
//   node scripts/install.mjs --no-codex           skip ~/.agents
//   node scripts/install.mjs --no-agents          skip the role agents
//   node scripts/install.mjs --project <repo>     drop the project kit into one repo (see below)
//   node scripts/install.mjs --dry-run            say what would happen, change nothing
//
// Copies of the skill are clean (the target folder is replaced), so a file
// removed from the source does not linger. settings.json is *merged*: every
// entry that is not ours survives byte-for-byte, and a backup is written first.

import { existsSync, rmSync, cpSync, mkdirSync, readFileSync } from 'node:fs';
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

// ---- the output style -------------------------------------------------------
// Copied, never selected. An output style rewrites the system prompt for every
// turn of every session, so turning one on is the user's call, not an
// installer's. `outputStyle` lives in their settings and they choose it.
const STYLE_SRC = join(SRC, 'assets', 'output-styles', 'plain.md');
const STYLE_DST = join(HOME, '.claude', 'output-styles', 'plain.md');
if (existsSync(STYLE_SRC)) {
  if (!dryRun) { mkdirSync(dirname(STYLE_DST), { recursive: true }); cpSync(STYLE_SRC, STYLE_DST); }
  say(`output style -> ${toPosix(STYLE_DST)} (not selected; see below)`);
}

// ---- hooks in ~/.claude/settings.json --------------------------------------
const wantRouter = has('--with-router');
const wantGuard = has('--with-hook');

// The reply evaluator, globally rather than only in orchestrate sessions. Off
// by default: a false block re-reads the whole conversation, and nobody has
// measured the rate outside this skill yet. SKILL.md's own frontmatter carries
// the same prompt for sessions where the skill is in play, which is the scope
// it ships in until a measured week says otherwise.
const wantReplyCheck = has('--with-reply-check');
const REPLY_CHECK_SRC = join(SRC, 'assets', 'reply-check.txt');
let replyCheck = null;
if (wantReplyCheck) {
  try { replyCheck = readFileSync(REPLY_CHECK_SRC, 'utf8').replace(/\n+$/, ''); } catch {}
  if (!replyCheck) { console.error(`cannot read ${toPosix(REPLY_CHECK_SRC)}`); process.exit(1); }
}

if (wantRouter || wantGuard || replyCheck) {
  const settingsPath = join(HOME, '.claude', 'settings.json');
  const scriptsDir = join(CLAUDE_SKILL, 'scripts');
  const entries = registrations(scriptsDir, { router: wantRouter, guard: wantGuard, replyCheck });
  const settings = readSettings(settingsPath);
  const before = JSON.stringify(settings);
  const report = applyRegistrations(settings, entries);
  if (!dryRun) {
    const backup = backupSettings(settingsPath, join(HOME, '.claude', 'orchestrate'));
    if (backup) say(`backed up settings -> ${toPosix(backup)}`);
    writeSettings(settingsPath, settings);
  }
  const named = [...report.basenames, ...(replyCheck ? ['reply check (prompt hook, sonnet)'] : [])];
  say(`settings ${toPosix(settingsPath)}: ${report.removed} stale orchestrate entr${report.removed === 1 ? 'y' : 'ies'} removed, ${report.added} registered (${named.join(', ')})`);
  say('takes effect in new sessions');
  if (dryRun && before === JSON.stringify(settings)) say('no change needed');
}

// ---- role agents ------------------------------------------------------------
if (!has('--no-agents')) {
  const args = [join(SRC, 'scripts', 'install-agents.mjs'), ...(dryRun ? ['--dry-run'] : [])];
  const r = spawnSync(process.execPath, args, { stdio: 'inherit', env: { ...process.env, ORCH_SKILL_DIR: CLAUDE_SKILL } });
  if (r.status) process.exit(r.status);
}

if (existsSync(STYLE_SRC)) {
  console.log('');
  console.log('The "Plain" output style is installed but off. It answers first, proves every');
  console.log('claim, and explains rather than defines, on every turn of every session.');
  console.log('Turn it on by adding this to ~/.claude/settings.json (or a project\'s');
  console.log('.claude/settings.local.json), then starting a new session:');
  console.log('');
  console.log('  "outputStyle": "Plain"');
  console.log('');
  console.log('Claude Code also ships a built-in "Concise" style that leads with the result');
  console.log('and drops the narration. Try that first if you only want shorter answers.');
  console.log('');
  console.log('Installed as a plugin instead, the Plain voice is on in every session without');
  console.log('anybody selecting it, and disabling the plugin is the way off.');
}

if (!wantReplyCheck) {
  console.log('');
  console.log('The reply check is on inside orchestrate sessions and off everywhere else.');
  console.log('It is one Sonnet call per turn that reads only your last reply, and sends the');
  console.log('turn back once when a claim names no evidence. To run it in every session:');
  console.log('');
  console.log('  node scripts/install.mjs --with-reply-check');
  console.log('');
  console.log('See it working with: node skills/orchestrate/scripts/measure.mjs --latest');
}
