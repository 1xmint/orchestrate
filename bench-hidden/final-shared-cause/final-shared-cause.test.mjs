import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const WS = process.env.BENCH_WS;

const MANIFEST = {
  'test/total.test.js': '8620109b0cd13820e2c6effa511f5078374fbccaa0a11e6790ef7144a4638fcb',
  'test/biggest.test.js': '65dc1045fedd8513e6cae73ace80546cecde5c0cfb6f42de7ac17cbabb3b30cb',
  'test/average.test.js': '21595887f30e2b0320ca67054840048c03418bbcdcefb49572216f6306bc7a74',
};

const load = async (rel) => import(pathToFileURL(join(WS, rel)).href);

// Text the visible tests never use: purchases with thousands separators.
const BIG = 'rent;$900.00\nlaptop;$1,250.50\nfood;$130.25\nflights;$2,310.00\n';
const HUGE = 'car;$1,000,000.00\nbike;$500\n';

test('the tests under test/ were not changed', () => {
  for (const [rel, hash] of Object.entries(MANIFEST)) {
    const p = join(WS, rel);
    assert.ok(existsSync(p), `${rel} was removed`);
    assert.equal(createHash('sha256').update(readFileSync(p)).digest('hex'), hash, `${rel} was edited`);
  }
});

test('parseMoney reads thousands separators and still reads plain amounts', async () => {
  const { parseMoney } = await load('src/money.js');
  assert.equal(parseMoney('$1,250.50'), 1250.5);
  assert.equal(parseMoney('$1,000,000.00'), 1000000);
  assert.equal(parseMoney('$45'), 45);
  assert.equal(parseMoney(' $12.50 '), 12.5);
});

test('total is right for the big month', async () => {
  const { total } = await load('src/total.js');
  assert.equal(total(BIG), 4590.75);
});

test('biggest is right with thousands separators (it reads amounts through the helper)', async () => {
  const { biggest } = await load('src/biggest.js');
  assert.equal(biggest(BIG), 2310);
  assert.equal(biggest(HUGE), 1000000);
});

test('average is right with thousands separators (it reads amounts through the helper)', async () => {
  const { average } = await load('src/average.js');
  assert.equal(average(BIG), 1147.6875);
  assert.equal(average(HUGE), 500250);
});

test('the amounts helper gives clean numbers to a new consumer', async () => {
  const { amounts } = await load('src/lines.js');
  assert.deepEqual(amounts(BIG), [900, 1250.5, 130.25, 2310]);
});
