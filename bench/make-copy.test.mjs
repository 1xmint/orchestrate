import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectFiles } from './make-copy.mjs';

test('selectFiles keeps plugin files and bench folders, never bench-hidden or .git', () => {
  const plugin = ['.claude-plugin/plugin.json', 'skills/orchestrate/SKILL.md', 'hooks/hooks.json', 'docs/x.md', 'evals/a.mjs', '.git/config', 'bench-hidden/c/must.json', 'skills/node_modules/x.js', 'LICENSE'];
  const bench = ['bench/RULE.md', 'bench-final/c/prompt.md', 'bench-pilot/env-names/prompt.md', 'bench-hidden/c/a.test.mjs', 'bench/.git/x', 'skills/other.md'];
  const out = selectFiles(plugin, bench);
  assert.deepEqual(out, ['.claude-plugin/plugin.json', 'LICENSE', 'bench-final/c/prompt.md', 'bench-pilot/env-names/prompt.md', 'bench/RULE.md', 'hooks/hooks.json', 'skills/orchestrate/SKILL.md']);
  assert.ok(!out.some(p => p.includes('bench-hidden') || p.includes('.git/')));
});

test('selectFiles takes bench paths only from the bench list and handles backslashes', () => {
  const out = selectFiles(['bench/old.md', 'skills\\a.md'], ['bench\\new.md']);
  assert.deepEqual(out, ['bench/new.md', 'skills/a.md']);
});
