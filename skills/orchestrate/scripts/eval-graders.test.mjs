// eval-graders.test.mjs — no LLM grader under evals/ judges the whole run
// record (`focus: trace`). The eval host cuts the middle out of a long record
// ("[…14 messages elided…]"), and the plugin's records run longer because it
// sends helpers, so a trace judge failed work that was done (live notes V, X).
// A grader reads the final message or a file; what was or was not done goes
// to a tool_used or file grader. Lives under skills/ so the gate runs it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const EVALS = join(ROOT, 'evals');

function graderFiles() {
  const out = [];
  for (const c of readdirSync(EVALS, { withFileTypes: true })) {
    if (!c.isDirectory()) continue;
    const dir = join(EVALS, c.name, 'graders');
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) if (f.endsWith('.md')) out.push(join(dir, f));
  }
  return out;
}

const frontMatter = text => (text.match(/^---\r?\n([\s\S]*?)\r?\n---/) || [])[1] || '';

test('evals/ has graders to check', () => {
  assert.ok(graderFiles().length > 10);
});

test('no llm grader judges the whole run record', () => {
  const bad = graderFiles().filter(f => {
    const fm = frontMatter(readFileSync(f, 'utf8'));
    return /^type:\s*llm\s*$/m.test(fm) && /^focus:\s*["']?trace["']?\s*$/m.test(fm);
  }).map(f => relative(ROOT, f));
  assert.deepEqual(bad, [], 'use focus: last_message or a file; hold actions with tool_used graders');
});

test('every llm grader names what it reads', () => {
  const missing = graderFiles().filter(f => {
    const fm = frontMatter(readFileSync(f, 'utf8'));
    return /^type:\s*llm\s*$/m.test(fm) && !/^focus:/m.test(fm);
  }).map(f => relative(ROOT, f));
  assert.deepEqual(missing, []);
});
