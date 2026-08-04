// A local nested-detail return marker only; it never applies or changes credit.
export function localVendorCreditLinkedBillReturn(creditKey) {
  return creditKey == null || creditKey === '' ? null : String(creditKey);
}

export function localVendorCreditJournalReturnContext(creditKey) {
  const key = localVendorCreditLinkedBillReturn(creditKey);
  return key ? {route:'ap', tab:'Bills', creditKey:key} : null;
}

export function localVendorCreditReturnScopeLabel(context = {}) {
  return `Retained Vendor Credit scope · ${context.creditKey || 'unselected credit'}`;
}
