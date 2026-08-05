const selected = value => value !== 'ALL' && value !== '' && value != null;
const same = (left, right) => String(left) === String(right);

// Audits, rather than infers, why posted lines are outside a selected local
// entity/dimension scope. It does not change the report row set.
export function localDimensionScopeEvidence(journals = [], {entityId = null, propertyId = 'ALL', projectId = 'ALL', loanId = 'ALL'} = {}, properties = []) {
  const projectByProperty = new Map(properties.map(row => [String(row.property_id), String(row.project_id)]));
  const totals = {inScope:0,missingDimension:0,crossScope:0,entityMismatch:0};
  const reviewRows = [];
  if (!selected(entityId)) return {
    totals,
    reviewRows,
    state:'ENTITY_REQUIRED',
    detail:'Select one entity before evaluating report scope evidence.',
  };
  journals.filter(journal => journal.posting_status === 'POSTED').forEach(journal => (journal.lines || []).forEach(line => {
    if (!same(journal.entity_id, entityId)) { totals.entityMismatch++; reviewRows.push({journal,line,reason:'ENTITY_MISMATCH'}); return; }
    const inferredProject = line.project_id ?? projectByProperty.get(String(line.property_id));
    const requirements = [[propertyId,line.property_id,'PROPERTY'],[projectId,inferredProject,'PROJECT'],[loanId,line.loan_id,'LOAN']].filter(([value])=>selected(value));
    const missing = requirements.find(([,actual])=>actual == null || actual === '');
    if (missing) { totals.missingDimension++; reviewRows.push({journal,line,reason:`MISSING_${missing[2]}`}); return; }
    const mismatch = requirements.find(([expected,actual])=>!same(expected,actual));
    if (mismatch) { totals.crossScope++; reviewRows.push({journal,line,reason:`${mismatch[2]}_MISMATCH`}); return; }
    totals.inScope++;
  }));
  return {totals,reviewRows,state:totals.missingDimension||totals.crossScope||totals.entityMismatch?'LOCAL_SCOPE_REVIEW':'LOCAL_SCOPE_COMPLETE'};
}
