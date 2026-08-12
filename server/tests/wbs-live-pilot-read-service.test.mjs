import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalRequestHash} from '../runtime/request-hash.mjs';
import {assertWbsLivePilotResult,createWbsLivePilotReadService,parseWbsLivePilotSelection,WBS_LIVE_PILOT_TOOLS} from '../runtime/wbs-live-pilot-read-service.mjs';

const tenantId='6fb25daf-0799-4805-bede-be54230da33c',entityId='ca8d23c7-0ea6-4860-8e3e-caf9a3e22ce3';
const observed=({tool='list_payables',rows=[{ap_guid:'private-ap-id',posting_date:'2026-08-11',amount:'12.3',pay_status:'Clear'}],scope={company_codes:[],date_range:['2026-08-01','2026-08-11']}}={})=>({tool_name:tool,contract_version:'WBS-REFS-MCP-V1',environment:'production',captured_at:'2026-08-11T10:00:00.000Z',scope,record_count:rows.length,content_sha256:canonicalRequestHash(rows).slice(7),cursor_next:null,rows});

test('pilot query requires one fixed tool and one bounded limit',()=>{
  assert.deepEqual(parseWbsLivePilotSelection(new URLSearchParams('tool=list_payables&limit=10')),{tool:'list_payables',limit:10});
  for(const query of ['tool=list_payables','limit=1','tool=get_meta&limit=1','tool=list_payables&limit=0','tool=list_payables&limit=11','tool=list_payables&limit=1&x=1','tool=list_payables&tool=list_payables&limit=1'])assert.throws(()=>parseWbsLivePilotSelection(new URLSearchParams(query)));
  assert.deepEqual(WBS_LIVE_PILOT_TOOLS,['list_payables','list_bank_transactions','list_autorec_details','list_autorec_banks','list_journal_entries']);
});

test('live pilot authorizes exact scope and returns sanitized non-admitted observations only',async()=>{
  const calls=[],client={initialize:async()=>calls.push('initialize'),listTools:async()=>calls.push('listTools'),readView:async args=>(calls.push(args),observed())};
  const service=createWbsLivePilotReadService({client,authorize:async scope=>calls.push(scope)});
  const result=await service.readObservation({tenantId,entityId,tool:'list_payables',limit:1});
  assert.deepEqual(calls.slice(0,3),[{tenantId,entityId},'initialize','listTools']);assert.deepEqual(calls[3],{toolName:'list_payables',args:{limit:1}});
  assert.equal(result.status,'NOT_ADMITTED');assert.equal(result.observation_mode,'UNSIGNED_PILOT');assert.equal(result.signature_verified,false);
  assert.deepEqual(result.scope,{company_codes:[],date_range:['2026-08-01','2026-08-11']});assert.equal(result.rows[0].amount,'12.3000');assert.equal(result.rows[0].accounting_date,'2026-08-11');assert.equal(result.rows[0].status,'CLEAR');assert.equal(result.rows[0].currency,'USD');assert.match(result.rows[0].source_record_hash,/^sha256:[0-9a-f]{64}$/);assert.equal(JSON.stringify(result).includes('private-ap-id'),false);
  for(const flag of ['can_import','can_create_transaction','can_match','can_allocate','can_create_draft','can_approve','can_post','can_reverse'])assert.equal(result[flag],false);
  assert.equal(assertWbsLivePilotResult(result,{entityId,tool:'list_payables',limit:1}),result);
});

test('each tool exposes only its frozen row contract and never a provider stable identifier',async()=>{
  const fixtures={
    list_bank_transactions:{row:{cb_id:'bank-private',posting_date:'2026-08-10',debtor:'4',lender:'0',review:'READY'},keys:['source_record_hash','currency','accounting_date','amount','direction','status']},
    list_autorec_details:{row:{pd_guid:'detail-private',incurred_date:'2026-08-09',payment:'2',deposit:'3.25',status:'OPEN',match_status:'UNMATCHED'},keys:['source_record_hash','currency','accounting_date','payment_amount','deposit_amount','status','match_status']},
    list_autorec_banks:{row:{pb_guid:'autorec-private',pay_amount:'1',debit_amount:'2',quantity:'3',released:'4',released_quantity:'5',incurred:'6',status:'READY'},keys:['source_record_hash','currency','pay_amount','debit_amount','quantity','released_amount','released_quantity','incurred_amount','status']},
    list_journal_entries:{row:{id:7,posting_date:'2026-08-08',debtor:'9',lender:'10',review:'PENDING'},keys:['source_record_hash','currency','accounting_date','debit_amount','credit_amount','review_status']}
  };
  for(const [tool,{row,keys}] of Object.entries(fixtures)){
    const client={initialize:async()=>{},listTools:async()=>{},readView:async()=>observed({tool,rows:[row]})};
    const result=await createWbsLivePilotReadService({client,authorize:async()=>{}}).readObservation({tenantId,entityId,tool,limit:1});
    assert.deepEqual(Object.keys(result.rows[0]),keys);assert.equal(JSON.stringify(result.rows[0]).includes('private'),false);
  }
});

test('unsafe provider observations fail closed and cannot be asserted as API results',async()=>{
  const client={initialize:async()=>{},listTools:async()=>{},readView:async()=>observed({rows:[{amount:'1.0'}]})};
  await assert.rejects(createWbsLivePilotReadService({client,authorize:async()=>{}}).readObservation({tenantId,entityId,tool:'list_payables',limit:1}),error=>error.code==='WBS_LIVE_PILOT_ROW_KEY_INVALID');
  assert.throws(()=>assertWbsLivePilotResult({},{entityId,tool:'list_payables',limit:1}),error=>error.code==='WBS_LIVE_PILOT_RESULT_INVALID');
});

test('provider initialization and catalog failures map to stable unavailable errors after authorization',async()=>{
  for(const method of ['initialize','listTools']){
    let authorized=0;
    const client={initialize:async()=>{if(method==='initialize')throw new Error('credential detail');},listTools:async()=>{if(method==='listTools')throw new Error('catalog detail');},readView:async()=>observed()};
    const service=createWbsLivePilotReadService({client,authorize:async()=>{authorized++;}});
    await assert.rejects(service.readObservation({tenantId,entityId,tool:'list_payables',limit:1}),error=>error.code==='WBS_LIVE_PILOT_PROVIDER_UNAVAILABLE'&&!error.message.includes('detail'));
    assert.equal(authorized,1);
  }
});
