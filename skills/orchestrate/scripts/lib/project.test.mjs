// lib/project.test.mjs — the project page: the template, the reading helpers,
// and the one thing that writes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { ensureProject, projectPath, readProject, sections, nextSteps, projectHead, TEMPLATE_PATH, MAX_LINES, HEAD_CAP } from './project.mjs';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'project.mjs');
const FILLED = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'PROJECT.filled.md'), 'utf8');
const lines = t => t.replace(/\n$/, '').split('\n').length;

test('the template and the realistic filled example are within the 60-line limit', () => {
  assert.ok(lines(readFileSync(TEMPLATE_PATH, 'utf8')) <= MAX_LINES);
  assert.ok(lines(FILLED) <= MAX_LINES);
});

test('always-on budget: the example page plus the growth of SKILL.md and the card stays under 900 tokens (chars/4)', () => {
  // Before step 4: SKILL.md 19996 bytes, card.mjs 6538 bytes.
  const here = dirname(fileURLToPath(import.meta.url));
  const skill = readFileSync(join(here, '..', '..', 'SKILL.md')).length;
  const card = readFileSync(join(here, 'card.mjs')).length;
  const total = (Buffer.byteLength(FILLED) + (skill - 19996) + (card - 6538)) / 4;
  assert.ok(total <= 900, `${total} tokens`);
});

test('the template has the six sections in order, and every blank is recognisable', () => {
  const t = readFileSync(TEMPLATE_PATH, 'utf8');
  assert.deepEqual(Object.keys(sections(t)), ['What this is for', 'Where it stands', 'Next', 'Decisions', 'Open questions for the owner', 'Earlier research']);
  assert.equal(nextSteps(t).length, 0, 'an unfilled Next has no step');
  assert.equal(projectHead(t), '', 'an unfilled page has no head');
});

test('a filled page gives its head: purpose, where it stands and the numbered steps, within the cap', () => {
  assert.deepEqual(Object.keys(sections(FILLED)).slice(0, 3), ['What this is for', 'Where it stands', 'Next']);
  const steps = nextSteps(FILLED);
  assert.ok(steps.length >= 3 && steps.length <= 7);
  assert.ok(steps.every(s => s.includes('→')));
  const head = projectHead(FILLED);
  assert.match(head, /^What this is for: /);
  assert.match(head, /\nWhere it stands: /);
  assert.match(head, /\nNext:\n1\. /);
  assert.doesNotMatch(head, /Decisions|Earlier research/);
  assert.ok(Buffer.byteLength(head) <= HEAD_CAP);
  assert.ok(Buffer.byteLength(projectHead(FILLED, 200)) <= 200 + 4, 'a small cap clips at a line end');
});

test('ordinary angle brackets in a filled step are not blanks', () => {
  assert.equal(nextSteps('## Next\n\n1. Render <html> safely → the page shows\n').length, 1);
});

test('ensureProject copies the template once, writes only that file, and is idempotent', () => {
  const root = mkdtempSync(join(tmpdir(), 'orch-pp-'));
  assert.equal(readProject(root), null);
  assert.equal(ensureProject(root, { dryRun: true }).action, 'would-create');
  assert.equal(existsSync(projectPath(root)), false, 'a dry run writes nothing');
  assert.equal(ensureProject(root).action, 'created');
  assert.equal(readProject(root), readFileSync(TEMPLATE_PATH, 'utf8'));
  assert.deepEqual(readdirSync(root), ['.orchestrator']);
  assert.deepEqual(readdirSync(join(root, '.orchestrator')), ['PROJECT.md']);
  assert.equal(ensureProject(root).action, 'exists');
});

test('ensureProject never overwrites a page the lead has filled', () => {
  const root = mkdtempSync(join(tmpdir(), 'orch-pp-'));
  ensureProject(root);
  spawnSync(process.execPath, ['-e', `require('fs').writeFileSync(${JSON.stringify(projectPath(root))}, 'mine\\n')`]);
  assert.equal(ensureProject(root).action, 'exists');
  assert.equal(readProject(root), 'mine\n');
});

test('project.mjs init creates the page; check reports lines, bytes and Next, and fails past 60 lines', () => {
  const root = mkdtempSync(join(tmpdir(), 'orch-pp-'));
  const run = (...a) => spawnSync(process.execPath, [CLI, ...a], { encoding: 'utf8' });
  assert.equal(run('check', root).status, 1, 'missing page');
  assert.equal(run('init', root).status, 0);
  const c = run('check', root);
  assert.equal(c.status, 0);
  assert.match(c.stdout, /\d+ lines, \d+ bytes; Next is not filled/);
  const long = join(root, '.orchestrator', 'PROJECT.md');
  spawnSync(process.execPath, ['-e', `require('fs').writeFileSync(${JSON.stringify(long)}, '## Next\\n\\n1. a → b\\n' + 'x\\n'.repeat(70))`]);
  const o = run('check', root);
  assert.equal(o.status, 1);
  assert.match(o.stdout, /Next has 1 filled step; over the 60-line limit/);
});
