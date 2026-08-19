import test from 'node:test';
import assert from 'node:assert/strict';
import {createWbsTestImportService} from '../runtime/wbs-test-import-service.mjs';

const uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const tenantId=uuid(1),entityId=uuid(2);
const actors={importer:'range-importer',maker:'range-maker',submitter:'range-submitter',reviewer:'range-reviewer',approver:'range-approver',poster:'range-poster'};
const scope={tenantId,entityId,companyCode:'WBPA',actors};
const digest=value=>value.length===64?value:value.repeat(64),hash=value=>`sha256:${digest(value)}`;
const observation=(tool,identity,date='2026-01-15')=>({schema_version:'WBS_LIVE_PILOT_OBSERVATION_V1',status:'NOT_ADMITTED',observation_mode:'UNSIGNED_PILOT',source_system:'WBS',tool,environment:'PRODUCTION',entity_id:entityId,captured_at:'2026-08-19T12:00:00.000Z',provider_content_sha256:digest(identity),scope:{company_codes:['WBPA'],date_range:['2026-01-01','2026-01-31']},record_count:1,rows:[tool==='list_payables'?{source_record_hash:hash(identity),currency:'USD',accounting_date:date,amount:'10.0000',status:'OPEN'}:{source_record_hash:hash(identity),currency:'USD',accounting_date:date,amount:'20.0000',direction:'DEBIT',status:'OPEN'}],signature_verified:false,can_import:false,can_create_transaction:false,can_match:false,can_allocate:false,can_create_draft:false,can_approve:false,can_post:false,can_reverse:false,observation_hash:hash(identity)});

function harness({duplicate=false,loop=false,identityMismatch=false,identityMismatchTool=null,outOfOrder=false,reverseRows=false,repartition=null,payableCount=2,bankCount=2,tokenMode=false}={}){
  const calls=[];let draft=0,bank=0;const draftReceipts=new Map(),postReceipts=new Map(),bankReceipts=new Map();
  const page=(tool,facts)=>{const base=observation(tool,facts[0][0],facts[0][1]),rows=facts.map(([letter,date])=>observation(tool,letter,date).rows[0]);return {...base,record_count:rows.length,rows};};
  const payableFacts=repartition?[['a','2026-01-15'],['b','2026-01-20'],['c','2026-01-30']]:Array.from({length:payableCount},(_,index)=>[(index+1).toString(16).padStart(2,'0').repeat(32),`2026-01-${String(10+(index%20)).padStart(2,'0')}`]),bankFacts=repartition?[['d','2026-01-15'],['e','2026-01-20'],['f','2026-01-30']]:Array.from({length:bankCount},(_,index)=>([(10000+index).toString(16).padStart(4,'0').repeat(16),`2026-01-${String(10+(index%20)).padStart(2,'0')}`]));
  const layout=(tool,facts)=>repartition==='one-two'?[page(tool,[facts[0]]),page(tool,facts.slice(1))]:repartition==='two-one'?[page(tool,[facts[2],facts[0]]),page(tool,[facts[1]])]:facts.length>3?Array.from({length:Math.ceil(facts.length/10)},(_,index)=>page(tool,facts.slice(index*10,index*10+10))):reverseRows?[page(tool,[facts[1]]),page(tool,[facts[0]])]:[page(tool,[facts[0]]),page(tool,[duplicate?[facts[0][0],facts[1][1]]:facts[1]])];
  const pages={list_payables:layout('list_payables',payableFacts),list_bank_transactions:layout('list_bank_transactions',bankFacts)};
  const pilotService={
    async readObservation(){throw new Error('legacy read not expected');},
    async readObservationPage(args){calls.push(['read',args]);const index=args.cursor===null?0:Number(args.cursor.slice(5))-1,token=tokenMode?`snapshot-${args.tool}`:null,last=index===pages[args.tool].length-1,mismatch=(identityMismatch||identityMismatchTool===args.tool)&&last;return {observation:pages[args.tool][index],cursor_next:last?(loop?'page-2':null):`page-${index+2}`,pagination:{snapshot_token:token,captured_at:index===1?'2026-08-19T12:00:01.000Z':'2026-08-19T12:00:00.000Z',contract_version:mismatch?'WBS-REFS-MCP-V2':'WBS-REFS-MCP-V1',environment:'production',source_hash:hash('f'),first_stable_key:index===0?'001':outOfOrder?'001':'002',last_stable_key:index===0?'001':outOfOrder?'001':'002'}};}
  };
  const kernelForActor=actor=>({
    async ensureWbsTestH12026Periods(args){calls.push(['periods',actor,args]);return {status:'WBS_TEST_H1_PERIODS_READY',periods:Array.from({length:6},(_,index)=>{const month=index+1,code=`2026-${String(month).padStart(2,'0')}`;return {period_id:uuid(200+month),period_code:code,starts_on:`${code}-01`,ends_on:new Date(Date.UTC(2026,month,0)).toISOString().slice(0,10)};}),test_only:true};},
    async createWbsTestPayableDraft(args){calls.push(['draft',actor,args]);if(draftReceipts.has(args.idempotencyKey))return {...draftReceipts.get(args.idempotencyKey),idempotent:true};const n=++draft*10,result={business_document_id:uuid(n+1),journal_entry_id:uuid(n+2),source_document_id:uuid(n+3),attachment_id:uuid(n+4),status:'DRAFT',revision:0,idempotent:false,test_only:true,provenance_mode:'UNSIGNED_TEST_ONLY'};draftReceipts.set(args.idempotencyKey,result);return result;},
    async transitionJournal(args){calls.push(['transition',actor,args]);return {status:{SUBMIT:'PENDING_REVIEW',REVIEW:'PENDING_APPROVAL',APPROVE:'APPROVED'}[args.action]};},
    async postJournal(args){calls.push(['post',actor,args]);if(postReceipts.has(args.idempotencyKey))return {...postReceipts.get(args.idempotencyKey),idempotent:true};const result={journal_entry_id:args.journalEntryId,posting_batch_id:uuid(80+postReceipts.size+1),idempotent:false,revision:4};postReceipts.set(args.idempotencyKey,result);return result;},
    async finalizeWbsTestImportSource(args){calls.push(['finalize',actor,args]);return {status:'POSTED',test_only:true,idempotent:false};},
    async createWbsControlledTestBankScope(args){calls.push(['bank',actor,args]);if(bankReceipts.has(args.idempotencyKey))return {...bankReceipts.get(args.idempotencyKey),idempotent:true};const n=++bank,ids=args.observation.rows.map((_,index)=>uuid(120+n+index)),result={wbs_controlled_test_bank_import_id:uuid(100+n),reconciliation_id:uuid(110+n),bank_source_ids:ids,bank_account_ref:args.bankAccountRef,statement_ending_date:args.observation.rows.at(-1).accounting_date,transaction_count:ids.length,status:'DRAFT',provenance_mode:'CONTROLLED_TEST_UNSIGNED',test_only:true,idempotent:false};bankReceipts.set(args.idempotencyKey,result);return result;}
  });
  return {calls,deltaCount:()=>draftReceipts.size+postReceipts.size+bankReceipts.size,service:createWbsTestImportService({pilotService,kernelForActor,authorizeBank:async args=>calls.push(['authorize',args]),scope})};
}

const input={tenantId,entityId,companyCode:'WBPA',dateFrom:'2026-01-01',dateTo:'2026-01-31',pageSize:10,maxPages:1000,payableOffset:0,payableBatchSize:25,idempotencyKey:'wbs-month-2026-01-v1'};

test('reads every real cursor-only page despite changing capture times before any monthly accounting write',async()=>{
  const {service,calls}=harness();const result=await service.importRange(input);
  assert.deepEqual(result,{status:'WBS_TEST_MONTH_IMPORT_COMPLETE',period_code:'2026-01',date_from:'2026-01-01',date_to:'2026-01-31',page_size:10,payables:{provider_page_count:2,record_count:2,batch_offset:0,batch_count:2,next_offset:null,complete:true,imported_count:2,replayed_count:0,posted_count:2},bank:{provider_page_count:2,record_count:2,reconciliation:{bank_account_ref:'WBS_TEST_BANK_2026_01',period_code:'2026-01',period_id:uuid(201),reconciliation_id:uuid(111),transaction_count:2},bank_source_ids:[uuid(121),uuid(122)]},test_only:true});
  assert.equal(calls.filter(([kind])=>kind==='read').length,4);assert.equal(calls.findIndex(([kind])=>kind==='draft')>calls.map(([kind])=>kind).lastIndexOf('read'),true);
  assert.deepEqual(calls.filter(([kind])=>kind==='read').map(([,args])=>[args.tool,args.cursor,args.snapshot_token]),[['list_payables',null,null],['list_bank_transactions',null,null],['list_payables','page-2',null],['list_bank_transactions','page-2',null]]);
  assert.ok(calls.filter(([kind])=>kind==='draft').every(([,actor,args])=>actor===actors.maker&&args.row.accounting_date>='2026-01-01'&&args.row.accounting_date<='2026-01-31'&&args.idempotencyKey.includes(args.row.source_record_hash.slice(7,31))));
  const bankCall=calls.filter(([kind])=>kind==='bank');assert.equal(bankCall.length,1);assert.equal(bankCall[0][1],actors.importer);assert.deepEqual([bankCall[0][2].bankAccountRef,bankCall[0][2].periodId,bankCall[0][2].observation.rows.length],['WBS_TEST_BANK_2026_01',uuid(201),2]);
});

test('retains strict optional-token identity while still completing all reads before writes',async()=>{
  const {service,calls}=harness({tokenMode:true});await service.importRange(input);
  assert.deepEqual(calls.filter(([kind])=>kind==='read').map(([,args])=>[args.tool,args.cursor,args.snapshot_token]),[['list_payables',null,null],['list_bank_transactions',null,null],['list_payables','page-2','snapshot-list_payables'],['list_bank_transactions','page-2','snapshot-list_bank_transactions']]);
  assert.equal(calls.findIndex(([kind])=>kind==='draft')>calls.map(([kind])=>kind).lastIndexOf('read'),true);
});

test('accepts cursor traversal that is not globally stable-key ordered and writes globally sorted identities',async()=>{
  const {service,calls}=harness({outOfOrder:true,reverseRows:true});await service.importRange(input);
  const drafts=calls.filter(([kind])=>kind==='draft');assert.equal(drafts.length,2);assert.deepEqual(drafts.map(([, ,args])=>args.row.source_record_hash),[hash('01'.repeat(32)),hash('02'.repeat(32))]);
  assert.equal(calls.findIndex(([kind])=>kind==='draft')>calls.map(([kind])=>kind).lastIndexOf('read'),true);
});

test('same facts under different Provider page boundaries and row order retain exact aggregate hashes and child keys',async()=>{
  const first=harness({repartition:'one-two'}),second=harness({repartition:'two-one'});await first.service.importRange(input);await second.service.importRange(input);
  const signature=calls=>calls.filter(([kind])=>kind==='draft').map(([, ,args])=>[args.row.source_record_hash,args.observation.observation_hash,args.observation.provider_content_sha256,args.idempotencyKey]);
  assert.deepEqual(signature(first.calls),signature(second.calls));
  const bankSignature=calls=>calls.filter(([kind])=>kind==='bank').map(([, ,args])=>[args.observation.observation_hash,args.observation.provider_content_sha256,args.idempotencyKey]);
  assert.deepEqual(bankSignature(first.calls),bankSignature(second.calls));
});

test('same-key replay has no new accounting child receipts after deterministic aggregation',async()=>{
  const fixture=harness({repartition:'two-one'}),first=await fixture.service.importRange(input),before=fixture.deltaCount(),second=await fixture.service.importRange(input);
  assert.equal(fixture.deltaCount(),before);assert.equal(first.payables.imported_count,3);assert.equal(second.payables.imported_count,0);assert.equal(second.payables.replayed_count,3);assert.equal(second.payables.posted_count,3);
});

test('a large monthly Payables population resumes in fixed 25-row batches while Bank replays',async()=>{
  const fixture=harness({payableCount:30}),first=await fixture.service.importRange(input),afterFirst=fixture.deltaCount(),second=await fixture.service.importRange({...input,payableOffset:first.payables.next_offset});
  assert.equal(first.status,'WBS_TEST_MONTH_IMPORT_PARTIAL');assert.equal(first.payables.batch_count,25);assert.equal(first.payables.next_offset,25);assert.equal(first.payables.complete,false);
  assert.equal(second.status,'WBS_TEST_MONTH_IMPORT_COMPLETE');assert.equal(second.payables.batch_offset,25);assert.equal(second.payables.batch_count,5);assert.equal(second.payables.next_offset,null);assert.equal(second.payables.complete,true);assert.equal(fixture.deltaCount()-afterFirst,10);
  assert.equal(fixture.calls.filter(([kind])=>kind==='bank').length,2);
});

test('the observed January Bank population of 1,888 rows remains bounded and imports as one monthly scope',async()=>{
  const fixture=harness({bankCount:1888}),result=await fixture.service.importRange(input),bankCall=fixture.calls.find(([kind])=>kind==='bank');
  assert.equal(result.bank.provider_page_count,189);assert.equal(result.bank.record_count,1888);assert.equal(result.bank.reconciliation.transaction_count,1888);assert.equal(bankCall[2].observation.rows.length,1888);
});

test('rejects duplicate hashes, cursor loops, identity mismatch, and truncation before writes',async()=>{
  for(const options of [{duplicate:true},{loop:true},{identityMismatch:true}]){
    const {service,calls}=harness(options);await assert.rejects(service.importRange(input),error=>error.code==='WBS_TEST_IMPORT_ROW_INVALID');assert.equal(calls.some(([kind])=>['draft','bank'].includes(kind)),false);
  }
  for(const identityMismatchTool of ['list_payables','list_bank_transactions']){const {service,calls}=harness({identityMismatchTool});await assert.rejects(service.importRange(input),error=>error.code==='WBS_TEST_IMPORT_ROW_INVALID');assert.equal(calls.some(([kind])=>['draft','bank'].includes(kind)),false);}
  const {service,calls}=harness();await assert.rejects(service.importRange({...input,maxPages:1}),error=>error.code==='WBS_TEST_IMPORT_PAGE_LIMIT_EXCEEDED');assert.equal(calls.some(([kind])=>['draft','bank'].includes(kind)),false);
  await assert.rejects(service.importRange({...input,pageSize:5}),error=>error.code==='WBS_TEST_IMPORT_SELECTION_INVALID');assert.equal(calls.some(([kind])=>['draft','bank'].includes(kind)),false);
});
