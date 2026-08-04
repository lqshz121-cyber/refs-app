// Report-center launch context is evidence-only navigation state. It never
// changes an AP/AR document, allocation, period, or local ledger.
export function localReportWorkflowContext(target, reportName) {
  if (!target?.route || !target?.context) return null;
  return {
    ...target.context,
    reportCenterReturn: { route: 'reports', reportName: String(reportName || '') },
  };
}
