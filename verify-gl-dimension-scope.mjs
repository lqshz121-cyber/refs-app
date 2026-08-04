import assert from 'node:assert/strict';
import { dimensionScopeLabel, scopedPostedJournalEntries } from './src/gl-dimension-scope.js';

const properties = [{ property_id: 2, property_code: 'P0020', project_id: 8 }];
const journals = [{ posting_status: 'POSTED', je_number: 'JE-1', lines: [
  { account_code: '120200', property_id: 2 },
  { account_code: '421803', property_id: 2 },
  { account_code: '111000' },
] }, { posting_status: 'DRAFT', je_number: 'JE-2', lines: [{ account_code: '164200', project_id: 8 }] }];

assert.deepEqual(scopedPostedJournalEntries(journals, { propertyId: '2', properties }).map(j => j.lines.map(l => l.account_code)), [['120200', '421803']]);
assert.deepEqual(scopedPostedJournalEntries(journals, { projectId: '8', properties }).map(j => j.lines.map(l => l.account_code)), [['120200', '421803']]);
assert.equal(scopedPostedJournalEntries(journals, { loanId: '1', properties }).length, 0);
assert.equal(dimensionScopeLabel({ propertyId:'2', projectId:'8', loanId:'ALL' }, { properties, projects:[{project_id:8,project_code:'PRJ-008'}] }), 'Property P0020 · Project PRJ-008');
console.log('GL dimension scope: posted line-level property/project/loan filtering verified');
