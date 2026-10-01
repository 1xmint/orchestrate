// profile.test.mjs — the Codex side of the profile: the plan is asked once and
// stored, and `--brief` says what Codex can do from a cache it never refreshes
// itself, in one of five shapes.

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
  return r.stdout.split('\n').find(l => l.startsWith('codex:'));
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

test('--brief prints the codex line in each shape from the cache', () => {
  const home = sandbox();
  assert.match(codexLine(home), /^codex: not checked in the last hour/);
  cache(home, { status: 'ok', model: 'gpt-5.6-terra' }, new Date(Date.now() - 2 * 3600000).toISOString());
  assert.match(codexLine(home), /^codex: not checked in the last hour/, 'an old probe is not trusted');
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

test('the skills line counts skills of installed plugins and the user\'s own, and never says "none" when none are found', () => {
  const home = sandbox();
  // none anywhere: says none were found on disk, without claiming the listing is empty
  const empty = profile(home, ['--brief']);
  assert.equal(empty.status, 0, empty.stderr);
  const emptyLine = empty.stdout.split('\n').find(l => l.startsWith('skills on disk'));
  assert.match(emptyLine, /none found on disk/);
  assert.match(emptyLine, /not the session's own listing/);
  // an installed plugin (named by installed_plugins.json, kept outside ~/.claude/plugins) and a user skill
  const inst = join(home, 'elsewhere', 'docs-plugin');
  mkdirSync(join(inst, 'skills', 'pdf'), { recursive: true });
  writeFileSync(join(inst, 'skills', 'pdf', 'SKILL.md'), '---\nname: pdf\n---\n');
  mkdirSync(join(inst, 'skills', 'not-a-skill'), { recursive: true });
  mkdirSync(join(home, '.claude', 'plugins'), { recursive: true });
  writeFileSync(join(home, '.claude', 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'docs-plugin@market': [{ scope: 'user', installPath: inst, version: '1' }] } }));
  mkdirSync(join(home, '.claude', 'skills', 'mine'), { recursive: true });
  writeFileSync(join(home, '.claude', 'skills', 'mine', 'SKILL.md'), '---\nname: mine\n---\n');
  const r = profile(home, ['--brief']);
  const line = r.stdout.split('\n').find(l => l.startsWith('skills on disk'));
  assert.match(line, /docs-plugin:pdf/);
  assert.match(line, /\bmine\b/);
  assert.doesNotMatch(line, /not-a-skill|none/);
});
