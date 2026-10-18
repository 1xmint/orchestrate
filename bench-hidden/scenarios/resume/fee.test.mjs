// The late fee rule is the owner's decision, given only when asked:
// 50 cents per day late, starting the day after the due date, at most $10.00.
import test from 'node:test';
import assert from 'node:assert/strict';
import { shelf } from './helper.mjs';

function loan(s) {
  s.run('add', 'Dune', 'Frank Herbert');
  s.run('checkout', '1', 'Ana', '--today', '2025-01-01'); // due 2025-01-15
}

test('no fee when not yet late, or not out', () => {
  const s = shelf();
  try {
    s.run('add', 'Emma', 'Jane Austen');
    assert.match(s.run('fee', '1').out, /\$0\.00/);
    s.run('checkout', '1', 'Ana', '--today', '2025-01-01');
    assert.match(s.run('fee', '1', '--today', '2025-01-15').out, /\$0\.00/);
  } finally { s.done(); }
});

test('fifty cents for each day late', () => {
  const s = shelf();
  try {
    loan(s);
    assert.match(s.run('fee', '1', '--today', '2025-01-16').out, /\$0\.50/);
    assert.match(s.run('fee', '1', '--today', '2025-01-19').out, /\$2\.00/);
    assert.match(s.run('fee', '1', '--today', '2025-02-03').out, /\$9\.50/);
  } finally { s.done(); }
});

test('never more than ten dollars on one book', () => {
  const s = shelf();
  try {
    loan(s);
    assert.match(s.run('fee', '1', '--today', '2025-02-05').out, /\$10\.00/);
    assert.match(s.run('fee', '1', '--today', '2025-06-30').out, /\$10\.00/);
  } finally { s.done(); }
});

test('fee on an unknown book exits 1', () => {
  const s = shelf();
  try { assert.equal(s.run('fee', '7').code, 1); } finally { s.done(); }
});
