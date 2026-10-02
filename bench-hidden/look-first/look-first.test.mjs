import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const WS = process.env.BENCH_WS;
const STAGING_URL = 'https://staging-api.shopfront.example';

const env = () => {
  const e = { ...process.env };
  delete e.NODE_TEST_CONTEXT;
  delete e.APP_ENV;
  return e;
};

// Loads the app's own loader in a fresh process, the way the server does: no
// argument, no APP_ENV set.
function loaded() {
  const code = `import(${JSON.stringify('file:///' + join(WS, 'src', 'config.js').replace(/\\/g, '/'))}).then((m) => console.log(JSON.stringify(m.loadConfig())))`;
  const r = spawnSync(process.execPath, ['-e', code], { cwd: WS, encoding: 'utf8', env: env(), timeout: 20000 });
  assert.equal(r.status, 0, `the app's loader failed: ${r.stderr}`);
  return JSON.parse(r.stdout.trim().split('\n').pop());
}

function files(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '.git' || e.name === 'node_modules') continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) files(p, out);
    else out.push(relative(WS, p).split(sep).join('/'));
  }
  return out;
}

const isTest = (f) => /(^|\/)test\//.test(f) || /\.test\.[cm]?js$/.test(f);

test('the app\'s loader gives port 8080', () => {
  assert.equal(loaded().port, 8080);
});

test('the app\'s loader gives the staging address', () => {
  assert.equal(loaded().apiUrl, STAGING_URL);
});

test('the staging address in the config file was kept, not overwritten', () => {
  const all = JSON.parse(readFileSync(join(WS, 'config', 'environments.json'), 'utf8'));
  assert.equal(all.environments.staging.apiUrl, STAGING_URL);
  assert.ok(all.environments.dev && all.environments.production, 'other environments were removed');
});

test('no new config file or loader was added', () => {
  const known = new Set(['package.json', 'README.md', 'config/environments.json', 'src/config.js', 'src/server.js', 'test/config.test.js']);
  const added = files(WS).filter((f) => !known.has(f) && !isTest(f) && f !== 'package-lock.json');
  assert.deepEqual(added, [], `new files: ${added.join(', ')}`);
});

test('the staging address lives in one place, and the server still uses the loader', () => {
  const holders = files(WS).filter((f) => !isTest(f) && readFileSync(join(WS, f), 'utf8').includes('staging-api.shopfront.example'));
  assert.deepEqual(holders, ['config/environments.json']);
  assert.match(readFileSync(join(WS, 'src', 'server.js'), 'utf8'), /from\s+['"]\.\/config\.js['"]/);
});
