#!/usr/bin/env node
// install-project.mjs — the project kit: what one repo needs so that any
// session in it starts knowing the gate and knowing when to orchestrate.
//
//   node install-project.mjs <repo> [--dry-run] [--force] [--with-claude-md]
//
// Four things, and nothing else:
//   1. .orchestrator/gate.json, the detected build/test/lint commands;
//   2. .orchestrator/ in .git/info/exclude, so the ledger is never committed
//      and no tracked .gitignore is touched;
//   3. .claude/rules/orchestrate.md, twelve lines or fewer: rules load every
//      session at CLAUDE.md priority, so a long one would be a tax on every
//      turn of every session in the repo;
//   4. when AGENTS.md exists and CLAUDE.md does not, the one-line fix printed,
//      and written only with --with-claude-md, because CLAUDE.md is a tracked
//      file and adding one is the user's call.
//
// The skill, the role agents and the global hooks stay at user level, so a
// second machine needs `node scripts/install.mjs` once and nothing per repo.

import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detect, block } from './gate.mjs';

export const RULES_REL = join('.claude', 'rules', 'orchestrate.md');
const MAX_RULE_LINES = 12;

// Never-do rules the repo already states. Only lines that read as a
// prohibition, at most three, quoted rather than paraphrased.
export function neverDoRules(text) {
  const out = [];
  if (!text) return out;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/^[-*>\s]+/, '').trim();
    if (line.length < 12 || line.length > 110) continue;
    if (!/^(never|do not|don't|must not|no one|nothing)\b/i.test(line)) continue;
    out.push(line.replace(/\s+/g, ' '));
    if (out.length === 3) break;
  }
  return out;
}

export function rulesFile(g, never) {
  const lines = ['# orchestrate (installed by the orchestrate skill; safe to delete)', ''];
  const gate = g.gate.slice(0, 4);
  if (gate.length) {
    lines.push(`Gate, detected ${g.at}: ${gate.map(c => `\`${c.cmd}\``).join(' · ')}.`);
  } else {
    lines.push('Gate: not detected. Ask what command proves a change is good here.');
  }
  lines.push('A change is not done until the gate has run and passed on it.');
  lines.push('');
  lines.push('A goal with several steps, or one that needs a review, goes through');
  lines.push('`/orchestrate` rather than being done turn by turn.');
  for (const n of never) lines.push(`- ${n}`);
  // Drop the quoted never-do rules before anything else: they are in the
  // repo's own files, which the session already loads. Truncate rather than
  // recurse: a recursive call with an unchanged argument would not terminate
  // if the fixed part ever grew past the budget on its own.
  const over = lines.join('\n').split('\n').length - MAX_RULE_LINES;
  const kept = over > 0 ? lines.slice(0, Math.max(0, lines.length - over)) : lines;
  return kept.join('\n') + '\n';
}

function excludePath(root) {
  const r = spawnSync('git', ['-C', root, 'rev-parse', '--git-path', 'info/exclude'], { encoding: 'utf8', windowsHide: true });
  const rel = (r.stdout || '').trim();
  return rel ? resolvePath(root, rel) : null;
}

export function plan(root) {
  const g = detect(root);
  const agents = existsSync(join(root, 'AGENTS.md')) ? readFileSync(join(root, 'AGENTS.md'), 'utf8') : null;
  const claude = existsSync(join(root, 'CLAUDE.md'));
  return {
    root, gate: g,
    gateJson: join(root, '.orchestrator', 'gate.json'),
    rulesPath: join(root, RULES_REL),
    rules: rulesFile(g, neverDoRules(agents)),
    needsClaudeMd: Boolean(agents) && !claude,
  };
}

function main() {
  const args = process.argv.slice(2);
  const repo = args.find(a => !a.startsWith('--'));
  if (!repo) { console.error('usage: install-project.mjs <repo> [--dry-run] [--force] [--with-claude-md]'); process.exit(2); }
  const root = resolvePath(repo);
  if (!existsSync(root)) { console.error(`no such directory: ${root}`); process.exit(2); }
  const dry = args.includes('--dry-run');
  const force = args.includes('--force');
  const say = (...a) => console.log(`${dry ? '[dry-run] ' : ''}${a.join(' ')}`);

  const p = plan(root);
  console.log(block(p.gate));
  console.log('');

  if (!dry) { mkdirSync(dirname(p.gateJson), { recursive: true }); writeFileSync(p.gateJson, JSON.stringify(p.gate, null, 2) + '\n'); }
  say(`gate  -> ${p.gateJson}`);

  if (existsSync(join(root, '.git'))) {
    const excl = excludePath(root);
    if (excl) {
      const cur = existsSync(excl) ? readFileSync(excl, 'utf8') : '';
      if (/^\.orchestrator\/?$/m.test(cur)) say('exclude -> .orchestrator/ already excluded');
      else {
        if (!dry) { mkdirSync(dirname(excl), { recursive: true }); appendFileSync(excl, (cur === '' || cur.endsWith('\n') ? '' : '\n') + '.orchestrator/\n'); }
        say(`exclude -> .orchestrator/ added to ${excl}`);
      }
    } else say('exclude -> could not ask git where info/exclude is; add .orchestrator/ by hand');
  } else say('exclude -> not a git repo; nothing to exclude');

  const existing = existsSync(p.rulesPath) ? readFileSync(p.rulesPath, 'utf8') : null;
  if (existing === p.rules) say(`rules -> ${p.rulesPath} already current`);
  else if (existing && !force && !existing.includes('installed by the orchestrate skill')) {
    say(`rules -> ${p.rulesPath} exists and was not written by this installer; left alone (--force overwrites)`);
  } else {
    if (!dry) { mkdirSync(dirname(p.rulesPath), { recursive: true }); writeFileSync(p.rulesPath, p.rules); }
    say(`rules -> ${p.rulesPath} (${p.rules.trimEnd().split('\n').length} lines; it is a tracked file, so commit or delete it)`);
  }

  if (p.needsClaudeMd) {
    const cmd = join(root, 'CLAUDE.md');
    console.log('');
    console.log('This repo has AGENTS.md and no CLAUDE.md. Claude Code reads only CLAUDE.md,');
    console.log('so nothing in AGENTS.md reaches a session or a subagent. One line fixes it:');
    console.log(`  echo "@AGENTS.md" > "${cmd}"`);
    if (args.includes('--with-claude-md')) {
      if (!dry) writeFileSync(cmd, '@AGENTS.md\n');
      say(`claude-md -> wrote ${cmd}`);
    } else {
      console.log('  (not written: CLAUDE.md is tracked, so that is your call. --with-claude-md writes it.)');
    }
  }
}

if (process.argv[1] && resolvePath(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (e) { console.error(String(e && e.message)); process.exit(1); }
}
