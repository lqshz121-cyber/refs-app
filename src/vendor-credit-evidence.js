const amount = value => Number(value || 0);
const AP_CONTROL = '291001';
const dimensionsFor = journal => {
  const values = key => [...new Set((journal?.lines || []).map(line => line[key]).filter(value => value != null))];
  return {propertyIds:values('property_id'), projectIds:values('project_id')};
};
const scopesConflict = (left = [], right = []) => left.length > 0 && right.length > 0 && !left.some(value => right.includes(value));
const isCapitalOrPrepaid = journal => (journal?.lines || []).some(line => /^(164|141)/.test(String(line.account_code || '')));
const apDebitFor = journal => (journal?.lines || []).filter(line => line.account_code === AP_CONTROL)
  .reduce((total, line) => total + amount(line.debit_amount), 0);
const cashCreditFor = journal => (journal?.lines || []).filter(line => line.account_code === '111000')
  .reduce((total, line) => total + amount(line.credit_amount), 0);
const apCreditFor = journal => (journal?.lines || []).filter(line => line.account_code === AP_CONTROL)
  .reduce((total, line) => total + amount(line.credit_amount), 0);
const cashDebitFor = journal => (journal?.lines || []).filter(line => line.account_code === '111000')
  .reduce((total, line) => total + amount(line.debit_amount), 0);
const reverses = (journal, target) => journal?.je_type === 'REVERSAL' && ((journal.history || []).some(item => String(item.a || '').includes(`REVERSAL of ${target}`)) || String(journal.description || '').includes(target) || journal.reversal_of === target);

// Retained local payment proof for balance calculations. A bank match is a
// valuable audit signal, but not a prerequisite for a posted AP payment to
// reduce the bill balance. This never posts, matches, or changes a payment.
export function localBillAppliedPaymentEvidence(bill, journals = [], asOfDate = '', bankTransactions = []) {
  const refs = [...new Set([bill?.pay_je_number, ...(bill?.payment_je_numbers || [])].filter(Boolean))];
  const rows = refs.map(ref => journals.find(journal => journal.je_number === ref)).filter(Boolean).map(journal => {
    const apAmount = apDebitFor(journal);
    const cashAmount = cashCreditFor(journal);
    const sameEntity = Number(journal.entity_id) === Number(bill?.entity_id);
    const sameVendor = (!journal.vendor_id && !journal.payee) || (journal.vendor_id != null && String(journal.vendor_id) === String(bill?.vendor_id)) || (journal.payee && String(journal.payee) === String(bill?.vendor_name));
    const withinCutoff = !asOfDate || !journal.je_date || journal.je_date <= asOfDate;
    const valid = journal.posting_status === 'POSTED' && sameEntity && sameVendor && withinCutoff && apAmount > 0 && apAmount <= amount(bill?.amount) && (cashAmount === 0 || Math.abs(cashAmount - apAmount) < 0.005);
    const reversals = journals.filter(candidate => candidate.posting_status === 'POSTED' && reverses(candidate, journal.je_number));
    const effectiveReversals = reversals.filter(candidate => !asOfDate || (candidate.je_date && candidate.je_date <= asOfDate));
    const exactReversal = effectiveReversals.find(candidate => candidate.entity_id === journal.entity_id && Math.abs(apCreditFor(candidate) - apAmount) < 0.005 && (cashDebitFor(candidate) === 0 || Math.abs(cashDebitFor(candidate) - apAmount) < 0.005)) || null;
    const bankLinks = bankTransactions.filter(transaction => transaction.match_status === 'MATCHED' && transaction.matched_je === journal.je_number);
    const signedBankLink = bankLinks.some(transaction => transaction.reconcile_state === 'SIGNED_OFF' || transaction.signed_off === true);
    const reversalBlocked = !!exactReversal && (bankLinks.length > 0 || signedBankLink);
    return {journal,apAmount,cashAmount,sameEntity,sameVendor,withinCutoff,valid,reversals,effectiveReversals,exactReversal,bankLinks,signedBankLink,reversalBlocked};
  });
  const paidAmount = Math.min(amount(bill?.amount), rows.filter(row => row.valid && (!row.exactReversal || row.reversalBlocked)).reduce((total,row) => total + row.apAmount, 0));
  const state = rows.length === 0 ? 'NO_RETAINED_PAYMENT'
    : rows.some(row => row.reversalBlocked) ? 'PAYMENT_REVERSAL_BANK_REVIEW'
    : rows.some(row => row.exactReversal) ? 'PAYMENT_REVERSED_EVIDENCE'
    : rows.every(row => row.valid) ? 'VALID_POSTED_PAYMENT_EVIDENCE' : 'PAYMENT_REVIEW';
  return {rows,paidAmount,state};
}

const apDebit = journal => (journal?.lines || []).filter(line => line.account_code === AP_CONTROL)
  .reduce((total, line) => total + amount(line.debit_amount) - amount(line.credit_amount), 0);

// Read-only proof resolver. A vendor credit is never inferred from a negative
// expense line: it needs an explicit retained AP_CREDIT journal and can only
// reduce a linked bill after the retained application states the exact amount.
export function localVendorCreditEvidence({ bills = [], journals = [], bankTransactions = [] } = {}) {
  const rows = journals.filter(journal => journal?.source_system === 'AP_CREDIT').map(journal => {
    const billRef = journal.applied_bill_no || journal.source_bill_no || journal.source_bill_id || null;
    const bill = bills.find(candidate => String(candidate.bill_no) === String(billRef) || String(candidate.bill_id) === String(billRef)) || null;
    const billJournal = journals.find(candidate => candidate.je_number === bill?.je_number) || bill?.paymentEvidence?.apJournal || null;
    const creditAmount = apDebit(journal);
    const applicationAmount = amount(journal.applied_amount || 0);
    const paymentEvidence = localBillAppliedPaymentEvidence(bill, journals, journal.je_date || '', bankTransactions);
    const creditBankLinks = bankTransactions.filter(transaction => transaction.matched_je === journal.je_number);
    const creditBankEvidence = {
      links: creditBankLinks,
      state: creditBankLinks.length === 0 ? 'NO_RETAINED_BANK_LINK'
        : creditBankLinks.some(transaction => transaction.reconcile_state === 'SIGNED_OFF' || transaction.signed_off === true) ? 'MATCHED_BANK_SIGNED_OFF'
        : creditBankLinks.some(transaction => transaction.cleared === true) ? 'MATCHED_BANK_CLEARED'
        : 'MATCHED_BANK_REVIEW',
    };
    const unpaidAfterPayments = Math.max(0, amount(bill?.amount) - paymentEvidence.paidAmount);
    const sameEntity = !!bill && Number(journal.entity_id) === Number(bill.entity_id);
    const sameVendor = !bill || (!journal.vendor_id && !journal.payee) || (journal.vendor_id != null && String(journal.vendor_id) === String(bill.vendor_id)) || (journal.payee && String(journal.payee) === String(bill.vendor_name));
    const creditDimensions = dimensionsFor(journal);
    const billDimensions = dimensionsFor(billJournal);
    const dimensionMismatch = scopesConflict(creditDimensions.propertyIds, billDimensions.propertyIds) || scopesConflict(creditDimensions.projectIds, billDimensions.projectIds);
    const capitalSourceMissing = (isCapitalOrPrepaid(journal) || isCapitalOrPrepaid(billJournal)) && !(journal.source_doc_id || journal.original_source_doc_id);
    const relatedPartyReview = !!journal.related_party && !(journal.related_party_reason && journal.approval_history?.length);
    const sourcePosted = journal.posting_status === 'POSTED';
    const openBill = bill && !['PAID', 'VOID'].includes(bill.status);
    const applicationValid = applicationAmount > 0 && applicationAmount <= creditAmount && applicationAmount <= unpaidAfterPayments;
    const state = !sourcePosted ? 'CREDIT_REVIEW_NOT_POSTED'
      : creditAmount <= 0 ? 'CREDIT_REVIEW_AP_DIRECTION'
      : !billRef ? 'POSTED_UNAPPLIED_CREDIT'
      : !bill ? 'CREDIT_REVIEW_BILL_NOT_RETAINED'
      : !sameEntity ? 'CREDIT_REVIEW_CROSS_ENTITY'
      : !sameVendor ? 'CREDIT_REVIEW_VENDOR_MISMATCH'
      : dimensionMismatch ? 'CREDIT_REVIEW_PROPERTY_PROJECT_MISMATCH'
      : capitalSourceMissing ? 'CREDIT_REVIEW_CAPITAL_OR_PREPAID_SOURCE'
      : relatedPartyReview ? 'CREDIT_REVIEW_RELATED_PARTY_AUDIT'
      : !openBill ? 'CREDIT_REVIEW_BILL_NOT_OPEN'
      : applicationAmount === 0 ? 'POSTED_UNAPPLIED_CREDIT'
      : !applicationValid ? 'CREDIT_REVIEW_APPLICATION_LIMIT'
      : 'APPLIED_CREDIT_EVIDENCE';
    return {
      journal, bill, billRef, creditAmount, applicationAmount, billJournal, creditDimensions, billDimensions, paymentEvidence, creditBankEvidence, unpaidAfterPayments,
      auditState: journal.posting_status === 'POSTED' && journal.history?.length ? 'POSTED_AUDIT_RETAINED' : 'AUDIT_HISTORY_REVIEW',
      unappliedAmount: state === 'APPLIED_CREDIT_EVIDENCE' ? creditAmount - applicationAmount : creditAmount,
      state,
      canReduceAging: state === 'APPLIED_CREDIT_EVIDENCE',
      entityId: journal.entity_id || null,
    };
  });
  return rows.map(row => {
    if (!row.canReduceAging) return row;
    const applicationTotal = rows.filter(candidate => candidate.canReduceAging && candidate.bill?.bill_id === row.bill?.bill_id)
      .reduce((total, candidate) => total + candidate.applicationAmount, 0);
    if (applicationTotal > row.unpaidAfterPayments) return {...row, applicationTotal, state:'CREDIT_REVIEW_APPLICATION_LIMIT', canReduceAging:false};
    return {...row, applicationTotal};
  });
}
