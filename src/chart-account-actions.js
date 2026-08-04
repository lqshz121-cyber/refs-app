// Maps the observed QBO account-list action shape onto REFS's existing local
// detail surfaces. It does not create, edit, or change account state.
import { localCashAccountGroup } from './cash-account-scope.js';

export function chartAccountScope(accountCode) {
  return localCashAccountGroup(accountCode) || 'Non-cash';
}

export function chartAccountControlState(accountCode) {
  if (accountCode === '120200') return 'AR control';
  if (accountCode === '291001') return 'AP control';
  return chartAccountScope(accountCode) === 'Non-cash' ? 'No cash control' : 'Cash scope control';
}

export function chartAccountDrill(account) {
  // The QBO shell can expose a register for broader balance-sheet classes,
  // but this real-estate workspace only has a retained, entity-safe register
  // for locally classified cash. AR/AP and every non-cash balance-sheet
  // account stay in scoped GL Detail so we never imply a bank/register view
  // that cannot be evidenced locally.
  if (localCashAccountGroup(account?.account_code)) {
    return { label: 'View register', route: 'register', context: { route: 'register', accountCode: account.account_code } };
  }
  return { label: 'Run report', route: 'gl', context: { route: 'gl', tab: 'GL Detail', drillAccounts: [account?.account_code], drillLabel: `${account?.account_code || ''} ${account?.account_name || ''}`.trim() } };
}
