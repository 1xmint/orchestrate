// run-init.test.mjs — the script that creates every ledger. It had no test,
// and it is the one file whose output a later session depends on to resume.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { latestRun } from './lib/tier.mjs';
import { openRunsUnder } from './lib/runs.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, 'run-init.mjs');

function repo(files = {}, withGit = true) {
  const dir = mkdtempSync(join(tmpdir(), 'orch-runinit-'));
  for (const [rel, content] of Object.entries(files)) {
    const p = join(dir, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content);
  }
  if (withGit) spawnSync('git', ['init', '-q', dir], { encoding: 'utf8' });
  return dir;
}

// A fake HOME, because run-init records the run it created under
// ~/.claude/orchestrate so hooks can find it from any cwd. Without this the
// suite would repoint the developer's own machine at a temp directory.
const FAKE_HOME = mkdtempSync(join(tmpdir(), 'orch-runinit-home-'));
const run = (cwd, ...args) => spawnSync(process.execPath, [SCRIPT, ...args], {
  cwd, encoding: 'utf8', env: { ...process.env, HOME: FAKE_HOME, USERPROFILE: FAKE_HOME },
});

test('a ledger is created with the headings a resuming session looks for', () => {
  const dir = repo({ 'pyproject.toml': '[tool.pytest.ini_options]\n' });
  const r = run(dir, 'tidy-finish', '--goal', 'finish tidy', '--tier', 'max5');
  assert.equal(r.status, 0, r.stderr);

  const path = r.stdout.split('\n')[0].trim();
  assert.ok(existsSync(path), 'the first line of output is the path it wrote');
  const md = readFileSync(path, 'utf8');
  for (const h of ['## Goal', '## Done when', '## Profile', '## Facts learned while grounding',
    '## Tasks', '## Decisions', '## Open questions for the user', '## Pickup', '## Verified vs inherited']) {
    assert.ok(md.includes(h), `keeps the heading ${h}`);
  }
  assert.match(md, /finish tidy/);
  assert.match(md, /tier: max5/);
  assert.doesNotMatch(md, /\{\{[A-Z_]+\}\}/, 'no template placeholder survives');
  assert.match(r.stdout, /task id prefix: \d+-\d+-NNNN/);
});

test('the detected gate is prefilled under Facts, and written to gate.json', () => {
  const dir = repo({ 'pyproject.toml': '[tool.pytest.ini_options]\n\n[tool.ruff]\n' });
  const r = run(dir, 'x');
  const md = readFileSync(r.stdout.split('\n')[0].trim(), 'utf8');
  const facts = md.slice(md.indexOf('## Facts'), md.indexOf('## Tasks'));
  assert.match(facts, /GATE \(detected \d{4}-\d\d-\d\d/);
  assert.match(facts, /pytest -q/);
  assert.match(facts, /ruff check \./);
  assert.ok(existsSync(join(dir, '.orchestrator', 'gate.json')));
});

test('the repo map is built at run start and named under Facts; a folder outside git has none', () => {
  const dir = repo({ 'src/a.mjs': "import './b.mjs';\n", 'src/b.mjs': '// b.\n' });
  spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'add', '-A'], { cwd: dir });
  spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'x'], { cwd: dir });
  const md = readFileSync(run(dir, 'x').stdout.split('\n')[0].trim(), 'utf8');
  assert.match(md.slice(md.indexOf('## Facts'), md.indexOf('## Tasks')), /MAP: .*map\.md \(\d+ chars/);
  assert.match(readFileSync(join(dir, '.orchestrator', 'map', 'map.md'), 'utf8'), /src\/b\.mjs — 1 importers/);
  const plain = repo({ 'README.md': 'hi\n' }, false);
  const r = run(plain, 'x');
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(readFileSync(r.stdout.split('\n')[0].trim(), 'utf8'), /^MAP:/m);
});

test('a repo with no detectable gate still gets a ledger, and says the gate is unknown', () => {
  const dir = repo({ 'README.md': 'hi\n' });
  const r = run(dir, 'x');
  assert.equal(r.status, 0);
  assert.match(readFileSync(r.stdout.split('\n')[0].trim(), 'utf8'), /none detected: ask the user/);
});

test('the ledger is excluded from git rather than added to a tracked ignore file', () => {
  const dir = repo({ 'package.json': '{}' });
  run(dir, 'x');
  assert.match(readFileSync(join(dir, '.git', 'info', 'exclude'), 'utf8'), /^\.orchestrator\/$/m);
  assert.equal(existsSync(join(dir, '.gitignore')), false, 'a tracked file is never touched');
});

test('the same slug twice refuses rather than overwriting a live ledger', () => {
  const dir = repo({ 'package.json': '{}' });
  assert.equal(run(dir, 'dup').status, 0);
  const second = run(dir, 'dup');
  assert.equal(second.status, 1);
  assert.match(second.stderr, /exists:/);
  assert.match(second.stderr, /resume it \(read its Pickup section\)/);
});

test('--repo puts the ledger in the repo the goal is about, not the current directory', () => {
  const target = repo({ 'Cargo.toml': '[package]\nname="x"\n' });
  const elsewhere = repo({}, false);
  const r = run(elsewhere, 'x', '--repo', target);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.stdout.startsWith(target), 'the ledger lands in the target repo');
  assert.equal(existsSync(join(elsewhere, '.orchestrator')), false);
  assert.match(r.stderr + r.stdout, /^(?!.*--repo not found)/s);

  const missing = run(elsewhere, 'x', '--repo', join(tmpdir(), 'orch-absent-4242'));
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /--repo not found/);
});

test('a slug is required, and a messy one is normalised', () => {
  const dir = repo({ 'package.json': '{}' });
  assert.equal(run(dir).status, 2);
  const r = run(dir, 'Tidy Finish!! v2');
  assert.equal(r.status, 0);
  assert.match(r.stdout.split('\n')[0], /\d{8}-tidy-finish-v2/);
});

// 9-14-0002: the run and the host's plan file point at each other, so the
// checkpoint check can treat a fresh plan as a real checkpoint.
test('a plan file touched after the session started gets a Plan line; an older one does not', () => {
  const dir = repo({ 'package.json': '{}' });
  const plansDir = join(FAKE_HOME, '.claude', 'plans');
  mkdirSync(plansDir, { recursive: true });
  const sessionsDir = join(FAKE_HOME, '.claude', 'orchestrate', 'sessions');
  mkdirSync(sessionsDir, { recursive: true });
  const started = new Date(Date.now() - 60000).toISOString();
  writeFileSync(join(sessionsDir, 'sess-fresh.json'), JSON.stringify({ session_id: 'sess-fresh', started }));
  const planPath = join(plansDir, 'the-plan.md');
  writeFileSync(planPath, '# plan\n');

  const r = run(dir, 'x', '--session-id', 'sess-fresh');
  assert.equal(r.status, 0, r.stderr);
  const md = readFileSync(r.stdout.split('\n')[0].trim(), 'utf8');
  assert.match(md, new RegExp(`^Plan: .*the-plan\\.md$`, 'm'));

  // An older session: its plan predates the session, so it is not this run's plan.
  const oldStarted = new Date(Date.now() + 3600000).toISOString(); // "started" after the plan file's mtime
  writeFileSync(join(sessionsDir, 'sess-stale.json'), JSON.stringify({ session_id: 'sess-stale', started: oldStarted }));
  const r2 = run(dir, 'y', '--session-id', 'sess-stale');
  assert.equal(r2.status, 0, r2.stderr);
  const md2 = readFileSync(r2.stdout.split('\n')[0].trim(), 'utf8');
  assert.doesNotMatch(md2, /^Plan:/m);
});

test('no session-id and no plan file both leave the Plan line off', () => {
  const dir = repo({ 'package.json': '{}' });
  const r = run(dir, 'z');
  assert.equal(r.status, 0, r.stderr);
  const md = readFileSync(r.stdout.split('\n')[0].trim(), 'utf8');
  assert.doesNotMatch(md, /^Plan:/m);
});

// Live note Q: the Goal held only the lead's paraphrase. With a session id the
// owner's own words are quoted from the transcript, a mid-turn message counts,
// and a short reply brings the longer request before it along.
test('the Goal quotes the owner from the transcript, then gives the lead\'s reading', () => {
  const projects = join(FAKE_HOME, '.claude', 'projects', 'proj');
  mkdirSync(projects, { recursive: true });
  const L = o => JSON.stringify(o) + '\n';
  const said = t => L({ type: 'user', message: { role: 'user', content: t } });
  const queued = t => L({ type: 'attachment', attachment: { type: 'queued_command', prompt: t, origin: { kind: 'human' } } });
  writeFileSync(join(projects, 'sess-words.jsonl'),
    said('<command-name>/orchestrate</command-name>')
    + said('make the members page load faster, it takes $& ten seconds on my phone and people complain')
    + L({ type: 'assistant', message: { content: [{ type: 'text', text: 'Shall I start?' }] } })
    + queued('yes go'));
  const dir = repo({ 'package.json': '{}' });
  const r = run(dir, 'w', '--session-id', 'sess-words', '--goal', 'cut members page load time');
  assert.equal(r.status, 0, r.stderr);
  const md = readFileSync(r.stdout.split('\n')[0].trim(), 'utf8');
  assert.match(md, /The owner's words, quoted from the session: "make the members page load faster, it takes \$& ten seconds[^"]*" Then: "yes go"/);
  assert.match(md, /The lead's reading: cut members page load time/);
  assert.doesNotMatch(md, /command-name/);

  const r2 = run(dir, 'w2', '--session-id', 'sess-none', '--goal', 'only mine');
  assert.match(readFileSync(r2.stdout.split('\n')[0].trim(), 'utf8'), /## Goal\n\nonly mine\n/, 'no transcript: the --goal text alone, as before');
});

test('the new ledger reads back as an open run with an unwritten Pickup', () => {
  const dir = repo({ 'package.json': '{}' });
  run(dir, 'x', '--goal', 'do the thing');
  const found = latestRun(dir);
  assert.ok(found, 'latestRun finds what run-init wrote');
  assert.equal(found.open, true, 'the placeholder row counts as open');
  assert.deepEqual(found.pickup, {}, 'nothing in Pickup is written yet, so nothing is reported');
  assert.equal(readdirSync(join(dir, '.orchestrator', 'runs')).length, 1);
});

// Seen live on 0.17.0: a finished run kept one blocked row (work only another
// machine could do), so it stayed "open", and every new session in the repo was
// told it continued that run and filed its helpers' returns into it.
test('--close ends a run that still holds a blocked row; --reopen brings it back', () => {
  const dir = repo({ 'package.json': '{}' });
  run(dir, 'finished', '--goal', 'old goal');
  const runsDir = join(dir, '.orchestrator', 'runs');
  const id = readdirSync(runsDir)[0];
  const runMd = join(runsDir, id, 'RUN.md');
  writeFileSync(runMd, readFileSync(runMd, 'utf8').replace(/\n## Tasks[^\n]*\n/, m => `${m}\n| 9-29-0001 | ⛔ blocked (machine) | — | — | — | needs Linux | — | 0 | — |\n`));
  assert.equal(openRunsUnder(dir).length, 1, 'a blocked row keeps the run open');

  const closed = run(dir, '--close', id, '--reason', 'goal dropped by the user');
  assert.equal(closed.status, 0, closed.stderr);
  assert.match(readFileSync(runMd, 'utf8'), /^Closed: \d{4}-\d{2}-\d{2} — goal dropped by the user$/m);
  assert.equal(openRunsUnder(dir).length, 0, 'a closed run is not open, blocked row or not');
  assert.equal(latestRun(dir).closed, true);

  const back = run(dir, '--reopen', id);
  assert.equal(back.status, 0, back.stderr);
  assert.doesNotMatch(readFileSync(runMd, 'utf8'), /^Closed:/m);
  assert.equal(openRunsUnder(dir).length, 1, 'reopening removes the Closed line');
});

test('--close names a run that does not exist and changes nothing', () => {
  const dir = repo({ 'package.json': '{}' });
  const r = run(dir, '--close', '20990101-nope');
  assert.equal(r.status, 2);
  assert.match(r.stderr, /no RUN\.md/);
});

// The same run with its own HOME and a chosen environment: host variables the
// developer's own session carries are dropped first.
function runWith(cwd, env, storedProfile, ...args) {
  const home = mkdtempSync(join(tmpdir(), 'orch-runinit-host-'));
  if (storedProfile) {
    mkdirSync(join(home, '.claude', 'orchestrate'), { recursive: true });
    writeFileSync(join(home, '.claude', 'orchestrate', 'profile.json'), JSON.stringify(storedProfile));
  }
  const base = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(CLAUDE|CODEX_)/.test(k)));
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8', env: { ...base, ...env, HOME: home, USERPROFILE: home } });
  return { r, md: r.status === 0 ? readFileSync(r.stdout.split('\n')[0].trim(), 'utf8') : '' };
}

test('the ledger Profile line takes its host from the stored profile, then the host environment, else says unknown', () => {
  const dir = () => repo({ 'pyproject.toml': '[tool.pytest.ini_options]\n' });
  assert.match(runWith(dir(), {}, { host: 'codex' }, 'h-stored').md, /host: codex/);
  assert.match(runWith(dir(), { CLAUDECODE: '1' }, null, 'h-env').md, /host: claude-code/);
  assert.match(runWith(dir(), { CLAUDECODE: '1' }, { host: 'codex' }, 'h-both', '--host', 'x-host').md, /host: x-host/);
  assert.match(runWith(dir(), {}, null, 'h-none').md, /host: unknown/);
});

test('--help lists --repo, --close and --reopen and exits 0', () => {
  const r = run(tmpdir(), '--help');
  assert.equal(r.status, 0);
  for (const f of ['--repo', '--close', '--reopen']) assert.ok(r.stdout.includes(f), f);
});
