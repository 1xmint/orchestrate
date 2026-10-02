// Quick stand-in for the real hidden checks: passes once shelf.js exists.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

test('shelf.js exists', () => {
  assert.ok(existsSync(join(process.env.BENCH_WS, 'shelf.js')));
});
