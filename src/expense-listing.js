export function filterExpenseEvidence(bills = [], { transactionType = 'ALL', dateRange = 'LAST_12_MONTHS', status = 'ALL', query = '', fromDate = '', toDate = '', vendorId = 'ALL', categoryCode = 'ALL' } = {}) {
  const dateFloor = dateRange === 'THIS_MONTH' ? '2026-07-01' : dateRange === 'LAST_12_MONTHS' ? '2025-08-01' : '';
  const normalizedQuery = query.trim().toLowerCase();
  return bills.filter(bill => {
    const isLocalPayment = bill.status === 'PAID' && !!bill.pay_je_number;
    if (transactionType === 'BILL_PAYMENTS' && !isLocalPayment) return false;
    if (transactionType === 'BILLS' && isLocalPayment) return false;
    if (dateFloor && bill.bill_date < dateFloor) return false;
    if (fromDate && bill.bill_date < fromDate) return false;
    if (toDate && bill.bill_date > toDate) return false;
    if (status !== 'ALL' && bill.status !== status) return false;
    if (vendorId !== 'ALL' && String(bill.vendor_id) !== String(vendorId)) return false;
    if (categoryCode !== 'ALL' && bill.account_code !== categoryCode) return false;
    return !normalizedQuery || `${bill.bill_no} ${bill.vendor_name || ''} ${bill.invoice_no || ''}`.toLowerCase().includes(normalizedQuery);
  });
}

export const LOCAL_EXPENSE_COLUMN_KEYS = ['DATE', 'TYPE', 'NUMBER', 'PAYEE', 'CATEGORY', 'DUE_DATE', 'TOTAL', 'BILL_APPROVAL', 'LOCAL_PROOF'];
// The fixed evidence view keeps the due date visible. It is an accounting
// control field, not a personalizable QBO-style saved column preference.
export const DEFAULT_EXPENSE_COLUMNS = { DATE:true, TYPE:true, NUMBER:true, PAYEE:true, CATEGORY:true, DUE_DATE:true, TOTAL:true, BILL_APPROVAL:true, LOCAL_PROOF:true };

export function normalizeExpenseColumnVisibility(candidate = {}) {
  return LOCAL_EXPENSE_COLUMN_KEYS.reduce((result, key) => ({ ...result, [key]: typeof candidate[key] === 'boolean' ? candidate[key] : DEFAULT_EXPENSE_COLUMNS[key] }), {});
}
