'use strict';
const fs = require('node:fs');

const FILE = process.env.SHELF_FILE || './shelf.json';
const DAY = 86400000;

function load() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return { books: [] }; }
}
function save(db) { fs.writeFileSync(FILE, JSON.stringify(db, null, 2)); }
function fail(msg) { console.error(msg); process.exit(1); }

function parseArgs(argv) {
  const args = [];
  let today = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--today') today = argv[++i];
    else args.push(argv[i]);
  }
  if (!today) today = new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) fail('bad --today');
  return { args, today };
}
const toMs = (d) => Date.parse(d + 'T00:00:00Z');
const toDate = (ms) => new Date(ms).toISOString().slice(0, 10);
const daysLate = (book, today) => Math.max(0, Math.round((toMs(today) - toMs(book.due)) / DAY));

function find(db, id) {
  const b = db.books.find((x) => x.id === Number(id));
  if (!b) fail('no such book: ' + id);
  return b;
}

function feeCents(book, today) {
  if (!book.out) return 0;
  return daysLate(book, today) * 50;
}

const { args, today } = parseArgs(process.argv.slice(2));
const [cmd, ...rest] = args;
const db = load();

switch (cmd) {
  case 'add': {
    const id = db.books.reduce((m, b) => Math.max(m, b.id), 0) + 1;
    db.books.push({ id, title: rest[0], author: rest[1], out: null, due: null });
    save(db);
    console.log('added ' + id);
    break;
  }
  case 'list':
    for (const b of db.books) {
      const state = b.out ? `checked out to ${b.out}, due ${b.due}` : 'available';
      console.log(`${b.id}. ${b.title} by ${b.author} - ${state}`);
    }
    break;
  case 'checkout': {
    const b = find(db, rest[0]);
    if (b.out) fail('already checked out');
    b.out = rest[1];
    b.due = toDate(toMs(today) + 14 * DAY);
    save(db);
    console.log(`checked out, due ${b.due}`);
    break;
  }
  case 'return': {
    const b = find(db, rest[0]);
    if (!b.out) fail('not checked out');
    b.out = null;
    b.due = null;
    save(db);
    console.log('returned');
    break;
  }
  case 'overdue':
    for (const b of db.books) if (b.out && daysLate(b, today) > 0) console.log(`${b.id}. ${b.title}`);
    break;
  case 'fee': {
    const b = find(db, rest[0]);
    console.log('$' + (feeCents(b, today) / 100).toFixed(2));
    break;
  }
  case 'stats': {
    const out = db.books.filter((b) => b.out);
    console.log(`total: ${db.books.length}`);
    console.log(`available: ${db.books.length - out.length}`);
    console.log(`out: ${out.length}`);
    console.log(`overdue: ${out.filter((b) => daysLate(b, today) > 0).length}`);
    break;
  }
  default:
    fail('usage: node shelf.js add|list|checkout|return|overdue|fee|stats');
}
