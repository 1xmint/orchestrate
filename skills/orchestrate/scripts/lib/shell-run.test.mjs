// lib/shell-run.test.mjs — telling what a shell line runs from the words it
// only contains. The guard-level replays are in ../live-misfires.test.mjs.
//   node --test skills/orchestrate/scripts/lib/shell-run.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { segments, commandOf, splitHeredocs, isTextToFile, runnable, runsPayment, withoutFileText } from './shell-run.mjs';

test('segments splits on unquoted separators and keeps 2>&1', () => {
  assert.deepEqual(segments(`a "x; y" && b | c; d 2>&1`), ['a "x; y"', 'b', 'c', 'd 2>&1']);
  assert.deepEqual(segments(`echo 'a|b' || f`), [`echo 'a|b'`, 'f']);
});

test('commandOf peels assignments and wrappers', () => {
  assert.deepEqual(commandOf('FOO=1 sudo -E env BAR=2 npx stripe x'), ['stripe', 'x']);
});

test('splitHeredocs keeps a body only when a shell or language reads it', () => {
  assert.deepEqual(splitHeredocs(`cat > f <<'EOF'\nstripe charges create\nEOF`).code, []);
  assert.deepEqual(splitHeredocs(`bash <<EOF\nls\nEOF`).code, [{ kind: 'shell', text: 'ls' }]);
  assert.deepEqual(splitHeredocs(`python3 - <<-"PY"\nprint(1)\n\tPY`).code, [{ kind: 'lang', text: 'print(1)' }]);
});

test('isTextToFile: echo/printf/cat into a file, tee always; plain echo is not', () => {
  assert.equal(isTextToFile('echo hi > a.txt'), true);
  assert.equal(isTextToFile('tee a.txt'), true);
  assert.equal(isTextToFile('echo hi'), false);
  assert.equal(isTextToFile('cat a.txt'), false);
});

test('runnable reaches into -c strings, $( ) and backticks', () => {
  const r = runnable('bash -c "ls; whoami" && echo `date` $(pwd)');
  for (const s of ['ls', 'whoami', 'date', 'pwd']) assert.ok(r.shell.includes(s), s);
  assert.deepEqual(runnable(`node -e "console.log(1)"`).lang, ['console.log(1)']);
});

test('runsPayment: a payment SDK in run code, a fetch to a payment host', () => {
  assert.equal(runsPayment(`python3 -c "import stripe; stripe.Charge.create()"`), true);
  assert.equal(runsPayment(`python3 - <<'EOF'\nimport stripe\nEOF`), true);
  assert.equal(runsPayment(`node -e "fetch('https://api.stripe.com/v1/refunds')"`), true);
  assert.equal(runsPayment('curl https://stripe.com/docs'), false, 'the docs site is not the API');
});

test('withoutFileText drops prose bound for files but keeps what runs', () => {
  assert.equal(withoutFileText(`echo "before merge" > a.md`), '');
  assert.match(withoutFileText(`echo "before merge" > a.md && gh pr merge 3`), /gh pr merge 3/);
});
