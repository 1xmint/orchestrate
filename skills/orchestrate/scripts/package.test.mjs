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
  assert.match(SKILL, /^!`node "\$\{CLAUDE_SKILL_DIR\}\/scripts\/profile\.mjs" --brief`$/m);
  assert.match(SKILL, /version: "\d+\.\d+\.\d+"/);
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
  // Whatever the version is, both builds carry the same one.
  assert.equal(/version: "([\d.]+)"/.exec(s)[1], /version: "([\d.]+)"/.exec(SKILL)[1]);
});

test('the portable build does not promise enforcement it cannot deliver', () => {
  // Flattened, so reflowing a paragraph never fails a test about what it says.
  const s = toSpec(SKILL).replace(/\s+/g, ' ');
  assert.doesNotMatch(s, /Three hooks hold the mechanical rules/);
  assert.match(s, /This host runs none of the skill's hooks/);
  assert.match(s, /it spends the user's own money, so recommend it, price it/, 'the money rule survives as prose');
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

test('the portable build leaves no unresolved path, since nothing resolves one there', () => {
  // No plugin host and no installer on claude.ai or Codex, so any token that
  // one of those two would have expanded has to be gone before it ships.
  for (const t of [toSpec(SKILL), toSpec(AGENT)]) {
    assert.doesNotMatch(t, /\{\{NODE\}\}|\{\{SKILL_DIR\}\}/);
  }
});

test('both builds carry the revised policy, and neither names a hook that is gone', () => {
  const spec = toSpec(SKILL);
  for (const [name, text] of [['plugin', SKILL], ['portable', spec]]) {
    // The three execution choices replaced the ten-rung routing ladder.
    assert.match(text, /\*\*Direct\.\*\*/, name);
    assert.match(text, /\*\*Assisted\.\*\*/, name);
    assert.match(text, /\*\*Coordinated\.\*\*/, name);
    // Review is bought for a named risk, not scheduled by model rank.
    assert.match(text, /authorisation or security boundary/, name);
    // Evidence is reused rather than rerun by ritual.
    assert.match(text, /Do not rerun it by ritual/, name);
    // Local durability is not publication.
    assert.match(text, /Local durability is not publication/, name);
    // And the maintainer rule that keeps this from growing back. Flattened,
    // so reflowing the paragraph never fails a test about what it says.
    assert.match(text.replace(/\s+/g, ' '), /needs a concrete failure it prevents/, name);
    assert.doesNotMatch(text, /return-check/, name);
    assert.doesNotMatch(text, /\d+% of a week/, name);
  }
});

test('the hook paths the plugin registers all point at scripts that exist', () => {
  const fm = /^---\n([\s\S]*?)\n---\n/.exec(SKILL)[1];
  const named = [...fm.matchAll(/scripts\/([A-Za-z0-9_-]+\.mjs)/g)].map(m => m[1]);
  assert.ok(named.length >= 3, 'the skill registers its hooks');
  for (const n of named) {
    assert.ok(existsSync(join(ROOT, 'skills', 'orchestrate', 'scripts', n)), `${n} exists`);
  }
  const hooks = readFileSync(join(ROOT, 'hooks', 'hooks.json'), 'utf8');
  JSON.parse(hooks);
  for (const m of hooks.matchAll(/scripts\/([A-Za-z0-9_-]+\.mjs)/g)) {
    assert.ok(existsSync(join(ROOT, 'skills', 'orchestrate', 'scripts', m[1])), `hooks.json names ${m[1]}, which exists`);
  }
});
