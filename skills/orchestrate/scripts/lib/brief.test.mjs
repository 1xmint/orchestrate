// lib/brief.test.mjs — the project's own "What this is for" section, tested
// directly against the pure functions rather than through a spawned router
// process (router.test.mjs keeps those).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { BRIEF_CAP, briefState, briefNote } from './brief.mjs';

function tempStore() {
  return join(mkdtempSync(join(tmpdir(), 'orch-brief-store-')), 'brief-missing.json');
}

function makeBriefRepo({ file = 'CLAUDE.md', body = '## What this is for\n\nMakes toast, for people in a hurry.\n\nDeciding documents (these win when the code and the intent disagree):\n- docs/roadmap.md — where we are\n' } = {}) {
  const repo = mkdtempSync(join(tmpdir(), 'orch-brief-repo-'));
  mkdirSync(join(repo, '.git'), { recursive: true });
  if (file) {
    const p = join(repo, file);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, body);
  }
  return repo;
}

test('lib/brief.mjs exports exactly the names this concern owns', async () => {
  const mod = await import('./brief.mjs');
  assert.deepEqual(Object.keys(mod).sort(), ['BRIEF_CAP', 'briefNote', 'briefState'].sort());
});

test('a missing brief section prints one fact line, once, with no file paths', () => {
  const repo = makeBriefRepo({ file: 'CLAUDE.md', body: '# Just some notes\n\nNo section here.\n' });
  const ctx = { repoRoot: repo, cwd: repo, run: null };
  const state = {};
  const store = tempStore();
  const first = briefNote(ctx, state, { store });
  assert.match(first, /no "What this is for" section/);
  assert.doesNotMatch(first, /[\\/]/, 'no path segments of any kind');
  assert.doesNotMatch(first, /Template:/);
  assert.equal(briefNote(ctx, state, { store }), '', 'said once per session');
});

test('a missing brief section is said once per project across sessions, via the store', () => {
  const repo = makeBriefRepo({ file: 'CLAUDE.md', body: '# Just some notes\n\nNo section here.\n' });
  const ctx = { repoRoot: repo, cwd: repo, run: null };
  const store = tempStore();
  const first = briefNote(ctx, {}, { store });
  assert.match(first, /no "What this is for" section/);
  // A fresh state object (a new session) but the same store and same root:
  // already told, so nothing prints.
  assert.equal(briefNote(ctx, {}, { store }), '', 'not repeated for the same project in a later session');
});

test('a different project root gets the line even with a shared store', () => {
  const repoA = makeBriefRepo({ file: 'CLAUDE.md', body: '# Notes\n' });
  const repoB = makeBriefRepo({ file: 'CLAUDE.md', body: '# Notes\n' });
  const store = tempStore();
  briefNote({ repoRoot: repoA, cwd: repoA, run: null }, {}, { store });
  const second = briefNote({ repoRoot: repoB, cwd: repoB, run: null }, {}, { store });
  assert.match(second, /no "What this is for" section/, 'a different root is not yet told');
});

test('a store that cannot be read or written does not throw, and still prints once per session', () => {
  const repo = makeBriefRepo({ file: 'CLAUDE.md', body: '# Notes\n' });
  const ctx = { repoRoot: repo, cwd: repo, run: null };
  const badDir = mkdtempSync(join(tmpdir(), 'orch-brief-badstore-'));
  const store = join(badDir, 'no-such-subdir', 'brief-missing.json');
  try { chmodSync(badDir, 0o400); } catch {}
  const state = {};
  let first;
  assert.doesNotThrow(() => { first = briefNote(ctx, state, { store }); });
  assert.match(first, /no "What this is for" section/);
  assert.equal(briefNote(ctx, state, { store }), '', 'still once per session');
  try { chmodSync(badDir, 0o700); } catch {}
});

test('a brief the host loads prints nothing', () => {
  const repo = makeBriefRepo();
  const ctx = { repoRoot: repo, cwd: repo, run: null };
  const state = {};
  assert.equal(briefState(ctx, state).kind, 'kept');
  assert.equal(briefNote(ctx, state), '');
});

test('a brief the host does not keep in view is printed once per epoch and again after a compaction', () => {
  const repo = makeBriefRepo();
  // No repoRoot: the session was started above the project, and the working
  // project is known only from touched paths (context-check.mjs's state.work).
  const ctx = { repoRoot: null, cwd: null, run: null };
  const state = { work: { root: repo, dir: repo, counts: {} } };
  const b = briefState(ctx, state);
  assert.equal(b.kind, 'other');
  const first = briefNote(ctx, state);
  assert.match(first, /\[orchestrate · brief\] from .*CLAUDE\.md/);
  assert.match(first, /Makes toast/);
  assert.equal(briefNote(ctx, state), '', 'once per epoch');
  // A compaction is a new epoch: the router forces it, whatever was said before.
  const again = briefNote(ctx, state, { force: true });
  assert.match(again, /Makes toast/);
});

test('the brief section is found in AGENTS.md', () => {
  const repo = makeBriefRepo({ file: 'AGENTS.md', body: '## What this is for\n\nRuns the payroll for one small shop.\n' });
  const ctx = { repoRoot: repo, cwd: repo, run: null };
  const state = {};
  const b = briefState(ctx, state);
  assert.match(b.file, /AGENTS\.md$/);
  assert.match(b.text, /Runs the payroll/);
  // A bare AGENTS.md nobody pulls in with @AGENTS.md is not kept in view.
  assert.equal(b.kind, 'other');
});

test('BRIEF_CAP still caps the excerpt via the shared sectionExcerpt', async () => {
  const { sectionExcerpt } = await import('./resume.mjs');
  const md = `## What this is for\n\n${'x'.repeat(BRIEF_CAP + 200)}\n`;
  const ex = sectionExcerpt(md, [{ pattern: /(?:^|\n)##\s+What this is for\b[ \t]*\n([\s\S]*?)(?:\n##\s|\s*$)/i }], BRIEF_CAP, { intro: false });
  assert.ok(ex.length <= BRIEF_CAP, `${ex.length} <= ${BRIEF_CAP}`);
  assert.match(ex, /^x+\.\.\.$/);
});
