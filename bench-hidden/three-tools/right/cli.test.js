const test = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const run = (cmd, input) => spawnSync(process.execPath, [path.join(__dirname, 'cli.js'), cmd], { input, encoding: 'utf8' }).stdout;

test('wordcount', () => assert.strictEqual(run('wordcount', 'a b\nc\n').trim(), '3'));
test('dedupe', () => assert.strictEqual(run('dedupe-lines', 'a\na\nb\n'), 'a\nb\n'));
test('csv quoted comma', () => assert.deepStrictEqual(JSON.parse(run('csv-to-json', 'a\n"x,y"\n')), [{ a: 'x,y' }]));
