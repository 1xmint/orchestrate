import test from 'node:test';
import assert from 'node:assert/strict';
import { shelf } from './helper.mjs';

const trimmed = (out) => out.trim().split(/\r?\n/).map((l) => l.trim());

test('stats counts total, available, out and overdue', () => {
  const s = shelf();
  try {
    for (const t of ['A', 'B', 'C', 'D']) s.run('add', t, 'Someone');
    s.run('checkout', '1', 'Ana', '--today', '2025-01-01'); // due 01-15
    s.run('checkout', '2', 'Bo', '--today', '2025-01-10'); // due 01-24
    assert.deepEqual(trimmed(s.run('stats', '--today', '2025-01-20').out),
      ['total: 4', 'available: 2', 'out: 2', 'overdue: 1']);
  } finally { s.done(); }
});

test('stats on an empty shelf', () => {
  const s = shelf();
  try {
    assert.deepEqual(trimmed(s.run('stats').out),
      ['total: 0', 'available: 0', 'out: 0', 'overdue: 0']);
  } finally { s.done(); }
});
