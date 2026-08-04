export function filterLocalVendors(vendors = [], query = '') {
  const needle = query.trim().toLowerCase();
  return !needle ? vendors : vendors.filter(vendor => `${vendor.vendor_code || ''} ${vendor.vendor_name || ''}`.toLowerCase().includes(needle));
}

export function localVendorOpenBalance(bills = [], vendorId) {
  return bills
    .filter(bill => bill.vendor_id === vendorId && !['PAID', 'VOID'].includes(bill.status))
    .reduce((total, bill) => total + Number(bill.amount || 0), 0);
}

export function localVendorWorkflowTarget(vendorId, tab = 'Bills') {
  if (vendorId == null || vendorId === '') return null;
  return { route: 'ap', context: { route: 'ap', tab, vendorId: String(vendorId) } };
}

// Vendor master data is not itself an entity balance. This evidence keeps every
// AP/paid/1099 observation scoped to a posted local bill/payment source.
export function localVendorEvidence(vendor, bills = [], journals = [], bankTransactions = []) {
  const evidenceBills = bills.filter(bill => bill.vendor_id === vendor?.vendor_id).map(bill => ({
    bill,
    proof:localBillPaymentEvidence(bill, journals, bankTransactions),
  }));
  const open = evidenceBills.filter(row => row.bill.status === 'APPROVED' && row.proof.billState === 'VALID_POSTED_AP');
  const paid = evidenceBills.filter(row => row.bill.status === 'PAID' && row.proof.paymentState === 'VALID_POSTED_PAYMENT');
  const entityIds = [...new Set([...open, ...paid].map(row => (row.proof.apJournal || row.proof.paymentJournal)?.entity_id).filter(id => id != null))];
  const byEntity = entityIds.map(entity_id => ({
    entity_id,
    open_balance:open.filter(row => row.proof.apJournal?.entity_id === entity_id).reduce((sum, row) => sum + Number(row.bill.amount || 0), 0),
    paid_total:paid.filter(row => row.proof.paymentJournal?.entity_id === entity_id).reduce((sum, row) => sum + Number(row.bill.amount || 0), 0),
  }));
  const eligible1099Payments = paid.filter(row => vendor?.is_1099 && row.proof.bankState === 'BANK_MATCHED');
  return {
    vendor, byEntity, evidenceBills, open, paid,
    state:entityIds.length ? (entityIds.length === 1 ? 'ENTITY_SCOPED_LOCAL_VENDOR' : 'MULTI_ENTITY_VENDOR_REVIEW') : 'NO_POSTED_VENDOR_EVIDENCE',
    open_balance:byEntity.reduce((sum, row) => sum + row.open_balance, 0),
    taxState:vendor?.is_1099 ? (eligible1099Payments.length ? 'POSSIBLE_1099_REVIEW' : '1099_SOURCE_OR_TAX_EVIDENCE_MISSING') : 'NOT_MARKED_FOR_1099',
    eligible1099Payments,
  };
}
import { localBillPaymentEvidence } from './bill-payment-evidence.js';
