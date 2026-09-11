#!/usr/bin/env node
// batch.mjs — WS5's in-model fan-out lane. Turns one mechanical change spec
// and a file list into N per-file packets and N `RUN.md` task rows, so a
// mass-edit ("rename this field everywhere", "add this header to every
// route") can go out as N parallel `orch-implementer` dispatches, each in its
// own worktree owning exactly one file, capped at a concurrency the lead
// controls.
//
// This exists because the model cannot reliably start Claude Code's own
// `/batch` (a user-typed slash command, per lanes.md) or the Workflow tool
// (not exposed to the model here, re-checked 2026-09-10 — see hosts.md), so a
// portable fallback that works with only the Agent tool this skill already
// uses is worth building. If a future host exposes either to the model
// directly, prefer that; this stays the one that works everywhere.
//
// Every task here owns exactly one file — never split a file across two
// tasks, and never batch a file whose change needs to see another file (a
// shared rename across a type and its usages is not this lane; that needs
// one task that owns the whole set). The spec is the one mechanical
// instruction applied identically to every file; a task whose edit differs in
// kind from the others does not belong in the same batch.
//
//   node batch.mjs <RUN.md> --spec "<the mechanical instruction>" \
//     --files "a.ts,b.ts,c.ts" [--done-when "<command>"] \
//     [--concurrency 20] [--role orch-implementer] [--model sonnet] \
//     [--dry-run]
//
// Prints the task rows (paste into RUN.md's table) and, for each file, the
// full packet (paste into that file's Agent dispatch). Without --dry-run,
// also writes each packet to <run dir>/batch/<slug>/<id>.md so a long batch
// does not have to be re-typed if the session is interrupted mid-wave.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

// The next unused NNNN in the run's own `{{ID_PREFIX}}-NNNN` sequence, read
// from its task table so a batch never collides with ids already in use.
export function nextTaskNumber(runMdText, idPrefix) {
  const re = new RegExp(`^\\|\\s*${idPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-(\\d{4,})\\s*\\|`, 'gm');
  let max = 0;
  for (const m of String(runMdText || '').matchAll(re)) max = Math.max(max, Number(m[1]));
  return max + 1;
}

export function idPrefixFromRunMd(runMdText) {
  const m = /\|\s*(\d+-\d+)-\d{4,}\s*\|/.exec(String(runMdText || ''));
  return m ? m[1] : null;
}

const pad4 = n => String(n).padStart(4, '0');

// One task per file: a row for the table, and the full packet text. `owns`
// is the single file, which is what makes N of these safe to run at once —
// an agent cannot see the other worktrees, so two tasks owning the same file
// is a merge conflict after both finish, not a warning here.
export function buildBatch({ idPrefix, startAt = 1, spec, objective, doneWhen, files, role = 'orch-implementer', model = 'sonnet', concurrency = 20, runId }) {
  const list = (files || []).filter(Boolean);
  if (!idPrefix) throw new Error('idPrefix is required (e.g. "9-10", from the run\'s own task ids)');
  if (!spec) throw new Error('--spec is required: the one mechanical instruction applied to every file');
  if (!list.length) throw new Error('--files is required: a non-empty list');

  const tasks = list.map((file, i) => {
    const id = `${idPrefix}-${pad4(startAt + i)}`;
    const done = doneWhen || 'the gate the run already detected, run against this file alone where that is possible';
    const row = `| ${id} | 📋 planned | — | ${file} | ${role} · ${model} | ${spec} | ${done} | 0 | — |`;
    const packet = [
      `TASK: ${id}  ROLE: ${role.replace(/^orch-/, '')}`,
      ...(runId ? [`RUN: ${runId}`] : []),
      '',
      'OBJECTIVE',
      objective || spec,
      '',
      'CONTEXT',
      `- this is one task in a batch of ${list.length} applying the same mechanical change across files; every other file is a separate task owning its own file, not yours to touch`,
      '',
      'SCOPE',
      `in: ${file}`,
      'out: any other file, even one that looks related — a shared change belongs to one task that owns the whole set, not a batch',
      '',
      `OWNS: ${file}`,
      'WHERE: worktree: yes',
      '',
      'DONE WHEN (evidence)',
      `- ${done}`,
    ].join('\n');
    return { id, file, row, packet };
  });

  const waves = [];
  for (let i = 0; i < tasks.length; i += concurrency) waves.push(tasks.slice(i, i + concurrency).map(t => t.id));

  return { tasks, waves, concurrency };
}

function parseArgs(argv) {
  const positional = [];
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      if (key === 'dry-run') { opts[key] = true; continue; }
      opts[key] = argv[i + 1] ?? '';
      i++;
    } else positional.push(argv[i]);
  }
  return { positional, opts };
}

function main() {
  const { positional, opts } = parseArgs(process.argv.slice(2));
  const runMd = positional[0] ? resolvePath(positional[0]) : null;
  if (!runMd || !existsSync(runMd)) {
    console.error('usage: batch.mjs <RUN.md> --spec "…" --files "a,b,c" [--done-when "…"] [--concurrency 20] [--role orch-implementer] [--model sonnet] [--dry-run]');
    process.exit(2);
  }
  const runText = readFileSync(runMd, 'utf8');
  const idPrefix = idPrefixFromRunMd(runText);
  if (!idPrefix) { console.error(`could not find an existing task id in ${runMd} to read the id prefix from`); process.exit(2); }
  const startAt = nextTaskNumber(runText, idPrefix);
  const runId = (/^#\s*Run\s+(\S+)/m.exec(runText) || [])[1] || null;

  const files = (opts.files || '').split(',').map(s => s.trim()).filter(Boolean);
  const concurrency = opts.concurrency ? Number(opts.concurrency) : 20;

  let result;
  try {
    result = buildBatch({
      idPrefix, startAt, spec: opts.spec, objective: opts.objective, doneWhen: opts['done-when'],
      files, role: opts.role || 'orch-implementer', model: opts.model || 'sonnet', concurrency, runId,
    });
  } catch (e) { console.error(String(e && e.message || e)); process.exit(2); }

  console.log(`${result.tasks.length} task(s), ${result.waves.length} wave(s) at concurrency ${result.concurrency}\n`);
  console.log('-- paste into RUN.md\'s task table --');
  for (const t of result.tasks) console.log(t.row);
  console.log('');

  if (!opts['dry-run']) {
    const dir = join(dirname(runMd), 'batch', new Date().toISOString().slice(0, 10).replace(/-/g, ''));
    mkdirSync(dir, { recursive: true });
    for (const t of result.tasks) writeFileSync(join(dir, `${t.id}.md`), t.packet + '\n');
    console.log(`packets written to ${dir}\\<id>.md`);
  } else {
    for (const t of result.tasks) { console.log(`-- packet ${t.id} (${t.file}) --`); console.log(t.packet); console.log(''); }
  }
}

if (process.argv[1] && resolvePath(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
