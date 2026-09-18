// P08 — the missing impairment posting path (migration 432). 242 records an independently reviewed
// assessment, 243 reconciles POSTED impairment lines against it, and until now nothing could create
// the journal in between. The Draft takes its amount from the assessment and never posts.
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
  admin=await createPool({databaseUrl:config.migrationDatabaseUrl,applicationName:'refs-p08-admin',max:2});await admin.query('SELECT 1');await migrateUp(admin,{});
  runtime=await createPool({databaseUrl:config.databaseUrl,applicationName:'refs-p08-runtime',max:6});await runtime.query('SELECT 1');
  issuer=await createPool({databaseUrl:config.contextIssuerDatabaseUrl,applicationName:'refs-p08-issuer',max:2});await issuer.query('SELECT 1');
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
const rejects=async(fn,code,re)=>{try{await fn();assert.fail('expected rejection '+code);}catch(e){assert.equal(e.code,code,e.message);if(re)assert.match(e.message,re);}};
function pgTest(name,fn){test(name,async t=>{if(unavailable){t.skip(unavailable);return;}await fn(t);});}

// Minimal evidence chain: source document/line -> classification evidence -> capitalization proposal
// -> register evidence -> impairment assessment. Built with the migrator role; the point of the test
// is the command under 432, not the upstream review commands that already have their own coverage.
async function seed(tag,{status='ACTIVE',loss=true,assessmentStatus='INDEPENDENTLY_REVIEWED'}={}){
  const tenantId=randomUUID(),entityId=randomUUID(),periodId=randomUUID(),attachmentId=randomUUID();
  const batchId=randomUUID(),rawId=randomUUID(),documentId=randomUUID(),lineId=randomUUID(),classId=randomUUID(),proposalId=randomUUID(),registerId=randomUUID(),settingId=randomUUID(),assessmentId=randomUUID();
  await admin.query('INSERT INTO tenant(tenant_id,tenant_code,name) VALUES($1,$2,$3)',[tenantId,`T${tenantId.replaceAll('-','').slice(0,8)}`.toUpperCase(),`p08-${tag}`]);
  await admin.query("INSERT INTO entity(entity_id,tenant_id,entity_code,source_system,source_entity_id,name,base_currency) VALUES($1,$2,'E1','WBS','E1','E1','USD')",[entityId,tenantId]);
  await admin.query("INSERT INTO accounting_period(period_id,tenant_id,entity_id,period_code,starts_on,ends_on,status) VALUES($1,$2,$3,'2026-07','2026-07-01','2026-07-31','OPEN')",[periodId,tenantId,entityId]);
  await admin.query(`INSERT INTO account_master(tenant_id,entity_id,account_code,account_name,requires_member,required_member_type) VALUES
    ($1,$2,'170100','Buildings',false,NULL),($1,$2,'179100','Accumulated depreciation',false,NULL),($1,$2,'159200','Accumulated impairment',false,NULL),
    ($1,$2,'680200','Impairment loss',false,NULL),($1,$2,'291001','Accounts payable',true,'VENDOR'),($1,$2,'111000','Operating Cash',true,'BANK')`,[tenantId,entityId]);
  await admin.query(`INSERT INTO member_master(tenant_id,entity_id,member_ref,member_type,display_name) VALUES($1,$2,'VENDOR-1','VENDOR','Builder'),($1,$2,'BANK-1','BANK','Operating bank')`,[tenantId,entityId]);
  await admin.query(`INSERT INTO attachment(attachment_id,tenant_id,entity_id,name,media_type,size_bytes,content_hash,storage_ref,storage_version,uploaded_by,uploaded_at,verified_at,scan_status,finalization_status,finalized_at) VALUES($1,$2,$3,'valuation.pdf','application/pdf',10,$4,$5,'v1','maker',now(),now(),'CLEAN','VERIFIED_CLEAN',now())`,[attachmentId,tenantId,entityId,hash(attachmentId),`object://attachments/${attachmentId}`]);
  await admin.query("INSERT INTO import_batch(import_batch_id,tenant_id,entity_id,connector_code,source_module,source_entity_id,idempotency_key,request_hash) VALUES($1,$2,$3,'WBS_API','payable','E1',$4,$5)",[batchId,tenantId,entityId,'p08-'+tag,hash('batch'+tag)]);
  await admin.query(`INSERT INTO raw_event(raw_event_id,tenant_id,entity_id,import_batch_id,source_system,source_module,source_entity_id,source_record_id,source_version,event_type,occurred_at,payload_hash,payload_ref,correlation_id)
    VALUES($1,$2,$3,$4,'WBS','payable','E1',$5,'1','UPSERT',now(),$6,$7,$5)`,[rawId,tenantId,entityId,batchId,'REC-'+tag,hash('raw'+tag),`object://raw/${rawId}`]);
  await admin.query(`INSERT INTO source_document(source_document_id,tenant_id,entity_id,raw_event_id,source_system,source_module,source_entity_id,source_record_id,source_version,document_type,business_date,accounting_date,currency,gross_amount,source_ref,payload_hash)
    VALUES($1,$2,$3,$4,'WBS','payable','E1',$5,'1','VENDOR_INVOICE','2026-07-01','2026-07-01','USD',30000,$6,$7)`,[documentId,tenantId,entityId,rawId,'REC-'+tag,`WBS:REC-${tag}`,hash('doc'+tag)]);
  await admin.query(`INSERT INTO source_document_line(source_document_line_id,tenant_id,entity_id,source_document_id,line_no,source_line_id,amount,direction,party_ref,project_ref,property_ref)
    VALUES($1,$2,$3,$4,1,$5,30000,'DEBIT','VENDOR-1','PRJ-1','PROP-1')`,[lineId,tenantId,entityId,documentId,'L-'+tag]);
  await admin.query(`INSERT INTO setting_snapshot(setting_snapshot_id,tenant_id,entity_id,family,scope_type,scope_key,version,effective_from,effective_to,status,snapshot,snapshot_hash,created_by,approved_by,approved_at)
    VALUES($1,$2,$3::uuid,'AI_POLICY','ENTITY',$3::text,1,'2026-01-01T00:00:00Z',NULL,'APPROVED','{}',(SELECT refs_jsonb_hash('{}'::jsonb)),'m','a',now())`,[settingId,tenantId,entityId]);
  await admin.query(`INSERT INTO ai_invoice_accounting_classification_evidence(ai_invoice_accounting_classification_evidence_id,tenant_id,entity_id,accounting_period_id,source_document_id,source_document_line_id,source_payload_hash,source_line_hash,classifier_version,classification,reason,confidence,required_human_fields,rule_id,policy_snapshot_id,policy_snapshot_hash,policy_evidence,classification_hash,status,created_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,'AI_INVOICE_ACCOUNTING_CLASSIFICATION_V2','CAPITALIZATION_REVIEW','Fixture classification for the impairment Draft test',0.9900,'[]'::jsonb,'R-CAP-1',$9,$10,'{}'::jsonb,$11,'CLASSIFIED','ai-service')`,
    [classId,tenantId,entityId,periodId,documentId,lineId,hash('doc'+tag),hash('line'+tag),settingId,hash('policy'+tag),hash('class'+tag)]);
  await admin.query(`INSERT INTO ai_invoice_capitalization_proposal(ai_invoice_capitalization_proposal_id,tenant_id,entity_id,ai_invoice_accounting_classification_evidence_id,classification_hash,source_document_id,source_document_line_id,source_payload_hash,source_line_hash,accounting_period_id,capitalization_treatment,asset_account_code,liability_account_code,asset_class,currency,amount,member_trace,placed_in_service_date,useful_life_months,rule_id,policy_snapshot_id,policy_snapshot_hash,confidence,proposal_reason,proposal_hash,created_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'FIXED_ASSET','170100','291001','BUILDING','USD',30000,$11,'2026-07-01',120,'AI_CAPITALIZATION_POLICY_V1',$12,$13,0.9900,'Fixture capitalization proposal for the impairment Draft test',$14,'ai-service')`,
    [proposalId,tenantId,entityId,classId,hash('class'+tag),documentId,lineId,hash('doc'+tag),hash('line'+tag),periodId,JSON.stringify({project_ref:'PRJ-1',property_ref:'PROP-1',allocation_basis:'SPECIFIC'}),settingId,hash('policy'+tag),hash('proposal'+tag)]);
  await admin.query(`INSERT INTO fixed_asset_register_evidence(fixed_asset_register_evidence_id,tenant_id,entity_id,capitalization_proposal_id,source_document_id,source_payload_hash,asset_tag,asset_class,currency,cost_basis,salvage_value,placed_in_service_date,useful_life_months,depreciation_method,depreciation_convention,asset_account_code,accumulated_depreciation_account_code,depreciation_expense_account_code,member_trace,status,reviewed_by,review_reason,register_evidence_hash)
    VALUES($1,$2,$3,$4,$5,$6,$7,'BUILDING','USD',30000,0,'2026-07-01',120,'STRAIGHT_LINE','FULL_MONTH','170100','179100','680100',$8,$9,'register-reviewer','Fixture register review for the impairment Draft test',$10)`,
    [registerId,tenantId,entityId,proposalId,documentId,hash('doc'+tag),'ASSET-'+tag,JSON.stringify({project_ref:'PRJ-1',property_ref:'PROP-1',allocation_basis:'SPECIFIC'}),status,hash('register'+tag)]);
  const carrying=30000,recoverable=loss?25000:30000,impairment=Math.max(carrying-recoverable,0);
  await admin.query(`INSERT INTO fixed_asset_impairment_assessment_evidence(fixed_asset_impairment_assessment_evidence_id,tenant_id,entity_id,fixed_asset_register_evidence_id,accounting_period_id,valuation_source_document_id,valuation_source_payload_hash,assessment_date,currency,posted_carrying_value,recoverable_amount,impairment_loss,impairment_expense_account_code,accumulated_impairment_account_code,journal_entry_ids,journal_line_ids,ledger_line_ids,reviewed_by,review_reason,impairment_assessment_hash,status)
    VALUES($1,$2,$3,$4,$5,$6,$7,'2026-07-20','USD',$8,$9,$10,'680200','159200',ARRAY[$11::uuid],ARRAY[$12::uuid],ARRAY[$13::uuid],'impairment-reviewer','Fixture independent valuation for the impairment Draft test',$14,$15)`,
    [assessmentId,tenantId,entityId,registerId,periodId,documentId,hash('doc'+tag),carrying,recoverable,impairment,randomUUID(),randomUUID(),randomUUID(),hash('assessment'+tag),assessmentStatus]);
  const ids={tenantId,entityId,periodId,attachmentId,registerId,assessmentId,assessmentHash:hash('assessment'+tag),impairment};
  for(const [a,p] of [['impmaker','FIXED_ASSET.IMPAIRMENT.DRAFT'],['submitter','GL.JE.SUBMIT'],['reviewer','GL.JE.REVIEW'],['approver','GL.JE.APPROVE'],['poster','GL.JE.POST'],['analyst','AI.ANALYSIS.EXPLAIN']])await grant(ids,a,p);
  await grant(ids,'impmaker','GL.JE.CREATE');
  await grant(ids,'impairment-reviewer','FIXED_ASSET.IMPAIRMENT.DRAFT');await grant(ids,'impairment-reviewer','GL.JE.CREATE');
  return ids;
}
const draft=(ids,actor,args={})=>kernelFor(ids,actor).createFixedAssetImpairmentDraft({tenantId:ids.tenantId,entityId:ids.entityId,
  impairmentAssessmentEvidenceId:ids.assessmentId,journalNumber:'P08-IMP-1',journalDate:'2026-07-20',expectedAssessmentHash:ids.assessmentHash,
  reason:'book the independently reviewed impairment',attachmentIds:[ids.attachmentId],idempotencyKey:'p08-imp-1',...args});

pgTest('P08-1: the impairment Draft is bound to the reviewed assessment and refuses every unsound case',async()=>{
  const ids=await seed('guards');
  await rejects(()=>draft(ids,'impmaker',{expectedAssessmentHash:hash('stale'),idempotencyKey:'p08-imp-stale'}),'40001',/assessment changed/);
  await rejects(()=>draft(ids,'impairment-reviewer',{idempotencyKey:'p08-imp-self'}),'42501',/reviewer and Draft maker/);
  await rejects(()=>draft(ids,'submitter',{idempotencyKey:'p08-imp-noperm'}),'42501');
  await rejects(()=>kernelFor(ids,'impmaker').createFixedAssetImpairmentDraft({tenantId:ids.tenantId,entityId:ids.entityId,impairmentAssessmentEvidenceId:randomUUID(),journalNumber:'P08-IMP-X',journalDate:'2026-07-20',expectedAssessmentHash:ids.assessmentHash,reason:'book the independently reviewed impairment',attachmentIds:[ids.attachmentId],idempotencyKey:'p08-imp-missing'}),'P0002');
  // no loss recorded
  const none=await seed('noloss',{loss:false});
  await rejects(()=>draft(none,'impmaker',{idempotencyKey:'p08-imp-zero'}),'23514',/no impairment loss/);
  // The ACTIVE guard in 432 is defence in depth: 236 constrains the register
  // status to ACTIVE only, so a non-ACTIVE register row cannot exist at all.
  // Pin that, and pin that the assessment must be independently reviewed.
  await rejects(()=>seed('retired',{status:'RETIRED'}),'23514');
  await rejects(()=>seed('unreviewed',{assessmentStatus:'DRAFT'}),'23514');
});

pgTest('P08-2: the Draft carries both assessment dimensions, never posts, is idempotent, and closes the 242-243 loop once posted',async()=>{
  const ids=await seed('loop');
  const receipt=await draft(ids,'impmaker');
  assert.equal(receipt.schema_version,'FIXED_ASSET_IMPAIRMENT_DRAFT_V1');assert.equal(receipt.status,'DRAFT');
  assert.equal(receipt.impairment_loss,'5000.0000');assert.equal(receipt.impairment_assessment_hash,ids.assessmentHash);assert.equal(receipt.idempotent,false);
  assert.equal((await draft(ids,'impmaker')).idempotent,true);
  await rejects(()=>draft(ids,'impmaker',{journalNumber:'P08-IMP-2',idempotencyKey:'p08-imp-second'}),'23505');
  const ledger=async code=>Number((await admin.query('SELECT COALESCE(sum(debit_amount-credit_amount),0)::text n FROM ledger_line WHERE tenant_id=$1 AND account_code=$2',[ids.tenantId,code])).rows[0].n);
  assert.equal(await ledger('680200'),0,'a Draft is not in the ledger');
  const lines=(await admin.query('SELECT account_code,debit_amount::text d,credit_amount::text c,dimensions FROM journal_line WHERE journal_entry_id=$1 ORDER BY line_no',[receipt.journal_entry_id])).rows;
  assert.equal(lines.length,2);
  assert.deepEqual([lines[0].account_code,lines[0].d],['680200','5000.0000']);
  assert.deepEqual([lines[1].account_code,lines[1].c],['159200','5000.0000']);
  for(const row of lines){
    assert.equal(row.dimensions.impairment_assessment_evidence_id,ids.assessmentId,'243 keys on the short spelling');
    assert.equal(row.dimensions.fixed_asset_impairment_assessment_evidence_id,ids.assessmentId,'the rest of the module keys on the long spelling');
    assert.equal(row.dimensions.fixed_asset_register_evidence_id,ids.registerId);
    assert.equal(row.dimensions.project_ref,'PRJ-1');assert.equal(row.dimensions.property_ref,'PROP-1');
  }
  // before posting, 243 reports the assessment as unposted
  const reconcile=async()=>{const rows=(await runtime.query('SELECT 1')).rows;assert.ok(rows);
    const k=kernelFor(ids,'analyst');
    return k.inSession(async client=>(await client.query('SELECT refs_read_ai_fixed_asset_impairment_posted_reconciliation($1,$2,$3) AS row',[ids.tenantId,ids.entityId,ids.periodId])).rows.map(r=>r.row));};
  let recon=await reconcile();
  assert.equal(recon.length,1);assert.equal(recon[0].expected_impairment_loss,'5000.0000');
  assert.equal(Number(recon[0].posted_impairment_expense??0),0,'nothing posted yet');
  // post through the ordinary four-eyes chain
  for(const [action,rev,actor] of [['SUBMIT',0,'submitter'],['REVIEW',1,'reviewer'],['APPROVE',2,'approver']])
    await kernelFor(ids,actor).transitionJournal({tenantId:ids.tenantId,entityId:ids.entityId,journalEntryId:receipt.journal_entry_id,action,expectedRevision:rev,idempotencyKey:`p08-${action}`});
  await kernelFor(ids,'poster').postJournal({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId,journalEntryId:receipt.journal_entry_id,expectedRevision:3,idempotencyKey:'p08-post'});
  assert.equal(await ledger('680200'),5000);assert.equal(await ledger('159200'),-5000);
  recon=await reconcile();
  assert.equal(recon[0].posted_impairment_expense,'5000.0000','243 now matches the Draft it could never see before');
  assert.equal(recon[0].posted_accumulated_impairment,'5000.0000');
  // a second Draft after posting is refused twice over: unique binding and the posted-ledger guard
  const fresh=await seed('posted');
  await admin.query(`UPDATE fixed_asset_impairment_draft_binding SET created_at=created_at WHERE false`);
  const b=(await admin.query('SELECT impairment_loss::text l,impairment_assessment_hash h FROM fixed_asset_impairment_draft_binding WHERE tenant_id=$1',[ids.tenantId])).rows;
  assert.equal(b.length,1);assert.equal(b[0].l,'5000.0000');assert.equal(b[0].h,ids.assessmentHash);
  await rejects(()=>admin.query('UPDATE fixed_asset_impairment_draft_binding SET impairment_loss=1 WHERE tenant_id=$1',[ids.tenantId]),'55000');
  const audits=(await admin.query("SELECT count(*)::int n FROM audit_event WHERE tenant_id=$1 AND event_type='FIXED_ASSET_IMPAIRMENT_DRAFT_CREATED'",[ids.tenantId])).rows[0].n;
  assert.equal(audits,1);
  assert.ok(fresh.assessmentId);
});
