// Statement of cash flows - measurement.
//
// Nothing here is asserted. Every number is measured from the posted ledger and
// the elimination ledger the consolidation engine builds from it, in integer
// minor units. Exit code is 1 if any check fails.
//
// Run:
//   ./node_modules/.bin/esbuild tools/analysis/cash-flow.js --bundle \
//     --platform=node --format=cjs --outfile=/tmp/x.cjs && node /tmp/x.cjs
import { POSTED, ENTITIES, ENT, fmt } from './_ledger.js';
import {
  buildCashFlowStatement, buildConsolidatedCashFlowStatement, classifyLine,
  CASH_FLOW_RULES, CASH_FLOW_SECTIONS, isCashAccount, interestDestinationByLoan,
  OPERATING, INVESTING, FINANCING,
} from '../../src/cash-flow-statement.js';
import { buildEliminations, IC_ACCOUNTS } from '../../src/consolidation.js';
import { fullyConsolidatedEntityIds, TOP_GROUP_CODE } from '../../src/consolidation-groups.js';

const FROM = '2026-01';
const THROUGH = '2026-07';
const out = []; const P = s => out.push(s);
const failures = [];
const d = c => fmt(c / 100);
const c = n => Math.round(Number(n || 0) * 100);

P(`== STATEMENT OF CASH FLOWS · ${FROM} ~ ${THROUGH} ==`);

// ---------------------------------------------------------------------------
// [0] The cash base.
// ---------------------------------------------------------------------------
const cashCodes = new Set();
const nonCashPostedCodes = new Set();
POSTED.forEach(j => (j.lines || []).forEach(l => {
  if (isCashAccount(l.account_code)) cashCodes.add(l.account_code); else nonCashPostedCodes.add(l.account_code);
}));
P('');
P(`  [0] cash, cash equivalents and restricted cash (ASU 2016-18) posted in the ledger: ${[...cashCodes].sort().join(', ')}`);
P(`      distinct non-cash accounts posted: ${nonCashPostedCodes.size}`);

// ---------------------------------------------------------------------------
// [1] Every posted line is classified exactly once. No line uncategorised,
//     no line counted twice.
// ---------------------------------------------------------------------------
const unclassifiedCodes = new Map();
let classifiedLines = 0, cashLines = 0;
const sectionCount = {[OPERATING]: 0, [INVESTING]: 0, [FINANCING]: 0};
POSTED.filter(j => j.period_code >= FROM && j.period_code <= THROUGH).forEach(j => (j.lines || []).forEach(l => {
  if (isCashAccount(l.account_code)) { cashLines += 1; return; }
  const verdict = classifyLine(l, {journal: j});
  if (!verdict.section) {
    const k = `${l.account_code} ${verdict.reason || 'unclassified'}`;
    unclassifiedCodes.set(k, (unclassifiedCodes.get(k) || 0) + 1);
    return;
  }
  classifiedLines += 1;
  sectionCount[verdict.section] += 1;
}));
P('');
P(`  [1] posted lines in range: ${cashLines} cash-account lines, ${classifiedLines} classified non-cash lines`);
P(`      Operating ${sectionCount[OPERATING]} · Investing ${sectionCount[INVESTING]} · Financing ${sectionCount[FINANCING]} lines`);
P(`      lines carrying NO classification: ${[...unclassifiedCodes.values()].reduce((s, n) => s + n, 0)}`);
[...unclassifiedCodes.entries()].slice(0, 10).forEach(([k, n]) => P(`        ${n}x ${k}`));
if (unclassifiedCodes.size) failures.push(`${unclassifiedCodes.size} account(s) carry posted lines with no cash-flow classification`);
// classifyLine returns ONE verdict; double counting would show as a section sum
// that does not match the line count.
if (sectionCount[OPERATING] + sectionCount[INVESTING] + sectionCount[FINANCING] !== classifiedLines) {
  failures.push('a classified line landed in more than one section');
}

// ---------------------------------------------------------------------------
// [2] Per entity: opening cash + net change = closing cash, exact.
// ---------------------------------------------------------------------------
const statements = ENTITIES.map(e => ({entity: e, st: buildCashFlowStatement({journals: POSTED, entityId: e.entity_id, fromPeriod: FROM, throughPeriod: THROUGH})}));
const notTied = statements.filter(x => !x.st.ties.opening_plus_change_equals_closing || !x.st.ties.sections_equal_cash_movement);
const notBs = statements.filter(x => !x.st.ties.closing_equals_balance_sheet);
const notAgreed = statements.filter(x => !x.st.ties.direct_equals_indirect);
const notReady = statements.filter(x => !x.st.ready);
P('');
P(`  [2] entities whose opening cash + net change != closing cash: ${notTied.length} of ${ENTITIES.length}`);
P(`      entities whose closing cash != balance-sheet cash accounts: ${notBs.length} of ${ENTITIES.length}`);
P(`      entities where the direct and indirect methods disagree:    ${notAgreed.length} of ${ENTITIES.length}`);
P(`      entities the statement declares not ready:                  ${notReady.length} of ${ENTITIES.length}`);
notReady.slice(0, 5).forEach(x => P(`        ${x.entity.entity_code}: ${x.st.findings.join('; ')}`));
if (notTied.length) failures.push(`${notTied.length} entity cash flow statement(s) do not tie`);
if (notBs.length) failures.push(`${notBs.length} entity closing cash figure(s) do not equal the balance sheet`);
if (notAgreed.length) failures.push(`${notAgreed.length} entity statement(s) where direct and indirect disagree`);
if (notReady.length) failures.push(`${notReady.length} entity statement(s) are not ready`);

const groupOpening = statements.reduce((s, x) => s + x.st.cash.opening_cents, 0);
const groupChange = statements.reduce((s, x) => s + x.st.cash.net_change_cents, 0);
const groupClosing = statements.reduce((s, x) => s + x.st.cash.closing_cents, 0);
P(`      sum of the 119 entity statements: opening ${d(groupOpening)} + change ${d(groupChange)} = closing ${d(groupClosing)}`);
if (groupOpening + groupChange !== groupClosing) failures.push('the sum of the entity statements does not tie');

// ---------------------------------------------------------------------------
// [3] The consolidated statement.
// ---------------------------------------------------------------------------
const entityIds = fullyConsolidatedEntityIds(TOP_GROUP_CODE);
const entityNames = entityIds.map(id => (ENT[id] || {}).entity_name).filter(Boolean);
const elim = buildEliminations({journals: POSTED, groupCode: TOP_GROUP_CODE, throughPeriod: THROUGH});
const cons = buildConsolidatedCashFlowStatement({
  journals: POSTED, eliminations: elim.eliminations,
  entityIds, entityNames, fromPeriod: FROM, throughPeriod: THROUGH,
});
P('');
P(`  [3] consolidated group ${TOP_GROUP_CODE}: ${entityIds.length} entities, ${elim.eliminations.length} elimination journals, ${elim.warnings.length} unmatched intercompany warning(s)`);
P(`      opening cash            ${d(cons.cash.opening_cents).padStart(18)}`);
P(`      net change              ${d(cons.cash.net_change_cents).padStart(18)}`);
P(`      closing cash            ${d(cons.cash.closing_cents).padStart(18)}`);
P(`      balance-sheet cash      ${d(cons.cash.balance_sheet_cents).padStart(18)}`);
P(`      opening + change = closing: ${cons.ties.opening_plus_change_equals_closing}`);
P(`      closing = balance sheet:    ${cons.ties.closing_equals_balance_sheet}`);
if (!cons.ready) { cons.findings.forEach(f => failures.push(`consolidated: ${f}`)); }
if (groupClosing !== cons.cash.closing_cents) {
  failures.push(`the sum of the entity closing cash ${d(groupClosing)} does not equal consolidated closing cash ${d(cons.cash.closing_cents)}`);
}
P(`      sum of entity closing cash = consolidated closing cash: ${groupClosing === cons.cash.closing_cents}`);

// ---------------------------------------------------------------------------
// [4] Elimination of intercompany cash movement.
// ---------------------------------------------------------------------------
P('');
P(`  [4] intercompany cash movement inside the boundary (treated as internal cash):`);
P(`        inflow  ${d(cons.intercompany.internal_cash_inflow_cents).padStart(18)}`);
P(`        outflow ${d(cons.intercompany.internal_cash_outflow_cents).padStart(18)}`);
P(`        net     ${d(cons.intercompany.internal_cash_net_cents).padStart(18)}  eliminated: ${cons.ties.intercompany_eliminated}`);
P(`      purely internal transaction chains suppressed from the sections: ${cons.intercompany.internal_transaction_groups} chain(s), ${cons.intercompany.internal_transaction_journals} journal(s)`);
if (cons.intercompany.internal_cash_net_cents !== 0) failures.push('intercompany cash movement does not net to zero on consolidation');
// Independent check: on the consolidated column no intercompany account carries
// a balance at all.
const icPeriodMovement = [...POSTED, ...elim.eliminations]
  .filter(j => j.posting_status === 'POSTED' && j.period_code >= FROM && j.period_code <= THROUGH)
  .reduce((s, j) => s + (j.lines || []).filter(l => IC_ACCOUNTS.includes(l.account_code))
    .reduce((t, l) => t + c(l.debit_amount) - c(l.credit_amount), 0), 0);
P(`      independent check: movement on 125xxx/291xxx after eliminations = ${d(icPeriodMovement)}`);
if (icPeriodMovement !== 0) failures.push(`intercompany accounts move ${d(icPeriodMovement)} after eliminations`);

// ---------------------------------------------------------------------------
// [5] The consolidated statement itself.
// ---------------------------------------------------------------------------
P('');
P('== CONSOLIDATED STATEMENT OF CASH FLOWS · DIRECT METHOD ==');
cons.direct.sections.forEach(s => {
  P(`  ${s.section.toUpperCase()} ACTIVITIES`);
  s.lines.forEach(l => P(`    ${l.rule_id.padEnd(24)} ${l.label.slice(0, 52).padEnd(54)} ${d(l.cents).padStart(18)}`));
  P(`    ${''.padEnd(24)} ${('Net cash from ' + s.section.toLowerCase() + ' activities').padEnd(54)} ${d(s.total_cents).padStart(18)}`);
});
P(`  ${''.padEnd(24)} ${'NET CHANGE IN CASH'.padEnd(54)} ${d(cons.direct.total_cents).padStart(18)}`);
P(`  ${''.padEnd(24)} ${'Cash at the beginning of the period'.padEnd(54)} ${d(cons.cash.opening_cents).padStart(18)}`);
P(`  ${''.padEnd(24)} ${'Cash at the end of the period'.padEnd(54)} ${d(cons.cash.closing_cents).padStart(18)}`);

P('');
P('== CONSOLIDATED · INDIRECT RECONCILIATION OF OPERATING ACTIVITIES ==');
P(`    ${'Net income'.padEnd(64)} ${d(cons.indirect.net_income_cents).padStart(18)}`);
if (cons.indirect.reclassifications.length) {
  P('    Items presented in investing or financing activities');
  cons.indirect.reclassifications.forEach(r => P(`      ${r.account_code} ${r.account_name.slice(0, 44).padEnd(46)} ${d(r.presented_cents).padStart(18)}`));
}
P('    Non-cash transactions (journals that moved no cash)');
cons.indirect.non_cash_adjustments.forEach(r => P(`      ${r.account_code} ${r.account_name.slice(0, 44).padEnd(46)} ${d(r.presented_cents).padStart(18)}`));
P('    Changes in operating assets and liabilities');
cons.indirect.working_capital.forEach(r => P(`      ${r.account_code} ${r.account_name.slice(0, 44).padEnd(46)} ${d(r.presented_cents).padStart(18)}`));
P(`    ${'Net cash from operating activities (indirect)'.padEnd(64)} ${d(cons.indirect.operating_cents).padStart(18)}`);
P(`    ${'Net cash from operating activities (direct)'.padEnd(64)} ${d(cons.direct.sections[0].total_cents).padStart(18)}`);
P('');
CASH_FLOW_SECTIONS.forEach(section => {
  const s = cons.direct.sections.find(x => x.section === section);
  P(`    ${section.padEnd(12)} direct ${d(s.total_cents).padStart(18)}   indirect ${d(s.indirect_cents).padStart(18)}   difference ${d(s.total_cents - s.indirect_cents).padStart(12)}`);
});
if (!cons.ties.direct_equals_indirect) failures.push('the consolidated direct and indirect methods disagree');

// ---------------------------------------------------------------------------
// [6] Real-estate classification: the calls that matter, measured.
// ---------------------------------------------------------------------------
P('');
P('  [6] real-estate classification, measured against the posted ledger');
const inventoryLine = cons.direct.sections.find(s => s.section === OPERATING).lines.find(l => l.rule_id === 'CF-OP-INVENTORY');
const debtLine = cons.direct.sections.find(s => s.section === FINANCING).lines.find(l => l.rule_id === 'CF-FIN-DEBT');
const investingTotal = cons.direct.sections.find(s => s.section === INVESTING).total_cents;
P(`      land and construction spend on inventory held for sale -> OPERATING: ${inventoryLine ? d(inventoryLine.cents) : '(no activity)'}`);
P(`      loan draws and principal repayments -> FINANCING:                    ${debtLine ? d(debtLine.cents) : '(no activity)'}`);
P(`      property held for use -> INVESTING:                                  ${d(investingTotal)}`);
// A loan draw must NEVER reach a cost account: red line.
const drawJournals = POSTED.filter(j => j.rule_code === 'R-LOAN-01');
const drawToCost = drawJournals.filter(j => (j.lines || []).some(l => /^(5|6|7)/.test(String(l.account_code))));
P(`      loan draw journals: ${drawJournals.length}; draws that touch a cost account: ${drawToCost.length}`);
if (drawToCost.length) failures.push('a loan draw reached a cost account');

// Capitalised interest: where each facility's interest accrual landed, and
// therefore how its cash payments classify.
const destinations = interestDestinationByLoan(POSTED);
P(`      interest destination by loan (drives how interest PAID classifies):`);
[...destinations.entries()].sort().forEach(([loanId, section]) => P(`        loan ${loanId} -> ${section}`));
const interestPayments = POSTED.filter(j => j.period_code >= FROM && j.period_code <= THROUGH
  && (j.lines || []).some(l => isCashAccount(l.account_code))
  && (j.lines || []).some(l => ['220310', '220410', '220451'].includes(l.account_code)));
const interestPaidCents = interestPayments.reduce((s, j) => s + (j.lines || []).filter(l => isCashAccount(l.account_code))
  .reduce((t, l) => t + c(l.debit_amount) - c(l.credit_amount), 0), 0);
P(`      cash interest payments in range: ${interestPayments.length}, cash effect ${d(interestPaidCents)}`);
// The ASC 230-10-45-13(c) edge: interest capitalised into an asset HELD FOR USE
// would have to be investing. Measure whether the ledger ever reaches it.
const capitalisedIntoHeldForUse = POSTED.filter(j => (j.lines || []).some(l => ['164500', '164501'].includes(l.account_code))
  && (j.lines || []).some(l => /^(165000|1652|1653|1654|1655|1656|1657|1658|1659|166000|168)/.test(String(l.account_code))));
P(`      journals capitalising interest into an asset HELD FOR USE: ${capitalisedIntoHeldForUse.length}`);
P(`        (the investing branch of the interest rule is therefore UNEXERCISED by this ledger)`);

// ---------------------------------------------------------------------------
// [7] Rule coverage. Which rules the posted ledger actually exercises.
// ---------------------------------------------------------------------------
const used = new Map();
[...statements.map(x => x.st), cons].forEach(st => st.rule_use.forEach(r => used.set(r.rule_id, (used.get(r.rule_id) || 0) + r.lines)));
P('');
P(`  [7] classification rules: ${CASH_FLOW_RULES.length} defined, ${used.size} exercised by the posted ledger`);
CASH_FLOW_RULES.forEach(r => {
  const n = used.get(r.id) || 0;
  P(`        ${n ? 'USED  ' : 'unused'} ${r.id.padEnd(24)} ${String(r.section || '(refuse)').padEnd(10)} ${r.label}`);
});

// ---------------------------------------------------------------------------
// [8] Mutation: removing any one EXERCISED classification rule must break the
//     statement. A rule the ledger does not exercise cannot be proved this way
//     and is reported as such rather than counted as proved.
// ---------------------------------------------------------------------------
P('');
P('  [8] mutation - remove one rule at a time and rebuild every statement it can reach');
P('      A rule is load bearing on SECTIONS when removing it moves a section total or');
P('      makes a statement declare itself not ready. Some rules are a more specific');
P('      restatement of a later, broader rule in the SAME section; removing one of those');
P('      cannot move a total, only the line the money reports on. Those are reported as');
P('      PRESENTATION rather than counted as proving a section. The distinction is');
P('      measured here, not assumed.');
const MUTATION_ENTITIES = [1, 2, 3, 4, 33];
const fingerprint = st => ({
  sections: st.direct.sections.map(s => `${s.section}:${s.total_cents}`).join('|'),
  lines: st.direct.sections.map(s => s.lines.map(l => `${l.rule_id}=${l.cents}`).join(',')).join('|'),
  ready: st.ready,
});
const buildAll = () => [
  fingerprint(buildConsolidatedCashFlowStatement({journals: POSTED, eliminations: elim.eliminations, entityIds, entityNames, fromPeriod: FROM, throughPeriod: THROUGH})),
  ...MUTATION_ENTITIES.map(id => fingerprint(buildCashFlowStatement({journals: POSTED, entityId: id, fromPeriod: FROM, throughPeriod: THROUGH}))),
];
const baseline = buildAll();
const originalMatchers = CASH_FLOW_RULES.map(r => r.match);
let provedSections = 0, provedPresentation = 0, unprovable = 0;
CASH_FLOW_RULES.forEach((rule, index) => {
  if (!(used.get(rule.id) || 0)) {
    unprovable += 1;
    P(`        UNPROVABLE   ${rule.id.padEnd(24)} the posted ledger never reaches this rule`);
    return;
  }
  rule.match = () => false;                       // remove the rule
  let movedSections = false, movedLines = false, how = '';
  try {
    buildAll().forEach((f, i) => {
      if (f.sections !== baseline[i].sections || f.ready !== baseline[i].ready) {
        movedSections = true;
        if (!how) how = f.ready === baseline[i].ready ? 'a section total moves' : 'the statement stops being ready';
      }
      if (f.lines !== baseline[i].lines) movedLines = true;
    });
  } catch (error) { movedSections = true; how = `throws: ${error.message}`; }
  rule.match = originalMatchers[index];           // put it back
  if (movedSections) { provedSections += 1; P(`        PROVED       ${rule.id.padEnd(24)} ${how}`); }
  else if (movedLines) { provedPresentation += 1; P(`        PRESENTATION ${rule.id.padEnd(24)} the money stays in the same section but reports on a different line`); }
  else { failures.push(`removing ${rule.id} changes nothing at all; the rule is dead`); P(`        DEAD         ${rule.id}`); }
});
const restored = CASH_FLOW_RULES.every((r, i) => r.match === originalMatchers[i]);
P(`      rules that move a section total when removed: ${provedSections}`);
P(`      rules that move only the presentation line:   ${provedPresentation}`);
P(`      rules the posted ledger cannot reach:         ${unprovable} of ${CASH_FLOW_RULES.length}`);
P(`      rule table restored after the harness:        ${restored}`);
if (!restored) failures.push('the mutation harness did not restore the rule table');

// A second mutation: break the developer split itself. Reclassifying inventory
// held for sale as investing must move the sections.
const inventoryRule = CASH_FLOW_RULES.find(r => r.id === 'CF-OP-INVENTORY');
const before = cons.direct.sections.map(s => s.total_cents).join('|');
inventoryRule.section = INVESTING;
const flipped = buildConsolidatedCashFlowStatement({journals: POSTED, eliminations: elim.eliminations, entityIds, entityNames, fromPeriod: FROM, throughPeriod: THROUGH});
inventoryRule.section = OPERATING;
const after = flipped.direct.sections.map(s => s.total_cents).join('|');
P(`      flipping the developer split (inventory -> investing) moves the sections: ${before !== after}`);
P(`        operating ${d(cons.direct.sections[0].total_cents)} -> ${d(flipped.direct.sections[0].total_cents)}`);
P(`        investing ${d(cons.direct.sections[1].total_cents)} -> ${d(flipped.direct.sections[1].total_cents)}`);
if (before === after) failures.push('flipping the developer inventory split changes nothing');
if (flipped.cash.opening_cents + flipped.cash.net_change_cents !== flipped.cash.closing_cents) {
  failures.push('the flipped statement stopped tying, which means the tie depends on the classification rather than on the cash');
}
P(`      the flipped statement still TIES (the tie does not depend on the classification): ${flipped.ties.opening_plus_change_equals_closing && flipped.ties.sections_equal_cash_movement}`);

// A third mutation: drop the elimination ledger from the consolidated build.
//
// MEASURED RESULT, stated plainly because it surprised the author: the
// consolidated CASH totals are invariant to the elimination ledger. That is not
// a bug and it is not the pool hiding something. Intercompany cash nets to zero
// because every 125xxx debit has a mirrored 291xxx credit at the counterparty
// and BOTH are in the pool; the E-IC-BAL entry reverses two pool accounts
// against each other and moves nothing. E-IC-PL and E-IC-PROFIT touch no cash
// and no pool account at all, so they are non-cash transactions and the
// correction removes them from every section.
//
// What the elimination ledger DOES change is the top of the indirect
// reconciliation - consolidated NET INCOME - and the non-cash adjustment that
// offsets it. That is measured here, and it is what makes the elimination
// ledger load bearing for this statement.
const noElim = buildConsolidatedCashFlowStatement({journals: POSTED, eliminations: [], entityIds, entityNames, fromPeriod: FROM, throughPeriod: THROUGH});
P(`      consolidating WITHOUT the elimination ledger:`);
P(`        intercompany cash nets to ${d(noElim.intercompany.internal_cash_net_cents)} (unchanged: the mirrored pair already nets)`);
P(`        net change in cash        ${d(noElim.cash.net_change_cents)} vs ${d(cons.cash.net_change_cents)} with eliminations`);
P(`        operating total           ${d(noElim.direct.sections[0].total_cents)} vs ${d(cons.direct.sections[0].total_cents)} with eliminations`);
P(`        NET INCOME at the top of the indirect reconciliation ${d(noElim.indirect.net_income_cents)} vs ${d(cons.indirect.net_income_cents)} with eliminations`);
P(`        difference in net income  ${d(noElim.indirect.net_income_cents - cons.indirect.net_income_cents)}`);
if (noElim.indirect.net_income_cents === cons.indirect.net_income_cents) {
  failures.push('the elimination ledger does not reach the consolidated statement of cash flows at all');
}
if (noElim.cash.net_change_cents !== cons.cash.net_change_cents) {
  failures.push('the elimination ledger changed consolidated cash; an elimination must never touch a cash account');
}
const elimTouchesCash = elim.eliminations.filter(e => (e.lines || []).some(l => isCashAccount(l.account_code)));
P(`      elimination journals that touch a cash account: ${elimTouchesCash.length} of ${elim.eliminations.length}`);
if (elimTouchesCash.length) failures.push(`${elimTouchesCash.length} elimination journal(s) touch a cash account`);

// ---------------------------------------------------------------------------
// [9] One entity in full, so the drill-down is readable.
// ---------------------------------------------------------------------------
const sample = statements.find(x => Number(x.entity.entity_id) === 1) || statements[0];
P('');
P(`== ENTITY ${sample.entity.entity_code} ${sample.entity.entity_name} · ${FROM} ~ ${THROUGH} ==`);
sample.st.direct.sections.forEach(s => {
  P(`  ${s.section.toUpperCase()}`);
  s.lines.forEach(l => P(`    ${l.label.slice(0, 58).padEnd(60)} ${d(l.cents).padStart(18)}  (${l.journal_numbers.length} JE)`));
  P(`    ${('Net cash from ' + s.section.toLowerCase()).padEnd(60)} ${d(s.total_cents).padStart(18)}`);
});
P(`    ${'NET CHANGE IN CASH'.padEnd(60)} ${d(sample.st.direct.total_cents).padStart(18)}`);
P(`    ${'Opening cash'.padEnd(60)} ${d(sample.st.cash.opening_cents).padStart(18)}`);
P(`    ${'Closing cash'.padEnd(60)} ${d(sample.st.cash.closing_cents).padStart(18)}`);
P(`    ${'Balance-sheet cash accounts'.padEnd(60)} ${d(sample.st.cash.balance_sheet_cents).padStart(18)}`);
P(`    direct = indirect: ${sample.st.ties.direct_equals_indirect}; cash journals walked: ${sample.st.entries.length}`);

P('');
if (failures.length) { failures.forEach(f => P(`FAIL ${f}`)); P(`cash-flow: failures=${failures.length}`); }
else P('cash-flow: failures=0');
console.log(out.join('\n'));
if (failures.length) process.exitCode = 1;
