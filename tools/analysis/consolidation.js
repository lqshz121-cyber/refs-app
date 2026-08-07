// Consolidation measurement. Nothing here is asserted; everything is measured
// from the posted ledger and the elimination ledger the engine builds from it.
//
// Run:
//   ./node_modules/.bin/esbuild tools/analysis/consolidation.js --bundle \
//     --platform=node --format=cjs --outfile=/tmp/x.cjs && node /tmp/x.cjs
//
// Exit code is 1 if any assertion fails.
import { POSTED, ENT, fmt } from './_ledger.js';
import {
  buildConsolidation, buildEliminations, consolidationInvariants, consolidatedAccountDetail,
  IC_ACCOUNTS, IC_DUE_FROM_ACCOUNTS, IC_DUE_TO_ACCOUNTS, GROUP_INVENTORY_ACCOUNTS, IC_TRANSFER_GAIN_ACCOUNTS,
  ELIMINATION_TYPES, cents,
} from '../../src/consolidation.js';
import { ELIMINATION_ENTITY, TOP_GROUP_CODE, CONSOLIDATION_GROUPS, CONSOLIDATION_MEMBERS, validateConsolidationModel, groupMembers } from '../../src/consolidation-groups.js';
import { ENTITIES } from '../../src/data.js';

const THROUGH = '2026-07';
const out = []; const P = s => out.push(s);
const failures = [];
const d = c => fmt(c / 100);

const options = {journals: POSTED, groupCode: TOP_GROUP_CODE, throughPeriod: THROUGH};
const result = buildConsolidation(options);
const tb = result.trialBalance;
const bs = result.balanceSheet;
const is = result.incomeStatement;
const el = result.elimination;
const at = code => tb.rows.find(r => r.account_code === code) || null;
const sumAt = (codes, key) => codes.reduce((s, c) => s + (at(c) ? at(c)[key] : 0), 0);

P('== CONSOLIDATION · group ' + TOP_GROUP_CODE + ' · through ' + THROUGH + ' ==');

// ---------------------------------------------------------------------------
// [0] The group model itself.
// ---------------------------------------------------------------------------
const model = validateConsolidationModel(ENTITIES, CONSOLIDATION_MEMBERS);
P('');
P(`  [0] group model: ${CONSOLIDATION_GROUPS.length} groups, ${model.member_count} membership rows against ${model.entity_count} entities in the master`);
groupMembers(TOP_GROUP_CODE).reduce((acc, m) => { acc[m.group_code] = (acc[m.group_code] || 0) + 1; return acc; }, {}) &&
  CONSOLIDATION_GROUPS.forEach(g => {
    const n = CONSOLIDATION_MEMBERS.filter(m => m.group_code === g.group_code).length;
    P(`        ${g.group_code.padEnd(9)} ${String(n).padStart(3)} member(s)  parent entity ${String(g.parent_entity_id).padStart(3)}  ${g.group_name}`);
  });
model.findings.forEach(f => P(`        MODEL DEFECT ${f}`));
if (!model.ok) failures.push(`${model.findings.length} defect(s) in the consolidation group model`);
if (ENTITIES.some(e => Number(e.entity_id) === ELIMINATION_ENTITY.entity_id)) {
  failures.push('the elimination entity is in the entity master');
}
P(`        elimination entity: ${ELIMINATION_ENTITY.entity_id} ${ELIMINATION_ENTITY.entity_code} - in ENTITIES master: ${ENTITIES.some(e => Number(e.entity_id) === ELIMINATION_ENTITY.entity_id)}`);

// ---------------------------------------------------------------------------
// [1] The elimination ledger never touches an entity ledger.
// ---------------------------------------------------------------------------
const strayEntity = el.eliminations.filter(e => Number(e.entity_id) !== ELIMINATION_ENTITY.entity_id);
const beforeSignature = POSTED.map(j => `${j.je_id}|${j.posting_status}|${(j.lines || []).map(l => `${l.account_code}:${cents(l.debit_amount)}:${cents(l.credit_amount)}`).join(',')}`).join('~');
buildEliminations(options);   // build again; a build must be a read
const afterSignature = POSTED.map(j => `${j.je_id}|${j.posting_status}|${(j.lines || []).map(l => `${l.account_code}:${cents(l.debit_amount)}:${cents(l.credit_amount)}`).join(',')}`).join('~');
P('');
P(`  [1] elimination ledger: ${el.eliminations.length} journals, batch ${el.batch.batch_id}, all on entity ${ELIMINATION_ENTITY.entity_id}: ${strayEntity.length === 0}`);
P(`      entity ledger byte-identical after building the batch twice: ${beforeSignature === afterSignature}`);
if (strayEntity.length) failures.push(`${strayEntity.length} elimination(s) are not on the elimination entity`);
if (beforeSignature !== afterSignature) failures.push('building the elimination batch changed an entity ledger');
ELIMINATION_TYPES.forEach(t => {
  const n = el.eliminations.filter(e => e.elimination_type === t.code).length;
  const dr = el.eliminations.filter(e => e.elimination_type === t.code).reduce((s, e) => s + e.total_debit_cents, 0);
  P(`        ${t.code.padEnd(12)} ${String(n).padStart(4)} entries  ${d(dr).padStart(18)}  ${t.name}`);
  if (n === 0) failures.push(`elimination type ${t.code} produced no entries; it is not exercised by the ledger`);
});

// ---------------------------------------------------------------------------
// [2] Every elimination balances in itself, and so does the batch.
// ---------------------------------------------------------------------------
const unbalanced = el.eliminations.filter(e => !e.balanced);
P('');
P(`  [2] eliminations that do not balance in themselves: ${unbalanced.length} of ${el.eliminations.length}`);
unbalanced.slice(0, 6).forEach(e => P(`        ${e.elimination_id}: debit ${d(e.total_debit_cents)} credit ${d(e.total_credit_cents)}`));
P(`      batch total: debit ${d(el.batch.total_debit_cents)} credit ${d(el.batch.total_credit_cents)} balanced=${el.batch.balanced}`);
if (unbalanced.length) failures.push(`${unbalanced.length} elimination entr(ies) do not balance`);
if (!el.batch.balanced) failures.push('the elimination batch does not balance');

// ---------------------------------------------------------------------------
// [3] Consolidated intercompany residual.
// ---------------------------------------------------------------------------
const icEntity = sumAt(IC_ACCOUNTS, 'entity_balance_cents');
const icElim = sumAt(IC_ACCOUNTS, 'elimination_balance_cents');
const icCons = sumAt(IC_ACCOUNTS, 'consolidated_balance_cents');
P('');
P('  [3] intercompany accounts (125xxx Due from + 291xxx Due to/from)');
P('        ACCOUNT   ENTITY TOTALS        ELIMINATIONS       CONSOLIDATED');
IC_ACCOUNTS.filter(c => at(c)).forEach(c => {
  const r = at(c);
  P(`        ${c}  ${d(r.entity_balance_cents).padStart(18)} ${d(r.elimination_balance_cents).padStart(18)} ${d(r.consolidated_balance_cents).padStart(18)}`);
});
P(`        TOTAL   ${d(icEntity).padStart(18)} ${d(icElim).padStart(18)} ${d(icCons).padStart(18)}`);
if (icCons !== 0) failures.push(`consolidated intercompany residual is ${d(icCons)}, not 0.00`);
// The residual netting to zero is NOT the test. The group's due-froms already
// equal its due-tos, so the total is zero whether or not anything eliminates -
// which is exactly how $10.5m of intercompany receivable and $10.5m of
// intercompany payable can both sit on a "balanced" consolidated balance sheet.
// The test is that no intercompany account carries ANY consolidated balance.
const icStillCarried = IC_ACCOUNTS.filter(c => at(c) && at(c).consolidated_balance_cents !== 0);
const icGrossConsolidated = IC_ACCOUNTS.reduce((s, c) => s + Math.abs(at(c) ? at(c).consolidated_balance_cents : 0), 0);
P(`        intercompany accounts still carrying a consolidated balance: ${icStillCarried.length}, gross ${d(icGrossConsolidated)}`);
if (icStillCarried.length) failures.push(`${icStillCarried.length} intercompany account(s) still carry a consolidated balance: ${icStillCarried.join(', ')}`);
const grossIc = sumAt(IC_DUE_FROM_ACCOUNTS, 'entity_debit_cents') + sumAt(IC_DUE_TO_ACCOUNTS, 'entity_credit_cents');
P(`        gross intercompany turnover removed from the consolidated balance sheet: ${d(grossIc)}`);

// ---------------------------------------------------------------------------
// [4] Consolidated Assets = Liabilities + Equity + current earnings.
// ---------------------------------------------------------------------------
const showCol = (label, c) => P(`        ${label.padEnd(14)} assets ${d(c.assets).padStart(18)}  liabilities ${d(c.liabilities).padStart(18)}  equity ${d(c.equity).padStart(16)}  earnings ${d(c.current_earnings).padStart(16)}`);
P('');
P('  [4] balance sheet identity');
showCol('entity', bs.totals.entity);
showCol('eliminations', bs.totals.elimination);
showCol('consolidated', bs.totals.consolidated);
P(`        consolidated out of balance: ${d(bs.out_of_balance_cents.consolidated)}  (entity column: ${d(bs.out_of_balance_cents.entity)})`);
P(`        consolidated trial balance debit ${d(tb.totals.consolidated_debit_cents)} credit ${d(tb.totals.consolidated_credit_cents)} ties=${tb.totals.consolidated_debit_cents === tb.totals.consolidated_credit_cents}`);
if (bs.out_of_balance_cents.consolidated !== 0) failures.push(`consolidated Assets != Liabilities + Equity + earnings, out by ${d(bs.out_of_balance_cents.consolidated)}`);
if (tb.totals.consolidated_debit_cents !== tb.totals.consolidated_credit_cents) failures.push('consolidated trial balance does not tie');

// ---------------------------------------------------------------------------
// [5] Consolidated revenue and expense exclude intercompany activity.
// ---------------------------------------------------------------------------
// Re-measured independently of the engine: an intercompany revenue or expense
// line is one in a posted journal that also carries an intercompany line naming
// a consolidated group entity.
const consolidatedNames = new Set(groupMembers(TOP_GROUP_CODE).filter(m => m.method === 'FULL')
  .map(m => (ENT[m.entity_id] || {}).entity_name).filter(Boolean));
const independentIc = {revenue: 0, expense: 0, byAccount: {}};
for (const j of POSTED) {
  if (String(j.period_code || '') > THROUGH) continue;
  const self = ENT[j.entity_id];
  if (!self || !consolidatedNames.has(self.entity_name)) continue;
  const counterparties = new Set((j.lines || [])
    .filter(l => IC_ACCOUNTS.includes(l.account_code))
    .map(l => l.member || (l.description || '').split('_').slice(1).join('_'))
    .filter(m => consolidatedNames.has(m) && m !== self.entity_name));
  if (counterparties.size !== 1) continue;
  for (const l of (j.lines || [])) {
    if (IC_TRANSFER_GAIN_ACCOUNTS.includes(l.account_code)) continue;
    const first = String(l.account_code)[0];
    const net = cents(l.debit_amount) - cents(l.credit_amount);
    if (first === '4') { independentIc.revenue += -net; independentIc.byAccount[l.account_code] = (independentIc.byAccount[l.account_code] || 0) + -net; }
    else if (first >= '5') { independentIc.expense += net; independentIc.byAccount[l.account_code] = (independentIc.byAccount[l.account_code] || 0) + net; }
  }
}
P('');
P('  [5] intercompany revenue and expense');
P(`      measured independently of the engine, from the ledger:`);
P(`        intercompany revenue ${d(independentIc.revenue)}   intercompany expense ${d(independentIc.expense)}   difference ${d(independentIc.revenue - independentIc.expense)}`);
Object.keys(independentIc.byAccount).sort().forEach(c => P(`          ${c} ${at(c) ? at(c).account_name.slice(0, 34).padEnd(34) : ''} ${d(independentIc.byAccount[c]).padStart(18)}`));
P(`      income statement:`);
P(`        entity        revenue ${d(is.totals.entity.revenue).padStart(18)}  expense ${d(is.totals.entity.cost_of_sales + is.totals.entity.operating_expense).padStart(18)}  net income ${d(is.totals.entity.net_income).padStart(18)}`);
P(`        eliminations  revenue ${d(is.totals.elimination.revenue).padStart(18)}  expense ${d(is.totals.elimination.cost_of_sales + is.totals.elimination.operating_expense).padStart(18)}  net income ${d(is.totals.elimination.net_income).padStart(18)}`);
P(`        consolidated  revenue ${d(is.totals.consolidated.revenue).padStart(18)}  expense ${d(is.totals.consolidated.cost_of_sales + is.totals.consolidated.operating_expense).padStart(18)}  net income ${d(is.totals.consolidated.net_income).padStart(18)}`);
if (independentIc.revenue !== independentIc.expense) {
  failures.push(`intercompany revenue ${d(independentIc.revenue)} does not equal intercompany expense ${d(independentIc.expense)}; the pair cannot eliminate cleanly`);
}
if (-is.totals.elimination.revenue !== independentIc.revenue) {
  failures.push(`eliminations removed ${d(-is.totals.elimination.revenue)} of revenue; the ledger carries ${d(independentIc.revenue)} of intercompany revenue`);
}
const expenseEliminated = -(is.totals.elimination.cost_of_sales + is.totals.elimination.operating_expense);
// 787001 Gain on sale/transfer classifies as an expense-type account, so the
// expense column also carries the E-IC-PROFIT DEBIT that removes the transfer
// gain - it pushes the expense column back UP by that amount. Add it back to
// isolate what E-IC-PL removed.
const profitElimOnGain = el.eliminations.filter(e => e.elimination_type === 'E-IC-PROFIT')
  .reduce((s, e) => s + e.lines.filter(l => IC_TRANSFER_GAIN_ACCOUNTS.includes(l.account_code)).reduce((t, l) => t + l.debit_cents - l.credit_cents, 0), 0);
if (expenseEliminated + profitElimOnGain !== independentIc.expense) {
  failures.push(`eliminations removed ${d(expenseEliminated + profitElimOnGain)} of intercompany expense; the ledger carries ${d(independentIc.expense)} of it`);
}
// The consolidated column must be the entity column less exactly the
// intercompany activity measured above - no more, no less.
const expectedRevenue = is.totals.entity.revenue - independentIc.revenue;
const entityExpense = is.totals.entity.cost_of_sales + is.totals.entity.operating_expense;
const consolidatedExpense = is.totals.consolidated.cost_of_sales + is.totals.consolidated.operating_expense;
const expectedExpense = entityExpense - independentIc.expense + profitElimOnGain;
P(`        consolidated revenue expected ${d(expectedRevenue)} actual ${d(is.totals.consolidated.revenue)}`);
P(`        consolidated expense expected ${d(expectedExpense)} actual ${d(consolidatedExpense)} (includes the ${d(profitElimOnGain)} unrealised-profit debit to 787001)`);
if (is.totals.consolidated.revenue !== expectedRevenue) failures.push(`consolidated revenue ${d(is.totals.consolidated.revenue)} still carries intercompany revenue (expected ${d(expectedRevenue)})`);
if (consolidatedExpense !== expectedExpense) failures.push(`consolidated expense ${d(consolidatedExpense)} still carries intercompany expense (expected ${d(expectedExpense)})`);

// ---------------------------------------------------------------------------
// [6] No unrealised intercompany profit remains in consolidated inventory.
// ---------------------------------------------------------------------------
// Measured independently: for every paired intercompany asset transfer, what
// the receiver capitalised less what the transferor released.
const pairs = new Map();
for (const j of POSTED) {
  if (!j.ic_pair_id || String(j.period_code || '') > THROUGH) continue;
  if (!pairs.has(j.ic_pair_id)) pairs.set(j.ic_pair_id, []);
  pairs.get(j.ic_pair_id).push(j);
}
let capitalisedAbove = 0, transferCount = 0;
const rows = [];
for (const [pairId, group] of [...pairs.entries()].sort()) {
  const released = group.reduce((s, j) => s + (j.lines || []).reduce((t, l) =>
    GROUP_INVENTORY_ACCOUNTS.includes(l.account_code) ? t + cents(l.credit_amount) : t, 0), 0);
  const capitalised = group.reduce((s, j) => s + (j.lines || []).reduce((t, l) =>
    GROUP_INVENTORY_ACCOUNTS.includes(l.account_code) ? t + cents(l.debit_amount) : t, 0), 0);
  const above = capitalised - released;
  if (above === 0 && released === 0) continue;
  transferCount += 1; capitalisedAbove += above;
  rows.push([pairId, released, capitalised, above]);
}
P('');
P(`  [6] paired intercompany asset transfers in the ledger: ${transferCount}`);
P('        PAIR          RELEASED BY SELLER   CAPITALISED BY BUYER   ABOVE GROUP COST');
rows.slice(0, 10).forEach(([id, rel, cap, ab]) => P(`        ${id.padEnd(14)} ${d(rel).padStart(18)} ${d(cap).padStart(22)} ${d(ab).padStart(18)}`));
P(`        total unrealised intercompany profit sitting in entity inventory: ${d(capitalisedAbove)}`);
const invEntity = sumAt(GROUP_INVENTORY_ACCOUNTS, 'entity_balance_cents');
const invElim = sumAt(GROUP_INVENTORY_ACCOUNTS, 'elimination_balance_cents');
const invCons = sumAt(GROUP_INVENTORY_ACCOUNTS, 'consolidated_balance_cents');
P(`        inventory and work in progress: entity ${d(invEntity)}  eliminations ${d(invElim)}  consolidated ${d(invCons)}`);
P(`        transfer gain 787001: entity ${d(at('787001') ? at('787001').entity_balance_cents : 0)}  eliminations ${d(at('787001') ? at('787001').elimination_balance_cents : 0)}  consolidated ${d(at('787001') ? at('787001').consolidated_balance_cents : 0)}`);
P(`        engine diagnostics: ${el.diagnostics.transfer_pairs} pair(s), ${el.diagnostics.transfer_pairs_unrealised} still held by the group, ${el.diagnostics.transfer_pairs_realised} sold outside the group, ${el.diagnostics.transfer_pairs_part_realised} part sold`);
if (transferCount === 0) failures.push('no paired intercompany asset transfer exists, so unrealised profit elimination is never exercised');
if (capitalisedAbove <= 0) failures.push('no intercompany transfer capitalises above group cost, so there is no unrealised profit to remove');
if (-invElim !== capitalisedAbove) failures.push(`eliminations removed ${d(-invElim)} from inventory; ${d(capitalisedAbove)} of intercompany margin is capitalised in it`);
const gainConsolidated = at('787001') ? at('787001').consolidated_balance_cents : 0;
if (gainConsolidated !== 0) failures.push(`the consolidated result still carries ${d(-gainConsolidated)} of intercompany transfer gain`);

// ---------------------------------------------------------------------------
// [7] Drill-back: every consolidated figure resolves to entities and eliminations.
// ---------------------------------------------------------------------------
P('');
P('  [7] drill-back');
let undrillable = 0, drilled = 0;
for (const r of tb.rows) {
  if (r.entity_balance_cents !== 0 && !r.entities.length) undrillable += 1;
  if (r.elimination_balance_cents !== 0 && !r.elimination_refs.length) undrillable += 1;
  const entitySum = r.entities.reduce((s, e) => s + e.debit_cents - e.credit_cents, 0);
  if (entitySum !== r.entity_balance_cents) undrillable += 1; else drilled += 1;
}
P(`      accounts whose entity column re-adds from its drill-down: ${drilled} of ${tb.rows.length}`);
if (undrillable) failures.push(`${undrillable} consolidated figure(s) do not resolve to the entities and eliminations behind them`);
const sample = consolidatedAccountDetail(result, '125000');
if (sample) {
  P(`      125000 ${sample.account_name}: entity ${d(sample.entity_balance_cents)} from ${sample.entities.length} entit(ies), ${sample.eliminations.length} elimination(s), consolidated ${d(sample.consolidated_balance_cents)}`);
  const src = sample.eliminations[0] && sample.eliminations[0].sources[0];
  if (src) P(`        first source line: ${src.je_number} entity ${src.entity_id} ${src.account_code} Dr ${d(src.debit_cents)} Cr ${d(src.credit_cents)} member ${src.member}`);
  const noSources = sample.eliminations.filter(e => !e.sources.length).length;
  if (noSources) failures.push(`${noSources} elimination(s) on 125000 name no source journal line`);
} else failures.push('account 125000 does not appear in the consolidated trial balance');

// ---------------------------------------------------------------------------
// [8] Removing an elimination makes the consolidated statements fail.
// ---------------------------------------------------------------------------
P('');
P('  [8] suppression test - removing one elimination type must break the consolidation');
let proved = 0;
for (const t of ELIMINATION_TYPES) {
  const broken = buildConsolidation({...options, suppressTypes: [t.code]});
  const inv = consolidationInvariants(broken);
  const bicons = broken.trialBalance.rows.filter(r => IC_ACCOUNTS.includes(r.account_code)).reduce((s, r) => s + r.consolidated_balance_cents, 0);
  const binv = GROUP_INVENTORY_ACCOUNTS.reduce((s, c) => {
    const r = broken.trialBalance.rows.find(x => x.account_code === c); return s + (r ? r.consolidated_balance_cents : 0);
  }, 0);
  const bgain = (broken.trialBalance.rows.find(r => r.account_code === '787001') || {consolidated_balance_cents: 0}).consolidated_balance_cents;
  const bgross = IC_ACCOUNTS.reduce((s, c) => {
    const r = broken.trialBalance.rows.find(x => x.account_code === c); return s + Math.abs(r ? r.consolidated_balance_cents : 0);
  }, 0);
  const bassets = broken.balanceSheet.totals.consolidated.assets;
  const brev = broken.incomeStatement.totals.consolidated.revenue;
  const bexp = broken.incomeStatement.totals.consolidated.cost_of_sales + broken.incomeStatement.totals.consolidated.operating_expense;
  const symptoms = [];
  if (bicons !== 0) symptoms.push(`intercompany residual ${d(bicons)}`);
  if (bgross !== 0) symptoms.push(`${d(bgross)} of gross intercompany balance left on the consolidated balance sheet`);
  if (bassets !== bs.totals.consolidated.assets) symptoms.push(`consolidated assets ${d(bassets)} instead of ${d(bs.totals.consolidated.assets)}`);
  if (brev !== is.totals.consolidated.revenue) symptoms.push(`consolidated revenue ${d(brev)} instead of ${d(is.totals.consolidated.revenue)}`);
  if (bexp !== consolidatedExpense) symptoms.push(`consolidated expense ${d(bexp)} instead of ${d(consolidatedExpense)}`);
  if (binv !== invCons) symptoms.push(`inventory ${d(binv)} instead of ${d(invCons)}`);
  if (bgain !== 0) symptoms.push(`transfer gain ${d(-bgain)} left in the result`);
  if (!inv.ok) symptoms.push(inv.findings[0]);
  P(`        without ${t.code.padEnd(12)} -> ${symptoms.length ? symptoms.join('; ') : 'NOTHING CHANGED'}`);
  if (symptoms.length) proved += 1;
  else failures.push(`suppressing ${t.code} changed nothing in the consolidated statements; the elimination does no work`);
}
// And removing a member from the boundary must break it too.
const excluded = buildConsolidation({...options, memberOverrides: {3: 'EXCLUDED'}});
const exIc = excluded.trialBalance.rows.filter(r => IC_ACCOUNTS.includes(r.account_code)).reduce((s, r) => s + r.consolidated_balance_cents, 0);
P(`        excluding entity 3 (the funder) from the group -> intercompany residual ${d(exIc)}, ${excluded.elimination.warnings.length} unmatched intercompany warning(s)`);
if (exIc === 0) failures.push('excluding the funder from the consolidation group left the intercompany residual at zero; the group boundary does no work');
P(`      elimination types proved load bearing: ${proved} of ${ELIMINATION_TYPES.length}`);

// ---------------------------------------------------------------------------
// [9] Warnings the engine raised. An intercompany balance it could not
//     eliminate is reported, never dropped.
// ---------------------------------------------------------------------------
P('');
P(`  [9] engine warnings on the full group: ${el.warnings.length}`);
el.warnings.slice(0, 8).forEach(w => P(`        ${w}`));
P(`      intercompany lines seen ${el.diagnostics.ic_lines}, of which outside the boundary ${el.diagnostics.ic_lines_outside_boundary}`);
P(`      intercompany journals ${el.diagnostics.ic_journals}, intercompany profit-and-loss lines ${el.diagnostics.ic_pl_lines}`);
if (el.warnings.length) failures.push(`${el.warnings.length} intercompany balance(s) could not be eliminated`);

// ---------------------------------------------------------------------------
// Consolidated statements, printed.
// ---------------------------------------------------------------------------
P('');
P('== CONSOLIDATED BALANCE SHEET · ' + THROUGH + ' ==');
P('  ACCT   NAME                                   ENTITY TOTALS      ELIMINATIONS      CONSOLIDATED');
const line = r => P(`  ${r.account_code} ${r.account_name.slice(0, 36).padEnd(36)} ${d(r.entity_cents).padStart(17)} ${d(r.elimination_cents).padStart(17)} ${d(r.consolidated_cents).padStart(17)}`);
['assets', 'liabilities', 'equity'].forEach(k => {
  P(`  -- ${k.toUpperCase()}`);
  bs.sections[k].filter(r => r.consolidated_cents !== 0 || r.elimination_cents !== 0).forEach(line);
  P(`  ${''.padEnd(43)} ${d(bs.totals.entity[k]).padStart(17)} ${d(bs.totals.elimination[k]).padStart(17)} ${d(bs.totals.consolidated[k]).padStart(17)}`);
});
P(`  -- CURRENT EARNINGS${''.padEnd(25)} ${d(bs.totals.entity.current_earnings).padStart(17)} ${d(bs.totals.elimination.current_earnings).padStart(17)} ${d(bs.totals.consolidated.current_earnings).padStart(17)}`);
P('');
P('== CONSOLIDATED INCOME STATEMENT · ' + THROUGH + ' ==');
['revenue', 'cost_of_sales', 'operating_expense'].forEach(k => {
  P(`  -- ${k.replace(/_/g, ' ').toUpperCase()}`);
  is.sections[k].filter(r => r.consolidated_cents !== 0 || r.elimination_cents !== 0).forEach(line);
});
P(`  Revenue        ${d(is.totals.entity.revenue).padStart(17)} ${d(is.totals.elimination.revenue).padStart(17)} ${d(is.totals.consolidated.revenue).padStart(17)}`);
P(`  Cost of sales  ${d(is.totals.entity.cost_of_sales).padStart(17)} ${d(is.totals.elimination.cost_of_sales).padStart(17)} ${d(is.totals.consolidated.cost_of_sales).padStart(17)}`);
P(`  Gross profit   ${d(is.totals.entity.gross_profit).padStart(17)} ${d(is.totals.elimination.gross_profit).padStart(17)} ${d(is.totals.consolidated.gross_profit).padStart(17)}`);
P(`  Operating exp  ${d(is.totals.entity.operating_expense).padStart(17)} ${d(is.totals.elimination.operating_expense).padStart(17)} ${d(is.totals.consolidated.operating_expense).padStart(17)}`);
P(`  NET INCOME     ${d(is.totals.entity.net_income).padStart(17)} ${d(is.totals.elimination.net_income).padStart(17)} ${d(is.totals.consolidated.net_income).padStart(17)}`);

const engineInvariants = consolidationInvariants(result);
engineInvariants.findings.forEach(f => failures.push(f));

P('');
if (failures.length) { failures.forEach(f => P(`FAIL ${f}`)); P(`consolidation: failures=${failures.length}`); }
else P('consolidation: failures=0');
console.log(out.join('\n'));
if (failures.length) process.exitCode = 1;
