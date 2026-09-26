#!/usr/bin/env node
// test.mjs — the one "run everything" command, works the same in bash and in
// PowerShell. `node --test $(find skills -name '*.test.mjs')` needs a POSIX
// shell for both `find` and `$()`; PowerShell has neither, so that command in
// README.md silently failed there. This walks the tree itself with node:fs
// and hands the file list straight to `node --test`, no shell substitution.
//
//   node scripts/test.mjs         -> run every *.test.mjs under skills/ and
//                                    evals/no-machinery.test.mjs
//   node scripts/test.mjs --help  -> print the file list and exit 0, run
//                                    nothing (a dry check the drift test uses)

import { readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith('.test.mjs')) out.push(p);
  }
  return out;
}

export function collectTestFiles(root = ROOT) {
  const files = walk(join(root, 'skills'));
  const noMachinery = join(root, 'evals', 'no-machinery.test.mjs');
  if (existsSync(noMachinery)) files.push(noMachinery);
  return files.sort();
}

function main() {
  const files = collectTestFiles();
  const dry = process.argv.includes('--help') || process.argv.includes('--dry-run');
  if (dry) {
    for (const f of files) console.log(relative(ROOT, f));
    console.log(`${files.length} test files`);
    process.exit(0);
  }
  const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
  process.exit(result.status ?? 1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
