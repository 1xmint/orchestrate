// band-mod.test.mjs — the band's mod (hooks/band.mjs) only reads and draws, and
// this holds it to that. Three kinds of check, none of which needs Claude Code:
//   1. the source is scanned for every `$.<namespace>.<method>` it calls, against
//      a list of read-only calls, and for the two events it registers;
//   2. hooks/hooks.json names it once, under "modules", beside the command hooks;
//   3. the mod is run against a fake `$` that records what it asks for, to see it
//      stand down where nothing draws, read a file only when its time moved, and
//      ask for a redraw only when the line changed.
// `claude plugin validate` (the CI job "validate") reads the same source for the
// rules the host holds a mod to; docs/band.md says what neither has seen.
//   node --test skills/orchestrate/scripts/band-mod.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { bandRecord, bandLine, OTHER_SESSION_TAG } from './lib/band-line.mjs';
import { BAND_REL } from './lib/band.mjs';
import { PAUSE_REL } from './lib/pause.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const MOD = join(ROOT, 'hooks', 'band.mjs');
const HOOKS_JSON = join(ROOT, 'hooks', 'hooks.json');
const LINE_LIB = join(ROOT, 'skills', 'orchestrate', 'scripts', 'lib', 'band-line.mjs');
const source = readFileSync(MOD, 'utf8');

// ---- what the mod may call -----------------------------------------------------
// Reads and draws only. Everything the host offers that writes a file, sends a
// prompt or a message, runs a command, a tool, a model, a helper, the network or
// an MCP server is left off, so adding one fails here and gets looked at.
const READ_ONLY = {
  session: ['root', 'id', 'surfaces'],   // where the session is, who it is, what it draws on
  fs: ['exists', 'stat', 'read'],        // the two records, read
  clock: ['now', 'every'],               // the time, and the poll
  ui: ['invalidate', 'resolve'],         // ask for a redraw, get the components to draw with
};
const EVENTS = ['session.start', 'ui.render'];

// The comments cut out, so a call named in a comment is not a call and a call
// hidden after a comment mark is not missed. Only whole-line `//` comments, `//`
// after a space and block comments: a `//` inside a regular expression or a
// string has no space before it.
const code = text => text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|\s)\/\/.*$/gm, '$1');

// What `$` is used for in a source: the `$.<ns>.<method>` calls, and any other use
// of the host handle (indexed, aliased, destructured, passed to something not in
// the same file) that would let a call go unseen.
export function usesOf(text) {
  const c = code(text);
  const calls = new Set();
  for (const m of c.matchAll(/\$\.([A-Za-z_]\w*)\.([A-Za-z_]\w*)/g)) calls.add(`${m[1]}.${m[2]}`);
  const strange = [];
  if (/\$\s*\[/.test(c)) strange.push('$[...] reaches a call by a computed name');
  if (/\$\.\w/.test(c.replace(/\$\.[A-Za-z_]\w*\.[A-Za-z_]\w*/g, ''))) strange.push('$.<namespace> used without a method');
  if (/=\s*\$\s*(?:[;,)\n]|$)/.test(c)) strange.push('$ stored under another name');
  // The handle may be handed on only to a function this same file declares (the
  // host's own check says the same of an imported one).
  const declared = new Set([...c.matchAll(/\bfunction\s+([A-Za-z_]\w*)\s*\(/g)].map(m => m[1]));
  for (const m of c.matchAll(/([A-Za-z_]\w*)\s*\(\s*\$\s*[,)]/g)) {
    if (m[1] === 'async' || m[1] === 'function') continue;
    if (!declared.has(m[1])) strange.push(`$ handed to ${m[1]}, which this file does not declare`);
  }
  if (/\b(?:eval|Function|require|globalThis|process|fetch|XMLHttpRequest|WebSocket|Deno|Bun)\b/.test(c)) strange.push('a global that reaches outside the handle');
  if (/\bimport\s*\(/.test(c)) strange.push('a dynamic import');
  return { calls: [...calls].sort(), strange };
}

test('the mod calls only the read-only calls on the list, and nothing else of the host handle', () => {
  const { calls, strange } = usesOf(source);
  const allowed = new Set(Object.entries(READ_ONLY).flatMap(([ns, ms]) => ms.map(m => `${ns}.${m}`)));
  const extra = calls.filter(c => !allowed.has(c));
  assert.deepEqual(extra, [], `calls off the list: ${extra.join(', ')}`);
  assert.deepEqual(strange, []);
  assert.ok(calls.length >= 8, `the scan found ${calls.length} calls; a scan that finds none passes anything`);
});

test('the mod uses each kind of read it is listed for: the list is not wider than the mod', () => {
  const { calls } = usesOf(source);
  for (const [ns, methods] of Object.entries(READ_ONLY)) {
    for (const m of methods) assert.ok(calls.includes(`${ns}.${m}`), `${ns}.${m} is allowed but never called; take it off the list`);
  }
});

test('the scan itself catches what it is there for', () => {
  const bad = [
    ['a prompt sent', `on('session.start', async ($, e, next) => { $.prompt.send('go'); return next(e) })`, 'prompt.send'],
    ['a prompt filled', `$.prompt.fill('x')`, 'prompt.fill'],
    ['a file written', `await $.fs.write('/a', 'b')`, 'fs.write'],
    ['a command run', `await $.shell.run('rm -rf /')`, 'shell.run'],
    ['a tool run', `await $.tool.call('Bash', {})`, 'tool.call'],
    ['a model asked', `await $.model.ask('x')`, 'model.ask'],
    ['a state write', `$.state.set('k', 1)`, 'state.set'],
    ['a call after a comment mark', `// fine\n$.fs.remove('/a')`, 'fs.remove'],
  ];
  const allowed = new Set(Object.entries(READ_ONLY).flatMap(([ns, ms]) => ms.map(m => `${ns}.${m}`)));
  for (const [name, text, call] of bad) {
    const { calls } = usesOf(text);
    assert.ok(calls.includes(call), `${name}: found`);
    assert.ok(calls.some(c => !allowed.has(c)), `${name}: refused`);
  }
  assert.deepEqual(usesOf(`// $.prompt.send('x')\n/* $.fs.write() */\n$.fs.read('/a')`).calls, ['fs.read'], 'a call named in a comment is not a call');
  for (const [name, text] of [
    ['an alias', `const h = $\nh.prompt.send('x')`],
    ['a computed name', `$['prompt']['send']('x')`],
    ['a namespace handed on', `const p = $.prompt\np.send('x')`],
    ['a handle passed to a function', `export(hand($))`],
    ['a global', `fetch('https://example.invalid')`],
    ['a dynamic import', `await import('node:fs')`],
  ]) {
    assert.ok(usesOf(text).strange.length > 0, `${name}: flagged`);
  }
  assert.deepEqual(usesOf(`async function look($) { return await $.session.surfaces() }\nlook($)\non('x', async ($, e, next) => next(e))`).strange, [], 'the mod\'s own shapes are not flagged');
});

test('the mod registers session.start and ui.render, and nothing else', () => {
  const events = [...code(source).matchAll(/\bon\(\s*(['"`])([^'"`]+)\1/g)].map(m => m[2]);
  assert.deepEqual(events, EVENTS);
  assert.equal([...code(source).matchAll(/\bon\(/g)].length, EVENTS.length, 'every registration names its event as a string');
  assert.match(code(source), /on\('ui\.render',\s*\{\s*component:\s*'AbovePrompt'\s*\}/, 'ui.render only for the line above the prompt');
});

test('the mod\'s only import is the pure half, a relative file inside the plugin that imports nothing itself', () => {
  const imports = [...code(source).matchAll(/^\s*import\s[^;]*?from\s+(['"])([^'"]+)\1/gm)].map(m => m[2]);
  assert.deepEqual(imports, ['../skills/orchestrate/scripts/lib/band-line.mjs']);
  assert.equal(existsSync(join(dirname(MOD), imports[0])), true);
  const lib = code(readFileSync(LINE_LIB, 'utf8'));
  assert.doesNotMatch(lib, /^\s*import\s|\brequire\(|\bimport\(/m, 'band-line.mjs imports nothing, so the mod runs with no Node and validates');
  assert.doesNotMatch(code(source), /node:/, 'no Node module in the mod');
});

test('the mod names the files the hooks write, and the poll is about two seconds', () => {
  assert.ok(source.includes(`/${BAND_REL.replace(/\\/g, '/')}`), 'it reads the file router and persist-check write');
  assert.ok(source.includes(`/${PAUSE_REL.replace(/\\/g, '/')}`), 'and the pause record beside it');
  assert.match(source, /const EVERY_MS = 2000\b/);
});

// ---- hooks/hooks.json ---------------------------------------------------------------
test('hooks/hooks.json names the mod once, under "modules", and the command hooks are where they were', () => {
  const json = JSON.parse(readFileSync(HOOKS_JSON, 'utf8'));
  assert.deepEqual(json.modules, ['./band.mjs'], 'one path, relative to hooks.json (the host takes at most one)');
  assert.equal(existsSync(join(dirname(HOOKS_JSON), json.modules[0])), true);
  assert.ok(json.hooks && typeof json.hooks === 'object' && !Array.isArray(json.hooks), 'the command hooks stay an event map under "hooks"');
});

// ---- CI --------------------------------------------------------------------------------
test('the CI job that validates the plugin installs the Claude Code the bench pins, and no run line starts with npm', () => {
  const ci = readFileSync(join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
  const bench = readFileSync(join(ROOT, '.github', 'workflows', 'bench.yml'), 'utf8');
  const pin = /@anthropic-ai\/claude-code@(\d+\.\d+\.\d+)/;
  assert.ok(pin.test(ci), 'ci.yml installs a pinned Claude Code');
  assert.equal(pin.exec(ci)[1], pin.exec(bench)[1], 'one pin, in both workflows');
  assert.match(ci, /^\s*run: claude plugin validate \.claude-plugin\/plugin\.json\s*$/m);
  for (const l of ci.split(/\r?\n/)) {
    const m = /^\s*(?:-\s*)?run:\s*(.*)$/.exec(l);
    // orchestrate reads a run line that starts with a package manager as the
    // repository's build check (see bench.yml), so the install line starts with cd.
    if (m) assert.doesNotMatch(m[1].trim(), /^(?:npm|pnpm|yarn)\b/, `a run line that starts with a package manager: ${l.trim()}`);
  }
  assert.ok(readFileSync(join(ROOT, 'docs', 'band.md'), 'utf8').includes(pin.exec(ci)[1]), 'docs/band.md names the version CI validates with');
});

// ---- the mod against a fake `$` ----------------------------------------------------------
const NOW = Date.parse('2026-10-03T09:00:00.000Z');
let fresh = 0;
// A new copy of the module each time: its state (the line shown, the timer, what
// it last read) is module-level, as the host's own copy of it would be.
async function load() {
  const mod = await import(`${pathToFileURL(MOD).href}?copy=${++fresh}`);
  const registered = [];
  mod.register((event, a, b) => registered.push(typeof a === 'function' ? { event, opts: null, fn: a } : { event, opts: a, fn: b }));
  return { registered, start: registered.find(r => r.event === 'session.start').fn, render: registered.find(r => r.event === 'ui.render').fn };
}

// A world the fake `$` looks at: files with a modified time and text, a clock,
// the session's own answers. It records every call so a test can say what was
// asked for.
function world({ surfaces = ['terminal'], root = '/work/proj/src', id = 's1', files = {}, dirs = ['/work/proj/.git'] } = {}) {
  const w = {
    surfaces, root, id, now: NOW, files, dirs: new Set(dirs), calls: [], invalidated: 0, timers: [],
    put(path, text, mtime) { w.files[path] = { text, mtime }; },
    drop(path) { delete w.files[path]; },
    reads(path) { return w.calls.filter(c => c[0] === 'read' && (!path || c[1] === path)).length; },
    stats() { return w.calls.filter(c => c[0] === 'stat').length; },
  };
  w.$ = {
    session: { root: async () => w.root, id: async () => w.id, surfaces: async () => w.surfaces },
    fs: {
      exists: async p => w.dirs.has(p) || p in w.files,
      stat: async p => {
        w.calls.push(['stat', p]);
        if (!(p in w.files)) throw Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' });
        return { mtimeMs: w.files[p].mtime };
      },
      read: async p => { w.calls.push(['read', p]); return w.files[p].text; },
    },
    clock: {
      now: async () => w.now,
      every: (ms, fn) => { const t = { ms, fn, cancelled: false, cancel() { this.cancelled = true; } }; w.timers.push(t); return t; },
    },
    ui: {
      invalidate: name => { w.invalidated++; w.lastInvalidated = name; },
      resolve: () => ({ Text: props => ({ Text: props }) }),
    },
  };
  return w;
}
const BAND = '/work/proj/.orchestrator/band.json';
const PAUSE = '/work/proj/.orchestrator/pause.json';
const bandText = (kind, text, session = 's1', at = NOW) => JSON.stringify(bandRecord({ session, kind, text, now: new Date(at) }));
const NEXT = { next: true };
const next = () => NEXT;
const props = (extra = {}) => ({ props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 80, ...extra } });
const tick = async w => { for (const t of [...w.timers]) if (!t.cancelled) await t.fn(); };

test('the mod registers its two events, the render one for the line above the prompt only', async () => {
  const { registered } = await load();
  assert.deepEqual(registered.map(r => r.event), EVENTS);
  assert.equal(registered[0].opts, null);
  assert.deepEqual(registered[1].opts, { component: 'AbovePrompt' });
});

test('where nothing draws (a plain -p run, the bench) it reads nothing and asks for nothing', async () => {
  for (const surfaces of [[], ['sdk']]) {
    const w = world({ surfaces });
    w.put(BAND, bandText('working', 'Fix the date parser'), 1);
    const { start, render } = await load();
    const out = await start(w.$, {}, next);
    assert.equal(out, NEXT, 'the start event passes on');
    assert.equal(w.timers.length, 1, 'one poll is running');
    await tick(w); await tick(w);
    assert.equal(w.calls.length, 0, `${JSON.stringify(surfaces)}: not a file was looked at`);
    assert.equal(w.invalidated, 0);
    assert.equal(await render(w.$, props(), next), NEXT, 'and the render hook leaves the prompt as it is');
  }
});

test('on the terminal and on desktop it reads the record, asks for a redraw once, and draws one dim truncated line', async () => {
  for (const surfaces of [['terminal'], ['desktop'], ['terminal', 'desktop']]) {
    const w = world({ surfaces });
    w.put(BAND, bandText('working', 'Fix the date parser'), 100);
    const { start, render } = await load();
    await start(w.$, {}, next);
    assert.equal(w.invalidated, 1, `${surfaces}: one redraw asked for`);
    assert.equal(w.lastInvalidated, 'ui.render');
    const drawn = await render(w.$, props(), next);
    assert.deepEqual(drawn, { Text: { dimColor: true, wrap: 'truncate-end', children: 'Working on: Fix the date parser' } });
  }
});

test('the record is found at the git root above the session\'s folder, where the hooks write it', async () => {
  const w = world({ root: '/work/proj/src/deep' });
  w.put(BAND, bandText('needs', 'Postgres or SQLite?'), 1);
  const { start } = await load();
  await start(w.$, {}, next);
  assert.deepEqual(w.calls.filter(c => c[0] === 'stat').map(c => c[1]).sort(), [BAND, PAUSE].sort());
  assert.equal(w.reads(BAND), 1);

  // Outside a repository it is the session's own folder, as the hooks resolve it.
  const bare = world({ root: '/loose/folder', dirs: [] });
  bare.put('/loose/folder/.orchestrator/band.json', bandText('working', 'x'), 1);
  const m = await load();
  await m.start(bare.$, {}, next);
  assert.equal(bare.reads('/loose/folder/.orchestrator/band.json'), 1);
});

test('a file is read again only when its modified time moved, and a redraw is asked for only when the line changed', async () => {
  const w = world();
  w.put(BAND, bandText('working', 'Fix the date parser'), 100);
  const { start } = await load();
  await start(w.$, {}, next);
  assert.equal(w.reads(BAND), 1);
  assert.equal(w.invalidated, 1);

  await tick(w); await tick(w); await tick(w);
  assert.equal(w.reads(BAND), 1, 'three polls, nothing changed: the file is statted, not read');
  assert.ok(w.stats() >= 8, 'but it was looked at each time');
  assert.equal(w.invalidated, 1, 'and no redraw was asked for');

  w.put(BAND, bandText('needs', 'Postgres or SQLite?'), 200);
  await tick(w);
  assert.equal(w.reads(BAND), 2);
  assert.equal(w.invalidated, 2, 'the line changed');

  w.put(BAND, bandText('needs', 'Postgres or SQLite?', 's1', NOW + 5000), 300);
  await tick(w);
  assert.equal(w.reads(BAND), 3, 'a newer file is read');
  assert.equal(w.invalidated, 2, 'but the same line is not drawn again');
});

test('a pause shows over a question, and the line returns to the question when the pause is cleared', async () => {
  const w = world();
  w.put(BAND, bandText('needs', 'Postgres or SQLite?'), 1);
  const { start, render } = await load();
  await start(w.$, {}, next);
  assert.equal((await render(w.$, props(), next)).Text.children, 'Needs you: Postgres or SQLite?');

  const pause = { kind: 'usage_limit', error: 'rate_limit', at: new Date(NOW).toISOString(), session: 's1', text: 'Paused for the usage limit; keep-going stays on.' };
  w.put(PAUSE, JSON.stringify(pause), 2);
  await tick(w);
  assert.equal((await render(w.$, props(), next)).Text.children, 'Paused for the usage limit; keep-going stays on.');
  assert.equal(w.invalidated, 2);

  w.put(PAUSE, JSON.stringify({ ...pause, cleared: new Date(NOW + 1000).toISOString(), clearedBy: 'stop' }), 3);
  await tick(w);
  assert.equal((await render(w.$, props(), next)).Text.children, 'Needs you: Postgres or SQLite?');
  assert.equal(w.invalidated, 3);
});

test('nothing to say draws nothing: the prompt area is left to Claude Code', async () => {
  const w = world();
  const { start, render } = await load();
  await start(w.$, {}, next);
  assert.equal(w.invalidated, 0, 'no record, no line, no redraw');
  assert.equal(await render(w.$, props(), next), NEXT);

  w.put(BAND, bandText('idle', ''), 1);
  await tick(w);
  assert.equal(await render(w.$, props(), next), NEXT, 'an idle record is no line');
  assert.equal(w.invalidated, 0);
});

test('a line that was shown and then goes (the record removed, or idle) is cleared with one redraw', async () => {
  const w = world();
  w.put(BAND, bandText('working', 'Fix the date parser'), 1);
  const { start, render } = await load();
  await start(w.$, {}, next);
  assert.equal(w.invalidated, 1);
  w.put(BAND, bandText('idle', ''), 2);
  await tick(w);
  assert.equal(w.invalidated, 2);
  assert.equal(await render(w.$, props(), next), NEXT);
  w.put(BAND, bandText('working', 'Fix the date parser'), 3);
  await tick(w);
  assert.equal(w.invalidated, 3);
  w.drop(BAND);
  await tick(w);
  assert.equal(w.invalidated, 4);
  assert.equal(await render(w.$, props(), next), NEXT);
});

test('while the feedback survey has the spot, the band stands aside', async () => {
  const w = world();
  w.put(BAND, bandText('working', 'Fix the date parser'), 1);
  const { start, render } = await load();
  await start(w.$, {}, next);
  assert.equal(await render(w.$, props({ hasSurvey: true }), next), NEXT);
  assert.equal((await render(w.$, props({ hasSurvey: false }), next)).Text.children, 'Working on: Fix the date parser');
});

test('the line is kept two cells short of the width it is given, and cut with an ellipsis', async () => {
  const w = world();
  w.put(BAND, bandText('working', 'a'.repeat(100)), 1);
  const { start, render } = await load();
  await start(w.$, {}, next);
  const text = (await render(w.$, props({ bodyColumns: 30 }), next)).Text.children;
  assert.equal(text.length, 28);
  assert.ok(text.endsWith('…'));
  assert.equal((await render(w.$, props({ bodyColumns: 200 }), next)).Text.children.length, 'Working on: '.length + 100, 'a wide screen shows the whole clipped text');
  assert.equal((await render(w.$, { props: { hasSurvey: false } }, next)).Text.children.length, 78, 'no width given: 80 less the two');
});

test('a record that carries another session\'s id, or a session id the mod cannot learn, still shows the line', async () => {
  const w = world({ id: 'the-hosts-other-spelling' });
  w.put(BAND, bandText('working', 'Fix the date parser', 'hook-payload-id', NOW - 60000), 1);
  const { start, render } = await load();
  await start(w.$, {}, next);
  assert.equal((await render(w.$, props(), next)).Text.children, `${OTHER_SESSION_TAG}Working on: Fix the date parser`);

  const w2 = world({ id: null });
  w2.put(BAND, bandText('working', 'Fix the date parser', 'hook-payload-id'), 1);
  const m2 = await load();
  await m2.start(w2.$, {}, next);
  assert.equal((await m2.render(w2.$, props(), next)).Text.children, 'Working on: Fix the date parser');

  const w3 = world({ id: 'the-hosts-other-spelling' });
  w3.put(BAND, bandText('working', 'Fix the date parser', 'hook-payload-id', NOW - 3 * 60 * 60 * 1000), 1);
  const m3 = await load();
  await m3.start(w3.$, {}, next);
  assert.equal(await m3.render(w3.$, props(), next), NEXT, 'a mismatched record hours old is not shown');
});

test('the line the mod draws is the line bandLine gives for the same two records', async () => {
  const band = bandRecord({ session: 's1', kind: 'needs', text: 'Which one do you want?', now: new Date(NOW) });
  const w = world();
  w.put(BAND, JSON.stringify(band), 1);
  const { start, render } = await load();
  await start(w.$, {}, next);
  assert.equal((await render(w.$, props(), next)).Text.children, bandLine({ band, session: 's1', now: NOW }));
});

test('a second session.start drops the first poll instead of stacking another', async () => {
  const w = world();
  const { start } = await load();
  await start(w.$, {}, next);
  await start(w.$, {}, next);
  assert.equal(w.timers.length, 2);
  assert.equal(w.timers[0].cancelled, true);
  assert.equal(w.timers[1].cancelled, false);
  assert.equal(w.timers[1].ms, 2000);
});

test('a file that cannot be read, or a host that errors on a look, is a quiet skip and the poll goes on', async () => {
  const w = world();
  w.put(BAND, 'not json at all', 1);
  const { start, render } = await load();
  assert.equal(await start(w.$, {}, next), NEXT, 'the start event is never failed');
  assert.equal(await render(w.$, props(), next), NEXT);

  const broken = world();
  broken.$.session.surfaces = async () => { throw new Error('host went away'); };
  const m = await load();
  assert.equal(await m.start(broken.$, {}, next), NEXT, 'a throw in the first look does not fail the start');
  await tick(broken);
  assert.equal(await m.render(broken.$, props(), next), NEXT);

  const unreadable = world();
  unreadable.put(BAND, bandText('working', 'x'), 1);
  unreadable.$.fs.read = async () => { throw new Error('EACCES'); };
  const m2 = await load();
  await m2.start(unreadable.$, {}, next);
  assert.equal(await m2.render(unreadable.$, props(), next), NEXT);
});
