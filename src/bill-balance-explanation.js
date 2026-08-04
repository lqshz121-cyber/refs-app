import { localApAgingEvidence } from './aging-local-evidence.js';

const amount = value => Number(value || 0);

// This is a presentation-only explanation of retained evidence. It neither
// creates an application nor decides that an unproven payment/credit reduces AP.
export function localBillBalanceExplanation({ bill, journals = [], bankTransactions = [], vendorCredits = [], asOfDate = '' } = {}) {
  const aging = localApAgingEvidence(bill, journals, bankTransactions, asOfDate, vendorCredits);
  const linkedCredits = vendorCredits.filter(credit => credit.bill?.bill_id === bill?.bill_id);
  const reviewReasons = [];
  if (aging.evidence?.billState !== 'VALID_POSTED_AP') reviewReasons.push('No POSTED local AP source');
  if (aging.payment_evidence?.state === 'NO_RETAINED_PAYMENT') reviewReasons.push('No POSTED payment retained');
  if (aging.payment_evidence?.state === 'PAYMENT_REVERSED_EVIDENCE') reviewReasons.push('Payment reversal is within the as-of scope');
  if (aging.payment_evidence?.state === 'PAYMENT_REVERSAL_BANK_REVIEW') reviewReasons.push('Matched payment reversal requires Bank/Reconcile review');
  if ((aging.payment_evidence?.rows || []).some(row => !row.withinCutoff)) reviewReasons.push('A payment is outside the as-of date');
  if (linkedCredits.some(credit => !credit.canReduceAging)) reviewReasons.push('A linked credit is unapplied or requires scope review');
  if (bill?.voidEvidence?.state && bill.voidEvidence.state !== 'VOID_EVIDENCE_RETAINED') reviewReasons.push('Void/reversal evidence requires review');

  const originalAmount = amount(bill?.amount);
  const effectivePayments = Math.min(originalAmount, amount(aging.paid_amount));
  const appliedCredits = Math.min(Math.max(0, originalAmount - effectivePayments), amount(aging.applied_credit_amount));
  const openAmount = Math.max(0, originalAmount - effectivePayments - appliedCredits);
  const state = reviewReasons.length ? 'REVIEW_REQUIRED' : aging.included ? 'OPEN_AP_RETAINED' : openAmount === 0 ? 'NO_OPEN_AP_AS_OF' : 'NOT_ELIGIBLE_FOR_AGING';
  return {
    asOfDate,
    originalAmount,
    effectivePayments,
    appliedCredits,
    openAmount,
    state,
    reviewReasons,
    paymentEvidence: aging.payment_evidence,
    bankState: aging.evidence?.bankState || bill?.paymentEvidence?.bankState || 'NO_LOCAL_PAYMENT',
    sourceState: aging.evidence?.billState || 'UNVERIFIED',
    dimensions: aging.dimensions,
    linkedCredits,
  };
}
