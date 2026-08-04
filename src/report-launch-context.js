// Reports Center only opens a retained local ledger view.  It deliberately
// carries the entity in route state so a later global entity change cannot
// make Back reconstruct a different statement.
export function localLedgerReportLaunchContext(tab, entityId, options = {}) {
  return {
    route: 'gl',
    tab: String(tab || 'Trial Balance'),
    fromP: '2026-01',
    toP: '2026-07',
    entityId: entityId == null ? '' : String(entityId),
    ...options,
  };
}
