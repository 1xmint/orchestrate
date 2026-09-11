// settings.test.mjs — the installer's merge, proved on a copy of a real
// settings.json: our entries land, a second run does not stack them, and
// nothing that belongs to the user is touched.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  registrations, applyRegistrations, readSettings, writeSettings, backupSettings,
  commandBasename, stripByBasename, nodeMajor, toPosix, commandFor, setKeys,
} from './settings.mjs';

// A settings file shaped like Josh's: an unrelated PreToolUse hook that must
// survive, plus the keys the app writes around it.
const REAL_SHAPE = {
  permissions: { defaultMode: 'auto' },
  model: 'sonnet',
  hooks: {
    PreToolUse: [
      { matcher: 'Write|Edit', hooks: [{ type: 'command', command: 'node "C:/Users/Josh/.claude/hooks/memory-write-gate.mjs"' }] },
    ],
  },
  effortLevel: 'low',
  autoMode: { allow: ['$defaults', 'Bash(rustup:*)'] },
};

const clone = o => JSON.parse(JSON.stringify(o));
const SCRIPTS = 'C:/Users/Josh/.claude/skills/orchestrate/scripts';

function tmp() {
  return mkdtempSync(join(tmpdir(), 'orch-settings-'));
}

test('registering router and guard keeps every entry that is not ours', () => {
  const s = clone(REAL_SHAPE);
  const entries = registrations(SCRIPTS, { router: true, guard: true });
  const report = applyRegistrations(s, entries);

  assert.equal(report.removed, 0);
  assert.equal(report.added, 6);
  const gate = s.hooks.PreToolUse.find(g => JSON.stringify(g).includes('memory-write-gate.mjs'));
  assert.deepEqual(gate, REAL_SHAPE.hooks.PreToolUse[0], 'the memory-write-gate entry is untouched');
  assert.deepEqual(s.permissions, REAL_SHAPE.permissions);
  assert.equal(s.effortLevel, 'low');
  assert.deepEqual(s.autoMode, REAL_SHAPE.autoMode);

  assert.equal(s.hooks.UserPromptSubmit.length, 1);
  assert.equal(s.hooks.UserPromptSubmit[0].matcher, undefined, 'UserPromptSubmit takes no matcher');
  assert.equal(s.hooks.UserPromptSubmit[0].hooks[0].timeout, 5);
  assert.equal(s.hooks.SessionStart[0].matcher, 'resume|compact|clear');
  assert.equal(s.hooks.SubagentStop[0].hooks[0].command, commandFor(join(SCRIPTS, 'ledger.mjs')));
  assert.match(s.hooks.PreToolUse.map(g => JSON.stringify(g)).join(''), /guard-agent\.mjs/);
  assert.match(s.hooks.PreToolUse.map(g => JSON.stringify(g)).join(''), /Agent\|Task/, 'the guard matches a future Task-named tool too');
  assert.equal(s.hooks.Stop[0].hooks[0].command, commandFor(join(SCRIPTS, 'turn-check.mjs')), 'the Pickup check is pinned by a script install too, not just SKILL.md\'s bare `node`');
  assert.equal(s.hooks.PreCompact[0].hooks[0].command, commandFor(join(SCRIPTS, 'precompact-check.mjs')));
});

test('a second run replaces our entries instead of stacking them', () => {
  const s = clone(REAL_SHAPE);
  applyRegistrations(s, registrations(SCRIPTS, { router: true, guard: true }));
  const once = clone(s);
  const report = applyRegistrations(s, registrations(SCRIPTS, { router: true, guard: true }));

  assert.equal(report.removed, 6, 'the stale copies are found by basename and dropped');
  assert.equal(s.hooks.UserPromptSubmit.length, 1);
  assert.equal(s.hooks.SessionStart.length, 1);
  assert.equal(s.hooks.SubagentStop.length, 1);
  assert.equal(s.hooks.Stop.length, 1);
  assert.equal(s.hooks.PreCompact.length, 1);
  assert.equal(s.hooks.PreToolUse.length, 2, 'the user hook plus one of ours');
  assert.deepEqual(new Set(Object.keys(s.hooks)), new Set(Object.keys(once.hooks)));
});

test('an old entry under a different path is still recognised as ours', () => {
  const s = clone(REAL_SHAPE);
  s.hooks.PreToolUse.push({ matcher: 'Agent', hooks: [{ type: 'command', command: 'node "/home/someone/else/guard-agent.mjs"' }] });
  const report = applyRegistrations(s, registrations(SCRIPTS, { guard: true }));
  assert.equal(report.removed, 1);
  assert.equal(s.hooks.PreToolUse.length, 2);
  assert.match(JSON.stringify(s.hooks.PreToolUse), /skills\/orchestrate\/scripts\/guard-agent\.mjs/);
});

test('stripping the only hook in a group drops the group, not the event of a sibling', () => {
  const s = { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'node "x/turn-check.mjs"' }] }], PreToolUse: [{ matcher: 'Write', hooks: [{ type: 'command', command: 'node "keep.mjs"' }] }] } };
  const removed = stripByBasename(s, ['turn-check.mjs']);
  assert.equal(removed, 1);
  assert.equal(s.hooks.Stop, undefined, 'an emptied event is removed');
  assert.equal(s.hooks.PreToolUse.length, 1);
});

test('a group with one of ours and one of theirs keeps theirs', () => {
  const s = { hooks: { PreToolUse: [{ matcher: 'Agent', hooks: [
    { type: 'command', command: 'node "a/guard-agent.mjs"' },
    { type: 'command', command: 'node "b/their-audit.mjs"' },
  ] }] } };
  stripByBasename(s, ['guard-agent.mjs']);
  assert.equal(s.hooks.PreToolUse[0].hooks.length, 1);
  assert.match(s.hooks.PreToolUse[0].hooks[0].command, /their-audit/);
});

test('commands name the interpreter by absolute path, quoted, with no shell operators', () => {
  // Bare `node` is not enough: a desktop app launched from the dock or Start
  // menu has the OS login environment, not a shell's, so an nvm or Homebrew
  // Node is not on its PATH and every hook would fail silently.
  for (const e of registrations('C:\\Users\\Josh\\.claude\\skills\\orchestrate\\scripts', { router: true, guard: true })) {
    assert.match(e.command, /^"[^"]+" "[^"]+\.mjs"$/);
    assert.ok(e.command.startsWith(`"${process.execPath.split('\\').join('/')}"`));
    assert.doesNotMatch(e.command, /\\|&&|\||;|\$\(/, 'no backslashes and no shell operators');
    assert.equal(commandBasename(e.command).endsWith('.mjs'), true, 'the script, not the interpreter, is what dedupe keys on');
  }
});

test('settings with no hooks key, or a corrupt file, still merge', () => {
  const s = { model: 'opus' };
  applyRegistrations(s, registrations(SCRIPTS, { router: true }));
  assert.equal(s.hooks.UserPromptSubmit.length, 1);
  assert.equal(s.model, 'opus');

  const dir = tmp();
  const p = join(dir, 'settings.json');
  writeFileSync(p, '{ this is not json');
  assert.deepEqual(readSettings(p), {}, 'a corrupt file reads as empty rather than throwing');
});

test('a backup is written before the file changes, and round-trips', () => {
  const dir = tmp();
  const p = join(dir, 'settings.json');
  const backups = join(dir, 'backups');
  writeSettings(p, REAL_SHAPE);
  const original = readFileSync(p, 'utf8');

  const backup = backupSettings(p, backups);
  assert.ok(backup && existsSync(backup));
  assert.equal(readFileSync(backup, 'utf8'), original);

  const s = readSettings(p);
  applyRegistrations(s, registrations(SCRIPTS, { router: true, guard: true }));
  writeSettings(p, s);
  assert.notEqual(readFileSync(p, 'utf8'), original);
  assert.deepEqual(readSettings(backup), REAL_SHAPE, 'the backup still holds the pre-merge file');
  assert.equal(readdirSync(backups).length, 1);
  assert.equal(backupSettings(join(dir, 'absent.json'), backups), null, 'nothing to back up is not an error');
});

test('the real settings.json on this machine survives a dry merge', { skip: !existsSync(join(homedir(), '.claude', 'settings.json')) }, () => {
  const p = join(homedir(), '.claude', 'settings.json');
  const before = readSettings(p);
  const s = readSettings(p);
  applyRegistrations(s, registrations(SCRIPTS, { router: true, guard: true }));
  // Every non-orchestrate hook group is still present, byte for byte.
  const ours = new Set(['router.mjs', 'guard-agent.mjs', 'ledger.mjs', 'turn-check.mjs', 'precompact-check.mjs']);
  const theirs = o => JSON.stringify(Object.fromEntries(Object.entries((o.hooks) || {}).map(([ev, gs]) => [ev, (gs || []).map(g => ({ ...g, hooks: (g.hooks || []).filter(h => !ours.has(commandBasename(h.command))) })).filter(g => g.hooks.length)]).filter(([, gs]) => gs.length)));
  assert.equal(theirs(s), theirs(before));
  for (const k of Object.keys(before)) if (k !== 'hooks') assert.deepEqual(s[k], before[k], `${k} is untouched`);
});

test('node version and path helpers', () => {
  assert.equal(nodeMajor('v18.20.4'), 18);
  assert.equal(nodeMajor('v22.1.0'), 22);
  assert.equal(nodeMajor('nonsense'), 0);
  assert.ok(nodeMajor() >= 18, 'these scripts require Node 18+');
  assert.equal(toPosix('C:\\a\\b'), 'C:/a/b');
  assert.equal(commandBasename('node "C:/x/y/router.mjs"'), 'router.mjs');
  assert.equal(commandBasename('echo hi'), '');
});


test('the default model and effort merge in without disturbing anything else', () => {
  const dir = mkdtempSync(join(tmpdir(), 'orch-setkeys-'));
  const p = join(dir, 'settings.json');
  const before = { model: 'sonnet', effortLevel: 'low', permissions: { allow: ['Bash(git status:*)'] }, hooks: { Stop: [{ hooks: [{ type: 'command', command: 'node theirs.mjs' }] }] } };
  writeSettings(p, before);
  const s = readSettings(p);
  setKeys(s, { model: 'opus', effortLevel: 'high' });
  writeSettings(p, s);
  const after = readSettings(p);
  assert.equal(after.model, 'opus');
  assert.equal(after.effortLevel, 'high');
  assert.deepEqual(after.permissions, before.permissions, 'their permissions are untouched');
  assert.deepEqual(after.hooks, before.hooks, 'their hooks are untouched');
});

// `max` is not accepted in either key. Writing it would leave every new session
// refusing to start, which is worse than the file saying nothing at all.
test('max is refused in both keys', () => {
  assert.throws(() => setKeys({}, { effortLevel: 'max' }), /max is not accepted/);
  assert.throws(() => setKeys({}, { model: 'max' }), /max is not accepted/);
  // profile.mjs must catch both BEFORE it takes a backup, or the user gets a
  // raw stack trace next to a stray backup file for a typo.
  const here = dirname(fileURLToPath(import.meta.url));
  const cli = readFileSync(join(here, '..', 'profile.mjs'), 'utf8');
  assert.match(cli, /kvd\.effort === 'max' \|\| kvd\.model === 'max'/);
  assert.ok(cli.indexOf("kvd.model === 'max'") < cli.indexOf('backupSettings(settingsPath'),
    'the refusal comes before the backup');
  const s = {};
  setKeys(s, { model: 'opus' });
  assert.equal(s.effortLevel, undefined, 'one key at a time is fine');
});

// v0.7.x put a `type: "prompt"` Stop hook in this file that had a second model
// read every reply. It is gone. Anyone who installed it still has it, so the
// installer has to take it back out, and leave everything else in the file
// exactly where it was.
test('a reply check somebody already has is removed by the next install', () => {
  const OLD = 'You are checking one reply from a coding assistant.\nRules follow.';
  const s = { hooks: { Stop: [
    { hooks: [{ type: 'prompt', prompt: OLD, model: 'sonnet', timeout: 30 }] },
    { hooks: [{ type: 'command', command: 'node "C:/theirs/other.mjs"' }] },
  ] } };

  const entries = registrations(SCRIPTS, { router: true, guard: true });
  applyRegistrations(s, entries);

  const stops = s.hooks.Stop.flatMap(g => g.hooks);
  assert.equal(stops.filter(h => h.type === 'prompt').length, 0, 'the old reply check is gone');
  assert.ok(stops.some(h => h.command === 'node "C:/theirs/other.mjs"'), 'their own hook survives');

  // And nothing registers one again.
  assert.equal(entries.filter(e => e.type === 'prompt').length, 0);
});
