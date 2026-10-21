// lib/node.test.mjs — the hooks start without loading what they do not use.
// Every script outside the tests takes fs, crypto and child_process from
// lib/node.mjs, and the two hooks that run around every tool call load none of
// the expensive parts of Node on an ordinary call.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), '..');

function scripts(dir = SCRIPTS) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'fixtures' && e.name !== 'node_modules') out.push(...scripts(p)); }
    else if (e.name.endsWith('.mjs') && !e.name.endsWith('.test.mjs')) out.push(p);
  }
  return out;
}

test('no script outside the tests takes fs, crypto or child_process from Node directly', () => {
  const direct = /(?:from\s*|import\s*\(\s*|require\s*\(\s*)['"](?:node:)?(?:fs|fs\/promises|crypto|child_process)['"]/;
  const found = scripts()
    .filter(p => relative(SCRIPTS, p) !== join('lib', 'node.mjs'))
    .filter(p => direct.test(readFileSync(p, 'utf8')))
    .map(p => relative(SCRIPTS, p));
  assert.deepEqual(found, [], 'import these from lib/node.mjs instead');
});

// Runs a hook as Claude Code does, with a payload on stdin, and lists the parts
// of Node it loaded. The wrapper sets argv[1] to the hook so its main code runs.
function loaded(hook, payload) {
  const dir = mkdtempSync(join(tmpdir(), 'orch-node-'));
  if (!hook) { hook = join(dir, 'empty.mjs'); writeFileSync(hook, ''); }
  const wrap = join(dir, 'wrap.mjs');
  writeFileSync(wrap, [
    "import { pathToFileURL } from 'node:url';",
    'const hook = process.argv[2];',
    'process.argv.splice(1, 2, hook);',
    "process.on('exit', () => { process.stderr.write('\\nLOADED ' + JSON.stringify(process.moduleLoadList) + '\\n'); });",
    'await import(pathToFileURL(hook).href);',
  ].join('\n'));
  const r = spawnSync(process.execPath, [wrap, hook.startsWith(dir) ? hook : join(SCRIPTS, hook)], {
    input: JSON.stringify(payload), encoding: 'utf8', timeout: 30000,
    env: { ...process.env, HOME: dir, USERPROFILE: dir },
  });
  const line = String(r.stderr).split('\n').find(l => l.startsWith('LOADED '));
  assert.ok(line, `${hook} ran: ${r.stderr}`);
  return JSON.parse(line.slice(7));
}

test('the hooks that run around every tool call load no fs promises, crypto or child_process on an ordinary call', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'orch-node-cwd-'));
  const base = { session_id: 'node-1', cwd, transcript_path: '' };
  const cases = [
    ['context-check.mjs', { ...base, hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: { file_path: join(cwd, 'a.txt') }, tool_response: {} }],
    ['guard-bash.mjs', { ...base, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls -la' } }],
  ];
  // What Node's own module loader brings in (older Node versions read files
  // through fs promises) is not the hook's doing.
  const before = new Set(loaded(null, {}));
  for (const [hook, payload] of cases) {
    const list = loaded(hook, payload).filter(m => !before.has(m));
    for (const part of ['internal/fs/promises', 'crypto', 'child_process']) {
      assert.ok(!list.includes(`NativeModule ${part}`), `${hook} loaded ${part}`);
    }
  }
});
