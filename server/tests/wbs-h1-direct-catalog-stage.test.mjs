import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {normalizeDirectWbsH1CatalogRows,partitionDirectWbsH1CatalogRows} from '../tools/stage-wbs-h1-payable-mapping-direct-catalog.mjs';

const tenantId='11111111-1111-4111-8111-111111111111',entityA='22222222-2222-4222-8222-222222222222',entityB='33333333-3333-4333-8333-333333333333',hash=`sha256:${'a'.repeat(64)}`,capturedAt='2026-08-22T20:00:00.000Z';
const rows=[{uuid:'row-a',company_code:'SUCF',posting_date:'2026-01-31',amount:'125.00',project_code:'P1',cost_code:'C1',vendor_no:'V1'},{uuid:'row-b',company_code:'SUML',incurred_date:'2026-06-30',amount:'-75.5',project_code:null,cost_code:null,vendor_no:'V2'}];

test('multi-company direct catalog binds every row to its exact provisioned entity and H1 month',()=>{
  const result=normalizeDirectWbsH1CatalogRows(rows,{tenantId,entityByCompany:new Map([['SUCF',entityA],['SUML',entityB]]),providerContentHash:hash,capturedAt});
  assert.equal(result.length,2);assert.deepEqual(result.map(row=>[row.company_code,row.entity_id,row.period_code,row.amount]),[['SUCF',entityA,'2026-01','125.0000'],['SUML',entityB,'2026-06','-75.5000']]);
  assert.throws(()=>normalizeDirectWbsH1CatalogRows(rows,{tenantId,entityByCompany:new Map([['SUCF',entityA]]),providerContentHash:hash,capturedAt}),/provisioned/);
  assert.throws(()=>normalizeDirectWbsH1CatalogRows([...rows,rows[0]],{tenantId,entityByCompany:new Map([['SUCF',entityA],['SUML',entityB]]),providerContentHash:hash,capturedAt}),/identity/);
});

test('catalog utility is staging-only and groups exact provisioned companies without accounting actions',async()=>{
  const source=await readFile(new URL('../tools/stage-wbs-h1-payable-mapping-direct-catalog.mjs',import.meta.url),'utf8');
  for(const token of ['retainWbsH1PayableMappingSourceRows','source_system=\'WBS\'','entity_code=ANY($2::text[])','WBS_H1_DIRECT_PAYABLE_CATALOG_STAGED'])assert.match(source,new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  assert.doesNotMatch(source,/create.*journal|submit|review|approve|post\s*\(/i);
});

test('catalog utility preserves retained identities and inserts only missing rows',()=>{
  const staged=[
    {entity_id:entityA,source_record_hash:`sha256:${'1'.repeat(64)}`,source_fact_hash:`sha256:${'a'.repeat(64)}`},
    {entity_id:entityA,source_record_hash:`sha256:${'2'.repeat(64)}`,source_fact_hash:`sha256:${'b'.repeat(64)}`},
    {entity_id:entityA,source_record_hash:`sha256:${'3'.repeat(64)}`,source_fact_hash:`sha256:${'c'.repeat(64)}`}
  ];
  const result=partitionDirectWbsH1CatalogRows(staged,[staged[0],{...staged[1],source_fact_hash:`sha256:${'d'.repeat(64)}`}]);
  assert.deepEqual(result.missing,[staged[2]]);assert.equal(result.existing_exact_count,1);assert.equal(result.existing_drift_count,1);
});
