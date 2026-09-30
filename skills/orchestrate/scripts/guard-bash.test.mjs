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
  assert.equal(decide('git branch -d main').kind, 'pass');
  assert.equal(decide('git branch -d worktree-agent-abc123 feature').kind, 'pass');
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
    'git worktree remove .claude/worktrees/a && git branch -D task/x',
    'git worktree remove .claude/worktrees/a && git branch -d task/x --force',
    'git worktree remove .claude/worktrees/a && git branch -d task/x && rm -rf src',
    'git worktree remove .claude/worktrees/a && git branch -d task/x | sh',
    'git worktree remove .claude/worktrees/a && git branch -d task/x & git branch -D y',
    'git worktree remove .claude/worktrees/a && git branch -d $(git branch)',
  ]) assert.notEqual(decide(bad).kind, 'pass', bad);
});

test('the small branch delete passes anywhere in a chain when every other part passes alone', () => {
  const live = 'git worktree remove .claude/worktrees/agent-abc123 && git branch -d worktree-agent-abc123 && node --test | tail';
  for (const opts of [{}, { headless: true, mode: 'auto' }, { subagent: true }]) assert.equal(decide(live, opts).kind, 'pass', JSON.stringify(opts));
  assert.equal(decide('node --test && git branch -d worktree-agent-abc123', {}).kind, 'pass');
  assert.equal(decide('git branch -d worktree-agent-abc123 && git status | tail', {}).kind, 'pass');
  for (const bad of [
    'git branch -d worktree-agent-abc123 && rm -rf src',
    'git branch -d worktree-agent-abc123 && git push origin --force',
    'node --test | git branch -d worktree-agent-abc123 && echo hi',
    'git branch -d worktree-agent-abc123 && echo $(git branch -D x)',
  ]) assert.notEqual(decide(bad, {}).kind, 'pass', bad);
});

test('the small branch delete passes with several names, error text folded in, and joined by ; or ||', () => {
  // The shape a live run sent: three names, the second delete, a listing, `2>&1` after the deletes.
  const live = 'cd "C:\\work\\project" && git branch -d worktree-agent-a606aaeefecf71f19 worktree-agent-a6e2177a3c2231b73 worktree-agent-ab498e8 2>&1; git branch -d worktree-agent-ab512b9e04631df94 2>&1; git branch -a';
  for (const opts of [{}, { headless: true, mode: 'auto' }, { subagent: true }]) {
    assert.equal(decide(live, opts).kind, 'pass', JSON.stringify(opts));
    assert.equal(decide('git branch -d worktree-agent-a1 2>&1', opts).kind, 'pass');
    assert.equal(decide('git branch -d worktree-agent-a1 worktree-agent-b2; git branch -d task/x; git branch', opts).kind, 'pass');
    assert.equal(decide('git branch -d worktree-agent-a1 || git branch -a', opts).kind, 'pass');
  }
  // The clean chain: helper folder removal, the small delete, a harmless command.
  assert.equal(decide('git worktree remove .claude/worktrees/agent-a1 2>&1 && git branch -d worktree-agent-a1 2>&1; git status', { headless: true, mode: 'auto' }).kind, 'pass');
  // Still refused: a forced delete, --force, a write to a file, a pipe, another part that would not pass alone.
  for (const bad of [
    'git branch -D worktree-agent-a1 2>&1; git branch',
    'git branch -d worktree-agent-a1 --force 2>&1',
    'git branch -d worktree-agent-a1 > out.txt',
    'git branch -d worktree-agent-a1 2>&1 | sh',
    'git branch -d worktree-agent-a1 2>&1; rm -rf src',
    'git branch -d worktree-agent-a1 2>&1 || git push --force',
    'git branch -d worktree-agent-a1 2>&1; git branch -D x',
    'git branch -d worktree-agent-a1 2>&1; git branch -D main',
  ]) assert.notEqual(decide(bad, { headless: true, mode: 'auto' }).kind, 'pass', bad);
});

test('a forced branch delete after a safe folder removal is refused in plain words: no mode, no file name, the small form named', () => {
  const chain = 'git worktree remove .claude/worktrees/agent-abc123 && git branch -D worktree-agent-abc123 && node --test | tail';
  for (const opts of [{ headless: true, mode: 'auto' }, { subagent: true }]) {
    const d = decide(chain, opts);
    assert.equal(d.kind, 'deny');
    assert.match(d.reason, /helper folders can be removed, but the forced branch delete cannot/);
    assert.match(d.reason, /git branch -d <name>/);
    assert.doesNotMatch(d.reason, /auto mode|allow-bash|\.json|mode/i);
  }
  const lone = decide('git branch -D worktree-agent-abc123', { headless: true, mode: 'auto' });
  assert.equal(lone.kind, 'deny');
  assert.doesNotMatch(lone.reason, /auto mode|allow-bash|\.json|mode/i);
  assert.match(lone.reason, /git branch -d <name>/);
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

test('options placed before the git command word do not step round any check', () => {
  const root = mkdtempSync(join(tmpdir(), 'orch-wt-'));
  const sh = (args, cwd) => spawnSync('git', args, { cwd, encoding: 'utf8' });
  sh(['init', '-q'], root);
  const wt = join(root, '.claude', 'worktrees', 'agent-abc123');
  mkdirSync(wt, { recursive: true });
  sh(['init', '-q'], wt);
  const forms = [
    'git -C . worktree remove --force .claude/worktrees/agent-abc123',
    'git --no-pager -C . worktree remove .claude/worktrees/agent-abc123',
    'git -c core.x=1 worktree remove -f .claude/worktrees/agent-abc123 && git branch -d task/x',
  ];
  for (const c of forms) assert.equal(decide(c, { cwd: root }).kind, 'pass', `clean: ${c}`);
  writeFileSync(join(wt, 'unsaved.txt'), 'work');
  for (const c of forms) {
    assert.equal(decide(c, { cwd: root }).kind, 'ask', c);
    assert.equal(decide(c, { cwd: root, subagent: true }).kind, 'deny', c);
  }
  // -C moves where the path is read from
  assert.equal(decide('git -C .claude worktree remove --force worktrees/agent-abc123', { cwd: root }).kind, 'pass', 'not a helper path as written');
  assert.equal(decide('git -C sub worktree remove --force ../.claude/worktrees/agent-abc123', { cwd: root }).kind, 'pass', 'a path with .. is outside the rule, as before');
  for (const c of ['git -C . push --force', 'git -C . branch -D feature/x', 'git --no-pager clean -fd', 'git -c a=b push origin --delete old']) {
    assert.equal(decide(c).kind, 'ask', c);
  }
  assert.equal(decide('git -C . status').kind, 'pass');
  assert.equal(decide('git -C . branch -d feature/x').kind, 'pass');
});

test('throwing away every unsaved edit is stopped only when there are edits to lose', () => {
  const root = mkdtempSync(join(tmpdir(), 'orch-discard-'));
  const sh = args => spawnSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', ...args], { cwd: root, encoding: 'utf8' });
  sh(['init', '-q']);
  writeFileSync(join(root, 'a.txt'), 'one');
  sh(['add', '.']); sh(['commit', '-q', '-m', 'first']);
  const all = ['git reset --hard', 'git reset --hard HEAD', 'git checkout -- .', 'git checkout .', 'git restore .', 'git -C . reset --hard', 'git status && git reset --hard'];
  for (const c of all) assert.equal(decide(c, { cwd: root }).kind, 'pass', `clean: ${c}`);
  writeFileSync(join(root, 'a.txt'), 'two, never saved');
  for (const c of all) {
    const d = decide(c, { cwd: root });
    assert.equal(d.kind, 'ask', c);
    assert.match(d.reason, /never saved to git/);
    assert.equal(decide(c, { cwd: root, subagent: true }).kind, 'deny', c);
  }
  for (const c of ['git checkout -- a.txt', 'git restore a.txt', 'git restore --staged .', 'git reset --soft HEAD', 'git checkout main']) {
    assert.equal(decide(c, { cwd: root }).kind, 'pass', `one file or no loss: ${c}`);
  }
});

test('a quoted branch name in the small delete passes; a quoted name with shell syntax does not', () => {
  assert.equal(decide('git branch -d "feature/x"').kind, 'pass');
  assert.equal(decide("git branch -d 'feature/x' task/y").kind, 'pass');
  assert.equal(decide('git status && git branch -d "feature/x"').kind, 'pass');
  assert.equal(decide('git branch -d "$(git branch --merged)"').kind, 'ask');
  assert.equal(decide('git branch -D "feature/x"').kind, 'ask');
});

test('a refused line of several parts says once that nothing ran', () => {
  const d = decide('git status && rm -rf uploads', { headless: true, mode: 'auto' });
  assert.equal(d.kind, 'deny');
  assert.equal((d.reason.match(/Nothing/g) || []).length, 1);
  assert.match(d.reason, /Nothing in this line ran\.$/);
});

test('a worktree cleanup chain with the path outside .claude/worktrees/ still asks or denies', () => {
  const outside = 'git worktree remove ../elsewhere/worktree-agent-abc123 && git branch -d worktree-agent-abc123';
  assert.equal(decide(outside).kind, 'ask');
  assert.equal(decide(outside, { headless: true, mode: 'auto' }).kind, 'deny');
});

test('a forced or remote branch delete is stopped, and the small -d passes for any name', () => {
  assert.equal(decide('git branch -D x').kind, 'ask');
  assert.equal(decide('git branch -d x').kind, 'pass');
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

test('git reset --hard passes where there is nothing unsaved to lose', () => {
  assert.equal(decide('git reset --hard', { cwd: mkdtempSync(join(tmpdir(), 'orch-clean-')) }).kind, 'pass');
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
  assert.match(headless.reason, /nobody is present to say yes/);
  assert.doesNotMatch(headless.reason, /Say yes|auto mode|allow-bash|\.json/);
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
  assert.match(r.json.hookSpecificOutput.permissionDecisionReason, /nobody is present to say yes/);
  assert.doesNotMatch(r.json.hookSpecificOutput.permissionDecisionReason, /allow-bash|\.json|mode/i);
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

test('auto mode has nobody to answer an ask, so it is denied in plain words with no mode named', () => {
  const r = run(bash('git push --force', { permission_mode: 'auto' }));
  assert.equal(r.json.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(r.json.hookSpecificOutput.permissionDecisionReason, /nobody is present to say yes/);
  assert.doesNotMatch(r.json.hookSpecificOutput.permissionDecisionReason, /auto mode|allow-bash|\.json/i);
  assert.doesNotMatch(r.json.hookSpecificOutput.permissionDecisionReason, /Say yes/);
});

test('dontAsk mode has nobody to answer an ask, so it is denied in plain words with no mode named', () => {
  const r = run(bash('git push --force', { permission_mode: 'dontAsk' }));
  assert.equal(r.json.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(r.json.hookSpecificOutput.permissionDecisionReason, /nobody is present to say yes/);
  assert.doesNotMatch(r.json.hookSpecificOutput.permissionDecisionReason, /dontAsk|allow-bash|\.json/i);
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

test('the main session in auto mode is still refused, in plain words with no mode or file named', () => {
  const r = run(bash('git push --force', { permission_mode: 'auto' }));
  assert.equal(r.json.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(r.json.hookSpecificOutput.permissionDecisionReason, /nobody is present to say yes/);
});

test('every refusal where nobody can say yes is plain: no mode, no file name, and a way that works', () => {
  const cmds = ['git push --force', 'git push origin --delete x', 'git branch -D x', 'rm -rf src', 'git clean -fd', 'npm publish', 'vercel --prod', 'pkill -f node', 'stripe charges create --amount=1000'];
  for (const c of cmds) {
    const d = decide(c, { headless: true, mode: 'auto' });
    assert.equal(d.kind, 'deny', c);
    assert.doesNotMatch(d.reason, /\bmode\b|allow-bash|\.json|\.orchestrator|Say yes to continue/i, c);
    if (!/branch -D/.test(c)) assert.match(d.reason, /nobody is present to say yes/, c);
    if (!/branch -D/.test(c)) assert.match(d.reason, /tell the user|run it themselves/, c);
  }
});

test('a helper folder with unsaved changes is refused in plain words: save first, remove without force, or leave it', () => {
  const root = mkdtempSync(join(tmpdir(), 'orch-wt-plain-'));
  const sh = (args, cwd) => spawnSync('git', args, { cwd, encoding: 'utf8' });
  sh(['init', '-q'], root);
  const wt = join(root, '.claude', 'worktrees', 'agent-abc123');
  mkdirSync(wt, { recursive: true });
  sh(['init', '-q'], wt);
  writeFileSync(join(wt, 'unsaved.txt'), 'work');
  for (const c of ['git worktree remove --force .claude/worktrees/agent-abc123', 'git worktree remove .claude/worktrees/agent-abc123 --force && git worktree list']) {
    const d = decide(c, { cwd: root, headless: true, mode: 'auto' });
    assert.equal(d.kind, 'deny', c);
    assert.match(d.reason, /never saved to git/);
    assert.match(d.reason, /commit/);
    assert.match(d.reason, /copy the files into the main folder/);
    assert.match(d.reason, /without force/);
    assert.match(d.reason, /leave the folder where it is and tell the user/);
    assert.doesNotMatch(d.reason, /\bmode\b|allow-bash|\.json|Say yes to continue/i, c);
  }
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

test('the small delete passes for any branch name, several names, and in a chain, never with a force flag', () => {
  for (const ok of [
    'git branch -d feature/login',
    'git branch --delete release-1.2 main',
    'git branch -d a b c',
    'git branch -d my-feature && git status',
    'git status; git branch -d fix/x 2>&1',
  ]) assert.equal(decide(ok, { headless: true, mode: 'auto' }).kind, 'pass', ok);
  for (const bad of [
    'git branch -D feature',
    'git branch --force -d feature',
    'git branch -d feature --force',
    'git branch -d feature -f',
    'git branch -d --force feature',
    'git branch -f -d feature',
    'git branch -d feature && git branch -D other',
    'git branch --delete --force feature',
    'git branch -d $(git branch)',
    'git branch -d feature > out.txt',
  ]) assert.notEqual(decide(bad, { headless: true, mode: 'auto' }).kind, 'pass', bad);
});

test('a refused branch delete never names a form that is itself refused', () => {
  const d = decide('git branch -D feature', { headless: true, mode: 'auto' });
  assert.equal(d.kind, 'deny');
  assert.match(d.reason, /git branch -d <name>/);
  assert.doesNotMatch(d.reason, /helper branches/);
});

test('a refused line with several parts ends by saying nothing in it ran; a single part does not', () => {
  for (const opts of [{ headless: true, mode: 'auto' }, { subagent: true }]) {
    for (const multi of ['git status && rm -rf src', 'git branch -D x; git status', 'git status && git push --force']) {
      const d = decide(multi, opts);
      assert.equal(d.kind, 'deny', multi);
      assert.match(d.reason, /Nothing in this line ran\.$/, multi);
    }
    assert.doesNotMatch(decide('git branch -D x', opts).reason, /Nothing in this line ran/);
    assert.doesNotMatch(decide('git push --force', opts).reason, /Nothing in this line ran/);
  }
});

// Seen live: a refusal blamed a lowercase `branch -d` and said to use the
// lowercase flag, when the part that stopped the line was an `rm -rf`.
test('a line refused for another part names that part, not a lowercase branch delete', () => {
  for (const opts of [{ headless: true, mode: 'auto' }, { subagent: true }]) {
    const withRm = decide('rm -rf src && git branch -d worktree-agent-abc123', opts);
    assert.equal(withRm.kind, 'deny');
    assert.doesNotMatch(withRm.reason, /lowercase flag/);
    assert.match(withRm.reason, /permanently delete files or folders/);
    assert.match(decide('git branch -D worktree-agent-abc123 && rm -rf src', opts).reason, /lowercase flag/);
    assert.match(decide('git branch -d feature-x && git branch -D y', opts).reason, /lowercase flag/);
  }
});

// Live, 0.17.1: `git branch -d <ten names> 2>&1 | tail -12; grep …` was refused
// for the pipe, and the refusal told the lead to use the lowercase flag it had
// already used. A pipe into a filter that only reads cannot change what the
// delete does, so that shape passes; every way to make the pipe do more stays refused.
test('a small branch delete piped into a read-only filter passes, with several names', () => {
  const live = 'git branch -d release/0.17.1 trial/all-prs fix/review-hold 2>&1 | tail -12; grep -rh "pass" docs';
  for (const opts of [{}, { headless: true, mode: 'auto' }, { subagent: true }]) {
    assert.equal(decide(live, opts).kind, 'pass', JSON.stringify(opts));
    for (const ok of [
      'git branch -d a b c | tail -12',
      'git branch -d a b | head -5',
      'git branch -d a | wc -l',
      'git branch -d a b | cat',
      'git branch -d a b 2>&1 | grep -v "not found"',
      'git worktree remove .claude/worktrees/agent-a1 && git branch -d worktree-agent-a1 | tail -3',
    ]) assert.equal(decide(ok, opts).kind, 'pass', ok);
  }
});

// Written before the change; these pass on the old code by design, because the
// old code refused every pipe. They pin what the new allowance must not open.
test('a pipe after a small branch delete stays refused when it can run, write or delete anything', () => {
  for (const bad of [
    'git branch -d a | xargs git branch -D',
    'git branch -d a | xargs -I{} git branch -D {}',
    'git branch -d a | sh',
    'git branch -d a | bash',
    'git branch -d a | eval',
    'git branch -d a | env sh',
    'git branch -d a | tee log.txt',
    'git branch -d a | tail > out.txt',
    'git branch -d a | tail >> out.txt',
    'git branch -d a |& cat',
    'git branch -d a | grep x | xargs git branch -D',
    'git branch -d a | grep x | sh',
    'git branch -d a | sort -o out.txt',
    'git branch -d a | uniq - out.txt',
    'git branch -d a | tail -n $(rm -rf src)',
    'git branch -d a | tail `rm -rf src`',
    'git branch -d a | grep "$(rm -rf src)"',
    'git branch -d a | tail <(git branch -D b)',
    'git branch -d a | tail & rm -rf src',
    'git branch -d $(git branch) | tail',
    'git branch -d `git branch` | tail',
    'git branch -d a -f | tail',
    'git branch -df a | tail',
    'git branch -d a --force | tail',
    'git branch -D a | tail',
    'git branch -d a | tail; git branch -D b',
    'git branch -d a | tail && rm -rf src',
    'git branch -d main; git push origin --delete main | tail',
    'sh -c "git branch -D a" | tail',
  ]) {
    for (const opts of [{}, { headless: true, mode: 'auto' }, { subagent: true }]) assert.notEqual(decide(bad, opts).kind, 'pass', `${bad} ${JSON.stringify(opts)}`);
  }
});

// Found while writing the tests above: 0.17.1 let `git branch -df main` through
// with no question, because the delete flag was only seen standing alone.
// -df and -fd are the forced delete, the same as -D.
test('a delete flag combined with others is still a branch delete', () => {
  for (const bad of [
    'git branch -df main',
    'git branch -fd main',
    'git branch -Df main',
    'git branch -fD main',
    'git branch -dr origin/main',
    'git -C /x branch -df main',
    'git branch -q -df main',
  ]) {
    for (const opts of [{}, { headless: true, mode: 'auto' }, { subagent: true }]) assert.notEqual(decide(bad, opts).kind, 'pass', `${bad} ${JSON.stringify(opts)}`);
  }
  // Listing flags that merely contain a letter d elsewhere are not deletes.
  for (const ok of ['git branch -a', 'git branch -vv', 'git branch --merged', 'git branch --no-merged main']) assert.equal(decide(ok).kind, 'pass', ok);
});

test('a small delete refused only for what follows it says so, and does not advise the flag already used', () => {
  for (const opts of [{ headless: true, mode: 'auto' }, { subagent: true }]) {
    for (const [line, part] of [
      ['git branch -d a b c | tee log.txt', '| tee log.txt'],
      ['git branch -d a > out.txt', '> out.txt'],
      ['git branch -d a b | sh', '| sh'],
    ]) {
      const d = decide(line, opts);
      assert.equal(d.kind, 'deny', line);
      assert.doesNotMatch(d.reason, /lowercase flag works/, line);
      assert.ok(d.reason.includes(part), `${line}: ${d.reason}`);
      assert.match(d.reason, /same delete with nothing after it passes/, line);
    }
  }
  // A forced delete still gets the lowercase advice.
  assert.match(decide('git branch -D a | tail', { headless: true, mode: 'auto' }).reason, /git branch -d <name>/);
});
