// Statement of cash flows.
//
// THE ONE IDENTITY THIS FILE OBEYS
//
//   opening cash + (operating + investing + financing) = closing cash
//
// exactly, in integer minor units, per entity and consolidated. Everything else
// here exists to make that identity true for the right reasons rather than by
// construction on a residual. There is no "unexplained" or "other" bucket: a
// posted line that no rule classifies is REPORTED as unclassified and the
// statement declares itself not ready. It never lands in a plug.
//
// HOW THE TWO METHODS ARE BUILT
//
// Every posted journal that moves cash balances: the sum of its cash lines is
// the negative of the sum of its non-cash lines. So the cash a journal moved can
// be attributed, exactly and without allocation, to that journal's non-cash
// lines - one line, one classification, one attribution.
//
//   DIRECT    walk the journals that touch cash; attribute each journal's cash
//             movement to its own non-cash lines. Receipts and payments.
//
//   INDIRECT  walk the ACCOUNT movements for the period: net income, plus the
//             lines of journals that moved no cash (the non-cash adjustments),
//             plus the movement in operating balance-sheet accounts.
//
// The two are different aggregations of the same per-line classification, so
// they agree if and only if every line is classified exactly once and every
// cashless transaction is corrected exactly once. A dropped line, a double
// count, or a context rule that fires in one path and not the other shows up as
// a section difference. That is what the agreement check detects; it is not two
// independent derivations of the same economics, and this file does not claim
// it is. The independent check is the third one: the raw movement of the cash
// accounts themselves, computed with no classification at all, must equal the
// sum of the three sections.
//
// CONSOLIDATION
//
// For a group, an intercompany receivable/payable that eliminates inside the
// boundary is INTERNAL CASH. Entity 3 paying entity 1's contractor is not a
// financing outflow of the group - it is the group paying a contractor, and the
// group's cash flow has to follow the money to the entity that spent it. So the
// consolidated walk runs over a CASH POOL = real cash accounts + intercompany
// accounts whose counterparty is consolidated in the same group. The pool's own
// movement equals real cash movement exactly when intercompany cash nets to
// zero, which is measured, not assumed.
//
// This module posts nothing. It is a read.

import { localCashAccountGroup } from './cash-account-scope.js';
import { IC_ACCOUNTS, accountName, accountType } from './consolidation.js';
import { WBS_COA_MAP, memberOf } from './coa-wbs.js';
import { ENTITIES } from './data.js';

export const OPERATING = 'Operating';
export const INVESTING = 'Investing';
export const FINANCING = 'Financing';
export const CASH_FLOW_SECTIONS = Object.freeze([OPERATING, INVESTING, FINANCING]);

const cents = n => Math.round(Number(n || 0) * 100);
const netOf = line => cents(line.debit_amount) - cents(line.credit_amount);
const code6 = value => String(value == null ? '' : value);
const between = (code, lo, hi) => code.length === 6 && code >= lo && code <= hi;
const oneOf = (code, list) => list.includes(code);

// ---------------------------------------------------------------------------
// The cash base.
//
// ASU 2016-18: the statement explains the change in cash, cash equivalents AND
// restricted cash. The cash base is therefore every account the application
// already recognises as cash (src/cash-account-scope.js) - operating, escrow,
// reserve/restricted, security-deposit and payroll-restricted. There is exactly
// one definition of cash in this product and this is not a second one.
//
// A transfer between two accounts inside the base is not a cash flow. It falls
// out of the arithmetic on its own: both lines are in the base, the journal has
// no line outside it, and it contributes nothing to any section.
// ---------------------------------------------------------------------------
export const isCashAccount = accountCode => localCashAccountGroup(accountCode) !== null;

// Accounts whose NAME says cash but which the application's cash scope does not
// recognise. Classifying them by guess would silently move money in or out of
// the cash base, so they are refused: anything posted to one of these makes the
// statement report an unclassified line rather than pick a side.
export const CASH_SCOPE_GAP_ACCOUNTS = Object.freeze(['115000', '115010', '116000']);

// ---------------------------------------------------------------------------
// Classification rules.
//
// Ordered. First match wins. Each rule carries the presentation line it feeds
// and the reason it exists; docs/CASH-FLOW-STATEMENT.md is generated from the
// same table so the policy and the code cannot drift apart.
//
// `context` rules read the journal the line sits in. They are the three places
// where an account code alone is not enough to classify a real-estate cash flow:
// security deposits, gains on disposal, and interest paid.
// ---------------------------------------------------------------------------

const SECURITY_DEPOSIT_LIABILITIES = ['225000', '225001', '225100', '225200'];
const DISPOSAL_RESULT_ACCOUNTS = ['787001', '787002'];
const INTEREST_PAYABLE_ACCOUNTS = ['220310', '220410', '220451'];
const CAPITALISED_INTEREST_ACCOUNTS = ['164500', '164501'];
const INTEREST_EXPENSE_ACCOUNTS = ['661000', '772450', '795000'];

// Property held for use. Everything else in the 16xxxx family is inventory.
const heldForUse = c => (between(c, '165000', '165099') || between(c, '165200', '165999')
  || between(c, '166000', '166000') || between(c, '168000', '168999'));

export const CASH_FLOW_RULES = Object.freeze([
  // -- refusals -------------------------------------------------------------
  {
    id: 'CF-GAP-CASH', section: null, label: 'Cash-named account outside the application cash scope',
    match: c => oneOf(c, CASH_SCOPE_GAP_ACCOUNTS),
    why: 'The account is named as cash but is not in the cash scope the balance sheet uses. Classifying it would move the cash base without saying so.',
  },

  // -- intercompany ---------------------------------------------------------
  {
    id: 'CF-IC-01', section: FINANCING, label: 'Advances to and from affiliates',
    match: c => oneOf(c, IC_ACCOUNTS),
    why: 'A standalone entity that funds, or is funded by, an affiliate is financing itself. On consolidation the same balance is internal cash and never reaches a section.',
  },

  // -- financing: debt ------------------------------------------------------
  {
    id: 'CF-FIN-DEBT-COST', section: FINANCING, label: 'Debt issuance and loan costs paid',
    match: c => oneOf(c, ['161201', '161202', '164700', '164800', '185100', '270800', '270900']),
    why: 'Costs of obtaining borrowings, and the lender deposit that secures them, are financing outflows however they are capitalised.',
  },
  {
    id: 'CF-FIN-DEBT', section: FINANCING, label: 'Loan draws and principal repayments',
    match: c => between(c, '260000', '279999'),
    why: 'RED LINE. A construction loan draw is Dr Cash / Cr Loan Payable - a financing inflow, never a cost. Repayment of principal is the financing outflow that reverses it.',
  },
  {
    id: 'CF-FIN-NOTE', section: FINANCING, label: 'Notes payable drawn and repaid',
    match: c => between(c, '227303', '227305'),
    why: 'A note payable is borrowing, regardless of where the chart files it.',
  },
  {
    id: 'CF-FIN-PREF', section: FINANCING, label: 'Preferred capital classified as a liability',
    match: c => oneOf(c, ['289100', '289500', '298100']),
    why: 'Preferred capital carried as a liability is still capital raised; its cash is financing.',
  },

  // -- financing: equity ----------------------------------------------------
  {
    id: 'CF-FIN-DIST', section: FINANCING, label: 'Distributions and draws paid to owners',
    match: c => oneOf(c, ['220455', '380110', '380116', '380117', '380200', '381104', '795010']),
    why: 'A distribution is a return of capital to owners. The withholding tax deducted from it stays in operating with the other taxes.',
  },
  {
    id: 'CF-FIN-CONTRIB', section: FINANCING, label: 'Capital contributions received',
    match: c => between(c, '380000', '389999') || oneOf(c, ['228000', '312000', '313000', '323000']),
    why: 'Capital put in by members, partners or the developer is a financing inflow.',
  },
  {
    id: 'CF-FIN-RESULT', section: FINANCING, label: 'Result carried in equity (nil in a closed period)',
    match: c => between(c, '350000', '359999') || between(c, '370000', '379999') || oneOf(c, ['311000', '322000']),
    why: 'Retained earnings and the current-year result are an accumulation, not a transaction. The year-end close moves one to the other inside this line and nets to nil; anything else here is a defect and is meant to be visible.',
  },
  {
    id: 'CF-FIN-RESERVE', section: FINANCING, label: 'Replacement and reserve fund movements',
    match: c => between(c, '310000', '349999'),
    why: 'Reserve-fund contributions are funding set aside by owners. JUDGEMENT, and unexercised by the posted ledger.',
  },

  // -- operating and investing: receivables --------------------------------
  {
    id: 'CF-OP-AR', section: OPERATING, label: 'Receipts from customers and residents',
    match: c => between(c, '120000', '124999') || oneOf(c, ['125001', '125002', '125003', '125006', '125007', '125008', '125009', '159022', '159032', '159040', '166100', '298101']),
    why: 'Rent, management fees, sale proceeds receivable and other trade receivables are the operating cycle.',
  },
  {
    id: 'CF-INV-NOTE-RCV', section: INVESTING, label: 'Notes receivable advanced and collected',
    match: c => oneOf(c, ['159002']),
    why: 'Lending money to a third party is investing, not a trade receivable.',
  },
  {
    id: 'CF-OP-PREPAID', section: OPERATING, label: 'Prepaid expenses and other operating assets',
    match: c => between(c, '140000', '149999'),
    why: 'Prepaid insurance, tax and supplies are operating working capital.',
  },
  {
    id: 'CF-INV-RESERVEFUND', section: INVESTING, label: 'Reserve and replacement funds',
    match: c => between(c, '150000', '150999'),
    why: 'A replacement reserve is money set aside to buy capital assets. JUDGEMENT, and unexercised by the posted ledger.',
  },
  {
    id: 'CF-INV-EQUITY-METHOD', section: INVESTING, label: 'Investments in subsidiaries, joint ventures and associates',
    match: c => oneOf(c, ['151800']) || between(c, '158000', '158999') || between(c, '114000', '114999'),
    why: 'Buying and selling an interest in another undertaking, or an investment security, is investing.',
  },

  // -- the developer split --------------------------------------------------
  {
    id: 'CF-OP-INVENTORY', section: OPERATING, label: 'Land and construction spend on inventory held for sale',
    match: c => between(c, '161000', '161200') || oneOf(c, ['162000', '163000'])
      || between(c, '164000', '164699') || between(c, '164900', '164999')
      || between(c, '165100', '165199'),
    why: 'THE DEVELOPER RULE. Land, land improvements, construction work in progress and completed homes are INVENTORY for a merchant builder. Buying and building them is the operating cycle, not investing - the group is not acquiring a productive asset, it is manufacturing the product it sells. These are the 161x/162x/163x/164x/1651x accounts; property held for use lives in 165000, 1652xx-1659xx and 166000 and is a different rule.',
  },
  {
    id: 'CF-INV-PPE', section: INVESTING, label: 'Property and equipment held for use',
    match: heldForUse,
    why: 'THE DEVELOPER RULE, other side. Investment homes, vehicles, furniture, leasehold improvements and their accumulated depreciation are held to produce rent or to be used, not to be sold as product. Buying and disposing of them is investing.',
  },
  {
    id: 'CF-INV-INTANGIBLE', section: INVESTING, label: 'Software and other intangible assets',
    match: c => between(c, '171000', '171999') && !oneOf(c, ['171001', '171003']),
    why: 'Capitalised software and organisational costs are long-lived assets acquired.',
  },
  {
    id: 'CF-OP-COMMISSION-ASSET', section: OPERATING, label: 'Capitalised leasing commissions',
    match: c => oneOf(c, ['171001', '171003']),
    why: 'A leasing commission is a cost of obtaining a lease - part of the rental operating cycle.',
  },

  // -- deposits paid --------------------------------------------------------
  {
    id: 'CF-OP-DEPOSIT-PAID', section: OPERATING, label: 'Deposits paid and refunded',
    match: c => between(c, '181000', '185099') || oneOf(c, ['185101']),
    why: 'Utility deposits and earnest money on land bought for inventory sit in the operating cycle. The lender-required construction loan deposit (185100) is financing and is matched earlier.',
  },

  // -- payables and accruals ------------------------------------------------
  {
    id: 'CF-OP-INTEREST', section: OPERATING, label: 'Interest paid',
    match: c => oneOf(c, INTEREST_PAYABLE_ACCOUNTS),
    context: 'interest',
    why: 'ASC 230 puts interest paid in operating. Where the interest was CAPITALISED rather than expensed, this rule looks through the payable to what the capitalisation funded: into inventory (164500 CWIP capitalised interest) it stays operating, because for a developer the inventory it funds is operating; into property held for use it becomes investing, which is what ASC 230-10-45-13(c) requires. See docs/CASH-FLOW-STATEMENT.md.',
  },
  {
    id: 'CF-OP-DEPOSIT-HELD', section: OPERATING, label: 'Security deposits received and refunded',
    match: c => oneOf(c, SECURITY_DEPOSIT_LIABILITIES),
    context: 'security-deposit',
    why: 'A resident deposit taken into UNRESTRICTED operating cash is operating: the money is available to the business and the liability is part of the rental cycle. A deposit taken into a RESTRICTED security-deposit account (117xxx) is financing: the group holds the money for the resident, cannot use it, and the arrangement is a refundable borrowing. The rule reads which cash account the journal actually used.',
  },
  {
    id: 'CF-OP-AP', section: OPERATING, label: 'Payments to vendors, contractors and for operating costs',
    match: c => between(c, '220000', '224999') || between(c, '225300', '227302') || oneOf(c, ['226000', '228100']),
    why: 'Trade payables, accruals and tax payables settle the operating cycle. Where the payable funded construction work in progress it is still operating, because that work in progress is inventory.',
  },

  // -- profit and loss ------------------------------------------------------
  {
    id: 'CF-OP-REVENUE', section: OPERATING, label: 'Revenue',
    match: c => between(c, '400000', '499999'),
    why: 'All income, including interest income, is operating. Proceeds of an inventory unit sale are operating; proceeds of disposing of property held for use are matched by the disposal rules and land in investing.',
  },
  {
    id: 'CF-INV-DISPOSAL-RESULT', section: OPERATING, label: 'Result on disposal or transfer',
    match: c => oneOf(c, DISPOSAL_RESULT_ACCOUNTS),
    context: 'disposal',
    why: 'A gain or loss follows the asset. On an inventory lot it is operating; on property held for use it is investing, so that the whole of the disposal proceeds - carrying amount and result together - reports in investing rather than being split across two sections.',
  },
  {
    id: 'CF-INV-LOSS', section: INVESTING, label: 'Investment losses',
    match: c => oneOf(c, ['778100']),
    why: 'A loss on an investment belongs with the investment cash flows.',
  },
  {
    id: 'CF-INV-CAPEX', section: INVESTING, label: 'Capital expenditure',
    match: c => between(c, '780000', '784999'),
    why: 'The 780xxx CAPITAL EXPENSE family buys capital items. Charging them through the profit and loss does not make buying a dishwasher an operating cash flow. JUDGEMENT, and unexercised by the posted ledger.',
  },
  {
    id: 'CF-OP-EXPENSE', section: OPERATING, label: 'Operating costs paid',
    match: c => between(c, '500000', '799999'),
    why: 'Cost of sales, property expense, administrative expense, depreciation and interest expense are the operating result. Depreciation is non-cash and is added back through the non-cash adjustment, not by excluding the account.',
  },
]);

const RULE_BY_ID = Object.fromEntries(CASH_FLOW_RULES.map(r => [r.id, r]));

// A header or a total is not a postable account. If one carries a posted line
// the chart has been misused and the statement must say so rather than absorb it.
const isHeaderAccount = code => {
  const meta = WBS_COA_MAP[code];
  return !!meta && (meta.kind === 'H' || meta.kind === 'T');
};

// ---------------------------------------------------------------------------
// classifyLine
//
// Returns {section, rule_id, label} or {section:null, ...reason} when no rule
// claims the line. Never guesses, never falls back on account type.
// ---------------------------------------------------------------------------
export function classifyLine(line, context = {}) {
  const code = code6(line && line.account_code);
  if (!code) return {section: null, rule_id: null, label: 'Line carries no account', reason: 'no account code'};
  if (code.length !== 6) return {section: null, rule_id: null, label: `Account ${code} is not a six-digit account`, reason: 'account code is not six digits'};
  if (isHeaderAccount(code)) return {section: null, rule_id: null, label: `Account ${code} is a header or total`, reason: 'header and total accounts are not postable'};
  for (const rule of CASH_FLOW_RULES) {
    if (!rule.match(code)) continue;
    if (!rule.section) return {section: null, rule_id: rule.id, label: rule.label, reason: rule.why};
    const section = rule.context ? applyContext(rule, code, line, context) : rule.section;
    return {section, rule_id: rule.id, label: rule.label};
  }
  return {section: null, rule_id: null, label: `Account ${code} ${accountName(code)}`, reason: 'no cash-flow classification rule matches this account'};
}

// The three context rules.
function applyContext(rule, code, line, context) {
  const journal = context.journal || null;
  const lines = (journal && journal.lines) || [];
  if (rule.context === 'security-deposit') {
    // Restricted only when the journal's own cash line sits in the restricted
    // security-deposit scope. Commingled with operating cash it is operating.
    const restricted = lines.some(l => localCashAccountGroup(l.account_code) === 'Security deposit');
    return restricted ? FINANCING : OPERATING;
  }
  if (rule.context === 'disposal') {
    // Follow the asset that moved in the same journal.
    const heldForUseLine = lines.some(l => heldForUse(code6(l.account_code)));
    return heldForUseLine ? INVESTING : OPERATING;
  }
  if (rule.context === 'interest') {
    // Look through the payable to what the interest funded. `context.interestDestination`
    // is a Map loan_id -> section built once per statement from the accrual side.
    const destination = context.interestDestination;
    const loanId = line.loan_id != null ? String(line.loan_id) : null;
    if (destination && loanId && destination.has(loanId)) return destination.get(loanId);
    return OPERATING;
  }
  return rule.section;
}

// Where each loan's interest accrual landed. Built from the posted accrual side:
// a debit to a capitalised-interest account, an interest expense account, or an
// asset held for use. A loan whose capitalised interest reaches a held-for-use
// asset makes its interest payments investing (ASC 230-10-45-13(c)).
export function interestDestinationByLoan(journals) {
  const byLoan = new Map();
  for (const je of journals) {
    for (const l of (je.lines || [])) {
      const code = code6(l.account_code);
      const isDestination = oneOf(code, CAPITALISED_INTEREST_ACCOUNTS) || oneOf(code, INTEREST_EXPENSE_ACCOUNTS) || heldForUse(code);
      if (!isDestination) continue;
      // only where the journal also touches an interest payable, i.e. an accrual
      if (!(je.lines || []).some(x => oneOf(code6(x.account_code), INTEREST_PAYABLE_ACCOUNTS))) continue;
      const loanId = l.loan_id != null ? String(l.loan_id) : null;
      if (!loanId) continue;
      const section = heldForUse(code) ? INVESTING : OPERATING;
      // Investing wins: any capitalisation into a held-for-use asset makes the
      // whole facility's interest investing rather than silently splitting it.
      if (section === INVESTING || !byLoan.has(loanId)) byLoan.set(loanId, section);
    }
  }
  return byLoan;
}

// ---------------------------------------------------------------------------
// buildCashFlowStatement
//
//   journals              every posted journal to consider, entity ledger and,
//                         for a group, the elimination ledger as well
//   entityId              one entity, or null for a group
//   consolidatedEntityNames  entity names inside the reporting boundary; when
//                         supplied the statement runs in consolidated mode and
//                         intercompany balances with those counterparties become
//                         internal cash
// ---------------------------------------------------------------------------
export function buildCashFlowStatement({
  journals = [],
  entityId = null,
  fromPeriod = '',
  throughPeriod = '',
  consolidatedEntityNames = null,
} = {}) {
  const consolidated = !!consolidatedEntityNames;
  const boundary = consolidated ? new Set(consolidatedEntityNames) : null;

  const inScope = j => {
    if (j.posting_status !== 'POSTED') return false;
    if (entityId != null && entityId !== '' && Number(j.entity_id) !== Number(entityId)) return false;
    return true;
  };
  const period = j => String(j.period_code || '');
  const all = journals.filter(inScope);
  const openingJournals = all.filter(j => !fromPeriod || period(j) < fromPeriod);
  const periodJournals = all.filter(j => (!fromPeriod || period(j) >= fromPeriod) && (!throughPeriod || period(j) <= throughPeriod));
  const asOfJournals = all.filter(j => !throughPeriod || period(j) <= throughPeriod);

  // An intercompany line is internal cash only when its counterparty is inside
  // the boundary. One-sided intercompany does not eliminate and stays financing.
  const isInternalCashLine = line => consolidated
    && oneOf(code6(line.account_code), IC_ACCOUNTS)
    && !!memberOf(line) && boundary.has(memberOf(line));
  const isPoolLine = line => isCashAccount(line.account_code) || isInternalCashLine(line);

  const interestDestination = interestDestinationByLoan(all);
  const context = journal => ({journal, interestDestination});

  // ---- the cash base, with no classification at all ------------------------
  const cashByAccount = (list) => {
    const map = new Map();
    list.forEach(j => (j.lines || []).forEach(l => {
      if (!isCashAccount(l.account_code)) return;
      map.set(l.account_code, (map.get(l.account_code) || 0) + netOf(l));
    }));
    return map;
  };
  const openingByAccount = cashByAccount(openingJournals);
  const movementByAccount = cashByAccount(periodJournals);
  const closingByAccount = cashByAccount(asOfJournals);
  const sumMap = m => [...m.values()].reduce((s, v) => s + v, 0);
  const openingCashCents = sumMap(openingByAccount);
  const netChangeCents = sumMap(movementByAccount);
  const closingCashCents = openingCashCents + netChangeCents;
  const balanceSheetCashCents = sumMap(closingByAccount);

  const cashAccountRows = [...new Set([...openingByAccount.keys(), ...movementByAccount.keys(), ...closingByAccount.keys()])]
    .sort().map(accountCode => ({
      account_code: accountCode,
      scope: localCashAccountGroup(accountCode),
      account_name: accountName(accountCode),
      opening_cents: openingByAccount.get(accountCode) || 0,
      movement_cents: movementByAccount.get(accountCode) || 0,
      closing_cents: closingByAccount.get(accountCode) || 0,
    }));

  // ---- which journals moved the group's money -----------------------------
  // A journal that touches a real cash account obviously did. On consolidation a
  // journal that only touches INTERNAL cash did too, but only if the money it
  // is settling actually left a bank account somewhere in the linked chain:
  // entity 1's payable settled by entity 3 belongs in the group's operating
  // payments, because entity 3's bank paid it. An intercompany lot transfer,
  // where no bank account in the chain moved at all, does not - it is an
  // internal transfer and must not gross up any section.
  //
  // Journals are linked exactly the way the elimination engine pairs them:
  // period plus the sorted counterparty pair. A link group that contains no
  // real cash line anywhere is a non-cash transaction of the group.
  const {bearing: cashBearing, suppressed: internalTransactions} =
    intercompanyCashBearing(periodJournals, {consolidated, isInternalCashLine, isPoolLine});

  const direct = {[OPERATING]: new Map(), [INVESTING]: new Map(), [FINANCING]: new Map()};
  const unclassified = [];
  const entries = [];
  const journalImbalance = [];
  const internalCashMovementCents = {inflow: 0, outflow: 0, net: 0};
  const ruleUse = new Map();
  const movement = new Map();       // account -> net movement, classified
  const nonCash = new Map();        // account -> net movement on journals that moved no cash

  const bump = (map, key, seed, deltaCents, journal) => {
    if (!map.has(key)) map.set(key, {...seed, cents: 0, journal_numbers: new Set()});
    const row = map.get(key);
    row.cents += deltaCents;
    if (journal) row.journal_numbers.add(journal.je_number || journal.elimination_id || String(journal.je_id));
    return row;
  };

  // ONE classification pass. Every non-pool line of every journal in the range
  // is classified exactly once and routed to exactly one of two places: the
  // direct walk (the journal moved the group's money) or the non-cash
  // correction (it did not). Nothing is classified twice and nothing is skipped.
  for (const je of periodJournals) {
    const lines = je.lines || [];
    const poolLines = lines.filter(isPoolLine);
    const otherLines = lines.filter(l => !isPoolLine(l));
    const hasRealCash = lines.some(l => isCashAccount(l.account_code));
    const moved = hasRealCash || (poolLines.length > 0 && cashBearing.has(je));

    poolLines.filter(isInternalCashLine).forEach(l => {
      const v = netOf(l);
      internalCashMovementCents.net += v;
      if (v > 0) internalCashMovementCents.inflow += v; else internalCashMovementCents.outflow += v;
    });

    if (moved) {
      const poolMovement = poolLines.reduce((s, l) => s + netOf(l), 0);
      const attributed = otherLines.reduce((s, l) => s - netOf(l), 0);
      if (poolMovement !== attributed) {
        journalImbalance.push({je_number: je.je_number || je.elimination_id, entity_id: je.entity_id, pool_cents: poolMovement, attributed_cents: attributed});
      }
    }

    let entryCents = 0;
    const entrySections = new Set();
    for (const l of otherLines) {
      const verdict = classifyLine(l, context(je));
      if (!verdict.section) {
        unclassified.push({
          je_number: je.je_number || je.elimination_id, entity_id: je.entity_id, period_code: je.period_code,
          account_code: l.account_code, account_name: accountName(l.account_code),
          cents: -netOf(l), rule_id: verdict.rule_id, reason: verdict.reason || 'unclassified',
        });
        continue;
      }
      const key = l.account_code;
      const seed = {account_code: key, account_name: accountName(key), account_type: accountType(key), section: verdict.section, rule_id: verdict.rule_id, label: verdict.label};
      bump(movement, key, seed, netOf(l), je);
      if (moved) {
        ruleUse.set(verdict.rule_id, (ruleUse.get(verdict.rule_id) || 0) + 1);
        bump(direct[verdict.section], verdict.rule_id, {rule_id: verdict.rule_id, label: verdict.label, section: verdict.section}, -netOf(l), je);
        entryCents += -netOf(l);
        entrySections.add(verdict.section);
      } else {
        bump(nonCash, key, seed, netOf(l), je);
      }
    }
    if (moved && poolLines.length) {
      entries.push({
        je_number: je.je_number || je.elimination_id, je_date: je.je_date, entity_id: je.entity_id,
        period_code: je.period_code, source: String(je.source_system || je.ledger || '').toUpperCase(),
        description: je.description || '',
        cash_cents: poolLines.filter(l => isCashAccount(l.account_code)).reduce((s, l) => s + netOf(l), 0),
        pool_cents: poolLines.reduce((s, l) => s + netOf(l), 0), classified_cents: entryCents,
        sections: [...entrySections].sort(),
        internal_only: !hasRealCash,
      });
    }
  }

  const isPL = type => type === 'REVENUE' || type === 'EXPENSE';
  const rows = [...movement.values()];
  const netIncomeCents = -rows.filter(r => isPL(r.account_type)).reduce((s, r) => s + r.cents, 0);
  const reclassLines = rows.filter(r => isPL(r.account_type) && r.section !== OPERATING)
    .map(r => ({...r, presented_cents: r.cents}));
  const workingCapitalLines = rows.filter(r => !isPL(r.account_type) && r.section === OPERATING)
    .map(r => ({...r, presented_cents: -r.cents}));
  const nonCashOperating = [...nonCash.values()].filter(r => r.section === OPERATING)
    .map(r => ({...r, presented_cents: r.cents}));

  const sectionMovement = section => -rows.filter(r => r.section === section).reduce((s, r) => s + r.cents, 0)
    + [...nonCash.values()].filter(r => r.section === section).reduce((s, r) => s + r.cents, 0);

  const indirect = {
    net_income_cents: netIncomeCents,
    reclassifications: sortRows(reclassLines),
    non_cash_adjustments: sortRows(nonCashOperating),
    working_capital: sortRows(workingCapitalLines),
    operating_cents: sectionMovement(OPERATING),
    investing_cents: sectionMovement(INVESTING),
    financing_cents: sectionMovement(FINANCING),
    investing_lines: sortRows(rows.filter(r => r.section === INVESTING).map(r => ({...r, presented_cents: -r.cents}))),
    financing_lines: sortRows(rows.filter(r => r.section === FINANCING).map(r => ({...r, presented_cents: -r.cents}))),
  };

  // ---- supplemental: transactions that moved no cash at all ---------------
  const nonCashActivities = sortRows([...nonCash.values()].map(r => ({...r, presented_cents: r.cents})))
    .filter(r => r.cents !== 0);

  // ---- totals and ties -----------------------------------------------------
  const directTotal = section => [...direct[section].values()].reduce((s, r) => s + r.cents, 0);
  const sections = CASH_FLOW_SECTIONS.map(section => ({
    section,
    total_cents: directTotal(section),
    indirect_cents: section === OPERATING ? indirect.operating_cents : section === INVESTING ? indirect.investing_cents : indirect.financing_cents,
    lines: [...direct[section].values()]
      .map(r => ({...r, journal_numbers: [...r.journal_numbers].sort()}))
      .filter(r => r.cents !== 0 || r.journal_numbers.length > 0)
      .sort((a, b) => a.rule_id.localeCompare(b.rule_id)),
  }));
  const sectionsTotalCents = sections.reduce((s, r) => s + r.total_cents, 0);
  const methodDifferences = sections.filter(s => s.total_cents !== s.indirect_cents)
    .map(s => ({section: s.section, direct_cents: s.total_cents, indirect_cents: s.indirect_cents, difference_cents: s.total_cents - s.indirect_cents}));

  const findings = [];
  if (sectionsTotalCents !== netChangeCents) {
    findings.push(`the three sections total ${sectionsTotalCents} minor units but the cash accounts moved ${netChangeCents}; the statement does not tie`);
  }
  if (closingCashCents !== balanceSheetCashCents) {
    findings.push(`closing cash ${closingCashCents} does not equal the balance-sheet cash accounts ${balanceSheetCashCents}`);
  }
  if (methodDifferences.length) {
    methodDifferences.forEach(d => findings.push(`${d.section}: direct ${d.direct_cents} and indirect ${d.indirect_cents} disagree by ${d.difference_cents} minor units`));
  }
  if (unclassified.length) {
    findings.push(`${unclassified.length} posted line(s) carry no cash-flow classification`);
  }
  if (journalImbalance.length) {
    findings.push(`${journalImbalance.length} journal(s) move cash that its own non-cash lines do not account for`);
  }
  if (consolidated && internalCashMovementCents.net !== 0) {
    findings.push(`intercompany cash movement inside the group nets to ${internalCashMovementCents.net} minor units instead of nil`);
  }

  return {
    scope: {
      entity_id: entityId == null || entityId === '' ? null : Number(entityId),
      from_period: fromPeriod || null, through_period: throughPeriod || null,
      consolidated, boundary_size: boundary ? boundary.size : 0,
    },
    cash: {
      opening_cents: openingCashCents,
      net_change_cents: netChangeCents,
      closing_cents: closingCashCents,
      balance_sheet_cents: balanceSheetCashCents,
      accounts: cashAccountRows,
      scopes: cashScopeRows(cashAccountRows),
    },
    direct: {sections, total_cents: sectionsTotalCents},
    indirect,
    non_cash_activities: nonCashActivities,
    entries,
    unclassified,
    journal_imbalance: journalImbalance,
    intercompany: {
      internal_cash_inflow_cents: internalCashMovementCents.inflow,
      internal_cash_outflow_cents: internalCashMovementCents.outflow,
      internal_cash_net_cents: internalCashMovementCents.net,
      internal_transaction_groups: internalTransactions.length,
      internal_transaction_journals: internalTransactions.reduce((s, g) => s + g.journals, 0),
      internal_transaction_sample: internalTransactions.slice(0, 5),
    },
    rule_use: [...ruleUse.entries()].map(([id, n]) => ({rule_id: id, lines: n, label: (RULE_BY_ID[id] || {}).label || id}))
      .sort((a, b) => a.rule_id.localeCompare(b.rule_id)),
    ties: {
      opening_plus_change_equals_closing: closingCashCents === openingCashCents + netChangeCents,
      sections_equal_cash_movement: sectionsTotalCents === netChangeCents,
      closing_equals_balance_sheet: closingCashCents === balanceSheetCashCents,
      direct_equals_indirect: methodDifferences.length === 0,
      method_differences: methodDifferences,
      intercompany_eliminated: !consolidated || internalCashMovementCents.net === 0,
    },
    ready: findings.length === 0,
    findings,
  };
}

// Journals joined by an eliminated intercompany balance, and whether any bank
// account in the chain actually moved. Union-find over (period, counterparty
// pair) - the same key the elimination engine buckets on, so a link group is
// exactly the set of journals one E-IC-BAL entry reverses.
const ENTITY_NAME_BY_ID = Object.fromEntries(ENTITIES.map(e => [Number(e.entity_id), e.entity_name]));

function intercompanyCashBearing(journals, {consolidated, isInternalCashLine, isPoolLine}) {
  const bearing = new Set();
  const suppressed = [];
  if (!consolidated) return {bearing, suppressed};
  const parent = new Map();
  const find = k => { while (parent.get(k) !== k) { parent.set(k, parent.get(parent.get(k))); k = parent.get(k); } return k; };
  const add = k => { if (!parent.has(k)) parent.set(k, k); return k; };
  const union = (a, b) => { const ra = find(add(a)), rb = find(add(b)); if (ra !== rb) parent.set(ra, rb); };

  const nodeOf = (index) => `J:${index}`;
  const linked = new Map();      // journal index -> journal
  journals.forEach((je, index) => {
    const period = String(je.period_code || '');
    let any = false;
    for (const l of (je.lines || [])) {
      if (!isInternalCashLine(l)) continue;
      const self = l.source_entity_name || ENTITY_NAME_BY_ID[Number(je.entity_id)] || `entity ${je.entity_id}`;
      const other = memberOf(l);
      if (!other) continue;
      union(nodeOf(index), `K:${period}|${[self, other].sort().join(' <-> ')}`);
      any = true;
    }
    if (any) linked.set(index, je);
  });

  // A link group moved the group's money if its REAL cash netted to something,
  // or if any single journal in it both moved real cash and carried a line
  // outside the pool - the signature of a payment to somebody outside the group.
  // A group that only shuffled cash between two members' bank accounts did not.
  const groups = new Map();
  for (const [index, je] of linked) {
    const root = find(nodeOf(index));
    if (!groups.has(root)) groups.set(root, {journals: [], real_cash_cents: 0, external: false});
    const g = groups.get(root);
    g.journals.push(je);
    const cashLines = (je.lines || []).filter(l => isCashAccount(l.account_code));
    g.real_cash_cents += cashLines.reduce((s, l) => s + netOf(l), 0);
    if (cashLines.length && (je.lines || []).some(l => !isPoolLine(l))) g.external = true;
  }
  for (const g of groups.values()) {
    if (g.real_cash_cents !== 0 || g.external) { g.journals.forEach(je => bearing.add(je)); continue; }
    suppressed.push({journals: g.journals.length, real_cash_cents: g.real_cash_cents,
      je_numbers: g.journals.map(j => j.je_number || j.elimination_id).slice(0, 6)});
  }
  return {bearing, suppressed};
}

function sortRows(list) {
  return list.map(r => ({...r, journal_numbers: r.journal_numbers ? [...r.journal_numbers].sort() : []}))
    .filter(r => r.cents !== 0)
    .sort((a, b) => String(a.account_code || '').localeCompare(String(b.account_code || '')));
}

function cashScopeRows(accounts) {
  const map = new Map();
  accounts.forEach(a => {
    const scope = a.scope || 'Unscoped';
    if (!map.has(scope)) map.set(scope, {scope, opening_cents: 0, movement_cents: 0, closing_cents: 0, accounts: []});
    const row = map.get(scope);
    row.opening_cents += a.opening_cents;
    row.movement_cents += a.movement_cents;
    row.closing_cents += a.closing_cents;
    row.accounts.push(a.account_code);
  });
  return [...map.values()].sort((a, b) => a.scope.localeCompare(b.scope));
}

// ---------------------------------------------------------------------------
// Consolidated statement of cash flows.
//
// Entity ledgers plus the elimination ledger, with intercompany balances inside
// the boundary treated as internal cash. The elimination journals are what make
// intercompany cash net to zero; without them the pool would not close.
// ---------------------------------------------------------------------------
export function buildConsolidatedCashFlowStatement({
  journals = [], eliminations = [], entityIds = [], entityNames = [],
  fromPeriod = '', throughPeriod = '',
} = {}) {
  const ids = new Set(entityIds.map(Number));
  const scoped = journals.filter(j => ids.has(Number(j.entity_id)));
  return buildCashFlowStatement({
    journals: [...scoped, ...eliminations],
    entityId: null,
    fromPeriod, throughPeriod,
    consolidatedEntityNames: entityNames,
  });
}

// ---------------------------------------------------------------------------
// cashFlowInvariants
//
// What the measurement script and the verifier both call. It returns findings,
// it never adjusts anything to make a check pass.
// ---------------------------------------------------------------------------
export function cashFlowInvariants(statement) {
  const findings = [...statement.findings];
  if (!statement.ties.opening_plus_change_equals_closing) findings.push('opening cash plus net change does not equal closing cash');
  return {ok: findings.length === 0, findings};
}
