import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {canonicalRequestHash} from '../runtime/request-hash.mjs';
import {createWbsSnapshotSignatureVerifier} from '../runtime/wbs-snapshot-signature.mjs';
import {createWbsAdmittedCostCwipIngestion,WbsAdmittedCostCwipIngestionError} from '../runtime/wbs-admitted-cost-cwip-ingestion.mjs';
import {buildStandardDraftRequest} from '../runtime/wbs-inbound-data-adapter.mjs';

const tenantId='11111111-1111-4111-8111-111111111111',entityId='22222222-2222-4222-8222-222222222222';
const pair=generateKeyPairSync('ed25519'),keyId='wbs-admitted-cost-cwip-test';
const publicKeys={[keyId]:pair.publicKey.export({type:'spki',format:'pem'})};
const rows=[{costLedgerId:'COST-LEDGER-001',currency:'USD',amount:'125.5000',cost_date:'2026-08-10',posting_date:'2026-08-11',project_ref:'PROJECT-01',cost_code_ref:'CWIP-LAND',description:'Land preparation',direction:'DEBIT'}];
const without=(value,...keys)=>Object.fromEntries(Object.entries(value).filter(([key])=>!keys.includes(key)));

function signedSnapshot(inputRows=rows){
  const snapshot={schema_version:'WBS_READONLY_SNAPSHOT_V2',snapshot_id:'44444444-4444-4444-8444-444444444444',captured_at:'2026-08-11T02:00:00.000Z',environment:'PRODUCTION',source_system:'WBS',dictionary_version:'WBS-COST-GL-V1',delivery:{mode:'SIGNED_SNAPSHOT_PACKAGE',snapshot_token:'provider-snapshot-cost-1',extract_started_at:'2026-08-11T01:59:00.000Z',extract_completed_at:'2026-08-11T02:00:00.000Z',consistency:'COMPLETE',read_consistency:'SNAPSHOT_ISOLATION',pagination:'PRIMARY_KEY_SEEK'},views:[{name:'BGDATA.cost_general_ledger',company_key:'COMPANY-A',rows:structuredClone(inputRows),row_count:inputRows.length,first_primary_key:inputRows.length?inputRows[0].costLedgerId:null,last_primary_key:inputRows.length?inputRows.at(-1).costLedgerId:null,content_hash:canonicalRequestHash(inputRows)}],detached_signature:{key_id:keyId,algorithm:'Ed25519',value:'placeholder'}};
  snapshot.package_hash=canonicalRequestHash(without(snapshot,'package_hash','detached_signature'));
  snapshot.detached_signature={...snapshot.detached_signature,value:sign(null,Buffer.from(snapshot.package_hash),pair.privateKey).toString('base64')};
  return snapshot;
}
function resign(snapshot,mutate){const next=structuredClone(snapshot);mutate(next);const view=next.views[0],key=view.name==='BGDATA.payable'?'apGuId':'costLedgerId';view.row_count=view.rows.length;view.first_primary_key=view.rows.length?view.rows[0][key]:null;view.last_primary_key=view.rows.length?view.rows.at(-1)[key]:null;view.content_hash=canonicalRequestHash(view.rows);next.package_hash=canonicalRequestHash(without(next,'package_hash','detached_signature'));next.detached_signature={...next.detached_signature,value:sign(null,Buffer.from(next.package_hash),pair.privateKey).toString('base64')};return next;}
function harness(){const calls=[];const kernel={async recordWbsSnapshot(request){calls.push(['receipt',request]);return {import_batch_id:'55555555-5555-4555-8555-555555555555',idempotent:false,can_create_draft:false,can_post:false};},async persistWbsInboundRows(request){calls.push(['rows',request]);return {receipt_id:'66666666-6666-4666-8666-666666666666',row_count:request.rows.length,idempotent:false,can_create_draft:false,can_post:false};}};return {calls,service:createWbsAdmittedCostCwipIngestion({kernel,signatureVerifier:createWbsSnapshotSignatureVerifier({publicKeys})})};}

test('signed production Cost-to-CWIP composes immutable receipt through Raw, MONEY4 Normalized and Staging with zero posting authority',async()=>{
  const {calls,service}=harness(),result=await service.ingest({tenantId,entityId,snapshot:signedSnapshot(),idempotencyKey:'wbs-cost-cwip-admission-0001'});
  assert.deepEqual(calls.map(([kind])=>kind),['receipt','rows']);
  const row=calls[1][1].rows[0];
  assert.deepEqual({raw:row.raw.amount,type:row.normalized.source_type,money4:row.normalized.amount_money4,project:row.normalized.project_ref,cost:row.normalized.cost_code_ref,outcome:row.outcome_kind},{raw:'125.5000',type:'COST_CWIP',money4:'125.5000',project:'PROJECT-01',cost:'CWIP-LAND',outcome:'STAGING'});
  assert.deepEqual({status:result.status,normalized:result.normalized_count,staging:result.staging_count,exceptions:result.exception_count,draft:result.can_create_draft,approve:result.can_approve,post:result.can_post},{status:'PERSISTED_COST_CWIP_STAGING_REVIEW_REQUIRED',normalized:1,staging:1,exceptions:0,draft:false,approve:false,post:false});
});

test('Cost-to-CWIP replay is idempotent and changed evidence under the same key is rejected',async()=>{
  const {calls,service}=harness(),snapshot=signedSnapshot();
  const first=await service.ingest({tenantId,entityId,snapshot,idempotencyKey:'wbs-cost-cwip-admission-replay'}),replay=await service.ingest({tenantId,entityId,snapshot,idempotencyKey:'wbs-cost-cwip-admission-replay'});
  assert.equal(first.idempotent,false);assert.equal(replay.idempotent,true);assert.equal(calls.length,2);
  const changed=resign(snapshot,value=>{value.views[0].rows[0].description='different signed cost evidence';});
  await assert.rejects(()=>service.ingest({tenantId,entityId,snapshot:changed,idempotencyKey:'wbs-cost-cwip-admission-replay'}),error=>error instanceof WbsAdmittedCostCwipIngestionError&&error.code==='WBS_COST_CWIP_ADMISSION_IDEMPOTENCY_CONFLICT');
});

test('unsigned pilot, a control view, and a bad signature never reach Cost-to-CWIP persistence',async()=>{
  const cases=[
    [{...signedSnapshot(),status:'NOT_ADMITTED',signature_verified:false,can_persist:false},'WBS_COST_CWIP_ADMISSION_UNSIGNED_PILOT_FORBIDDEN'],
    [resign(signedSnapshot(),value=>{value.views[0].name='BGDATA.payable';value.views[0].rows[0]={apGuId:'77777777-7777-4777-8777-777777777777',currency:'USD',amount:'1.0000',invoice_date:'2026-08-10',posting_date:'2026-08-11'};}),'WBS_COST_CWIP_ADMISSION_SCOPE_INVALID'],
    [{...signedSnapshot(),detached_signature:{key_id:keyId,algorithm:'Ed25519',value:'invalid'}},'WBS_COST_CWIP_ADMISSION_SIGNATURE_INVALID']
  ];
  for(const [snapshot,code] of cases){const {calls,service}=harness();await assert.rejects(()=>service.ingest({tenantId,entityId,snapshot,idempotencyKey:`wbs-cost-cwip-${code}`}),error=>error.code===code);assert.equal(calls.length,0);}
});

test('signed malformed Cost-to-CWIP evidence is retained as an Exception, not a Draft candidate',async()=>{
  const {calls,service}=harness(),snapshot=resign(signedSnapshot(),value=>{value.views[0].rows[0].amount='125.50000';});
  const result=await service.ingest({tenantId,entityId,snapshot,idempotencyKey:'wbs-cost-cwip-exception-0001'});
  const row=calls[1][1].rows[0];assert.equal(row.raw.amount,'125.50000');assert.equal(row.normalized.amount_money4,null);assert.equal(row.outcome_kind,'EXCEPTION');assert.equal(result.exception_count,1);assert.equal(result.can_create_draft,false);
});
test('a reviewed Cost-to-CWIP row requires an exact approved CWIP mapping and produces only a standard Draft request',()=>{
  const externalTrace={provider_snapshot:'provider-snapshot-cost-1',project_ref:'PROJECT-01',cost_code_ref:'CWIP-LAND'};
  const staging={stage:'STAGING_REVIEWED',receipt_id:'receipt-cost-1',receipt_ref:'object://wbs-snapshot/cost-1/BGDATA.cost_general_ledger/COST-LEDGER-001',receipt_hash:canonicalRequestHash({receipt:'cost-1'}),staging_item_id:'staging-cost-1',source_document_id:'document-cost-1',raw_event_id:'raw-cost-1',source_record_id:'COST-LEDGER-001',source_version:'snapshot:cost-1:row-1',company_key:'COMPANY-A',currency:'USD',business_date:'2026-08-10',accounting_date:'2026-08-11',direction:'DEBIT',source_type:'COST_CWIP',external_trace:externalTrace,external_trace_hash:canonicalRequestHash(externalTrace)};
  const mapping={status:'APPROVED',mapping_id:'cwip-map-1',version:'1',snapshot_hash:canonicalRequestHash({mapping:'cwip-map-1'}),source_type:'COST_CWIP',company_key:'COMPANY-A',currency:'USD',effective_from:'2026-01-01T00:00:00Z',effective_to:null};
  const journal={period_id:'period-1',journal_number:'CWIP-2026-08-001',company_key:'COMPANY-A',currency:'USD',accounting_date:'2026-08-11',description:'Capitalized land cost',lines:[{account_code:'164100',debit_amount:'125.5000',credit_amount:'0.0000'},{account_code:'610000',debit_amount:'0.0000',credit_amount:'125.5000'}]};
  const request=buildStandardDraftRequest({stagingItem:staging,mapping,journal});
  assert.deepEqual({status:request.status,dispatch:request.can_dispatch,post:request.can_post,type:request.trace.source_type,mapping:request.mapping.mapping_id,lines:request.lines.length},{status:'READY_FOR_STANDARD_JE_COMMAND',dispatch:false,post:false,type:'COST_CWIP',mapping:'cwip-map-1',lines:2});
  assert.throws(()=>buildStandardDraftRequest({stagingItem:staging,mapping:{...mapping,status:'DRAFT'},journal}),error=>error.code==='WBS_MAPPING_APPROVED_REQUIRED');
});
