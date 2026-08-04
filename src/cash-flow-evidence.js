import { isOperatingCashAccount, localCashAccountGroup } from './cash-account-scope.js';

const amount = line => (line.debit_amount || 0) - (line.credit_amount || 0);
const isCash = line => isOperatingCashAccount(line.account_code);

export function buildLocalCashFlow({ openingJournals = [], periodJournals = [] } = {}) {
  const cashAccounts = new Set();
  const scopeMovement = new Map();
  const scopeOpening = new Map();
  const addScope = (target, line) => {
    const scope = localCashAccountGroup(line.account_code);
    if (!scope) return;
    target.set(scope, (target.get(scope) || 0) + amount(line));
  };
  const cashFor = journals => journals.reduce((total, journal) => total + (journal.lines || []).filter(isCash).reduce((sum, line) => {
    cashAccounts.add(line.account_code);
    return sum + amount(line);
  }, 0), 0);
  openingJournals.forEach(journal => (journal.lines || []).forEach(line => addScope(scopeOpening, line)));
  periodJournals.forEach(journal => (journal.lines || []).forEach(line => addScope(scopeMovement, line)));
  const openingCash = cashFor(openingJournals);
  const entries = periodJournals.flatMap(journal => {
    const cashLines = (journal.lines || []).filter(isCash);
    if (!cashLines.length) return [];
    const otherCodes = (journal.lines || []).filter(line => !isCash(line)).map(line => String(line.account_code || ''));
    const source = String(journal.source_system || '').toUpperCase();
    let category = null;
    let issue = null;
    if (otherCodes.some(code => code.startsWith('291'))) issue = 'Intercompany cash needs a close-policy classification.';
    else if (otherCodes.some(code => /^(26|27|28|38)/.test(code))) category = 'Financing';
    else if (otherCodes.some(code => /^(15|16|17|18)/.test(code))) category = 'Investing';
    else if (source === 'PM' || otherCodes.some(code => /^(12|22|4|5|6|7)/.test(code))) category = 'Operating';
    else issue = 'Cash entry has no retained local operating, investing, or financing classification.';
    return [{ je:journal.je_number, date:journal.je_date, source, netCash:cashLines.reduce((sum, line) => sum + amount(line), 0), category, issue }];
  });
  const totalFor = category => entries.filter(entry => entry.category === category).reduce((total, entry) => total + entry.netCash, 0);
  const periodCash = entries.reduce((total, entry) => total + entry.netCash, 0);
  const operating = totalFor('Operating');
  const investing = totalFor('Investing');
  const financing = totalFor('Financing');
  const classifiedChange = operating + investing + financing;
  const closingCash = openingCash + periodCash;
  const scopes = [...new Set([...scopeOpening.keys(), ...scopeMovement.keys()])].sort().map(scope => ({
    scope,
    openingCash:scopeOpening.get(scope) || 0,
    movement:scopeMovement.get(scope) || 0,
    closingCash:(scopeOpening.get(scope) || 0) + (scopeMovement.get(scope) || 0),
  }));
  const totalOpeningCash = scopes.reduce((total, row) => total + row.openingCash, 0);
  const totalClosingCash = scopes.reduce((total, row) => total + row.closingCash, 0);
  return {
    cashAccounts:[...cashAccounts].sort(), openingCash, closingCash, operating, investing, financing,
    classifiedChange, unclassified:entries.filter(entry => !entry.category), entries,
    reconciliationDifference: closingCash - (openingCash + classifiedChange),
    scopes, totalOpeningCash, totalClosingCash,
  };
}
