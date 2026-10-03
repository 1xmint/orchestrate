// lib/workflow.mjs — the scheduling rules a dispatch must clear before the
// model rule or the spend gate ever run, split out of guard-agent.mjs.
//
// Scheduling belongs to the lead. The record that set these: one Sonnet helper
// dispatched as built-in general-purpose (no turn cap) made 274 model calls,
// reached 683k context, and started helpers of its own. Each rule names what to
// send instead.
//
//   nested       only a recorded coordinator may start a capped child
//   plan mode    helpers only read and return findings inline
//   uncapped     general-purpose/claude while capped role agents are installed
//   worktree     a Claude helper aimed at a worktree a live Codex worker holds
//   concurrency  two workers normally, three while a coordinator holds a slot

import { loadPolicy } from './policy.mjs';
import { nativeAgent, lockedWorktreeIn, concurrencyDecision } from './workers.mjs';
import { normalizeRole } from './prices.mjs';
import { AGENT_NAMES } from './tier.mjs';

// What a role can do to the project, said in one place for every rule that
// asks (plan mode here, the project-page gate in guard-agent.mjs). From each
// role's agent file (assets/agents/*.md) and Claude Code's built-in agents:
//   PLAN_READ_ROLES  change no project file. The researcher and the planner
//                    write only their own report or progress file, which
//                    plan mode refuses below as a PROGRESS line; the browser
//                    has no Edit, Write, NotebookEdit or Bash at all.
//   BUILD_ROLES      change the project: the plugin's builder and fault-finder
//                    (each in its own worktree), the coordinator that merges
//                    their branches, and the uncapped built-ins that can edit
//                    anything (general-purpose, claude, a fork).
// A role in neither (statusline-setup, an agent the user wrote) is neither
// admitted to plan mode nor held for the project page: nothing here knows
// what it does.
export const PLAN_READ_ROLES = new Set(['orch-advisor', 'orch-planner', 'orch-researcher', 'orch-reviewer', 'orch-browser', 'Explore', 'Plan', 'claude-code-guide']);
export const BUILD_ROLES = new Set(['orch-implementer', 'orch-debugger', 'orch-coordinator', 'general-purpose', 'claude', 'fork']);
export const UNCAPPED = new Set(['general-purpose', 'claude']);
export const COORDINATOR_CHILD_ROLES = new Set(['orch-implementer', 'orch-researcher', 'orch-reviewer', 'Explore']);
// Roles whose agent file declares `isolation: worktree` (see
// skills/orchestrate/assets/agents/*.md front matter). These helpers always
// work in their own worktree and branch; a packet that sends one into the
// shared checkout makes it write outside the repo or refuse.
export const WORKTREE_ISOLATED_ROLES = new Set(['orch-implementer', 'orch-debugger']);
// The one capped role whose install flips the uncapped-helper gate: router.mjs
// reads this rather than naming the role itself, since router.mjs is kept free
// of agent/role names (see router.test.mjs).
export const UNCAPPED_GATE_ROLE = 'orch-implementer';
// Needs words that mean working in the shared checkout; a file merely located
// "in the project root" does not count, and neither does a command run "from
// the project root": inside a helper's own folder that is the folder's top, so
// "`npm test` run from the project root passes" is a check, not a place to work.
// Running names a place only when the place is the shared or main checkout.
const SHARED_CHECKOUT_RE = /\b(work|working|edit|editing|write|writing)\s+(directly\s+)?(in|inside|from)\s+the\s+(project root|shared checkout|main checkout)|\b(run|running)\s+(directly\s+)?(in|inside|from)\s+the\s+(shared|main)\s+checkout|do not use a separate worktree|work directly in the (repo|checkout)|same checkout as/i;

export const nestedReason = 'this nested dispatch cannot be attributed to a recorded coordinator parent, so it is denied';

export function workflowDecision(input, ti, { policy = loadPolicy(), installed = 0, missing = null, native = [], external = [], dispatches = [], files = new Map() } = {}) {
  const role = normalizeRole(ti.subagent_type || 'general-purpose');
  const prompt = String(ti.prompt || '');
  const nestedParent = input && input.agent_id ? nativeAgent(dispatches, files, input.agent_id) : null;

  if (input && input.agent_id && policy.workers.nested !== 'allow') {
    if (policy.workers.nested === 'deny') {
      return { prefix: 'workers', reason: 'nested dispatches are disabled by policy.workers.nested=deny' };
    }
    const parent = nestedParent;
    if (!parent || parent.depth == null) return { prefix: 'workers', reason: nestedReason };
    if (parent.role !== 'orch-coordinator') return { prefix: 'workers', reason: `only orch-coordinator may dispatch workers; recorded parent ${parent.agentId} is ${parent.role}` };
    if (!COORDINATOR_CHILD_ROLES.has(role)) return { prefix: 'workers', reason: `orch-coordinator may dispatch only orch-implementer, orch-researcher, orch-reviewer, or Explore; ${role} is not allowed` };
    if (!String(ti.model || '').trim()) return { prefix: 'workers', reason: 'a coordinator child must name its model' };
    if (parent.depth + 1 > 2) return { prefix: 'workers', reason: `nested dispatch depth ${parent.depth + 1} exceeds the depth-2 limit` };
  }

  if (input && input.permission_mode === 'plan') {
    if (!PLAN_READ_ROLES.has(role)) return { prefix: 'plan', reason: `the host is in Plan mode, where helpers only read, and ${role} ${BUILD_ROLES.has(role) ? 'can change files' : 'is not known to only read'}. Send orch-advisor to test a direction, orch-planner for an ordered plan returned inline, orch-researcher for facts outside the code, orch-reviewer to judge a change, orch-browser to see a page, or Explore (naming a model) to find things. Or do the inspection yourself.` };
    if (ti.isolation === 'worktree' || /^\s*WHERE:.*worktree:\s*yes/mi.test(prompt) || /^\s*worktree:\s*yes/mi.test(prompt)) return { prefix: 'plan', reason: 'the host is in Plan mode: no worktrees. Remove the worktree and ask for read-only findings returned inline.' };
    if (/^\s*PROGRESS:/m.test(prompt)) return { prefix: 'plan', reason: 'the host is in Plan mode: helpers write no progress files. Remove the PROGRESS line and ask for findings returned inline; only the lead maintains the plan.' };
  }

  if (WORKTREE_ISOLATED_ROLES.has(role) && ti.isolation !== 'worktree' && !/worktree:\s*yes/i.test(prompt)) {
    if (/worktree:\s*no/i.test(prompt) || SHARED_CHECKOUT_RE.test(prompt)) {
      return { prefix: 'workers', reason: `${role} always works in its own worktree and branch; a packet that sends it into the shared checkout makes it write outside the repo or refuse. Say WHERE: … worktree: yes and merge its branch when it returns.` };
    }
  }

  // The gate is about orch-implementer specifically, not the full set: it is
  // the one capped role that writes code, so it is the uncapped helper's only
  // real substitute. Once its file is installed, general-purpose/claude is
  // refused even on a partial install of the other seven roles (profile.mjs names the fix);
  // only when orch-implementer itself is missing does general-purpose remain
  // the sole choice for a writing role.
  const implementerMissing = missing ? missing.includes(UNCAPPED_GATE_ROLE) : installed < AGENT_NAMES.length;
  if (UNCAPPED.has(role) && !implementerMissing && policy.workers.generalPurpose !== 'allow') {
    const missingNames = Array.isArray(missing) ? missing : [];
    const tail = missingNames.length
      ? ` ${installed} of ${AGENT_NAMES.length} role agent files are installed; missing: ${missingNames.map(n => `${n}.md`).join(', ')}.`
      : '';
    return { prefix: 'workers', reason: `${role} has no turn cap and can start helpers of its own. To build, send orch-implementer (model "sonnet", it runs in its own worktree: WHERE … worktree: yes); to find things, orch-researcher or Explore (model "haiku"); orch-planner, orch-debugger, orch-reviewer, orch-advisor or orch-browser for the rest. Or do a small task yourself.${tail}` };
  }

  const locked = lockedWorktreeIn(prompt, external);
  if (locked) return { prefix: 'workers', reason: `a Codex worker (${locked.task || 'task'}, pid ${locked.pid}) is still running in ${locked.worktree}. Two providers never work in one worktree at once: wait for it to exit, then send only the unfinished part.` };

  const coordinatorParentId = nestedParent && nestedParent.role === 'orch-coordinator' ? nestedParent.agentId : null;
  const busy = concurrencyDecision(role, { native, external, policy, coordinatorParentId });
  if (busy) return { prefix: 'workers', reason: busy };
  return null;
}
