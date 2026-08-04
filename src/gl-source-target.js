// Resolve only retained REFS evidence to an existing local workspace. This
// module is navigation-only and does not calculate or post accounting data.
export function localGLSourceTarget(journal, { apBills = [], arInvoices = [], bankAccounts = {}, sourceDocuments = {} } = {}) {
  if (!journal) return null;
  if (journal.source_doc_id && sourceDocuments[journal.source_doc_id]) return { route: 'sourcedocs', context: { route: 'sourcedocs', docId: journal.source_doc_id, jeNumber: journal.je_number, sourceSystem: journal.source_system } };
  const apBill = apBills.find(bill => bill.je_number === journal.je_number || bill.pay_je_number === journal.je_number);
  if (apBill) return { route: 'ap', context: { route: 'ap', tab: 'Bills', billId: apBill.bill_id, jeNumber: journal.je_number } };
  const arInvoice = arInvoices.find(invoice => invoice.je_number === journal.je_number || invoice.pay_je_number === journal.je_number);
  if (arInvoice) return { route: 'ar', context: { route: 'ar', tab: 'Invoices', invoiceId: arInvoice.inv_id, jeNumber: journal.je_number } };
  const bankHit = Object.entries(bankAccounts).flatMap(([acctCode, account]) => (account.txns || []).map(txn => ({ acctCode, txn }))).find(hit => hit.txn.matched_je === journal.je_number);
  if (bankHit) return { route: 'banktx', context: { route: 'banktx', acctCode: bankHit.acctCode, bankTxnId: bankHit.txn.bank_txn_id, jeNumber: journal.je_number } };
  if (journal.source_system === 'PM') return { route: 'pmpickup', context: { route: 'pmpickup', jeNumber: journal.je_number } };
  if (journal.source_system === 'WBS_CL' || String(journal.source_system || '').startsWith('WBS')) return { route: 'autobankrec', context: { route: 'autobankrec', jeNumber: journal.je_number } };
  return null;
}
