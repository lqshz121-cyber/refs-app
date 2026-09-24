// R04: a capability issued by an attempt whose COMMIT fails must still be revoked.
//
// revokeOnFailure only wraps `work`. Under SERIALIZABLE, a conflict is often detected at COMMIT,
// after `work` has returned -- the bind rolls back, the issuer's row stays live and unbound until
// its TTL. context-retry-revocation-postgres caught this intermittently (5 of 25 runs on PG16.14);
// these tests pin each branch deterministically without a database.
import test from 'node:test';
import assert from 'node:assert/strict';
import {PostgresAccountingKernel} from '../runtime/kernel-repository.mjs';
import {withSerializableRetry} from '../runtime/db.mjs';

const token=n=>`ctx-${String(n).padStart(40,'0')}`;
function fakePool({commitFailures=[]}={}){
  const failures=[...commitFailures];const clients=[];
  return {clients,async connect(){
    const queries=[];
    const client={queries,async query(sql){
      queries.push(sql);
      if(sql==='COMMIT'&&failures.length){const code=failures.shift();if(code)throw Object.assign(new Error(`commit ${code}`),{code});}
      if(/session_user/.test(sql))return {rowCount:1,rows:[{session_user:'refs_runtime',current_user:'refs_runtime',is_superuser:false}]};
      return {rowCount:1,rows:[{}]};
    },release(){}};
    clients.push(client);return client;
  }};
}
function kernelWith(pool,{workError=null}={}){
  let issued=0;const revoked=[];
  const k=new PostgresAccountingKernel(pool,{
    sessionProvider:async()=>({trusted:true,contextToken:token(++issued)}),
    sessionRevoker:async(session,meta)=>{revoked.push({token:session.contextToken,code:meta.code});},
  });
  return {k,revoked,issued:()=>issued,run:()=>k.inSession(async()=>{if(workError)throw workError;return 'ok';})};
}

test('KCR-1: COMMIT raising 40001 revokes exactly that attempt\'s capability, and the retry commits untouched',async()=>{
  const t=kernelWith(fakePool({commitFailures:['40001']}));
  assert.equal(await t.run(),'ok');
  assert.equal(t.issued(),2);
  assert.deepEqual(t.revoked,[{token:token(1),code:'40001'}],'the committed attempt (token 2) must never be revoked');
});

test('KCR-2: a deadlock at COMMIT (40P01) is treated the same way',async()=>{
  const t=kernelWith(fakePool({commitFailures:['40P01','40001']}));
  assert.equal(await t.run(),'ok');
  assert.deepEqual(t.revoked.map(r=>r.token),[token(1),token(2)]);
});

test('KCR-3: a failure inside work is revoked once, not twice',async()=>{
  const t=kernelWith(fakePool(),{workError:Object.assign(new Error('denied'),{code:'42501'})});
  await assert.rejects(t.run(),{code:'42501'});
  assert.deepEqual(t.revoked,[{token:token(1),code:'42501'}]);
});

test('KCR-4: an ambiguous COMMIT failure (connection lost) is NOT revoked, because it may have committed',async()=>{
  const t=kernelWith(fakePool({commitFailures:['08006']}));
  await assert.rejects(t.run(),{code:'08006'});
  assert.deepEqual(t.revoked,[],'revoking a binding that might be committed would break a live transaction');
});

test('KCR-5: a successful first attempt revokes nothing',async()=>{
  const t=kernelWith(fakePool());
  assert.equal(await t.run(),'ok');
  assert.deepEqual(t.revoked,[]);
});

test('KCR-6: onAttemptError sees commit-time failures and cannot mask the original error',async()=>{
  const seen=[];
  await assert.rejects(withSerializableRetry(fakePool({commitFailures:['40001','23505']}),async()=>'x',
    {sleep:async()=>{},onAttemptError:e=>{seen.push(e.code);throw new Error('hook blew up');}}),{code:'23505'});
  assert.deepEqual(seen,['40001','23505']);
});
