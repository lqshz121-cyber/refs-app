const codeOf = row => String(row?.account_code || '');

// Presentation-only classification for same-scope posted P&L rows. It does
// not reclassify, capitalize, post, or change the account balance.
export function localIncomeStatementSection(row) {
  const code = codeOf(row);
  if (row?.type === 'REVENUE') {
    if (code.startsWith('42')) return 'Rental income';
    if (/^(44|46|48)/.test(code)) return 'Other property income';
    return 'Other income · review';
  }
  if (row?.type === 'EXPENSE') {
    if (code.startsWith('51')) return 'Cost of goods sold';
    if (code.startsWith('795')) return 'Interest and financing';
    if (code.startsWith('780')) return 'Capital / completion review';
    if (/^(60|61|62|63|64|68)/.test(code)) return 'Property operations';
    if (code.startsWith('7')) return 'General and administrative';
    return 'Other operating expense · review';
  }
  return 'Out of P&L scope';
}
