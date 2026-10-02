import test from 'node:test';
import assert from 'node:assert/strict';
import { shelf } from './helper.mjs';

test('add numbers books from 1 and list shows them', () => {
  const s = shelf();
  try {
    assert.match(s.run('add', 'Dune', 'Frank Herbert').out, /added 1\b/);
    assert.match(s.run('add', 'Emma', 'Jane Austen').out, /added 2\b/);
    const lines = s.run('list').out.trim().split(/\r?\n/);
    assert.equal(lines.length, 2);
    assert.match(lines[0], /1/);
    assert.match(lines[0], /Dune/);
    assert.match(lines[0], /Frank Herbert/);
    assert.match(lines[0], /available/);
    assert.match(lines[1], /Emma/);
  } finally { s.done(); }
});

test('records persist between runs and an empty shelf lists nothing', () => {
  const s = shelf();
  try {
    assert.equal(s.run('list').out.trim(), '');
    s.run('add', 'Dune', 'Frank Herbert');
    assert.match(s.run('list').out, /Dune/);
  } finally { s.done(); }
});
