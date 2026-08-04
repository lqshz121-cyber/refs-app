// Local AP drill contract. It only resolves existing REFS bill evidence and
// never creates a transaction or invokes the QBO service.
export function findBillForApDrill(bills = [], context = {}) {
  if (!context || typeof context !== 'object') return null;
  return bills.find(bill =>
    (context.billId != null && bill.bill_id === context.billId) ||
    (context.billNo && bill.bill_no === context.billNo) ||
    (context.jeNumber && (bill.je_number === context.jeNumber || bill.pay_je_number === context.jeNumber))
  ) || null;
}
