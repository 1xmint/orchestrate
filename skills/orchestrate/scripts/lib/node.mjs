// lib/node.mjs — the Node built-ins the plugin's scripts use, loaded the cheap
// way. Every script outside the tests takes `fs`, `crypto` and `child_process`
// from here, never from 'node:fs' and the rest directly (node.test.mjs holds it).
//
// A hook is a new Node process on every tool call, prompt and Stop, so what it
// loads before its first line runs is paid hundreds of times a session, and the
// user waits for it each time. Imported as an ES module, 'node:fs' builds its
// whole export list and so loads the promise and stream halves of fs too;
// 'node:crypto' and 'node:child_process' each load a large part of Node. Taken
// through `require`, fs comes without its lazy parts, and crypto and
// child_process are loaded only when a hash or a command is first needed. A
// hook on an ordinary tool call now loads none of them (measured 2026-10-03,
// STATE.md).
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const fs = require('node:fs');

export const {
  appendFileSync, closeSync, copyFileSync, createWriteStream, existsSync, fstatSync,
  mkdirSync, openSync, readFileSync, readSync, readdirSync, realpathSync,
  renameSync, rmSync, rmdirSync, statSync, unlinkSync, utimesSync, writeFileSync, writeSync,
} = fs;

export const createHash = (...a) => require('node:crypto').createHash(...a);
export const spawnSync = (...a) => require('node:child_process').spawnSync(...a);
export const spawn = (...a) => require('node:child_process').spawn(...a);
export const execFileSync = (...a) => require('node:child_process').execFileSync(...a);
