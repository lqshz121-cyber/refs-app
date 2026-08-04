// QBO labels observed on the Bills page. The mapping below is deliberately
// local-only because QBO queue membership semantics were not exercised.
export const LOCAL_BILL_QUEUE_VIEWS = ['For review', 'Unpaid', 'Paid'];

export function filterLocalBillQueue(bills = [], view = 'All') {
  const allowed = {
    'For review': ['PENDING_APPROVAL'],
    Unpaid: ['DRAFT', 'APPROVED'],
    Paid: ['PAID'],
  }[view];
  return allowed ? bills.filter(bill => allowed.includes(bill.status)) : bills;
}
