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

// The host calls this hook before it writes the summary's own boundary record
// (lib/helper-compaction.mjs; the PostCompact call comes before the marker is
// built). The old test wrote the boundary first, so it passed while, in the real
// order, the first summary got no checkpoint and the second got one of the
// stretch before the first (whole-file review). Here each hook runs, then its
// boundary is written.
test('a lead-side payload writes a checkpoint of the stretch just summarised, in the order the host runs it', () => {
  const home = mkdtempSync(join(tmpdir(), 'orch-postcompact-home-'));
  const tdir = mkdtempSync(join(tmpdir(), 'orch-postcompact-transcript-'));
  const transcriptPath = join(tdir, 't.jsonl');
  const line = o => JSON.stringify(o) + '\n';
  const edit = (id, path) => line({ type: 'assistant', message: { id, model: 'claude-sonnet-5', usage: { input_tokens: 10 }, content: [{ type: 'tool_use', id: `tu-${id}`, name: 'Edit', input: { file_path: path } }] } });
  const records = [
    line({ type: 'user', timestamp: new Date().toISOString(), message: { role: 'user', content: 'do the widget task' } }),
    edit('a1', '/repo/widget.js'),
    line({ type: 'assistant', message: { id: 'a2', model: 'claude-sonnet-5', usage: { input_tokens: 10 }, content: [{ type: 'text', text: 'The widget works.' }] } }),
  ];
  const sid = 'lead-snap-1';
  const dir = join(home, '.claude', 'orchestrate', 'context', sid);
  const hook = trigger => spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ hook_event_name: 'PostCompact', session_id: sid, transcript_path: transcriptPath, trigger, compact_summary: 'the summary' }),
    encoding: 'utf8',
    env: { ...process.env, HOME: home, USERPROFILE: home },
  });
  const read = name => readFileSync(join(dir, name), 'utf8');

  writeFileSync(transcriptPath, records.join(''));
  const r = hook('auto');
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), '');
  const first = existsSync(dir) ? readdirSync(dir).filter(n => /^checkpoint-.*\.md$/.test(n)) : [];
  assert.deepEqual(first, [`checkpoint-${sid}.md`], 'the first summary: the file of the stretch before any boundary');
  assert.match(read(first[0]), /compaction 1 \(auto\)/);
  assert.match(read(first[0]), /Goal: do the widget task/);
  assert.match(read(first[0]), /widget\.js/);

  // The host writes the first boundary and its summary; work goes on.
  records.push(
    line({ type: 'system', subtype: 'compact_boundary', uuid: 'b1', timestamp: new Date().toISOString(), compactMetadata: { trigger: 'auto', preTokens: 200000, postTokens: 20000 } }),
    line({ type: 'user', isCompactSummary: true, timestamp: new Date().toISOString(), message: { role: 'user', content: 'This session is being continued from a previous conversation.' } }),
    line({ type: 'user', timestamp: new Date().toISOString(), message: { role: 'user', content: 'now the gadget' } }),
    edit('a3', '/repo/gadget.js'),
    line({ type: 'assistant', message: { id: 'a4', model: 'claude-sonnet-5', usage: { input_tokens: 10 }, content: [{ type: 'text', text: 'The gadget works.' }] } }),
  );
  writeFileSync(transcriptPath, records.join(''));
  hook('manual');
  const second = read('checkpoint-b1.md');
  assert.match(second, /compaction 2 \(manual\)/, 'the second summary is compaction 2');
  assert.match(second, /Last message before compaction: now the gadget/, 'the stretch since the first boundary, not the summary text');
  assert.match(second, /gadget\.js/);
  assert.doesNotMatch(second, /widget\.js/, 'not the stretch before the first summary');
  assert.match(read(`checkpoint-${sid}.md`), /compaction 1 \(auto\)/, 'the first stretch\'s file is left as it was');
});

// The first context reading after a boundary writes that epoch's file with the
// stretch before it (lib/context-store.mjs), so the epoch's file can hold the
// stretch before; the next summary's hook replaces that copy of the plugin's
// own, and never a file the lead wrote.
test('the next summary replaces the plugin\'s own earlier copy at that path, and never the lead\'s', () => {
  const tdir = mkdtempSync(join(tmpdir(), 'orch-postcompact-transcript-'));
  const transcriptPath = join(tdir, 't.jsonl');
  const line = o => JSON.stringify(o) + '\n';
  writeFileSync(transcriptPath, [
    line({ type: 'user', timestamp: new Date().toISOString(), message: { role: 'user', content: 'do the widget task' } }),
    line({ type: 'system', subtype: 'compact_boundary', uuid: 'b1', timestamp: new Date().toISOString(), compactMetadata: { trigger: 'auto' } }),
    line({ type: 'user', timestamp: new Date().toISOString(), message: { role: 'user', content: 'now the gadget' } }),
  ].join(''));
  for (const [existing, kept] of [
    ['This is a checkpoint the plugin wrote from the transcript at compaction 1 (auto), not the lead\'s own judgment.\n\nGoal: do the widget task\n', false],
    ['My own notes before the summary: the gadget is next.\n', true],
  ]) {
    const home = mkdtempSync(join(tmpdir(), 'orch-postcompact-home-'));
    const dir = join(home, '.claude', 'orchestrate', 'context', 'lead-snap-2');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'checkpoint-b1.md'), existing);
    run({ hook_event_name: 'PostCompact', session_id: 'lead-snap-2', transcript_path: transcriptPath, trigger: 'auto' }, home);
    const now = readFileSync(join(dir, 'checkpoint-b1.md'), 'utf8');
    if (kept) assert.equal(now, existing, 'the lead\'s own file is left alone');
    else assert.match(now, /compaction 2 \(auto\)[\s\S]*Last message before compaction: now the gadget/);
  }
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
  // The lead's own boundary is not on file yet when its hook runs.
  writeFileSync(transcriptPath, [
    line({ type: 'user', timestamp: new Date().toISOString(), message: { role: 'user', content: 'do the widget task' } }),
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
