// install-agents.test.mjs — the upgrade path for the role agents. The
// promise it makes is that a file the user tuned locally is not silently
// overwritten by the next install, and these are the cases that promise turns
// on. Every run uses a fake HOME, so the machine's own agents are untouched.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { AGENT_NAMES } from './lib/tier.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, 'install-agents.mjs');

function home() {
  const h = mkdtempSync(join(tmpdir(), 'orch-agents-'));
  mkdirSync(join(h, '.claude'), { recursive: true });
  return h;
}

const run = (h, ...args) => spawnSync(process.execPath, [SCRIPT, ...args], {
  encoding: 'utf8',
  env: { ...process.env, HOME: h, USERPROFILE: h, ORCH_SKILL_DIR: '/opt/skill' },
});

const agentPath = (h, n) => join(h, '.claude', 'agents', `${n}.md`);

test('a first install writes every role, with {{SKILL_DIR}} substituted', () => {
  const h = home();
  const r = run(h);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(readdirSync(join(h, '.claude', 'agents')).sort(), AGENT_NAMES.map(n => `${n}.md`).sort());
  const reviewer = readFileSync(agentPath(h, 'orch-reviewer'), 'utf8');
  assert.doesNotMatch(reviewer, /\{\{SKILL_DIR\}\}|CLAUDE_PLUGIN_ROOT/, 'no unresolved path reaches the installed file');
  // The role files carry no hooks of their own any more. The one they had sent
  // a finished return back to be reformatted, which spent a model turn to buy a
  // shape. Nothing in an installed agent file can now cost a turn.
  assert.doesNotMatch(reviewer, /^hooks:/m, 'no per-agent hook survives the install');
  assert.match(r.stdout, new RegExp(`${AGENT_NAMES.length} installed, 0 refreshed`));
});

test('a second install changes nothing and says so', () => {
  const h = home();
  run(h);
  const before = readFileSync(agentPath(h, 'orch-planner'), 'utf8');
  const r = run(h);
  assert.match(r.stdout, new RegExp(`0 installed, 0 refreshed, ${AGENT_NAMES.length} unchanged`));
  assert.equal(readFileSync(agentPath(h, 'orch-planner'), 'utf8'), before);
});

test('a file the user edited is kept, and --force overwrites it', () => {
  const h = home();
  run(h);
  const p = agentPath(h, 'orch-implementer');
  writeFileSync(p, `${readFileSync(p, 'utf8')}\nMy own rule: never touch the migrations folder.\n`);

  const kept = run(h);
  assert.match(kept.stdout, /kept       orch-implementer\.md/);
  assert.match(kept.stdout, /edited locally since install/);
  assert.match(readFileSync(p, 'utf8'), /never touch the migrations folder/, 'local tuning survives an upgrade');

  const forced = run(h, '--force');
  assert.match(forced.stdout, /refreshed  orch-implementer\.md/);
  assert.doesNotMatch(readFileSync(p, 'utf8'), /never touch the migrations folder/);
});

// This is the invariant every future upgrade rides on. The record stores the
// hash of what was written, which is the templated text, not the repo source.
// If it stored the source with {{SKILL_DIR}} still in it, then on a machine
// where templating changed anything, every file would look user-edited and no
// upgrade would ever apply.
test('the record holds the hash of the file as written, so an untouched file upgrades', () => {
  const h = home();
  run(h);
  const record = JSON.parse(readFileSync(join(h, '.claude', 'orchestrate', 'agents.installed.json'), 'utf8'));
  for (const n of AGENT_NAMES) {
    const onDisk = createHash('sha256').update(readFileSync(agentPath(h, n), 'utf8')).digest('hex');
    assert.equal(record[`${n}.md`], onDisk, `${n} record matches what is on disk`);
  }
  // And the consequence: nothing is reported as user-edited straight after an install.
  assert.match(run(h).stdout, /0 kept/);
});

test('--dry-run reports without writing anything', () => {
  const h = home();
  const r = run(h, '--dry-run');
  assert.equal(r.status, 0);
  assert.match(r.stdout, new RegExp(`\\[dry-run\\] ${AGENT_NAMES.length} installed`));
  assert.equal(existsSync(join(h, '.claude', 'agents')), false);
});

test('with the plugin installed it writes nothing, since a second copy lists every role twice', () => {
  const h = home();
  const pdir = join(h, '.claude', 'plugins', 'cache', 'market', 'orchestrate', '0.16.0', 'skills', 'orchestrate', 'assets', 'agents');
  mkdirSync(pdir, { recursive: true });
  for (const n of AGENT_NAMES) writeFileSync(join(pdir, `${n}.md`), `---\nname: ${n}\n---\n`);
  const r = run(h);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /skipped: the orchestrate plugin already provides the role agents/);
  assert.equal(existsSync(join(h, '.claude', 'agents')), false);
  const forced = run(h, '--force');
  assert.match(forced.stdout, new RegExp(`${AGENT_NAMES.length} installed`), '--force still copies');
});
