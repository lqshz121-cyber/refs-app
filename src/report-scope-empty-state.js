// Reports Center scope is descriptive local evidence, not a substitute for a
// QBO report filter. No global or zero-value result may be presented as an
// entity-scoped report when its retained evidence is absent.
export function localReportScopeState({ journals = [], entityId = null, fromPeriod = '2026-01', toPeriod = '2026-07' } = {}) {
  if (!entityId) return {state:'NO_LOCAL_EVIDENCE_IN_SCOPE', postedCount:0, detail:'Select an entity before reviewing local report evidence.'};
  const posted = journals.filter(journal => journal.posting_status === 'POSTED' && journal.entity_id === entityId && (!journal.period_code || (journal.period_code >= fromPeriod && journal.period_code <= toPeriod)));
  if (!posted.length) return {state:'NO_POSTED_LOCAL_ACTIVITY', postedCount:0, detail:'No POSTED local activity is retained for this entity and period.'};
  const missingDimensions = posted.filter(journal => journal.lines?.some(line => line.account_code && ['164100','164200','164400','164500'].includes(line.account_code) && !(journal.property_id || journal.project_id || line.property_id || line.project_id))).length;
  if (missingDimensions) return {state:'REVIEW_REQUIRED_MISSING_DIMENSION', postedCount:posted.length, missingDimensions, detail:`${missingDimensions} retained capital/cost journal(s) lack property or project evidence and remain outside automatic operating/control aggregation.`};
  return {state:'POSTED_LOCAL_EVIDENCE_AVAILABLE', postedCount:posted.length, missingDimensions:0, detail:'Same-entity retained POSTED evidence is available; account, control and cash-scope differences remain explicit in each report.'};
}
