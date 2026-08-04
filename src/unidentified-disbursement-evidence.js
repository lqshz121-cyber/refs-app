const amount = value => +(value || 0);
const EPSILON = 0.005;

const cashImpact = (journal, accountCode) => (journal?.lines || [])
  .filter(line => line.account_code === accountCode)
  .reduce((total, line) => total + amount(line.debit_amount) - amount(line.credit_amount), 0);

const disbursementKind = journal => {
  const debitCodes = (journal?.lines || []).filter(line => amount(line.debit_amount) > EPSILON).map(line => String(line.account_code || ''));
  if (debitCodes.some(code => code.startsWith('164'))) return 'CWIP_CANDIDATE';
  if (debitCodes.some(code => /^6|^7|^78/.test(code))) return 'EXPENSE_CANDIDATE';
  if ((journal?.source_system === 'EXPA' || journal?.source_system === 'PAYABLE') && debitCodes.includes('291001')) return 'AP_PAYMENT_CANDIDATE';
  return 'CASH_DEBIT_REVIEW';
};

// Review evidence only. This never classifies, posts, matches, clears, or
// changes an AP bill/CWIP/expense. A same-amount JE stays a candidate until a
// human explicitly resolves it in a later supported workflow.
export function localUnidentifiedDisbursementEvidence({ bankTransactions = [], journals = [], bills = [], bankAccounts = [] } = {}) {
  return bankTransactions
    .filter(transaction => transaction?.direction === 'DEBIT' && transaction?.match_status !== 'MATCHED' && transaction?.ui_status !== 'Excluded')
    .map(transaction => {
      const master = bankAccounts.find(account => account.bank_account_code === transaction.bank_account_code) || null;
      const scope = master?.cash_scope || null;
      const candidates = master ? journals.filter(journal => journal.posting_status === 'POSTED'
        && journal.entity_id === master.entity_id
        && Math.abs(cashImpact(journal, master.gl_account_code) + amount(transaction.amount)) < EPSILON
        && ['AP_PAYMENT_CANDIDATE', 'EXPENSE_CANDIDATE', 'CWIP_CANDIDATE'].includes(disbursementKind(journal))) : [];
      const candidate = candidates.length === 1 ? candidates[0] : null;
      const bill = candidate ? bills.find(row => row.pay_je_number === candidate.je_number) || null : null;
      const workflowState = !master ? 'UNMATCHED'
        : scope !== 'Operating' ? 'HELD_UNEXPLAINED'
        : candidate ? 'INVESTIGATING'
        : 'HELD_UNEXPLAINED';
      const state = !master ? 'MISSING_BANK_MASTER_REVIEW'
        : scope !== 'Operating' ? 'HELD_NON_OPERATING_CASH_SCOPE'
        : candidates.length > 1 ? 'AMBIGUOUS_LOCAL_DISBURSEMENT_REVIEW'
        : candidate ? 'EXACT_LOCAL_DISBURSEMENT_CANDIDATE_REVIEW'
        : 'UNIDENTIFIED_DEBIT_REVIEW';
      return {
        bankTransaction: transaction,
        master,
        candidate,
        bill,
        candidateCount:candidates.length,
        disbursementKind:candidate ? disbursementKind(candidate) : null,
        workflowState,
        state,
        entityId:master?.entity_id || null,
        cashScope:scope,
        propertyId:candidate?.property_id || bill?.property_id || null,
        projectId:candidate?.project_id || null,
        counterparty:candidate?.payee || bill?.vendor_name || null,
      };
    });
}

export const localUnidentifiedDisbursementView = (rows = [], view = 'All') => rows.filter(row => view === 'All'
  || (view === 'Investigating' && row.workflowState === 'INVESTIGATING')
  || (view === 'Held unexplained' && row.workflowState === 'HELD_UNEXPLAINED'));
