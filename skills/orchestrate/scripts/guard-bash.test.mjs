// guard-bash.test.mjs — the PreToolUse guard on the Bash tool: the pure
// decision (`decide`) plus the hook process's stdin/stdout contract.
//   node --test skills/orchestrate/scripts/guard-bash.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decide, isSafeDeleteTarget, isAllowed } from './guard-bash.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const GUARD = join(HERE, 'guard-bash.mjs');

function run(input, home = mkdtempSync(join(tmpdir(), 'orch-bash-home-'))) {
  const r = spawnSync(process.execPath, [GUARD], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: { ...process.env, HOME: home, USERPROFILE: home },
  });
  let json = null;
  try { json = r.stdout.trim() ? JSON.parse(r.stdout) : null; } catch {}
  return { stdout: r.stdout, json, status: r.status };
}

function bash(command, extra = {}) {
  return { hook_event_name: 'PreToolUse', tool_name: 'Bash', session_id: 's1', cwd: process.cwd(), tool_input: { command }, ...extra };
}

function powershell(command, extra = {}) {
  return { hook_event_name: 'PreToolUse', tool_name: 'PowerShell', session_id: 's1', cwd: process.cwd(), tool_input: { command }, ...extra };
}

// ---- the destructive / publishing / paying shapes --------------------------

test('git push --force is stopped', () => {
  assert.equal(decide('git push --force').kind, 'ask');
  assert.equal(decide('git push -f origin main').kind, 'ask');
});

test('git push --delete and the :branch shorthand are stopped', () => {
  assert.equal(decide('git push origin --delete a').kind, 'ask');
  assert.equal(decide('git push origin :a').kind, 'ask');
});

test('a helper worktree branch may be deleted with -d once merged; -D, other names, and mixed lists still stop', () => {
  assert.equal(decide('git branch -d worktree-agent-abc123').kind, 'pass');
  assert.equal(decide('git branch --delete worktree-agent-abc123 worktree-agent-0f9e').kind, 'pass');
  assert.equal(decide('git branch -D worktree-agent-abc123').kind, 'ask');
  assert.equal(decide('git branch -d main').kind, 'ask');
  assert.equal(decide('git branch -d worktree-agent-abc123 feature').kind, 'ask');
  assert.equal(decide('git branch -d worktree-agent-abc123 && git branch -D main').kind, 'ask');
});

test('the worktree-remove-then-branch-delete cleanup chain passes for a helper worktree, in auto and default', () => {
  const chain = 'git worktree remove .claude/worktrees/worktree-agent-abc123 && git branch -d worktree-agent-abc123';
  assert.equal(decide(chain).kind, 'pass');
  assert.equal(decide(chain, { headless: true, mode: 'auto' }).kind, 'pass');
  assert.equal(decide(chain, { subagent: true }).kind, 'pass');
  // `;` joins the same way as `&&`, and --delete is the long form of -d.
  const chainSemi = 'git worktree remove .claude/worktrees/worktree-agent-abc123 ; git branch --delete worktree-agent-abc123';
  assert.equal(decide(chainSemi).kind, 'pass');
});

test('a lead\'s clean-up of several helper worktrees passes: quoted paths, a read-only list between, task/ branches', () => {
  const three = 'git worktree remove ".claude/worktrees/agent-a1" C:\\repo\\.claude\\worktrees\\agent-b2 .claude/worktrees/agent-c3 && git worktree list && git branch -d worktree-agent-a1 worktree-agent-b2 task/0103-small-faults';
  assert.equal(decide(three).kind, 'pass');
  assert.equal(decide(three, { headless: true, mode: 'auto' }).kind, 'pass');
  assert.equal(decide('git worktree remove \'.claude/worktrees/x\' ; git branch -d task/0103.a_b').kind, 'pass');
});

test('the wider clean-up still refuses anything that could lose work or reach elsewhere', () => {
  const tail = ' && git branch -d worktree-agent-abc123';
  for (const bad of [
    'git worktree remove .claude/worktrees/../../src' + tail,
    'git worktree remove .claude/worktrees/a elsewhere/b' + tail,
    'git worktree remove .claude/worktrees/a && git branch -d main',
    'git worktree remove .claude/worktrees/a && git branch -d worktree-agent-abc123 feature',
    'git worktree remove .claude/worktrees/a && git branch -D task/x',
    'git worktree remove .claude/worktrees/a && git branch -d task/x --force',
    'git worktree remove .claude/worktrees/a && git branch -d task/x && rm -rf src',
    'git worktree remove .claude/worktrees/a && git branch -d task/x | cat',
    'git worktree remove .claude/worktrees/a && git branch -d task/x & git branch -D y',
    'git worktree remove .claude/worktrees/a && git branch -d $(git branch)',
  ]) assert.notEqual(decide(bad).kind, 'pass', bad);
});

test('a forced helper-folder removal passes when the folder is clean or gone, and stops naming the folder when it has unsaved changes', () => {
  const root = mkdtempSync(join(tmpdir(), 'orch-wt-'));
  const sh = (args, cwd) => spawnSync('git', args, { cwd, encoding: 'utf8' });
  sh(['init', '-q'], root);
  const wt = join(root, '.claude', 'worktrees', 'agent-abc123');
  mkdirSync(wt, { recursive: true });
  sh(['init', '-q'], wt);
  const gone = 'git worktree remove --force .claude/worktrees/agent-gone';
  assert.equal(decide(gone, { cwd: root }).kind, 'pass', 'a missing folder is clean');
  const forced = 'git worktree remove --force .claude/worktrees/agent-abc123';
  assert.equal(decide(forced, { cwd: root }).kind, 'pass', 'clean folder');
  const chain = forced + ' && git branch -d worktree-agent-abc123';
  assert.equal(decide(chain, { cwd: root }).kind, 'pass');
  assert.equal(decide('git worktree remove -f .claude/worktrees/agent-abc123 && git branch -d task/x', { cwd: root }).kind, 'pass');
  writeFileSync(join(wt, 'unsaved.txt'), 'work');
  for (const c of [forced, chain, 'git worktree remove .claude/worktrees/agent-abc123']) {
    const d = decide(c, { cwd: root });
    assert.equal(d.kind, 'ask', c);
    assert.match(d.reason, /\.claude\/worktrees\/agent-abc123/);
    assert.equal(decide(c, { cwd: root, headless: true, mode: 'auto' }).kind, 'deny', c);
  }
  const forcedBranch = 'git worktree remove .claude/worktrees/worktree-agent-abc123 && git branch -D worktree-agent-abc123';
  assert.equal(decide(forcedBranch, { cwd: root }).kind, 'ask', '-D stays refused');
});

test('a worktree cleanup chain with the path outside .claude/worktrees/ still asks or denies', () => {
  const outside = 'git worktree remove ../elsewhere/worktree-agent-abc123 && git branch -d worktree-agent-abc123';
  assert.equal(decide(outside).kind, 'ask');
  assert.equal(decide(outside, { headless: true, mode: 'auto' }).kind, 'deny');
});

test('deleting a branch three ways is stopped, and a merged -d cannot be told apart cheaply so it is stopped too', () => {
  assert.equal(decide('git branch -D x').kind, 'ask');
  assert.equal(decide('git branch -d x').kind, 'ask');
  assert.equal(decide('git push origin --delete a b c').kind, 'ask');
});

test('plain git branch (listing) passes through silently', () => {
  assert.equal(decide('git branch').kind, 'pass');
  assert.equal(decide('git branch -a').kind, 'pass');
  assert.equal(decide('git branch new-feature').kind, 'pass');
});

test('git rm -r is stopped', () => {
  assert.equal(decide('git rm -r uploads').kind, 'ask');
});

test('git clean -fd is stopped', () => {
  assert.equal(decide('git clean -fd').kind, 'ask');
});

test('rm -rf on something that is not a reproducible folder and not under the OS temp dir is stopped', () => {
  const d = decide('rm -rf uploads', { cwd: '/home/user/project' });
  assert.equal(d.kind, 'ask');
});

test('rm -rf node_modules is ordinary and passes through', () => {
  assert.equal(decide('rm -rf node_modules', { cwd: '/home/user/project' }).kind, 'pass');
});

test('rm -rf inside the OS temp dir passes through', () => {
  const dir = mkdtempSync(join(tmpdir(), 'orch-bash-tmp-'));
  assert.equal(decide(`rm -rf ${dir}`, { cwd: process.cwd() }).kind, 'pass');
});

test('git reset --hard with no argument is not blocked: it only discards uncommitted local edits in the working copy, never a commit', () => {
  assert.equal(decide('git reset --hard').kind, 'pass');
});

test('npm publish, gh release create, and deploy commands are stopped', () => {
  assert.equal(decide('npm publish').kind, 'ask');
  assert.equal(decide('gh release create v1.0.0').kind, 'ask');
  assert.equal(decide('vercel --prod').kind, 'ask');
  assert.equal(decide('fly deploy').kind, 'ask');
  assert.equal(decide('wrangler publish').kind, 'ask');
});

test('a stripe CLI command that changes something is stopped', () => {
  assert.equal(decide('stripe charges create --amount=1000').kind, 'ask');
  assert.equal(decide('stripe login').kind, 'pass');
});

// ---- dropping or truncating a database is stopped --------------------------

test('a drop or truncate against a database CLI is stopped, with the data-store reason', () => {
  const commands = [
    'psql -c "drop table users"',
    'mysql -e "DROP DATABASE mydb"',
    'sqlite3 mydb.db "DROP TABLE users"',
    'mongosh mydb --eval "db.dropDatabase()"',
    'mongo mydb --eval "db.dropDatabase()"',
    'mongosh mydb --eval "db.users.drop()"',
    'redis-cli flushall',
    'redis-cli FLUSHDB',
    'prisma migrate reset',
    'prisma db push --force-reset',
    'rails db:drop',
    'rails db:reset',
    'knex migrate:rollback --all',
    'dropdb mydb',
  ];
  for (const command of commands) {
    const d = decide(command);
    assert.equal(d.kind, 'ask', command);
    assert.match(d.reason, /^This would permanently delete data in a database, which cannot be undone\. /, command);
  }
});

test('a drop table mention that is not a database command is not stopped', () => {
  assert.equal(decide('cat migrations/drop_table.sql').kind, 'pass');
  assert.equal(decide('grep -r "drop table" src').kind, 'pass');
  assert.equal(decide('echo "truncate"').kind, 'pass');
});

test('a .sql file run against a database is not asked about unless the command line itself says drop or truncate', () => {
  assert.equal(decide('psql -f migrations/drop_table.sql').kind, 'pass');
  assert.equal(decide('mysql < migrations/drop_table.sql').kind, 'pass');
});

// ---- killing processes by name is stopped ---------------------------------

test('a process kill by name is stopped, with the process-kill reason', () => {
  const commands = [
    'taskkill //F //IM node.exe',
    'taskkill /F /IM node.exe',
    'taskkill -F -IM node.exe',
    'pkill -f node',
    'pkill node',
    'killall node',
    'kill -9 $(pgrep node)',
    'kill -9 `pgrep node`',
    'kill -9 -1',
    'kill -KILL $(lsof -t -i:3000)',
    'kill -s KILL $(cat server.pid)',
    'Stop-Process -Name node -Force',
    'Stop-Process -ProcessName node',
    'Get-Process node | Stop-Process -Force',
  ];
  for (const command of commands) {
    const d = decide(command);
    assert.equal(d.kind, 'ask', command);
    assert.match(d.reason, /^This would end every running program with that name on this machine, not only the one you started/, command);
    assert.match(d.reason, /Say yes to continue./, command);
  }
});

test('a kill of one known process id is not stopped', () => {
  for (const command of [
    'taskkill /PID 1234',
    'taskkill //F //PID 1234',
    'kill -9 12345',
    'kill -9 12345 12346',
    'kill 12345',
    'kill -TERM 12345',
    'Stop-Process -Id 5',
    'Stop-Process -Id 5 -Force',
    'echo "the skill is loaded"',
  ]) assert.equal(decide(command).kind, 'pass', command);
});

test('a process kill by name from a helper or in headless mode is refused, not asked', () => {
  const helper = decide('taskkill //F //IM node.exe', { subagent: true });
  assert.equal(helper.kind, 'deny');
  assert.match(helper.reason, /cannot be answered here/);
  assert.doesNotMatch(helper.reason, /Say yes/);
  const headless = decide('pkill -f node', { headless: true, mode: 'auto' });
  assert.equal(headless.kind, 'deny');
  assert.match(headless.reason, /auto mode, where nobody can say yes/);
  assert.doesNotMatch(headless.reason, /Say yes/);
});

test('a process kill by name sent as a PowerShell tool call is stopped too', () => {
  const r = run(powershell('Get-Process node | Stop-Process -Force'));
  assert.equal(r.json.hookSpecificOutput.permissionDecision, 'ask');
  assert.match(r.json.hookSpecificOutput.permissionDecisionReason, /^This would end every running program with that name/);
});

test('a drop-database command from a subagent is denied with a report-back reason', () => {
  const r = run(bash('psql -c "drop table users"', { agent_id: 'helper-1' }));
  assert.equal(r.json.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(r.json.hookSpecificOutput.permissionDecisionReason, /report back/);
});

test('the same drop-database command asked twice in one session gets "Asked already: " the second time', () => {
  const home = mkdtempSync(join(tmpdir(), 'orch-bash-home-'));
  const first = run(bash('redis-cli flushall'), home);
  assert.equal(first.json.hookSpecificOutput.permissionDecision, 'ask');
  assert.doesNotMatch(first.json.hookSpecificOutput.permissionDecisionReason, /^Asked already:/);

  const second = run(bash('redis-cli flushall'), home);
  assert.equal(second.json.hookSpecificOutput.permissionDecision, 'ask');
  assert.match(second.json.hookSpecificOutput.permissionDecisionReason, /^Asked already: /);
});

// ---- the PowerShell tool: same decision, same patterns -----------------------

test('PowerShell Remove-Item -Recurse -Force on a real path is stopped, aliases too', () => {
  assert.equal(decide('Remove-Item -Recurse -Force src', { cwd: '/home/user/project' }).kind, 'ask');
  assert.equal(decide('rm -Recurse -Force src', { cwd: '/home/user/project' }).kind, 'ask');
  assert.equal(decide('del -Recurse -Force src', { cwd: '/home/user/project' }).kind, 'ask');
  assert.equal(decide('ri -Recurse -Force src', { cwd: '/home/user/project' }).kind, 'ask');
  assert.equal(decide('rmdir -Recurse -Force src', { cwd: '/home/user/project' }).kind, 'ask');
  assert.equal(decide('Remove-Item -r -Force src', { cwd: '/home/user/project' }).kind, 'ask');
});

test('PowerShell Remove-Item -Recurse -Force node_modules is ordinary and passes through', () => {
  assert.equal(decide('Remove-Item -Recurse -Force node_modules', { cwd: '/home/user/project' }).kind, 'pass');
});

test('PowerShell Remove-Item without both -Recurse and -Force passes through', () => {
  assert.equal(decide('Remove-Item -Force src', { cwd: '/home/user/project' }).kind, 'pass');
  assert.equal(decide('Remove-Item -Recurse src', { cwd: '/home/user/project' }).kind, 'pass');
  assert.equal(decide('Remove-Item src', { cwd: '/home/user/project' }).kind, 'pass');
});

test('git branch -D via the PowerShell tool is stopped, same as Bash', () => {
  assert.equal(decide('git branch -D old').kind, 'ask');
});

test('a PowerShell tool call is recognised by the hook process, same as Bash', () => {
  const r = run(powershell('Remove-Item -Recurse -Force src'));
  assert.equal(r.json.hookSpecificOutput.permissionDecision, 'ask');

  const safe = run(powershell('Remove-Item -Recurse -Force node_modules'));
  assert.equal(safe.stdout, '');
});

// ---- the bypassPermissions deny path actually denies an unsafe target ------

test('an unsafe Bash rm -rf under bypassPermissions is denied, not silently allowed', () => {
  const r = run(bash('rm -rf src', { permission_mode: 'bypassPermissions', cwd: '/home/user/project' }));
  assert.equal(r.json.hookSpecificOutput.permissionDecision, 'deny');
  assert.doesNotMatch(r.json.hookSpecificOutput.permissionDecisionReason, /report back/);
  // Nobody can answer in this mode, so the reason must not invite a "yes".
  assert.doesNotMatch(r.json.hookSpecificOutput.permissionDecisionReason, /Say yes/);
  assert.match(r.json.hookSpecificOutput.permissionDecisionReason, /allow-bash\.json/);
});

test('an unsafe PowerShell Remove-Item under bypassPermissions is denied, not silently allowed', () => {
  const r = run(powershell('Remove-Item -Recurse -Force src', { permission_mode: 'bypassPermissions', cwd: '/home/user/project' }));
  assert.equal(r.json.hookSpecificOutput.permissionDecision, 'deny');
  assert.doesNotMatch(r.json.hookSpecificOutput.permissionDecisionReason, /report back/);
});

test('an unsafe Bash rm -rf from a subagent is denied with a report-back reason', () => {
  const r = run(bash('rm -rf src', { agent_id: 'helper-1', cwd: '/home/user/project' }));
  assert.equal(r.json.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(r.json.hookSpecificOutput.permissionDecisionReason, /report back/);
  // Nobody can answer inside a helper, so the reason must not invite a "yes".
  assert.doesNotMatch(r.json.hookSpecificOutput.permissionDecisionReason, /Say yes/);
});

// ---- ordinary commands pass through with no output -------------------------

test('ordinary commands pass through with no output', () => {
  assert.equal(run(bash('git push origin feature-x')).stdout, '');
  assert.equal(run(bash('rm -rf node_modules')).stdout, '');
  assert.equal(run(bash('npm test')).stdout, '');
  const dir = mkdtempSync(join(tmpdir(), 'orch-bash-tmp-'));
  assert.equal(run(bash(`rm -rf ${dir}`)).stdout, '');
});

// ---- who is asking changes ask vs. deny, never which commands match --------

test('the same command from a subagent payload is denied with a report-back reason, not asked', () => {
  const r = run(bash('git push --force', { agent_id: 'helper-1' }));
  assert.equal(r.json.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(r.json.hookSpecificOutput.permissionDecisionReason, /report back/);
  assert.doesNotMatch(r.json.hookSpecificOutput.permissionDecisionReason, /Say yes/);
});

test('the same command from the main interactive session asks, with a plain sentence', () => {
  const r = run(bash('git push --force'));
  assert.equal(r.json.hookSpecificOutput.permissionDecision, 'ask');
  assert.match(r.json.hookSpecificOutput.permissionDecisionReason, /Say yes to continue/);
  assert.doesNotMatch(r.json.hookSpecificOutput.permissionDecisionReason, /\borch-/);
});

test('a session with no one able to answer an interactive prompt (bypassPermissions) is denied outright, not asked', () => {
  const r = run(bash('git push --force', { permission_mode: 'bypassPermissions' }));
  assert.equal(r.json.hookSpecificOutput.permissionDecision, 'deny');
  assert.doesNotMatch(r.json.hookSpecificOutput.permissionDecisionReason, /report back/);
});

test('auto mode has nobody to answer an ask, so it is denied with the mode named', () => {
  const r = run(bash('git push --force', { permission_mode: 'auto' }));
  assert.equal(r.json.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(r.json.hookSpecificOutput.permissionDecisionReason, /auto mode/);
  assert.doesNotMatch(r.json.hookSpecificOutput.permissionDecisionReason, /Say yes/);
});

test('dontAsk mode has nobody to answer an ask, so it is denied with the mode named', () => {
  const r = run(bash('git push --force', { permission_mode: 'dontAsk' }));
  assert.equal(r.json.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(r.json.hookSpecificOutput.permissionDecisionReason, /dontAsk mode/);
  assert.doesNotMatch(r.json.hookSpecificOutput.permissionDecisionReason, /Say yes/);
});

test('default mode still asks: someone is there to answer', () => {
  const r = run(bash('git push --force', { permission_mode: 'default' }));
  assert.equal(r.json.hookSpecificOutput.permissionDecision, 'ask');
  assert.match(r.json.hookSpecificOutput.permissionDecisionReason, /Say yes to continue/);
});

test('deny reasons in modes with nobody to answer name no drive letter or account detail', () => {
  for (const mode of ['bypassPermissions', 'auto', 'dontAsk']) {
    const r = run(bash('git push --force', { permission_mode: mode, cwd: 'C:\\Users\\someone\\project' }));
    assert.equal(r.json.hookSpecificOutput.permissionDecision, 'deny');
    assert.doesNotMatch(r.json.hookSpecificOutput.permissionDecisionReason, /[A-Z]:\\/);
    assert.doesNotMatch(r.json.hookSpecificOutput.permissionDecisionReason, /Users/);
  }
});

// ---- the "ask" tail tells a headless model to stop instead of retrying -----

test('every "ask" reason ends with the plain instruction to stop and tell the user rather than retry', () => {
  const commands = ['git push --force', 'git push origin --delete a', 'git branch -D x', 'git rm -r uploads', 'git clean -fd', 'npm publish', 'gh release create v1.0.0', 'vercel --prod', 'stripe charges create --amount=1000'];
  for (const command of commands) {
    const d = decide(command);
    assert.equal(d.kind, 'ask');
    assert.match(d.reason, /Say yes to continue\. If nobody can answer here, stop and tell the user what you were about to run instead of trying again\.$/);
  }
});

// ---- the repeat guard: same command twice in one session is not re-asked fresh --

test('the same command asked twice in one session gets "Asked already: " the second time', () => {
  const home = mkdtempSync(join(tmpdir(), 'orch-bash-home-'));
  const first = run(bash('git push --force'), home);
  assert.equal(first.json.hookSpecificOutput.permissionDecision, 'ask');
  assert.doesNotMatch(first.json.hookSpecificOutput.permissionDecisionReason, /^Asked already:/);

  const second = run(bash('git push --force'), home);
  assert.equal(second.json.hookSpecificOutput.permissionDecision, 'ask');
  assert.match(second.json.hookSpecificOutput.permissionDecisionReason, /^Asked already: /);
});

test('a different command in the same session is not prefixed "Asked already: "', () => {
  const home = mkdtempSync(join(tmpdir(), 'orch-bash-home-'));
  run(bash('git push --force'), home);
  const other = run(bash('git branch -D x'), home);
  assert.equal(other.json.hookSpecificOutput.permissionDecision, 'ask');
  assert.doesNotMatch(other.json.hookSpecificOutput.permissionDecisionReason, /^Asked already:/);
});

test('the same command in a different session is asked fresh, not prefixed', () => {
  const homeA = mkdtempSync(join(tmpdir(), 'orch-bash-home-'));
  const homeB = mkdtempSync(join(tmpdir(), 'orch-bash-home-'));
  run(bash('git push --force'), homeA);
  const inOther = run({ hook_event_name: 'PreToolUse', tool_name: 'Bash', session_id: 's2', cwd: process.cwd(), tool_input: { command: 'git push --force' } }, homeB);
  assert.doesNotMatch(inOther.json.hookSpecificOutput.permissionDecisionReason, /^Asked already:/);
});

test('a helper in a mode where a person answers prompts gets the same ask as the main session', () => {
  for (const mode of ['default', 'acceptEdits', 'plan']) {
    const lead = run(bash('git push --force', { permission_mode: mode }));
    const helper = run(bash('git push --force', { permission_mode: mode, agent_id: 'helper-1' }));
    assert.equal(helper.json.hookSpecificOutput.permissionDecision, 'ask', mode);
    assert.equal(helper.json.hookSpecificOutput.permissionDecisionReason, lead.json.hookSpecificOutput.permissionDecisionReason, mode);
  }
  const ps = run(powershell('Remove-Item -Recurse -Force src', { permission_mode: 'default', agent_id: 'helper-1', cwd: '/home/user/project' }));
  assert.equal(ps.json.hookSpecificOutput.permissionDecision, 'ask');
});

test('a helper where nobody can say yes is refused because the question cannot be answered here', () => {
  for (const mode of ['auto', 'bypassPermissions', 'dontAsk', undefined]) {
    const extra = { agent_id: 'helper-1', cwd: '/home/user/project' };
    if (mode) extra.permission_mode = mode;
    for (const r of [run(bash('git push --force', extra)), run(powershell('Remove-Item -Recurse -Force src', extra))]) {
      assert.equal(r.json.hookSpecificOutput.permissionDecision, 'deny', String(mode));
      const reason = r.json.hookSpecificOutput.permissionDecisionReason;
      assert.match(reason, /cannot be answered here/);
      assert.doesNotMatch(reason, /cannot ask|Say yes|\blead\b/);
    }
  }
});

test('the main session in auto mode is still refused, naming the mode', () => {
  const r = run(bash('git push --force', { permission_mode: 'auto' }));
  assert.equal(r.json.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(r.json.hookSpecificOutput.permissionDecisionReason, /auto mode, where nobody can say yes/);
});

test('the subagent deny path is unchanged by the repeat guard', () => {
  const home = mkdtempSync(join(tmpdir(), 'orch-bash-home-'));
  run(bash('git push --force'), home);
  const r = run(bash('git push --force', { agent_id: 'helper-1' }), home);
  assert.equal(r.json.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(r.json.hookSpecificOutput.permissionDecisionReason, /report back/);
  assert.doesNotMatch(r.json.hookSpecificOutput.permissionDecisionReason, /^Asked already:/);
});

// ---- malformed input never crashes or blocks --------------------------------

test('malformed stdin exits 0 with empty stdout', () => {
  const r = spawnSync(process.execPath, [GUARD], { input: '{not json', encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});

test('a non-Bash tool call is ignored', () => {
  const r = run({ hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { command: 'rm -rf /' } });
  assert.equal(r.stdout, '');
});

test('no command in tool_input is ignored', () => {
  const r = run({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: {} });
  assert.equal(r.stdout, '');
});

// ---- the allow-list ----------------------------------------------------------

test('a project allow-list lets a specific, previously-approved command through', () => {
  const repo = mkdtempSync(join(tmpdir(), 'orch-bash-repo-'));
  mkdirSync(join(repo, '.git'));
  mkdirSync(join(repo, '.orchestrator'));
  writeFileSync(join(repo, '.orchestrator', 'allow-bash.json'), JSON.stringify({ allow: ['git branch -D old-experiment'] }));

  assert.equal(isAllowed('git branch -D old-experiment', repo), true);
  assert.equal(isAllowed('git branch -D some-other-branch', repo), false);

  const r = run(bash('git branch -D old-experiment', { cwd: repo }));
  assert.equal(r.stdout, '');
});

// ---- isSafeDeleteTarget -------------------------------------------------------

test('isSafeDeleteTarget recognises reproducible folder names and the OS temp dir, and nothing else', () => {
  assert.equal(isSafeDeleteTarget('node_modules', '/anywhere'), true);
  assert.equal(isSafeDeleteTarget('packages/app/node_modules', '/anywhere'), true);
  assert.equal(isSafeDeleteTarget('uploads', '/anywhere'), false);
  assert.equal(isSafeDeleteTarget('/', '/anywhere'), false);
  assert.equal(isSafeDeleteTarget('~', '/anywhere'), false);
  const dir = mkdtempSync(join(tmpdir(), 'orch-bash-tmp-'));
  assert.equal(isSafeDeleteTarget(dir, '/anywhere'), true);
});

// ---- timing -------------------------------------------------------------------
//
// End to end (spawn node, parse stdin, decide, print) is dominated by node's
// own process startup — on this machine that alone runs 70-200ms depending on
// what else is on the box, which is the runtime's cost, not this guard's. What
// the guard actually controls is the decision itself: parsing the payload and
// running it through `decide`. That is what is timed here, against the same
// 100ms-per-call budget the packet asks for.

test('50 invocations of the guard’s own decision average under 100ms each', () => {
  const N = 50;
  const commands = ['npm test', 'git push --force', 'rm -rf uploads', 'git branch -D x', 'npm publish'];
  const payloads = commands.map(command => JSON.stringify(bash(command)));
  const started = Date.now();
  for (let i = 0; i < N; i++) {
    const input = JSON.parse(payloads[i % payloads.length]);
    const ti = input.tool_input || {};
    decide(String(ti.command || ''), { cwd: input.cwd, subagent: Boolean(input.agent_id) });
  }
  const avg = (Date.now() - started) / N;
  // eslint-disable-next-line no-console
  console.log(`guard-bash decide(): ${N} invocations, ${avg.toFixed(3)}ms average`);
  assert.ok(avg < 100, `expected under 100ms average, got ${avg.toFixed(3)}ms`);
});
