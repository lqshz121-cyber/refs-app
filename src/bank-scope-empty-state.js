// Empty-state wording is derived from local retained evidence only. It must
// never imply an external bank connection, refresh, or statement import.
export function localBankScopeEmptyState({ account = null, transactions = [], queueRows = [], queue = 'Review', entityId = null } = {}) {
  if (!account) return {state:'NO_LOCAL_BANK_EVIDENCE', title:'No local bank evidence', detail:'No retained local bank account exists for this scope.'};
  const scoped = transactions.filter(transaction => !entityId || !transaction.local_evidence?.entityId || transaction.local_evidence.entityId === entityId);
  if (entityId && transactions.length && scoped.length === 0) return {state:'SCOPE_CONFLICT_OR_MISSING_DIMENSION', title:'Scope conflict / missing dimension', detail:'Retained bank rows do not prove the active entity; review entity and property/project evidence before drilling.'};
  if (queueRows.length) return {state:'ROWS_AVAILABLE', title:null, detail:null};
  if (queue === 'Posted') return {state:'NO_POSTED_CASH_ACTIVITY', title:'No POSTED cash activity in this scope', detail:'No retained bank row has same-entity, same-cash-account, direction, amount and POSTED JE proof.'};
  if (queue === 'Review') return {state:'NO_ELIGIBLE_ITEMS_FOR_STATEMENT_PERIOD', title:'No eligible items for this statement period', detail:'No retained local bank item matches the selected account, queue and statement period.'};
  return {state:'NO_LOCAL_BANK_EVIDENCE', title:'No local bank evidence', detail:'No retained local bank item is available in this queue.'};
}
