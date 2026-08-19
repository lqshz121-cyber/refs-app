import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalRequestHash} from '../runtime/request-hash.mjs';
import {assertWbsLivePilotResult,buildWbsLivePilotObservation,createWbsLivePilotReadService,parseWbsLivePilotSelection,WBS_LIVE_PILOT_TOOLS} from '../runtime/wbs-live-pilot-read-service.mjs';

const tenantId='6fb25daf-0799-4805-bede-be54230da33c',entityId='ca8d23c7-0ea6-4860-8e3e-caf9a3e22ce3';
const observed=({tool='list_payables',rows=[{ap_guid:'private-ap-id',posting_date:'2026-08-11',amount:'12.3',pay_status:'Clear'}],scope={company_codes:[],date_range:['2026-08-01','2026-08-11']}}={})=>({tool_name:tool,contract_version:'WBS-REFS-MCP-V1',environment:'production',captured_at:'2026-08-11T10:00:00.000Z',scope,record_count:rows.length,content_sha256:canonicalRequestHash(rows).slice(7),cursor_next:null,rows});

test('pilot query requires one fixed tool and one bounded limit',()=>{
  assert.deepEqual(parseWbsLivePilotSelection(new URLSearchParams('tool=list_payables&limit=10')),{tool:'list_payables',limit:10,company_code:null,date_from:null,date_to:null});
  assert.deepEqual(parseWbsLivePilotSelection(new URLSearchParams('tool=list_payables&limit=10&company_code=WBPA&date_from=2026-01-01&date_to=2026-12-31')),{tool:'list_payables',limit:10,company_code:'WBPA',date_from:'2026-01-01',date_to:'2026-12-31'});
    for(const query of ['tool=list_payables&limit=1&company_code=WBPA&company_code=WBPA','tool=list_payables&limit=1&date_from=2026-01-01','tool=list_payables&limit=1&date_from=2026-02-31&date_to=2026-12-31','tool=list_payables&limit=1&date_from=2026-12-31&date_to=2026-01-01','tool=list_autorec_details&limit=1&company_code=WBPA','tool=list_autorec_banks&limit=1&date_from=2026-01-01&date_to=2026-12-31'])assert.throws(()=>parseWbsLivePilotSelection(new URLSearchParams(query)));
  assert.deepEqual(parseWbsLivePilotSelection(new URLSearchParams('tool=list_journal_entries&limit=1&company_code=WBPA&date_from=2026-01-01&date_to=2026-12-31')),{tool:'list_journal_entries',limit:1,company_code:'WBPA',date_from:'2026-01-01',date_to:'2026-12-31'});
  assert.deepEqual(parseWbsLivePilotSelection(new URLSearchParams('tool=list_autorec_details&limit=1&date_from=2026-01-01&date_to=2026-12-31')),{tool:'list_autorec_details',limit:1,company_code:null,date_from:'2026-01-01',date_to:'2026-12-31'});
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

test('live pilot passes server-requested company/date scope to the provider unchanged',async()=>{
  const calls=[];
  const client={initialize:async()=>{},listTools:async()=>{},readView:async request=>{calls.push(request);return observed({scope:{company_codes:['WBPA'],date_range:['2026-01-01','2026-12-31']}});}};
  const service=createWbsLivePilotReadService({client,authorize:async()=>{}});
  await service.readObservation({tenantId:'tenant',entityId:'entity',tool:'list_payables',limit:10,company_code:'WBPA',date_from:'2026-01-01',date_to:'2026-12-31'});
  assert.deepEqual(calls,[{toolName:'list_payables',args:{limit:10,company_code:'WBPA',incurred_date_from:'2026-01-01',incurred_date_to:'2026-12-31',posting_date_from:'2026-01-01',posting_date_to:'2026-12-31'}}]);
});

test('paged live pilot preserves the sanitized observation while carrying only the opaque provider cursor beside it',async()=>{
  const calls=[];const client={initialize:async()=>{},listTools:async()=>{},readView:async request=>(calls.push(request),{...observed({scope:{company_codes:['WBPA'],date_range:['2026-01-01','2026-06-30']}}),cursor_next:'opaque-page-3'})};
  const service=createWbsLivePilotReadService({client,authorize:async()=>{}});
  const page=await service.readObservationPage({tenantId,entityId,tool:'list_payables',limit:10,company_code:'WBPA',date_from:'2026-01-01',date_to:'2026-06-30',cursor:'opaque-page-2'});
  assert.deepEqual(Object.keys(page).sort(),['cursor_next','observation']);assert.equal(page.cursor_next,'opaque-page-3');assert.equal(Object.hasOwn(page.observation,'cursor_next'),false);assert.equal(page.observation.rows[0].accounting_date,'2026-08-11');
  assert.deepEqual(calls[0].args,{limit:10,company_code:'WBPA',incurred_date_from:'2026-01-01',incurred_date_to:'2026-06-30',posting_date_from:'2026-01-01',posting_date_to:'2026-06-30',cursor:'opaque-page-2'});
  await assert.rejects(service.readObservationPage({tenantId,entityId,tool:'list_payables',limit:10,cursor:'bad\nvalue'}),error=>error.code==='WBS_LIVE_PILOT_SELECTION_INVALID');
});

test('live pilot maps each provider view to its published company/date fields',async()=>{
  const calls=[];
  const make=(tool,selection,providerScope)=>createWbsLivePilotReadService({client:{initialize:async()=>{},listTools:async()=>{},readView:async request=>{calls.push(request);return observed({tool,scope:providerScope,rows:[]});}},authorize:async()=>{}}).readObservation({tenantId:'tenant',entityId:'entity',tool,limit:1,...selection});
  await make('list_bank_transactions',{company_code:'WBPA',date_from:'2026-01-01',date_to:'2026-12-31'},{company_codes:['WBPA'],date_range:['2026-01-01','2026-12-31']});
  await make('list_journal_entries',{company_code:'WBPA',date_from:'2026-01-01',date_to:'2026-12-31'},{company_codes:['WBPA'],date_range:['2026-01-01','2026-12-31']});
  await make('list_autorec_details',{date_from:'2026-01-01',date_to:'2026-12-31'},{company_codes:[],date_range:['2026-01-01','2026-12-31']});
  await make('list_autorec_banks',{company_code:'WBPA'},{company_codes:['WBPA'],date_range:[null,null]});
  assert.deepEqual(calls.map(call=>call.args),[
    {limit:1,company_code:'WBPA',set_date_from:'2026-01-01',set_date_to:'2026-12-31'},
    {limit:1,company:'WBPA',posting_date_from:'2026-01-01',posting_date_to:'2026-12-31'},
    {limit:1,clear_date_from:'2026-01-01',clear_date_to:'2026-12-31'},
    {limit:1,company_code:'WBPA'},
  ]);
});

test('live pilot rejects a provider response that ignores requested company/date scope',async()=>{
  const client={initialize:async()=>{},listTools:async()=>{},readView:async()=>observed({scope:{company_codes:['OTHER'],date_range:['2026-01-01','2026-12-31']}})};
  const service=createWbsLivePilotReadService({client,authorize:async()=>{}});
  await assert.rejects(()=>service.readObservation({tenantId:'tenant',entityId:'entity',tool:'list_payables',limit:10,company_code:'WBPA',date_from:'2026-01-01',date_to:'2026-12-31'}),error=>error.code==='WBS_LIVE_PILOT_SCOPE_MISMATCH');
});

test('observation hash remains stable when the same provider facts are captured at different instants',()=>{
  const first=observed({});
  const second={...first,captured_at:'2026-08-11T10:00:02.000Z'};
  const firstObservation=buildWbsLivePilotObservation({observed:first,entityId,tool:'list_payables'});
  const secondObservation=buildWbsLivePilotObservation({observed:second,entityId,tool:'list_payables'});
  assert.notEqual(firstObservation.captured_at,secondObservation.captured_at);
  assert.equal(firstObservation.provider_content_sha256,secondObservation.provider_content_sha256);
  assert.equal(firstObservation.observation_hash,secondObservation.observation_hash);
});

test('each tool exposes only its frozen row contract and never a provider stable identifier',async()=>{
  const fixtures={
    list_bank_transactions:{row:{cb_id:'bank-private',posting_date:'2026-08-10',debtor:'4',lender:'0',review:'READY'},keys:['source_record_hash','currency','accounting_date','amount','direction','status']},
    list_autorec_details:{row:{pd_guid:'detail-private',incurred_date:'2026-08-09',payment:'2',deposit:'3.25',status:'OPEN',match_status:'UNMATCHED'},keys:['source_record_hash','currency','accounting_date','payment_amount','deposit_amount','status','match_status']},
    list_autorec_banks:{row:{pb_guid:'autorec-private',pay_amount:'1',debit_amount:'2',quantity:'3',released:'4',released_quantity:'5',incurred:'6',status:'READY'},keys:['source_record_hash','currency','pay_amount','debit_amount','quantity','released_amount','released_quantity','incurred_amount','status']},
    list_journal_entries:{row:{id:7,posting_date:'2026-08-08 04:05:06',debtor:'9.25',lender:'10.00',review:'0'},keys:['source_record_hash','currency','accounting_date','debit_amount','credit_amount','review_status']}
  };
  for(const [tool,{row,keys}] of Object.entries(fixtures)){
    const client={initialize:async()=>{},listTools:async()=>{},readView:async()=>observed({tool,rows:[row]})};
    const result=await createWbsLivePilotReadService({client,authorize:async()=>{}}).readObservation({tenantId,entityId,tool,limit:1});
    assert.deepEqual(Object.keys(result.rows[0]),keys);assert.equal(JSON.stringify(result.rows[0]).includes('private'),false);
    if(tool==='list_journal_entries')assert.deepEqual(result.rows[0],{source_record_hash:result.rows[0].source_record_hash,currency:'USD',accounting_date:'2026-08-08',debit_amount:'9.2500',credit_amount:'10.0000',review_status:'CODE_0'});
  }
});

test('live journal dates are timezone-independent and invalid SQL timestamps remain blocked',async()=>{
  for(const posting_date of ['2026-08-08','2026-08-08 04:05:06','2026-08-08T04:05:06','2026-08-08T04:05:06Z','2026-08-08T04:05:06+08:00']){
    const client={initialize:async()=>{},listTools:async()=>{},readView:async()=>observed({tool:'list_journal_entries',rows:[{id:7,posting_date,debtor:'9.25',lender:'0.00',review:'0'}]})};
    const result=await createWbsLivePilotReadService({client,authorize:async()=>{}}).readObservation({tenantId,entityId,tool:'list_journal_entries',limit:1});
    assert.equal(result.rows[0].accounting_date,'2026-08-08',posting_date);
  }
  for(const posting_date of ['2026-02-30 04:05:06','2026-08-08 24:00:00','2026-08-08 04:60:00','2026-08-08 04:05']){
    const client={initialize:async()=>{},listTools:async()=>{},readView:async()=>observed({tool:'list_journal_entries',rows:[{id:7,posting_date,debtor:'9.25',lender:'0.00',review:'0'}]})};
    const result=await createWbsLivePilotReadService({client,authorize:async()=>{}}).readObservation({tenantId,entityId,tool:'list_journal_entries',limit:1});
    assert.equal(Object.hasOwn(result.rows[0],'accounting_date'),false,posting_date);
  }
});

test('AutoRec bank rows retain a closed schema when the provider omits a numeric observation',async()=>{
  const row={pb_guid:'provider-row-redacted',pay_amount:'100.00000',debit_amount:'0.00000',quantity:'2.00000',released:'50.00000',released_quantity:null,incurred:'25.00000',status:'N'};
  const client={initialize:async()=>{},listTools:async()=>{},readView:async()=>observed({tool:'list_autorec_banks',rows:[row]})};
  const result=await createWbsLivePilotReadService({client,authorize:async()=>{}}).readObservation({tenantId,entityId,tool:'list_autorec_banks',limit:1});
  assert.deepEqual(Object.keys(result.rows[0]),['source_record_hash','currency','pay_amount','debit_amount','quantity','released_amount','released_quantity','incurred_amount','status']);
  assert.equal(result.rows[0].released_quantity,null);assert.equal(result.rows[0].pay_amount,'100.0000');assert.equal(result.rows[0].status,'N');assert.equal(JSON.stringify(result).includes('provider-row-redacted'),false);
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
