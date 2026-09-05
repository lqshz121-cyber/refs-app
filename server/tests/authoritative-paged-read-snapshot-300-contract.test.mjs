import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createAccountingApi} from '../api/accounting-http.mjs';
import {PostgresAccountingKernel} from '../runtime/kernel-repository.mjs';
import {MIGRATION_MANIFEST} from '../runtime/migration-manifest.mjs';

const load=relative=>readFile(new URL(relative,import.meta.url),'utf8');
const id=n=>`${String(n).padStart(8,'0')}-0000-4000-8000-${String(n).padStart(12,'0')}`;
const tenantId=id(1),entityId=id(2),periodId=id(3),hash=`sha256:${'a'.repeat(64)}`;
const row={period_id:periodId,period_code:'2026-08',period_start:'2026-08-01',period_end:'2026-08-31',account_code:'610000',account_name:'Project expense',currency:'USD',journal_date:'2026-08-15',journal_entry_id:id(4),journal_number:'JE-300-001',journal_line_id:id(5),ledger_line_id:id(6),journal_revision:4,member_ref:null,description:'Posted source-bound expense',debit_amount:'10.0000',credit_amount:'0.0000',source_document_ids:[id(7)],total_count:1};
const page={schema_version:'GENERAL_LEDGER_SNAPSHOT_PAGE_V1',scope:{tenant_id:tenantId,entity_id:entityId,period_id:periodId},filter:{account_code:null,query:null},limit:200,offset:0,total_count:1,read_count:1,population_complete:true,population_hash:hash,snapshot_token:hash,rows:[row]};
const principal={trusted:true,tenantId,actorId:'ledger-reader'};

test('migration 300 hashes complete ordered queue and GL versions inside each page statement',async()=>{
  const [up,down]=await Promise.all([load('../db/migrations/300_authoritative_paged_read_snapshots.sql'),load('../db/migrations/down/300_authoritative_paged_read_snapshots.sql')]);
  for(const name of ['refs_read_ai_accounting_decision_queue_snapshot','refs_read_general_ledger_snapshot']){assert.match(up,new RegExp(`CREATE FUNCTION ${name}`));assert.match(up,new RegExp(`REVOKE ALL ON FUNCTION ${name}`));assert.match(up,new RegExp(`GRANT EXECUTE ON FUNCTION ${name}`));assert.match(down,new RegExp(`DROP FUNCTION ${name}`));}
  assert.match(up,/ordered_population AS MATERIALIZED/);assert.match(up,/population AS MATERIALIZED/);assert.match(up,/ordered_row_versions/);assert.match(up,/tenant_id',p_tenant,'entity_id',p_entity,'period_id',p_period/);
  assert.match(up,/journal_revision',j\.revision/);assert.match(up,/human_evidence_hash',h\.evidence_hash/);assert.match(up,/draft_evidence_hash',de\.evidence_hash/);assert.match(up,/source_document_ids'/);
  assert.match(up,/LIMIT 100001/);assert.match(up,/p_limit NOT BETWEEN 1 AND 200/);assert.match(up,/population hash changed between pages/);
  assert.ok(MIGRATION_MANIFEST.some(item=>item.name==='300_authoritative_paged_read_snapshots.sql'));
});

test('repository sends the first-page token back to both database readers',async()=>{
  const calls=[],repository=Object.create(PostgresAccountingKernel.prototype);repository.inSession=async work=>work({query:async(text,values)=>(calls.push({text,values}),{rowCount:1,rows:[{result:{ok:true}}]})});
  await repository.readAiAccountingDecisionQueueSnapshot({tenantId,entityId,accountingPeriodId:periodId,limit:200,offset:200,snapshotToken:hash});
  await repository.readGeneralLedgerSnapshot({tenantId,entityId,periodId,limit:200,offset:200,snapshotToken:hash});
  assert.match(calls[0].text,/refs_read_ai_accounting_decision_queue_snapshot/);assert.equal(calls[0].values.at(-1),hash);
  assert.match(calls[1].text,/refs_read_general_ledger_snapshot/);assert.equal(calls[1].values.at(-1),hash);
});

test('GL snapshot endpoint is no-store, scoped, token-bound, and keeps the 200 row cap',async()=>{
  let seen;const api=createAccountingApi({authenticate:async()=>principal,kernelFactory:async()=>({readGeneralLedgerSnapshot:async input=>(seen=input,page)})});
  const first=await api({method:'GET',url:`/api/v1/entities/${entityId}/general-ledger/snapshot-entries?periodId=${periodId}&limit=200&offset=0`,headers:{},body:null});
  assert.equal(first.status,200);assert.equal(first.headers['cache-control'],'no-store');assert.deepEqual(seen,{tenantId,entityId,periodId,accountCode:null,query:null,limit:200,offset:0,snapshotToken:null});assert.equal(first.body.data.snapshot_token,hash);
  const noToken=await api({method:'GET',url:`/api/v1/entities/${entityId}/general-ledger/snapshot-entries?periodId=${periodId}&limit=200&offset=200`,headers:{},body:null});assert.equal(noToken.status,400);assert.equal(noToken.body.code,'GENERAL_LEDGER_SNAPSHOT_REQUIRED');
  const tooLarge=await api({method:'GET',url:`/api/v1/entities/${entityId}/general-ledger/snapshot-entries?periodId=${periodId}&limit=201&offset=0`,headers:{},body:null});assert.equal(tooLarge.status,400);
});

test('HTTP rejects a same-count but changed GL population token',async()=>{
  const changed=`sha256:${'b'.repeat(64)}`,api=createAccountingApi({authenticate:async()=>principal,kernelFactory:async()=>({readGeneralLedgerSnapshot:async()=>({...page,offset:200,population_hash:changed,snapshot_token:changed,rows:[],read_count:0,population_complete:true})})});
  const response=await api({method:'GET',url:`/api/v1/entities/${entityId}/general-ledger/snapshot-entries?periodId=${periodId}&limit=200&offset=200&snapshotToken=${encodeURIComponent(hash)}`,headers:{},body:null});
  assert.equal(response.status,502);assert.equal(response.headers['cache-control'],'no-store');assert.equal(response.body.code,'GENERAL_LEDGER_SNAPSHOT_RESPONSE_INVALID');
});

test('OpenAPI publishes the immutable tokens and exact later-page requirement',async()=>{
  const spec=JSON.parse(await load('../api/openapi-accounting.json')),operation=spec.paths['/entities/{entityId}/general-ledger/snapshot-entries'].get;
  assert.equal(operation.parameters.find(value=>value.name==='limit').schema.maximum,200);assert.equal(operation.parameters.find(value=>value.name==='snapshotToken').schema.$ref,'#/components/schemas/Sha256');
  assert.equal(spec.components.schemas.GeneralLedgerSnapshotPage.additionalProperties,false);assert.equal(spec.components.schemas.GeneralLedgerSnapshotPage.properties.snapshot_token.$ref,'#/components/schemas/Sha256');
});
