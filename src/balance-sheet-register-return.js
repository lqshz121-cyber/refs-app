import { localCashAccountGroup } from './cash-account-scope.js';
import { localReportReturnContext } from './report-return-context.js';

// Cash rows can open the local register without changing the Balance Sheet.
// The report return retains as-of and dimension scope; no bank/reconcile state
// is inferred from the balance itself.
export function localBalanceSheetRegisterTarget({ entityId = '', accountCode = '', accountName = '', fromP = '', toP = '', propertyId = 'ALL', projectId = 'ALL', loanId = 'ALL', dimensionState = '' } = {}) {
  const code = String(accountCode || '');
  const cashScope = localCashAccountGroup(code);
  if (!entityId || !code || !cashScope || dimensionState !== 'LOCAL_SCOPE_COMPLETE') return null;
  return {
    route:'register', accountCode:code, fromPeriod:String(fromP || ''), throughPeriod:String(toP || ''),
    reportReturn:localReportReturnContext({tab:'Balance Sheet',fromP,toP,entityId,propertyId,projectId,loanId,cashScope,drillAccounts:[code],drillLabel:`${code} ${accountName}`.trim()}),
  };
}
