#!/usr/bin/env bash
# Seeds a small, already-working app with committed history, so the case
# starts from real work in flight rather than an empty folder — the
# empty-repo variant in docs/audits/2026-09-24-live-runs.md (Scenario 2)
# produced nothing to interrupt, which this case exists to fix.
set -euo pipefail

git init -q
git config user.email "eval@example.com"
git config user.name "eval"

mkdir -p src test

cat > package.json <<'EOF'
{
  "name": "seed-app",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "start": "node src/server.js",
    "test": "node --test test/**/*.test.js"
  }
}
EOF

cat > src/server.js <<'EOF'
const http = require('http');

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
    return;
  }
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('not found');
});

if (require.main === module) {
  server.listen(3000, () => console.log('listening on 3000'));
}

module.exports = server;
EOF

cat > test/health.test.js <<'EOF'
const test = require('node:test');
const assert = require('node:assert');

test('placeholder', () => {
  assert.ok(true);
});
EOF

git add -A
git commit -q -m "seed: minimal server with a health check, no auth yet"
