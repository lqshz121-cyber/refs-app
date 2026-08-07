import assert from 'node:assert/strict';
import {accountingApiConfig,applyAuthoritativeCredit,createAuthoritativeAdjustment,createAuthoritativeBusinessDocument,createAuthoritativeSettlement,refreshAuthoritativeBankTransactions,refreshAuthoritativeDocuments,refreshAuthoritativeJournalEntries,refreshAuthoritativeReconciliation,transitionAuthoritativeJournal,refreshAuthoritativeAging,refreshAuthoritativeControlTotals} from '../src/accounting-api.js';
const entityId='11111111-1111-4111-8111-111111111111';
const periodId='33333333-3333-4333-8333-333333333333';
assert.equal(accountingApiConfig({__REFS_ACCOUNTING_API__:{baseUrl:'http://unsafe.example',entityId,periodId}}),null);
const accessToken='a'.repeat(48);assert.equal(accountingApiConfig({__REFS_ACCOUNTING_API__:{baseUrl:'https://api.example/',entityId,periodId}}),null);
const configured=accountingApiConfig({__REFS_ACCOUNTING_API__:{baseUrl:'https://api.example/',entityId,periodId,cashAccountCode:'111000',getAccessToken:async()=>accessToken}});
assert.equal(configured.baseUrl,'https://api.example');assert.equal(configured.cashAccountCode,'111000');
assert.equal(accountingApiConfig({__REFS_ACCOUNTING_API__:{baseUrl:'https://api.example/',entityId,periodId,cashAccountCode:'cash account',getAccessToken:async()=>accessToken}}).cashAccountCode,null);
const rows={'/ap/bills':[{business_document_id:entityId,document_number:'B-1',counterparty_ref:'V-1',counterparty_name:'Vendor',currency:'USD',accounting_date:'2026-08-01',due_date:'2026-08-31',gross_amount:'10.2500',open_balance:'7.2500',status:'PARTIALLY_PAID',posted_journal_entry_id:null,version:3}],'/ar/invoices':[{business_document_id:'22222222-2222-4222-8222-222222222222',document_number:'I-1',counterparty_ref:'C-1',counterparty_name:'Customer',currency:'USD',accounting_date:'2026-08-01',due_date:null,gross_amount:'8.0000',open_balance:'8.0000',status:'OPEN',posted_journal_entry_id:null,version:0}],'/ap/adjustments':[{business_adjustment_id:entityId,adjustment_kind:'AP_VENDOR_CREDIT',amount:'3.0000',status:'DRAFT'}],'/ar/adjustments':[{business_adjustment_id:'22222222-2222-4222-8222-222222222222',adjustment_kind:'AR_CREDIT_MEMO',amount:'2.0000',status:'POSTED'}]};
const config=configured;
(async()=>{
  const readCalls=[];const result=await refreshAuthoritativeDocuments({config,fetcher:async(url,options)=>{readCalls.push({url,options});return {ok:true,json:async()=>({ok:true,data:rows[new URL(url).pathname.replace(`/api/v1/entities/${entityId}`,'')]})};}});
  assert.equal(result.ok,true);assert.equal(result.ap.bills[0].business_document_id,entityId);assert.equal(result.ap.bills[0].open_balance,7.25);assert.equal(result.ar.invoices[0].business_document_id,'22222222-2222-4222-8222-222222222222');assert.equal(result.ar.invoices[0].inv_no,'I-1');assert.equal(result.ap.adjustments[0].adjustment_kind,'AP_VENDOR_CREDIT');assert.equal(result.ar.adjustments[0].status,'POSTED');
  assert.equal(readCalls.length,4);for(const read of readCalls){assert.equal(read.options.method,'GET');assert.equal(read.options.credentials,'include');assert.equal(read.options.cache,'no-store');assert.equal(read.options.headers.authorization,`Bearer ${accessToken}`);}
  const journalRead=await refreshAuthoritativeJournalEntries({config,fetcher:async(url,options)=>{assert.match(url,/\/journal-entries$/);assert.equal(options.method,'GET');assert.equal(options.cache,'no-store');return {ok:true,json:async()=>({ok:true,data:[{journal_entry_id:entityId,journal_number:'JE-1',journal_type:'MANUAL',status:'DRAFT',journal_date:'2026-08-01',currency:'USD',revision:'2',created_at:'2026-08-01T00:00:00.000Z',posted_at:null,ledger_line_count:'0'}]})};}});
  assert.equal(journalRead.ok,true);assert.equal(journalRead.journals[0].revision,2);assert.equal(journalRead.journals[0].ledger_line_count,0);
  let bankCall;const bankRead=await refreshAuthoritativeBankTransactions({config,bankAccountRef:'BANK-1',from:'2026-07-01',through:'2026-07-31',limit:25,fetcher:async(url,options)=>{bankCall={url,options};return {ok:true,json:async()=>({ok:true,data:[{bank_source_id:entityId,bank_account_ref:'BANK-1',external_bank_line_id:'BANK-LINE-1',transaction_date:'2026-07-15',currency:'USD',amount:'-125.2500',version:'3',source_document_id:'22222222-2222-4222-8222-222222222222',source_ref:'SOURCE-1',document_type:'BANK_TRANSACTION',bank_match_id:null,match_status:null,business_source_document_id:null,journal_entry_id:null,journal_line_id:null,candidate_rule_code:null,amount_delta:null,currency_match:null,date_delta_days:null,matched_by:null,matched_at:null,match_version:null}]})};}});
  assert.equal(bankRead.ok,true);assert.equal(bankRead.rows[0].amount,-125.25);assert.equal(bankRead.rows[0].version,3);assert.match(bankCall.url,/\/bank\/transactions\?bankAccountRef=BANK-1&limit=25&from=2026-07-01&through=2026-07-31$/);assert.equal(bankCall.options.method,'GET');assert.equal(bankCall.options.cache,'no-store');assert.equal(bankCall.options.headers.authorization,`Bearer ${accessToken}`);assert.equal('body' in bankCall.options,false);
  let reconciliationCall;const reconciliationRead=await refreshAuthoritativeReconciliation({config,bankAccountRef:'BANK-1',statementEndingDate:'2026-07-31',fetcher:async(url,options)=>{reconciliationCall={url,options};return {ok:true,json:async()=>({ok:true,data:[{reconciliation_id:entityId,bank_account_ref:'BANK-1',statement_ending_date:'2026-07-31',statement_ending_balance:'1000.0000',difference:'0.0000',status:'RECONCILED',version:'4',reconciled_by:'controller',reconciled_at:'2026-08-01T00:00:00.000Z',reopened_by:null,reopened_at:null,bank_transaction_count:'6',active_match_count:'5',unmatched_transaction_count:'1',statement_activity_amount:'250.0000'}]})};}});
  assert.equal(reconciliationRead.ok,true);assert.equal(reconciliationRead.row.bank_transaction_count,6);assert.match(reconciliationCall.url,/\/bank\/reconciliation\?bankAccountRef=BANK-1&statementEndingDate=2026-07-31$/);assert.equal(reconciliationCall.options.method,'GET');assert.equal(reconciliationCall.options.headers.authorization,`Bearer ${accessToken}`);assert.equal('body' in reconciliationCall.options,false);
  assert.equal((await refreshAuthoritativeBankTransactions({config,bankAccountRef:'',fetcher:async()=>{throw new Error('must not call');}})).code,'ACCOUNTING_API_SCOPE_INVALID');
  assert.equal((await refreshAuthoritativeBankTransactions({config,bankAccountRef:'BANK-1',from:'2026-08-01',through:'2026-07-31',fetcher:async()=>{throw new Error('must not call');}})).code,'ACCOUNTING_API_SCOPE_INVALID');
  assert.equal((await refreshAuthoritativeReconciliation({config,bankAccountRef:'BANK-1',statementEndingDate:'2026-02-30',fetcher:async()=>{throw new Error('must not call');}})).code,'ACCOUNTING_API_SCOPE_INVALID');
  const attachmentId='44444444-4444-4444-8444-444444444444';let call;const created=await createAuthoritativeBusinessDocument({config,kind:'AP_BILL',idempotencyKey:'AP-BILL-request-0001',document:{documentNumber:'B-2',counterpartyRef:'V-2',counterpartyName:'Vendor 2',currency:'USD',accountingDate:'2026-08-01',dueDate:'2026-08-31',amount:3,offsetAccountCode:'641600',attachmentIds:[attachmentId]},fetcher:async(url,options)=>{call={url,options};return {ok:true,status:201,json:async()=>({ok:true,data:{business_document_id:entityId,status:'DRAFT'}})};}});
  assert.equal(created.ok,true);assert.match(call.url,/\/ap\/bills$/);assert.equal(call.options.credentials,'include');assert.equal(call.options.headers.authorization,`Bearer ${accessToken}`);assert.equal(call.options.headers['idempotency-key'],'AP-BILL-request-0001');assert.equal(JSON.parse(call.options.body).periodId,periodId);assert.deepEqual(JSON.parse(call.options.body).attachmentIds,[attachmentId]);
  const paid=await createAuthoritativeSettlement({config,kind:'AP_PAYMENT',businessDocumentId:entityId,accountingDate:'2026-08-02',amount:7.25,idempotencyKey:'AP-PAY-request-0001',fetcher:async(url,options)=>{call={url,options};return {ok:true,status:201,json:async()=>({ok:true,data:{status:'DRAFT'}})};}});
  assert.equal(paid.ok,true);assert.match(call.url,/\/ap\/bills\/.+\/payments$/);assert.equal(JSON.parse(call.options.body).cashAccountCode,'111000');assert.equal(JSON.parse(call.options.body).bankMemberRef,null);
  const credit=await createAuthoritativeAdjustment({config,kind:'AP_VENDOR_CREDIT',idempotencyKey:'AP-CREDIT-request-0001',adjustment:{number:'VC-100',date:'2026-08-02',counterpartyRef:'V-1',counterpartyName:'Vendor',amount:10,lines:[{line_no:1,account_code:'610000',amount:10}],reason:'Approved vendor credit'},fetcher:async(url,options)=>{call={url,options};return {ok:true,status:201,json:async()=>({ok:true,data:{business_adjustment_id:entityId,status:'DRAFT'}})};}});
  assert.equal(credit.ok,true);assert.match(call.url,/\/ap\/vendor-credits$/);assert.equal(JSON.parse(call.options.body).creditNumber,'VC-100');
  const memo=await createAuthoritativeAdjustment({config,kind:'AR_CREDIT_MEMO',idempotencyKey:'AR-CREDIT-request-0001',adjustment:{number:'CM-100',date:'2026-08-02',counterpartyRef:'C-1',counterpartyName:'Customer',amount:4,lines:[{line_no:1,account_code:'411100',amount:4}],reason:'Approved customer credit'},fetcher:async(url,options)=>{call={url,options};return {ok:true,status:201,json:async()=>({ok:true,data:{business_adjustment_id:entityId,status:'DRAFT'}})};}});
  assert.equal(memo.ok,true);assert.match(call.url,/\/ar\/credit-memos$/);assert.equal(JSON.parse(call.options.body).memoNumber,'CM-100');
  const allocation=await applyAuthoritativeCredit({config,kind:'AR_CREDIT_MEMO',businessAdjustmentId:entityId,businessDocumentId:'22222222-2222-4222-8222-222222222222',amount:5,reason:'Apply posted credit',idempotencyKey:'AR-CREDIT-ALLOC-0001',fetcher:async(url,options)=>{call={url,options};return {ok:true,status:201,json:async()=>({ok:true,data:{status:'PENDING'}})};}});
  assert.equal(allocation.ok,true);assert.match(call.url,/\/ar\/credit-memos\/.+\/allocations$/);assert.equal(JSON.parse(call.options.body).amount,5);
  const refund=await createAuthoritativeAdjustment({config,kind:'AR_REFUND',idempotencyKey:'AR-REFUND-request-0001',adjustment:{sourceAdjustmentId:entityId,number:'RF-100',date:'2026-08-02',amount:5,reason:'Return customer credit'},fetcher:async(url,options)=>{call={url,options};return {ok:true,status:201,json:async()=>({ok:true,data:{status:'DRAFT'}})};}});
  assert.equal(refund.ok,true);assert.match(call.url,/\/ar\/refunds$/);assert.equal(JSON.parse(call.options.body).cashAccountCode,'111000');
  const advanced=await transitionAuthoritativeJournal({config,journalEntryId:entityId,revision:2,action:'POST',fetcher:async(url,options)=>{call={url,options};return {ok:true,status:201,json:async()=>({ok:true,data:{status:'POSTED',revision:3}})};}});
  assert.equal(advanced.ok,true);assert.match(call.url,/\/journal-entries\/.+\/post$/);assert.equal(call.options.headers['if-match'],'"2"');assert.equal(JSON.parse(call.options.body).periodId,periodId);
  const attachmentMissing=await createAuthoritativeBusinessDocument({config,kind:'AP_BILL',idempotencyKey:'AP-BILL-attachment-missing',document:{documentNumber:'B-3'},fetcher:async()=>{throw new Error('must not call');}});assert.equal(attachmentMissing.code,'ATTACHMENT_REQUIRED');
  const missingToken=await createAuthoritativeBusinessDocument({config:{...config,getAccessToken:async()=>null},kind:'AP_BILL',idempotencyKey:'AP-BILL-token-missing',document:{documentNumber:'B-3',attachmentIds:[attachmentId]},fetcher:async()=>{throw new Error('must not call');}});assert.equal(missingToken.code,'AUTHENTICATION_REQUIRED');
  let agingCall;const apAging=await refreshAuthoritativeAging({config,side:'ap',asOfDate:'2026-07-31',fetcher:async(url,options)=>{agingCall={url,options};return {ok:true,json:async()=>({ok:true,data:[{currency:'USD',current_amount:'100.0000',days_1_30:'0.0000',days_31_60:'0.0000',days_61_90:'0.0000',days_91_plus:'25.5000',total_open_balance:'125.5000'}]})};}});
  assert.equal(apAging.ok,true);assert.equal(apAging.rows[0].total_open_balance,'125.5000');assert.match(agingCall.url,/\/ap\/aging\?asOf=2026-07-31$/);assert.equal(agingCall.options.method,'GET');assert.equal(agingCall.options.cache,'no-store');assert.equal(agingCall.options.headers.authorization,`Bearer ${accessToken}`);assert.equal('body' in agingCall.options,false);
  const arAgingNum=await refreshAuthoritativeAging({config,side:'ar',asOfDate:'2026-07-31',fetcher:async()=>({ok:true,json:async()=>({ok:true,data:[{currency:'USD',current_amount:5,days_1_30:0,days_31_60:0,days_61_90:0,days_91_plus:0,total_open_balance:5}]})})});
  assert.equal(arAgingNum.ok,true);assert.equal(arAgingNum.rows[0].total_open_balance,'5.0000');
  assert.equal((await refreshAuthoritativeAging({config,side:'ap',asOfDate:'2026-02-30',fetcher:async()=>{throw new Error('must not call');}})).code,'ACCOUNTING_API_SCOPE_INVALID');
  assert.equal((await refreshAuthoritativeAging({config,side:'xx',asOfDate:'2026-07-31',fetcher:async()=>{throw new Error('must not call');}})).code,'ACCOUNTING_API_SCOPE_INVALID');
  let ctCall;const apControl=await refreshAuthoritativeControlTotals({config,side:'ap',fetcher:async(url,options)=>{ctCall={url,options};return {ok:true,json:async()=>({ok:true,data:[{currency:'USD',open_balance:'125.5000',control_balance:'125.5000',in_balance:true}]})};}});
  assert.equal(apControl.ok,true);assert.equal(apControl.rows[0].in_balance,true);assert.equal(apControl.rows[0].open_balance,'125.5000');assert.match(ctCall.url,/\/ap\/control-totals$/);assert.equal(ctCall.options.method,'GET');assert.equal('body' in ctCall.options,false);
  assert.equal((await refreshAuthoritativeControlTotals({config,side:'zz',fetcher:async()=>{throw new Error('must not call');}})).code,'ACCOUNTING_API_SCOPE_INVALID');

  // -------------------------------------------------------------------------
  // Failure classification.
  //
  // These are simulated responses, not a live accounting API: there is no API
  // reachable from this test environment. What is proven here is that the
  // client turns each observable condition into a distinct code, so the UI can
  // tell the reader what actually happened instead of guessing a cause.
  // -------------------------------------------------------------------------
  const respond=(status,body)=>({ok:status>=200&&status<300,status,json:async()=>body});
  const transportFailure=async()=>{throw new TypeError('Failed to fetch');};

  for(const [status,expected] of [[401,'AUTHENTICATION_REQUIRED'],[403,'AUTHORIZATION_DENIED'],[500,'ACCOUNTING_API_SERVER_ERROR'],[502,'ACCOUNTING_API_SERVER_ERROR'],[400,'JSON_OBJECT_REQUIRED'],[404,'SOMETHING_ELSE'],[409,'SOMETHING_ELSE']]){
    const journals=await refreshAuthoritativeJournalEntries({config,fetcher:async()=>respond(status,{ok:false,code:status===400?'JSON_OBJECT_REQUIRED':'SOMETHING_ELSE',message:'server text'})});
    assert.equal(journals.ok,false);
    assert.equal(journals.code,expected,`HTTP ${status} must classify as ${expected}`);
    assert.equal(journals.status,status);
    const documents=await refreshAuthoritativeDocuments({config,fetcher:async()=>respond(status,{ok:false,code:status===400?'JSON_OBJECT_REQUIRED':'SOMETHING_ELSE',message:'server text'})});
    assert.equal(documents.code,expected,`AP/AR read must classify HTTP ${status} as ${expected}`);
  }

  // A status with no domain code in the body still classifies from the status.
  for(const [status,expected] of [[404,'ACCOUNTING_API_SCOPE_NOT_FOUND'],[429,'ACCOUNTING_API_RATE_LIMITED'],[418,'ACCOUNTING_API_REQUEST_REJECTED']]){
    const bare=await refreshAuthoritativeJournalEntries({config,fetcher:async()=>respond(status,{ok:false})});
    assert.equal(bare.code,expected,`HTTP ${status} without a domain code must classify as ${expected}`);
  }
  // A 5xx is decided by the status line: a server failure must not be relabelled
  // by whatever the failing server put in the body.
  assert.equal((await refreshAuthoritativeJournalEntries({config,fetcher:async()=>respond(503,{ok:false,code:'PERIOD_CLOSED'})})).code,'ACCOUNTING_API_SERVER_ERROR');

  // A 401 or 403 is decided by the status line. A body code must not be able to
  // relabel an authentication failure as an authorization failure or the reverse.
  assert.equal((await refreshAuthoritativeJournalEntries({config,fetcher:async()=>respond(403,{ok:false,code:'AUTHENTICATION_REQUIRED',message:'wrong'})})).code,'AUTHORIZATION_DENIED');
  assert.equal((await refreshAuthoritativeJournalEntries({config,fetcher:async()=>respond(401,{ok:false,code:'AUTHORIZATION_DENIED',message:'wrong'})})).code,'AUTHENTICATION_REQUIRED');
  // An authorization refusal must not echo the server text: it must not describe
  // what the caller is not allowed to see.
  const refused=await refreshAuthoritativeJournalEntries({config,fetcher:async()=>respond(403,{ok:false,code:'X',message:'entity 42 belongs to tenant Northwind'})});
  assert.ok(!refused.message.includes('Northwind'),'a 403 must not echo server-supplied detail');

  // No HTTP response at all is a transport failure and is reported as one.
  for(const read of [refreshAuthoritativeJournalEntries,refreshAuthoritativeDocuments]){
    const result=await read({config,fetcher:transportFailure});
    assert.equal(result.ok,false);assert.equal(result.code,'ACCOUNTING_API_UNREACHABLE');
  }
  assert.equal((await refreshAuthoritativeBankTransactions({config,bankAccountRef:'BANK-1',fetcher:transportFailure})).code,'ACCOUNTING_API_UNREACHABLE');
  assert.equal((await refreshAuthoritativeReconciliation({config,bankAccountRef:'BANK-1',statementEndingDate:'2026-07-31',fetcher:transportFailure})).code,'ACCOUNTING_API_UNREACHABLE');
  assert.equal((await transitionAuthoritativeJournal({config,journalEntryId:entityId,revision:1,action:'POST',fetcher:transportFailure})).code,'ACCOUNTING_API_UNREACHABLE');

  // A 200 whose shape the read contract rejects is neither unreachable nor a
  // server error: partial data is discarded rather than displayed.
  assert.equal((await refreshAuthoritativeJournalEntries({config,fetcher:async()=>respond(200,{ok:true,data:{}})})).code,'ACCOUNTING_API_PROTOCOL');
  assert.equal((await refreshAuthoritativeDocuments({config,fetcher:async()=>respond(200,{ok:true,data:'not-an-array'})})).code,'ACCOUNTING_API_PROTOCOL');

  // A read where one of the four business-document calls is refused reports that
  // refusal, not a generic failure.
  const mixed=await refreshAuthoritativeDocuments({config,fetcher:async url=>url.includes('/ar/adjustments')?respond(403,{ok:false}):respond(200,{ok:true,data:[]})});
  assert.equal(mixed.code,'AUTHORIZATION_DENIED');

  // No configuration at all is a deployment problem, not an API failure.
  assert.equal((await refreshAuthoritativeDocuments({config:null,fetcher:async()=>respond(200,{ok:true,data:[]})})).code,'CONFIGURATION_REQUIRED');
  assert.equal((await refreshAuthoritativeJournalEntries({config:null,fetcher:async()=>respond(200,{ok:true,data:[]})})).code,'CONFIGURATION_REQUIRED');

  // An expired or absent access token is reported before any request is made.
  assert.equal((await refreshAuthoritativeJournalEntries({config:{...config,getAccessToken:async()=>{throw new Error('OIDC access token is unavailable or expired');}},fetcher:async()=>{throw new Error('must not call');}})).code,'AUTHENTICATION_REQUIRED');

  console.log('accounting-api-client: all assertions passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
