// Navigation-only AP Aging scope; never computes or changes an aging balance.
export function localApAgingReturnContext({ vendorId = 'ALL', asOfDate = '', agingBucket = 'ALL' } = {}) {
  return { route:'ap', tab:'AP Aging', vendorId:String(vendorId || 'ALL'), asOfDate:String(asOfDate || ''), agingBucket:String(agingBucket || 'ALL') };
}

export function localApAgingReturnScopeLabel(context = {}) {
  return `Retained AP Aging scope · vendor ${context.vendorId || 'ALL'} · ${context.agingBucket || 'ALL'} · as of ${context.asOfDate || '—'}`;
}
