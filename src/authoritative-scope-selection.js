const nonEmpty = value => typeof value === 'string' && value.length > 0;

// The accounting-scope catalog is already restricted by the authenticated
// database context. If the deployment default points at a scope the current
// actor cannot read, prefer another period in the same company and then the
// first catalogued company. Returning null for an exact match prevents a
// transient read failure from silently moving a user away from their choice.
export function resolveAuthorizedScopeFallback({
  scopes,
  entityId,
  periodId,
} = {}) {
  if (!Array.isArray(scopes) || !nonEmpty(entityId) || !nonEmpty(periodId)) return null;
  const catalog = scopes.filter(row => row && nonEmpty(row.entity_id) && nonEmpty(row.period_id));
  if (catalog.some(row => row.entity_id === entityId && row.period_id === periodId)) return null;
  return catalog.find(row => row.entity_id === entityId) || catalog[0] || null;
}
