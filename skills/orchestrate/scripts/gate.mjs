#!/usr/bin/env node
// gate.mjs — find the commands that decide whether a change is good in this
// repo, once, and write them down.
//
// Without this the orchestrator reads AGENTS.md, CLAUDE.md, the justfile, the
// Makefile, package.json, Cargo.toml and pyproject on every run to learn the
// same four commands, and every packet restates them from memory. Here they are
// discovered from the files, dated, and pasted into packets verbatim.
//
//   node gate.mjs [repo]            print the block, write .orchestrator/gate.json
//   node gate.mjs [repo] --json     the whole detection as JSON
//   node gate.mjs [repo] --print    print the block from an existing gate.json
//   node gate.mjs [repo] --dry-run  print, write nothing
//
// Ordering: an explicit instruction in AGENTS.md or CLAUDE.md beats a task
// runner, a task runner beats a package manifest, and CI is the tiebreak,
// because CI is what actually blocks a merge.

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

// 'gate' is the repo's own umbrella command (`just check`, `npm run ci`): when
// one exists it is the whole answer, so it is listed first.
export const KINDS = ['gate', 'build', 'test', 'lint', 'fmt', 'typecheck'];

const read = p => { try { return readFileSync(p, 'utf8'); } catch { return null; } };

// A line in AGENTS.md/CLAUDE.md like "run `just check` before every commit".
export function fromInstructions(text) {
  const out = [];
  if (!text) return out;
  for (const line of text.split('\n')) {
    if (!/\b(run|always run|must run|before (you )?(commit|push|opening a pr)|gate|check)\b/i.test(line)) continue;
    for (const m of line.matchAll(/`([^`\n]{3,120})`/g)) {
      const cmd = m[1].trim();
      if (!/^(just|make|npm|pnpm|yarn|bun|cargo|python|pytest|uv|poetry|ruff|tox|go|dotnet|mvn|gradle|bazel|task|deno)\b/.test(cmd)) continue;
      out.push({ cmd, kind: kindOf(cmd), source: 'AGENTS.md/CLAUDE.md instruction' });
    }
  }
  return out;
}

export function kindOf(cmd) {
  const c = cmd.toLowerCase();
  if (/\b(fmt|format|prettier)\b/.test(c)) return 'fmt';
  if (/\b(lint|clippy|ruff|eslint|flake8)\b/.test(c)) return 'lint';
  if (/\b(typecheck|tsc|mypy|pyright)\b/.test(c)) return 'typecheck';
  if (/\btest|pytest|spec\b/.test(c)) return 'test';
  if (/\b(check|verify|ci|gate|quality|hooks|all)\b/.test(c)) return 'gate';
  if (/\b(build|compile)\b/.test(c)) return 'build';
  return 'build';
}

// Recipe names from a justfile, target names from a Makefile: only the ones
// whose name says what they are for, so a packet never suggests `just deploy`.
export function fromTaskRunner(text, runner) {
  const out = [];
  if (!text) return out;
  const re = runner === 'just' ? /^([a-zA-Z][\w-]*)(?:\s+[^:\n]*)?:(?!=)/gm : /^([a-zA-Z][\w-]*):(?!=)/gm;
  for (const m of text.matchAll(re)) {
    const name = m[1];
    if (!/^(check|test|tests|lint|fmt|format|build|ci|typecheck|verify|all|gate|quality)$/i.test(name)) continue;
    out.push({ cmd: `${runner} ${name}`, kind: kindOf(name), source: runner === 'just' ? 'justfile' : 'Makefile' });
  }
  return out;
}

export function fromPackageJson(text) {
  const out = [];
  let pkg; try { pkg = JSON.parse(text); } catch { return out; }
  const scripts = (pkg && pkg.scripts) || {};
  const pm = 'npm run';
  for (const name of Object.keys(scripts)) {
    if (!/^(test|lint|build|typecheck|check|format|fmt|ci|verify)$/i.test(name)) continue;
    out.push({ cmd: `${pm} ${name}`, kind: kindOf(name), source: 'package.json scripts' });
  }
  return out;
}

export function fromCargo() {
  return [
    { cmd: 'cargo build --all-targets', kind: 'build', source: 'Cargo.toml' },
    { cmd: 'cargo test', kind: 'test', source: 'Cargo.toml' },
    { cmd: 'cargo clippy --all-targets -- -D warnings', kind: 'lint', source: 'Cargo.toml' },
    { cmd: 'cargo fmt --check', kind: 'fmt', source: 'Cargo.toml' },
  ];
}

export function fromPyproject(text) {
  const out = [];
  if (!text) return out;
  if (/\[tool\.pytest|pytest/.test(text)) out.push({ cmd: 'pytest -q', kind: 'test', source: 'pyproject.toml' });
  if (/\[tool\.ruff/.test(text)) out.push({ cmd: 'ruff check .', kind: 'lint', source: 'pyproject.toml' });
  if (/\[tool\.mypy/.test(text)) out.push({ cmd: 'mypy .', kind: 'typecheck', source: 'pyproject.toml' });
  return out;
}

// What CI actually runs, as a tiebreak and as the honest answer to "what blocks
// a merge". Lines are read as text: a workflow file is data, not instructions.
export function fromWorkflows(root) {
  const out = [];
  const dir = join(root, '.github', 'workflows');
  let files = [];
  try { files = readdirSync(dir).filter(f => /\.ya?ml$/.test(f)); } catch { return out; }
  for (const f of files.slice(0, 10)) {
    const text = read(join(dir, f));
    if (!text) continue;
    for (const m of text.matchAll(/^\s*(?:-\s*)?run:\s*(?:\|\s*)?(.+)$/gm)) {
      const cmd = m[1].trim().replace(/^["']|["']$/g, '');
      if (!/^(just|make|npm|pnpm|yarn|cargo|pytest|python -m pytest|ruff|mypy|go test|dotnet test)\b/.test(cmd)) continue;
      if (cmd.length > 120) continue;
      out.push({ cmd, kind: kindOf(cmd), source: `.github/workflows/${f}` });
    }
  }
  return out;
}

export function detect(root) {
  const at = new Date().toISOString().slice(0, 10);
  const agents = read(join(root, 'AGENTS.md'));
  const claude = read(join(root, 'CLAUDE.md'));
  const candidates = [
    ...fromInstructions(agents),
    ...fromInstructions(claude),
    ...fromTaskRunner(read(join(root, 'justfile')) || read(join(root, 'Justfile')), 'just'),
    ...fromTaskRunner(read(join(root, 'Makefile')), 'make'),
    ...(existsSync(join(root, 'package.json')) ? fromPackageJson(read(join(root, 'package.json')) || '{}') : []),
    ...(existsSync(join(root, 'Cargo.toml')) ? fromCargo() : []),
    ...fromPyproject(read(join(root, 'pyproject.toml'))),
    ...fromWorkflows(root),
  ];

  // First source wins per kind, and a command is never listed twice.
  const chosen = {};
  const seen = new Set();
  for (const c of candidates) {
    if (seen.has(c.cmd)) continue;
    seen.add(c.cmd);
    if (!chosen[c.kind]) chosen[c.kind] = c;
  }

  return {
    at, root,
    standards: [agents ? 'AGENTS.md' : null, claude ? 'CLAUDE.md' : null].filter(Boolean),
    agentsNotLoaded: Boolean(agents) && !claude,
    gate: KINDS.map(k => chosen[k]).filter(Boolean),
    candidates,
  };
}

// The six lines a packet pastes verbatim.
export function block(g) {
  const lines = ['GATE (detected ' + g.at + '; re-run scripts/gate.mjs if the repo changed)'];
  if (g.gate.length) for (const c of g.gate) lines.push(`  ${c.kind}: ${c.cmd}   (${c.source})`);
  else lines.push('  none detected: ask the user for the command that proves a change is good');
  lines.push(`  repo standards: ${g.standards.length ? g.standards.join(', ') : 'none in the repo root'}`);
  if (g.agentsNotLoaded) lines.push('  AGENTS.md is NOT loaded by Claude Code (it reads CLAUDE.md only): paste its never-do rules into every packet, or add "@AGENTS.md" to CLAUDE.md');
  return lines.join('\n');
}

function main() {
  const args = process.argv.slice(2);
  const root = resolvePath(args.find(a => !a.startsWith('--')) || process.cwd());
  const out = join(root, '.orchestrator', 'gate.json');

  if (args.includes('--print')) {
    let g; try { g = JSON.parse(readFileSync(out, 'utf8')); } catch { console.error(`no gate.json at ${out}; run: node gate.mjs "${root}"`); process.exit(1); }
    console.log(block(g));
    return;
  }

  const g = detect(root);
  if (args.includes('--json')) { console.log(JSON.stringify(g, null, 2)); return; }
  if (!args.includes('--dry-run')) {
    mkdirSync(join(root, '.orchestrator'), { recursive: true });
    writeFileSync(out, JSON.stringify(g, null, 2) + '\n');
  }
  console.log(block(g));
  if (!args.includes('--dry-run')) console.log(`\nwritten to ${out}`);
}

if (process.argv[1] && resolvePath(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (e) { console.error(String(e && e.message)); process.exit(1); }
}
