// assets.test.mjs — the shipped markdown has to keep its frontmatter contract.
// These are cheap checks that catch drift a human edit would introduce.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AGENT_NAMES } from './lib/tier.mjs';

const SKILL = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const AGENTS = join(SKILL, 'assets', 'agents');

const frontmatter = text => {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  assert.ok(m, 'the file starts with frontmatter');
  return m[1];
};

test('all six role agents ship, and each names itself', () => {
  const files = readdirSync(AGENTS).filter(f => f.endsWith('.md'));
  assert.equal(files.length, 6);
  for (const f of files) {
    const fm = frontmatter(readFileSync(join(AGENTS, f), 'utf8'));
    assert.match(fm, new RegExp(`^name: ${f.replace(/\.md$/, '')}$`, 'm'));
    assert.ok(AGENT_NAMES.includes(f.replace(/\.md$/, '')), `${f} is in AGENT_NAMES`);
  }
});

test('every role agent carries the return check as its own Stop hook', () => {
  for (const f of readdirSync(AGENTS).filter(f => f.endsWith('.md'))) {
    const fm = frontmatter(readFileSync(join(AGENTS, f), 'utf8'));
    assert.match(fm, /^hooks:$/m, f);
    assert.match(fm, /^ {2}Stop:$/m, f);
    // A single-quoted YAML scalar, so the interpreter path the installer
    // substitutes can carry its own quotes and its own spaces.
    assert.match(fm, /command: '\{\{NODE\}\} "\{\{SKILL_DIR\}\}\/scripts\/return-check\.mjs"'/, f);
    assert.ok(existsSync(join(SKILL, 'scripts', 'return-check.mjs')), 'the script the hook names exists');
  }
});

test('memory is on the two roles that gain from it, and off the two that would be steered by it', () => {
  const has = n => /^memory: user$/m.test(readFileSync(join(AGENTS, `${n}.md`), 'utf8'));
  assert.ok(has('orch-reviewer'), 'a reviewer should remember repo standards');
  assert.ok(has('orch-researcher'), 'a researcher should remember sources');
  assert.ok(!has('orch-implementer'), 'a stale note must not steer a change');
  assert.ok(!has('orch-debugger'), 'a stale note must not steer a diagnosis');
});

test('read-only roles keep read-only tool sets', () => {
  const tools = n => (/^tools: (.+)$/m.exec(readFileSync(join(AGENTS, `${n}.md`), 'utf8')) || [])[1] || '';
  for (const n of ['orch-reviewer', 'orch-planner', 'orch-researcher']) {
    const t = tools(n);
    assert.ok(t, `${n} declares a tool set`);
    assert.doesNotMatch(t, /\bEdit\b|\bNotebookEdit\b/, `${n} cannot edit`);
    // The planner and the researcher write exactly one document each; the
    // reviewer writes nothing at all, which is what makes its verdict worth
    // reading.
    if (n === 'orch-reviewer') assert.doesNotMatch(t, /\bWrite\b/, 'a reviewer cannot write');
  }
});

test('the placeholder is only ever {{SKILL_DIR}}, never a machine path', () => {
  for (const f of readdirSync(AGENTS).filter(f => f.endsWith('.md'))) {
    const text = readFileSync(join(AGENTS, f), 'utf8');
    assert.doesNotMatch(text, /C:\\Users|\/Users\/[a-z]+\/|\/home\/[a-z]+\//i, `${f} carries no machine path`);
  }
});

// The eval file is the input to the skill-creator loop. It was never run, and
// it turned out it could not be: the Windows path in eval 2 was written with
// unescaped backslashes, so the file was not valid JSON at all.
test('evals.json parses, and every eval carries the fields the loop needs', () => {
  const p = join(SKILL, '..', '..', 'evals', 'evals.json');
  const raw = readFileSync(p, 'utf8');
  const doc = JSON.parse(raw); // this threw before the fix
  assert.equal(doc.skill_name, 'orchestrate');
  assert.ok(Array.isArray(doc.evals) && doc.evals.length >= 3);
  const ids = new Set();
  for (const e of doc.evals) {
    for (const k of ['id', 'name', 'prompt', 'expected_output']) assert.ok(e[k], `eval ${e.id} has ${k}`);
    assert.ok(!ids.has(e.id), `eval id ${e.id} is unique`);
    ids.add(e.id);
    assert.match(e.name, /^[a-z0-9-]+$/);
  }
});

test('no eval hard-codes one machine, so the file runs on any checkout', () => {
  const raw = readFileSync(join(SKILL, '..', '..', 'evals', 'evals.json'), 'utf8');
  assert.doesNotMatch(raw, /C:\\Users|\/Users\/[a-z]+\/|\/home\/[a-z]+\//i);
  assert.match(raw, /\{\{FIXTURE_[A-Z]+\}\}/, 'fixtures are named by placeholder');
});
