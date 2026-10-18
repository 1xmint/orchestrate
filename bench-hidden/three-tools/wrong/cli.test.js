const test = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const run = (cmd, input) => spawnSync(process.execPath, [path.join(__dirname, 'cli.js'), cmd], { input, encoding: 'utf8' }).stdout;

test('wordcount', () => assert.strictEqual(run('wordcount', 'a b c').trim(), '3'));
test('csv simple', () => assert.deepStrictEqual(JSON.parse(run('csv-to-json', 'a,b\n1,2')), [{ a: '1', b: '2' }]));
