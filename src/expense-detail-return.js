// A detail replaces the local Expenses list. Freeze only user-visible local
// scope so Back can restore it without creating or mutating accounting data.
export function localExpenseDetailReturnScope(scope = {}) {
  return Object.freeze({
    tab:scope.tab || 'Bills',
    query:scope.query || '',
    statusFilter:scope.statusFilter || 'ALL',
    transactionType:scope.transactionType || 'ALL',
    dateRange:scope.dateRange || 'LAST_12_MONTHS',
    fromDate:scope.fromDate || '',
    toDate:scope.toDate || '',
    vendorId:scope.vendorId || 'ALL',
    categoryCode:scope.categoryCode || 'ALL',
    billQueueView:scope.billQueueView || 'All',
  });
}
