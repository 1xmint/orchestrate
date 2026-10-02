#!/usr/bin/env node
// make-copy.mjs — build a plugin copy outside the repo for one bench arm.
//
//   node bench/make-copy.mjs --arm branch --out <dir>
//   node bench/make-copy.mjs --arm v0.21.0 --out <dir>
//
// branch: the working tree's plugin files plus bench/ (and bench-final/,
//         bench-pilot/ when present).
// <tag>:  the plugin files at that git tag (git archive), with the *current*
//         bench folders added, so both arms run the same cases.
// bench-hidden/ and .git are never copied: the agent must not be able to read
// the hidden tests.

import { readdirSync, statSync, mkdirSync, copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname, resolve, relative, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const PLUGIN_ROOTS = ['.claude-plugin', 'skills', 'hooks', 'agents', 'commands', 'output-styles'];
export const PLUGIN_FILES = ['LICENSE', 'README.md'];
export const BENCH_ROOTS = ['bench', 'bench-final', 'bench-pilot'];
const NEVER = ['.git', 'bench-hidden', 'node_modules', '.orchestrator', 'results'];

const norm = p => p.replace(/\\/g, '/').replace(/^\.\//, '');
const never = p => norm(p).split('/').some(seg => NEVER.includes(seg));

// Pure: which relative paths go in the copy. `pluginPaths` come from the arm's
// source (working tree or tag); `benchPaths` always from the current tree.
export function selectFiles(pluginPaths, benchPaths = []) {
  const plugin = pluginPaths.map(norm).filter(p => !never(p) &&
    (PLUGIN_FILES.includes(p) || PLUGIN_ROOTS.some(r => p.startsWith(`${r}/`))));
  const bench = benchPaths.map(norm).filter(p => !never(p) && BENCH_ROOTS.some(r => p.startsWith(`${r}/`)));
  return [...new Set([...plugin, ...bench])].sort();
}

function walk(root, dir = root, out = []) {
  for (const name of readdirSync(dir)) {
    if (NEVER.includes(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(root, p, out); else out.push(norm(relative(root, p)));
  }
  return out;
}

function copyAll(srcRoot, files, out) {
  for (const f of files) {
    const to = join(out, ...f.split('/'));
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(join(srcRoot, ...f.split('/')), to);
  }
}

// On the bench runner only the checked-out branch is local; every other branch
// is origin/<name>, which a bare name does not reach. A name that resolves
// neither way stays as given, so git archive reports it.
export function resolveArm(repo, arm) {
  const ok = r => spawnSync('git', ['-C', repo, 'rev-parse', '--verify', '--quiet', `${r}^{tree}`], { encoding: 'utf8' }).status === 0;
  return ok(arm) || !ok(`origin/${arm}`) ? arm : `origin/${arm}`;
}

export function makeCopy({ arm, out, repo }) {
  if (!existsSync(out)) mkdirSync(out, { recursive: true });
  else if (readdirSync(out).length) throw new Error(`out folder is not empty: ${out}`);
  const benchPaths = walk(repo);
  if (arm === 'branch') {
    const files = selectFiles(walk(repo), benchPaths);
    copyAll(repo, files, out);
    return files;
  }
  // Any other arm is a git tag or ref.
  const tmp = mkdtempSync(join(tmpdir(), 'bench-arm-'));
  try {
    const tarFile = join(tmp, 'src.tar');
    const a = spawnSync('git', ['-C', repo, 'archive', '--format=tar', '-o', tarFile, resolveArm(repo, arm)], { encoding: 'utf8' });
    if (a.status !== 0) throw new Error(`git archive ${arm} failed: ${(a.stderr || '').trim()}`);
    const src = join(tmp, 'src');
    mkdirSync(src);
    const x = spawnSync('tar', ['-xf', 'src.tar', '-C', 'src'], { cwd: tmp, encoding: 'utf8' });
    if (x.status !== 0) throw new Error(`tar failed: ${(x.stderr || '').trim()}`);
    const files = selectFiles(walk(src), benchPaths);
    // Plugin files from the tag, bench folders from the current tree.
    const isBench = f => BENCH_ROOTS.some(r => f.startsWith(`${r}/`));
    copyAll(src, files.filter(f => !isBench(f)), out);
    copyAll(repo, files.filter(isBench), out);
    return files;
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

if (resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2);
  const get = k => { const i = a.indexOf(`--${k}`); return i >= 0 ? a[i + 1] : null; };
  const arm = get('arm'), out = get('out');
  if (!arm || !out) { console.error('usage: make-copy.mjs --arm branch|<tag> --out <dir>'); process.exit(1); }
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const files = makeCopy({ arm, out: resolve(out), repo });
  console.log(`copied ${files.length} files for arm ${arm}`);
}
