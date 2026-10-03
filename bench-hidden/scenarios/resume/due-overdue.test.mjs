import test from 'node:test';
import assert from 'node:assert/strict';
import { shelf } from './helper.mjs';

test('due date is 14 days out, across a month end', () => {
  const s = shelf();
  try {
    s.run('add', 'Dune', 'Frank Herbert');
    s.run('checkout', '1', 'Ana', '--today', '2025-02-20');
    assert.match(s.run('list', '--today', '2025-02-21').out, /due 2025-03-06/);
  } finally { s.done(); }
});

test('overdue lists only books whose due date is before today', () => {
  const s = shelf();
  try {
    s.run('add', 'Dune', 'Frank Herbert');
    s.run('add', 'Emma', 'Jane Austen');
    s.run('add', 'Ulysses', 'James Joyce');
    s.run('checkout', '1', 'Ana', '--today', '2025-01-01'); // due 2025-01-15
    s.run('checkout', '2', 'Bo', '--today', '2025-01-02'); // due 2025-01-16
    const onDue = s.run('overdue', '--today', '2025-01-15').out;
    assert.doesNotMatch(onDue, /Dune/, 'not overdue on the due date itself');
    const next = s.run('overdue', '--today', '2025-01-16').out;
    assert.match(next, /Dune/);
    assert.doesNotMatch(next, /Emma/);
    assert.doesNotMatch(next, /Ulysses/);
    const later = s.run('overdue', '--today', '2025-02-01').out;
    assert.match(later, /Dune/);
    assert.match(later, /Emma/);
    assert.doesNotMatch(later, /Ulysses/);
  } finally { s.done(); }
});
