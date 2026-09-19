// L20: adversarial fail-closed matrix. Seven attack vectors, one fixture style, every
// negative path asserting ZERO writes by reading the accounting tables back.
//
// The point of this file is not to re-prove controls that other suites already cover in
// depth (posting SoD, the closed-period write matrix). It is to put every vector an
// attacker would actually try into one place, exercised through the real production
// chain -- runtime_actor_grant -> PostgresContextIssuer -> refs_bootstrap_context -> command
// -- so that a regression in any single control surfaces here rather than being noticed
// only by whichever domain suite happens to touch it.
//
// Vector 6 is different from the rest and deserves attention when reading the results:
// it does NOT fail closed today, and this file pins that fact rather than pretending
// otherwise. See L20-6.
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
    admin=await createPool({databaseUrl:config.migrationDatabaseUrl,applicationName:'refs-l20-admin',max:2});
    await admin.query('SELECT 1');await migrateUp(admin,{});
    runtime=await createPool({databaseUrl:config.databaseUrl,applicationName:'refs-l20-runtime',max:4});
    await runtime.query('SELECT 1');
    issuer=await createPool({databaseUrl:config.contextIssuerDatabaseUrl,applicationName:'refs-l20-issuer',max:2});
    await issuer.query('SELECT 1');
  }catch(error){
    unavailable=`POSTGRES NOT RUN: ${error.code||error.name}: ${error.message}`;
    if(config.requirePostgres)throw error;
    for(const p of [admin,runtime,issuer])if(p)await p.end().catch(()=>{});admin=null;runtime=null;issuer=null;
  }
});
after(async()=>{for(const p of [admin,runtime,issuer])if(p)await p.end();});
const pgTest=(name,fn)=>test(name,async t=>{if(unavailable){t.skip(unavailable);return;}await fn(t);});

async function seed({periodStatus='OPEN',scanStatus='CLEAN',finalization='VERIFIED_CLEAN'}={}){
  const tenantId=randomUUID(),entityId=randomUUID(),periodId=randomUUID(),attachmentId=randomUUID();
  const code=`E${entityId.replaceAll('-','').slice(0,8)}`.toUpperCase();
  await admin.query('INSERT INTO tenant(tenant_id,tenant_code,name) VALUES($1,$2,$3)',[tenantId,`T${tenantId.replaceAll('-','').slice(0,8)}`.toUpperCase(),'L20 red team tenant']);
  await admin.query("INSERT INTO entity(entity_id,tenant_id,entity_code,source_system,source_entity_id,name,base_currency) VALUES($1,$2,$3,'WBS',$3,$3,'USD')",[entityId,tenantId,code]);
  await admin.query("INSERT INTO accounting_period(period_id,tenant_id,entity_id,period_code,starts_on,ends_on,status,closed_by,closed_at) VALUES($1,$2,$3,'2026-07','2026-07-01','2026-07-31',$4,$5,$6)",
    [periodId,tenantId,entityId,periodStatus,periodStatus==='CLOSED'?'closer':null,periodStatus==='CLOSED'?new Date():null]);
  await admin.query("INSERT INTO account_master(tenant_id,entity_id,account_code,account_name,requires_member,required_member_type) VALUES($1,$2,'111000','Cash',true,'BANK'),($1,$2,'291001','Accounts Payable',true,'VENDOR')",[tenantId,entityId]);
  await admin.query("INSERT INTO member_master(tenant_id,entity_id,member_ref,member_type,display_name) VALUES($1,$2,'BANK-1','BANK','Operating Cash'),($1,$2,'VENDOR-1','VENDOR','Vendor')",[tenantId,entityId]);
  const verified=finalization==='VERIFIED_CLEAN';
  await admin.query(`INSERT INTO attachment(attachment_id,tenant_id,entity_id,name,media_type,size_bytes,content_hash,storage_ref,storage_version,uploaded_by,uploaded_at,verified_at,finalized_at,scan_status,finalization_status)
    VALUES($1,$2,$3,'evidence.pdf','application/pdf',10,$4,$5,'v1','uploader',now(),$6,$6,$7,$8)`,
    [attachmentId,tenantId,entityId,hash(attachmentId),`object://l20/${attachmentId}`,verified?new Date():null,scanStatus,finalization]);
  return {tenantId,entityId,periodId,attachmentId};
}

// A second entity inside an existing tenant, so the "grant scoped elsewhere" probe uses a
// real sibling entity rather than re-pointing a foreign key.
async function siblingEntity(ids){
  const entityId=randomUUID();
  const code=`S${entityId.replaceAll('-','').slice(0,8)}`.toUpperCase();
  await admin.query("INSERT INTO entity(entity_id,tenant_id,entity_code,source_system,source_entity_id,name,base_currency) VALUES($1,$2,$3,'WBS',$3,$3,'USD')",[entityId,ids.tenantId,code]);
  return entityId;
}

async function grant(ids,actorId,permission,{entityId=ids.entityId,expired=false}={}){
  const authority=(await admin.query('SELECT authority_class FROM runtime_human_permission_authority WHERE permission_code=$1',[permission])).rows[0]?.authority_class||'ANALYSIS';
  const until=expired?"clock_timestamp()-interval '1 hour'":"clock_timestamp()+interval '1 hour'";
  await admin.query(`INSERT INTO runtime_actor_grant(tenant_id,actor_id,entity_id,permission,authority_class,valid_until) VALUES($1,$2,$3,$4,$5,${until})
    ON CONFLICT(tenant_id,actor_id,entity_id,permission) DO UPDATE SET authority_class=EXCLUDED.authority_class,valid_until=EXCLUDED.valid_until,revoked_at=NULL`,
    [ids.tenantId,actorId,entityId,permission,authority]);
}
const kernelFor=(ids,actorId,{tenantId=ids.tenantId}={})=>{
  const ci=new PostgresContextIssuer(issuer,{principalProvider:async()=>({trusted:true,actorId,tenantId})});
  return new PostgresAccountingKernel(runtime,{sessionProvider:()=>ci.issue({tenantId})});
};
const draft=(ids,actor,{tenantId=ids.tenantId,entityId=ids.entityId,attachmentIds}={})=>
  kernelFor(ids,actor,{tenantId}).createManualJournal({
    tenantId,entityId,periodId:ids.periodId,journalNumber:`JE-${randomUUID().slice(0,8)}`,journalDate:'2026-07-15',currency:'USD',
    lines:[{line_no:1,account_code:'111000',debit_amount:100,credit_amount:0,member_ref:'BANK-1',dimensions:{}},
           {line_no:2,account_code:'291001',debit_amount:0,credit_amount:100,member_ref:'VENDOR-1',dimensions:{}}],
    attachmentIds:attachmentIds??[ids.attachmentId],reason:'L20 adversarial probe of the draft command',
    idempotencyKey:`l20-${randomUUID()}`});

async function writes(ids){
  const n=async(sql,args)=>(await admin.query(sql,args)).rows[0].n;
  return {
    journals:await n('SELECT count(*)::int n FROM journal_entry WHERE tenant_id=$1 AND entity_id=$2',[ids.tenantId,ids.entityId]),
    lines:await n('SELECT count(*)::int n FROM journal_line WHERE tenant_id=$1 AND entity_id=$2',[ids.tenantId,ids.entityId]),
    ledger:await n('SELECT count(*)::int n FROM ledger_line WHERE tenant_id=$1 AND entity_id=$2',[ids.tenantId,ids.entityId]),
    audits:await n('SELECT count(*)::int n FROM audit_event WHERE tenant_id=$1 AND entity_id=$2',[ids.tenantId,ids.entityId]),
    receipts:await n('SELECT count(*)::int n FROM idempotency_receipt WHERE tenant_id=$1',[ids.tenantId])
  };
}
const NOTHING={journals:0,lines:0,ledger:0,audits:0,receipts:0};

pgTest('L20-0 control: with a valid grant, an open period and verified evidence, the draft succeeds',async()=>{
  const ids=await seed();
  await grant(ids,'maker','GL.JE.CREATE');
  const r=await draft(ids,'maker');
  assert.match(r.journal_entry_id,/^[0-9a-f-]{36}$/,'the positive path must work, or the negatives below prove nothing');
  const w=await writes(ids);
  assert.equal(w.journals,1);assert.equal(w.lines,2);
  assert.equal(w.ledger,0,'a Draft must never reach the ledger');
});

pgTest('L20-1 unauthorized access: an actor with no grant at all is refused 42501 with zero writes',async()=>{
  const ids=await seed();
  await assert.rejects(draft(ids,'nobody'),e=>e.code==='42501','an ungranted actor must be refused');
  assert.deepEqual(await writes(ids),NOTHING);
});

pgTest('L20-2 cross-tenant: a context issued for another tenant cannot act on this one, and a grant on another entity does not carry',async()=>{
  const victim=await seed();
  const attacker=await seed();
  // (a) attacker is fully granted in their own tenant, then aims the command at the victim tenant.
  await grant(attacker,'attacker','GL.JE.CREATE');
  await assert.rejects(draft(victim,'attacker',{tenantId:attacker.tenantId}),e=>e.code==='42501','cross-tenant must be refused');
  // (b) same tenant, but the grant is scoped to a different entity in that tenant.
  const sibling=await siblingEntity(victim);
  await grant(victim,'wrongscope','GL.JE.CREATE',{entityId:sibling});
  await assert.rejects(draft(victim,'wrongscope'),e=>e.code==='42501','a grant on another entity must not carry');
  assert.deepEqual(await writes(victim),NOTHING);
});

pgTest('L20-3 expired token: a grant whose valid_until has passed is refused 42501 with zero writes',async()=>{
  const ids=await seed();
  await grant(ids,'stale','GL.JE.CREATE',{expired:true});
  await assert.rejects(draft(ids,'stale'),e=>e.code==='42501','an expired grant must not authorise');
  assert.deepEqual(await writes(ids),NOTHING);
  // And a grant revoked after issue is equally dead.
  const ids2=await seed();
  await grant(ids2,'revoked','GL.JE.CREATE');
  await admin.query('UPDATE runtime_actor_grant SET revoked_at=clock_timestamp() WHERE tenant_id=$1 AND actor_id=$2',[ids2.tenantId,'revoked']);
  await assert.rejects(draft(ids2,'revoked'),e=>e.code==='42501','a revoked grant must not authorise');
  assert.deepEqual(await writes(ids2),NOTHING);
});

pgTest('L20-4 forged context: hand-set refs.* session claims are not an authority source',async()=>{
  const ids=await seed();
  // No grant, no issued context: forge the GUCs the kernel reads and call the SQL directly.
  const client=await runtime.connect();
  try{
    await client.query('BEGIN');
    await client.query("SELECT set_config('refs.tenant_id',$1,true)",[ids.tenantId]);
    await client.query("SELECT set_config('refs.actor_id','forger',true)");
    await client.query("SELECT set_config('refs.context_hash',$1,true)",[hash('forged')]);
    await assert.rejects(
      client.query('SELECT refs_assert_scope($1,$2,$3)',[ids.tenantId,ids.entityId,'GL.JE.CREATE']),
      e=>e.code==='42501','forged GUC claims must be refused before any write');
    await client.query('ROLLBACK');
  }finally{client.release();}
  assert.deepEqual(await writes(ids),NOTHING);
});

pgTest('L20-5 WBS write: the inbound evidence tables are append-only, so retained rows cannot be altered or deleted',async()=>{
  const ids=await seed();
  const receiptId=randomUUID(),rowId=randomUUID(),batchId=randomUUID();
  await admin.query(`INSERT INTO import_batch(import_batch_id,tenant_id,entity_id,connector_code,source_module,source_entity_id,idempotency_key,request_hash,status,row_count)
    VALUES($1,$2,$3,'WBS','payable',$4,$5,$6,'SUCCEEDED',1)`,[batchId,ids.tenantId,ids.entityId,ids.entityId,`k-${batchId}`,hash(batchId)]);
  await admin.query(`INSERT INTO wbs_inbound_receipt(receipt_id,tenant_id,entity_id,import_batch_id,receipt_hash,payload_ref)
    VALUES($1,$2,$3,$4,$5,$6)`,[receiptId,ids.tenantId,ids.entityId,batchId,hash(receiptId),`object://wbs/${receiptId}`]);
  await admin.query(`INSERT INTO wbs_inbound_row(wbs_inbound_row_id,tenant_id,entity_id,receipt_id,source_record_id,source_version,raw,normalized,outcome,outcome_kind)
    VALUES($1,$2,$3,$4,'REC-1','1','{"a":1}'::jsonb,'{"b":2}'::jsonb,'{"stage":"STAGING_REVIEW_REQUIRED"}'::jsonb,'STAGING')`,
    [rowId,ids.tenantId,ids.entityId,receiptId]);

  // Even the migration superuser cannot mutate retained WBS evidence.
  for(const [label,sql,args] of [
    ['UPDATE row','UPDATE wbs_inbound_row SET raw=\'{"a":99}\'::jsonb WHERE wbs_inbound_row_id=$1',[rowId]],
    ['DELETE row','DELETE FROM wbs_inbound_row WHERE wbs_inbound_row_id=$1',[rowId]],
    ['UPDATE receipt','UPDATE wbs_inbound_receipt SET receipt_hash=$2 WHERE receipt_id=$1',[receiptId,hash('tamper')]],
    ['DELETE receipt','DELETE FROM wbs_inbound_receipt WHERE receipt_id=$1',[receiptId]]
  ]) await assert.rejects(admin.query(sql,args),e=>typeof e.code==='string',`${label} must be rejected by the append-only trigger`);

  const row=(await admin.query('SELECT raw FROM wbs_inbound_row WHERE wbs_inbound_row_id=$1',[rowId])).rows[0];
  assert.deepEqual(row.raw,{a:1},'the retained payload must be byte-for-byte unchanged');
});

pgTest('L20-6 infected attachment: unscanned or REJECTED evidence is refused, but the guard is tenant-scoped, not entity-scoped',async()=>{
  // Two guards sit on this path and it matters which one does the work.
  //
  //   refs_create_manual_journal (002:1041-1043) checks only that each attachment id is
  //   TENANT-OWNED. Read alone, that looks like a hole.
  //
  //   The hole is closed downstream: inserting the JE_ATTACHMENT source_link fires
  //   require_finalized_source_link_attachment (001:725-738, trigger 001:757), which
  //   refuses anything whose finalization_status is not VERIFIED_CLEAN with 23514.
  //
  // So the system DOES fail closed on infected or unscanned evidence. This test exists to
  // keep it that way, and to pin the one dimension the downstream guard does not cover:
  // it matches on tenant_id alone, so a VERIFIED_CLEAN attachment belonging to a DIFFERENT
  // ENTITY in the same tenant still passes.
  for(const [label,scanStatus,finalization] of [
    ['never scanned','PENDING','PENDING'],
    ['scanner rejected it (infected)','REJECTED','REJECTED']
  ]){
    const ids=await seed({scanStatus,finalization});
    await grant(ids,'maker','GL.JE.CREATE');
    await assert.rejects(draft(ids,'maker'),
      e=>e.code==='23514'&&/VERIFIED_CLEAN before it enters the trace graph/.test(e.message),
      `${label}: non-verified evidence must be refused`);
    assert.deepEqual(await writes(ids),NOTHING,`${label}: nothing may be written`);
  }

  const ids=await seed();
  await grant(ids,'maker','GL.JE.CREATE');
  // Evidence that resolves to no row at all is refused by the upstream gate instead.
  await assert.rejects(draft(ids,'maker',{attachmentIds:[randomUUID()]}),
    e=>e.code==='23503'&&/tenant-owned attachment evidence/.test(e.message),
    'an attachment id resolving to no row must be refused');
  await assert.rejects(draft(ids,'maker',{attachmentIds:[]}),
    e=>e.code==='23503','an empty evidence list must be refused');

  // GAP PIN: cross-entity evidence. The attachment is VERIFIED_CLEAN but belongs to a
  // sibling entity; neither guard scopes to entity_id, so it is accepted. If this starts
  // throwing, the entity-scoping half of D-N21-1 was implemented -- update this pin.
  const foreign=randomUUID();
  const sibling=await siblingEntity(ids);
  await admin.query(`INSERT INTO attachment(attachment_id,tenant_id,entity_id,name,media_type,size_bytes,content_hash,storage_ref,storage_version,uploaded_by,uploaded_at,verified_at,finalized_at,scan_status,finalization_status)
    VALUES($1,$2,$3,'sibling.pdf','application/pdf',10,$4,$5,'v1','uploader',now(),now(),now(),'CLEAN','VERIFIED_CLEAN')`,
    [foreign,ids.tenantId,sibling,hash(foreign),`object://l20/${foreign}`]);
  const accepted=await draft(ids,'maker',{attachmentIds:[foreign]});
  assert.match(accepted.journal_entry_id,/^[0-9a-f-]{36}$/,
    'GAP PIN: evidence owned by a sibling entity is accepted because both guards match on tenant_id only.');
});

pgTest('L20-7 period-end escalation: a fully granted actor still cannot write into a CLOSED period',async()=>{
  const ids=await seed({periodStatus:'CLOSED'});
  // The attacker holds the real permission; only the period stands in the way.
  await grant(ids,'maker','GL.JE.CREATE');
  await assert.rejects(draft(ids,'maker'),e=>e.code==='55000','a closed period must refuse the draft');
  assert.deepEqual(await writes(ids),NOTHING);

  // Nor can the period be walked back by a normal actor: reopen demands GL.PERIOD.REOPEN,
  // retained close evidence and a different actor from the closer.
  await grant(ids,'maker','GL.PERIOD.REOPEN');
  await assert.rejects(
    kernelFor(ids,'maker').reopenPeriod({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId,
      expectedVersion:1,closeAuditEventId:randomUUID(),expectedReadinessHash:hash('nope'),
      reason:'L20 adversarial reopen attempt without retained close evidence',idempotencyKey:`l20-reopen-${randomUUID()}`}),
    e=>typeof e.code==='string','a reopen without retained close evidence must be refused');
  const period=(await admin.query('SELECT status FROM accounting_period WHERE period_id=$1',[ids.periodId])).rows[0];
  assert.equal(period.status,'CLOSED','the period must still be closed after the attempt');
});
