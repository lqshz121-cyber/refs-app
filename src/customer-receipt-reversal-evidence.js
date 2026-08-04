const amount = value => Number(value || 0);
const total = (journal, accountCode, field) => (journal?.lines || []).filter(line => line.account_code === accountCode)
  .reduce((sum,line) => sum + amount(line[field]), 0);
const dimensionsFor = journal => {
  const values = key => [...new Set((journal?.lines || []).map(line => line[key]).filter(value => value != null))];
  return {propertyIds:values('property_id'), projectIds:values('project_id')};
};
const mismatch = (left = [], right = []) => left.length > 0 && right.length > 0 && !left.some(value => right.includes(value));
const reverses = (journal, target) => journal?.je_type === 'REVERSAL' && ((journal.history || []).some(item => String(item.a || '').includes(`REVERSAL of ${target}`)) || String(journal.description || '').includes(target) || journal.reversal_of === target);
const restrictedReceipt = journal => (journal?.lines || []).some(line => /^(231|232|233|241)/.test(String(line.account_code || '')));

// Local-only receipt balance resolver. Deposits, prepayments, and restricted
// cash never become AR allocation merely because their bank amount matches.
export function localInvoiceReceiptBalanceEvidence(invoice, journals = [], asOfDate = '', bankTransactions = []) {
  const source = journals.find(journal => journal.je_number === invoice?.je_number) || null;
  const sourceDims = dimensionsFor(source);
  const refs = [...new Set([invoice?.pay_je_number, ...(invoice?.receipt_je_numbers || [])].filter(Boolean))];
  const rows = refs.map(ref => journals.find(journal => journal.je_number === ref)).filter(Boolean).map(journal => {
    const cashAmount = total(journal,'111000','debit_amount');
    const arAmount = total(journal,'120200','credit_amount');
    const sameEntity = Number(journal.entity_id) === Number(source?.entity_id);
    const sameCustomer = (!journal.customer_id && !journal.payee) || (journal.customer_id != null && String(journal.customer_id) === String(invoice?.customer_id)) || (journal.payee && String(journal.payee) === String(invoice?.customer_name));
    const dims = dimensionsFor(journal);
    const sameScope = !mismatch(dims.propertyIds,sourceDims.propertyIds) && !mismatch(dims.projectIds,sourceDims.projectIds);
    const withinCutoff = !asOfDate || (journal.je_date && journal.je_date <= asOfDate);
    const relatedPartyReview = !!journal.related_party && !(journal.related_party_reason && journal.approval_history?.length);
    const valid = journal.posting_status === 'POSTED' && sameEntity && sameCustomer && sameScope && withinCutoff && !restrictedReceipt(journal) && !relatedPartyReview && cashAmount > 0 && Math.abs(cashAmount-arAmount)<0.005 && cashAmount <= amount(invoice?.amount);
    const reversals = journals.filter(candidate => candidate.posting_status === 'POSTED' && reverses(candidate,journal.je_number));
    const exactReversal = reversals.find(candidate => (!asOfDate || (candidate.je_date && candidate.je_date <= asOfDate)) && candidate.entity_id === journal.entity_id && Math.abs(total(candidate,'111000','credit_amount')-cashAmount)<0.005 && Math.abs(total(candidate,'120200','debit_amount')-cashAmount)<0.005) || null;
    const bankLinks = bankTransactions.filter(transaction => transaction.match_status === 'MATCHED' && transaction.direction === 'CREDIT' && transaction.matched_je === journal.je_number);
    const reversalBlocked = !!exactReversal && bankLinks.length > 0;
    return {journal,cashAmount,arAmount,sameEntity,sameCustomer,sameScope,withinCutoff,relatedPartyReview,restricted:restrictedReceipt(journal),valid,exactReversal,bankLinks,reversalBlocked};
  });
  const receivedAmount = Math.min(amount(invoice?.amount), rows.filter(row => row.valid && (!row.exactReversal || row.reversalBlocked)).reduce((sum,row)=>sum+row.cashAmount,0));
  const state = rows.length===0 ? 'NO_RETAINED_RECEIPT'
    : rows.some(row=>row.reversalBlocked) ? 'RECEIPT_REVERSAL_BANK_REVIEW'
    : rows.some(row=>row.exactReversal) ? 'RECEIPT_REVERSED_EVIDENCE'
    : rows.every(row=>row.valid) ? 'VALID_POSTED_RECEIPT_EVIDENCE' : 'RECEIPT_REVIEW';
  return {rows,receivedAmount,state,sourceDims};
}
