#!/usr/bin/env node
// test.mjs — the one "run everything" command, works the same in bash and in
// PowerShell. `node --test $(find skills -name '*.test.mjs')` needs a POSIX
// shell for both `find` and `$()`; PowerShell has neither, so that command in
// README.md silently failed there. This walks the tree itself with node:fs
// and hands the file list straight to `node --test`, no shell substitution.
//
//   node scripts/test.mjs         -> run every *.test.mjs under skills/ and
//                                    evals/*.test.mjs, bench/*.test.mjs and
//                                    bench/scenarios/*.test.mjs
//   node scripts/test.mjs --help  -> print the file list and exit 0, run
//                                    nothing (a dry check the drift test uses)

import { readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve, dirname, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
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
  // The eval and bench harness tests are offline and quota-free. Only the
  // top level of each folder plus bench/scenarios: never bench-hidden/, and
  // never the fixture files a case carries.
  for (const sub of ['evals', 'bench', join('bench', 'scenarios')]) {
    const dir = join(root, sub);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (name.endsWith('.test.mjs') && statSync(p).isFile() && !files.includes(p)) files.push(p);
    }
  }
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
  const result = spawnSync(process.execPath, ['--test', ...reporterArgs(), ...files], { stdio: 'inherit' });
  process.exit(result.status ?? 1);
}

// On GitHub, each failing test also becomes a check annotation (gh-annotate.mjs),
// so a red run names what failed without opening the log. Elsewhere the
// default output is unchanged.
export function reporterArgs(env = process.env) {
  if (env.GITHUB_ACTIONS !== 'true') return [];
  const annotate = pathToFileURL(join(ROOT, 'scripts', 'gh-annotate.mjs')).href;
  return ['--test-reporter=spec', '--test-reporter-destination=stdout',
    `--test-reporter=${annotate}`, '--test-reporter-destination=stdout'];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
