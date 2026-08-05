import test,{after,before} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,randomUUID,sign} from 'node:crypto';
import {spawn} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {runtimeConfig} from '../runtime/config.mjs';
import {createPool} from '../runtime/db.mjs';
import {migrateDown,migrateUp} from '../runtime/migrations.mjs';
import {PostgresAccountingKernel} from '../runtime/kernel-repository.mjs';
import {createAccountingApi} from '../api/accounting-http.mjs';
import {PostgresContextIssuer} from '../runtime/context-issuer.mjs';
import {PostgresGrantSync} from '../runtime/grant-sync.mjs';
import {AttachmentEvidenceService,AttachmentCleanupService} from '../runtime/attachment-storage.mjs';
import {MIGRATION_MANIFEST} from '../runtime/migration-manifest.mjs';
import {canonicalRequestHash} from '../runtime/request-hash.mjs';
import {createWbsSnapshotSignatureVerifier} from '../runtime/wbs-snapshot-signature.mjs';
import {createProductionAccountingServer} from '../runtime/accounting-server.mjs';
import {OidcJwtAuthenticator} from '../api/oidc-authenticator.mjs';

const config=runtimeConfig();
let adminPool=null;
let runtimePool=null;
let issuerPool=null;
let grantSyncPool=null;
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
    grantSyncPool=await createPool({databaseUrl:config.grantSyncDatabaseUrl,applicationName:'refs-pg-integration-grant-sync',max:4});
    await grantSyncPool.query('SELECT 1');
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
  if(grantSyncPool)await grantSyncPool.end();
  if(adminPool)await adminPool.end();
});

function pgTest(name,fn){
  test(name,async t=>{
    if(unavailable){t.skip(unavailable);return;}
    await adminPool.query('TRUNCATE tenant CASCADE');
    await fn(t);
  });
}

const hash=value=>`sha256:${createHash('sha256').update(String(value)).digest('hex')}`;

async function rejectsInTransaction(client,query,validator){
  await client.query('SAVEPOINT expected_error');
  try{await assert.rejects(query(),validator);}
  finally{
    await client.query('ROLLBACK TO SAVEPOINT expected_error');
    await client.query('RELEASE SAVEPOINT expected_error');
  }
}

async function seed({status='APPROVED',journalType='MANUAL',attachmentStatus='VERIFIED_CLEAN',tenantId=randomUUID(),entityId=randomUUID(),periodId=randomUUID(),journalId=randomUUID(),extraAccounts=[],extraMembers=[],journalLines=null}={}){
  const sourceEntityId=`E${entityId.replaceAll('-','').slice(0,8)}`.toUpperCase();
  await adminPool.query('INSERT INTO tenant(tenant_id,tenant_code,name) VALUES($1,$2,$3) ON CONFLICT (tenant_id) DO NOTHING',[tenantId,`T${tenantId.replaceAll('-','').slice(0,8)}`.toUpperCase(),'Test tenant']);
  await adminPool.query("INSERT INTO entity(entity_id,tenant_id,entity_code,source_system,source_entity_id,name,base_currency) VALUES($1,$2,$3,'WBS',$3,$3,'USD')",[entityId,tenantId,sourceEntityId]);
  await adminPool.query("INSERT INTO accounting_period(period_id,tenant_id,entity_id,period_code,starts_on,ends_on,status) VALUES($1,$2,$3,'2026-07','2026-07-01','2026-07-31','OPEN')",[periodId,tenantId,entityId]);
  await adminPool.query("INSERT INTO account_master(tenant_id,entity_id,account_code,account_name,requires_member,required_member_type) VALUES($1,$2,'111000','Cash',true,'BANK'),($1,$2,'291001','Accounts Payable',true,'VENDOR'),($1,$2,'120200','Accounts Receivable',true,'CUSTOMER_OR_AFFILIATE')",[tenantId,entityId]);
  await adminPool.query("INSERT INTO member_master(tenant_id,entity_id,member_ref,member_type,display_name) VALUES($1,$2,'BANK-1','BANK','Operating Cash'),($1,$2,'VENDOR-1','VENDOR','Vendor')",[tenantId,entityId]);
  for(const account of extraAccounts)await adminPool.query('INSERT INTO account_master(tenant_id,entity_id,account_code,account_name,requires_member,required_member_type) VALUES($1,$2,$3,$4,$5,$6)',[tenantId,entityId,account.accountCode,account.accountName,account.requiresMember??false,account.requiredMemberType??null]);
  for(const member of extraMembers)await adminPool.query('INSERT INTO member_master(tenant_id,entity_id,member_ref,member_type,display_name) VALUES($1,$2,$3,$4,$5)',[tenantId,entityId,member.memberRef,member.memberType,member.displayName]);
  const actors=status==='DRAFT'?[null,null,null]:['reviewer','approver',null];
  await adminPool.query(`INSERT INTO journal_entry(journal_entry_id,tenant_id,entity_id,period_id,journal_number,journal_type,status,journal_date,currency,created_by,reviewed_by,approved_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,'2026-07-15','USD','maker',$8,$9)`,[journalId,tenantId,entityId,periodId,`JE-${journalId.slice(0,8)}`,journalType,status,actors[0],actors[1]]);
  const lines=journalLines||[{lineNo:1,accountCode:'111000',debit:100,credit:0,memberRef:'BANK-1'},{lineNo:2,accountCode:'291001',debit:0,credit:100,memberRef:'VENDOR-1'}];
  for(const line of lines)await adminPool.query('INSERT INTO journal_line(tenant_id,entity_id,period_id,journal_entry_id,line_no,account_code,debit_amount,credit_amount,member_ref) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[tenantId,entityId,periodId,journalId,line.lineNo,line.accountCode,line.debit,line.credit,line.memberRef??null]);
  if(attachmentStatus){
    const attachmentId=randomUUID();
    await adminPool.query(`INSERT INTO attachment(attachment_id,tenant_id,entity_id,name,media_type,size_bytes,content_hash,storage_ref,storage_version,uploaded_by,uploaded_at,verified_at,scan_status,finalization_status,finalized_at)
      VALUES($1,$2,$3,'support.pdf','application/pdf',10,$4,$5,'v1','maker',now(),CASE WHEN $6='VERIFIED_CLEAN' THEN now() END,CASE WHEN $6='VERIFIED_CLEAN' THEN 'CLEAN' WHEN $6='REJECTED' THEN 'REJECTED' ELSE 'PENDING' END,$6,CASE WHEN $6='VERIFIED_CLEAN' THEN now() END)`,[attachmentId,tenantId,entityId,hash('attachment'),`object://attachments/${attachmentId}`,attachmentStatus]);
    await adminPool.query("INSERT INTO source_link(tenant_id,entity_id,link_type,journal_entry_id,attachment_id,created_by) VALUES($1,$2,'JE_ATTACHMENT',$3,$4,'maker')",[tenantId,entityId,journalId,attachmentId]);
  }
  return {tenantId,entityId,sourceEntityId,periodId,journalId};
}

async function attachAutoSource(ids,{effectiveFrom='2026-01-01T00:00:00Z',effectiveTo=null,mappingPriority=0,evaluatedAt=null,linkJournal=true,reuseApprovedSnapshots=false}={}){
  const batchId=randomUUID(),rawId=randomUUID(),documentId=randomUUID(),ruleId=randomUUID(),stagingId=randomUUID(),recordId=`AUTO-${ids.journalId}`;let settingId=randomUUID(),mappingId=randomUUID();
  const inputKeyHash=hash('mapping-key');
  const configHashes=(await adminPool.query("SELECT refs_jsonb_hash('{}'::jsonb) AS setting_hash,refs_jsonb_hash(jsonb_build_object('input_keys','{}'::jsonb,'output_rules','{}'::jsonb)) AS mapping_hash")).rows[0];
  await adminPool.query("INSERT INTO import_batch(import_batch_id,tenant_id,entity_id,connector_code,source_module,source_entity_id,idempotency_key,request_hash) VALUES($1,$2,$3,'WBS_API','bankFeed',$4,$5,$6)",[batchId,ids.tenantId,ids.entityId,ids.sourceEntityId,'auto-import-'+ids.journalId,hash('auto-import')]);
  await adminPool.query(`INSERT INTO raw_event(raw_event_id,tenant_id,entity_id,import_batch_id,source_system,source_module,source_entity_id,source_record_id,source_version,event_type,occurred_at,payload_hash,payload_ref,correlation_id)
    VALUES($1,$2,$3,$4,'WBS','bankFeed',$5,$6,'1','UPSERT',now(),$7,$8,$6)`,[rawId,ids.tenantId,ids.entityId,batchId,ids.sourceEntityId,recordId,hash('auto-raw'),`object://raw/${rawId}`]);
  await adminPool.query(`INSERT INTO source_document(source_document_id,tenant_id,entity_id,raw_event_id,source_system,source_module,source_entity_id,source_record_id,source_version,document_type,business_date,accounting_date,currency,gross_amount,source_ref,payload_hash)
    VALUES($1,$2,$3,$4,'WBS','bankFeed',$5,$6,'1','BANK_TRANSACTION','2026-07-15','2026-07-15','USD',100,$7,$8)`,[documentId,ids.tenantId,ids.entityId,rawId,ids.sourceEntityId,recordId,`WBS:${recordId}`,hash('auto-doc')]);
  if(reuseApprovedSnapshots){
    const existingSetting=(await adminPool.query(`SELECT setting_snapshot_id FROM setting_snapshot WHERE tenant_id=$1 AND entity_id=$2 AND family='BANK' AND scope_type='ENTITY' AND scope_key=$2::text AND status IN ('APPROVED','RETIRED') ORDER BY version DESC LIMIT 1`,[ids.tenantId,ids.entityId])).rows[0];
    const existingMapping=(await adminPool.query(`SELECT mapping_snapshot_id FROM mapping_snapshot WHERE tenant_id=$1 AND entity_id=$2 AND family='BANK' AND scope_type='ENTITY' AND scope_key=$2::text AND status IN ('APPROVED','RETIRED') ORDER BY version DESC LIMIT 1`,[ids.tenantId,ids.entityId])).rows[0];
    if(existingSetting)settingId=existingSetting.setting_snapshot_id;
    if(existingMapping)mappingId=existingMapping.mapping_snapshot_id;
  }
  if(!reuseApprovedSnapshots || !(await adminPool.query('SELECT 1 FROM setting_snapshot WHERE setting_snapshot_id=$1',[settingId])).rowCount){
    await adminPool.query(`INSERT INTO setting_snapshot(setting_snapshot_id,tenant_id,entity_id,family,scope_type,scope_key,version,effective_from,effective_to,status,snapshot,snapshot_hash,created_by,approved_by,approved_at)
      VALUES($1,$2,$3::uuid,'BANK','ENTITY',$3::text,1,$4,$5,'APPROVED','{}',$6,'setting-maker','setting-approver',now())`,[settingId,ids.tenantId,ids.entityId,effectiveFrom,effectiveTo,configHashes.setting_hash]);
  }
  if(!reuseApprovedSnapshots || !(await adminPool.query('SELECT 1 FROM mapping_snapshot WHERE mapping_snapshot_id=$1',[mappingId])).rowCount){
    await adminPool.query(`INSERT INTO mapping_snapshot(mapping_snapshot_id,tenant_id,entity_id,family,scope_type,scope_key,input_key_hash,version,priority,effective_from,effective_to,status,input_keys,output_rules,snapshot_hash,created_by,approved_by,approved_at)
      VALUES($1,$2,$3::uuid,'BANK','ENTITY',$3::text,$4,1,$5,$6,$7,'APPROVED','{}','{}',$8,'mapping-maker','mapping-approver',now())`,[mappingId,ids.tenantId,ids.entityId,inputKeyHash,mappingPriority,effectiveFrom,effectiveTo,configHashes.mapping_hash]);
  }
  const inputDigest=hash('rule');
  const evaluationDigest=(await adminPool.query("SELECT refs_rule_evaluation_hash($1,$2,$3,'R-BANK-01',1,'{}'::jsonb,'{}'::jsonb,$4) AS digest",[documentId,settingId,mappingId,inputDigest])).rows[0].digest;
  await adminPool.query(`INSERT INTO rule_evaluation(rule_evaluation_id,tenant_id,source_document_id,setting_snapshot_id,mapping_snapshot_id,rule_code,rule_version,matched_facts,result,reason,input_digest,evaluation_digest,evaluated_at)
    VALUES($1,$2,$3,$4,$5,'R-BANK-01',1,'{}','{}','fixture',$6,$7,COALESCE($8::timestamptz,now()))`,[ruleId,ids.tenantId,documentId,settingId,mappingId,inputDigest,evaluationDigest,evaluatedAt]);
  await adminPool.query(`INSERT INTO staging_item(staging_item_id,tenant_id,entity_id,source_document_id,setting_snapshot_id,mapping_snapshot_id,rule_evaluation_id,status,reviewed_by,reviewed_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,'reviewer',now())`,[stagingId,ids.tenantId,ids.entityId,documentId,settingId,mappingId,ruleId,linkJournal?'APPROVED':'READY_FOR_DRAFT']);
  if(linkJournal)await adminPool.query("INSERT INTO source_link(tenant_id,entity_id,link_type,source_document_id,staging_item_id,journal_entry_id,created_by) VALUES($1,$2,'SOURCE_TO_JE',$3,$4,$5,'engine')",[ids.tenantId,ids.entityId,documentId,stagingId,ids.journalId]);
  return {batchId,rawId,documentId,settingId,mappingId,ruleId,stagingId,inputKeyHash,configHashes};
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

pgTest('authorized WBS snapshot import persists immutable observations without creating source documents or journals',async()=>{
  const ids=await seed({status:'DRAFT'}),snapshotId=randomUUID(),rowId=randomUUID(),capturedAt=new Date().toISOString();
  const snapshot={schema_version:'WBS_READONLY_SNAPSHOT_V1',snapshot_id:snapshotId,captured_at:capturedAt,environment:'SANDBOX',source_system:'WBS',dictionary_version:'WBS-DICT-TEST',views:[{name:'BGDATA.payable',company_key:ids.sourceEntityId,rows:[{apGuId:rowId,ap_type:'AUTOC'}]}]};
  snapshot.views=snapshot.views.map(view=>({...view,content_hash:canonicalRequestHash(view.rows)}));
  snapshot.package_hash=canonicalRequestHash(snapshot);
  const denied=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'snapshot-reader',['AP.VIEW'])});
  await assert.rejects(denied.recordWbsSnapshot({tenantId:ids.tenantId,entityId:ids.entityId,snapshot,idempotencyKey:'snapshot-denied-0001'}),error=>error.code==='42501');
  const kernel=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'snapshot-importer',['WBS.SNAPSHOT.IMPORT'])});
  const created=await kernel.recordWbsSnapshot({tenantId:ids.tenantId,entityId:ids.entityId,snapshot,idempotencyKey:'snapshot-import-ok-001'});
  assert.equal(created.receipt_count,1);assert.equal(created.idempotent,false);
  const replay=await kernel.recordWbsSnapshot({tenantId:ids.tenantId,entityId:ids.entityId,snapshot,idempotencyKey:'snapshot-import-ok-001'});
  assert.equal(replay.idempotent,true);assert.equal(replay.wbs_snapshot_import_id,created.wbs_snapshot_import_id);
  const productionViews=snapshot.views.map(view=>({...view,rows:[],content_hash:canonicalRequestHash([]),row_count:0,first_primary_key:null,last_primary_key:null}));const {privateKey,publicKey}=generateKeyPairSync('ed25519');const production={...snapshot,schema_version:'WBS_READONLY_SNAPSHOT_V2',snapshot_id:randomUUID(),environment:'PRODUCTION',views:productionViews,delivery:{mode:'READONLY_VIEW_EXPORT',extract_started_at:capturedAt,extract_completed_at:capturedAt,consistency:'COMPLETE',read_consistency:'SNAPSHOT_ISOLATION',pagination:'PRIMARY_KEY_SEEK'},detached_signature:{key_id:'wbs-prod-test',algorithm:'Ed25519',value:''}};delete production.package_hash;const {detached_signature,...productionManifest}=production;production.package_hash=canonicalRequestHash(productionManifest);production.detached_signature.value=sign(null,Buffer.from(production.package_hash),privateKey).toString('base64');
  await assert.rejects(kernel.recordWbsSnapshot({tenantId:ids.tenantId,entityId:ids.entityId,snapshot:production,idempotencyKey:'snapshot-production-unsigned-001'}),error=>error.code==='WBS_SNAPSHOT_SIGNATURE_REQUIRED');
  const verified=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'snapshot-importer',['WBS.SNAPSHOT.IMPORT']),wbsSnapshotVerifier:createWbsSnapshotSignatureVerifier({publicKeys:{'wbs-prod-test':publicKey.export({type:'spki',format:'pem'})}})});
  const productionCreated=await verified.recordWbsSnapshot({tenantId:ids.tenantId,entityId:ids.entityId,snapshot:production,idempotencyKey:'snapshot-production-signed-001'});
  assert.equal(productionCreated.receipt_count,0);
  assert.equal((await adminPool.query('SELECT count(*)::int n FROM wbs_snapshot_receipt WHERE tenant_id=$1',[ids.tenantId])).rows[0].n,1);
  const delivery=(await adminPool.query('SELECT attestation,attestation_hash FROM wbs_snapshot_delivery_attestation WHERE tenant_id=$1 AND entity_id=$2 AND wbs_snapshot_import_id=$3',[ids.tenantId,ids.entityId,productionCreated.wbs_snapshot_import_id])).rows[0];
  assert.equal(delivery.attestation.views.find(view=>view.name==='BGDATA.payable').row_count,0);assert.equal(delivery.attestation.views.find(view=>view.name==='BGDATA.payable').first_primary_key,null);assert.match(delivery.attestation_hash,/^sha256:[0-9a-f]{64}$/);
  assert.equal((await adminPool.query('SELECT count(*)::int n FROM source_document WHERE tenant_id=$1',[ids.tenantId])).rows[0].n,0);
  assert.equal((await adminPool.query("SELECT count(*)::int n FROM audit_event WHERE tenant_id=$1 AND event_type='WBS_SNAPSHOT_OBSERVED'",[ids.tenantId])).rows[0].n,2);
  assert.equal((await adminPool.query("SELECT count(*)::int n FROM audit_event WHERE tenant_id=$1 AND event_type='WBS_SNAPSHOT_DELIVERY_ATTESTED'",[ids.tenantId])).rows[0].n,1);
  await assert.rejects(adminPool.query("UPDATE wbs_snapshot_receipt SET source_record_id='tampered' WHERE tenant_id=$1",[ids.tenantId]),error=>error.code==='55000');
});

pgTest('authenticated HTTP records only sandbox WBS snapshot observations in its authorized entity',async()=>{
  const ids=await seed({status:'DRAFT'}),snapshotId=randomUUID(),rowId=randomUUID();
  const snapshot={schema_version:'WBS_READONLY_SNAPSHOT_V1',snapshot_id:snapshotId,captured_at:new Date().toISOString(),environment:'SANDBOX',source_system:'WBS',dictionary_version:'WBS-DICT-HTTP',views:[{name:'BGDATA.payable',company_key:ids.sourceEntityId,rows:[{apGuId:rowId,ap_type:'AUTOC'}]}]};snapshot.views=snapshot.views.map(view=>({...view,content_hash:canonicalRequestHash(view.rows)}));snapshot.package_hash=canonicalRequestHash(snapshot);
  const permissions={'snapshot-http-importer':['WBS.SNAPSHOT.IMPORT'],'snapshot-http-reader':['AP.VIEW']};
  const api=createAccountingApi({authenticate:async({headers})=>({trusted:true,tenantId:ids.tenantId,actorId:headers['x-test-actor']}),kernelFactory:async principal=>new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,principal.actorId,permissions[principal.actorId]||[])})});
  const request={method:'POST',url:`/api/v1/entities/${ids.entityId}/wbs/snapshots`,headers:{'x-test-actor':'snapshot-http-importer','Idempotency-Key':'snapshot-http-route-001'},body:{snapshot}};
  const created=await api(request);assert.equal(created.status,201);assert.equal(created.body.data.receipt_count,1);
  const replay=await api(request);assert.equal(replay.status,200);assert.equal(replay.body.data.idempotent,true);
  const denied=await api({...request,headers:{...request.headers,'x-test-actor':'snapshot-http-reader','Idempotency-Key':'snapshot-http-route-002'}});assert.equal(denied.status,403);
  const spoofed=await api({...request,body:{snapshot,entityId:randomUUID()}});assert.equal(spoofed.status,400);
  assert.equal((await adminPool.query('SELECT count(*)::int n FROM source_document WHERE tenant_id=$1',[ids.tenantId])).rows[0].n,0);
});

pgTest('concurrent up and down runners serialize on the same advisory lock',async()=>{
  await Promise.all([migrateDown(adminPool,{all:true}),migrateUp(adminPool)]);
  await migrateUp(adminPool);
  const applied=await adminPool.query('SELECT migration_name FROM refs_schema_migration ORDER BY migration_name');
  assert.deepEqual(applied.rows.map(row=>row.migration_name),MIGRATION_MANIFEST.map(migration=>migration.name));
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
    await rejectsInTransaction(client,()=>client.query('SELECT refs_reserve_idempotency($1,$2,$3,$4,$5)',[two.tenantId,`POST_JOURNAL:${two.entityId}`,'forged-key-0001',hash('forged'),'victim']),error=>error.code==='42501');
    await rejectsInTransaction(client,()=>client.query("UPDATE entity SET name='forbidden' WHERE entity_id=$1",[one.entityId]),error=>error.code==='42501');
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

pgTest('SECURITY DEFINER namespace is protected from runtime object shadowing',async()=>{
  const ids=await seed();const session=await trustedSession(ids);
  const client=await runtimePool.connect();
  try{
    await client.query('BEGIN');await client.query('SET LOCAL ROLE refs_app');await client.query('SELECT refs_bootstrap_context($1)',[session.contextToken]);
    await assert.rejects(client.query("CREATE FUNCTION public.refs_current_actor() RETURNS text LANGUAGE sql AS 'SELECT ''attacker'''"),error=>error.code==='42501');
    await client.query('ROLLBACK');
  }finally{client.release();}
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

pgTest('ingestion RLS preserves exact same-tenant entity scope independent of connector code',async()=>{
  const one=await seed();
  const two=await seed({tenantId:one.tenantId});
  for(const ids of [one,two]){
    const batch=randomUUID();
    await adminPool.query("INSERT INTO sync_cursor(tenant_id,entity_id,connector_code,source_module,source_entity_id) VALUES($1,$2,'WBS_API','bankFeed',$3)",[ids.tenantId,ids.entityId,ids.sourceEntityId]);
    await adminPool.query("INSERT INTO import_batch(import_batch_id,tenant_id,entity_id,connector_code,source_module,source_entity_id,idempotency_key,request_hash) VALUES($1,$2,$3,'WBS_API','bankFeed',$4,$5,$6)",[batch,ids.tenantId,ids.entityId,ids.sourceEntityId,`import-${ids.entityId}`,hash(ids.entityId)]);
    await adminPool.query("INSERT INTO raw_event(tenant_id,entity_id,import_batch_id,source_system,source_module,source_entity_id,source_record_id,source_version,event_type,occurred_at,payload_hash,payload_ref,correlation_id) VALUES($1,$2,$3,'WBS','bankFeed',$4,$5,'1','UPSERT',now(),$6,$7,$5)",[ids.tenantId,ids.entityId,batch,ids.sourceEntityId,`ROW-${ids.entityId}`,hash(`raw-${ids.entityId}`),`object://raw/${ids.entityId}`]);
  }
  const kernel=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(one)});
  await kernel.inSession(async client=>{
    for(const table of ['sync_cursor','import_batch','raw_event']){
      const rows=(await client.query(`SELECT entity_id FROM ${table}`)).rows;
      assert.deepEqual(rows.map(row=>row.entity_id),[one.entityId]);
    }
  });
});

pgTest('account member type is enforced for BANK, VENDOR, CUSTOMER and AFFILIATE',async()=>{
  const ids=await seed({status:'DRAFT'});
  await assert.rejects(adminPool.query("UPDATE journal_line SET member_ref='VENDOR-1' WHERE journal_entry_id=$1 AND account_code='111000'",[ids.journalId]),error=>error.code==='23514');
  await assert.rejects(adminPool.query("UPDATE journal_line SET member_ref='BANK-1' WHERE journal_entry_id=$1 AND account_code='291001'",[ids.journalId]),error=>error.code==='23514');
  await adminPool.query("INSERT INTO member_master(tenant_id,entity_id,member_ref,member_type,display_name) VALUES($1,$2,'CUSTOMER-1','CUSTOMER','Customer'),($1,$2,'AFFILIATE-1','AFFILIATE','Affiliate')",[ids.tenantId,ids.entityId]);
  await adminPool.query("INSERT INTO journal_line(tenant_id,entity_id,period_id,journal_entry_id,line_no,account_code,debit_amount,credit_amount,member_ref) VALUES($1,$2,$3,$4,3,'120200',1,0,'CUSTOMER-1'),($1,$2,$3,$4,4,'120200',0,1,'AFFILIATE-1')",[ids.tenantId,ids.entityId,ids.periodId,ids.journalId]);
  await assert.rejects(adminPool.query("INSERT INTO journal_line(tenant_id,entity_id,period_id,journal_entry_id,line_no,account_code,debit_amount,credit_amount,member_ref) VALUES($1,$2,$3,$4,5,'120200',1,0,'BANK-1')",[ids.tenantId,ids.entityId,ids.periodId,ids.journalId]),error=>error.code==='23514');
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

pgTest('formal IAM grant sync reconciles and revokes desired state with version, idempotency and audit',async()=>{
  const ids=await seed();const actor='iam-subject';
  const sync=new PostgresGrantSync(grantSyncPool,{principalProvider:async()=>({trusted:true,serviceId:'platform-iam-sync'})});
  const first=await sync.reconcile({tenantId:ids.tenantId,actorId:actor,entityId:ids.entityId,permissions:['GL.JE.POST','AP.VIEW'],expectedVersion:0,idempotencyKey:'grant-sync-0001'});
  const replay=await sync.reconcile({tenantId:ids.tenantId,actorId:actor,entityId:ids.entityId,permissions:['AP.VIEW','GL.JE.POST'],expectedVersion:0,idempotencyKey:'grant-sync-0001'});
  assert.equal(first.version,1);assert.equal(replay.idempotent,true);
  const revoked=await sync.reconcile({tenantId:ids.tenantId,actorId:actor,entityId:ids.entityId,permissions:[],expectedVersion:1,idempotencyKey:'grant-sync-0002'});
  assert.equal(revoked.version,2);
  assert.equal((await adminPool.query('SELECT count(*)::int AS n FROM runtime_actor_grant WHERE tenant_id=$1 AND actor_id=$2 AND revoked_at IS NULL',[ids.tenantId,actor])).rows[0].n,0);
  assert.equal((await adminPool.query("SELECT count(*)::int AS n FROM audit_event WHERE event_type='ACTOR_GRANTS_RECONCILED' AND entity_id=$1",[ids.entityId])).rows[0].n,2);
  assert.equal((await adminPool.query("SELECT count(*)::int AS n FROM outbox_event WHERE event_type='ACTOR_GRANTS_RECONCILED' AND entity_id=$1",[ids.entityId])).rows[0].n,2);
  await assert.rejects(sync.reconcile({tenantId:ids.tenantId,actorId:actor,entityId:ids.entityId,permissions:['ROOT.ALL'],expectedVersion:2,idempotencyKey:'grant-sync-0003'}),error=>error.code==='22023');
  const other=await seed();
  await assert.rejects(sync.reconcile({tenantId:ids.tenantId,actorId:actor,entityId:other.entityId,permissions:['AP.VIEW'],expectedVersion:0,idempotencyKey:'grant-sync-0004'}),error=>error.code==='42501');
  const spoofed=new PostgresGrantSync(grantSyncPool,{principalProvider:async()=>({trusted:true,serviceId:'runtime-request'})});
  await assert.rejects(spoofed.reconcile({tenantId:ids.tenantId,actorId:actor,entityId:ids.entityId,permissions:['AP.VIEW'],expectedVersion:2,idempotencyKey:'grant-sync-0005'}),error=>error.code==='GRANT_SYNC_PRINCIPAL_DENIED');
  const runtime=await runtimePool.connect();
  try{await assert.rejects(runtime.query("INSERT INTO runtime_actor_grant(tenant_id,actor_id,entity_id,permission) VALUES($1,'spoof',$2,'AP.VIEW')",[ids.tenantId,ids.entityId]),error=>error.code==='42501');}finally{runtime.release();}
  await sync.reconcile({tenantId:ids.tenantId,actorId:actor,entityId:ids.entityId,permissions:['AP.VIEW'],expectedVersion:2,idempotencyKey:'grant-sync-0006'});
  await adminPool.query("UPDATE permission_catalog SET active=false,version=version+1 WHERE permission_code='AP.VIEW'");
  await assert.rejects(trustedSession(ids,actor,['AP.VIEW']),error=>error.code==='42501');
  await adminPool.query("UPDATE permission_catalog SET active=true,version=version+1 WHERE permission_code='AP.VIEW'");
});

pgTest('two connections enforce duplicate canonical raw source and atomic idempotency compare/replay',async()=>{
  const ids=await seed();
  const batch=randomUUID();
  await adminPool.query("INSERT INTO import_batch(import_batch_id,tenant_id,entity_id,connector_code,source_module,source_entity_id,idempotency_key,request_hash) VALUES($1,$2,$3,'WBS_API','bankFeed',$4,'import-key-0001',$5)",[batch,ids.tenantId,ids.entityId,ids.sourceEntityId,hash('a')]);
  const params=[randomUUID(),ids.tenantId,ids.entityId,batch,'WBS','bankFeed',ids.sourceEntityId,'BANK-1','1','UPSERT','2026-07-15',hash('b'),'object://raw/1','corr-1'];
  const insert=`INSERT INTO raw_event(raw_event_id,tenant_id,entity_id,import_batch_id,source_system,source_module,source_entity_id,source_record_id,source_version,event_type,occurred_at,payload_hash,payload_ref,correlation_id) VALUES(${params.map((_,i)=>`$${i+1}`).join(',')})`;
  await adminPool.query(insert,params);
  await assert.rejects(adminPool.query(insert,[randomUUID(),...params.slice(1)]),error=>error.code==='23505');

  const args={...ids,journalEntryId:ids.journalId,expectedRevision:0,idempotencyKey:'same-key-0001',requestHash:hash('c')};
  const firstKernel=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids)});
  const secondKernel=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids)});
  const [first,second]=await Promise.all([firstKernel.postJournal(args),secondKernel.postJournal(args)]);
  assert.equal([first.idempotent,second.idempotent].filter(Boolean).length,1);
  await assert.rejects(firstKernel.postJournal({...args,expectedRevision:1,requestHash:hash('caller-is-ignored')}),error=>error.code==='23505');
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
  const tracked=['posting_batch','ledger_line','source_link','audit_event','outbox_event','idempotency_receipt'];
  const before={};
  try{
    const session=await trustedSession(ids);
    for(const table of tracked)before[table]=(await adminPool.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n;
    await client.query('BEGIN');await client.query('SET LOCAL ROLE refs_app');await client.query('SELECT refs_bootstrap_context($1)',[session.contextToken]);
    await client.query('SELECT refs_post_journal($1,$2,$3,$4,0,$5,$6,refs_current_actor())',[ids.tenantId,ids.entityId,ids.periodId,ids.journalId,'rollback-post',hash('rollback')]);
    await assert.rejects(client.query('SELECT 1/0'),error=>error.code==='22012');
    await client.query('ROLLBACK');
  }finally{client.release();}
  for(const table of tracked)assert.equal((await adminPool.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n,before[table],table);
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
  assert.equal((await adminPool.query('SELECT count(*)::int AS n FROM posting_batch')).rows[0].n,0);
  assert.equal((await adminPool.query('SELECT count(*)::int AS n FROM ledger_line')).rows[0].n,0);
  assert.equal((await adminPool.query("SELECT count(*)::int AS n FROM audit_event WHERE event_type='JOURNAL_POSTED'")).rows[0].n,0);
  assert.equal((await adminPool.query("SELECT count(*)::int AS n FROM outbox_event WHERE event_type='JOURNAL_POSTED'")).rows[0].n,0);
  assert.equal((await adminPool.query('SELECT count(*)::int AS n FROM idempotency_receipt')).rows[0].n,0);
});

pgTest('pending and rejected attachments cannot enter the JE trace graph',async()=>{
  for(const status of ['PENDING','REJECTED']){
    const ids=await seed({attachmentStatus:null}),attachmentId=randomUUID();
    await adminPool.query(`INSERT INTO attachment(attachment_id,tenant_id,entity_id,name,media_type,size_bytes,content_hash,storage_ref,storage_version,uploaded_by,uploaded_at,scan_status,finalization_status)
      VALUES($1,$2,$3,'unsafe.pdf','application/pdf',10,$4,$5,'v1','maker',now(),$6,$7)`,[attachmentId,ids.tenantId,ids.entityId,hash(status),`object://attachments/${attachmentId}`,status,status]);
    await assert.rejects(adminPool.query("INSERT INTO source_link(tenant_id,entity_id,link_type,journal_entry_id,attachment_id,created_by) VALUES($1,$2,'JE_ATTACHMENT',$3,$4,'maker')",[ids.tenantId,ids.entityId,ids.journalId,attachmentId]),error=>error.code==='23514');
  }
});

pgTest('attachment reserve and scanner finalization are entity-scoped, idempotent and immutable',async()=>{
  const ids=await seed({status:'DRAFT',attachmentStatus:null});const contentHash=hash('uploaded-object');
  const uploader=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'attachment-uploader',['ATTACHMENT.CREATE'])});
  const reserveArgs={tenantId:ids.tenantId,entityId:ids.entityId,name:'invoice.pdf',mediaType:'application/pdf',sizeBytes:321,contentHash,
    storageRef:`object://attachments/${randomUUID()}`,storageVersion:'pending:reservation-1',idempotencyKey:'attachment-reserve-0001'};
  const reserved=await uploader.reserveAttachment(reserveArgs);const replay=await uploader.reserveAttachment(reserveArgs);
  assert.equal(reserved.status,'PENDING');assert.equal(replay.idempotent,true);assert.equal(replay.attachment_id,reserved.attachment_id);
  const unrelated=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'unrelated-reader',['AP.VIEW'])});
  await assert.rejects(unrelated.requestAttachmentFinalize({tenantId:ids.tenantId,entityId:ids.entityId,attachmentId:reserved.attachment_id,idempotencyKey:'unrelated-finalize-request'}),error=>error.code==='42501');
  await assert.rejects(unrelated.inSession(client=>client.query('SELECT storage_ref FROM attachment WHERE attachment_id=$1',[reserved.attachment_id])),error=>error.code==='42501');
  const requested=await uploader.requestAttachmentFinalize({tenantId:ids.tenantId,entityId:ids.entityId,attachmentId:reserved.attachment_id,idempotencyKey:'attachment-finalize-request-0001'});
  assert.equal(requested.storage_ref,reserveArgs.storageRef);assert.equal(requested.initiated_by,'attachment-uploader');
  const secondUploader=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'attachment-uploader-2',['ATTACHMENT.CREATE'])});
  assert.equal((await secondUploader.requestAttachmentFinalize({tenantId:ids.tenantId,entityId:ids.entityId,attachmentId:reserved.attachment_id,idempotencyKey:'attachment-finalize-request-0002'})).initiated_by,'attachment-uploader-2');
  const scanner=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'attachment-scanner',['ATTACHMENT.FINALIZE'])});
  const finalizeArgs={tenantId:ids.tenantId,entityId:ids.entityId,attachmentId:reserved.attachment_id,storageRef:reserveArgs.storageRef,observedSizeBytes:321,observedContentHash:contentHash,
    observedMediaType:'application/pdf',storageVersion:'version-1',scanClean:true,scanRef:'clamav:scan-001',idempotencyKey:'attachment-finalize-0001'};
  const selfScanner=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'attachment-uploader',['ATTACHMENT.FINALIZE'])});
  await assert.rejects(selfScanner.finalizeAttachment({...finalizeArgs,idempotencyKey:'attachment-self-finalize'}),error=>error.code==='42501');
  await assert.rejects(scanner.finalizeAttachment({...finalizeArgs,storageRef:`object://attachments/${randomUUID()}`,idempotencyKey:'attachment-wrong-object'}),error=>error.code==='23514');
  const finalized=await scanner.finalizeAttachment(finalizeArgs);assert.equal(finalized.status,'VERIFIED_CLEAN');
  await assert.rejects(adminPool.query("UPDATE attachment SET name='tampered.pdf' WHERE attachment_id=$1",[reserved.attachment_id]),error=>error.code==='55000');
  const maker=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'attachment-je-maker',['GL.JE.CREATE'])});
  const created=await maker.createManualJournal({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId,journalNumber:'JE-ATT-001',journalDate:'2026-07-20',currency:'USD',description:'Uses scanned evidence',attachmentIds:[reserved.attachment_id],idempotencyKey:'attachment-je-create-0001',lines:[
    {line_no:1,account_code:'111000',debit_amount:10,credit_amount:0,member_ref:'BANK-1',dimensions:{}},{line_no:2,account_code:'291001',debit_amount:0,credit_amount:10,member_ref:'VENDOR-1',dimensions:{}}
  ]});assert.equal(created.status,'DRAFT');
  const rejectedStorageRef=`object://attachments/${randomUUID()}`;
  const rejectedReserve=await uploader.reserveAttachment({...reserveArgs,storageRef:rejectedStorageRef,idempotencyKey:'attachment-reserve-0002'});
  await uploader.requestAttachmentFinalize({tenantId:ids.tenantId,entityId:ids.entityId,attachmentId:rejectedReserve.attachment_id,idempotencyKey:'attachment-finalize-request-0003'});
  const rejected=await scanner.finalizeAttachment({...finalizeArgs,attachmentId:rejectedReserve.attachment_id,storageRef:rejectedStorageRef,observedSizeBytes:999,idempotencyKey:'attachment-finalize-0002'});
  assert.equal(rejected.status,'REJECTED');
  assert.equal((await adminPool.query("SELECT count(*)::int n FROM outbox_event WHERE aggregate_id IN ($1,$2) AND event_type IN ('ATTACHMENT_RESERVED','ATTACHMENT_FINALIZE_REQUESTED','ATTACHMENT_FINALIZED')",[reserved.attachment_id,rejectedReserve.attachment_id])).rows[0].n,7);
  assert.deepEqual((await adminPool.query("SELECT actor_id,event_type FROM audit_event WHERE object_id=$1 AND event_type IN ('ATTACHMENT_FINALIZE_REQUESTED','ATTACHMENT_FINALIZED') ORDER BY occurred_at,actor_id",[reserved.attachment_id])).rows.map(row=>[row.actor_id,row.event_type]),[
    ['attachment-uploader','ATTACHMENT_FINALIZE_REQUESTED'],['attachment-uploader-2','ATTACHMENT_FINALIZE_REQUESTED'],['attachment-scanner','ATTACHMENT_FINALIZED']]);
});

pgTest('authenticated attachment HTTP traverses storage inspection and PostgreSQL without caller-controlled object evidence',async()=>{
  const ids=await seed({status:'DRAFT',attachmentStatus:null}),contentHash=hash('http-uploaded-object');let storageRef;
  const permissions={'http-uploader':['ATTACHMENT.CREATE'],'http-scanner':['ATTACHMENT.FINALIZE']};
  const kernelFor=principal=>new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,principal.actorId,permissions[principal.actorId]||[])});
  const storage={reserveUpload:async()=>{storageRef=`object://attachments/${randomUUID()}`;return {storageRef,storageVersion:'pending:http-reservation',uploadUrl:'https://upload.example/signed',requiredHeaders:{'x-amz-meta-sha256':contentHash},expiresAt:new Date(Date.now()+60000).toISOString()};},deleteReservation:async()=>{},inspect:async ref=>{assert.equal(ref,storageRef);return {sizeBytes:88,mediaType:'application/pdf',contentHash,storageVersion:'http-version-1'};}};
  const scanner={scan:async evidence=>{assert.deepEqual(evidence,{tenantId:ids.tenantId,entityId:ids.entityId,attachmentId:evidence.attachmentId,storageRef,storageVersion:'http-version-1',sizeBytes:88,contentHash,mediaType:'application/pdf'});assert.match(evidence.attachmentId,/^[0-9a-f-]{36}$/);return {clean:true,scanRef:'clamav:http-001'};}};
  const service=new AttachmentEvidenceService({storage,scanner,uploaderKernelFactory:kernelFor,scannerKernelFactory:()=>kernelFor({actorId:'http-scanner'})});
  const api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId:ids.tenantId,actorId:'http-uploader'}),kernelFactory:async()=>kernelFor({actorId:'http-uploader'}),attachmentServiceFactory:async()=>service});
  const base=`/api/v1/entities/${ids.entityId}/attachments`;
  const reserved=await api({method:'POST',url:`${base}/reservations`,headers:{'idempotency-key':'http-attachment-reserve'},body:{name:'http-evidence.pdf',mediaType:'application/pdf',sizeBytes:88,contentHash}});
  assert.equal(reserved.status,201);const attachmentId=reserved.body.data.attachment_id;
  const finalized=await api({method:'POST',url:`${base}/${attachmentId}/finalize`,headers:{'idempotency-key':'http-attachment-final'},body:{}});
  assert.equal(finalized.status,201);assert.equal(finalized.body.data.status,'VERIFIED_CLEAN');
  const replay=await api({method:'POST',url:`${base}/${attachmentId}/finalize`,headers:{'idempotency-key':'http-attachment-final'},body:{}});assert.equal(replay.status,200);
  const row=(await adminPool.query('SELECT storage_ref,storage_version,finalization_status FROM attachment WHERE attachment_id=$1',[attachmentId])).rows[0];
  assert.deepEqual(row,{storage_ref:storageRef,storage_version:'http-version-1',finalization_status:'VERIFIED_CLEAN'});
  assert.equal((await adminPool.query("SELECT count(*)::int n FROM audit_event WHERE object_id=$1 AND event_type='ATTACHMENT_FINALIZE_REQUESTED' AND actor_id='http-uploader'",[attachmentId])).rows[0].n,1);
  assert.equal((await adminPool.query("SELECT count(*)::int n FROM audit_event WHERE object_id=$1 AND event_type='ATTACHMENT_FINALIZED' AND actor_id='http-scanner'",[attachmentId])).rows[0].n,1);
  const unknown=await api({method:'POST',url:`${base}/${randomUUID()}/finalize`,headers:{'idempotency-key':'http-attachment-missing'},body:{}});assert.equal(unknown.status,404);
  const sameTenantOther=await seed({status:'DRAFT',attachmentStatus:null,tenantId:ids.tenantId});
  assert.equal((await api({method:'POST',url:`/api/v1/entities/${sameTenantOther.entityId}/attachments/${randomUUID()}/finalize`,headers:{'idempotency-key':'http-attachment-cross-entity'},body:{}})).status,404);
  const otherTenant=await seed({status:'DRAFT',attachmentStatus:null});
  assert.equal((await api({method:'POST',url:`/api/v1/entities/${otherTenant.entityId}/attachments/${randomUUID()}/finalize`,headers:{'idempotency-key':'http-attachment-cross-tenant'},body:{}})).status,404);
});

pgTest('expired attachment cleanup is claimed exclusively, retries failures and leaves an immutable audit trail',async()=>{
  const ids=await seed({status:'DRAFT',attachmentStatus:null}),attachmentId=randomUUID(),storageRef=`object://attachments/${randomUUID()}`;
  await adminPool.query(`INSERT INTO attachment(attachment_id,tenant_id,entity_id,name,media_type,size_bytes,content_hash,storage_ref,storage_version,uploaded_by,uploaded_at,reserved_at,upload_expires_at)
    VALUES($1,$2,$3,'expired.pdf','application/pdf',10,$4,$5,'pending:expired','uploader',now()-interval '30 minutes',now()-interval '30 minutes',now()-interval '15 minutes')`,[attachmentId,ids.tenantId,ids.entityId,hash('expired'),storageRef]);
  const kernel=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'attachment-cleaner',['ATTACHMENT.CLEANUP'])});
  const competing=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'attachment-cleaner-2',['ATTACHMENT.CLEANUP'])});
  const firstClaim=await kernel.claimExpiredAttachments({tenantId:ids.tenantId,entityId:ids.entityId,limit:5});assert.equal(firstClaim.length,1);assert.equal((await competing.claimExpiredAttachments({tenantId:ids.tenantId,entityId:ids.entityId,limit:5})).length,0);
  const admin=await adminPool.connect();try{await admin.query('BEGIN');await admin.query("SELECT set_config('refs.attachment_finalize','authorized',true)");await admin.query("UPDATE attachment SET cleanup_claimed_at=now()-interval '10 minutes' WHERE attachment_id=$1",[attachmentId]);await admin.query('COMMIT');}finally{admin.release();}
  const recovered=(await competing.claimExpiredAttachments({tenantId:ids.tenantId,entityId:ids.entityId,limit:5}))[0];assert.equal(recovered.cleanup_attempt,2);assert.notEqual(recovered.claim_token,firstClaim[0].claim_token);
  await assert.rejects(kernel.completeAttachmentCleanup({tenantId:ids.tenantId,entityId:ids.entityId,attachmentId,claimToken:firstClaim[0].claim_token,deleted:true}),error=>error.code==='40001');
  assert.equal((await competing.completeAttachmentCleanup({tenantId:ids.tenantId,entityId:ids.entityId,attachmentId,claimToken:recovered.claim_token,deleted:false,errorCode:'ATTACHMENT_STORAGE_UNAVAILABLE',errorCategory:'STORAGE'})).status,'CLEANUP_FAILED');
  let row=(await adminPool.query('SELECT finalization_status,cleanup_status,cleanup_attempts,cleanup_error_code,cleanup_error_category FROM attachment WHERE attachment_id=$1',[attachmentId])).rows[0];assert.deepEqual(row,{finalization_status:'PENDING',cleanup_status:'FAILED',cleanup_attempts:2,cleanup_error_code:'ATTACHMENT_STORAGE_UNAVAILABLE',cleanup_error_category:'STORAGE'});assert.equal((await adminPool.query("SELECT count(*)::int n FROM audit_event WHERE object_id=$1 AND metadata ? 'error'",[attachmentId])).rows[0].n,0);
  const service=new AttachmentCleanupService({storage:{purgeAllVersions:async ref=>{assert.equal(ref,storageRef);return {verifiedEmpty:true};}},kernelFactory:async()=>kernel});assert.equal((await service.runOnce({}, {tenantId:ids.tenantId,entityId:ids.entityId,limit:5}))[0].status,'CLEANED');
  row=(await adminPool.query('SELECT finalization_status,scan_status,cleanup_status,cleanup_attempts,cleaned_at IS NOT NULL cleaned FROM attachment WHERE attachment_id=$1',[attachmentId])).rows[0];assert.deepEqual(row,{finalization_status:'REJECTED',scan_status:'ERROR',cleanup_status:'COMPLETE',cleanup_attempts:3,cleaned:true});
  assert.equal((await adminPool.query("SELECT count(*)::int n FROM audit_event WHERE object_id=$1 AND event_type IN ('ATTACHMENT_CLEANUP_CLAIMED','ATTACHMENT_CLEANUP_FAILED','ATTACHMENT_CLEANED')",[attachmentId])).rows[0].n,5);
  assert.equal((await adminPool.query("SELECT count(*)::int n FROM audit_event WHERE object_id=$1 AND metadata::text LIKE '%object://%'",[attachmentId])).rows[0].n,0);
  assert.equal((await adminPool.query("SELECT count(*)::int n FROM outbox_event WHERE aggregate_id=$1 AND payload::text LIKE '%object://%'",[attachmentId])).rows[0].n,0);
  assert.equal((await kernel.claimExpiredAttachments({tenantId:ids.tenantId,entityId:ids.entityId,limit:5})).length,0);
});

pgTest('a killed cleanup process loses its expired lease and a distinct process safely recovers it',async()=>{const ids=await seed({status:'DRAFT',attachmentStatus:null}),attachmentId=randomUUID(),storageRef=`object://attachments/${randomUUID()}`;await adminPool.query(`INSERT INTO attachment(attachment_id,tenant_id,entity_id,name,media_type,size_bytes,content_hash,storage_ref,storage_version,uploaded_by,uploaded_at,reserved_at,upload_expires_at) VALUES($1,$2,$3,'crash.pdf','application/pdf',10,$4,$5,'pending:crash','uploader',now()-interval '30 minutes',now()-interval '30 minutes',now()-interval '15 minutes')`,[attachmentId,ids.tenantId,ids.entityId,hash('crash'),storageRef]);for(const actor of ['cleanup-process-a','cleanup-process-b'])await adminPool.query("INSERT INTO runtime_actor_grant(tenant_id,actor_id,entity_id,permission) VALUES($1,$2,$3,'ATTACHMENT.CLEANUP')",[ids.tenantId,actor,ids.entityId]);const helper=fileURLToPath(new URL('./helpers/cleanup-worker-process.mjs',import.meta.url)),childEnv=(actor,mode)=>({...process.env,CLEANUP_TENANT_ID:ids.tenantId,CLEANUP_ENTITY_ID:ids.entityId,CLEANUP_ACTOR_ID:actor,CLEANUP_MODE:mode});const first=spawn(process.execPath,[helper],{env:childEnv('cleanup-process-a','HOLD'),stdio:['ignore','pipe','pipe']}),claimed=await new Promise((resolveClaim,reject)=>{let output='';first.stdout.on('data',chunk=>{output+=chunk;const newline=output.indexOf('\n');if(newline>=0)resolveClaim(JSON.parse(output.slice(0,newline)));});first.once('error',reject);first.stderr.on('data',chunk=>reject(new Error(chunk.toString())));});assert.equal(claimed.items.length,1);first.kill('SIGTERM');await new Promise(resolveExit=>first.once('exit',resolveExit));const admin=await adminPool.connect();try{await admin.query('BEGIN');await admin.query("SELECT set_config('refs.attachment_finalize','authorized',true)");await admin.query("UPDATE attachment SET cleanup_claimed_at=now()-interval '10 minutes' WHERE attachment_id=$1",[attachmentId]);await admin.query('COMMIT');}finally{admin.release();}const recovered=await new Promise((resolveChild,reject)=>{const child=spawn(process.execPath,[helper],{env:childEnv('cleanup-process-b','RECOVER'),stdio:['ignore','pipe','pipe']});let output='',errors='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>errors+=chunk);child.once('error',reject);child.once('exit',code=>code===0?resolveChild(JSON.parse(output.trim())):reject(new Error(errors||`cleanup child ${code}`)));});assert.equal(recovered.completed,true);assert.notEqual(recovered.items[0].claim_token,claimed.items[0].claim_token);const row=(await adminPool.query('SELECT cleanup_status,finalization_status,cleanup_claimed_by FROM attachment WHERE attachment_id=$1',[attachmentId])).rows[0];assert.deepEqual(row,{cleanup_status:'COMPLETE',finalization_status:'REJECTED',cleanup_claimed_by:null});});

pgTest('cleanup worker scopes from configuration cannot exceed the DB grant for its service actor',async()=>{const allowed=await seed({status:'DRAFT',attachmentStatus:null}),outside=await seed({status:'DRAFT',attachmentStatus:null,tenantId:allowed.tenantId}),attachmentId=randomUUID();await adminPool.query(`INSERT INTO attachment(attachment_id,tenant_id,entity_id,name,media_type,size_bytes,content_hash,storage_ref,storage_version,uploaded_by,uploaded_at,reserved_at,upload_expires_at) VALUES($1,$2,$3,'outside.pdf','application/pdf',10,$4,$5,'pending:outside','uploader',now()-interval '30 minutes',now()-interval '15 minutes',now()-interval '5 minutes')`,[attachmentId,outside.tenantId,outside.entityId,hash('outside'),`object://attachments/${attachmentId}`]);const kernel=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(allowed,'scoped-cleaner',['ATTACHMENT.CLEANUP'])});await assert.rejects(kernel.claimExpiredAttachments({tenantId:outside.tenantId,entityId:outside.entityId,limit:1}),error=>error.code==='42501');assert.deepEqual((await adminPool.query('SELECT cleanup_status,cleanup_claim_token FROM attachment WHERE attachment_id=$1',[attachmentId])).rows[0],{cleanup_status:'NONE',cleanup_claim_token:null});assert.equal((await adminPool.query("SELECT count(*)::int n FROM audit_event WHERE object_id=$1 AND event_type='ATTACHMENT_CLEANUP_CLAIMED'",[attachmentId])).rows[0].n,0);});

pgTest('automatic journal posts without manual attachment only when immutable source evidence exists',async()=>{
  const ids=await seed({journalType:'AUTO',attachmentStatus:null});
  await attachAutoSource(ids,{effectiveFrom:'2026-07-15T00:00:00Z',effectiveTo:'2026-07-16T00:00:00Z',evaluatedAt:'2026-07-15T12:00:00Z'});
  const kernel=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids)});
  const result=await kernel.postJournal({...ids,journalEntryId:ids.journalId,expectedRevision:0,idempotencyKey:'auto-source-post',requestHash:hash('auto-source')});
  assert.equal(result.idempotent,false);
  assert.equal((await adminPool.query('SELECT count(*)::int AS n FROM ledger_line WHERE journal_entry_id=$1',[ids.journalId])).rows[0].n,2);
});

pgTest('AUTO evaluation requires effective approved canonical snapshots and rejects future, expired, and hash mismatch',async()=>{
  const future=new Date(Date.now()+86400000).toISOString();
  const expired=new Date(Date.now()-86400000).toISOString();
  const old=new Date(Date.now()-172800000).toISOString();
  for(const window of [{effectiveFrom:future},{effectiveFrom:old,effectiveTo:expired}]){
    const ids=await seed({journalType:'AUTO',attachmentStatus:null});
    await assert.rejects(attachAutoSource(ids,window),error=>error.code==='23514');
  }
  const ids=await seed({journalType:'AUTO',attachmentStatus:null});
  await assert.rejects(adminPool.query(`INSERT INTO setting_snapshot(tenant_id,entity_id,family,scope_type,scope_key,version,effective_from,status,snapshot,snapshot_hash,created_by,approved_by,approved_at)
    VALUES($1,$2::uuid,'BANK','ENTITY',$2::text,99,'2026-01-01','APPROVED','{}',$3,'maker','approver',now())`,[ids.tenantId,ids.entityId,hash('wrong-setting')]),error=>error.code==='23514');
  await assert.rejects(adminPool.query(`INSERT INTO mapping_snapshot(tenant_id,entity_id,family,scope_type,scope_key,input_key_hash,version,effective_from,status,input_keys,output_rules,snapshot_hash,created_by,approved_by,approved_at)
    VALUES($1,$2::uuid,'BANK','ENTITY',$2::text,$3,99,'2026-01-01','APPROVED','{}','{}',$4,'maker','approver',now())`,[ids.tenantId,ids.entityId,hash('key'),hash('wrong-mapping')]),error=>error.code==='23514');
  assert.equal((await adminPool.query('SELECT count(*)::int AS n FROM posting_batch')).rows[0].n,0);
  assert.equal((await adminPool.query('SELECT count(*)::int AS n FROM ledger_line')).rows[0].n,0);
  assert.equal((await adminPool.query("SELECT count(*)::int AS n FROM audit_event WHERE event_type='JOURNAL_POSTED'")).rows[0].n,0);
});

pgTest('approved snapshots are immutable, controlled retirement is idempotent and historical AUTO remains postable',async()=>{
  const ids=await seed({journalType:'AUTO',attachmentStatus:null});
  const trace=await attachAutoSource(ids);
  await assert.rejects(adminPool.query("UPDATE setting_snapshot SET snapshot='{}' WHERE setting_snapshot_id=$1",[trace.settingId]),error=>error.code==='55000');
  await assert.rejects(adminPool.query('DELETE FROM mapping_snapshot WHERE mapping_snapshot_id=$1',[trace.mappingId]),error=>error.code==='55000');

  const cutoff=new Date();cutoff.setUTCDate(cutoff.getUTCDate()+1);cutoff.setUTCHours(0,0,0,0);
  const cutoffIso=cutoff.toISOString();
  await adminPool.query("INSERT INTO accounting_period(tenant_id,entity_id,period_code,starts_on,ends_on,status) VALUES($1,$2,$3,$4,$4,'OPEN')",[ids.tenantId,ids.entityId,cutoffIso.slice(0,7),cutoffIso.slice(0,10)]);
  const kernel=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'config-retirer',['CONFIG.SNAPSHOT.RETIRE'])});
  const args={kind:'SETTING',tenantId:ids.tenantId,entityId:ids.entityId,snapshotId:trace.settingId,expectedRevision:0,cutoff:cutoffIso,reason:'Superseded by approved version 2',idempotencyKey:'retire-setting-0001'};
  const today=new Date();today.setUTCHours(0,0,0,0);
  await assert.rejects(kernel.retireConfigSnapshot({...args,cutoff:today.toISOString(),idempotencyKey:'retire-setting-today'}),error=>error.code==='22023');
  const yesterday=new Date();yesterday.setUTCDate(yesterday.getUTCDate()-1);yesterday.setUTCHours(0,0,0,0);
  await assert.rejects(kernel.retireConfigSnapshot({...args,cutoff:yesterday.toISOString(),idempotencyKey:'retire-setting-backdate'}),error=>error.code==='22023');
  const closedCutoff=new Date(Date.UTC(cutoff.getUTCFullYear(),cutoff.getUTCMonth()+1,1));
  await adminPool.query("INSERT INTO accounting_period(tenant_id,entity_id,period_code,starts_on,ends_on,status) VALUES($1,$2,$3,$4,$4,'CLOSED')",[ids.tenantId,ids.entityId,closedCutoff.toISOString().slice(0,7),closedCutoff.toISOString().slice(0,10)]);
  await assert.rejects(kernel.retireConfigSnapshot({...args,kind:'MAPPING',snapshotId:trace.mappingId,cutoff:closedCutoff.toISOString(),idempotencyKey:'retire-mapping-closed'}),error=>error.code==='55000');
  const retired=await kernel.retireConfigSnapshot(args);const replay=await kernel.retireConfigSnapshot(args);
  assert.equal(retired.status,'RETIRED');assert.equal(replay.idempotent,true);
  const row=(await adminPool.query('SELECT status,lifecycle_revision,retired_by,effective_to FROM setting_snapshot WHERE setting_snapshot_id=$1',[trace.settingId])).rows[0];
  assert.equal(row.status,'RETIRED');assert.equal(row.lifecycle_revision,'1');assert.equal(row.retired_by,'config-retirer');
  await assert.rejects(adminPool.query("UPDATE setting_snapshot SET retire_reason='tampered retirement reason' WHERE setting_snapshot_id=$1",[trace.settingId]),error=>error.code==='55000');
  const settingHash=(await adminPool.query("SELECT refs_jsonb_hash('{}'::jsonb) AS hash")).rows[0].hash;
  const tenantSetting=randomUUID();
  await adminPool.query(`INSERT INTO setting_snapshot(setting_snapshot_id,tenant_id,family,scope_type,scope_key,version,effective_from,status,snapshot,snapshot_hash,created_by,approved_by,approved_at)
    VALUES($1,$2::uuid,'BANK','TENANT',$2::text,1,'2026-01-01','APPROVED','{}',$3,'tenant-maker','tenant-approver',now())`,[tenantSetting,ids.tenantId,settingHash]);
  await assert.rejects(kernel.retireConfigSnapshot({...args,snapshotId:tenantSetting,idempotencyKey:'retire-tenant-scope'}),error=>error.code==='0A000');
  const sodKernel=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'mapping-approver',['CONFIG.SNAPSHOT.RETIRE'])});
  await assert.rejects(sodKernel.retireConfigSnapshot({...args,kind:'MAPPING',snapshotId:trace.mappingId,idempotencyKey:'retire-mapping-sod'}),error=>error.code==='42501');
  const retiredMapping=await kernel.retireConfigSnapshot({...args,kind:'MAPPING',snapshotId:trace.mappingId,idempotencyKey:'retire-mapping-0001'});
  assert.equal(retiredMapping.status,'RETIRED');
  await adminPool.query(`INSERT INTO setting_snapshot(tenant_id,entity_id,family,scope_type,scope_key,version,effective_from,status,snapshot,snapshot_hash,created_by,approved_by,approved_at)
    VALUES($1,$2::uuid,'BANK','ENTITY',$2::text,2,$3,'APPROVED','{}',$4,'v2-maker','v2-approver',now())`,[ids.tenantId,ids.entityId,cutoffIso,settingHash]);
  await adminPool.query(`INSERT INTO mapping_snapshot(tenant_id,entity_id,family,scope_type,scope_key,input_key_hash,version,priority,effective_from,status,input_keys,output_rules,snapshot_hash,created_by,approved_by,approved_at)
    VALUES($1,$2::uuid,'BANK','ENTITY',$2::text,$3,2,0,$4,'APPROVED','{}','{}',$5,'v2-map-maker','v2-map-approver',now())`,[ids.tenantId,ids.entityId,trace.inputKeyHash,cutoffIso,trace.configHashes.mapping_hash]);
  await assert.rejects(adminPool.query(`INSERT INTO setting_snapshot(tenant_id,entity_id,family,scope_type,scope_key,version,effective_from,status,snapshot,snapshot_hash,created_by,approved_by,approved_at)
    VALUES($1,$2::uuid,'BANK','ENTITY',$2::text,3,'2026-07-01','APPROVED','{}',$3,'backdated-maker','backdated-approver',now())`,[ids.tenantId,ids.entityId,settingHash]),error=>error.code==='23P01');
  await assert.rejects(adminPool.query(`INSERT INTO mapping_snapshot(tenant_id,entity_id,family,scope_type,scope_key,input_key_hash,version,priority,effective_from,status,input_keys,output_rules,snapshot_hash,created_by,approved_by,approved_at)
    VALUES($1,$2::uuid,'BANK','ENTITY',$2::text,$3,3,0,'2026-07-01','APPROVED','{}','{}',$4,'backdated-map-maker','backdated-map-approver',now())`,[ids.tenantId,ids.entityId,trace.inputKeyHash,trace.configHashes.mapping_hash]),error=>error.code==='23P01');
  await assert.rejects(kernel.retireConfigSnapshot({...args,snapshotId:(await adminPool.query("SELECT setting_snapshot_id FROM setting_snapshot WHERE version=2 AND entity_id=$1",[ids.entityId])).rows[0].setting_snapshot_id,expectedRevision:1,idempotencyKey:'retire-setting-stale',reason:'Stale retirement must fail'}),error=>error.code==='40001');

  const poster=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids)});
  await adminPool.query('UPDATE source_document SET accounting_date=$2::date WHERE source_document_id=$1',[trace.documentId,cutoffIso]);
  await assert.rejects(poster.postJournal({...ids,journalEntryId:ids.journalId,expectedRevision:0,idempotencyKey:'retired-cutoff-reject'}),error=>error.code==='23514');
  assert.equal((await adminPool.query('SELECT count(*)::int AS n FROM posting_batch')).rows[0].n,0);
  await adminPool.query("UPDATE source_document SET accounting_date='2026-07-15' WHERE source_document_id=$1",[trace.documentId]);
  const posted=await poster.postJournal({...ids,journalEntryId:ids.journalId,expectedRevision:0,idempotencyKey:'retired-history-post'});
  assert.equal(posted.idempotent,false);
  assert.equal((await adminPool.query("SELECT count(*)::int AS n FROM audit_event WHERE event_type='CONFIG_SNAPSHOT_RETIRED'")).rows[0].n,2);
  assert.equal((await adminPool.query("SELECT count(*)::int AS n FROM outbox_event WHERE event_type='CONFIG_SNAPSHOT_RETIRED'")).rows[0].n,2);
});

pgTest('setting overlap and mapping equal-priority overlap fail while a unique highest mapping wins',async()=>{
  const ids=await seed({journalType:'AUTO',attachmentStatus:null});const trace=await attachAutoSource(ids,{mappingPriority:10});
  const settingHash=trace.configHashes.setting_hash,mappingHash=trace.configHashes.mapping_hash;
  await assert.rejects(adminPool.query(`INSERT INTO setting_snapshot(tenant_id,entity_id,family,scope_type,scope_key,version,effective_from,status,snapshot,snapshot_hash,created_by,approved_by,approved_at)
    VALUES($1,$2::uuid,'BANK','ENTITY',$2::text,2,'2026-02-01','APPROVED','{}',$3,'maker2','approver2',now())`,[ids.tenantId,ids.entityId,settingHash]),error=>error.code==='23P01');
  await assert.rejects(adminPool.query(`INSERT INTO mapping_snapshot(tenant_id,entity_id,family,scope_type,scope_key,input_key_hash,version,priority,effective_from,status,input_keys,output_rules,snapshot_hash,created_by,approved_by,approved_at)
    VALUES($1,$2::uuid,'BANK','ENTITY',$2::text,$3,2,10,'2026-02-01','APPROVED','{}','{}',$4,'maker2','approver2',now())`,[ids.tenantId,ids.entityId,trace.inputKeyHash,mappingHash]),error=>error.code==='23P01');
  await adminPool.query(`INSERT INTO mapping_snapshot(tenant_id,entity_id,family,scope_type,scope_key,input_key_hash,version,priority,effective_from,status,input_keys,output_rules,snapshot_hash,created_by,approved_by,approved_at)
    VALUES($1,$2::uuid,'BANK','ENTITY',$2::text,$3,3,5,'2026-02-01','APPROVED','{}','{}',$4,'maker3','approver3',now())`,[ids.tenantId,ids.entityId,trace.inputKeyHash,mappingHash]);
  await assert.rejects(adminPool.query(`INSERT INTO mapping_snapshot(tenant_id,entity_id,family,scope_type,scope_key,input_key_hash,version,priority,effective_from,status,input_keys,output_rules,snapshot_hash,created_by,approved_by,approved_at)
    VALUES($1,$2::uuid,'BANK','ENTITY',$2::text,$3,4,20,'2026-07-01','APPROVED','{}','{}',$4,'retro-maker','retro-approver',now())`,[ids.tenantId,ids.entityId,trace.inputKeyHash,mappingHash]),error=>error.code==='23514');
  await adminPool.query(`INSERT INTO mapping_snapshot(tenant_id,entity_id,family,scope_type,scope_key,input_key_hash,version,priority,effective_from,status,input_keys,output_rules,snapshot_hash,created_by,approved_by,approved_at)
    VALUES($1,$2::uuid,'BANK','ENTITY',$2::text,$3,5,20,'2026-07-16','APPROVED','{}','{}',$4,'forward-maker','forward-approver',now())`,[ids.tenantId,ids.entityId,trace.inputKeyHash,mappingHash]);
  const kernel=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids)});
  assert.equal((await kernel.postJournal({...ids,journalEntryId:ids.journalId,expectedRevision:0,idempotencyKey:'highest-mapping-post'})).idempotent,false);
});

pgTest('post rehash and unique setting/mapping resolvers fail closed against owner bypass',async()=>{
  const tampered=await seed({journalType:'AUTO',attachmentStatus:null});const trace=await attachAutoSource(tampered);
  await adminPool.query('ALTER TABLE setting_snapshot DISABLE TRIGGER USER');
  try{await adminPool.query("UPDATE setting_snapshot SET snapshot=jsonb_build_object('tampered',true) WHERE setting_snapshot_id=$1",[trace.settingId]);}
  finally{await adminPool.query('ALTER TABLE setting_snapshot ENABLE TRIGGER USER');}
  const tamperKernel=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(tampered)});
  await assert.rejects(tamperKernel.postJournal({...tampered,journalEntryId:tampered.journalId,expectedRevision:0,idempotencyKey:'tamper-rehash-post'}),error=>error.code==='23514');
  assert.equal((await adminPool.query('SELECT count(*)::int AS n FROM posting_batch')).rows[0].n,0);

  await adminPool.query('TRUNCATE tenant CASCADE');
  const duplicateSetting=await seed({journalType:'AUTO',attachmentStatus:null});const settingTrace=await attachAutoSource(duplicateSetting);
  await adminPool.query('ALTER TABLE setting_snapshot DROP CONSTRAINT setting_approved_scope_no_overlap');
  try{
    await adminPool.query(`INSERT INTO setting_snapshot(tenant_id,entity_id,family,scope_type,scope_key,version,effective_from,status,snapshot,snapshot_hash,created_by,approved_by,approved_at)
      VALUES($1,$2::uuid,'BANK','ENTITY',$2::text,2,'2026-01-01','APPROVED','{}',$3,'duplicate-maker','duplicate-approver',now())`,[duplicateSetting.tenantId,duplicateSetting.entityId,settingTrace.configHashes.setting_hash]);
    const duplicateKernel=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(duplicateSetting)});
    await assert.rejects(duplicateKernel.postJournal({...duplicateSetting,journalEntryId:duplicateSetting.journalId,expectedRevision:0,idempotencyKey:'setting-duplicate-post'}),error=>error.code==='23514');
  }finally{
    await adminPool.query('ALTER TABLE setting_snapshot DISABLE TRIGGER USER');
    await adminPool.query('DELETE FROM setting_snapshot WHERE version=2 AND entity_id=$1',[duplicateSetting.entityId]);
    await adminPool.query('ALTER TABLE setting_snapshot ENABLE TRIGGER USER');
    await adminPool.query(`ALTER TABLE setting_snapshot ADD CONSTRAINT setting_approved_scope_no_overlap EXCLUDE USING gist (
      tenant_id WITH =,family WITH =,scope_type WITH =,scope_key WITH =,
      tstzrange(effective_from,COALESCE(effective_to,'infinity'::timestamptz),'[)') WITH &&) WHERE (status IN ('APPROVED','RETIRED'))`);
  }

  await adminPool.query('TRUNCATE tenant CASCADE');
  const tied=await seed({journalType:'AUTO',attachmentStatus:null});const tiedTrace=await attachAutoSource(tied,{mappingPriority:9});
  await adminPool.query('ALTER TABLE mapping_snapshot DROP CONSTRAINT mapping_approved_equal_priority_no_overlap');
  try{
    await adminPool.query(`INSERT INTO mapping_snapshot(tenant_id,entity_id,family,scope_type,scope_key,input_key_hash,version,priority,effective_from,status,input_keys,output_rules,snapshot_hash,created_by,approved_by,approved_at)
      VALUES($1,$2::uuid,'BANK','ENTITY',$2::text,$3,2,9,'2026-01-01','APPROVED','{}','{}',$4,'tie-maker','tie-approver',now())`,[tied.tenantId,tied.entityId,tiedTrace.inputKeyHash,tiedTrace.configHashes.mapping_hash]);
    const tieKernel=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(tied)});
    await assert.rejects(tieKernel.postJournal({...tied,journalEntryId:tied.journalId,expectedRevision:0,idempotencyKey:'mapping-tie-post'}),error=>error.code==='23514');
  }finally{
    await adminPool.query('ALTER TABLE mapping_snapshot DISABLE TRIGGER USER');
    await adminPool.query('DELETE FROM mapping_snapshot WHERE version=2 AND entity_id=$1',[tied.entityId]);
    await adminPool.query('ALTER TABLE mapping_snapshot ENABLE TRIGGER USER');
    await adminPool.query(`ALTER TABLE mapping_snapshot ADD CONSTRAINT mapping_approved_equal_priority_no_overlap EXCLUDE USING gist (
      tenant_id WITH =,family WITH =,scope_type WITH =,scope_key WITH =,input_key_hash WITH =,priority WITH =,
      tstzrange(effective_from,COALESCE(effective_to,'infinity'::timestamptz),'[)') WITH &&) WHERE (status IN ('APPROVED','RETIRED'))`);
  }
  assert.equal((await adminPool.query('SELECT count(*)::int AS n FROM posting_batch')).rows[0].n,0);
});

pgTest('legacy dirty approved configuration makes migration 002 fail atomically',async()=>{
  while((await adminPool.query('SELECT count(*)::int AS n FROM refs_schema_migration')).rows[0].n>1)await migrateDown(adminPool);
  const tenantId=randomUUID(),entityId=randomUUID();
  await adminPool.query("INSERT INTO tenant(tenant_id,tenant_code,name) VALUES($1,'DIRTYTEN','Dirty migration tenant')",[tenantId]);
  await adminPool.query("INSERT INTO entity(entity_id,tenant_id,entity_code,source_system,source_entity_id,name,base_currency) VALUES($1,$2,'DIRTYENT','WBS','DIRTYENT','Dirty entity','USD')",[entityId,tenantId]);
  await adminPool.query('ALTER TABLE setting_snapshot DISABLE TRIGGER USER');
  try{
    await adminPool.query(`INSERT INTO setting_snapshot(tenant_id,entity_id,family,scope_type,scope_key,version,effective_from,status,snapshot,snapshot_hash,created_by,approved_by,approved_at)
      VALUES($1,$2::uuid,'BANK','ENTITY',$2::text,1,'2026-01-01','APPROVED','{}',$3,'maker','approver',now())`,[tenantId,entityId,hash('not-canonical')]);
  }finally{await adminPool.query('ALTER TABLE setting_snapshot ENABLE TRIGGER USER');}
  await assert.rejects(migrateUp(adminPool),error=>/canonical validation|snapshot hash mismatch/i.test(error.message));
  assert.equal((await adminPool.query("SELECT to_regclass('public.account_master') AS table_name")).rows[0].table_name,null);
  assert.deepEqual((await adminPool.query('SELECT migration_name FROM refs_schema_migration ORDER BY migration_name')).rows.map(row=>row.migration_name),['001_wbs_accounting_core.sql']);
  await adminPool.query('DELETE FROM setting_snapshot WHERE tenant_id=$1',[tenantId]);
  await adminPool.query('DELETE FROM entity WHERE tenant_id=$1',[tenantId]);
  await adminPool.query('DELETE FROM tenant WHERE tenant_id=$1',[tenantId]);
  await migrateUp(adminPool);
});

pgTest('down restores pre-hardened PUBLIC CREATE and exact direct USAGE ACLs',async()=>{
  const aclRows=async()=>(await adminPool.query(`SELECT CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE r.rolname END AS grantee,x.privilege_type
    FROM pg_namespace n CROSS JOIN LATERAL aclexplode(COALESCE(n.nspacl,acldefault('n',n.nspowner))) x
    LEFT JOIN pg_roles r ON r.oid=x.grantee
    WHERE n.nspname='public' AND (x.grantee=0 OR r.rolname IN ('refs_app','refs_context_issuer','refs_grant_sync'))
    ORDER BY 1,2`)).rows;
  await migrateDown(adminPool,{all:true});
  await adminPool.query('GRANT CREATE,USAGE ON SCHEMA public TO PUBLIC');
  await adminPool.query('REVOKE USAGE ON SCHEMA public FROM refs_app,refs_context_issuer,refs_grant_sync');
  const before=await aclRows();
  await migrateUp(adminPool);
  const publicPrivileges=(await adminPool.query(`SELECT privilege_type FROM pg_namespace n,LATERAL aclexplode(COALESCE(n.nspacl,acldefault('n',n.nspowner))) x
    WHERE n.nspname='public' AND x.grantee=0 ORDER BY privilege_type`)).rows.map(row=>row.privilege_type);
  assert.deepEqual(publicPrivileges,['USAGE']);
  await migrateDown(adminPool,{all:true});
  assert.deepEqual(await aclRows(),before);
  await migrateUp(adminPool);
});

pgTest('runtime roles create, submit, review, approve and post a manual journal without admin DML',async()=>{
  const ids=await seed({status:'DRAFT'});
  const attachmentId=(await adminPool.query('SELECT attachment_id FROM source_link WHERE journal_entry_id=$1 AND attachment_id IS NOT NULL',[ids.journalId])).rows[0].attachment_id;
  const createArgs={tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId,journalNumber:'JE-RUNTIME-001',journalDate:'2026-07-16',currency:'USD',description:'Runtime-created manual journal',attachmentIds:[attachmentId],idempotencyKey:'create-manual-0001',lines:[
    {line_no:1,account_code:'111000',debit_amount:125,credit_amount:0,member_ref:'BANK-1',description:'Cash',dimensions:{}},
    {line_no:2,account_code:'291001',debit_amount:0,credit_amount:125,member_ref:'VENDOR-1',description:'AP',dimensions:{}}
  ]};
  const maker=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'runtime-maker',['GL.JE.CREATE','GL.JE.SUBMIT','GL.JE.REVIEW'])});
  const created=await maker.createManualJournal(createArgs);const replay=await maker.createManualJournal(createArgs);
  assert.equal(created.status,'DRAFT');assert.equal(replay.idempotent,true);assert.equal(replay.journal_entry_id,created.journal_entry_id);
  const submitted=await maker.transitionJournal({tenantId:ids.tenantId,entityId:ids.entityId,journalEntryId:created.journal_entry_id,action:'SUBMIT',expectedRevision:0,idempotencyKey:'submit-manual-0001'});
  assert.equal(submitted.status,'PENDING_REVIEW');
  await assert.rejects(maker.transitionJournal({tenantId:ids.tenantId,entityId:ids.entityId,journalEntryId:created.journal_entry_id,action:'REVIEW',expectedRevision:1,idempotencyKey:'self-review-manual-0001'}),error=>error.code==='42501');
  const reviewer=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'runtime-reviewer',['GL.JE.REVIEW'])});
  const reviewed=await reviewer.transitionJournal({tenantId:ids.tenantId,entityId:ids.entityId,journalEntryId:created.journal_entry_id,action:'REVIEW',expectedRevision:1,idempotencyKey:'review-manual-0001'});
  assert.equal(reviewed.status,'PENDING_APPROVAL');
  const approver=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'runtime-approver',['GL.JE.APPROVE'])});
  const approved=await approver.transitionJournal({tenantId:ids.tenantId,entityId:ids.entityId,journalEntryId:created.journal_entry_id,action:'APPROVE',expectedRevision:2,idempotencyKey:'approve-manual-0001'});
  assert.equal(approved.status,'APPROVED');
  const poster=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'runtime-poster',['GL.JE.POST'])});
  const posted=await poster.postJournal({...ids,journalEntryId:created.journal_entry_id,expectedRevision:3,idempotencyKey:'post-runtime-manual-0001'});
  assert.equal(posted.idempotent,false);
  assert.equal((await adminPool.query('SELECT count(*)::int n FROM ledger_line WHERE journal_entry_id=$1',[created.journal_entry_id])).rows[0].n,2);
  assert.equal((await adminPool.query("SELECT count(*)::int n FROM audit_event WHERE object_id=$1 AND event_type IN ('JOURNAL_CREATED','JOURNAL_SUBMIT','JOURNAL_REVIEW','JOURNAL_APPROVE','JOURNAL_POSTED')",[created.journal_entry_id])).rows[0].n,5);
  assert.equal((await adminPool.query("SELECT count(*)::int n FROM outbox_event WHERE aggregate_id=$1 AND event_type IN ('JOURNAL_CREATED','JOURNAL_SUBMIT','JOURNAL_REVIEW','JOURNAL_APPROVE','JOURNAL_POSTED')",[created.journal_entry_id])).rows[0].n,5);
});

pgTest('authenticated HTTP commands traverse context issuance and PostgreSQL into the immutable ledger',async()=>{
  const ids=await seed({status:'DRAFT'});
  const attachmentId=(await adminPool.query('SELECT attachment_id FROM source_link WHERE journal_entry_id=$1 AND attachment_id IS NOT NULL',[ids.journalId])).rows[0].attachment_id;
  const permissions={
    'http-maker':['GL.JE.CREATE','GL.JE.SUBMIT'],'http-reviewer':['GL.JE.REVIEW'],
    'http-approver':['GL.JE.APPROVE'],'http-poster':['GL.JE.POST']
  };
  const api=createAccountingApi({
    authenticate:async({headers})=>({trusted:true,tenantId:ids.tenantId,actorId:headers['x-test-actor']}),
    kernelFactory:async principal=>new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,principal.actorId,permissions[principal.actorId]||[])})
  });
  const send=(actor,path,body,idempotencyKey,revision)=>api({method:'POST',url:path,body,headers:{'x-test-actor':actor,'idempotency-key':idempotencyKey,...(revision==null?{}:{'if-match':`"${revision}"`})}});
  const base=`/api/v1/entities/${ids.entityId}/journal-entries`;
  const create=await send('http-maker',`${base}/manual`,{periodId:ids.periodId,journalNumber:'JE-HTTP-PG-001',journalDate:'2026-07-18',currency:'USD',description:'HTTP to PG',attachmentIds:[attachmentId],lines:[
    {line_no:1,account_code:'111000',debit_amount:75,credit_amount:0,member_ref:'BANK-1',dimensions:{}},
    {line_no:2,account_code:'291001',debit_amount:0,credit_amount:75,member_ref:'VENDOR-1',dimensions:{}}
  ]},'http-create-0001');
  assert.equal(create.status,201);const journalId=create.body.data.journal_entry_id;
  assert.equal((await send('http-maker',`${base}/${journalId}/transitions/submit`,{},'http-submit-0001',0)).status,201);
  assert.equal((await send('http-reviewer',`${base}/${journalId}/transitions/review`,{},'http-review-0001',1)).status,201);
  assert.equal((await send('http-approver',`${base}/${journalId}/transitions/approve`,{},'http-approve-0001',2)).status,201);
  assert.equal((await send('http-poster',`${base}/${journalId}/post`,{periodId:ids.periodId},'http-post-0001',3)).status,201);
  assert.equal((await adminPool.query('SELECT status FROM journal_entry WHERE journal_entry_id=$1',[journalId])).rows[0].status,'POSTED');
  assert.equal((await adminPool.query('SELECT count(*)::int n FROM ledger_line WHERE journal_entry_id=$1',[journalId])).rows[0].n,2);
  assert.equal((await adminPool.query("SELECT count(*)::int n FROM audit_event WHERE object_id=$1 AND event_type IN ('JOURNAL_CREATED','JOURNAL_SUBMIT','JOURNAL_REVIEW','JOURNAL_APPROVE','JOURNAL_POSTED')",[journalId])).rows[0].n,5);
});

pgTest('production HTTP listener verifies an RS256 access token before DB context issuance and immutable posting',async()=>{
  const ids=await seed({status:'DRAFT'}),attachmentId=(await adminPool.query('SELECT attachment_id FROM source_link WHERE journal_entry_id=$1 AND attachment_id IS NOT NULL',[ids.journalId])).rows[0].attachment_id;
  const permissions={maker:['GL.JE.CREATE','GL.JE.SUBMIT'],reviewer:['GL.JE.REVIEW'],approver:['GL.JE.APPROVE'],poster:['GL.JE.POST']};
  for(const [actor,grants] of Object.entries(permissions))for(const permission of grants)await adminPool.query('INSERT INTO runtime_actor_grant(tenant_id,actor_id,entity_id,permission) VALUES($1,$2,$3,$4)',[ids.tenantId,actor,ids.entityId,permission]);
  const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048}),issuer='https://issuer.refs.test',audience='refs-accounting',authenticator=new OidcJwtAuthenticator({issuer,audience,keyResolver:{resolve:async()=>publicKey}});
  const token=actor=>{const now=Math.floor(Date.now()/1000),header=Buffer.from(JSON.stringify({alg:'RS256',kid:'test-key',typ:'JWT'})).toString('base64url'),payload=Buffer.from(JSON.stringify({iss:issuer,aud:audience,iat:now,exp:now+300,tenant_id:ids.tenantId,sub:actor})).toString('base64url'),signature=sign('RSA-SHA256',Buffer.from(`${header}.${payload}`),privateKey).toString('base64url');return `${header}.${payload}.${signature}`;};
  const server=createProductionAccountingServer({runtimePool,issuerPool,authenticator,attachmentStorage:{probe:async()=>true},virusScanner:{probe:async()=>true},scannerServiceActorId:'scanner-service',wbsSnapshotVerifier:()=>true,allowedOrigins:['https://app.example']});
  await new Promise((resolve,reject)=>server.listen(0,'127.0.0.1',error=>error?reject(error):resolve()));
  try{
    const base=`http://127.0.0.1:${server.address().port}`,request=async(actor,path,body,idempotencyKey,revision)=>{const response=await fetch(`${base}${path}`,{method:'POST',headers:{authorization:`Bearer ${token(actor)}`,'content-type':'application/json','idempotency-key':idempotencyKey,...(revision==null?{}:{'if-match':`"${revision}"`})},body:JSON.stringify(body)});return {status:response.status,body:await response.json()};};
    assert.equal((await fetch(`${base}/health/ready`)).status,200);assert.equal((await fetch(`${base}/api/v1/entities/${ids.entityId}/journal-entries/manual`,{method:'POST'})).status,401);
    const path=`/api/v1/entities/${ids.entityId}/journal-entries`,created=await request('maker',`${path}/manual`,{periodId:ids.periodId,journalNumber:'JE-PROD-OIDC-001',journalDate:'2026-07-18',currency:'USD',description:'Production composition',attachmentIds:[attachmentId],lines:[{line_no:1,account_code:'111000',debit_amount:75,credit_amount:0,member_ref:'BANK-1',dimensions:{}},{line_no:2,account_code:'291001',debit_amount:0,credit_amount:75,member_ref:'VENDOR-1',dimensions:{}}]},'prod-create-0001');
    assert.equal(created.status,201);const journalId=created.body.data.journal_entry_id;
    assert.equal((await request('maker',`${path}/${journalId}/transitions/submit`,{},'prod-submit-0001',0)).status,201);assert.equal((await request('reviewer',`${path}/${journalId}/transitions/review`,{},'prod-review-0001',1)).status,201);assert.equal((await request('approver',`${path}/${journalId}/transitions/approve`,{},'prod-approve-0001',2)).status,201);assert.equal((await request('poster',`${path}/${journalId}/post`,{periodId:ids.periodId},'prod-post-0001',3)).status,201);
    assert.equal((await adminPool.query('SELECT status FROM journal_entry WHERE journal_entry_id=$1',[journalId])).rows[0].status,'POSTED');assert.equal((await adminPool.query('SELECT count(*)::int n FROM ledger_line WHERE journal_entry_id=$1',[journalId])).rows[0].n,2);assert.equal((await adminPool.query("SELECT count(*)::int n FROM audit_event WHERE object_id=$1 AND event_type='JOURNAL_POSTED'",[journalId])).rows[0].n,1);
  }finally{await new Promise(resolve=>server.close(resolve));}
});

pgTest('authenticated HTTP AR aging reads only the entity authorized by its DB context',async()=>{
  const ids=await seed({status:'APPROVED'}),invoiceId=randomUUID(),other=await seed({status:'APPROVED',tenantId:ids.tenantId});
  await adminPool.query(`INSERT INTO business_document(business_document_id,tenant_id,entity_id,document_kind,document_number,counterparty_ref,counterparty_name,currency,accounting_date,due_date,gross_amount,open_balance,status,created_by)
    VALUES($1,$2,$3,'AR_INVOICE','INV-HTTP-AGING','CUSTOMER-1','Customer','USD','2026-07-01','2026-07-01',30,30,'OPEN','fixture')`,[invoiceId,ids.tenantId,ids.entityId]);
  await adminPool.query(`INSERT INTO business_document(business_document_id,tenant_id,entity_id,document_kind,document_number,counterparty_ref,counterparty_name,currency,accounting_date,due_date,gross_amount,open_balance,status,created_by)
    VALUES($1,$2,$3,'AR_INVOICE','INV-FUTURE-AGING','CUSTOMER-1','Customer','USD','2026-09-01','2026-09-30',40,40,'OPEN','fixture')`,[randomUUID(),ids.tenantId,ids.entityId]);
  const api=createAccountingApi({
    authenticate:async()=>({trusted:true,tenantId:ids.tenantId,actorId:'http-aging-reader'}),
    kernelFactory:async()=>new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'http-aging-reader',['AR.VIEW'])})
  });
  const path=`/api/v1/entities/${ids.entityId}/ar/aging?asOf=2026-08-31`;
  const response=await api({method:'GET',url:path,headers:{},body:null});
  assert.equal(response.status,200);assert.deepEqual(response.body.data,[{currency:'USD',current_amount:'0.0000',days_1_30:'0.0000',days_31_60:'0.0000',days_61_90:'30.0000',days_91_plus:'0.0000',total_open_balance:'30.0000'}]);
  assert.equal((await api({method:'GET',url:`/api/v1/entities/${other.entityId}/ar/aging?asOf=2026-08-31`,headers:{},body:null})).status,403);
});

pgTest('authenticated HTTP refreshes AP Bills and AR Invoices only from its authorized entity',async()=>{
  const ids=await seed({status:'APPROVED'}),other=await seed({status:'APPROVED',tenantId:ids.tenantId});
  const billId=randomUUID(),invoiceId=randomUUID(),otherBillId=randomUUID();
  await adminPool.query(`INSERT INTO business_document(business_document_id,tenant_id,entity_id,document_kind,document_number,counterparty_ref,counterparty_name,currency,accounting_date,due_date,gross_amount,open_balance,status,created_by)
    VALUES($1,$2,$3,'AP_BILL','BILL-HTTP-READ','VENDOR-1','Vendor','USD','2026-07-15','2026-08-15',100,60,'PARTIALLY_PAID','fixture'),
      ($4,$2,$3,'AR_INVOICE','INV-HTTP-READ','CUSTOMER-1','Customer','USD','2026-07-16','2026-08-16',80,80,'OPEN','fixture'),
      ($5,$2,$6,'AP_BILL','BILL-OTHER-ENTITY','VENDOR-1','Vendor','USD','2026-07-15','2026-08-15',50,50,'OPEN','fixture')`,[billId,ids.tenantId,ids.entityId,invoiceId,otherBillId,other.entityId]);
  const api=createAccountingApi({
    authenticate:async()=>({trusted:true,tenantId:ids.tenantId,actorId:'http-document-reader'}),
    kernelFactory:async()=>new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'http-document-reader',['AP.VIEW','AR.VIEW'])})
  });
  const billResponse=await api({method:'GET',url:`/api/v1/entities/${ids.entityId}/ap/bills`,headers:{},body:null});
  assert.equal(billResponse.status,200);assert.deepEqual(billResponse.body.data.map(row=>({business_document_id:row.business_document_id,document_number:row.document_number,open_balance:row.open_balance,status:row.status})),[{business_document_id:billId,document_number:'BILL-HTTP-READ',open_balance:'60.0000',status:'PARTIALLY_PAID'}]);
  const invoiceResponse=await api({method:'GET',url:`/api/v1/entities/${ids.entityId}/ar/invoices`,headers:{},body:null});
  assert.equal(invoiceResponse.status,200);assert.deepEqual(invoiceResponse.body.data.map(row=>({business_document_id:row.business_document_id,document_number:row.document_number,open_balance:row.open_balance,status:row.status})),[{business_document_id:invoiceId,document_number:'INV-HTTP-READ',open_balance:'80.0000',status:'OPEN'}]);
  assert.equal((await api({method:'GET',url:`/api/v1/entities/${other.entityId}/ap/bills`,headers:{},body:null})).status,403);
  assert.equal((await api({method:'GET',url:`/api/v1/entities/${ids.entityId}/ap/bills`,headers:{'Idempotency-Key':'read-not-allowed'},body:null})).status,400);
});

pgTest('authenticated HTTP refreshes durable AP and AR adjustments with linked workflow state only from its authorized entity',async()=>{
  const ids=await seed({status:'APPROVED'}),other=await seed({status:'APPROVED',tenantId:ids.tenantId});
  const apId=randomUUID(),arId=randomUUID();
  await adminPool.query(`INSERT INTO business_adjustment(business_adjustment_id,tenant_id,entity_id,adjustment_kind,amount,currency,accounting_date,period_id,reason,status,idempotency_key,request_hash,created_by)
    VALUES($1,$2,$3,'AP_VENDOR_CREDIT',12.5,'USD','2026-07-15',$4,'Approved vendor credit','DRAFT','adjustment-read-ap-001',$5,'fixture'),
      ($6,$2,$3,'AR_CREDIT_MEMO',8,'USD','2026-07-16',$4,'Approved customer credit','POSTED','adjustment-read-ar-001',$5,'fixture')`,[apId,ids.tenantId,ids.entityId,ids.periodId,`sha256:${'a'.repeat(64)}`,arId]);
  const api=createAccountingApi({
    authenticate:async()=>({trusted:true,tenantId:ids.tenantId,actorId:'adjustment-reader'}),
    kernelFactory:async()=>new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'adjustment-reader',['AP.VIEW','AR.VIEW'])})
  });
  const ap=await api({method:'GET',url:`/api/v1/entities/${ids.entityId}/ap/adjustments`,headers:{},body:null});
  const ar=await api({method:'GET',url:`/api/v1/entities/${ids.entityId}/ar/adjustments`,headers:{},body:null});
  assert.equal(ap.status,200);assert.deepEqual(ap.body.data.map(row=>({business_adjustment_id:row.business_adjustment_id,adjustment_kind:row.adjustment_kind,amount:row.amount,status:row.status})),[{business_adjustment_id:apId,adjustment_kind:'AP_VENDOR_CREDIT',amount:'12.5000',status:'DRAFT'}]);
  assert.equal(ar.status,200);assert.deepEqual(ar.body.data.map(row=>({business_adjustment_id:row.business_adjustment_id,adjustment_kind:row.adjustment_kind,amount:row.amount,status:row.status})),[{business_adjustment_id:arId,adjustment_kind:'AR_CREDIT_MEMO',amount:'8.0000',status:'POSTED'}]);
  assert.equal((await api({method:'GET',url:`/api/v1/entities/${other.entityId}/ap/adjustments`,headers:{},body:null})).status,403);
});

pgTest('authenticated HTTP creates AP Bills and AR Invoices only as evidence-backed Draft JEs, then posts both atomically',async()=>{
  const ids=await seed({status:'APPROVED',extraAccounts:[{accountCode:'610000',accountName:'Expense'},{accountCode:'400000',accountName:'Revenue'}]});
  await adminPool.query("INSERT INTO member_master(tenant_id,entity_id,member_ref,member_type,display_name) VALUES($1,$2,'CUSTOMER-1','CUSTOMER','Customer')",[ids.tenantId,ids.entityId]);
  const attachmentId=(await adminPool.query('SELECT attachment_id FROM source_link WHERE journal_entry_id=$1 AND attachment_id IS NOT NULL',[ids.journalId])).rows[0].attachment_id;
  const permissions={
    'document-maker':['AP.BILL.CREATE','AR.INVOICE.CREATE','GL.JE.SUBMIT'],
    'document-reviewer':['GL.JE.REVIEW'],'document-approver':['GL.JE.APPROVE'],'document-poster':['GL.JE.POST'],
    'document-reader':['AP.VIEW','AR.VIEW']
  };
  const api=createAccountingApi({
    authenticate:async({headers})=>({trusted:true,tenantId:ids.tenantId,actorId:headers['x-test-actor']}),
    kernelFactory:async principal=>new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,principal.actorId,permissions[principal.actorId]||[])})
  });
  const send=(actor,path,body,idempotencyKey,revision)=>api({method:'POST',url:path,body,headers:{'x-test-actor':actor,'idempotency-key':idempotencyKey,...(revision==null?{}:{'if-match':`"${revision}"`})}});
  const root=`/api/v1/entities/${ids.entityId}`;
  const create=async(module,body,key)=>{
    const response=await send('document-maker',`${root}/${module}`,body,key);
    assert.equal(response.status,201,JSON.stringify(response.body));assert.equal(response.body.data.status,'DRAFT');
    const result=response.body.data;
    assert.deepEqual((await adminPool.query('SELECT status,open_balance,draft_journal_entry_id,posted_journal_entry_id FROM business_document WHERE business_document_id=$1',[result.business_document_id])).rows[0],{status:'DRAFT',open_balance:'100.0000',draft_journal_entry_id:result.journal_entry_id,posted_journal_entry_id:null});
    assert.equal((await adminPool.query('SELECT count(*)::int n FROM ledger_line WHERE journal_entry_id=$1',[result.journal_entry_id])).rows[0].n,0);
    const journalPath=`${root}/journal-entries/${result.journal_entry_id}`;
    assert.equal((await send('document-maker',`${journalPath}/transitions/submit`,{},`${key}-submit`,0)).status,201);
    assert.equal((await send('document-reviewer',`${journalPath}/transitions/review`,{},`${key}-review`,1)).status,201);
    assert.equal((await send('document-approver',`${journalPath}/transitions/approve`,{},`${key}-approve`,2)).status,201);
    assert.equal((await send('document-poster',`${journalPath}/post`,{periodId:ids.periodId},`${key}-post`,3)).status,201);
    assert.deepEqual((await adminPool.query('SELECT status,open_balance,draft_journal_entry_id,posted_journal_entry_id,version FROM business_document WHERE business_document_id=$1',[result.business_document_id])).rows[0],{status:'OPEN',open_balance:'100.0000',draft_journal_entry_id:null,posted_journal_entry_id:result.journal_entry_id,version:'1'});
    assert.equal((await adminPool.query('SELECT count(*)::int n FROM ledger_line WHERE journal_entry_id=$1',[result.journal_entry_id])).rows[0].n,2);
    assert.equal((await adminPool.query("SELECT count(*)::int n FROM audit_event WHERE object_id=$1 AND event_type IN ('AP_BILL_DRAFT_CREATED','AP_BILL_POSTED','AR_INVOICE_DRAFT_CREATED','AR_INVOICE_POSTED')",[result.business_document_id])).rows[0].n,2);
    return result;
  };
  const bill=await create('ap/bills',{periodId:ids.periodId,documentNumber:'BILL-NATIVE-100',counterpartyRef:'VENDOR-1',counterpartyName:'Vendor',currency:'USD',accountingDate:'2026-07-18',dueDate:'2026-08-18',amount:100,offsetAccountCode:'610000',description:'Native AP bill',attachmentIds:[attachmentId]},'native-ap-bill-100');
  const invoice=await create('ar/invoices',{periodId:ids.periodId,documentNumber:'INV-NATIVE-100',counterpartyRef:'CUSTOMER-1',counterpartyName:'Customer',currency:'USD',accountingDate:'2026-07-18',dueDate:'2026-08-18',amount:100,offsetAccountCode:'400000',description:'Native AR invoice',attachmentIds:[attachmentId]},'native-ar-invoice-100');
  const readBill=(await api({method:'GET',url:`${root}/ap/bills`,headers:{'x-test-actor':'document-reader'},body:null})).body.data[0];
  assert.deepEqual({business_document_id:readBill.business_document_id,status:readBill.status,offset_account_code:readBill.offset_account_code,description:readBill.description,journal_entry_id:readBill.journal_entry_id,journal_status:readBill.journal_status,journal_revision:readBill.journal_revision,period_id:readBill.period_id},{business_document_id:bill.business_document_id,status:'OPEN',offset_account_code:'610000',description:'Native AP bill',journal_entry_id:bill.journal_entry_id,journal_status:'POSTED',journal_revision:'4',period_id:ids.periodId});
  const readInvoice=(await api({method:'GET',url:`${root}/ar/invoices`,headers:{'x-test-actor':'document-reader'},body:null})).body.data[0];
  assert.deepEqual({business_document_id:readInvoice.business_document_id,status:readInvoice.status,offset_account_code:readInvoice.offset_account_code,description:readInvoice.description,journal_entry_id:readInvoice.journal_entry_id,journal_status:readInvoice.journal_status,journal_revision:readInvoice.journal_revision,period_id:readInvoice.period_id},{business_document_id:invoice.business_document_id,status:'OPEN',offset_account_code:'400000',description:'Native AR invoice',journal_entry_id:invoice.journal_entry_id,journal_status:'POSTED',journal_revision:'4',period_id:ids.periodId});
  const spoof=await send('document-maker',`${root}/ap/bills`,{periodId:ids.periodId,documentNumber:'BILL-NO-EVIDENCE',counterpartyRef:'VENDOR-1',counterpartyName:'Vendor',currency:'USD',accountingDate:'2026-07-18',amount:100,offsetAccountCode:'610000',attachmentIds:[]},'native-ap-bill-no-evidence');
  assert.equal(spoof.status,422);
});

pgTest('authenticated HTTP posts a vendor credit and atomically applies it to an AP bill',async()=>{
  const ids=await seed({status:'APPROVED',extraAccounts:[{accountCode:'610000',accountName:'Expense'}]}),billId=randomUUID(),applierId=randomUUID();
  await adminPool.query(`INSERT INTO business_document(business_document_id,tenant_id,entity_id,document_kind,document_number,counterparty_ref,counterparty_name,currency,accounting_date,due_date,gross_amount,open_balance,status,created_by)
    VALUES($1,$2,$3,'AP_BILL','BILL-HTTP-CREDIT','VENDOR-1','Vendor','USD','2026-07-15','2026-08-15',100,100,'APPROVED','fixture')`,[billId,ids.tenantId,ids.entityId]);
  const permissions={
    'http-credit-maker':['AP.VENDOR_CREDIT.CREATE','GL.JE.SUBMIT'],'http-credit-reviewer':['GL.JE.REVIEW'],
    'http-credit-approver':['GL.JE.APPROVE'],'http-credit-poster':['GL.JE.POST'],[applierId]:['AP.VENDOR_CREDIT.APPLY']
  };
  const api=createAccountingApi({
    authenticate:async({headers})=>({trusted:true,tenantId:ids.tenantId,actorId:headers['x-test-actor']}),
    kernelFactory:async principal=>new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,principal.actorId,permissions[principal.actorId]||[])})
  });
  const send=(actor,path,body,idempotencyKey,revision)=>api({method:'POST',url:path,body,headers:{'x-test-actor':actor,'idempotency-key':idempotencyKey,...(revision==null?{}:{'if-match':`"${revision}"`})}});
  const root=`/api/v1/entities/${ids.entityId}`;
  const created=await send('http-credit-maker',`${root}/ap/vendor-credits`,{periodId:ids.periodId,creditNumber:'VC-HTTP-100',creditDate:'2026-07-16',vendorRef:'VENDOR-1',vendorName:'Vendor',amount:100,lines:[{line_no:1,account_code:'610000',amount:100,description:'Vendor credit'}],reason:'HTTP vendor price adjustment'},'http-credit-create');
  assert.equal(created.status,201);const credit=created.body.data;
  await attachAutoSource({...ids,journalId:credit.journal_entry_id});
  const journalPath=`${root}/journal-entries/${credit.journal_entry_id}`;
  assert.equal((await send('http-credit-maker',`${journalPath}/transitions/submit`,{},'http-credit-submit',0)).status,201);
  assert.equal((await send('http-credit-reviewer',`${journalPath}/transitions/review`,{},'http-credit-review',1)).status,201);
  assert.equal((await send('http-credit-approver',`${journalPath}/transitions/approve`,{},'http-credit-approve',2)).status,201);
  assert.equal((await send('http-credit-poster',`${journalPath}/post`,{periodId:ids.periodId},'http-credit-post',3)).status,201);
  const allocationPath=`${root}/ap/vendor-credits/${credit.business_adjustment_id}/allocations`;
  const allocationBody={businessDocumentId:billId,amount:40,reason:'Apply posted vendor credit'};
  assert.equal((await send(applierId,allocationPath,allocationBody,'http-credit-apply')).status,201);
  const replay=await send(applierId,allocationPath,allocationBody,'http-credit-apply');assert.equal(replay.status,200);
  assert.deepEqual((await adminPool.query('SELECT open_balance,status FROM business_document WHERE business_document_id=$1',[billId])).rows[0],{open_balance:'60.0000',status:'PARTIALLY_PAID'});
  const fullApply={businessDocumentId:billId,amount:60,reason:'Apply remaining posted vendor credit'};
  assert.equal((await send(applierId,allocationPath,fullApply,'http-credit-apply-remaining')).status,201);
  assert.deepEqual((await adminPool.query('SELECT open_balance,status FROM business_document WHERE business_document_id=$1',[billId])).rows[0],{open_balance:'0.0000',status:'PAID'});
  assert.equal((await adminPool.query("SELECT count(*)::int n FROM business_allocation WHERE business_adjustment_id=$1 AND status='ACTIVE'",[credit.business_adjustment_id])).rows[0].n,2);
  assert.equal((await adminPool.query('SELECT status FROM journal_entry WHERE journal_entry_id=$1',[credit.journal_entry_id])).rows[0].status,'POSTED');
  assert.equal((await adminPool.query('SELECT count(*)::int n FROM ledger_line WHERE journal_entry_id=$1',[credit.journal_entry_id])).rows[0].n,2);
});

pgTest('authenticated HTTP posts an AR credit memo, applies it and refunds only remaining posted credit',async()=>{
  const ids=await seed({status:'APPROVED',extraAccounts:[{accountCode:'410000',accountName:'Sales returns'}]}),invoiceId=randomUUID();
  await adminPool.query("INSERT INTO member_master(tenant_id,entity_id,member_ref,member_type,display_name) VALUES($1,$2,'CUSTOMER-1','CUSTOMER','Customer')",[ids.tenantId,ids.entityId]);
  await adminPool.query("INSERT INTO account_master(tenant_id,entity_id,account_code,account_name,requires_member) VALUES($1,$2,'220000','Customer refunds',false)",[ids.tenantId,ids.entityId]);
  await adminPool.query(`INSERT INTO business_document(business_document_id,tenant_id,entity_id,document_kind,document_number,counterparty_ref,counterparty_name,currency,accounting_date,due_date,gross_amount,open_balance,status,created_by)
    VALUES($1,$2,$3,'AR_INVOICE','INV-HTTP-MEMO','CUSTOMER-1','Customer','USD','2026-07-15','2026-08-15',100,100,'OPEN','fixture')`,[invoiceId,ids.tenantId,ids.entityId]);
  const makerId=randomUUID(),reviewerId=randomUUID(),approverId=randomUUID(),posterId=randomUUID(),applierId=randomUUID(),refundMakerId=randomUUID();
  const permissions={
    [makerId]:['AR.CREDIT_MEMO.CREATE','GL.JE.SUBMIT'],[reviewerId]:['GL.JE.REVIEW'],[approverId]:['GL.JE.APPROVE'],[posterId]:['GL.JE.POST'],
    [applierId]:['AR.CREDIT_MEMO.APPLY'],[refundMakerId]:['AR.REFUND.CREATE','GL.JE.SUBMIT']
  };
  const api=createAccountingApi({
    authenticate:async({headers})=>({trusted:true,tenantId:ids.tenantId,actorId:headers['x-test-actor']}),
    kernelFactory:async principal=>new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,principal.actorId,permissions[principal.actorId]||[])})
  });
  const send=(actor,path,body,idempotencyKey,revision)=>api({method:'POST',url:path,body,headers:{'x-test-actor':actor,'idempotency-key':idempotencyKey,...(revision==null?{}:{'if-match':`"${revision}"`})}});
  const root=`/api/v1/entities/${ids.entityId}`;
  const memoResponse=await send(makerId,`${root}/ar/credit-memos`,{periodId:ids.periodId,memoNumber:'CM-HTTP-100',memoDate:'2026-07-16',customerRef:'CUSTOMER-1',customerName:'Customer',amount:100,lines:[{line_no:1,account_code:'410000',amount:100,description:'Customer credit'}],reason:'HTTP customer credit correction'},'http-memo-create');
  assert.equal(memoResponse.status,201);const memo=memoResponse.body.data;
  await attachAutoSource({...ids,journalId:memo.journal_entry_id});
  const advance=async(journalId,prefix)=>{
    const path=`${root}/journal-entries/${journalId}`;
    assert.equal((await send(prefix==='memo'?makerId:refundMakerId,`${path}/transitions/submit`,{},`${prefix}-submit`,0)).status,201);
    assert.equal((await send(reviewerId,`${path}/transitions/review`,{},`${prefix}-review`,1)).status,201);
    assert.equal((await send(approverId,`${path}/transitions/approve`,{},`${prefix}-approve`,2)).status,201);
    assert.equal((await send(posterId,`${path}/post`,{periodId:ids.periodId},`${prefix}-post`,3)).status,201);
  };
  await advance(memo.journal_entry_id,'memo');
  const applyBody={businessDocumentId:invoiceId,amount:40,reason:'Apply part of posted credit memo'};
  const applyPath=`${root}/ar/credit-memos/${memo.business_adjustment_id}/allocations`;
  assert.equal((await send(applierId,applyPath,applyBody,'http-memo-apply')).status,201);
  assert.equal((await send(applierId,applyPath,applyBody,'http-memo-apply')).status,200);
  const refundResponse=await send(refundMakerId,`${root}/ar/refunds`,{periodId:ids.periodId,sourceAdjustmentId:memo.business_adjustment_id,refundNumber:'RF-HTTP-60',refundDate:'2026-07-17',cashAccountCode:'220000',amount:60,reason:'Refund remaining posted customer credit'},'http-refund-create');
  assert.equal(refundResponse.status,201);const refund=refundResponse.body.data;
  await attachAutoSource({...ids,journalId:refund.journal_entry_id},{reuseApprovedSnapshots:true});
  await advance(refund.journal_entry_id,'refund');
  assert.deepEqual((await adminPool.query('SELECT open_balance,status FROM business_document WHERE business_document_id=$1',[invoiceId])).rows[0],{open_balance:'60.0000',status:'PARTIALLY_PAID'});
  assert.equal((await adminPool.query('SELECT status FROM business_adjustment WHERE business_adjustment_id=$1',[refund.business_adjustment_id])).rows[0].status,'POSTED');
  assert.equal((await adminPool.query('SELECT count(*)::int n FROM ledger_line WHERE journal_entry_id=$1',[refund.journal_entry_id])).rows[0].n,2);
  const over=await send(refundMakerId,`${root}/ar/refunds`,{periodId:ids.periodId,sourceAdjustmentId:memo.business_adjustment_id,refundNumber:'RF-HTTP-01',refundDate:'2026-07-18',cashAccountCode:'220000',amount:1,reason:'Over refund must fail atomically'},'http-refund-over');
  assert.equal(over.status,422);
  assert.equal((await adminPool.query("SELECT count(*)::int n FROM business_adjustment WHERE tenant_id=$1 AND entity_id=$2 AND adjustment_kind='AR_REFUND'",[ids.tenantId,ids.entityId])).rows[0].n,1);
  assert.equal((await adminPool.query("SELECT count(*)::int n FROM journal_entry WHERE tenant_id=$1 AND entity_id=$2 AND journal_number='RF-HTTP-01'",[ids.tenantId,ids.entityId])).rows[0].n,0);
  assert.equal((await adminPool.query("SELECT count(*)::int n FROM idempotency_receipt WHERE tenant_id=$1 AND operation_scope='AR_REFUND:'||$2::text AND idempotency_key='http-refund-over'",[ids.tenantId,ids.entityId])).rows[0].n,0);
});

pgTest('authenticated HTTP posts an AP payment and a cross-period Draft reversal without mutating the original ledger',async()=>{
  const ids=await seed({status:'APPROVED'}),billId=randomUUID(),reversalPeriodId=randomUUID();
  await adminPool.query(`INSERT INTO business_document(business_document_id,tenant_id,entity_id,document_kind,document_number,counterparty_ref,counterparty_name,currency,accounting_date,due_date,gross_amount,open_balance,status,created_by)
    VALUES($1,$2,$3,'AP_BILL','BILL-HTTP-PAYMENT','VENDOR-1','Vendor','USD','2026-07-15','2026-08-15',100,100,'APPROVED','fixture')`,[billId,ids.tenantId,ids.entityId]);
  await adminPool.query("INSERT INTO accounting_period(period_id,tenant_id,entity_id,period_code,starts_on,ends_on,status) VALUES($1,$2,$3,'2026-08','2026-08-01','2026-08-31','OPEN')",[reversalPeriodId,ids.tenantId,ids.entityId]);
  const makerId=randomUUID(),reviewerId=randomUUID(),approverId=randomUUID(),posterId=randomUUID(),reversalMakerId=randomUUID();
  const permissions={
    [makerId]:['AP.PAYMENT.CREATE','GL.JE.SUBMIT'],[reviewerId]:['GL.JE.REVIEW'],[approverId]:['GL.JE.APPROVE'],[posterId]:['GL.JE.POST'],[reversalMakerId]:['AP.PAYMENT.REVERSE','GL.JE.SUBMIT']
  };
  const api=createAccountingApi({authenticate:async({headers})=>({trusted:true,tenantId:ids.tenantId,actorId:headers['x-test-actor']}),kernelFactory:async principal=>new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,principal.actorId,permissions[principal.actorId]||[])})});
  const send=(actor,path,body,idempotencyKey,revision)=>api({method:'POST',url:path,body,headers:{'x-test-actor':actor,'idempotency-key':idempotencyKey,...(revision==null?{}:{'if-match':`"${revision}"`})}});
  const root=`/api/v1/entities/${ids.entityId}`;
  const advance=async(journalId,prefix,periodId,submitter)=>{
    const path=`${root}/journal-entries/${journalId}`;
    assert.equal((await send(submitter,`${path}/transitions/submit`,{},`${prefix}-submit`,0)).status,201);
    assert.equal((await send(reviewerId,`${path}/transitions/review`,{},`${prefix}-review`,1)).status,201);
    assert.equal((await send(approverId,`${path}/transitions/approve`,{},`${prefix}-approve`,2)).status,201);
    assert.equal((await send(posterId,`${path}/post`,{periodId},`${prefix}-post`,3)).status,201);
  };
  const paymentResponse=await send(makerId,`${root}/ap/bills/${billId}/payments`,{periodId:ids.periodId,paymentNumber:'PAY-HTTP-40',paymentDate:'2026-07-16',cashAccountCode:'111000',bankMemberRef:'BANK-1',amount:40,reason:'HTTP partial AP payment'},'http-payment-create');
  assert.equal(paymentResponse.status,201);const payment=paymentResponse.body.data;
  await attachAutoSource({...ids,journalId:payment.journal_entry_id});
  await advance(payment.journal_entry_id,'payment',ids.periodId,makerId);
  assert.equal((await adminPool.query('SELECT open_balance FROM business_document WHERE business_document_id=$1',[billId])).rows[0].open_balance,'60.0000');
  const reversalResponse=await send(reversalMakerId,`${root}/ap/payments/${payment.payment_occurrence_id}/reversals`,{periodId:reversalPeriodId,journalNumber:'PAY-HTTP-40-REV',journalDate:'2026-08-02',reason:'Reverse duplicate AP payment'},'http-payment-reversal');
  assert.equal(reversalResponse.status,201);const reversal=reversalResponse.body.data;
  await attachAutoSource({...ids,journalId:reversal.journal_entry_id},{reuseApprovedSnapshots:true});
  await advance(reversal.journal_entry_id,'payment-reversal',reversalPeriodId,reversalMakerId);
  assert.equal((await adminPool.query('SELECT status FROM journal_entry WHERE journal_entry_id=$1',[payment.journal_entry_id])).rows[0].status,'POSTED');
  assert.equal((await adminPool.query('SELECT count(*)::int n FROM ledger_line WHERE journal_entry_id=$1',[payment.journal_entry_id])).rows[0].n,2);
  assert.deepEqual((await adminPool.query('SELECT open_balance,status FROM business_document WHERE business_document_id=$1',[billId])).rows[0],{open_balance:'100.0000',status:'APPROVED'});
  assert.equal((await adminPool.query('SELECT status FROM payment_occurrence WHERE payment_occurrence_id=$1',[payment.payment_occurrence_id])).rows[0].status,'REVERSED');
});

pgTest('authenticated HTTP posts an AR receipt and a cross-period Draft reversal without mutating the original ledger',async()=>{
  const ids=await seed({status:'APPROVED'}),invoiceId=randomUUID(),reversalPeriodId=randomUUID();
  await adminPool.query("INSERT INTO member_master(tenant_id,entity_id,member_ref,member_type,display_name) VALUES($1,$2,'CUSTOMER-1','CUSTOMER','Customer')",[ids.tenantId,ids.entityId]);
  await adminPool.query(`INSERT INTO business_document(business_document_id,tenant_id,entity_id,document_kind,document_number,counterparty_ref,counterparty_name,currency,accounting_date,due_date,gross_amount,open_balance,status,created_by)
    VALUES($1,$2,$3,'AR_INVOICE','INV-HTTP-RECEIPT','CUSTOMER-1','Customer','USD','2026-07-15','2026-08-15',100,100,'OPEN','fixture')`,[invoiceId,ids.tenantId,ids.entityId]);
  await adminPool.query("INSERT INTO accounting_period(period_id,tenant_id,entity_id,period_code,starts_on,ends_on,status) VALUES($1,$2,$3,'2026-08','2026-08-01','2026-08-31','OPEN')",[reversalPeriodId,ids.tenantId,ids.entityId]);
  const makerId=randomUUID(),reviewerId=randomUUID(),approverId=randomUUID(),posterId=randomUUID(),reversalMakerId=randomUUID();
  const permissions={
    [makerId]:['AR.RECEIPT.CREATE','GL.JE.SUBMIT'],[reviewerId]:['GL.JE.REVIEW'],[approverId]:['GL.JE.APPROVE'],[posterId]:['GL.JE.POST'],[reversalMakerId]:['AR.RECEIPT.REVERSE','GL.JE.SUBMIT']
  };
  const api=createAccountingApi({authenticate:async({headers})=>({trusted:true,tenantId:ids.tenantId,actorId:headers['x-test-actor']}),kernelFactory:async principal=>new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,principal.actorId,permissions[principal.actorId]||[])})});
  const send=(actor,path,body,idempotencyKey,revision)=>api({method:'POST',url:path,body,headers:{'x-test-actor':actor,'idempotency-key':idempotencyKey,...(revision==null?{}:{'if-match':`"${revision}"`})}});
  const root=`/api/v1/entities/${ids.entityId}`;
  const advance=async(journalId,prefix,periodId,submitter)=>{
    const path=`${root}/journal-entries/${journalId}`;
    assert.equal((await send(submitter,`${path}/transitions/submit`,{},`${prefix}-submit`,0)).status,201);
    assert.equal((await send(reviewerId,`${path}/transitions/review`,{},`${prefix}-review`,1)).status,201);
    assert.equal((await send(approverId,`${path}/transitions/approve`,{},`${prefix}-approve`,2)).status,201);
    assert.equal((await send(posterId,`${path}/post`,{periodId},`${prefix}-post`,3)).status,201);
  };
  const receiptResponse=await send(makerId,`${root}/ar/invoices/${invoiceId}/receipts`,{periodId:ids.periodId,receiptNumber:'REC-HTTP-40',receiptDate:'2026-07-16',cashAccountCode:'111000',bankMemberRef:'BANK-1',amount:40,reason:'HTTP partial customer receipt'},'http-receipt-create');
  assert.equal(receiptResponse.status,201);const receipt=receiptResponse.body.data;
  await attachAutoSource({...ids,journalId:receipt.journal_entry_id});
  await advance(receipt.journal_entry_id,'receipt',ids.periodId,makerId);
  assert.equal((await adminPool.query('SELECT open_balance FROM business_document WHERE business_document_id=$1',[invoiceId])).rows[0].open_balance,'60.0000');
  const reversalResponse=await send(reversalMakerId,`${root}/ar/receipts/${receipt.payment_occurrence_id}/reversals`,{periodId:reversalPeriodId,journalNumber:'REC-HTTP-40-REV',journalDate:'2026-08-02',reason:'Reverse duplicate AR receipt'},'http-receipt-reversal');
  assert.equal(reversalResponse.status,201);const reversal=reversalResponse.body.data;
  await attachAutoSource({...ids,journalId:reversal.journal_entry_id},{reuseApprovedSnapshots:true});
  await advance(reversal.journal_entry_id,'receipt-reversal',reversalPeriodId,reversalMakerId);
  assert.equal((await adminPool.query('SELECT status FROM journal_entry WHERE journal_entry_id=$1',[receipt.journal_entry_id])).rows[0].status,'POSTED');
  assert.equal((await adminPool.query('SELECT count(*)::int n FROM ledger_line WHERE journal_entry_id=$1',[receipt.journal_entry_id])).rows[0].n,2);
  assert.deepEqual((await adminPool.query('SELECT open_balance,status FROM business_document WHERE business_document_id=$1',[invoiceId])).rows[0],{open_balance:'100.0000',status:'OPEN'});
  assert.equal((await adminPool.query('SELECT status FROM payment_occurrence WHERE payment_occurrence_id=$1',[receipt.payment_occurrence_id])).rows[0].status,'REVERSED');
});

pgTest('runtime creates an evidence-backed Auto Draft and advances staging atomically through posting',async()=>{
  const ids=await seed({status:'DRAFT'});
  const trace=await attachAutoSource(ids,{linkJournal:false});
  const lines=[
    {line_no:1,account_code:'111000',debit_amount:100,credit_amount:0,member_ref:'BANK-1',description:'Bank fact',dimensions:{}},
    {line_no:2,account_code:'291001',debit_amount:0,credit_amount:100,member_ref:'VENDOR-1',description:'Payable match',dimensions:{}}
  ];
  const engine=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'auto-engine',['GL.JE.AUTO.CREATE','GL.JE.SUBMIT'])});
  const createArgs={tenantId:ids.tenantId,entityId:ids.entityId,stagingItemId:trace.stagingId,periodId:ids.periodId,
    expectedStagingVersion:0,journalNumber:'JE-AUTO-001',description:'Evidence-backed Auto JE',lines,idempotencyKey:'create-auto-0001'};
  const created=await engine.createAutoJournal(createArgs);const replay=await engine.createAutoJournal(createArgs);
  assert.equal(created.status,'DRAFT');assert.equal(created.staging_version,1);assert.equal(replay.idempotent,true);
  assert.equal(replay.journal_entry_id,created.journal_entry_id);
  await assert.rejects(engine.createAutoJournal({...createArgs,journalNumber:'JE-AUTO-002',idempotencyKey:'create-auto-0002'}),error=>error.code==='40001'||error.code==='23514');
  assert.deepEqual((await adminPool.query('SELECT status,version FROM staging_item WHERE staging_item_id=$1',[trace.stagingId])).rows[0],{status:'DRAFT_CREATED',version:'1'});
  await engine.transitionJournal({tenantId:ids.tenantId,entityId:ids.entityId,journalEntryId:created.journal_entry_id,action:'SUBMIT',expectedRevision:0,idempotencyKey:'submit-auto-0001'});
  const reviewer=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'auto-reviewer',['GL.JE.REVIEW'])});
  await reviewer.transitionJournal({tenantId:ids.tenantId,entityId:ids.entityId,journalEntryId:created.journal_entry_id,action:'REVIEW',expectedRevision:1,idempotencyKey:'review-auto-0001'});
  const approver=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'auto-approver',['GL.JE.APPROVE'])});
  await approver.transitionJournal({tenantId:ids.tenantId,entityId:ids.entityId,journalEntryId:created.journal_entry_id,action:'APPROVE',expectedRevision:2,idempotencyKey:'approve-auto-0001'});
  const beforePost=(await adminPool.query('SELECT status,version FROM staging_item WHERE staging_item_id=$1',[trace.stagingId])).rows[0];
  assert.deepEqual(beforePost,{status:'APPROVED',version:'4'});
  const poster=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'auto-poster',['GL.JE.POST'])});
  await poster.postJournal({...ids,journalEntryId:created.journal_entry_id,expectedRevision:3,idempotencyKey:'post-auto-0001'});
  assert.deepEqual((await adminPool.query('SELECT status,version FROM staging_item WHERE staging_item_id=$1',[trace.stagingId])).rows[0],{status:'POSTED',version:'5'});
  assert.equal((await adminPool.query('SELECT count(*)::int n FROM ledger_line WHERE journal_entry_id=$1',[created.journal_entry_id])).rows[0].n,2);
  assert.equal((await adminPool.query("SELECT count(*)::int n FROM source_link WHERE staging_item_id=$1 AND link_type='SOURCE_TO_JE'",[trace.stagingId])).rows[0].n,1);
  assert.equal((await adminPool.query("SELECT count(*)::int n FROM outbox_event WHERE aggregate_id=$1 AND event_type IN ('AUTO_JOURNAL_CREATED','JOURNAL_SUBMIT','JOURNAL_REVIEW','JOURNAL_APPROVE','JOURNAL_POSTED')",[created.journal_entry_id])).rows[0].n,5);
});

pgTest('runtime reversal creates an exact Draft inverse in a new OPEN period and preserves the closed original ledger',async()=>{
  const ids=await seed({status:'APPROVED'});
  const originalPoster=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'original-poster',['GL.JE.POST'])});
  await originalPoster.postJournal({...ids,journalEntryId:ids.journalId,expectedRevision:0,idempotencyKey:'post-original-reversal-test'});
  const closer=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'period-closer',['GL.PERIOD.CLOSE'])});
  await closer.closePeriod({...ids,expectedVersion:0,idempotencyKey:'close-original-period'});
  const augustPeriod=randomUUID();
  await adminPool.query("INSERT INTO accounting_period(period_id,tenant_id,entity_id,period_code,starts_on,ends_on,status) VALUES($1,$2,$3,'2026-08','2026-08-01','2026-08-31','OPEN')",[augustPeriod,ids.tenantId,ids.entityId]);
  const requester=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'reversal-requester',['GL.JE.REVERSE','GL.JE.SUBMIT'])});
  const reversalArgs={action:'REVERSAL',tenantId:ids.tenantId,entityId:ids.entityId,originalJournalEntryId:ids.journalId,periodId:augustPeriod,journalNumber:'JE-REV-001',journalDate:'2026-08-02',description:'Reverse July manual journal',reason:'Correct duplicate manual accrual',attachmentIds:[],idempotencyKey:'create-reversal-0001'};
  const reversal=await requester.createJournalAdjustment(reversalArgs);const replay=await requester.createJournalAdjustment(reversalArgs);
  assert.equal(reversal.status,'DRAFT');assert.equal(replay.idempotent,true);assert.equal(replay.journal_entry_id,reversal.journal_entry_id);
  await assert.rejects(requester.createJournalAdjustment({...reversalArgs,journalNumber:'JE-REV-002',idempotencyKey:'create-reversal-0002'}),error=>error.code==='23505');
  await requester.transitionJournal({tenantId:ids.tenantId,entityId:ids.entityId,journalEntryId:reversal.journal_entry_id,action:'SUBMIT',expectedRevision:0,idempotencyKey:'submit-reversal-0001'});
  const reviewer=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'reversal-reviewer',['GL.JE.REVIEW'])});
  await reviewer.transitionJournal({tenantId:ids.tenantId,entityId:ids.entityId,journalEntryId:reversal.journal_entry_id,action:'REVIEW',expectedRevision:1,idempotencyKey:'review-reversal-0001'});
  const approver=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'reversal-approver',['GL.JE.APPROVE'])});
  await approver.transitionJournal({tenantId:ids.tenantId,entityId:ids.entityId,journalEntryId:reversal.journal_entry_id,action:'APPROVE',expectedRevision:2,idempotencyKey:'approve-reversal-0001'});
  const poster=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'reversal-poster',['GL.JE.POST'])});
  await poster.postJournal({tenantId:ids.tenantId,entityId:ids.entityId,periodId:augustPeriod,journalEntryId:reversal.journal_entry_id,expectedRevision:3,idempotencyKey:'post-reversal-0001'});
  const original=(await adminPool.query('SELECT status,revision FROM journal_entry WHERE journal_entry_id=$1',[ids.journalId])).rows[0];
  assert.equal(original.status,'POSTED');assert.equal(original.revision,'1');
  assert.equal((await adminPool.query('SELECT count(*)::int n FROM ledger_line WHERE journal_entry_id=$1',[ids.journalId])).rows[0].n,2);
  const reversalLedger=(await adminPool.query('SELECT account_code,debit_amount,credit_amount FROM ledger_line WHERE journal_entry_id=$1 ORDER BY account_code',[reversal.journal_entry_id])).rows;
  assert.deepEqual(reversalLedger.map(row=>[row.account_code,Number(row.debit_amount),Number(row.credit_amount)]),[['111000',0,100],['291001',100,0]]);
});

pgTest('runtime reclass requires evidence, creates new balanced lines and leaves its Posted original immutable',async()=>{
  const ids=await seed({status:'APPROVED'});
  await adminPool.query("INSERT INTO member_master(tenant_id,entity_id,member_ref,member_type,display_name) VALUES($1,$2,'CUSTOMER-1','CUSTOMER','Customer')",[ids.tenantId,ids.entityId]);
  const originalPoster=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'reclass-original-poster',['GL.JE.POST'])});
  await originalPoster.postJournal({...ids,journalEntryId:ids.journalId,expectedRevision:0,idempotencyKey:'post-original-reclass-test'});
  const attachmentId=(await adminPool.query('SELECT attachment_id FROM source_link WHERE journal_entry_id=$1 AND attachment_id IS NOT NULL',[ids.journalId])).rows[0].attachment_id;
  const requester=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'reclass-requester',['GL.JE.RECLASS','GL.JE.SUBMIT'])});
  const args={action:'RECLASS',tenantId:ids.tenantId,entityId:ids.entityId,originalJournalEntryId:ids.journalId,periodId:ids.periodId,journalNumber:'JE-RCL-001',journalDate:'2026-07-20',description:'Move payable classification to receivable',reason:'Correct member and account classification',lines:[
    {line_no:1,account_code:'291001',debit_amount:100,credit_amount:0,member_ref:'VENDOR-1',description:'Clear AP class',dimensions:{}},
    {line_no:2,account_code:'120200',debit_amount:0,credit_amount:100,member_ref:'CUSTOMER-1',description:'Move to AR class',dimensions:{}}
  ],attachmentIds:[],idempotencyKey:'create-reclass-missing-evidence'};
  await assert.rejects(requester.createJournalAdjustment(args),error=>error.code==='23503');
  assert.equal((await adminPool.query("SELECT count(*)::int n FROM journal_entry WHERE journal_type='RECLASS'")).rows[0].n,0);
  const reclass=await requester.createJournalAdjustment({...args,attachmentIds:[attachmentId],idempotencyKey:'create-reclass-0001'});
  await requester.transitionJournal({tenantId:ids.tenantId,entityId:ids.entityId,journalEntryId:reclass.journal_entry_id,action:'SUBMIT',expectedRevision:0,idempotencyKey:'submit-reclass-0001'});
  const reviewer=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'reclass-reviewer',['GL.JE.REVIEW'])});
  await reviewer.transitionJournal({tenantId:ids.tenantId,entityId:ids.entityId,journalEntryId:reclass.journal_entry_id,action:'REVIEW',expectedRevision:1,idempotencyKey:'review-reclass-0001'});
  const approver=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'reclass-approver',['GL.JE.APPROVE'])});
  await approver.transitionJournal({tenantId:ids.tenantId,entityId:ids.entityId,journalEntryId:reclass.journal_entry_id,action:'APPROVE',expectedRevision:2,idempotencyKey:'approve-reclass-0001'});
  const poster=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'reclass-poster',['GL.JE.POST'])});
  await poster.postJournal({...ids,journalEntryId:reclass.journal_entry_id,expectedRevision:3,idempotencyKey:'post-reclass-0001'});
  assert.equal((await adminPool.query('SELECT status FROM journal_entry WHERE journal_entry_id=$1',[ids.journalId])).rows[0].status,'POSTED');
  assert.equal((await adminPool.query('SELECT count(*)::int n FROM ledger_line WHERE journal_entry_id=$1',[ids.journalId])).rows[0].n,2);
  assert.equal((await adminPool.query('SELECT count(*)::int n FROM ledger_line WHERE journal_entry_id=$1',[reclass.journal_entry_id])).rows[0].n,2);
});

pgTest('posting is atomic, same-hash retry replays before state validation, different hash conflicts',async()=>{
  const ids=await seed();
  const kernel=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids)});
  const args={...ids,journalEntryId:ids.journalId,expectedRevision:0,idempotencyKey:'post-key-0001',requestHash:hash('post')};
  const first=await kernel.postJournal(args);
  const replay=await kernel.postJournal(args);
  assert.equal(first.idempotent,false);assert.equal(replay.idempotent,true);assert.equal(replay.posting_batch_id,first.posting_batch_id);assert.equal(first.revision,1);assert.equal(replay.revision,1);
  await assert.rejects(kernel.postJournal({...args,expectedRevision:1,requestHash:hash('caller-is-ignored')}),error=>error.code==='23505');
  assert.equal((await adminPool.query('SELECT count(*)::int AS n FROM ledger_line')).rows[0].n,2);
  assert.equal((await adminPool.query("SELECT count(*)::int AS n FROM source_link WHERE link_type='JE_LINE_TO_LEDGER'")).rows[0].n,2);
  assert.equal((await adminPool.query("SELECT count(*)::int AS n FROM audit_event WHERE event_type='JOURNAL_POSTED'")).rows[0].n,1);
  assert.equal((await adminPool.query("SELECT count(*)::int AS n FROM outbox_event WHERE event_type='JOURNAL_POSTED'")).rows[0].n,1);
  const audit=(await adminPool.query("SELECT after_hash,metadata FROM audit_event WHERE event_type='JOURNAL_POSTED' AND object_id=$1",[ids.journalId])).rows[0];
  const state=(await adminPool.query('SELECT refs_jsonb_hash(to_jsonb(journal_entry)) AS state_hash FROM journal_entry WHERE journal_entry_id=$1',[ids.journalId])).rows[0].state_hash;
  assert.equal(audit.after_hash,state);assert.match(audit.metadata.request_hash,/^sha256:[0-9a-f]{64}$/);assert.notEqual(audit.after_hash,audit.metadata.request_hash);
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

/* AP payment reversal integration is reserved for the AP/AR owner suite. */
pgTest('AP payment partial occurrence posts and reversal restores bill balance atomically',async()=>{
  const ids=await seed({status:'APPROVED'});const billId=randomUUID();
  await adminPool.query(`INSERT INTO business_document(business_document_id,tenant_id,entity_id,document_kind,document_number,counterparty_ref,counterparty_name,currency,accounting_date,due_date,gross_amount,open_balance,status,created_by) VALUES($1,$2,$3,'AP_BILL','BILL-PARTIAL-1','VENDOR-1','Vendor','USD','2026-07-15','2026-08-15',100,100,'APPROVED','fixture')`,[billId,ids.tenantId,ids.entityId]);
  const maker=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'payment-maker',['AP.PAYMENT.CREATE','GL.JE.SUBMIT'])});
  const payment=await maker.createApPayment({...ids,businessDocumentId:billId,paymentNumber:'PAY-400',paymentDate:'2026-07-16',cashAccountCode:'111000',bankMemberRef:'BANK-1',amount:40,reason:'Partial payment',idempotencyKey:'payment-partial-400'});
  await attachAutoSource({...ids,journalId:payment.journal_entry_id});
  const reviewer=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'payment-reviewer',['GL.JE.REVIEW'])});
  const approver=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'payment-approver',['GL.JE.APPROVE'])});
  await maker.transitionJournal({...ids,journalEntryId:payment.journal_entry_id,action:'SUBMIT',expectedRevision:0,idempotencyKey:'payment-submit-400'});
  await reviewer.transitionJournal({...ids,journalEntryId:payment.journal_entry_id,action:'REVIEW',expectedRevision:1,idempotencyKey:'payment-review-400'});
  await approver.transitionJournal({...ids,journalEntryId:payment.journal_entry_id,action:'APPROVE',expectedRevision:2,idempotencyKey:'payment-approve-400'});
  const poster=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'payment-poster',['GL.JE.POST'])});
  await poster.postJournal({...ids,journalEntryId:payment.journal_entry_id,periodId:ids.periodId,expectedRevision:3,idempotencyKey:'payment-post-400'});
  assert.equal((await adminPool.query('SELECT open_balance FROM business_document WHERE business_document_id=$1',[billId])).rows[0].open_balance,'60.0000');
  const closer=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'payment-period-closer',['GL.PERIOD.CLOSE'])});
  await closer.closePeriod({...ids,expectedVersion:0,idempotencyKey:'close-payment-period'});
  const augustPeriod=randomUUID();await adminPool.query("INSERT INTO accounting_period(period_id,tenant_id,entity_id,period_code,starts_on,ends_on,status) VALUES($1,$2,$3,'2026-08','2026-08-01','2026-08-31','OPEN')",[augustPeriod,ids.tenantId,ids.entityId]);
  const reversalMaker=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'payment-reversal-maker',['AP.PAYMENT.REVERSE','GL.JE.SUBMIT'])});
  const reversal=await reversalMaker.createApPaymentReversal({...ids,sourceOccurrenceId:payment.payment_occurrence_id,periodId:augustPeriod,journalNumber:'PAY-400-REV',journalDate:'2026-08-02',reason:'Reverse duplicate payment',idempotencyKey:'payment-reversal-400'});
  await reversalMaker.transitionJournal({...ids,journalEntryId:reversal.journal_entry_id,action:'SUBMIT',expectedRevision:0,idempotencyKey:'payment-reversal-submit'});
  await reviewer.transitionJournal({...ids,journalEntryId:reversal.journal_entry_id,action:'REVIEW',expectedRevision:1,idempotencyKey:'payment-reversal-review'});
  await approver.transitionJournal({...ids,journalEntryId:reversal.journal_entry_id,action:'APPROVE',expectedRevision:2,idempotencyKey:'payment-reversal-approve'});
  await poster.postJournal({...ids,journalEntryId:reversal.journal_entry_id,periodId:augustPeriod,expectedRevision:3,idempotencyKey:'payment-reversal-post'});
  assert.equal((await adminPool.query('SELECT open_balance FROM business_document WHERE business_document_id=$1',[billId])).rows[0].open_balance,'100.0000');
  assert.equal((await adminPool.query('SELECT status FROM payment_occurrence WHERE payment_occurrence_id=$1',[payment.payment_occurrence_id])).rows[0].status,'REVERSED');
  assert.equal((await adminPool.query("SELECT status FROM business_allocation WHERE payment_occurrence_id=$1",[payment.payment_occurrence_id])).rows[0].status,'REVERSED');
});

pgTest('AP multiple payment occurrences reverse independently without touching the other Posted occurrence',async()=>{
  const ids=await seed({status:'APPROVED'});const billId=randomUUID();
  await adminPool.query(`INSERT INTO business_document(business_document_id,tenant_id,entity_id,document_kind,document_number,counterparty_ref,counterparty_name,currency,accounting_date,due_date,gross_amount,open_balance,status,created_by) VALUES($1,$2,$3,'AP_BILL','BILL-MULTI-1','VENDOR-1','Vendor','USD','2026-07-15','2026-08-15',100,100,'APPROVED','fixture')`,[billId,ids.tenantId,ids.entityId]);
  const augustPeriod=randomUUID();await adminPool.query("INSERT INTO accounting_period(period_id,tenant_id,entity_id,period_code,starts_on,ends_on,status) VALUES($1,$2,$3,'2026-08','2026-08-01','2026-08-31','OPEN')",[augustPeriod,ids.tenantId,ids.entityId]);
  const maker=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'multi-payment-maker',['AP.PAYMENT.CREATE','GL.JE.SUBMIT'])});
  const reviewer=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'multi-payment-reviewer',['GL.JE.REVIEW'])});
  const approver=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'multi-payment-approver',['GL.JE.APPROVE'])});
  const poster=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'multi-payment-poster',['GL.JE.POST'])});
  const postPayment=async(number,amount,suffix)=>{
    const p=await maker.createApPayment({...ids,businessDocumentId:billId,paymentNumber:number,paymentDate:'2026-07-16',cashAccountCode:'111000',bankMemberRef:'BANK-1',amount,reason:'Split payment',idempotencyKey:`multi-payment-${suffix}`});
    await attachAutoSource({...ids,journalId:p.journal_entry_id},{reuseApprovedSnapshots:true});
    await maker.transitionJournal({...ids,journalEntryId:p.journal_entry_id,action:'SUBMIT',expectedRevision:0,idempotencyKey:`multi-submit-${suffix}`});
    await reviewer.transitionJournal({...ids,journalEntryId:p.journal_entry_id,action:'REVIEW',expectedRevision:1,idempotencyKey:`multi-review-${suffix}`});
    await approver.transitionJournal({...ids,journalEntryId:p.journal_entry_id,action:'APPROVE',expectedRevision:2,idempotencyKey:`multi-approve-${suffix}`});
    await poster.postJournal({...ids,journalEntryId:p.journal_entry_id,periodId:ids.periodId,expectedRevision:3,idempotencyKey:`multi-post-${suffix}`});
    return p;
  };
  const first=await postPayment('PAY-200',20,'200');const second=await postPayment('PAY-300',30,'300');
  assert.equal((await adminPool.query('SELECT open_balance,status FROM business_document WHERE business_document_id=$1',[billId])).rows[0].open_balance,'50.0000');
  const reversalMaker=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'multi-payment-reversal',['AP.PAYMENT.REVERSE','GL.JE.SUBMIT'])});
  const reversal=await reversalMaker.createApPaymentReversal({...ids,sourceOccurrenceId:first.payment_occurrence_id,periodId:augustPeriod,journalNumber:'PAY-200-REV',journalDate:'2026-08-02',reason:'Reverse first payment',idempotencyKey:'multi-payment-reversal-200'});
  await reversalMaker.transitionJournal({...ids,journalEntryId:reversal.journal_entry_id,action:'SUBMIT',expectedRevision:0,idempotencyKey:'multi-reversal-submit'});
  await reviewer.transitionJournal({...ids,journalEntryId:reversal.journal_entry_id,action:'REVIEW',expectedRevision:1,idempotencyKey:'multi-reversal-review'});
  await approver.transitionJournal({...ids,journalEntryId:reversal.journal_entry_id,action:'APPROVE',expectedRevision:2,idempotencyKey:'multi-reversal-approve'});
  await poster.postJournal({...ids,journalEntryId:reversal.journal_entry_id,periodId:augustPeriod,expectedRevision:3,idempotencyKey:'multi-reversal-post'});
  const occurrences=(await adminPool.query('SELECT payment_occurrence_id,status,amount FROM payment_occurrence WHERE business_document_id=$1 ORDER BY amount',[billId])).rows;
  assert.deepEqual(occurrences.map(row=>[row.payment_occurrence_id,row.status,Number(row.amount)]),[[first.payment_occurrence_id,'REVERSED',20],[second.payment_occurrence_id,'POSTED',30]]);
  assert.equal((await adminPool.query('SELECT open_balance,status FROM business_document WHERE business_document_id=$1',[billId])).rows[0].open_balance,'70.0000');
  const original=(await adminPool.query('SELECT status FROM journal_entry WHERE journal_entry_id=$1',[first.journal_entry_id])).rows[0];
  assert.equal(original.status,'POSTED');
});

pgTest('AR multiple receipt occurrences reverse independently without touching the other Posted receipt',async()=>{
  const ids=await seed({status:'APPROVED'});const invoiceId=randomUUID();
  await adminPool.query("INSERT INTO member_master(tenant_id,entity_id,member_ref,member_type,display_name) VALUES($1,$2,'CUSTOMER-1','CUSTOMER','Customer')",[ids.tenantId,ids.entityId]);
  await adminPool.query(`INSERT INTO business_document(business_document_id,tenant_id,entity_id,document_kind,document_number,counterparty_ref,counterparty_name,currency,accounting_date,due_date,gross_amount,open_balance,status,created_by) VALUES($1,$2,$3,'AR_INVOICE','INV-MULTI-1','CUSTOMER-1','Customer','USD','2026-07-15','2026-08-15',100,100,'OPEN','fixture')`,[invoiceId,ids.tenantId,ids.entityId]);
  const augustPeriod=randomUUID();await adminPool.query("INSERT INTO accounting_period(period_id,tenant_id,entity_id,period_code,starts_on,ends_on,status) VALUES($1,$2,$3,'2026-08','2026-08-01','2026-08-31','OPEN')",[augustPeriod,ids.tenantId,ids.entityId]);
  const maker=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'multi-receipt-maker',['AR.RECEIPT.CREATE','GL.JE.SUBMIT'])});
  const reviewer=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'multi-receipt-reviewer',['GL.JE.REVIEW'])});
  const approver=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'multi-receipt-approver',['GL.JE.APPROVE'])});
  const poster=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'multi-receipt-poster',['GL.JE.POST'])});
  const postReceipt=async(number,amount,suffix)=>{
    const p=await maker.createArReceipt({...ids,businessDocumentId:invoiceId,receiptNumber:number,receiptDate:'2026-07-16',cashAccountCode:'111000',bankMemberRef:'BANK-1',amount,reason:'Split receipt',idempotencyKey:`multi-receipt-${suffix}`});
    await attachAutoSource({...ids,journalId:p.journal_entry_id},{reuseApprovedSnapshots:true});
    await maker.transitionJournal({...ids,journalEntryId:p.journal_entry_id,action:'SUBMIT',expectedRevision:0,idempotencyKey:`multi-receipt-submit-${suffix}`});
    await reviewer.transitionJournal({...ids,journalEntryId:p.journal_entry_id,action:'REVIEW',expectedRevision:1,idempotencyKey:`multi-receipt-review-${suffix}`});
    await approver.transitionJournal({...ids,journalEntryId:p.journal_entry_id,action:'APPROVE',expectedRevision:2,idempotencyKey:`multi-receipt-approve-${suffix}`});
    await poster.postJournal({...ids,journalEntryId:p.journal_entry_id,periodId:ids.periodId,expectedRevision:3,idempotencyKey:`multi-receipt-post-${suffix}`});
    return p;
  };
  const first=await postReceipt('REC-400',40,'400');const second=await postReceipt('REC-600',60,'600');
  assert.equal((await adminPool.query('SELECT open_balance FROM business_document WHERE business_document_id=$1',[invoiceId])).rows[0].open_balance,'0.0000');
  const reversalMaker=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'multi-receipt-reversal',['AR.RECEIPT.REVERSE','GL.JE.SUBMIT'])});
  const reversal=await reversalMaker.createArReceiptReversal({...ids,sourceOccurrenceId:first.payment_occurrence_id,periodId:augustPeriod,journalNumber:'REC-400-REV',journalDate:'2026-08-02',reason:'Reverse first receipt',idempotencyKey:'multi-receipt-reversal-400'});
  await reversalMaker.transitionJournal({...ids,journalEntryId:reversal.journal_entry_id,action:'SUBMIT',expectedRevision:0,idempotencyKey:'multi-receipt-reversal-submit'});
  await reviewer.transitionJournal({...ids,journalEntryId:reversal.journal_entry_id,action:'REVIEW',expectedRevision:1,idempotencyKey:'multi-receipt-reversal-review'});
  await approver.transitionJournal({...ids,journalEntryId:reversal.journal_entry_id,action:'APPROVE',expectedRevision:2,idempotencyKey:'multi-receipt-reversal-approve'});
  await poster.postJournal({...ids,journalEntryId:reversal.journal_entry_id,periodId:augustPeriod,expectedRevision:3,idempotencyKey:'multi-receipt-reversal-post'});
  const occurrences=(await adminPool.query('SELECT payment_occurrence_id,status,amount FROM payment_occurrence WHERE business_document_id=$1 ORDER BY amount',[invoiceId])).rows;
  assert.deepEqual(occurrences.map(row=>[row.payment_occurrence_id,row.status,Number(row.amount)]),[[first.payment_occurrence_id,'REVERSED',40],[second.payment_occurrence_id,'POSTED',60]]);
  assert.equal((await adminPool.query('SELECT open_balance FROM business_document WHERE business_document_id=$1',[invoiceId])).rows[0].open_balance,'40.0000');
});

pgTest('AR receipt and reversal keep aging and the 120200 control balance in lockstep',async()=>{
  const ids=await seed({status:'APPROVED',journalType:'AUTO',attachmentStatus:null,
    extraAccounts:[{accountCode:'400000',accountName:'Revenue'}],
    extraMembers:[{memberRef:'CUSTOMER-1',memberType:'CUSTOMER',displayName:'Customer'}],
    journalLines:[{lineNo:1,accountCode:'120200',debit:100,credit:0,memberRef:'CUSTOMER-1'},{lineNo:2,accountCode:'400000',debit:0,credit:100}]});
  const source=await attachAutoSource(ids);
  const sourcePoster=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'ar-invoice-source-poster',['GL.JE.POST'])});
  await sourcePoster.postJournal({...ids,journalEntryId:ids.journalId,expectedRevision:0,idempotencyKey:'ar-invoice-source-post'});
  const invoiceId=randomUUID();
  await adminPool.query(`INSERT INTO business_document(business_document_id,tenant_id,entity_id,source_document_id,document_kind,document_number,counterparty_ref,counterparty_name,currency,accounting_date,due_date,gross_amount,open_balance,status,posted_journal_entry_id,created_by)
    VALUES($1,$2,$3,$4,'AR_INVOICE','INV-AGING-1','CUSTOMER-1','Customer','USD','2026-07-15','2026-07-15',100,100,'OPEN',$5,'fixture')`,[invoiceId,ids.tenantId,ids.entityId,source.documentId,ids.journalId]);
  const maker=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'aging-receipt-maker',['AR.RECEIPT.CREATE','GL.JE.SUBMIT'])});
  const reviewer=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'aging-receipt-reviewer',['GL.JE.REVIEW'])});
  const approver=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'aging-receipt-approver',['GL.JE.APPROVE'])});
  const poster=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'aging-receipt-poster',['GL.JE.POST'])});
  const receipt=await maker.createArReceipt({...ids,businessDocumentId:invoiceId,receiptNumber:'REC-AGING-40',receiptDate:'2026-07-16',cashAccountCode:'111000',bankMemberRef:'BANK-1',amount:40,reason:'Partial receipt',idempotencyKey:'aging-receipt-create'});
  await attachAutoSource({...ids,journalId:receipt.journal_entry_id},{reuseApprovedSnapshots:true});
  await maker.transitionJournal({...ids,journalEntryId:receipt.journal_entry_id,action:'SUBMIT',expectedRevision:0,idempotencyKey:'aging-receipt-submit'});
  await reviewer.transitionJournal({...ids,journalEntryId:receipt.journal_entry_id,action:'REVIEW',expectedRevision:1,idempotencyKey:'aging-receipt-review'});
  await approver.transitionJournal({...ids,journalEntryId:receipt.journal_entry_id,action:'APPROVE',expectedRevision:2,idempotencyKey:'aging-receipt-approve'});
  await poster.postJournal({...ids,journalEntryId:receipt.journal_entry_id,periodId:ids.periodId,expectedRevision:3,idempotencyKey:'aging-receipt-post'});
  const reader=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'aging-reader',['AR.VIEW'])});
  await assert.rejects(reader.getApControlTotal({tenantId:ids.tenantId,entityId:ids.entityId}),error=>error.code==='42501');
  assert.deepEqual(await reader.getArAging({tenantId:ids.tenantId,entityId:ids.entityId,asOfDate:'2026-08-31'}),[{currency:'USD',current_amount:'0.0000',days_1_30:'0.0000',days_31_60:'60.0000',days_61_90:'0.0000',days_91_plus:'0.0000',total_open_balance:'60.0000'}]);
  assert.deepEqual(await reader.getArControlTotal({tenantId:ids.tenantId,entityId:ids.entityId}),[{currency:'USD',open_balance:'60.0000',control_balance:'60.0000',in_balance:true}]);
  const closer=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'aging-period-closer',['GL.PERIOD.CLOSE'])});
  await closer.closePeriod({...ids,expectedVersion:0,idempotencyKey:'aging-period-close'});
  const augustPeriod=randomUUID();await adminPool.query("INSERT INTO accounting_period(period_id,tenant_id,entity_id,period_code,starts_on,ends_on,status) VALUES($1,$2,$3,'2026-08','2026-08-01','2026-08-31','OPEN')",[augustPeriod,ids.tenantId,ids.entityId]);
  const reversalMaker=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'aging-receipt-reversal-maker',['AR.RECEIPT.REVERSE','GL.JE.SUBMIT'])});
  const reversal=await reversalMaker.createArReceiptReversal({...ids,sourceOccurrenceId:receipt.payment_occurrence_id,periodId:augustPeriod,journalNumber:'REC-AGING-40-REV',journalDate:'2026-08-02',reason:'Receipt reversal',idempotencyKey:'aging-receipt-reversal-create'});
  await reversalMaker.transitionJournal({...ids,journalEntryId:reversal.journal_entry_id,action:'SUBMIT',expectedRevision:0,idempotencyKey:'aging-receipt-reversal-submit'});
  await reviewer.transitionJournal({...ids,journalEntryId:reversal.journal_entry_id,action:'REVIEW',expectedRevision:1,idempotencyKey:'aging-receipt-reversal-review'});
  await approver.transitionJournal({...ids,journalEntryId:reversal.journal_entry_id,action:'APPROVE',expectedRevision:2,idempotencyKey:'aging-receipt-reversal-approve'});
  await poster.postJournal({...ids,journalEntryId:reversal.journal_entry_id,periodId:augustPeriod,expectedRevision:3,idempotencyKey:'aging-receipt-reversal-post'});
  assert.deepEqual(await reader.getArAging({tenantId:ids.tenantId,entityId:ids.entityId,asOfDate:'2026-08-31'}),[{currency:'USD',current_amount:'0.0000',days_1_30:'0.0000',days_31_60:'100.0000',days_61_90:'0.0000',days_91_plus:'0.0000',total_open_balance:'100.0000'}]);
  assert.deepEqual(await reader.getArControlTotal({tenantId:ids.tenantId,entityId:ids.entityId}),[{currency:'USD',open_balance:'100.0000',control_balance:'100.0000',in_balance:true}]);
});

pgTest('AP payment and reversal keep aging and the 291001 control balance in lockstep',async()=>{
  const ids=await seed({status:'APPROVED',journalType:'AUTO',attachmentStatus:null,
    extraAccounts:[{accountCode:'610000',accountName:'Expense'}],
    journalLines:[{lineNo:1,accountCode:'610000',debit:100,credit:0},{lineNo:2,accountCode:'291001',debit:0,credit:100,memberRef:'VENDOR-1'}]});
  const source=await attachAutoSource(ids);
  const sourcePoster=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'ap-bill-source-poster',['GL.JE.POST'])});
  await sourcePoster.postJournal({...ids,journalEntryId:ids.journalId,expectedRevision:0,idempotencyKey:'ap-bill-source-post'});
  const billId=randomUUID();
  await adminPool.query(`INSERT INTO business_document(business_document_id,tenant_id,entity_id,source_document_id,document_kind,document_number,counterparty_ref,counterparty_name,currency,accounting_date,due_date,gross_amount,open_balance,status,posted_journal_entry_id,created_by)
    VALUES($1,$2,$3,$4,'AP_BILL','BILL-AGING-1','VENDOR-1','Vendor','USD','2026-07-15','2026-07-15',100,100,'OPEN',$5,'fixture')`,[billId,ids.tenantId,ids.entityId,source.documentId,ids.journalId]);
  const maker=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'aging-payment-maker',['AP.PAYMENT.CREATE','GL.JE.SUBMIT'])});
  const reviewer=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'aging-payment-reviewer',['GL.JE.REVIEW'])});
  const approver=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'aging-payment-approver',['GL.JE.APPROVE'])});
  const poster=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'aging-payment-poster',['GL.JE.POST'])});
  const payment=await maker.createApPayment({...ids,businessDocumentId:billId,paymentNumber:'PAY-AGING-40',paymentDate:'2026-07-16',cashAccountCode:'111000',bankMemberRef:'BANK-1',amount:40,reason:'Partial payment',idempotencyKey:'aging-payment-create'});
  await attachAutoSource({...ids,journalId:payment.journal_entry_id},{reuseApprovedSnapshots:true});
  await maker.transitionJournal({...ids,journalEntryId:payment.journal_entry_id,action:'SUBMIT',expectedRevision:0,idempotencyKey:'aging-payment-submit'});
  await reviewer.transitionJournal({...ids,journalEntryId:payment.journal_entry_id,action:'REVIEW',expectedRevision:1,idempotencyKey:'aging-payment-review'});
  await approver.transitionJournal({...ids,journalEntryId:payment.journal_entry_id,action:'APPROVE',expectedRevision:2,idempotencyKey:'aging-payment-approve'});
  await poster.postJournal({...ids,journalEntryId:payment.journal_entry_id,periodId:ids.periodId,expectedRevision:3,idempotencyKey:'aging-payment-post'});
  const reader=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'ap-aging-reader',['AP.VIEW'])});
  await assert.rejects(reader.getArControlTotal({tenantId:ids.tenantId,entityId:ids.entityId}),error=>error.code==='42501');
  assert.deepEqual(await reader.getApAging({tenantId:ids.tenantId,entityId:ids.entityId,asOfDate:'2026-08-31'}),[{currency:'USD',current_amount:'0.0000',days_1_30:'0.0000',days_31_60:'60.0000',days_61_90:'0.0000',days_91_plus:'0.0000',total_open_balance:'60.0000'}]);
  assert.deepEqual(await reader.getApControlTotal({tenantId:ids.tenantId,entityId:ids.entityId}),[{currency:'USD',open_balance:'60.0000',control_balance:'60.0000',in_balance:true}]);
  const closer=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'ap-aging-period-closer',['GL.PERIOD.CLOSE'])});
  await closer.closePeriod({...ids,expectedVersion:0,idempotencyKey:'ap-aging-period-close'});
  const augustPeriod=randomUUID();await adminPool.query("INSERT INTO accounting_period(period_id,tenant_id,entity_id,period_code,starts_on,ends_on,status) VALUES($1,$2,$3,'2026-08','2026-08-01','2026-08-31','OPEN')",[augustPeriod,ids.tenantId,ids.entityId]);
  const reversalMaker=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'aging-payment-reversal-maker',['AP.PAYMENT.REVERSE','GL.JE.SUBMIT'])});
  const reversal=await reversalMaker.createApPaymentReversal({...ids,sourceOccurrenceId:payment.payment_occurrence_id,periodId:augustPeriod,journalNumber:'PAY-AGING-40-REV',journalDate:'2026-08-02',reason:'Payment reversal',idempotencyKey:'aging-payment-reversal-create'});
  await reversalMaker.transitionJournal({...ids,journalEntryId:reversal.journal_entry_id,action:'SUBMIT',expectedRevision:0,idempotencyKey:'aging-payment-reversal-submit'});
  await reviewer.transitionJournal({...ids,journalEntryId:reversal.journal_entry_id,action:'REVIEW',expectedRevision:1,idempotencyKey:'aging-payment-reversal-review'});
  await approver.transitionJournal({...ids,journalEntryId:reversal.journal_entry_id,action:'APPROVE',expectedRevision:2,idempotencyKey:'aging-payment-reversal-approve'});
  await poster.postJournal({...ids,journalEntryId:reversal.journal_entry_id,periodId:augustPeriod,expectedRevision:3,idempotencyKey:'aging-payment-reversal-post'});
  assert.deepEqual(await reader.getApAging({tenantId:ids.tenantId,entityId:ids.entityId,asOfDate:'2026-08-31'}),[{currency:'USD',current_amount:'0.0000',days_1_30:'0.0000',days_31_60:'100.0000',days_61_90:'0.0000',days_91_plus:'0.0000',total_open_balance:'100.0000'}]);
  assert.deepEqual(await reader.getApControlTotal({tenantId:ids.tenantId,entityId:ids.entityId}),[{currency:'USD',open_balance:'100.0000',control_balance:'100.0000',in_balance:true}]);
});

pgTest('AP vendor credit posted first then partial and full apply updates bill atomically',async()=>{
  const ids=await seed({status:'APPROVED',journalType:'AUTO',attachmentStatus:null,
    extraAccounts:[{accountCode:'610000',accountName:'Expense'}],
    journalLines:[{lineNo:1,accountCode:'610000',debit:100,credit:0},{lineNo:2,accountCode:'291001',debit:0,credit:100,memberRef:'VENDOR-1'}]});const billId=randomUUID();
  const source=await attachAutoSource(ids);
  const sourcePoster=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'vendor-credit-bill-source-poster',['GL.JE.POST'])});
  await sourcePoster.postJournal({...ids,journalEntryId:ids.journalId,periodId:ids.periodId,expectedRevision:0,idempotencyKey:'vendor-credit-bill-source-post'});
  await adminPool.query(`INSERT INTO business_document(business_document_id,tenant_id,entity_id,source_document_id,document_kind,document_number,counterparty_ref,counterparty_name,currency,accounting_date,due_date,gross_amount,open_balance,status,posted_journal_entry_id,created_by) VALUES($1,$2,$3,$4,'AP_BILL','BILL-CREDIT-1','VENDOR-1','Vendor','USD','2026-07-15','2026-08-15',100,100,'OPEN',$5,'fixture')`,[billId,ids.tenantId,ids.entityId,source.documentId,ids.journalId]);
  const maker=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'credit-maker',['AP.VENDOR_CREDIT.CREATE','GL.JE.SUBMIT'])});
  await assert.rejects(maker.createApVendorCredit({...ids,creditNumber:'VC-CONTROL-BAD',creditDate:'2026-07-16',vendorRef:'VENDOR-1',vendorName:'Vendor',amount:100,lines:[{line_no:1,account_code:'291001',amount:100,member_ref:'VENDOR-1'}],reason:'Reject control-account counterpart',idempotencyKey:'vendor-credit-control-bad'}),error=>error.code==='23514');
  assert.equal((await adminPool.query("SELECT count(*)::int n FROM business_adjustment WHERE adjustment_kind='AP_VENDOR_CREDIT'",[])).rows[0].n,0);
  const credit=await maker.createApVendorCredit({...ids,creditNumber:'VC-100',creditDate:'2026-07-16',vendorRef:'VENDOR-1',vendorName:'Vendor',amount:100,lines:[{line_no:1,account_code:'610000',amount:100,description:'Credit'}],reason:'Vendor credit',idempotencyKey:'vendor-credit-100'});
  await attachAutoSource({...ids,journalId:credit.journal_entry_id},{reuseApprovedSnapshots:true});
  const reviewer=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'credit-reviewer',['GL.JE.REVIEW'])});
  const approver=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'credit-approver',['GL.JE.APPROVE'])});
  const poster=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'credit-poster',['GL.JE.POST'])});
  await maker.transitionJournal({...ids,journalEntryId:credit.journal_entry_id,action:'SUBMIT',expectedRevision:0,idempotencyKey:'vendor-credit-submit'});
  await reviewer.transitionJournal({...ids,journalEntryId:credit.journal_entry_id,action:'REVIEW',expectedRevision:1,idempotencyKey:'vendor-credit-review'});
  await approver.transitionJournal({...ids,journalEntryId:credit.journal_entry_id,action:'APPROVE',expectedRevision:2,idempotencyKey:'vendor-credit-approve'});
  await poster.postJournal({...ids,journalEntryId:credit.journal_entry_id,periodId:ids.periodId,expectedRevision:3,idempotencyKey:'vendor-credit-post'});
  assert.deepEqual((await adminPool.query('SELECT account_code,debit_amount,credit_amount,member_ref FROM journal_line WHERE journal_entry_id=$1 ORDER BY line_no',[credit.journal_entry_id])).rows,[{account_code:'291001',debit_amount:'100.0000',credit_amount:'0.0000',member_ref:'VENDOR-1'},{account_code:'610000',debit_amount:'0.0000',credit_amount:'100.0000',member_ref:null}]);
  const reader=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'vendor-credit-control-reader',['AP.VIEW'])});
  assert.deepEqual(await reader.getApControlTotal({tenantId:ids.tenantId,entityId:ids.entityId}),[{currency:'USD',open_balance:'0.0000',control_balance:'0.0000',in_balance:true}]);
  assert.deepEqual(await reader.getApAging({tenantId:ids.tenantId,entityId:ids.entityId,asOfDate:'2026-08-31'}),[{currency:'USD',current_amount:'0.0000',days_1_30:'100.0000',days_31_60:'-100.0000',days_61_90:'0.0000',days_91_plus:'0.0000',total_open_balance:'0.0000'}]);
  const applier=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,randomUUID(),['AP.VENDOR_CREDIT.APPLY'])});
  const first=await applier.applyApVendorCredit({...ids,businessAdjustmentId:credit.business_adjustment_id,businessDocumentId:billId,amount:40,reason:'Partial apply',idempotencyKey:'vendor-credit-apply-40'});
  assert.equal(first.status,'ACTIVE');
  assert.equal((await adminPool.query('SELECT status FROM business_allocation WHERE business_allocation_id=$1',[first.business_allocation_id])).rows[0].status,'ACTIVE');
  assert.equal((await adminPool.query('SELECT open_balance,status FROM business_document WHERE business_document_id=$1',[billId])).rows[0].open_balance,'60.0000');
  assert.deepEqual(await reader.getApControlTotal({tenantId:ids.tenantId,entityId:ids.entityId}),[{currency:'USD',open_balance:'0.0000',control_balance:'0.0000',in_balance:true}]);
  assert.deepEqual(await reader.getApAging({tenantId:ids.tenantId,entityId:ids.entityId,asOfDate:'2026-08-31'}),[{currency:'USD',current_amount:'0.0000',days_1_30:'60.0000',days_31_60:'-60.0000',days_61_90:'0.0000',days_91_plus:'0.0000',total_open_balance:'0.0000'}]);
  const replay=await applier.applyApVendorCredit({...ids,businessAdjustmentId:credit.business_adjustment_id,businessDocumentId:billId,amount:40,reason:'Partial apply',idempotencyKey:'vendor-credit-apply-40'});
  assert.equal(replay.idempotent,true);assert.equal(replay.status,'ACTIVE');
  const second=await applier.applyApVendorCredit({...ids,businessAdjustmentId:credit.business_adjustment_id,businessDocumentId:billId,amount:60,reason:'Full apply',idempotencyKey:'vendor-credit-apply-60'});
  assert.equal(second.status,'ACTIVE');
  assert.equal((await adminPool.query('SELECT status FROM business_allocation WHERE business_allocation_id=$1',[second.business_allocation_id])).rows[0].status,'ACTIVE');
  assert.deepEqual((await adminPool.query('SELECT open_balance,status FROM business_document WHERE business_document_id=$1',[billId])).rows[0],{open_balance:'0.0000',status:'PAID'});
  assert.equal((await adminPool.query("SELECT count(*)::int n FROM business_allocation WHERE business_adjustment_id=$1 AND status='ACTIVE'",[credit.business_adjustment_id])).rows[0].n,2);
  assert.deepEqual(await reader.getApControlTotal({tenantId:ids.tenantId,entityId:ids.entityId}),[{currency:'USD',open_balance:'0.0000',control_balance:'0.0000',in_balance:true}]);
  assert.deepEqual(await reader.getApAging({tenantId:ids.tenantId,entityId:ids.entityId,asOfDate:'2026-08-31'}),[{currency:'USD',current_amount:'0.0000',days_1_30:'0.0000',days_31_60:'0.0000',days_61_90:'0.0000',days_91_plus:'0.0000',total_open_balance:'0.0000'}]);
});

pgTest('AR credit memo posted first then partial and full apply updates invoice atomically',async()=>{
  const ids=await seed({status:'APPROVED',extraAccounts:[{accountCode:'410000',accountName:'Sales returns'}]});const invoiceId=randomUUID();
  await adminPool.query("INSERT INTO member_master(tenant_id,entity_id,member_ref,member_type,display_name) VALUES($1,$2,'CUSTOMER-1','CUSTOMER','Customer')",[ids.tenantId,ids.entityId]);
  await adminPool.query(`INSERT INTO business_document(business_document_id,tenant_id,entity_id,document_kind,document_number,counterparty_ref,counterparty_name,currency,accounting_date,due_date,gross_amount,open_balance,status,created_by) VALUES($1,$2,$3,'AR_INVOICE','INV-CREDIT-1','CUSTOMER-1','Customer','USD','2026-07-15','2026-08-15',100,100,'OPEN','fixture')`,[invoiceId,ids.tenantId,ids.entityId]);
  const maker=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'ar-credit-maker',['AR.CREDIT_MEMO.CREATE','GL.JE.SUBMIT'])});
  await assert.rejects(maker.createArCreditMemo({...ids,memoNumber:'CM-CONTROL-BAD',memoDate:'2026-07-16',customerRef:'CUSTOMER-1',customerName:'Customer',amount:100,lines:JSON.stringify([{line_no:1,account_code:'120200',amount:100,member_ref:'CUSTOMER-1'}]),reason:'Reject control-account counterpart',idempotencyKey:'ar-credit-control-bad'}),error=>error.code==='23514');
  assert.equal((await adminPool.query("SELECT count(*)::int n FROM business_adjustment WHERE adjustment_kind='AR_CREDIT_MEMO'",[])).rows[0].n,0);
  const memo=await maker.createArCreditMemo({...ids,memoNumber:'CM-100',memoDate:'2026-07-16',customerRef:'CUSTOMER-1',customerName:'Customer',amount:100,lines:JSON.stringify([{line_no:1,account_code:'410000',amount:100,description:'Memo'}]),reason:'Credit memo',idempotencyKey:'ar-credit-100'});
  await attachAutoSource({...ids,journalId:memo.journal_entry_id},{reuseApprovedSnapshots:true});
  const reviewer=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'ar-credit-reviewer',['GL.JE.REVIEW'])});
  const approver=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'ar-credit-approver',['GL.JE.APPROVE'])});
  const poster=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'ar-credit-poster',['GL.JE.POST'])});
  await maker.transitionJournal({...ids,journalEntryId:memo.journal_entry_id,action:'SUBMIT',expectedRevision:0,idempotencyKey:'ar-credit-submit'});
  await reviewer.transitionJournal({...ids,journalEntryId:memo.journal_entry_id,action:'REVIEW',expectedRevision:1,idempotencyKey:'ar-credit-review'});
  await approver.transitionJournal({...ids,journalEntryId:memo.journal_entry_id,action:'APPROVE',expectedRevision:2,idempotencyKey:'ar-credit-approve'});
  await poster.postJournal({...ids,journalEntryId:memo.journal_entry_id,periodId:ids.periodId,expectedRevision:3,idempotencyKey:'ar-credit-post'});
  const agingReader=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'ar-credit-aging-reader',['AR.VIEW'])});
  assert.deepEqual(await agingReader.getArAging({tenantId:ids.tenantId,entityId:ids.entityId,asOfDate:'2026-08-31'}),[{currency:'USD',current_amount:'0.0000',days_1_30:'100.0000',days_31_60:'-100.0000',days_61_90:'0.0000',days_91_plus:'0.0000',total_open_balance:'0.0000'}]);
  const applier=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,randomUUID(),['AR.CREDIT_MEMO.APPLY'])});
  const first=await applier.applyArCreditMemo({...ids,businessAdjustmentId:memo.business_adjustment_id,businessDocumentId:invoiceId,amount:40,reason:'Partial apply',idempotencyKey:'ar-credit-apply-40'});
  assert.equal(first.status,'ACTIVE');
  assert.equal((await adminPool.query('SELECT status FROM business_allocation WHERE business_allocation_id=$1',[first.business_allocation_id])).rows[0].status,'ACTIVE');
  assert.equal((await adminPool.query('SELECT open_balance,status FROM business_document WHERE business_document_id=$1',[invoiceId])).rows[0].open_balance,'60.0000');
  assert.deepEqual(await agingReader.getArAging({tenantId:ids.tenantId,entityId:ids.entityId,asOfDate:'2026-08-31'}),[{currency:'USD',current_amount:'0.0000',days_1_30:'60.0000',days_31_60:'-60.0000',days_61_90:'0.0000',days_91_plus:'0.0000',total_open_balance:'0.0000'}]);
  const second=await applier.applyArCreditMemo({...ids,businessAdjustmentId:memo.business_adjustment_id,businessDocumentId:invoiceId,amount:60,reason:'Full apply',idempotencyKey:'ar-credit-apply-60'});
  assert.equal(second.status,'ACTIVE');
  assert.equal((await adminPool.query('SELECT status FROM business_allocation WHERE business_allocation_id=$1',[second.business_allocation_id])).rows[0].status,'ACTIVE');
  assert.deepEqual((await adminPool.query('SELECT open_balance,status FROM business_document WHERE business_document_id=$1',[invoiceId])).rows[0],{open_balance:'0.0000',status:'PAID'});
  assert.deepEqual(await agingReader.getArAging({tenantId:ids.tenantId,entityId:ids.entityId,asOfDate:'2026-08-31'}),[{currency:'USD',current_amount:'0.0000',days_1_30:'0.0000',days_31_60:'0.0000',days_61_90:'0.0000',days_91_plus:'0.0000',total_open_balance:'0.0000'}]);
});

pgTest('AR refund posts against available posted credit and rejects over-refund atomically',async()=>{
  const ids=await seed({status:'APPROVED',journalType:'AUTO',attachmentStatus:null,
    extraAccounts:[{accountCode:'400000',accountName:'Revenue'},{accountCode:'410000',accountName:'Sales returns'}],
    extraMembers:[{memberRef:'CUSTOMER-1',memberType:'CUSTOMER',displayName:'Customer'}],
    journalLines:[{lineNo:1,accountCode:'120200',debit:100,credit:0,memberRef:'CUSTOMER-1'},{lineNo:2,accountCode:'400000',debit:0,credit:100}]});const invoiceId=randomUUID();
  const source=await attachAutoSource(ids);
  const sourcePoster=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'refund-invoice-source-poster',['GL.JE.POST'])});
  await sourcePoster.postJournal({...ids,journalEntryId:ids.journalId,periodId:ids.periodId,expectedRevision:0,idempotencyKey:'refund-invoice-source-post'});
  await adminPool.query("INSERT INTO account_master(tenant_id,entity_id,account_code,account_name,requires_member) VALUES($1,$2,'220000','Customer refunds',false)",[ids.tenantId,ids.entityId]);
  await adminPool.query(`INSERT INTO business_document(business_document_id,tenant_id,entity_id,source_document_id,document_kind,document_number,counterparty_ref,counterparty_name,currency,accounting_date,due_date,gross_amount,open_balance,status,posted_journal_entry_id,created_by) VALUES($1,$2,$3,$4,'AR_INVOICE','INV-REFUND-1','CUSTOMER-1','Customer','USD','2026-07-15','2026-08-15',100,100,'OPEN',$5,'fixture')`,[invoiceId,ids.tenantId,ids.entityId,source.documentId,ids.journalId]);
  const maker=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'refund-credit-maker',['AR.CREDIT_MEMO.CREATE','GL.JE.SUBMIT'])});
  const memo=await maker.createArCreditMemo({...ids,memoNumber:'CM-REFUND',memoDate:'2026-07-16',customerRef:'CUSTOMER-1',customerName:'Customer',amount:100,lines:JSON.stringify([{line_no:1,account_code:'410000',amount:100,description:'Memo'}]),reason:'Refund source credit',idempotencyKey:'refund-credit-source'});
  await attachAutoSource({...ids,journalId:memo.journal_entry_id},{reuseApprovedSnapshots:true});
  const reviewer=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'refund-reviewer',['GL.JE.REVIEW'])});
  const approver=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'refund-approver',['GL.JE.APPROVE'])});
  const poster=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'refund-poster',['GL.JE.POST'])});
  await maker.transitionJournal({...ids,journalEntryId:memo.journal_entry_id,action:'SUBMIT',expectedRevision:0,idempotencyKey:'refund-source-submit'});
  await reviewer.transitionJournal({...ids,journalEntryId:memo.journal_entry_id,action:'REVIEW',expectedRevision:1,idempotencyKey:'refund-source-review'});
  await approver.transitionJournal({...ids,journalEntryId:memo.journal_entry_id,action:'APPROVE',expectedRevision:2,idempotencyKey:'refund-source-approve'});
  await poster.postJournal({...ids,journalEntryId:memo.journal_entry_id,periodId:ids.periodId,expectedRevision:3,idempotencyKey:'refund-source-post'});
  assert.deepEqual((await adminPool.query('SELECT account_code,debit_amount,credit_amount,member_ref FROM journal_line WHERE journal_entry_id=$1 ORDER BY line_no',[memo.journal_entry_id])).rows,[{account_code:'120200',debit_amount:'0.0000',credit_amount:'100.0000',member_ref:'CUSTOMER-1'},{account_code:'410000',debit_amount:'100.0000',credit_amount:'0.0000',member_ref:null}]);
  const reader=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'refund-control-reader',['AR.VIEW'])});
  assert.deepEqual(await reader.getArControlTotal({tenantId:ids.tenantId,entityId:ids.entityId}),[{currency:'USD',open_balance:'0.0000',control_balance:'0.0000',in_balance:true}]);
  assert.deepEqual(await reader.getArAging({tenantId:ids.tenantId,entityId:ids.entityId,asOfDate:'2026-08-31'}),[{currency:'USD',current_amount:'0.0000',days_1_30:'100.0000',days_31_60:'-100.0000',days_61_90:'0.0000',days_91_plus:'0.0000',total_open_balance:'0.0000'}]);
  const refundMaker=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'refund-maker',['AR.REFUND.CREATE','GL.JE.SUBMIT'])});
  const competingRefundMaker=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'refund-maker-2',['AR.REFUND.CREATE','GL.JE.SUBMIT'])});
  const attempts=await Promise.allSettled([
    refundMaker.createArRefund({...ids,sourceAdjustmentId:memo.business_adjustment_id,refundNumber:'REF-60-A',refundDate:'2026-07-17',cashAccountCode:'220000',amount:60,reason:'Return customer credit funds',idempotencyKey:'refund-60-a'}),
    competingRefundMaker.createArRefund({...ids,sourceAdjustmentId:memo.business_adjustment_id,refundNumber:'REF-60-B',refundDate:'2026-07-17',cashAccountCode:'220000',amount:60,reason:'Return customer credit funds',idempotencyKey:'refund-60-b'})
  ]);
  assert.equal(attempts.filter(result=>result.status==='fulfilled').length,1);
  assert.equal(attempts.filter(result=>result.status==='rejected').length,1);
  assert.equal(attempts.find(result=>result.status==='rejected').reason.code,'23514');
  const refund=attempts.find(result=>result.status==='fulfilled').value;
  assert.equal((await adminPool.query("SELECT count(*)::int n FROM business_adjustment WHERE source_adjustment_id=$1 AND adjustment_kind='AR_REFUND'",[memo.business_adjustment_id])).rows[0].n,1);
  assert.equal((await adminPool.query("SELECT count(*)::int n FROM idempotency_receipt WHERE tenant_id=$1 AND operation_scope='AR_REFUND:'||$2::text AND idempotency_key IN ('refund-60-a','refund-60-b')",[ids.tenantId,ids.entityId])).rows[0].n,1);
  await attachAutoSource({...ids,journalId:refund.journal_entry_id},{reuseApprovedSnapshots:true});
  await refundMaker.transitionJournal({...ids,journalEntryId:refund.journal_entry_id,action:'SUBMIT',expectedRevision:0,idempotencyKey:'refund-submit'});
  await reviewer.transitionJournal({...ids,journalEntryId:refund.journal_entry_id,action:'REVIEW',expectedRevision:1,idempotencyKey:'refund-review'});
  await approver.transitionJournal({...ids,journalEntryId:refund.journal_entry_id,action:'APPROVE',expectedRevision:2,idempotencyKey:'refund-approve'});
  await poster.postJournal({...ids,journalEntryId:refund.journal_entry_id,periodId:ids.periodId,expectedRevision:3,idempotencyKey:'refund-post'});
  assert.equal((await adminPool.query('SELECT status FROM business_adjustment WHERE business_adjustment_id=$1',[refund.business_adjustment_id])).rows[0].status,'POSTED');
  assert.deepEqual((await adminPool.query('SELECT account_code,debit_amount,credit_amount,member_ref FROM journal_line WHERE journal_entry_id=$1 ORDER BY line_no',[refund.journal_entry_id])).rows,[{account_code:'120200',debit_amount:'60.0000',credit_amount:'0.0000',member_ref:'CUSTOMER-1'},{account_code:'220000',debit_amount:'0.0000',credit_amount:'60.0000',member_ref:null}]);
  assert.deepEqual(await reader.getArControlTotal({tenantId:ids.tenantId,entityId:ids.entityId}),[{currency:'USD',open_balance:'60.0000',control_balance:'60.0000',in_balance:true}]);
  assert.deepEqual(await reader.getArAging({tenantId:ids.tenantId,entityId:ids.entityId,asOfDate:'2026-08-31'}),[{currency:'USD',current_amount:'0.0000',days_1_30:'100.0000',days_31_60:'-40.0000',days_61_90:'0.0000',days_91_plus:'0.0000',total_open_balance:'60.0000'}]);
  await assert.rejects(refundMaker.createArRefund({...ids,sourceAdjustmentId:memo.business_adjustment_id,refundNumber:'REF-50',refundDate:'2026-07-18',cashAccountCode:'220000',amount:50,reason:'Over available customer credit',idempotencyKey:'refund-50'}),error=>error.code==='23514');
});

pgTest('AP bill void posts in a new open period and leaves the original Posted JE immutable',async()=>{
  const ids=await seed({status:'APPROVED',journalType:'AUTO',attachmentStatus:null});
  const trace=await attachAutoSource(ids);
  const originalPoster=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'bill-original-poster',['GL.JE.POST'])});
  await originalPoster.postJournal({...ids,journalEntryId:ids.journalId,periodId:ids.periodId,expectedRevision:0,idempotencyKey:'bill-original-post'});
  const billId=randomUUID();
  await adminPool.query(`INSERT INTO business_document(business_document_id,tenant_id,entity_id,document_kind,document_number,counterparty_ref,counterparty_name,currency,accounting_date,due_date,gross_amount,open_balance,status,source_document_id,posted_journal_entry_id,created_by) VALUES($1,$2,$3,'AP_BILL','BILL-VOID-1','VENDOR-1','Vendor','USD','2026-07-15','2026-08-15',100,100,'APPROVED',$4,$5,'fixture')`,[billId,ids.tenantId,ids.entityId,trace.documentId,ids.journalId]);
  const augustPeriod=randomUUID();await adminPool.query("INSERT INTO accounting_period(period_id,tenant_id,entity_id,period_code,starts_on,ends_on,status) VALUES($1,$2,$3,'2026-08','2026-08-01','2026-08-31','OPEN')",[augustPeriod,ids.tenantId,ids.entityId]);
  const maker=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'bill-void-maker',['AP.BILL.VOID.CREATE','GL.JE.SUBMIT'])});
  const draft=await maker.createApBillVoid({...ids,businessDocumentId:billId,periodId:augustPeriod,expectedVersion:0,journalNumber:'BILL-VOID-1-REV',journalDate:'2026-08-02',reason:'Void duplicate bill',idempotencyKey:'bill-void-create'});
  await maker.transitionJournal({...ids,journalEntryId:draft.journal_entry_id,action:'SUBMIT',expectedRevision:0,idempotencyKey:'bill-void-submit'});
  const reviewer=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'bill-void-reviewer',['GL.JE.REVIEW'])});
  await reviewer.transitionJournal({...ids,journalEntryId:draft.journal_entry_id,action:'REVIEW',expectedRevision:1,idempotencyKey:'bill-void-review'});
  const approver=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'bill-void-approver',['GL.JE.APPROVE'])});
  await approver.transitionJournal({...ids,journalEntryId:draft.journal_entry_id,action:'APPROVE',expectedRevision:2,idempotencyKey:'bill-void-approve'});
  const poster=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'bill-void-poster',['GL.JE.POST'])});
  await poster.postJournal({...ids,journalEntryId:draft.journal_entry_id,periodId:augustPeriod,expectedRevision:3,idempotencyKey:'bill-void-post'});
  const bill=(await adminPool.query('SELECT status,open_balance,version FROM business_document WHERE business_document_id=$1',[billId])).rows[0];
  assert.deepEqual(bill,{status:'VOID',open_balance:'0.0000',version:'1'});
  assert.equal((await adminPool.query('SELECT status FROM journal_entry WHERE journal_entry_id=$1',[ids.journalId])).rows[0].status,'POSTED');
  assert.equal((await adminPool.query('SELECT count(*)::int n FROM ledger_line WHERE journal_entry_id=$1',[ids.journalId])).rows[0].n,2);
  const control=(await adminPool.query('SELECT ap_open_balance,ap_control_balance,ap_in_balance FROM refs_ap_ar_control_reconciliation WHERE tenant_id=$1 AND entity_id=$2 AND currency=$3',[ids.tenantId,ids.entityId,'USD'])).rows[0];
  assert.deepEqual(control,{ap_open_balance:'0.0000',ap_control_balance:'0.0000',ap_in_balance:true});
});

pgTest('bank and reconciliation reads enforce permission, tenant, entity, account and statement scope',async()=>{
  const ids=await seed({status:'APPROVED',journalType:'AUTO',attachmentStatus:null});
  const trace=await attachAutoSource(ids);
  const bankSourceId=randomUUID(),bankMatchId=randomUUID(),reconciliationId=randomUUID();
  const journalLineId=(await adminPool.query('SELECT journal_line_id FROM journal_line WHERE journal_entry_id=$1 ORDER BY line_no LIMIT 1',[ids.journalId])).rows[0].journal_line_id;
  await adminPool.query(`INSERT INTO bank_source(bank_source_id,tenant_id,entity_id,source_document_id,bank_account_ref,external_bank_line_id,transaction_date,currency,amount)
    VALUES($1,$2,$3,$4,'BANK-1','BANK-LINE-1','2026-07-15','USD',100)`,[bankSourceId,ids.tenantId,ids.entityId,trace.documentId]);
  await adminPool.query(`INSERT INTO bank_match(bank_match_id,tenant_id,entity_id,bank_source_id,business_source_document_id,journal_entry_id,journal_line_id,candidate_rule_code,amount_delta,currency_match,date_delta_days,status,matched_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,'R-BANK-01',0,true,0,'ACTIVE','bank-reviewer')`,[bankMatchId,ids.tenantId,ids.entityId,bankSourceId,trace.documentId,ids.journalId,journalLineId]);
  await adminPool.query(`INSERT INTO reconciliation(reconciliation_id,tenant_id,entity_id,bank_account_ref,statement_ending_date,statement_ending_balance,difference,status)
    VALUES($1,$2,$3,'BANK-1','2026-07-31',100,0,'DRAFT')`,[reconciliationId,ids.tenantId,ids.entityId]);

  const denied=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'bank-denied',['AP.VIEW'])});
  await assert.rejects(denied.listBankTransactions({tenantId:ids.tenantId,entityId:ids.entityId,bankAccountRef:'BANK-1'}),error=>error.code==='42501');
  const reader=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'bank-reader',['BANK.VIEW'])});
  const rows=await reader.listBankTransactions({tenantId:ids.tenantId,entityId:ids.entityId,bankAccountRef:'BANK-1',fromDate:'2026-07-01',throughDate:'2026-07-31',limit:25});
  assert.equal(rows.length,1);assert.equal(rows[0].bank_source_id,bankSourceId);assert.equal(rows[0].bank_match_id,bankMatchId);
  assert.equal(rows[0].match_status,'ACTIVE');assert.equal(rows[0].journal_entry_id,ids.journalId);assert.equal(rows[0].amount,'100.0000');
  await assert.rejects(reader.listBankTransactions({tenantId:ids.tenantId,entityId:ids.entityId,bankAccountRef:'BANK-1',limit:null}),error=>error.code==='22023');
  assert.deepEqual(await reader.listBankTransactions({tenantId:ids.tenantId,entityId:ids.entityId,bankAccountRef:'OTHER',limit:25}),[]);
  const oldBankSourceId=randomUUID(),priorReconciliationId=randomUUID();
  await adminPool.query(`INSERT INTO bank_source(bank_source_id,tenant_id,entity_id,source_document_id,bank_account_ref,external_bank_line_id,transaction_date,currency,amount)
    VALUES($1,$2,$3,$4,'BANK-1','BANK-LINE-OLD','2026-07-05','USD',25)`,[oldBankSourceId,ids.tenantId,ids.entityId,trace.documentId]);
  await adminPool.query(`INSERT INTO reconciliation(reconciliation_id,tenant_id,entity_id,bank_account_ref,statement_ending_date,statement_ending_balance,difference,status,reconciled_by,reconciled_at)
    VALUES($1,$2,$3,'BANK-1','2026-07-10',25,0,'RECONCILED','bank-reviewer',now())`,[priorReconciliationId,ids.tenantId,ids.entityId]);
  const summaries=await reader.getReconciliationSummary({tenantId:ids.tenantId,entityId:ids.entityId,bankAccountRef:'BANK-1',statementEndingDate:'2026-07-31'});
  assert.equal(summaries.length,1);assert.equal(summaries[0].reconciliation_id,reconciliationId);
  assert.equal(summaries[0].bank_transaction_count,'1');assert.equal(summaries[0].active_match_count,'1');assert.equal(summaries[0].unmatched_transaction_count,'0');
  assert.equal(summaries[0].statement_activity_amount,'100.0000');
  assert.deepEqual(await reader.getReconciliationSummary({tenantId:ids.tenantId,entityId:ids.entityId,bankAccountRef:'BANK-1',statementEndingDate:'2026-07-10'}),[]);
  const indexes=(await adminPool.query("SELECT to_regclass('public.bank_source_read_scope_idx') bank, to_regclass('public.reconciliation_live_read_scope_idx') live, to_regclass('public.reconciliation_reconciled_cutoff_idx') cutoff")).rows[0];
  assert.deepEqual(indexes,{bank:'bank_source_read_scope_idx',live:'reconciliation_live_read_scope_idx',cutoff:'reconciliation_reconciled_cutoff_idx'});

  const outside=await seed({status:'DRAFT',attachmentStatus:null,tenantId:ids.tenantId});
  await assert.rejects(reader.listBankTransactions({tenantId:ids.tenantId,entityId:outside.entityId,bankAccountRef:'BANK-1'}),error=>error.code==='42501');
  const api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId:ids.tenantId,actorId:'bank-reader'}),kernelFactory:async()=>reader});
  const response=await api({method:'GET',url:`/api/v1/entities/${ids.entityId}/bank/reconciliation?bankAccountRef=BANK-1&statementEndingDate=2026-07-31`,body:null,headers:{}});
  assert.equal(response.status,200);assert.equal(response.headers['cache-control'],'no-store');assert.equal(response.body.data[0].reconciliation_id,reconciliationId);
});
