// Posting controls as a first-class contract: authorization, actor binding,
// segregation of duties, period state and tenant scope on refs_post_journal,
// with the positive path proving the same call succeeds once every control is
// satisfied. Each negative path asserts zero writes by reading the ledger,
// posting_batch, audit and outbox tables back from PostgreSQL.
//
// Authority is exercised exactly as production exercises it: a runtime_actor_grant
// row (what the IAM grant sync writes), a context issued by PostgresContextIssuer
// on the issuer login, and refs_bootstrap_context binding that token to one
// runtime transaction inside PostgresAccountingKernel.inSession. Session GUCs
// are NOT an authority source - refs_current_tenant()/refs_entity_allowed()
// derive everything from the bound context joined to live grants and the
// permission catalog, so setting refs.* claims by hand is refused with 42501;
// this file's first draft proved that by accident and one test below pins it.

import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID, createHash} from 'node:crypto';
import {createPool} from '../runtime/db.mjs';
import {runtimeConfig} from '../runtime/config.mjs';
import {migrateUp} from '../runtime/migrations.mjs';
import {PostgresAccountingKernel} from '../runtime/kernel-repository.mjs';
import {PostgresContextIssuer} from '../runtime/context-issuer.mjs';

const config=runtimeConfig();
let admin=null, runtime=null, issuer=null, unavailable=null;
const hash=value=>`sha256:${createHash('sha256').update(String(value)).digest('hex')}`;

before(async()=>{
  try{
    admin=await createPool({databaseUrl:config.migrationDatabaseUrl,applicationName:'refs-posting-sod-admin',max:2});
    await admin.query('SELECT 1');await migrateUp(admin,{});
    runtime=await createPool({databaseUrl:config.databaseUrl,applicationName:'refs-posting-sod-runtime',max:4});
    await runtime.query('SELECT 1');
    issuer=await createPool({databaseUrl:config.contextIssuerDatabaseUrl,applicationName:'refs-posting-sod-issuer',max:2});
    await issuer.query('SELECT 1');
  }catch(error){
    unavailable=`POSTGRES NOT RUN: ${error.code||error.name}: ${error.message}`;
    if(config.requirePostgres)throw error;
    for(const p of [admin,runtime,issuer])if(p)await p.end().catch(()=>{});admin=null;runtime=null;issuer=null;
  }
});
after(async()=>{for(const p of [admin,runtime,issuer])if(p)await p.end();});

async function seed({periodStatus='OPEN'}={}){
  const tenantId=randomUUID(),entityId=randomUUID(),periodId=randomUUID(),journalId=randomUUID(),attachmentId=randomUUID();
  const code=`E${entityId.replaceAll('-','').slice(0,8)}`.toUpperCase();
  await admin.query('INSERT INTO tenant(tenant_id,tenant_code,name) VALUES($1,$2,$3)',[tenantId,`T${tenantId.replaceAll('-','').slice(0,8)}`.toUpperCase(),'SoD contract tenant']);
  await admin.query("INSERT INTO entity(entity_id,tenant_id,entity_code,source_system,source_entity_id,name,base_currency) VALUES($1,$2,$3,'WBS',$3,$3,'USD')",[entityId,tenantId,code]);
  await admin.query("INSERT INTO accounting_period(period_id,tenant_id,entity_id,period_code,starts_on,ends_on,status) VALUES($1,$2,$3,'2026-07','2026-07-01','2026-07-31',$4)",[periodId,tenantId,entityId,periodStatus]);
  await admin.query("INSERT INTO account_master(tenant_id,entity_id,account_code,account_name,requires_member,required_member_type) VALUES($1,$2,'111000','Cash',true,'BANK'),($1,$2,'291001','Accounts Payable',true,'VENDOR')",[tenantId,entityId]);
  await admin.query("INSERT INTO member_master(tenant_id,entity_id,member_ref,member_type,display_name) VALUES($1,$2,'BANK-1','BANK','Operating Cash'),($1,$2,'VENDOR-1','VENDOR','Vendor')",[tenantId,entityId]);
  await admin.query(`INSERT INTO journal_entry(journal_entry_id,tenant_id,entity_id,period_id,journal_number,journal_type,status,journal_date,currency,created_by,reviewed_by,approved_by)
    VALUES($1,$2,$3,$4,$5,'MANUAL','APPROVED','2026-07-15','USD','maker','reviewer','approver')`,[journalId,tenantId,entityId,periodId,`JE-${journalId.slice(0,8)}`]);
  for(const [n,acct,d,c,m] of [[1,'111000',100,0,'BANK-1'],[2,'291001',0,100,'VENDOR-1']])
    await admin.query("INSERT INTO journal_line(tenant_id,entity_id,period_id,journal_entry_id,line_no,account_code,debit_amount,credit_amount,member_ref,dimensions) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'{}'::jsonb)",[tenantId,entityId,periodId,journalId,n,acct,d,c,m]);
  await admin.query(`INSERT INTO attachment(attachment_id,tenant_id,entity_id,name,media_type,size_bytes,content_hash,storage_ref,storage_version,uploaded_by,uploaded_at,verified_at,scan_status,finalization_status,finalized_at)
    VALUES($1,$2,$3,'support.pdf','application/pdf',10,$4,$5,'v1','maker',now(),now(),'CLEAN','VERIFIED_CLEAN',now())`,[attachmentId,tenantId,entityId,hash('attachment'),`object://attachments/${attachmentId}`]);
  await admin.query("INSERT INTO source_link(tenant_id,entity_id,link_type,journal_entry_id,attachment_id,created_by) VALUES($1,$2,'JE_ATTACHMENT',$3,$4,'maker')",[tenantId,entityId,journalId,attachmentId]);
  return {tenantId,entityId,periodId,journalId};
}

// Grant -> issue -> bind -> command, the production chain.
async function grant(ids,actorId,permission,{entityId=ids.entityId}={}){
  const authority=(await admin.query('SELECT authority_class FROM runtime_human_permission_authority WHERE permission_code=$1',[permission])).rows[0]?.authority_class||'ANALYSIS';
  await admin.query(`INSERT INTO runtime_actor_grant(tenant_id,actor_id,entity_id,permission,authority_class,valid_until) VALUES($1,$2,$3,$4,$5,clock_timestamp()+interval '1 hour')
    ON CONFLICT(tenant_id,actor_id,entity_id,permission) DO UPDATE SET authority_class=EXCLUDED.authority_class,valid_until=EXCLUDED.valid_until,revoked_at=NULL`,[ids.tenantId,actorId,entityId,permission,authority]);
}
function kernelFor(ids,actorId,{tenantId=ids.tenantId}={}){
  const contextIssuer=new PostgresContextIssuer(issuer,{principalProvider:async()=>({trusted:true,actorId,tenantId})});
  return new PostgresAccountingKernel(runtime,{sessionProvider:()=>contextIssuer.issue({tenantId})});
}
async function post(ids,{actor,permission='GL.JE.POST',key,grantEntity}){
  if(permission)await grant(ids,actor,permission,grantEntity?{entityId:grantEntity}:{});
  return kernelFor(ids,actor).postJournal({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId,journalEntryId:ids.journalId,expectedRevision:0,idempotencyKey:key||`post-${randomUUID()}`});
}

async function state(ids){
  const q=async(sql,args)=>(await admin.query(sql,args)).rows[0];
  return {
    status:(await q('SELECT status,revision::int AS revision FROM journal_entry WHERE journal_entry_id=$1',[ids.journalId])),
    ledger_lines:(await q('SELECT count(*)::int n FROM ledger_line WHERE journal_entry_id=$1',[ids.journalId])).n,
    batches:(await q('SELECT count(*)::int n FROM posting_batch WHERE tenant_id=$1 AND entity_id=$2',[ids.tenantId,ids.entityId])).n,
    posted_audits:(await q("SELECT count(*)::int n FROM audit_event WHERE tenant_id=$1 AND entity_id=$2 AND event_type='JOURNAL_POSTED'",[ids.tenantId,ids.entityId])).n,
    posted_outbox:(await q("SELECT count(*)::int n FROM outbox_event WHERE tenant_id=$1 AND entity_id=$2 AND event_type='JOURNAL_POSTED'",[ids.tenantId,ids.entityId])).n,
    receipts:(await q("SELECT count(*)::int n FROM idempotency_receipt WHERE tenant_id=$1 AND operation_scope LIKE 'POST_JOURNAL:%'",[ids.tenantId])).n
  };
}
const untouched={status:{status:'APPROVED',revision:0},ledger_lines:0,batches:0,posted_audits:0,posted_outbox:0,receipts:0};

function pgTest(name,fn){test(name,async t=>{if(unavailable){t.skip(unavailable);return;}await fn(t);});}

pgTest('positive path: an independent poster with GL.JE.POST posts once, with ledger, batch, audit and outbox each written exactly once',async()=>{
  const ids=await seed();
  const result=await post(ids,{actor:'poster'});
  assert.equal(result.journal_entry_id,ids.journalId);assert.match(result.posting_batch_id,/^[0-9a-f-]{36}$/);assert.equal(result.idempotent,false);
  assert.deepEqual(await state(ids),{status:{status:'POSTED',revision:1},ledger_lines:2,batches:1,posted_audits:1,posted_outbox:1,receipts:1});
  const audit=(await admin.query("SELECT actor_id,permission_used FROM audit_event WHERE tenant_id=$1 AND event_type='JOURNAL_POSTED'",[ids.tenantId])).rows;
  assert.deepEqual(audit,[{actor_id:'poster',permission_used:'GL.JE.POST'}]);
});

pgTest('segregation of duties: the maker, the reviewer and the approver are each refused as poster with 42501 and zero writes',async()=>{
  for(const actor of ['maker','reviewer','approver']){
    const ids=await seed();
    await assert.rejects(post(ids,{actor}),error=>error.code==='42501'&&/Posting SoD violation/.test(error.message),actor);
    assert.deepEqual(await state(ids),untouched,`${actor} must leave nothing behind`);
  }
});

pgTest('actor binding: session GUC claims are not an authority source - hand-set refs.* claims are refused with 42501 before any write',async()=>{
  const ids=await seed();
  const client=await runtime.connect();
  try{
    await client.query('BEGIN');await client.query('SET LOCAL ROLE refs_app');
    for(const [k,v] of [['refs.tenant_id',ids.tenantId],['refs.entity_ids',ids.entityId],['refs.permissions','GL.JE.POST'],['refs.actor_id','poster']])await client.query('SELECT set_config($1,$2,true)',[k,v]);
    await assert.rejects(client.query('SELECT refs_post_journal($1,$2,$3,$4,0,$5,$6,$7)',[ids.tenantId,ids.entityId,ids.periodId,ids.journalId,'guc-forgery',hash('guc-forgery'),'poster']),error=>error.code==='42501'&&/scope denied/.test(error.message));
    // And the kernel path pins p_actor to the bound context: a caller cannot name another actor.
    await client.query('ROLLBACK');
  }finally{client.release();}
  assert.deepEqual(await state(ids),untouched);
  await grant(ids,'poster','GL.JE.POST');
  const bound=await new PostgresContextIssuer(issuer,{principalProvider:async()=>({trusted:true,actorId:'poster',tenantId:ids.tenantId})}).issue({tenantId:ids.tenantId});
  const client2=await runtime.connect();
  try{
    await client2.query('BEGIN');await client2.query('SET LOCAL ROLE refs_app');
    await client2.query('SELECT refs_bootstrap_context($1)',[bound.contextToken]);
    await assert.rejects(client2.query('SELECT refs_post_journal($1,$2,$3,$4,0,$5,$6,$7)',[ids.tenantId,ids.entityId,ids.periodId,ids.journalId,'actor-spoof',hash('actor-spoof'),'someone-else']),error=>error.code==='42501'&&/Actor mismatch/.test(error.message));
    await client2.query('ROLLBACK');
  }finally{client2.release();}
  assert.deepEqual(await state(ids),untouched);
});

pgTest('authorization: a session without GL.JE.POST is refused by refs_assert_scope with 42501 and zero writes',async()=>{
  const ids=await seed();
  await assert.rejects(post(ids,{actor:'poster',permission:'GL.JE.VIEW'}),error=>error.code==='42501');
  assert.deepEqual(await state(ids),untouched);
});

pgTest('tenant scope: claims for another tenant cannot post into this one (42501), and an entity outside the claim set is refused',async()=>{
  const ids=await seed();
  // A grant on some other entity of the same tenant does not reach this one.
  const otherEntity=randomUUID();
  await admin.query("INSERT INTO entity(entity_id,tenant_id,entity_code,source_system,source_entity_id,name,base_currency) VALUES($1,$2,'OTHER','WBS','OTHER','Other','USD')",[otherEntity,ids.tenantId]);
  await assert.rejects(post(ids,{actor:'poster',grantEntity:otherEntity}),error=>error.code==='42501');
  // A context issued for another tenant cannot act in this one.
  const foreign=await seed();
  await grant(foreign,'poster','GL.JE.POST');
  await assert.rejects(kernelFor(foreign,'poster').postJournal({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId,journalEntryId:ids.journalId,expectedRevision:0,idempotencyKey:'cross-tenant'}),error=>error.code==='42501'||error.code==='TENANT_CONTEXT_MISMATCH');
  assert.deepEqual(await state(ids),untouched);
});

pgTest('period state: posting into a CLOSED period is refused with 55000 and leaves no receipt or ledger row',async()=>{
  const ids=await seed({periodStatus:'CLOSED'});
  await assert.rejects(post(ids,{actor:'poster'}),error=>error.code==='55000'&&/Period is not open/.test(error.message));
  assert.deepEqual(await state(ids),untouched);
});

pgTest('idempotency: the same key replays the posted result without a second batch; a different request under the same key is 23505',async()=>{
  const ids=await seed();
  const first=await post(ids,{actor:'poster',key:'post-replay-0001'});
  const replay=await post(ids,{actor:'poster',key:'post-replay-0001'});
  assert.equal(replay.idempotent,true);assert.equal(replay.posting_batch_id,first.posting_batch_id);
  assert.deepEqual(await state(ids),{status:{status:'POSTED',revision:1},ledger_lines:2,batches:1,posted_audits:1,posted_outbox:1,receipts:1});
  // Same key, different request hash: the receipt refuses to be reused.
  await assert.rejects(kernelFor(ids,'poster').postJournal({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId,journalEntryId:ids.journalId,expectedRevision:1,idempotencyKey:'post-replay-0001'}),error=>error.code==='23505');
});
