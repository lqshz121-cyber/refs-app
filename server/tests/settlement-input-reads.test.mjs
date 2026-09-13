import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createAccountingApi} from '../api/accounting-http.mjs';
import {validSettlementBankPage,validSettlementContext} from '../runtime/settlement-input-reads.mjs';
import {validSettlementBankAccountPairPage} from '../runtime/settlement-bank-account-pairs.mjs';
const tenantId='11111111-1111-4111-8111-111111111111',entityId='22222222-2222-4222-8222-222222222222';
const businessDocumentId='33333333-3333-4333-8333-333333333333',periodId='44444444-4444-4444-8444-444444444444';
const scope={entityId,businessDocumentId,periodId,settlementKind:'AP_PAYMENT'};
const bankPath=`/api/v1/entities/${entityId}/settlements/draft-bank-members`;
const pairPath=`/api/v1/entities/${entityId}/settlements/draft-bank-account-pairs`;
const contextPath=`/api/v1/entities/${entityId}/business-documents/${businessDocumentId}/settlement-context`;
const page=s=>({schema_version:'SETTLEMENT_BANK_MEMBERS_V1',entity_id:entityId,settlement_kind:s.settlementKind,query:s.query,after_ref:s.afterRef,limit:s.limit,rows:[],next_ref:null});
const pairPage=s=>({schema_version:'SETTLEMENT_BANK_ACCOUNT_PAIRS_V1',entity_id:entityId,settlement_kind:s.settlementKind,period_id:s.periodId,settlement_date:s.settlementDate,query:s.query,after_ref:s.afterRef,limit:s.limit,rows:[],next_ref:null});
const context=(kind='AP_PAYMENT')=>({schema_version:'SETTLEMENT_CONTEXT_V1',entity_id:entityId,settlement_kind:kind,
  payment_period:{period_id:periodId,starts_on:'2026-08-01',ends_on:'2026-08-31',status:'OPEN',revision:'0'},
  document:{business_document_id:businessDocumentId,document_kind:kind==='AP_PAYMENT'?'AP_BILL':'AR_INVOICE',document_number:'DOC-1',counterparty_ref:'PARTY-1',counterparty_name:'Counterparty',currency:'USD',accounting_date:'2026-07-15',due_date:null,status:'OPEN',revision:'1',open_balance:'100.0000'},
  pending_allocation_amount:'30.0000',available_amount:'70.0000',can_create_draft:true});
const apiFor=kernel=>createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'maker'}),kernelFactory:async()=>kernel});
const get=(api,url,patch={})=>api({method:'GET',url,body:null,headers:{},...patch});

test('refund bank selection is scoped independently from invoice receipt context',async()=>{
  const calls=[],api=apiFor({readSettlementBankMembers:async args=>(calls.push(args),page(args))});
  const result=await get(api,bankPath+'?kind=AR_REFUND');
  assert.equal(result.status,200);assert.equal(result.body.data.settlement_kind,'AR_REFUND');
  assert.deepEqual(calls,[{tenantId,entityId,settlementKind:'AR_REFUND',query:'',afterRef:null,limit:50}]);
  assert.equal((await get(api,contextPath+`?kind=AR_REFUND&periodId=${periodId}`)).status,400);
  assert.equal((await get(apiFor({readSettlementBankMembers:async args=>page({...args,settlementKind:'AR_RECEIPT'})}),bankPath+'?kind=AR_REFUND')).status,500);
});

test('settlement input GETs derive tenant identity and preserve exact selection without accepting command inputs',async()=>{
  const calls=[],api=apiFor({readSettlementBankMembers:async args=>(calls.push(args),page(args)),readSettlementContext:async args=>(calls.push(args),context(args.settlementKind))});
  const response=await get(api,bankPath+'?kind=AP_PAYMENT&query=50%25_&afterRef=B-1&limit=25');
  assert.equal(response.status,200);assert.equal(response.headers['cache-control'],'no-store');
  assert.deepEqual(calls[0],{tenantId,entityId,settlementKind:'AP_PAYMENT',query:'50%_',afterRef:'B-1',limit:25});
  for(const kind of ['AP_PAYMENT','AR_RECEIPT']){
    const read=await get(api,contextPath+`?kind=${kind}&periodId=${periodId}`);
    assert.equal(read.status,200);assert.equal(read.headers['cache-control'],'no-store');assert.deepEqual(read.body.data,context(kind));
    assert.deepEqual(calls.at(-1),{tenantId,...scope,settlementKind:kind});
  }
  const count=calls.length;
  for(const suffix of ['', '?kind=AP_PAYMENT&kind=AR_RECEIPT','?kind=AP_BILL','?kind=AP_PAYMENT&limit=0','?kind=AP_PAYMENT&limit=101','?kind=AP_PAYMENT&limit=1e1','?kind=AP_PAYMENT&limit=01','?kind=AP_PAYMENT&afterRef=','?kind=AP_PAYMENT&query=%0A','?kind=AP_PAYMENT&query=%20bank','?kind=AP_PAYMENT&tenantId=spoof','?kind=AP_PAYMENT&query='+'a'.repeat(129)])assert.equal((await get(api,bankPath+suffix)).status,400,suffix);
  for(const suffix of ['', '?kind=AP_PAYMENT',`?kind=BAD&periodId=${periodId}`,`?kind=AP_PAYMENT&periodId=bad`,`?kind=AP_PAYMENT&periodId=${periodId}&periodId=${periodId}`,`?kind=AP_PAYMENT&periodId=${periodId}&actorId=spoof`])assert.equal((await get(api,contextPath+suffix)).status,400,suffix);
  for(const url of [bankPath+'?kind=AP_PAYMENT',contextPath+`?kind=AP_PAYMENT&periodId=${periodId}`]){
    for(const patch of [{body:{}},{headers:{'idempotency-key':'not-a-command'}},{headers:{'if-match':'"1"'}}])assert.equal((await get(api,url,patch)).status,400);
  }
  assert.equal(calls.length,count,'invalid reads do not reach kernel methods');
});

test('bank-account pair reads bind the open payment period and date without changing refund bank selection',async()=>{
  const calls=[],api=apiFor({readSettlementBankAccountPairs:async args=>(calls.push(args),pairPage(args))});
  const url=pairPath+`?kind=AP_PAYMENT&periodId=${periodId}&settlementDate=2026-08-10&query=Operating&afterRef=WyJCQU5LMSJd&limit=25`;
  const response=await get(api,url);
  assert.equal(response.status,200);assert.equal(response.headers['cache-control'],'no-store');
  assert.deepEqual(calls,[{tenantId,entityId,settlementKind:'AP_PAYMENT',periodId,settlementDate:'2026-08-10',query:'Operating',afterRef:'WyJCQU5LMSJd',limit:25}]);
  for(const suffix of ['',`?kind=AR_REFUND&periodId=${periodId}&settlementDate=2026-08-10`,`?kind=AP_PAYMENT&periodId=${periodId}`,`?kind=AP_PAYMENT&periodId=${periodId}&settlementDate=2026-02-30`,`?kind=AP_PAYMENT&periodId=bad&settlementDate=2026-08-10`,`?kind=AP_PAYMENT&periodId=${periodId}&settlementDate=2026-08-10&afterRef=`,`?kind=AP_PAYMENT&periodId=${periodId}&settlementDate=2026-08-10&limit=101`])assert.equal((await get(api,pairPath+suffix)).status,400,suffix);
  for(const patch of [{body:{}},{headers:{'idempotency-key':'forbidden'}},{headers:{'if-match':'"1"'}}])assert.equal((await get(api,pairPath+`?kind=AP_PAYMENT&periodId=${periodId}&settlementDate=2026-08-10`,patch)).status,400);
  assert.equal((await get(apiFor({}),pairPath+`?kind=AP_PAYMENT&periodId=${periodId}&settlementDate=2026-08-10`)).status,503);
});

test('bank-account pair pages reject scope, period, date, currency and cursor drift',async()=>{
  const selection={entityId,settlementKind:'AP_PAYMENT',periodId,settlementDate:'2026-08-10',query:'',afterRef:null,limit:1};
  const pair={pair_ref:'WyJCQU5LMSIsIjEwMDEwMCIsIlVTRCJd',member_ref:'BANK1',member_type:'BANK',display_name:'Operating bank',cash_account_code:'100100',cash_account_name:'Operating bank',currency:'USD'};
  const good={...pairPage(selection),rows:[pair],next_ref:pair.pair_ref};
  assert.equal(validSettlementBankAccountPairPage(good,selection),true);
  for(const bad of [{...good,entity_id:tenantId},{...good,period_id:businessDocumentId},{...good,settlement_date:'2026-08-11'},{...good,next_ref:'other'},{...good,rows:[{...pair,currency:'usd'}]},{...good,rows:[{...pair,member_type:'VENDOR'}]},{...good,extra:true}])assert.equal(validSettlementBankAccountPairPage(bad,selection),false);
  const api=apiFor({readSettlementBankAccountPairs:async()=>({...good,rows:[{...pair,currency:'usd'}]})});
  assert.equal((await get(api,pairPath+`?kind=AP_PAYMENT&periodId=${periodId}&settlementDate=2026-08-10&limit=1`)).status,500);
});

test('reconciliation adjustment attachment candidate reads are entity-derived, read-only and bounded',async()=>{
  const attachmentId='55555555-5555-4555-8555-555555555555';
  const candidate={schema_version:'RECONCILIATION_ADJUSTMENT_ATTACHMENT_CANDIDATES_V1',entity_id:entityId,attachments:[{attachment_id:attachmentId,name:'statement.pdf',media_type:'application/pdf',verified_at:'2026-08-10T10:00:00.000Z'}]};
  const calls=[],api=apiFor({readReconciliationAdjustmentAttachmentCandidates:async args=>(calls.push(args),candidate)});
  const path=`/api/v1/entities/${entityId}/bank/reconciliation-adjustment-attachments`;
  const response=await get(api,path+'?limit=25');
  assert.equal(response.status,200);assert.equal(response.headers['cache-control'],'no-store');assert.deepEqual(calls,[{tenantId,entityId,limit:25}]);
  for(const suffix of ['?limit=0','?limit=101','?limit=01','?limit=1e1','?limit=25&limit=25','?limit=25&tenantId=spoof'])assert.equal((await get(api,path+suffix)).status,400,suffix);
  for(const patch of [{body:{}},{headers:{'idempotency-key':'forbidden'}},{headers:{'if-match':'"1"'}}])assert.equal((await get(api,path+'?limit=25',patch)).status,400);
  assert.equal((await get(apiFor({}),path+'?limit=25')).status,503);
});

test('bank page validation rejects scope/type/cursor drift and uses database C byte ordering',async()=>{
  const selection={entityId,settlementKind:'AP_PAYMENT',query:'',afterRef:null,limit:2};
  const a={member_ref:'B-1',member_type:'BANK',display_name:'Bank one'},b={...a,member_ref:'B-2'};
  const good={...page(selection),rows:[a,b],next_ref:'B-2'};
  assert.equal(validSettlementBankPage(good,selection),true);
  for(const bad of [{...good,entity_id:tenantId},{...good,settlement_kind:'AR_RECEIPT'},{...good,query:'changed'},{...good,after_ref:'B-0'},
    {...good,limit:3},{...good,next_ref:'B-3'},{...good,rows:[a]},{...good,rows:[b,a]},{...good,rows:[a,a]},
    {...good,rows:[{...a,member_type:'VENDOR'},b]},{...good,can_post:true}]){
    assert.equal(validSettlementBankPage(bad,selection),false);
    assert.equal((await get(apiFor({readSettlementBankMembers:async()=>bad}),bankPath+'?kind=AP_PAYMENT&limit=2')).status,500);
  }
  const unicode={...good,rows:[{...a,member_ref:'\uE000'},{...b,member_ref:'\u{10000}'}],next_ref:null};
  assert.equal(validSettlementBankPage(unicode,selection),true,'UTF-8 order differs from UTF-16 code unit order');
  assert.equal(validSettlementBankPage({...good,after_ref:'B-1'},{...selection,afterRef:'B-1'}),false);
});

test('context validates exact decimal arithmetic, actual payment period and command eligibility for both source kinds',async()=>{
  for(const kind of ['AP_PAYMENT','AR_RECEIPT']){
    const selected={...scope,settlementKind:kind},good=context(kind);
    assert.equal(validSettlementContext(good,selected),true,'older source date is allowed');
    for(const bad of [{...good,entity_id:tenantId},{...good,settlement_kind:'UNKNOWN'},{...good,available_amount:'71.0000'},
      {...good,pending_allocation_amount:30},{...good,can_create_draft:false},{...good,extra:true},
      {...good,document:{...good.document,business_document_id:periodId}},{...good,document:{...good.document,revision:1}},
      {...good,document:{...good.document,status:'DRAFT'}},{...good,payment_period:{...good.payment_period,period_id:businessDocumentId}},
      {...good,payment_period:{...good.payment_period,starts_on:'2026-02-30'}},{...good,payment_period:{...good.payment_period,status:'CLOSED'}}]){
      assert.equal(validSettlementContext(bad,selected),false);
      assert.equal((await get(apiFor({readSettlementContext:async()=>bad}),contextPath+`?kind=${kind}&periodId=${periodId}`)).status,500);
    }
    for(const status of ['DRAFT','PENDING_POST','PAID','VOID','REVERSED'])assert.equal(validSettlementContext({...good,document:{...good.document,status},can_create_draft:false},selected),true);
    assert.equal(validSettlementContext({...good,document:{...good.document,status:'APPROVED'},can_create_draft:kind==='AP_PAYMENT'},selected),true);
    assert.equal(validSettlementContext({...good,payment_period:{...good.payment_period,status:'CLOSED'},can_create_draft:false},selected),true);
    assert.equal(validSettlementContext({...good,pending_allocation_amount:'101.0000',available_amount:'-1.0000',can_create_draft:false},selected),true,'negative capacity must remain visible and ineligible');
    assert.equal(validSettlementContext({...good,pending_allocation_amount:'100.0000',available_amount:'0.0000',can_create_draft:false},selected),true);
    assert.equal(validSettlementContext({...good,document:{...good.document,open_balance:'9999999999999999.9999'},pending_allocation_amount:'9999999999999999.9998',available_amount:'0.0001'},selected),true,'do not round monetary values through Number');
  }
});

test('absent input readers fail closed and OpenAPI documents bounded maker-only reads',async()=>{
  assert.equal((await get(apiFor({}),bankPath+'?kind=AP_PAYMENT')).status,503);
  assert.equal((await get(apiFor({}),contextPath+`?kind=AP_PAYMENT&periodId=${periodId}`)).status,503);
  const doc=JSON.parse(await readFile(new URL('../api/openapi-accounting.json',import.meta.url),'utf8'));
  for(const path of ['/entities/{entityId}/settlements/draft-bank-members','/entities/{entityId}/settlements/draft-bank-account-pairs','/entities/{entityId}/business-documents/{businessDocumentId}/settlement-context']){
    const route=doc.paths[path];assert.deepEqual(Object.keys(route),['get']);
    assert.match(route.get.description,/AP\.PAYMENT\.CREATE/);assert.match(route.get.description,/AR\.RECEIPT\.CREATE/);
    assert.equal(route.get.responses['200'].headers['Cache-Control'].schema.const,'no-store');
  }
  assert.equal(doc.paths['/entities/{entityId}/settlements/draft-bank-members'].get.parameters.find(p=>p.name==='limit').schema.maximum,100);
  assert.equal(doc.paths['/entities/{entityId}/settlements/draft-bank-account-pairs'].get.parameters.find(p=>p.name==='limit').schema.maximum,100);
});
