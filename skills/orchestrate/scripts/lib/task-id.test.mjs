// lib/task-id.test.mjs — the one rule for reading a packet's TASK id.
//   node --test skills/orchestrate/scripts/lib/task-id.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { taskIdIn } from './task-id.mjs';

test('a TASK line whose token has a digit is read as the id', () => {
  assert.equal(taskIdIn('TASK: 9-27-0056\nmore'), '9-27-0056');
  assert.equal(taskIdIn('TASK: 0004\nmore'), '0004');
  assert.equal(taskIdIn('TASK: r6-3\nmore'), 'r6-3');
});

test('a TASK line whose token has no digit is prose, not an id', () => {
  assert.equal(taskIdIn('TASK: build the login page'), null);
  assert.equal(taskIdIn('TASK: x'), null);
});

test('no TASK line, or an empty packet, is null', () => {
  assert.equal(taskIdIn(''), null);
  assert.equal(taskIdIn('OBJECTIVE\ndo the thing'), null);
  assert.equal(taskIdIn(undefined), null);
});

test('leading spaces before TASK: still match, matching a packet indented for readability', () => {
  assert.equal(taskIdIn('  TASK: 9-1-0002\nmore'), '9-1-0002');
});

test('TASK: only matches at the start of a line, not a mention mid-line', () => {
  assert.equal(taskIdIn('see TASK: 9-1-0002 above\nOBJECTIVE\ndo it'), null);
});

test('case: lower/mixed-case "task:" is ignored unless caseInsensitive is asked for', () => {
  assert.equal(taskIdIn('task: 9-1-0002'), null);
  assert.equal(taskIdIn('task: 9-1-0002', { caseInsensitive: true }), '9-1-0002');
  assert.equal(taskIdIn('TaSk: 9-1-0002', { caseInsensitive: true }), '9-1-0002');
});
