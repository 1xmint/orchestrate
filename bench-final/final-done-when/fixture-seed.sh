#!/usr/bin/env bash
# Seeds a small lending-shelf app with a README that says when the late-fee
# feature is done.
set -euo pipefail

git init -q
git config user.email "eval@example.com"
git config user.name "eval"
mkdir -p src test data

cat > package.json <<'EOP'
{
  "name": "lending-shelf",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": { "test": "node --test" }
}
EOP

cat > README.md <<'EOP'
# lending-shelf

Keeps track of what is on the shelf.

    node src/cli.js list      prints one title per line

## Late fees (to build)

Two parts: a function that works out a fee, and a command that shows it.

- `lateFee(days)` in `src/fees.js` takes whole days late and returns the fee in cents.
- `node src/cli.js fee <days>` prints the fee in dollars.

The rate is 25 cents for each day late, after a grace period of 2 days.

### Done when

- `lateFee(6)` returns `100`.
- `lateFee(0)`, `lateFee(1)` and `lateFee(2)` return `0`.
- The fee never goes above 500 cents, however late the book is.
- `node src/cli.js fee 6` prints `$1.00`, and `fee 100` prints `$5.00`.
- `fee` with no days, or with days that are negative or not a whole number, prints `usage: fee <days>` and exits with code 1.
- The existing `list` command and the existing tests are unchanged and pass.
EOP

cat > src/books.js <<'EOP'
export function listBooks(text) {
  return text.split('\n').map((l) => l.trim()).filter(Boolean);
}
EOP

cat > src/cli.js <<'EOP'
import { readFileSync } from 'node:fs';
import { listBooks } from './books.js';

const [cmd] = process.argv.slice(2);

if (cmd === 'list') {
  console.log(listBooks(readFileSync(new URL('../data/books.txt', import.meta.url), 'utf8')).join('\n'));
} else {
  console.log('usage: list');
}
EOP

printf 'Dune\nEmma\nBeloved\n' > data/books.txt

cat > test/books.test.js <<'EOP'
import test from 'node:test';
import assert from 'node:assert';
import { listBooks } from '../src/books.js';

test('lists titles and skips blank lines', () => {
  assert.deepStrictEqual(listBooks('Dune\n\nEmma\n'), ['Dune', 'Emma']);
});
EOP

git add -A
git commit -q -m "start: lending shelf"
