// policy.test.mjs — the efficiency numbers every hook reads, their defaults,
// and how a saved profile can override them without ever breaking a hook on a
// bad value.
//   node --test skills/orchestrate/scripts/lib/policy.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPolicy, sizeBudget, setPolicyValue, DEFAULT_POLICY } from './policy.mjs';

test('loadPolicy with no profile at all returns the documented defaults', () => {
  const p = loadPolicy(null);
  assert.equal(p.context.checkpointAt, DEFAULT_POLICY.context.checkpointAt);
  assert.equal(p.workers.maxConcurrent, DEFAULT_POLICY.workers.maxConcurrent);
  assert.equal(p.workers.generalPurpose, 'deny');
  assert.equal(p.codex.effortImplement, 'medium');
});

test('loadPolicy takes a valid override and ignores an invalid one, falling back to the default', () => {
  const p = loadPolicy({ policy: { context: { checkpointAt: 5000, compactAt: -1 } } });
  assert.equal(p.context.checkpointAt, 5000, 'valid override applied');
  assert.equal(p.context.compactAt, DEFAULT_POLICY.context.compactAt, 'negative value rejected, default kept');
});

test('loadPolicy rejects an out-of-range windowFraction and an unknown workers.nested value', () => {
  const p = loadPolicy({ policy: { context: { windowFraction: 3 }, workers: { nested: 'sideways' } } });
  assert.equal(p.context.windowFraction, DEFAULT_POLICY.context.windowFraction);
  assert.equal(p.workers.nested, DEFAULT_POLICY.workers.nested);
});

test('loadPolicy accepts a valid workers.nested value and workers.generalPurpose=allow', () => {
  const p = loadPolicy({ policy: { workers: { nested: 'allow', generalPurpose: 'allow' } } });
  assert.equal(p.workers.nested, 'allow');
  assert.equal(p.workers.generalPurpose, 'allow');
});

test('loadPolicy parses autocompactDefault as a bare number, a "k" suffix, or "off"', () => {
  assert.equal(loadPolicy({ policy: { context: { autocompactDefault: '50k' } } }).context.autocompactDefault, 50000);
  assert.equal(loadPolicy({ policy: { context: { autocompactDefault: 'off' } } }).context.autocompactDefault, 'off');
  assert.equal(loadPolicy({ policy: { context: { autocompactDefault: 'garbage' } } }).context.autocompactDefault, DEFAULT_POLICY.context.autocompactDefault);
});

test('loadPolicy merges a per-role size budget on top of the defaults, keeping the untouched roles', () => {
  const p = loadPolicy({ policy: { workers: { size: { 'orch-researcher': { warnAt: 1000, returnAt: 2000 } } } } });
  assert.deepEqual(p.workers.size['orch-researcher'], { warnAt: 1000, returnAt: 2000 });
  assert.deepEqual(p.workers.size['orch-coordinator'], DEFAULT_POLICY.workers.size['orch-coordinator']);
  assert.deepEqual(p.workers.size.default, DEFAULT_POLICY.workers.size.default);
});

test('loadPolicy rejects a size pair where warnAt is not below returnAt, falling back to that role\'s own default', () => {
  const p = loadPolicy({ policy: { workers: { size: { 'orch-coordinator': { warnAt: 300000, returnAt: 100000 } } } } });
  assert.deepEqual(p.workers.size['orch-coordinator'], DEFAULT_POLICY.workers.size['orch-coordinator']);
});

// ---- sizeBudget --------------------------------------------------------------

test('sizeBudget strips a plugin prefix and falls back to "default" for an unknown role', () => {
  const policy = loadPolicy(null);
  assert.deepEqual(sizeBudget('orchestrate:orch-coordinator', policy), policy.workers.size['orch-coordinator']);
  assert.deepEqual(sizeBudget('some-unlisted-role', policy), policy.workers.size.default);
});

// ---- setPolicyValue -----------------------------------------------------------

test('setPolicyValue writes a scalar under policy.<section>.<key>, coercing numbers and booleans', () => {
  const out = setPolicyValue({}, 'context.compactAt', '180000');
  assert.equal(out.policy.context.compactAt, 180000);
  const out2 = setPolicyValue(out, 'codex.enabled', 'false');
  assert.equal(out2.policy.codex.enabled, false);
});

test('setPolicyValue rejects an unknown dotted key', () => {
  assert.throws(() => setPolicyValue({}, 'workers.notARealKey', '1'), /unknown policy key/);
});

test('setPolicyValue takes the workers.size.<role>.<field> form and rejects a non-positive value', () => {
  const out = setPolicyValue({}, 'workers.size.orch-implementer.warnAt', '90000');
  assert.equal(out.policy.workers.size['orch-implementer'].warnAt, 90000);
  assert.throws(() => setPolicyValue({}, 'workers.size.orch-implementer.warnAt', '-5'), /workers\.size/);
});
