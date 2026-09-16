// Journal entry lifecycle as one contract, on the production chain
// (grant -> issue -> bind -> kernel): Draft -> Submit -> Review -> Approve ->
// Post -> Reverse, plus Reject back to Draft. For every stage: who may act
// (SoD), what a stale revision does (40001), that the same key replays
// idempotently, and that once Posted the journal, its lines and the ledger are
// immutable at the database, not just the API. Fixtures are inserted by the
// admin pool the way postgres-kernel.test.mjs seed() does; assertions read back.
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

pgTest('happy path: Draft -> Submit -> Review -> Approve -> Post by four distinct actors, revision advancing 0..4, one ledger batch',async()=>{
  const ids=await seed();const d=await draft(ids);assert.equal(d.status,'DRAFT');const id=d.journal_entry_id;
  await move(ids,'submitter',id,'SUBMIT',0,'lc-submit');assert.deepEqual((await je(id)).status,'PENDING_REVIEW');
  await move(ids,'reviewer',id,'REVIEW',1,'lc-review');assert.equal((await je(id)).status,'PENDING_APPROVAL');
  await move(ids,'approver',id,'APPROVE',2,'lc-approve');assert.equal((await je(id)).status,'APPROVED');
  const posted=await kernelFor(ids,'poster').postJournal({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId,journalEntryId:id,expectedRevision:3,idempotencyKey:'je-lifecycle-lc-post'});
  const row=await je(id);assert.equal(row.status,'POSTED');assert.equal(row.revision,4);
  assert.deepEqual([row.created_by,row.reviewed_by,row.approved_by,row.posted_by],['maker','reviewer','approver','poster']);assert.equal(row.revision,4);
  assert.equal((await admin.query('SELECT count(*)::int n FROM ledger_line WHERE journal_entry_id=$1',[id])).rows[0].n,2);
  assert.match(posted.posting_batch_id,/^[0-9a-f-]{36}$/);
});

pgTest('segregation of duties is enforced twice: the grant layer refuses a second workflow authority class per actor, and the command layer refuses creator/reviewer/approver at review, approve and post',async()=>{
  const ids=await seed();
  // Layer 1 - grants: giving the maker (DRAFT class) a REVIEW grant makes context issuance refuse the actor outright.
  await grant(ids,'maker','GL.JE.REVIEW');
  await assert.rejects(draft(ids,'JE-SOD-MIX'),e=>e.code==='42501'&&/mutually exclusive workflow authorities/.test(e.message));
  await admin.query("UPDATE runtime_actor_grant SET revoked_at=clock_timestamp() WHERE tenant_id=$1 AND actor_id='maker' AND permission='GL.JE.REVIEW'",[ids.tenantId]);
  // Layer 2 - command: seat the acting role as an earlier participant by fixture and let the SQL SoD refuse it.
  const seat=async(status,created_by,reviewed_by=null,approved_by=null)=>{const id=randomUUID();
    await admin.query("INSERT INTO journal_entry(journal_entry_id,tenant_id,entity_id,period_id,journal_number,journal_type,status,journal_date,currency,created_by,reviewed_by,approved_by) VALUES($1,$2,$3,$4,$5,'MANUAL',$6,'2026-07-15','USD',$7,$8,$9)",[id,ids.tenantId,ids.entityId,ids.periodId,`JE-${id.slice(0,8)}`,status,created_by,reviewed_by,approved_by]);
    let n=0;for(const l of lines)await admin.query("INSERT INTO journal_line(tenant_id,entity_id,period_id,journal_entry_id,line_no,account_code,debit_amount,credit_amount,member_ref,dimensions) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'{}')",[ids.tenantId,ids.entityId,ids.periodId,id,++n,l.account_code,l.debit_amount,l.credit_amount,l.member_ref]);
    await admin.query("INSERT INTO source_link(tenant_id,entity_id,link_type,journal_entry_id,attachment_id,created_by) VALUES($1,$2,'JE_ATTACHMENT',$3,$4,'maker')",[ids.tenantId,ids.entityId,id,ids.attachmentId]);return id;};
  const r1=await seat('PENDING_REVIEW','reviewer');await assert.rejects(move(ids,'reviewer',r1,'REVIEW',0,'je-lifecycle-sod-r'),e=>e.code==='42501'&&/SoD/.test(e.message));assert.equal((await je(r1)).status,'PENDING_REVIEW');
  const a1=await seat('PENDING_APPROVAL','approver','reviewer');await assert.rejects(move(ids,'approver',a1,'APPROVE',0,'je-lifecycle-sod-a1'),e=>e.code==='42501');
  const a2=await seat('PENDING_APPROVAL','maker','approver');await assert.rejects(move(ids,'approver',a2,'APPROVE',0,'je-lifecycle-sod-a2'),e=>e.code==='42501');
  for(const seatAs of [['poster','reviewer','approver'],['maker','poster','approver'],['maker','reviewer','poster']]){
    const p=await seat('APPROVED',...seatAs);
    await assert.rejects(kernelFor(ids,'poster').postJournal({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId,journalEntryId:p,expectedRevision:0,idempotencyKey:`sod-p-${p}`}),e=>e.code==='42501'&&/SoD/.test(e.message));
    assert.equal((await admin.query('SELECT count(*)::int n FROM ledger_line WHERE journal_entry_id=$1',[p])).rows[0].n,0);
  }
});

pgTest('optimistic locking: a stale expectedRevision is refused with 40001 at transition and at post, and the row is unchanged',async()=>{
  const ids=await seed();const id=(await draft(ids)).journal_entry_id;
  await move(ids,'submitter',id,'SUBMIT',0,'ol-submit');
  await assert.rejects(move(ids,'reviewer',id,'REVIEW',0,'ol-stale'),e=>e.code==='40001');
  assert.deepEqual(await je(id),{status:'PENDING_REVIEW',revision:1,created_by:'maker',reviewed_by:null,approved_by:null,posted_by:null});
  await move(ids,'reviewer',id,'REVIEW',1,'ol-review');await move(ids,'approver',id,'APPROVE',2,'ol-approve');
  await assert.rejects(kernelFor(ids,'poster').postJournal({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId,journalEntryId:id,expectedRevision:2,idempotencyKey:'ol-post-stale'}),e=>e.code==='40001');
  assert.equal((await je(id)).status,'APPROVED');
});

pgTest('idempotency: replaying a transition with the same key returns idempotent and does not advance revision; a different request under the same key is 23505',async()=>{
  const ids=await seed();const id=(await draft(ids)).journal_entry_id;
  const first=await move(ids,'submitter',id,'SUBMIT',0,'idem-submit');
  const replay=await move(ids,'submitter',id,'SUBMIT',0,'idem-submit');
  assert.equal(replay.idempotent,true);assert.equal((await je(id)).revision,1);
  await assert.rejects(move(ids,'submitter',id,'SUBMIT',1,'idem-submit'),e=>e.code==='23505');
  void first;
});

pgTest('reject returns to Draft, clears reviewer/approver, requires a reason of 8+ chars and a non-creator, and the maker can resubmit',async()=>{
  const ids=await seed();const id=(await draft(ids)).journal_entry_id;
  await move(ids,'submitter',id,'SUBMIT',0,'rj-submit');await move(ids,'reviewer',id,'REVIEW',1,'rj-review');
  await assert.rejects(move(ids,'rejecter',id,'REJECT',2,'rj-short','short'),e=>e.code==='42501');
  // creator seated as rejecter by fixture -> command-layer SoD
  const own=randomUUID();await admin.query("INSERT INTO journal_entry(journal_entry_id,tenant_id,entity_id,period_id,journal_number,journal_type,status,journal_date,currency,created_by,reviewed_by) VALUES($1,$2,$3,$4,'JE-OWN','MANUAL','PENDING_APPROVAL','2026-07-15','USD','rejecter','reviewer')",[own,ids.tenantId,ids.entityId,ids.periodId]);
  await assert.rejects(move(ids,'rejecter',own,'REJECT',0,'je-lifecycle-rj-self','creator cannot reject own'),e=>e.code==='42501');
  await move(ids,'rejecter',id,'REJECT',2,'je-lifecycle-rj-ok','Wrong account on line 1');
  assert.deepEqual(await je(id),{status:'DRAFT',revision:3,created_by:'maker',reviewed_by:null,approved_by:null,posted_by:null});
  await move(ids,'submitter',id,'SUBMIT',3,'rj-resubmit');assert.equal((await je(id)).status,'PENDING_REVIEW');
});

pgTest('submit gates: unbalanced lines, missing required member, and a manual journal without attachment evidence are all refused before review',async()=>{
  const ids=await seed();
  // createManualJournal enforces balance itself; prove submit-time guards via admin-inserted drafts.
  for(const [label,ls,att] of [
    ['unbalanced',[['610000',25,0,null],['111000',0,20,'BANK-1']],true],
    ['missing member',[['610000',25,0,null],['111000',0,25,null]],true],
    ['no attachment',[['610000',25,0,null],['111000',0,25,'BANK-1']],false]]){
    const id=randomUUID();
    await admin.query("INSERT INTO journal_entry(journal_entry_id,tenant_id,entity_id,period_id,journal_number,journal_type,status,journal_date,currency,created_by) VALUES($1,$2,$3,$4,$5,'MANUAL','DRAFT','2026-07-15','USD','maker')",[id,ids.tenantId,ids.entityId,ids.periodId,`JE-${label.replace(/\s/g,'')}`]);
    let n=0,lineRejected=null;
    for(const [a,d,c,m] of ls){try{await admin.query("INSERT INTO journal_line(tenant_id,entity_id,period_id,journal_entry_id,line_no,account_code,debit_amount,credit_amount,member_ref,dimensions) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'{}')",[ids.tenantId,ids.entityId,ids.periodId,id,++n,a,d,c,m]);}catch(e){lineRejected=e;}}
    if(label==='missing member'){
      // 002:99 journal_line trigger refuses a member-less line on a requires_member account before any workflow step exists.
      assert.equal(lineRejected?.code,'23514',label);assert.match(lineRejected.message,/Member is required/);continue;
    }
    assert.equal(lineRejected,null,label);
    if(att)await admin.query("INSERT INTO source_link(tenant_id,entity_id,link_type,journal_entry_id,attachment_id,created_by) VALUES($1,$2,'JE_ATTACHMENT',$3,$4,'maker')",[ids.tenantId,ids.entityId,id,ids.attachmentId]);
    await assert.rejects(move(ids,'submitter',id,'SUBMIT',0,`gate-${label}`),e=>e.code==='23514',label);
    assert.equal((await je(id)).status,'DRAFT',label);
  }
});

pgTest('immutability: once Posted, journal_entry and journal_line reject UPDATE/DELETE, ledger_line is append-only, and REJECT/SUBMIT are refused',async()=>{
  const ids=await seed();const id=(await draft(ids)).journal_entry_id;
  await move(ids,'submitter',id,'SUBMIT',0,'je-lifecycle-im-s');await move(ids,'reviewer',id,'REVIEW',1,'je-lifecycle-im-r');await move(ids,'approver',id,'APPROVE',2,'je-lifecycle-im-a');
  await kernelFor(ids,'poster').postJournal({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId,journalEntryId:id,expectedRevision:3,idempotencyKey:'je-lifecycle-im-p'});
  await assert.rejects(admin.query("UPDATE journal_entry SET description='tampered' WHERE journal_entry_id=$1",[id]));
  await assert.rejects(admin.query("UPDATE journal_line SET debit_amount=debit_amount+1 WHERE journal_entry_id=$1 AND line_no=1",[id]));
  await assert.rejects(admin.query("DELETE FROM journal_line WHERE journal_entry_id=$1",[id]));
  await assert.rejects(admin.query("UPDATE ledger_line SET debit_amount=0 WHERE journal_entry_id=$1",[id]));
  await assert.rejects(admin.query("DELETE FROM ledger_line WHERE journal_entry_id=$1",[id]));
  await assert.rejects(move(ids,'rejecter',id,'REJECT',4,'im-reject','Try to reject posted'),e=>e.code==='42501');
  await assert.rejects(move(ids,'submitter',id,'SUBMIT',4,'im-resubmit'),e=>e.code==='55000');
  assert.equal((await je(id)).status,'POSTED');
});

pgTest('reverse: a Posted manual journal is reversed only through a new Draft (exact inverse) that itself runs the four-role workflow; the original stays Posted and a second reversal is refused',async()=>{
  const ids=await seed();const id=(await draft(ids)).journal_entry_id;
  await move(ids,'submitter',id,'SUBMIT',0,'je-lifecycle-rv-s');await move(ids,'reviewer',id,'REVIEW',1,'je-lifecycle-rv-r');await move(ids,'approver',id,'APPROVE',2,'je-lifecycle-rv-a');
  await kernelFor(ids,'poster').postJournal({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId,journalEntryId:id,expectedRevision:3,idempotencyKey:'je-lifecycle-rv-p'});
  const rev=await kernelFor(ids,'reverser').createJournalAdjustment({action:'REVERSAL',tenantId:ids.tenantId,entityId:ids.entityId,originalJournalEntryId:id,periodId:ids.periodId,journalNumber:'JE-LC-1-REV',journalDate:'2026-07-20',description:'reverse',reason:'Posted in error, reversing',attachmentIds:[ids.attachmentId],idempotencyKey:'rv-create',lines:[]});
  assert.equal(rev.status,'DRAFT');
  const rl=(await admin.query('SELECT account_code,debit_amount::text d,credit_amount::text c FROM journal_line WHERE journal_entry_id=$1 ORDER BY line_no',[rev.journal_entry_id])).rows;
  assert.deepEqual(rl,[{account_code:'610000',d:'0.0000',c:'25.0000'},{account_code:'111000',d:'25.0000',c:'0.0000'}],'reversal lines are the exact inverse');
  assert.equal((await je(id)).status,'POSTED','original untouched');
  await move(ids,'submitter',rev.journal_entry_id,'SUBMIT',0,'je-lifecycle-rv2-s');await move(ids,'reviewer',rev.journal_entry_id,'REVIEW',1,'je-lifecycle-rv2-r');await move(ids,'approver',rev.journal_entry_id,'APPROVE',2,'je-lifecycle-rv2-a');
  await kernelFor(ids,'poster').postJournal({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId,journalEntryId:rev.journal_entry_id,expectedRevision:3,idempotencyKey:'je-lifecycle-rv2-p'});
  assert.equal((await je(rev.journal_entry_id)).status,'POSTED');
  const net=(await admin.query('SELECT coalesce(sum(debit_amount)-sum(credit_amount),0)::text n FROM ledger_line WHERE journal_entry_id IN ($1,$2)',[id,rev.journal_entry_id])).rows[0].n;
  assert.equal(Number(net),0,'original + reversal net to zero in the ledger');
  await assert.rejects(kernelFor(ids,'reverser').createJournalAdjustment({action:'REVERSAL',tenantId:ids.tenantId,entityId:ids.entityId,originalJournalEntryId:id,periodId:ids.periodId,journalNumber:'JE-LC-1-REV2',journalDate:'2026-07-21',description:'again',reason:'second reversal attempt',attachmentIds:[ids.attachmentId],idempotencyKey:'rv-create-2',lines:[]}),e=>e.code==='23505'||e.code==='55000','one reversal per original (journal_entry_one_reversal_uq)');
});
