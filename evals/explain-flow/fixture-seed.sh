#!/usr/bin/env bash
# Seeds a tiny Node app with a password login and a session cookie.
# Plain Node built-ins only; no network, no install.
set -euo pipefail

git init -q
git config user.email "eval@example.com"
git config user.name "eval"
mkdir -p src

cat > package.json <<'EOP'
{
  "name": "club-site",
  "version": "1.0.0",
  "private": true,
  "scripts": { "start": "node src/server.js" }
}
EOP

cat > README.md <<'EOP'
# Club site

Members page for our running club. I'm not a programmer; a friend set this up.

Start it: `npm start`, then open the address it prints.
EOP

cat > src/users.js <<'EOP'
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'users.json');

function hash(password, salt) {
  return crypto.scryptSync(password, salt, 32).toString('hex');
}

function check(email, password) {
  const users = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  const u = users.find((x) => x.email === email);
  if (!u) return null;
  return hash(password, u.salt) === u.hash ? u : null;
}

module.exports = { check, hash };
EOP

cat > src/sessions.js <<'EOP'
const crypto = require('crypto');

const live = new Map(); // session id -> email, forgotten when the server restarts

function start(email) {
  const id = crypto.randomBytes(16).toString('hex');
  live.set(id, email);
  return id;
}

function who(cookieHeader) {
  const m = /sid=([a-f0-9]+)/.exec(cookieHeader || '');
  return m ? live.get(m[1]) || null : null;
}

module.exports = { start, who };
EOP

cat > src/server.js <<'EOP'
const http = require('http');
const { check } = require('./users');
const sessions = require('./sessions');

const PORT = 4321;

http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/login') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const f = new URLSearchParams(body);
      const user = check(f.get('email'), f.get('password'));
      if (!user) { res.writeHead(401); return res.end('wrong email or password'); }
      res.writeHead(302, { 'Set-Cookie': `sid=${sessions.start(user.email)}; HttpOnly`, Location: '/members' });
      res.end();
    });
    return;
  }
  if (req.url === '/members') {
    const email = sessions.who(req.headers.cookie);
    if (!email) { res.writeHead(302, { Location: '/' }); return res.end(); }
    return res.end(`Members only. Hello ${email}`);
  }
  res.end('<form method=post action=/login><input name=email><input name=password type=password><button>Log in</button></form>');
}).listen(PORT, () => console.log(`open http://localhost:${PORT}`));
EOP

node -e "
const {hash}=require('./src/users');
require('fs').writeFileSync('users.json', JSON.stringify([{email:'sam@club.example',salt:'s1',hash:hash('runfast','s1')}],null,2));
"
git add -A
git commit -q -m "seed: club site with password login and session cookie"
