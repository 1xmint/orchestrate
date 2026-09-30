import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileChange, isProsePath } from './file-change.mjs';

const sh = command => fileChange('Bash', { command });

test('edit tools change their file_path, notebook_path or path', () => {
  assert.deepEqual(fileChange('Edit', { file_path: 'a.ts' }), { changes: true, paths: ['a.ts'], exact: true });
  assert.deepEqual(fileChange('NotebookEdit', { notebook_path: 'n.ipynb' }).paths, ['n.ipynb']);
  assert.equal(fileChange('Read', { file_path: 'a.ts' }).changes, false);
  assert.equal(fileChange('Agent', {}).changes, false);
});

test('shell writes are found and name their files where the command does', () => {
  assert.deepEqual(sh('sed -i s/a/b/ src/auth.ts').paths, ['src/auth.ts']);
  assert.deepEqual(sh("sed -i -e 's/a/b/' -e 's/c/d/' x.ts y.ts").paths, ['x.ts', 'y.ts']);
  assert.deepEqual(sh('perl -pi -e "s/a/b/" lib/pay.js').paths, ['lib/pay.js']);
  assert.deepEqual(sh("cat > f.js <<'EOF'\nconsole.log(1)\nEOF").paths, ['f.js']);
  assert.deepEqual(sh('echo x >> notes.txt').paths, ['notes.txt']);
  assert.deepEqual(sh('printf a | tee -a out.log other.log').paths, ['out.log', 'other.log']);
  assert.deepEqual(sh('mv a.ts b.ts && rm old.ts').paths, ['a.ts', 'b.ts', 'old.ts']);
  assert.deepEqual(sh('git checkout -- src/a.ts').paths, ['src/a.ts']);
  assert.deepEqual(fileChange('PowerShell', { command: "Set-Content -Path C:\\r\\a.md -Value 'x'" }).paths, ['C:\\r\\a.md']);
  assert.deepEqual(fileChange('PowerShell', { command: "'x' | Out-File a.txt" }).paths, ['a.txt']);
});

test('a command that writes but does not say where still counts, without exact paths', () => {
  for (const c of ['node -e "require(\'fs\').writeFileSync(\'a\',\'b\')"', 'git apply fix.patch', 'find . -name x -delete', 'make build', 'node scripts/package.mjs']) {
    const r = sh(c);
    assert.equal(r.changes, true, c);
    assert.equal(r.exact, false, c);
  }
});

test('clearly read-only commands do not count', () => {
  for (const c of [
    'grep -rn payment src', 'rg token', 'cat a.ts | head -5', 'ls -la', 'find . -name "*.ts"', 'git status', 'git diff HEAD~1', 'git log --oneline',
    'git show HEAD', 'git branch', 'git commit -m "fix auth"', 'git push', 'node --test skills/x.test.mjs', 'npm test', 'cd src && grep -n a b.ts',
    'echo "a > b"', 'ls 2>/dev/null', 'node --test x.test.mjs 2>&1 | grep FAIL', 'cat <<EOF\nrm -rf x\nEOF', 'bash -c "grep a b"', 'Get-Content a.md',
  ]) assert.equal(sh(c).changes, false, c);
  assert.equal(fileChange('PowerShell', { command: 'Get-ChildItem | Select-String auth' }).changes, false);
});

test('git commands that touch the working tree count', () => {
  for (const c of ['git checkout main', 'git restore a.ts', 'git reset --hard', 'git stash', 'git branch -D x', 'git clean -fd', 'git pull']) assert.equal(sh(c).changes, true, c);
  assert.equal(sh('git stash list').changes, false);
});

test('isProsePath goes by extension only', () => {
  for (const p of ['a.md', 'x/B.MDX', 'notes.txt', 'r.rst']) assert.equal(isProsePath(p), true, p);
  for (const p of ['docs/a.ts', 'README', 'docs/pricing/table.json', 'a.md.bak']) assert.equal(isProsePath(p), false, p);
});

test('text is the source of only the pieces that write, with a heredoc body kept', () => {
  const r = sh('git checkout -q main && git pull -q && grep -n -E "price|PRICE" file');
  assert.equal(r.changes, true);
  assert.doesNotMatch(r.text, /price/i);
  assert.match(r.text, /git pull/);
  const h = sh('cat > f.js <<EOF\nconst payments = 1;\nEOF\ngrep token x');
  assert.match(h.text, /payments/);
  assert.doesNotMatch(h.text, /token/);
});

test('shell keywords are not commands: a loop of read-only calls is not a change', () => {
  assert.equal(sh('for p in 1 2; do gh pr checks $p; done').changes, false);
  assert.equal(sh('if grep -q a b; then echo yes; else echo no; fi').changes, false);
  assert.equal(sh('for f in a b; do sed -i s/x/y/ $f; done').changes, true);
});

test('gh changes local files only for pr checkout, repo clone, run download, release download', () => {
  for (const c of ['gh pr checkout 5', 'gh repo clone a/b', 'gh run download 1', 'gh release download v1']) {
    const r = sh(c);
    assert.equal(r.changes, true, c);
    assert.equal(r.exact, false, c);
  }
  for (const c of ['gh pr create --fill', 'gh pr edit 3 --body x', 'gh api repos/a/b', 'gh pr view 2']) assert.equal(sh(c).changes, false, c);
});

test('a read-only inline node script is no change; one that writes still is', () => {
  assert.equal(sh("node -e 'const t=require(\"fs\").readFileSync(\"a\",\"utf8\"); console.log(t.match(/x/))'").changes, false);
  assert.equal(sh("node - a <<'EOT'\nconsole.log(1)\nEOT").changes, false);
  assert.equal(sh("node -e 'require(\"fs\").writeFileSync(\"a\",\"b\")'").changes, true);
  assert.equal(sh("node - a <<'EOT'\nfs.writeFileSync(f, s)\nEOT").changes, true);
});

test('a command substitution is read as commands of its own', () => {
  assert.equal(sh('F=a.txt; n=$(grep -n -i billing "$F"); sed -n 1,5p "$F"').changes, false);
  assert.equal(sh('n=$(sed -i s/a/b/ f); echo $n').changes, true);
  assert.equal(sh('echo `rm -f x`').changes, true);
});
