export function filterLocalPaymentHistory(bills, { paymentDate = 'All dates', currentMonth = '2026-07' } = {}) {
  return bills.filter((bill) => {
    if (bill.status !== 'PAID') return false;
    if (paymentDate === 'All dates') return true;
    if (paymentDate === 'This month') return String(bill.paid_date || bill.bill_date || '').startsWith(currentMonth);
    return false;
  });
}

export function isLocalPaymentHistoryEmpty(bills, options) {
  return filterLocalPaymentHistory(bills, options).length === 0;
}
