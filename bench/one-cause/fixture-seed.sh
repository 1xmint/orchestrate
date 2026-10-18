#!/usr/bin/env bash
# Seeds a small hours-report app. Every report reads its file through
# parseRows in src/parse.js.
set -euo pipefail

git init -q
git config user.email "eval@example.com"
git config user.name "eval"
mkdir -p src test data

cat > package.json <<'EOP'
{
  "name": "hours-report",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": { "test": "node --test" }
}
EOP

cat > README.md <<'EOP'
# hours-report

Reads a CSV with the columns `name,hours,status` and prints reports.

    node src/cli.js names data/team.csv     lists the people
    node src/cli.js total data/team.csv     adds up the hours
    node src/cli.js open data/team.csv      counts rows whose status is "open"

`data/team.csv` was saved on a Mac. `data/windows.csv` came from the Windows
machine in the front office.
EOP

cat > src/parse.js <<'EOP'
// Turns CSV text into a list of rows. The first line holds the column names;
// each row is an object keyed by those names.
export function parseRows(text) {
  const lines = text.split('\n');
  const header = lines[0].split(',');
  return lines.slice(1).map((line) => {
    const cells = line.split(',');
    const row = {};
    header.forEach((name, i) => { row[name] = cells[i]; });
    return row;
  });
}
EOP

cat > src/names.js <<'EOP'
import { parseRows } from './parse.js';

export function listNames(text) {
  return parseRows(text).map((r) => r.name);
}
EOP

cat > src/total.js <<'EOP'
import { parseRows } from './parse.js';

export function totalHours(text) {
  return parseRows(text).reduce((sum, r) => sum + Number(r.hours), 0);
}
EOP

cat > src/status.js <<'EOP'
import { parseRows } from './parse.js';

export function countOpen(text) {
  return parseRows(text).filter((r) => r.status === 'open').length;
}
EOP

cat > src/cli.js <<'EOP'
import { readFileSync } from 'node:fs';
import { listNames } from './names.js';
import { totalHours } from './total.js';
import { countOpen } from './status.js';

const [cmd, file] = process.argv.slice(2);
const text = file ? readFileSync(file, 'utf8') : '';

if (cmd === 'names') console.log(listNames(text).join('\n'));
else if (cmd === 'total') console.log(totalHours(text));
else if (cmd === 'open') console.log(countOpen(text));
else console.log('usage: names|total|open <file.csv>');
EOP

printf 'name,hours,status\nAnn,5,open\nBo,3,done\nCy,4,open' > data/team.csv
printf 'name,hours,status\r\nDee,6,open\r\nEli,2,done\r\nFay,7,open\r\n' > data/windows.csv

cat > test/names.test.js <<'EOP'
import test from 'node:test';
import assert from 'node:assert';
import { listNames } from '../src/names.js';

test('lists names', () => {
  assert.deepStrictEqual(listNames('name,hours,status\nAnn,5,open\nBo,3,done'), ['Ann', 'Bo']);
});
EOP

cat > test/total.test.js <<'EOP'
import test from 'node:test';
import assert from 'node:assert';
import { totalHours } from '../src/total.js';

test('adds hours', () => {
  assert.strictEqual(totalHours('name,hours,status\nAnn,5,open\nBo,3,done'), 8);
});
EOP

cat > test/status.test.js <<'EOP'
import test from 'node:test';
import assert from 'node:assert';
import { countOpen } from '../src/status.js';

test('counts open rows', () => {
  assert.strictEqual(countOpen('name,hours,status\nAnn,5,open\nBo,3,done\nCy,4,open'), 2);
});
EOP

git add -A
git commit -q -m "start: hours report"
