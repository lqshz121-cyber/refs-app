// Read-only Account Register -> JE return scope. It retains the selected local
// entity/account/period/entry and cannot edit, delete, post, or reconcile it.
export function localAccountRegisterJournalReturnContext({ entityId = '', accountCode = '', fromPeriod = '', throughPeriod = '', entryId = '', query = '', coaReturn = null } = {}) {
  const account = String(accountCode || '');
  const entry = String(entryId || '');
  if (!account || !entry) return null;
  return {route:'register', entityId:String(entityId || ''), accountCode:account, ...(fromPeriod ? {fromPeriod:String(fromPeriod)} : {}), throughPeriod:String(throughPeriod || ''), query:String(query || ''), entryId:entry, ...(coaReturn?.route === 'coa' ? {coaReturn} : {})};
}

// Report launches have no selected register row; retain the parent register
// scope without manufacturing an entry id.
export function localAccountRegisterReportReturnContext({ entityId = '', accountCode = '', fromPeriod = '', throughPeriod = '', query = '', coaReturn = null } = {}) {
  const account = String(accountCode || '');
  if (!account) return null;
  return {route:'register', entityId:String(entityId || ''), accountCode:account, ...(fromPeriod ? {fromPeriod:String(fromPeriod)} : {}), throughPeriod:String(throughPeriod || ''), query:String(query || ''), ...(coaReturn?.route === 'coa' ? {coaReturn} : {})};
}

export function localAccountRegisterReturnScopeLabel(context = {}) {
  const periodLabel = `${context.fromPeriod || 'inception'} → ${context.throughPeriod || 'all periods'}`;
  if (context.entityId) return `Retained register scope · entity ${context.entityId} · account ${context.accountCode || 'unselected'} · ${periodLabel}`;
  return `Retained register scope · account ${context.accountCode || 'unselected'} · ${periodLabel}`;
}
