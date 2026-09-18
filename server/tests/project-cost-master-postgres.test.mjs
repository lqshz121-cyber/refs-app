// P05 — project / cost code / unit masters (migration 429) and the derived cost-layer read.
// Masters are approvable (SoD maker≠approver, CAS revision, idempotent); the cost-layer read
// groups POSTED ledger lines by project_ref/cost_code_ref/unit_ref, classifies CWIP only from an
// APPROVED CWIP_ACCOUNT_CLASSIFICATION mapping, and reports unregistered refs as exceptions.
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
  admin=await createPool({databaseUrl:config.migrationDatabaseUrl,applicationName:'refs-p05-admin',max:2});await admin.query('SELECT 1');await migrateUp(admin,{});
  runtime=await createPool({databaseUrl:config.databaseUrl,applicationName:'refs-p05-runtime',max:6});await runtime.query('SELECT 1');
  issuer=await createPool({databaseUrl:config.contextIssuerDatabaseUrl,applicationName:'refs-p05-issuer',max:2});await issuer.query('SELECT 1');
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

async function seed(tag){
  const tenantId=randomUUID(),entityId=randomUUID(),periodId=randomUUID(),nextPeriodId=randomUUID(),attachmentId=randomUUID();
  await admin.query('INSERT INTO tenant(tenant_id,tenant_code,name) VALUES($1,$2,$3)',[tenantId,`T${tenantId.replaceAll('-','').slice(0,8)}`.toUpperCase(),`p05-${tag}`]);
  await admin.query("INSERT INTO entity(entity_id,tenant_id,entity_code,source_system,source_entity_id,name,base_currency) VALUES($1,$2,'E1','WBS','E1','E1','USD')",[entityId,tenantId]);
  await admin.query("INSERT INTO accounting_period(period_id,tenant_id,entity_id,period_code,starts_on,ends_on,status) VALUES($1,$2,$3,'2026-07','2026-07-01','2026-07-31','OPEN')",[periodId,tenantId,entityId]);
  await admin.query("INSERT INTO accounting_period(period_id,tenant_id,entity_id,period_code,starts_on,ends_on,status) VALUES($1,$2,$3,'2026-08','2026-08-01','2026-08-31','OPEN')",[nextPeriodId,tenantId,entityId]);
  await admin.query(`INSERT INTO account_master(tenant_id,entity_id,account_code,account_name,requires_member,required_member_type) VALUES
    ($1,$2,'150100','Construction in progress',false,NULL),($1,$2,'610000','Repairs',false,NULL),($1,$2,'111000','Operating Cash',true,'BANK')`,[tenantId,entityId]);
  await admin.query("INSERT INTO member_master(tenant_id,entity_id,member_ref,member_type,display_name) VALUES($1,$2,'BANK-1','BANK','Operating bank')",[tenantId,entityId]);
  await admin.query(`INSERT INTO attachment(attachment_id,tenant_id,entity_id,name,media_type,size_bytes,content_hash,storage_ref,storage_version,uploaded_by,uploaded_at,verified_at,scan_status,finalization_status,finalized_at) VALUES($1,$2,$3,'doc.pdf','application/pdf',10,$4,$5,'v1','maker',now(),now(),'CLEAN','VERIFIED_CLEAN',now())`,[attachmentId,tenantId,entityId,hash(attachmentId),`object://attachments/${attachmentId}`]);
  // CWIP classification: only 150100 is CWIP, by explicit APPROVED mapping (077 family).
  const mh=(await admin.query("SELECT refs_jsonb_hash(jsonb_build_object('input_keys',jsonb_build_object('account_code','150100'),'output_rules',jsonb_build_object('classification','CWIP'))) h")).rows[0].h;
  await admin.query(`INSERT INTO mapping_snapshot(mapping_snapshot_id,tenant_id,entity_id,family,scope_type,scope_key,input_key_hash,version,priority,effective_from,effective_to,status,input_keys,output_rules,snapshot_hash,created_by,approved_by,approved_at)
    VALUES($1,$2,$3::uuid,'CWIP_ACCOUNT_CLASSIFICATION','ENTITY',$3::text,$4,1,0,'2026-01-01T00:00:00Z',NULL,'APPROVED',jsonb_build_object('account_code','150100'),jsonb_build_object('classification','CWIP'),$5,'mapping-maker','mapping-approver',now())`,[randomUUID(),tenantId,entityId,hash('cwip-150100'),mh]);
  const ids={tenantId,entityId,periodId,nextPeriodId,attachmentId};
  for(const [a,p] of [['pmaker','PROJECT.MASTER.CREATE'],['papprover','PROJECT.MASTER.APPROVE'],['pviewer','PROJECT.MASTER.VIEW'],['reporter','GL.REPORT.VIEW'],
    ['jemaker','GL.JE.CREATE'],['submitter','GL.JE.SUBMIT'],['reviewer','GL.JE.REVIEW'],['approver','GL.JE.APPROVE'],['poster','GL.JE.POST']])await grant(ids,a,p);
  return ids;
}
async function postJournalFully(ids,journalEntryId,tag){
  await kernelFor(ids,'submitter').transitionJournal({tenantId:ids.tenantId,entityId:ids.entityId,journalEntryId,action:'SUBMIT',expectedRevision:0,idempotencyKey:`p05-sub-${tag}`});
  await kernelFor(ids,'reviewer').transitionJournal({tenantId:ids.tenantId,entityId:ids.entityId,journalEntryId,action:'REVIEW',expectedRevision:1,idempotencyKey:`p05-rev-${tag}`});
  await kernelFor(ids,'approver').transitionJournal({tenantId:ids.tenantId,entityId:ids.entityId,journalEntryId,action:'APPROVE',expectedRevision:2,idempotencyKey:`p05-app-${tag}`});
  await kernelFor(ids,'poster').postJournal({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId,journalEntryId,expectedRevision:3,idempotencyKey:`p05-post-${tag}`});
}
async function postCost(ids,tag,{account='150100',amount,dims,date='2026-07-10'}){
  const lines=[{line_no:1,account_code:account,debit_amount:amount,credit_amount:0,member_ref:null,dimensions:dims},{line_no:2,account_code:'111000',debit_amount:0,credit_amount:amount,member_ref:'BANK-1',dimensions:{}}];
  const je=await kernelFor(ids,'jemaker').createManualJournal({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId,journalNumber:`P05-${tag}`,journalDate:date,currency:'USD',description:`project cost ${tag}`,attachmentIds:[ids.attachmentId],idempotencyKey:`p05-je-${tag}`,lines});
  await postJournalFully(ids,je.journal_entry_id,tag);return je.journal_entry_id;
}
const rejects=async(fn,code,re)=>{try{await fn();assert.fail('expected rejection '+code);}catch(e){assert.equal(e.code,code,e.message);if(re)assert.match(e.message,re);}};
function pgTest(name,fn){test(name,async t=>{if(unavailable){t.skip(unavailable);return;}await fn(t);});}

const K={project:'PROJECT',cc:'COST_CODE',unit:'UNIT'};
const create=(ids,args)=>kernelFor(ids,'pmaker').createProjectMaster({tenantId:ids.tenantId,entityId:ids.entityId,projectRef:'PRJ-1',projectName:'Riverside Phase 1',projectType:'DEVELOPMENT',capitalizationPolicy:'CWIP_UNTIL_COMPLETION',reason:'register development project',idempotencyKey:'p05-prj-1',...args});
const transition=(ids,actor,args)=>kernelFor(ids,actor).transitionProjectMaster({tenantId:ids.tenantId,entityId:ids.entityId,reason:'approve master data',...args});

pgTest('P05-1: masters — SoD, CAS, idempotency, approval prerequisite and retire guard',async()=>{
  const ids=await seed('masters');
  const prj=await create(ids,{});
  assert.equal(prj.schema_version,'PROJECT_MASTER_V1');assert.equal(prj.status,'DRAFT');assert.equal(prj.revision,0);assert.equal(prj.idempotent,false);
  const replay=await create(ids,{});assert.equal(replay.idempotent,true);assert.equal(replay.project_id,prj.project_id);
  await rejects(()=>create(ids,{projectName:'Different'}),'23505');                                   // same key, different payload
  await rejects(()=>create(ids,{idempotencyKey:'p05-prj-dup'}),'23505');                               // same ref twice → unique
  await rejects(()=>kernelFor(ids,'papprover').createProjectMaster({tenantId:ids.tenantId,entityId:ids.entityId,projectRef:'PRJ-X',projectName:'x',projectType:'OTHER',capitalizationPolicy:'EXPENSE_AS_INCURRED',reason:'no create permission here',idempotencyKey:'p05-prj-x'}),'42501');
  // cost codes and units need an APPROVED project
  await rejects(()=>kernelFor(ids,'pmaker').createProjectCostCode({tenantId:ids.tenantId,entityId:ids.entityId,projectId:prj.project_id,costCodeRef:'01-LAND',costCodeName:'Land',costCategory:'LAND',capitalizable:true,reason:'land cost code',idempotencyKey:'p05-cc-early'}),'23514',/APPROVED project/);
  // SoD: the maker cannot approve even when granted the approve permission (same authority class conflict is a separate 274 control; here we test the function guard)
  await grant(ids,'pmaker','PROJECT.MASTER.APPROVE').catch(()=>{});
  const makerApprove=transition(ids,'pmaker',{objectType:K.project,objectId:prj.project_id,expectedRevision:0,event:'APPROVED',idempotencyKey:'p05-appr-self'});
  await rejects(()=>makerApprove,'42501');
  await admin.query("UPDATE runtime_actor_grant SET revoked_at=clock_timestamp() WHERE tenant_id=$1 AND actor_id='pmaker' AND permission='PROJECT.MASTER.APPROVE'",[ids.tenantId]);
  await rejects(()=>transition(ids,'papprover',{objectType:K.project,objectId:prj.project_id,expectedRevision:5,event:'APPROVED',idempotencyKey:'p05-appr-stale'}),'40001');
  await rejects(()=>transition(ids,'papprover',{objectType:K.project,objectId:prj.project_id,expectedRevision:0,event:'RETIRED',idempotencyKey:'p05-ret-draft'}),'23514');
  const approved=await transition(ids,'papprover',{objectType:K.project,objectId:prj.project_id,expectedRevision:0,event:'APPROVED',idempotencyKey:'p05-appr-1'});
  assert.equal(approved.status,'APPROVED');assert.equal(approved.revision,1);assert.equal(approved.approved_by,'papprover');
  const cc=await kernelFor(ids,'pmaker').createProjectCostCode({tenantId:ids.tenantId,entityId:ids.entityId,projectId:prj.project_id,costCodeRef:'01-LAND',costCodeName:'Land',costCategory:'LAND',capitalizable:true,reason:'land cost code',idempotencyKey:'p05-cc-1'});
  const unit=await kernelFor(ids,'pmaker').createProjectUnit({tenantId:ids.tenantId,entityId:ids.entityId,projectId:prj.project_id,unitRef:'U-101',unitName:'Unit 101',allocationBasis:'AREA',allocationWeight:'1250.5',reason:'unit 101 by area',idempotencyKey:'p05-unit-1'});
  assert.equal(cc.status,'DRAFT');assert.equal(unit.status,'DRAFT');assert.equal(unit.allocation_weight,1250.5);
  await transition(ids,'papprover',{objectType:K.cc,objectId:cc.cost_code_id,expectedRevision:0,event:'APPROVED',idempotencyKey:'p05-appr-cc'});
  // project cannot retire while an APPROVED cost code lives under it
  await rejects(()=>transition(ids,'papprover',{objectType:K.project,objectId:prj.project_id,expectedRevision:1,event:'RETIRED',idempotencyKey:'p05-ret-live'}),'23514',/Retire APPROVED/);
  const read=await kernelFor(ids,'pviewer').readProjectMasters({tenantId:ids.tenantId,entityId:ids.entityId});
  assert.equal(read.accounting_authority,'NONE');assert.equal(read.projects.length,1);assert.equal(read.projects[0].cost_codes[0].status,'APPROVED');assert.equal(read.projects[0].units[0].status,'DRAFT');
  await rejects(()=>kernelFor(ids,'jemaker').readProjectMasters({tenantId:ids.tenantId,entityId:ids.entityId}),'42501');
  // lineage: every command left an append-only event + audit row; events cannot be edited
  const ev=(await admin.query("SELECT event_type,object_type FROM project_master_event WHERE tenant_id=$1 ORDER BY recorded_at",[ids.tenantId])).rows.map(r=>`${r.object_type}:${r.event_type}`);
  assert.deepEqual(ev,['PROJECT:CREATED','PROJECT:APPROVED','COST_CODE:CREATED','UNIT:CREATED','COST_CODE:APPROVED']);
  await rejects(()=>admin.query('DELETE FROM project_master_event WHERE tenant_id=$1',[ids.tenantId]),'55000');
  const audits=(await admin.query("SELECT count(*)::int n FROM audit_event WHERE tenant_id=$1 AND event_type LIKE 'PROJECT_MASTER_%'",[ids.tenantId])).rows[0].n;assert.equal(audits,5);
});

pgTest('P05-2: cost layers — CWIP only by approved mapping, unregistered refs are exceptions, period bound, no accounting authority',async()=>{
  const ids=await seed('layers');
  const prj=await create(ids,{});
  await transition(ids,'papprover',{objectType:K.project,objectId:prj.project_id,expectedRevision:0,event:'APPROVED',idempotencyKey:'p05-appr-2'});
  const mk=(ref,name,cat,cap,key)=>kernelFor(ids,'pmaker').createProjectCostCode({tenantId:ids.tenantId,entityId:ids.entityId,projectId:prj.project_id,costCodeRef:ref,costCodeName:name,costCategory:cat,capitalizable:cap,reason:`cost code ${ref}`,idempotencyKey:key});
  const land=await mk('01-LAND','Land','LAND',true,'p05-cc-land'),mkt=await mk('90-MKT','Marketing','MARKETING',false,'p05-cc-mkt');
  for(const [c,k] of [[land,'a'],[mkt,'b']])await transition(ids,'papprover',{objectType:K.cc,objectId:c.cost_code_id,expectedRevision:0,event:'APPROVED',idempotencyKey:`p05-appr-cc-${k}`});
  const u=await kernelFor(ids,'pmaker').createProjectUnit({tenantId:ids.tenantId,entityId:ids.entityId,projectId:prj.project_id,unitRef:'U-101',unitName:'Unit 101',allocationBasis:'AREA',allocationWeight:'1000',reason:'unit 101 by area',idempotencyKey:'p05-unit-2'});
  await transition(ids,'papprover',{objectType:K.unit,objectId:u.unit_id,expectedRevision:0,event:'APPROVED',idempotencyKey:'p05-appr-u'});

  await postCost(ids,'land-1',{amount:500,dims:{project_ref:'PRJ-1',cost_code_ref:'01-LAND'}});
  await postCost(ids,'land-u101',{amount:200,dims:{project_ref:'PRJ-1',cost_code_ref:'01-LAND',unit_ref:'U-101'}});
  await postCost(ids,'mkt-cwip',{amount:70,dims:{project_ref:'PRJ-1',cost_code_ref:'90-MKT'}});                       // CWIP account on a non-capitalizable code → exception
  await postCost(ids,'mkt-exp',{account:'610000',amount:30,dims:{project_ref:'PRJ-1',cost_code_ref:'90-MKT'}});         // expense account → NON_CWIP, clean
  await postCost(ids,'unreg',{amount:40,dims:{project_ref:'PRJ-1',cost_code_ref:'99-UNKNOWN'}});                       // cost code not registered
  await postCost(ids,'nocode',{amount:10,dims:{project_ref:'PRJ-1'}});                                                 // cost code missing
  await postCost(ids,'late',{amount:60,dims:{project_ref:'PRJ-1',cost_code_ref:'01-LAND'},date:'2026-07-31'});
  // draft (not posted) cost must never appear
  await kernelFor(ids,'jemaker').createManualJournal({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId,journalNumber:'P05-DRAFT',journalDate:'2026-07-12',currency:'USD',description:'draft only cost',attachmentIds:[ids.attachmentId],idempotencyKey:'p05-je-draft',
    lines:[{line_no:1,account_code:'150100',debit_amount:9999,credit_amount:0,member_ref:null,dimensions:{project_ref:'PRJ-1',cost_code_ref:'01-LAND'}},{line_no:2,account_code:'111000',debit_amount:0,credit_amount:9999,member_ref:'BANK-1',dimensions:{}}]});

  const r=await kernelFor(ids,'reporter').readProjectCostLayers({tenantId:ids.tenantId,entityId:ids.entityId,projectRef:'PRJ-1',periodId:ids.periodId});
  assert.equal(r.schema_version,'PROJECT_COST_LAYERS_V1');assert.equal(r.accounting_authority,'NONE');assert.equal(r.can_capitalize,false);assert.equal(r.can_transfer,false);assert.equal(r.can_post,false);
  assert.equal(r.project_status,'APPROVED');assert.equal(r.capitalization_policy,'CWIP_UNTIL_COMPLETION');assert.equal(r.period_code,'2026-07');
  const key=l=>`${l.cost_code_ref??'-'}|${l.unit_ref??'-'}|${l.account_code}`;
  const by=Object.fromEntries(r.layers.map(l=>[key(l),l]));
  assert.equal(by['01-LAND|-|150100'].net_amount,560);assert.equal(by['01-LAND|-|150100'].layer_class,'CWIP');assert.equal(by['01-LAND|-|150100'].exception_code,null);assert.equal(by['01-LAND|-|150100'].journal_entry_count,2);
  assert.equal(by['01-LAND|U-101|150100'].net_amount,200);assert.equal(by['01-LAND|U-101|150100'].unit_status,'APPROVED');assert.equal(by['01-LAND|U-101|150100'].exception_code,null);
  assert.equal(by['90-MKT|-|150100'].exception_code,'CWIP_ON_NON_CAPITALIZABLE_CODE');
  assert.equal(by['90-MKT|-|610000'].layer_class,'NON_CWIP');assert.equal(by['90-MKT|-|610000'].exception_code,null);
  assert.equal(by['99-UNKNOWN|-|150100'].exception_code,'COST_CODE_NOT_APPROVED');
  assert.equal(by['-|-|150100'].exception_code,'COST_CODE_MISSING');
  assert.equal(r.layers.findIndex(l=>l.exception_code===null),3,'exceptions sort first');
  assert.equal(r.totals.layer_count,6);assert.equal(r.totals.exception_count,3);assert.equal(r.totals.cwip_net,880);assert.equal(r.totals.non_cwip_net,30);
  // totals reconcile to the ledger: CWIP account net for PRJ-1 = 500+200+70+40+10+60 = 880
  const ledger=(await admin.query("SELECT sum(debit_amount-credit_amount)::text n FROM ledger_line WHERE tenant_id=$1 AND account_code='150100' AND dimensions->>'project_ref'='PRJ-1'",[ids.tenantId])).rows[0].n;assert.equal(ledger,'880.0000');
  // a project that nobody registered is still readable, every layer flagged PROJECT_NOT_REGISTERED
  await postCost(ids,'ghost',{amount:15,dims:{project_ref:'GHOST',cost_code_ref:'01-LAND'}});
  const g=await kernelFor(ids,'reporter').readProjectCostLayers({tenantId:ids.tenantId,entityId:ids.entityId,projectRef:'GHOST'});
  assert.equal(g.project_id,null);assert.equal(g.layers.length,1);assert.equal(g.layers[0].exception_code,'PROJECT_NOT_REGISTERED');assert.equal(g.as_of,null);
  // period bound: a period whose end precedes every posting yields no layers; foreign period id rejected
  await admin.query("INSERT INTO accounting_period(period_id,tenant_id,entity_id,period_code,starts_on,ends_on,status) VALUES($1,$2,$3,'2026-06','2026-06-01','2026-06-30','OPEN')",[randomUUID(),ids.tenantId,ids.entityId]);
  const early=(await admin.query("SELECT period_id FROM accounting_period WHERE tenant_id=$1 AND period_code='2026-06'",[ids.tenantId])).rows[0].period_id;
  const e=await kernelFor(ids,'reporter').readProjectCostLayers({tenantId:ids.tenantId,entityId:ids.entityId,projectRef:'PRJ-1',periodId:early});
  assert.equal(e.layers.length,0);assert.equal(e.totals.layer_count,0);assert.equal(e.totals.cwip_net,0);
  await rejects(()=>kernelFor(ids,'reporter').readProjectCostLayers({tenantId:ids.tenantId,entityId:ids.entityId,projectRef:'PRJ-1',periodId:randomUUID()}),'22023');
  await rejects(()=>kernelFor(ids,'pviewer').readProjectCostLayers({tenantId:ids.tenantId,entityId:ids.entityId,projectRef:'PRJ-1'}),'42501');
  // read is side-effect free
  const audits=(await admin.query("SELECT count(*)::int n FROM audit_event WHERE tenant_id=$1 AND event_type LIKE 'PROJECT_COST%'",[ids.tenantId])).rows[0].n;assert.equal(audits,0);
});
