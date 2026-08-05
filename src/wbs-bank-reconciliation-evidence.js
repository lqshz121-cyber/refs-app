import {
  buildAccountingEvents,
  createWbsMockDataset,
  runDeterministicAccountingRules,
} from './wbs-accounting-foundation.js';

const money = value => Math.round(Number(value || 0) * 100) / 100;
const abs = value => Math.abs(money(value));

export function buildWbsBankReconciliationEvidence(snapshot = createWbsMockDataset()) {
  const events = buildAccountingEvents(snapshot);
  const findings = runDeterministicAccountingRules(snapshot, events);
  const findingBySource = new Map(findings.map(finding => [finding.object_id, finding]));
  const apBySourceDoc = new Map(snapshot.payableInvoices.map(invoice => [invoice.source_document_id, invoice]));
  const bankRows = snapshot.bankTransactions.map(txn => {
    const event = events.find(item => item.source_transaction_id === txn.id);
    const finding = findingBySource.get(txn.id);
    const matchedInvoice = apBySourceDoc.get(txn.source_document_id);
    const isLoanDraw = /draw|lender|loan/i.test(txn.memo || '') || event?.event_type === 'loan_draw';
    const isMatched = txn.match_status === 'MATCHED' && Boolean(matchedInvoice);
    const missingAp = txn.direction === 'DEBIT' && txn.match_status === 'UNMATCHED' && !matchedInvoice && !isLoanDraw;
    const suggestedQueue = isLoanDraw ? 'LOAN_DRAW_REVIEW' : missingAp ? 'MISSING_AP_EXCEPTION' : isMatched ? 'EXACT_MATCH_REVIEW' : 'BANK_EXCEPTION_REVIEW';
    const controlState = isMatched ? 'MATCH_CANDIDATE_RETAINED' : isLoanDraw ? 'LOAN_DRAW_DETECTED' : missingAp ? 'AP_SOURCE_REQUIRED' : 'REVIEW_REQUIRED';
    return {
      bank_txn_id: txn.id,
      external_source_id: txn.external_source_id,
      bank_account_id: txn.bank_account_id,
      direction: txn.direction,
      amount: abs(txn.amount),
      signed_amount: money(txn.amount),
      memo: txn.memo,
      match_status: txn.match_status,
      source_document_id: txn.source_document_id,
      event_id: event?.event_id || null,
      event_type: event?.event_type || 'bank_transaction',
      rule_id: finding?.rule_id || event?.rule_id || 'BANK_MATCHED_RETAINED',
      risk_level: finding?.risk_level || (missingAp ? 'HIGH' : isLoanDraw ? 'MEDIUM' : 'LOW'),
      reason: finding?.reason || (isMatched ? 'Bank payment is matched to retained source support.' : isLoanDraw ? 'Bank credit appears to be lender draw funding.' : 'Bank transaction requires review.'),
      suggested_action: finding?.suggested_action || (isMatched ? 'Keep independent match, cleared and sign-off review.' : isLoanDraw ? 'Route to construction loan draw review before GL posting.' : 'Route to exception queue and obtain payable support.'),
      suggested_queue: suggestedQueue,
      control_state: controlState,
      matched_invoice_id: matchedInvoice?.id || null,
      can_auto_match: false,
      can_post: false,
      requires_review: !isMatched,
    };
  });
  const exceptions = bankRows.filter(row => row.suggested_queue !== 'EXACT_MATCH_REVIEW');
  return {
    mode: 'WBS_MOCK_BANK_RECONCILIATION',
    bankRows,
    exceptions,
    summary: {
      total: bankRows.length,
      matched: bankRows.filter(row => row.control_state === 'MATCH_CANDIDATE_RETAINED').length,
      missingAp: bankRows.filter(row => row.control_state === 'AP_SOURCE_REQUIRED').length,
      loanDraws: bankRows.filter(row => row.control_state === 'LOAN_DRAW_DETECTED').length,
      reviewRequired: bankRows.filter(row => row.requires_review).length,
      totalAmount: bankRows.reduce((total, row) => money(total + row.signed_amount), 0),
    },
  };
}
