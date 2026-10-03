// statusline.test.mjs — the status line that carries live plan usage to the
// hooks. The input is the shape the Claude Code docs publish.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, utimesSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { footer, accountOrg, currentCopy } from './statusline.mjs';
import { snapshotFrom } from './lib/quota.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SAMPLE = {
  model: { id: 'claude-opus-5', display_name: 'Opus 5' },
  context_window: { used_percentage: 34.2 },
  rate_limits: { five_hour: { used_percentage: 23.5, resets_at: 1738425600 }, seven_day: { used_percentage: 41.2, resets_at: 1738857600 } },
};

function sandbox() {
  const home = mkdtempSync(join(tmpdir(), 'orch-sl-'));
  mkdirSync(join(home, '.claude', 'orchestrate'), { recursive: true });
  return home;
}
const env = home => ({ ...process.env, HOME: home, USERPROFILE: home });
const node = (home, args, input) => spawnSync(process.execPath, [join(HERE, 'statusline.mjs'), ...args], { input, encoding: 'utf8', env: env(home) });

test('the footer is short and says only what it was given', () => {
  const line = footer(snapshotFrom(SAMPLE));
  assert.match(line, /^Opus 5 · context 34% · 5h 24% \(resets .+\) · wk 41%$/);
  assert.equal(footer(snapshotFrom({ model: { display_name: 'Sonnet 5' } })), 'Sonnet 5', 'an API-key session has no windows and shows none');
});

test('status line mode saves the snapshot the hooks read', () => {
  const home = sandbox();
  const r = node(home, [], JSON.stringify(SAMPLE));
  assert.equal(r.status, 0);
  assert.match(r.stdout, /5h 24%/);
  const q = JSON.parse(readFileSync(join(home, '.claude', 'orchestrate', 'quota.json'), 'utf8'));
  assert.equal(q.fiveHour.pct, 23.5);
  assert.equal(q.week.pct, 41.2);
  assert.equal(node(home, [], 'not json').status, 0, 'bad input never breaks the footer');
});

test('install keeps an existing status line running first, and uninstall puts it back', () => {
  const home = sandbox();
  const settings = join(home, '.claude', 'settings.json');
  const theirs = { type: 'command', command: `"${process.execPath}" -e "process.stdout.write('THEIRS')"` };
  writeFileSync(settings, JSON.stringify({ model: 'opus', statusLine: theirs }));

  assert.match(node(home, ['--install']).stdout, /installed/);
  const s = JSON.parse(readFileSync(settings, 'utf8'));
  assert.match(s.statusLine.command, /statusline\.mjs/);
  assert.equal(s.model, 'opus', 'nothing else in settings changes');
  assert.match(node(home, ['--install']).stdout, /already installed/);

  const out = node(home, [], JSON.stringify(SAMPLE)).stdout;
  assert.match(out, /^THEIRS\n.*5h 24%/s, 'their line first, ours under it');

  assert.match(node(home, ['--uninstall']).stdout, /removed/);
  assert.deepEqual(JSON.parse(readFileSync(settings, 'utf8')).statusLine, theirs);
});

// The footer parsed all of ~/.claude.json on every draw: about 105 ms at 5 MB
// and 200 ms at 20 MB, after every message (whole-file review). What it needs
// is kept, keyed by the file's size and modified time.
test('the account the footer files usage under is read from ~/.claude.json only when that file changed', () => {
  const home = sandbox();
  const cfgPath = join(home, '.claude.json');
  const cachePath = join(home, '.claude', 'orchestrate', 'account-org.json');
  let parses = 0;
  const read = p => { parses++; try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
  const org = () => accountOrg({ cfgPath, cachePath, hostSession: '', read });
  assert.equal(org(), null, 'no file: no account, and nothing read');
  assert.equal(parses, 0);
  writeFileSync(cfgPath, JSON.stringify({ oauthAccount: { organizationUuid: 'org-one' }, projects: { big: 'x'.repeat(1000) } }));
  assert.equal(org(), 'org-one');
  assert.equal(org(), 'org-one');
  assert.equal(org(), 'org-one');
  assert.equal(parses, 1, 'three draws, one parse');
  writeFileSync(cfgPath, JSON.stringify({ oauthAccount: { organizationUuid: 'org-two' } }));
  const later = new Date(Date.now() + 5000);
  utimesSync(cfgPath, later, later);
  assert.equal(org(), 'org-two', 'a changed file is read again');
  assert.equal(parses, 2);
  writeFileSync(cfgPath, '{ "oauthAccount": { "organizationUuid": "org-th');
  utimesSync(cfgPath, new Date(Date.now() + 9000), new Date(Date.now() + 9000));
  assert.equal(org(), null, 'a file caught half written names no account');
  assert.equal(org(), null);
  assert.equal(parses, 4, 'and is not remembered, so the next draw reads it again');
});

// --install wrote the path of the version it ran from, so after a plugin update
// the footer went on running that version's folder (whole-file review). The copy
// in the plugin cache hands over to the copy Claude Code's install record names.
test('a copy in the plugin cache names the copy installed now; a script install, the same copy or an unreadable record names none', () => {
  const home = sandbox();
  const cache = join(home, '.claude', 'plugins', 'cache', 'orchestrate', 'orchestrate');
  const at = version => join(cache, version, 'skills', 'orchestrate', 'scripts', 'statusline.mjs');
  for (const v of ['0.1.0', '0.2.0']) { mkdirSync(dirname(at(v)), { recursive: true }); writeFileSync(at(v), ''); }
  const record = join(home, '.claude', 'plugins', 'installed_plugins.json');
  const write = installs => writeFileSync(record, JSON.stringify({ version: 2, plugins: { 'orchestrate@orchestrate': installs, 'other@m': [{ scope: 'user', installPath: join(cache, '0.1.0') }] } }));
  write([{ scope: 'user', installPath: join(cache, '0.2.0'), version: '0.2.0' }]);
  assert.equal(currentCopy(at('0.1.0'), record), at('0.2.0'));
  assert.equal(currentCopy(at('0.2.0'), record), null, 'already the current copy');
  assert.equal(currentCopy(join(home, '.claude', 'skills', 'orchestrate', 'scripts', 'statusline.mjs'), record), null, 'a script install is left alone');
  write([{ scope: 'project', installPath: join(cache, '0.1.0') }, { scope: 'user', installPath: join(cache, '0.2.0') }]);
  assert.equal(currentCopy(at('0.1.0'), record), at('0.2.0'), 'the user-wide install first');
  write([{ scope: 'user', installPath: join(cache, '9.9.9') }]);
  assert.equal(currentCopy(at('0.1.0'), record), null, 'a folder that is not there');
  writeFileSync(record, '{ broken');
  assert.equal(currentCopy(at('0.1.0'), record), null);
});

test('the footer run from an earlier version\'s folder draws with the current copy', () => {
  const home = sandbox();
  const cache = join(home, '.claude', 'plugins', 'cache', 'orchestrate', 'orchestrate');
  const old = join(cache, '0.1.0', 'skills', 'orchestrate', 'scripts');
  cpSync(HERE, old, { recursive: true, filter: src => !/\.test\.mjs$/.test(src) && !/[\\/]fixtures([\\/]|$)/.test(src) });
  const current = join(cache, '0.2.0', 'skills', 'orchestrate', 'scripts', 'statusline.mjs');
  mkdirSync(dirname(current), { recursive: true });
  writeFileSync(current, "process.stdout.write('the current copy drew this'); process.exit(0);\n");
  writeFileSync(join(home, '.claude', 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'orchestrate@orchestrate': [{ scope: 'user', installPath: join(cache, '0.2.0') }] } }));
  const r = spawnSync(process.execPath, [join(old, 'statusline.mjs')], { input: JSON.stringify(SAMPLE), encoding: 'utf8', env: env(home) });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, 'the current copy drew this');
  // With no install record the copy it was run as draws, as before.
  writeFileSync(join(home, '.claude', 'plugins', 'installed_plugins.json'), '{}');
  assert.match(spawnSync(process.execPath, [join(old, 'statusline.mjs')], { input: JSON.stringify(SAMPLE), encoding: 'utf8', env: env(home) }).stdout, /5h 24%/);
});

test('--install from another copy points the status line at it, and keeps the line it wraps', () => {
  const home = sandbox();
  const settings = join(home, '.claude', 'settings.json');
  const before = { type: 'command', command: '"node" "/old/plugins/cache/orchestrate/orchestrate/0.1.0/skills/orchestrate/scripts/statusline.mjs"', padding: 0 };
  writeFileSync(settings, JSON.stringify({ model: 'opus', statusLine: before }));
  writeFileSync(join(home, '.claude', 'orchestrate', 'statusline-wrap.json'), JSON.stringify({ command: 'echo THEIRS', previous: { type: 'command', command: 'echo THEIRS' } }));
  assert.match(node(home, ['--install']).stdout, /^updated to run this copy/);
  const s = JSON.parse(readFileSync(settings, 'utf8'));
  assert.ok(s.statusLine.command.includes(join(HERE, 'statusline.mjs').replace(/\\/g, '/')), s.statusLine.command);
  assert.equal(s.model, 'opus');
  assert.equal(JSON.parse(readFileSync(join(home, '.claude', 'orchestrate', 'statusline-wrap.json'), 'utf8')).command, 'echo THEIRS', 'what it wraps is kept');
  assert.match(node(home, ['--install']).stdout, /already installed/);
  assert.match(node(home, ['--uninstall']).stdout, /removed/);
  assert.equal(JSON.parse(readFileSync(settings, 'utf8')).statusLine.command, 'echo THEIRS');
});

test('install refuses to rewrite a settings file it cannot parse', () => {
  const home = sandbox();
  const settings = join(home, '.claude', 'settings.json');
  writeFileSync(settings, '{ broken');
  assert.match(node(home, ['--install']).stdout, /not installed/);
  assert.equal(readFileSync(settings, 'utf8'), '{ broken');
  assert.equal(existsSync(join(home, '.claude', 'orchestrate', 'statusline-wrap.json')), false);
});
