// ---------------------------------------------------------------------------
// Consolidation and elimination regression gate.
//
// The product can now consolidate. This file exists so that none of the things
// that make the consolidation trustworthy can quietly regress:
//
//   1. The group is explicit data. Every entity in the master has exactly one
//      membership row, with an ownership basis and a method, and the ownership
//      graph has one root and no cycles.
//   2. An elimination is a journal on a separate elimination ledger, on an
//      entity that does not exist in the entity master. Building the batch is a
//      READ: no entity ledger changes, ever.
//   3. Every elimination balances in itself, and so does the batch.
//   4. The consolidated statements hold: no intercompany account carries a
//      consolidated balance, Assets = Liabilities + Equity + current earnings,
//      consolidated revenue and expense exclude intercompany activity, and no
//      unrealised intercompany profit is left in group inventory.
//   5. Every consolidated figure drills back to the entities and the posted
//      journal lines that produced it.
//   6. Each elimination type is load bearing: removing it breaks the statements.
//   7. The group boundary is load bearing: taking a member out of it leaves an
//      intercompany residual, and every unmatched balance is reported.
//
// Run: node verify-consolidation-invariants.mjs   (auto-discovered by tools/run-verifiers.mjs)
// ---------------------------------------------------------------------------
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { ENTITIES } from './src/data.js';
import { JOURNAL_ENTRIES, FY2026 } from './src/seed.js';
import {
  buildConsolidation, consolidationInvariants, consolidatedAccountDetail,
  ELIMINATION_TYPES, IC_ACCOUNTS, IC_TRANSFER_GAIN_ACCOUNTS, GROUP_INVENTORY_ACCOUNTS, cents,
} from './src/consolidation.js';
import {
  CONSOLIDATION_GROUPS, CONSOLIDATION_MEMBERS, CONSOLIDATION_METHODS, ELIMINATION_ENTITY,
  TOP_GROUP_CODE, fullyConsolidatedEntityIds, groupTree, validateConsolidationModel,
} from './src/consolidation-groups.js';

const read = file => readFileSync(new URL(file, import.meta.url), 'utf8');
const POSTED = [...JOURNAL_ENTRIES, ...FY2026].filter(j => j.posting_status === 'POSTED');
const THROUGH = '2026-07';
const pass = name => console.log(`PASS ${name}`);

// -- 1. the group model ------------------------------------------------------
const model = validateConsolidationModel(ENTITIES, CONSOLIDATION_MEMBERS);
assert.deepEqual(model.findings, [], `consolidation group model defects:\n${model.findings.join('\n')}`);
assert.equal(CONSOLIDATION_MEMBERS.length, ENTITIES.length, 'every entity must have exactly one membership row');
assert.equal(new Set(CONSOLIDATION_MEMBERS.map(m => m.entity_id)).size, ENTITIES.length, 'membership rows must be unique per entity');
assert.equal(CONSOLIDATION_MEMBERS.filter(m => m.parent_entity_id == null).length, 1, 'the group must have exactly one ultimate parent');
for (const m of CONSOLIDATION_MEMBERS) {
  assert.ok(Number.isInteger(m.ownership_bp), `entity ${m.entity_id} ownership must be integer basis points, never a float`);
  assert.ok(CONSOLIDATION_METHODS.includes(m.method), `entity ${m.entity_id} carries an unknown consolidation method`);
}
assert.equal(groupTree(TOP_GROUP_CODE).length, CONSOLIDATION_GROUPS.length, 'every group must roll up into the top group');
assert.ok(!ENTITIES.some(e => Number(e.entity_id) === ELIMINATION_ENTITY.entity_id),
  'the elimination entity must not be in the entity master');
pass(`consolidation group model: ${CONSOLIDATION_MEMBERS.length} members in ${CONSOLIDATION_GROUPS.length} groups, one root, no cycles`);

// -- 2. building the batch is a read ----------------------------------------
const signature = () => POSTED.map(j => `${j.je_id}|${j.entity_id}|${j.posting_status}|${(j.lines || [])
  .map(l => `${l.account_code}:${cents(l.debit_amount)}:${cents(l.credit_amount)}:${l.member || ''}:${l.unit_code || ''}`).join(',')}`).join('~');
const before = signature();
const options = {journals: POSTED, groupCode: TOP_GROUP_CODE, throughPeriod: THROUGH};
const result = buildConsolidation(options);
buildConsolidation(options);
assert.equal(signature(), before, 'building the elimination batch changed an entity ledger');
const tb = result.trialBalance, bs = result.balanceSheet, is = result.incomeStatement, elim = result.elimination;
const entityIds = new Set(ENTITIES.map(e => Number(e.entity_id)));
for (const e of elim.eliminations) {
  assert.equal(Number(e.entity_id), ELIMINATION_ENTITY.entity_id, `${e.elimination_id} is not on the elimination entity`);
  assert.ok(!entityIds.has(Number(e.entity_id)), `${e.elimination_id} is posted to an entity in the entity master`);
  assert.equal(e.ledger, 'ELIMINATION', `${e.elimination_id} is not on the elimination ledger`);
}
pass(`elimination ledger: ${elim.eliminations.length} entries, all on consolidation-only entity ${ELIMINATION_ENTITY.entity_id}, entity ledgers untouched`);

// -- 3. eliminations balance -------------------------------------------------
const unbalanced = elim.eliminations.filter(e => !e.balanced);
assert.deepEqual(unbalanced.map(e => e.elimination_id), [], 'every elimination must balance in itself');
assert.ok(elim.batch.balanced, 'the elimination batch must balance');
assert.equal(elim.batch.total_debit_cents, elim.batch.total_credit_cents, 'batch debits must equal batch credits');
pass(`every elimination balances in itself and the batch ties at ${(elim.batch.total_debit_cents / 100).toFixed(2)}`);

// -- 4. the consolidated statements hold ------------------------------------
const invariants = consolidationInvariants(result);
assert.deepEqual(invariants.findings, [], `consolidated statements:\n${invariants.findings.join('\n')}`);
const at = code => tb.rows.find(r => r.account_code === code);
const icStillCarried = IC_ACCOUNTS.filter(c => at(c) && at(c).consolidated_balance_cents !== 0);
assert.deepEqual(icStillCarried, [], 'no intercompany account may carry a consolidated balance');
assert.equal(invariants.ic_residual_cents, 0, 'consolidated intercompany residual must be exactly 0.00');
assert.equal(bs.out_of_balance_cents.consolidated, 0, 'consolidated Assets must equal Liabilities + Equity + current earnings');
assert.equal(tb.totals.consolidated_debit_cents, tb.totals.consolidated_credit_cents, 'consolidated trial balance must tie');
pass('consolidated intercompany residual 0.00, no intercompany account left on the balance sheet, statements tie');

// Intercompany revenue and expense, measured here rather than taken from the engine.
const consolidatedNames = new Set(fullyConsolidatedEntityIds(TOP_GROUP_CODE)
  .map(id => (ENTITIES.find(e => Number(e.entity_id) === id) || {}).entity_name).filter(Boolean));
let icRevenue = 0, icExpense = 0;
for (const j of POSTED) {
  if (String(j.period_code || '') > THROUGH) continue;
  const self = ENTITIES.find(e => Number(e.entity_id) === Number(j.entity_id));
  if (!self || !consolidatedNames.has(self.entity_name)) continue;
  const counterparties = new Set((j.lines || [])
    .filter(l => IC_ACCOUNTS.includes(l.account_code))
    .map(l => l.member || (l.description || '').split('_').slice(1).join('_'))
    .filter(m => consolidatedNames.has(m) && m !== self.entity_name));
  if (counterparties.size !== 1) continue;
  for (const l of (j.lines || [])) {
    if (IC_TRANSFER_GAIN_ACCOUNTS.includes(l.account_code)) continue;
    const net = cents(l.debit_amount) - cents(l.credit_amount);
    const first = String(l.account_code)[0];
    if (first === '4') icRevenue += -net;
    else if (first >= '5') icExpense += net;
  }
}
assert.ok(icRevenue > 0, 'the ledger must carry intercompany revenue for this gate to mean anything');
assert.equal(icRevenue, icExpense, 'intercompany revenue must equal intercompany expense or the pair cannot eliminate');
assert.equal(is.totals.consolidated.revenue, is.totals.entity.revenue - icRevenue,
  'consolidated revenue must be entity revenue less exactly the intercompany revenue');
const profitElimOnGain = elim.eliminations.filter(e => e.elimination_type === 'E-IC-PROFIT')
  .reduce((s, e) => s + e.lines.filter(l => IC_TRANSFER_GAIN_ACCOUNTS.includes(l.account_code))
    .reduce((t, l) => t + l.debit_cents - l.credit_cents, 0), 0);
const entityExpense = is.totals.entity.cost_of_sales + is.totals.entity.operating_expense;
const consolidatedExpense = is.totals.consolidated.cost_of_sales + is.totals.consolidated.operating_expense;
assert.equal(consolidatedExpense, entityExpense - icExpense + profitElimOnGain,
  'consolidated expense must be entity expense less exactly the intercompany expense');
pass(`consolidated revenue and expense exclude ${(icRevenue / 100).toFixed(2)} of intercompany activity`);

// Unrealised intercompany profit in inventory, measured here.
const pairs = new Map();
for (const j of POSTED) {
  if (!j.ic_pair_id || String(j.period_code || '') > THROUGH) continue;
  if (!pairs.has(j.ic_pair_id)) pairs.set(j.ic_pair_id, []);
  pairs.get(j.ic_pair_id).push(j);
}
let capitalisedAboveCost = 0, transferPairs = 0;
for (const group of pairs.values()) {
  const released = group.reduce((s, j) => s + (j.lines || []).reduce((t, l) =>
    GROUP_INVENTORY_ACCOUNTS.includes(l.account_code) ? t + cents(l.credit_amount) : t, 0), 0);
  const capitalised = group.reduce((s, j) => s + (j.lines || []).reduce((t, l) =>
    GROUP_INVENTORY_ACCOUNTS.includes(l.account_code) ? t + cents(l.debit_amount) : t, 0), 0);
  if (!released && !capitalised) continue;
  transferPairs += 1;
  capitalisedAboveCost += Math.max(0, capitalised - released);
}
assert.ok(transferPairs > 0, 'the ledger must carry a paired intercompany asset transfer for this gate to mean anything');
assert.ok(capitalisedAboveCost > 0, 'the ledger must carry intercompany margin capitalised in inventory');
const inventoryEliminated = -GROUP_INVENTORY_ACCOUNTS.reduce((s, c) => s + (at(c) ? at(c).elimination_balance_cents : 0), 0);
assert.equal(inventoryEliminated, capitalisedAboveCost,
  'the eliminations must remove exactly the intercompany margin capitalised in group inventory');
assert.equal(at('787001') ? at('787001').consolidated_balance_cents : 0, 0,
  'no intercompany transfer gain may survive into the consolidated result');
pass(`${transferPairs} intercompany asset transfer(s): ${(capitalisedAboveCost / 100).toFixed(2)} of unrealised profit removed from group inventory`);

// -- 5. drill-back -----------------------------------------------------------
for (const row of tb.rows) {
  const fromEntities = row.entities.reduce((s, e) => s + e.debit_cents - e.credit_cents, 0);
  assert.equal(fromEntities, row.entity_balance_cents,
    `${row.account_code}: the entity column does not re-add from the entities behind it`);
  if (row.elimination_balance_cents !== 0) {
    assert.ok(row.elimination_refs.length, `${row.account_code}: an eliminated figure names no elimination`);
  }
}
for (const e of elim.eliminations) {
  assert.ok(e.sources.length, `${e.elimination_id} names no posted journal line`);
  for (const s of e.sources) {
    assert.ok(s.je_number || s.je_id != null, `${e.elimination_id} carries a source with no journal reference`);
    assert.ok(entityIds.has(Number(s.entity_id)), `${e.elimination_id} names a source on an entity outside the master`);
  }
}
const drill = consolidatedAccountDetail(result, '125000');
assert.ok(drill && drill.entities.length > 1 && drill.eliminations.length > 0,
  'the intercompany receivable must drill to the entities and eliminations behind it');
pass(`drill-back: ${tb.rows.length} consolidated accounts re-add from their entities; every elimination names its source lines`);

// -- 6. each elimination type is load bearing --------------------------------
for (const type of ELIMINATION_TYPES) {
  const broken = buildConsolidation({...options, suppressTypes: [type.code]});
  const brokenAt = code => broken.trialBalance.rows.find(r => r.account_code === code);
  const grossIc = IC_ACCOUNTS.reduce((s, c) => s + Math.abs(brokenAt(c) ? brokenAt(c).consolidated_balance_cents : 0), 0);
  const changed = grossIc !== 0
    || broken.balanceSheet.totals.consolidated.assets !== bs.totals.consolidated.assets
    || broken.incomeStatement.totals.consolidated.revenue !== is.totals.consolidated.revenue
    || broken.incomeStatement.totals.consolidated.net_income !== is.totals.consolidated.net_income;
  assert.ok(changed, `suppressing ${type.code} changed nothing in the consolidated statements; the elimination does no work`);
}
pass(`${ELIMINATION_TYPES.length} elimination types proved load bearing: removing any one changes the consolidated statements`);

// -- 7. the group boundary is load bearing -----------------------------------
const excluded = buildConsolidation({...options, memberOverrides: {3: 'EXCLUDED'}});
const excludedResidual = IC_ACCOUNTS.reduce((s, c) => {
  const r = excluded.trialBalance.rows.find(x => x.account_code === c);
  return s + (r ? r.consolidated_balance_cents : 0);
}, 0);
assert.notEqual(excludedResidual, 0, 'excluding a member from the group must leave an intercompany residual');
assert.ok(excluded.elimination.warnings.length > 0,
  'an intercompany balance whose counterparty is outside the boundary must be reported, never dropped');
assert.equal(elim.warnings.length, 0, 'the full group must leave no unmatched intercompany balance');
pass(`group boundary is load bearing: excluding the funder leaves ${(excludedResidual / 100).toFixed(2)} residual and ${excluded.elimination.warnings.length} reported item(s)`);

// -- 8. source contracts -----------------------------------------------------
const engineSource = read('./src/consolidation.js');
const groupSource = read('./src/consolidation-groups.js');
const appSource = read('./src/app.jsx');
const moduleSource = read('./src/module-consolidation.jsx');
const transferSource = read('./src/unit-transfer-pairing.js');

assert.ok(/entity_id: 900/.test(groupSource), 'the elimination entity must be declared in the group model');
for (const marker of ['E-IC-BAL', 'E-IC-PL', 'E-IC-PROFIT']) {
  assert.ok(engineSource.includes(marker), `the engine must declare elimination type ${marker}`);
  assert.ok(moduleSource.includes('ELIMINATION_TYPES') || moduleSource.includes(marker),
    `the consolidation workspace must present elimination type ${marker}`);
}
// Nothing in the consolidation may write to an entity ledger. It never imports
// the repository, the journal workflow or the seed's mutable arrays.
for (const f of ['./repo.js', './je-workflow.js', './document-posting.js', './seed.js']) {
  assert.ok(!engineSource.includes(`from '${f}'`), `the consolidation engine must not import ${f}`);
}
// No assignment to any field of a journal or a journal line. The runtime check
// above already proves the ledger is unchanged; this stops the pattern being
// introduced at all.
const mutation = /\b(je|j|jes|journal|journals|line|lines|l)\s*(\[[^\]]*\])?\s*\.\s*(posting_status|lines|debit_amount|credit_amount|entity_id|period_code|account_code|member)\s*=[^=]/;
assert.ok(!mutation.test(engineSource),
  'the consolidation engine must not assign to any field of a journal or a journal line');
assert.ok(!/Object\.assign\(\s*(je|j|journal|line|l)\b/.test(engineSource),
  'the consolidation engine must not Object.assign onto a journal or a journal line');
assert.ok(appSource.includes("COMP.consolidation = Consolidation"), 'the consolidation workspace must be routed');
assert.ok(/\['consolidation','Consolidation'\]/.test(appSource), 'the consolidation workspace must be in the navigation');
const seedVersion = (appSource.match(/const SEED_V='v(\d+)'/) || [])[1];
assert.ok(seedVersion && Number(seedVersion) >= 14,
  `SEED_V must be raised past v13 when the seed structure changes (found v${seedVersion})`);
// The unit-transfer path must not push the consolidation entry into the
// receiver's own ledger. The receiver capitalises what it paid.
assert.ok(transferSource.includes('debit_amount:consideration'),
  'the receiving entity must capitalise the transfer price on its own books');
assert.ok(!/inLines\.push\(\{ account_code:IC_TRANSFER_GAIN_ACCOUNT/.test(transferSource),
  'the receiving entity must not carry the eliminating entry for the transferor gain in its own ledger');
pass('source contracts: elimination types declared, workspace routed, seed version raised, no elimination pushed into an entity ledger');

console.log('PASS consolidation invariants');
