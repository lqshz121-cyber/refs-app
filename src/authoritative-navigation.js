// This catalog mirrors the product's complete workspace taxonomy without
// importing the legacy demonstration shell.  A route is marked API_READ only
// when the authoritative client has a corresponding signed-in read workspace.
// Everything else remains discoverable but explicitly fails closed as an
// unavailable read model; it never receives seed, repo, or browser state.
const item = (route, label, availability = 'API_UNAVAILABLE', requirements = []) => Object.freeze({
  route,
  label,
  availability,
  requirements: Object.freeze(requirements),
});
const group = (label, items) => Object.freeze({ label, items: Object.freeze(items) });

export const AUTHORITATIVE_NAVIGATION = Object.freeze([
  group('Control Center', [
    item('overview', 'Dashboard', 'API_READ'),
    item('approvals', 'Action required'),
    item('ai-audit', 'AI Audit Center', 'API_READ'),
    item('ai-je-workbench', 'AI JE Workbench', 'API_READ', [
      'Only immutable amortization proposal lines with exact source and proposal hashes may be selected.',
      'A separately authorized human maker may create a MANUAL Draft; submit, review, approve, and post remain separate Journal Entry actions.',
    ]),
  ]),
  group('Accounting Settings', [
    item('settings', 'Core settings'),
    item('rules', 'Rules', 'API_UNAVAILABLE', [
      'Entity-scoped immutable rule identity, revision, priority, conditions, mapping actions, status, usage, and audit evidence.',
      'Read-only Bank and Integration rule lists, filters, paging, detail, and history; creation, editing, reordering, copying, enablement, automatic categorisation, matching, and posting remain unavailable.',
    ]),
    item('mapping', 'Mapping Center'),
  ]),
  group('Source & Staging', [
    item('wbs-payable-review', 'WBS Payable Review', 'API_READ', [
      'Only server-derived, signed and admitted WBS Payables may enter the review queue.',
      'Attachment binding, independent review and the separate AP Draft step preserve exact receipt and object-version evidence.',
    ]),
    item('staging', 'Accounting Staging', 'API_UNAVAILABLE', [
      'Entity-scoped persisted staging items with immutable receipt, source version, mapping version, and review state.',
      'Read-only list and detail endpoints before any controller workflow can be exposed.',
    ]),
    item('source-documents', 'Source Documents', 'API_READ', [
      'Entity-scoped source-document list and immutable detail endpoints.',
      'Separate authorised attachment-read contract; upload and finalise endpoints are not a document reader.',
    ]),
    item('receipts', 'Receipts', 'API_UNAVAILABLE', [
      'Entity-scoped receipt queue with immutable receipt, attachment object/version, content hash, creator, review status, and extracted accounting facts.',
      'Read-only For review and Reviewed list/detail endpoints; upload, OCR, review mutation, add-to-books, export, customize, and payment promotion remain unavailable.',
    ]),
    item('integration-hub', 'Integration transactions', 'API_UNAVAILABLE', [
      'The REFS Integration Hub requires read-only connector health, immutable receipt, source-version, and retained transaction evidence scoped to this entity.',
      'No provider connection, synchronisation, import, refresh, or transaction command is shown until a server-authorised contract exists.',
    ]),
    item('mapping-exceptions', 'Mapping Exceptions', 'API_UNAVAILABLE', [
      'Entity- and period-scoped exception read model with mapping version, reason, and retained audit evidence.',
      'A reviewed resolution command must be separately authorised and versioned.',
    ]),
  ]),
  group('Auto Reconciliation', [
    item('bank-batch-pipeline', 'Bank Batch Pipeline', 'API_READ'),
    item('wbs-autorec-evidence', 'WBS AutoRec evidence', 'API_READ'),
    item('bank', 'Bank transaction matching', 'API_READ'),
    item('reconciliation', 'Reconciliation worksheet', 'API_READ'),
    item('checks-payments', 'Checks & payments'),
  ]),
  group('Journal Entry', [item('journals', 'Journal entries', 'API_READ')]),
  group('General Ledger', [
    item('general-ledger', 'General Ledger', 'API_READ'),
    // Consolidation is an evidence reader only. It cannot create eliminations
    // or substitute a legacy browser-side consolidation workbook.
    item('consolidation', 'Consolidation', 'API_READ'),
    item('account-inquiry', 'Account inquiry', 'API_READ'), item('subsidiary-ledger', 'Subsidiary ledger'),
    item('chart-of-accounts', 'Chart of accounts', 'API_READ'),
  ]),
  group('Accounting Operations', [
    // This is an authenticated report-evidence workspace, not the legacy
    // project-cost register. Cost-code and vendor registers remain unavailable
    // until their own server read contracts exist.
    item('project-cost-cwip', 'Project Cost & CWIP', 'API_READ'), item('unit-cost-ledger', 'Unit Cost Ledger', 'API_READ'),
    item('unit-transfer', 'Unit Transfer'),
    // Existing OIDC report readers expose only mapping-backed rollforward
    // evidence. The loan register and lender workflow remain unavailable.
    item('construction-loan', 'Construction Loan', 'API_READ'),
    item('loan-register', 'Loan Register'), item('property-ops-pickup', 'Property Ops Pickup', 'API_READ'),
    item('closing-accounting', 'Closing Accounting'),
    // The available scope is the existing two-entity reconciliation reader;
    // it does not expose an uncontracted intercompany posting workflow.
    item('intercompany', 'Intercompany', 'API_READ'),
    item('recurring-transactions', 'Recurring transactions', 'API_UNAVAILABLE', [
      'Entity-scoped recurring-template rows with immutable template identity, revision, type, interval, dates, counterparty, currency, amount, and status.',
      'Read-only filter, paging, and detail endpoints; template lifecycle, reminder execution, recurring payment management, and accounting commands remain unavailable.',
    ]),
    item('revenue-recognition', 'Revenue recognition', 'API_UNAVAILABLE', [
      'Entity- and period-scoped recognition schedules with immutable source, schedule revision, dates, accounts, currency, amount, status, Journal, ledger, and audit identifiers.',
      'Read-only list, detail, and report endpoints; settings, rule changes, schedule creation, automatic Journal generation, and posting remain unavailable.',
    ]),
    item('fixed-assets', 'Fixed assets', 'API_UNAVAILABLE', [
      'Entity-scoped fixed-asset register rows with immutable asset identity/revision, dates, cost, residual value, method/life, accumulated depreciation, net book value, status, accounts, source, Journal, ledger, and audit identifiers.',
      'Read-only list, detail, and report endpoints; asset creation, bulk import, edits, depreciation generation, disposal, and posting remain unavailable.',
    ]),
    // QBO calls this surface Prepaid expenses. REFS keeps its stronger
    // Amortization Center controls behind that familiar accounting label.
    item('amortization', 'Prepaid expenses', 'API_READ'),
    item('accruals', 'Accrual Center'),
  ]),
  group('Close', [item('month-end-close', 'Month-End Close'), item('period-management', 'Period Management')]),
  group('Payables & Receivables', [
    item('payables', 'Bills & expenses', 'API_READ'),
    item('vendors', 'Vendors', 'API_UNAVAILABLE', [
      'Entity-scoped vendor master rows with immutable vendor identity, company, contact, tax-status, and open-balance facts.',
      'Read-only search, paging, and detail endpoints; vendor creation, bill creation, payment, email, print, export, and tax actions remain unavailable.',
    ]),
    item('bill-payments', 'Bill payments', 'API_UNAVAILABLE', [
      'Entity- and period-scoped retained Bill Payment evidence with immutable Bill, payment, Journal, ledger, and audit identifiers.',
      'Read-only list and detail endpoints; payment initiation, approval, void, release, and external money movement remain unavailable.',
    ]),
    item('contractors', 'Contractors', 'API_UNAVAILABLE', [
      'Permission-scoped contractor identity, W-9 status, and retained payment evidence with immutable source and audit identifiers.',
      'Read-only search, status, paging, and detail endpoints; invitations, setup, direct deposit, bulk pay, 1099 filing, and tax actions remain unavailable.',
    ]),
    item('1099s', '1099s', 'API_UNAVAILABLE', [
      'Tax-permission-scoped filing-year snapshots with immutable recipient, W-9, form, filing, correction, and audit identifiers.',
      'Read-only recipient and completed-form endpoints; preparation, autofill, import, e-file, correction, download, print, mail, and export remain unavailable.',
    ]),
    item('receivables', 'Invoices & receipts', 'API_READ'),
  ]),
  group('Reports', [item('reports', 'Standard reports', 'API_READ'),item('accounting-analysis-report', 'Accounting Analysis Report', 'API_READ')]),
  group('Administration', [
    item('master-data', 'Master Data'), item('bank-accounts', 'Bank Accounts'),
    item('audit-log', 'Audit Log', 'API_UNAVAILABLE', [
      'Permission-scoped, entity-bound audit events with immutable event identity, timestamp, actor, event type, target identity/revision, correlation, and history facts.',
      'Read-only user, date, event, search, paging, and history-detail endpoints; settings, print, export, provider calls, and accounting mutations remain unavailable.',
    ]), item('users-settings', 'Users & settings'),
  ]),
]);

export const AUTHORITATIVE_ROUTES = Object.freeze(AUTHORITATIVE_NAVIGATION.flatMap(entry => entry.items.map(item => item.route)));
export const AUTHORITATIVE_API_ROUTES = Object.freeze(AUTHORITATIVE_NAVIGATION.flatMap(entry => entry.items.filter(item => item.availability === 'API_READ').map(item => item.route)));
export const navigationItemForRoute = route => AUTHORITATIVE_NAVIGATION.flatMap(entry => entry.items).find(item => item.route === route) || null;
