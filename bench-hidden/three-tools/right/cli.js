#!/usr/bin/env node
const fs = require('fs');

function readInput(file) {
  return fs.readFileSync(file || 0, 'utf8');
}
const lines = (text) => {
  const t = text.replace(/\r\n/g, '\n');
  if (t === '') return [];
  return (t.endsWith('\n') ? t.slice(0, -1) : t).split('\n');
};

function wordcount(text) {
  return text.split(/\s+/).filter(Boolean).length + '\n';
}

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', q = false, any = false;
  const t = text.replace(/\r\n/g, '\n');
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    any = true;
    if (q) {
      if (c === '"') { if (t[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; any = false; }
    else field += c;
  }
  if (any) { row.push(field); rows.push(row); }
  return rows;
}
function csvToJson(text) {
  const rows = parseCsv(text);
  if (!rows.length) return '[]\n';
  const [head, ...rest] = rows;
  return JSON.stringify(rest.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])))) + '\n';
}

function dedupe(text) {
  return [...new Set(lines(text))].map((l) => l + '\n').join('');
}

const [cmd, file] = process.argv.slice(2);
const commands = { wordcount, 'csv-to-json': csvToJson, 'dedupe-lines': dedupe };
if (!commands[cmd]) {
  console.error(`unknown command: ${cmd || '(none)'}`);
  process.exit(1);
}
process.stdout.write(commands[cmd](readInput(file)));
