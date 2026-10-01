#!/usr/bin/env bash
# Seeds a monthly sales report whose crash is reported in report.js but is
# caused in parser.js: split('\n').slice(1, -1) is meant to drop the header
# and a trailing blank line, but data/sales.csv has no trailing newline, so
# the last line (the only 2026-09 row) is dropped and report.js then throws
# TypeError reading 'total' on the missing September bucket.
set -euo pipefail

git init -q
git config user.email "eval@example.com"
git config user.name "eval"
mkdir -p src data test

cat > package.json <<'EOP'
{
  "name": "monthly-report",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "start": "node src/report.js",
    "test": "node --test"
  }
}
EOP

# printf, not echo: no trailing newline on the last line.
printf 'date,amount\n2026-07-03,40\n2026-07-19,25\n2026-08-02,60\n2026-08-21,35\n2026-09-14,120' > data/sales.csv

cat > src/config.js <<'EOP'
module.exports = { reportMonth: '2026-09' };
EOP

cat > src/parser.js <<'EOP'
const fs = require('fs');

// Reads the sales CSV: drops the header line and the trailing blank line.
function readSales(file) {
  const text = fs.readFileSync(file, 'utf8');
  return text
    .split('\n')
    .slice(1, -1)
    .map((line) => {
      const [date, amount] = line.split(',');
      return { date, amount: Number(amount) };
    });
}

module.exports = { readSales };
EOP

cat > src/report.js <<'EOP'
const path = require('path');
const config = require('./config');
const { readSales } = require('./parser');

function monthlyTotals(sales) {
  const byMonth = {};
  for (const s of sales) {
    const month = s.date.slice(0, 7);
    byMonth[month] = byMonth[month] || { total: 0, count: 0 };
    byMonth[month].total += s.amount;
    byMonth[month].count += 1;
  }
  return byMonth;
}

function buildReport(file) {
  const byMonth = monthlyTotals(readSales(file));
  return { month: config.reportMonth, total: byMonth[config.reportMonth].total };
}

if (require.main === module) {
  const r = buildReport(path.join(__dirname, '..', 'data', 'sales.csv'));
  console.log(`${r.month}: ${r.total}`);
}

module.exports = { buildReport, monthlyTotals };
EOP

cat > test/report.test.js <<'EOP'
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { buildReport } = require('../src/report');

test('September total is 120', () => {
  const r = buildReport(path.join(__dirname, '..', 'data', 'sales.csv'));
  assert.strictEqual(r.month, '2026-09');
  assert.strictEqual(r.total, 120);
});
EOP

# Prove the seed fails as designed before committing.
if out=$(node --test 2>&1); then
  echo "seed error: tests should fail" >&2; exit 1
fi
echo "$out" | grep -q "Cannot read properties of undefined (reading 'total')" \
  || { echo "seed error: wrong failure" >&2; echo "$out" >&2; exit 1; }

git add -A
git commit -q -m "seed: monthly report, September report crashes"
