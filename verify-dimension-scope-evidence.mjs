import assert from 'node:assert/strict';
import { localDimensionScopeEvidence } from './src/dimension-scope-evidence.js';
const rows=[{posting_status:'POSTED',entity_id:2,je_number:'J1',lines:[{property_id:1},{property_id:2},{project_id:8}]},{posting_status:'POSTED',entity_id:3,je_number:'J2',lines:[{property_id:1}]}];
const evidence=localDimensionScopeEvidence(rows,{entityId:2,propertyId:'1',projectId:'7'},[{property_id:1,project_id:7},{property_id:2,project_id:8}]);
assert.deepEqual(evidence.totals,{inScope:1,missingDimension:1,crossScope:1,entityMismatch:1});
assert.equal(evidence.state,'LOCAL_SCOPE_REVIEW');
console.log('dimension scope evidence: in-scope, missing, cross-scope, and entity mismatch rows verified');
