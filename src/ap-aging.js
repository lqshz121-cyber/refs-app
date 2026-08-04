export const DEFAULT_AP_AGING_AS_OF = '2026-07-31';
export const AP_AGING_BUCKETS = ['Current', '1-30', '31-60', '61-90', '90+'];

export function isOpenLocalPayable(bill) {
  return !['PAID', 'VOID'].includes(bill?.status);
}

export function localApAgingBucket(bill, asOfDate = DEFAULT_AP_AGING_AS_OF) {
  const dueDate = new Date(bill?.due_date);
  const asOf = new Date(asOfDate);
  if (Number.isNaN(dueDate.valueOf()) || Number.isNaN(asOf.valueOf())) return 'Current';
  const daysPastDue = Math.floor((asOf - dueDate) / 86400000);
  return daysPastDue <= 0 ? 'Current' : daysPastDue <= 30 ? '1-30' : daysPastDue <= 60 ? '31-60' : daysPastDue <= 90 ? '61-90' : '90+';
}

export function localApAgingRows(bills = [], asOfDate = DEFAULT_AP_AGING_AS_OF) {
  return bills.filter(isOpenLocalPayable).map(bill => ({...bill, aging_bucket:localApAgingBucket(bill, asOfDate)}));
}
