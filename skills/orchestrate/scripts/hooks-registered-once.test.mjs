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

// The named exceptions, each with the reason it is on two events by design:
//  - router.mjs reads the prompt on UserPromptSubmit and re-sends the goal and
//    the run on SessionStart (resume, compact, clear).
//  - persist-check.mjs is the keep-going loop and the commit-claim check on Stop,
//    and the pause-record writer on StopFailure, the host's moment for a turn
//    that ended in an API error (a usage limit among them). It is one script on
//    both because the record needs the same session state, project root and
//    helper-silence rule, and the host ignores a hook's output at StopFailure,
//    so the second registration can never refuse or disarm anything (docs/pause.md).
const TWICE = {
  'router.mjs': ['SessionStart', 'UserPromptSubmit'],
  'persist-check.mjs': ['Stop', 'StopFailure'],
};

test('every hook script is registered exactly once overall, except router.mjs and persist-check.mjs, each on two distinct events by design', () => {
  const json = JSON.parse(readFileSync(HOOKS_JSON, 'utf8'));
  const regs = registrationsFromHooksJson(json);

  const counts = new Map();
  for (const r of regs) counts.set(r.script, (counts.get(r.script) || 0) + 1);

  for (const [script, events] of Object.entries(TWICE)) {
    assert.equal(counts.get(script), 2, `${script} runs on ${events.join(' and ')}, both by design`);
    assert.deepEqual(regs.filter(r => r.script === script).map(r => r.event).sort(), events, `${script} is on exactly ${events.join(' and ')}`);
  }

  for (const [script, count] of counts) {
    if (TWICE[script]) continue;
    assert.equal(count, 1, `${script} is registered ${count} times; a script other than ${Object.keys(TWICE).join(' and ')} must be registered exactly once`);
  }
});

test('persist-check.mjs on StopFailure has no matcher, so every error kind the host sends reaches it', () => {
  const json = JSON.parse(readFileSync(HOOKS_JSON, 'utf8'));
  const groups = json.hooks.StopFailure || [];
  assert.equal(groups.length, 1);
  assert.equal(groups[0].matcher, undefined, 'a matcher would drop the error kinds nobody has seen yet');
  assert.deepEqual(groups[0].hooks.map(h => scriptName(h.command)), ['persist-check.mjs']);
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

test('the Stop hook that used to live only in SKILL.md frontmatter is registered in hooks.json, and nothing runs on PreCompact', () => {
  const json = JSON.parse(readFileSync(HOOKS_JSON, 'utf8'));
  const regs = registrationsFromHooksJson(json);
  assert.ok(regs.some(r => r.event === 'Stop' && r.script === 'turn-check.mjs'), 'turn-check.mjs must run on Stop');
  assert.ok(!regs.some(r => r.event === 'PreCompact'), 'a PreCompact block reaches nobody under autocompact; the context notice asks instead');
});

test('guard-bash.mjs is registered on PreToolUse for both Bash and PowerShell — a Windows host routes shell commands through the PowerShell tool instead of Bash, and the guard payload/logic covers both', () => {
  const json = JSON.parse(readFileSync(HOOKS_JSON, 'utf8'));
  const pre = json.hooks.PreToolUse || [];
  const entry = pre.find(e => (e.hooks || []).some(h => scriptName(h.command) === 'guard-bash.mjs'));
  assert.ok(entry, 'guard-bash.mjs must be registered on PreToolUse');
  assert.equal(entry.matcher, 'Bash|PowerShell');
});

test('every known hook script this plugin ships is registered somewhere', () => {
  const json = JSON.parse(readFileSync(HOOKS_JSON, 'utf8'));
  const regs = registrationsFromHooksJson(json);
  const registered = new Set(regs.map(r => r.script));
  const expected = [
    'router.mjs', 'guard-agent.mjs', 'guard-bash.mjs', 'context-check.mjs',
    'persist-check.mjs', 'turn-check.mjs', 'ledger.mjs', 'postcompact-check.mjs',
  ];
  for (const script of expected) {
    assert.ok(registered.has(script), `${script} is not registered anywhere in hooks.json`);
  }
});
