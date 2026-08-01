import test,{after,before} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {runtimeConfig} from '../runtime/config.mjs';
import {createPool} from '../runtime/db.mjs';
import {migrateDown,migrateUp} from '../runtime/migrations.mjs';
import {PostgresAccountingKernel} from '../runtime/kernel-repository.mjs';
import {PostgresContextIssuer} from '../runtime/context-issuer.mjs';

const config=runtimeConfig();
let adminPool=null;
let runtimePool=null;
let issuerPool=null;
let unavailable=null;

before(async()=>{
  try{
    adminPool=await createPool({databaseUrl:config.migrationDatabaseUrl,applicationName:'refs-pg-integration-admin',max:8});
    await adminPool.query('SELECT 1');
    await migrateUp(adminPool);
    runtimePool=await createPool({databaseUrl:config.databaseUrl,applicationName:'refs-pg-integration-runtime',max:8});
    await runtimePool.query('SELECT 1');
    issuerPool=await createPool({databaseUrl:config.contextIssuerDatabaseUrl,applicationName:'refs-pg-integration-issuer',max:4});
    await issuerPool.query('SELECT 1');
  }catch(error){
    unavailable=`POSTGRES NOT RUN: ${error.code||error.name}: ${error.message}`;
    if(config.requirePostgres)throw error;
    if(adminPool)await adminPool.end().catch(()=>{});
    adminPool=null;runtimePool=null;issuerPool=null;
  }
});

after(async()=>{
  if(adminPool)await adminPool.query('TRUNCATE tenant CASCADE').catch(()=>{});
  if(runtimePool)await runtimePool.end();
  if(issuerPool)await issuerPool.end();
  if(adminPool)await adminPool.end();
});

function pgTest(name,fn){
  test(name,async t=>{
    if(unavailable){t.skip(unavailable);return;}
    await adminPool.query('TRUNCATE tenant CASCADE');
    await fn(t);
  });
}

const hash=value=>`sha256:${String(value).padEnd(64,'0').slice(0,64)}`;

async function seed({status='APPROVED',journalType='MANUAL',attachmentStatus='VERIFIED_CLEAN',tenantId=randomUUID(),entityId=randomUUID(),periodId=randomUUID(),journalId=randomUUID()}={}){
  await adminPool.query('INSERT INTO tenant(tenant_id,tenant_code,name) VALUES($1,$2,$3)',[tenantId,`T${tenantId.replaceAll('-','').slice(0,8)}`,'Test tenant']);
  await adminPool.query("INSERT INTO entity(entity_id,tenant_id,entity_code,source_system,source_entity_id,name,base_currency) VALUES($1,$2,$3,'WBS',$3,$3,'USD')",[entityId,tenantId,`E${entityId.replaceAll('-','').slice(0,8)}`]);
  await adminPool.query("INSERT INTO accounting_period(period_id,tenant_id,entity_id,period_code,starts_on,ends_on,status) VALUES($1,$2,$3,'2026-07','2026-07-01','2026-07-31','OPEN')",[periodId,tenantId,entityId]);
  await adminPool.query("INSERT INTO account_master(tenant_id,entity_id,account_code,account_name,requires_member) VALUES($1,$2,'111000','Cash',true),($1,$2,'291001','Accounts Payable',true)",[tenantId,entityId]);
  await adminPool.query("INSERT INTO member_master(tenant_id,entity_id,member_ref,member_type,display_name) VALUES($1,$2,'BANK-1','BANK','Operating Cash'),($1,$2,'VENDOR-1','VENDOR','Vendor')",[tenantId,entityId]);
  const actors=status==='DRAFT'?[null,null,null]:['reviewer','approver',null];
  await adminPool.query(`INSERT INTO journal_entry(journal_entry_id,tenant_id,entity_id,period_id,journal_number,journal_type,status,journal_date,currency,created_by,reviewed_by,approved_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,'2026-07-15','USD','maker',$8,$9)`,[journalId,tenantId,entityId,periodId,`JE-${journalId.slice(0,8)}`,journalType,status,actors[0],actors[1]]);
  await adminPool.query(`INSERT INTO journal_line(tenant_id,entity_id,period_id,journal_entry_id,line_no,account_code,debit_amount,credit_amount,member_ref)
    VALUES($1,$2,$3,$4,1,'111000',100,0,'BANK-1'),($1,$2,$3,$4,2,'291001',0,100,'VENDOR-1')`,[tenantId,entityId,periodId,journalId]);
  if(attachmentStatus){
    const attachmentId=randomUUID();
    await adminPool.query(`INSERT INTO attachment(attachment_id,tenant_id,name,media_type,size_bytes,content_hash,storage_ref,storage_version,uploaded_by,uploaded_at,verified_at,scan_status,finalization_status,finalized_at)
      VALUES($1,$2,'support.pdf','application/pdf',10,$3,$4,'v1','maker',now(),CASE WHEN $5='VERIFIED_CLEAN' THEN now() END,CASE WHEN $5='VERIFIED_CLEAN' THEN 'CLEAN' WHEN $5='REJECTED' THEN 'REJECTED' ELSE 'PENDING' END,$5,CASE WHEN $5='VERIFIED_CLEAN' THEN now() END)`,[attachmentId,tenantId,hash('attachment'),`object://attachments/${attachmentId}`,attachmentStatus]);
    await adminPool.query("INSERT INTO source_link(tenant_id,entity_id,link_type,journal_entry_id,attachment_id,created_by) VALUES($1,$2,'JE_ATTACHMENT',$3,$4,'maker')",[tenantId,entityId,journalId,attachmentId]);
  }
  return {tenantId,entityId,periodId,journalId};
}

async function attachAutoSource(ids){
  const batchId=randomUUID(),rawId=randomUUID(),documentId=randomUUID(),recordId=`AUTO-${ids.journalId}`;
  await adminPool.query("INSERT INTO import_batch(import_batch_id,tenant_id,connector_code,source_module,source_entity_id,idempotency_key,request_hash) VALUES($1,$2,'TEST','bankFeed',$3,$4,$5)",[batchId,ids.tenantId,ids.entityId,'auto-import-'+ids.journalId,hash('auto-import')]);
  await adminPool.query(`INSERT INTO raw_event(raw_event_id,tenant_id,import_batch_id,source_system,source_module,source_entity_id,source_record_id,source_version,event_type,occurred_at,payload_hash,payload_ref,correlation_id)
    VALUES($1,$2,$3,'WBS','bankFeed',$4,$5,'1','UPSERT',now(),$6,$7,$5)`,[rawId,ids.tenantId,batchId,ids.entityId,recordId,hash('auto-raw'),`object://raw/${rawId}`]);
  await adminPool.query(`INSERT INTO source_document(source_document_id,tenant_id,entity_id,raw_event_id,source_system,source_module,source_entity_id,source_record_id,source_version,document_type,business_date,accounting_date,currency,gross_amount,source_ref,payload_hash)
    VALUES($1,$2,$3,$4,'WBS','bankFeed',$5,$6,'1','BANK_TRANSACTION','2026-07-15','2026-07-15','USD',100,$7,$8)`,[documentId,ids.tenantId,ids.entityId,rawId,ids.entityId,recordId,`WBS:${recordId}`,hash('auto-doc')]);
  await adminPool.query("INSERT INTO source_link(tenant_id,entity_id,link_type,source_document_id,journal_entry_id,created_by) VALUES($1,$2,'SOURCE_TO_JE',$3,$4,'engine')",[ids.tenantId,ids.entityId,documentId,ids.journalId]);
}

async function trustedSession(ids,actorId='poster',permissions=['GL.JE.POST']){
  for(const permission of permissions)await adminPool.query(`INSERT INTO runtime_actor_grant(tenant_id,actor_id,entity_id,permission)
    VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`,[ids.tenantId,actorId,ids.entityId,permission]);
  const issuer=new PostgresContextIssuer(issuerPool,{principalProvider:async()=>({trusted:true,actorId})});
  return issuer.issue({tenantId:ids.tenantId});
}

const sessionProvider=(ids,actorId='poster',permissions=['GL.JE.POST'])=>()=>trustedSession(ids,actorId,permissions);

pgTest('migration clean down and up is reversible from the fixed manifest',async()=>{
  await migrateDown(adminPool,{all:true});
  const missing=await adminPool.query("SELECT to_regclass('public.tenant') AS tenant_table");
  assert.equal(missing.rows[0].tenant_table,null);
  await migrateUp(adminPool);
  const present=await adminPool.query("SELECT to_regprocedure('refs_post_journal(uuid,uuid,uuid,uuid,bigint,text,text,text)') AS post_fn");
  assert.ok(present.rows[0].post_fn);
});

pgTest('concurrent up and down runners serialize on the same advisory lock',async()=>{
  await Promise.all([migrateDown(adminPool,{all:true}),migrateUp(adminPool)]);
  await migrateUp(adminPool);
  const applied=await adminPool.query('SELECT migration_name FROM refs_schema_migration ORDER BY migration_name');
  assert.deepEqual(applied.rows.map(row=>row.migration_name),['001_wbs_accounting_core.sql','002_accounting_runtime.sql']);
  assert.ok((await adminPool.query("SELECT to_regprocedure('refs_post_journal(uuid,uuid,uuid,uuid,bigint,text,text,text)') AS post_fn")).rows[0].post_fn);
});

pgTest('runtime login is non-owner/non-superuser and RLS denies cross-tenant access and direct writes',async()=>{
  const one=await seed();
  const two=await seed();
  const client=await runtimePool.connect();
  try{
    await client.query('BEGIN');
    const identity=(await client.query("SELECT session_user,current_user,(SELECT rolsuper FROM pg_roles WHERE rolname=session_user) AS super")).rows[0];
    assert.equal(identity.session_user,'refs_runtime');
    assert.equal(identity.current_user,'refs_runtime');
    assert.equal(identity.super,false);
    await client.query('SET LOCAL ROLE refs_app');
    await client.query("SELECT set_config('refs.tenant_id',$1,true),set_config('refs.entity_ids',$2,true),set_config('refs.permissions','*',true),set_config('refs.actor_id','victim',true)",[two.tenantId,two.entityId]);
    assert.equal((await client.query('SELECT count(*)::int AS n FROM entity')).rows[0].n,0);
    await assert.rejects(client.query('SELECT refs_reserve_idempotency($1,$2,$3,$4,$5)',[two.tenantId,`POST_JOURNAL:${two.entityId}`,'forged-key-0001',hash('forged'),'victim']),error=>error.code==='42501');
    await assert.rejects(client.query("UPDATE entity SET name='forbidden' WHERE entity_id=$1",[one.entityId]),error=>error.code==='42501');
    await client.query('ROLLBACK');

    const legitimate=await trustedSession(one);
    const legitimateHash='sha256:'+createHash('sha256').update(legitimate.contextToken).digest('hex');
    await client.query('BEGIN');await client.query('SET LOCAL ROLE refs_app');
    await client.query('SELECT refs_bootstrap_context($1)',[legitimate.contextToken]);
    assert.deepEqual((await client.query('SELECT entity_id FROM entity')).rows.map(row=>row.entity_id),[one.entityId]);
    await client.query('COMMIT');
    await client.query('BEGIN');await client.query('SET LOCAL ROLE refs_app');
    await client.query("SELECT set_config('refs.context_hash',$1,true)",[legitimateHash]);
    assert.equal((await client.query('SELECT count(*)::int AS n FROM entity')).rows[0].n,0,'a pooled backend cannot replay a prior transaction context');
    await client.query('ROLLBACK');
  }finally{client.release();}
  const roleClient=await runtimePool.connect();
  try{await roleClient.query('BEGIN');await assert.rejects(roleClient.query('SET LOCAL ROLE refs_migrator'),error=>error.code==='42501');await roleClient.query('ROLLBACK');}finally{roleClient.release();}
  assert.notEqual(one.tenantId,two.tenantId);
});

pgTest('missing, empty, malformed and unknown session claims fail closed with zero writes',async()=>{
  const ids=await seed();
  const cases=[
    [],
    [['refs.tenant_id',''],['refs.entity_ids',''],['refs.permissions',''],['refs.actor_id','']],
    [['refs.tenant_id',ids.tenantId],['refs.entity_ids','not-a-uuid'],['refs.permissions','GL.PERIOD.CLOSE'],['refs.actor_id','closer']],
    [['refs.tenant_id',ids.tenantId],['refs.entity_ids',ids.entityId],['refs.permissions','UNKNOWN'],['refs.actor_id','closer']]
  ];
  for(const claims of cases){
    const client=await runtimePool.connect();
    try{
      await client.query('BEGIN');await client.query('SET LOCAL ROLE refs_app');
      for(const [key,value] of claims)await client.query('SELECT set_config($1,$2,true)',[key,value]);
      await assert.rejects(client.query('SELECT refs_close_period($1,$2,$3,0,$4,$5,$6)',[ids.tenantId,ids.entityId,ids.periodId,'close-negative',hash('close-negative'),'closer']),error=>error.code==='42501');
      await client.query('ROLLBACK');
    }finally{client.release();}
  }
  assert.equal((await adminPool.query('SELECT version FROM accounting_period WHERE period_id=$1',[ids.periodId])).rows[0].version,'0');
});

pgTest('context authorization preserves exact entity and permission pairs',async()=>{
  const ids=await seed();const entityB=randomUUID();const actor='pair-actor';
  await adminPool.query("INSERT INTO entity(entity_id,tenant_id,entity_code,source_system,source_entity_id,name,base_currency) VALUES($1,$2,'PAIR-B','WBS','PAIR-B','Pair B','USD')",[entityB,ids.tenantId]);
  await adminPool.query(`INSERT INTO runtime_actor_grant(tenant_id,actor_id,entity_id,permission) VALUES
    ($1,$2,$3,'GL.JE.POST'),($1,$2,$4,'AP.VIEW')`,[ids.tenantId,actor,ids.entityId,entityB]);
  const issuer=new PostgresContextIssuer(issuerPool,{principalProvider:async()=>({trusted:true,actorId:actor})});
  const kernel=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>issuer.issue({tenantId:ids.tenantId})});
  await kernel.inSession(client=>client.query("SELECT refs_assert_scope($1,$2,'GL.JE.POST')",[ids.tenantId,ids.entityId]));
  await kernel.inSession(client=>client.query("SELECT refs_assert_scope($1,$2,'AP.VIEW')",[ids.tenantId,entityB]));
  await assert.rejects(kernel.inSession(client=>client.query("SELECT refs_assert_scope($1,$2,'GL.JE.POST')",[ids.tenantId,entityB])),error=>error.code==='42501');
  await assert.rejects(kernel.inSession(client=>client.query("SELECT refs_assert_scope($1,$2,'AP.VIEW')",[ids.tenantId,ids.entityId])),error=>error.code==='42501');
});

pgTest('context issuer rejects wrong, revoked, expired, and runtime-self-issued capabilities',async()=>{
  const ids=await seed();const actor='context-user';
  await adminPool.query("INSERT INTO runtime_actor_grant(tenant_id,actor_id,entity_id,permission) VALUES($1,$2,$3,'GL.JE.POST')",[ids.tenantId,actor,ids.entityId]);
  const issuer=new PostgresContextIssuer(issuerPool,{principalProvider:async()=>({trusted:true,actorId:actor})});
  const issued=await issuer.issue({tenantId:ids.tenantId});
  const kernel=new PostgresAccountingKernel(runtimePool,{sessionProvider:async()=>issued});
  await issuer.revoke({contextToken:issued.contextToken,reason:'security test'});
  await assert.rejects(kernel.inSession(client=>client.query('SELECT 1')),error=>error.code==='42501');
  const expired=await issuer.issue({tenantId:ids.tenantId});
  await adminPool.query('UPDATE runtime_auth_context SET expires_at=now()-interval \'1 second\' WHERE token_hash=$1',['sha256:'+createHash('sha256').update(expired.contextToken).digest('hex')]);
  await assert.rejects(new PostgresAccountingKernel(runtimePool,{sessionProvider:async()=>expired}).inSession(client=>client.query('SELECT 1')),error=>error.code==='42501');
  await assert.rejects(new PostgresAccountingKernel(runtimePool,{sessionProvider:async()=>({trusted:true,contextToken:'x'.repeat(43)})}).inSession(client=>client.query('SELECT 1')),error=>error.code==='42501');
  const runtime=await runtimePool.connect();
  try{await runtime.query('BEGIN');await runtime.query('SET LOCAL ROLE refs_app');await assert.rejects(runtime.query("SELECT refs_issue_context($1,$2,$3,60)",[actor,ids.tenantId,hash('self-issue')]),error=>error.code==='42501');await runtime.query('ROLLBACK');}finally{runtime.release();}
});

pgTest('two connections enforce duplicate canonical raw source and atomic idempotency compare/replay',async()=>{
  const ids=await seed();
  const batch=randomUUID();
  await adminPool.query("INSERT INTO import_batch(import_batch_id,tenant_id,connector_code,source_module,source_entity_id,idempotency_key,request_hash) VALUES($1,$2,'WBS','bankFeed',$3,'import-key-0001',$4)",[batch,ids.tenantId,ids.entityId,hash('a')]);
  const params=[randomUUID(),ids.tenantId,batch,'WBS','bankFeed',ids.entityId,'BANK-1','1','UPSERT','2026-07-15',hash('b'),'object://raw/1','corr-1'];
  const insert=`INSERT INTO raw_event(raw_event_id,tenant_id,import_batch_id,source_system,source_module,source_entity_id,source_record_id,source_version,event_type,occurred_at,payload_hash,payload_ref,correlation_id) VALUES(${params.map((_,i)=>`$${i+1}`).join(',')})`;
  await adminPool.query(insert,params);
  await assert.rejects(adminPool.query(insert,[randomUUID(),...params.slice(1)]),error=>error.code==='23505');

  const args={...ids,journalEntryId:ids.journalId,expectedRevision:0,idempotencyKey:'same-key-0001',requestHash:hash('c')};
  const firstKernel=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids)});
  const secondKernel=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids)});
  const [first,second]=await Promise.all([firstKernel.postJournal(args),secondKernel.postJournal(args)]);
  assert.equal([first.idempotent,second.idempotent].filter(Boolean).length,1);
  await assert.rejects(firstKernel.postJournal({...args,requestHash:hash('different')}),error=>error.code==='23505');
});

pgTest('period close and post serialize on the period row',async()=>{
  const ids=await seed();
  const closeClient=await runtimePool.connect();
  try{
    await closeClient.query('BEGIN');await closeClient.query('SET LOCAL ROLE refs_app');
    const closeSession=await trustedSession(ids,'closer',['GL.PERIOD.CLOSE']);
    await closeClient.query('SELECT refs_bootstrap_context($1)',[closeSession.contextToken]);
    await closeClient.query('SELECT refs_close_period($1,$2,$3,0,$4,$5,refs_current_actor())',[ids.tenantId,ids.entityId,ids.periodId,'close-race-key',hash('close-race')]);
    const kernel=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids)});
    const posting=kernel.postJournal({...ids,journalEntryId:ids.journalId,expectedRevision:0,idempotencyKey:'post-close-race',requestHash:hash('race')});
    await new Promise(resolve=>setTimeout(resolve,100));
    await closeClient.query('COMMIT');
    await assert.rejects(posting,error=>error.code==='55000');
  }finally{closeClient.release();}
  assert.equal((await adminPool.query('SELECT count(*)::int AS n FROM ledger_line')).rows[0].n,0);
});

pgTest('period close is OPEN-only, audited, idempotent and replayable',async()=>{
  const ids=await seed();
  const kernel=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'closer',['GL.PERIOD.CLOSE'])});
  const args={...ids,expectedVersion:0,idempotencyKey:'close-key-0001',requestHash:hash('close')};
  const first=await kernel.closePeriod(args);
  const replay=await kernel.closePeriod(args);
  assert.equal(first.status,'CLOSED');assert.equal(first.idempotent,false);assert.equal(replay.idempotent,true);
  await assert.rejects(kernel.closePeriod({...args,idempotencyKey:'close-key-0002',requestHash:hash('close2')}),error=>error.code==='55000');
  assert.equal((await adminPool.query("SELECT count(*)::int AS n FROM audit_event WHERE event_type='PERIOD_CLOSED'")).rows[0].n,1);
  assert.equal((await adminPool.query("SELECT count(*)::int AS n FROM outbox_event WHERE event_type='PERIOD_CLOSED'")).rows[0].n,1);
});

pgTest('CAS edit rejects stale revision and forged body actor is not an input surface',async()=>{
  const ids=await seed({status:'DRAFT'});
  const kernel=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'editor',['GL.JE.EDIT'])});
  const first=await kernel.updateDraftDescription({...ids,journalEntryId:ids.journalId,expectedRevision:0,description:'first',idempotencyKey:'edit-key-0001',requestHash:hash('edit1'),actorId:'forged'});
  assert.equal(first.revision,1);
  await assert.rejects(kernel.updateDraftDescription({...ids,journalEntryId:ids.journalId,expectedRevision:0,description:'stale',idempotencyKey:'edit-key-0002',requestHash:hash('edit2')}),error=>error.code==='40001');
  assert.equal((await adminPool.query('SELECT actor_id FROM audit_event WHERE object_id=$1',[ids.journalId])).rows[0].actor_id,'editor');
});

pgTest('caller transaction failure rolls back posting, ledger, trace, audit, outbox and receipt',async()=>{
  const ids=await seed();
  const client=await runtimePool.connect();
  try{
    const session=await trustedSession(ids);
    await client.query('BEGIN');await client.query('SET LOCAL ROLE refs_app');await client.query('SELECT refs_bootstrap_context($1)',[session.contextToken]);
    await client.query('SELECT refs_post_journal($1,$2,$3,$4,0,$5,$6,refs_current_actor())',[ids.tenantId,ids.entityId,ids.periodId,ids.journalId,'rollback-post',hash('rollback')]);
    await assert.rejects(client.query('SELECT 1/0'),error=>error.code==='22012');
    await client.query('ROLLBACK');
  }finally{client.release();}
  for(const table of ['posting_batch','ledger_line','source_link','audit_event','outbox_event','idempotency_receipt'])assert.equal((await adminPool.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n,0,table);
  assert.equal((await adminPool.query('SELECT status FROM journal_entry WHERE journal_entry_id=$1',[ids.journalId])).rows[0].status,'APPROVED');
});

pgTest('database posting rejects unsupported MANUAL and AUTO evidence with zero writes',async()=>{
  for(const fixture of [
    await seed({journalType:'MANUAL',attachmentStatus:null}),
    await seed({journalType:'RECLASS',attachmentStatus:null}),
    await seed({journalType:'AUTO',attachmentStatus:null})
  ]){
    const kernel=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(fixture)});
    await assert.rejects(kernel.postJournal({...fixture,journalEntryId:fixture.journalId,expectedRevision:0,idempotencyKey:`evidence-${fixture.journalId}`,requestHash:hash(fixture.journalId)}),error=>error.code==='23514');
  }
  for(const table of ['posting_batch','ledger_line','audit_event','outbox_event','idempotency_receipt'])assert.equal((await adminPool.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n,0,table);
});

pgTest('pending and rejected attachments cannot enter the JE trace graph',async()=>{
  for(const status of ['PENDING','REJECTED']){
    const ids=await seed({attachmentStatus:null}),attachmentId=randomUUID();
    await adminPool.query(`INSERT INTO attachment(attachment_id,tenant_id,name,media_type,size_bytes,content_hash,storage_ref,storage_version,uploaded_by,uploaded_at,scan_status,finalization_status)
      VALUES($1,$2,'unsafe.pdf','application/pdf',10,$3,$4,'v1','maker',now(),$5,$6)`,[attachmentId,ids.tenantId,hash(status),`object://attachments/${attachmentId}`,status,status]);
    await assert.rejects(adminPool.query("INSERT INTO source_link(tenant_id,entity_id,link_type,journal_entry_id,attachment_id,created_by) VALUES($1,$2,'JE_ATTACHMENT',$3,$4,'maker')",[ids.tenantId,ids.entityId,ids.journalId,attachmentId]),error=>error.code==='23514');
  }
});

pgTest('automatic journal posts without manual attachment only when immutable source evidence exists',async()=>{
  const ids=await seed({journalType:'AUTO',attachmentStatus:null});await attachAutoSource(ids);
  const kernel=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids)});
  const result=await kernel.postJournal({...ids,journalEntryId:ids.journalId,expectedRevision:0,idempotencyKey:'auto-source-post',requestHash:hash('auto-source')});
  assert.equal(result.idempotent,false);
  assert.equal((await adminPool.query('SELECT count(*)::int AS n FROM ledger_line WHERE journal_entry_id=$1',[ids.journalId])).rows[0].n,2);
});

pgTest('posting is atomic, same-hash retry replays before state validation, different hash conflicts',async()=>{
  const ids=await seed();
  const kernel=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids)});
  const args={...ids,journalEntryId:ids.journalId,expectedRevision:0,idempotencyKey:'post-key-0001',requestHash:hash('post')};
  const first=await kernel.postJournal(args);
  const replay=await kernel.postJournal(args);
  assert.equal(first.idempotent,false);assert.equal(replay.idempotent,true);assert.equal(replay.posting_batch_id,first.posting_batch_id);
  await assert.rejects(kernel.postJournal({...args,requestHash:hash('changed')}),error=>error.code==='23505');
  assert.equal((await adminPool.query('SELECT count(*)::int AS n FROM ledger_line')).rows[0].n,2);
  assert.equal((await adminPool.query('SELECT count(*)::int AS n FROM source_link')).rows[0].n,2);
  assert.equal((await adminPool.query('SELECT count(*)::int AS n FROM audit_event')).rows[0].n,1);
  assert.equal((await adminPool.query('SELECT count(*)::int AS n FROM outbox_event')).rows[0].n,1);
});

pgTest('posted journal, ledger, audit and outbox payload are immutable; outbox claim is exclusive',async()=>{
  const ids=await seed();
  const kernel=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids)});
  await kernel.postJournal({...ids,journalEntryId:ids.journalId,expectedRevision:0,idempotencyKey:'immutable-post',requestHash:hash('immutable')});
  await assert.rejects(adminPool.query("UPDATE journal_entry SET description='tamper' WHERE journal_entry_id=$1",[ids.journalId]),error=>error.code==='55000');
  await assert.rejects(adminPool.query('UPDATE ledger_line SET debit_amount=999 WHERE journal_entry_id=$1',[ids.journalId]),error=>error.code==='55000');
  await assert.rejects(adminPool.query("UPDATE audit_event SET action='tamper' WHERE object_id=$1",[ids.journalId]),error=>error.code==='55000');
  await assert.rejects(adminPool.query("UPDATE outbox_event SET payload='{}' WHERE aggregate_id=$1",[ids.journalId]),error=>error.code==='55000');
  const entityB=randomUUID(),eventB=randomUUID(),aggregateB=randomUUID();
  await adminPool.query("INSERT INTO entity(entity_id,tenant_id,entity_code,source_system,source_entity_id,name,base_currency) VALUES($1,$2,'OUTBOX-B','WBS','OUTBOX-B','Outbox B','USD')",[entityB,ids.tenantId]);
  await adminPool.query("INSERT INTO outbox_event(outbox_event_id,tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash) VALUES($1,$2,$3,'TEST',$4,'ENTITY_B_EVENT','{}',$5)",[eventB,ids.tenantId,entityB,aggregateB,hash('entity-b-event')]);
  const dispatcher=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'worker-1',['OUTBOX.DISPATCH'])});
  assert.equal((await dispatcher.claimOutbox({tenantId:ids.tenantId})).length,1);
  await assert.rejects(dispatcher.completeOutbox({tenantId:ids.tenantId,eventId:eventB,success:true}),error=>error.code==='42501');
  const second=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'worker-2',['OUTBOX.DISPATCH'])});
  assert.equal((await second.claimOutbox({tenantId:ids.tenantId})).length,0);
});
