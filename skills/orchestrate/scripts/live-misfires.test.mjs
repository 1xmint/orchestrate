// Replays the false alarms from the first live session on 0.17.2
// (docs/audits/2026-09-30-live-session-notes.md, notes I, Q, R, T, U, V) and
// checks each now passes silently, while the real dangers next to them still
// stop. Plan 0005 step 2: a check that guesses from words goes; a check that
// reads what actually runs stays.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide } from './guard-bash.mjs';
import { runsPayment, withoutFileText } from './lib/shell-run.mjs';

const pass = cmd => assert.equal(decide(cmd).kind, 'pass', cmd);
const stops = cmd => assert.notEqual(decide(cmd).kind, 'pass', cmd);
const paymentStops = cmd => {
  const d = decide(cmd);
  assert.notEqual(d.kind, 'pass', cmd);
  assert.match(d.reason, /real payment account/, cmd);
};

// Note I: a read-only node -e listing hid vendor plugins with a regex holding
// two brand words. Reconstructed from note I (the original printed plugin names).
test('note I: brand words inside a node -e regex are not a payment', () => {
  pass(`node -e "const m=require('./marketplace.json'); console.log(m.plugins.filter(p=>!/stripe|shopify/i.test(p.name)).map(p=>p.name).join('\\n'))"`);
  pass(`grep -n -i "stripe\\|paypal" README.md`);
  pass(`grep -rn 'stripe charges create' docs/`);
  pass(`git log --oneline --grep=stripe`);
});

test('note I: brand words in text written to a file are not a payment', () => {
  pass(`cat > notes.md <<'EOF'\n# Payments\nWe never run stripe charges create from a helper.\nEOF`);
  pass(`echo "stripe refunds create is refused by the guard" >> docs/notes.md`);
  pass(`printf 'curl https://api.stripe.com/v1/charges\\n' > example.txt`);
});

test('real payment actions still stop', () => {
  paymentStops('stripe charges create --amount=1000');
  paymentStops(`bash -c "stripe refunds create --charge ch_1"`);
  paymentStops(`sh -c 'npx stripe customers delete cus_1'`);
  paymentStops('env STRIPE_API_KEY=x stripe payment_intents confirm pi_1');
  paymentStops('curl https://api.stripe.com/v1/charges -u sk_test_x: -d amount=100');
  paymentStops(`node -e "require('stripe')(k).charges.create({})"`);
  paymentStops(`python3 - <<'EOF'\nimport stripe\nstripe.Refund.create(charge='ch_1')\nEOF`);
  paymentStops(`echo ok && $(stripe charges create --amount=5)`);
  paymentStops('ls; stripe subscriptions cancel sub_1');
});

test('stripe CLI read and config commands still pass', () => {
  pass('stripe login');
  pass('stripe listen --forward-to localhost:3000/webhook');
  pass('stripe --version');
});

// Note U: prose piped into a file mentioned "before merge"; the merge bar
// refused it. Reconstructed from note U.
test('note U: prose about merging, written to a file, is not a merge', () => {
  const line = `cat > docs/research/plan.md <<'EOF'\nEach step goes to an independent review before merge.\nThe gh pr merge happens only after PASS.\nEOF`;
  assert.doesNotMatch(withoutFileText(line), /merge/);
  pass(line);
  pass(`echo "run gh pr merge only after review" > NOTES.md`);
});

test('a heredoc fed to a shell is still read for merges, and real merges still stop', () => {
  assert.match(withoutFileText(`bash <<'EOF'\ngh pr merge 5 --squash\nEOF`), /gh pr merge 5/);
  assert.match(withoutFileText(`echo $(gh pr merge 5) > out.txt`), /gh pr merge 5/);
  const refused = cmd => assert.equal(decide(cmd, { mentionsMerge: () => true, ghView: () => ({ ok: false }) }).kind, 'deny', cmd);
  refused(`bash <<'EOF'\ngh pr merge 5\nEOF`);
  refused('gh pr merge 5 --squash');
});

test('force-push to main still stops', () => {
  stops('git push --force origin main');
});

test('runsPayment reads command words, not words', () => {
  assert.equal(runsPayment(`grep stripe package.json`), false);
  assert.equal(runsPayment(`node -e "console.log('stripe')"`), false);
  assert.equal(runsPayment(`wget https://api.paypal.com/v2/payments`), true);
  assert.equal(runsPayment(`sudo -E stripe products create --name x`), true);
});

// Notes R and V: a short prompt naming its brief file was told the brief
// lacked fields that were all in the file; a read-only docs lookup about
// permission rules was told it would wait for an independent review.
test('notes R and V: the brief file a prompt names is graded, and an unreadable one draws nothing', async () => {
  const { missingFact, namedFiles } = await import('./guard-agent.mjs');
  const files = { '.orchestrator/runs/r/packets/9-30-0004.md': 'TASK: 9-30-0004\nFOR: a vibe coder\nDONE WHEN\n- tests pass\nPROGRESS: .orchestrator/runs/r/progress/9-30-0004.md\n' };
  const readFile = p => { if (p in files) return files[p]; throw new Error('ENOENT'); };
  const prompt = 'Your brief is .orchestrator/runs/r/packets/9-30-0004.md. Read it first; it has everything.';
  assert.deepEqual(namedFiles(prompt), ['.orchestrator/runs/r/packets/9-30-0004.md']);
  assert.equal(missingFact('orch-planner', prompt, false, readFile), '');
  assert.equal(missingFact('orch-implementer', 'Brief: elsewhere/packets/x.md', false, readFile), '', 'cannot read it, so says nothing');
  assert.equal(missingFact('orch-implementer', 'TASK: 1\nfind it', false, readFile), 'brief lacks: what it is for, a check it is done, a PROGRESS path', 'no file named: graded as before');
});

test('note V: a lookup whose objective says "permission" is not held for review', async () => {
  const src = (await import('node:fs')).readFileSync(new URL('./guard-agent.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /will wait for an independent review because/);
  assert.doesNotMatch(src, /reviewInferred/);
});
