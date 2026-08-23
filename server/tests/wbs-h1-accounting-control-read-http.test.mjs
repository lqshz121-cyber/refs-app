import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createAccountingApi} from '../api/accounting-http.mjs';

const hash=character=>`sha256:${character.repeat(64)}`;
const tenantId=randomUUID(),entityId=randomUUID(),runId=randomUUID(),receiptId=randomUUID(),periodId=randomUUID(),moduleReceiptId=randomUUID();
const data={schema_version:'WBS_H1_ACCOUNTING_CONTROL_RECEIPT_V1',run_id:runId,receipt_id:receiptId,receipt_hash:hash('a'),company_code:'WBPA',currency:'USD',date_from:'2026-01-01',date_to:'2026-06-30',source_version:hash('b'),snapshot_token_hash:hash('c'),provider_content_hash:hash('d'),source_manifest:{bytes:'1',company_code:'WBPA',date_from:'2026-01-01',date_to:'2026-06-30',domain:'accounting_info',file_name:'accounting_info__WBPA__2026-H1.ndjson',generated_at:'2026-08-23T12:00:00.000Z',period:'2026-H1',rows:'1',schema_version:'WBS_H1_2026_LOCAL_SNAPSHOT_V1',sha256:'d'.repeat(64)},source_manifest_hash:hash('e'),row_count:1,included_h1_row_count:1,excluded_row_count:0,debit_amount:'25.0000',credit_amount:'25.0000',population_hash:hash('f'),module_receipt_count:1,module_receipts:[{receipt_id:moduleReceiptId,period_id:periodId,period_code:'2026-01',currency:'USD',module_code:'AP',row_count:1,debit_amount:'25.0000',credit_amount:'25.0000',module_hash:hash('1'),balance_status:'BALANCED'}],after_ordinal:0,limit:50,population_complete:true,run_finalized:true,page_complete:true,cursor_next:null,rows:[{tenant_id:tenantId,entity_id:entityId,company_code:'WBPA',currency:'USD',source_version:hash('b'),wbs_accounting_info_id:1,row_ordinal:1,journal_group_id:'J-1',line_no:1,period_id:periodId,period_code:'2026-01',set_date:'2026-01-01',posting_date:'2026-01-01',account_code:'610000',debit_amount:'25.0000',credit_amount:'0.0000',member_ref:null,project_ref:null,property_ref:null,cost_code:null,unit_ref:null,business_guid:null,sys_id:null,bill_no:null,cb_id:null,come_from:'AP',source:'WBS',review_status:'NEW',closed_status:'OPEN',completeness_status:'COMPLETE',gap_codes:[],excluded_from_h1:false,line_hash:hash('2')}],accounting_authority:'CONTROL_EVIDENCE_ONLY',can_create_draft:false,can_review:false,can_approve:false,can_post:false};

test('WBS H1 accounting control population is closed, no-store, scoped, and actionless',async()=>{
  let observed;const api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'reader'}),kernelFactory:async()=>({readWbsH1AccountingControlPopulation:async args=>(observed=args,data)})});
  const path=`/api/v1/entities/${entityId}/wbs/h1-accounting-control-population?runId=${runId}&afterOrdinal=0&limit=50`;
  const response=await api({method:'GET',url:path,headers:{},body:null});
  assert.equal(response.status,200);assert.equal(response.headers['cache-control'],'no-store');assert.deepEqual(response.body.data,data);assert.deepEqual(observed,{tenantId,entityId,runId,afterOrdinal:0,limit:50});
  assert.equal((await api({method:'GET',url:path,headers:{'Idempotency-Key':'forbidden'},body:null})).status,400);
  const badApi=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'reader'}),kernelFactory:async()=>({readWbsH1AccountingControlPopulation:async()=>({...data,can_post:true})})});
  const bad=await badApi({method:'GET',url:path,headers:{},body:null});assert.equal(bad.status,502);assert.equal(bad.body.code,'WBS_H1_ACCOUNTING_CONTROL_POPULATION_PROTOCOL');
});
