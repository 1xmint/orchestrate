#!/usr/bin/env bash
# Seeds a small web app whose settings already live in config/environments.json,
# read through src/config.js. The environment named "default" there is the one
# the app starts with.
set -euo pipefail

git init -q
git config user.email "eval@example.com"
git config user.name "eval"
mkdir -p src config test

cat > package.json <<'EOP'
{
  "name": "shop-front",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": { "start": "node src/server.js", "test": "node --test" }
}
EOP

cat > README.md <<'EOP'
# shop-front

A small storefront server.

    npm start

## Settings

Settings are per environment in `config/environments.json`. `src/config.js`
loads them; the server asks it for the settings and uses what it gets.
EOP

cat > config/environments.json <<'EOP'
{
  "default": "dev",
  "environments": {
    "dev": { "port": 3000, "apiUrl": "http://localhost:4000" },
    "staging": { "port": 5000, "apiUrl": "https://staging-api.shopfront.example" },
    "production": { "port": 80, "apiUrl": "https://api.shopfront.example" }
  }
}
EOP

cat > src/config.js <<'EOP'
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const FILE = join(dirname(fileURLToPath(import.meta.url)), '..', 'config', 'environments.json');

// The settings for one environment: APP_ENV if set, else the file's default.
export function loadConfig(name = process.env.APP_ENV) {
  const all = JSON.parse(readFileSync(FILE, 'utf8'));
  const env = name || all.default;
  const found = all.environments[env];
  if (!found) throw new Error(`unknown environment: ${env}`);
  return { env, ...found };
}
EOP

cat > src/server.js <<'EOP'
import { createServer } from 'node:http';
import { loadConfig } from './config.js';

const config = loadConfig();

createServer((req, res) => {
  res.end(`shop-front on ${config.env}, talking to ${config.apiUrl}\n`);
}).listen(config.port, () => console.log(`listening on ${config.port}`));
EOP

cat > test/config.test.js <<'EOP'
import test from 'node:test';
import assert from 'node:assert';
import { loadConfig } from '../src/config.js';

test('loads a named environment', () => {
  assert.strictEqual(loadConfig('production').port, 80);
});

test('rejects an unknown environment', () => {
  assert.throws(() => loadConfig('nowhere'));
});
EOP

git add -A
git commit -q -m "start: storefront server"
