// lib/brief.test.mjs — the project's own "What this is for" section, tested
// directly against the pure functions rather than through a spawned router
// process (router.test.mjs keeps those).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { BRIEF_CAP, briefState, briefNote } from './brief.mjs';

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

test('a missing brief section prints one fact line, once', () => {
  const repo = makeBriefRepo({ file: 'CLAUDE.md', body: '# Just some notes\n\nNo section here.\n' });
  const ctx = { repoRoot: repo, cwd: repo, run: null };
  const state = {};
  const first = briefNote(ctx, state);
  assert.match(first, /\[orchestrate · brief\] no "What this is for" section between/);
  assert.match(first, /Template: .*assets[\\/]BRIEF\.md/);
  assert.equal(briefNote(ctx, state), '', 'said once per session');
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
