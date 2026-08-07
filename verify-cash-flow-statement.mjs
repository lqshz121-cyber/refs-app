// ---------------------------------------------------------------------------
// Statement of cash flows regression gate.
//
// REFS now has a real statement of cash flows. This file exists so that none of
// the things that make it a statement rather than an evidence list can quietly
// regress:
//
//   1. Money is integer minor units. Nothing in the engine reads or writes a
//      float amount, and the statement never rounds to reach a total.
//   2. opening cash + net change = closing cash, EXACTLY, per entity and
//      consolidated, and closing cash equals the balance-sheet cash accounts.
//   3. The direct and the indirect methods agree in every section.
//   4. Every posted line that is not cash is classified exactly once. A line no
//      rule claims makes the statement declare itself NOT READY; it never lands
//      in an "other" bucket.
//   5. The developer split is real: land, construction work in progress and
//      completed homes are operating; property held for use is investing.
//      Loan draws and repayments are financing.
//   6. On consolidation, intercompany cash movement nets to zero and a chain of
//      intercompany journals that moved no bank balance grosses up no section.
//   7. An elimination never touches a cash account, and the elimination ledger
//      does reach the consolidated statement - through net income.
//   8. Each classification rule is load bearing: removing one either moves a
//      section or moves the presentation line the money reports on.
//   9. The statement is a READ. Building it changes no journal.
//  10. The Cash Flow tab and the consolidated Cash Flows view render, tie, and
//      say so on screen.
//
// Run: node verify-cash-flow-statement.mjs   (auto-discovered by tools/run-verifiers.mjs)
// ---------------------------------------------------------------------------
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { ENTITIES } from './src/data.js';
import { JOURNAL_ENTRIES, FY2026 } from './src/seed.js';
import {
  buildCashFlowStatement, buildConsolidatedCashFlowStatement, cashFlowInvariants,
  classifyLine, isCashAccount, interestDestinationByLoan,
  CASH_FLOW_RULES, CASH_FLOW_SECTIONS, CASH_SCOPE_GAP_ACCOUNTS,
  OPERATING, INVESTING, FINANCING,
} from './src/cash-flow-statement.js';
import { buildEliminations, IC_ACCOUNTS, cents } from './src/consolidation.js';
import { fullyConsolidatedEntityIds, TOP_GROUP_CODE } from './src/consolidation-groups.js';

const read = file => readFileSync(new URL(file, import.meta.url), 'utf8');
const POSTED = [...JOURNAL_ENTRIES, ...FY2026].filter(j => j.posting_status === 'POSTED');
const FROM = '2026-01';
const THROUGH = '2026-07';
const pass = name => console.log(`PASS ${name}`);

// -- 1. integer minor units --------------------------------------------------
const engine = read('./src/cash-flow-statement.js');
assert.ok(!/toFixed\(2\)/.test(engine), 'the cash-flow engine must not format money with toFixed');
assert.ok(!/parseFloat/.test(engine), 'the cash-flow engine must not parse money as a float');
assert.ok(/Math\.round\(Number\(n \|\| 0\) \* 100\)/.test(engine), 'the cash-flow engine must convert to integer minor units');
assert.ok(!/repo\.js|je-workflow\.js|document-posting\.js|seed\.js/.test(engine),
  'the cash-flow engine must not import anything that can post');
pass('cash-flow engine: integer minor units, imports nothing that can post');

// -- 2. the tie, per entity --------------------------------------------------
const statements = ENTITIES.map(e => ({e, st: buildCashFlowStatement({journals: POSTED, entityId: e.entity_id, fromPeriod: FROM, throughPeriod: THROUGH})}));
for (const {e, st} of statements) {
  assert.equal(st.cash.opening_cents + st.cash.net_change_cents, st.cash.closing_cents,
    `${e.entity_code}: opening cash + net change != closing cash`);
  assert.equal(st.direct.total_cents, st.cash.net_change_cents,
    `${e.entity_code}: the three sections do not total the cash movement`);
  assert.equal(st.cash.closing_cents, st.cash.balance_sheet_cents,
    `${e.entity_code}: closing cash != the balance-sheet cash accounts`);
  assert.deepEqual(st.findings, [], `${e.entity_code}: ${st.findings.join('; ')}`);
  assert.ok(st.ready, `${e.entity_code}: the statement is not ready`);
}
assert.equal(statements.length, ENTITIES.length);
pass(`the tie holds for ${ENTITIES.length}/${ENTITIES.length} entities, exact in integer minor units`);

// -- 3. direct and indirect agree -------------------------------------------
for (const {e, st} of statements) {
  for (const section of st.direct.sections) {
    assert.equal(section.total_cents, section.indirect_cents,
      `${e.entity_code}: ${section.section} direct ${section.total_cents} != indirect ${section.indirect_cents}`);
  }
  assert.ok(st.ties.direct_equals_indirect, `${e.entity_code}: the two methods disagree`);
}
pass('the direct and indirect methods agree in every section, for every entity');

// -- 4. every line classified exactly once -----------------------------------
let classified = 0;
const unclassified = [];
for (const je of POSTED.filter(j => j.period_code >= FROM && j.period_code <= THROUGH)) {
  for (const l of (je.lines || [])) {
    if (isCashAccount(l.account_code)) continue;
    const verdict = classifyLine(l, {journal: je});
    if (!verdict.section) { unclassified.push(`${je.je_number} ${l.account_code}`); continue; }
    assert.ok(CASH_FLOW_SECTIONS.includes(verdict.section), `${l.account_code} landed outside the three sections`);
    classified += 1;
  }
}
assert.deepEqual(unclassified.slice(0, 5), [], `${unclassified.length} posted line(s) carry no classification`);
assert.ok(classified > 0, 'no line was classified at all');
pass(`${classified} posted non-cash lines classified, exactly one section each, 0 unclassified`);

// An account no rule claims must REFUSE, not default.
const invented = classifyLine({account_code: '999999', debit_amount: 1}, {journal: {lines: []}});
assert.equal(invented.section, null, 'an unknown account must not be given a section');
const header = classifyLine({account_code: '119000', debit_amount: 1}, {journal: {lines: []}});
assert.equal(header.section, null, 'a total account must not be given a section');
for (const code of CASH_SCOPE_GAP_ACCOUNTS) {
  assert.equal(classifyLine({account_code: code, debit_amount: 1}, {journal: {lines: []}}).section, null,
    `${code} is named as cash but outside the cash scope; it must refuse rather than guess`);
}
pass('unknown accounts, total accounts and cash-named accounts outside the cash scope all refuse to classify');

// -- 5. the developer split --------------------------------------------------
const s = (code, journal = {lines: []}) => classifyLine({account_code: code, debit_amount: 1}, {journal}).section;
for (const code of ['161000', '161100', '162000', '163000', '164100', '164200', '164400', '164500', '164600', '165100', '165101', '165102']) {
  assert.equal(s(code), OPERATING, `${code} is inventory held for sale and must be operating for a developer`);
}
for (const code of ['165000', '165200', '165500', '165600', '165700', '165900', '165901', '165902', '168002', '168004']) {
  assert.equal(s(code), INVESTING, `${code} is property held for use and must be investing`);
}
for (const code of ['260100', '260200', '260300', '270100', '270101', '270200', '270700', '227303']) {
  assert.equal(s(code), FINANCING, `${code} is borrowing and must be financing`);
}
for (const code of ['380100', '380101', '380104', '380110', '380200']) {
  assert.equal(s(code), FINANCING, `${code} is owner capital and must be financing`);
}
for (const code of ['125000', '125004', '125005', '125010', '291000', '291001', '291031']) {
  assert.equal(s(code), FINANCING, `${code} is an affiliate balance and must be financing for a single entity`);
}
assert.equal(s('220410'), OPERATING, 'interest paid is operating');
assert.equal(s('795000'), OPERATING, 'interest expense is operating');
assert.equal(s('491800'), OPERATING, 'proceeds of an inventory unit sale are operating');
assert.equal(s('161201'), FINANCING, 'loan closing costs are a cost of borrowing');
assert.equal(s('185100'), FINANCING, 'a lender-required construction loan deposit is financing');
pass('the developer split holds: inventory held for sale operating, property held for use investing, debt and capital financing');

// A RED LINE: a loan draw is Dr Cash / Cr Loan Payable and never reaches a cost
// account, so its classification can only ever be financing.
const draws = POSTED.filter(j => j.rule_code === 'R-LOAN-01');
assert.ok(draws.length > 0, 'the ledger carries no loan draw to check');
for (const je of draws) {
  const nonCash = (je.lines || []).filter(l => !isCashAccount(l.account_code));
  for (const l of nonCash) {
    assert.equal(classifyLine(l, {journal: je}).section, FINANCING, `${je.je_number}: a loan draw must be financing`);
    assert.ok(!/^(5|6|7)/.test(String(l.account_code)), `${je.je_number}: a loan draw reached a cost account`);
  }
}
pass(`${draws.length} loan draw(s): financing, and none reaches a cost account`);

// Contextual rules: a security deposit taken into restricted cash is financing,
// commingled with operating cash it is operating; a disposal result follows the
// asset that moved.
const depositRestricted = {lines: [{account_code: '117000', debit_amount: 500}, {account_code: '225000', credit_amount: 500}]};
const depositOperating = {lines: [{account_code: '111000', debit_amount: 500}, {account_code: '225000', credit_amount: 500}]};
assert.equal(s('225000', depositRestricted), FINANCING, 'a deposit held in restricted cash is financing');
assert.equal(s('225000', depositOperating), OPERATING, 'a deposit commingled with operating cash is operating');
const disposalHeldForUse = {lines: [{account_code: '111000', debit_amount: 10}, {account_code: '165901', credit_amount: 8}, {account_code: '787001', credit_amount: 2}]};
const disposalInventory = {lines: [{account_code: '111000', debit_amount: 10}, {account_code: '165100', credit_amount: 8}, {account_code: '787001', credit_amount: 2}]};
assert.equal(s('787001', disposalHeldForUse), INVESTING, 'a result on disposing of property held for use is investing');
assert.equal(s('787001', disposalInventory), OPERATING, 'a result on an inventory unit is operating');
pass('contextual rules fire: restricted vs commingled deposits, and a disposal result follows its asset');

// Capitalised interest: the interest a facility pays is classified by where the
// facility's interest accrual landed. Both branches are exercised here with a
// fixture; the posted ledger reaches only the operating branch and the
// measurement script reports that.
const destinations = interestDestinationByLoan(POSTED);
assert.ok(destinations.size > 0, 'no loan interest destination could be resolved');
for (const [, section] of destinations) assert.ok(CASH_FLOW_SECTIONS.includes(section));
const fixture = [
  {posting_status: 'POSTED', entity_id: 1, period_code: '2026-07', lines: [
    {account_code: '164500', debit_amount: 100, loan_id: 91}, {account_code: '220410', credit_amount: 100, loan_id: 91}]},
  {posting_status: 'POSTED', entity_id: 1, period_code: '2026-07', lines: [
    {account_code: '165901', debit_amount: 100, loan_id: 92}, {account_code: '220410', credit_amount: 100, loan_id: 92}]},
];
const fixtureDestinations = interestDestinationByLoan(fixture);
assert.equal(fixtureDestinations.get('91'), OPERATING, 'interest capitalised into inventory keeps interest paid in operating');
assert.equal(fixtureDestinations.get('92'), INVESTING, 'interest capitalised into property held for use moves interest paid to investing');
assert.equal(classifyLine({account_code: '220410', debit_amount: 100, loan_id: 92}, {journal: fixture[1], interestDestination: fixtureDestinations}).section,
  INVESTING, 'the interest look-through must reach the investing branch');
pass('capitalised interest looks through the payable to what it funded, both branches');

// -- 6. consolidated ---------------------------------------------------------
const entityIds = fullyConsolidatedEntityIds(TOP_GROUP_CODE);
const nameById = Object.fromEntries(ENTITIES.map(e => [Number(e.entity_id), e.entity_name]));
const entityNames = entityIds.map(id => nameById[Number(id)]).filter(Boolean);
const elim = buildEliminations({journals: POSTED, groupCode: TOP_GROUP_CODE, throughPeriod: THROUGH});
const consolidatedOptions = {journals: POSTED, eliminations: elim.eliminations, entityIds, entityNames, fromPeriod: FROM, throughPeriod: THROUGH};
const cons = buildConsolidatedCashFlowStatement(consolidatedOptions);
assert.equal(cons.cash.opening_cents + cons.cash.net_change_cents, cons.cash.closing_cents, 'the consolidated statement does not tie');
assert.equal(cons.direct.total_cents, cons.cash.net_change_cents, 'the consolidated sections do not total the cash movement');
assert.equal(cons.cash.closing_cents, cons.cash.balance_sheet_cents, 'consolidated closing cash != the balance-sheet cash accounts');
assert.ok(cons.ties.direct_equals_indirect, 'the consolidated methods disagree');
assert.deepEqual(cons.findings, [], cons.findings.join('; '));
assert.deepEqual(cashFlowInvariants(cons), {ok: true, findings: []});
const entitySum = statements.reduce((t, x) => t + x.st.cash.closing_cents, 0);
assert.equal(entitySum, cons.cash.closing_cents, 'the entity statements do not sum to the consolidated statement');
pass(`consolidated statement ties over ${entityIds.length} entities and equals the sum of the entity statements`);

assert.equal(cons.intercompany.internal_cash_net_cents, 0, 'intercompany cash movement does not net to zero');
assert.ok(cons.intercompany.internal_cash_inflow_cents > 0, 'no intercompany cash movement was measured at all');
const icMovement = [...POSTED, ...elim.eliminations]
  .filter(j => j.posting_status === 'POSTED' && j.period_code >= FROM && j.period_code <= THROUGH)
  .reduce((t, j) => t + (j.lines || []).filter(l => IC_ACCOUNTS.includes(l.account_code))
    .reduce((u, l) => u + cents(l.debit_amount) - cents(l.credit_amount), 0), 0);
assert.equal(icMovement, 0, 'intercompany accounts still move after eliminations');
assert.ok(cons.intercompany.internal_transaction_groups > 0,
  'no purely internal intercompany chain was detected; the phantom-gross-up guard is not being exercised');
pass(`intercompany cash eliminated: ${cons.intercompany.internal_cash_inflow_cents / 100} in and out, net 0, ${cons.intercompany.internal_transaction_groups} internal chain(s) kept out of the sections`);

// -- 7. eliminations never touch cash, but do reach the statement ------------
for (const e of elim.eliminations) {
  for (const l of (e.lines || [])) {
    assert.ok(!isCashAccount(l.account_code), `${e.elimination_id} touches cash account ${l.account_code}`);
  }
}
const withoutEliminations = buildConsolidatedCashFlowStatement({...consolidatedOptions, eliminations: []});
assert.equal(withoutEliminations.cash.net_change_cents, cons.cash.net_change_cents,
  'the elimination ledger changed consolidated cash; an elimination must never move cash');
assert.notEqual(withoutEliminations.indirect.net_income_cents, cons.indirect.net_income_cents,
  'the elimination ledger does not reach the consolidated statement of cash flows at all');
pass('no elimination touches cash, and the elimination ledger reaches the statement through consolidated net income');

// -- 8. every exercised rule is load bearing ---------------------------------
const exercised = new Set();
[...statements.map(x => x.st), cons].forEach(st => st.rule_use.forEach(r => exercised.add(r.rule_id)));
const MUTATION_ENTITIES = [1, 2, 3, 4, 33];
const fingerprint = st => JSON.stringify([
  st.ready,
  st.direct.sections.map(x => [x.section, x.total_cents]),
  st.direct.sections.map(x => x.lines.map(l => [l.rule_id, l.cents])),
]);
const snapshot = () => [
  fingerprint(buildConsolidatedCashFlowStatement(consolidatedOptions)),
  ...MUTATION_ENTITIES.map(id => fingerprint(buildCashFlowStatement({journals: POSTED, entityId: id, fromPeriod: FROM, throughPeriod: THROUGH}))),
].join('~');
const baseline = snapshot();
const matchers = CASH_FLOW_RULES.map(r => r.match);
let proved = 0;
for (const [i, rule] of CASH_FLOW_RULES.entries()) {
  if (!exercised.has(rule.id)) continue;
  rule.match = () => false;
  const mutated = snapshot();
  rule.match = matchers[i];
  assert.notEqual(mutated, baseline, `removing ${rule.id} changes nothing at all; the rule is dead`);
  proved += 1;
}
assert.ok(CASH_FLOW_RULES.every((r, i) => r.match === matchers[i]), 'the mutation harness did not restore the rule table');
assert.equal(snapshot(), baseline, 'the statement did not return to its baseline after the mutations');
assert.ok(proved >= 8, `only ${proved} rules were proved load bearing`);
pass(`${proved} of ${CASH_FLOW_RULES.length} classification rules proved load bearing; the rest are unreachable on this ledger and the measurement script names them`);

// Flipping the developer split has to move the statement, and the tie must
// survive it: the tie is a property of the cash, not of the classification.
const inventoryRule = CASH_FLOW_RULES.find(r => r.id === 'CF-OP-INVENTORY');
inventoryRule.section = INVESTING;
const flipped = buildConsolidatedCashFlowStatement(consolidatedOptions);
inventoryRule.section = OPERATING;
assert.notEqual(flipped.direct.sections.find(x => x.section === OPERATING).total_cents,
  cons.direct.sections.find(x => x.section === OPERATING).total_cents,
  'flipping inventory to investing changed nothing');
assert.equal(flipped.cash.opening_cents + flipped.cash.net_change_cents, flipped.cash.closing_cents,
  'the flipped statement stopped tying, so the tie depends on the classification rather than on the cash');
pass('the developer split moves the statement, and the tie survives being wrong - it is a property of the cash');

// -- 9. building the statement is a read -------------------------------------
const signature = () => POSTED.map(j => `${j.je_id}|${j.posting_status}|${(j.lines || [])
  .map(l => `${l.account_code}:${cents(l.debit_amount)}:${cents(l.credit_amount)}:${l.member || ''}`).join(',')}`).join('~');
const before = signature();
buildConsolidatedCashFlowStatement(consolidatedOptions);
ENTITIES.slice(0, 10).forEach(e => buildCashFlowStatement({journals: POSTED, entityId: e.entity_id, fromPeriod: FROM, throughPeriod: THROUGH}));
assert.equal(signature(), before, 'building the statement of cash flows changed a posted journal');
pass('building the statement is a read: the posted ledger is byte-identical afterwards');

// -- 10. the screens ---------------------------------------------------------
const reports = read('./src/modules-more.jsx');
assert.match(reports, /Statement of Cash Flows/, 'the Cash Flow tab must present a statement of cash flows');
assert.match(reports, /Segmented options=\{\['Statement','Indirect reconciliation','Cash movement evidence'\]\}/,
  'the Cash Flow tab must switch sections with the segmented control, not a new page');
assert.match(reports, /Cash movement evidence/, 'the direct evidence walk must remain available as the drill-down');
assert.match(reports, /Direct and indirect methods agree/, 'the two-method agreement must be stated on screen');
assert.match(reports, /Opening cash \+ net change = closing cash/, 'the headline tie must be stated on screen');
assert.match(reports, /buildCashFlowStatement/, 'the Cash Flow tab must read the statement engine');
const consolidation = read('./src/module-consolidation.jsx');
assert.match(consolidation, /'Cash Flows'/, 'the consolidation workspace must carry a consolidated statement of cash flows');
assert.match(consolidation, /buildConsolidatedCashFlowStatement/, 'the consolidated view must read the consolidated engine');
assert.match(consolidation, /Intercompany cash eliminated/, 'the consolidated view must state whether intercompany cash eliminated');
// The old blanket disclaimer said the view was NOT a statement of cash flows.
// It is one now, for the local ledger, so that sentence must be gone - and what
// replaced it must still name what is unproven rather than claim completeness.
assert.ok(!/This evidence view is not a complete statement of cash flows/.test(reports),
  'the superseded disclaimer must not survive alongside a statement that ties');
const doc = read('./docs/CASH-FLOW-STATEMENT.md');
assert.match(doc, /Residual risk/, 'the policy document must carry a residual-risk section');
assert.match(doc, /unexercised|UNPROVABLE/i, 'the policy document must say which rules the ledger does not reach');
for (const rule of CASH_FLOW_RULES) {
  assert.ok(doc.includes(rule.id), `${rule.id} is not documented in docs/CASH-FLOW-STATEMENT.md`);
}
pass(`both screens present the statement, and all ${CASH_FLOW_RULES.length} classification rules are documented`);

console.log('verify-cash-flow-statement: OK');
