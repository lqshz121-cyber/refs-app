const codeOf = value => String(value || '');

export function localCashAccountGroup(accountCode) {
  const code = codeOf(accountCode);
  if (code === '110100' || code === '111000') return 'Operating';
  if (code.startsWith('112')) return 'Escrow';
  if (code.startsWith('113')) return 'Restricted';
  if (code.startsWith('117')) return 'Security deposit';
  if (code.startsWith('118')) return 'Payroll restricted';
  return null;
}

export const isOperatingCashAccount = accountCode => localCashAccountGroup(accountCode) === 'Operating';

export function localCashAccountRows(journals = [], { entityId = null, toPeriod = '' } = {}) {
  const byAccount = new Map();
  journals.filter(journal => journal.posting_status === 'POSTED'
    && (!entityId || journal.entity_id === entityId)
    && (!toPeriod || journal.period_code <= toPeriod)).forEach(journal => (journal.lines || []).forEach(line => {
    const group = localCashAccountGroup(line.account_code);
    if (!group) return;
    const current = byAccount.get(line.account_code) || { account_code:line.account_code, group, balance:0, posted_je_count:0, journal_numbers:new Set() };
    current.balance += (line.debit_amount || 0) - (line.credit_amount || 0);
    current.journal_numbers.add(journal.je_number);
    current.posted_je_count = current.journal_numbers.size;
    byAccount.set(line.account_code, current);
  }));
  return [...byAccount.values()].map(row => ({...row, journal_numbers:[...row.journal_numbers]})).sort((a,b)=>a.account_code.localeCompare(b.account_code));
}

export function localBankEvidenceForCashGroup(group, bankAccounts = [], entityId = null) {
  const type = group === 'Escrow' ? 'ESCROW' : group === 'Operating' ? 'OPERATING' : null;
  if (!type) return { state:'UNMAPPED', label:'No local bank-account mapping retained' };
  const matches = bankAccounts.filter(account => account.account_type === type && (!entityId || account.entity_id === entityId));
  return matches.length ? { state:'LOCAL_MASTER_ONLY', label:matches.map(account=>account.bank_account_code).join(', ') } : { state:'UNMAPPED', label:'No local bank account retained' };
}
