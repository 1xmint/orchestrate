import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyTemplate, hasPlaceholder, templateTree } from './template.mjs';

test('a Windows path is substituted with forward slashes', () => {
  const out = applyTemplate('hooks: node "{{SKILL_DIR}}/scripts/return-check.mjs"', { SKILL_DIR: 'C:\\Users\\Josh\\.claude\\skills\\orchestrate' });
  assert.equal(out, 'hooks: node "C:/Users/Josh/.claude/skills/orchestrate/scripts/return-check.mjs"');
  assert.doesNotMatch(out, /\\/);
});

test('every occurrence is replaced and unknown placeholders are left alone', () => {
  const out = applyTemplate('{{SKILL_DIR}} and {{SKILL_DIR}} but not {{OTHER}}', { SKILL_DIR: '/x' });
  assert.equal(out, '/x and /x but not {{OTHER}}');
  assert.ok(hasPlaceholder('a {{SKILL_DIR}} b'));
  assert.ok(!hasPlaceholder('a b'));
});

test('templateTree rewrites markdown in place, recursively, and reports what changed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'orch-tpl-'));
  mkdirSync(join(dir, 'assets', 'agents'), { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), 'run {{SKILL_DIR}}/scripts/profile.mjs');
  writeFileSync(join(dir, 'assets', 'agents', 'orch-reviewer.md'), 'hook: {{SKILL_DIR}}/scripts/return-check.mjs');
  writeFileSync(join(dir, 'README.md'), 'nothing to do here');
  writeFileSync(join(dir, 'router.mjs'), '// {{SKILL_DIR}} stays: not a .md file');

  const changed = templateTree(dir, { SKILL_DIR: '/opt/skill' });
  assert.equal(changed.length, 2);
  assert.equal(readFileSync(join(dir, 'SKILL.md'), 'utf8'), 'run /opt/skill/scripts/profile.mjs');
  assert.match(readFileSync(join(dir, 'assets', 'agents', 'orch-reviewer.md'), 'utf8'), /^hook: \/opt\/skill\//);
  assert.equal(readFileSync(join(dir, 'README.md'), 'utf8'), 'nothing to do here');
  assert.match(readFileSync(join(dir, 'router.mjs'), 'utf8'), /\{\{SKILL_DIR\}\}/);

  assert.equal(templateTree(dir, { SKILL_DIR: '/opt/skill' }).length, 0, 'idempotent: a second pass changes nothing');
});

test('a missing directory is not an error', () => {
  assert.deepEqual(templateTree(join(tmpdir(), 'orch-does-not-exist-12345'), { SKILL_DIR: '/x' }), []);
});
