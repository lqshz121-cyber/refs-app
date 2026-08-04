export function localGLDrillState(lines = [], label = 'Selected accounts', fromPeriod = '', toPeriod = '') {
  const count = lines.length;
  const period = [fromPeriod, toPeriod].filter(Boolean).join(' to ');
  return {
    count,
    isEmpty: count === 0,
    emptyLabel: `No posted local activity for ${label}${period ? ` in ${period}` : ''}.`,
  };
}

// Statement totals provide account-code strings while TB rows provide account
// objects. Keep both forms in the selected detail scope instead of falling
// back to an unscoped/global report.
export function localGLDrillAccountCodes(rows = []) {
  return [...new Set((rows || []).map(row => typeof row === 'string' ? row : row?.account_code).filter(Boolean))];
}

// A report-line balance is derived only from the same scoped POSTED opening
// evidence and the sorted in-period lines. It never infers a balance for an
// account that is not represented in the supplied evidence set.
export function localGLRunningBalanceRows(lines = [], openingByAccount = new Map()) {
  const balances = new Map(openingByAccount);
  return [...lines]
    .sort((a,b)=>String(a.acct).localeCompare(String(b.acct)) || String(a.date).localeCompare(String(b.date)) || String(a.je).localeCompare(String(b.je)) || (a.lineIndex || 0) - (b.lineIndex || 0))
    .map(line => {
      const runningBalance = (balances.get(line.acct) || 0) + Number(line.dr || 0) - Number(line.cr || 0);
      balances.set(line.acct, runningBalance);
      return {...line, runningBalance};
    });
}
