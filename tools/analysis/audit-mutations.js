// ---------------------------------------------------------------------------
// Mutation catalogue for the ledger audit gate.
//
// Every rule in audit.js is proved by injecting the defect it claims to catch
// into a COPY of the shipped ledger and re-running the real gate. An injection
// can only ADD a defect - nothing here removes a check, relaxes a threshold or
// deletes a failure - so setting REFS_AUDIT_INJECT can never make the gate
// greener than it is on the untouched seed. audit.js additionally exits non-zero
// when an injection is set and the expected rule does NOT fire, so a check that
// stops working fails the harness even if the ledger is otherwise clean.
//
// Run them all:   node tools/analysis/audit-mutation-harness.mjs
// Run one:        REFS_AUDIT_INJECT=loan-draw-as-cost npm run test:audit
// List them:      REFS_AUDIT_INJECT=--list npm run test:audit
// ---------------------------------------------------------------------------
import { SOURCE_DOCS } from '../../src/seed.js';
import { MAPPINGS } from '../../src/data.js';

const clone = (j) => JSON.parse(JSON.stringify(j));
const L = (account_code, dr, cr, dim = {}) => ({account_code, debit_amount: dr || 0, credit_amount: cr || 0, ...dim});
const BANK2 = 'Operating Cash_WBLL_WF_9002';
const VENDOR = 'Summit General Contractors';

let _seq = 0;
// Default injection slot: entity 2, period 2026-07. That pair is the one
// entity/period the period master marks OPEN for entity 2, so an injected
// journal raises the rule under test and no period-control noise.
const je = (o = {}) => {
  _seq += 1;
  return {
    je_id: 990000 + _seq,
    je_number: `MUT-${String(_seq).padStart(4, '0')}`,
    entity_id: 2,
    period_code: '2026-07',
    je_date: '2026-07-31',
    je_type: 'MANUAL',
    source_system: 'MAN',
    posting_status: 'POSTED',
    has_attachment: true,
    created_by: 'mutation-harness',
    description: 'injected mutation',
    history: [{a: 'POST', by: 'mutation-harness', at: '2026-07-31'}],
    ...o,
  };
};
const add = (...entries) => (jes) => [...jes, ...entries.map((e) => (typeof e === 'function' ? e() : e))];

// Replace one journal in the copied ledger, leaving the original untouched.
const patch = (find, mutate) => (jes) => {
  const i = jes.findIndex(find);
  if (i < 0) throw new Error('mutation target not found in ledger');
  const copy = jes.slice();
  const j = clone(copy[i]);
  mutate(j, copy);
  copy[i] = j;
  return copy;
};

export const INJECTIONS = {
  // ---- balance / money exactness -----------------------------------------
  'off-by-a-cent': {
    rule: 'AUD-BAL-001',
    describe: 'Journal that does not balance to the cent (debit 1,000.01 vs credit 1,000.00).',
    apply: add(() => je({description: 'Injected: out of balance by one cent',
      lines: [L('705002', 1000.01, 0), L('220300', 0, 1000, {member: VENDOR})]})),
  },
  'within-old-0005-tolerance': {
    rule: 'AUD-BAL-001',
    describe: 'Out of balance by 0.004 - inside the tolerance the previous gate allowed.',
    apply: add(() => je({description: 'Injected: 0.004 out of balance',
      lines: [L('705002', 1000.004, 0), L('220300', 0, 1000, {member: VENDOR})]})),
  },
  'sub-minor-unit-precision': {
    rule: 'AUD-BAL-002',
    describe: 'Amount carrying more than 4 decimals, which numeric(20,4) would silently round.',
    apply: add(() => je({description: 'Injected: 5-decimal amount',
      lines: [L('705002', 1000.00005, 0), L('220300', 0, 1000.00005, {member: VENDOR})]})),
  },
  'negative-both-sides': {
    rule: 'AUD-SIGN-001',
    describe: 'Negative debit and negative credit that still net to balanced.',
    apply: add(() => je({description: 'Injected: negative debit and credit',
      lines: [L('705002', -1000, 0), L('220300', 0, -1000, {member: VENDOR})]})),
  },

  // ---- chart of accounts --------------------------------------------------
  'four-digit-account': {
    rule: 'AUD-COA-002',
    describe: 'Six-digit account code degraded to four digits (7050 instead of 705002).',
    apply: add(() => je({description: 'Injected: truncated account code',
      lines: [L('7050', 5000, 0), L('220300', 0, 5000, {member: VENDOR})]})),
  },
  'unknown-account': {
    rule: 'AUD-COA-004',
    describe: 'Posting to an account code that is in neither the demo COA nor the WBS master.',
    apply: add(() => je({description: 'Injected: unknown account',
      lines: [L('999999', 5000, 0), L('220300', 0, 5000, {member: VENDOR})]})),
  },
  'header-account-posting': {
    rule: 'AUD-COA-003',
    describe: 'Posting to WBS header account 110000 CASH (kind=H), which is a roll-up, not a ledger account.',
    apply: add(() => je({description: 'Injected: posting to a header account',
      lines: [L('110000', 1000, 0), L('220300', 0, 1000, {member: VENDOR})]})),
  },
  'total-account-posting': {
    rule: 'AUD-COA-003',
    describe: 'Posting to WBS total account 199000 TOTAL ASSETS (kind=T).',
    apply: add(() => je({description: 'Injected: posting to a total account',
      lines: [L('199000', 1000, 0), L('220300', 0, 1000, {member: VENDOR})]})),
  },

  // ---- period and entity identity ----------------------------------------
  'impossible-period': {
    rule: 'AUD-PER-001',
    describe: 'Posting into 2027-13, a period that cannot exist and therefore can never be opened.',
    apply: add(() => je({period_code: '2027-13', je_date: '2027-12-31', description: 'Injected: month 13',
      lines: [L('705002', 5000, 0), L('220300', 0, 5000, {member: VENDOR})]})),
  },
  'date-outside-period': {
    rule: 'AUD-PER-002',
    describe: 'je_date falls in a different month from period_code.',
    apply: add(() => je({period_code: '2026-07', je_date: '2026-08-03', description: 'Injected: date outside its period',
      lines: [L('705002', 5000, 0), L('220300', 0, 5000, {member: VENDOR})]})),
  },
  'nonexistent-entity': {
    rule: 'AUD-ENT-001',
    describe: 'Posting to an entity_id that is not in the entity master.',
    apply: add(() => je({entity_id: 9999, description: 'Injected: unknown entity',
      lines: [L('705002', 5000, 0), L('220300', 0, 5000, {member: VENDOR})]})),
  },

  // ---- duplicates ---------------------------------------------------------
  'duplicate-journal': {
    rule: 'AUD-DUP-003',
    describe: 'The same posted journal replayed: identical entity, period, date and line set under a new number.',
    apply: (jes) => {
      const src = jes.find((j) => j.posting_status === 'POSTED' && j.rule_code === 'R-WBS-INV-01');
      if (!src) throw new Error('no construction-invoice journal to duplicate');
      const dup = clone(src);
      dup.je_id = 991001;
      dup.je_number = `${src.je_number}-REPLAY`;
      return [...jes, dup];
    },
  },
  'duplicate-je-number': {
    rule: 'AUD-DUP-001',
    describe: 'Two different journals sharing one document number inside one entity.',
    apply: (jes) => {
      const src = jes.find((j) => j.posting_status === 'POSTED' && j.entity_id === 2 && j.period_code === '2026-07');
      if (!src) throw new Error('no entity 2 / 2026-07 journal to collide with');
      return [...jes, je({je_id: 991002, je_number: src.je_number, description: 'Injected: duplicate document number',
        lines: [L('705002', 77, 0), L('220300', 0, 77, {member: VENDOR})]})];
    },
  },

  // ---- construction loan --------------------------------------------------
  'loan-draw-as-cost': {
    rule: 'AUD-LOAN-001',
    describe: 'Loan draw booked as cost (Dr CWIP / Cr Loan Payable) instead of Dr Cash / Cr Loan Payable.',
    apply: add(() => je({description: 'Injected: Construction Loan Draw #9 - Cedar Ridge', rule_code: 'R-LOAN-01',
      lines: [L('164200', 500000, 0, {project_id: 1, loan_id: 1}), L('270100', 0, 500000, {loan_id: 1, member: 'First National Bank'})]})),
  },
  'interest-expensed-under-construction': {
    rule: 'AUD-LOAN-002',
    describe: 'Interest expensed to 795000 while the financed project is UNDER_CONSTRUCTION.',
    apply: add(() => je({description: 'Injected: interest accrual expensed during construction', rule_code: 'R-LOAN-04',
      lines: [L('795000', 29200, 0, {loan_id: 1, project_id: 1}), L('220410', 0, 29200, {loan_id: 1})]})),
  },
  'interest-capitalised-in-service': {
    rule: 'AUD-LOAN-003',
    describe: 'Interest capitalised to 164500 after the asset is complete and IN_SERVICE.',
    apply: add(() => je({entity_id: 4, description: 'Injected: interest capitalised on an in-service asset', rule_code: 'R-LOAN-03',
      lines: [L('164500', 29315, 0, {loan_id: 2, project_id: 2}), L('220410', 0, 29315, {loan_id: 2})]})),
  },
  'interest-basis-unresolvable': {
    rule: 'AUD-LOAN-004',
    describe: 'Loan interest accrual that names no loan and no project, so its capitalisation basis cannot be evidenced.',
    apply: add(() => je({entity_id: 33, description: 'Injected: interest accrual with no loan or project reference',
      lines: [L('795000', 4000, 0), L('220410', 0, 4000)]})),
  },

  // ---- deposits -----------------------------------------------------------
  'deposit-to-revenue': {
    rule: 'AUD-DEP-001',
    describe: 'Security deposit receipt credited to revenue 491800 instead of deposit liability 225000.',
    apply: add(() => je({description: 'Injected: Security deposit received from resident B-110',
      lines: [L('111000', 1500, 0, {member: BANK2}), L('491800', 0, 1500)]})),
  },
  'deposit-mapping-to-revenue': {
    rule: 'AUD-DEP-002',
    describe: 'PM charge-code mapping flagged LIABILITY but pointing at a revenue account.',
    apply: (jes) => {
      const m = MAPPINGS.find((x) => x.rev_exp_flag === 'LIABILITY');
      if (!m) throw new Error('no LIABILITY mapping to corrupt');
      m.owner_gl_account_code = '482300';
      return jes;
    },
  },

  // ---- unit cost / inventory / COGS ---------------------------------------
  'cogs-70x-unit-cost': {
    rule: 'AUD-INV-001',
    describe: 'COGS relief of 5,000,000 against a unit that never accumulated any cost.',
    apply: add(() => je({description: 'Injected: COGS far in excess of unit cost',
      lines: [L('510000', 5000000, 0, {unit_code: 'MUT Lot 1 Block Z'}), L('165100', 0, 5000000, {unit_code: 'MUT Lot 1 Block Z'})]})),
  },
  'cumulative-cogs-over-cost': {
    rule: 'AUD-INV-001',
    describe: 'One extra cent of COGS on a unit already fully relieved - cumulative COGS exceeds cumulative unit cost by 0.01.',
    apply: (jes) => {
      const src = jes.find((j) => j.posting_status === 'POSTED' && j.rule_code === 'R-CLS-COGS-01');
      if (!src) throw new Error('no COGS relief journal to extend');
      const unit = (src.lines.find((l) => l.unit_code) || {}).unit_code;
      return [...jes, je({entity_id: src.entity_id, period_code: src.period_code, je_date: src.je_date,
        description: `Injected: one cent of extra COGS on ${unit}`,
        lines: [L('510000', 0.01, 0, {unit_code: unit}), L('165100', 0, 0.01, {unit_code: unit})]})];
    },
  },
  'cogs-not-from-inventory': {
    rule: 'AUD-INV-002',
    describe: 'COGS relieved straight off CWIP without the completion transfer into finished inventory.',
    apply: add(
      () => je({description: 'Injected: cost capitalised to a unit',
        lines: [L('164400', 100000, 0, {unit_code: 'MUT Lot 7 Block Z'}), L('220300', 0, 100000, {member: VENDOR})]}),
      () => je({description: 'Injected: COGS taken directly off CWIP',
        lines: [L('510000', 100000, 0, {unit_code: 'MUT Lot 7 Block Z'}), L('164400', 0, 100000, {unit_code: 'MUT Lot 7 Block Z'})]}),
    ),
  },
  'cogs-without-unit': {
    rule: 'AUD-INV-003',
    describe: 'COGS debited with no unit dimension, so no unit ledger can carry it.',
    apply: add(() => je({description: 'Injected: undimensioned COGS',
      lines: [L('510000', 90000, 0), L('165100', 0, 90000)]})),
  },
  'sale-without-cogs': {
    rule: 'AUD-CLS-001',
    describe: 'Unit closing revenue recognised with no cost of sales in the same entity, period and unit.',
    apply: add(() => je({description: 'Injected: home closing with no COGS relief',
      lines: [L('111000', 300000, 0, {unit_code: 'MUT Lot 9 Block Z', member: BANK2}), L('491800', 0, 300000, {unit_code: 'MUT Lot 9 Block Z'})]})),
  },

  // ---- construction invoice dimensions ------------------------------------
  'construction-no-dimensions': {
    rule: 'AUD-CON-001',
    describe: 'Vertical construction cost with no Project and no Unit/WBS dimension.',
    apply: add(() => je({description: 'Injected: undimensioned construction cost',
      lines: [L('164400', 80000, 0), L('220300', 0, 80000, {member: VENDOR})]})),
  },
  'construction-unit-but-no-project': {
    rule: 'AUD-CON-001',
    describe: 'Construction cost that names a unit and nothing else - the exact shape 462 seeded lines carried while the gate stayed green.',
    apply: add(() => je({description: 'Injected: construction cost with a unit but no project',
      lines: [L('164400', 80000, 0, {unit_code: 'MUT Lot 4 Block Z'}), L('220300', 0, 80000, {member: VENDOR})]})),
  },
  'land-cost-no-project': {
    rule: 'AUD-CON-001',
    describe: 'Land development cost capitalised to 164100 with no project, so it can never be allocated to a lot.',
    apply: add(() => je({description: 'Injected: land development cost with no project',
      lines: [L('164100', 45000, 0), L('220300', 0, 45000, {member: VENDOR})]})),
  },
  'construction-line-dimensions-only-on-document': {
    rule: 'AUD-CON-003',
    describe: 'Construction invoice whose source document is complete but whose journal line carries no Cost Code and no Vendor, so no job cost report can be built from the ledger.',
    apply: (jes) => {
      SOURCE_DOCS['MUT-DOC-CONSTR-LINE'] = {id: 'MUT-DOC-CONSTR-LINE', type: 'CONSTRUCTION_INVOICE', doc_no: 'INV-MUT-002',
        unit: 'MUT Lot 5 Block Z', project_id: 1, cost_code: '2HD220', vendor: VENDOR, po_no: 'PO-MUT-002',
        date: '2026-07-15', amount: 40000, source_system: 'WBS · Faster PO'};
      return [...jes, je({je_type: 'AUTO', source_system: 'PAYABLE', rule_code: 'R-WBS-INV-01', source_doc_id: 'MUT-DOC-CONSTR-LINE',
        description: 'Injected: construction invoice whose dimensions never reach the journal line',
        lines: [L('164400', 40000, 0, {unit_code: 'MUT Lot 5 Block Z', project_id: 1}), L('220300', 0, 40000, {member: VENDOR})]})];
    },
  },
  'construction-line-unknown-cost-code': {
    rule: 'AUD-CON-003',
    describe: 'Construction cost line carrying a cost code that is not in the cost code master, so it maps to no budget line.',
    apply: (jes) => {
      SOURCE_DOCS['MUT-DOC-CONSTR-CC'] = {id: 'MUT-DOC-CONSTR-CC', type: 'CONSTRUCTION_INVOICE', doc_no: 'INV-MUT-003',
        unit: 'MUT Lot 6 Block Z', project_id: 1, cost_code: '2HD220', vendor: VENDOR, po_no: 'PO-MUT-003',
        date: '2026-07-15', amount: 40000, source_system: 'WBS · Faster PO'};
      return [...jes, je({je_type: 'AUTO', source_system: 'PAYABLE', rule_code: 'R-WBS-INV-01', source_doc_id: 'MUT-DOC-CONSTR-CC',
        description: 'Injected: construction cost line with an unknown cost code',
        lines: [L('164400', 40000, 0, {unit_code: 'MUT Lot 6 Block Z', project_id: 1, cost_code: 'ZZZ999', vendor: VENDOR}),
          L('220300', 0, 40000, {member: VENDOR})]})];
    },
  },
  'construction-invoice-missing-costcode': {
    rule: 'AUD-CON-002',
    describe: 'Construction invoice whose source document carries no Cost Code and no Vendor.',
    apply: (jes) => {
      SOURCE_DOCS['MUT-DOC-CONSTR'] = {id: 'MUT-DOC-CONSTR', type: 'CONSTRUCTION_INVOICE', doc_no: 'INV-MUT-001',
        unit: 'MUT Lot 3 Block Z', date: '2026-07-15', amount: 40000, source_system: 'WBS · Faster PO'};
      return [...jes, je({je_type: 'AUTO', source_system: 'PAYABLE', rule_code: 'R-WBS-INV-01', source_doc_id: 'MUT-DOC-CONSTR',
        description: 'Injected: construction invoice with no cost code or vendor',
        lines: [L('164400', 40000, 0, {unit_code: 'MUT Lot 3 Block Z'}), L('220300', 0, 40000, {member: VENDOR})]})];
    },
  },

  // ---- intercompany -------------------------------------------------------
  'one-sided-intercompany': {
    rule: 'AUD-IC-002',
    describe: 'Due-from booked on one entity with no mirror Due-to on the counterparty in that period.',
    apply: add(() => je({entity_id: 3, description: 'Injected: unmirrored intercompany receivable',
      lines: [L('125000', 250000, 0, {member: 'Wan Bridge Group LLC', description: 'Due from_Wan Bridge Group LLC'}), L('490600', 0, 250000)]})),
  },
  'intercompany-nongroup-member': {
    rule: 'AUD-IC-001',
    describe: 'Intercompany account carrying a counterparty that is not a group entity, so it can never eliminate.',
    apply: add(() => je({description: 'Injected: affiliate balance against a non-group party',
      lines: [L('705002', 250000, 0), L('291001', 0, 250000, {member: 'Some Affiliate LLC'})]})),
  },
  'intercompany-self-dealing': {
    rule: 'AUD-IC-003',
    describe: 'Intercompany line naming its own entity as the counterparty.',
    apply: add(() => je({description: 'Injected: entity owing itself',
      lines: [L('125000', 5000, 0, {member: 'Wan Bridge Land LLC', description: 'Due from_Wan Bridge Land LLC'}), L('490600', 0, 5000)]})),
  },

  // ---- subsidiary ledger --------------------------------------------------
  'subsidiary-no-member': {
    rule: 'AUD-SUB-001',
    describe: 'Subsidiary-ledger line (A/P Accrual) posted with no member.',
    apply: add(() => je({description: 'Injected: subsidiary line with no member',
      lines: [L('705002', 5000, 0), L('220300', 0, 5000)]})),
  },

  // ---- suspense, fixed assets --------------------------------------------
  'suspense-balance': {
    rule: 'AUD-SUS-001',
    describe: 'Suspense account 142000 left carrying an unidentified balance.',
    apply: add(() => je({description: 'Injected: unexplained suspense balance',
      lines: [L('142000', 34000, 0), L('111000', 0, 34000, {member: BANK2})]})),
  },
  'depreciation-never-run': {
    rule: 'AUD-FA-001',
    describe: 'Depreciable fixed asset acquired and carried with no depreciation ever posted against it.',
    apply: add(() => je({description: 'Injected: fixed asset purchase, no depreciation run',
      lines: [L('165600', 120000, 0), L('111000', 0, 120000, {member: BANK2})]})),
  },

  // ---- control / provenance ----------------------------------------------
  'posted-then-edited': {
    rule: 'AUD-IMM-001',
    describe: 'Posted entry amended in place instead of corrected by reversal.',
    apply: patch((j) => Array.isArray(j.history) && j.history.some((h) => /POST/i.test(h.a || '')) && j.posting_status === 'POSTED',
      (j) => { j.history.push({a: 'EDIT AMOUNT', by: 'someone', at: '2026-07-20'}); }),
  },
  'ai-autopost': {
    rule: 'AUD-AI-001',
    describe: 'AI-originated journal reaching POSTED with no human reviewer or approver.',
    apply: add(() => je({created_by: 'ai-assistant', source_system: 'AI', je_type: 'MANUAL',
      description: 'Injected: AI drafted and posted entry',
      history: [{a: 'AI DRAFT', by: 'ai-assistant', at: '2026-07-31'}, {a: 'POST', by: 'ai-assistant', at: '2026-07-31'}],
      lines: [L('705002', 4200, 0), L('220300', 0, 4200, {member: VENDOR})]})),
  },
  'auto-without-trace': {
    rule: 'AUD-TRC-001',
    describe: 'Automatic journal with no source document and no rule code.',
    apply: add(() => je({je_type: 'AUTO', source_system: 'PAYABLE', description: 'Injected: untraceable automatic entry',
      lines: [L('705002', 5000, 0), L('220300', 0, 5000, {member: VENDOR})]})),
  },
  'dangling-source-doc': {
    rule: 'AUD-TRC-002',
    describe: 'Journal naming a source document that does not exist.',
    apply: add(() => je({je_type: 'AUTO', source_system: 'PAYABLE', rule_code: 'R-AP-STD-01', source_doc_id: 'SD-DOES-NOT-EXIST',
      description: 'Injected: source document reference that resolves to nothing',
      lines: [L('705002', 5000, 0), L('220300', 0, 5000, {member: VENDOR})]})),
  },
};

export const INJECTION_NAMES = Object.keys(INJECTIONS);
