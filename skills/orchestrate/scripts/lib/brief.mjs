// lib/brief.mjs — the project's own "What this is for" section: finding it
// across a folder chain and a worktree's main checkout, whether Claude Code
// already keeps it in view, and the note printed when it does not. Split out
// because locating and reading that one section is a self-contained job
// nothing else in router.mjs needs to know the shape of.

import { readFileSync, existsSync, statSync } from './node.mjs';
import { join, dirname, resolve } from 'node:path';
import { sectionExcerpt } from './resume.mjs';
import { DIR, readJson, writeJsonAtomic } from './tier.mjs';

// Where "this project has already been told" is remembered across sessions,
// keyed by project root. Kept separate from the profile so a corrupt or
// unwritable file here never touches anything else this plugin remembers.
const BRIEF_MISSING_STORE = join(DIR, 'brief-missing.json');

function normRoot(root) {
  return String(root || '').replace(/\\/g, '/').toLowerCase();
}

// Has this project root already been told, in an earlier session? Read
// failures (missing file, bad JSON, unreadable home folder) all read as "no" —
// the in-session flag on `state` is what keeps a broken store from repeating
// the line within one session.
function alreadyToldAcrossSessions(store, root) {
  const data = readJson(store);
  return Boolean(data && data.roots && data.roots[normRoot(root)]);
}

function rememberToldAcrossSessions(store, root) {
  try {
    const data = readJson(store) || { v: 1, roots: {} };
    if (!data.roots || typeof data.roots !== 'object') data.roots = {};
    data.roots[normRoot(root)] = new Date().toISOString();
    writeJsonAtomic(store, data);
  } catch {}
}

// ---- the brief: the project's own "What this is for" -----------------------
// "The brief" is that section of the project's instruction file, not a
// separate file this plugin keeps. BRIEF_CAP is the original design's number,
// kept because the section is meant to read as one paragraph plus two short
// lists, not a whole document.
export const BRIEF_CAP = 900;

// No /m: with it, `$` matches at every line break, not just end-of-string, so
// the lazy body group could stop on the section's very first blank line.
const BRIEF_SECTION_RE = /(?:^|\n)##\s+What this is for\b[ \t]*\n([\s\S]*?)(?:\n##\s|\s*$)/i;
// Checked in this order in every folder: the files Claude Code is sure to keep
// loaded while working in that folder, then the two shapes of `AGENTS.md`.
const BRIEF_KEPT_FILES = ['CLAUDE.md', join('.claude', 'CLAUDE.md'), 'CLAUDE.local.md'];
const BRIEF_AGENTS_FILES = ['AGENTS.md', join('.claude', 'AGENTS.md')];

function readBriefSection(filePath) {
  let text = '';
  try { text = readFileSync(filePath, 'utf8'); } catch { return null; }
  const body = sectionExcerpt(text, [{ pattern: BRIEF_SECTION_RE }], BRIEF_CAP, { intro: false });
  return body || null;
}

// A bare `AGENTS.md` counts as "kept in view" only when one of the files
// Claude Code always loads in that folder pulls it in with a first line of
// `@AGENTS.md` — an `@` import loads the whole file, so that line is enough.
function agentsPulledIn(folder) {
  for (const f of BRIEF_KEPT_FILES) {
    try {
      if (/^@AGENTS\.md\s*$/m.test(readFileSync(join(folder, f), 'utf8'))) return true;
    } catch {}
  }
  return false;
}

const normSlashes = p => String(p || '').replace(/\\/g, '/');

function isAncestorOrSelf(folder, of) {
  if (!folder || !of) return false;
  const a = normSlashes(resolve(folder)).toLowerCase();
  const b = normSlashes(resolve(of)).toLowerCase();
  return b === a || b.startsWith(a.endsWith('/') ? a : `${a}/`);
}

// Nearest folder first, the way Claude Code resolves nested instruction files.
function folderChain(dir, root) {
  const chain = [];
  let d = resolve(dir || root);
  const r = resolve(root);
  for (let i = 0; i < 40; i++) {
    chain.push(d);
    if (normSlashes(d).toLowerCase() === normSlashes(r).toLowerCase()) break;
    const parent = dirname(d);
    if (parent === d) break;
    d = parent;
  }
  return chain;
}

// `<root>/.git` is a file, not a folder, in a worktree; it names the main
// checkout's own `.git` folder two levels up from `.git/worktrees/<name>`. No
// `git` process — this is one small text file.
function mainCheckoutFromGitFile(gitFile) {
  let txt = '';
  try { txt = readFileSync(gitFile, 'utf8'); } catch { return null; }
  const m = /^gitdir:\s*(.+?)\s*$/m.exec(txt);
  if (!m) return null;
  let gitdir = normSlashes(m[1]);
  if (!/^[a-zA-Z]:\//.test(gitdir) && !gitdir.startsWith('/')) gitdir = normSlashes(resolve(dirname(gitFile), gitdir));
  const idx = gitdir.toLowerCase().indexOf('/.git/worktrees/');
  return idx < 0 ? null : gitdir.slice(0, idx);
}

// Walks `dir` up to `root`, nearest folder first, and returns the first
// section found plus whether it sits somewhere Claude Code is sure to keep
// loaded (`launchFolder` is the session's own cwd; only files at or above it
// are ever in that set). A worktree's main-checkout `CLAUDE.local.md` is
// checked last and is never "kept in view" — it lives in a different checkout.
function findBriefSection(dir, root, launchFolder) {
  for (const folder of folderChain(dir, root)) {
    const atOrAbove = launchFolder ? isAncestorOrSelf(folder, launchFolder) : false;
    for (const f of BRIEF_KEPT_FILES) {
      const body = readBriefSection(join(folder, f));
      if (body) return { file: join(folder, f), text: body, keptInView: atOrAbove, reason: 'above' };
    }
    for (const f of BRIEF_AGENTS_FILES) {
      const body = readBriefSection(join(folder, f));
      if (body) return { file: join(folder, f), text: body, keptInView: atOrAbove && agentsPulledIn(folder), reason: 'above' };
    }
  }
  try {
    const gitFile = join(root, '.git');
    if (existsSync(gitFile) && statSync(gitFile).isFile()) {
      const main = mainCheckoutFromGitFile(gitFile);
      if (main) {
        const body = readBriefSection(join(main, 'CLAUDE.local.md'));
        if (body) return { file: join(main, 'CLAUDE.local.md'), text: body, keptInView: false, reason: 'worktree' };
      }
    }
  } catch {}
  return null;
}

// The project this session is in, its brief section if there is one, and
// whether Claude Code is already showing it. `root` falls back from the
// launch folder's own repo, to a bound run's repo, to the folder
// context-check.mjs has learned from touched paths (`state.work`) — the only
// way an above-project session ever learns where it is working.
export function briefState(ctx, state) {
  const root = ctx.repoRoot || (ctx.run && ctx.run.root) || (state.work && state.work.root) || null;
  if (!root) return { kind: 'none' };
  const dir = (state.work && state.work.dir) || root;
  const launchFolder = ctx.repoRoot ? (ctx.cwd || ctx.repoRoot) : null;
  const found = findBriefSection(dir, root, launchFolder);
  if (!found) return { kind: 'missing', root, dir };
  return { kind: found.keptInView ? 'kept' : 'other', root, dir, file: found.file, text: found.text, reason: found.reason };
}

// Prints per the outcome table: nothing when Claude Code already shows the
// section; the "missing" line once per session; the section's own text, once
// per epoch (the file that earned it changing counts as a new epoch too), on
// the first prompt after the root is known and again — forced — right after a
// compaction, since a summary drops everything a hook said before it.
export function briefNote(ctx, state, { force = false, store = BRIEF_MISSING_STORE } = {}) {
  const b = briefState(ctx, state);
  if (b.kind === 'none') return '';
  if (b.kind === 'missing') {
    if (state.briefMissingShown) return '';
    state.briefMissingShown = true;
    if (alreadyToldAcrossSessions(store, b.root)) return '';
    rememberToldAcrossSessions(store, b.root);
    // A fact and a pointer, not a file to write: which file the section goes in
    // depends on whether the repo is public (references/brief.md), and a
    // tracked CLAUDE.md in a public repo would be published on the next push
    // (prompt review, 2026-10-03).
    return `[orchestrate · brief] CLAUDE.md and AGENTS.md have no "What this is for" section; the skill's brief.md says what goes in it and where (untracked in a public repo).`;
  }
  if (b.kind === 'kept') { state.briefSentFor = null; return ''; }
  if (!force && state.briefSentFor === b.file) return '';
  state.briefSentFor = b.file;
  const where = b.reason === 'worktree' ? 'this is a worktree and the file lives in the main checkout' : 'this session was started above the project';
  return `[orchestrate · brief] from ${b.file}. Claude Code does not keep this file in view here (${where}), so its "What this is for" section is copied below, and again after each summary.\n${b.text}`;
}
