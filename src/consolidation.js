// Consolidation and elimination.
//
// THE ONE RULE THIS FILE OBEYS
// An elimination never touches an entity's own ledger. Every journal produced
// here is written to the ELIMINATION LEDGER - a separate array of journals on
// the consolidation-only entity 900 (src/consolidation-groups.js) - and the
// consolidated column is the entity ledger PLUS the elimination ledger, never
// the entity ledger with something subtracted from it in a report. Delete the
// elimination ledger and every entity's books are exactly as posted.
//
// The eliminations are DERIVED, and derived deterministically: the same posted
// books produce the same batch every time, with the same journal numbers. That
// is what makes them checkable. They are not "auto-posted": nothing reaches an
// entity ledger, nothing changes a posting status, and no user action creates
// them. Building the batch is a read.
//
// ELIMINATION TYPES
//
//   E-IC-BAL     Intercompany receivable and payable.
//                Trigger: a posted line on an intercompany account (125000 Due
//                from Related Party, 291xxx Due to/from) whose subsidiary member
//                is another entity consolidated in the same group.
//                Entry:   reverses both sides of the pair, per period, per pair.
//
//   E-IC-PL      Intercompany revenue and expense.
//                Trigger: a revenue or expense line in a journal that also
//                carries an intercompany line naming a consolidated group
//                counterparty. Interest charged by a fund to the developer and
//                the outsourcing service fee charged by the service hub are both
//                caught this way, on both sides, from the ledger - no rule-code
//                allow list, because the expense side of the service fee carries
//                no intercompany rule code at all.
//                Entry:   Dr the intercompany revenue, Cr the intercompany
//                         expense, per period, per pair.
//
//   E-IC-PROFIT  Unrealised intercompany profit held in inventory.
//                Trigger: a paired intercompany asset transfer (both journals
//                carry the same ic_pair_id) where the receiving entity
//                capitalised MORE than the transferring entity released - the
//                difference is group margin sitting in group inventory.
//                Entry:   Dr the transfer gain, Cr the receiver's inventory,
//                         for the part of the asset the group still holds.
//                Not eliminated when the receiver has already relieved the unit
//                to cost of sales: at that point the group sold it to somebody
//                outside the group and the profit is real.
//
// WHAT IS NOT ELIMINATED - and why. See docs/CONSOLIDATION.md.

import { COA, ENTITIES } from './data.js';
import { WBS_COA_MAP, memberOf, subsidiaryOf } from './coa-wbs.js';
import { ELIMINATION_ENTITY, TOP_GROUP_CODE, consolidationGroup, fullyConsolidatedEntityIds, groupMembers } from './consolidation-groups.js';

// ---- money: integer minor units, never float --------------------------------
export const cents = n => Math.round(Number(n || 0) * 100);
const dollars = c => c / 100;

// ---- account families -------------------------------------------------------
export const IC_DUE_FROM_ACCOUNTS = ['125000', '125004', '125005', '125010'];
export const IC_DUE_TO_ACCOUNTS = ['291000', '291001', '291002', '291003', '291004', '291005', '291006', '291007', '291031'];
export const IC_ACCOUNTS = [...IC_DUE_FROM_ACCOUNTS, ...IC_DUE_TO_ACCOUNTS];
// Inventory and work in progress that an intercompany transfer can land in.
export const GROUP_INVENTORY_ACCOUNTS = ['161000', '162000', '163000', '164000', '164100', '164200', '164300', '164400', '164500', '164600', '165100', '165101', '165102'];
export const IC_TRANSFER_GAIN_ACCOUNTS = ['787001'];
export const COGS_ACCOUNTS = ['510000', '510001'];

const COA_BY_CODE = Object.fromEntries(COA.map(a => [a.account_code, a]));
const ENTITY_BY_ID = Object.fromEntries(ENTITIES.map(e => [Number(e.entity_id), e]));
const ENTITY_BY_NAME = Object.fromEntries(ENTITIES.map(e => [e.entity_name, e]));

export function accountName(code) {
  return (COA_BY_CODE[code] && COA_BY_CODE[code].account_name)
    || (WBS_COA_MAP[code] && WBS_COA_MAP[code].name)
    || 'unknown account';
}
export function accountType(code) {
  if (COA_BY_CODE[code]) return COA_BY_CODE[code].account_type;
  const first = String(code)[0];
  return first === '1' ? 'ASSET' : first === '2' ? 'LIABILITY' : first === '3' ? 'EQUITY' : first === '4' ? 'REVENUE' : 'EXPENSE';
}

export const ELIMINATION_TYPES = Object.freeze([
  {code:'E-IC-BAL',    name:'Intercompany receivable and payable', rule_code:'R-ELIM-IC-BAL-01'},
  {code:'E-IC-PL',     name:'Intercompany revenue and expense',    rule_code:'R-ELIM-IC-PL-01'},
  {code:'E-IC-PROFIT', name:'Unrealised intercompany profit in inventory', rule_code:'R-ELIM-IC-PROFIT-01'},
]);
const RULE_OF_TYPE = Object.fromEntries(ELIMINATION_TYPES.map(t => [t.code, t.rule_code]));
const NAME_OF_TYPE = Object.fromEntries(ELIMINATION_TYPES.map(t => [t.code, t.name]));

const netOf = line => cents(line.debit_amount) - cents(line.credit_amount);
const inRange = (period, from, to) => (!from || period >= from) && (!to || period <= to);

// A stable, human-readable elimination journal number. Same books, same number.
const eliminationNumber = (groupCode, period, type, seq) =>
  `ELIM-${groupCode}-${period}-${type.replace(/^E-/, '')}-${String(seq).padStart(4, '0')}`;

function makeEliminationJournal({groupCode, period, type, seq, description, lines, pairKey, sources}) {
  const debit = lines.reduce((s, l) => s + cents(l.debit_amount), 0);
  const credit = lines.reduce((s, l) => s + cents(l.credit_amount), 0);
  return {
    elimination_id: eliminationNumber(groupCode, period, type, seq),
    je_number: eliminationNumber(groupCode, period, type, seq),
    ledger: 'ELIMINATION',
    entity_id: ELIMINATION_ENTITY.entity_id,
    entity_code: ELIMINATION_ENTITY.entity_code,
    entity_name: ELIMINATION_ENTITY.entity_name,
    group_code: groupCode,
    period_code: period,
    elimination_type: type,
    elimination_type_name: NAME_OF_TYPE[type],
    rule_code: RULE_OF_TYPE[type],
    pair_key: pairKey || null,
    description,
    posting_status: 'POSTED',
    created_by: 'consolidation',
    lines,
    sources: sources || [],
    total_debit_cents: debit,
    total_credit_cents: credit,
    balanced: debit === credit,
  };
}

// An elimination line. `member` is preserved from the source so a subsidiary
// ledger account never loses the counterparty it was posted against.
function elimLine(accountCode, netCents, extra = {}) {
  const amount = -netCents;   // reverse what the entities carry
  return {
    account_code: accountCode,
    account_name: accountName(accountCode),
    debit_amount: amount > 0 ? dollars(amount) : 0,
    credit_amount: amount < 0 ? dollars(-amount) : 0,
    debit_cents: amount > 0 ? amount : 0,
    credit_cents: amount < 0 ? -amount : 0,
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// Elimination builder.
// ---------------------------------------------------------------------------
export function buildEliminations({
  journals = [],
  groupCode = TOP_GROUP_CODE,
  fromPeriod = '',
  throughPeriod = '',
  memberOverrides = {},
  suppressTypes = [],
} = {}) {
  const suppressed = new Set(suppressTypes);
  const consolidatedIds = new Set(fullyConsolidatedEntityIds(groupCode, memberOverrides).map(Number));
  const consolidatedNames = new Set([...consolidatedIds].map(id => (ENTITY_BY_ID[id] || {}).entity_name).filter(Boolean));

  const scoped = journals.filter(j => j.posting_status === 'POSTED'
    && consolidatedIds.has(Number(j.entity_id))
    && inRange(String(j.period_code || ''), fromPeriod, throughPeriod));

  const warnings = [];
  const eliminations = [];
  const diagnostics = {
    ic_lines: 0,
    ic_lines_outside_boundary: 0,
    ic_journals: 0,
    ic_pl_lines: 0,
    transfer_pairs: 0,
    transfer_pairs_unrealised: 0,
    transfer_pairs_realised: 0,
    transfer_pairs_part_realised: 0,
    transfer_pairs_below_cost: 0,
  };

  // ---- E-IC-BAL ------------------------------------------------------------
  // key: period | pairKey | ownerName | account  ->  {net, sources}
  const balanceBuckets = new Map();
  // ---- E-IC-PL -------------------------------------------------------------
  const plBuckets = new Map();

  const bucket = (map, key, seed) => {
    if (!map.has(key)) map.set(key, {net: 0, sources: [], ...seed});
    return map.get(key);
  };
  const pairKeyOf = (a, b) => [a, b].sort().join(' <-> ');

  for (const je of scoped) {
    const self = ENTITY_BY_ID[Number(je.entity_id)];
    if (!self) continue;
    const period = String(je.period_code || '');
    const lines = Array.isArray(je.lines) ? je.lines : [];
    const icCounterparties = new Set();

    lines.forEach((l, index) => {
      if (!IC_ACCOUNTS.includes(l.account_code)) return;
      diagnostics.ic_lines += 1;
      const other = memberOf(l);
      if (!other || !consolidatedNames.has(other) || other === self.entity_name) {
        // Only one side of this balance is inside the reporting boundary, so it
        // cannot eliminate. It is reported, never quietly dropped.
        diagnostics.ic_lines_outside_boundary += 1;
        warnings.push(`${je.je_number || je.je_id} ${self.entity_name} ${l.account_code}: counterparty ${other || '(none)'} is not consolidated in ${groupCode}; this balance cannot eliminate.`);
        return;
      }
      icCounterparties.add(other);
      const pk = pairKeyOf(self.entity_name, other);
      const b = bucket(balanceBuckets, `${period}|${pk}|${self.entity_name}|${l.account_code}`,
        {period, pairKey: pk, owner: self.entity_name, counterparty: other, account_code: l.account_code});
      b.net += netOf(l);
      b.sources.push({je_id: je.je_id, je_number: je.je_number, entity_id: je.entity_id, entity_name: self.entity_name,
        period_code: period, line_index: index, account_code: l.account_code, member: other,
        debit_cents: cents(l.debit_amount), credit_cents: cents(l.credit_amount), description: l.description || je.description || ''});
    });

    if (!icCounterparties.size) continue;
    diagnostics.ic_journals += 1;
    if (icCounterparties.size > 1) {
      warnings.push(`${je.je_number || je.je_id} ${self.entity_name} names ${icCounterparties.size} intercompany counterparties in one journal; its revenue and expense cannot be attributed to a single pair.`);
      continue;
    }
    const other = [...icCounterparties][0];
    const pk = pairKeyOf(self.entity_name, other);
    lines.forEach((l, index) => {
      const type = accountType(l.account_code);
      if (type !== 'REVENUE' && type !== 'EXPENSE') return;
      // The gain on an intercompany asset transfer is NOT a matched
      // revenue/expense pair - the receiver books no expense against it, it
      // books an asset. It is unrealised profit, it belongs to E-IC-PROFIT, and
      // eliminating it here as well would both unbalance this entry and remove
      // the same margin twice. It is also the one intercompany result that must
      // SURVIVE consolidation once the asset has been sold outside the group.
      if (IC_TRANSFER_GAIN_ACCOUNTS.includes(l.account_code)) return;
      diagnostics.ic_pl_lines += 1;
      const b = bucket(plBuckets, `${period}|${pk}|${self.entity_name}|${l.account_code}`,
        {period, pairKey: pk, owner: self.entity_name, counterparty: other, account_code: l.account_code});
      b.net += netOf(l);
      b.sources.push({je_id: je.je_id, je_number: je.je_number, entity_id: je.entity_id, entity_name: self.entity_name,
        period_code: period, line_index: index, account_code: l.account_code, member: other,
        debit_cents: cents(l.debit_amount), credit_cents: cents(l.credit_amount), description: l.description || je.description || ''});
    });
  }

  const emitPairBuckets = (map, type, describe) => {
    if (suppressed.has(type)) return;
    const byPairPeriod = new Map();
    for (const b of map.values()) {
      const k = `${b.period}|${b.pairKey}`;
      if (!byPairPeriod.has(k)) byPairPeriod.set(k, []);
      byPairPeriod.get(k).push(b);
    }
    let seq = 0;
    [...byPairPeriod.keys()].sort().forEach(k => {
      const buckets = byPairPeriod.get(k).filter(b => b.net !== 0).sort((a, x) =>
        a.owner.localeCompare(x.owner) || a.account_code.localeCompare(x.account_code));
      if (!buckets.length) return;
      const [period, pk] = k.split('|');
      seq += 1;
      const lines = buckets.map(b => elimLine(b.account_code, b.net, {
        member: subsidiaryOf(b.account_code) ? b.counterparty : undefined,
        source_entity_id: (ENTITY_BY_NAME[b.owner] || {}).entity_id,
        source_entity_name: b.owner,
        counterparty: b.counterparty,
        description: `${describe} · ${b.owner} against ${b.counterparty}`,
      }));
      const sources = buckets.flatMap(b => b.sources);
      eliminations.push(makeEliminationJournal({
        groupCode, period, type, seq, pairKey: pk, lines, sources,
        description: `${describe} · ${pk} · ${period}`,
      }));
    });
  };
  emitPairBuckets(balanceBuckets, 'E-IC-BAL', 'Eliminate intercompany receivable and payable');
  emitPairBuckets(plBuckets, 'E-IC-PL', 'Eliminate intercompany revenue and expense');

  // ---- E-IC-PROFIT ---------------------------------------------------------
  // Paired intercompany asset transfers. Both journals carry the same
  // ic_pair_id, which is what the paired-transfer builder writes
  // (src/unit-transfer-pairing.js) and what the seeded lot transfers carry.
  const pairs = new Map();
  for (const je of scoped) {
    if (!je.ic_pair_id) continue;
    if (!pairs.has(je.ic_pair_id)) pairs.set(je.ic_pair_id, []);
    pairs.get(je.ic_pair_id).push(je);
  }
  // Cost of sales already taken by each (entity | unit), so a lot the group has
  // since sold outside itself is not "eliminated" back onto the balance sheet.
  const cogsByUnit = new Map();
  for (const je of scoped) {
    for (const l of (je.lines || [])) {
      if (!COGS_ACCOUNTS.includes(l.account_code) || !l.unit_code) continue;
      const k = `${je.entity_id}|${l.unit_code}`;
      cogsByUnit.set(k, (cogsByUnit.get(k) || 0) + cents(l.debit_amount) - cents(l.credit_amount));
    }
  }

  let profitSeq = 0;
  [...pairs.keys()].sort().forEach(pairId => {
    const group = pairs.get(pairId);
    const outSide = group.find(j => (j.lines || []).some(l => IC_DUE_FROM_ACCOUNTS.includes(l.account_code) && cents(l.debit_amount) > 0));
    const inSide = group.find(j => (j.lines || []).some(l => IC_DUE_TO_ACCOUNTS.includes(l.account_code) && cents(l.credit_amount) > 0));
    if (!outSide || !inSide || outSide === inSide) {
      warnings.push(`intercompany pair ${pairId} does not have both a transferring and a receiving journal inside ${groupCode}; unrealised profit cannot be measured for it.`);
      return;
    }
    diagnostics.transfer_pairs += 1;
    const released = (outSide.lines || []).reduce((s, l) =>
      GROUP_INVENTORY_ACCOUNTS.includes(l.account_code) ? s + cents(l.credit_amount) - cents(l.debit_amount) : s, 0);
    const capitalisedLines = (inSide.lines || [])
      .map((l, index) => ({l, index}))
      .filter(({l}) => GROUP_INVENTORY_ACCOUNTS.includes(l.account_code) && cents(l.debit_amount) > 0);
    const capitalised = capitalisedLines.reduce((s, {l}) => s + cents(l.debit_amount), 0);
    const groupGain = group.reduce((s, j) => s + (j.lines || []).reduce((t, l) =>
      IC_TRANSFER_GAIN_ACCOUNTS.includes(l.account_code) ? t + cents(l.credit_amount) - cents(l.debit_amount) : t, 0), 0);
    const unrealised = capitalised - released;
    if (unrealised < 0) {
      // The asset moved inside the group at BELOW its group carrying cost, so
      // group inventory and the group result both fall by the difference. The
      // literal reading of "intragroup profits and losses are eliminated in
      // full" would write the asset back up to group cost. This consolidation
      // deliberately does not: a transfer below carrying cost is the single
      // clearest impairment indicator a group ledger produces, and REFS holds
      // no recoverable-amount evidence with which to decide that the write-down
      // was wrong. It is reported, and left in.
      diagnostics.transfer_pairs_below_cost += 1;
      warnings.push(`intercompany pair ${pairId} moved an asset at ${dollars(-unrealised).toFixed(2)} BELOW group carrying cost. The consolidation does not write it back up: an internal transfer at a loss is an impairment indicator and REFS carries no recoverable amount to test it against. Group inventory and the group result both carry the reduction.`);
      return;
    }
    if (unrealised === 0) {
      if (groupGain !== 0) {
        warnings.push(`intercompany pair ${pairId} leaves ${dollars(groupGain).toFixed(2)} of transfer gain in the group result but nothing above group cost in inventory.`);
      }
      return;
    }
    if (groupGain !== unrealised) {
      warnings.push(`intercompany pair ${pairId}: the receiver capitalised ${dollars(unrealised).toFixed(2)} above group cost but the group result carries ${dollars(groupGain).toFixed(2)} of transfer gain. The elimination follows the inventory.`);
    }
    // How much of what the receiver capitalised has already left the group.
    const relieved = capitalisedLines.reduce((s, {l}) =>
      s + Math.max(0, cogsByUnit.get(`${inSide.entity_id}|${l.unit_code}`) || 0), 0);
    let remaining = unrealised;
    if (relieved >= capitalised) { diagnostics.transfer_pairs_realised += 1; return; }
    if (relieved > 0) {
      diagnostics.transfer_pairs_part_realised += 1;
      remaining = Math.floor(unrealised * (capitalised - relieved) / capitalised);
      if (remaining <= 0) return;
    }
    diagnostics.transfer_pairs_unrealised += 1;
    if (suppressed.has('E-IC-PROFIT')) return;
    profitSeq += 1;
    const gainAccount = IC_TRANSFER_GAIN_ACCOUNTS[0];
    const target = capitalisedLines[0];
    const period = String(inSide.period_code || outSide.period_code || '');
    const sellerName = (ENTITY_BY_ID[Number(outSide.entity_id)] || {}).entity_name || `entity ${outSide.entity_id}`;
    const buyerName = (ENTITY_BY_ID[Number(inSide.entity_id)] || {}).entity_name || `entity ${inSide.entity_id}`;
    const lines = [
      elimLine(gainAccount, -remaining, {
        source_entity_id: outSide.entity_id, source_entity_name: sellerName, counterparty: buyerName,
        description: `Remove intercompany transfer gain [${pairId}]`,
      }),
      elimLine(target.l.account_code, remaining, {
        unit_code: target.l.unit_code, source_entity_id: inSide.entity_id, source_entity_name: buyerName, counterparty: sellerName,
        description: `Restate ${target.l.unit_code || 'transferred asset'} to group carrying cost [${pairId}]`,
      }),
    ];
    const sources = [outSide, inSide].flatMap(j => (j.lines || []).map((l, index) => ({
      je_id: j.je_id, je_number: j.je_number, entity_id: j.entity_id,
      entity_name: (ENTITY_BY_ID[Number(j.entity_id)] || {}).entity_name,
      period_code: j.period_code, line_index: index, account_code: l.account_code, member: memberOf(l) || null,
      unit_code: l.unit_code || null,
      debit_cents: cents(l.debit_amount), credit_cents: cents(l.credit_amount), description: l.description || j.description || '',
    })));
    eliminations.push(makeEliminationJournal({
      groupCode, period, type: 'E-IC-PROFIT', seq: profitSeq, pairKey: pairId, lines, sources,
      description: `Eliminate unrealised intercompany profit in inventory · ${sellerName} to ${buyerName} · ${pairId}`,
    }));
  });

  eliminations.sort((a, b) => a.period_code.localeCompare(b.period_code)
    || a.elimination_type.localeCompare(b.elimination_type)
    || a.elimination_id.localeCompare(b.elimination_id));

  const batch = {
    batch_id: `ELIM-${groupCode}-${throughPeriod || 'ALL'}`,
    group_code: groupCode,
    group_name: (consolidationGroup(groupCode) || {}).group_name || groupCode,
    from_period: fromPeriod || null,
    through_period: throughPeriod || null,
    entity_count: consolidatedIds.size,
    elimination_count: eliminations.length,
    total_debit_cents: eliminations.reduce((s, e) => s + e.total_debit_cents, 0),
    total_credit_cents: eliminations.reduce((s, e) => s + e.total_credit_cents, 0),
    unbalanced: eliminations.filter(e => !e.balanced).map(e => e.elimination_id),
    suppressed_types: [...suppressed],
  };
  batch.balanced = batch.total_debit_cents === batch.total_credit_cents && !batch.unbalanced.length;
  return {batch, eliminations, warnings, diagnostics, entity_ids: [...consolidatedIds].sort((a, b) => a - b)};
}

// ---------------------------------------------------------------------------
// Consolidated trial balance: entity column, elimination column, consolidated
// column, and the drill-back for every one of them.
// ---------------------------------------------------------------------------
export function consolidatedTrialBalance({
  journals = [],
  groupCode = TOP_GROUP_CODE,
  fromPeriod = '',
  throughPeriod = '',
  memberOverrides = {},
  suppressTypes = [],
  eliminationResult = null,
} = {}) {
  const elim = eliminationResult
    || buildEliminations({journals, groupCode, fromPeriod, throughPeriod, memberOverrides, suppressTypes});
  const consolidatedIds = new Set(elim.entity_ids.map(Number));
  const rows = new Map();
  const row = code => {
    if (!rows.has(code)) rows.set(code, {
      account_code: code, account_name: accountName(code), account_type: accountType(code),
      entity_debit_cents: 0, entity_credit_cents: 0,
      elimination_debit_cents: 0, elimination_credit_cents: 0,
      entities: new Map(), elimination_refs: new Map(),
    });
    return rows.get(code);
  };

  for (const je of journals) {
    if (je.posting_status !== 'POSTED') continue;
    if (!consolidatedIds.has(Number(je.entity_id))) continue;
    if (!inRange(String(je.period_code || ''), fromPeriod, throughPeriod)) continue;
    for (const l of (je.lines || [])) {
      const r = row(l.account_code);
      const d = cents(l.debit_amount), c = cents(l.credit_amount);
      r.entity_debit_cents += d; r.entity_credit_cents += c;
      const id = Number(je.entity_id);
      if (!r.entities.has(id)) r.entities.set(id, {
        entity_id: id, entity_code: (ENTITY_BY_ID[id] || {}).entity_code || String(id),
        entity_name: (ENTITY_BY_ID[id] || {}).entity_name || String(id), debit_cents: 0, credit_cents: 0, line_count: 0,
      });
      const e = r.entities.get(id);
      e.debit_cents += d; e.credit_cents += c; e.line_count += 1;
    }
  }
  for (const el of elim.eliminations) {
    for (const l of el.lines) {
      const r = row(l.account_code);
      r.elimination_debit_cents += l.debit_cents; r.elimination_credit_cents += l.credit_cents;
      if (!r.elimination_refs.has(el.elimination_id)) r.elimination_refs.set(el.elimination_id, {
        elimination_id: el.elimination_id, elimination_type: el.elimination_type,
        period_code: el.period_code, pair_key: el.pair_key, debit_cents: 0, credit_cents: 0,
      });
      const ref = r.elimination_refs.get(el.elimination_id);
      ref.debit_cents += l.debit_cents; ref.credit_cents += l.credit_cents;
    }
  }

  const out = [...rows.values()].map(r => {
    const consolidated_debit_cents = r.entity_debit_cents + r.elimination_debit_cents;
    const consolidated_credit_cents = r.entity_credit_cents + r.elimination_credit_cents;
    return {
      account_code: r.account_code, account_name: r.account_name, account_type: r.account_type,
      entity_debit_cents: r.entity_debit_cents, entity_credit_cents: r.entity_credit_cents,
      entity_balance_cents: r.entity_debit_cents - r.entity_credit_cents,
      elimination_debit_cents: r.elimination_debit_cents, elimination_credit_cents: r.elimination_credit_cents,
      elimination_balance_cents: r.elimination_debit_cents - r.elimination_credit_cents,
      consolidated_debit_cents, consolidated_credit_cents,
      consolidated_balance_cents: consolidated_debit_cents - consolidated_credit_cents,
      entities: [...r.entities.values()].sort((a, b) => Math.abs(b.debit_cents - b.credit_cents) - Math.abs(a.debit_cents - a.credit_cents)),
      elimination_refs: [...r.elimination_refs.values()].sort((a, b) => a.elimination_id.localeCompare(b.elimination_id)),
    };
  }).sort((a, b) => a.account_code.localeCompare(b.account_code));

  const total = key => out.reduce((s, r) => s + r[key], 0);
  return {
    group_code: groupCode, from_period: fromPeriod || null, through_period: throughPeriod || null,
    rows: out,
    totals: {
      entity_debit_cents: total('entity_debit_cents'), entity_credit_cents: total('entity_credit_cents'),
      elimination_debit_cents: total('elimination_debit_cents'), elimination_credit_cents: total('elimination_credit_cents'),
      consolidated_debit_cents: total('consolidated_debit_cents'), consolidated_credit_cents: total('consolidated_credit_cents'),
    },
    elimination: elim,
  };
}

const signedBalance = (row, column) => {
  const bal = row[`${column}_balance_cents`];
  return (row.account_type === 'ASSET' || row.account_type === 'EXPENSE') ? bal : -bal;
};

function statementSection(rows, types, column) {
  const picked = rows.filter(r => types.includes(r.account_type) && (r.entity_balance_cents !== 0 || r.consolidated_balance_cents !== 0));
  return picked.map(r => ({
    account_code: r.account_code, account_name: r.account_name, account_type: r.account_type,
    entity_cents: signedBalance(r, 'entity'),
    elimination_cents: signedBalance(r, 'elimination'),
    consolidated_cents: signedBalance(r, 'consolidated'),
    entities: r.entities, elimination_refs: r.elimination_refs,
  })).sort((a, b) => a.account_code.localeCompare(b.account_code));
}
const sectionTotal = (section, key) => section.reduce((s, r) => s + r[key], 0);

export function consolidatedBalanceSheet(tb) {
  const assets = statementSection(tb.rows, ['ASSET'], 'consolidated');
  const liabilities = statementSection(tb.rows, ['LIABILITY'], 'consolidated');
  const equity = statementSection(tb.rows, ['EQUITY'], 'consolidated');
  const revenue = statementSection(tb.rows, ['REVENUE'], 'consolidated');
  const expense = statementSection(tb.rows, ['EXPENSE'], 'consolidated');
  const col = key => ({
    assets: sectionTotal(assets, key),
    liabilities: sectionTotal(liabilities, key),
    equity: sectionTotal(equity, key),
    current_earnings: sectionTotal(revenue, key) - sectionTotal(expense, key),
  });
  const entity = col('entity_cents'), elimination = col('elimination_cents'), consolidated = col('consolidated_cents');
  const check = c => c.assets - (c.liabilities + c.equity + c.current_earnings);
  return {
    sections: {assets, liabilities, equity},
    totals: {entity, elimination, consolidated},
    out_of_balance_cents: {entity: check(entity), elimination: check(elimination), consolidated: check(consolidated)},
    balanced: check(consolidated) === 0,
  };
}

export function consolidatedIncomeStatement(tb) {
  const revenue = statementSection(tb.rows, ['REVENUE'], 'consolidated');
  const cogs = statementSection(tb.rows, ['EXPENSE'], 'consolidated').filter(r => /^51/.test(r.account_code));
  const opex = statementSection(tb.rows, ['EXPENSE'], 'consolidated').filter(r => !/^51/.test(r.account_code));
  const col = key => {
    const rev = sectionTotal(revenue, key), c = sectionTotal(cogs, key), o = sectionTotal(opex, key);
    return {revenue: rev, cost_of_sales: c, gross_profit: rev - c, operating_expense: o, net_income: rev - c - o};
  };
  return {
    sections: {revenue, cost_of_sales: cogs, operating_expense: opex},
    totals: {entity: col('entity_cents'), elimination: col('elimination_cents'), consolidated: col('consolidated_cents')},
  };
}

// One call for the whole consolidated report set.
export function buildConsolidation(options = {}) {
  const tb = consolidatedTrialBalance(options);
  return {
    group: consolidationGroup(options.groupCode || TOP_GROUP_CODE),
    members: groupMembers(options.groupCode || TOP_GROUP_CODE, options.memberOverrides || {}),
    trialBalance: tb,
    balanceSheet: consolidatedBalanceSheet(tb),
    incomeStatement: consolidatedIncomeStatement(tb),
    elimination: tb.elimination,
  };
}

// ---- drill-back -------------------------------------------------------------
// Every consolidated figure resolves to the entities and the eliminations that
// produced it, and every elimination resolves to the posted journal lines it was
// derived from. Nothing in the consolidated column is unattributable.
export function consolidatedAccountDetail(result, accountCode) {
  const tb = result.trialBalance || result;
  const row = tb.rows.find(r => r.account_code === accountCode);
  if (!row) return null;
  const byId = Object.fromEntries((tb.elimination.eliminations || []).map(e => [e.elimination_id, e]));
  return {
    ...row,
    eliminations: row.elimination_refs.map(ref => {
      const e = byId[ref.elimination_id];
      return {
        ...ref,
        description: e ? e.description : '',
        rule_code: e ? e.rule_code : '',
        balanced: e ? e.balanced : false,
        lines: e ? e.lines.filter(l => l.account_code === accountCode) : [],
        sources: e ? e.sources.filter(s => s.account_code === accountCode || !s.account_code) : [],
      };
    }),
  };
}

export function eliminationDetail(result, eliminationId) {
  const list = (result.trialBalance ? result.trialBalance.elimination : result.elimination || result).eliminations || [];
  return list.find(e => e.elimination_id === eliminationId) || null;
}

// ---- invariants -------------------------------------------------------------
// The measurement script and the verifier both call this. It returns findings,
// it does not throw, and it never adjusts anything to make a check pass.
export function consolidationInvariants(result) {
  const tb = result.trialBalance;
  const bs = result.balanceSheet;
  const el = tb.elimination;
  const findings = [];
  const at = code => tb.rows.find(r => r.account_code === code);

  const icResidual = IC_ACCOUNTS.reduce((s, code) => s + (at(code) ? at(code).consolidated_balance_cents : 0), 0);
  if (icResidual !== 0) findings.push(`consolidated intercompany residual is ${dollars(icResidual).toFixed(2)}, not 0.00`);

  if (tb.totals.consolidated_debit_cents !== tb.totals.consolidated_credit_cents) {
    findings.push(`consolidated trial balance does not tie: debit ${dollars(tb.totals.consolidated_debit_cents).toFixed(2)} credit ${dollars(tb.totals.consolidated_credit_cents).toFixed(2)}`);
  }
  if (bs.out_of_balance_cents.consolidated !== 0) {
    findings.push(`consolidated Assets do not equal Liabilities + Equity + current earnings; out by ${dollars(bs.out_of_balance_cents.consolidated).toFixed(2)}`);
  }
  for (const e of el.eliminations) {
    if (!e.balanced) findings.push(`elimination ${e.elimination_id} does not balance: debit ${dollars(e.total_debit_cents).toFixed(2)} credit ${dollars(e.total_credit_cents).toFixed(2)}`);
  }
  if (!el.batch.balanced) findings.push(`elimination batch ${el.batch.batch_id} does not balance`);
  return {ok: findings.length === 0, findings, ic_residual_cents: icResidual};
}
