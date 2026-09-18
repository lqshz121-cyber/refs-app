// P06 — unit sale close-out (migration 430): revenue / released COGS / remaining capitalised cost tied per unit,
// and the controlled COGS release Draft. Nothing auto-posts; reversing a posted release restores the unit state.
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

before(async()=>{try{
  admin=await createPool({databaseUrl:config.migrationDatabaseUrl,applicationName:'refs-p06-admin',max:2});await admin.query('SELECT 1');await migrateUp(admin,{});
  runtime=await createPool({databaseUrl:config.databaseUrl,applicationName:'refs-p06-runtime',max:6});await runtime.query('SELECT 1');
  issuer=await createPool({databaseUrl:config.contextIssuerDatabaseUrl,applicationName:'refs-p06-issuer',max:2});await issuer.query('SELECT 1');
}catch(error){unavailable=`POSTGRES NOT RUN: ${error.code||error.name}: ${error.message}`;if(config.requirePostgres)throw error;for(const p of [admin,runtime,issuer])if(p)await p.end().catch(()=>{});admin=runtime=issuer=null;}});
after(async()=>{for(const p of [admin,runtime,issuer])if(p)await p.end();});

async function grant(ids,actorId,permission){
  const a=(await admin.query('SELECT authority_class FROM runtime_human_permission_authority WHERE permission_code=$1',[permission])).rows[0]?.authority_class||'ANALYSIS';
  await admin.query(`INSERT INTO runtime_actor_grant(tenant_id,actor_id,entity_id,permission,authority_class,valid_until) VALUES($1,$2,$3,$4,$5,clock_timestamp()+interval '1 hour') ON CONFLICT(tenant_id,actor_id,entity_id,permission) DO UPDATE SET revoked_at=NULL,authority_class=EXCLUDED.authority_class,valid_until=EXCLUDED.valid_until`,[ids.tenantId,actorId,ids.entityId,permission,a]);
}
const kernelFor=(ids,actorId)=>{
  const ci=new PostgresContextIssuer(issuer,{principalProvider:async()=>({trusted:true,actorId,tenantId:ids.tenantId})});
  return new PostgresAccountingKernel(runtime,{sessionProvider:()=>ci.issue({tenantId:ids.tenantId})});
};
async function classify(ids,family,account,classification,tag){
  const mh=(await admin.query("SELECT refs_jsonb_hash(jsonb_build_object('input_keys',jsonb_build_object('account_code',$1::text),'output_rules',jsonb_build_object('classification',$2::text))) h",[account,classification])).rows[0].h;
  await admin.query(`INSERT INTO mapping_snapshot(mapping_snapshot_id,tenant_id,entity_id,family,scope_type,scope_key,input_key_hash,version,priority,effective_from,effective_to,status,input_keys,output_rules,snapshot_hash,created_by,approved_by,approved_at)
    VALUES($1,$2,$3::uuid,$4,'ENTITY',$3::text,$5,1,0,'2026-01-01T00:00:00Z',NULL,'APPROVED',jsonb_build_object('account_code',$6::text),jsonb_build_object('classification',$7::text),$8,'mapping-maker','mapping-approver',now())`,
    [randomUUID(),ids.tenantId,ids.entityId,family,hash(`${family}-${account}-${tag}`),account,classification,mh]);
}

async function seed(tag){
  const tenantId=randomUUID(),entityId=randomUUID(),periodId=randomUUID(),nextPeriodId=randomUUID(),attachmentId=randomUUID();
  await admin.query('INSERT INTO tenant(tenant_id,tenant_code,name) VALUES($1,$2,$3)',[tenantId,`T${tenantId.replaceAll('-','').slice(0,8)}`.toUpperCase(),`p06-${tag}`]);
  await admin.query("INSERT INTO entity(entity_id,tenant_id,entity_code,source_system,source_entity_id,name,base_currency) VALUES($1,$2,'E1','WBS','E1','E1','USD')",[entityId,tenantId]);
  await admin.query("INSERT INTO accounting_period(period_id,tenant_id,entity_id,period_code,starts_on,ends_on,status) VALUES($1,$2,$3,'2026-07','2026-07-01','2026-07-31','OPEN')",[periodId,tenantId,entityId]);
  await admin.query("INSERT INTO accounting_period(period_id,tenant_id,entity_id,period_code,starts_on,ends_on,status) VALUES($1,$2,$3,'2026-08','2026-08-01','2026-08-31','OPEN')",[nextPeriodId,tenantId,entityId]);
  await admin.query(`INSERT INTO account_master(tenant_id,entity_id,account_code,account_name,requires_member,required_member_type) VALUES
    ($1,$2,'150100','Construction in progress',false,NULL),($1,$2,'500100','Cost of units sold',false,NULL),($1,$2,'400100','Unit sales revenue',false,NULL),
    ($1,$2,'610000','Repairs',false,NULL),($1,$2,'111000','Operating Cash',true,'BANK')`,[tenantId,entityId]);
  await admin.query("INSERT INTO member_master(tenant_id,entity_id,member_ref,member_type,display_name) VALUES($1,$2,'BANK-1','BANK','Operating bank')",[tenantId,entityId]);
  await admin.query(`INSERT INTO attachment(attachment_id,tenant_id,entity_id,name,media_type,size_bytes,content_hash,storage_ref,storage_version,uploaded_by,uploaded_at,verified_at,scan_status,finalization_status,finalized_at) VALUES($1,$2,$3,'doc.pdf','application/pdf',10,$4,$5,'v1','maker',now(),now(),'CLEAN','VERIFIED_CLEAN',now())`,[attachmentId,tenantId,entityId,hash(attachmentId),`object://attachments/${attachmentId}`]);
  const ids={tenantId,entityId,periodId,nextPeriodId,attachmentId};
  await classify(ids,'CWIP_ACCOUNT_CLASSIFICATION','150100','CWIP','a');
  await classify(ids,'UNIT_SALE_ACCOUNT_CLASSIFICATION','500100','COGS','b');
  await classify(ids,'UNIT_SALE_ACCOUNT_CLASSIFICATION','400100','REVENUE','c');
  for(const [a,p] of [['pmaker','PROJECT.MASTER.CREATE'],['papprover','PROJECT.MASTER.APPROVE'],['reporter','GL.REPORT.VIEW'],['releaser','UNIT.COGS.RELEASE.DRAFT'],
    ['jemaker','GL.JE.CREATE'],['submitter','GL.JE.SUBMIT'],['reviewer','GL.JE.REVIEW'],['approver','GL.JE.APPROVE'],['poster','GL.JE.POST'],['reverser','GL.JE.REVERSE']])await grant(ids,a,p);
  await grant(ids,'releaser','GL.JE.CREATE');
  return ids;
}
async function postJournalFully(ids,journalEntryId,tag,periodId=ids.periodId){
  await kernelFor(ids,'submitter').transitionJournal({tenantId:ids.tenantId,entityId:ids.entityId,journalEntryId,action:'SUBMIT',expectedRevision:0,idempotencyKey:`p06-sub-${tag}`});
  await kernelFor(ids,'reviewer').transitionJournal({tenantId:ids.tenantId,entityId:ids.entityId,journalEntryId,action:'REVIEW',expectedRevision:1,idempotencyKey:`p06-rev-${tag}`});
  await kernelFor(ids,'approver').transitionJournal({tenantId:ids.tenantId,entityId:ids.entityId,journalEntryId,action:'APPROVE',expectedRevision:2,idempotencyKey:`p06-app-${tag}`});
  await kernelFor(ids,'poster').postJournal({tenantId:ids.tenantId,entityId:ids.entityId,periodId,journalEntryId,expectedRevision:3,idempotencyKey:`p06-post-${tag}`});
}
async function postPair(ids,tag,{debit,credit,amount,dims,date='2026-07-10'}){
  const mem=a=>a==='111000'?'BANK-1':null,dim=a=>a==='111000'?{}:dims;
  const lines=[{line_no:1,account_code:debit,debit_amount:amount,credit_amount:0,member_ref:mem(debit),dimensions:dim(debit)},
               {line_no:2,account_code:credit,debit_amount:0,credit_amount:amount,member_ref:mem(credit),dimensions:dim(credit)}];
  const je=await kernelFor(ids,'jemaker').createManualJournal({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId,journalNumber:`P06-${tag}`,journalDate:date,currency:'USD',description:`p06 ${tag}`,attachmentIds:[ids.attachmentId],idempotencyKey:`p06-je-${tag}`,lines});
  await postJournalFully(ids,je.journal_entry_id,tag);return je.journal_entry_id;
}
const rejects=async(fn,code,re)=>{try{await fn();assert.fail('expected rejection '+code);}catch(e){assert.equal(e.code,code,e.message);if(re)assert.match(e.message,re);}};
function pgTest(name,fn){test(name,async t=>{if(unavailable){t.skip(unavailable);return;}await fn(t);});}

async function approvedProject(ids,units){
  const prj=await kernelFor(ids,'pmaker').createProjectMaster({tenantId:ids.tenantId,entityId:ids.entityId,projectRef:'PRJ-1',projectName:'Riverside Phase 1',projectType:'DEVELOPMENT',capitalizationPolicy:'CWIP_UNTIL_COMPLETION',reason:'register development project',idempotencyKey:'p06-prj-1'});
  await kernelFor(ids,'papprover').transitionProjectMaster({tenantId:ids.tenantId,entityId:ids.entityId,objectType:'PROJECT',objectId:prj.project_id,expectedRevision:0,event:'APPROVED',reason:'approve the project',idempotencyKey:'p06-appr-prj'});
  const made={};
  for(const [unitRef,basis] of units){
    const u=await kernelFor(ids,'pmaker').createProjectUnit({tenantId:ids.tenantId,entityId:ids.entityId,projectId:prj.project_id,unitRef,unitName:`Unit ${unitRef}`,allocationBasis:basis,allocationWeight:'1000.0000',reason:`register unit ${unitRef}`,idempotencyKey:`p06-unit-${unitRef}`});
    await kernelFor(ids,'papprover').transitionProjectMaster({tenantId:ids.tenantId,entityId:ids.entityId,objectType:'UNIT',objectId:u.unit_id,expectedRevision:0,event:'APPROVED',reason:`approve unit ${unitRef}`,idempotencyKey:`p06-appr-${unitRef}`});
    made[unitRef]=u.unit_id;
  }
  return {projectId:prj.project_id,units:made};
}
const closeout=(ids,extra={})=>kernelFor(ids,'reporter').readUnitSaleCloseout({tenantId:ids.tenantId,entityId:ids.entityId,projectRef:'PRJ-1',...extra});
const byUnit=r=>Object.fromEntries(r.units.map(u=>[u.unit_ref,u]));

pgTest('P06-1: close-out states — unsold, revenue without COGS, released, partially released, unregistered and unclassified',async()=>{
  const ids=await seed('states');
  await approvedProject(ids,[['U-101','SPECIFIC_IDENTIFICATION'],['U-102','SPECIFIC_IDENTIFICATION'],['U-103','SPECIFIC_IDENTIFICATION']]);
  const d=u=>({project_ref:'PRJ-1',unit_ref:u});
  await postPair(ids,'cost-101',{debit:'150100',credit:'111000',amount:600,dims:d('U-101')});
  await postPair(ids,'cost-102',{debit:'150100',credit:'111000',amount:400,dims:d('U-102')});
  await postPair(ids,'cost-103',{debit:'150100',credit:'111000',amount:300,dims:d('U-103')});
  await postPair(ids,'rev-101',{debit:'111000',credit:'400100',amount:900,dims:d('U-101')});
  await postPair(ids,'rev-102',{debit:'111000',credit:'400100',amount:500,dims:d('U-102')});
  // U-101 fully released, U-102 half released, U-103 unsold
  await postPair(ids,'cogs-101',{debit:'500100',credit:'150100',amount:600,dims:d('U-101')});
  await postPair(ids,'cogs-102',{debit:'500100',credit:'150100',amount:150,dims:d('U-102')});
  // an unclassified account carrying the unit dimension must be reported, not guessed
  await postPair(ids,'misc-103',{debit:'610000',credit:'111000',amount:25,dims:d('U-103')});
  // a unit that exists only in the ledger
  await postPair(ids,'ghost',{debit:'150100',credit:'111000',amount:70,dims:d('U-999')});

  const r=await closeout(ids,{periodId:ids.periodId});
  assert.equal(r.schema_version,'UNIT_SALE_CLOSEOUT_V1');assert.equal(r.accounting_authority,'NONE');assert.equal(r.can_release,false);assert.equal(r.can_post,false);
  assert.equal(r.project_status,'APPROVED');assert.equal(r.period_code,'2026-07');
  const u=byUnit(r);
  assert.equal(u['U-101'].state,'CLOSED_OUT');assert.equal(u['U-101'].exception_code,null);
  assert.equal(u['U-101'].capitalized_cost,0);assert.equal(u['U-101'].cogs_released,600);assert.equal(u['U-101'].revenue_recognized,900);assert.equal(u['U-101'].gross_margin,300);
  assert.equal(u['U-102'].state,'PARTIALLY_RELEASED');assert.equal(u['U-102'].exception_code,'CAPITALIZED_COST_REMAINING');assert.equal(u['U-102'].capitalized_cost,250);
  assert.equal(u['U-103'].state,'UNSOLD');assert.equal(u['U-103'].exception_code,'ACCOUNT_CLASSIFICATION_MISSING');assert.equal(u['U-103'].unclassified_line_count,1);
  assert.equal(u['U-999'].exception_code,'UNIT_NOT_REGISTERED');assert.equal(u['U-999'].unit_id,null);assert.equal(u['U-999'].capitalized_cost,70);
  assert.equal(r.units[r.units.length-1].unit_ref,'U-101','clean rows sort last');
  assert.equal(r.totals.unit_count,4);assert.equal(r.totals.exception_count,3);assert.equal(r.totals.closed_out_count,1);
  assert.equal(r.totals.revenue_recognized,1400);assert.equal(r.totals.cogs_released,750);assert.equal(r.totals.gross_margin,650);
  // the totals tie to the ledger for the classified accounts
  const led=(await admin.query("SELECT COALESCE(sum(credit_amount-debit_amount),0)::text rev FROM ledger_line WHERE tenant_id=$1 AND account_code='400100'",[ids.tenantId])).rows[0].rev;
  assert.equal(Number(led),1400);
  // scope and argument guards
  await rejects(()=>kernelFor(ids,'jemaker').readUnitSaleCloseout({tenantId:ids.tenantId,entityId:ids.entityId,projectRef:'PRJ-1'}),'42501');
  await rejects(()=>closeout(ids,{periodId:randomUUID()}),'22023');
  const audits=(await admin.query("SELECT count(*)::int n FROM audit_event WHERE tenant_id=$1 AND event_type LIKE 'UNIT_SALE%'",[ids.tenantId])).rows[0].n;assert.equal(audits,0);
});

pgTest('P06-2: COGS release Draft — guards, never posts, idempotent, reservation of open drafts, and reversal restores the state',async()=>{
  const ids=await seed('release');
  const {units}=await approvedProject(ids,[['U-201','SPECIFIC_IDENTIFICATION'],['U-202','AREA']]);
  const d=u=>({project_ref:'PRJ-1',unit_ref:u});
  await postPair(ids,'cost-201',{debit:'150100',credit:'111000',amount:800,dims:d('U-201')});
  await postPair(ids,'cost-202',{debit:'150100',credit:'111000',amount:500,dims:d('U-202')});
  const release=(unitId,args={})=>{const key=args.idempotencyKey??'p06-rel-1';
    return kernelFor(ids,'releaser').createUnitCogsReleaseDraft({tenantId:ids.tenantId,entityId:ids.entityId,unitId,periodId:ids.periodId,
      journalNumber:`P06-REL-${key}`,journalDate:'2026-07-20',cwipAccountCode:'150100',cogsAccountCode:'500100',amount:'800.0000',reason:'release unit cost on closing',attachmentIds:[ids.attachmentId],...args,idempotencyKey:key});};
  // cost may not be released before revenue exists
  await rejects(()=>release(units['U-201']),'23514',/POSTED revenue/);
  await postPair(ids,'rev-201',{debit:'111000',credit:'400100',amount:1200,dims:d('U-201')});
  await postPair(ids,'rev-202',{debit:'111000',credit:'400100',amount:700,dims:d('U-202')});
  // AREA units have no approved allocation basis → refused, never guessed
  await rejects(()=>release(units['U-202'],{amount:'500.0000',idempotencyKey:'p06-rel-area'}),'23514',/SPECIFIC_IDENTIFICATION/);
  // unclassified target account
  await rejects(()=>release(units['U-201'],{cogsAccountCode:'610000',idempotencyKey:'p06-rel-badacct'}),'23514',/approved COGS classification/);
  await rejects(()=>release(units['U-201'],{cwipAccountCode:'610000',idempotencyKey:'p06-rel-badcwip'}),'23514',/approved CWIP classification/);
  // over-release
  await rejects(()=>release(units['U-201'],{amount:'900.0000',idempotencyKey:'p06-rel-over'}),'23514',/exceeds the remaining capitalised cost/);
  // permission: a plain JE maker may not release
  await rejects(()=>kernelFor(ids,'jemaker').createUnitCogsReleaseDraft({tenantId:ids.tenantId,entityId:ids.entityId,unitId:units['U-201'],periodId:ids.periodId,journalNumber:'P06-REL-X',journalDate:'2026-07-20',cwipAccountCode:'150100',cogsAccountCode:'500100',amount:'100.0000',reason:'release unit cost on closing',attachmentIds:[ids.attachmentId],idempotencyKey:'p06-rel-nope'}),'42501');

  const first=await release(units['U-201'],{amount:'500.0000',idempotencyKey:'p06-rel-500'});
  assert.equal(first.schema_version,'UNIT_COGS_RELEASE_DRAFT_V1');assert.equal(first.status,'DRAFT');assert.equal(first.amount,'500.0000');assert.equal(first.idempotent,false);
  assert.equal(first.available_before,'800.0000');
  const replay=await release(units['U-201'],{amount:'500.0000',idempotencyKey:'p06-rel-500'});
  assert.equal(replay.idempotent,true);assert.equal(replay.journal_entry_id,first.journal_entry_id);
  await rejects(()=>release(units['U-201'],{amount:'400.0000',idempotencyKey:'p06-rel-500'}),'23505');
  // the Draft is not in the ledger and the close-out has not moved
  const ledgerCogs=async()=>Number((await admin.query("SELECT COALESCE(sum(debit_amount-credit_amount),0)::text n FROM ledger_line WHERE tenant_id=$1 AND account_code='500100'",[ids.tenantId])).rows[0].n);
  assert.equal(await ledgerCogs(),0);
  assert.equal(byUnit(await closeout(ids))['U-201'].state,'REVENUE_WITHOUT_COGS');
  // an open Draft reserves the cost: only 300 remains releasable
  await rejects(()=>release(units['U-201'],{amount:'400.0000',idempotencyKey:'p06-rel-second'}),'23514',/available 300\.0000/);
  const second=await release(units['U-201'],{amount:'300.0000',idempotencyKey:'p06-rel-300'});
  // post both releases through the ordinary four-eyes chain
  await postJournalFully(ids,first.journal_entry_id,'rel500');
  await postJournalFully(ids,second.journal_entry_id,'rel300');
  assert.equal(await ledgerCogs(),800);
  const after=byUnit(await closeout(ids))['U-201'];
  assert.equal(after.state,'CLOSED_OUT');assert.equal(after.capitalized_cost,0);assert.equal(after.cogs_released,800);assert.equal(after.gross_margin,400);
  // reversing one release restores capitalised cost and reopens the close-out — no master compensation needed
  const rev=await kernelFor(ids,'reverser').createJournalAdjustment({action:'REVERSAL',tenantId:ids.tenantId,entityId:ids.entityId,originalJournalEntryId:second.journal_entry_id,periodId:ids.periodId,
    journalNumber:'P06-REL-REV',journalDate:'2026-07-25',description:'reverse the over-released portion',reason:'reverse the over-released portion',attachmentIds:[ids.attachmentId],idempotencyKey:'p06-rel-reverse'});
  await postJournalFully(ids,rev.journal_entry_id,'relrev');
  const reopened=byUnit(await closeout(ids))['U-201'];
  assert.equal(reopened.capitalized_cost,300);assert.equal(reopened.cogs_released,500);assert.equal(reopened.state,'PARTIALLY_RELEASED');assert.equal(reopened.exception_code,'CAPITALIZED_COST_REMAINING');
  // and the reversal frees the amount again
  const third=await release(units['U-201'],{amount:'300.0000',idempotencyKey:'p06-rel-again'});
  assert.equal(third.available_before,'300.0000');
  // evidence: one binding per Draft, append-only, with the revenue evidence captured at Draft time
  const bindings=(await admin.query('SELECT amount::text,cwip_account_code,cogs_account_code,revenue_evidence FROM unit_cogs_release_binding WHERE tenant_id=$1 ORDER BY created_at',[ids.tenantId])).rows;
  assert.equal(bindings.length,3);assert.equal(bindings[0].amount,'500.0000');assert.equal(bindings[0].cogs_account_code,'500100');
  assert.equal(bindings[0].revenue_evidence.revenue_recognized,'1200.0000');
  await rejects(()=>admin.query('UPDATE unit_cogs_release_binding SET amount=1 WHERE tenant_id=$1',[ids.tenantId]),'55000');
  const audits=(await admin.query("SELECT count(*)::int n FROM audit_event WHERE tenant_id=$1 AND event_type='UNIT_COGS_RELEASE_DRAFT_CREATED'",[ids.tenantId])).rows[0].n;assert.equal(audits,3);
});
