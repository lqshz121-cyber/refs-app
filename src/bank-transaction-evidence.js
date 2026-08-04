import { localCashAccountGroup } from './cash-account-scope.js';

const EPSILON = 0.005;
const cashImpactFor = (journal, accountCode) => (journal?.lines || [])
  .filter(line => line.account_code === accountCode)
  .reduce((total, line) => total + (line.debit_amount || 0) - (line.credit_amount || 0), 0);

const expectedCash = transaction => transaction?.direction === 'CREDIT'
  ? Number(transaction.amount || 0)
  : -Number(transaction?.amount || 0);

// Evidence only: this neither creates a JE nor changes a bank transaction. A
// "matched" label is withheld until a retained local JE proves the same
// entity, cash account, direction, and amount.
export function localBankTransactionEvidence(transaction, journals = [], bankAccounts = []) {
  const master = bankAccounts.find(account => account.bank_account_code === transaction?.bank_account_code) || null;
  if (transaction?.ui_status === 'Excluded') return { transaction, master, journal:null, state:'EXCLUDED_NEEDS_AUDIT_REASON', queue:'Excluded', canDrill:false, label:'Excluded — retain rationale/audit evidence' };
  if (transaction?.match_status !== 'MATCHED') return { transaction, master, journal:null, state:'PENDING_REVIEW', queue:'Review', canDrill:false, label:'Pending review — no local posted match' };
  if (!master) return { transaction, master:null, journal:null, state:'BANK_ACCOUNT_MASTER_MISSING', queue:'Review', canDrill:false, label:'Pending review — local bank-account master missing' };
  const candidates = journals.filter(journal => journal.je_number === transaction.matched_je);
  if (candidates.length !== 1) return { transaction, master, journal:null, state:candidates.length ? 'AMBIGUOUS_JE_REFERENCE' : 'MATCHED_JE_MISSING', queue:'Review', canDrill:false, label:'Pending review — retained JE reference is not unique' };
  const journal = candidates[0];
  if (journal.posting_status !== 'POSTED') return { transaction, master, journal, state:'MATCHED_JE_NOT_POSTED', queue:'Review', canDrill:false, label:'Pending review — referenced JE is not posted' };
  if (journal.entity_id !== master.entity_id) return { transaction, master, journal, state:'CROSS_ENTITY_JE', queue:'Review', canDrill:false, label:'Pending review — JE entity differs from bank account' };
  const actualCash = cashImpactFor(journal, master.gl_account_code);
  if (Math.abs(actualCash) < EPSILON) return { transaction, master, journal, state:'CASH_ACCOUNT_MISMATCH', queue:'Review', canDrill:false, label:`Pending review — JE does not move ${master.gl_account_code}` };
  if (Math.abs(actualCash - expectedCash(transaction)) >= EPSILON) return { transaction, master, journal, state:'CASH_DIRECTION_OR_AMOUNT_MISMATCH', queue:'Review', canDrill:false, label:'Pending review — JE cash direction or amount differs' };
  return { transaction, master, journal, state:'VALID_LOCAL_MATCH', queue:'Posted', canDrill:true, cashImpact:actualCash, dateVariance:journal.je_date !== transaction.txn_date, cashScope:master.cash_scope || localCashAccountGroup(master.gl_account_code), label:journal.je_date === transaction.txn_date ? 'Posted — exact local proof' : 'Posted — local proof; date variance shown' };
}

export const localBankTransactionEvidenceRows = (transactions, journals, bankAccounts) =>
  (transactions || []).map(transaction => localBankTransactionEvidence(transaction, journals, bankAccounts));
