#!/usr/bin/env node
// package.mjs — zip skills/orchestrate into orchestrate.skill (a plain zip
// with an orchestrate/ top folder). The skill-creator packager rejects the
// Claude Code-only `hooks` frontmatter key, which this skill needs for the
// money rules, so we zip directly. Uses Node's built-in zlib; no dependencies.

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'skills', 'orchestrate');
const OUT = join(ROOT, 'orchestrate.skill');

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

// minimal zip writer (deflate, no zip64) — enough for a few dozen small files
const crcTable = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc32 = buf => { let c = -1; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const u16 = n => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const u32 = n => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };

const locals = [], centrals = [];
let offset = 0;
for (const file of walk(SRC).sort()) {
  const name = Buffer.from('orchestrate/' + relative(SRC, file).split('\\').join('/'));
  const data = readFileSync(file);
  const comp = deflateRawSync(data);
  const crc = crc32(data);
  const head = Buffer.concat([u32(0x04034b50), u16(20), u16(0x0800), u16(8), u16(0), u16(0x21), u32(crc), u32(comp.length), u32(data.length), u16(name.length), u16(0), name]);
  locals.push(head, comp);
  centrals.push(Buffer.concat([u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(8), u16(0), u16(0x21), u32(crc), u32(comp.length), u32(data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name]));
  offset += head.length + comp.length;
}
const central = Buffer.concat(centrals);
const end = Buffer.concat([u32(0x06054b50), u16(0), u16(0), u16(centrals.length), u16(centrals.length), u32(central.length), u32(offset), u16(0)]);
writeFileSync(OUT, Buffer.concat([...locals, central, end]));
console.log(`${OUT}: ${centrals.length} files`);
