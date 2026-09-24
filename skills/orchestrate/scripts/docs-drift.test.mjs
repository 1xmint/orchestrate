// docs-drift.test.mjs — countable claims in the docs against the code that
// makes them true, so a number gets stale in the code without going stale in
// prose right next to it. Every count here is read from the source file at
// run time (hooks.json, plugin.json), never hard-coded, so this test does not
// itself need updating when a hook or an agent is added — only the docs do.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILL = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = resolve(SKILL, '..', '..');
const README = readFileSync(join(ROOT, 'README.md'), 'utf8');
const HOOKS = JSON.parse(readFileSync(join(ROOT, 'hooks', 'hooks.json'), 'utf8'));
const PLUGIN = JSON.parse(readFileSync(join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8'));

// One leaf per registered command, across every event and every matcher group.
function countHooks(hooksJson) {
  let n = 0;
  for (const groups of Object.values(hooksJson.hooks || {})) {
    for (const g of groups) n += (g.hooks || []).length;
  }
  return n;
}

const agentCount = () => (PLUGIN.agents || []).length;

test('README\'s hook count matches hooks.json, if it names one', () => {
  const m = /(\w+) global hooks?/i.exec(README);
  if (!m) return; // no numeric claim to drift
  const words = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
  const claimed = words[m[1].toLowerCase()] ?? Number(m[1]);
  assert.equal(claimed, countHooks(HOOKS),
    `README says "${m[0]}" but hooks/hooks.json registers ${countHooks(HOOKS)}`);
});

test('agent counts in README, hosts.md and models.md match plugin.json', () => {
  const n = agentCount();
  const words = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
  const numberWord = Object.keys(words).find(w => words[w] === n) || String(n);

  const files = {
    'README.md': README,
    'references/hosts.md': readFileSync(join(SKILL, 'references', 'hosts.md'), 'utf8'),
    'references/models.md': readFileSync(join(SKILL, 'references', 'models.md'), 'utf8'),
  };
  for (const [name, text] of Object.entries(files)) {
    // Any "<number-word> role agent(s)" / "<number-word> `orch-*` roles" claim
    // must name the true count. A file with no such claim is not checked.
    const re = /\b(\w+)\s+(?:role agents?|`orch-\*` roles)\b/gi;
    let m;
    let sawClaim = false;
    while ((m = re.exec(text))) {
      sawClaim = true;
      const claimed = words[m[1].toLowerCase()];
      if (claimed == null) continue; // not a spelled-out number, skip
      assert.equal(claimed, n, `${name}: "${m[0]}" but plugin.json lists ${n} agents (expected "${numberWord}")`);
    }
    void sawClaim;
  }
});

test('a SKILL.md line-count claim in README is within 5% of the real body length, or absent', () => {
  const skillText = readFileSync(join(SKILL, 'SKILL.md'), 'utf8');
  const totalLines = skillText.split('\n').length;
  const fmEnd = (() => {
    const lines = skillText.split('\n');
    if (lines[0] !== '---') return 0;
    const i = lines.slice(1).findIndex(l => l === '---');
    return i === -1 ? 0 : i + 2;
  })();
  const bodyLines = totalLines - fmEnd;

  const m = /(\d+)\s+body lines/i.exec(README);
  if (!m) return; // claim removed, nothing to check
  const claimed = Number(m[1]);
  const tolerance = bodyLines * 0.05;
  assert.ok(Math.abs(claimed - bodyLines) <= tolerance,
    `README claims ${claimed} body lines, SKILL.md has ${bodyLines} (tolerance ${tolerance.toFixed(1)})`);
});

test('no doc claims a "sixth step" check-in unless persist-check.mjs implements one', () => {
  const persistCheck = readFileSync(join(SKILL, 'scripts', 'persist-check.mjs'), 'utf8');
  const implementsSixthStep = /sixth|% *6 *===|steps? *% *6/i.test(persistCheck);
  assert.equal(implementsSixthStep, false, 'this test itself is now stale: persist-check.mjs implements a sixth-step check-in, so the docs claim may be restored');

  const refDir = join(SKILL, 'references');
  const files = readdirSync(refDir).filter(f => f.endsWith('.md'));
  for (const f of files) {
    const text = readFileSync(join(refDir, f), 'utf8');
    assert.doesNotMatch(text, /every sixth step/i, `${f} claims a sixth-step check-in that persist-check.mjs does not implement`);
  }
  assert.doesNotMatch(README, /every sixth step/i);
});
