// statusline.test.mjs — the status line that carries live plan usage to the
// hooks. The input is the shape the Claude Code docs publish.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { footer } from './statusline.mjs';
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
  assert.match(line, /^Opus 5 · ctx 34% · 5h 24% \(resets .+\) · wk 41%$/);
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

test('install refuses to rewrite a settings file it cannot parse', () => {
  const home = sandbox();
  const settings = join(home, '.claude', 'settings.json');
  writeFileSync(settings, '{ broken');
  assert.match(node(home, ['--install']).stdout, /not installed/);
  assert.equal(readFileSync(settings, 'utf8'), '{ broken');
  assert.equal(existsSync(join(home, '.claude', 'orchestrate', 'statusline-wrap.json')), false);
});
