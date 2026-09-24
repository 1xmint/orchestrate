// hooks-registered-once.test.mjs — every hook script this plugin ships is
// wired up exactly once, and only in hooks.json. Before this, guard-agent.mjs
// and ledger.mjs were registered there *and* in SKILL.md's frontmatter, so
// Claude Code ran each of them twice per event; turn-check.mjs and
// precompact-check.mjs existed only in the frontmatter, invisible to anyone
// reading hooks.json to see what the plugin does. hooks.json is now the one
// place any of this is registered.
//   node --test skills/orchestrate/scripts/hooks-registered-once.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const HOOKS_JSON = join(ROOT, 'hooks', 'hooks.json');
const SKILL_MD = join(ROOT, 'skills', 'orchestrate', 'SKILL.md');

function scriptName(command) {
  const m = /scripts\/([a-zA-Z0-9_-]+\.mjs)/.exec(String(command || ''));
  return m ? m[1] : null;
}

// Every (event, script) registration hooks.json makes, in order.
function registrationsFromHooksJson(json) {
  const out = [];
  const hooks = (json && json.hooks) || {};
  for (const [event, entries] of Object.entries(hooks)) {
    for (const entry of entries) {
      for (const h of entry.hooks || []) {
        const name = scriptName(h.command);
        if (name) out.push({ event, script: name });
      }
    }
  }
  return out;
}

// SKILL.md's own frontmatter, parsed just enough to find a `hooks:` block —
// no YAML dependency needed for a check this narrow.
function frontmatter(md) {
  const m = /^---\n([\s\S]*?)\n---/.exec(md);
  return m ? m[1] : '';
}

test('SKILL.md frontmatter registers no hooks at all', () => {
  const fm = frontmatter(readFileSync(SKILL_MD, 'utf8'));
  assert.doesNotMatch(fm, /^hooks:/m, 'hooks.json is the only place a hook is registered now');
});

test('SKILL.md frontmatter metadata.version matches plugin.json', () => {
  const fm = frontmatter(readFileSync(SKILL_MD, 'utf8'));
  const skillVersion = (/version:\s*"([^"]+)"/.exec(fm) || [])[1];
  const plugin = JSON.parse(readFileSync(join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8'));
  assert.equal(skillVersion, plugin.version);
});

test('every hook script is registered exactly once overall, except router.mjs which fires on two distinct events by design', () => {
  const json = JSON.parse(readFileSync(HOOKS_JSON, 'utf8'));
  const regs = registrationsFromHooksJson(json);

  const counts = new Map();
  for (const r of regs) counts.set(r.script, (counts.get(r.script) || 0) + 1);

  assert.equal(counts.get('router.mjs'), 2, 'router.mjs runs on UserPromptSubmit and SessionStart, both by design');

  for (const [script, count] of counts) {
    if (script === 'router.mjs') continue;
    assert.equal(count, 1, `${script} is registered ${count} times; a script other than router.mjs must be registered exactly once`);
  }
});

test('no event lists the same script twice within itself', () => {
  const json = JSON.parse(readFileSync(HOOKS_JSON, 'utf8'));
  const regs = registrationsFromHooksJson(json);
  const seen = new Set();
  for (const { event, script } of regs) {
    const key = `${event}:${script}`;
    assert.ok(!seen.has(key), `${script} is listed twice under ${event}`);
    seen.add(key);
  }
});

test('the Stop and PreCompact hooks that used to live only in SKILL.md frontmatter are registered in hooks.json', () => {
  const json = JSON.parse(readFileSync(HOOKS_JSON, 'utf8'));
  const regs = registrationsFromHooksJson(json);
  assert.ok(regs.some(r => r.event === 'Stop' && r.script === 'turn-check.mjs'), 'turn-check.mjs must run on Stop');
  assert.ok(regs.some(r => r.event === 'PreCompact' && r.script === 'precompact-check.mjs'), 'precompact-check.mjs must run on PreCompact');
});

test('guard-bash.mjs is registered on PreToolUse for Bash', () => {
  const json = JSON.parse(readFileSync(HOOKS_JSON, 'utf8'));
  const pre = json.hooks.PreToolUse || [];
  const entry = pre.find(e => (e.hooks || []).some(h => scriptName(h.command) === 'guard-bash.mjs'));
  assert.ok(entry, 'guard-bash.mjs must be registered on PreToolUse');
  assert.equal(entry.matcher, 'Bash');
});

test('every known hook script this plugin ships is registered somewhere', () => {
  const json = JSON.parse(readFileSync(HOOKS_JSON, 'utf8'));
  const regs = registrationsFromHooksJson(json);
  const registered = new Set(regs.map(r => r.script));
  const expected = [
    'router.mjs', 'guard-agent.mjs', 'guard-bash.mjs', 'context-check.mjs',
    'persist-check.mjs', 'turn-check.mjs', 'ledger.mjs', 'postcompact-check.mjs',
    'precompact-check.mjs',
  ];
  for (const script of expected) {
    assert.ok(registered.has(script), `${script} is not registered anywhere in hooks.json`);
  }
});
