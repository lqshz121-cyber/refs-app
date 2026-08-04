const amount = value => +(value || 0);
const EPSILON = 0.005;

const cashImpact = (journal, accountCode) => (journal?.lines || [])
  .filter(line => line.account_code === accountCode)
  .reduce((total, line) => total + amount(line.debit_amount) - amount(line.credit_amount), 0);

const receiptKind = journal => {
  const codes = new Set((journal?.lines || []).map(line => line.account_code));
  if (codes.has('120200')) return 'AR_RECEIPT_CANDIDATE';
  if (codes.has('225000')) return 'PREPAYMENT_CANDIDATE';
  return 'CASH_CREDIT_REVIEW';
};

// Review evidence only: no candidate here matches, allocates, posts, or clears
// a bank item. Exact local JE evidence is deliberately kept distinct from a
// bank-match decision and from a reconciliation clearing state.
export function localUnidentifiedReceiptEvidence({ bankTransactions = [], journals = [], invoices = [], bankAccounts = [] } = {}) {
  return bankTransactions
    .filter(transaction => transaction?.direction === 'CREDIT' && transaction?.match_status !== 'MATCHED' && transaction?.ui_status !== 'Excluded')
    .map(transaction => {
      const master = bankAccounts.find(account => account.bank_account_code === transaction.bank_account_code) || null;
      const scope = master?.cash_scope || null;
      const candidates = master ? journals.filter(journal => journal.posting_status === 'POSTED'
        && journal.entity_id === master.entity_id
        && Math.abs(cashImpact(journal, master.gl_account_code) - amount(transaction.amount)) < EPSILON
        && ['AR_RECEIPT_CANDIDATE', 'PREPAYMENT_CANDIDATE'].includes(receiptKind(journal))) : [];
      const candidate = candidates.length === 1 ? candidates[0] : null;
      const invoice = candidate ? invoices.find(row => row.pay_je_number === candidate.je_number) || null : null;
      const workflowState = !master ? 'UNMATCHED'
        : scope !== 'Operating' ? 'HELD_AS_UNAPPLIED'
        : candidates.length === 1 ? 'INVESTIGATING'
        : 'HELD_AS_UNAPPLIED';
      const state = !master ? 'MISSING_BANK_MASTER_REVIEW'
        : scope !== 'Operating' ? 'HELD_NON_OPERATING_CASH_SCOPE'
        : candidates.length > 1 ? 'AMBIGUOUS_LOCAL_RECEIPT_REVIEW'
        : candidate ? 'EXACT_LOCAL_RECEIPT_CANDIDATE_REVIEW'
        : 'UNIDENTIFIED_CREDIT_REVIEW';
      return {
        bankTransaction: transaction,
        master,
        candidate,
        invoice,
        candidateCount: candidates.length,
        receiptKind: candidate ? receiptKind(candidate) : null,
        workflowState,
        state,
        entityId: master?.entity_id || null,
        cashScope: scope,
        propertyId: candidate?.property_id || null,
        projectId: candidate?.project_id || null,
        counterparty: candidate?.payee || invoice?.customer_name || null,
      };
    });
}

export const localUnidentifiedReceiptView = (rows = [], view = 'All') => rows.filter(row => view === 'All'
  || (view === 'Investigating' && row.workflowState === 'INVESTIGATING')
  || (view === 'Held as unapplied' && row.workflowState === 'HELD_AS_UNAPPLIED'));
