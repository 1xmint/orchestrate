// turn-check-project.test.mjs — the project page's turn-end note: three edit
// turns without a PROJECT.md edit. The pure parts and the hook end to end.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { turnEdits, projectCount, PROJECT_TURNS } from './turn-check.mjs';

const HOOK = join(dirname(fileURLToPath(import.meta.url)), 'turn-check.mjs');

function run(input, home) {
  const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify(input), encoding: 'utf8', env: { ...process.env, HOME: home, USERPROFILE: home } });
  return r.stdout.trim();
}

const userLine = text => JSON.stringify({ type: 'user', message: { role: 'user', content: text } });
const toolLine = (name, input) => JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'tu', name, input }] } });
const resultLine = () => JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu', content: 'ok' }] } });

function projectRepo({ page = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'orch-turncheck-proj-'));
  execFileSync('git', ['init', '-q', dir]);
  writeFileSync(join(dir, '.gitignore'), 'dist/\n');
  if (page) { mkdirSync(join(dir, '.orchestrator'), { recursive: true }); writeFileSync(join(dir, '.orchestrator', 'PROJECT.md'), '## Next\n1. a → b\n'); }
  return dir;
}

// One turn as the transcript tail has it: a real prompt, then the edits.
function turnTranscript(home, edits, n) {
  const tp = join(home, `t${n}.jsonl`);
  writeFileSync(tp, [userLine('please change things'), ...edits.flatMap(e => [toolLine('Edit', { file_path: e, new_string: 'x' }), resultLine()])].join('\n') + '\n');
  return tp;
}

test('turnEdits: only edits after the last real prompt; tool results do not start a turn', () => {
  const t = [userLine('one'), toolLine('Edit', { file_path: 'a.js' }), resultLine(), userLine('two'), toolLine('Write', { file_path: 'b.js' }), resultLine()].join('\n');
  assert.deepEqual(turnEdits(t).paths, ['b.js']);
  const t2 = [userLine('one'), toolLine('Edit', { file_path: 'a.js' }), resultLine(), toolLine('Edit', { file_path: 'c.js' })].join('\n');
  assert.deepEqual(turnEdits(t2).paths, ['a.js', 'c.js']);
});

test('projectCount: counts a tracked edit; skips .orchestrator, .claude, outside and ignored paths; resets on a PROJECT.md edit', () => {
  const root = '/r';
  assert.equal(projectCount({ prev: 0, paths: ['/r/src/a.js'], root }).count, 1);
  assert.equal(projectCount({ prev: 1, paths: ['/r/.orchestrator/runs/x/RUN.md'], root }).count, 1);
  assert.equal(projectCount({ prev: 1, paths: ['/r/.claude/settings.json'], root }).count, 1);
  assert.equal(projectCount({ prev: 1, paths: ['/elsewhere/a.js'], root }).count, 1);
  assert.equal(projectCount({ prev: 1, paths: ['/r/dist/a.js'], root, ignored: () => true }).count, 1);
  assert.equal(projectCount({ prev: 2, paths: ['/r/src/a.js', '/r/.orchestrator/PROJECT.md'], root }).count, 0);
  assert.equal(projectCount({ prev: 2, paths: ['/r/.orchestrator/PROJECT.md'], root }).block, false);
  const third = projectCount({ prev: PROJECT_TURNS - 1, paths: ['src/a.js'], root });
  assert.equal(third.block, true);
  assert.equal(third.count, 0);
});

test('Stop: holds once on the third edit turn without a PROJECT.md edit, not before; a PROJECT.md edit resets', () => {
  const home = mkdtempSync(join(tmpdir(), 'orch-turncheck-home-'));
  const repo = projectRepo();
  const src = join(repo, 'src.js');
  const stop = (edits, n) => run({ hook_event_name: 'Stop', session_id: 'proj-s', cwd: repo, transcript_path: turnTranscript(home, edits, n) }, home);
  assert.equal(stop([src], 1), '');
  assert.equal(stop([src], 2), '');
  assert.match(JSON.parse(stop([src], 3)).reason, /3 turns changed project files and \.orchestrator\/PROJECT\.md did not change; update Where it stands \/ Next if they moved\./);
  assert.equal(stop([src], 4), '');
  assert.equal(stop([src, join(repo, '.orchestrator', 'PROJECT.md')], 5), '');
  assert.equal(stop([src], 6), '');
  assert.equal(stop([src], 7), '');
  assert.notEqual(stop([src], 8), '');
});

test('Stop: no note when stop_hook_active, with no PROJECT.md, or outside a git repo', () => {
  const home = mkdtempSync(join(tmpdir(), 'orch-turncheck-home-'));
  const repo = projectRepo();
  for (let i = 1; i <= 4; i++) assert.equal(run({ hook_event_name: 'Stop', session_id: 'proj-a', cwd: repo, stop_hook_active: true, transcript_path: turnTranscript(home, [join(repo, 'src.js')], i) }, home), '');
  const bare = projectRepo({ page: false });
  for (let i = 1; i <= 4; i++) assert.equal(run({ hook_event_name: 'Stop', session_id: 'proj-b', cwd: bare, transcript_path: turnTranscript(home, [join(bare, 'a.js')], i) }, home), '');
  const plain = mkdtempSync(join(tmpdir(), 'orch-turncheck-plain-'));
  for (let i = 1; i <= 4; i++) assert.equal(run({ hook_event_name: 'Stop', session_id: 'proj-c', cwd: plain, transcript_path: turnTranscript(home, [join(plain, 'a.js')], i) }, home), '');
});
