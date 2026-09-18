// P07 HTTP contract: loan masters, draws, transitions, the deterministic accrual read and the interest Draft.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createAccountingApi} from '../api/accounting-http.mjs';
const tenantId=randomUUID(),entityId=randomUUID(),loanId=randomUUID(),drawId=randomUUID(),periodId=randomUUID(),journalEntryId=randomUUID(),bindingId=randomUUID(),attachmentId=randomUUID();
const H={'idempotency-key':'p07-http-key-1','content-type':'application/json'};
const CH='sha256:'+'a'.repeat(64);
const base=`/api/v1/entities/${entityId}`;
const api=kernel=>createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'lmaker'}),kernelFactory:async()=>kernel});
const failing=(code,message='kernel')=>async()=>{const e=new Error(message);e.code=code;throw e;};
const masters={schema_version:'LOAN_MASTERS_V1',accounting_authority:'NONE',loans:[{loan_id:loanId,loan_ref:'LN-1',status:'APPROVED',revision:1,outstanding_principal:1000000,draws:[]}]};
const accrual={schema_version:'LOAN_INTEREST_ACCRUAL_V1',accounting_authority:'NONE',can_post:false,can_draft:false,loan_id:loanId,loan_ref:'LN-1',loan_status:'APPROVED',
  period_id:periodId,period_code:'2026-07',currency:'USD',capitalized_amount:6200,expensed_amount:0,total_amount:6200,
  computation:{method:'DAILY_SIMPLE_INTEREST_ON_APPROVED_DRAWS',basis_days:365,capitalizable_days:31},computation_hash:CH,existing_draft:null};
const loanReceipt={schema_version:'LOAN_MASTER_V1',loan_id:loanId,status:'DRAFT',revision:0,idempotent:false};
const drawReceipt={schema_version:'LOAN_DRAW_V1',loan_draw_id:drawId,loan_id:loanId,status:'DRAFT',revision:0,idempotent:false};
const intReceipt={schema_version:'LOAN_INTEREST_DRAFT_V1',journal_entry_id:journalEntryId,loan_interest_draft_binding_id:bindingId,loan_id:loanId,loan_ref:'LN-1',
  capitalized_amount:'6200.0000',expensed_amount:'0.0000',total_amount:'6200.0000',computation_hash:CH,status:'DRAFT',revision:0,idempotent:false};
const loanBody={loanRef:'LN-1',lenderMemberRef:'LENDER-1',facilityAmount:'1000000.0000',currency:'USD',annualRate:'0.073000',dayCountBasis:'ACT_365',
  capitalizationStart:'2026-07-01',capitalizationEnd:null,projectRef:'PRJ-1',cwipAccountCode:'150100',interestExpenseAccountCode:'780100',accruedInterestAccountCode:'292001',reason:'register construction loan'};
const drawBody={drawRef:'D-1',drawDate:'2026-07-01',amount:'1000000.0000',reason:'first construction draw'};
const intBody={periodId,journalNumber:'P07-INT-1',journalDate:'2026-07-31',expectedComputationHash:CH,attachmentIds:[attachmentId],reason:'accrue july construction interest'};

test('P07 reads: loan masters and the accrual are bodyless no-store reads, the accrual etags its computation hash',async()=>{
  const observed=[];let answer=accrual;
  const a=api({readLoanMasters:async args=>(observed.push(args),masters),readLoanInterestAccrual:async args=>(observed.push(args),answer)});
  let r=await a({method:'GET',url:`${base}/loans`,body:null,headers:{}});
  assert.equal(r.status,200);assert.equal(r.headers['cache-control'],'no-store');assert.deepEqual(r.body.data,masters);assert.deepEqual(observed[0],{tenantId,entityId});
  r=await a({method:'GET',url:`${base}/loans/${loanId}/interest-accrual?periodId=${periodId}`,body:null,headers:{}});
  assert.equal(r.status,200);assert.equal(r.headers.etag,`"${CH}"`);assert.deepEqual(observed[1],{tenantId,entityId,loanId,periodId});
  for(const url of [`${base}/loans?x=1`,`${base}/loans/${loanId}/interest-accrual`,`${base}/loans/${loanId}/interest-accrual?periodId=nope`,`${base}/loans/nope/interest-accrual?periodId=${periodId}`])
    assert.equal((await a({method:'GET',url,body:null,headers:{}})).status,400,url);
  assert.equal((await a({method:'GET',url:`${base}/loans`,body:{},headers:{}})).status,400);
  assert.equal((await a({method:'GET',url:`${base}/loans`,body:null,headers:{'idempotency-key':'x'}})).status,400);
  answer={...accrual,can_draft:true};assert.equal((await a({method:'GET',url:`${base}/loans/${loanId}/interest-accrual?periodId=${periodId}`,body:null,headers:{}})).status,502);
  assert.equal((await api({readLoanMasters:failing('42501')})({method:'GET',url:`${base}/loans`,body:null,headers:{}})).status,403);
  assert.equal((await api({readLoanInterestAccrual:failing('22023')})({method:'GET',url:`${base}/loans/${loanId}/interest-accrual?periodId=${periodId}`,body:null,headers:{}})).status,400);
  assert.equal((await api({readLoanInterestAccrual:failing('P0002')})({method:'GET',url:`${base}/loans/${loanId}/interest-accrual?periodId=${periodId}`,body:null,headers:{}})).status,404);
});

test('P07 masters: closed payloads, rate and capitalisation-window validation, draw sign, transition CAS',async()=>{
  const observed=[];
  const a=api({createLoanMaster:async args=>(observed.push(['loan',args]),loanReceipt),
    createLoanDraw:async args=>(observed.push(['draw',args]),drawReceipt),
    transitionLoanMaster:async args=>(observed.push(['tr',args]),{schema_version:'LOAN_MASTER_TRANSITION_V1',status:args.event,revision:args.expectedRevision+1,idempotent:false})});
  let r=await a({method:'POST',url:`${base}/loans`,body:loanBody,headers:H});
  assert.equal(r.status,201);assert.equal(r.headers.etag,'"0"');assert.equal(observed[0][1].annualRate,'0.073000');assert.equal(observed[0][1].cwipAccountCode,'150100');
  // a capitalisation window is all-or-nothing
  assert.equal((await a({method:'POST',url:`${base}/loans`,body:{...loanBody,cwipAccountCode:null},headers:H})).status,400);
  assert.equal((await a({method:'POST',url:`${base}/loans`,body:{...loanBody,projectRef:null},headers:H})).status,400);
  const noWindow={...loanBody,capitalizationStart:null,capitalizationEnd:null,projectRef:null,cwipAccountCode:null};
  assert.equal((await a({method:'POST',url:`${base}/loans`,body:noWindow,headers:H})).status,201,'a loan with no capitalisation window is valid');
  assert.equal((await a({method:'POST',url:`${base}/loans`,body:{...loanBody,capitalizationEnd:'2026-06-30'},headers:H})).status,400,'window end before start');
  for(const bad of [{...loanBody,annualRate:'0.073'},{...loanBody,annualRate:'1.000000'},{...loanBody,annualRate:0.073},{...loanBody,dayCountBasis:'30_360'},
    {...loanBody,facilityAmount:'1000000'},{...loanBody,facilityAmount:'0.0000'},{...loanBody,currency:'usd'},{...loanBody,loanRef:'bad ref'},{...loanBody,reason:'short'},{...loanBody,extra:1}])
    assert.equal((await a({method:'POST',url:`${base}/loans`,body:bad,headers:H})).status,400,JSON.stringify(bad).slice(0,70));
  assert.equal((await a({method:'POST',url:`${base}/loans`,body:loanBody,headers:{'content-type':'application/json'}})).status,400,'Idempotency-Key required');
  assert.equal((await a({method:'POST',url:`${base}/loans`,body:loanBody,headers:{...H,'if-match':'"0"'}})).status,400);
  // draws
  r=await a({method:'POST',url:`${base}/loans/${loanId}/draws`,body:drawBody,headers:H});
  assert.equal(r.status,201);assert.equal(observed[observed.length-1][1].amount,'1000000.0000');
  r=await a({method:'POST',url:`${base}/loans/${loanId}/draws`,body:{...drawBody,amount:'-250000.0000'},headers:H});
  assert.equal(r.status,201,'a negative amount records a principal repayment');
  for(const bad of [{...drawBody,amount:'0.0000'},{...drawBody,amount:'1000'},{...drawBody,drawDate:'31-07-2026'},{...drawBody,drawRef:'bad ref'}])
    assert.equal((await a({method:'POST',url:`${base}/loans/${loanId}/draws`,body:bad,headers:H})).status,400);
  // transitions
  r=await a({method:'POST',url:`${base}/loan-masters/loans/${loanId}/transitions`,body:{event:'APPROVED',reason:'approve the construction loan'},headers:{...H,'if-match':'"0"'}});
  assert.equal(r.status,200);assert.equal(r.headers.etag,'"1"');
  const tr=observed[observed.length-1][1];assert.equal(tr.objectType,'LOAN');assert.equal(tr.expectedRevision,0);
  r=await a({method:'POST',url:`${base}/loan-masters/draws/${drawId}/transitions`,body:{event:'APPROVED',reason:'approve the construction draw'},headers:{...H,'if-match':'"2"'}});
  assert.equal(observed[observed.length-1][1].objectType,'DRAW');assert.equal(observed[observed.length-1][1].expectedRevision,2);
  assert.equal((await a({method:'POST',url:`${base}/loan-masters/loans/${loanId}/transitions`,body:{event:'APPROVED',reason:'approve the construction loan'},headers:H})).status,428);
  assert.equal((await a({method:'POST',url:`${base}/loan-masters/things/${loanId}/transitions`,body:{event:'APPROVED',reason:'approve the construction loan'},headers:{...H,'if-match':'"0"'}})).status,404);
  assert.equal((await api({transitionLoanMaster:failing('40001','Loan master revision is stale')})({method:'POST',url:`${base}/loan-masters/loans/${loanId}/transitions`,body:{event:'APPROVED',reason:'approve the construction loan'},headers:{...H,'if-match':'"0"'}})).status,412);
  for(const [code,status] of [['42501',403],['P0002',404],['23503',422],['23514',422],['23505',409]])
    assert.equal((await api({createLoanMaster:failing(code)})({method:'POST',url:`${base}/loans`,body:loanBody,headers:H})).status,status,code);
  assert.equal((await api({createLoanMaster:async()=>({...loanReceipt,status:'APPROVED'})})({method:'POST',url:`${base}/loans`,body:loanBody,headers:H})).status,502);
});

test('P07 interest Draft: computation hash is mandatory and echoed, 412 on drift, amounts never come from the request',async()=>{
  const observed=[];
  const a=api({createLoanInterestDraft:async args=>(observed.push(args),intReceipt)});
  const url=`${base}/loans/${loanId}/interest-drafts`;
  const r=await a({method:'POST',url,body:intBody,headers:H});
  assert.equal(r.status,201);assert.deepEqual(r.body.data,intReceipt);
  assert.deepEqual(observed[0],{tenantId,entityId,loanId,periodId,journalNumber:'P07-INT-1',journalDate:'2026-07-31',expectedComputationHash:CH,reason:'accrue july construction interest',attachmentIds:[attachmentId],idempotencyKey:'p07-http-key-1'});
  assert.ok(!Object.keys(observed[0]).some(k=>/amount/i.test(k)),'the command carries no amount at all');
  assert.equal((await api({createLoanInterestDraft:async()=>({...intReceipt,idempotent:true})})({method:'POST',url,body:intBody,headers:H})).status,200);
  for(const bad of [{...intBody,expectedComputationHash:'nope'},{...intBody,expectedComputationHash:CH.toUpperCase()},{...intBody,attachmentIds:[]},{...intBody,reason:'short'},
    {...intBody,capitalizedAmount:'1.0000'},{...intBody,journalNumber:''},{...intBody,periodId:'nope'}])
    assert.equal((await a({method:'POST',url,body:bad,headers:H})).status,400,JSON.stringify(bad).slice(0,70));
  assert.equal((await a({method:'POST',url,body:intBody,headers:{...H,'if-match':'"0"'}})).status,400);
  assert.equal((await a({method:'POST',url,body:intBody,headers:{'content-type':'application/json'}})).status,400);
  assert.equal((await api({createLoanInterestDraft:failing('40001')})({method:'POST',url,body:intBody,headers:H})).status,412);
  for(const [code,status] of [['42501',403],['P0002',404],['23514',422],['23505',409],['55000',423]])
    assert.equal((await api({createLoanInterestDraft:failing(code)})({method:'POST',url,body:intBody,headers:H})).status,status,code);
  assert.equal((await api({createLoanInterestDraft:async()=>({...intReceipt,computation_hash:'sha256:'+'b'.repeat(64)})})({method:'POST',url,body:intBody,headers:H})).status,502,'the receipt must echo the reviewed computation');
  assert.equal((await api({createLoanInterestDraft:async()=>({...intReceipt,status:'POSTED'})})({method:'POST',url,body:intBody,headers:H})).status,502);
  assert.equal((await api({})({method:'POST',url,body:intBody,headers:H})).status,503);
});
