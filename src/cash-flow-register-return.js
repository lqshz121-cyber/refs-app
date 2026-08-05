import { localCashAccountGroup } from './cash-account-scope.js';
import { localReportReturnContext } from './report-return-context.js';

// A Cash Flow scope may expose a Register only when it resolves to exactly one
// local cash account. Aggregate and conflicting scopes stay in GL review.
export function localCashFlowRegisterTarget({ entityId = '', accountCodes = [], scope = '', fromP = '', toP = '', propertyId = 'ALL', projectId = 'ALL', loanId = 'ALL', dimensionState = '', reportCenterReturn = null } = {}) {
  const accounts = [...new Set((accountCodes || []).map(String).filter(Boolean))];
  const accountCode = accounts.length === 1 ? accounts[0] : '';
  const cashScope = localCashAccountGroup(accountCode);
  if (!entityId || !accountCode || !cashScope || cashScope !== scope || dimensionState !== 'LOCAL_SCOPE_COMPLETE') return null;
  return {
    route:'register', accountCode, fromPeriod:String(fromP || ''), throughPeriod:String(toP || ''),
    reportReturn:localReportReturnContext({tab:'Cash Flow',fromP,toP,entityId,propertyId,projectId,loanId,cashScope,drillAccounts:[accountCode],drillLabel:`Cash flow · ${cashScope}`,reportCenterReturn}),
  };
}
