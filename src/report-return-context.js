// A local navigation contract only. It preserves a report's currently visible
// scope while reviewing a retained JE; it does not save/share a QBO report.
export function localReportReturnContext({ tab = 'Trial Balance', fromP = '', toP = '', entityId = '', propertyId = 'ALL', projectId = 'ALL', loanId = 'ALL', cashScope = 'ALL', drillAccounts = null, drillLabel = '', asOf = false } = {}) {
  const validPeriod = Boolean(fromP && toP && fromP <= toP);
  const context = {
    route:'gl', tab, fromP, toP,
    entityId:entityId == null ? '' : String(entityId),
    propertyId:String(propertyId), projectId:String(projectId), loanId:String(loanId), cashScope:String(cashScope),
    drillAccounts:Array.isArray(drillAccounts) ? drillAccounts : null,
    drillLabel:drillLabel || '',
    state:validPeriod ? 'LOCAL_REPORT_RETURN_READY' : 'LOCAL_REPORT_RETURN_SCOPE_MISSING',
  };
  return asOf === true ? {...context,asOf:true} : context;
}

// Visible in every full-page source drill: the user can tell what Back restores.
export function localReportReturnScopeLabel(context = {}) {
  return `Retained local scope · entity ${context.entityId || 'required'} · ${context.propertyId || 'ALL'} / ${context.projectId || 'ALL'} / ${context.loanId || 'ALL'} · cash ${context.cashScope || 'ALL'} · ${context.fromP || '—'} ~ ${context.toP || '—'}`;
}
