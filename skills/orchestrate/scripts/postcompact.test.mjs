// postcompact.test.mjs — postcompact-check.mjs (the PostCompact save) and
// its lead-facing fact in ledger.mjs. Every hook test runs the real script as
// a child process with a fake HOME and a fixture repo, same shape as
// hooks.test.mjs, so nothing here touches the machine's own ~/.claude.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decide, nextCompactN } from './postcompact-check.mjs';
import { compactFact } from './ledger.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const script = n => join(HERE, n);

function sandbox() {
  const home = mkdtempSync(join(tmpdir(), 'orch-home-'));
  mkdirSync(join(home, '.claude', 'orchestrate'), { recursive: true });
  return home;
}

// A repo with an open run, same shape as hooks.test.mjs's fixtureRepo.
function fixtureRepo(opts = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'orch-repo-'));
  mkdirSync(join(dir, '.git'), { recursive: true });
  const runDir = join(dir, '.orchestrator', 'runs', opts.runId || '20260909-fixture');
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, 'RUN.md'), `# Run ${opts.runId || '20260909-fixture'}

## Goal

Ship the flag.

## Tasks

| id | phase | role · model | task | acceptance evidence | attempts | result |
|---|---|---|---|---|---|---|
| 9-9-0001 | 🔨 running | implementer · sonnet | add the flag | the test passes | 0 | — |

## Pickup

Pickup prompt: <one sentence that continues from here>
Pickup confidence: high
Resume risk: none
`);
  return { dir, runDir, runId: opts.runId || '20260909-fixture', runMd: join(runDir, 'RUN.md') };
}

// Bind a session to a run the way run-init --session-id does.
function bind(home, sessionId, repo) {
  const dir = join(home, '.claude', 'orchestrate', 'sessions');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${sessionId}.json`), JSON.stringify({
    v: 1, session_id: sessionId,
    run: { root: repo.dir, runId: repo.runId, runMd: repo.runMd, boundAt: new Date().toISOString() },
  }));
}

function run(name, payload, home) {
  const r = spawnSync(process.execPath, [script(name)], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, HOME: home, USERPROFILE: home, ANTHROPIC_API_KEY: '' },
  });
  return { status: r.status, stdout: r.stdout };
}

// ------------------------------------------------------------- pure decide --

test('decide: no agent_id means lead-side PostCompact, nothing to do', () => {
  const run = { dir: '/x/run' };
  assert.equal(decide({ session_id: 's', compact_summary: 'x' }, run), null);
});

test('decide: agent_id but no bound run means nothing to do', () => {
  assert.equal(decide({ session_id: 's', agent_id: 'a1', compact_summary: 'x' }, null), null);
});

test('decide: agent_id in a bound run names the first compact file', () => {
  const d = decide({ session_id: 's', agent_id: 'a1', compact_summary: 'kept this' }, { dir: '/x/run' });
  assert.ok(d);
  assert.equal(d.agentId, 'a1');
  assert.equal(d.summary, 'kept this');
  assert.match(d.file, /a1-compact-1\.md$/);
});

test('nextCompactN counts existing rows for that agent, ignoring others', () => {
  const dir = mkdtempSync(join(tmpdir(), 'orch-returns-'));
  writeFileSync(join(dir, 'returns.jsonl'), [
    JSON.stringify({ kind: 'compact', agentId: 'a1', file: 'a1-compact-1.md' }),
    JSON.stringify({ kind: 'compact', agentId: 'a2', file: 'a2-compact-1.md' }),
    JSON.stringify({ task: '9-9-0001', agent: 'orch-implementer' }), // an ordinary return row
  ].join('\n') + '\n');
  assert.equal(nextCompactN(dir, 'a1'), 2);
  assert.equal(nextCompactN(dir, 'a2'), 2);
  assert.equal(nextCompactN(dir, 'a3'), 1, 'an agent with no rows starts at 1');
});

// ------------------------------------------------------------------ script --

test('postcompact-check.mjs: helper input in a bound session writes the first compact file and one index row', () => {
  const home = sandbox();
  const repo = fixtureRepo();
  bind(home, 's1', repo);

  const out = run('postcompact-check.mjs', {
    hook_event_name: 'PostCompact', session_id: 's1', cwd: repo.dir,
    agent_id: 'agent_abc', trigger: 'auto', compact_summary: 'the summary the helper kept',
  }, home);

  assert.equal(out.status, 0);
  const returns = join(repo.runDir, 'returns');
  const files = readdirSync(returns).filter(f => f.endsWith('.md'));
  assert.deepEqual(files, ['agent_abc-compact-1.md']);
  assert.equal(readFileSync(join(returns, files[0]), 'utf8').trim(), 'the summary the helper kept');

  const rows = readFileSync(join(returns, 'returns.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].kind, 'compact');
  assert.equal(rows[0].agentId, 'agent_abc');
  assert.equal(rows[0].file, join(returns, 'agent_abc-compact-1.md'));
});

test('postcompact-check.mjs: a second compaction for the same helper counts up', () => {
  const home = sandbox();
  const repo = fixtureRepo();
  bind(home, 's2', repo);
  const payload = { hook_event_name: 'PostCompact', session_id: 's2', cwd: repo.dir, agent_id: 'agent_xyz', trigger: 'auto' };

  run('postcompact-check.mjs', { ...payload, compact_summary: 'first' }, home);
  run('postcompact-check.mjs', { ...payload, compact_summary: 'second' }, home);

  const returns = join(repo.runDir, 'returns');
  const files = readdirSync(returns).filter(f => f.endsWith('.md')).sort();
  assert.deepEqual(files, ['agent_xyz-compact-1.md', 'agent_xyz-compact-2.md']);
  assert.equal(readFileSync(join(returns, 'agent_xyz-compact-2.md'), 'utf8').trim(), 'second');
  const rows = readFileSync(join(returns, 'returns.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(rows.length, 2);
});

test('postcompact-check.mjs: no agent_id (lead-side compaction) writes nothing', () => {
  const home = sandbox();
  const repo = fixtureRepo();
  bind(home, 's3', repo);

  const out = run('postcompact-check.mjs', {
    hook_event_name: 'PostCompact', session_id: 's3', cwd: repo.dir, trigger: 'auto', compact_summary: 'lead summary',
  }, home);

  assert.equal(out.status, 0);
  assert.equal(existsSync(join(repo.runDir, 'returns')), false);
});

test('postcompact-check.mjs: an unbound session writes nothing', () => {
  const home = sandbox();
  const repo = fixtureRepo();
  // Deliberately not bound.

  const out = run('postcompact-check.mjs', {
    hook_event_name: 'PostCompact', session_id: 'unbound', cwd: repo.dir,
    agent_id: 'agent_lost', trigger: 'auto', compact_summary: 'nowhere to put this',
  }, home);

  assert.equal(out.status, 0);
  assert.equal(existsSync(join(repo.runDir, 'returns')), false);
});

test('postcompact-check.mjs: malformed input exits 0 and writes nothing', () => {
  const home = sandbox();
  const r = spawnSync(process.execPath, [script('postcompact-check.mjs')], {
    input: '{not json',
    encoding: 'utf8',
    env: { ...process.env, HOME: home, USERPROFILE: home, ANTHROPIC_API_KEY: '' },
  });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});

// -------------------------------------------------------- ledger's fact --

test('compactFact: an agent with one compaction row carries the fact with the path', () => {
  const dir = mkdtempSync(join(tmpdir(), 'orch-returns-'));
  const file = join(dir, 'a1-compact-1.md');
  writeFileSync(join(dir, 'returns.jsonl'), JSON.stringify({ kind: 'compact', agentId: 'a1', file }) + '\n');
  assert.equal(compactFact(dir, 'a1'), `compacted 1× mid-task; kept: ${file}`);
});

test('compactFact: an agent with none does not get the fact', () => {
  const dir = mkdtempSync(join(tmpdir(), 'orch-returns-'));
  writeFileSync(join(dir, 'returns.jsonl'), JSON.stringify({ kind: 'compact', agentId: 'other', file: 'x' }) + '\n');
  assert.equal(compactFact(dir, 'a1'), null);
  assert.equal(compactFact(dir, null), null);
});

test('compactFact: two compactions report the count and only the last path', () => {
  const dir = mkdtempSync(join(tmpdir(), 'orch-returns-'));
  writeFileSync(join(dir, 'returns.jsonl'), [
    JSON.stringify({ kind: 'compact', agentId: 'a1', file: 'a1-compact-1.md' }),
    JSON.stringify({ kind: 'compact', agentId: 'a1', file: 'a1-compact-2.md' }),
  ].join('\n') + '\n');
  assert.equal(compactFact(dir, 'a1'), 'compacted 2× mid-task; kept: a1-compact-2.md');
});

test('ledger.mjs: a return from a helper that compacted once carries the fact in its saved header', () => {
  const home = sandbox();
  const repo = fixtureRepo();
  bind(home, 'sc1', repo);

  run('postcompact-check.mjs', {
    hook_event_name: 'PostCompact', session_id: 'sc1', cwd: repo.dir,
    agent_id: 'agent_c1', trigger: 'auto', compact_summary: 'what it kept',
  }, home);

  const tr = join(repo.dir, 'agent.jsonl');
  writeFileSync(tr, JSON.stringify({ type: 'assistant', message: { usage: { input_tokens: 100, output_tokens: 50 } } }));

  run('ledger.mjs', {
    hook_event_name: 'SubagentStop', session_id: 'sc1', cwd: repo.dir, agent_id: 'agent_c1',
    agent_type: 'orch-implementer', agent_transcript_path: tr,
    last_assistant_message: 'TASK: 9-9-0001\nSTATUS: DONE\nEVIDENCE: pytest -> 1 passed',
  }, home);

  const returns = join(repo.runDir, 'returns');
  const file = readdirSync(returns).find(f => f.endsWith('.md') && f.startsWith('orch-implementer-'));
  const saved = readFileSync(join(returns, file), 'utf8');
  assert.match(saved, /compacted 1× mid-task; kept: .*agent_c1-compact-1\.md/);
});

test('ledger.mjs: a return from a helper that never compacted carries no such fact', () => {
  const home = sandbox();
  const repo = fixtureRepo();
  bind(home, 'sc2', repo);
  const tr = join(repo.dir, 'agent.jsonl');
  writeFileSync(tr, JSON.stringify({ type: 'assistant', message: { usage: { input_tokens: 100, output_tokens: 50 } } }));

  run('ledger.mjs', {
    hook_event_name: 'SubagentStop', session_id: 'sc2', cwd: repo.dir, agent_id: 'agent_c2',
    agent_type: 'orch-implementer', agent_transcript_path: tr,
    last_assistant_message: 'TASK: 9-9-0001\nSTATUS: DONE\nEVIDENCE: pytest -> 1 passed',
  }, home);

  const returns = join(repo.runDir, 'returns');
  const file = readdirSync(returns).find(f => f.endsWith('.md') && f.startsWith('orch-implementer-'));
  const saved = readFileSync(join(returns, file), 'utf8');
  assert.doesNotMatch(saved, /compacted/);
});
