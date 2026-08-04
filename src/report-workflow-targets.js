const LOCAL_REPORT_WORKFLOW_TARGETS = Object.freeze({
  'AP Aging': Object.freeze({ route: 'ap', context: Object.freeze({ route: 'ap', tab: 'Aging' }) }),
  'Accounts receivable aging summary': Object.freeze({ route: 'ar', context: Object.freeze({ route: 'ar', tab: 'AR Aging' }) }),
  'Reconciliation History': Object.freeze({ route: 'bankrec', context: Object.freeze({ route: 'bankrec' }) }),
});

export function localReportWorkflowTarget(name) {
  return LOCAL_REPORT_WORKFLOW_TARGETS[String(name || '')] || null;
}

const LOCAL_LEDGER_REPORTS = new Set(['Trial Balance', 'General Ledger', 'Balance Sheet', 'Income Statement', 'Profit and Loss', 'Cash Flow', 'Cost General Ledger']);
const LOCAL_PREVIEW_REPORTS = new Set(['Property Operating Statement', 'Construction Loan Rollforward', 'Manual JE Report', 'Exception Aging']);

// A capability marker for the Reports Center. Reference-only names may remain
// visible as observed QBO IA, but never become a ready/drillable local report.
export function localReportCapability(name) {
  const reportName = String(name || '');
  if (localReportWorkflowTarget(reportName)) return { state:'LOCAL_WORKFLOW', label:'Local workflow' };
  if (LOCAL_LEDGER_REPORTS.has(reportName)) return { state:'LOCAL_LEDGER', label:'Local ledger workflow' };
  if (LOCAL_PREVIEW_REPORTS.has(reportName)) return { state:'LOCAL_PREVIEW', label:'Local preview — no source drill' };
  return { state:'REFERENCE_ONLY', label:'Reference only — unavailable' };
}
