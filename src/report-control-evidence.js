import { statements, trialBalance } from './engine.js';
import { localCashAccountGroup, localCashAccountRows } from './cash-account-scope.js';

const near = (left, right) => Math.abs(left - right) < 0.005;

// Computes report controls from the caller's already scoped POSTED evidence.
// It intentionally has no access to feeds, external balances, or the posting
// kernel, so every signal is local and reproducible from the report’s JEs.
export function localReportControlEvidence({ periodJournals = [], asOfJournals = [], entityId = null, toPeriod = '', cashFlow = null } = {}) {
  const tb = trialBalance(periodJournals);
  const bsTb = trialBalance(asOfJournals);
  const bs = statements(asOfJournals);
  const tbBalanced = near(tb.totalDebit, tb.totalCredit);
  const bsBalanced = near(bs.assets, bs.liabilities + bs.equity + bs.netIncome);
  const glBalances = new Map();
  periodJournals.forEach(journal => (journal.lines || []).forEach(line => {
    const code = line.account_code;
    glBalances.set(code, (glBalances.get(code) || 0) + (line.debit_amount || 0) - (line.credit_amount || 0));
  }));
  const tbByAccount = new Map(tb.rows.map(row => [row.account_code, row.balance]));
  const glTbTied = [...new Set([...glBalances.keys(), ...tbByAccount.keys()])].every(code => near(glBalances.get(code) || 0, tbByAccount.get(code) || 0));
  const cashRows = localCashAccountRows(asOfJournals, { entityId, toPeriod });
  const cashGroups = ['Operating', 'Escrow', 'Restricted', 'Security deposit', 'Payroll restricted'].map(group => ({
    group, amount:cashRows.filter(row => row.group === group).reduce((sum, row) => sum + row.balance, 0), accounts:cashRows.filter(row => row.group === group).map(row => row.account_code),
  }));
  const totalCash = cashGroups.reduce((sum, row) => sum + row.amount, 0);
  const operatingCash = cashGroups.find(row => row.group === 'Operating')?.amount || 0;
  const restrictedCash = totalCash - operatingCash;
  const bsCash = bsTb.rows.filter(row => localCashAccountGroup(row.account_code)).reduce((sum, row) => sum + row.balance, 0);
  const cashGroupsTied = near(totalCash, bsCash);
  const cashFlowOperatingTied = !cashFlow || near(cashFlow.closingCash, operatingCash);
  return { tb, bsTb, bs, tbBalanced, bsBalanced, glTbTied, cashRows, cashGroups, totalCash, operatingCash, restrictedCash, bsCash, cashGroupsTied, cashFlowOperatingTied };
}
