import assert from 'node:assert/strict';
import { localAssetSubledger, localAssetSubledgerControl } from './src/asset-subledger-evidence.js';

const journals = [
  {je_number:'CWIP-1',entity_id:2,period_code:'2026-07',posting_status:'POSTED',source_system:'AP',lines:[{account_code:'164200',debit_amount:100,project_id:1,loan_id:1}]},
  {je_number:'LAND-1',entity_id:2,period_code:'2026-07',posting_status:'POSTED',source_system:'CLS',lines:[{account_code:'161000',debit_amount:50,property_id:1}]},
  {je_number:'DRAFT',entity_id:2,period_code:'2026-07',posting_status:'DRAFT',lines:[{account_code:'164200',debit_amount:999}]},
  {je_number:'OTHER',entity_id:4,period_code:'2026-07',posting_status:'POSTED',lines:[{account_code:'164200',debit_amount:777}]},
];
const rows = localAssetSubledger(journals,{entityId:2,toPeriod:'2026-07'});
assert.equal(rows.length, 2);
assert.equal(rows.find(row=>row.account_code==='164200').depreciation_state, 'CWIP_NOT_DEPRECIATED');
assert.equal(rows.find(row=>row.account_code==='161000').status, 'IN_SERVICE_BASIS_REVIEW');
assert.deepEqual(localAssetSubledgerControl(rows), {total:150,cwip:100,inService:50,state:'LOCAL_POSTED_ASSET_EVIDENCE'});
console.log('asset subledger evidence: entity-scoped posted asset/CWIP balances verified');
