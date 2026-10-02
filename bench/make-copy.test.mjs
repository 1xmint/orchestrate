import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectFiles } from './make-copy.mjs';

test('selectFiles keeps plugin files and bench folders, never bench-hidden or .git', () => {
  const plugin = ['.claude-plugin/plugin.json', 'skills/orchestrate/SKILL.md', 'hooks/hooks.json', 'docs/x.md', 'evals/a.mjs', '.git/config', 'bench-hidden/c/must.json', 'skills/node_modules/x.js', 'LICENSE'];
  const bench = ['bench/RULE.md', 'bench-final/c/prompt.md', 'bench-pilot/env-names/prompt.md', 'bench-hidden/c/a.test.mjs', 'bench/.git/x', 'skills/other.md'];
  const out = selectFiles(plugin, bench);
  assert.deepEqual(out, ['.claude-plugin/plugin.json', 'LICENSE', 'bench-final/c/prompt.md', 'bench-pilot/env-names/prompt.md', 'bench/RULE.md', 'hooks/hooks.json', 'skills/orchestrate/SKILL.md']);
  assert.ok(!out.some(p => p.includes('bench-hidden') || p.includes('.git/')));
});

test('selectFiles takes bench paths only from the bench list and handles backslashes', () => {
  const out = selectFiles(['bench/old.md', 'skills\\a.md'], ['bench\\new.md']);
  assert.deepEqual(out, ['bench/new.md', 'skills/a.md']);
});

test('makeCopy: branch takes the working tree, any other arm is a git ref taken through git archive', async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join, dirname } = await import('node:path');
  const { spawnSync } = await import('node:child_process');
  const { makeCopy } = await import('./make-copy.mjs');
  const repo = mkdtempSync(join(tmpdir(), 'mc-repo-'));
  const outs = mkdtempSync(join(tmpdir(), 'mc-out-'));
  const run = (...a) => { const r = spawnSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); };
  const put = (p, t) => { mkdirSync(dirname(join(repo, p)), { recursive: true }); writeFileSync(join(repo, p), t); };
  try {
    run('init', '-q');
    put('skills/a/SKILL.md', 'old'); put('bench/RULE.md', 'oldrule'); put('docs/x.md', 'x');
    run('add', '-A'); run('commit', '-q', '-m', 'one'); run('tag', 'v0.0.1');
    put('skills/a/SKILL.md', 'new'); put('bench/RULE.md', 'newrule'); put('bench-hidden/c/t.mjs', 'secret');
    const b = join(outs, 'b'), t = join(outs, 't');
    makeCopy({ arm: 'branch', out: b, repo });
    makeCopy({ arm: 'v0.0.1', out: t, repo });
    assert.equal(readFileSync(join(b, 'skills/a/SKILL.md'), 'utf8'), 'new');
    assert.equal(readFileSync(join(t, 'skills/a/SKILL.md'), 'utf8'), 'old');
    assert.equal(readFileSync(join(t, 'bench/RULE.md'), 'utf8'), 'newrule');
    for (const d of [b, t]) { assert.ok(!existsSync(join(d, 'bench-hidden'))); assert.ok(!existsSync(join(d, 'docs'))); }
    assert.throws(() => makeCopy({ arm: 'no-such-ref', out: join(outs, 'n'), repo }), /git archive/);
  } finally { rmSync(repo, { recursive: true, force: true }); rmSync(outs, { recursive: true, force: true }); }
});

test('makeCopy: a branch that exists only as origin/<name> in a clone is found by its bare name', async () => {
  // The bench runner's checkout makes a local branch only for the ref it
  // checks out, so the arm "phase/x" must reach origin/phase/x.
  const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join, dirname } = await import('node:path');
  const { spawnSync } = await import('node:child_process');
  const { makeCopy, resolveArm } = await import('./make-copy.mjs');
  const base = mkdtempSync(join(tmpdir(), 'mc-origin-'));
  const up = join(base, 'up'), clone = join(base, 'clone');
  const git = (dir, ...a) => { const r = spawnSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); };
  const put = (p, t) => { mkdirSync(dirname(join(up, p)), { recursive: true }); writeFileSync(join(up, p), t); };
  try {
    mkdirSync(up); git(up, 'init', '-q');
    put('skills/a/SKILL.md', 'main'); put('bench/RULE.md', 'rule');
    git(up, 'add', '-A'); git(up, 'commit', '-q', '-m', 'one');
    git(up, 'switch', '-q', '-c', 'phase/x'); put('skills/a/SKILL.md', 'proposed');
    git(up, 'commit', '-q', '-am', 'two'); git(up, 'switch', '-q', '-');
    git(base, 'clone', '-q', up, clone);
    assert.equal(resolveArm(clone, 'phase/x'), 'origin/phase/x');
    assert.equal(resolveArm(up, 'phase/x'), 'phase/x');
    assert.equal(resolveArm(clone, 'no-such-ref'), 'no-such-ref');
    makeCopy({ arm: 'phase/x', out: join(base, 'out'), repo: clone });
    assert.equal(readFileSync(join(base, 'out', 'skills/a/SKILL.md'), 'utf8'), 'proposed');
  } finally { rmSync(base, { recursive: true, force: true }); }
});
