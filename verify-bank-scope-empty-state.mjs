import assert from 'node:assert/strict';
import { localBankScopeEmptyState } from './src/bank-scope-empty-state.js';

assert.equal(localBankScopeEmptyState({account:null}).state,'NO_LOCAL_BANK_EVIDENCE');
assert.equal(localBankScopeEmptyState({account:{},transactions:[{local_evidence:{entityId:'E2'}}],entityId:'E1'}).state,'SCOPE_CONFLICT_OR_MISSING_DIMENSION');
assert.equal(localBankScopeEmptyState({account:{},transactions:[{}],queueRows:[],queue:'Posted'}).state,'NO_POSTED_CASH_ACTIVITY');
assert.equal(localBankScopeEmptyState({account:{},transactions:[{}],queueRows:[],queue:'Review'}).state,'NO_ELIGIBLE_ITEMS_FOR_STATEMENT_PERIOD');
assert.equal(localBankScopeEmptyState({account:{},transactions:[{}],queueRows:[{}]}).state,'ROWS_AVAILABLE');
console.log('bank scope empty state: local scope and posting boundaries verified');
