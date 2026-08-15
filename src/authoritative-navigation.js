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
    item('ai-je-workbench', 'AI JE Workbench'),
  ]),
  group('Accounting Settings', [
    item('settings', 'Core settings'), item('rules', 'Rule Center'), item('mapping', 'Mapping Center'),
  ]),
  group('Source & Staging', [
    item('wbs-payable-review', 'WBS Payable Review', 'API_READ', [
      'Only server-derived, signed and admitted WBS Payables may enter the review queue.',
      'Attachment binding, independent review and the separate AP Draft step preserve exact receipt and object-version evidence.',
    ]),
    item('staging', 'Accounting Staging', 'API_UNAVAILABLE', [
      'Your finance administrator needs to activate the approved incoming-data connection for this company.',
      'The connection must provide reviewed accounting items and their supporting documents before this workspace can be used.',
    ]),
    item('source-documents', 'Source Documents', 'API_READ', [
      'Entity-scoped source-document list and immutable detail endpoints.',
      'Separate authorised attachment-read contract; upload and finalise endpoints are not a document reader.',
    ]),
    item('integration-hub', 'Integration Hub', 'API_UNAVAILABLE', [
      'Connect the approved source systems for this company and confirm read access for the finance team.',
      'Once verified, this workspace will show connection status and document history. It will not change source data.',
    ]),
    item('mapping-exceptions', 'Mapping Exceptions', 'API_UNAVAILABLE', [
      'Approve this company’s accounting mappings and the review process for exceptions.',
      'Once ready, finance users can review exceptions alongside their supporting evidence.',
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
  group('Reports', [item('reports', 'Financial statements', 'API_READ')]),
  group('Administration', [
    item('master-data', 'Master Data'), item('bank-accounts', 'Bank Accounts'),
    item('audit-log', 'Audit Log'), item('users-settings', 'Users & settings'),
  ]),
]);

export const AUTHORITATIVE_ROUTES = Object.freeze(AUTHORITATIVE_NAVIGATION.flatMap(entry => entry.items.map(item => item.route)));
export const AUTHORITATIVE_API_ROUTES = Object.freeze(AUTHORITATIVE_NAVIGATION.flatMap(entry => entry.items.filter(item => item.availability === 'API_READ').map(item => item.route)));
export const navigationItemForRoute = route => AUTHORITATIVE_NAVIGATION.flatMap(entry => entry.items).find(item => item.route === route) || null;
