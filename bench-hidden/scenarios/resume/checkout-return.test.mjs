import test from 'node:test';
import assert from 'node:assert/strict';
import { shelf } from './helper.mjs';

test('checkout, return and the exit-1 cases', () => {
  const s = shelf();
  try {
    s.run('add', 'Dune', 'Frank Herbert');
    assert.equal(s.run('checkout', '1', 'Ana', '--today', '2025-03-01').code, 0);
    assert.match(s.run('list', '--today', '2025-03-01').out, /checked out to Ana/);
    const twice = s.run('checkout', '1', 'Bo', '--today', '2025-03-02');
    assert.equal(twice.code, 1);
    assert.ok((twice.out + twice.err).trim().length > 0);
    assert.equal(s.run('return', '1').code, 0);
    assert.match(s.run('list').out, /available/);
    assert.equal(s.run('return', '1').code, 1);
    assert.equal(s.run('checkout', '9', 'Ana').code, 1);
    assert.equal(s.run('return', '9').code, 1);
  } finally { s.done(); }
});
