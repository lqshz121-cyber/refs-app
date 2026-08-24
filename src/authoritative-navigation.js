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
    item('settings', 'Core settings'), item('mapping', 'Mapping Center'),
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
    item('integration-hub', 'WBS Data Import', 'API_READ', [
      'Read production WBS Payables, Bank, AutoRec and Journal evidence for one explicit company and date scope.',
      'The controlled H1 test import remains server-authorised, TEST ONLY, company-scoped and fully auditable.',
    ]),
    item('mapping-exceptions', 'Mapping Exceptions', 'API_UNAVAILABLE', [
      'Entity- and period-scoped exception read model with mapping version, reason, and retained audit evidence.',
      'A reviewed resolution command must be separately authorised and versioned.',
    ]),
  ]),
  group('Auto Reconciliation', [
    item('bank-batch-pipeline', 'Bank Batch Pipeline', 'API_READ'),
    item('wbs-autorec-evidence', 'WBS AutoRec evidence', 'API_READ'),
    item('bank', 'Bank transactions', 'API_READ'),
    item('reconciliation', 'Reconcile', 'API_READ'),
    item('rules', 'Rules'),
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
    item('fixed-assets', 'Fixed Assets'),
    // The authoritative reader is prepaid rollforward evidence only; it does
    // not manufacture a legacy amortization schedule or posting workflow.
    item('amortization', 'Amortization Center', 'API_READ'),
    item('accruals', 'Accrual Center'),
  ]),
  group('Close', [item('month-end-close', 'Month-End Close'), item('period-management', 'Period Management')]),
  group('Payables & Receivables', [
    item('payables', 'Bills & expenses', 'API_READ'), item('receivables', 'Invoices & receipts', 'API_READ'),
  ]),
  group('Reports & Analytics', [item('reports', 'Standard reports', 'API_READ'),item('accounting-analysis-report', 'Accounting Analysis Report', 'API_READ')]),
  group('Administration', [
    item('master-data', 'Master Data'), item('bank-accounts', 'Bank Accounts'),
    item('audit-log', 'Audit Log'), item('users-settings', 'Users & settings'),
  ]),
]);

export const AUTHORITATIVE_ROUTES = Object.freeze(AUTHORITATIVE_NAVIGATION.flatMap(entry => entry.items.map(item => item.route)));
export const AUTHORITATIVE_API_ROUTES = Object.freeze(AUTHORITATIVE_NAVIGATION.flatMap(entry => entry.items.filter(item => item.availability === 'API_READ').map(item => item.route)));
export const navigationItemForRoute = route => AUTHORITATIVE_NAVIGATION.flatMap(entry => entry.items).find(item => item.route === route) || null;
