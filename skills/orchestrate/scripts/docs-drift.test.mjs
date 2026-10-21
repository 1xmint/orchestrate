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
import { spawnSync } from 'node:child_process';
import { PRICES, cacheReadShare } from './lib/prices.mjs';

const SKILL = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = resolve(SKILL, '..', '..');
const README = readFileSync(join(ROOT, 'README.md'), 'utf8');
const HOOKS = JSON.parse(readFileSync(join(ROOT, 'hooks', 'hooks.json'), 'utf8'));
const PLUGIN = JSON.parse(readFileSync(join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8'));
const MODELS_MD = readFileSync(join(SKILL, 'references', 'models.md'), 'utf8');
const ROUTING_MD = readFileSync(join(SKILL, 'references', 'routing.md'), 'utf8');

// One name per registered hook script, across every event and matcher group.
function scriptsFromHooksJson(hooksJson) {
  const names = new Set();
  for (const groups of Object.values(hooksJson.hooks || {})) {
    for (const g of groups) {
      for (const h of g.hooks || []) {
        const m = /scripts\/([a-zA-Z0-9_-]+\.mjs)/.exec(h.command || '');
        if (m) names.add(m[1]);
      }
    }
  }
  return [...names];
}

// The short role name (no `orch-` prefix) for each agent plugin.json ships,
// derived from its file path so a renamed or added agent needs no edit here.
function agentNamesFromPlugin() {
  return (PLUGIN.agents || [])
    .map(p => p.split('/').pop().replace(/\.md$/, '').replace(/^orch-/, ''))
    .sort();
}

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

test('the keep-going limits README, lanes.md and the arming line state match persist-check.mjs', async () => {
  const { PERSIST_STEP_CAP, PERSIST_SAME_ITEM_CAP } = await import('./persist-check.mjs');
  const word = { 2: 'two', 3: 'three', 4: 'four', 5: 'five' }[PERSIST_SAME_ITEM_CAP] ?? String(PERSIST_SAME_ITEM_CAP);
  const docs = {
    'README.md': README,
    'references/lanes.md': readFileSync(join(SKILL, 'references', 'lanes.md'), 'utf8'),
    'scripts/lib/persist-words.mjs': readFileSync(join(SKILL, 'scripts', 'lib', 'persist-words.mjs'), 'utf8'),
  };
  for (const [name, text] of Object.entries(docs)) {
    const flat = text.replace(/\s+/g, ' ');
    assert.match(flat, new RegExp(`\\b${PERSIST_STEP_CAP} steps\\b`), `${name} does not state the ${PERSIST_STEP_CAP}-step limit`);
    assert.match(flat, new RegExp(`\\b${word} continues on the same open item\\b`), `${name} does not state the stop after ${word} continues on the same open item`);
  }
});

test('agent counts in README, hosts.md, claude-code.md and models.md match plugin.json', () => {
  const n = agentCount();
  const words = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
  const numberWord = Object.keys(words).find(w => words[w] === n) || String(n);

  const files = {
    'README.md': README,
    'references/hosts.md': readFileSync(join(SKILL, 'references', 'hosts.md'), 'utf8'),
    'references/claude-code.md': readFileSync(join(SKILL, 'references', 'claude-code.md'), 'utf8'),
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

test('README\'s "The agents are ..." sentence names exactly the agents plugin.json ships', () => {
  const m = /The agents are ([\s\S]*?)\./.exec(README);
  assert.ok(m, 'README no longer has a "The agents are ..." sentence to check');
  const named = m[1].replace(/\n/g, ' ').split(/,| and /).map(s => s.trim()).filter(Boolean).sort();
  assert.deepEqual(named, agentNamesFromPlugin(),
    `README names [${named}] but plugin.json's agents are [${agentNamesFromPlugin()}]`);
});

test('README\'s manual-uninstall list names every hook script hooks.json registers', () => {
  const scripts = scriptsFromHooksJson(HOOKS);
  const m = /delete the hook entries naming([\s\S]*?)\. Your own/.exec(README);
  assert.ok(m, 'README no longer has the manual-uninstall hook-entry sentence to check');
  for (const script of scripts) {
    assert.ok(m[1].includes(`\`${script}\``), `README's manual-uninstall list omits ${script}`);
  }
});

test('README\'s sample "agents N/N" lines match the real agent count', () => {
  const n = agentCount();
  const re = /agents?\s+(\d+)\/(\d+)/gi;
  let m;
  let saw = false;
  while ((m = re.exec(README))) {
    saw = true;
    assert.equal(Number(m[1]), n, `README shows "${m[0]}" but plugin.json lists ${n} agents`);
    assert.equal(Number(m[2]), n, `README shows "${m[0]}" but plugin.json lists ${n} agents`);
  }
  assert.ok(saw, 'README has no sample "agents N/N" line to check');
});

test('README does not claim a hook this plugin ships is registered twice', () => {
  assert.doesNotMatch(README, /registers?\s+(?:each of\s+)?[^.]*?twice/i,
    'SKILL.md\'s frontmatter carries no hooks key, so nothing this plugin registers runs twice');
});

test('models.md\'s Opus price matches prices.mjs, and its checked date is not older than routing.md\'s', () => {
  const priceRow = /\|\s*Opus[^|]*\|[^|]*\|\s*\$(\d+)\s*\/\s*\$(\d+)\s*\|/.exec(MODELS_MD);
  assert.ok(priceRow, 'models.md has no "| Opus ... | $in / $out |" row to check');
  assert.equal(Number(priceRow[1]), PRICES.opus.in, 'models.md\'s Opus input price does not match prices.mjs');
  assert.equal(Number(priceRow[2]), PRICES.opus.out, 'models.md\'s Opus output price does not match prices.mjs');

  const modelsChecked = /checked (\d{4}-\d{2}-\d{2})/.exec(MODELS_MD);
  const routingChecked = [...ROUTING_MD.matchAll(/checked (\d{4}-\d{2}-\d{2})/gi)].map(x => x[1]).sort().pop();
  assert.ok(modelsChecked, 'models.md has no "checked YYYY-MM-DD" date to compare');
  assert.ok(routingChecked, 'routing.md has no "checked YYYY-MM-DD" date to compare against');
  assert.ok(modelsChecked[1] >= routingChecked,
    `models.md was checked ${modelsChecked[1]}, older than routing.md's ${routingChecked}`);
});

test('every family\'s price in models.md\'s table matches prices.mjs, and so does any price README quotes', () => {
  // One row per family named in prices.mjs, so a family added there without a
  // row here — or a row here whose number drifts — fails loudly.
  const rowFor = {
    fable: /\|\s*Fable[^|]*\|[^|]*\|\s*\$(\d+)\s*\/\s*\$(\d+)\s*\|\s*\$([\d.]+)\s*\|/,
    opus: /\|\s*Opus[^|]*\|[^|]*\|\s*\$(\d+)\s*\/\s*\$(\d+)\s*\|\s*\$([\d.]+)\s*\|/,
    sonnet: /\|\s*Sonnet[^|]*\|[^|]*\|\s*\$(\d+)\s*\/\s*\$(\d+)\s*\|\s*\$([\d.]+)\s*\|/,
    haiku: /\|\s*Haiku[^|]*\|[^|]*\|\s*\$(\d+)\s*\/\s*\$(\d+)\s*\|\s*\$([\d.]+)\s*\|/,
  };
  // A model id per family that cacheReadShare actually recognises (its own
  // pattern match, e.g. "fable-5-1" or "opus"), so the expected cache-read
  // dollar figure below is computed the same way prices.mjs computes it, not
  // just hard-coded a second time.
  const modelIdFor = { fable: 'claude-fable-5-1', opus: 'claude-opus-5-5', sonnet: 'claude-sonnet-5', haiku: 'claude-haiku-4-5' };
  for (const [family, re] of Object.entries(rowFor)) {
    const row = re.exec(MODELS_MD);
    assert.ok(row, `models.md has no price row for ${family} to check`);
    assert.equal(Number(row[1]), PRICES[family].in, `models.md's ${family} input price does not match prices.mjs`);
    assert.equal(Number(row[2]), PRICES[family].out, `models.md's ${family} output price does not match prices.mjs`);
    const expectedCacheRead = PRICES[family].in * cacheReadShare(modelIdFor[family]);
    assert.equal(Number(row[3]), expectedCacheRead, `models.md's ${family} cache-read price does not match prices.mjs's cacheReadShare`);
  }

  // README states no per-family $in/$out prices today (it only quotes
  // subscription-plan dollar figures, e.g. "Max 5x, $100"); if a future edit
  // adds one, it must match prices.mjs the same way.
  const readmeRow = /\b(Fable|Opus|Sonnet|Haiku)[^\n]*?\$(\d+)\s*\/\s*\$(\d+)\s*(?:per|\/)\s*(?:1M|million)/i.exec(README);
  if (readmeRow) {
    const f = readmeRow[1].toLowerCase();
    assert.equal(Number(readmeRow[2]), PRICES[f].in, `README's ${f} input price does not match prices.mjs`);
    assert.equal(Number(readmeRow[3]), PRICES[f].out, `README's ${f} output price does not match prices.mjs`);
  }
});

// The skill body used to list every hook script and their number, so a test
// kept that list in step with hooks.json. The list cost the lead about 650
// bytes on every load and changed nothing it did: each hook states its own fact
// when it speaks. Plan 0010 step 2e dropped it; this keeps it from coming back
// as a second copy of what README.md and hooks.json already say.
test('SKILL.md names no hook script and states no hook count', () => {
  const SKILL_MD = readFileSync(join(SKILL, 'SKILL.md'), 'utf8');
  for (const script of scriptsFromHooksJson(HOOKS)) {
    assert.ok(!SKILL_MD.includes(`\`${script}\``), `SKILL.md names ${script}; the hook list lives in README.md`);
  }
  assert.doesNotMatch(SKILL_MD, /^\w+ hooks run around you/m, 'SKILL.md states a hook count');
});

test('scripts/test.mjs collects the eval and bench tests, never bench-hidden or a case fixture', async () => {
  const { collectTestFiles } = await import(new URL('../../../scripts/test.mjs', import.meta.url).href);
  const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const root = mkdtempSync(join(tmpdir(), 'orch-collect-'));
  for (const f of ['skills/a/a.test.mjs', 'evals/e.test.mjs', 'evals/no-machinery.test.mjs', 'bench/b.test.mjs', 'bench/scenarios/s.test.mjs',
    'bench-hidden/h.test.mjs', 'bench/bench-hidden/h.test.mjs', 'bench/scenarios/resume/fixture/f.test.mjs', 'evals/case/fixture/f.test.mjs', 'bench/one/x.test.mjs']) {
    mkdirSync(join(root, f, '..'), { recursive: true });
    writeFileSync(join(root, f), '');
  }
  const got = collectTestFiles(root).map(p => p.slice(root.length + 1).replace(/\\/g, '/')).sort();
  assert.deepEqual(got, ['bench/b.test.mjs', 'bench/scenarios/s.test.mjs', 'evals/e.test.mjs', 'evals/no-machinery.test.mjs', 'skills/a/a.test.mjs']);
});

test('README\'s "Test it" command runs without a shell substitution and actually works', () => {
  const m = /## Test it\n\n```(?:bash|sh)?\n([^\n]+)\n```/.exec(README);
  assert.ok(m, 'README has no "## Test it" fenced command to check');
  const cmd = m[1].trim();
  assert.doesNotMatch(cmd, /\$\(/, 'the command shells out with $(...), which PowerShell cannot run');
  assert.doesNotMatch(cmd, /\bfind\b/, 'the command calls find, which PowerShell does not have');
  assert.match(cmd, /^node\s+scripts\/test\.mjs/, 'README\'s Test it command should be `node scripts/test.mjs`');

  const result = spawnSync(process.execPath, [join(ROOT, 'scripts', 'test.mjs'), '--help'], { encoding: 'utf8' });
  assert.equal(result.status, 0, `node scripts/test.mjs --help exited ${result.status}: ${result.stderr}`);
  assert.match(result.stdout, /test files/);
});

test('README\'s "What the hooks do" table has a row for every script hooks.json registers', () => {
  const scripts = scriptsFromHooksJson(HOOKS);
  const start = README.indexOf('What the hooks do');
  assert.ok(start >= 0, 'README no longer has a "What the hooks do" section to check');
  const section = README.slice(start, README.indexOf('\n## ', start + 1));
  for (const script of scripts) {
    assert.ok(new RegExp(`^\| \`${script.replace('.', '\.')}\``, 'm').test(section),
      `README's hooks table has no row for ${script}`);
  }
});

test('no current doc claims to be current for a version: the version lives only in plugin.json', () => {
  const docs = join(ROOT, 'docs');
  const stale = [];
  for (const f of readdirSync(docs).filter(n => n.endsWith('.md'))) {
    const m = /current (?:for|as of) v?\d+\.\d+(?:\.\d+)?/i.exec(readFileSync(join(docs, f), 'utf8'));
    if (m) stale.push(`docs/${f}: "${m[0]}" (plugin.json says ${PLUGIN.version})`);
  }
  assert.deepEqual(stale, []);
});
