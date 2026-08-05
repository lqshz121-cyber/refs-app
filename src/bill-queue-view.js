// QBO labels observed on the Bills page. Membership stays tied to retained
// local evidence; it never infers payment or bank clearance.
export const LOCAL_BILL_QUEUE_VIEWS = ['For review', 'Unpaid', 'Paid'];

export function filterLocalBillQueue(bills = [], view = 'For review') {
  if (view === 'For review') return bills.filter(bill => bill.status === 'PENDING_APPROVAL');
  if (view === 'Unpaid') return bills.filter(bill => bill.paymentEvidence?.billState === 'VALID_POSTED_AP' && bill.status !== 'PAID');
  if (view === 'Paid') return bills.filter(bill => bill.status === 'PAID' && bill.paymentEvidence?.paymentState === 'VALID_POSTED_PAYMENT');
  return [];
}
