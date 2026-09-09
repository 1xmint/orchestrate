#!/usr/bin/env node
// package.mjs — zip skills/orchestrate into a .skill file (a plain zip with an
// orchestrate/ top folder). The skill-creator packager rejects the Claude
// Code-only `hooks` frontmatter key, which this skill needs for the money
// rules, so we zip directly. Node's zlib only; no dependencies.
//
//   node scripts/package.mjs           -> orchestrate.skill (Claude Code)
//   node scripts/package.mjs --spec    -> orchestrate-spec.skill (portable)
//   node scripts/package.mjs --both    -> both
//
// The portable build is for hosts that read the skill spec but not Claude
// Code's extensions: claude.ai and Codex. It drops `hooks` and `when_to_use`
// from every frontmatter block and removes the `!`command`` injection line,
// because a host that does not run it would show the backticks as prose. What
// the hooks enforce is stated as rules in the body, so the portable build is
// weaker but not wrong.

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'skills', 'orchestrate');

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

// Drop a top-level frontmatter key and everything indented under it.
export function stripKey(frontmatter, key) {
  const lines = frontmatter.split('\n');
  const out = [];
  let skipping = false;
  for (const line of lines) {
    if (skipping) {
      if (/^\s/.test(line) && line.trim()) continue;
      skipping = false;
    }
    if (new RegExp(`^${key}:`).test(line)) { skipping = true; continue; }
    out.push(line);
  }
  return out.join('\n');
}

export function toSpec(text) {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!m) return text;
  let fm = m[1];
  for (const key of ['hooks', 'when_to_use', 'memory']) fm = stripKey(fm, key);
  fm = fm.replace(/\n{3,}/g, '\n\n').trim();
  let body = text.slice(m[0].length);
  // The `!`cmd`` injection line, and the sentence that refers to it.
  body = body.replace(/^!`[^`]*`\n\n?/m, '');
  body = body.replace(/ The\n?line above is this machine's profile, injected at no cost\./, '');
  // Nothing enforces the rules here, so say so plainly instead of promising
  // hooks the host will never run.
  body = body.replace(
    /Four hooks hold what is mechanical, so you need not: `guard-agent\.mjs`[\s\S]*?§0\s+says how\./,
    'This host runs none of the skill\'s hooks, so nothing keeps credentials out\nof a packet, writes the ledger row or holds the Pickup line for you. Hold them\nyourself; they are stated where they apply below. Choosing the model was never\nmechanical anyway, so §0 reads the same here as everywhere.'
  );
  body = body.replace(/^Tier `unknown` above:/m, 'Start by running `profile.mjs` in the skill folder. Tier `unknown`:');
  body = body.replace(/`ledger\.mjs` saves every return and moves its row to 🔍 review; grading is\nyours\./, 'Save every return under the run folder and move its row to 🔍 review yourself.');
  body = body.split('${CLAUDE_SKILL_DIR}').join('<skill folder>');
  // No installer runs on these hosts, so nothing would substitute the
  // interpreter placeholder; plain `node` is the honest fallback there.
  body = body.split('{{NODE}} ').join('node ').split('{{NODE}}').join('node');
  return `---\n${fm}\n---\n${body}`;
}

// minimal zip writer (deflate, no zip64) — enough for a few dozen small files
const crcTable = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc32 = buf => { let c = -1; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const u16 = n => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const u32 = n => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };

function writeZip(out, entries) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const [nameStr, data] of entries) {
    const name = Buffer.from(nameStr);
    const comp = deflateRawSync(data);
    const crc = crc32(data);
    const head = Buffer.concat([u32(0x04034b50), u16(20), u16(0x0800), u16(8), u16(0), u16(0x21), u32(crc), u32(comp.length), u32(data.length), u16(name.length), u16(0), name]);
    locals.push(head, comp);
    centrals.push(Buffer.concat([u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(8), u16(0), u16(0x21), u32(crc), u32(comp.length), u32(data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name]));
    offset += head.length + comp.length;
  }
  const central = Buffer.concat(centrals);
  const end = Buffer.concat([u32(0x06054b50), u16(0), u16(0), u16(centrals.length), u16(centrals.length), u32(central.length), u32(offset), u16(0)]);
  writeFileSync(out, Buffer.concat([...locals, central, end]));
  return centrals.length;
}

function build(spec) {
  const out = join(ROOT, spec ? 'orchestrate-spec.skill' : 'orchestrate.skill');
  const entries = [];
  for (const file of walk(SRC).sort()) {
    const rel = relative(SRC, file).split('\\').join('/');
    // The test files are the proof, not the product; they never ship.
    if (/\.test\.mjs$/.test(rel)) continue;
    let data = readFileSync(file);
    if (spec && /\.md$/.test(rel)) data = Buffer.from(toSpec(data.toString('utf8')), 'utf8');
    entries.push([`orchestrate/${rel}`, data]);
  }
  const n = writeZip(out, entries);
  console.log(`${out}: ${n} files${spec ? ' (spec frontmatter, no hooks, no injection line)' : ''}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.includes('--both')) { build(false); build(true); }
  else build(args.includes('--spec'));
}
