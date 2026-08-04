import assert from 'node:assert/strict';
import { localReportScopeState } from './src/report-scope-empty-state.js';

assert.equal(localReportScopeState({journals:[],entityId:null}).state,'NO_LOCAL_EVIDENCE_IN_SCOPE');
assert.equal(localReportScopeState({journals:[],entityId:'E1'}).state,'NO_POSTED_LOCAL_ACTIVITY');
assert.equal(localReportScopeState({entityId:'E1',journals:[{entity_id:'E1',posting_status:'POSTED',period_code:'2026-07',lines:[{account_code:'164100'}]}]}).state,'REVIEW_REQUIRED_MISSING_DIMENSION');
assert.equal(localReportScopeState({entityId:'E1',journals:[{entity_id:'E1',posting_status:'POSTED',period_code:'2026-07',property_id:'P1',lines:[{account_code:'164100'}]}]}).state,'POSTED_LOCAL_EVIDENCE_AVAILABLE');
console.log('report scope empty state: entity, posted evidence, and dimension review boundaries verified');
