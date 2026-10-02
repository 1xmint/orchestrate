#!/usr/bin/env bash
# Seeds a small word-count CLI. The visible tests pass already; the README's
# "Done when" list asks for more than they check.
set -euo pipefail

git init -q
git config user.email "eval@example.com"
git config user.name "eval"
mkdir -p src test

cat > package.json <<'EOP'
{
  "name": "notecount",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": { "test": "node --test" }
}
EOP

cat > README.md <<'EOP'
# notecount

Counts the lines and words in a text file.

    node src/cli.js notes.txt

prints

    lines: 3
    words: 12

## Done when

- `node src/cli.js <file>` prints `lines: N` and `words: N`, one per line.
- `node src/cli.js --json <file>` prints one line of JSON, `{"lines":N,"words":N}`, and nothing else.
- Bad input (no file given, or a file that does not exist) prints a short message to stderr, prints nothing to stdout, and exits with code 2.
- `npm test` passes.
EOP

cat > src/count.js <<'EOP'
// Counts lines and words in a piece of text. A trailing newline does not add a line.
export function count(text) {
  const lines = text === '' ? 0 : text.replace(/\n$/, '').split('\n').length;
  const words = text.split(/\s+/).filter(Boolean).length;
  return { lines, words };
}
EOP

cat > src/cli.js <<'EOP'
import { readFileSync } from 'node:fs';
import { count } from './count.js';

const file = process.argv[2];
const { lines, words } = count(readFileSync(file, 'utf8'));
console.log(`lines: ${lines}`);
console.log(`words: ${words}`);
EOP

cat > test/count.test.js <<'EOP'
import test from 'node:test';
import assert from 'node:assert';
import { count } from '../src/count.js';

test('counts lines and words', () => {
  assert.deepStrictEqual(count('one two\nthree\n'), { lines: 2, words: 3 });
});

test('empty text has nothing', () => {
  assert.deepStrictEqual(count(''), { lines: 0, words: 0 });
});
EOP

git add -A
git commit -q -m "start: word counter"
