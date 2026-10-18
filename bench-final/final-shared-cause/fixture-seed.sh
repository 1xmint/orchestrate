#!/usr/bin/env bash
# Seeds a small spending tracker. Every command turns the amount text on a
# line into a number through parseMoney in src/money.js.
set -euo pipefail

git init -q
git config user.email "eval@example.com"
git config user.name "eval"
mkdir -p src test data

cat > package.json <<'EOP'
{
  "name": "spend-tracker",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": { "test": "node --test" }
}
EOP

cat > README.md <<'EOP'
# spend-tracker

Reads a file with one purchase per line, written `label;amount`, and prints
a figure.

    node src/cli.js total data/march.txt     adds up everything spent
    node src/cli.js biggest data/march.txt   the largest single purchase
    node src/cli.js average data/march.txt   the average purchase

`data/february.txt` is a quiet month. `data/march.txt` has the big purchases.
EOP

cat > src/money.js <<'EOP'
// Turns amount text such as "$12.50" into a number.
export function parseMoney(text) {
  return parseFloat(text.trim().replace('$', ''));
}
EOP

cat > src/lines.js <<'EOP'
import { parseMoney } from './money.js';

// Returns the amounts on every non-blank line of a file's text.
export function amounts(text) {
  return text
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => parseMoney(l.split(';')[1]));
}
EOP

cat > src/total.js <<'EOP'
import { amounts } from './lines.js';

export function total(text) {
  return amounts(text).reduce((a, b) => a + b, 0);
}
EOP

cat > src/biggest.js <<'EOP'
import { amounts } from './lines.js';

export function biggest(text) {
  return Math.max(...amounts(text));
}
EOP

cat > src/average.js <<'EOP'
import { amounts } from './lines.js';

export function average(text) {
  const all = amounts(text);
  return all.reduce((a, b) => a + b, 0) / all.length;
}
EOP

cat > src/cli.js <<'EOP'
import { readFileSync } from 'node:fs';
import { total } from './total.js';
import { biggest } from './biggest.js';
import { average } from './average.js';

const [cmd, file] = process.argv.slice(2);
const text = file ? readFileSync(file, 'utf8') : '';

if (cmd === 'total') console.log(total(text).toFixed(2));
else if (cmd === 'biggest') console.log(biggest(text).toFixed(2));
else if (cmd === 'average') console.log(average(text).toFixed(2));
else console.log('usage: total|biggest|average <file>');
EOP

printf 'rent;$900.00\nfood;$120.50\nbus pass;$45\n' > data/february.txt
printf 'rent;$900.00\nlaptop;$1,250.50\nfood;$130.25\nflights;$2,310.00\n' > data/march.txt

cat > test/total.test.js <<'EOP'
import test from 'node:test';
import assert from 'node:assert';
import { total } from '../src/total.js';

test('adds up small purchases', () => {
  assert.strictEqual(total('rent;$900.00\nfood;$120.50\n'), 1020.5);
});
EOP

cat > test/biggest.test.js <<'EOP'
import test from 'node:test';
import assert from 'node:assert';
import { biggest } from '../src/biggest.js';

test('finds the biggest small purchase', () => {
  assert.strictEqual(biggest('rent;$900.00\nfood;$120.50\n'), 900);
});
EOP

cat > test/average.test.js <<'EOP'
import test from 'node:test';
import assert from 'node:assert';
import { average } from '../src/average.js';

test('averages small purchases', () => {
  assert.strictEqual(average('rent;$900.00\nfood;$100.00\n'), 500);
});
EOP

git add -A
git commit -q -m "start: spend tracker"
