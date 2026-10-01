// compaction-snapshot.test.mjs — the plugin's own checkpoint, written from
// the transcript at each compaction.
//   node --test skills/orchestrate/scripts/lib/compaction-snapshot.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeCompactionSnapshot } from './compaction-snapshot.mjs';
import { readContext } from './context-scan.mjs';
import { checkpointPath } from './context-advice.mjs';

// HOME/USERPROFILE point at a fresh temp folder for every test, and `ctx.dir`
// is always passed explicitly too — CONTEXT_DIR is read once at import time,
// before any test can move HOME, so the real store path is never touched
// either way.
function makeHome() {
  const home = mkdtempSync(join(tmpdir(), 'orch-compaction-snapshot-home-'));
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  return home;
}

const line = o => JSON.stringify(o) + '\n';
const user = text => line({ type: 'user', timestamp: new Date().toISOString(), message: { role: 'user', content: text } });
// A tool call and its result: the tool's name reaches the scan only through the
// tool_use id, which is how a test line is told from a line of source code.
const toolResult = (name, text) => {
  const id = `tu-${Math.random()}`;
  return line({ type: 'assistant', message: { id: `a-${Math.random()}`, model: 'claude-sonnet-5', usage: { input_tokens: 100 }, content: [{ type: 'tool_use', id, name, input: name === 'Read' ? { file_path: '/repo/src/x.mjs' } : { command: 'npm test' } }] } })
    + line({ type: 'user', timestamp: new Date().toISOString(), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: text }] } });
};
const userResult = text => toolResult('Bash', text);
const assistantText = text => line({ type: 'assistant', message: { id: `a-${Math.random()}`, model: 'claude-sonnet-5', usage: { input_tokens: 100 }, content: [{ type: 'text', text }] } });
const edit = path => line({ type: 'assistant', message: { id: `a-${Math.random()}`, model: 'claude-sonnet-5', usage: { input_tokens: 100 }, content: [{ type: 'tool_use', name: 'Edit', input: { file_path: path } }] } });
const boundary = (uuid, trigger = 'auto', pre = 200000, post = 20000) => line({ type: 'system', subtype: 'compact_boundary', uuid, timestamp: new Date().toISOString(), compactMetadata: { trigger, preTokens: pre, postTokens: post } });

// A transcript with two boundaries: the goal, an edit and a test result
// before the first, then more of the same before the second (compaction 2).
function twoBoundaryTranscript() {
  return [
    user('do the thing: fix the widget'),
    edit('/repo/src/widget.mjs'),
    userResult('Tests: 3 passed, 0 failed'),
    assistantText('Fixed the widget by adjusting the render loop.'),
    boundary('b1', 'auto', 200000, 20000),
    user('now fix the gadget'),
    edit('/repo/src/gadget.mjs'),
    userResult('Tests: 4 passed, 0 failed'),
    assistantText('Fixed the gadget; the loop now checks bounds first.'),
    boundary('b2', 'manual', 210000, 21000),
  ].join('');
}

function writeTranscript(home, text) {
  const dir = join(home, 'transcripts');
  mkdirSync(dir, { recursive: true });
  const p = join(dir, 't.jsonl');
  writeFileSync(p, text);
  return p;
}

test('writes the snapshot at checkpointPath, with the goal, last user line, edited paths, test line, compaction number and trigger', () => {
  const home = makeHome();
  const dir = join(home, 'store');
  const transcriptPath = writeTranscript(home, twoBoundaryTranscript());
  const session = 's1';
  const reading = readContext(transcriptPath, { session });
  const path = writeCompactionSnapshot({ session, reading, transcriptPath, ctx: { dir } });
  assert.equal(path, checkpointPath(session, reading, dir));
  assert.ok(existsSync(path));
  const body = readFileSync(path, 'utf8');
  assert.match(body, /compaction 2 \(manual\)/);
  assert.match(body, /Goal: do the thing: fix the widget/);
  assert.match(body, /Last message before compaction: now fix the gadget/);
  assert.match(body, /gadget/);
  assert.match(body, /\/repo\/src\/gadget\.mjs/);
  assert.match(body, /Tests: 4 passed, 0 failed/);
  assert.ok(Buffer.byteLength(body, 'utf8') < 1600, `body is ${Buffer.byteLength(body, 'utf8')} bytes`);
});

test('a second call does not rewrite the file', () => {
  const home = makeHome();
  const dir = join(home, 'store');
  const transcriptPath = writeTranscript(home, twoBoundaryTranscript());
  const session = 's2';
  const reading = readContext(transcriptPath, { session });
  const first = writeCompactionSnapshot({ session, reading, transcriptPath, ctx: { dir } });
  const before = readFileSync(first, 'utf8');
  // Touch the transcript so a naive rewrite would produce different content,
  // then call again: the existing file must be left exactly as it was.
  writeFileSync(transcriptPath, twoBoundaryTranscript() + user('extra turn after the write'));
  const second = writeCompactionSnapshot({ session, reading, transcriptPath, ctx: { dir } });
  assert.equal(second, first);
  assert.equal(readFileSync(first, 'utf8'), before);
});

test('a lead-written checkpoint at that path is left alone', () => {
  const home = makeHome();
  const dir = join(home, 'store');
  const transcriptPath = writeTranscript(home, twoBoundaryTranscript());
  const session = 's3';
  const reading = readContext(transcriptPath, { session });
  const path = checkpointPath(session, reading, dir);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, 'the lead\'s own checkpoint text');
  const result = writeCompactionSnapshot({ session, reading, transcriptPath, ctx: { dir } });
  assert.equal(result, path);
  assert.equal(readFileSync(path, 'utf8'), 'the lead\'s own checkpoint text');
});

test('a transcript with no boundary returns null and writes no file', () => {
  const home = makeHome();
  const dir = join(home, 'store');
  const transcriptPath = writeTranscript(home, [user('hello'), assistantText('hi')].join(''));
  const session = 's4';
  const reading = readContext(transcriptPath, { session });
  const result = writeCompactionSnapshot({ session, reading, transcriptPath, ctx: { dir } });
  assert.equal(result, null);
  assert.ok(!existsSync(checkpointPath(session, reading, dir)));
});

test('a malformed transcript returns null without throwing', () => {
  const home = makeHome();
  const dir = join(home, 'store');
  const transcriptPath = writeTranscript(home, 'not json at all\n{"broken": ');
  const session = 's5';
  const reading = readContext(transcriptPath, { session });
  assert.doesNotThrow(() => {
    const result = writeCompactionSnapshot({ session, reading, transcriptPath, ctx: { dir } });
    assert.equal(result, null);
  });
});

test('missing transcript path returns null without throwing', () => {
  const home = makeHome();
  const dir = join(home, 'store');
  const session = 's6';
  assert.doesNotThrow(() => {
    const result = writeCompactionSnapshot({ session, reading: null, transcriptPath: null, ctx: { dir } });
    assert.equal(result, null);
  });
});

test('a bound run\'s Goal line wins over the session\'s first user prompt', () => {
  const home = makeHome();
  const dir = join(home, 'store');
  const transcriptPath = writeTranscript(home, twoBoundaryTranscript());
  const session = 's7';
  const reading = readContext(transcriptPath, { session });
  const runMd = join(home, 'RUN.md');
  writeFileSync(runMd, '## Goal\nShip the widget-gadget bridge.\n\n## Pickup\n');
  const path = writeCompactionSnapshot({ session, reading, transcriptPath, ctx: { dir, runMd } });
  const body = readFileSync(path, 'utf8');
  assert.match(body, /Goal: Ship the widget-gadget bridge\./);
});

test('the goal note wins over the first user text, and a long one is clipped at a word boundary', () => {
  const home = makeHome();
  const dir = join(home, 'store');
  const proj = join(home, 'proj');
  mkdirSync(join(proj, '.orchestrator'), { recursive: true });
  writeFileSync(join(proj, '.orchestrator', 'goal.md'), `${'alpha bravo charlie '.repeat(20)}\n`);
  const transcriptPath = writeTranscript(home, twoBoundaryTranscript());
  const session = 's-note';
  const reading = readContext(transcriptPath, { session });
  const body = readFileSync(writeCompactionSnapshot({ session, reading, transcriptPath, ctx: { dir, cwd: proj } }), 'utf8');
  const goal = /Goal: (.*)/.exec(body)[1];
  assert.match(goal, /^alpha bravo charlie/);
  assert.doesNotMatch(body, /do the thing: fix the widget\n\nLast/);
  assert.match(goal, /(alpha|bravo|charlie)…$/, 'ends at a whole word');
  assert.ok(Buffer.byteLength(goal) <= 300);
});

test('when the goal and the last message are the same text it is written once', () => {
  const home = makeHome();
  const dir = join(home, 'store');
  const transcriptPath = writeTranscript(home, [user('fix the widget please'), assistantText('ok'), boundary('b1')].join(''));
  const session = 's-same';
  const reading = readContext(transcriptPath, { session });
  const body = readFileSync(writeCompactionSnapshot({ session, reading, transcriptPath, ctx: { dir } }), 'utf8');
  assert.equal((body.match(/fix the widget please/g) || []).length, 1);
  assert.match(body, /Last message before compaction: the same as the goal above/);
});

test('copies the file to <run dir>/checkpoints/<same name> when a run is bound', () => {
  const home = makeHome();
  const dir = join(home, 'store');
  const transcriptPath = writeTranscript(home, twoBoundaryTranscript());
  const session = 's8';
  const reading = readContext(transcriptPath, { session });
  const runDir = join(home, 'run');
  mkdirSync(runDir, { recursive: true });
  const path = writeCompactionSnapshot({ session, reading, transcriptPath, ctx: { dir, runDir } });
  const copy = join(runDir, 'checkpoints', path.split(/[\\/]/).pop());
  assert.ok(existsSync(copy));
  assert.equal(readFileSync(copy, 'utf8'), readFileSync(path, 'utf8'));
});

test('a file changed by a shell write is in the changed-files list, a read-only command is not', () => {
  const home = makeHome();
  const dir = join(home, 'store');
  const bash = command => line({ type: 'assistant', message: { id: `a-${Math.random()}`, model: 'claude-sonnet-5', usage: { input_tokens: 100 }, content: [{ type: 'tool_use', name: 'Bash', input: { command } }] } });
  const text = [
    user('fix it'),
    bash("sed -i 's/a/b/' /repo/src/shelled.mjs"),
    bash('grep -rn payment /repo/src/readonly.mjs'),
    boundary('b1'),
  ].join('');
  const transcriptPath = writeTranscript(home, text);
  const reading = readContext(transcriptPath, { session: 's-shell' });
  const path = writeCompactionSnapshot({ session: 's-shell', reading, transcriptPath, ctx: { dir } });
  const body = readFileSync(path, 'utf8');
  assert.match(body, /\/repo\/src\/shelled\.mjs/);
  assert.doesNotMatch(body, /readonly\.mjs/);
});

function snapshotOf(parts, session = 's-x') {
  const home = makeHome();
  const dir = join(home, 'store');
  const transcriptPath = writeTranscript(home, parts.join('') + boundary('b1'));
  const reading = readContext(transcriptPath, { session });
  return readFileSync(writeCompactionSnapshot({ session, reading, transcriptPath, ctx: { dir } }), 'utf8');
}

test('a test line is taken only from a shell result, never from a Read', () => {
  // (a) source code that says "pass" or "fail 1" is not a test result
  const read = snapshotOf([user('go'), toolResult('Read', '64 // One forward pass of the transcript\nfail 1')]);
  assert.match(read, /Last test result: none seen/);
  // (b) a Bash result is taken
  const bash = snapshotOf([user('go'), toolResult('Bash', '# pass 12\n# fail 0')]);
  assert.match(bash, /Last test result: # fail 0/);
  // (c) a PowerShell result is taken
  const ps = snapshotOf([user('go'), toolResult('PowerShell', 'Tests: 7 passed, 0 failed')]);
  assert.match(ps, /Last test result: Tests: 7 passed, 0 failed/);
  // a result whose call was never seen is not a shell result
  const orphan = snapshotOf([user('go'), line({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'nope', content: '# fail 3' }] } })]);
  assert.match(orphan, /Last test result: none seen/);
  // a later Read does not replace an earlier shell test line
  const both = snapshotOf([user('go'), toolResult('Bash', '# pass 12'), toolResult('Read', 'fail 1')]);
  assert.match(both, /Last test result: # pass 12/);
});

test('goal and last message skip host wrapper text and meta records', () => {
  const wrappers = [
    '<local-command-caveat>Caveat: The messages below were generated by the user while running local commands.</local-command-caveat>',
    '<system-reminder>As you answer, use this context.</system-reminder>',
    '<command-name>/clear</command-name>',
    '<command-message>clear</command-message>',
    '<command-args></command-args>',
    '<local-command-stdout>ok</local-command-stdout>',
    'Stop hook feedback:\n- keep going',
  ];
  for (const w of wrappers) {
    const body = snapshotOf([user(w), user('fix the widget')]);
    assert.match(body, /Goal: fix the widget/, `goal skips ${w.slice(0, 20)}`);
    const last = snapshotOf([user('fix the widget'), user(w)]);
    assert.match(last, /Last message before compaction: the same as the goal above/, `last skips ${w.slice(0, 20)}`);
  }
  // a meta record is not something the user typed
  const meta = snapshotOf([line({ type: 'user', isMeta: true, message: { role: 'user', content: 'Caveat: generated while running local commands' } }), user('fix the widget')]);
  assert.match(meta, /Goal: fix the widget/);
  // wrapper blocks in a block array
  const blocks = snapshotOf([line({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: '<system-reminder>ctx</system-reminder>' }, { type: 'text', text: 'fix the widget' }] } })]);
  assert.match(blocks, /Goal: fix the widget/);
});

test('system reminders stuck to real text are cut off it, and a real prompt after a wrapper is used', () => {
  const body = snapshotOf([
    user('<system-reminder>one</system-reminder>\n<system-reminder>two</system-reminder>\nfix the widget\n<system-reminder>three</system-reminder>'),
    user('<local-command-caveat>Caveat</local-command-caveat>'),
    user('now fix the gadget'),
    user('<system-reminder>late context</system-reminder>'),
  ]);
  assert.match(body, /Goal: fix the widget\n/);
  assert.match(body, /Last message before compaction: now fix the gadget\n/);
  assert.doesNotMatch(body, /system-reminder/);
});

// A shell call with its own command, so the test line is told by the command.
const shellRun = (command, text) => {
  const id = `tu-${Math.random()}`;
  return line({ type: 'assistant', message: { id: `a-${Math.random()}`, model: 'claude-sonnet-5', usage: { input_tokens: 100 }, content: [{ type: 'tool_use', id, name: 'Bash', input: { command } }] } })
    + line({ type: 'user', timestamp: new Date().toISOString(), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: text }] } });
};

test('a table row that says Failed, printed by a command that is not a test run, gives no test line', () => {
  const row = '| Steve DATA pack | the grading states Done / Built-unverified / Partial / Blocked / Failed |';
  const none = snapshotOf([user('go'), shellRun('cat docs/research/notes.md', row)]);
  assert.match(none, /Last test result: none seen/);
  const ran = snapshotOf([user('go'), shellRun('cat notes.md', row), shellRun('node --test skills/x.test.mjs', '# tests 9\n# pass 9\n# fail 0')]);
  assert.match(ran, /Last test result: # fail 0/);
  // the document row printed after a real test run does not replace it
  const after = snapshotOf([user('go'), shellRun('npm test', '# pass 4'), shellRun('cat notes.md', row)]);
  assert.match(after, /Last test result: # pass 4/);
});

test('which commands count as a test run is read from the command, not from the output', async () => {
  const { isTestCommand } = await import('./compaction-snapshot.mjs');
  for (const c of ['node --test skills', 'npm test', 'npm run test -- -u', 'pytest -q', 'python -m pytest', 'cargo test', 'go test ./...', 'npx vitest run', 'cd x && jest', 'node --test $(find skills -name "*.test.mjs")']) assert.ok(isTestCommand(c), c);
  for (const c of ['cat notes.md', 'grep -rn Failed docs', 'node scripts/package.mjs --both', 'git log']) assert.ok(!isTestCommand(c), c);
});

test('Files touched lists each file once and leaves out the plugin own checkpoint files', () => {
  const home = makeHome();
  const dir = join(home, 'store');
  const rec = (cwd, o) => line({ cwd, ...o });
  const editRel = path => rec('/repo', { type: 'assistant', message: { id: `a-${Math.random()}`, content: [{ type: 'tool_use', name: 'Edit', input: { file_path: path } }] } });
  const text = [
    rec('/repo', { type: 'user', message: { role: 'user', content: 'go' } }),
    editRel('docs/notes.md'),
    editRel('/repo/docs/notes.md'),
    editRel('/home/u/.claude/orchestrate/context/sess/checkpoint-abc.md'),
    editRel('/repo/.orchestrator/runs/r1/checkpoints/checkpoint-abc.md'),
    editRel('/repo/src/a.mjs'),
    boundary('b1'),
  ].join('');
  const transcriptPath = writeTranscript(home, text);
  const reading = readContext(transcriptPath, { session: 's-files' });
  const body = readFileSync(writeCompactionSnapshot({ session: 's-files', reading, transcriptPath, ctx: { dir } }), 'utf8');
  const files = /Files touched: (.*)/.exec(body)[1].split(', ');
  assert.deepEqual(files.sort(), ['/repo/docs/notes.md', '/repo/src/a.mjs']);
});
