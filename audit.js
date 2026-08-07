// ---------------------------------------------------------------------------
// REFS ledger audit gate.
//
// This script answers one question: does the posted ledger obey the accounting
// red lines, or does it not. It reports two independent things and never mixes
// them:
//
//   fails=            journal CONTENT defects. The books are wrong. Hard stop.
//   period-control    posting AUTHORIZATION defects on already-Posted evidence.
//                     The books may be right; nobody opened the period they sit
//                     in. Resolved by a period action or a reversal, by a human,
//                     never by this script re-dating or deleting anything.
//
// Why the split, restated for every new rule below: a content rule asks "is
// this entry a correct record of what happened". A control rule asks "was this
// entry allowed to be made". A malformed period code like 2027-13 is a CONTENT
// defect, not a control one, because no period authority could ever open it. A
// journal on an entity that is not in the entity master is likewise content: the
// period master cannot arbitrate a posting for an entity that does not exist.
// Only the two codes below - a period the master marks CLOSED, and an
// entity/period the master holds no record for - are authorization questions,
// and they keep their own reported line.
//
// Money is compared in integer minor units at the precision the database
// stores, numeric(20,4) - that is, ten-thousandths. There is no tolerance. The
// previous 0.005 per-journal float tolerance is gone; see AUD-BAL-001/002.
//
// Every rule here is mutation-tested. See tools/analysis/audit-mutations.js and
// tools/analysis/audit-mutation-harness.mjs, and docs/AUDIT-GATE-HARDENING.md.
// ---------------------------------------------------------------------------
import { COA, ENTITIES, PERIODS, PROJECTS, LOANS, MAPPINGS } from './src/data.js';
import { WBS_COA_MAP, subsidiaryOf, memberOf } from './src/coa-wbs.js';
import { JOURNAL_ENTRIES, FY2026, SOURCE_DOCS } from './src/seed.js';
import { jeTotals, validateJE } from './src/engine.js';
import { periodControlExceptions, PERIOD_CLOSED, PERIOD_NOT_CONFIGURED, PERIOD_CODE_PATTERN } from './src/period-control.js';
import { INJECTIONS } from './tools/analysis/audit-mutations.js';

const PERIOD_AUTHORIZATION_CODES = new Set([PERIOD_CLOSED, PERIOD_NOT_CONFIGURED, 'JE_PERIOD_UNIDENTIFIED']);

// ---------------------------------------------------------------------------
// Money. numeric(20,4) on the Postgres side, so the ledger's minor unit is one
// ten-thousandth. Everything is accumulated as an integer count of those units;
// no comparison anywhere in this file uses a tolerance.
// ---------------------------------------------------------------------------
const UNIT = 10000;
const U = (n) => Math.round((Number(n) || 0) * UNIT);
const fmtU = (n) => (n < 0 ? '(' : '') + '$' + (Math.abs(n) / UNIT).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 4}) + (n < 0 ? ')' : '');
// True when the literal value carries more precision than numeric(20,4) can
// hold. Read off the decimal text, not off a float multiplication, because
// 1703376.86 * 10000 is 17033768599.999998 in binary floating point.
const overPrecision = (v) => {
  if (v === undefined || v === null || v === '') return false;
  const s = String(v);
  if (/e/i.test(s)) return true;
  const dot = s.indexOf('.');
  return dot >= 0 && s.length - dot - 1 > 4;
};

// ---------------------------------------------------------------------------
// Account families, read off the WBS master chart wherever possible.
// ---------------------------------------------------------------------------
const CASH_ACCOUNTS = (c) => /^11\d{4}$/.test(c);
const LOAN_PAYABLE = new Set(['260100', '260101', '260200', '260300', '260700', '260701', '260702', '260703', '260704',
  '270100', '270101', '270200', '270700', '270701', '270702', '289500', '227303', '227304']);
const LOAN_INTEREST_PAYABLE = new Set(['220410', '220451', '220310']);
const CAPITALISED_INTEREST = new Set(['164500', '164501']);
const INTEREST_EXPENSE = new Set(['795000', '661000', '772450']);
// Vertical construction work in progress. 164100 CWIP - Land is deliberately
// excluded: land development at a LandCo is a parcel cost and carries no unit.
const VERTICAL_CWIP = new Set(['164200', '164300', '164400', '164500', '164600', '164700', '164900']);
const UNIT_COST_ACCOUNTS = new Set(['161000', '162000', '163000', '164000', '164100', '164200', '164300', '164400', '164500', '164600']);
const FINISHED_INVENTORY = new Set(['165100', '165101', '165102']);
const COGS_ACCOUNTS = new Set(['510000', '510001']);
const UNIT_SALE_REVENUE = new Set(['491800', '490100', '490101']);
const DEPOSIT_LIABILITY = new Set(['225000', '225001', '225100', '225200', '227200', '227201', '228100', '220600']);
// 163000 Inventory_Buildings and 1651xx Inventory are for-sale inventory in the
// WBS master, not depreciable property, so they are not in this list.
const DEPRECIABLE_FA = new Set(['162000', '165000', '165200', '165300', '165301', '165400', '165500', '165600', '165700', '165800', '165900', '165901', '165902']);
const DEPRECIATION_EXPENSE = new Set(['785000', '785500', '786000', '787000', '787003', '789000']);
const SUSPENSE_ACCOUNTS = new Set(['142000', '221010', '227100', '123300']);
const IC_DUE_FROM = new Set(['125000', '125004', '125005', '125010']);
const IC_DUE_TO = new Set(['291000', '291001', '291002', '291003', '291004', '291005', '291006', '291007', '291031']);
const IC_ACCOUNTS = new Set([...IC_DUE_FROM, ...IC_DUE_TO]);

const DEPOSIT_TEXT = /security deposit|sec[_ -]?deposit|pet deposit|key deposit|earnest money deposit|damage deposit/i;
const LOAN_DRAW_TEXT = /loan draw|draw request|construction draw #/i;

// ---------------------------------------------------------------------------
// Ledger under audit. REFS_AUDIT_INJECT applies one named defect from the
// mutation catalogue to a COPY of the shipped ledger. Injections only ever ADD
// a defect, so the variable cannot be used to make the gate greener; and when
// it is set, the run also fails unless the rule it targets actually fires.
// ---------------------------------------------------------------------------
const injectName = process.env.REFS_AUDIT_INJECT || '';
if (injectName === '--list') {
  console.log(JSON.stringify(Object.entries(INJECTIONS).map(([name, i]) => ({name, rule: i.rule, describe: i.describe})), null, 2));
  process.exit(0);
}
let jes = [...JOURNAL_ENTRIES, ...FY2026];
let expectedRule = null;
if (injectName) {
  const injection = INJECTIONS[injectName];
  if (!injection) { console.error(`audit: unknown REFS_AUDIT_INJECT '${injectName}'`); process.exit(2); }
  jes = injection.apply(jes);
  expectedRule = injection.rule;
}
const posted = jes.filter((j) => j.posting_status === 'POSTED');

// ---------------------------------------------------------------------------
// Failure reporting. A failure names the journal, entity, period, account and
// the rule violated, so that an accountant can act on the line alone.
// ---------------------------------------------------------------------------
const ENTITY_BY_ID = new Map(ENTITIES.map((e) => [Number(e.entity_id), e]));
const ENTITY_NAMES = new Set(ENTITIES.map((e) => e.entity_name));
const PROJECT_BY_ID = new Map(PROJECTS.map((p) => [p.project_id, p]));
const PROJECTS_BY_ENTITY = new Map();
PROJECTS.forEach((p) => { if (!PROJECTS_BY_ENTITY.has(p.entity_id)) PROJECTS_BY_ENTITY.set(p.entity_id, []); PROJECTS_BY_ENTITY.get(p.entity_id).push(p); });
const LOAN_BY_ID = new Map(LOANS.map((l) => [l.loan_id, l]));
const knownAccounts = new Set([...COA.map((a) => a.account_code), ...Object.keys(WBS_COA_MAP)]);
const accountName = (code) => (WBS_COA_MAP[code] && WBS_COA_MAP[code].name)
  || (COA.find((a) => a.account_code === code) || {}).account_name || 'unknown account';

const failures = [];
const RULES = {};
const fail = (rule, je, account, message) => {
  const e = ENTITY_BY_ID.get(Number(je && je.entity_id));
  const ref = (je && (je.je_number || je.je_id)) || 'n/a';
  failures.push({
    rule,
    ref,
    entity_id: je ? je.entity_id : null,
    entity_code: e ? e.entity_code : '?',
    period_code: je ? je.period_code : null,
    account,
    message,
    line: `${rule} je=${ref} entity=${je ? je.entity_id : 'n/a'} (${e ? e.entity_code : '?'}) period=${je ? je.period_code : 'n/a'}`
      + (account ? ` account=${account} (${accountName(account)})` : '')
      + ` :: ${message}`,
  });
  RULES[rule] = (RULES[rule] || 0) + 1;
};
// Some rules are about an aggregate (a unit, a pair of entities, an entity's
// suspense balance) rather than one journal. They still have to name the
// journals involved, so they pass a synthetic carrier with the real references.
const scope = (entity_id, period_code, ref) => ({entity_id, period_code, je_number: ref});

// ===========================================================================
// PASS 1 - per journal. Structure, money, identity, provenance.
// ===========================================================================
for (const je of jes) {
  const lines = Array.isArray(je.lines) ? je.lines : [];

  // ---- AUD-BAL-001 / AUD-BAL-002: exact money, no tolerance ---------------
  let debitU = 0, creditU = 0;
  for (const l of lines) {
    debitU += U(l.debit_amount);
    creditU += U(l.credit_amount);
    for (const [field, value] of [['debit_amount', l.debit_amount], ['credit_amount', l.credit_amount]]) {
      if (overPrecision(value)) {
        fail('AUD-BAL-002', je, l.account_code,
          `${field} ${value} carries more precision than the ledger's minor unit. Amounts are stored numeric(20,4); anything finer is silently rounded on the way in and the journal stops tying to its source.`);
      }
    }
    if ((l.debit_amount || 0) < 0 || (l.credit_amount || 0) < 0) {
      fail('AUD-SIGN-001', je, l.account_code,
        `line carries a negative amount (debit ${l.debit_amount || 0}, credit ${l.credit_amount || 0}). Direction is expressed by the side of the entry, never by the sign; a negative credit is a debit and must be booked as one, or the trial balance columns stop being additive.`);
    }
  }
  if (debitU !== creditU) {
    fail('AUD-BAL-001', je, null,
      `journal does not balance: debit ${fmtU(debitU)} credit ${fmtU(creditU)}, out by ${fmtU(debitU - creditU)}. Balance is exact in ten-thousandths (numeric(20,4)); there is no tolerance.`);
  }
  if (debitU <= 0 && lines.length) {
    fail('AUD-BAL-003', je, null, `journal carries no positive debit total (${fmtU(debitU)}). An entry with nothing on the debit side records nothing.`);
  }
  if (!lines.length) fail('AUD-BAL-003', je, null, 'journal has no lines.');

  // ---- AUD-COA-002 / 003 / 004: chart of accounts integrity ---------------
  for (const l of lines) {
    const code = String(l.account_code == null ? '' : l.account_code);
    if (!/^\d{6}$/.test(code)) {
      fail('AUD-COA-002', je, code || '(empty)',
        `account code '${code}' is not six digits. The WBS chart is six-digit throughout; a truncated or padded code cannot be mapped back to a real account and silently lands in whatever the fallback classifier guesses.`);
      continue;
    }
    if (!knownAccounts.has(code)) {
      fail('AUD-COA-004', je, code, 'account is in neither the demo chart of accounts nor the WBS master template.');
      continue;
    }
    const master = WBS_COA_MAP[code];
    if (master && (master.kind === 'H' || master.kind === 'T')) {
      fail('AUD-COA-003', je, code,
        `account is a ${master.kind === 'H' ? 'HEADER' : 'TOTAL'} node in the WBS master, not a postable ledger account. Posting to it double counts: the amount lands in the roll-up and again in whatever the roll-up sums.`);
    }
  }

  // ---- AUD-PER-001 / 002: period identity (content, not authorization) ----
  const periodCode = String(je.period_code || '');
  if (!PERIOD_CODE_PATTERN.test(periodCode)) {
    fail('AUD-PER-001', je, null,
      `period_code '${periodCode || '(not set)'}' is not a real accounting period (expected YYYY-MM with month 01-12). This is a content defect, not a period-control exception: no period authority can open a period that cannot exist.`);
  } else if (je.je_date && String(je.je_date).slice(0, 7) !== periodCode) {
    fail('AUD-PER-002', je, null,
      `je_date ${je.je_date} falls outside period ${periodCode}. An entry dated in one month and posted into another breaks cut-off and every period comparative built on it.`);
  }

  // ---- AUD-ENT-001: entity identity (content, not authorization) ----------
  if (!ENTITY_BY_ID.has(Number(je.entity_id))) {
    fail('AUD-ENT-001', je, null,
      `entity_id ${je.entity_id} is not in the entity master. This is a content defect, not a period-control exception: there is no entity whose period could be opened.`);
  }

  // ---- Existing engine catalog: line shape, subsidiary member -------------
  for (const err of validateJE(je)) {
    if (PERIOD_AUTHORIZATION_CODES.has(err.code)) continue;
    // 4006 out-of-balance is re-raised exactly by AUD-BAL-001 above, at
    // ten-thousandth precision instead of the engine's 0.005 float tolerance.
    if (err.code === '4006' || err.code === 'VAL-001') continue;
    if (je.posting_status !== 'POSTED') continue;
    const rule = err.code === '4020' ? 'AUD-SUB-001' : `AUD-VAL-${err.code}`;
    const acct = err.code === '4020' ? (err.msg.match(/(\d{6})/) || [])[1] || null : null;
    fail(rule, je, acct, err.code === '4020'
      ? `${err.msg} A subsidiary-ledger account with no member cannot be reconciled to its subledger and disappears from the AP/AR/affiliate aging.`
      : `${err.code} ${err.msg}`);
  }

  // ---- AUD-TRC-001 / 002: provenance of automatic postings ----------------
  if (je.je_type === 'AUTO' && (!je.source_doc_id || !je.rule_code)) {
    fail('AUD-TRC-001', je, null,
      `automatic journal carries no ${!je.source_doc_id ? 'source_doc_id' : ''}${!je.source_doc_id && !je.rule_code ? ' and no ' : ''}${!je.rule_code ? 'rule_code' : ''}. An entry the system made for you has to say which document and which rule made it.`);
  }
  if (je.source_doc_id && !SOURCE_DOCS[je.source_doc_id]) {
    fail('AUD-TRC-002', je, null, `source_doc_id ${je.source_doc_id} does not resolve to any source document.`);
  }

  // ---- AUD-AI-001: AI never auto-posts ------------------------------------
  const aiOrigin = je.ai_generated === true
    || /^(ai|agent|assistant|copilot)[-_ .]/i.test(String(je.created_by || ''))
    || ['AI', 'AI_DRAFT', 'AI_AGENT'].includes(String(je.source_system || '').toUpperCase());
  if (aiOrigin && je.posting_status === 'POSTED' && !je.reviewer && !je.approver) {
    fail('AUD-AI-001', je, null,
      `AI-originated journal (created_by=${je.created_by || '?'}, source_system=${je.source_system || '?'}) reached POSTED with no reviewer and no approver. AI drafts; a person reviews, approves and posts.`);
  }

  // ---- AUD-IMM-001: posted entries are immutable --------------------------
  const history = Array.isArray(je.history) ? je.history : [];
  const postAt = history.findIndex((h) => /\bPOST\b/i.test(String(h && h.a || '')));
  if (postAt >= 0) {
    const after = history.slice(postAt + 1).filter((h) => !/REVERS/i.test(String(h && h.a || '')));
    if (after.length) {
      fail('AUD-IMM-001', je, null,
        `posted entry carries later history action(s) [${after.map((h) => h.a).join(', ')}]. A posted entry is immutable; the only correction is a reversal in an open period.`);
    }
  }

  // ---- AUD-LOAN-001: a draw is cash in, never cost ------------------------
  const isDraw = je.rule_code === 'R-LOAN-01' || LOAN_DRAW_TEXT.test(String(je.description || ''));
  if (isDraw) {
    const badDebits = lines.filter((l) => U(l.debit_amount) > 0 && !CASH_ACCOUNTS(l.account_code));
    const creditsNotLoan = lines.filter((l) => U(l.credit_amount) > 0 && !LOAN_PAYABLE.has(l.account_code));
    badDebits.forEach((l) => fail('AUD-LOAN-001', je, l.account_code,
      `a loan draw is Dr Cash / Cr Loan Payable. This journal debits ${l.account_code} ${accountName(l.account_code)} for ${fmtU(U(l.debit_amount))}, booking borrowed money as cost. The cash that actually arrived is never recorded, the loan balance is right for the wrong reason, and the cost is overstated by the whole draw.`));
    creditsNotLoan.forEach((l) => fail('AUD-LOAN-001', je, l.account_code,
      `a loan draw must credit a loan payable account. This journal credits ${l.account_code} ${accountName(l.account_code)} for ${fmtU(U(l.credit_amount))}.`));
  }

  // ---- AUD-LOAN-002/003/004: interest capitalisation ----------------------
  const accruesLoanInterest = lines.some((l) => LOAN_INTEREST_PAYABLE.has(l.account_code) && U(l.credit_amount) > 0);
  if (accruesLoanInterest) {
    const capitalised = lines.filter((l) => CAPITALISED_INTEREST.has(l.account_code) && U(l.debit_amount) > 0);
    const expensed = lines.filter((l) => INTEREST_EXPENSE.has(l.account_code) && U(l.debit_amount) > 0);
    let status = null, basis = '';
    for (const l of lines) {
      if (l.project_id && PROJECT_BY_ID.has(l.project_id)) { status = PROJECT_BY_ID.get(l.project_id).construction_status; basis = `project ${l.project_id}`; break; }
      const loan = l.loan_id != null ? LOAN_BY_ID.get(l.loan_id) : null;
      if (loan && PROJECT_BY_ID.has(loan.project_id)) { status = PROJECT_BY_ID.get(loan.project_id).construction_status; basis = `loan ${loan.loan_code} -> project ${loan.project_id}`; break; }
    }
    if (!status) {
      const owned = PROJECTS_BY_ENTITY.get(Number(je.entity_id)) || [];
      const distinct = [...new Set(owned.map((p) => p.construction_status))];
      if (distinct.length === 1) { status = distinct[0]; basis = `entity ${je.entity_id}'s only project status`; }
    }
    if (!status) {
      fail('AUD-LOAN-004', je, null,
        `loan interest accrual names no project_id and no loan_id that resolves to a project, so whether it should be capitalised or expensed cannot be evidenced. Every interest accrual has to say what it is financing.`);
    } else if (status === 'UNDER_CONSTRUCTION' && expensed.length) {
      expensed.forEach((l) => fail('AUD-LOAN-002', je, l.account_code,
        `interest of ${fmtU(U(l.debit_amount))} expensed to ${l.account_code} ${accountName(l.account_code)} while the financed asset is UNDER_CONSTRUCTION (${basis}). Interest during construction is a cost of the asset and belongs in 164500 Capitalized interest; expensing it understates the asset and overstates the period loss.`));
    } else if (status !== 'UNDER_CONSTRUCTION' && capitalised.length) {
      capitalised.forEach((l) => fail('AUD-LOAN-003', je, l.account_code,
        `interest of ${fmtU(U(l.debit_amount))} capitalised to ${l.account_code} ${accountName(l.account_code)} while the financed asset is ${status} (${basis}). Capitalisation stops when the asset is complete and in use; after that, interest is period expense.`));
    }
  }

  // ---- AUD-DEP-001: a deposit is a liability, never revenue ---------------
  const doc = je.source_doc_id ? SOURCE_DOCS[je.source_doc_id] : null;
  const looksLikeDeposit = /^R-PM-16/.test(String(je.rule_code || ''))
    || DEPOSIT_TEXT.test(String(je.description || ''))
    || (doc && DEPOSIT_TEXT.test(String(doc.type || '') + ' ' + String(doc.doc_no || '')))
    || lines.some((l) => DEPOSIT_TEXT.test(String(l.description || '')));
  if (looksLikeDeposit) {
    const creditedRevenue = lines.filter((l) => U(l.credit_amount) > 0 && /^4/.test(String(l.account_code)));
    const creditedDeposit = lines.some((l) => U(l.credit_amount) > 0 && DEPOSIT_LIABILITY.has(l.account_code));
    creditedRevenue.forEach((l) => fail('AUD-DEP-001', je, l.account_code,
      `a security deposit is money held for someone else. This journal credits revenue ${l.account_code} ${accountName(l.account_code)} for ${fmtU(U(l.credit_amount))}; it must credit a deposit liability (225000 Security Deposit). Booking it as income overstates revenue and hides a refund obligation.`));
    if (!creditedDeposit && !creditedRevenue.length) {
      fail('AUD-DEP-001', je, null, 'entry is identified as a security deposit but credits no deposit liability account.');
    }
  }

  // ---- AUD-CON-001: construction cost carries its dimensions --------------
  for (const l of lines) {
    if (VERTICAL_CWIP.has(l.account_code) && U(l.debit_amount) > 0 && !l.unit_code && !l.project_id) {
      fail('AUD-CON-001', je, l.account_code,
        `construction cost of ${fmtU(U(l.debit_amount))} capitalised with no Unit/WBS and no Project. Cost that names no unit can never be relieved to cost of sales against the unit that was sold.`);
    }
  }
  // ---- AUD-CON-002: the construction invoice behind it is complete --------
  const isConstructionInvoice = je.rule_code === 'R-WBS-INV-01' || (doc && doc.type === 'CONSTRUCTION_INVOICE');
  if (isConstructionInvoice) {
    if (!doc) {
      fail('AUD-CON-002', je, null, 'construction invoice posting resolves to no source document, so Project, Unit/WBS, Cost Code and Vendor cannot be evidenced.');
    } else {
      const missing = [];
      if (!doc.vendor) missing.push('Vendor');
      if (!doc.cost_code) missing.push('Cost Code');
      if (!doc.unit) missing.push('Unit/WBS');
      if (!doc.po_no && !doc.contract) missing.push('PO or Contract');
      if (missing.length) {
        fail('AUD-CON-002', je, null,
          `construction invoice ${doc.doc_no || je.source_doc_id} carries no ${missing.join(', no ')}. A construction invoice without these cannot be tied to a budget line or a subcontract.`);
      }
    }
  }

  // ---- AUD-INV-003: cost of sales names the unit it came off -------------
  for (const l of lines) {
    if (COGS_ACCOUNTS.has(l.account_code) && U(l.debit_amount) > 0 && !l.unit_code) {
      fail('AUD-INV-003', je, l.account_code,
        `cost of sales of ${fmtU(U(l.debit_amount))} posted with no Unit/WBS. Undimensioned COGS cannot be tested against the cost the unit actually accumulated.`);
    }
  }

  // ---- AUD-IC-001 / 003: who the affiliate balance is with ---------------
  for (const l of lines) {
    if (!IC_ACCOUNTS.has(l.account_code)) continue;
    const counterparty = memberOf(l);
    if (!counterparty) {
      fail('AUD-IC-001', je, l.account_code, 'intercompany balance names no counterparty, so it can never be matched or eliminated.');
      continue;
    }
    if (!ENTITY_NAMES.has(counterparty)) {
      fail('AUD-IC-001', je, l.account_code,
        `intercompany account carries '${counterparty}', which is not a group entity. A balance with a third party is a trade receivable or payable; parked in an affiliate account it will never eliminate on consolidation.`);
      continue;
    }
    const self = ENTITY_BY_ID.get(Number(je.entity_id));
    if (self && counterparty === self.entity_name) {
      fail('AUD-IC-003', je, l.account_code, 'intercompany line names its own entity as the counterparty. An entity cannot owe itself.');
    }
  }
}

// ===========================================================================
// PASS 2 - across journals. Duplicates.
// ===========================================================================
const byNumber = new Map();
const byId = new Map();
const bySignature = new Map();
for (const je of posted) {
  const numKey = `${je.entity_id}|${je.je_number}`;
  if (!byNumber.has(numKey)) byNumber.set(numKey, []);
  byNumber.get(numKey).push(je);
  if (!byId.has(je.je_id)) byId.set(je.je_id, []);
  byId.get(je.je_id).push(je);
  const sig = `${je.entity_id}|${je.period_code}|${je.je_date}|`
    + (je.lines || []).map((l) => `${l.account_code}:${U(l.debit_amount)}:${U(l.credit_amount)}:${l.unit_code || ''}:${memberOf(l) || ''}`).sort().join(',');
  if (!bySignature.has(sig)) bySignature.set(sig, []);
  bySignature.get(sig).push(je);
}
for (const [key, group] of byNumber) {
  if (group.length < 2) continue;
  fail('AUD-DUP-001', group[0], null,
    `document number ${group[0].je_number} is carried by ${group.length} different journals in this entity (je_id ${group.map((j) => j.je_id).join(', ')}). A journal number identifies one journal; a collision makes every reference to it ambiguous.`);
}
for (const [id, group] of byId) {
  if (group.length < 2) continue;
  fail('AUD-DUP-002', group[0], null, `je_id ${id} is used by ${group.length} journals (${group.map((j) => j.je_number).join(', ')}).`);
}
for (const [sig, group] of bySignature) {
  if (group.length < 2) continue;
  fail('AUD-DUP-003', group[0], null,
    `this journal is posted ${group.length} times: ${group.map((j) => j.je_number).join(', ')} share one entity, period, date and line set. The same economic event is in the books more than once.`);
}

// ===========================================================================
// PASS 3 - unit cost ledger. Land/CWIP -> Finished inventory -> COGS.
// Cumulative, in ten-thousandths, per (entity | unit).
// ===========================================================================
const unitLedger = new Map();
const unitAt = (k) => {
  if (!unitLedger.has(k)) unitLedger.set(k, {cost: 0, toInventory: 0, cogs: 0, costRefs: [], cogsRefs: []});
  return unitLedger.get(k);
};
const saleKeys = new Map();
const cogsKeys = new Set();
for (const je of posted) {
  for (const l of je.lines || []) {
    if (l.unit_code) {
      const k = `${je.entity_id}|${l.unit_code}`;
      const r = unitAt(k);
      if (UNIT_COST_ACCOUNTS.has(l.account_code)) { r.cost += U(l.debit_amount); if (U(l.debit_amount) > 0 && r.costRefs.length < 4) r.costRefs.push(je.je_number); }
      if (FINISHED_INVENTORY.has(l.account_code)) r.toInventory += U(l.debit_amount);
      if (COGS_ACCOUNTS.has(l.account_code)) { r.cogs += U(l.debit_amount); if (U(l.debit_amount) > 0 && r.cogsRefs.length < 4) r.cogsRefs.push(je.je_number); }
      if (UNIT_SALE_REVENUE.has(l.account_code) && U(l.credit_amount) > 0) saleKeys.set(`${je.entity_id}|${je.period_code}|${l.unit_code}`, je);
      if (COGS_ACCOUNTS.has(l.account_code) && U(l.debit_amount) > 0) cogsKeys.add(`${je.entity_id}|${je.period_code}|${l.unit_code}`);
    }
  }
}
for (const [key, r] of unitLedger) {
  const [entityId, unit] = key.split('|');
  if (r.cogs > r.cost) {
    fail('AUD-INV-001', scope(Number(entityId), null, r.cogsRefs.join(', ') || 'n/a'), '510000',
      `unit '${unit}' has been relieved ${fmtU(r.cogs)} of cost of sales against ${fmtU(r.cost)} ever capitalised to it - over-relieved by ${fmtU(r.cogs - r.cost)}. Cost of sales comes out of what the unit accumulated, never out of the sale price. Cost journals: ${r.costRefs.join(', ') || 'none'}. COGS journals: ${r.cogsRefs.join(', ')}.`);
  }
  if (r.cogs > r.toInventory) {
    fail('AUD-INV-002', scope(Number(entityId), null, r.cogsRefs.join(', ') || 'n/a'), '165100',
      `unit '${unit}' relieved ${fmtU(r.cogs)} to cost of sales but only ${fmtU(r.toInventory)} was ever transferred into finished inventory. The path is Land/CWIP -> Finished Inventory -> COGS; relieving straight off CWIP skips the completion step and leaves work in progress that was already sold.`);
  }
}
for (const [key, je] of saleKeys) {
  if (cogsKeys.has(key)) continue;
  const unit = key.split('|')[2];
  fail('AUD-CLS-001', je, '491800',
    `unit '${unit}' produced closing revenue in ${je.period_code} with no cost of sales in the same entity, period and unit. A closing splits Cash/AR, revenue, COGS and title withholding; revenue without its cost overstates the margin by the whole cost of the home.`);
}

// ===========================================================================
// PASS 4 - intercompany mirror, per pair and per period.
// ===========================================================================
const pairPeriod = new Map();
const pairRefs = new Map();
for (const je of posted) {
  const self = ENTITY_BY_ID.get(Number(je.entity_id));
  if (!self) continue;
  for (const l of je.lines || []) {
    if (!IC_ACCOUNTS.has(l.account_code)) continue;
    const other = memberOf(l);
    if (!other || !ENTITY_NAMES.has(other) || other === self.entity_name) continue;
    const key = `${self.entity_name}|${other}|${je.period_code}`;
    pairPeriod.set(key, (pairPeriod.get(key) || 0) + U(l.debit_amount) - U(l.credit_amount));
    if (!pairRefs.has(key)) pairRefs.set(key, []);
    if (pairRefs.get(key).length < 4) pairRefs.get(key).push(je.je_number);
  }
}
const seenPairs = new Set();
for (const [key, net] of pairPeriod) {
  const [a, b, period] = key.split('|');
  const reverseKey = `${b}|${a}|${period}`;
  const id = [key, reverseKey].sort().join('::');
  if (seenPairs.has(id)) continue;
  seenPairs.add(id);
  const reverse = pairPeriod.get(reverseKey);
  if (reverse !== undefined && reverse === -net) continue;
  const entityA = ENTITIES.find((e) => e.entity_name === a);
  fail('AUD-IC-002', scope(entityA ? entityA.entity_id : null, period, (pairRefs.get(key) || []).join(', ') || 'n/a'), null,
    `intercompany balance between '${a}' and '${b}' in ${period} does not mirror: '${a}' carries ${fmtU(net)}, '${b}' carries ${reverse === undefined ? 'nothing at all' : fmtU(reverse)}. A due-from must have an equal and opposite due-to in the same period or the pair cannot be eliminated on consolidation.`);
}

// ===========================================================================
// PASS 5 - entity level balances: suspense, depreciation.
// ===========================================================================
const suspenseByEntity = new Map();
const faByEntity = new Map();
const depByEntity = new Map();
const suspenseRefs = new Map();
const faRefs = new Map();
for (const je of posted) {
  const e = Number(je.entity_id);
  for (const l of je.lines || []) {
    if (SUSPENSE_ACCOUNTS.has(l.account_code)) {
      suspenseByEntity.set(e, (suspenseByEntity.get(e) || 0) + U(l.debit_amount) - U(l.credit_amount));
      if (!suspenseRefs.has(e)) suspenseRefs.set(e, []);
      if (suspenseRefs.get(e).length < 4) suspenseRefs.get(e).push(je.je_number);
    }
    if (DEPRECIABLE_FA.has(l.account_code)) {
      faByEntity.set(e, (faByEntity.get(e) || 0) + U(l.debit_amount) - U(l.credit_amount));
      if (!faRefs.has(e)) faRefs.set(e, []);
      if (faRefs.get(e).length < 4) faRefs.get(e).push(je.je_number);
    }
    if (DEPRECIATION_EXPENSE.has(l.account_code)) depByEntity.set(e, (depByEntity.get(e) || 0) + U(l.debit_amount));
  }
}
for (const [e, balance] of suspenseByEntity) {
  if (balance === 0) continue;
  fail('AUD-SUS-001', scope(e, null, (suspenseRefs.get(e) || []).join(', ')), '142000',
    `suspense carries ${fmtU(balance)} at the end of the ledger. A suspense balance is an amount nobody has identified; it may not survive a close.`);
}
for (const [e, balance] of faByEntity) {
  if (balance <= 0) continue;
  if ((depByEntity.get(e) || 0) > 0) continue;
  fail('AUD-FA-001', scope(e, null, (faRefs.get(e) || []).join(', ')), null,
    `entity carries ${fmtU(balance)} of depreciable fixed assets and no depreciation has ever been posted against them. Assets in service depreciate; a ledger with none overstates both the asset and the result.`);
}

// ===========================================================================
// PASS 6 - reference data that drives postings.
// ===========================================================================
for (const m of MAPPINGS) {
  if (m.rev_exp_flag !== 'LIABILITY') continue;
  const code = String(m.owner_gl_account_code || '');
  if (/^2/.test(code) && DEPOSIT_LIABILITY.has(code)) continue;
  fail('AUD-DEP-002', scope(null, null, `MAPPING ${m.mapping_type}/${m.source_code}`), code,
    `charge code '${m.source_code}' is flagged LIABILITY but maps to ${code} ${accountName(code)}, which is not a deposit liability. Every pickup on this code will be booked as income.`);
}

// ---- Coverage (unchanged) -------------------------------------------------
const covered = new Set(FY2026.map((j) => j.entity_id));
for (const entity of ENTITIES) {
  if (!covered.has(entity.entity_id)) {
    fail('AUD-COV-001', scope(entity.entity_id, null, entity.entity_code), null, 'entity has no FY2026 ledger coverage.');
  }
}

// ===========================================================================
// Report.
// ===========================================================================
console.log(`audit entities=${covered.size}/${ENTITIES.length} jes=${jes.length} fails=${failures.length}${injectName ? ` injection=${injectName}` : ''}`);
const ruleNames = Object.keys(RULES).sort();
if (ruleNames.length) console.log(`audit-rules-fired ${ruleNames.map((r) => `${r}=${RULES[r]}`).join(' ')}`);
const shownPerRule = new Map();
for (const f of failures) {
  const n = (shownPerRule.get(f.rule) || 0) + 1;
  shownPerRule.set(f.rule, n);
  if (n <= 8) console.error('FAIL', f.line);
  else if (n === 9) console.error('FAIL', `${f.rule} ... ${RULES[f.rule] - 8} further violation(s) of this rule suppressed`);
}

// Period control is reported, never folded into `fails`. `fails` counts journal
// CONTENT defects; these are posting-AUTHORIZATION defects in already Posted,
// immutable evidence. They are exceptions for a human to resolve by reversal or
// by an authorised period action, and the same detector drives the Exception
// Center in the application.
const periodControl = periodControlExceptions({journals: jes, periods: PERIODS});
console.log(`period-control ${periodControl.state} closed_period_journals=${periodControl.totals.closedPeriodJournals} unconfigured_entity_periods=${periodControl.totals.unconfiguredCombinations} unconfigured_journals=${periodControl.totals.unconfiguredJournals}`);
periodControl.closedPeriodPostings.forEach((row) => console.error('PERIOD-CONTROL', `${row.object_ref}: POSTED in ${row.period_code} which entity ${row.entity_id}'s period master marks ${row.period_status}`));

if (failures.length) process.exitCode = 1;

// A mutation run has to prove the rule it targets actually fired. If it did
// not, the check is broken and the run fails even when the ledger is clean.
if (injectName) {
  const detected = failures.some((f) => f.rule === expectedRule);
  console.log(`injection=${injectName} expected_rule=${expectedRule} detected=${detected}`);
  if (!detected) {
    console.error('FAIL', `MUTATION-NOT-DETECTED injection '${injectName}' did not raise ${expectedRule}. The check is not doing what it claims.`);
    process.exitCode = 1;
  }
}
