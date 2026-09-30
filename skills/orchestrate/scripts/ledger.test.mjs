// ledger.test.mjs — deterministic caps, unpriced rows never counted as free,
// lenient STATUS parsing, and a malformed RUN.md row refused rather than
// written. Audit r1 areas 2 and 11 (docs/audits/2026-09-24-scoresheet-r1.md).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  appendCost, sumCosts, parseReturn, lintRunRow, lintLedger,
  evidenceDowngrade, NO_EVIDENCE_NOTE, reviewDowngrade, NO_REVIEW_NOTE,
  dirtyPaths, dirtyDowngrade, dirtyNote, resolveHelperWorktree, handbackText, reviewGated,
  recordBody, LONG_HANDBACK_BYTES,
} from './ledger.mjs';

test('recordBody keeps a short hand-back whole and cuts a long one to five lines and the byte count', () => {
  const short = 'OUTCOME: DONE it works.\nPROOF: tests pass.\n';
  assert.deepEqual(recordBody(short), { body: short, bytes: Buffer.byteLength(short), long: false });
  const lines = ['OUTCOME: DONE x', 'PROOF: y', 'NOT CHECKED: z', 'NEEDS A DECISION: nothing', 'FULL REPORT: p'];
  const long = lines.join('\n') + '\n' + 'STATUS: DONE\nEVIDENCE: ' + 'e'.repeat(LONG_HANDBACK_BYTES);
  const r = recordBody(long);
  assert.equal(r.long, true);
  assert.equal(r.bytes, Buffer.byteLength(long));
  assert.ok(r.body.startsWith(lines.join('\n') + '\n'));
  assert.ok(!r.body.includes('EVIDENCE'));
  assert.ok(r.body.includes(`${r.bytes} bytes against 600`));
});

function tmpFile() {
  const dir = mkdtempSync(join(tmpdir(), 'orch-ledger-'));
  return join(dir, 'costs.jsonl');
}

// A real temp git repo, one commit in, HOME pointed at a fresh temp folder so
// nothing here ever touches a real ~/.claude.
function tmpRepo() {
  const home = mkdtempSync(join(tmpdir(), 'orch-ledger-home-'));
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  const dir = mkdtempSync(join(tmpdir(), 'orch-ledger-repo-'));
  const git = (...args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  git('init', '-q');
  git('config', 'user.email', 'x@x.com');
  git('config', 'user.name', 'x');
  writeFileSync(join(dir, 'a.txt'), 'one\n');
  git('add', 'a.txt');
  git('commit', '-q', '-m', 'first');
  return dir;
}

test('the costs cap is deterministic: 600 appends never leave more than 500 rows', () => {
  const path = tmpFile();
  for (let i = 0; i < 600; i++) {
    appendCost({ at: new Date().toISOString(), role: 'implementer', model: 'sonnet', priced: true, dollars: 0.01 }, path);
    const rows = readFileSync(path, 'utf8').split('\n').filter(Boolean);
    assert.ok(rows.length <= 500, `row ${i}: ${rows.length} rows, cap is 500`);
  }
  const rows = readFileSync(path, 'utf8').split('\n').filter(Boolean);
  assert.equal(rows.length, 500);
});

test('a sum over costs skips rows with no known model and says how many', () => {
  const rows = [
    { dollars: 1.5 },
    { dollars: null },
    { dollars: 2.25 },
    { dollars: null },
    {},
  ];
  const { total, skipped } = sumCosts(rows);
  assert.equal(total, 3.75);
  assert.equal(skipped, 3);
});

test('sumCosts on an all-unpriced set totals zero and skips every row', () => {
  const { total, skipped } = sumCosts([{ dollars: null }, { dollars: null }]);
  assert.equal(total, 0);
  assert.equal(skipped, 2);
});

test('STATUS parses leniently: colon, dash, and case', () => {
  assert.equal(parseReturn('TASK: 9-1-0001\nstatus: done\n').status, 'DONE');
  assert.equal(parseReturn('TASK: 9-1-0001\nSTATUS - DONE\n').status, 'DONE');
  assert.equal(parseReturn('TASK: 9-1-0001\nSTATUS – partial\n').status, 'PARTIAL');
});

test('STATUS is read wherever it falls in the return, including line 5', () => {
  const text = 'TASK: 9-1-0001\nRUN: r1\nsome notes\nmore notes\nSTATUS: DONE\nEVIDENCE: x\n';
  assert.equal(parseReturn(text).status, 'DONE');
});

test('a well-formed RUN.md row passes the lint unchanged', () => {
  const header = '| id | phase | role · model | task | evidence | attempts | result |';
  const row = '| 9-9-0001 | 🔨 running | implementer · sonnet | do the thing | x | 0 | — |';
  const r = lintRunRow(header, row);
  assert.equal(r.ok, true);
  assert.equal(r.cells.length, 7);
});

// A small ledger in the real layout: task table, then the sections below it.
const HEAD = '| id | phase | blocks on | owns | role · model | task | acceptance evidence | attempts | result |\n|---|---|---|---|---|---|---|---|---|';
const ledger = (rows, below = '') =>
  `# Run r\n\n## Tasks\n\n${HEAD}\n${rows.join('\n')}\n\nPhases: ...\n\n## Decisions\n- a decision\n${below}\n## Pickup\n\nPickup prompt: x\n`;
const row = (id, phase, blocks = '—') => `| ${id} | ${phase} | ${blocks} | a.mjs | implementer · sonnet | t | e | 0 | — |`;

test('lintLedger: a clean ledger prints nothing', () => {
  const text = ledger([row('9-1-0001', '✅ done 2026-01-01'), row('9-1-0002', '⏳ dispatched 2026-01-02', '0001')]);
  assert.deepEqual(lintLedger(text), []);
});

test('lintLedger: a task row pasted below the table is named with its line', () => {
  const text = ledger([row('9-1-0001', '✅ done 2026-01-01')], row('9-1-0002', '✅ done 2026-01-01') + '\n');
  const p = lintLedger(text);
  assert.equal(p.length, 1);
  assert.match(p[0], /9-1-0002 sits outside the task table \(line \d+\)/);
});

test('lintLedger: a row with the wrong column count inside the table is named', () => {
  const short = '| 9-1-0003 | ✅ done | implementer · sonnet | base abc, worktree | ~$2 | wave-9.md |';
  const p = lintLedger(ledger([row('9-1-0001', '✅ done 2026-01-01'), short]));
  assert.equal(p.length, 1);
  assert.match(p[0], /9-1-0003 has 6 columns, the table header has 9/);
});

test('lintLedger: a row still dispatched days after the newest row is named', () => {
  const p = lintLedger(ledger([row('9-1-0001', '⏳ dispatched 2026-01-01'), row('9-1-0002', '✅ done 2026-01-04')]));
  assert.equal(p.length, 1);
  assert.match(p[0], /9-1-0001 still says "⏳ dispatched 2026-01-01", 3 days older/);
});

test('lintLedger: a dispatched row a later done row blocks on is named, whatever its age', () => {
  const p = lintLedger(ledger([row('9-1-0001', '⏳ dispatched'), row('9-1-0002', '✅ done', '0001')]));
  assert.equal(p.length, 1);
  assert.match(p[0], /9-1-0001 still says "⏳ dispatched" but 9-1-0002, which blocks on it, is done/);
});

test('lintLedger: a row dispatched the same day as the newest row is not stale', () => {
  assert.deepEqual(lintLedger(ledger([row('9-1-0001', '⏳ dispatched 2026-01-04'), row('9-1-0002', '✅ done 2026-01-04')])), []);
});

test('a row with a shifted or missing cell is refused, naming the task id', () => {
  const header = '| id | phase | role · model | task | evidence | attempts | result |';
  const shifted = '| 9-9-0002 | 🔨 running | implementer · sonnet | do the thing | x | 0 |';
  const r = lintRunRow(header, shifted);
  assert.equal(r.ok, false);
  assert.match(r.reason, /9-9-0002/);
  assert.match(r.reason, /6 columns.*7/);
});

test('evidenceDowngrade: DONE with an evidence line is left DONE, no note', () => {
  const text = 'TASK: 9-1-0001\nSTATUS: DONE\nEVIDENCE: node --test lib/x.test.mjs — 4 pass\n';
  const r = evidenceDowngrade('DONE', text);
  assert.equal(r.status, 'DONE');
  assert.equal(r.note, null);
});

test('evidenceDowngrade: DONE with no evidence line is downgraded to PARTIAL with the note', () => {
  const text = 'TASK: 9-1-0001\nSTATUS: DONE\nCHANGED: lib/x.mjs\n';
  const r = evidenceDowngrade('DONE', text);
  assert.equal(r.status, 'PARTIAL');
  assert.equal(r.note, NO_EVIDENCE_NOTE);
  assert.match(r.note, /no evidence line/);
});

test('evidenceDowngrade never touches a return that is already PARTIAL', () => {
  const text = 'TASK: 9-1-0001\nSTATUS: PARTIAL\nNOT VERIFIED: the gate\n';
  const r = evidenceDowngrade('PARTIAL', text);
  assert.equal(r.status, 'PARTIAL');
  assert.equal(r.note, null);
});

test('evidenceDowngrade never touches a return that is already BLOCKED', () => {
  const r = evidenceDowngrade('BLOCKED', 'TASK: 9-1-0001\nSTATUS: BLOCKED\nQUESTIONS: which file\n');
  assert.equal(r.status, 'BLOCKED');
  assert.equal(r.note, null);
});

test('evidenceDowngrade never upgrades: a null status stays null', () => {
  const r = evidenceDowngrade(null, 'no fields at all');
  assert.equal(r.status, null);
  assert.equal(r.note, null);
});

test('parseReturn reads REVIEW OF: as the reviewed task id, its first token', () => {
  const r = parseReturn('TASK: 9-1-0099\nREVIEW OF: 9-1-0034 on agent/x @ abc123, worktree /r/w\nSTATUS: DONE\nVERDICT: PASS\n');
  assert.equal(r.reviewOf, '9-1-0034');
  assert.equal(r.task, '9-1-0099');
});

test('parseReturn reads a reviewer five-line return: OUTCOME gives status and verdict, PROOF counts as evidence', () => {
  const r = parseReturn('OUTCOME: PASS the change holds.\nPROOF: ran the tests, 12 pass.\nNOT CHECKED: none.\nNEEDS A DECISION: nothing\nFULL REPORT: x');
  assert.equal(r.status, 'DONE');
  assert.equal(r.verdict, 'PASS');
  assert.equal(r.evidence, true);
  assert.equal(parseReturn('OUTCOME: FAIL broken\nPROOF: y').verdict, 'FAIL');
});

test('parseReturn: no REVIEW OF line reads as null', () => {
  assert.equal(parseReturn('TASK: 9-1-0001\nSTATUS: DONE\n').reviewOf, null);
});

test('parseReturn reads REVIEW OF from inside the five-line OUTCOME line', () => {
  const r = parseReturn('OUTCOME: PASS (REVIEW OF: tu-x) the hold now releases.\nPROOF: node --test, 66 pass\n');
  assert.equal(r.reviewOf, 'tu-x');
  assert.equal(r.verdict, 'PASS');
  assert.equal(parseReturn('OUTCOME: FAIL (REVIEW OF: release/0.17.1). At x.\n').reviewOf, 'release/0.17.1');
  assert.equal(parseReturn('OUTCOME: FAIL, REVIEW OF: 9-1-0034.\n').reviewOf, '9-1-0034');
  assert.equal(parseReturn('PROOF: the brief said REVIEW OF: 9-1-0034\n').reviewOf, null, 'only the OUTCOME line or its own line');
});

test('a return whose TASK line is prose ("TASK: build the login page") is not filed under its first word', () => {
  const r = parseReturn('TASK: build the login page\nSTATUS: DONE\nEVIDENCE: it loads\n');
  assert.equal(r.task, null);
  assert.notEqual(r.task, 'build');
});

test('reviewDowngrade: a REVIEW: yes task marked DONE with no reviewer return yet is downgraded to PARTIAL with the note', () => {
  const r = reviewDowngrade('DONE', true, '9-1-0034', []);
  assert.equal(r.status, 'PARTIAL');
  assert.equal(r.note, NO_REVIEW_NOTE);
});

test('reviewDowngrade: a REVIEW: yes task marked DONE with a matching reviewer return already in the index stays DONE', () => {
  const rows = [{ reviewOf: '9-1-0034', status: 'DONE', verdict: 'PASS' }];
  const r = reviewDowngrade('DONE', true, '9-1-0034', rows);
  assert.equal(r.status, 'DONE');
  assert.equal(r.note, null);
});

test('reviewDowngrade: a reviewer return that failed does not count as reviewed; a later pass does', () => {
  const failed = [{ reviewOf: '9-1-0034', status: 'FAIL', verdict: 'FAIL' }];
  assert.equal(reviewDowngrade('DONE', true, '9-1-0034', failed).status, 'PARTIAL');
  const both = [...failed, { reviewOf: '9-1-0034', status: 'DONE', verdict: 'PASS' }];
  assert.equal(reviewDowngrade('DONE', true, '9-1-0034', both).status, 'DONE');
});

test('reviewDowngrade: a reviewer return for a different task id does not satisfy the gate', () => {
  const rows = [{ reviewOf: '9-1-0099' }];
  const r = reviewDowngrade('DONE', true, '9-1-0034', rows);
  assert.equal(r.status, 'PARTIAL');
});

test('reviewDowngrade: no REVIEW flag leaves DONE unchanged, reviewer return or not', () => {
  assert.equal(reviewDowngrade('DONE', false, '9-1-0034', []).status, 'DONE');
  assert.equal(reviewDowngrade('DONE', false, '9-1-0034', []).note, null);
});

test('reviewDowngrade never touches PARTIAL or BLOCKED, and never upgrades', () => {
  assert.equal(reviewDowngrade('PARTIAL', true, '9-1-0034', []).status, 'PARTIAL');
  assert.equal(reviewDowngrade('PARTIAL', true, '9-1-0034', []).note, null);
  assert.equal(reviewDowngrade('BLOCKED', true, '9-1-0034', []).status, 'BLOCKED');
  assert.equal(reviewDowngrade(null, true, '9-1-0034', []).status, null);
});

test('reviewDowngrade: a review inferred from the objective\'s own words names the word in the note', () => {
  const r = reviewDowngrade('DONE', true, '9-1-0034', [], 'payment');
  assert.equal(r.status, 'PARTIAL');
  assert.equal(r.note, "done, but its objective mentions payment, so it waits for an independent review that has not returned yet.");
});

test('reviewDowngrade: no reviewInferred word falls back to the plain NO_REVIEW_NOTE', () => {
  const r = reviewDowngrade('DONE', true, '9-1-0034', []);
  assert.equal(r.note, NO_REVIEW_NOTE);
});

test('dirtyDowngrade: DONE with a dirty worktree is downgraded to PARTIAL, note names the paths', () => {
  const dir = tmpRepo();
  writeFileSync(join(dir, 'untracked.txt'), 'x\n');
  const paths = dirtyPaths(dir);
  assert.deepEqual(paths, ['untracked.txt']);
  const r = dirtyDowngrade('DONE', paths);
  assert.equal(r.status, 'PARTIAL');
  assert.equal(r.note, 'returned done with uncommitted changes in its worktree: untracked.txt; commit or copy them before the worktree is removed');
});

test('dirtyDowngrade: DONE with a clean worktree stays DONE, no note', () => {
  const dir = tmpRepo();
  const paths = dirtyPaths(dir);
  assert.deepEqual(paths, []);
  const r = dirtyDowngrade('DONE', paths);
  assert.equal(r.status, 'DONE');
  assert.equal(r.note, null);
});

test('dirtyDowngrade: DONE with no worktree resolved (no such dir, no run) is unchanged', () => {
  const r = resolveHelperWorktree({ cwd: mkdtempSync(join(tmpdir(), 'orch-ledger-nowt-')), agent_id: 'nope-does-not-exist' }, { task: '9-1-0001' }, null);
  assert.equal(r, null);
  const d = dirtyDowngrade('DONE', r ? dirtyPaths(r) : []);
  assert.equal(d.status, 'DONE');
  assert.equal(d.note, null);
});

test('dirtyDowngrade: a PARTIAL return with a dirty worktree stays PARTIAL, note untouched', () => {
  const dir = tmpRepo();
  writeFileSync(join(dir, 'untracked.txt'), 'x\n');
  const r = dirtyDowngrade('PARTIAL', dirtyPaths(dir));
  assert.equal(r.status, 'PARTIAL');
  assert.equal(r.note, null);
});

test('dirtyDowngrade never touches BLOCKED or a null status', () => {
  assert.equal(dirtyDowngrade('BLOCKED', ['x.txt']).status, 'BLOCKED');
  assert.equal(dirtyDowngrade('BLOCKED', ['x.txt']).note, null);
  assert.equal(dirtyDowngrade(null, ['x.txt']).status, null);
});

test('dirtyPaths: a directory that is not a git repo answers no paths, never throws', () => {
  const dir = mkdtempSync(join(tmpdir(), 'orch-ledger-notrepo-'));
  assert.deepEqual(dirtyPaths(dir), []);
});

test('dirtyPaths: git missing from PATH answers no paths, never throws', () => {
  const dir = tmpRepo();
  writeFileSync(join(dir, 'untracked.txt'), 'x\n');
  const realPath = process.env.PATH;
  process.env.PATH = '';
  try {
    assert.deepEqual(dirtyPaths(dir), []);
  } finally {
    process.env.PATH = realPath;
  }
});

test('dirtyPaths: .orchestrator/ and the progress file are never counted as dirty', () => {
  const dir = tmpRepo();
  mkdirSync(join(dir, '.orchestrator'), { recursive: true });
  writeFileSync(join(dir, '.orchestrator', 'run.md'), 'x\n');
  writeFileSync(join(dir, 'progress.md'), 'x\n');
  writeFileSync(join(dir, 'real.txt'), 'x\n');
  const paths = dirtyPaths(dir, join(dir, 'progress.md'));
  assert.deepEqual(paths, ['real.txt']);
});

test('dirtyNote: more than 8 paths is shown as up to 8, plus a count of the rest', () => {
  const paths = Array.from({ length: 11 }, (_, i) => `f${i}.txt`);
  const note = dirtyNote(paths);
  assert.match(note, /^returned done with uncommitted changes in its worktree: f0\.txt, f1\.txt, f2\.txt, f3\.txt, f4\.txt, f5\.txt, f6\.txt, f7\.txt, \+3 more; commit or copy them before the worktree is removed$/);
});

test('resolveHelperWorktree: the harness-named worktree dir is used when it exists', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'orch-ledger-cwd-'));
  const agentId = 'abc123';
  const wt = join(cwd, '.claude', 'worktrees', `agent-${agentId}`);
  mkdirSync(wt, { recursive: true });
  const r = resolveHelperWorktree({ cwd, agent_id: agentId }, { task: '9-1-0001' }, null);
  assert.equal(r, wt);
});

// ---- the helper's real report: the hand-back call, not the stub -------------
// Fixtures are built by hand here from made-up text, in the shape a helper's
// own transcript records a hand-back: an assistant line whose content holds a
// tool_use block named SubagentHandback with the report in input.message.

const STUB = 'Report delivered to caller.'; // 27 bytes

function handbackLine(text, name = 'SubagentHandback', field = 'message') {
  return JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_x', name, input: { [field]: text } }] } });
}
function plainLine(text) {
  return JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } });
}
function bigReport(task, status) {
  const head = `TASK: ${task}\nSTATUS: ${status}\nEVIDENCE:\n$ node --test\n# pass 12\n# fail 0\n`;
  return head + 'Detail line for the report, made up for this test.\n'.repeat(60);
}
function writeTranscript(lines) {
  const dir = mkdtempSync(join(tmpdir(), 'orch-ledger-tr-'));
  const p = join(dir, 'agent.jsonl');
  writeFileSync(p, lines.join('\n') + '\n');
  return p;
}
// Runs the hook for real with a temp HOME, returns the filed text and index row.
function runHook(input) {
  const home = mkdtempSync(join(tmpdir(), 'orch-ledger-hook-'));
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  const res = spawnSync(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), 'ledger.mjs')], { input: JSON.stringify(input), encoding: 'utf8', env });
  const rdir = join(home, '.claude', 'orchestrate', 'returns', String(input.session_id));
  let rows = [];
  try { rows = readFileSync(join(rdir, 'returns.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)); } catch {}
  const row = rows[rows.length - 1] || null;
  const filed = row ? readFileSync(row.file, 'utf8') : null;
  return { res, row, filed };
}
function hookInput(extra) {
  return { session_id: 'sess-hb-' + Math.random().toString(16).slice(2), agent_type: 'orchestrate:orch-implementer', agent_id: 'a' + Math.random().toString(16).slice(2, 10), cwd: tmpdir(), ...extra };
}

test('the filed return is the hand-back report, not the 27-byte stub, and the row has a task and a status', () => {
  const report = bigReport('9-1-0001', 'PARTIAL');
  assert.ok(Buffer.byteLength(report) > 3000);
  const tp = writeTranscript([plainLine('working'), handbackLine(report), plainLine(STUB)]);
  const { row, filed, res } = runHook(hookInput({ agent_transcript_path: tp, last_assistant_message: STUB }));
  assert.equal(res.status, 0);
  assert.ok(filed.includes('TASK: 9-1-0001') && !filed.includes(report), 'a long hand-back is filed as five lines');
  assert.ok(filed.includes(`${Buffer.byteLength(report)} bytes against 600`), 'with its size');
  assert.equal(row.task, '9-1-0001');
  assert.equal(row.status, 'PARTIAL');
  assert.equal(row.evidence, true);
});

test('a long hand-back keeps its whole text in a .full.md beside the five-line record', () => {
  // A reviewer has no tool that writes files, so its findings live only in
  // the hand-back; cutting them to five lines lost them.
  const report = bigReport('9-1-0009', 'PARTIAL');
  const tp = writeTranscript([handbackLine(report), plainLine(STUB)]);
  const { row, filed } = runHook(hookInput({ agent_type: 'orchestrate:orch-reviewer', agent_transcript_path: tp, last_assistant_message: STUB }));
  const full = row.file.replace(/\.md$/, '.full.md');
  assert.ok(existsSync(full), 'the whole hand-back is kept');
  assert.equal(readFileSync(full, 'utf8'), report);
  assert.ok(filed.includes(full), 'and the short record names where');
  const short = 'TASK: 9-1-0010\nSTATUS: PARTIAL\nEVIDENCE: ran it, 3 pass\n';
  const s = runHook(hookInput({ last_assistant_message: short }));
  assert.ok(!existsSync(s.row.file.replace(/\.md$/, '.full.md')), 'a short one needs no second file');
});

test('no hand-back in the transcript: the filed text is the last plain message', () => {
  const msg = 'TASK: 9-1-0002\nSTATUS: PARTIAL\nEVIDENCE: ran it, 3 pass\n';
  const tp = writeTranscript([plainLine('hello'), plainLine(msg)]);
  const { row, filed } = runHook(hookInput({ agent_transcript_path: tp, last_assistant_message: msg }));
  assert.ok(filed.endsWith(msg));
  assert.equal(row.task, '9-1-0002');
});

test('DONE in the hand-back with a dirty helper worktree is downgraded to PARTIAL', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'orch-ledger-lead-'));
  const agentId = 'dirty' + Math.random().toString(16).slice(2, 8);
  const wt = join(cwd, '.claude', 'worktrees', `agent-${agentId}`);
  mkdirSync(wt, { recursive: true });
  const git = (...a) => spawnSync('git', a, { cwd: wt, encoding: 'utf8' });
  git('init', '-q'); git('config', 'user.email', 'x@x.com'); git('config', 'user.name', 'x');
  writeFileSync(join(wt, 'a.txt'), 'one\n'); git('add', 'a.txt'); git('commit', '-q', '-m', 'first');
  writeFileSync(join(wt, 'left-behind.txt'), 'x\n');
  const tp = writeTranscript([handbackLine(bigReport('9-1-0003', 'DONE')), plainLine(STUB)]);
  const { row } = runHook(hookInput({ cwd, agent_id: agentId, agent_transcript_path: tp, last_assistant_message: STUB }));
  assert.equal(row.status, 'PARTIAL');
  assert.equal(row.dirtyWorktree, true);
});

test('a missing or unreadable transcript path falls back to the last plain message, never throws', () => {
  const msg = 'TASK: 9-1-0004\nSTATUS: BLOCKED\nEVIDENCE: none\n';
  const a = runHook(hookInput({ agent_transcript_path: join(tmpdir(), 'no-such-dir', 'x.jsonl'), last_assistant_message: msg }));
  assert.equal(a.res.status, 0);
  assert.ok(a.filed.endsWith(msg));
  const dir = mkdtempSync(join(tmpdir(), 'orch-ledger-dirpath-'));
  const b = runHook(hookInput({ agent_transcript_path: dir, last_assistant_message: msg }));
  assert.ok(b.filed.endsWith(msg));
  const c = runHook(hookInput({ last_assistant_message: msg }));
  assert.ok(c.filed.endsWith(msg));
  assert.equal(handbackText(undefined), '');
  assert.equal(handbackText(dir), '');
});

test('two hand-backs: the last one wins; a bad JSON line and a renamed tool and field are tolerated', () => {
  const first = bigReport('9-1-0005', 'PARTIAL');
  const last = bigReport('9-1-0006', 'BLOCKED');
  const tp = writeTranscript([handbackLine(first), 'not json {handback', handbackLine(last, 'mcp__x__subagent_handback', 'report_text')]);
  assert.equal(handbackText(tp), last);
  const tp2 = writeTranscript([handbackLine(first), handbackLine(last)]);
  assert.equal(handbackText(tp2), last);
});

function userLine(text) {
  return JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } });
}
function toolResultLine() {
  return JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_x', content: 'handback received' }] } });
}

test('a hand-back from before the helper was resumed is not filed again: the plain message after the resume is', () => {
  const old = bigReport('9-1-0010', 'DONE');
  const msg = 'TASK: 9-1-0010\nSTATUS: PARTIAL\nEVIDENCE: ran it again, 2 fail\n';
  const tp = writeTranscript([handbackLine(old), toolResultLine(), plainLine(STUB), userLine('one more thing, please'), plainLine(msg)]);
  assert.equal(handbackText(tp), '');
  const { row, filed } = runHook(hookInput({ agent_transcript_path: tp, last_assistant_message: msg }));
  assert.ok(filed.endsWith(msg));
  assert.ok(!filed.includes('Detail line for the report'));
  assert.equal(row.status, 'PARTIAL');
  // A tool result is a user line without text: it does not end the segment.
  const tp2 = writeTranscript([userLine('start'), handbackLine(old), toolResultLine(), plainLine(STUB)]);
  assert.equal(handbackText(tp2), old);
});

test('a reviewer return is never held for review, whatever its dispatch was flagged', () => {
  assert.equal(reviewGated({ review: true }, { reviewOf: '9-1-0034' }), false);
  assert.equal(reviewGated({ review: true }, { reviewOf: null }), true);
  assert.equal(reviewGated({ review: false }, { reviewOf: null }), false);
  assert.equal(reviewGated(null, { reviewOf: null }), false);
  const r = reviewDowngrade('DONE', reviewGated({ review: true }, { reviewOf: '9-1-0034' }), '9-1-0097', []);
  assert.equal(r.status, 'DONE');
});

test('a 5 MB transcript is read from the tail in under 200 ms and still finds the hand-back', () => {
  const filler = plainLine('x'.repeat(4000));
  const lines = [handbackLine('TASK: 9-1-0007\nold report that sits beyond the tail window, made up')];
  for (let i = 0; i < 1300; i++) lines.push(filler);
  const last = bigReport('9-1-0008', 'PARTIAL');
  lines.push(handbackLine(last), plainLine(STUB));
  const tp = writeTranscript(lines);
  const t0 = Date.now();
  const got = handbackText(tp);
  const ms = Date.now() - t0;
  assert.equal(got, last);
  assert.ok(ms < 200, `took ${ms} ms`);
});

// The record read a hand-back's status with a reader of its own that knew only
// STATUS lines and PASS/FAIL, so "OUTCOME: DONE" was stored with no status and
// a FAIL followed by a trailing "STATUS: DONE" was stored as DONE.
test('parseReturn reads the word that opens OUTCOME as the status (a five-line hand-back)', () => {
  assert.equal(parseReturn('OUTCOME: DONE - Created lib/search.js exporting search.\nPROOF: git commit abc123.\n').status, 'DONE');
  assert.equal(parseReturn('OUTCOME: DONE. Created lib/list.js only.\nPROOF: node -e ok.\n').status, 'DONE');
  assert.equal(parseReturn('OUTCOME: DONE \u2014 created lib/add.js.\nPROOF: `node -e` ok.\n').status, 'DONE');
  assert.equal(parseReturn('OUTCOME: partial - step 1 only.\nPROOF: none yet.\n').status, 'PARTIAL');
  assert.equal(parseReturn('OUTCOME: BLOCKED - needs a key.\nPROOF: none.\n').status, 'BLOCKED');
  // Indented under a wrapper the host adds.
  assert.equal(parseReturn('[Subagent hand-back] text follows\n  OUTCOME: DONE - built it.\n  PROOF: node --test x.test.mjs 4 pass\n').status, 'DONE');
});

test('parseReturn: a reviewer FAIL is stored as FAIL and wins over a later STATUS line; PASS stays DONE', () => {
  const fail = parseReturn('OUTCOME: FAIL. Auth works, but server.js:76 ships a hardcoded password.\nPROOF: node --test x.test.mjs 8 pass\nSTATUS: DONE\nEVIDENCE: read server.js:76\n');
  assert.equal(fail.status, 'FAIL');
  assert.equal(fail.verdict, 'FAIL');
  const pass = parseReturn('OUTCOME: PASS. The fallback is gone.\nPROOF: node --test x.test.mjs 8 pass\nSTATUS: DONE\n');
  assert.equal(pass.status, 'DONE');
  assert.equal(pass.verdict, 'PASS');
  // The old form with no OUTCOME still reads its STATUS line.
  assert.equal(parseReturn('TASK: 9-1-0001\nSTATUS: PARTIAL\n').status, 'PARTIAL');
});

test('the record files a five-line DONE with its status, and a reviewer FAIL as FAIL', () => {
  const done = 'OUTCOME: DONE - Created lib/search.js exporting search.\nPROOF: git commit abc1234, node --test lib/search.test.mjs 4 pass.\nNOT CHECKED: nothing.\nNEEDS A DECISION: nothing\nFULL REPORT: progress/x.md\n';
  const a = runHook(hookInput({ last_assistant_message: done }));
  assert.equal(a.row.status, 'DONE');
  const fail = 'OUTCOME: FAIL. server.js:76 ships a hardcoded password.\nPROOF: node --test x.test.mjs 8 pass.\nNOT CHECKED: nothing.\nNEEDS A DECISION: nothing\nFULL REPORT: r.md\nSTATUS: DONE\nEVIDENCE: read server.js:76\n';
  const b = runHook(hookInput({ agent_type: 'orchestrate:orch-reviewer', last_assistant_message: fail }));
  assert.equal(b.row.status, 'FAIL');
  assert.equal(b.row.verdict, 'FAIL');
});

import { sumUsage, costLine } from './ledger.mjs';
import { dollars } from './lib/prices.mjs';

const advRec = (id, usage) => JSON.stringify({ type: 'assistant', message: { id, model: 'claude-sonnet-5-5', usage } });
const ADV_USAGE = {
  input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0,
  iterations: [
    { type: 'message', input_tokens: 1000, output_tokens: 100 },
    { type: 'advisor_message', model: 'claude-opus-5-5', input_tokens: 108419, output_tokens: 14312, cache_read_input_tokens: 1000, cache_creation_input_tokens: 500 },
  ],
};

test('a helper transcript cost includes the advisor at the advisor model rate', () => {
  const p = writeTranscript([advRec('m1', { input_tokens: 500, output_tokens: 50 }), advRec('m2', ADV_USAGE)]);
  const u = sumUsage(p);
  assert.equal(u.input, 1500);
  const advD = dollars({ input: 108419, output: 14312, cacheRead: 1000, cacheWrite: 500 }, 'claude-opus-5-5');
  const mainD = dollars(u, 'claude-sonnet-5-5');
  const line = costLine('orch-implementer', 'claude-sonnet-5-5', u);
  assert.equal(line.dollars, Number((mainD + advD).toFixed(4)));
  assert.equal(line.advisorCalls, 1);
  assert.equal(line.advisorModel, 'opus');
  assert.equal(line.advisorInput, 108419);
  assert.equal(line.advisorDollars, Number(advD.toFixed(4)));
});

test('the same message id three times counts the advisor once', () => {
  const p = writeTranscript([advRec('m2', ADV_USAGE), advRec('m2', ADV_USAGE), advRec('m2', ADV_USAGE)]);
  const u = sumUsage(p);
  assert.equal(u.turns, 1);
  assert.equal(u.advisor[0].calls, 1);
  assert.equal(u.advisor[0].output, 14312);
});

test('an advisor model nobody can price stays unpriced and adds nothing', () => {
  const odd = { ...ADV_USAGE, iterations: [{ type: 'advisor_message', model: 'mystery-1', input_tokens: 9e6, output_tokens: 1 }] };
  const u = sumUsage(writeTranscript([advRec('m1', odd)]));
  const line = costLine('x', 'claude-sonnet-5-5', u);
  assert.equal(line.advisorDollars, 0);
  assert.equal(line.advisorUnpriced, 1);
  assert.equal(line.dollars, Number(dollars(u, 'claude-sonnet-5-5').toFixed(4)));
});

test('a return whose advisor cannot be priced says the price leaves it out', async () => {
  const { priceText } = await import('./ledger.mjs');
  const odd = { ...ADV_USAGE, iterations: [{ type: 'advisor_message', model: 'mystery-1', input_tokens: 100000, output_tokens: 10000 }] };
  const line = costLine('x', 'claude-sonnet-5-5', sumUsage(writeTranscript([advRec('m1', odd)])));
  assert.match(priceText(line), /^\$\d+\.\d\d at list price \(advisor not priced, left out\)$/);
  assert.match(priceText(costLine('x', 'claude-sonnet-5-5', sumUsage(writeTranscript([advRec('m2', ADV_USAGE)])))), /^\$\d+\.\d\d at list price$/);
  assert.equal(priceText({ dollars: null }), 'unpriced (no model named)');
});
