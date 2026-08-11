// This catalog mirrors the product's complete workspace taxonomy without
// importing the legacy demonstration shell.  A route is marked API_READ only
// when the authoritative client has a corresponding signed-in read workspace.
// Everything else remains discoverable but explicitly fails closed as an
// unavailable read model; it never receives seed, repo, or browser state.
const item = (route, label, availability = 'API_UNAVAILABLE') => Object.freeze({ route, label, availability });
const group = (label, items) => Object.freeze({ label, items: Object.freeze(items) });

export const AUTHORITATIVE_NAVIGATION = Object.freeze([
  group('Control Center', [
    item('overview', 'Dashboard', 'API_READ'),
    item('approvals', 'Action required'),
    item('ai-audit', 'AI Audit Center'),
    item('ai-je-workbench', 'AI JE Workbench'),
  ]),
  group('Accounting Settings', [
    item('settings', 'Core settings'), item('rules', 'Rule Center'), item('mapping', 'Mapping Center'),
  ]),
  group('Source & Staging', [
    item('staging', 'Accounting Staging'), item('source-documents', 'Source Documents'),
    item('integration-hub', 'Integration Hub'), item('mapping-exceptions', 'Mapping Exceptions'),
  ]),
  group('Auto Reconciliation', [
    item('bank-batch-pipeline', 'Bank Batch Pipeline'),
    item('bank', 'Bank transaction matching', 'API_READ'),
    item('reconciliation', 'Reconciliation worksheet', 'API_READ'),
    item('checks-payments', 'Checks & payments'),
  ]),
  group('Journal Entry', [item('journals', 'Journal entries', 'API_READ')]),
  group('General Ledger', [
    item('general-ledger', 'GL / TB / BS / IS'), item('consolidation', 'Consolidation'),
    item('account-inquiry', 'Account inquiry'), item('subsidiary-ledger', 'Subsidiary ledger'),
    item('chart-of-accounts', 'Chart of accounts'),
  ]),
  group('Accounting Operations', [
    item('project-cost-cwip', 'Project Cost & CWIP'), item('unit-cost-ledger', 'Unit Cost Ledger'),
    item('unit-transfer', 'Unit Transfer'), item('construction-loan', 'Construction Loan'),
    item('loan-register', 'Loan Register'), item('property-ops-pickup', 'Property Ops Pickup'),
    item('closing-accounting', 'Closing Accounting'), item('intercompany', 'Intercompany'),
    item('fixed-assets', 'Fixed Assets'), item('amortization', 'Amortization Center'),
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
