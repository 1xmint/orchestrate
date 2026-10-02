#!/usr/bin/env node
const fs = require('fs');
const text = fs.readFileSync(process.argv[3] || 0, 'utf8');
const cmd = process.argv[2];
if (cmd === 'wordcount') {
  console.log(text.split(' ').filter(Boolean).length);
} else if (cmd === 'csv-to-json') {
  const [head, ...rest] = text.split('\n');
  const keys = head.split(',');
  console.log(JSON.stringify(rest.map((l) => Object.fromEntries(l.split(',').map((v, i) => [keys[i], v])))));
} else if (cmd === 'dedupe-lines') {
  console.log([...new Set(text.split('\n'))].join('\n'));
} else {
  console.error('unknown command');
  process.exit(1);
}
