// REFS WBS accounting foundation.
// This is the replaceable seam for the future real WBS MCP adapter: UI and
// accounting logic consume this contract shape, not temporary screen fields.

const commonFields = Object.freeze([
  'id',
  'external_source_id',
  'source_system',
  'entity_id',
  'project_id',
  'property_id',
  'transaction_date',
  'accounting_period',
  'amount',
  'currency',
  'status',
  'source_document_id',
  'created_at',
  'updated_at',
  'confidence_score',
  'audit_trail_id',
]);

const partyFields = Object.freeze(['vendor_id', 'customer_id']);

export const WBS_MCP_CONTRACTS = Object.freeze({
  Entity: ['id', 'external_source_id', 'source_system', 'status', 'created_at', 'updated_at', 'audit_trail_id', 'entity_code', 'legal_name', 'currency'],
  Project: [...commonFields, 'project_code', 'project_name', 'completion_date'],
  Property: [...commonFields, 'lot', 'unit', 'address'],
  Vendor: [...commonFields, 'vendor_id', 'vendor_name', 'vendor_type'],
  CustomerTenant: [...commonFields, 'customer_id', 'customer_name', 'tenant_status'],
  ChartOfAccounts: [...commonFields, 'account_code', 'account_name', 'account_type'],
  BankTransaction: [...commonFields, ...partyFields, 'bank_account_id', 'direction', 'memo', 'match_status'],
  PayableInvoice: [...commonFields, 'vendor_id', 'invoice_number', 'invoice_date', 'due_date', 'open_amount'],
  PayablePayment: [...commonFields, 'vendor_id', 'invoice_id', 'bank_transaction_id', 'payment_status'],
  CostGLTransaction: [...commonFields, 'vendor_id', 'cost_code', 'cost_class', 'capitalization_status'],
  ConstructionLoan: [...commonFields, 'lender_vendor_id', 'loan_number', 'loan_status', 'lender_balance', 'gl_balance'],
  LoanTransaction: [...commonFields, 'loan_id', 'loan_transaction_type', 'memo'],
  PropertyOperation: [...commonFields, 'operation_type', 'metric_name'],
  RentRoll: [...commonFields, 'customer_id', 'lease_id', 'scheduled_rent'],
  ResidentActivity: [...commonFields, 'customer_id', 'activity_type'],
  ClosingStatement: [...commonFields, 'closing_type', 'settlement_agent'],
  SourceDocument: [...commonFields, ...partyFields, 'document_type', 'document_hash', 'storage_ref'],
  JournalEntry: [...commonFields, 'je_id', 'je_number', 'posting_status', 'review_status'],
  JournalEntryLine: [...commonFields, 'je_id', 'line_number', 'account_code', 'debit_amount', 'credit_amount'],
  AIFinding: [...commonFields, 'rule_id', 'risk_level', 'reason', 'suggested_action', 'owner', 'due_date'],
  AIRuleResult: [...commonFields, 'rule_id', 'object_type', 'object_id', 'result_status'],
  AmortizationSchedule: [...commonFields, 'schedule_id', 'coverage_start', 'coverage_end', 'monthly_amount'],
  AccrualSchedule: [...commonFields, 'schedule_id', 'accrual_type', 'reversal_period'],
});

export const ACCOUNTING_EVENT_TYPES = Object.freeze([
  'invoice',
  'payment',
  'loan_draw',
  'loan_interest',
  'loan_fee',
  'loan_repayment',
  'escrow',
  'prepaid',
  'amortization',
  'accrual',
  'rent_income',
  'deposit_liability',
  'property_expense',
  'intercompany',
  'reimbursement',
  'construction_cost',
  'closing_cost',
  'reclass',
  'reversal',
  'manual_je',
]);

export const ACCOUNT_MAP = Object.freeze({
  cash: '111000',
  ar: '120200',
  prepaidInsurance: '140100',
  cwip: '164400',
  capitalizedInterest: '164500',
  ap: '220100',
  loanPayable: '211000',
  dueToFrom: '291001',
  rentRevenue: '411000',
  insuranceExpense: '610100',
  propertyTaxExpense: '610200',
  interestExpense: '610500',
  suspense: '999999',
});

const now = '2026-08-05T00:00:00.000Z';
const money = value => Math.round(Number(value || 0) * 100) / 100;
const periodOf = date => String(date || '').slice(0, 7);
const lower = value => String(value || '').toLowerCase();
const sourceRef = item => item.source_document_id || item.id;
const auditTrail = (id, action) => ({ id: `AUD-${id}-${action}`, action, at: now, actor: 'SYSTEM_RULE_ENGINE' });

const base = (kind, id, overrides = {}) => ({
  id,
  external_source_id: `WBS:${id}`,
  source_system: 'WBS_MOCK',
  entity_id: 'ENT-WB-001',
  project_id: overrides.project_id ?? 'PROJ-HOU-01',
  property_id: overrides.property_id ?? 'PROP-AUSTIN-01',
  transaction_date: overrides.transaction_date ?? '2026-07-31',
  accounting_period: overrides.accounting_period ?? periodOf(overrides.transaction_date ?? '2026-07-31'),
  amount: money(overrides.amount),
  currency: 'USD',
  status: overrides.status ?? 'READY',
  source_document_id: overrides.source_document_id ?? `DOC-${id}`,
  created_at: now,
  updated_at: now,
  confidence_score: overrides.confidence_score ?? 0.92,
  audit_trail_id: `AUD-${kind}-${id}`,
  ...overrides,
});

export function createWbsMockDataset() {
  const entities = [{ id: 'ENT-WB-001', external_source_id: 'WBS:ENT-WB-001', source_system: 'WBS_MOCK', status: 'ACTIVE', created_at: now, updated_at: now, audit_trail_id: 'AUD-ENTITY-1', entity_code: 'WB-AUS', legal_name: 'WanBridge Austin Homes LLC', currency: 'USD' }];
  const projects = [
    base('PROJECT', 'PROJ-HOU-01', { amount: 0, project_code: 'HOU-01', project_name: 'Austin Horizontal Build', completion_date: null }),
    base('PROJECT', 'PROJ-DONE-01', { amount: 0, project_code: 'DONE-01', project_name: 'Completed Villas', completion_date: '2026-06-15' }),
  ];
  const properties = [base('PROPERTY', 'PROP-AUSTIN-01', { amount: 0, lot: 'LOT-18', unit: 'UNIT-18', address: '118 Greenway Loop, Austin, TX' })];
  const vendors = [
    base('VENDOR', 'VEN-INS-01', { amount: 0, vendor_id: 'VEN-INS-01', vendor_name: 'Continental Insurance', vendor_type: 'INSURANCE' }),
    base('VENDOR', 'VEN-LEND-01', { amount: 0, vendor_id: 'VEN-LEND-01', vendor_name: 'Texas Construction Bank', vendor_type: 'LENDER' }),
    base('VENDOR', 'VEN-GC-01', { amount: 0, vendor_id: 'VEN-GC-01', vendor_name: 'Hill Country GC', vendor_type: 'CONTRACTOR' }),
  ];
  const sourceDocuments = [
    base('DOC', 'DOC-INS-12MO', { amount: 12000, document_type: 'INSURANCE_POLICY', document_hash: 'sha256-insurance-12mo', storage_ref: 'mock://wbs/documents/insurance-12mo.pdf' }),
    base('DOC', 'DOC-AP-MISSING-GL', { amount: 45000, document_type: 'PAYABLE_REPORT', document_hash: 'sha256-payable-accrual', storage_ref: 'mock://wbs/reports/payable-july.json' }),
    base('DOC', 'DOC-BANK-UNMATCHED', { amount: -8500, document_type: 'BANK_STATEMENT', document_hash: 'sha256-bank-unmatched', storage_ref: 'mock://wbs/bank/july.csv' }),
    base('DOC', 'DOC-LOAN-DRAW', { amount: 250000, document_type: 'LOAN_DRAW_SCHEDULE', document_hash: 'sha256-loan-draw', storage_ref: 'mock://wbs/loan/draw-07.pdf' }),
    base('DOC', 'DOC-RENT-ROLL', { amount: 98000, document_type: 'RENT_ROLL', document_hash: 'sha256-rent-roll', storage_ref: 'mock://wbs/pm/rent-roll.json' }),
  ];
  const payableInvoices = [
    base('AP', 'AP-INS-12MO', { amount: 12000, vendor_id: 'VEN-INS-01', invoice_number: 'INS-2026-12', invoice_date: '2026-07-01', due_date: '2026-07-15', coverage_start: '2026-07-01', coverage_end: '2027-06-30', open_amount: 0, source_document_id: 'DOC-INS-12MO' }),
    base('AP', 'AP-ACCRUAL-01', { amount: 45000, vendor_id: 'VEN-GC-01', invoice_number: 'GC-775', invoice_date: '2026-07-29', due_date: '2026-08-15', open_amount: 45000, source_document_id: 'DOC-AP-MISSING-GL' }),
    base('AP', 'AP-DUP-01', { amount: 27500, vendor_id: 'VEN-GC-01', invoice_number: 'GC-DUP-9', invoice_date: '2026-07-20', due_date: '2026-08-05', open_amount: 27500 }),
    base('AP', 'AP-DUP-02', { amount: 27500, vendor_id: 'VEN-GC-01', invoice_number: 'GC-DUP-9', invoice_date: '2026-07-21', due_date: '2026-08-05', open_amount: 27500 }),
  ];
  const bankTransactions = [
    base('BANK', 'BANK-INS-PAY', { amount: -12000, vendor_id: 'VEN-INS-01', direction: 'DEBIT', memo: 'ACH Continental Insurance annual premium', match_status: 'MATCHED', bank_account_id: 'BA-OPERATING', source_document_id: 'DOC-INS-12MO' }),
    base('BANK', 'BANK-UNMATCHED-01', { amount: -8500, direction: 'DEBIT', memo: 'ACH vendor payment no invoice support', match_status: 'UNMATCHED', bank_account_id: 'BA-OPERATING', source_document_id: 'DOC-BANK-UNMATCHED' }),
    base('BANK', 'BANK-LOAN-DRAW-01', { amount: 250000, vendor_id: 'VEN-LEND-01', direction: 'CREDIT', memo: 'Construction loan draw funding', match_status: 'UNMATCHED', bank_account_id: 'BA-OPERATING', source_document_id: 'DOC-LOAN-DRAW' }),
  ];
  const costGlTransactions = [
    base('COST', 'COST-POST-COMPLETE-01', { amount: 31000, vendor_id: 'VEN-GC-01', project_id: 'PROJ-DONE-01', cost_code: '2HD-FRAMING', cost_class: 'HARD_COST', capitalization_status: 'CAPITALIZED' }),
    base('COST', 'COST-INTEREST-EXPENSED', { amount: 18500, vendor_id: 'VEN-LEND-01', cost_code: 'INT-CAP', cost_class: 'INTEREST', capitalization_status: 'EXPENSED', memo: 'Loan interest during active construction' }),
  ];
  const constructionLoans = [base('LOAN', 'LOAN-HOU-01', { amount: 0, lender_vendor_id: 'VEN-LEND-01', loan_number: 'L-2026-AUS', loan_status: 'ACTIVE', lender_balance: 750000, gl_balance: 500000 })];
  const loanTransactions = [
    base('LOAN_TXN', 'LOAN-DRAW-01', { amount: 250000, loan_id: 'LOAN-HOU-01', vendor_id: 'VEN-LEND-01', loan_transaction_type: 'DRAW', memo: 'Construction loan draw received', source_document_id: 'DOC-LOAN-DRAW' }),
    base('LOAN_TXN', 'LOAN-INT-01', { amount: 18500, loan_id: 'LOAN-HOU-01', vendor_id: 'VEN-LEND-01', loan_transaction_type: 'INTEREST', memo: 'Interest should be capitalized before completion' }),
  ];
  const rentRoll = [base('RENT', 'RENT-JULY-01', { amount: 98000, customer_id: 'TENANT-GROUP-01', lease_id: 'LEASE-JULY', scheduled_rent: 98000, source_document_id: 'DOC-RENT-ROLL' })];
  const propertyOperations = [base('OPS', 'OPS-JULY-01', { amount: 87500, operation_type: 'RENT_REVENUE_GL', metric_name: 'GL rent revenue' })];
  const journalEntries = [
    journal('JE-POSTED-INS-PAY', 'POSTED', '2026-07-15', 'DOC-INS-12MO', [
      line(ACCOUNT_MAP.prepaidInsurance, 12000, 0),
      line(ACCOUNT_MAP.cash, 0, 12000),
    ]),
    journal('JE-RENT-GL', 'POSTED', '2026-07-31', 'DOC-RENT-ROLL', [
      line(ACCOUNT_MAP.ar, 87500, 0),
      line(ACCOUNT_MAP.rentRevenue, 0, 87500),
    ]),
    journal('JE-MANUAL-NOATTACH', 'DRAFT', '2026-07-31', null, [
      line(ACCOUNT_MAP.suspense, 50000, 0),
      line(ACCOUNT_MAP.dueToFrom, 0, 50000),
    ], { je_type: 'MANUAL', has_attachment: false }),
  ];
  return { entities, projects, properties, vendors, sourceDocuments, payableInvoices, bankTransactions, costGlTransactions, constructionLoans, loanTransactions, rentRoll, propertyOperations, journalEntries, accountingPeriods: [{ period_code: '2026-07', status: 'OPEN' }, { period_code: '2026-06', status: 'CLOSED' }] };
}

function line(account_code, debit_amount, credit_amount) {
  return { account_code, debit_amount: money(debit_amount), credit_amount: money(credit_amount) };
}

function journal(je_id, posting_status, je_date, source_document_id, lines, overrides = {}) {
  return {
    je_id,
    je_number: je_id,
    entity_id: 'ENT-WB-001',
    project_id: 'PROJ-HOU-01',
    property_id: 'PROP-AUSTIN-01',
    je_date,
    accounting_period: periodOf(je_date),
    posting_status,
    review_status: posting_status === 'POSTED' ? 'POSTED' : 'DRAFT',
    source_document_id,
    source_system: 'REFS_MOCK',
    je_type: 'AUTO',
    has_attachment: Boolean(source_document_id),
    lines,
    audit_trail: [auditTrail(je_id, 'created')],
    ...overrides,
  };
}

export function createWbsMockConnector(dataset = createWbsMockDataset()) {
  return Object.freeze({
    mode: 'WBS_MOCK_CONNECTOR',
    async fetchSnapshot() {
      return structuredClone(dataset);
    },
    async fetchCollection(name) {
      if (!(name in dataset)) throw new Error(`Unknown WBS mock collection: ${name}`);
      return structuredClone(dataset[name]);
    },
  });
}

export function validateWbsContractRecord(contractName, record) {
  const fields = WBS_MCP_CONTRACTS[contractName];
  if (!fields) return { ok: false, missing: [], code: 'UNKNOWN_CONTRACT' };
  const missing = fields.filter(field => !(field in record));
  return { ok: missing.length === 0, missing, code: missing.length ? 'CONTRACT_FIELD_MISSING' : 'OK' };
}

export function buildAccountingEvents(snapshot) {
  const events = [];
  const push = (event_type, source, patch = {}) => events.push({
    event_id: `EVT-${source.id}`,
    event_type,
    source_transaction_id: source.id,
    entity_id: source.entity_id,
    project_id: source.project_id,
    property_id: source.property_id,
    amount: money(source.amount),
    accounting_period: source.accounting_period,
    suggested_debit_account: patch.suggested_debit_account || null,
    suggested_credit_account: patch.suggested_credit_account || null,
    rule_id: patch.rule_id || `EVENT_${event_type.toUpperCase()}`,
    confidence_score: patch.confidence_score ?? source.confidence_score ?? 0.8,
    status: patch.status || 'READY_FOR_RULES',
    reason: patch.reason || `Mapped WBS ${source.id} to ${event_type}`,
    requires_review: patch.requires_review ?? true,
    source_document_id: source.source_document_id,
    source_system: source.source_system,
  });
  snapshot.payableInvoices.forEach(invoice => {
    const text = lower(`${invoice.invoice_number} ${invoice.vendor_id}`);
    if (invoice.coverage_start && invoice.coverage_end) push('prepaid', invoice, { suggested_debit_account: ACCOUNT_MAP.prepaidInsurance, suggested_credit_account: ACCOUNT_MAP.ap, rule_id: 'PREPAID_COVERAGE_REQUIRED', reason: 'Payable has multi-month coverage and must be amortized.' });
    else push('invoice', invoice, { suggested_debit_account: ACCOUNT_MAP.cwip, suggested_credit_account: ACCOUNT_MAP.ap, rule_id: text.includes('tax') ? 'PROPERTY_TAX_INVOICE' : 'AP_INVOICE_RECOGNITION' });
  });
  snapshot.bankTransactions.forEach(txn => {
    if (/draw|lender|loan/i.test(txn.memo)) push('loan_draw', txn, { suggested_debit_account: ACCOUNT_MAP.cash, suggested_credit_account: ACCOUNT_MAP.loanPayable, rule_id: 'BANK_LOAN_DRAW_DETECTED', confidence_score: 0.96 });
    else push('payment', txn, { suggested_debit_account: ACCOUNT_MAP.ap, suggested_credit_account: ACCOUNT_MAP.cash, rule_id: txn.match_status === 'UNMATCHED' ? 'BANK_PAYMENT_NO_MATCH' : 'BANK_PAYMENT_MATCHED' });
  });
  snapshot.costGlTransactions.forEach(cost => push(cost.cost_class === 'INTEREST' ? 'loan_interest' : 'construction_cost', cost, { suggested_debit_account: cost.cost_class === 'INTEREST' ? ACCOUNT_MAP.capitalizedInterest : ACCOUNT_MAP.cwip, suggested_credit_account: ACCOUNT_MAP.ap, rule_id: cost.cost_class === 'INTEREST' ? 'INTEREST_CAPITALIZATION_REQUIRED' : 'CONSTRUCTION_COST_CLASSIFICATION' }));
  snapshot.loanTransactions.forEach(txn => push(txn.loan_transaction_type === 'INTEREST' ? 'loan_interest' : 'loan_draw', txn, { suggested_debit_account: txn.loan_transaction_type === 'INTEREST' ? ACCOUNT_MAP.capitalizedInterest : ACCOUNT_MAP.cash, suggested_credit_account: txn.loan_transaction_type === 'INTEREST' ? ACCOUNT_MAP.ap : ACCOUNT_MAP.loanPayable, rule_id: `LOAN_${txn.loan_transaction_type}` }));
  snapshot.rentRoll.forEach(rent => push('rent_income', rent, { suggested_debit_account: ACCOUNT_MAP.ar, suggested_credit_account: ACCOUNT_MAP.rentRevenue, rule_id: 'RENT_ROLL_REVENUE' }));
  return events;
}

export function runDeterministicAccountingRules(snapshot, events = buildAccountingEvents(snapshot)) {
  const findings = [];
  const posted = snapshot.journalEntries.filter(je => je.posting_status === 'POSTED');
  const postedSourceDocs = new Set(posted.map(je => je.source_document_id).filter(Boolean));
  const sourceDocs = new Set(snapshot.sourceDocuments.map(doc => doc.id));
  const add = (event, rule) => findings.push({
    finding_id: `FIND-${rule.rule_id}-${event.source_transaction_id}`,
    rule_id: rule.rule_id,
    rule_name: rule.rule_name,
    risk_level: rule.risk_level,
    object_type: rule.object_type || 'ACCOUNTING_EVENT',
    object_id: event.source_transaction_id,
    reason: rule.reason,
    suggested_action: rule.suggested_action,
    suggested_je: Object.prototype.hasOwnProperty.call(rule, 'suggested_je') ? rule.suggested_je : buildSuggestedJournalEntry(event, rule.rule_id),
    confidence_score: rule.confidence_score ?? event.confidence_score,
    owner: rule.owner || (rule.risk_level === 'HIGH' ? 'CONTROLLER' : 'SENIOR_ACCOUNTANT'),
    due_date: rule.due_date || '2026-08-06',
    status: rule.risk_level === 'HIGH' ? 'REVIEW_REQUIRED' : 'OPEN',
    source_refs: [event.source_document_id, event.source_transaction_id].filter(Boolean),
    audit_trail: [auditTrail(event.source_transaction_id, rule.rule_id)],
  });
  events.forEach(event => {
    if (event.event_type === 'prepaid') add(event, { rule_id: 'PREPAID_SCHEDULE_REQUIRED', rule_name: 'Insurance coverage period requires amortization', risk_level: 'HIGH', reason: 'Insurance payable covers more than one accounting month.', suggested_action: 'Create prepaid asset and monthly amortization schedule before period close.', confidence_score: 0.98 });
    if (event.event_type === 'payment' && /NO_MATCH/.test(event.rule_id)) add(event, { rule_id: 'PAYMENT_WITHOUT_BILL', rule_name: 'Bank payment missing AP source', risk_level: 'HIGH', reason: 'Outgoing bank payment has no matched payable invoice.', suggested_action: 'Route to bank exception queue and obtain invoice support before matching.', confidence_score: 0.96 });
    if (event.event_type === 'loan_draw') add(event, { rule_id: 'LOAN_DRAW_RECOGNITION', rule_name: 'Construction loan draw recognition', risk_level: 'MEDIUM', reason: 'Bank credit or loan transaction indicates lender draw funding.', suggested_action: 'Prepare loan draw JE after source review.', confidence_score: 0.95 });
    if (event.event_type === 'loan_interest') add(event, { rule_id: 'INTEREST_CAPITALIZATION_REQUIRED', rule_name: 'Loan interest capitalization', risk_level: 'HIGH', reason: 'Interest relates to an active construction project and should be reviewed for capitalization.', suggested_action: 'Prepare capitalized interest JE or reclass from expense after controller review.', confidence_score: 0.94 });
  });
  snapshot.payableInvoices.forEach(invoice => {
    if (!postedSourceDocs.has(invoice.source_document_id) && invoice.open_amount > 0) {
      const event = events.find(item => item.source_transaction_id === invoice.id) || { ...invoice, source_transaction_id: invoice.id, event_type: 'accrual', suggested_debit_account: ACCOUNT_MAP.cwip, suggested_credit_account: ACCOUNT_MAP.ap };
      add(event, { rule_id: 'ACCRUAL_CANDIDATE', rule_name: 'Payable invoice exists without GL entry', risk_level: 'HIGH', reason: 'Payable report includes an open invoice but no posted GL entry exists for its source.', suggested_action: 'Create month-end accrual candidate and reversing JE workflow.', confidence_score: 0.97 });
    }
  });
  const dup = new Map();
  snapshot.payableInvoices.forEach(invoice => {
    const key = `${invoice.entity_id}|${invoice.vendor_id}|${invoice.invoice_number}|${invoice.amount}`;
    if (dup.has(key)) {
      const event = events.find(item => item.source_transaction_id === invoice.id) || { ...invoice, source_transaction_id: invoice.id, event_type: 'invoice', suggested_debit_account: ACCOUNT_MAP.cwip, suggested_credit_account: ACCOUNT_MAP.ap };
      add(event, { rule_id: 'DUPLICATE_INVOICE_RISK', rule_name: 'Duplicate invoice risk', risk_level: 'HIGH', reason: `Same vendor, invoice number and amount as ${dup.get(key)}.`, suggested_action: 'Block posting until duplicate review is resolved.', confidence_score: 0.99 });
    }
    dup.set(key, invoice.id);
  });
  snapshot.costGlTransactions.filter(cost => cost.capitalization_status === 'CAPITALIZED').forEach(cost => {
    const project = snapshot.projects.find(item => item.id === cost.project_id);
    if (project?.completion_date) {
      const event = events.find(item => item.source_transaction_id === cost.id) || { ...cost, source_transaction_id: cost.id, event_type: 'construction_cost', suggested_debit_account: ACCOUNT_MAP.cwip, suggested_credit_account: ACCOUNT_MAP.ap };
      add(event, { rule_id: 'CWIP_POST_COMPLETION_CUTOFF', rule_name: 'Completed project capitalization cutoff', risk_level: 'HIGH', reason: `Project was completed on ${project.completion_date} but new capitalized cost remains.`, suggested_action: 'Review cutoff and reclass to expense if capitalization is not supported.', confidence_score: 0.95 });
    }
  });
  snapshot.constructionLoans.forEach(loan => {
    const difference = money(loan.lender_balance - loan.gl_balance);
    if (Math.abs(difference) > 0.01) {
      const event = { source_transaction_id: loan.id, entity_id: loan.entity_id, project_id: loan.project_id, property_id: loan.property_id, amount: difference, accounting_period: loan.accounting_period, suggested_debit_account: difference > 0 ? ACCOUNT_MAP.cash : ACCOUNT_MAP.loanPayable, suggested_credit_account: difference > 0 ? ACCOUNT_MAP.loanPayable : ACCOUNT_MAP.cash, source_document_id: loan.source_document_id, confidence_score: 0.95 };
      add(event, { rule_id: 'LOAN_BALANCE_MISMATCH', rule_name: 'Loan statement balance does not tie to GL', risk_level: 'HIGH', reason: `Lender balance ${loan.lender_balance} differs from GL loan balance ${loan.gl_balance} by ${difference}.`, suggested_action: 'Reconcile lender statement, bank draw and GL loan payable before close.', confidence_score: 0.95 });
    }
  });
  snapshot.rentRoll.forEach(rent => {
    const glRevenue = snapshot.propertyOperations.filter(op => op.operation_type === 'RENT_REVENUE_GL' && op.entity_id === rent.entity_id).reduce((sum, op) => sum + Number(op.amount || 0), 0);
    const difference = money(rent.scheduled_rent - glRevenue);
    if (Math.abs(difference) > 0.01) {
      const event = events.find(item => item.source_transaction_id === rent.id) || { ...rent, source_transaction_id: rent.id, event_type: 'rent_income', suggested_debit_account: ACCOUNT_MAP.ar, suggested_credit_account: ACCOUNT_MAP.rentRevenue };
      add(event, { rule_id: 'RENT_ROLL_REVENUE_MISMATCH', rule_name: 'Rent roll does not tie to GL revenue', risk_level: 'HIGH', reason: `Rent roll ${rent.scheduled_rent} differs from GL revenue ${glRevenue} by ${difference}.`, suggested_action: 'Reconcile rent roll, resident activity and posted revenue before reporting.', confidence_score: 0.94 });
    }
  });
  snapshot.journalEntries.forEach(je => {
    const debit = je.lines.reduce((sum, item) => sum + Number(item.debit_amount || 0), 0);
    const credit = je.lines.reduce((sum, item) => sum + Number(item.credit_amount || 0), 0);
    if (Math.abs(debit - credit) > 0.005 || !je.source_document_id || !sourceDocs.has(je.source_document_id)) {
      const event = { source_transaction_id: je.je_id, entity_id: je.entity_id, project_id: je.project_id, property_id: je.property_id, amount: debit || credit, accounting_period: je.accounting_period, suggested_debit_account: ACCOUNT_MAP.suspense, suggested_credit_account: ACCOUNT_MAP.suspense, source_document_id: je.source_document_id, confidence_score: 0.99 };
      add(event, { rule_id: !je.source_document_id ? 'MISSING_SOURCE_DOCUMENT' : 'JE_CONTROL_FAILURE', rule_name: !je.source_document_id ? 'Missing source document blocks posting' : 'JE debit credit control failure', risk_level: 'HIGH', reason: !je.source_document_id ? 'Journal entry has no source document reference.' : 'Journal entry is not balanced.', suggested_action: 'Block posting until source support and debit/credit controls pass.', confidence_score: 0.99, suggested_je: null });
    }
    if (je.je_type === 'MANUAL' && je.has_attachment === false && Math.max(debit, credit) >= 10000) {
      const event = { source_transaction_id: je.je_id, entity_id: je.entity_id, project_id: je.project_id, property_id: je.property_id, amount: Math.max(debit, credit), accounting_period: je.accounting_period, suggested_debit_account: ACCOUNT_MAP.suspense, suggested_credit_account: ACCOUNT_MAP.dueToFrom, source_document_id: je.source_document_id, confidence_score: 0.98 };
      add(event, { rule_id: 'MANUAL_JE_LARGE_NO_ATTACHMENT', rule_name: 'Manual JE high risk', risk_level: 'HIGH', reason: 'Large manual JE has no attachment.', suggested_action: 'Require controller review, attachment and audit trail before posting.', confidence_score: 0.98, suggested_je: null });
    }
  });
  return findings;
}

export function buildSuggestedJournalEntry(event, ruleId = event.rule_id) {
  const amount = Math.abs(money(event.amount));
  const debit = event.suggested_debit_account || ACCOUNT_MAP.suspense;
  const credit = event.suggested_credit_account || ACCOUNT_MAP.suspense;
  if (!amount || debit === credit) return null;
  return journal(`SUG-${event.source_transaction_id}`, 'DRAFT', `${event.accounting_period || '2026-07'}-28`, event.source_document_id, [line(debit, amount, 0), line(credit, 0, amount)], {
    source_system: 'AI_RULE_ENGINE',
    review_status: 'REVIEW_REQUIRED',
    ai_rule_id: ruleId,
    ai_confidence: event.confidence_score,
    audit_trail: [auditTrail(event.source_transaction_id, `suggested:${ruleId}`)],
  });
}

export function createAmortizationScheduleFromInsurance(invoice) {
  if (!invoice.coverage_start || !invoice.coverage_end) throw new Error('Coverage period is required');
  const start = new Date(`${invoice.coverage_start}T00:00:00Z`);
  const end = new Date(`${invoice.coverage_end}T00:00:00Z`);
  const months = [];
  let cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  const final = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
  while (cursor <= final) {
    months.push(`${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, '0')}`);
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
  }
  const cents = Math.round(Number(invoice.amount) * 100);
  const baseCents = Math.floor(cents / months.length);
  let remainder = cents - baseCents * months.length;
  return {
    schedule_id: `AMORT-${invoice.id}`,
    source_invoice_id: invoice.id,
    source_document_id: invoice.source_document_id,
    entity_id: invoice.entity_id,
    project_id: invoice.project_id,
    property_id: invoice.property_id,
    coverage_start: invoice.coverage_start,
    coverage_end: invoice.coverage_end,
    status: 'DRAFT',
    lines: months.map(period => {
      const extra = remainder > 0 ? 1 : 0;
      remainder -= extra;
      const monthly = money((baseCents + extra) / 100);
      return {
        period,
        amount: monthly,
        suggested_je: journal(`AMORT-${invoice.id}-${period}`, 'DRAFT', `${period}-28`, invoice.source_document_id, [
          line(ACCOUNT_MAP.insuranceExpense, monthly, 0),
          line(ACCOUNT_MAP.prepaidInsurance, 0, monthly),
        ], { source_system: 'AI_RULE_ENGINE', review_status: 'REVIEW_REQUIRED', ai_rule_id: 'MONTHLY_PREPAID_AMORTIZATION' }),
      };
    }),
  };
}

export function approveAndPostSuggestedJEs({ suggestedJEs = [], periods = [] } = {}) {
  const periodByCode = new Map(periods.map(period => [period.period_code, period]));
  return suggestedJEs.map(je => {
    const debit = je.lines.reduce((sum, item) => sum + Number(item.debit_amount || 0), 0);
    const credit = je.lines.reduce((sum, item) => sum + Number(item.credit_amount || 0), 0);
    if (Math.abs(debit - credit) > 0.005) return { ...je, posting_status: 'BLOCKED', block_reason: 'JE debit must equal credit' };
    if (!je.source_document_id) return { ...je, posting_status: 'BLOCKED', block_reason: 'Missing source document' };
    if (periodByCode.get(je.accounting_period)?.status === 'CLOSED') return { ...je, posting_status: 'BLOCKED', block_reason: 'Closed period' };
    return { ...je, posting_status: 'POSTED', review_status: 'POSTED', posted_at: now, audit_trail: [...(je.audit_trail || []), auditTrail(je.je_id, 'approved'), auditTrail(je.je_id, 'posted')] };
  });
}

export function projectToGeneralLedger(journalEntries = []) {
  return journalEntries.flatMap(je => je.posting_status === 'POSTED' ? je.lines.map((lineItem, index) => ({
    gl_line_id: `${je.je_id}-${index + 1}`,
    je_id: je.je_id,
    je_number: je.je_number,
    source_document_id: je.source_document_id,
    entity_id: je.entity_id,
    project_id: je.project_id,
    property_id: je.property_id,
    accounting_period: je.accounting_period,
    account_code: lineItem.account_code,
    debit_amount: money(lineItem.debit_amount),
    credit_amount: money(lineItem.credit_amount),
  })) : []);
}

export function buildTrialBalance(glLines = []) {
  const byAccount = new Map();
  glLines.forEach(lineItem => {
    const row = byAccount.get(lineItem.account_code) || { account_code: lineItem.account_code, debit_amount: 0, credit_amount: 0, net_amount: 0 };
    row.debit_amount = money(row.debit_amount + lineItem.debit_amount);
    row.credit_amount = money(row.credit_amount + lineItem.credit_amount);
    row.net_amount = money(row.debit_amount - row.credit_amount);
    byAccount.set(lineItem.account_code, row);
  });
  const rows = [...byAccount.values()].sort((a, b) => a.account_code.localeCompare(b.account_code));
  const total_debit = money(rows.reduce((sum, row) => sum + row.debit_amount, 0));
  const total_credit = money(rows.reduce((sum, row) => sum + row.credit_amount, 0));
  return { rows, total_debit, total_credit, balanced: Math.abs(total_debit - total_credit) < 0.005 };
}

export async function runWbsAccountingMockPipeline(connector = createWbsMockConnector()) {
  const snapshot = await connector.fetchSnapshot();
  const events = buildAccountingEvents(snapshot);
  const findings = runDeterministicAccountingRules(snapshot, events);
  const suggestedJEs = findings.map(finding => finding.suggested_je).filter(Boolean);
  const insuranceInvoice = snapshot.payableInvoices.find(invoice => invoice.coverage_start && invoice.coverage_end);
  const amortizationSchedule = createAmortizationScheduleFromInsurance(insuranceInvoice);
  const postedJEs = approveAndPostSuggestedJEs({ suggestedJEs: [suggestedJEs.find(je => je.ai_rule_id === 'LOAN_DRAW_RECOGNITION')].filter(Boolean), periods: snapshot.accountingPeriods });
  const glLines = projectToGeneralLedger([...snapshot.journalEntries, ...postedJEs]);
  const trialBalance = buildTrialBalance(glLines);
  return { snapshot, events, findings, suggestedJEs, amortizationSchedule, postedJEs, glLines, trialBalance };
}
