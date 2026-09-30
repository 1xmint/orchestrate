// postcompact-check.test.mjs — the PostCompact hook that saves a helper's own
// compaction summary under its run's returns/ folder: the pure decide()
// function, the compact-row counter, and the hook process's silent contract.
//   node --test skills/orchestrate/scripts/postcompact-check.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decide, nextCompactN, INDEX_NAME } from './postcompact-check.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const HOOK = join(HERE, 'postcompact-check.mjs');

function run(input, home = mkdtempSync(join(tmpdir(), 'orch-postcompact-home-'))) {
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: { ...process.env, HOME: home, USERPROFILE: home },
  });
  return { stdout: r.stdout, status: r.status, home };
}

// ---- pure: decide -----------------------------------------------------------

test('decide is null for a lead-side PostCompact (no agent_id): not this hook\'s job', () => {
  assert.equal(decide({ compact_summary: 'x' }, { dir: '/some/run' }), null);
});

test('decide is null for an unbound helper session with no resolved run', () => {
  assert.equal(decide({ agent_id: 'helper-1', compact_summary: 'x' }, null), null);
});

test('decide names the file and index it writes for a bound helper', () => {
  const d = decide({ agent_id: 'helper-1', compact_summary: 'the summary text' }, { dir: '/repo/.orchestrator/runs/r1' });
  assert.equal(d.agentId, 'helper-1');
  assert.equal(d.summary, 'the summary text');
  assert.match(d.file, /helper-1-compact-1\.md$/);
});

test('decide treats a non-string compact_summary as an empty summary rather than throwing', () => {
  const d = decide({ agent_id: 'helper-1', compact_summary: undefined }, { dir: '/repo/run' });
  assert.equal(d.summary, '');
});

// ---- nextCompactN -------------------------------------------------------------

test('nextCompactN starts at 1 with no index file, and counts only this agent\'s own rows', () => {
  const dir = mkdtempSync(join(tmpdir(), 'orch-postcompact-dir-'));
  assert.equal(nextCompactN(dir, 'a1'), 1);
  writeFileSync(join(dir, INDEX_NAME), [
    JSON.stringify({ kind: 'compact', agentId: 'a1' }),
    JSON.stringify({ kind: 'compact', agentId: 'a2' }),
    JSON.stringify({ kind: 'return', agentId: 'a1' }),
  ].join('\n') + '\n');
  assert.equal(nextCompactN(dir, 'a1'), 2);
  assert.equal(nextCompactN(dir, 'a2'), 2);
});

// ---- hook process: silent contract --------------------------------------------

test('a malformed JSON payload exits 0 and writes nothing', () => {
  const r = spawnSync(process.execPath, [HOOK], { input: 'not json', encoding: 'utf8', env: { ...process.env, HOME: mkdtempSync(join(tmpdir(), 'orch-postcompact-home-')) } });
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), '');
});

test('a lead-side payload with no agent_id is silent and writes nothing to disk', () => {
  const r = run({ hook_event_name: 'PostCompact', session_id: 's1', compact_summary: 'lead summary' });
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), '');
});

test('a helper payload for a session with no bound run is silent (nothing to file it under)', () => {
  const r = run({ hook_event_name: 'PostCompact', session_id: 'unbound-session', agent_id: 'helper-1', compact_summary: 'x' });
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), '');
});

// ---- lead-side snapshot: lib/compaction-snapshot.mjs -----------------------

test('a lead-side payload with a compaction boundary in its transcript writes the plugin checkpoint and exits 0', () => {
  const home = mkdtempSync(join(tmpdir(), 'orch-postcompact-home-'));
  const tdir = mkdtempSync(join(tmpdir(), 'orch-postcompact-transcript-'));
  const transcriptPath = join(tdir, 't.jsonl');
  const line = o => JSON.stringify(o) + '\n';
  writeFileSync(transcriptPath, [
    line({ type: 'user', timestamp: new Date().toISOString(), message: { role: 'user', content: 'do the widget task' } }),
    line({ type: 'assistant', message: { id: 'a1', model: 'claude-sonnet-5', usage: { input_tokens: 10 }, content: [{ type: 'text', text: 'working on it' }] } }),
    line({ type: 'system', subtype: 'compact_boundary', uuid: 'b1', timestamp: new Date().toISOString(), compactMetadata: { trigger: 'auto', preTokens: 200000, postTokens: 20000 } }),
  ].join(''));

  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ hook_event_name: 'PostCompact', session_id: 'lead-snap-1', transcript_path: transcriptPath }),
    encoding: 'utf8',
    env: { ...process.env, HOME: home, USERPROFILE: home },
  });
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), '');
  const dir = join(home, '.claude', 'orchestrate', 'context', 'lead-snap-1');
  const files = existsSync(dir) ? readdirSync(dir).filter(n => /^checkpoint-.*\.md$/.test(n)) : [];
  assert.equal(files.length, 1, `expected one checkpoint file, found: ${files.join(', ')}`);
  const body = readFileSync(join(dir, files[0]), 'utf8');
  assert.match(body, /compaction 1 \(auto\)/);
  assert.match(body, /Goal: do the widget task/);
});

test('agent_id present keeps today\'s helper-side behaviour, never touching the context store', () => {
  const home = mkdtempSync(join(tmpdir(), 'orch-postcompact-home-'));
  const r = run({ hook_event_name: 'PostCompact', session_id: 'unbound-session', agent_id: 'helper-1', compact_summary: 'x' }, home);
  assert.equal(r.status, 0);
  const dir = join(home, '.claude', 'orchestrate', 'context', 'unbound-session');
  assert.ok(!existsSync(dir), 'the helper branch never touches the context store');
});

// A helper's own compaction also reaches PostCompact with no agent_id and the
// lead's transcript (anthropics/claude-code#91910). No lead checkpoint for it;
// the same payload with only an old helper boundary still writes one.
test("a lead-side payload seconds after a helper's own boundary writes no checkpoint; an old helper boundary does", () => {
  const tdir = mkdtempSync(join(tmpdir(), 'orch-postcompact-transcript-'));
  const transcriptPath = join(tdir, 't.jsonl');
  const line = o => JSON.stringify(o) + '\n';
  writeFileSync(transcriptPath, [
    line({ type: 'user', timestamp: new Date().toISOString(), message: { role: 'user', content: 'do the widget task' } }),
    line({ type: 'system', subtype: 'compact_boundary', uuid: 'b1', timestamp: new Date().toISOString(), compactMetadata: { trigger: 'auto', preTokens: 200000, postTokens: 20000 } }),
  ].join(''));
  const sid = 'lead-snap-helper';
  const sub = join(tdir, sid, 'subagents'); mkdirSync(sub, { recursive: true });
  const helper = join(sub, 'agent-a1.jsonl');
  const checkpoints = home => {
    const dir = join(home, '.claude', 'orchestrate', 'context', sid);
    return existsSync(dir) ? readdirSync(dir).filter(n => /^checkpoint-.*\.md$/.test(n)) : [];
  };
  const payload = { hook_event_name: 'PostCompact', session_id: sid, transcript_path: transcriptPath };
  writeFileSync(helper, line({ type: 'system', subtype: 'compact_boundary', uuid: 'h1', timestamp: new Date(Date.now() - 500).toISOString() }));
  const a = run(payload);
  assert.equal(a.status, 0);
  assert.equal(checkpoints(a.home).length, 0, "a helper's compaction half a second ago: no lead checkpoint");
  writeFileSync(helper, line({ type: 'system', subtype: 'compact_boundary', uuid: 'h1', timestamp: new Date(Date.now() - 60000).toISOString() }));
  const b = run(payload);
  assert.equal(checkpoints(b.home).length, 1, 'an old helper boundary: the lead checkpoint is written as before');
});
