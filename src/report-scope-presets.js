const validId = value => value !== null && value !== undefined && value !== '' && value !== 'ALL';

// Browser-local report presets retain the explicit local report scope only.
// They do not create QBO custom reports, links, exports, or subscriptions.
export function normalizeLocalReportScopes(scopes = []) {
  const seen = new Set();
  return (Array.isArray(scopes) ? scopes : []).filter(scope => {
    if (!validId(scope?.entityId) || !scope?.fromP || !scope?.toP) return false;
    const key = [scope.entityId, scope.tab, scope.fromP, scope.toP, scope.propertyId || 'ALL', scope.projectId || 'ALL', scope.loanId || 'ALL'].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function createLocalReportScope({ entityId, tab, fromP, toP, propertyId = 'ALL', projectId = 'ALL', loanId = 'ALL' } = {}) {
  if (!validId(entityId) || !fromP || !toP || fromP > toP) return null;
  const scope = { entityId, tab:tab || 'Trial Balance', fromP, toP, propertyId:String(propertyId), projectId:String(projectId), loanId:String(loanId) };
  return { ...scope, label:'Local ' + scope.tab + ' · E' + entityId + ' · ' + fromP + '–' + toP };
}

export function saveLocalReportScope(scopes = [], scope) {
  if (!scope) return normalizeLocalReportScopes(scopes);
  return normalizeLocalReportScopes([scope, ...scopes]);
}

export function localReportScopeForEntity(scopes = [], entityId) {
  return normalizeLocalReportScopes(scopes).filter(scope => String(scope.entityId) === String(entityId));
}
