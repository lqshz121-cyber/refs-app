export const REPORT_BUSINESS_SCOPE = Object.freeze({
  included: Object.freeze([
    'Financial statements and local GL/TB drill-down',
    'Expense, payables, receivables, bank, and reconciliation controls',
    'Property and project cost-control reporting',
  ]),
  referenceOnly: Object.freeze([
    'QuickBooks report-center navigation and empty-state shells',
    'QuickBooks custom, management, KPI, and dashboard information architecture',
  ]),
  excluded: Object.freeze([
    'Amazon, marketplace, and sales-channel connectors',
    'External app connections and data-source linking',
    'Spreadsheet Sync, Excel/Google Sheets two-way sync, and bulk sync',
    'Multi-company spreadsheet reporting and sales-performance dashboards',
    'Custom report creation, customization, sharing, distribution, and email/print/export delivery',
    'Automated KPIs, narrative insights, report notes, and management-report actions',
  ]),
});

export function isReportCapabilityExcluded(label) {
  const normalized = String(label || '').toLowerCase();
  return ['spreadsheet sync', 'sales performance', 'connect data source', 'excel', 'google sheets', 'multi-company', 'marketplace', 'amazon', 'create new report', 'custom report creation', 'customize', 'report sharing', 'report delivery', 'kpi', 'narrative insight', 'report notes', 'management-report action'].some(term => normalized.includes(term));
}
