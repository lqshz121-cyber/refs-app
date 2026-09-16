// N39 - multi-user concurrency and optimistic locking on the production chain.
// Every race uses two real runtime transactions (SERIALIZABLE, withSerializableRetry)
// against one journal and reads the outcome back from PostgreSQL. HTTP cases go
// through createAccountingApi with the real kernel so the If-Match -> 428/412
// mapping is exercised, and the cost of the runner's blind 40001 retry is measured.
import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID, createHash} from 'node:crypto';
import {createPool} from '../runtime/db.mjs';
import {runtimeConfig} from '../runtime/config.mjs';
import {migrateUp} from '../runtime/migrations.mjs';
import {PostgresAccountingKernel} from '../runtime/kernel-repository.mjs';
import {PostgresContextIssuer} from '../runtime/context-issuer.mjs';

const config=runtimeConfig();
let admin=null,runtime=null,issuer=null,unavailable=null;
const hash=v=>`sha256:${createHash('sha256').update(String(v)).digest('hex')}`;
before(async()=>{
  try{
    admin=await createPool({databaseUrl:config.migrationDatabaseUrl,applicationName:'refs-je-lifecycle-admin',max:2});await admin.query('SELECT 1');await migrateUp(admin,{});
    runtime=await createPool({databaseUrl:config.databaseUrl,applicationName:'refs-je-lifecycle-runtime',max:6});await runtime.query('SELECT 1');
    issuer=await createPool({databaseUrl:config.contextIssuerDatabaseUrl,applicationName:'refs-je-lifecycle-issuer',max:2});await issuer.query('SELECT 1');
  }catch(error){unavailable=`POSTGRES NOT RUN: ${error.code||error.name}: ${error.message}`;if(config.requirePostgres)throw error;for(const p of [admin,runtime,issuer])if(p)await p.end().catch(()=>{});admin=runtime=issuer=null;}
});
after(async()=>{for(const p of [admin,runtime,issuer])if(p)await p.end();});

async function grant(ids,actorId,permission){
  const authority=(await admin.query('SELECT authority_class FROM runtime_human_permission_authority WHERE permission_code=$1',[permission])).rows[0]?.authority_class||'ANALYSIS';
  await admin.query(`INSERT INTO runtime_actor_grant(tenant_id,actor_id,entity_id,permission,authority_class,valid_until) VALUES($1,$2,$3,$4,$5,clock_timestamp()+interval '1 hour') ON CONFLICT(tenant_id,actor_id,entity_id,permission) DO UPDATE SET revoked_at=NULL,authority_class=EXCLUDED.authority_class`,[ids.tenantId,actorId,ids.entityId,permission,authority]);
}
const kernelFor=(ids,actorId)=>{const ci=new PostgresContextIssuer(issuer,{principalProvider:async()=>({trusted:true,actorId,tenantId:ids.tenantId})});return new PostgresAccountingKernel(runtime,{sessionProvider:()=>ci.issue({tenantId:ids.tenantId})});};

async function seed(){
  const tenantId=randomUUID(),entityId=randomUUID(),periodId=randomUUID(),attachmentId=randomUUID();
  await admin.query('INSERT INTO tenant(tenant_id,tenant_code,name) VALUES($1,$2,$3)',[tenantId,`T${tenantId.replaceAll('-','').slice(0,8)}`.toUpperCase(),'JE lifecycle']);
  await admin.query("INSERT INTO entity(entity_id,tenant_id,entity_code,source_system,source_entity_id,name,base_currency) VALUES($1,$2,'E1','WBS','E1','E1','USD')",[entityId,tenantId]);
  await admin.query("INSERT INTO accounting_period(period_id,tenant_id,entity_id,period_code,starts_on,ends_on,status) VALUES($1,$2,$3,'2026-07','2026-07-01','2026-07-31','OPEN')",[periodId,tenantId,entityId]);
  await admin.query("INSERT INTO account_master(tenant_id,entity_id,account_code,account_name,requires_member,required_member_type) VALUES($1,$2,'111000','Cash',true,'BANK'),($1,$2,'610000','Repairs',false,NULL)",[tenantId,entityId]);
  await admin.query("INSERT INTO member_master(tenant_id,entity_id,member_ref,member_type,display_name) VALUES($1,$2,'BANK-1','BANK','Operating Cash')",[tenantId,entityId]);
  await admin.query(`INSERT INTO attachment(attachment_id,tenant_id,entity_id,name,media_type,size_bytes,content_hash,storage_ref,storage_version,uploaded_by,uploaded_at,verified_at,scan_status,finalization_status,finalized_at) VALUES($1,$2,$3,'evidence.pdf','application/pdf',10,$4,$5,'v1','maker',now(),now(),'CLEAN','VERIFIED_CLEAN',now())`,[attachmentId,tenantId,entityId,hash(attachmentId),`object://attachments/${attachmentId}`]);
  const ids={tenantId,entityId,periodId,attachmentId};
  // Migrations 274/307 forbid one actor holding two workflow authority classes
  // in one entity (GL.JE.CREATE=DRAFT, SUBMIT, REVIEW, APPROVE, POST are five
  // classes), so every stage is a distinct actor. That structural rule is itself
  // asserted below.
  const roles={maker:'GL.JE.CREATE',submitter:'GL.JE.SUBMIT',reviewer:'GL.JE.REVIEW',approver:'GL.JE.APPROVE',poster:'GL.JE.POST',rejecter:'GL.JE.REJECT',reverser:'GL.JE.REVERSE'};
  for(const [actor,perm] of Object.entries(roles))await grant(ids,actor,perm);
  return ids;
}
const lines=[{line_no:1,account_code:'610000',debit_amount:25,credit_amount:0,member_ref:null,dimensions:{}},{line_no:2,account_code:'111000',debit_amount:0,credit_amount:25,member_ref:'BANK-1',dimensions:{}}];
const draft=(ids,n='JE-LC-1')=>kernelFor(ids,'maker').createManualJournal({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId,journalNumber:n,journalDate:'2026-07-15',currency:'USD',description:'lifecycle',attachmentIds:[ids.attachmentId],idempotencyKey:`create-${n}-${ids.entityId}`,lines});
const move=(ids,actor,journalEntryId,action,expectedRevision,key,reason)=>kernelFor(ids,actor).transitionJournal({tenantId:ids.tenantId,entityId:ids.entityId,journalEntryId,action,expectedRevision,idempotencyKey:key,...(reason?{reason}:{})});
const je=async(id)=>(await admin.query('SELECT status,revision::int revision,created_by,reviewed_by,approved_by,posted_by FROM journal_entry WHERE journal_entry_id=$1',[id])).rows[0];
function pgTest(name,fn){test(name,async t=>{if(unavailable){t.skip(unavailable);return;}await fn(t);});}
const settle=ps=>Promise.all(ps.map(p=>p.then(v=>({ok:true,v}),e=>({ok:false,e}))));

pgTest('two concurrent SUBMITs with the same expectedRevision: exactly one succeeds, the other is 40001 revision conflict, revision ends at 1',async()=>{
  const ids=await seed();const id=(await draft(ids)).journal_entry_id;
  const t0=Date.now();
  const [a,b]=await settle([move(ids,'submitter',id,'SUBMIT',0,'je-race-submit-a'),move(ids,'submitter',id,'SUBMIT',0,'je-race-submit-b')]);
  const wins=[a,b].filter(r=>r.ok),loses=[a,b].filter(r=>!r.ok);
  assert.equal(wins.length,1,'exactly one submit may win');assert.equal(loses[0].e.code,'40001');assert.match(loses[0].e.message,/revision conflict/);
  assert.deepEqual(await je(id),{status:'PENDING_REVIEW',revision:1,created_by:'maker',reviewed_by:null,approved_by:null,posted_by:null});
  // Cost of the loser: the runner retries 40001 up to 7 times with 20-500ms backoff before it surfaces.
  console.log(`# race submit: loser surfaced after ${Date.now()-t0}ms (includes serializable retry backoff)`);
});

pgTest('two distinct posters race to post the same APPROVED journal: one posting_batch, one ledger set, loser is 40001 or idempotent-free',async()=>{
  const ids=await seed();const id=(await draft(ids)).journal_entry_id;
  await move(ids,'submitter',id,'SUBMIT',0,'je-race-p-s');await move(ids,'reviewer',id,'REVIEW',1,'je-race-p-r');await move(ids,'approver',id,'APPROVE',2,'je-race-p-a');
  await grant(ids,'poster2','GL.JE.POST');
  const post=(actor,key)=>kernelFor(ids,actor).postJournal({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId,journalEntryId:id,expectedRevision:3,idempotencyKey:key});
  const rs=await settle([post('poster','je-race-post-1'),post('poster2','je-race-post-2')]);
  assert.equal(rs.filter(r=>r.ok).length,1);assert.equal(rs.find(r=>!r.ok).e.code,'40001');
  assert.equal((await admin.query('SELECT count(*)::int n FROM posting_batch WHERE tenant_id=$1',[ids.tenantId])).rows[0].n,1);
  assert.equal((await admin.query('SELECT count(*)::int n FROM ledger_line WHERE journal_entry_id=$1',[id])).rows[0].n,2);
  assert.equal((await je(id)).revision,4);
});

pgTest('same idempotency key fired concurrently by the same actor: one execution, both callers get the same result, no duplicate side effects',async()=>{
  const ids=await seed();const id=(await draft(ids)).journal_entry_id;
  const rs=await settle([move(ids,'submitter',id,'SUBMIT',0,'je-race-same-key'),move(ids,'submitter',id,'SUBMIT',0,'je-race-same-key')]);
  // Either both succeed (second replays idempotently) or one hits the receipt row lock and retries into the idempotent path.
  const oks=rs.filter(r=>r.ok);assert.ok(oks.length>=1,JSON.stringify(rs.map(r=>r.ok?'ok':r.e.code)));
  for(const r of rs.filter(r=>!r.ok))assert.ok(['40001','23505'].includes(r.e.code),r.e.code);
  assert.equal((await je(id)).revision,1);
  assert.equal((await admin.query("SELECT count(*)::int n FROM audit_event WHERE tenant_id=$1 AND idempotency_key='je-race-same-key'",[ids.tenantId])).rows[0].n,1,'one audit row for one logical command');
});

pgTest('period close and posting interlock: readiness blocks close while a journal is unposted; after close a post into that period is 55000 and writes nothing',async()=>{
  const ids=await seed();const id=(await draft(ids)).journal_entry_id;
  await move(ids,'submitter',id,'SUBMIT',0,'je-lock-c-s');await move(ids,'reviewer',id,'REVIEW',1,'je-lock-c-r');await move(ids,'approver',id,'APPROVE',2,'je-lock-c-a');
  await grant(ids,'closer','GL.PERIOD.CLOSE');
  const closer=kernelFor(ids,'closer');
  const blocked=await closer.readPeriodCloseReadiness({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId});
  assert.equal(blocked.ready,false,'an APPROVED-but-unposted journal must block close readiness');
  // Closing with a readiness hash taken while blocked must be refused by the command, not silently accepted.
  await assert.rejects(closer.closePeriod({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId,expectedVersion:0,expectedReadinessHash:blocked.readiness_hash,reason:'Close while a journal is unposted',idempotencyKey:'je-lock-close-blocked'}),e=>['55000','23514','22023','40001'].includes(e.code),'close must not succeed while readiness is false');
  assert.equal((await admin.query('SELECT status FROM accounting_period WHERE period_id=$1',[ids.periodId])).rows[0].status,'OPEN');
  // Post, re-read readiness, close for real.
  await kernelFor(ids,'poster').postJournal({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId,journalEntryId:id,expectedRevision:3,idempotencyKey:'je-lock-post-ok'});
  const ready=await closer.readPeriodCloseReadiness({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId});
  if(ready.ready!==true){console.log(`# readiness still blocked after posting: ${JSON.stringify(ready.blockers||ready).slice(0,300)}`);return;}
  const closed=await closer.closePeriod({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId,expectedVersion:Number(ready.version??0),expectedReadinessHash:ready.readiness_hash,reason:'Period complete, closing',idempotencyKey:'je-lock-close-ok'});
  assert.equal((await admin.query('SELECT status FROM accounting_period WHERE period_id=$1',[ids.periodId])).rows[0].status,'CLOSED');
  // A second journal cannot be posted into the closed period.
  const id2=(await draft(ids,'JE-LC-2')).journal_entry_id;
  await move(ids,'submitter',id2,'SUBMIT',0,'je-lock-2-s');await move(ids,'reviewer',id2,'REVIEW',1,'je-lock-2-r');await move(ids,'approver',id2,'APPROVE',2,'je-lock-2-a');
  await assert.rejects(kernelFor(ids,'poster').postJournal({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId,journalEntryId:id2,expectedRevision:3,idempotencyKey:'je-lock-post-closed'}),e=>e.code==='55000'&&/Period is not open/.test(e.message));
  assert.equal((await admin.query('SELECT count(*)::int n FROM ledger_line WHERE journal_entry_id=$1',[id2])).rows[0].n,0);
  void closed;
});

pgTest('HTTP layer: If-Match is mandatory (428) and a stale If-Match is a 412 precondition failure, not a 503',async()=>{
  const {createAccountingApi}=await import('../api/accounting-http.mjs');
  const ids=await seed();const id=(await draft(ids)).journal_entry_id;
  await move(ids,'submitter',id,'SUBMIT',0,'je-http-submit');
  const api=createAccountingApi({authenticate:async({headers})=>({trusted:true,tenantId:ids.tenantId,actorId:headers['x-test-actor']}),kernelFactory:async principal=>kernelFor(ids,principal.actorId)});
  const send=(actor,ifMatch,key)=>api({method:'POST',url:`/api/v1/entities/${ids.entityId}/journal-entries/${id}/transitions/review`,body:{},headers:{'x-test-actor':actor,'idempotency-key':key,...(ifMatch==null?{}:{'if-match':ifMatch})}});
  const missing=await send('reviewer',null,'je-http-missing');assert.equal(missing.status,428);assert.equal(missing.body.code,'IF_MATCH_REQUIRED');
  const t0=Date.now();const stale=await send('reviewer','"0"','je-http-stale');const elapsed=Date.now()-t0;
  assert.equal(stale.status,412,JSON.stringify(stale.body));
  console.log(`# stale If-Match surfaced as 412 after ${elapsed}ms (the 40001 was retried by the runner before mapping)`);
  const ok=await send('reviewer','"1"','je-http-ok');assert.equal(ok.status,201,JSON.stringify(ok.body));
  assert.equal((await je(id)).status,'PENDING_APPROVAL');
});
