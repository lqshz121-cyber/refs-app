import { acct } from './engine.js';
import { localCashAccountGroup } from './cash-account-scope.js';

const value = (line, key) => line?.[key] || 0;
const normalSignFor = accountCode => ['ASSET', 'EXPENSE'].includes(acct(accountCode).account_type) ? 1 : -1;

export function localAccountRegisterOpeningBalance(journals = [], { entityId = null, accountCode, fromPeriod = '' } = {}) {
  if (!accountCode || !fromPeriod) return 0;
  const movement = journals
    .filter(journal => journal.posting_status === 'POSTED' && (!entityId || journal.entity_id === entityId) && journal.period_code < fromPeriod)
    .reduce((total, journal) => total + (journal.lines || []).filter(line => line.account_code === accountCode).reduce((lineTotal, line) => lineTotal + value(line, 'debit_amount') - value(line, 'credit_amount'), 0), 0);
  return +(normalSignFor(accountCode) * movement).toFixed(2);
}

export function localAccountRegisterEntries(journals = [], { entityId = null, accountCode, fromPeriod = '', throughPeriod = '' } = {}) {
  const normalSign = normalSignFor(accountCode);
  const openingBalance = localAccountRegisterOpeningBalance(journals, {entityId,accountCode,fromPeriod});
  const entries = journals
    .filter(journal => journal.posting_status === 'POSTED' && (!entityId || journal.entity_id === entityId) && (!fromPeriod || journal.period_code >= fromPeriod) && (!throughPeriod || journal.period_code <= throughPeriod))
    .flatMap(journal => (journal.lines || []).map((line, lineIndex) => ({ journal, line, lineIndex })))
    .filter(({ line }) => line.account_code === accountCode)
    .sort((left, right) => left.journal.je_date.localeCompare(right.journal.je_date) || String(left.journal.je_number).localeCompare(String(right.journal.je_number)) || left.lineIndex - right.lineIndex)
    .map(({ journal, line, lineIndex }) => ({
      id: `${journal.je_number}:${lineIndex}`, date:journal.je_date, period:journal.period_code, ref:journal.je_number, journal, line,
      source:journal.source_system || 'LOCAL_JE', transactionType:journal.je_type || 'JOURNAL_ENTRY',
      counterparty:journal.payee || journal.vendor_name || journal.customer_name || '', memo:line.description || journal.description || '',
      debit:value(line, 'debit_amount'), credit:value(line, 'credit_amount'),
    }));
  let runningBalance = openingBalance;
  return entries.map(entry => {
    runningBalance += normalSign * (entry.debit - entry.credit);
    return { ...entry, runningBalance:+runningBalance.toFixed(2) };
  });
}

export function localRegisterBankEvidence(journal, bankAccounts = {}, { bankAccountMaster = [], entityId = null, cashAccountCode = null } = {}) {
  const hits = Object.entries(bankAccounts).flatMap(([accountCode, account]) => (account.txns || []).filter(txn => txn.matched_je === journal?.je_number).map(txn => ({ accountCode, txn })));
  const inScopeHits = hits.filter(hit => {
    const master = bankAccountMaster.find(row => row.bank_account_code === hit.accountCode);
    return master && (!entityId || master.entity_id === entityId) && (!cashAccountCode || master.gl_account_code === cashAccountCode);
  });
  if (hits.length && !inScopeHits.length && (entityId || cashAccountCode)) return { state:'OUT_OF_SCOPE_BANK_EVIDENCE', label:'Bank evidence belongs to a different local entity or cash account' };
  const scopedHits = (entityId || cashAccountCode) ? inScopeHits : hits;
  const matched = scopedHits.filter(hit => hit.txn.match_status === 'MATCHED');
  if (matched.length) return { state:'LOCAL_MATCHED', label:matched.map(hit => hit.accountCode + ' / ' + (hit.txn.external_id || hit.txn.bank_txn_id)).join(', ') };
  if (scopedHits.length) return { state:'LOCAL_UNMATCHED', label:'Local bank item exists but is not matched' };
  return { state:'NO_LOCAL_BANK_EVIDENCE', label:'No local bank-match evidence' };
}

// Supplemental IDs for a reconciliation-history display. Keep this separate
// from localRegisterBankEvidence so its stable public evidence contract stays
// unchanged for existing register consumers.
export function localRegisterBankEvidenceTransactions(journal, bankAccounts = {}, { bankAccountMaster = [], entityId = null, cashAccountCode = null } = {}) {
  const hits = Object.entries(bankAccounts).flatMap(([accountCode, account]) => (account.txns || []).filter(txn => txn.matched_je === journal?.je_number).map(txn => ({accountCode, txn})));
  const scopedHits = hits.filter(hit => {
    const master = bankAccountMaster.find(row => row.bank_account_code === hit.accountCode);
    return master && (!entityId || master.entity_id === entityId) && (!cashAccountCode || master.gl_account_code === cashAccountCode);
  });
  return {
    bankTxnIds:scopedHits.map(hit => String(hit.txn.bank_txn_id || hit.txn.external_id || '')).filter(Boolean),
    clearedBankTxnIds:scopedHits.filter(hit => hit.txn.cleared).map(hit => String(hit.txn.bank_txn_id || hit.txn.external_id || '')).filter(Boolean),
  };
}

export function localRegisterScope(accountCode) { return localCashAccountGroup(accountCode) || 'Non-cash account'; }
export function localRegisterEndingBalance(entries = []) { return entries.length ? entries[entries.length - 1].runningBalance : 0; }

// QBO can expose View register more broadly. REFS limits that surface to
// retained local cash scopes so every row can carry a same-entity bank/reconcile
// boundary; AR/AP, CWIP, fixed assets, prepaids, equity and P&L stay in GL.
export function localRegisterAccountOptions(accounts = []) {
  return (accounts || []).filter(account => Boolean(localCashAccountGroup(account.account_code)));
}

export function localCashRegisterScope({ entityId = null, accountCode, bankAccountMaster = [] } = {}) {
  if (!entityId) return { state:'ENTITY_REQUIRED', master:null };
  const masters = bankAccountMaster.filter(row => row.entity_id === entityId && row.gl_account_code === accountCode);
  if (!masters.length) return { state:'MISSING_LOCAL_BANK_MAPPING', master:null };
  if (masters.length > 1) return { state:'MULTIPLE_BANK_MAPPINGS_REVIEW', master:null };
  return { state:'LOCAL_CASH_REGISTER', master:masters[0] };
}
