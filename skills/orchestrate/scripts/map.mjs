#!/usr/bin/env node
// map.mjs — a small map of the repo that an agent reads before it searches.
//
// Every helper starts cold and finds its way by reading and grepping, and all
// of that stays in its context and is re-read on every later step: on 81 past
// helpers, lookups before the first edit were ~21% of everything they read.
// This writes down, once per commit, which files exist, what each is for, who
// imports whom, and which tests cover which files, so a packet can point at it.
//
//   node map.mjs build [--repo <dir>]          write .orchestrator/map/{map.json,map.md}
//   node map.mjs status [--repo <dir>] [--json] fresh or stale, and the size
//   node map.mjs who-uses <file|symbol>        importers, with the lines that use it
//   node map.mjs deps <file>                   what a file imports
//   node map.mjs tests-for <file…>             tests that import or pair with the files
//
// Queries rebuild first when the map is missing or HEAD has moved; a rebuild
// re-scans only blobs it has not seen. What it reads is the git index (committed
// plus staged), through `git cat-file`, so edits not yet staged are not in it.
//
// Honest limits, also printed at the top of map.md: edges come from import lines
// found in the text, not from running or compiling anything. Dynamic imports,
// macros, reflection and re-exports through a package name are missed. Grep is
// still the tool for text; a language server, when loaded, for exact references.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve as resolvePath } from 'node:path';
import { posix } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MAP_V = 1;
// Bumped whenever scan() or purposeOf() changes what they return, so cached
// results from the older scanner are thrown away.
export const SCAN_V = 2;
export const MD_CAP = 4000;
const MAX_BYTES = 512 * 1024;
const SELF = fileURLToPath(import.meta.url);

const git = (root, args, input) => spawnSync('git', args, { cwd: root, input, encoding: input === undefined ? 'utf8' : undefined, maxBuffer: 512 * 1024 * 1024, windowsHide: true });

export function langOf(path) {
  if (/\.(?:[cm]?[jt]sx?)$/.test(path) && !/\.d\.ts$/.test(path)) return 'js';
  if (/\.py$/.test(path)) return 'py';
  if (/\.rs$/.test(path)) return 'rs';
  if (/\.go$/.test(path)) return 'go';
  return null;
}

export function isTest(path) {
  return /(?:^|\/)(?:tests?|__tests__|spec)\//.test(path)
    || /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path)
    || /(?:^|\/)test_[^/]+\.py$/.test(path)
    || /_test\.(?:py|go)$/.test(path);
}

// Line number of a character offset: newline offsets once per text, then a
// binary search per lookup.
function lineIndex(text) {
  const nl = [];
  for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) nl.push(i);
  return index => {
    let lo = 0, hi = nl.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (nl[mid] < index) lo = mid + 1; else hi = mid; }
    return lo + 1;
  };
}

// The first comment or docstring line, which in most repos says what a file is for.
// Comment lines are joined until a sentence ends, so a wrapped first sentence is
// not cut at the wrap.
export function purposeOf(text) {
  const lines = text.split('\n').slice(0, 30);
  const comment = l => /^(?:\/\/[/!]?|#(?!!)|\/\*\*?|\*(?!\/)|"""|''')\s*(.*?)\s*(?:\*\/|"""|''')?$/.exec(l.trim());
  let s = '';
  for (const raw of lines) {
    const l = raw.trim();
    if (!s && (!l || l.startsWith('#!') || /^(?:'use strict'|"use strict");?$/.test(l) || /^#\s*-\*-/.test(l))) continue;
    const m = comment(l);
    if (!m || !m[1]) break;
    s = s ? `${s} ${m[1]}` : m[1].replace(/^[\w./-]+\.(?:[cm]?[jt]sx?|py|rs|go)\s*[—–:-]+\s*/, '');
    if (/[.!?:]$/.test(s) || s.length >= 100) break;
  }
  s = s.trim();
  if (!s) return null;
  const sentence = /^(.+?[.!?])(?:\s|$)/.exec(s);
  if (sentence && sentence[1].length >= 20) s = sentence[1];
  return s.length > 100 ? s.slice(0, 97) + '…' : s;
}

// Imports as written, symbols with their line. Content only, so the result is
// cached by blob hash and resolved against the file list at build time.
export function scan(text, lang) {
  const imports = [];
  const symbols = [];
  const at = lineIndex(text);
  const add = (spec, index) => imports.push([spec, at(index)]);
  const each = (re, fn) => { for (const m of text.matchAll(re)) fn(m); };
  if (lang === 'js') {
    each(/(?:^|\n)[ \t]*(?:import|export)\b[^;'"`]*?\bfrom\s*(['"])([^'"\n]+)\1/g, m => add(m[2], m.index + m[0].indexOf(m[1] + m[2])));
    each(/(?:^|\n)[ \t]*import\s*(['"])([^'"\n]+)\1/g, m => add(m[2], m.index + m[0].indexOf(m[1] + m[2])));
    each(/\b(?:require|import)\s*\(\s*(['"])([^'"\n]+)\1\s*\)/g, m => add(m[2], m.index));
    each(/(?:^|\n)(export\s+(?:default\s+)?(?:async\s+)?(function\*?|class|const|let|var)\s+([A-Za-z_$][\w$]*))/g, m => symbols.push([m[3], m[2].replace('*', ''), at(m.index + m[0].indexOf(m[1]))]));
    each(/(?:^|\n)((?:async\s+)?(function\*?|class)\s+([A-Za-z_$][\w$]*))/g, m => symbols.push([m[3], m[2].replace('*', ''), at(m.index + m[0].indexOf(m[1]))]));
  } else if (lang === 'py') {
    each(/(?:^|\n)[ \t]*from\s+(\.*[\w.]*)\s+import\b/g, m => add(m[1], m.index + m[0].indexOf('from')));
    each(/(?:^|\n)[ \t]*import\s+([\w.]+(?:\s*,\s*[\w.]+)*)/g, m => { for (const s of m[1].split(',')) add(s.trim(), m.index + m[0].indexOf('import')); });
    each(/(?:^|\n)((?:async\s+)?(def|class)\s+(\w+))/g, m => symbols.push([m[3], m[2], at(m.index + m[0].indexOf(m[1]))]));
  } else if (lang === 'rs') {
    each(/(?:^|\n)[ \t]*(?:pub(?:\([^)]*\))?\s+)?mod\s+(\w+)\s*;/g, m => add(`mod:${m[1]}`, m.index + m[0].indexOf('mod')));
    each(/(?:^|\n)[ \t]*(?:pub(?:\([^)]*\))?\s+)?use\s+(crate(?:::\w+)+)/g, m => add(m[1], m.index + m[0].indexOf('use')));
    each(/(?:^|\n)[ \t]*(pub(?:\([^)]*\))?\s+(?:async\s+)?(fn|struct|enum|trait|type|const)\s+(\w+))/g, m => symbols.push([m[3], m[2], at(m.index + m[0].indexOf(m[1]))]));
  } else if (lang === 'go') {
    each(/(?:^|\n)import\s+(?:\w+\s+)?"([^"]+)"/g, m => add(m[1], m.index + m[0].indexOf('"')));
    each(/(?:^|\n)import\s*\(([^)]*)\)/g, m => { for (const q of m[1].matchAll(/"([^"]+)"/g)) add(q[1], m.index + m[0].indexOf(q[0])); });
    each(/(?:^|\n)((func)\s+(?:\([^)]*\)\s*)?(\w+)|(type)\s+(\w+))/g, m => symbols.push([m[3] || m[5], m[2] || m[4], at(m.index + m[0].indexOf(m[1]))]));
  }
  const entry = /^#!/.test(text)
    || (lang === 'js' && /import\.meta\.url\)?\s*===|require\.main\s*===\s*module/.test(text))
    || (lang === 'py' && /__name__\s*==\s*['"]__main__['"]/.test(text))
    || (lang === 'go' && /(?:^|\n)package\s+main\b/.test(text) && /(?:^|\n)func\s+main\s*\(/.test(text))
    || (lang === 'rs' && /(?:^|\n)fn\s+main\s*\(/.test(text));
  return { imports, symbols, purpose: purposeOf(text), lines: text.split('\n').length, entry: !!entry };
}

// A spec as written, to a file in the repo, or null for a package or unknown.
export function resolveSpec(spec, from, lang, files, extra = {}) {
  const dir = posix.dirname(from);
  const first = cands => cands.find(c => files.has(c)) || null;
  if (lang === 'js') {
    if (!/^\.\.?\//.test(spec)) return null;
    const base = posix.normalize(posix.join(dir, spec));
    const exts = ['', '.mjs', '.js', '.ts', '.tsx', '.jsx', '.cjs', '.mts', '.cts'];
    return first([...exts.map(e => base + e), ...exts.slice(1).map(e => `${base}/index${e}`), base.replace(/\.js$/, '.ts')]);
  }
  if (lang === 'py') {
    let p;
    const dots = /^\.+/.exec(spec);
    if (dots) {
      let d = dir;
      for (let i = 1; i < dots[0].length; i++) d = posix.dirname(d);
      p = posix.join(d, spec.slice(dots[0].length).replace(/\./g, '/'));
    } else p = spec.replace(/\./g, '/');
    const hit = first([`${p}.py`, `${p}/__init__.py`, `src/${p}.py`, `src/${p}/__init__.py`]);
    if (hit || dots) return hit;
    const tail = [`/${p}.py`, `/${p}/__init__.py`];
    const found = [...files].filter(f => tail.some(t => f.endsWith(t)));
    return found.length === 1 ? found[0] : null;
  }
  if (lang === 'rs') {
    if (spec.startsWith('mod:')) {
      const name = spec.slice(4);
      const own = /(?:^|\/)(?:mod|lib|main)\.rs$/.test(from) ? dir : posix.join(dir, posix.basename(from, '.rs'));
      return first([`${own}/${name}.rs`, `${own}/${name}/mod.rs`].map(c => c.replace(/^\.\//, '')));
    }
    const at = from.lastIndexOf('src/');
    if (at < 0) return null;
    const src = from.slice(0, at + 3);
    const parts = spec.split('::').slice(1);
    for (let n = parts.length; n > 0; n--) {
      const p = `${src}/${parts.slice(0, n).join('/')}`;
      const hit = first([`${p}.rs`, `${p}/mod.rs`]);
      if (hit) return hit;
    }
    return null;
  }
  if (lang === 'go') {
    if (!extra.goModule || !(spec === extra.goModule || spec.startsWith(extra.goModule + '/'))) return null;
    return `${spec.slice(extra.goModule.length + 1) || '.'}/`;
  }
  return null;
}

function listIndex(root) {
  const r = git(root, ['ls-files', '-s', '-z']);
  if (r.status !== 0) throw new Error(`not a git repository: ${root}`);
  const out = [];
  for (const rec of r.stdout.split('\0')) {
    const m = /^(\d+) ([0-9a-f]+) \d\t(.+)$/s.exec(rec);
    if (m && m[1] !== '160000') out.push({ path: m[3], blob: m[2] });
  }
  return out;
}

// One process for sizes, one for contents, only for blobs not in the cache.
function readBlobs(root, blobs) {
  const got = new Map();
  if (!blobs.length) return got;
  const check = git(root, ['cat-file', '--batch-check=%(objectname) %(objectsize)'], blobs.join('\n') + '\n');
  const small = String(check.stdout).split('\n').map(l => l.split(' ')).filter(([b, s]) => b && Number(s) <= MAX_BYTES).map(([b]) => b);
  if (!small.length) return got;
  const buf = git(root, ['cat-file', '--batch'], small.join('\n') + '\n').stdout;
  let at = 0;
  while (at < buf.length) {
    const nl = buf.indexOf(10, at);
    if (nl < 0) break;
    const [blob, , size] = buf.subarray(at, nl).toString('utf8').split(' ');
    const n = Number(size);
    if (!Number.isFinite(n)) break;
    const body = buf.subarray(nl + 1, nl + 1 + n);
    if (!body.subarray(0, 8000).includes(0)) got.set(blob, body.toString('utf8'));
    at = nl + 1 + n + 1;
  }
  return got;
}

export const mapDir = root => join(root, '.orchestrator', 'map');
const readJsonFile = p => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
export const headOf = root => { const r = git(root, ['rev-parse', 'HEAD']); return r.status === 0 ? r.stdout.trim() : null; };

export function build(root, { now = new Date(), write = true } = {}) {
  const t0 = Date.now();
  const index = listIndex(root);
  const dir = mapDir(root);
  const cachePath = join(dir, 'cache.json');
  const old = readJsonFile(cachePath);
  const cache = old && old.v === MAP_V && old.scan === SCAN_V ? old.blobs : {};
  const code = index.filter(f => langOf(f.path));
  const missing = [...new Set(code.filter(f => !cache[f.blob]).map(f => f.blob))];
  const texts = readBlobs(root, missing);
  const fresh = {};
  let scanned = 0;
  for (const f of code) {
    if (cache[f.blob]) { fresh[f.blob] = cache[f.blob]; continue; }
    const text = texts.get(f.blob);
    fresh[f.blob] = text == null ? { skipped: true } : scan(text, langOf(f.path));
    if (text != null) scanned++;
  }
  const paths = new Set(code.map(f => f.path));
  const goMod = index.find(f => f.path === 'go.mod');
  let goModule = null;
  if (goMod) { const t = readBlobs(root, [goMod.blob]).get(goMod.blob); const m = t && /^module\s+(\S+)/m.exec(t); goModule = m ? m[1] : null; }

  const files = {};
  const importers = {};
  for (const f of code) {
    const s = fresh[f.blob];
    if (s.skipped) { files[f.path] = { lang: langOf(f.path), skipped: 'over 512 KB or binary' }; continue; }
    const imports = [];
    for (const [spec, line] of s.imports) {
      const target = resolveSpec(spec, f.path, langOf(f.path), paths, { goModule });
      if (!target) continue;
      const targets = target.endsWith('/') ? [...paths].filter(p => posix.dirname(p) === target.slice(0, -1).replace(/^\.$/, '.') && !isTest(p)).slice(0, 20) : [target];
      for (const t of targets) if (t !== f.path && !imports.some(([x]) => x === t)) imports.push([t, line]);
    }
    for (const [t, line] of imports) (importers[t] ||= []).push([f.path, line]);
    files[f.path] = { lang: langOf(f.path), lines: s.lines, purpose: s.purpose, entry: s.entry, test: isTest(f.path), symbols: s.symbols, imports };
  }

  // Tests for a file: tests that import it, tests whose name pairs with it, and
  // tests one import further away, each with the reason.
  const testsFor = {};
  const tests = Object.keys(files).filter(p => files[p].test);
  const addTest = (src, test, why) => { const l = (testsFor[src] ||= []); if (!l.some(x => x[0] === test)) l.push([test, why]); };
  const stem = p => posix.basename(p).replace(/\.(?:test|spec)(?=\.)/, '').replace(/^test_/, '').replace(/_test(?=\.)/, '').replace(/\.[^.]+$/, '');
  const byStem = {};
  for (const p of Object.keys(files)) if (!files[p].test) (byStem[stem(p)] ||= []).push(p);
  for (const t of tests) {
    for (const [src, line] of files[t].imports || []) if (!files[src]?.test) addTest(src, t, `imports it at line ${line}`);
    for (const src of byStem[stem(t)] || []) addTest(src, t, 'name pairs with it');
  }
  for (const t of tests) {
    for (const [mid] of files[t].imports || []) {
      if (files[mid]?.test) continue;
      for (const [src] of files[mid]?.imports || []) if (!files[src]?.test) addTest(src, t, `through ${mid}`);
    }
  }

  const map = { v: MAP_V, head: headOf(root), builtAt: now.toISOString(), files, importers, testsFor, counts: { indexed: index.length, code: code.length, scanned, edges: Object.values(importers).reduce((n, l) => n + l.length, 0), linkedSources: Object.keys(testsFor).length } };
  const md = markdown(map, root);
  if (!write) return { map, md, ms: Date.now() - t0 };
  mkdirSync(dir, { recursive: true });
  const keep = {};
  for (const f of code) keep[f.blob] = fresh[f.blob];
  writeFileSync(cachePath, JSON.stringify({ v: MAP_V, scan: SCAN_V, blobs: keep }));
  writeFileSync(join(dir, 'map.json'), JSON.stringify(map));
  writeFileSync(join(dir, 'map.md'), md);
  return { map, md, ms: Date.now() - t0 };
}

export function markdown(map, root) {
  const files = map.files;
  const src = Object.keys(files).filter(p => !files[p].test && !files[p].skipped);
  const head = [
    `# Repo map (${String(map.head || 'no commit').slice(0, 7)}, ${map.builtAt.slice(0, 10)})`,
    '',
    'Read this before searching. Edges are import lines found in the text, not a compiled view:',
    'dynamic imports, macros and reflection are missed. Structure:',
    `\`node "${SELF.replace(/\\/g, '/')}" who-uses|deps|tests-for <file>\`.`,
    'Exact references: the LSP tool when loaded. Text: grep.',
  ];
  const sections = [];
  const folders = {};
  for (const p of Object.keys(files)) { const d = posix.dirname(p); (folders[d] ||= []).push(p); }
  const purposeOfDir = d => {
    const hub = folders[d].filter(p => !files[p].test && files[p].purpose).sort((a, b) => (map.importers[b]?.length || 0) - (map.importers[a]?.length || 0))[0];
    return hub ? `${posix.basename(hub)}: ${files[hub].purpose}` : '';
  };
  sections.push(['## Folders', Object.keys(folders).sort((a, b) => folders[b].length - folders[a].length).slice(0, 12)
    .map(d => `- ${d === '.' ? '(root)' : d + '/'} — ${folders[d].length} code files${folders[d].some(p => files[p].test) ? `, ${folders[d].filter(p => files[p].test).length} tests` : ''}${purposeOfDir(d) ? ` — ${purposeOfDir(d)}` : ''}`)]);
  sections.push(['## Most imported', src.filter(p => map.importers[p]?.length).sort((a, b) => map.importers[b].length - map.importers[a].length).slice(0, 10)
    .map(p => `- ${p} — ${map.importers[p].length} importers${files[p].purpose ? ` — ${files[p].purpose}` : ''}`)]);
  sections.push(['## Entry points', src.filter(p => files[p].entry).slice(0, 15).map(p => `- ${p}${files[p].purpose ? ` — ${files[p].purpose}` : ''}`)]);
  const gate = readJsonFile(join(root, '.orchestrator', 'gate.json'));
  if (gate && Array.isArray(gate.gate) && gate.gate.length) sections.push(['## Checks (from gate.json)', gate.gate.map(c => `- ${c.kind}: \`${c.cmd}\``)]);
  const c = map.counts;
  const foot = `${c.code} code files of ${c.indexed} in the index, ${c.edges} import edges, tests linked to ${c.linkedSources} files.`;

  // Fill to the cap, cutting list items from the end of each section rather
  // than dropping a section.
  let lines = [...head, ''];
  let budget = MD_CAP - foot.length - lines.join('\n').length - 2;
  const perSection = sections.map(([title, items]) => ({ title, items }));
  for (const s of perSection) {
    if (!s.items.length) continue;
    const block = [s.title];
    let used = s.title.length + 1;
    const share = Math.floor(budget / Math.max(1, perSection.filter(x => x.items.length).length));
    for (const it of s.items) { if (used + it.length + 1 > Math.max(share, 400)) break; block.push(it); used += it.length + 1; }
    if (block.length === 1) continue;
    lines.push(...block, '');
  }
  lines.push(foot);
  let md = lines.join('\n') + '\n';
  if (md.length > MD_CAP) md = md.slice(0, MD_CAP - 2) + '…\n';
  return md;
}

export function status(root) {
  const map = readJsonFile(join(mapDir(root), 'map.json'));
  const head = headOf(root);
  if (!map || map.v !== MAP_V) return { state: 'missing', head };
  const md = existsSync(join(mapDir(root), 'map.md')) ? readFileSync(join(mapDir(root), 'map.md'), 'utf8').length : 0;
  return { state: map.head === head ? 'fresh' : 'stale', head, mapHead: map.head, builtAt: map.builtAt, counts: map.counts, mdChars: md, mdPath: join(mapDir(root), 'map.md') };
}

export function load(root) {
  const s = status(root);
  if (s.state !== 'fresh') return build(root).map;
  return readJsonFile(join(mapDir(root), 'map.json'));
}

// A path as typed, to one file in the map: exact, then a unique suffix.
export function findFile(map, q) {
  const n = String(q).replace(/\\/g, '/').replace(/^\.\//, '');
  if (map.files[n]) return n;
  const hits = Object.keys(map.files).filter(p => p.endsWith('/' + n));
  return hits.length === 1 ? hits[0] : hits.length ? hits : null;
}

const CAP = 40;
const capped = (lines, what) => (lines.length > CAP ? [...lines.slice(0, CAP), `… ${lines.length - CAP} more ${what}`] : lines);

export function whoUses(map, q, root) {
  const f = findFile(map, q);
  if (Array.isArray(f)) return [`"${q}" matches ${f.length} files; give more of the path:`, ...f.slice(0, 10).map(p => `  ${p}`)];
  if (f) {
    const l = (map.importers[f] || []).map(([p, line]) => `${p}:${line}${map.files[p].test ? '  (test)' : ''}`);
    return l.length ? capped(l, 'importers') : [`nothing in the map imports ${f} (dynamic loads and package-name imports are not seen; grep to be sure)`];
  }
  // A symbol: where it is defined, then the lines in importing files that name it.
  const defs = [];
  for (const [p, info] of Object.entries(map.files)) for (const [name, kind, line] of info.symbols || []) if (name === q) defs.push([p, kind, line]);
  if (!defs.length) return [`no file or symbol named "${q}" in the map; grep for text`];
  const out = [];
  const word = new RegExp(`\\b${String(q).replace(/[$]/g, '\\$')}\\b`);
  for (const [p, kind, line] of defs) {
    out.push(`${p}:${line}  defines ${kind} ${q}`);
    for (const f of [p, ...(map.importers[p] || []).map(([imp]) => imp)]) {
      let text = '';
      try { text = readFileSync(join(root, f), 'utf8'); } catch { continue; }
      text.split('\n').forEach((l, i) => { if (word.test(l) && !(f === p && i + 1 === line)) out.push(`${f}:${i + 1}  ${l.trim().slice(0, 100)}`); });
    }
  }
  return capped(out, 'lines');
}

export function deps(map, q) {
  const f = findFile(map, q);
  if (!f || Array.isArray(f)) return [`no single file matches "${q}"`];
  const l = (map.files[f].imports || []).map(([p, line]) => `${f}:${line}  ${p}`);
  return l.length ? capped(l, 'imports') : [`${f} imports nothing else in the repo`];
}

export function testsFor(map, qs) {
  const out = [];
  const seen = new Set();
  for (const q of qs) {
    const f = findFile(map, q);
    if (!f || Array.isArray(f)) { out.push(`no single file matches "${q}"`); continue; }
    for (const [t, why] of map.testsFor[f] || []) {
      if (seen.has(t)) continue;
      seen.add(t);
      out.push(`${t}  (${why}${qs.length > 1 ? `, for ${f}` : ''})`);
    }
  }
  return out.length ? capped(out, 'tests') : ['no test in the map imports or pairs with these files; run the full gate'];
}

function main() {
  const args = process.argv.slice(2);
  const i = args.indexOf('--repo');
  const repoArg = i >= 0 ? args.splice(i, 2)[1] : null;
  const json = args.includes('--json');
  const [cmd, ...rest] = args.filter(a => a !== '--json');
  const top = git(resolvePath(repoArg || process.cwd()), ['rev-parse', '--show-toplevel']);
  if (top.status !== 0) { console.error('map.mjs: not inside a git repository'); process.exit(2); }
  const root = resolvePath(top.stdout.trim());
  if (cmd === 'build') {
    const { map, md, ms } = build(root);
    const c = map.counts;
    console.log(json ? JSON.stringify({ ...c, ms, mdChars: md.length }) : `map: ${c.code} code files (${c.scanned} scanned, rest cached), ${c.edges} import edges, tests linked to ${c.linkedSources} files, ${ms} ms\n${join(mapDir(root), 'map.md')} (${md.length} chars)`);
    return;
  }
  if (cmd === 'status') {
    const s = status(root);
    console.log(json ? JSON.stringify(s) : s.state === 'missing' ? 'map: none yet (node map.mjs build)' : `map: ${s.state}${s.state === 'stale' ? ` (built at ${String(s.mapHead).slice(0, 7)}, HEAD is ${String(s.head).slice(0, 7)})` : ''} · ${s.counts.code} code files · ${s.mdChars} chars · ${s.mdPath}`);
    return;
  }
  const queries = { 'who-uses': () => whoUses(load(root), rest[0], root), deps: () => deps(load(root), rest[0]), 'tests-for': () => testsFor(load(root), rest) };
  if (!queries[cmd] || (cmd !== 'tests-for' && !rest[0]) || (cmd === 'tests-for' && !rest.length)) {
    console.error('usage: map.mjs build | status | who-uses <file|symbol> | deps <file> | tests-for <file…>  [--repo <dir>] [--json]');
    process.exit(2);
  }
  const lines = queries[cmd]();
  console.log(json ? JSON.stringify(lines) : lines.join('\n'));
}

if (process.argv[1] && resolvePath(process.argv[1]) === SELF) {
  try { main(); } catch (e) { console.error(`map.mjs: ${e && e.message}`); process.exit(1); }
}
