import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createAccountingApi} from '../api/accounting-http.mjs';
import {PostgresAccountingKernel} from '../runtime/kernel-repository.mjs';
const tenantId=randomUUID(),entityId=randomUUID(),periodId=randomUUID(),ledgerLineId=randomUUID();
const row={entity_id:entityId,report_period_id:periodId,journal_period_id:randomUUID(),journal_entry_id:randomUUID(),journal_line_id:randomUUID(),ledger_line_id:ledgerLineId,journal_date:'2026-01-01',report_period_end:'2026-06-30'};
const url=`/api/v1/entities/${entityId}/general-ledger/line-identities/${ledgerLineId}?periodId=${periodId}`;
const api=(read=async()=>row,authenticate=async()=>({trusted:true,tenantId,actorId:'reader'}))=>createAccountingApi({authenticate,kernelFactory:async()=>({readLedgerLineIdentity:read})});
const request=(handler,extra={})=>handler({method:'GET',url,headers:{},body:null,...extra});
test('exact ledger identity GET preserves report and actual journal periods, no-store and trusted tenant',async()=>{
  const calls=[],response=await request(api(async scope=>(calls.push(scope),row)));
  assert.equal(response.status,200);assert.equal(response.headers['cache-control'],'no-store');assert.deepEqual(response.body.data,row);
  assert.deepEqual(calls,[{tenantId,entityId,periodId,ledgerLineId}]);
});
test('identity read rejects commands, ambiguous scope, anonymous access and hidden records',async()=>{
  for(const headers of [{'idempotency-key':'x'},{'if-match':'1'}])assert.equal((await request(api(),{headers})).status,400);
  assert.equal((await request(api(),{body:{periodId}})).status,400);
  for(const suffix of [`&periodId=${periodId}`,'&tenantId=x','&accountCode=111000'])assert.equal((await request(api(),{url:url+suffix})).status,400);
  assert.equal((await request(api(undefined,async()=>null))).status,401);
  for(const [code,status] of [['42501',403],['P0002',404]]){
    const response=await request(api(async()=>{throw Object.assign(new Error('private hidden identity'),{code});}));
    assert.equal(response.status,status);assert.doesNotMatch(response.body.message,/private hidden/);
  }
});
test('repository resolves one posted exact tenant/entity/ledger relationship through report end under existing view permission',async()=>{
  const calls=[],kernel=Object.create(PostgresAccountingKernel.prototype);
  kernel.inSession=async work=>work({query:async(sql,args)=>{calls.push({sql,args});return {rows:sql.includes('FROM public.ledger_line')?[row]:[]};}});
  assert.deepEqual(await kernel.readLedgerLineIdentity({tenantId,entityId,periodId,ledgerLineId}),row);
  assert.equal(calls[0].sql,"SELECT refs_assert_scope($1,$2,'GL.JE.VIEW')");
  assert.deepEqual(calls[1].args,[tenantId,entityId,periodId,ledgerLineId]);
  for(const token of ['j.period_id=l.period_id','jl.period_id=l.period_id','jl.journal_entry_id=l.journal_entry_id','jl.journal_line_id=l.journal_line_id',"j.status='POSTED'",'j.journal_date<=p.ends_on','l.tenant_id=$1 AND l.entity_id=$2 AND l.ledger_line_id=$4'])assert.ok(calls[1].sql.includes(token));
  assert.doesNotMatch(calls[1].sql,/\b(?:INSERT|UPDATE|DELETE|LIMIT)\b/);
  kernel.inSession=async work=>work({query:async()=>({rows:[]})});
  await assert.rejects(kernel.readLedgerLineIdentity({tenantId,entityId,periodId,ledgerLineId}),{code:'P0002'});
});
test('identity response is closed and rejects cross-scope, future, malformed and raw evidence',async()=>{
  for(const change of [{entity_id:randomUUID()},{report_period_id:randomUUID()},{ledger_line_id:randomUUID()},{journal_period_id:'bad'},{journal_date:'2026-07-01'},{journal_date:'2026-02-30'},{raw_payload:'private'}])assert.equal((await request(api(async()=>({...row,...change})))).status,502);
});
