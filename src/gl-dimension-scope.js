const matchesId = (value, expected) => expected === 'ALL' || expected === '' || expected == null || String(value) === String(expected);

export function scopedPostedJournalEntries(journals = [], {
  propertyId = 'ALL', projectId = 'ALL', loanId = 'ALL', properties = [],
} = {}) {
  const propertyProject = new Map(properties.map(property => [String(property.property_id), String(property.project_id)]));
  return journals
    .filter(journal => journal.posting_status === 'POSTED')
    .map(journal => {
      const lines = (journal.lines || []).filter(line => {
        const propertyMatches = matchesId(line.property_id, propertyId);
        const lineProject = line.project_id == null ? propertyProject.get(String(line.property_id)) : String(line.project_id);
        const projectMatches = matchesId(lineProject, projectId);
        const loanMatches = matchesId(line.loan_id, loanId);
        return propertyMatches && projectMatches && loanMatches;
      });
      return lines.length ? { ...journal, lines } : null;
    })
    .filter(Boolean);
}

export function dimensionScopeLabel({ propertyId = 'ALL', projectId = 'ALL', loanId = 'ALL' } = {}, { properties = [], projects = [], loans = [] } = {}) {
  const byId = (records, id, codeKey) => records.find(record => String(record[`${codeKey}_id`]) === String(id));
  const labels = [];
  if (propertyId !== 'ALL') { const property = byId(properties, propertyId, 'property'); labels.push(property ? `Property ${property.property_code}` : `Property ${propertyId}`); }
  if (projectId !== 'ALL') { const project = byId(projects, projectId, 'project'); labels.push(project ? `Project ${project.project_code}` : `Project ${projectId}`); }
  if (loanId !== 'ALL') { const loan = byId(loans, loanId, 'loan'); labels.push(loan ? `Loan ${loan.loan_code}` : `Loan ${loanId}`); }
  return labels.length ? labels.join(' · ') : 'All local dimensions';
}
