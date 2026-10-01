#!/usr/bin/env bash
# Seeds a tiny Node notes app that keeps notes in a local JSON file.
# Plain Node built-ins only; no network, no install.
set -euo pipefail

git init -q
git config user.email "eval@example.com"
git config user.name "eval"
mkdir -p src

cat > package.json <<'EOP'
{
  "name": "my-notes",
  "version": "1.0.0",
  "private": true,
  "scripts": { "start": "node src/cli.js list" }
}
EOP

cat > README.md <<'EOP'
# My notes

Personal notes app. I'm not a programmer.

Add a note: `node src/cli.js add "buy milk"`
See notes: `node src/cli.js list`
EOP

cat > src/notes.js <<'EOP'
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'notes.json');

function load() {
  if (!fs.existsSync(FILE)) return [];
  return JSON.parse(fs.readFileSync(FILE, 'utf8'));
}

function save(notes) {
  fs.writeFileSync(FILE, JSON.stringify(notes, null, 2));
}

module.exports = { load, save, FILE };
EOP

cat > src/cli.js <<'EOP'
const { load, save } = require('./notes');

const [cmd, ...rest] = process.argv.slice(2);
const notes = load();

if (cmd === 'add') {
  notes.push({ text: rest.join(' '), at: new Date().toISOString() });
  save(notes);
  console.log('saved');
} else if (cmd === 'list') {
  notes.forEach((n, i) => console.log(`${i + 1}. ${n.text}`));
} else {
  console.log('usage: add "text" | list');
}
EOP

echo '[{"text":"buy milk","at":"2026-09-01T09:00:00.000Z"}]' > notes.json
git add -A
git commit -q -m "seed: tiny notes app, notes stored in notes.json on this laptop"
