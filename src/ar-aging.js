export const DEFAULT_AR_AGING_AS_OF = '2026-07-31';
export const AR_AGING_BUCKETS = Object.freeze(['Current', '1-30', '31-60', '61-90', '90+']);

export function isOpenLocalReceivable(invoice) {
  return Boolean(invoice) && String(invoice.status || '').toUpperCase() === 'OPEN';
}

export function localArAgingBucket(invoice, asOf = DEFAULT_AR_AGING_AS_OF) {
  const daysPastDue = Math.floor((new Date(`${asOf}T00:00:00`) - new Date(`${invoice.due_date}T00:00:00`)) / 86400000);
  if (!Number.isFinite(daysPastDue) || daysPastDue <= 0) return 'Current';
  if (daysPastDue <= 30) return '1-30';
  if (daysPastDue <= 60) return '31-60';
  if (daysPastDue <= 90) return '61-90';
  return '90+';
}

export function localArAgingRows(invoices = [], asOf = DEFAULT_AR_AGING_AS_OF) {
  return invoices.filter(isOpenLocalReceivable).map(invoice => ({ ...invoice, aging_bucket: localArAgingBucket(invoice, asOf) }));
}
