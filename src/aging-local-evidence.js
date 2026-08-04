import { localInvoiceReceiptEvidence } from './invoice-receipt-evidence.js';
import { localBillPaymentEvidence } from './bill-payment-evidence.js';
import { localBillAppliedPaymentEvidence } from './vendor-credit-evidence.js';
import { localInvoiceReceiptBalanceEvidence } from './customer-receipt-reversal-evidence.js';

export const LOCAL_AGING_BUCKETS = Object.freeze(['Current', '1-30', '31-60', '61-90', '90+']);
const amount = value => Number(value || 0);

export function localAgingBucket(dueDate, asOfDate) {
  const due = new Date(`${dueDate || ''}T00:00:00`);
  const asOf = new Date(`${asOfDate || ''}T00:00:00`);
  const days = Math.floor((asOf - due) / 86400000);
  if (!Number.isFinite(days) || days <= 0) return 'Current';
  if (days <= 30) return '1-30';
  if (days <= 60) return '31-60';
  if (days <= 90) return '61-90';
  return '90+';
}

const dimensionsFor = journal => {
  const lines = journal?.lines || [];
  const values = key => [...new Set(lines.map(line => line[key]).filter(value => value != null))];
  return { property_ids:values('property_id'), project_ids:values('project_id') };
};

// Report-only proof gate. No balance is inferred from a payment that is absent
// from the retained object model: an OPEN row is the object’s outstanding full
// amount, while partial allocation remains an explicit unsupported gap.
export function localArAgingEvidence(invoice, journals = [], bankTransactions = [], asOfDate) {
  const evidence = localInvoiceReceiptEvidence(invoice, journals, bankTransactions);
  const eligible = invoice?.status === 'OPEN' && evidence.sourceState === 'VALID_POSTED_AR_SOURCE';
  const receiptBalance = localInvoiceReceiptBalanceEvidence(invoice, journals, asOfDate, bankTransactions);
  const outstandingAmount = eligible ? Math.max(0, amount(invoice.amount) - receiptBalance.receivedAmount) : 0;
  return {
    ...invoice, evidence, aging_bucket:localAgingBucket(invoice?.due_date, asOfDate),
    received_amount:receiptBalance.receivedAmount, receipt_evidence:receiptBalance,
    outstanding_amount:outstandingAmount,
    aging_state:eligible ? (receiptBalance.receivedAmount ? 'VALID_OPEN_POSTED_AR_RECEIPT_APPLIED' : 'VALID_OPEN_POSTED_AR') : (invoice?.status !== 'OPEN' ? 'NOT_OPEN' : evidence.sourceState),
    included:eligible && outstandingAmount > 0, dimensions:dimensionsFor(evidence.sourceJournal),
  };
}

export function localApAgingEvidence(bill, journals = [], bankTransactions = [], asOfDate, vendorCredits = []) {
  const evidence = localBillPaymentEvidence(bill, journals, bankTransactions);
  const eligible = bill?.status === 'APPROVED' && evidence.billState === 'VALID_POSTED_AP';
  const paymentBalance = localBillAppliedPaymentEvidence(bill, journals, asOfDate, bankTransactions);
  const appliedCredits = vendorCredits.filter(credit => credit.canReduceAging && credit.bill?.bill_id === bill?.bill_id && (!asOfDate || (credit.journal?.je_date && credit.journal.je_date <= asOfDate)));
  const appliedCreditAmount = appliedCredits.reduce((total, credit) => total + amount(credit.applicationAmount), 0);
  const outstandingAmount = eligible ? Math.max(0, amount(bill.amount) - paymentBalance.paidAmount - appliedCreditAmount) : 0;
  return {
    ...bill, evidence, aging_bucket:localAgingBucket(bill?.due_date, asOfDate),
    outstanding_amount:outstandingAmount,
    paid_amount:paymentBalance.paidAmount, payment_evidence:paymentBalance,
    applied_credit_amount:appliedCreditAmount,
    applied_credits:appliedCredits,
    aging_state:eligible ? (appliedCreditAmount ? 'VALID_OPEN_POSTED_AP_CREDIT_APPLIED' : 'VALID_OPEN_POSTED_AP') : (bill?.status === 'PAID' || bill?.status === 'VOID' ? 'NOT_OPEN' : evidence.billState),
    included:eligible && outstandingAmount > 0, dimensions:dimensionsFor(evidence.apJournal),
  };
}

export const localArAgingEvidenceRows = (invoices, journals, bankTransactions, asOfDate) =>
  (invoices || []).map(invoice => localArAgingEvidence(invoice, journals, bankTransactions, asOfDate));
export const localApAgingEvidenceRows = (bills, journals, bankTransactions, asOfDate, vendorCredits = []) =>
  (bills || []).map(bill => localApAgingEvidence(bill, journals, bankTransactions, asOfDate, vendorCredits));

export function localAgingControl(rows = [], accountCode) {
  const detailTotal = rows.filter(row => row.included).reduce((sum, row) => sum + amount(row.outstanding_amount), 0);
  const sourceControlTotal = rows.filter(row => row.included).reduce((sum, row) => {
    const journal = row.evidence?.sourceJournal || row.evidence?.apJournal;
    return sum + (journal?.lines || []).filter(line => line.account_code === accountCode).reduce((lineSum, line) => lineSum + amount(line.debit_amount || line.credit_amount), 0);
  }, 0);
  return { detailTotal, sourceControlTotal, state:Math.abs(detailTotal - sourceControlTotal) < 0.005 ? 'LOCAL_CONTROL_TIED' : 'LOCAL_CONTROL_DIFFERENCE' };
}

// Reconciles the open-document aging view to the retained posted GL control
// account. It does not create an adjustment or hide an unexplained variance.
export function localAgingGlReconciliation({ rows = [], journals = [], accountCode, entityId = null, asOfDate = '', normalSide = 'DEBIT' } = {}) {
  const detailTotal = rows.filter(row => row.included).reduce((sum,row) => sum + amount(row.outstanding_amount), 0);
  const sourceControlTotal = rows.filter(row => row.included).reduce((sum,row) => {
    const journal = row.evidence?.sourceJournal || row.evidence?.apJournal;
    const control = (journal?.lines || []).filter(line => line.account_code === accountCode).reduce((lineSum,line) => lineSum + (normalSide === 'CREDIT' ? amount(line.credit_amount) - amount(line.debit_amount) : amount(line.debit_amount) - amount(line.credit_amount)), 0);
    return sum + control;
  }, 0);
  const postedControlTotal = journals.filter(journal => journal.posting_status === 'POSTED'
    && (!entityId || journal.entity_id === entityId)
    && (!asOfDate || journal.je_date <= asOfDate))
    .reduce((sum,journal) => sum + (journal.lines || []).filter(line => line.account_code === accountCode).reduce((lineSum,line) => lineSum + (normalSide === 'CREDIT' ? amount(line.credit_amount) - amount(line.debit_amount) : amount(line.debit_amount) - amount(line.credit_amount)), 0), 0);
  const sourceDifference = +(detailTotal - sourceControlTotal).toFixed(2);
  const glDifference = +(detailTotal - postedControlTotal).toFixed(2);
  const differenceRows = [
    { key:'AGING_TO_SOURCE', label:'Aging detail less retained source-control evidence', amount:sourceDifference, state:Math.abs(sourceDifference) < 0.005 ? 'TIED' : 'REVIEW' },
    { key:'AGING_TO_GL', label:'Aging detail less same-scope posted GL control', amount:glDifference, state:Math.abs(glDifference) < 0.005 ? 'TIED' : 'REVIEW' },
  ];
  const state = differenceRows.every(row => row.state === 'TIED') ? 'LOCAL_AGING_GL_TIED' : 'LOCAL_AGING_GL_DIFFERENCE';
  return { detailTotal, sourceControlTotal, postedControlTotal, sourceDifference, glDifference, differenceRows, state };
}

// Evidence-only classifier for a control-account variance. It does not
// generate a balancing entry or decide a source classification; every item
// retains the supporting local journal/aging row for a controller drill.
export function localAgingControlDifferenceEvidence({ reportType, rows = [], allRows = [], journals = [], accountCode, entityId = null, asOfDate = '', normalSide = 'DEBIT' } = {}) {
  const reconciliation = localAgingGlReconciliation({rows,journals,accountCode,entityId,asOfDate,normalSide});
  const represented = new Set(allRows.flatMap(row => [row.evidence?.sourceJournal?.je_number, row.evidence?.apJournal?.je_number, ...(row.payment_evidence?.rows || []).map(item => item.journal?.je_number), ...(row.receipt_evidence?.rows || []).map(item => item.journal?.je_number)].filter(Boolean)));
  const controlAmount = journal => (journal.lines || []).filter(line => line.account_code === accountCode).reduce((sum,line) => sum + (normalSide === 'CREDIT' ? amount(line.credit_amount)-amount(line.debit_amount) : amount(line.debit_amount)-amount(line.credit_amount)),0);
  const journalRows = journals.filter(journal => journal.posting_status === 'POSTED' && (!entityId || journal.entity_id === entityId) && (!asOfDate || journal.je_date <= asOfDate) && (journal.lines || []).some(line => line.account_code === accountCode) && !represented.has(journal.je_number) && ['MAN','MANUAL','UNKNOWN'].includes(String(journal.source_system || '').toUpperCase()))
    .map(journal => ({key:`JE:${journal.je_number}`,category:'POSTED_CONTROL_UNMODELED',amount:controlAmount(journal),journal,entityId:journal.entity_id,reason:'Posted control-account JE is not represented by retained local document/payment evidence.'}));
  const lifecycleRows = allRows.flatMap(row => {
    const evidence = row.payment_evidence || row.receipt_evidence;
    if (!evidence?.state?.endsWith('_BANK_REVIEW')) return [];
    return [{key:`BANK:${reportType}:${row.bill_id || row.inv_id}`,category:'BANK_MATCHED_REVERSAL_REVIEW',amount:0,journal:evidence.rows?.find(item=>item.exactReversal)?.exactReversal || null,entityId:row.evidence?.apJournal?.entity_id || row.evidence?.sourceJournal?.entity_id || null,reason:`${evidence.state}; original matched bank evidence is retained and requires bank/reconcile review.`}];
  });
  const differenceRows = reconciliation.differenceRows.filter(row => row.state === 'REVIEW').map(row => ({key:`TOTAL:${row.key}`,category:row.key,amount:row.amount,journal:null,entityId,reason:row.label}));
  const issues = [...differenceRows,...journalRows,...lifecycleRows];
  return {reconciliation,issues,state:issues.length ? 'LOCAL_CONTROL_REVIEW' : 'LOCAL_CONTROL_TIED'};
}

// A report-level bridge keeps AP/AR aging and the GL/TB control accounts on
// exactly the same retained entity, cutoff, and property/project scope. It is
// deliberately read-only: the result is a controller review list, never an
// adjusting entry or an inferred allocation.
export function localAgingGlTbBridgeEvidence({ apRows = [], arRows = [], journals = [], entityId = null, asOfDate = '', propertyId = 'ALL', projectId = 'ALL' } = {}) {
  const wantedProperty = String(propertyId || 'ALL');
  const wantedProject = String(projectId || 'ALL');
  const rowInScope = row => {
    const journal = row?.evidence?.sourceJournal || row?.evidence?.apJournal;
    if (entityId && journal?.entity_id !== entityId) return false;
    const dimensions = row?.dimensions || dimensionsFor(journal);
    if (wantedProperty !== 'ALL' && !dimensions.property_ids.map(String).includes(wantedProperty)) return false;
    if (wantedProject !== 'ALL' && !dimensions.project_ids.map(String).includes(wantedProject)) return false;
    return true;
  };
  const apScopeRows = apRows.filter(rowInScope);
  const arScopeRows = arRows.filter(rowInScope);
  const ap = localAgingControlDifferenceEvidence({reportType:'AP',rows:apScopeRows,allRows:apScopeRows,journals,accountCode:'291001',entityId,asOfDate,normalSide:'CREDIT'});
  const ar = localAgingControlDifferenceEvidence({reportType:'AR',rows:arScopeRows,allRows:arScopeRows,journals,accountCode:'120200',entityId,asOfDate,normalSide:'DEBIT'});
  const issues = [...ap.issues.map(row=>({...row,reportType:'AP'})),...ar.issues.map(row=>({...row,reportType:'AR'}))];
  return {
    scope:{entityId,asOfDate,propertyId:wantedProperty,projectId:wantedProject},
    ap, ar, issues,
    state:issues.length ? 'LOCAL_GL_TB_AGING_REVIEW' : 'LOCAL_GL_TB_AGING_TIED',
  };
}
