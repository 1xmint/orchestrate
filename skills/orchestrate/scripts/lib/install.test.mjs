// install.test.mjs — plan-tier detection and installed-role-agent counting,
// split out of tier.test.mjs. These are small, but each one is read by a hook
// that runs on every prompt or every dispatch, so a wrong answer here is wrong
// everywhere.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { AGENT_NAMES } from './install.mjs';

const INSTALL = new URL('./install.mjs', import.meta.url).href;

// Run a snippet against this module with a HOME of its own. The active-run
// pointer lives under the real ~/.claude/orchestrate, so a test that wrote it
// in process would repoint the developer's own machine at a temp directory.
function inFakeHome(code, setup, env = {}) {
  const home = mkdtempSync(join(tmpdir(), 'orch-fakehome-'));
  if (setup) { mkdirSync(join(home, '.claude', 'orchestrate'), { recursive: true }); setup(home); }
  // The desktop app's own folders and session id are the developer's; a test
  // that inherited them would read the real account.
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
    encoding: 'utf8', env: { ...process.env, HOME: home, USERPROFILE: home, APPDATA: join(home, 'AppData', 'Roaming'), XDG_CONFIG_HOME: join(home, '.config'), CLAUDE_CODE_HOST_SESSION_ID: '', ...env },
  });
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stdout.trim();
}

test('a profile file from an older version still reads', () => {
  const out = JSON.parse(inFakeHome(`
    const { detectTier, routerSettings } = await import(${JSON.stringify(INSTALL)});
    console.log(JSON.stringify({ tier: detectTier(), router: routerSettings() }));
  `, home => {
    // The shape v0.7 wrote, including keys nothing reads any more.
    writeFileSync(join(home, '.claude', 'orchestrate', 'profile.json'), JSON.stringify({
      tier: 'max20', setAt: '2026-09-01T00:00:00Z', weekDollars: 600, weekSetAt: '2026-09-01',
      manager: { model: 'opus', effort: 'high', tier: 'max20', accepted: true },
      router: { enabled: true, haiku: false },
    }));
  }));
  assert.equal(out.tier.tier, 'max20');
  assert.equal(out.router.enabled, true);
});

test('the plan is read from the account type when the rate-limit tier is generic', () => {
  // The shape a current host writes for a Pro account: the rate-limit tier says
  // nothing ("default_claude_ai"), the organization type says Pro.
  const read = oauthAccount => JSON.parse(inFakeHome(`
    const { detectTier } = await import(${JSON.stringify(INSTALL)});
    console.log(JSON.stringify(detectTier()));
  `, home => writeFileSync(join(home, '.claude.json'), JSON.stringify({ oauthAccount }))));
  const pro = read({ billingType: 'stripe_subscription', seatTier: null, organizationType: 'claude_pro', organizationRateLimitTier: 'default_claude_ai', userRateLimitTier: null });
  assert.equal(pro.tier, 'pro');
  assert.match(pro.source, /organizationType="claude_pro"/);
  assert.equal(read({ organizationType: 'claude_max', organizationRateLimitTier: 'default_claude_max_20x' }).tier, 'max20');
  assert.equal(read({ organizationType: 'claude_max' }).tier, 'max5');
});

test('the plan follows the account the session runs on, and is remembered per account', () => {
  const PROFILE = new URL('../profile.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
  const home = mkdtempSync(join(tmpdir(), 'orch-acct-'));
  mkdirSync(join(home, '.claude', 'orchestrate'), { recursive: true });
  // The terminal last signed in to a Pro org; the desktop app runs this session
  // on another org.
  writeFileSync(join(home, '.claude.json'), JSON.stringify({ oauthAccount: { accountUuid: 'aaaa1111-pro', organizationUuid: 'org-pro-1111', organizationType: 'claude_pro' } }));
  const desktopOrg = join(home, 'AppData', 'Roaming', 'Claude', 'claude-code-sessions', 'bbbb2222-max', 'org-max-2222');
  mkdirSync(desktopOrg, { recursive: true });
  writeFileSync(join(desktopOrg, 'local_desk-1234.json'), '{}');
  const env = host => ({ ...process.env, HOME: home, USERPROFILE: home, APPDATA: join(home, 'AppData', 'Roaming'), XDG_CONFIG_HOME: join(home, '.config'), CLAUDE_CODE_HOST_SESSION_ID: host });
  const tier = host => JSON.parse(spawnSync(process.execPath, ['--input-type=module', '-e',
    `const { detectTier } = await import(${JSON.stringify(INSTALL)}); console.log(JSON.stringify(detectTier()));`],
  { encoding: 'utf8', env: env(host) }).stdout.trim());

  assert.equal(tier('').tier, 'pro', 'a terminal session is the account in the file');
  const desk = tier('local_desk-1234');
  assert.equal(desk.tier, 'unknown', 'the file describes another account, so its plan is not borrowed');
  assert.match(desk.source, /different Claude account \(org-max-\).*that one is pro/);

  const set = spawnSync(process.execPath, [PROFILE, '--set', 'tier=max5'], { encoding: 'utf8', env: env('local_desk-1234') });
  assert.match(set.stdout, /plan saved for this Claude account \(org-max-\): max5/);
  assert.equal(tier('local_desk-1234').tier, 'max5', 'remembered for the desktop account');
  assert.equal(tier('').tier, 'pro', 'and not applied to the other account');
  assert.equal(tier('../../etc').tier, 'pro', 'an id shaped like a path is ignored');
});

// A plugin install registers the six role agents from the plugin's own folder
// and copies nothing into ~/.claude/agents. Counting only the loose copies
// reported "agents 0/6 (missing ...)" on a perfectly good plugin install, and
// would have sent the model off to install a second set that then shadowed the
// plugin's own.
test('every role agent counts whether they are loose files or inside a plugin', () => {
  const names = AGENT_NAMES;
  const ask = home => JSON.parse(spawnSync(process.execPath, ['--input-type=module', '-e',
    `const { agentsInstalled } = await import(${JSON.stringify(INSTALL)}); console.log(JSON.stringify(agentsInstalled()));`,
  ], { encoding: 'utf8', env: { ...process.env, HOME: home, USERPROFILE: home } }).stdout.trim());

  const home = mkdtempSync(join(tmpdir(), 'orch-agentcount-'));
  assert.equal(ask(home).installed, 0, 'nothing installed either way');

  const pdir = join(home, '.claude', 'plugins', 'cache', 'orchestrate', 'orchestrate', '9.9.9', 'skills', 'orchestrate', 'assets', 'agents');
  mkdirSync(pdir, { recursive: true });
  for (const n of names) writeFileSync(join(pdir, `${n}.md`), `---
name: ${n}
---
`);
  const viaPlugin = ask(home);
  assert.equal(viaPlugin.installed, names.length, 'found inside the plugin');
  assert.deepEqual(viaPlugin.missing, []);
  assert.equal(viaPlugin.source, 'plugin');

  // Loose files still win when every role is there, so a script install is
  // unaffected and still reports its own directory.
  const loose = join(home, '.claude', 'agents');
  mkdirSync(loose, { recursive: true });
  for (const n of names) writeFileSync(join(loose, `${n}.md`), `---
name: ${n}
---
`);
  const viaFiles = ask(home);
  assert.equal(viaFiles.installed, names.length);
  assert.equal(viaFiles.source, 'files');
});

// observations.md: the card said "orch-agents 6/8 (missing orch-coordinator,
// orch-advisor)" while a plugin install of all 8 was in use. Names the exact
// two missing so a stale read is caught, not just a wrong total.
test('a plugin install missing two named agents reports exactly those two, not a stale count', () => {
  const names = AGENT_NAMES;
  const ask = home => JSON.parse(spawnSync(process.execPath, ['--input-type=module', '-e',
    `const { agentsInstalled } = await import(${JSON.stringify(INSTALL)}); console.log(JSON.stringify(agentsInstalled()));`,
  ], { encoding: 'utf8', env: { ...process.env, HOME: home, USERPROFILE: home } }).stdout.trim());

  const home = mkdtempSync(join(tmpdir(), 'orch-agentcount-missing-'));
  const pdir = join(home, '.claude', 'plugins', 'cache', 'orchestrate', 'orchestrate', '0.16.1', 'skills', 'orchestrate', 'assets', 'agents');
  mkdirSync(pdir, { recursive: true });
  const missingOnDisk = ['orch-coordinator', 'orch-advisor'];
  for (const n of names) {
    if (missingOnDisk.includes(n)) continue;
    writeFileSync(join(pdir, `${n}.md`), `---
name: ${n}
---
`);
  }
  const out = ask(home);
  assert.equal(out.installed, names.length - missingOnDisk.length);
  assert.deepEqual([...out.missing].sort(), [...missingOnDisk].sort());
  assert.equal(out.source, 'plugin');
});

// An update leaves the plugin cache holding both the old and the new version's
// agent folders (nothing prunes the old one). Reading whichever the
// filesystem listed first could land on the stale pre-update folder and
// report agents from the current, complete install as "missing" — this is the
// live bug: "orch-agents 6/8 (missing orch-coordinator, orch-advisor)" while
// both were dispatching fine, because they were added to the plugin after the
// stale cached version.
test('a stale version still in the plugin cache never shadows a complete newer install', () => {
  const names = AGENT_NAMES;
  const home = mkdtempSync(join(tmpdir(), 'orch-agentcount-stalecache-'));
  const oldDir = join(home, '.claude', 'plugins', 'cache', 'orchestrate', 'orchestrate', '0.15.0', 'skills', 'orchestrate', 'assets', 'agents');
  const newDir = join(home, '.claude', 'plugins', 'cache', 'orchestrate', 'orchestrate', '0.16.1', 'skills', 'orchestrate', 'assets', 'agents');
  mkdirSync(oldDir, { recursive: true });
  mkdirSync(newDir, { recursive: true });
  // Old cached version predates orch-coordinator and orch-advisor.
  for (const n of names.filter(n => n !== 'orch-coordinator' && n !== 'orch-advisor')) {
    writeFileSync(join(oldDir, `${n}.md`), `---
name: ${n}
---
`);
  }
  for (const n of names) {
    writeFileSync(join(newDir, `${n}.md`), `---
name: ${n}
---
`);
  }
  const out = JSON.parse(spawnSync(process.execPath, ['--input-type=module', '-e',
    `const { agentsInstalled } = await import(${JSON.stringify(INSTALL)}); console.log(JSON.stringify(agentsInstalled()));`,
  ], { encoding: 'utf8', env: { ...process.env, HOME: home, USERPROFILE: home } }).stdout.trim());
  assert.equal(out.installed, names.length, 'the complete newer version is the one counted');
  assert.deepEqual(out.missing, []);
  assert.equal(out.source, 'plugin');
});
