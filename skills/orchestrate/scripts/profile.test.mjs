// profile.test.mjs — the Codex side of the profile: the plan is asked once and
// stored, and `--brief` says what Codex can do from a fresh cache it never
// refreshes itself, in one of four shapes, and nothing without one.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const PROFILE = join(dirname(fileURLToPath(import.meta.url)), 'profile.mjs');

function sandbox() {
  const home = mkdtempSync(join(tmpdir(), 'orch-profile-'));
  mkdirSync(join(home, '.claude', 'orchestrate', 'workers'), { recursive: true });
  return home;
}
function profile(home, args) {
  return spawnSync(process.execPath, [PROFILE, ...args], {
    cwd: home, encoding: 'utf8', timeout: 30000,
    env: { ...process.env, HOME: home, USERPROFILE: home, CLAUDE_CODE_ENTRYPOINT: '' },
  });
}
function codexLine(home) {
  const r = profile(home, ['--brief']);
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.split('\n').find(l => l.startsWith('codex:')) ?? null;
}
function cache(home, value, at = new Date().toISOString()) {
  writeFileSync(join(home, '.claude', 'orchestrate', 'workers', 'codex-status.json'), JSON.stringify({ at, ...value }));
}

test('--set codex.tier saves the plan and refuses a value that is not a plan', () => {
  const home = sandbox();
  const ok = profile(home, ['--set', 'codex.tier=pro5']);
  assert.equal(ok.status, 0, ok.stderr);
  const saved = JSON.parse(readFileSync(join(home, '.claude', 'orchestrate', 'profile.json'), 'utf8'));
  assert.equal(saved.codex.tier, 'pro5');
  const bad = profile(home, ['--set', 'codex.tier=gold']);
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /plus\|pro5\|pro20/);
  assert.equal(JSON.parse(readFileSync(join(home, '.claude', 'orchestrate', 'profile.json'), 'utf8')).codex.tier, 'pro5');
});

test('--autocompact off removes the setting and leaves the opt-out marker', () => {
  const home = sandbox();
  writeFileSync(join(home, '.claude', 'settings.json'), JSON.stringify({ env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: '200000', KEEP: 'yes' } }));
  const r = profile(home, ['--autocompact', 'off']);
  assert.equal(r.status, 0, r.stderr);
  const settings = JSON.parse(readFileSync(join(home, '.claude', 'settings.json'), 'utf8'));
  assert.equal(settings.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW, undefined);
  assert.equal(settings.env.KEEP, 'yes');
  assert.ok(existsSync(join(home, '.claude', 'orchestrate', 'autocompact-default.json')));
  assert.match(r.stdout, /remove/);
});

test('--brief prints the codex line in each shape from a fresh cache, and nothing without one', () => {
  // Nothing in the plugin writes the cache today, so a line for "not checked"
  // was the same on every skill load and changed nothing (2026-10-03).
  const home = sandbox();
  assert.equal(codexLine(home), null, 'no reading: no line');
  cache(home, { status: 'ok', model: 'gpt-5.6-terra' }, new Date(Date.now() - 2 * 3600000).toISOString());
  assert.equal(codexLine(home), null, 'an old probe is not trusted');
  cache(home, { status: 'not-installed' });
  assert.equal(codexLine(home), 'codex: not installed');
  cache(home, { status: 'not-signed-in' });
  assert.equal(codexLine(home), 'codex: not signed in');
  cache(home, { status: 'limit', until: '3:40 PM' });
  assert.equal(codexLine(home), 'codex: limit until 3:40 PM');
  cache(home, { status: 'ok', model: 'gpt-5.6-terra' });
  assert.equal(codexLine(home), 'codex: gpt-5.6-terra · tier unknown · ok');
  assert.equal(profile(home, ['--set', 'codex.tier=plus']).status, 0);
  assert.equal(codexLine(home), 'codex: gpt-5.6-terra · plus · ok');
});

test('the brief line carries only what the lead can act on', () => {
  // It runs on every skill load and is read on every later turn (plan 0010
  // step 2e): no skills-on-disk list (the host lists them), no providers, no
  // auto-compact hint, and no prices or paid-skills line while they say nothing
  // beyond the skill. Live usage stays where it can be fixed: in a terminal
  // with no reading, the line names the one-time install (independent review,
  // round 2); the desktop app runs no status line, so it is not said there.
  const home = sandbox();
  const r = profile(home, ['--brief']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^orchestrate: tier /m);
  assert.match(r.stdout, /^this plan includes: /m);
  assert.doesNotMatch(r.stdout, /skills on disk|^providers:|auto-compact|prices measured here: none|skills that call a paid/m);
  assert.match(r.stdout, /^live usage: off, so no usage check can see the limit\. With the user's yes, once: node ".*statusline\.mjs" --install$/m);
  assert.ok(Buffer.byteLength(r.stdout) < 800, `the brief is ${Buffer.byteLength(r.stdout)} bytes`);
  for (const entry of ['claude-desktop', 'remote_cowork', 'claude-vscode', 'sdk-ts']) {
    const other = spawnSync(process.execPath, [PROFILE, '--brief'], {
      cwd: home, encoding: 'utf8', timeout: 30000,
      env: { ...process.env, HOME: home, USERPROFILE: home, CLAUDE_CODE_ENTRYPOINT: entry },
    });
    assert.equal(other.status, 0, other.stderr);
    assert.doesNotMatch(other.stdout, /live usage/, `${entry}: nothing to offer where no status line runs`);
  }
  const cli = spawnSync(process.execPath, [PROFILE, '--brief'], {
    cwd: home, encoding: 'utf8', timeout: 30000,
    env: { ...process.env, HOME: home, USERPROFILE: home, CLAUDE_CODE_ENTRYPOINT: 'cli' },
  });
  assert.match(cli.stdout, /^live usage: off/m, 'the terminal entrypoint says it');
});
