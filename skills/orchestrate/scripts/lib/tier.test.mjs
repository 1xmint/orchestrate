// tier.test.mjs — the shared helpers every hook imports. These are small, but
// each one is read by a hook that runs on every prompt or every dispatch, so a
// wrong answer here is wrong everywhere.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { isWritten, latestRun, readyTasks, ungradedReturns, returnedTasks, selfModel, shortModel, strongerThan, applyLimits, mapTier, today, sanitizeId, findRepoRoot, seenRecently, recordSeen, trimLog } from './tier.mjs';

const TIER = new URL('./tier.mjs', import.meta.url).href;

// Run a snippet against this module with a HOME of its own. The active-run
// pointer lives under the real ~/.claude/orchestrate, so a test that wrote it
// in process would repoint the developer's own machine at a temp directory.
function inFakeHome(code, setup) {
  const home = mkdtempSync(join(tmpdir(), 'orch-fakehome-'));
  if (setup) { mkdirSync(join(home, '.claude', 'orchestrate'), { recursive: true }); setup(home); }
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
    encoding: 'utf8', env: { ...process.env, HOME: home, USERPROFILE: home },
  });
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stdout.trim();
}

// ---- append-only seen-log (R4: dispatch-events.json under concurrent writers) --

test('recordSeen never reads before it writes, so two ids never collide', () => {
  const dir = mkdtempSync(join(tmpdir(), 'orch-seenlog-'));
  const path = join(dir, 'events.jsonl');
  const now = 1_000_000_000_000;
  recordSeen(path, 'a', now);
  recordSeen(path, 'b', now + 1);
  assert.equal(seenRecently(path, 'a', now + 2, 86400000), true);
  assert.equal(seenRecently(path, 'b', now + 2, 86400000), true);
  assert.equal(seenRecently(path, 'c', now + 2, 86400000), false);
});

test('two events landing at the same moment are both recorded (the bug a single slot had)', () => {
  // The defect this replaces: one {sig, ts} object, so a second concurrent
  // write clobbered the first's record before it could be checked. An
  // append-only log has no slot to clobber.
  const dir = mkdtempSync(join(tmpdir(), 'orch-seenlog-'));
  const path = join(dir, 'events.jsonl');
  const now = 1_000_000_000_000;
  const firstSeenBefore = seenRecently(path, 'dispatch-1', now, 86400000);
  recordSeen(path, 'dispatch-1', now);
  const secondSeenBefore = seenRecently(path, 'dispatch-2', now, 86400000);
  recordSeen(path, 'dispatch-2', now);
  assert.equal(firstSeenBefore, false, 'neither had been seen yet');
  assert.equal(secondSeenBefore, false, 'recording the first did not consume the slot the second needed');
  // A genuine repeat of the first, after the second was recorded in between,
  // is still caught — the exact case the global slot got wrong.
  assert.equal(seenRecently(path, 'dispatch-1', now + 1, 86400000), true);
});

test('seenRecently respects the TTL and ignores anything malformed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'orch-seenlog-'));
  const path = join(dir, 'events.jsonl');
  const now = 1_000_000_000_000;
  recordSeen(path, 'stale', now - 90_000_000);
  writeFileSync(path, 'not json\n', { flag: 'a' });
  recordSeen(path, 'fresh', now);
  assert.equal(seenRecently(path, 'stale', now, 86400000), false, 'older than the TTL is not a repeat');
  assert.equal(seenRecently(path, 'fresh', now, 86400000), true);
  assert.equal(seenRecently(path, 'missing-file-entirely', now), false);
});

test('trimLog drops the oldest lines and leaves a short log untouched', () => {
  const dir = mkdtempSync(join(tmpdir(), 'orch-seenlog-'));
  const path = join(dir, 'events.jsonl');
  for (let i = 0; i < 10; i++) recordSeen(path, `k${i}`, 1000 + i);
  trimLog(path, 4);
  const kept = require_lines(path);
  assert.equal(kept.length, 4);
  assert.deepEqual(kept.map(l => JSON.parse(l).id), ['k6', 'k7', 'k8', 'k9']);

  const untouched = join(dir, 'short.jsonl');
  recordSeen(untouched, 'only-one', 1000);
  trimLog(untouched, 4);
  assert.equal(require_lines(untouched).length, 1, 'nothing to trim is not an error');

  trimLog(join(dir, 'does-not-exist.jsonl'), 4); // must not throw
});

function require_lines(path) {
  return readFileSync(path, 'utf8').split('\n').filter(Boolean);
}

test('a Pickup value is written only when it is neither a placeholder nor the template list', () => {
  assert.equal(isWritten('dispatch 9-9-0002 once 0001 lands'), true);
  assert.equal(isWritten('high'), true);
  assert.equal(isWritten('<one sentence that continues from here>'), false);
  assert.equal(isWritten(''), false);
  assert.equal(isWritten(null), false);
  // The template's own alternatives, which used to leak into the resume line
  // as "confidence high | medium | low, risk none | mild | serious".
  assert.equal(isWritten('high | medium | low'), false);
  assert.equal(isWritten('none | mild | serious'), false);
  // A real sentence that happens to contain a pipe is still written.
  assert.equal(isWritten('run `rg foo | head` then continue at step three of the plan'), true);
});

test('a half-filled Pickup section yields no confidence or risk at all', () => {
  const repo = mkdtempSync(join(tmpdir(), 'orch-tier-'));
  const dir = join(repo, '.orchestrator', 'runs', '20260909-x');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'RUN.md'), [
    '# Run', '', '## Tasks', '',
    '| id | phase | role · model | task | rubric | attempts | evidence |',
    '|---|---|---|---|---|---|---|',
    '| 9-9-0001 | 🔨 running | implementer · sonnet | x | y | 0 | — |', '',
    '## Pickup', '',
    'Pickup prompt: continue at step three',
    'Pickup confidence: high | medium | low',
    'Resume risk: none | mild | serious', '',
  ].join('\n'));

  const run = latestRun(repo);
  assert.equal(run.open, true);
  assert.equal(run.pickup['Pickup prompt'], 'continue at step three');
  assert.equal(run.pickup['Pickup confidence'], undefined, 'an unedited template line is not an answer');
  assert.equal(run.pickup['Resume risk'], undefined);
});

test('the manager\'s own model comes from the last assistant record in the tail', () => {
  const dir = mkdtempSync(join(tmpdir(), 'orch-self-'));
  const p = join(dir, 't.jsonl');
  writeFileSync(p, [
    JSON.stringify({ type: 'assistant', effort: 'low', message: { model: 'claude-sonnet-5' } }),
    JSON.stringify({ type: 'user', message: { content: 'hi' } }),
    JSON.stringify({ type: 'assistant', effort: 'high', entrypoint: 'claude-desktop', message: { model: 'claude-opus-5' } }),
    JSON.stringify({ type: 'queue-operation', operation: 'enqueue' }),
  ].join('\n') + '\n');
  assert.deepEqual(selfModel(p), { model: 'opus', effort: 'high', entrypoint: 'claude-desktop' }, 'the newest record wins, host and all');
  assert.equal(selfModel(join(dir, 'absent.jsonl')), null);
  assert.equal(selfModel(''), null);

  assert.equal(shortModel('claude-opus-5'), 'opus');
  assert.equal(shortModel('claude-fable-5-1'), 'fable');
  assert.equal(shortModel('claude-haiku-4-5-20251001'), 'haiku');
  assert.equal(shortModel('some-other-model'), 'some-other-model');
});

test('the family ladder decides who is stronger, and a limit steps a family down', () => {
  assert.equal(strongerThan('opus', 'sonnet'), true);
  assert.equal(strongerThan('fable', 'opus'), true);
  assert.equal(strongerThan('sonnet', 'opus'), false);
  assert.equal(strongerThan('opus', 'opus'), false, 'equal is not stronger');
  assert.equal(strongerThan('opus', 'nonsense'), false, 'an unknown model never wins by default');
  assert.equal(strongerThan(null, 'sonnet'), false);

  assert.equal(applyLimits('opus', ['opus']), 'sonnet');
  assert.equal(applyLimits('opus', []), 'opus');
  assert.equal(applyLimits('haiku', ['haiku']), 'haiku', 'the bottom of the ladder has nowhere to go');
});

test('dates are local, and ids are safe to use as filenames', () => {
  const d = new Date(2026, 8, 9, 23, 30);
  assert.equal(today(d), '2026-09-09', 'local calendar date, not UTC');
  assert.equal(mapTier('claude_max_5x'), 'max5');
  assert.equal(mapTier('MAX'), 'max5', 'unversioned max is assumed to be the smaller one');
  assert.equal(mapTier('anything else'), null);
  assert.equal(sanitizeId('a/b\\c:d'), 'a_b_c_d');
});

test('a session whose cwd is above the repo still finds the open run', () => {
  const parent = mkdtempSync(join(tmpdir(), 'orch-parent-'));
  const repo = join(parent, 'therepo');
  const dir = join(repo, '.orchestrator', 'runs', '20260909-x');
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(repo, '.git'), { recursive: true });
  writeFileSync(join(dir, 'RUN.md'), [
    '# Run', '', '## Tasks', '',
    '| id | phase | role · model | task | rubric | attempts | evidence |',
    '|---|---|---|---|---|---|---|',
    '| 9-9-0001 | 🔨 running | implementer · sonnet | x | y | 0 | — |', '',
    '## Pickup', '', 'Pickup prompt: carry on at step two', '',
  ].join('\n'));

  // This is the layout Josh actually works in: the session starts in the folder
  // that contains his repos, so findRepoRoot(cwd) is null and every hook that
  // asked cwd found nothing.
  assert.equal(findRepoRoot(parent), null);

  // The pointer lives under the real home, so this half runs in a child with a
  // fake one; otherwise the suite would repoint the developer's own machine.
  const before = JSON.parse(inFakeHome(`
    const { resolveRun } = await import(${JSON.stringify(TIER)});
    console.log(JSON.stringify(resolveRun('s1', ${JSON.stringify(parent)})));
  `));
  assert.equal(before.run, null);
  assert.equal(before.candidates.length, 0, 'without the pointer there is nothing to offer');

  // With the pointer, the run is *offered*, not adopted. It is a candidate the
  // session has to claim on purpose, because "the last run opened on this
  // machine" and "the run this session is working on" are different facts, and
  // treating them as one wrote a return into a different repository's ledger.
  const after = JSON.parse(inFakeHome(`
    const { resolveRun, rememberActiveRun } = await import(${JSON.stringify(TIER)});
    rememberActiveRun(${JSON.stringify(repo)}, ${JSON.stringify(join(dir, 'RUN.md'))});
    console.log(JSON.stringify({
      read: resolveRun('s1', ${JSON.stringify(parent)}),
      write: resolveRun('s1', ${JSON.stringify(parent)}, { forWrite: true }),
    }));
  `));
  assert.equal(after.read.run, null, 'an unbound session is never given a run to write to');
  assert.equal(after.read.candidates.length, 1, 'it is shown as a candidate');
  assert.equal(after.read.candidates[0].runId, '20260909-x');
  assert.equal(after.read.candidates[0].pickup['Pickup prompt'], 'carry on at step two');
  assert.equal(after.write.candidates.length, 0, 'a write never sees the machine-wide pointer at all');
});

test('a session binds to a run explicitly, and then that run is the answer', () => {
  const repo = mkdtempSync(join(tmpdir(), 'orch-bind-'));
  mkdirSync(join(repo, '.git'), { recursive: true });
  const dir = join(repo, '.orchestrator', 'runs', '20260909-bound');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'RUN.md'), '# Run\n\n## Tasks\n\n| id | p | r | t | u | a | e |\n|---|---|---|---|---|---|---|\n| 9-9-0001 | 🔨 running | x | y | z | 0 | — |\n');

  const out = JSON.parse(inFakeHome(`
    const { bindSessionRun, readRun, resolveRun, sessionRun } = await import(${JSON.stringify(TIER)});
    const run = readRun(${JSON.stringify(join(dir, 'RUN.md'))}, ${JSON.stringify(repo)});
    bindSessionRun('sX', run);
    console.log(JSON.stringify({
      bound: sessionRun('sX').runId,
      // Bound wins even from a directory that knows nothing about the repo.
      elsewhere: resolveRun('sX', ${JSON.stringify(tmpdir())}, { forWrite: true }),
      unbound: resolveRun('sY', ${JSON.stringify(tmpdir())}, { forWrite: true }),
    }));
  `));
  assert.equal(out.bound, '20260909-bound');
  assert.equal(out.elsewhere.run.runId, '20260909-bound');
  assert.equal(out.elsewhere.how, 'bound to this session');
  assert.equal(out.unbound.run, null, 'another session in the same place gets nothing');
});

test('two open runs in one repo are candidates, never a guess', () => {
  const repo = mkdtempSync(join(tmpdir(), 'orch-two-'));
  mkdirSync(join(repo, '.git'), { recursive: true });
  for (const id of ['20260909-one', '20260910-two']) {
    const d = join(repo, '.orchestrator', 'runs', id);
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, 'RUN.md'), '# Run\n\n## Tasks\n\n| id | p | r | t | u | a | e |\n|---|---|---|---|---|---|---|\n| 9-9-0001 | 🔨 running | x | y | z | 0 | — |\n');
  }
  const out = JSON.parse(inFakeHome(`
    const { resolveRun } = await import(${JSON.stringify(TIER)});
    console.log(JSON.stringify(resolveRun('sZ', ${JSON.stringify(repo)}, { forWrite: true })));
  `));
  assert.equal(out.run, null);
  assert.equal(out.candidates.length, 2);
  assert.match(out.how, /2 open runs/);
});

test('the pointer never shows one repo the ledger of another', () => {
  const a = mkdtempSync(join(tmpdir(), 'orch-a-'));
  const b = mkdtempSync(join(tmpdir(), 'orch-b-'));
  for (const [root, id] of [[a, '20260909-a'], [b, '20260909-b']]) {
    const d = join(root, '.orchestrator', 'runs', id);
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, 'RUN.md'), `# Run\n\n## Tasks\n\n| id | phase | r | t | u | a | e |\n|---|---|---|---|---|---|---|\n| 9-9-0001 | 🔨 running | x | y | z | 0 | — |\n`);
  }
  const out = JSON.parse(inFakeHome(`
    const { latestRun, rememberActiveRun } = await import(${JSON.stringify(TIER)});
    rememberActiveRun(${JSON.stringify(a)}, 'ignored');
    console.log(JSON.stringify({ b: latestRun(${JSON.stringify(b)}).runId, a: latestRun(${JSON.stringify(a)}).runId }));
  `));
  assert.equal(out.b, '20260909-b', 'a repo with its own runs is never overridden by the pointer');
  assert.equal(out.a, '20260909-a');
});

// A plugin install registers the six role agents from the plugin's own folder
// and copies nothing into ~/.claude/agents. Counting only the loose copies
// reported "agents 0/6 (missing ...)" on a perfectly good plugin install, and
// would have sent the model off to install a second set that then shadowed the
// plugin's own.
test('the six agents count whether they are loose files or inside a plugin', () => {
  const names = ['orch-planner', 'orch-implementer', 'orch-researcher', 'orch-browser', 'orch-reviewer', 'orch-debugger'];
  const ask = home => JSON.parse(spawnSync(process.execPath, ['--input-type=module', '-e',
    `const { agentsInstalled } = await import(${JSON.stringify(TIER)}); console.log(JSON.stringify(agentsInstalled()));`,
  ], { encoding: 'utf8', env: { ...process.env, HOME: home, USERPROFILE: home } }).stdout.trim());

  const home = mkdtempSync(join(tmpdir(), 'orch-agentcount-'));
  assert.equal(ask(home).installed, 0, 'nothing installed either way');

  const pdir = join(home, '.claude', 'plugins', 'cache', 'orchestrate', 'orchestrate', '9.9.9', 'skills', 'orchestrate', 'assets', 'agents');
  mkdirSync(pdir, { recursive: true });
  for (const n of names) writeFileSync(join(pdir, `${n}.md`), `---
name: ${n}
---
`);
  const viaPlugin = ask(home);
  assert.equal(viaPlugin.installed, 6, 'found inside the plugin');
  assert.deepEqual(viaPlugin.missing, []);
  assert.equal(viaPlugin.source, 'plugin');

  // Loose files still win when all six are there, so a script install is
  // unaffected and still reports its own directory.
  const loose = join(home, '.claude', 'agents');
  mkdirSync(loose, { recursive: true });
  for (const n of names) writeFileSync(join(loose, `${n}.md`), `---
name: ${n}
---
`);
  const viaFiles = ask(home);
  assert.equal(viaFiles.installed, 6);
  assert.equal(viaFiles.source, 'files');
});


// Run folders are `<YYYYMMDD>-<slug>`, so a name sort only orders runs from
// different days. Two opened on the same day fell back to comparing slugs, and
// on 2026-09-09 the newer run lost to an older one for a whole session. That is
// not just a wrong label: the ledger writes whichever run it is handed, so a
// subagent's return was filed into a closed run and flipped two finished rows
// back to review.
test('the run opened last wins, even when an older one was written more recently', () => {
  const repo = mkdtempSync(join(tmpdir(), 'orch-samedate-'));
  const rows = glyph => [
    '# Run', '', '## Tasks', '',
    '| id | phase | role · model | task | rubric | attempts | evidence |',
    '|---|---|---|---|---|---|---|',
    '| 9-9-0001 | ' + glyph + ' | implementer · sonnet | x | y | 0 | — |', '',
    '## Pickup', '', 'Pickup prompt: which run am I', '',
  ].join('\n');

  // Alphabetically "vibe" sorts after "v07", which is how the real pair was
  // named, and the older one is also the one written most recently, because the
  // ledger rewrites RUN.md on every return. So neither a name sort nor a
  // modified-time sort gets this right. What run-init recorded does.
  const older = join(repo, '.orchestrator', 'runs', '20260909-vibe-coder-audit');
  const newer = join(repo, '.orchestrator', 'runs', '20260909-v07-senior-engineer');
  for (const d of [older, newer]) mkdirSync(d, { recursive: true });
  writeFileSync(join(newer, 'RUN.md'), rows('🔨 running'));
  writeFileSync(join(older, 'RUN.md'), rows('✅ done'));

  const out = JSON.parse(inFakeHome(`
    const { latestRun, rememberActiveRun } = await import(${JSON.stringify(TIER)});
    rememberActiveRun(${JSON.stringify(repo)}, ${JSON.stringify(join(newer, 'RUN.md'))});
    console.log(JSON.stringify(latestRun(${JSON.stringify(repo)})));
  `));

  assert.equal(out.runId, '20260909-v07-senior-engineer', 'the run opened last is the current one');
  assert.equal(out.open, true, 'and its own state is reported, not the closed run\'s');
});

test('the ordinary case is unchanged: runs made on later days still win', () => {
  const repo = mkdtempSync(join(tmpdir(), 'orch-days-'));
  const body = [
    '# Run', '', '## Tasks', '',
    '| id | phase | role · model | task | rubric | attempts | evidence |',
    '|---|---|---|---|---|---|---|',
    '| 9-9-0001 | 🔨 running | implementer · sonnet | x | y | 0 | — |', '',
  ].join('\n');
  // Created in the order they would really be created: earlier day first.
  for (const id of ['20260908-aaa-earlier-day', '20260910-zzz-later-day']) {
    const d = join(repo, '.orchestrator', 'runs', id);
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, 'RUN.md'), body);
  }
  assert.equal(latestRun(repo).runId, '20260910-zzz-later-day');
});

test('a run written by an older version is still read', () => {
  // Old ledgers are on people's disks. The headings moved (Shape gained
  // Constraints and Approach above it, the rubric column became acceptance
  // evidence), and none of that changes what a resuming session needs from an
  // old one: is it open, and what does its Pickup say.
  const repo = mkdtempSync(join(tmpdir(), 'orch-legacy-'));
  mkdirSync(join(repo, '.git'), { recursive: true });
  const dir = join(repo, '.orchestrator', 'runs', '20260901-old');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'RUN.md'), [
    '# Run 20260901-old', '', '## Goal', 'the old goal', '', '## Shape', '',
    'tasks: 2 · parallel: 1 · est. price: $4 (~3% of a week)', '', '## Tasks', '',
    '| id | phase | role · model | task | rubric (written before dispatch) | attempts | evidence |',
    '|---|---|---|---|---|---|---|',
    '| 9-1-0001 | ✅ done | implementer · sonnet | first | exit 0 | 1 | returns/001-orch-implementer.md |',
    '| 9-1-0002 | ◐ partial | implementer · sonnet | second | exit 0 | 2 | returns/002-orch-implementer.md |', '',
    '## Pickup', '', 'Pickup prompt: finish 9-1-0002', 'Pickup confidence: medium', 'Resume risk: mild', '',
  ].join('\n'));

  const run = latestRun(repo);
  assert.ok(run, 'an old ledger is still a run');
  assert.equal(run.runId, '20260901-old');
  assert.equal(run.open, true, 'a partial row keeps it open');
  assert.equal(run.rows, 2);
  assert.equal(run.pickup['Pickup prompt'], 'finish 9-1-0002');
});

test('a profile file from an older version still reads', () => {
  const out = JSON.parse(inFakeHome(`
    const { detectTier, routerSettings } = await import(${JSON.stringify(TIER)});
    console.log(JSON.stringify({ tier: detectTier(), router: routerSettings() }));
  `, home => {
    // The shape v0.7 wrote, including keys nothing reads any more.
    writeFileSync(join(home, '.claude', 'orchestrate', 'profile.json'), JSON.stringify({
      tier: 'max20', setAt: '2026-09-01T00:00:00Z', weekDollars: 600, weekSetAt: '2026-09-01',
      manager: { model: 'opus', effort: 'high', tier: 'max20', accepted: true },
      router: { enabled: true, haiku: false },
    }));
  }));
  assert.equal(out.tier.tier, 'max20');
  assert.equal(out.router.enabled, true);
});

// ---- which task could start right now ---------------------------------------
// The question a session could not answer, which is why one was watched sitting
// idle on a single agent with a finished plan on the board.

const HEADER = '| id | phase | blocks on | owns | role · model | task | acceptance evidence | attempts | result |';
const row = (id, phase, blocks = '—', task = 'do the thing') =>
  `| ${id} | ${phase} | ${blocks} | src/${id}.ts | implementer · sonnet | ${task} | exit 0 | 0 | — |`;

test('a planned task with nothing to wait for is ready', () => {
  const rows = [row('9-9-0001', '📋 planned'), row('9-9-0002', '📋 planned', '—')];
  assert.deepEqual(readyTasks(rows, HEADER), ['9-9-0001', '9-9-0002']);
});

test('a blocker releases what waits on it only when it is done', () => {
  const blocked = phase => readyTasks([row('9-9-0001', phase), row('9-9-0002', '📋 planned', '9-9-0001')], HEADER);
  assert.ok(blocked('✅ done').includes('9-9-0002'), 'done releases it');
  // Everything else leaves the waiting task where it is. The blocker itself may
  // well be ready — a planned blocker with nothing above it is — so this asks
  // whether the dependent moved, not what the whole list looks like.
  for (const phase of ['🔨 running', '🔍 review', '◐ partial', '⛔ blocked', '📋 planned']) {
    assert.ok(!blocked(phase).includes('9-9-0002'), `${phase} does not release it`);
  }
  // Failed never will release it, and built-unverified has not been checked by
  // anyone, so a task built on it would inherit the doubt.
  assert.ok(!blocked('✖ failed').includes('9-9-0002'));
  assert.ok(!blocked('🧱 built-unverified').includes('9-9-0002'));
});

test('only planned rows are candidates, and several blockers all have to land', () => {
  const rows = [
    row('9-9-0001', '✅ done'),
    row('9-9-0002', '🔨 running'),
    row('9-9-0003', '📋 planned', '9-9-0001, 9-9-0002'),
    row('9-9-0004', '📋 planned', '9-9-0001'),
    // Already running, so not a candidate however unblocked it is.
    row('9-9-0005', '🔨 running', '9-9-0001'),
  ];
  assert.deepEqual(readyTasks(rows, HEADER), ['9-9-0004']);
});

test('a blocker nobody wrote a row for is nothing to wait for', () => {
  const rows = [row('9-9-0002', '📋 planned', '9-9-0099')];
  assert.deepEqual(readyTasks(rows, HEADER), ['9-9-0002']);
});

test('a pipe in the task text cannot shift the columns that matter', () => {
  // Every cell readiness depends on sits to the left of the free text, which is
  // the reason the columns are ordered that way. Read from the right and a
  // rubric of "exit 0 | 41 passed" moves the phase.
  const rows = [row('9-9-0001', '📋 planned', '—', 'run `rg foo | head` and check exit 0 | 41 passed')];
  assert.deepEqual(readyTasks(rows, HEADER), ['9-9-0001']);
});

test('a ledger written before the columns existed reports nothing rather than guessing', () => {
  // The old seven-column table has no edges in it. Every planned row *might* be
  // ready and nothing on disk says so, so claiming they all are would be an
  // invention. It stays quiet and the run still reads normally.
  const legacy = '| id | phase | role · model | task | rubric | attempts | evidence |';
  const rows = [
    '| 9-1-0001 | ✅ done | implementer · sonnet | first | exit 0 | 1 | returns/a.md |',
    '| 9-1-0002 | 📋 planned | implementer · sonnet | second | exit 0 | 0 | — |',
  ];
  assert.deepEqual(readyTasks(rows, legacy), []);
  assert.deepEqual(readyTasks(rows, ''), [], 'no header at all is the same answer');
  assert.deepEqual(readyTasks([], HEADER), []);
});

// ---- work that came back while nobody was looking ---------------------------
// The hook stopped writing task rows in v0.9.0, so a row is only right if the
// lead sets it. That also decides whether `readyTasks` tells the truth, because
// readiness is computed from the same rows.

test('a return whose row was never touched is owed a grade', () => {
  const returned = ['9-9-0001'];
  const owed = phase => ungradedReturns([row('9-9-0001', phase)], returned);
  // The only two phases that mean nobody has been back to it since dispatch.
  assert.deepEqual(owed('🔨 running'), ['9-9-0001']);
  assert.deepEqual(owed('📋 planned'), ['9-9-0001']);
  // Grades the lead chose, and states that are final. All of them count as read.
  for (const phase of ['✅ done', '🧱 built-unverified', '✖ failed', '◐ partial', '⛔ blocked']) {
    assert.deepEqual(owed(phase), [], `${phase} has been judged`);
  }
});

test('a task with no return is never owed a grade', () => {
  const rows = [row('9-9-0001', '🔨 running'), row('9-9-0002', '🔨 running')];
  assert.deepEqual(ungradedReturns(rows, ['9-9-0002']), ['9-9-0002']);
  assert.deepEqual(ungradedReturns(rows, []), [], 'nothing has come back yet');
  assert.deepEqual(ungradedReturns(rows, null), []);
  // Two returns for one task is one row to set, not two.
  assert.deepEqual(ungradedReturns(rows, ['9-9-0001', '9-9-0001']), ['9-9-0001']);
  // A return for a task nobody wrote a row for cannot point at a row.
  assert.deepEqual(ungradedReturns(rows, ['9-9-0099']), []);
});

test('the returns index is read from disk, and a missing or broken one is quiet', () => {
  const dir = mkdtempSync(join(tmpdir(), 'orch-returns-'));
  assert.deepEqual(returnedTasks(dir), [], 'no returns folder at all');

  mkdirSync(join(dir, 'returns'), { recursive: true });
  writeFileSync(join(dir, 'returns', 'returns.jsonl'), [
    JSON.stringify({ task: '9-9-0001', agent: 'orch-implementer', status: 'DONE' }),
    'not json at all',
    '',
    JSON.stringify({ agent: 'orch-reviewer' }),
    JSON.stringify({ task: '9-9-0002', status: 'PARTIAL' }),
  ].join('\n'));
  // Every other reader here answers with less rather than throwing, and a hook
  // that throws on a half-written line is a hook that eats a return.
  assert.deepEqual(returnedTasks(dir), ['9-9-0001', '9-9-0002']);
});

test('a run reports what is owed and what is ready side by side', () => {
  const repo = mkdtempSync(join(tmpdir(), 'orch-owed-'));
  const dir = join(repo, '.orchestrator', 'runs', '20260909-owed');
  mkdirSync(join(dir, 'returns'), { recursive: true });
  writeFileSync(join(dir, 'RUN.md'), [
    '# Run', '', '## Tasks', '', HEADER, '|---|---|---|---|---|---|---|---|---|',
    row('9-9-0001', '🔨 running'),
    row('9-9-0002', '📋 planned', '9-9-0001'),
    row('9-9-0003', '📋 planned'),
  ].join('\n'));
  writeFileSync(join(dir, 'returns', 'returns.jsonl'),
    `${JSON.stringify({ task: '9-9-0001', agent: 'orch-implementer', status: 'DONE' })}\n`);

  const run = latestRun(repo);
  assert.deepEqual(run.ungraded, ['9-9-0001'], 'it came back and the row still says running');
  assert.deepEqual(run.ready, ['9-9-0003'], '0002 waits on a row nobody has set');
  assert.equal(run.open, true);
});
