#!/usr/bin/env node
// project.mjs — the project page's two commands.
//
//   node project.mjs init <repo>    copy the template to <repo>/.orchestrator/PROJECT.md
//                                   when it is not there yet; writes nothing else
//   node project.mjs check <repo>   print its line count, byte count and whether
//                                   Next has a filled step; exit 1 past 60 lines
//                                   or when the file is missing

import { existsSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureProject, readProject, projectPath, nextSteps, MAX_LINES } from './lib/project.mjs';

export function check(root) {
  const text = readProject(root);
  if (text == null) return { ok: false, line: `no project page at ${projectPath(root)}` };
  const lines = text.replace(/\n$/, '').split('\n').length;
  const steps = nextSteps(text).length;
  const over = lines > MAX_LINES;
  return {
    ok: !over,
    line: `${projectPath(root)}: ${lines} lines, ${Buffer.byteLength(text, 'utf8')} bytes; Next ${steps ? `has ${steps} filled step${steps === 1 ? '' : 's'}` : 'is not filled'}${over ? `; over the ${MAX_LINES}-line limit` : ''}`,
  };
}

function main() {
  const [cmd, repo] = process.argv.slice(2);
  if (!['init', 'check'].includes(cmd) || !repo) { console.error('usage: project.mjs init|check <repo>'); process.exit(2); }
  const root = resolvePath(repo);
  if (!existsSync(root)) { console.error(`no such directory: ${root}`); process.exit(2); }
  if (cmd === 'init') {
    const r = ensureProject(root);
    console.log(r.action === 'created' ? `created ${r.path}; fill What this is for, Where it stands and Next` : r.action === 'exists' ? `${r.path} already exists; left alone` : `could not write ${r.path}`);
    process.exit(r.action === 'failed' ? 1 : 0);
  }
  const c = check(root);
  console.log(c.line);
  process.exit(c.ok ? 0 : 1);
}

if (process.argv[1] && resolvePath(process.argv[1]) === fileURLToPath(import.meta.url)) main();
