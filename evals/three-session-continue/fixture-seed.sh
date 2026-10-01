#!/usr/bin/env bash
# Seeds a todo CLI with three commits that stand for three earlier sessions.
# Session 3 left markDone half-written in src/todos.js and not wired into
# src/cli.js. docs/plan.md ticks steps 1 and 2 and leaves step 3 open.
# (context.history_file can seed only one transcript, so the earlier
# sessions are files and commits only.)
set -euo pipefail

git init -q
git config user.email "eval@example.com"
git config user.name "eval"
mkdir -p src docs

cat > package.json <<'EOP'
{
  "name": "todo-cli",
  "version": "1.0.0",
  "private": true,
  "scripts": { "start": "node src/cli.js list" }
}
EOP

# --- session 1: model and storage
cat > docs/plan.md <<'EOP'
# Plan

- [x] 1. Todo model and storage
- [ ] 2. Add and list commands
- [ ] 3. Mark a todo done
- [ ] 4. Delete a todo
- [ ] 5. Tests for all commands
EOP
cat > src/todos.js <<'EOP'
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'todos.json');

function load() {
  if (!fs.existsSync(FILE)) return [];
  return JSON.parse(fs.readFileSync(FILE, 'utf8'));
}

function save(todos) {
  fs.writeFileSync(FILE, JSON.stringify(todos, null, 2));
}

module.exports = { load, save };
EOP
git add -A
git commit -q -m "session 1: todo model and storage"

# --- session 2: add and list
cat > docs/plan.md <<'EOP'
# Plan

- [x] 1. Todo model and storage
- [x] 2. Add and list commands
- [ ] 3. Mark a todo done
- [ ] 4. Delete a todo
- [ ] 5. Tests for all commands
EOP
cat > src/todos.js <<'EOP'
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'todos.json');

function load() {
  if (!fs.existsSync(FILE)) return [];
  return JSON.parse(fs.readFileSync(FILE, 'utf8'));
}

function save(todos) {
  fs.writeFileSync(FILE, JSON.stringify(todos, null, 2));
}

function add(text) {
  const todos = load();
  todos.push({ id: todos.length + 1, text, done: false });
  save(todos);
  return todos;
}

module.exports = { load, save, add };
EOP
cat > src/cli.js <<'EOP'
const todos = require('./todos');

const [cmd, ...rest] = process.argv.slice(2);

if (cmd === 'add') {
  todos.add(rest.join(' '));
  console.log('added');
} else if (cmd === 'list') {
  todos.load().forEach((t) => console.log(`${t.id}. [${t.done ? 'x' : ' '}] ${t.text}`));
} else {
  console.log('usage: add "text" | list');
}
EOP
git add -A
git commit -q -m "session 2: add and list commands"

# --- session 3: markDone started, not exported, not wired into the CLI
cat > src/todos.js <<'EOP'
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'todos.json');

function load() {
  if (!fs.existsSync(FILE)) return [];
  return JSON.parse(fs.readFileSync(FILE, 'utf8'));
}

function save(todos) {
  fs.writeFileSync(FILE, JSON.stringify(todos, null, 2));
}

function add(text) {
  const todos = load();
  todos.push({ id: todos.length + 1, text, done: false });
  save(todos);
  return todos;
}

// WIP: marks the todo with this id as done. Not exported or called yet.
function markDone(id) {
  const todos = load();
  const t = todos.find((x) => x.id === id);
  // TODO: handle an id that does not exist
  t.done = true;
  save(todos);
}

module.exports = { load, save, add };
EOP
git add -A
git commit -q -m "session 3: started the done command, not wired up yet"
