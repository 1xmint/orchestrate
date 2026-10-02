import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scan, format } from "./hook-bytes.mjs";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "hook-bytes");
const res = scan(dir);
const row = (tag) => res.rows.find((r) => r.tag === tag);
const bytes = (s) => Buffer.byteLength(s);

test("counts injections and bytes per tag, skipping the duplicate hook_success stdout and repeated uuids", () => {
  assert.equal(res.sessions, 2);
  // two size injections in one.jsonl; the same uuid copied into two.jsonl and the hook_success stdout are skipped
  assert.equal(row("size").injections, 2);
  assert.equal(row("size").bytes, bytes("[orchestrate · size] SECRETWORD aaaa") + bytes("[orchestrate · size] bb"));
  assert.equal(row("size").sessionsWithTag, 1);
  assert.equal(row("size").bytesPerSession, Math.round(row("size").bytes / 2));
  assert.equal(row("context").injections, 1);
  assert.equal(row("(untagged)").injections, 1);
  assert.equal(row("guard").injections, 1);
});

test("counts Stop blocks and Stop summaries, not skill listings or chat", () => {
  assert.equal(res.stopBlocks, 1);
  assert.equal(res.stopSummaries, 1);
  assert.equal(res.rows.length, 5);
});

test("ranks by bytes per session", () => {
  const v = res.rows.map((r) => r.bytesPerSession);
  assert.deepEqual(v, [...v].sort((a, b) => b - a));
});

test("no transcript text other than tag names reaches the output", () => {
  const out = format(res);
  for (const leak of ["SECRETWORD", "aaaa", "untagged text", "Stop hold", "no PROGRESS", "ordinary"]) {
    assert.ok(!out.includes(leak), leak);
  }
});
