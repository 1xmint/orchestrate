// package.test.mjs — the two builds. The Claude Code zip keeps the frontmatter
// that makes the rules mechanical; the portable one drops what its hosts
// cannot run, and says so rather than promising enforcement that is absent.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { toSpec, stripKey } from '../../../scripts/package.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SKILL = readFileSync(join(ROOT, 'skills', 'orchestrate', 'SKILL.md'), 'utf8');
const AGENT = readFileSync(join(ROOT, 'skills', 'orchestrate', 'assets', 'agents', 'orch-reviewer.md'), 'utf8');

test('the Claude Code source keeps what makes the rules mechanical', () => {
  assert.match(SKILL, /^hooks:$/m);
  assert.match(SKILL, /^when_to_use:/m);
  assert.match(SKILL, /^!`\{\{NODE\}\} "\$\{CLAUDE_SKILL_DIR\}\/scripts\/profile\.mjs" --brief`$/m);
  assert.match(SKILL, /version: "0\.4\.0"/);
});

test('the portable build drops hooks, when_to_use and the injection line', () => {
  const s = toSpec(SKILL);
  assert.doesNotMatch(s, /^hooks:$/m);
  assert.doesNotMatch(s, /^when_to_use:/m);
  assert.doesNotMatch(s, /guard-agent\.mjs"$/m, 'no hook command survives in the frontmatter');
  assert.doesNotMatch(s, /^!`/m);
  assert.doesNotMatch(s, /\$\{CLAUDE_SKILL_DIR\}/, 'a variable this host will not expand is replaced');
  assert.match(s, /^name: orchestrate$/m);
  assert.match(s, /^description: >-$/m);
  assert.match(s, /version: "0\.4\.0"/);
});

test('the portable build does not promise enforcement it cannot deliver', () => {
  const s = toSpec(SKILL);
  assert.doesNotMatch(s, /Three hooks hold the mechanical rules/);
  assert.match(s, /This host does not run the skill's hooks/);
  assert.match(s, /Fable is off on Pro, API, Team and unknown/, 'the money rule survives as prose');
  assert.match(s, /Never review your own edits/, 'so does the review rule');
});

test('an agent file loses hooks and memory but keeps its identity and tools', () => {
  const s = toSpec(AGENT);
  assert.doesNotMatch(s, /^hooks:$/m);
  assert.doesNotMatch(s, /^memory: user$/m);
  assert.doesNotMatch(s, /return-check\.mjs/);
  assert.match(s, /^name: orch-reviewer$/m);
  assert.match(s, /^tools: Read, Grep, Glob/m);
  assert.match(s, /^model: opus$/m);
});

test('stripKey removes the key and its indented block, and nothing else', () => {
  const fm = 'name: x\nhooks:\n  Stop:\n    - type: command\n      command: y\nmodel: opus\n';
  const out = stripKey(fm, 'hooks');
  assert.equal(out, 'name: x\nmodel: opus\n');
  assert.equal(stripKey('name: x\n', 'hooks'), 'name: x\n', 'a key that is absent changes nothing');
  assert.equal(stripKey('hooked: yes\nname: x', 'hook'), 'hooked: yes\nname: x', 'a prefix is not a match');
});

test('a file with no frontmatter passes through untouched', () => {
  const plain = '# Ladder\n\nSome prose.\n';
  assert.equal(toSpec(plain), plain);
});

test('both packaged artifacts exist and the tests are not in them', () => {
  for (const f of ['orchestrate.skill', 'orchestrate-spec.skill']) {
    const p = join(ROOT, f);
    assert.ok(existsSync(p), `${f} is built (node scripts/package.mjs --both)`);
    const zip = readFileSync(p, 'utf8');
    assert.doesNotMatch(zip, /\.test\.mjs/, `${f} ships no test files`);
    assert.match(zip, /orchestrate\/SKILL\.md/);
  }
});

test('the portable build falls back to plain node, since no installer runs there', () => {
  const s = toSpec(SKILL);
  assert.doesNotMatch(s, /\{\{NODE\}\}/);
  const a = toSpec(AGENT);
  assert.doesNotMatch(a, /\{\{NODE\}\}/);
});
