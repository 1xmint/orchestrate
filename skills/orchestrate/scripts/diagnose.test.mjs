// diagnose.test.mjs — the diagnostics snapshot is complete, read-only in effect,
// and safe to paste: versions, hooks, context, tree, and no home folder.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { diagnose, humanDiagnosis, redactHome, registeredHooks } from './diagnose.mjs';
import { loadPolicy } from './lib/policy.mjs';
import { thresholds } from './lib/context.mjs';

const NOW = Date.parse('2026-09-14T12:00:00Z');
const assistant = (id, tokens, min) => JSON.stringify({
  type: 'assistant', timestamp: new Date(NOW - (60 - min) * 60000).toISOString(), version: '2.1.270', entrypoint: 'claude-desktop',
  message: { id, model: 'claude-opus-5', role: 'assistant', content: [{ type: 'text', text: 'x' }], usage: { input_tokens: 2, cache_read_input_tokens: tokens - 2, cache_creation_input_tokens: 0, output_tokens: 10 } },
});

function fixture() {
  const home = mkdtempSync(join(tmpdir(), 'orch-diag-'));
  const project = join(home, '.claude', 'projects', 'p');
  mkdirSync(project, { recursive: true });
  const transcript = join(project, 'sess-d.jsonl');
  writeFileSync(transcript, [
    assistant('m1', 130000, 1),
    JSON.stringify({ type: 'system', subtype: 'compact_boundary', timestamp: new Date(NOW - 30 * 60000).toISOString(), compactMetadata: { trigger: 'manual', preTokens: 130000, postTokens: 20000 } }),
    assistant('m2', 25000, 40),
  ].join('\n') + '\n');
  mkdirSync(join(home, '.claude', 'plugins'), { recursive: true });
  writeFileSync(join(home, '.claude', 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'orchestrate@orchestrate': [{ scope: 'user', version: '0.12.1', gitCommitSha: 'd5986e385e0b' }] } }));
  writeFileSync(join(home, '.claude', 'settings.json'), JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: `node "${home}/x/router.mjs"` }] }], Stop: [{ hooks: [{ type: 'command', command: 'echo other' }] }] } }));
  return { home, transcript };
}

test('diagnosis gathers versions, hooks, context and the tree for a transcript', () => {
  const { home, transcript } = fixture();
  const d = diagnose({ transcript, env: {}, codex: false, home, now: NOW, policy: loadPolicy({}), reportsPath: join(home, 'none.jsonl') });
  assert.equal(d.v, 1);
  assert.equal(d.versions.installed[0].version, '0.12.1');
  assert.equal(d.versions.installed[0].commit, 'd5986e3');
  assert.match(d.versions.thisCopy, /^\d+\.\d+\.\d+$/);
  assert.deepEqual(d.hooks, { UserPromptSubmit: ['router.mjs'] });
  assert.equal(d.host.engine, '2.1.270');
  assert.equal(d.context.reading.tokens, 25000, 'measured after the compaction, not before');
  assert.equal(d.context.advice.action, 'none');
  assert.equal(d.tree.totals.calls, 2);
  assert.equal(d.codex, 'skipped');
  assert.deepEqual(d.errors, []);
  const text = humanDiagnosis(d);
  assert.match(text, /installed 0\.12\.1 \(user, d5986e3\)/);
  assert.match(text, /context: 25k \(measured\)/);
  assert.match(text, /UserPromptSubmit: router\.mjs/);
});

test('the home folder never appears in the diagnosis', () => {
  const { home, transcript } = fixture();
  const d = diagnose({ transcript, env: {}, codex: false, home, now: NOW, policy: loadPolicy({}), reportsPath: join(home, 'none.jsonl') });
  const json = JSON.stringify(d);
  assert.ok(!json.includes(home.replace(/\\/g, '/')) && !json.includes(JSON.stringify(home).slice(1, -1)), json);
  assert.match(d.transcript, /^~/);
  assert.equal(redactHome('C--Users-Pat-Desktop and C:\\Users\\Pat\\x', 'C:\\Users\\Pat'), '~-Desktop and ~\\x');
});

test('a large main context points to the growth report for this transcript', () => {
  const d = {
    at: 'now', versions: { installed: [] }, host: {}, policy: loadPolicy({}), hooks: {},
    transcript: '~/project/sess.jsonl', context: { reading: { tokens: thresholds(null, loadPolicy({})).checkpointAt, state: 'measured', stale: false }, advice: { action: 'checkpoint', why: 'large' } },
    codex: 'skipped', claudeQuota: { fresh: false, note: 'n' }, errors: [],
  };
  assert.match(humanDiagnosis(d), /inspect growth: node measure\.mjs --growth ~\/project\/sess\.jsonl/);
});

test('a missing transcript still reports the machine, and a settings file with no hooks is empty', () => {
  const home = mkdtempSync(join(tmpdir(), 'orch-diag-'));
  const d = diagnose({ transcript: join(home, 'nope.jsonl'), env: {}, codex: false, home, now: NOW, policy: loadPolicy({}) });
  assert.equal(d.transcript, null);
  assert.equal(d.context, null);
  assert.equal(d.tree, null);
  assert.ok(d.versions && d.policy);
  assert.deepEqual(registeredHooks(join(home, 'missing.json')), {});
  assert.match(humanDiagnosis(d), /transcript: none found/);
});

import { codeIntel } from './diagnose.mjs';
import { spawnSync } from 'node:child_process';

test('code tools: a ready language server, one whose binary is missing, a repo language nothing covers, and a graph tool', () => {
  const home = mkdtempSync(join(tmpdir(), 'orch-diag-ci-'));
  const plugins = join(home, '.claude', 'plugins');
  const put = (p, text) => { mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, text); };
  const tsPath = join(plugins, 'cache', 'm', 'ts-lsp');
  put(join(tsPath, '.lsp.json'), JSON.stringify({ typescript: { command: 'fake-tsls', extensionToLanguage: { '.mjs': 'javascript' } } }));
  put(join(plugins, 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: {
    'ts-lsp@m': [{ scope: 'user', installPath: tsPath }],
    'py-lsp@m': [{ scope: 'user', installPath: join(plugins, 'cache', 'm', 'py-lsp') }],
  } }));
  put(join(plugins, 'marketplaces', 'm', '.claude-plugin', 'marketplace.json'), JSON.stringify({ plugins: [
    { name: 'py-lsp', lspServers: { pyright: { command: 'fake-pyright', extensionToLanguage: { '.py': 'python' } } } },
    { name: 'rust-lsp', lspServers: { ra: { command: 'rust-analyzer', extensionToLanguage: { '.rs': 'rust' } } } },
  ] }));
  put(join(home, '.claude', 'settings.json'), JSON.stringify({ enabledPlugins: { 'ts-lsp@m': true, 'py-lsp@m': true } }));
  put(join(home, '.claude.json'), JSON.stringify({ mcpServers: { 'codebase-memory-mcp': { command: 'x' }, other: {} }, oauthAccount: { emailAddress: 'never@example.invalid' } }));
  const bin = join(home, 'bin');
  put(join(bin, process.platform === 'win32' ? 'fake-tsls.cmd' : 'fake-tsls'), '');
  const repo = join(home, 'repo');
  for (const f of ['a.rs', 'b.rs', 'c.rs', 'x.mjs', 'y.mjs', 'z.mjs']) put(join(repo, 'src', f), '// x\n');
  put(join(repo, 'graphify-out', 'graph.json'), '{}');
  spawnSync('git', ['init', '-q'], { cwd: repo });
  spawnSync('git', ['add', '-A'], { cwd: repo });

  const ci = codeIntel({ home, cwd: repo, env: { PATH: bin, PATHEXT: '.CMD' } });
  const by = Object.fromEntries(ci.languageServers.map(s => [s.server, s]));
  assert.equal(by.typescript.onPath, true);
  assert.equal(by.typescript.enabled, true);
  assert.equal(by.pyright.onPath, false, 'declared in the marketplace entry, binary not on PATH');
  assert.deepEqual(ci.uncovered, [{ extension: '.rs', files: 3, plugins: ['rust-lsp@m'] }]);
  assert.equal(ci.map.state, 'missing');
  assert.equal(ci.graphify, 'graph.json present');
  assert.deepEqual(ci.codeGraphMcp, ['codebase-memory-mcp']);
  assert.doesNotMatch(JSON.stringify(ci), /never@example/);
  const text = humanDiagnosis({ at: 'now', versions: { installed: [] }, host: {}, policy: loadPolicy({}), hooks: {}, codex: 'skipped', claudeQuota: { fresh: false, note: 'n' }, errors: [], codeIntel: ci });
  assert.match(text, /language servers: typescript \(ready\), pyright \(fake-pyright not on PATH\)/);
  assert.match(text, /no language server for \.rs \(3 files\); free and local: rust-lsp@m/);
  assert.match(text, /repo map: none/);
});
