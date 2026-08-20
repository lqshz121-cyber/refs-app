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
import {createWbsTestImportService,reconcileWbsTestImportActorGrants} from '../runtime/wbs-test-import-service.mjs';
import {createControlledTestBankWorkflowService} from '../runtime/controlled-test-bank-workflow-service.mjs';
import {createControlledTestBankMatchService} from '../runtime/controlled-test-bank-match-service.mjs';
import {STAGE1_CONTROLLED_TEST_WORKFLOW_PERMISSIONS,STAGE1_READ_PERMISSIONS,STAGE1_WBS_OPERATOR_PERMISSIONS,grantStage1ReadAccess,provisionStage1Scope,stage1GrantConfig,stage1ProvisionConfig,upgradeStage1ControlledTestWorkflowAccess,upgradeStage1WbsOperatorAccess,upgradeStage1WbsReadAccess} from '../runtime/stage1-bootstrap.mjs';
import {AttachmentEvidenceService,AttachmentCleanupService} from '../runtime/attachment-storage.mjs';
import {MIGRATION_MANIFEST} from '../runtime/migration-manifest.mjs';
import {canonicalRequestBody,canonicalRequestHash} from '../runtime/request-hash.mjs';
import {createWbsManifestSignatureVerifier,createWbsSnapshotSignatureVerifier} from '../runtime/wbs-snapshot-signature.mjs';
import {createWbsAutoRecTransitionContractVerifier} from '../runtime/wbs-autorec-transition-contract.mjs';
import {createWbsTraceRelationOrchestrator} from '../runtime/wbs-mcp-inbound-service.mjs';
import {buildWbsAutoRecExecutionIntent} from '../runtime/wbs-autorec-execution-contract.mjs';
import {createProductionAccountingServer} from '../runtime/accounting-server.mjs';
import {OidcJwtAuthenticator,REFS_TENANT_CLAIM} from '../api/oidc-authenticator.mjs';
import {buildWbsMcpReadonlySnapshot} from '../runtime/wbs-mcp-inbound-lineage.mjs';
import {createSyntheticWbsSignedDelivery} from './helpers/synthetic-wbs-signed-delivery.mjs';
import {createWbsProviderSignedPayableAdmission} from '../runtime/wbs-provider-signed-payable-admission.mjs';
import {createWbsAdmittedPayableIngestion} from '../runtime/wbs-admitted-payable-ingestion.mjs';
import {normalizeWbsCompanyCatalogCandidate,wbsCompanyCatalogCanonicalHash,normalizeWbsCompanyClassification} from '../runtime/wbs-company-catalog-controller.mjs';
import {createWbsAdmittedCostCwipIngestion} from '../runtime/wbs-admitted-cost-cwip-ingestion.mjs';
import {createAiInvoiceAccountingClassificationService} from '../runtime/ai-invoice-accounting-classification-service.mjs';
import {createAiAccountingApprovedDecisionService} from '../runtime/ai-accounting-approved-decision-service.mjs';
import {createAiAccountingApprovedSettingsAdapter} from '../runtime/ai-accounting-approved-settings-adapter.mjs';
import {installApprovedAiSettingsFixture,retainFinal1PayableFixture} from './helpers/approved-ai-settings-fixture.mjs';
import {readAuthoritativeSourceDocumentDetail,refreshAuthoritativeDocuments,refreshAuthoritativeFinancialStatementPeriodComparison,refreshAuthoritativeFinancialStatements,refreshAuthoritativeGeneralLedger,refreshAuthoritativeJournalEntries,refreshAuthoritativeSourceDocuments,refreshControlledTestAiSources} from '../../src/accounting-api.js';

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

pgTest('AI vendor monthly spend reads one complete signed current-source population across the approved history window',async()=>{
  const ids=await seed({status:'DRAFT'}),prior=[
    {id:randomUUID(),code:'2026-04',start:'2026-04-01',end:'2026-04-30'},
    {id:randomUUID(),code:'2026-05',start:'2026-05-01',end:'2026-05-31'},
    {id:randomUUID(),code:'2026-06',start:'2026-06-01',end:'2026-06-30'}
  ];
  for(const period of prior)await adminPool.query("INSERT INTO accounting_period(period_id,tenant_id,entity_id,period_code,starts_on,ends_on,status) VALUES($1,$2,$3,$4,$5,$6,'OPEN')",[period.id,ids.tenantId,ids.entityId,period.code,period.start,period.end]);
  const snapshot={schema_version:'AI_VENDOR_INVOICE_AMOUNT_ANOMALY_POLICY_SNAPSHOT_V1',rule_id:'AI_VENDOR_HISTORICAL_AMOUNT_SPIKE_V1',policy_version:1,minimum_history_periods:3,ratio_threshold_basis_points:30000,minimum_absolute_delta:'200.0000'},snapshotHash=(await adminPool.query('SELECT refs_jsonb_hash($1::jsonb) value',[JSON.stringify(snapshot)])).rows[0].value;
  await adminPool.query(`INSERT INTO setting_snapshot(tenant_id,entity_id,family,scope_type,scope_key,version,effective_from,effective_to,status,snapshot,snapshot_hash,created_by,approved_by,approved_at)
    VALUES($1,$2::uuid,'AI_VENDOR_INVOICE_ANOMALY_POLICY','ENTITY',$2::uuid::text,1,'2026-01-01','2027-01-01','APPROVED',$3::jsonb,$4,'vendor-policy-maker','vendor-policy-approver',now())`,[ids.tenantId,ids.entityId,JSON.stringify(snapshot),snapshotHash]);
  const importer=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'vendor-population-importer',['WBS.SNAPSHOT.IMPORT'])});
  await retainFinal1PayableFixture({pool:adminPool,kernel:importer,ids,amount:'125.0000'});
  const reader=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'vendor-population-reader',['AI.ANALYSIS.EXPLAIN'])});
  const counts=()=>adminPool.query("SELECT (SELECT count(*)::int FROM journal_entry WHERE tenant_id=$1) journal,(SELECT count(*)::int FROM ledger_line WHERE tenant_id=$1) ledger,(SELECT count(*)::int FROM audit_event WHERE tenant_id=$1 AND event_type<>'RUNTIME_CONTEXT_ISSUED') accounting_audit,(SELECT count(*)::int FROM audit_event WHERE tenant_id=$1 AND event_type='RUNTIME_CONTEXT_ISSUED') context_audit,(SELECT count(*)::int FROM outbox_event WHERE tenant_id=$1) outbox",[ids.tenantId]).then(value=>value.rows[0]);
  const before=await counts(),result=await reader.readAiVendorMonthlySpendPopulation({tenantId:ids.tenantId,entityId:ids.entityId,accountingPeriodId:ids.periodId}),after=await counts();
  assert.deepEqual({...after,context_audit:before.context_audit},before);assert.equal(after.context_audit,before.context_audit+1);assert.equal(result.population_complete,true);assert.equal(result.population_line_count,1);assert.equal(result.history_period_count,3);assert.equal(result.selected_period_ids.length,4);assert.equal(result.rows.length,1);assert.equal(result.rows[0].source_admission_status,'ADMITTED');assert.equal(result.rows[0].signature_verified,true);assert.equal(result.admission_proofs.length,1);assert.equal(result.approved_policy.setting_snapshot_hash,snapshotHash);assert.deepEqual(result.action_flags,{can_post:false,can_review:false,can_approve:false,can_create_draft:false});
  const serialized=JSON.stringify(result);for(const forbidden of ['storage_ref','storage_version','authorization','credential','private_key'])assert.equal(serialized.includes(forbidden),false);
  await adminPool.query('UPDATE raw_event SET is_current=false,superseded_at=now() WHERE tenant_id=$1 AND entity_id=$2 AND raw_event_id=(SELECT raw_event_id FROM wbs_final1_retained_source_row WHERE tenant_id=$1 AND entity_id=$2 LIMIT 1)',[ids.tenantId,ids.entityId]);
  const withoutSuperseded=await reader.readAiVendorMonthlySpendPopulation({tenantId:ids.tenantId,entityId:ids.entityId,accountingPeriodId:ids.periodId});assert.equal(withoutSuperseded.population_line_count,0);assert.deepEqual(withoutSuperseded.rows,[]);
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
    const cleanupClient=await adminPool.connect();try{await cleanupClient.query("SET statement_timeout='120s'");await cleanupClient.query('TRUNCATE tenant CASCADE');}finally{cleanupClient.release();}
    await fn(t);
  });
}

async function migrateDownThrough(pool,targetMigration){
  for(;;){
    const row=(await pool.query('SELECT migration_name FROM refs_schema_migration ORDER BY migration_name DESC LIMIT 1')).rows[0];
    assert.ok(row,`Expected ${targetMigration} to be installed`);
    await migrateDown(pool);
    if(row.migration_name===targetMigration)return;
  }
}

const hash=value=>`sha256:${createHash('sha256').update(String(value)).digest('hex')}`;

const retainPrepaidInvoiceClassification=async({ids,sourceDocumentId,label})=>{
  const line=(await adminPool.query('SELECT source_document_line_id FROM source_document_line WHERE tenant_id=$1 AND entity_id=$2 AND source_document_id=$3 ORDER BY line_no LIMIT 1',[ids.tenantId,ids.entityId,sourceDocumentId])).rows[0];
  assert.ok(line?.source_document_line_id,'prepaid classification fixture requires a retained source line');
  const classificationHash=hash(`prepaid-classification:${label}`);
  await adminPool.query(`INSERT INTO ai_invoice_accounting_classification_evidence(
    tenant_id,entity_id,accounting_period_id,source_document_id,source_document_line_id,source_payload_hash,source_line_hash,
    classifier_version,classification,reason,confidence,required_human_fields,rule_id,classification_hash,status,created_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,'AI_INVOICE_ACCOUNTING_CLASSIFICATION_V2','PREPAID_AMORTIZATION',
      'Exact retained invoice line and coverage evidence require prepaid amortization review.',1,'[]'::jsonb,
      'AI_PREPAID_MULTI_MONTH_COVERAGE_V1',$8,'REVIEW_REQUIRED','ai-classification-fixture')`,
    [ids.tenantId,ids.entityId,ids.periodId,sourceDocumentId,line.source_document_line_id,hash('auto-doc'),hash(`source-line:${label}`),classificationHash]);
  return {classificationHash,sourceDocumentLineId:line.source_document_line_id};
};

async function rejectsInTransaction(client,query,validator){
  await client.query('SAVEPOINT expected_error');
  try{await assert.rejects(query(),validator);}
  finally{
    await client.query('ROLLBACK TO SAVEPOINT expected_error');
    await client.query('RELEASE SAVEPOINT expected_error');
  }
}

async function seed({status='APPROVED',journalType='MANUAL',attachmentStatus='VERIFIED_CLEAN',tenantId=randomUUID(),entityId=randomUUID(),periodId=randomUUID(),journalId=randomUUID(),extraAccounts=[],extraMembers=[],journalLines=null,attachmentName='support.pdf',attachmentStorageRef=null,attachmentStorageVersion='v1'}={}){
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
  for(const line of lines)await adminPool.query('INSERT INTO journal_line(tenant_id,entity_id,period_id,journal_entry_id,line_no,account_code,debit_amount,credit_amount,member_ref,dimensions) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)',[tenantId,entityId,periodId,journalId,line.lineNo,line.accountCode,line.debit,line.credit,line.memberRef??null,JSON.stringify(line.dimensions??{})]);
  if(attachmentStatus){
    const attachmentId=randomUUID();
    await adminPool.query(`INSERT INTO attachment(attachment_id,tenant_id,entity_id,name,media_type,size_bytes,content_hash,storage_ref,storage_version,uploaded_by,uploaded_at,verified_at,scan_status,finalization_status,finalized_at)
      VALUES($1,$2,$3,$4,'application/pdf',10,$5,$6,$7,'maker',now(),CASE WHEN $8='VERIFIED_CLEAN' THEN now() END,CASE WHEN $8='VERIFIED_CLEAN' THEN 'CLEAN' WHEN $8='REJECTED' THEN 'REJECTED' ELSE 'PENDING' END,$8,CASE WHEN $8='VERIFIED_CLEAN' THEN now() END)`,[attachmentId,tenantId,entityId,attachmentName,hash('attachment'),attachmentStorageRef??`object://attachments/${attachmentId}`,attachmentStorageVersion,attachmentStatus]);
    await adminPool.query("INSERT INTO source_link(tenant_id,entity_id,link_type,journal_entry_id,attachment_id,created_by) VALUES($1,$2,'JE_ATTACHMENT',$3,$4,'maker')",[tenantId,entityId,journalId,attachmentId]);
  }
  return {tenantId,entityId,sourceEntityId,periodId,journalId};
}

async function attachAutoSource(ids,{effectiveFrom='2026-01-01T00:00:00Z',effectiveTo=null,mappingPriority=0,evaluatedAt=null,linkJournal=true,reuseApprovedSnapshots=false,sourceSystem='WBS',sourceModule='bankFeed',sourceRecordPrefix='AUTO'}={}){
  const batchId=randomUUID(),rawId=randomUUID(),documentId=randomUUID(),ruleId=randomUUID(),stagingId=randomUUID(),recordId=`${sourceRecordPrefix}-${ids.journalId}`;let settingId=randomUUID(),mappingId=randomUUID();
  const inputKeyHash=hash('mapping-key');
  const configHashes=(await adminPool.query("SELECT refs_jsonb_hash('{}'::jsonb) AS setting_hash,refs_jsonb_hash(jsonb_build_object('input_keys','{}'::jsonb,'output_rules','{}'::jsonb)) AS mapping_hash")).rows[0];
  await adminPool.query("INSERT INTO import_batch(import_batch_id,tenant_id,entity_id,connector_code,source_module,source_entity_id,idempotency_key,request_hash) VALUES($1,$2,$3,'WBS_API',$4,$5,$6,$7)",[batchId,ids.tenantId,ids.entityId,sourceModule,ids.sourceEntityId,'auto-import-'+ids.journalId,hash('auto-import')]);
  await adminPool.query(`INSERT INTO raw_event(raw_event_id,tenant_id,entity_id,import_batch_id,source_system,source_module,source_entity_id,source_record_id,source_version,event_type,occurred_at,payload_hash,payload_ref,correlation_id)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,'1','UPSERT',now(),$9,$10,$8)`,[rawId,ids.tenantId,ids.entityId,batchId,sourceSystem,sourceModule,ids.sourceEntityId,recordId,hash('auto-raw'),`object://raw/${rawId}`]);
  await adminPool.query(`INSERT INTO source_document(source_document_id,tenant_id,entity_id,raw_event_id,source_system,source_module,source_entity_id,source_record_id,source_version,document_type,business_date,accounting_date,currency,gross_amount,source_ref,payload_hash)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,'1','BANK_TRANSACTION','2026-07-15','2026-07-15','USD',100,$9,$10)`,[documentId,ids.tenantId,ids.entityId,rawId,sourceSystem,sourceModule,ids.sourceEntityId,recordId,`${sourceSystem}:${recordId}`,hash('auto-doc')]);
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

pgTest('controlled test AI source bridge is private, fixed-permission, and rejects non-WBS-test parents with zero writes',async()=>{
  const ids=await seed({status:'DRAFT',attachmentStatus:null,extraAccounts:[{accountCode:'610000',accountName:'Operating expense'}]});
  const ordinary=await attachAutoSource(ids,{linkJournal:false,sourceModule:'payable',sourceRecordPrefix:'ORDINARY-NON-TEST'});
  const counts=()=>adminPool.query(`SELECT
    (SELECT count(*)::int FROM controlled_test_ai_source WHERE tenant_id=$1) traces,
    (SELECT count(*)::int FROM source_document WHERE tenant_id=$1) sources,
    (SELECT count(*)::int FROM audit_event WHERE tenant_id=$1 AND event_type='CONTROLLED_TEST_AI_SOURCE_DERIVED') audits,
    (SELECT count(*)::int FROM outbox_event WHERE tenant_id=$1 AND event_type='CONTROLLED_TEST_AI_SOURCE_DERIVED') outbox,
    (SELECT count(*)::int FROM idempotency_receipt WHERE tenant_id=$1 AND operation_scope LIKE 'CONTROLLED_TEST_AI_SOURCE:%') receipts`,[ids.tenantId]).then(result=>result.rows[0]);
  const before=await counts();
  const denied=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'ordinary-ai-actor',[])});
  await assert.rejects(denied.deriveControlledTestAiSource({tenantId:ids.tenantId,entityId:ids.entityId,parentSourceDocumentId:ordinary.documentId,initiatedBy:'authenticated-test-user',idempotencyKey:'controlled-ai-denied'}),error=>error.code==='42501');
  assert.deepEqual(await counts(),before);
  const sourceMaker=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'controlled-ai-source-maker',['AI.TEST.WORKFLOW'])});
  await assert.rejects(sourceMaker.deriveControlledTestAiSource({tenantId:ids.tenantId,entityId:ids.entityId,parentSourceDocumentId:ordinary.documentId,initiatedBy:'authenticated-test-user',idempotencyKey:'controlled-ai-wrong-parent'}),error=>error.code==='23514');
  assert.deepEqual(await counts(),before);
  const acl=(await adminPool.query("SELECT has_function_privilege('refs_app','refs_derive_controlled_test_ai_source(uuid,uuid,uuid,text,text,text)','EXECUTE') allowed,EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid='refs_derive_controlled_test_ai_source(uuid,uuid,uuid,text,text,text)'::regprocedure AND a.grantee=0 AND a.privilege_type='EXECUTE') public_allowed")).rows[0];
  assert.deepEqual(acl,{allowed:true,public_allowed:false});
});

pgTest('controlled test AI source module and SERVICE_ACCOUNT audit actor are explicit and rollback fails closed after evidence exists',async()=>{
  const ids=await seed({status:'DRAFT',attachmentStatus:null});
  const batchId=randomUUID(),rawId=randomUUID(),sourceId=randomUUID(),recordId=`AI-TEST-${sourceId}`;
  await adminPool.query("INSERT INTO import_batch(import_batch_id,tenant_id,entity_id,connector_code,source_module,source_entity_id,idempotency_key,request_hash,status,row_count,started_at,completed_at) VALUES($1,$2,$3,'WBS_AI_TEST','ai_test_prepaid',$4,$5,$6,'SUCCEEDED',1,now(),now())",[batchId,ids.tenantId,ids.entityId,ids.sourceEntityId,`ai-module-${sourceId}`,hash('ai-module-batch')]);
  await adminPool.query("INSERT INTO raw_event(raw_event_id,tenant_id,entity_id,import_batch_id,source_system,source_module,source_entity_id,source_record_id,source_version,event_type,occurred_at,payload_hash,payload_ref,correlation_id) VALUES($1,$2,$3,$4,'WBS','ai_test_prepaid',$5,$6,'unsigned-test-only:v1','UPSERT',now(),$7,$8,$6)",[rawId,ids.tenantId,ids.entityId,batchId,ids.sourceEntityId,recordId,hash('ai-module-raw'),`object://refs-test-only/${ids.entityId}/ai-workflow/${sourceId}`]);
  await adminPool.query("INSERT INTO source_document(source_document_id,tenant_id,entity_id,raw_event_id,source_system,source_module,source_entity_id,source_record_id,source_version,document_type,document_no,business_date,accounting_date,currency,gross_amount,status,source_ref,payload_hash) VALUES($1,$2,$3,$4,'WBS','ai_test_prepaid',$5,$6,'unsigned-test-only:v1','WBS_TEST_AI_PREPAID',$6,'2026-07-15','2026-07-15','USD',1,'READY_FOR_DRAFT',$7,$8)",[sourceId,ids.tenantId,ids.entityId,rawId,ids.sourceEntityId,recordId,`object://refs-test-only/${ids.entityId}/ai-workflow/${sourceId}`,hash('ai-module-source')]);
  assert.deepEqual((await adminPool.query('SELECT source_module,document_type,status FROM source_document WHERE source_document_id=$1',[sourceId])).rows,[{source_module:'ai_test_prepaid',document_type:'WBS_TEST_AI_PREPAID',status:'READY_FOR_DRAFT'}]);
  const definition=(await adminPool.query("SELECT pg_get_functiondef('refs_derive_controlled_test_ai_source(uuid,uuid,uuid,text,text,text)'::regprocedure) definition")).rows[0].definition;
  assert.match(definition,/actor,'SERVICE_ACCOUNT','AI\.TEST\.WORKFLOW'/);assert.doesNotMatch(definition,/actor,'SERVICE','AI\.TEST\.WORKFLOW'/);
  await adminPool.query("INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash) VALUES($1,$2,'CONTROLLED_TEST_AI_SOURCE_DERIVED','SOURCE_DOCUMENT',$3,'DERIVE_TEST_SOURCE','controlled-ai-source-maker','SERVICE_ACCOUNT','AI.TEST.WORKFLOW',$4,$4,$4,$5)",[ids.tenantId,ids.entityId,sourceId,'controlled-ai-audit-actor-test',hash('controlled-ai-audit-actor-test')]);
  assert.deepEqual((await adminPool.query("SELECT actor_type FROM audit_event WHERE tenant_id=$1 AND entity_id=$2 AND event_type='CONTROLLED_TEST_AI_SOURCE_DERIVED'",[ids.tenantId,ids.entityId])).rows,[{actor_type:'SERVICE_ACCOUNT'}]);
  await migrateDown(adminPool); // 193 is the isolated TEST_ONLY Bank Match configuration workflow.
  await migrateDown(adminPool); // 192 admits only the legacy controlled Stage1 Payable identity.
  await migrateDown(adminPool); // 191 scopes the isolated TEST_ONLY Bank Match fixture to one period.
  await migrateDown(adminPool); // 190 is the isolated TEST_ONLY Bank Match fixture reader.
  await migrateDown(adminPool); // 189 is a read-only function replacement.
  await assert.rejects(migrateDown(adminPool),error=>error.code==='55006');
  assert.equal((await adminPool.query("SELECT pg_get_constraintdef(oid) definition FROM pg_constraint WHERE conname='source_document_source_module_check'")).rows[0].definition.includes('ai_test_prepaid'),true);
  assert.match((await adminPool.query("SELECT pg_get_functiondef('refs_derive_controlled_test_ai_source(uuid,uuid,uuid,text,text,text)'::regprocedure) definition")).rows[0].definition,/actor,'SERVICE_ACCOUNT','AI\.TEST\.WORKFLOW'/);
  await migrateUp(adminPool); // Restore the read-only 189 replacement removed above.
  await migrateUp(adminPool); // Restore the isolated TEST_ONLY Bank Match fixture reader.
  await migrateUp(adminPool); // Restore the period-scoped TEST_ONLY Bank Match fixture reader.
  await migrateUp(adminPool); // Restore the Stage1-compatible TEST_ONLY Bank Match source boundary.
  await migrateUp(adminPool); // Restore the isolated TEST_ONLY Bank Match configuration workflow.
});

pgTest('Controller retains classifies and approves an exact WBS company catalog binding with SoD CAS audit and zero accounting mapping snapshots',async()=>{
  const ids={tenantId:randomUUID(),entityId:randomUUID()};
  await adminPool.query('INSERT INTO tenant(tenant_id,tenant_code,name) VALUES($1,$2,$3)',[ids.tenantId,`T${ids.tenantId.replaceAll('-','').slice(0,8)}`.toUpperCase(),'Company catalog tenant']);
  await adminPool.query("INSERT INTO entity(entity_id,tenant_id,entity_code,source_system,source_entity_id,name,base_currency) VALUES($1,$2,'CATALOG_ENTITY','REFS_CATALOG_PENDING','PENDING-WBS-COMPANY','Catalog pending entity','USD')",[ids.entityId,ids.tenantId]);
  const makeCatalog=({companyCode='WBPA',declaredTotal=1,baseCurrency='USD',raw='catalog-raw'}={})=>{
    const input={catalogVersion:`catalog-${companyCode}-${baseCurrency}-${declaredTotal}-v1`,generatedAt:'2026-08-15T01:02:03.000Z',providerEnvironment:'PRODUCTION',source:{name:'wbs-accountbook-export',version:'wbs-readonly-2026-08-15',rawFileHash:hash(raw),catalogHash:hash('placeholder'),rowControl:{sourceRowCount:1,acceptedRowCount:1,rejectedRows:[]}},accountBookControl:{total:declaredTotal,open:1,closed:0,companiesWithBooks:1},companies:[{companyCode,wbsCompanyId:'176',displayName:'Wan Pacific Real Estate Development LLC',legalName:'Wan Pacific Real Estate Development LLC',activeStatus:'ACTIVE',entityType:'LEGAL_ENTITY',baseCurrency,operationallyActive2026:true,accountBooks:[{accountBookId:`book-${companyCode}-${baseCurrency}`,accountName:'Operating account',accountStatus:'O',externalCompanyId:'176'}],accountBookCount:1,openAccountBookCount:1,domains:{PAYABLES:{rowCount:183,minDate:'2026-01-01',maxDate:'2026-08-15'},JOURNAL:{rowCount:199,minDate:'2026-01-01',maxDate:'2026-08-15'},BANK:{rowCount:17,minDate:'2026-01-01',maxDate:'2026-08-15'},AUTOREC:{pbStatus:'SOURCE_PRESENT',reconStart:'2026-01-01'}}}]};
    input.source.catalogHash=wbsCompanyCatalogCanonicalHash(input);return normalizeWbsCompanyCatalogCandidate(input);
  };
  const catalog=makeCatalog(),retainer=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'catalog-retainer',['WBS.COMPANY.CATALOG.RETAIN','WBS.COMPANY.CATALOG.VIEW'])});
  const retained=await retainer.retainWbsCompanyCatalogCandidate({tenantId:ids.tenantId,entityId:ids.entityId,catalog,idempotencyKey:'catalog-pg-retain-001'});assert.equal(retained.record_count,1);assert.equal(retained.error_count,0);assert.equal(retained.can_create_mapping_snapshot,false);assert.equal((await retainer.retainWbsCompanyCatalogCandidate({tenantId:ids.tenantId,entityId:ids.entityId,catalog,idempotencyKey:'catalog-pg-retain-001'})).idempotent,true);
  const rows=await retainer.listWbsCompanyCatalogRows({tenantId:ids.tenantId,entityId:ids.entityId,candidateId:retained.wbs_company_catalog_candidate_id,limit:10,offset:0});assert.equal(rows.length,1);assert.equal(rows[0].company_code,'WBPA');const rowId=rows[0].wbs_company_catalog_candidate_row_id;
  const classification=normalizeWbsCompanyClassification({companyCode:'WBPA',displayName:'Wan Pacific Real Estate Development LLC',legalName:'Wan Pacific Real Estate Development LLC',entityType:'LEGAL_ENTITY',activeStatus:'ACTIVE',baseCurrency:'USD'});
  await assert.rejects(retainer.classifyWbsCompanyCatalogRow({tenantId:ids.tenantId,entityId:ids.entityId,rowId,expectedRevision:0,classification,reason:'Retainer must not classify retained evidence.',idempotencyKey:'catalog-pg-classify-sod'}),error=>error.code==='42501');
  const classifier=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'catalog-classifier',['WBS.COMPANY.CATALOG.CLASSIFY','WBS.COMPANY.CATALOG.VIEW'])});
  const wrongCompanyClassification=normalizeWbsCompanyClassification({companyCode:'WBLF',displayName:'Wan Pacific Real Estate Development LLC',legalName:'Wan Pacific Real Estate Development LLC',entityType:'LEGAL_ENTITY',activeStatus:'ACTIVE',baseCurrency:'USD'});
  await assert.rejects(classifier.classifyWbsCompanyCatalogRow({tenantId:ids.tenantId,entityId:ids.entityId,rowId,expectedRevision:0,classification:wrongCompanyClassification,reason:'A Controller must not replace the retained WBS company identity.',idempotencyKey:'catalog-pg-classify-wrong-company'}),error=>error.code==='23514');
  assert.equal(Number((await adminPool.query('SELECT count(*) count FROM wbs_company_catalog_controller_decision WHERE tenant_id=$1 AND entity_id=$2 AND wbs_company_catalog_candidate_row_id=$3',[ids.tenantId,ids.entityId,rowId])).rows[0].count),0);
  const classified=await classifier.classifyWbsCompanyCatalogRow({tenantId:ids.tenantId,entityId:ids.entityId,rowId,expectedRevision:0,classification,reason:'Independent Controller classified the exact WBS company.',idempotencyKey:'catalog-pg-classify-001'});assert.equal(classified.revision,1);assert.equal(classified.can_create_mapping_snapshot,false);
  await assert.rejects(classifier.approveWbsCompanyCatalogRow({tenantId:ids.tenantId,entityId:ids.entityId,rowId,expectedRevision:1,expectedCatalogHash:catalog.catalog_hash,expectedRowHash:catalog.rows[0].row_hash,effectiveFrom:'2026-01-01',effectiveTo:null,reason:'Classifier must not approve the same company.',idempotencyKey:'catalog-pg-approve-sod'}),error=>error.code==='42501');
  const approver=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'catalog-approver',['WBS.COMPANY.CATALOG.APPROVE','WBS.COMPANY.CATALOG.VIEW'])});
  await assert.rejects(approver.approveWbsCompanyCatalogRow({tenantId:ids.tenantId,entityId:ids.entityId,rowId,expectedRevision:1,expectedCatalogHash:hash('wrong-catalog'),expectedRowHash:catalog.rows[0].row_hash,effectiveFrom:'2026-01-01',effectiveTo:null,reason:'Reject a catalog whose exact evidence hash changed.',idempotencyKey:'catalog-pg-approve-hash'}),error=>error.code==='23514');
  const beforeMappings=Number((await adminPool.query('SELECT count(*) count FROM mapping_snapshot WHERE tenant_id=$1 AND entity_id=$2',[ids.tenantId,ids.entityId])).rows[0].count),approvalArgs={tenantId:ids.tenantId,entityId:ids.entityId,rowId,expectedRevision:1,expectedCatalogHash:catalog.catalog_hash,expectedRowHash:catalog.rows[0].row_hash,effectiveFrom:'2026-01-01',effectiveTo:'2026-12-31',reason:'Independent Controller approves the exact reconciled company binding.',idempotencyKey:'catalog-pg-approve-001'},approved=await approver.approveWbsCompanyCatalogRow(approvalArgs);assert.equal(approved.revision,2);assert.equal(approved.mapping.company_code,'WBPA');assert.equal(approved.can_create_mapping_snapshot,false);assert.equal((await approver.approveWbsCompanyCatalogRow(approvalArgs)).idempotent,true);
  assert.deepEqual((await adminPool.query('SELECT source_system,source_entity_id,base_currency FROM entity WHERE tenant_id=$1 AND entity_id=$2',[ids.tenantId,ids.entityId])).rows[0],{source_system:'WBS',source_entity_id:'WBPA',base_currency:'USD'});assert.equal(Number((await adminPool.query('SELECT count(*) count FROM mapping_snapshot WHERE tenant_id=$1 AND entity_id=$2',[ids.tenantId,ids.entityId])).rows[0].count),beforeMappings);
  assert.equal(Number((await adminPool.query("SELECT count(*) count FROM audit_event WHERE tenant_id=$1 AND entity_id=$2 AND event_type LIKE 'WBS_COMPANY_CATALOG_%'",[ids.tenantId,ids.entityId])).rows[0].count),3);assert.equal(Number((await adminPool.query("SELECT count(*) count FROM outbox_event WHERE tenant_id=$1 AND entity_id=$2 AND event_type LIKE 'WBS_COMPANY_CATALOG_%'",[ids.tenantId,ids.entityId])).rows[0].count),3);
  await assert.rejects(approver.approveWbsCompanyCatalogRow({tenantId:ids.tenantId,entityId:ids.entityId,rowId,expectedRevision:1,expectedCatalogHash:catalog.catalog_hash,expectedRowHash:catalog.rows[0].row_hash,effectiveFrom:'2026-01-01',effectiveTo:null,reason:'Stale Controller revision must fail closed.',idempotencyKey:'catalog-pg-approve-stale'}),error=>error.code==='40001');
  const retainAndClassify=async({candidate:nextCatalog,suffix})=>{const nextRetained=await retainer.retainWbsCompanyCatalogCandidate({tenantId:ids.tenantId,entityId:ids.entityId,catalog:nextCatalog,idempotencyKey:`catalog-pg-retain-${suffix}`}),nextRows=await retainer.listWbsCompanyCatalogRows({tenantId:ids.tenantId,entityId:ids.entityId,candidateId:nextRetained.wbs_company_catalog_candidate_id,limit:10,offset:0}),nextRowId=nextRows[0].wbs_company_catalog_candidate_row_id,nextClassification=normalizeWbsCompanyClassification({companyCode:nextCatalog.rows[0].company_code,displayName:'Controller verified company',legalName:'Controller verified company',entityType:'LEGAL_ENTITY',activeStatus:'ACTIVE',baseCurrency:nextCatalog.rows[0].base_currency});await classifier.classifyWbsCompanyCatalogRow({tenantId:ids.tenantId,entityId:ids.entityId,rowId:nextRowId,expectedRevision:0,classification:nextClassification,reason:'Independent Controller classified the exact company scope.',idempotencyKey:`catalog-pg-classify-${suffix}`});return {nextRetained,nextRowId};};
  const badControls=makeCatalog({declaredTotal:2,raw:'bad-controls'}),badControlState=await retainAndClassify({candidate:badControls,suffix:'bad-controls'});await assert.rejects(approver.approveWbsCompanyCatalogRow({tenantId:ids.tenantId,entityId:ids.entityId,rowId:badControlState.nextRowId,expectedRevision:1,expectedCatalogHash:badControls.catalog_hash,expectedRowHash:badControls.rows[0].row_hash,effectiveFrom:'2026-01-01',effectiveTo:null,reason:'Account-book control mismatch must fail closed.',idempotencyKey:'catalog-pg-approve-bad-controls'}),error=>error.code==='23514');
  const wrongCurrency=makeCatalog({baseCurrency:'EUR',raw:'wrong-currency'}),wrongCurrencyState=await retainAndClassify({candidate:wrongCurrency,suffix:'wrong-currency'});await assert.rejects(approver.approveWbsCompanyCatalogRow({tenantId:ids.tenantId,entityId:ids.entityId,rowId:wrongCurrencyState.nextRowId,expectedRevision:1,expectedCatalogHash:wrongCurrency.catalog_hash,expectedRowHash:wrongCurrency.rows[0].row_hash,effectiveFrom:'2026-01-01',effectiveTo:null,reason:'Entity base currency mismatch must fail closed.',idempotencyKey:'catalog-pg-approve-wrong-currency'}),error=>error.code==='23514');
  const wrongCompany=makeCatalog({companyCode:'WBLF',raw:'wrong-company'}),wrongCompanyState=await retainAndClassify({candidate:wrongCompany,suffix:'wrong-company'});await assert.rejects(approver.approveWbsCompanyCatalogRow({tenantId:ids.tenantId,entityId:ids.entityId,rowId:wrongCompanyState.nextRowId,expectedRevision:1,expectedCatalogHash:wrongCompany.catalog_hash,expectedRowHash:wrongCompany.rows[0].row_hash,effectiveFrom:'2026-01-01',effectiveTo:null,reason:'Existing exact WBS company binding must not be replaced.',idempotencyKey:'catalog-pg-approve-wrong-company'}),error=>error.code==='23514');
  await assert.rejects(adminPool.query('UPDATE wbs_company_catalog_candidate SET source_name=$1 WHERE wbs_company_catalog_candidate_id=$2',['mutated',retained.wbs_company_catalog_candidate_id]),error=>/append-only|not allowed|immutable/i.test(error.message));
});

pgTest('Insurance PC company mapping Controller164 records proposes approves resumes and preserves zero accounting writes',async()=>{
  const ids={tenantId:randomUUID(),entityId:randomUUID()},candidateId=randomUUID(),candidateRowId=randomUUID(),catalogDecisionId=randomUUID();
  await adminPool.query('INSERT INTO tenant(tenant_id,tenant_code,name) VALUES($1,$2,$3)',[ids.tenantId,`T${ids.tenantId.replaceAll('-','').slice(0,8)}`.toUpperCase(),'Controller164 tenant']);
  await adminPool.query("INSERT INTO entity(entity_id,tenant_id,entity_code,source_system,source_entity_id,name,base_currency) VALUES($1,$2,'WBPA','WBS','WBPA','WBPA','USD')",[ids.entityId,ids.tenantId]);
  const catalogHash=hash('controller164-catalog'),catalogRowHash=hash('controller164-catalog-row'),mappingBase={schema_version:'WBS_COMPANY_ENTITY_MAPPING_V1',tenant_id:ids.tenantId,refs_entity_id:ids.entityId,company_code:'WBPA',base_currency:'USD',effective_from:'2026-01-01',effective_to:'2026-12-31',approval_status:'APPROVED',mapping_version:'controller164-v1'},mappingHash=(await adminPool.query('SELECT refs_jsonb_hash($1::jsonb) hash',[JSON.stringify(mappingBase)])).rows[0].hash,mappingDocument={...mappingBase,mapping_hash:mappingHash};
  await adminPool.query(`INSERT INTO wbs_company_catalog_candidate(wbs_company_catalog_candidate_id,tenant_id,entity_id,catalog_version,generated_at,provider_environment,source_name,source_version,raw_file_hash,catalog_hash,source_row_count,accepted_row_count,rejected_row_count,source_rejections,declared_account_book_total,declared_account_book_open,declared_account_book_closed,declared_companies_with_books,recomputed_account_book_total,recomputed_account_book_open,recomputed_account_book_closed,recomputed_companies_with_books,retained_by,request_hash)
    VALUES($1,$2,$3,'controller164-v1',now(),'PRODUCTION','wbs-provider','v1',$4,$5,1,1,0,'[]',1,1,0,1,1,1,0,1,'catalog-retainer',$6)`,[candidateId,ids.tenantId,ids.entityId,hash('controller164-catalog-raw'),catalogHash,hash('controller164-catalog-request')]);
  await adminPool.query(`INSERT INTO wbs_company_catalog_candidate_row(wbs_company_catalog_candidate_row_id,tenant_id,entity_id,wbs_company_catalog_candidate_id,row_ordinal,company_code,wbs_company_id,display_name,legal_name,proposed_active_status,proposed_entity_type,proposed_base_currency,operationally_active_2026,account_books,domains,account_book_count,open_account_book_count,row_hash)
    VALUES($1,$2,$3,$4,0,'WBPA','176','WBPA','WBPA','ACTIVE','LEGAL_ENTITY','USD',true,'[]','{}',0,0,$5)`,[candidateRowId,ids.tenantId,ids.entityId,candidateId,catalogRowHash]);
  await adminPool.query(`INSERT INTO wbs_company_catalog_controller_decision(wbs_company_catalog_controller_decision_id,tenant_id,entity_id,wbs_company_catalog_candidate_id,wbs_company_catalog_candidate_row_id,revision,decision_type,company_code,display_name,legal_name,entity_type,active_status,base_currency,effective_from,effective_to,mapping_version,mapping_document,mapping_hash,reason,decided_by,decision_hash,request_hash)
    VALUES($1,$2,$3,$4,$5,2,'APPROVED','WBPA','WBPA','WBPA','LEGAL_ENTITY','ACTIVE','USD','2026-01-01','2026-12-31','controller164-v1',$6::jsonb,$7,'Independent catalog approval.','catalog-approver',$8,$9)`,[catalogDecisionId,ids.tenantId,ids.entityId,candidateId,candidateRowId,JSON.stringify(mappingDocument),mappingHash,hash('controller164-catalog-decision'),hash('controller164-catalog-decision-request')]);
  const artifacts=Object.fromEntries(['receipt','request','response','package'].map(name=>[name,{storage_ref:`s3://refs-wbs-final1/insurance/controller164/${name}`,storage_version:`controller164-${name}-v1`,content_hash:hash(`controller164-${name}`),size_bytes:100,media_type:['receipt','package'].includes(name)?'application/json':'application/octet-stream',object_lock_mode:'COMPLIANCE',retain_until:'2027-08-16T00:00:00.000Z',scan_disposition:'CLEAN',scan_ref:`clamav:${hash(`controller164-${name}`).slice(7)}:clean`,scan_hash:hash(`controller164-${name}`)}]));
  const aggregateRows=[{pc_code:'PC-1',observed_row_count:7},{pc_code:'PC-2',observed_row_count:3}];
  for(const row of aggregateRows)row.row_hash=(await adminPool.query("SELECT refs_jsonb_hash(jsonb_build_object('pc_code',$1::text,'observed_row_count',$2::bigint)) hash",[row.pc_code,row.observed_row_count])).rows[0].hash;
  const canonicalSetHash=(await adminPool.query("SELECT refs_jsonb_hash(jsonb_build_object('pc_codes',$1::jsonb)) hash",[JSON.stringify(aggregateRows.map(({pc_code,observed_row_count})=>({pc_code,observed_row_count})))])).rows[0].hash,artifactSetHash=(await adminPool.query('SELECT refs_jsonb_hash($1::jsonb) hash',[JSON.stringify(artifacts)])).rows[0].hash;
  const observationId=randomUUID(),admissionId=randomUUID(),immutableVersion=randomUUID(),publicBase={schema_version:'REFS_INSURANCE_PRE_ADMISSION_OBSERVATION_V1',observation_id:observationId,status:'PRE_ADMISSION_OBSERVATION',admission_state:'NOT_ADMITTED',source_kind:'PRE_ADMISSION_OBSERVATION',source_evidence_hash:hash('controller164-source-evidence'),scope_kind:'FIRST_PACKAGE_WBPA',scope_pc_code_count:2,artifact_set_hash:artifactSetHash,package_hash:hash('controller164-package-hash'),source_payload_hash:hash('controller164-source-payload'),canonical_set_hash:canonicalSetHash,captured_at:'2026-08-16T00:00:00.000Z',record_count:12,null_pc_code_row_count:2};
  const hashBase={...publicBase,admission_id:admissionId,immutable_version:immutableVersion,receipt_hash:hash('controller164-receipt'),date_from:'2026-01-01',date_to:'2026-12-31',signature_algorithm:'Ed25519',signature_verified:true,artifacts,actions:{can_propose_amortization:false,can_create_draft:false,can_review:false,can_approve:false,can_post:false},write_delta:{admission:0,retention:0,coverage:0,staging:0,journal_entry:0,ledger:0,audit:0,outbox:0,model_call:0,storage_action:0},public_dto:publicBase},observationHash=(await adminPool.query('SELECT refs_jsonb_hash($1::jsonb) hash',[JSON.stringify(hashBase)])).rows[0].hash,observation={...hashBase,observation_hash:observationHash,public_dto:{...publicBase,observation_hash:observationHash}};
  const kernelFor=(actor,permissions)=>new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,actor,permissions)}),observer=kernelFor('controller164-observer',['WBS.SNAPSHOT.IMPORT']),proposer=kernelFor('controller164-proposer',['WBS.INSURANCE.PC_MAPPING.PROPOSE','WBS.INSURANCE.PC_MAPPING.VIEW']),otherProposer=kernelFor('controller164-proposer-2',['WBS.INSURANCE.PC_MAPPING.PROPOSE']),approver=kernelFor('controller164-approver',['WBS.INSURANCE.PC_MAPPING.APPROVE','WBS.INSURANCE.PC_MAPPING.VIEW']),otherApprover=kernelFor('controller164-approver-2',['WBS.INSURANCE.PC_MAPPING.APPROVE']),catalogApprover=kernelFor('catalog-approver',['WBS.INSURANCE.PC_MAPPING.APPROVE']);
  const businessCounts=async()=>(await adminPool.query(`SELECT (SELECT count(*)::int FROM source_document WHERE tenant_id=$1) source_documents,(SELECT count(*)::int FROM staging_item WHERE tenant_id=$1) staging,(SELECT count(*)::int FROM journal_entry WHERE tenant_id=$1) journals,(SELECT count(*)::int FROM ledger_line WHERE tenant_id=$1) ledger`,[ids.tenantId])).rows[0],zeroAccounting={source_documents:0,staging:0,journals:0,ledger:0};
  const recorded=await observer.recordWbsInsurancePcMappingPreAdmission({tenantId:ids.tenantId,entityId:ids.entityId,observation,rows:aggregateRows});assert.equal(recorded.admission_state,'NOT_ADMITTED');assert.equal(recorded.observation_hash,observationHash);assert.deepEqual(await businessCounts(),zeroAccounting);
  assert.equal((await observer.recordWbsInsurancePcMappingPreAdmission({tenantId:ids.tenantId,entityId:ids.entityId,observation,rows:aggregateRows})).observation_id,observationId);
  const proposalArgs={tenantId:ids.tenantId,entityId:ids.entityId,observationId,expectedObservationHash:observationHash,reason:'Independent Controller review of the exact signed artifact aggregate.',idempotencyKey:'controller164-propose-0001'},proposal=await proposer.createWbsInsurancePcMappingProposal(proposalArgs);assert.equal(proposal.status,'PENDING_CONTROLLER_APPROVAL');assert.equal((await proposer.createWbsInsurancePcMappingProposal(proposalArgs)).idempotent,true);
  const afterProposal=(await adminPool.query(`SELECT (SELECT count(*)::int FROM wbs_insurance_pc_mapping_proposal WHERE tenant_id=$1) proposal,(SELECT count(*)::int FROM audit_event WHERE tenant_id=$1 AND event_type='WBS_INSURANCE_PC_MAPPING_PROPOSED') audit,(SELECT count(*)::int FROM outbox_event WHERE tenant_id=$1 AND event_type='WBS_INSURANCE_PC_MAPPING_PROPOSED') outbox`,[ids.tenantId])).rows[0];
  assert.deepEqual(afterProposal,{proposal:1,audit:1,outbox:1});
  await assert.rejects(otherProposer.createWbsInsurancePcMappingProposal(proposalArgs),error=>error.code==='23505');assert.deepEqual((await adminPool.query(`SELECT (SELECT count(*)::int FROM wbs_insurance_pc_mapping_proposal WHERE tenant_id=$1) proposal,(SELECT count(*)::int FROM audit_event WHERE tenant_id=$1 AND event_type='WBS_INSURANCE_PC_MAPPING_PROPOSED') audit,(SELECT count(*)::int FROM outbox_event WHERE tenant_id=$1 AND event_type='WBS_INSURANCE_PC_MAPPING_PROPOSED') outbox`,[ids.tenantId])).rows[0],afterProposal);
  const approvalArgs={tenantId:ids.tenantId,entityId:ids.entityId,proposalId:proposal.proposal_id,expectedRevision:0,expectedObservationHash:observationHash,expectedProposalHash:proposal.proposal_hash,catalogDecisionId,expectedCompanyMappingHash:mappingHash,effectiveFrom:'2026-01-01',effectiveTo:'2026-12-31',reason:'Independent Controller approves the exact signed PC mapping evidence.',idempotencyKey:'controller164-approve-0001'};
  await assert.rejects(proposer.approveWbsInsurancePcMappingProposal(approvalArgs),error=>error.code==='42501');await assert.rejects(catalogApprover.approveWbsInsurancePcMappingProposal({...approvalArgs,idempotencyKey:'controller164-approve-sod-catalog'}),error=>error.code==='42501');
  await assert.rejects(approver.approveWbsInsurancePcMappingProposal({...approvalArgs,expectedRevision:1,idempotencyKey:'controller164-approve-stale'}),error=>error.code==='22023'||error.code==='40001');
  const approved=await approver.approveWbsInsurancePcMappingProposal(approvalArgs);assert.equal(approved.status,'APPROVED');assert.equal(approved.match_count,2);assert.equal((await approver.approveWbsInsurancePcMappingProposal(approvalArgs)).idempotent,true);
  const approvalCounts=(await adminPool.query(`SELECT (SELECT count(*)::int FROM wbs_insurance_pc_mapping_approval WHERE tenant_id=$1) approval,(SELECT count(*)::int FROM wbs_insurance_pc_mapping_decision_trace WHERE tenant_id=$1) traces,(SELECT count(*)::int FROM audit_event WHERE tenant_id=$1 AND event_type='WBS_INSURANCE_PC_MAPPING_APPROVED') audit,(SELECT count(*)::int FROM outbox_event WHERE tenant_id=$1 AND event_type='WBS_INSURANCE_PC_MAPPING_APPROVED') outbox`,[ids.tenantId])).rows[0];assert.deepEqual(approvalCounts,{approval:1,traces:2,audit:1,outbox:1});
  await assert.rejects(otherApprover.approveWbsInsurancePcMappingProposal(approvalArgs),error=>error.code==='23505');assert.deepEqual((await adminPool.query(`SELECT (SELECT count(*)::int FROM wbs_insurance_pc_mapping_approval WHERE tenant_id=$1) approval,(SELECT count(*)::int FROM wbs_insurance_pc_mapping_decision_trace WHERE tenant_id=$1) traces,(SELECT count(*)::int FROM audit_event WHERE tenant_id=$1 AND event_type='WBS_INSURANCE_PC_MAPPING_APPROVED') audit,(SELECT count(*)::int FROM outbox_event WHERE tenant_id=$1 AND event_type='WBS_INSURANCE_PC_MAPPING_APPROVED') outbox`,[ids.tenantId])).rows[0],approvalCounts);
  const trace=await approver.getWbsInsurancePcMappingTrace({tenantId:ids.tenantId,entityId:ids.entityId,pcCode:'PC-1',accountingDate:'2026-06-30'});assert.equal(trace.mapping_status,'CONTROLLER_APPROVED');assert.equal(trace.observation_hash,observationHash);assert.equal(trace.decision_hash,approved.decision_hash);assert.equal(trace.company_mapping_hash,mappingHash);
  assert.deepEqual(await approver.getWbsInsurancePcMappingTrace({tenantId:ids.tenantId,entityId:ids.entityId,pcCode:'PC-MISSING',accountingDate:'2026-06-30'}),{pc_code:'PC-MISSING',accounting_date:'2026-06-30',match_count:0,mapping_status:'MISSING'});
  const resume=await observer.readWbsInsurancePcMappingAdmissionResume({tenantId:ids.tenantId,entityId:ids.entityId,observationId,expectedObservationHash:observationHash,expectedApprovalId:approved.mapping_approval_id,expectedDecisionHash:approved.decision_hash,expectedCompanyMappingHash:mappingHash});assert.equal(resume.admission_id,admissionId);assert.equal(resume.immutable_version,immutableVersion);assert.deepEqual(resume.observation.artifacts,artifacts);assert.equal(resume.approval.mapping_approval_id,approved.mapping_approval_id);assert.equal(resume.approval.canonical_mapping_decision_hash,approved.decision_hash);
  await assert.rejects(observer.readWbsInsurancePcMappingAdmissionResume({tenantId:ids.tenantId,entityId:ids.entityId,observationId,expectedObservationHash:hash('wrong-observation'),expectedApprovalId:approved.mapping_approval_id,expectedDecisionHash:approved.decision_hash,expectedCompanyMappingHash:mappingHash}),error=>error.code==='40001');assert.deepEqual(await businessCounts(),zeroAccounting);
  for(;;){
    const latest=(await adminPool.query('SELECT migration_name FROM refs_schema_migration ORDER BY migration_name DESC LIMIT 1')).rows[0]?.migration_name;
    assert.ok(latest,'Controller164 rollback guard requires an applied migration chain');
    if(latest.startsWith('164_'))break;
    await migrateDown(adminPool);
  }
  await assert.rejects(migrateDown(adminPool),error=>error.code==='55000');await migrateUp(adminPool);assert.deepEqual(await businessCounts(),zeroAccounting);
});

pgTest('WBS Final-1 Controller167 persists five-domain signed controls and exact business evidence with zero accounting action',async()=>{
  const ids={tenantId:randomUUID(),entityId:randomUUID()},candidateId=randomUUID(),candidateRowId=randomUUID(),actor='wbs-final1-importer';
  await adminPool.query('INSERT INTO tenant(tenant_id,tenant_code,name) VALUES($1,$2,$3)',[ids.tenantId,`T${ids.tenantId.replaceAll('-','').slice(0,8)}`.toUpperCase(),'Final-1 retained evidence tenant']);
  await adminPool.query("INSERT INTO entity(entity_id,tenant_id,entity_code,source_system,source_entity_id,name,base_currency) VALUES($1,$2,'WBPA','WBS','WBPA','WBPA','USD')",[ids.entityId,ids.tenantId]);
  await adminPool.query("INSERT INTO accounting_period(period_id,tenant_id,entity_id,period_code,starts_on,ends_on,status) VALUES($1,$2,$3,'2026-01','2026-01-01','2026-01-31','OPEN')",[randomUUID(),ids.tenantId,ids.entityId]);
  await adminPool.query(`INSERT INTO wbs_company_catalog_candidate(wbs_company_catalog_candidate_id,tenant_id,entity_id,catalog_version,generated_at,provider_environment,source_name,source_version,raw_file_hash,catalog_hash,source_row_count,accepted_row_count,rejected_row_count,source_rejections,declared_account_book_total,declared_account_book_open,declared_account_book_closed,declared_companies_with_books,recomputed_account_book_total,recomputed_account_book_open,recomputed_account_book_closed,recomputed_companies_with_books,retained_by,request_hash)
    VALUES($1,$2,$3,'catalog-v1',now(),'PRODUCTION','wbs-provider','v1',$4,$5,1,1,0,'[]',1,1,0,1,1,1,0,1,'controller-retainer',$6)`,[candidateId,ids.tenantId,ids.entityId,hash('catalog-raw'),hash('catalog'),hash('catalog-request')]);
  await adminPool.query(`INSERT INTO wbs_company_catalog_candidate_row(wbs_company_catalog_candidate_row_id,tenant_id,entity_id,wbs_company_catalog_candidate_id,row_ordinal,company_code,wbs_company_id,display_name,legal_name,proposed_active_status,proposed_entity_type,proposed_base_currency,operationally_active_2026,account_books,domains,account_book_count,open_account_book_count,row_hash)
    VALUES($1,$2,$3,$4,0,'WBPA','176','WBPA','WBPA','ACTIVE','LEGAL_ENTITY','USD',true,'[]','{}',0,0,$5)`,[candidateRowId,ids.tenantId,ids.entityId,candidateId,hash('catalog-row')]);
  const mappingBase={schema_version:'WBS_COMPANY_ENTITY_MAPPING_V1',tenant_id:ids.tenantId,refs_entity_id:ids.entityId,company_code:'WBPA',base_currency:'USD',effective_from:'2026-01-01',effective_to:'2026-12-31',approval_status:'APPROVED',mapping_version:'v1'};
  const mappingHash=(await adminPool.query('SELECT refs_jsonb_hash($1::jsonb) mapping_hash',[JSON.stringify(mappingBase)])).rows[0].mapping_hash,mappingDocument={...mappingBase,mapping_hash:mappingHash};
  await adminPool.query(`INSERT INTO wbs_company_catalog_controller_decision(tenant_id,entity_id,wbs_company_catalog_candidate_id,wbs_company_catalog_candidate_row_id,revision,decision_type,company_code,display_name,legal_name,entity_type,active_status,base_currency,effective_from,effective_to,mapping_version,mapping_document,mapping_hash,reason,decided_by,decision_hash,request_hash)
    VALUES($1,$2,$3,$4,2,'APPROVED','WBPA','WBPA','WBPA','LEGAL_ENTITY','ACTIVE','USD','2026-01-01','2026-12-31','v1',$5::jsonb,$6,'Independent Controller approved exact WBPA scope.','controller-approver',$7,$8)`,[ids.tenantId,ids.entityId,candidateId,candidateRowId,JSON.stringify(mappingDocument),mappingHash,hash('decision'),hash('decision-request')]);
  const controllerDecisionId=(await adminPool.query(`SELECT wbs_company_catalog_controller_decision_id FROM wbs_company_catalog_controller_decision WHERE tenant_id=$1 AND entity_id=$2 AND company_code='WBPA' AND mapping_hash=$3`,[ids.tenantId,ids.entityId,mappingHash])).rows[0].wbs_company_catalog_controller_decision_id;
  const pcDecisionDocument={tenant_id:ids.tenantId,entity_id:ids.entityId,pc_code:'WBPA',company_code:'WBPA',company_mapping_hash:mappingHash,controller_decision_id:controllerDecisionId,approval_status:'APPROVED',effective_from:'2026-01-01',effective_to:'2026-12-31',decided_by:'controller-approver'};
  const pcDecisionHash=(await adminPool.query('SELECT refs_jsonb_hash($1::jsonb) decision_hash',[JSON.stringify(pcDecisionDocument)])).rows[0].decision_hash;
  await adminPool.query(`INSERT INTO wbs_insurance_pc_company_mapping_decision(tenant_id,entity_id,pc_code,company_code,company_mapping_hash,wbs_company_catalog_controller_decision_id,approval_status,effective_from,effective_to,decision_document,decision_hash,decided_by)
    VALUES($1,$2,'WBPA','WBPA',$3,$4,'APPROVED','2026-01-01','2026-12-31',$5::jsonb,$6,'controller-approver')`,[ids.tenantId,ids.entityId,mappingHash,controllerDecisionId,JSON.stringify(pcDecisionDocument),pcDecisionHash]);
  await assert.rejects(adminPool.query(`INSERT INTO wbs_insurance_pc_company_mapping_decision(tenant_id,entity_id,pc_code,company_code,company_mapping_hash,wbs_company_catalog_controller_decision_id,approval_status,effective_from,effective_to,decision_document,decision_hash,decided_by)
    VALUES($1,$2,'BAD','WBPA',$3,$4,'APPROVED','2026-01-01','2026-12-31',$5::jsonb,$6,'controller-approver')`,[ids.tenantId,ids.entityId,mappingHash,controllerDecisionId,JSON.stringify(pcDecisionDocument),pcDecisionHash]),error=>error.code==='23514');
  await adminPool.query("INSERT INTO runtime_actor_grant(tenant_id,actor_id,entity_id,permission) VALUES($1,$2,$3,'WBS.SNAPSHOT.IMPORT')",[ids.tenantId,actor,ids.entityId]);
  const kernel=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,actor,['WBS.SNAPSHOT.IMPORT'])});
  const now=Date.now(),signedAt=new Date(now-60000).toISOString(),expiresAt=new Date(now+9*60000).toISOString(),observationAt=new Date(now-30000).toISOString();
  const controls=amounts=>{const total=amounts.reduce((sum,value)=>sum+BigInt(value.replace('.','')),0n),currency_totals=[{currency:'USD',row_count:amounts.length,amount_total:`${total/10000n}.${String(total%10000n).padStart(4,'0')}`}],row_count=amounts.length,control_totals={row_count,currency_totals};return {row_count,control_totals,control_totals_hash:canonicalRequestHash(control_totals)};};
  const artifactsFor=delivery=>Object.freeze(Object.fromEntries(['receipt','request','response','package'].map(name=>{const content_hash=delivery[name==='receipt'?'receipt_hash':`${name}_raw_hash`];return [name,{storage_ref:`s3://refs-wbs-final1/${delivery.domain}/${name}`,storage_version:`v-${name}`,size_bytes:100,media_type:['receipt','package'].includes(name)?'application/json':'application/octet-stream',content_hash,retentionMode:'COMPLIANCE',retainUntil:new Date(now+365*86400000).toISOString(),scan_clean:true,scan_ref:`clamav:${content_hash.slice(7)}:clean`}];})));
  const deliveryBase=domain=>({admission_id:randomUUID(),domain,issuer:'wbs-provider',key_id:'wbs-final1-key',algorithm:'Ed25519',nonce:`nonce-${domain.toLowerCase()}`,company_code:'WBPA',signed_at:signedAt,expires_at:expiresAt,observation_at:observationAt,date_from:'2026-01-01',date_to:'2026-12-31',snapshot_id:randomUUID(),receipt_hash:hash(`${domain}-receipt`),request_raw_hash:hash(`${domain}-request`),response_raw_hash:hash(`${domain}-response`),package_raw_hash:hash(`${domain}-package-raw`),package_hash:hash(`${domain}-package`),signature_verified:true});
  const knownControlTotals={row_count:1,currency_totals:[{currency:'USD',row_count:1,amount_total:'10.0000'}]},knownCanonicalBody='{"currency_totals":[{"amount_total":"10.0000","currency":"USD","row_count":1}],"row_count":1}',knownControlTotalsHash='sha256:faa6c295db3c0d8e097f0f897b7da3102ae098551023cc9e55bba1ebd14011e1';
  assert.equal(canonicalRequestHash(knownControlTotals),knownControlTotalsHash);
  const knownVector=(await adminPool.query('SELECT refs_canonical_jsonb_text($1::jsonb) canonical_body,refs_wbs_final1_control_totals_hash($1::jsonb) control_totals_hash',[JSON.stringify(knownControlTotals)])).rows[0];
  assert.deepEqual(knownVector,{canonical_body:knownCanonicalBody,control_totals_hash:knownControlTotalsHash});
  const payableControls=controls(['125.2500']),payableDelivery={...deliveryBase('PAYABLES'),...payableControls,plan_hash:hash('payable-plan')};
  const payableRowHash=hash('payable-row'),payableRecord=randomUUID(),payablePlan={status:'NORMALIZED_FINAL1_PAYABLE_STAGING_PLAN',plan_hash:payableDelivery.plan_hash,provenance:{tenant_id:ids.tenantId,entity_id:ids.entityId,company_code:'WBPA',snapshot_id:payableDelivery.snapshot_id,currency:'USD',source_row_count:1,source_surface:{database:'wbsdata',table:'account_book_payable_info'}},staging_rows:[{source_record_id:payableRecord,source_primary_key:payableRecord,source_row_ordinal:0,source_version:'final1:payable:v1',raw_row_hash:payableRowHash,raw_row:{ap_guid:payableRecord,company_code:'WBPA',amount:'125.2500',posting_date:'2026-01-15',incurred_date:null,vendor_no:'VENDOR-1',vendor_name:'Vendor',invoice_no:'INV-1',invoice_date:null,business_id:null,service_period_start:null,service_period_end:null,recurring_obligation_id:null,contract_id:null,charge_code:null,service_frequency:null,obligation_status:null},provider_snapshot_id:payableDelivery.snapshot_id,provider_company_code:'WBPA',provider_package_hash:payableDelivery.package_hash,provider_raw_package_hash:payableDelivery.package_raw_hash,currency:'USD',source_module:'BGDATA.payable',source_surface:{database:'wbsdata',table:'account_book_payable_info'},normalized:{apGuId:payableRecord,amount:'125.2500',invoiceNo:'INV-1',vendorRef:'VENDOR-1',vendorName:'Vendor',postingDate:'2026-01-15',incurredDate:null,invoiceDate:null,businessId:null,description:'Signed payable',projectRef:null},outcome:'STAGING_REVIEW_REQUIRED',exception_codes:['WBS_PAYABLE_ATTACHMENT_REQUIRED','WBS_PAYABLE_MAPPING_REVIEW_REQUIRED'],can_propose_amortization:false,can_create_draft:false,can_review:false,can_approve:false,can_post:false}],can_propose_amortization:false,can_create_draft:false,can_review:false,can_approve:false,can_post:false};
  const payable=await kernel.retainWbsProviderFinal1SourceEvidence({tenantId:ids.tenantId,entityId:ids.entityId,delivery:payableDelivery,artifacts:artifactsFor(payableDelivery),plan:payablePlan,idempotencyKey:'wbs-final1-payable-pg-001'});
  assert.equal(payable.status,'WBS_FINAL1_RETAINED_SOURCE_EVIDENCE');assert.equal(payable.row_count,1);assert.equal(payable.can_write_wbs,false);assert.equal((await kernel.retainWbsProviderFinal1SourceEvidence({tenantId:ids.tenantId,entityId:ids.entityId,delivery:payableDelivery,artifacts:artifactsFor(payableDelivery),plan:payablePlan,idempotencyKey:'wbs-final1-payable-pg-001'})).idempotent,true);
  const payablePersistedControl=(await adminPool.query('SELECT control_totals,control_totals_hash FROM wbs_final1_signed_control_total WHERE tenant_id=$1 AND entity_id=$2 AND wbs_final1_retained_evidence_admission_id=$3',[ids.tenantId,ids.entityId,payableDelivery.admission_id])).rows[0];
  assert.deepEqual(payablePersistedControl,{control_totals:payableControls.control_totals,control_totals_hash:payableControls.control_totals_hash});
  const writeCounts=async()=>(await adminPool.query(`SELECT
    (SELECT count(*)::int FROM idempotency_receipt WHERE tenant_id=$1) idempotency,
    (SELECT count(*)::int FROM import_batch WHERE tenant_id=$1) imports,
    (SELECT count(*)::int FROM wbs_final1_retained_evidence_admission WHERE tenant_id=$1) admissions,
    (SELECT count(*)::int FROM wbs_final1_retained_source_row WHERE tenant_id=$1) retained,
    (SELECT count(*)::int FROM raw_event WHERE tenant_id=$1) raw_events,
    (SELECT count(*)::int FROM source_document WHERE tenant_id=$1) documents,
    (SELECT count(*)::int FROM source_document_line WHERE tenant_id=$1) document_lines,
    (SELECT count(*)::int FROM source_link WHERE tenant_id=$1) source_links,
    (SELECT count(*)::int FROM accounting_exception WHERE tenant_id=$1) exceptions,
    (SELECT count(*)::int FROM wbs_final1_signed_control_total WHERE tenant_id=$1) controls,
    (SELECT count(*)::int FROM wbs_final1_signed_business_source_row WHERE tenant_id=$1) business_rows,
    (SELECT count(*)::int FROM ai_amortization_coverage_evidence WHERE tenant_id=$1) coverage,
    (SELECT count(*)::int FROM ai_prepaid_coverage_finding WHERE tenant_id=$1) findings,
    (SELECT count(*)::int FROM staging_item WHERE tenant_id=$1) staging,
    (SELECT count(*)::int FROM business_document WHERE tenant_id=$1) business_documents,
    (SELECT count(*)::int FROM journal_entry WHERE tenant_id=$1) journals,
    (SELECT count(*)::int FROM ledger_line WHERE tenant_id=$1) ledger,
    (SELECT count(*)::int FROM audit_event WHERE tenant_id=$1) audit,
    (SELECT count(*)::int FROM outbox_event WHERE tenant_id=$1) outbox`,[ids.tenantId])).rows[0];
  const rejectSignedControls=async(label,signedControls)=>{
    const directSession=await trustedSession(ids,actor,['WBS.SNAPSHOT.IMPORT']),directKernel=new PostgresAccountingKernel(runtimePool,{sessionProvider:async()=>directSession}),before=await writeCounts(),snapshotId=randomUUID(),sourceRecordId=randomUUID(),delivery={...payableDelivery,...signedControls,admission_id:randomUUID(),snapshot_id:snapshotId,nonce:`nonce-payable-controls-${label}`,receipt_hash:hash(`payable-controls-${label}-receipt`),request_raw_hash:hash(`payable-controls-${label}-request`),response_raw_hash:hash(`payable-controls-${label}-response`),package_raw_hash:hash(`payable-controls-${label}-package-raw`),package_hash:hash(`payable-controls-${label}-package`)},row={...payablePlan.staging_rows[0],source_record_id:sourceRecordId,source_primary_key:sourceRecordId,provider_snapshot_id:snapshotId,provider_package_hash:null,provider_raw_package_hash:null,raw_row:{...payablePlan.staging_rows[0].raw_row,ap_guid:sourceRecordId},normalized:{...payablePlan.staging_rows[0].normalized,apGuId:sourceRecordId}},plan={...payablePlan,provenance:{...payablePlan.provenance,snapshot_id:snapshotId},staging_rows:[]};
    row.provider_package_hash=delivery.package_hash;row.provider_raw_package_hash=delivery.package_raw_hash;row.raw_row_hash=canonicalRequestHash(row.raw_row);row.source_version=`final1:payable:${snapshotId}:${row.raw_row_hash.slice(7,23)}`;plan.staging_rows=[row];plan.plan_hash=canonicalRequestHash({provenance:plan.provenance,row_hashes:[row.raw_row_hash]});delivery.plan_hash=plan.plan_hash;
    const artifacts=Object.fromEntries(Object.entries(artifactsFor(delivery)).map(([name,value])=>[name,{...value,storage_ref:`s3://refs-wbs-final1/${delivery.domain}/${snapshotId}/${name}`,storage_version:`${snapshotId}-${name}`} ]));
    await assert.rejects(directKernel.retainWbsProviderFinal1SourceEvidence({tenantId:ids.tenantId,entityId:ids.entityId,delivery,artifacts,plan,idempotencyKey:`wbs-final1-payable-controls-${label}`}),error=>error.code==='22023');
    assert.deepEqual(await writeCounts(),before,`invalid canonical control totals ${label} must roll back the whole retained-evidence state`);
  };
  const legacyControlTotals={row_count:1,per_currency_totals:[{currency:'USD',gross_amount:'10.0000'}]};
  await rejectSignedControls('legacy-shape',{row_count:1,control_totals:legacyControlTotals,control_totals_hash:canonicalRequestHash(legacyControlTotals)});
  await rejectSignedControls('one-hex-hash',{row_count:1,control_totals:knownControlTotals,control_totals_hash:'sha256:0aa6c295db3c0d8e097f0f897b7da3102ae098551023cc9e55bba1ebd14011e1'});
  const rejectDirectPayable=async(label,mutate)=>{
    const directSession=await trustedSession(ids,actor,['WBS.SNAPSHOT.IMPORT']),directKernel=new PostgresAccountingKernel(runtimePool,{sessionProvider:async()=>directSession}),before=await writeCounts(),snapshotId=randomUUID(),sourceRecordId=randomUUID(),delivery={...payableDelivery,admission_id:randomUUID(),snapshot_id:snapshotId,nonce:`nonce-payable-direct-${label}`,receipt_hash:hash(`payable-direct-${label}-receipt`),request_raw_hash:hash(`payable-direct-${label}-request`),response_raw_hash:hash(`payable-direct-${label}-response`),package_raw_hash:hash(`payable-direct-${label}-package-raw`),package_hash:hash(`payable-direct-${label}-package`),plan_hash:hash(`payable-direct-${label}`)},row={...payablePlan.staging_rows[0],source_record_id:sourceRecordId,source_primary_key:sourceRecordId,provider_snapshot_id:snapshotId,raw_row:{...payablePlan.staging_rows[0].raw_row,ap_guid:sourceRecordId},normalized:{...payablePlan.staging_rows[0].normalized,apGuId:sourceRecordId},exception_codes:[...payablePlan.staging_rows[0].exception_codes]},plan={...payablePlan,plan_hash:delivery.plan_hash,provenance:{...payablePlan.provenance,snapshot_id:snapshotId},staging_rows:[row]};
    mutate(row); row.raw_row_hash=canonicalRequestHash(row.raw_row); row.source_version=`final1:payable:${snapshotId}:${row.raw_row_hash.slice(7,23)}`; plan.plan_hash=canonicalRequestHash({provenance:plan.provenance,row_hashes:[row.raw_row_hash]}); delivery.plan_hash=plan.plan_hash;
    const artifacts=Object.fromEntries(Object.entries(artifactsFor(delivery)).map(([name,value])=>[name,{...value,storage_ref:`s3://refs-wbs-final1/${delivery.domain}/${snapshotId}/${name}`,storage_version:`${snapshotId}-${name}`} ]));
    await assert.rejects(directKernel.retainWbsProviderFinal1SourceEvidence({tenantId:ids.tenantId,entityId:ids.entityId,delivery,artifacts,plan,idempotencyKey:`wbs-final1-payable-direct-${label}`}),error=>['22023','23514'].includes(error.code));
    assert.deepEqual(await writeCounts(),before,`invalid Final-1 Payables ${label} must be zero-write`);
  };
  for(const key of ['invoice_no','invoice_date','business_id','service_period_start','service_period_end','recurring_obligation_id','contract_id','charge_code','service_frequency','obligation_status'])await rejectDirectPayable(`missing-${key}`,row=>{delete row.raw_row[key];});
  for(const key of ['service_period_start','service_period_end','recurring_obligation_id','contract_id','charge_code','service_frequency','obligation_status'])await rejectDirectPayable(`nonnull-${key}`,row=>{row.raw_row[key]='forged';});
  for(const [rawKey,normalizedKey,value] of [['invoice_no','invoiceNo','forged-invoice'],['invoice_date','invoiceDate','2026-01-31'],['business_id','businessId','forged-business']])await rejectDirectPayable(`raw-normalized-${rawKey}`,row=>{row.raw_row[rawKey]=value;row.normalized[normalizedKey]=value;});
  await rejectDirectPayable('invoice-iff-positive',row=>{row.outcome='EXCEPTION_REVIEW_REQUIRED';row.exception_codes=['WBS_PAYABLE_INVOICE_NUMBER_MISSING','WBS_PAYABLE_ATTACHMENT_REQUIRED','WBS_PAYABLE_MAPPING_REVIEW_REQUIRED'];});
  await rejectDirectPayable('vendor-iff-positive',row=>{row.outcome='EXCEPTION_REVIEW_REQUIRED';row.exception_codes=['WBS_PAYABLE_VENDOR_MISSING','WBS_PAYABLE_ATTACHMENT_REQUIRED','WBS_PAYABLE_MAPPING_REVIEW_REQUIRED'];});
  const buildPayablePopulation=size=>{
    const populationControls=controls(Array.from({length:size},()=> '125.2500')),delivery={...payableDelivery,...populationControls,admission_id:randomUUID(),nonce:`nonce-payables-population-${size}`,receipt_hash:hash(`payables-population-${size}-receipt`),request_raw_hash:hash(`payables-population-${size}-request`),response_raw_hash:hash(`payables-population-${size}-response`),package_raw_hash:hash(`payables-population-${size}-package-raw`),package_hash:hash(`payables-population-${size}-package`),snapshot_id:randomUUID()};
    const provenance={...payablePlan.provenance,snapshot_id:delivery.snapshot_id,provider_package_hash:delivery.package_hash,provider_raw_package_hash:delivery.package_raw_hash,source_row_count:size};
    const rows=Array.from({length:size},(_,index)=>{
      const sourceRecordId=`00000000-0000-4000-8000-${String(index+1).padStart(12,'0')}`;
      const rawRow={...payablePlan.staging_rows[0].raw_row,ap_guid:sourceRecordId,invoice_no:`INV-POP-${index+1}`};
      const rawRowHash=canonicalRequestHash(rawRow);
      return {...payablePlan.staging_rows[0],source_record_id:sourceRecordId,source_primary_key:sourceRecordId,source_row_ordinal:index,source_version:`final1:${delivery.snapshot_id}:${rawRowHash.slice(7,23)}`,raw_row:rawRow,raw_row_hash:rawRowHash,provider_snapshot_id:delivery.snapshot_id,provider_package_hash:delivery.package_hash,provider_raw_package_hash:delivery.package_raw_hash,normalized:{...payablePlan.staging_rows[0].normalized,apGuId:sourceRecordId,invoiceNo:`INV-POP-${index+1}`}};
    });
    const plan={...payablePlan,provenance,staging_rows:rows,exception_rows:rows.filter(row=>row.outcome==='EXCEPTION_REVIEW_REQUIRED'),plan_hash:canonicalRequestHash({provenance,row_hashes:rows.map(row=>row.raw_row_hash)})};
    delivery.plan_hash=plan.plan_hash;
    return {delivery,plan};
  };
  const population500=buildPayablePopulation(500),population500Before=await writeCounts();
  const retained500=await kernel.retainWbsProviderFinal1SourceEvidence({tenantId:ids.tenantId,entityId:ids.entityId,delivery:population500.delivery,artifacts:artifactsFor(population500.delivery),plan:population500.plan,idempotencyKey:'wbs-final1-payable-population-500'});
  assert.equal(retained500.row_count,500);assert.equal((await kernel.retainWbsProviderFinal1SourceEvidence({tenantId:ids.tenantId,entityId:ids.entityId,delivery:population500.delivery,artifacts:artifactsFor(population500.delivery),plan:population500.plan,idempotencyKey:'wbs-final1-payable-population-500'})).idempotent,true);
  const population500After=await writeCounts();assert.equal(population500After.retained,population500Before.retained+500);assert.equal(population500After.documents,population500Before.documents+500);assert.equal(population500After.document_lines,population500Before.document_lines+500);
  const population501=buildPayablePopulation(501),population501Before=await writeCounts();
  await assert.rejects(kernel.retainWbsProviderFinal1SourceEvidence({tenantId:ids.tenantId,entityId:ids.entityId,delivery:population501.delivery,artifacts:artifactsFor(population501.delivery),plan:population501.plan,idempotencyKey:'wbs-final1-payable-population-501'}),error=>['22023','23514'].includes(error.code));
  const population501After=await writeCounts();assert.deepEqual({...population501After,audit:population501Before.audit},population501Before,'501 Final-1 Payables rows must fail before retained/source/accounting/outbox writes');
  const insuranceControls=controls(['999999999999999899.9900','100.0000']),insuranceDelivery={...deliveryBase('INSURANCE'),...insuranceControls,company_mapping_hash:mappingHash,plan_hash:hash('insurance-plan')},candidateHash=hash('insurance-candidate'),gapHash=hash('insurance-gap');
  const insurancePlan={status:'NORMALIZED_FINAL1_INSURANCE_EVIDENCE_PLAN',plan_hash:insuranceDelivery.plan_hash,provenance:{tenant_id:ids.tenantId,entity_id:ids.entityId,company_code:'WBPA',snapshot_id:insuranceDelivery.snapshot_id,currency:'USD',company_mapping_hash:mappingHash,source_row_count:2,source_surface:{database:'wb_insurance',table:'insurance_data'}},evidence_rows:[
    {source_record_id:'POLICY-1',source_primary_key:'1',source_row_ordinal:0,source_version:'final1:insurance:v1',raw_row_hash:candidateHash,raw_row:{company_code:null,pc_code:'WBPA'},provider_snapshot_id:insuranceDelivery.snapshot_id,provider_company_code:'WBPA',provider_package_hash:insuranceDelivery.package_hash,provider_raw_package_hash:insuranceDelivery.package_raw_hash,company_mapping_hash:mappingHash,company_mapping_trace:{pc_code:'WBPA',mapping_authority:'UNRESOLVED_PENDING_SERVER_DECISION',controller_approved:false,company_mapping_hash:mappingHash},currency:'USD',source_module:'payable',source_domain:'insurance',source_surface:{database:'wb_insurance',table:'insurance_data'},normalized:{policyId:'POLICY-1',sourceId:'1',pcCode:'WBPA',policyNumber:'P-1',carrier:'Carrier',insuranceType:'Annual',finalPremium:'999999999999999899.99',startDate:'2026-01-01',expireDate:'2026-12-31'},outcome:'AMORTIZATION_COVERAGE_EVIDENCE_CANDIDATE',exception_codes:[],can_propose_amortization:false,can_create_draft:false,can_review:false,can_approve:false,can_post:false},
    {source_record_id:'POLICY-2',source_primary_key:'2',source_row_ordinal:1,source_version:'final1:insurance:v1',raw_row_hash:gapHash,raw_row:{company_code:null,pc_code:'WBPA'},provider_snapshot_id:insuranceDelivery.snapshot_id,provider_company_code:'WBPA',provider_package_hash:insuranceDelivery.package_hash,provider_raw_package_hash:insuranceDelivery.package_raw_hash,company_mapping_hash:mappingHash,company_mapping_trace:{pc_code:'WBPA',mapping_authority:'UNRESOLVED_PENDING_SERVER_DECISION',controller_approved:false,company_mapping_hash:mappingHash},currency:'USD',source_module:'payable',source_domain:'insurance',source_surface:{database:'wb_insurance',table:'insurance_data'},normalized:{policyId:'POLICY-2',sourceId:'2',pcCode:'WBPA',policyNumber:'P-2',carrier:'Carrier',insuranceType:'Annual',finalPremium:'100.00',startDate:null,expireDate:null},outcome:'EXCEPTION_REVIEW_REQUIRED',exception_codes:['INSURANCE_COVERAGE_DATE_MISSING'],can_propose_amortization:false,can_create_draft:false,can_review:false,can_approve:false,can_post:false}
  ],can_propose_amortization:false,can_create_draft:false,can_review:false,can_approve:false,can_post:false};
  const insurance=await kernel.retainWbsProviderFinal1SourceEvidence({tenantId:ids.tenantId,entityId:ids.entityId,delivery:insuranceDelivery,artifacts:artifactsFor(insuranceDelivery),plan:insurancePlan,idempotencyKey:'wbs-final1-insurance-pg-001'});
  assert.equal(insurance.coverage_evidence_count,1);assert.equal(insurance.prepaid_coverage_finding_count,1);assert.equal(insurance.can_propose_amortization,false);
  const insuranceTrace=(await adminPool.query(`SELECT d.source_document_id,d.gross_amount::text gross_amount,l.external_dimension_refs FROM wbs_final1_retained_source_row r JOIN source_document d ON d.tenant_id=r.tenant_id AND d.entity_id=r.entity_id AND d.source_document_id=r.source_document_id JOIN source_document_line l ON l.tenant_id=r.tenant_id AND l.entity_id=r.entity_id AND l.source_document_line_id=r.source_document_line_id WHERE r.tenant_id=$1 AND r.entity_id=$2 AND r.domain='INSURANCE' AND r.source_primary_key='1'`,[ids.tenantId,ids.entityId])).rows[0];
  assert.equal(insuranceTrace.gross_amount,'999999999999999899.9900');assert.equal(insuranceTrace.external_dimension_refs.insurance_pc_mapping_match_count,1);assert.equal(insuranceTrace.external_dimension_refs.insurance_pc_mapping_approved,true);assert.equal(insuranceTrace.external_dimension_refs.insurance_pc_mapping_resolved_entity_id,ids.entityId);assert.equal(insuranceTrace.external_dimension_refs.insurance_pc_mapping_resolved_company_code,'WBPA');
  const sourceReader=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'provider-trace-reader',['GL.JE.VIEW'])}),payableTrace=(await adminPool.query(`SELECT d.source_document_id FROM wbs_final1_retained_source_row r JOIN source_document d ON d.tenant_id=r.tenant_id AND d.entity_id=r.entity_id AND d.source_document_id=r.source_document_id WHERE r.tenant_id=$1 AND r.entity_id=$2 AND r.domain='PAYABLES' AND r.source_primary_key=$3`,[ids.tenantId,ids.entityId,payableRecord])).rows[0],payableDetail=await sourceReader.getSourceDocumentDetail({tenantId:ids.tenantId,entityId:ids.entityId,sourceDocumentId:payableTrace.source_document_id}),insuranceDetail=await sourceReader.getSourceDocumentDetail({tenantId:ids.tenantId,entityId:ids.entityId,sourceDocumentId:insuranceTrace.source_document_id}),providerTrace=insuranceDetail[0].lines[0].provider_trace;
  assert.deepEqual(payableDetail[0].lines[0].provider_trace,{trace_version:'WBS_PROVIDER_SOURCE_TRACE_V1',domain:'PAYABLES',source_payload_hash:payableDetail[0].payload_hash,disposition:'RETAINED',action_flags:{can_propose_amortization:false,can_review:false,can_create_draft:false,can_approve:false,can_post:false},invoice_no:'INV-1',invoice_date:null,business_id:null,accrual:{service_period_start:null,service_period_end:null,recurring_obligation_id:null,contract_id:null,charge_code:null,service_frequency:null,obligation_status:null}});
  assert.deepEqual(providerTrace,{trace_version:'WBS_PROVIDER_SOURCE_TRACE_V1',domain:'INSURANCE',source_payload_hash:insuranceDetail[0].payload_hash,action_flags:{can_propose_amortization:false,can_review:false,can_create_draft:false,can_approve:false,can_post:false},policy_id:'POLICY-1',source_id:'1',pc_code:'WBPA',final_premium:'999999999999999899.9900',mapping_decision_id:insuranceTrace.external_dimension_refs.insurance_pc_mapping_id,mapping_decision_hash:pcDecisionHash,company_mapping_hash:mappingHash,resolved_company_code:'WBPA',match_count:1,disposition:'RESOLVED',coverage_start:'2026-01-01',coverage_end:'2026-12-31',coverage_disposition:'POSITIVE_COVERAGE'});
  const insuranceGap=(await adminPool.query(`SELECT d.source_document_id FROM wbs_final1_retained_source_row r JOIN source_document d ON d.tenant_id=r.tenant_id AND d.entity_id=r.entity_id AND d.source_document_id=r.source_document_id WHERE r.tenant_id=$1 AND r.entity_id=$2 AND r.domain='INSURANCE' AND r.source_primary_key='2'`,[ids.tenantId,ids.entityId])).rows[0],gapDetail=await sourceReader.getSourceDocumentDetail({tenantId:ids.tenantId,entityId:ids.entityId,sourceDocumentId:insuranceGap.source_document_id});
  assert.deepEqual(gapDetail[0].lines[0].provider_trace,{trace_version:'WBS_PROVIDER_SOURCE_TRACE_V1',domain:'INSURANCE',source_payload_hash:gapDetail[0].payload_hash,action_flags:{can_propose_amortization:false,can_review:false,can_create_draft:false,can_approve:false,can_post:false},policy_id:'POLICY-2',source_id:'2',pc_code:'WBPA',final_premium:'100.0000',mapping_decision_id:null,mapping_decision_hash:null,company_mapping_hash:null,resolved_company_code:null,match_count:0,disposition:'QUARANTINED',coverage_start:null,coverage_end:null,coverage_disposition:'EXCEPTION_REVIEW_REQUIRED'});
  const counts=(await adminPool.query(`SELECT
    (SELECT count(*)::int FROM wbs_final1_retained_source_row WHERE tenant_id=$1) retained,
    (SELECT count(*)::int FROM source_document WHERE tenant_id=$1) documents,
    (SELECT count(*)::int FROM ai_amortization_coverage_evidence WHERE tenant_id=$1) coverage,
    (SELECT count(*)::int FROM ai_prepaid_coverage_finding WHERE tenant_id=$1) findings,
    (SELECT count(*)::int FROM staging_item WHERE tenant_id=$1) staging,
    (SELECT count(*)::int FROM journal_entry WHERE tenant_id=$1) journals,
    (SELECT count(*)::int FROM ledger_line WHERE tenant_id=$1) ledger`,[ids.tenantId])).rows[0];
  assert.deepEqual(counts,{retained:503,documents:503,coverage:1,findings:1,staging:0,journals:0,ledger:0});
  const statuses=(await adminPool.query('SELECT status::text,accounting_period_id FROM source_document d JOIN wbs_final1_retained_source_row r USING(tenant_id,entity_id,source_document_id) WHERE d.tenant_id=$1 ORDER BY r.domain,r.source_row_ordinal',[ids.tenantId])).rows;
  assert.equal(statuses.length,503);assert.equal(statuses.filter(row=>row.status==='PENDING_REVIEW').length,502);assert.equal(statuses.filter(row=>row.status==='QUARANTINED').length,1);assert.ok(statuses.some(row=>row.accounting_period_id));
  const otherActor='wbs-final1-other-importer';await adminPool.query("INSERT INTO runtime_actor_grant(tenant_id,actor_id,entity_id,permission) VALUES($1,$2,$3,'WBS.SNAPSHOT.IMPORT')",[ids.tenantId,otherActor,ids.entityId]);
  const otherKernel=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,otherActor,['WBS.SNAPSHOT.IMPORT'])});
  for(const domain of ['BANK','COST','PROPERTY']){
    const source_tool=domain==='BANK'?'list_bank_transactions':'list_control_totals',signed=controls(['10.0000']),delivery={...deliveryBase(domain),...signed,source_tool,plan_hash:hash(`${domain}-business-plan`)},rowHash=hash(`${domain}-business-row`),sourceRecord=`${domain}-SOURCE-1`,plan={status:'NORMALIZED_FINAL1_BUSINESS_EVIDENCE_PLAN',plan_hash:delivery.plan_hash,provenance:{tenant_id:ids.tenantId,entity_id:ids.entityId,company_code:'WBPA',domain,source_tool,snapshot_id:delivery.snapshot_id,source_row_count:1,row_count:1,control_totals:signed.control_totals,control_totals_hash:signed.control_totals_hash,currency:'USD'},evidence_rows:[{source_system:'WBS',source_module:source_tool,source_domain:domain,source_record_id:sourceRecord,source_primary_key:sourceRecord,source_row_ordinal:0,source_version:`final1:${delivery.snapshot_id}:${rowHash.slice(7,23)}`,raw_row_hash:rowHash,provider_snapshot_id:delivery.snapshot_id,provider_package_hash:delivery.package_hash,provider_raw_package_hash:delivery.package_raw_hash,provider_company_code:'WBPA',currency:'USD',gross_amount:'10.0000',business_date:'2026-01-15',outcome:domain==='BANK'?'STAGING_REVIEW_REQUIRED':'CONTROL_EVIDENCE_ONLY',exception_codes:[],can_create_transaction:false,can_create_draft:false,can_review:false,can_approve:false,can_post:false}],can_persist_evidence:true,can_create_transaction:false,can_create_draft:false,can_review:false,can_approve:false,can_post:false},idempotencyKey=`controller167-${domain.toLowerCase()}-0001`,args={tenantId:ids.tenantId,entityId:ids.entityId,delivery,artifacts:artifactsFor(delivery),plan,idempotencyKey};
    const before=(await adminPool.query('SELECT count(*)::int rows FROM wbs_final1_signed_business_source_row WHERE tenant_id=$1',[ids.tenantId])).rows[0].rows,crossPeriodPlan=structuredClone(plan);crossPeriodPlan.evidence_rows[0].business_date='2027-01-15';
    await assert.rejects(kernel.retainWbsProviderFinal1SourceEvidence({...args,plan:crossPeriodPlan,idempotencyKey:`controller167-${domain.toLowerCase()}-cross-period`}),error=>error.code==='23514');
    assert.equal((await adminPool.query('SELECT count(*)::int rows FROM wbs_final1_signed_business_source_row WHERE tenant_id=$1',[ids.tenantId])).rows[0].rows,before);
    const result=await kernel.retainWbsProviderFinal1SourceEvidence(args);assert.equal(result.domain,domain);assert.equal(result.control_totals_hash,signed.control_totals_hash);assert.equal((await kernel.retainWbsProviderFinal1SourceEvidence(args)).idempotent,true);
    const persistedBusinessSource=(await adminPool.query('SELECT r.source_tool,d.source_module,e.source_module raw_source_module FROM wbs_final1_signed_business_source_row r JOIN source_document d ON d.tenant_id=r.tenant_id AND d.entity_id=r.entity_id AND d.source_document_id=r.source_document_id JOIN raw_event e ON e.tenant_id=r.tenant_id AND e.raw_event_id=r.raw_event_id WHERE r.tenant_id=$1 AND r.entity_id=$2 AND r.wbs_final1_retained_evidence_admission_id=$3',[ids.tenantId,ids.entityId,delivery.admission_id])).rows[0],canonicalSourceModule={BANK:'bankFeed',COST:'cost_general_ledger',PROPERTY:'pmCharge'}[domain];
    assert.deepEqual(persistedBusinessSource,{source_tool,source_module:canonicalSourceModule,raw_source_module:canonicalSourceModule});
    const persistedControl=(await adminPool.query('SELECT control_totals,control_totals_hash FROM wbs_final1_signed_control_total WHERE tenant_id=$1 AND entity_id=$2 AND wbs_final1_retained_evidence_admission_id=$3',[ids.tenantId,ids.entityId,delivery.admission_id])).rows[0];
    assert.deepEqual(persistedControl,{control_totals:signed.control_totals,control_totals_hash:signed.control_totals_hash});
    if(domain==='BANK')assert.deepEqual(persistedControl,{control_totals:knownControlTotals,control_totals_hash:knownControlTotalsHash});
    await assert.rejects(otherKernel.retainWbsProviderFinal1SourceEvidence(args),error=>error.code==='23505');
    const changed={...delivery,admission_id:randomUUID(),nonce:`changed-${domain}`,control_totals_hash:hash('wrong-control')};await assert.rejects(kernel.retainWbsProviderFinal1SourceEvidence({...args,delivery:changed,artifacts:artifactsFor(changed),idempotencyKey:`controller167-${domain.toLowerCase()}-drift`}),error=>error.code==='22023');
    assert.equal((await adminPool.query('SELECT count(*)::int rows FROM wbs_final1_signed_business_source_row WHERE tenant_id=$1',[ids.tenantId])).rows[0].rows,before+1);
  }
  const controller167=(await adminPool.query(`SELECT (SELECT count(*)::int FROM wbs_final1_signed_control_total WHERE tenant_id=$1) controls,(SELECT count(*)::int FROM wbs_final1_signed_business_source_row WHERE tenant_id=$1) business,(SELECT count(*)::int FROM journal_entry WHERE tenant_id=$1) journals,(SELECT count(*)::int FROM ledger_line WHERE tenant_id=$1) ledger`,[ids.tenantId])).rows[0];assert.deepEqual(controller167,{controls:6,business:3,journals:0,ledger:0});
});

pgTest('WBS TEST IMPORT atomically creates and posts an unsigned Payable while retaining an out-of-period source date',async()=>{
  const ids=await seed({status:'DRAFT',attachmentStatus:null}),other=await seed({status:'DRAFT',attachmentStatus:null});
  await adminPool.query('DELETE FROM journal_line WHERE tenant_id=$1 AND entity_id=$2 AND journal_entry_id=$3',[ids.tenantId,ids.entityId,ids.journalId]);
  await adminPool.query('DELETE FROM journal_entry WHERE tenant_id=$1 AND entity_id=$2 AND journal_entry_id=$3',[ids.tenantId,ids.entityId,ids.journalId]);
  await adminPool.query("UPDATE account_master SET requires_member=false,required_member_type=NULL WHERE account_code='291001' AND ((tenant_id=$1 AND entity_id=$2) OR (tenant_id=$3 AND entity_id=$4))",[ids.tenantId,ids.entityId,other.tenantId,other.entityId]);
  await adminPool.query("UPDATE entity SET source_system='REFS_STAGE1',source_entity_id='LEGACY-WBPA' WHERE tenant_id=$1 AND entity_id=$2",[ids.tenantId,ids.entityId]);
  const otherEntityBinding=(await adminPool.query('SELECT source_system,source_entity_id FROM entity WHERE tenant_id=$1 AND entity_id=$2',[other.tenantId,other.entityId])).rows[0];
  const rows=Array.from({length:10},(_,index)=>({source_record_hash:hash(`wbs-test-payable-row-${index}`),currency:'USD',accounting_date:index===0?'2025-02-15':`2025-03-${String(index+1).padStart(2,'0')}`,amount:index===0?'-12.3000':'1.0000',status:'CLEAR'})),row=rows[0];
  const observation={schema_version:'WBS_LIVE_PILOT_OBSERVATION_V1',status:'NOT_ADMITTED',observation_mode:'UNSIGNED_PILOT',source_system:'WBS',tool:'list_payables',environment:'PRODUCTION',entity_id:ids.entityId,captured_at:'2026-08-18T00:00:00.000Z',provider_content_sha256:createHash('sha256').update('provider-content').digest('hex'),scope:{company_codes:['WBPA'],date_range:['2025-01-01','2025-12-31']},record_count:10,rows,signature_verified:false,can_import:false,can_create_transaction:false,can_match:false,can_allocate:false,can_create_draft:false,can_approve:false,can_post:false,can_reverse:false,observation_hash:hash('wbs-test-observation')};
  const untouchedAccount=(await adminPool.query("SELECT account_name,requires_member,required_member_type,active FROM account_master WHERE tenant_id=$1 AND entity_id=$2 AND account_code='120200'",[ids.tenantId,ids.entityId])).rows[0];
  const counts=async()=>(await adminPool.query(`SELECT
    (SELECT count(*)::int FROM import_batch WHERE tenant_id=$1) import_batches,
    (SELECT count(*)::int FROM raw_event WHERE tenant_id=$1) raw_events,
    (SELECT count(*)::int FROM source_document WHERE tenant_id=$1) source_documents,
    (SELECT count(*)::int FROM attachment WHERE tenant_id=$1) attachments,
    (SELECT count(*)::int FROM business_document WHERE tenant_id=$1) business_documents,
    (SELECT count(*)::int FROM journal_entry WHERE tenant_id=$1) journals,
    (SELECT count(*)::int FROM wbs_test_import_draft WHERE tenant_id=$1) traces,
    (SELECT count(*)::int FROM audit_event WHERE tenant_id=$1 AND permission_used NOT LIKE 'AUTH.%') audits,
    (SELECT count(*)::int FROM outbox_event WHERE tenant_id=$1) outbox,
    (SELECT count(*)::int FROM idempotency_receipt WHERE tenant_id=$1) receipts`,[ids.tenantId])).rows[0];
  const noApSession=await trustedSession(ids,'wbs-test-no-ap',['WBS.TEST.IMPORT']);
  const noApKernel=new PostgresAccountingKernel(runtimePool,{sessionProvider:async()=>noApSession});
  const before=await counts();
  await assert.rejects(noApKernel.createWbsTestPayableDraft({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId,observation,row,rowIndex:0,idempotencyKey:'wbs-test-no-ap-0001'}),error=>error.code==='42501');
  assert.deepEqual(await counts(),before);
  assert.deepEqual((await adminPool.query("SELECT requires_member,required_member_type FROM account_master WHERE tenant_id=$1 AND entity_id=$2 AND account_code='291001'",[ids.tenantId,ids.entityId])).rows[0],{requires_member:false,required_member_type:null});
  assert.deepEqual((await adminPool.query('SELECT source_system,source_entity_id FROM entity WHERE tenant_id=$1 AND entity_id=$2',[ids.tenantId,ids.entityId])).rows[0],{source_system:'REFS_STAGE1',source_entity_id:'LEGACY-WBPA'});

  const maker=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'wbs-test-maker',['WBS.TEST.IMPORT','AP.BILL.CREATE'])});
  const draftArgs={tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId,observation,row,rowIndex:0,idempotencyKey:'wbs-test-draft-0001'};
  const draft=await maker.createWbsTestPayableDraft(draftArgs);
  assert.deepEqual({status:draft.status,revision:draft.revision,idempotent:draft.idempotent,test_only:draft.test_only,provenance_mode:draft.provenance_mode},{status:'DRAFT',revision:0,idempotent:false,test_only:true,provenance_mode:'UNSIGNED_TEST_ONLY'});
  assert.deepEqual((await adminPool.query('SELECT source_system,source_entity_id FROM entity WHERE tenant_id=$1 AND entity_id=$2',[ids.tenantId,ids.entityId])).rows[0],{source_system:'REFS_STAGE1',source_entity_id:'LEGACY-WBPA'});
  assert.deepEqual((await adminPool.query(`SELECT d.source_system document_source_system,d.source_entity_id document_source_entity_id,
      r.source_system raw_source_system,r.source_entity_id raw_source_entity_id,b.connector_code
    FROM source_document d JOIN raw_event r ON r.tenant_id=d.tenant_id AND r.raw_event_id=d.raw_event_id
    JOIN import_batch b ON b.tenant_id=r.tenant_id AND b.import_batch_id=r.import_batch_id
    WHERE d.tenant_id=$1 AND d.entity_id=$2 AND d.source_document_id=$3`,[ids.tenantId,ids.entityId,draft.source_document_id])).rows[0],{
    document_source_system:'REFS_STAGE1',document_source_entity_id:'LEGACY-WBPA',raw_source_system:'REFS_STAGE1',raw_source_entity_id:'LEGACY-WBPA',connector_code:'WBS_TEST'
  });
  assert.deepEqual((await adminPool.query("SELECT account_name,requires_member,required_member_type,active FROM account_master WHERE tenant_id=$1 AND entity_id=$2 AND account_code='291001'",[ids.tenantId,ids.entityId])).rows[0],{account_name:'Accounts Payable',requires_member:true,required_member_type:'VENDOR',active:true});
  assert.equal((await maker.createWbsTestPayableDraft(draftArgs)).idempotent,true);
  const source=(await adminPool.query(`SELECT d.business_date::text,d.accounting_date::text,d.gross_amount::text,d.status::text,l.amount::text line_amount,l.external_dimension_refs,
      a.scan_status,a.finalization_status,a.storage_ref
    FROM source_document d JOIN source_document_line l USING(tenant_id,entity_id,source_document_id)
    JOIN source_link sl ON sl.tenant_id=d.tenant_id AND sl.entity_id=d.entity_id AND sl.source_document_id=d.source_document_id AND sl.link_type='SOURCE_ATTACHMENT'
    JOIN attachment a ON a.tenant_id=sl.tenant_id AND a.attachment_id=sl.attachment_id
    WHERE d.tenant_id=$1 AND d.entity_id=$2 AND d.source_document_id=$3`,[ids.tenantId,ids.entityId,draft.source_document_id])).rows[0];
  assert.equal(source.business_date,'2025-02-15');assert.equal(source.accounting_date,'2026-07-01');assert.equal(source.status,'READY_FOR_DRAFT');
  assert.equal(source.gross_amount,'12.3000');assert.equal(source.line_amount,'12.3000');
  assert.equal(source.external_dimension_refs.original_accounting_date,'2025-02-15');assert.equal(source.external_dimension_refs.posting_accounting_date,'2026-07-01');
  assert.equal(source.external_dimension_refs.schema_version,'WBS_TEST_IMPORT_LINE_V1');assert.equal(source.external_dimension_refs.provenance_mode,'UNSIGNED_TEST_ONLY');
  assert.equal(source.scan_status,'CLEAN');assert.equal(source.finalization_status,'VERIFIED_CLEAN');assert.match(source.storage_ref,/^object:\/\/refs-test-only\//);
  const accounting=(await adminPool.query(`SELECT b.accounting_date::text business_accounting_date,b.status business_status,j.journal_date::text journal_date,j.status::text journal_status
    FROM business_document b JOIN journal_entry j ON j.tenant_id=b.tenant_id AND j.entity_id=b.entity_id AND j.journal_entry_id=b.draft_journal_entry_id
    WHERE b.tenant_id=$1 AND b.entity_id=$2 AND b.business_document_id=$3`,[ids.tenantId,ids.entityId,draft.business_document_id])).rows[0];
  assert.deepEqual(accounting,{business_accounting_date:'2026-07-01',business_status:'DRAFT',journal_date:'2026-07-01',journal_status:'DRAFT'});
  const linkCount=Number((await adminPool.query("SELECT count(*) count FROM source_link WHERE tenant_id=$1 AND entity_id=$2 AND source_document_id=$3 AND journal_entry_id=$4 AND link_type='SOURCE_TO_JE'",[ids.tenantId,ids.entityId,draft.source_document_id,draft.journal_entry_id])).rows[0].count);assert.equal(linkCount,1);

  const submitter=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'wbs-test-submitter',['GL.JE.SUBMIT'])});
  const reviewer=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'wbs-test-reviewer',['GL.JE.REVIEW'])});
  const approver=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'wbs-test-approver',['GL.JE.APPROVE'])});
  const poster=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'wbs-test-poster',['GL.JE.POST'])});
  assert.equal((await submitter.transitionJournal({tenantId:ids.tenantId,entityId:ids.entityId,journalEntryId:draft.journal_entry_id,action:'SUBMIT',expectedRevision:0,idempotencyKey:'wbs-test-submit-0001'})).status,'PENDING_REVIEW');
  assert.equal((await reviewer.transitionJournal({tenantId:ids.tenantId,entityId:ids.entityId,journalEntryId:draft.journal_entry_id,action:'REVIEW',expectedRevision:1,idempotencyKey:'wbs-test-review-0001'})).status,'PENDING_APPROVAL');
  assert.equal((await approver.transitionJournal({tenantId:ids.tenantId,entityId:ids.entityId,journalEntryId:draft.journal_entry_id,action:'APPROVE',expectedRevision:2,idempotencyKey:'wbs-test-approve-0001'})).status,'APPROVED');
  const posted=await poster.postJournal({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId,journalEntryId:draft.journal_entry_id,expectedRevision:3,idempotencyKey:'wbs-test-post-0001'});
  assert.equal(posted.journal_entry_id,draft.journal_entry_id);assert.equal(posted.idempotent,false);assert.ok(posted.posting_batch_id);
  const importer=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'wbs-test-importer',['WBS.TEST.IMPORT'])});
  const finalizeArgs={tenantId:ids.tenantId,entityId:ids.entityId,sourceDocumentId:draft.source_document_id,businessDocumentId:draft.business_document_id,journalEntryId:draft.journal_entry_id,idempotencyKey:'wbs-test-finalize-0001'};
  assert.deepEqual(await importer.finalizeWbsTestImportSource(finalizeArgs),{status:'POSTED',test_only:true,idempotent:false});
  assert.deepEqual(await importer.finalizeWbsTestImportSource(finalizeArgs),{status:'POSTED',test_only:true,idempotent:true});
  assert.equal((await adminPool.query('SELECT status::text FROM source_document WHERE tenant_id=$1 AND entity_id=$2 AND source_document_id=$3',[ids.tenantId,ids.entityId,draft.source_document_id])).rows[0].status,'POSTED');
  const completed=[draft];
  for(let index=1;index<rows.length;index++){
    const current=await maker.createWbsTestPayableDraft({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId,observation,row:rows[index],rowIndex:index,idempotencyKey:`wbs-test-draft-${index}`});
    assert.equal((await submitter.transitionJournal({tenantId:ids.tenantId,entityId:ids.entityId,journalEntryId:current.journal_entry_id,action:'SUBMIT',expectedRevision:0,idempotencyKey:`wbs-test-submit-${index}`})).status,'PENDING_REVIEW');
    assert.equal((await reviewer.transitionJournal({tenantId:ids.tenantId,entityId:ids.entityId,journalEntryId:current.journal_entry_id,action:'REVIEW',expectedRevision:1,idempotencyKey:`wbs-test-review-${index}`})).status,'PENDING_APPROVAL');
    assert.equal((await approver.transitionJournal({tenantId:ids.tenantId,entityId:ids.entityId,journalEntryId:current.journal_entry_id,action:'APPROVE',expectedRevision:2,idempotencyKey:`wbs-test-approve-${index}`})).status,'APPROVED');
    assert.equal((await poster.postJournal({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId,journalEntryId:current.journal_entry_id,expectedRevision:3,idempotencyKey:`wbs-test-post-${index}`})).journal_entry_id,current.journal_entry_id);
    assert.equal((await importer.finalizeWbsTestImportSource({tenantId:ids.tenantId,entityId:ids.entityId,sourceDocumentId:current.source_document_id,businessDocumentId:current.business_document_id,journalEntryId:current.journal_entry_id,idempotencyKey:`wbs-test-finalize-${index}`})).status,'POSTED');
    completed.push(current);
  }
  const ledger=(await adminPool.query(`SELECT ll.account_code,ll.debit_amount::text,ll.credit_amount::text FROM ledger_line ll
    JOIN journal_line jl ON jl.tenant_id=ll.tenant_id AND jl.entity_id=ll.entity_id AND jl.journal_line_id=ll.journal_line_id
    WHERE ll.tenant_id=$1 AND ll.entity_id=$2 AND ll.journal_entry_id=$3 ORDER BY jl.line_no`,[ids.tenantId,ids.entityId,draft.journal_entry_id])).rows;
  assert.deepEqual(ledger,[{account_code:'610000',debit_amount:'12.3000',credit_amount:'0.0000'},{account_code:'291001',debit_amount:'0.0000',credit_amount:'12.3000'}]);
  const reader=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'wbs-test-report-reader',['GL.REPORT.VIEW','GL.JE.VIEW','AP.VIEW'])});
  const gl=await reader.listGeneralLedger({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId,accountCode:'610000',query:'',limit:50,offset:0});
  assert.equal(gl.length,10);assert.equal(gl.reduce((sum,item)=>sum+Number(item.debit_amount),0),21.3);assert.ok(gl.some(item=>item.journal_entry_id===draft.journal_entry_id&&item.source_document_ids.includes(draft.source_document_id)));
  const generalLedgerHttpRows=JSON.parse(JSON.stringify(gl));
  const generalLedgerClientRead=await refreshAuthoritativeGeneralLedger({config:{baseUrl:'https://accounting.test',entityId:ids.entityId,periodId:ids.periodId,getAccessToken:async()=>`test-token-${'a'.repeat(32)}`},accountCode:'610000',query:'',limit:50,offset:0,fetcher:async()=>({ok:true,status:200,json:async()=>({ok:true,data:generalLedgerHttpRows})})});
  assert.equal(generalLedgerClientRead.ok,true,JSON.stringify({generalLedgerClientRead,generalLedgerHttpRows}));
  const statements=await reader.getFinancialStatements({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId});
  const expense=statements.find(item=>item.statement_type==='TRIAL_BALANCE'&&item.account_code==='610000'),payable=statements.find(item=>item.statement_type==='TRIAL_BALANCE'&&item.account_code==='291001'),incomeExpense=statements.find(item=>item.statement_type==='INCOME_STATEMENT'&&item.account_code==='610000');
  assert.deepEqual({debit:expense.period_debit,credit:expense.period_credit,balance:expense.display_balance},{debit:'21.3000',credit:'0.0000',balance:'21.3000'});
  assert.deepEqual({debit:payable.period_debit,credit:payable.period_credit,balance:payable.display_balance},{debit:'0.0000',credit:'21.3000',balance:'-21.3000'});
  assert.equal(incomeExpense.display_balance,'21.3000');assert.equal(incomeExpense.journal_entry_ids.length,10);assert.equal(incomeExpense.source_document_ids.length,10);
  const financialStatementHttpRows=JSON.parse(JSON.stringify(statements));
  const financialStatementClientRead=await refreshAuthoritativeFinancialStatements({config:{baseUrl:'https://accounting.test',entityId:ids.entityId,periodId:ids.periodId,getAccessToken:async()=>`test-token-${'a'.repeat(32)}`},fetcher:async()=>({ok:true,status:200,json:async()=>({ok:true,data:financialStatementHttpRows})})});
  assert.equal(financialStatementClientRead.ok,true,JSON.stringify({financialStatementClientRead,financialStatementHttpRows}));
  const listedSources=await reader.listSourceDocuments({tenantId:ids.tenantId,entityId:ids.entityId});
  assert.equal(listedSources.length,10);
  const sourceListHttpRows=JSON.parse(JSON.stringify(listedSources));
  const sourceListClientRead=await refreshAuthoritativeSourceDocuments({config:{baseUrl:'https://accounting.test',entityId:ids.entityId,periodId:ids.periodId,getAccessToken:async()=>`test-token-${'a'.repeat(32)}`},fetcher:async()=>({ok:true,status:200,headers:{get:()=> 'no-store'},json:async()=>({ok:true,data:sourceListHttpRows})})});
  assert.equal(sourceListClientRead.ok,true,JSON.stringify({sourceListClientRead,sourceListHttpRows}));
  const sourceDetailRows=await reader.getSourceDocumentDetail({tenantId:ids.tenantId,entityId:ids.entityId,sourceDocumentId:draft.source_document_id});
  const sourceDetailHttpRows=JSON.parse(JSON.stringify(sourceDetailRows));
  const sourceDetailClientRead=await readAuthoritativeSourceDocumentDetail({config:{baseUrl:'https://accounting.test',entityId:ids.entityId,periodId:ids.periodId,getAccessToken:async()=>`test-token-${'a'.repeat(32)}`},sourceDocumentId:draft.source_document_id,fetcher:async()=>({ok:true,status:200,headers:{get:()=> 'no-store'},json:async()=>({ok:true,data:sourceDetailHttpRows})})});
  assert.equal(sourceDetailClientRead.ok,true,JSON.stringify({sourceDetailClientRead,sourceDetailHttpRows}));
  const listedBillPage=await reader.listBusinessDocuments({tenantId:ids.tenantId,entityId:ids.entityId,documentKind:'AP_BILL',periodId:ids.periodId,limit:200,offset:0}),listedBills=listedBillPage.rows;
  assert.equal(listedBills.length,10);
  const clientRead=await refreshAuthoritativeDocuments({config:{baseUrl:'https://accounting.test',entityId:ids.entityId,periodId:ids.periodId,getAccessToken:async()=>`test-token-${'a'.repeat(32)}`},fetcher:async url=>{
    const path=new URL(url).pathname;
    const data=path.endsWith('/ap/bills')?listedBills:[];
    return {ok:true,status:200,json:async()=>path.endsWith('/adjustments')?({ok:true,data:[],scope:{...listedBillPage.scope,total_count:0}}):({ok:true,data,scope:listedBillPage.scope})};
  }});
  assert.equal(clientRead.ok,true,JSON.stringify({clientRead,listedBills}));
  const listedJournalPage=await reader.listJournalEntries({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId,limit:200,offset:0}),listedJournals=listedJournalPage.rows;
  assert.equal(listedJournals.length,10);
  const journalHttpRows=JSON.parse(JSON.stringify(listedJournals));
  const journalClientRead=await refreshAuthoritativeJournalEntries({config:{baseUrl:'https://accounting.test',entityId:ids.entityId,periodId:ids.periodId,getAccessToken:async()=>`test-token-${'a'.repeat(32)}`},fetcher:async()=>({ok:true,status:200,json:async()=>({ok:true,data:journalHttpRows,scope:listedJournalPage.scope})})});
  assert.equal(journalClientRead.ok,true,JSON.stringify({journalClientRead,listedJournals}));
  assert.deepEqual((await adminPool.query("SELECT account_name,requires_member,required_member_type,active FROM account_master WHERE tenant_id=$1 AND entity_id=$2 AND account_code='120200'",[ids.tenantId,ids.entityId])).rows[0],untouchedAccount);
  assert.deepEqual((await adminPool.query("SELECT requires_member,required_member_type FROM account_master WHERE tenant_id=$1 AND entity_id=$2 AND account_code='291001'",[other.tenantId,other.entityId])).rows[0],{requires_member:false,required_member_type:null});
  assert.deepEqual((await adminPool.query('SELECT source_system,source_entity_id FROM entity WHERE tenant_id=$1 AND entity_id=$2',[other.tenantId,other.entityId])).rows[0],otherEntityBinding);
  assert.deepEqual((await adminPool.query('SELECT (SELECT count(*)::int FROM business_document WHERE tenant_id=$1) documents,(SELECT count(*)::int FROM journal_entry WHERE tenant_id=$1) journals,(SELECT count(*)::int FROM ledger_line WHERE tenant_id=$1) ledger,(SELECT count(*)::int FROM source_document WHERE tenant_id=$1) sources',( [ids.tenantId] ))).rows[0],{documents:10,journals:10,ledger:20,sources:10});
});

pgTest('controlled TEST_ONLY AI source read stays bounded after thousands of unrelated entity sources',async()=>{
  const ids=await seed({status:'APPROVED'}),batchId=randomUUID();
  await adminPool.query("UPDATE entity SET source_system='REFS_STAGE1' WHERE tenant_id=$1 AND entity_id=$2",[ids.tenantId,ids.entityId]);
  const poster=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'ai-source-fixture-poster',['GL.JE.POST'])});
  await poster.postJournal({...ids,journalEntryId:ids.journalId,expectedRevision:0,idempotencyKey:'ai-source-fixture-post'});
  await adminPool.query(`INSERT INTO import_batch(import_batch_id,tenant_id,entity_id,connector_code,source_module,source_entity_id,idempotency_key,request_hash)
    VALUES($1,$2,$3,'WBS_API','payable',$4,'ai-source-read-fixture',$5)`,[batchId,ids.tenantId,ids.entityId,ids.sourceEntityId,hash('ai-source-read-fixture')]);
  await adminPool.query(`INSERT INTO raw_event(raw_event_id,tenant_id,entity_id,import_batch_id,source_system,source_module,source_entity_id,source_record_id,source_version,event_type,occurred_at,payload_hash,payload_ref,correlation_id)
    SELECT gen_random_uuid(),$1,$2,$3,'REFS_STAGE1',CASE WHEN g<=150 THEN 'payable' ELSE 'bankFeed' END,$4,'ai-source-'||g,'v1','UPSERT',clock_timestamp(),$5,'object://raw/ai-source-'||g,'ai-source-'||g
      FROM generate_series(0,2500) g`,[ids.tenantId,ids.entityId,batchId,ids.sourceEntityId,hash('ai-source-row')]);
  await adminPool.query(`INSERT INTO source_document(source_document_id,tenant_id,entity_id,raw_event_id,source_system,source_module,source_entity_id,source_record_id,source_version,document_type,document_no,business_date,accounting_date,currency,gross_amount,status,source_ref,payload_hash)
    SELECT gen_random_uuid(),r.tenant_id,$2,r.raw_event_id,r.source_system,r.source_module,r.source_entity_id,r.source_record_id,r.source_version,
           CASE WHEN r.source_module='payable' THEN 'WBS_TEST_PAYABLE' ELSE 'WBS_TEST_BANK_TRANSACTION' END,
           CASE WHEN r.source_record_id='ai-source-0' THEN 'WBS-AI-ELIGIBLE' ELSE NULL END,
           CASE WHEN r.source_record_id='ai-source-0' THEN '2026-07-01'::date ELSE '2026-07-31'::date END,
           CASE WHEN r.source_record_id='ai-source-0' THEN '2026-07-01'::date ELSE '2026-07-31'::date END,
           'USD',1.0000,'POSTED','WBS:'||r.source_record_id,$4
      FROM raw_event r WHERE r.tenant_id=$1 AND r.import_batch_id=$3`,[ids.tenantId,ids.entityId,batchId,hash('ai-source-document')]);
  assert.equal((await adminPool.query("SELECT count(*)::int n FROM source_document WHERE tenant_id=$1 AND entity_id=$2 AND source_module='payable' AND document_type='WBS_TEST_PAYABLE' AND source_record_id<>'ai-source-0'",[ids.tenantId,ids.entityId])).rows[0].n,150);
  const eligible=(await adminPool.query("SELECT source_document_id FROM source_document WHERE tenant_id=$1 AND entity_id=$2 AND source_record_id='ai-source-0'",[ids.tenantId,ids.entityId])).rows[0];
  await adminPool.query("INSERT INTO source_link(tenant_id,entity_id,link_type,source_document_id,journal_entry_id,created_by) VALUES($1,$2,'SOURCE_TO_JE',$3,$4,'fixture')",[ids.tenantId,ids.entityId,eligible.source_document_id,ids.journalId]);

  const reader=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'ai-source-reader',['GL.JE.VIEW'])}),started=Date.now();
  const rows=await reader.listControlledTestAiSources({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId,limit:100});
  assert.ok(Date.now()-started<10000);assert.equal(rows.length,1);assert.equal(rows[0].source_document_id,eligible.source_document_id);assert.deepEqual(rows[0].posted_journal_entry_ids,[ids.journalId]);
  await assert.rejects(reader.listControlledTestAiSources({tenantId:ids.tenantId,entityId:randomUUID(),periodId:ids.periodId,limit:100}),error=>error.code==='42501');
  const unauthorized=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'ai-source-unauthorized',[])});
  await assert.rejects(unauthorized.listControlledTestAiSources({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId,limit:100}),error=>error.code==='42501');
  const client=await refreshControlledTestAiSources({config:{baseUrl:'https://accounting.test',entityId:ids.entityId,periodId:ids.periodId,getAccessToken:async()=>`test-token-${'a'.repeat(32)}`},fetcher:async()=>({ok:true,status:200,headers:{get:name=>name==='content-type'?'application/json':'no-store'},json:async()=>({ok:true,data:JSON.parse(JSON.stringify(rows))})})});
  assert.equal(client.ok,true);assert.equal(client.rows.length,1);

  await adminPool.query("UPDATE accounting_period SET status='CLOSED' WHERE tenant_id=$1 AND entity_id=$2 AND period_id=$3",[ids.tenantId,ids.entityId,ids.periodId]);
  await assert.rejects(reader.listControlledTestAiSources({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId,limit:100}),error=>error.code==='55000');
});

pgTest('controlled DEMO tenant is tenant-scoped, retired non-destructively, and cannot cross real-tenant boundaries',async()=>{
  const demo=await seed({status:'DRAFT',attachmentStatus:null}),production=await seed({status:'DRAFT',attachmentStatus:null});
  await adminPool.query("UPDATE tenant SET tenant_code='DEMO_AP_BANK_2026' WHERE tenant_id=$1",[demo.tenantId]);
  await adminPool.query(`INSERT INTO controlled_demo_tenant(tenant_id,scenario_code,display_label,created_by,expires_at)
    VALUES($1,'AP_BANK_CLOSURE','DEMO ? non-real evidence','demo-admin',clock_timestamp()+interval '1 day')`,[demo.tenantId]);
  const demoReader=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(demo,'demo-reader')});
  const productionReader=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(production,'production-reader')});
  const demoStatus=await demoReader.readControlledDemoTenant({tenantId:demo.tenantId});
  assert.equal(demoStatus.is_demo,true);assert.equal(demoStatus.lifecycle_status,'ACTIVE_DEMO');assert.equal(demoStatus.scenario_code,'AP_BANK_CLOSURE');
  assert.equal((await productionReader.readControlledDemoTenant({tenantId:production.tenantId})).lifecycle_status,'PRODUCTION');
  for(const [reader,other] of [[demoReader,production],[productionReader,demo]]){
    await assert.rejects(()=>reader.readControlledDemoTenant({tenantId:other.tenantId}),error=>error.code==='42501');
    await assert.rejects(()=>reader.inSession(client=>client.query(`INSERT INTO controlled_demo_tenant(tenant_id,scenario_code,display_label,created_by,expires_at)
      VALUES($1,'AP_BANK_CLOSURE','DEMO ? non-real evidence','runtime-attempt',clock_timestamp()+interval '1 day')`,[other.tenantId])),error=>error.code==='42501');
  }
  const retired=(await adminPool.query("SELECT refs_retire_controlled_demo_tenant($1,'Demo validation complete','demo-admin') result",[demo.tenantId])).rows[0].result;
  assert.equal(retired.retired,true);assert.equal(retired.idempotent,false);
  const retiredStatus=await demoReader.readControlledDemoTenant({tenantId:demo.tenantId});
  assert.equal(retiredStatus.is_demo,false);assert.equal(retiredStatus.lifecycle_status,'RETIRED');
  assert.equal((await adminPool.query("SELECT count(*)::int n FROM audit_event WHERE tenant_id=$1 AND event_type='CONTROLLED_DEMO_RETIRED'",[demo.tenantId])).rows[0].n,1);
  assert.equal((await adminPool.query("SELECT count(*)::int n FROM outbox_event WHERE tenant_id=$1 AND event_type='CONTROLLED_DEMO_RETIRED'",[demo.tenantId])).rows[0].n,1);
});

pgTest('authoritative scope returns persisted entity metadata and period status through the text contract',async()=>{
  const ids=await seed({status:'DRAFT',attachmentStatus:null});
  await adminPool.query("UPDATE entity SET entity_code='WBPA',name='Wan Pacific Real Estate Development LLC' WHERE tenant_id=$1 AND entity_id=$2",[ids.tenantId,ids.entityId]);
  await adminPool.query("UPDATE accounting_period SET status='SOFT_CLOSED' WHERE tenant_id=$1 AND entity_id=$2 AND period_id=$3",[ids.tenantId,ids.entityId,ids.periodId]);
  const kernel=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'scope-reader',['GL.REPORT.VIEW'])});
  const scope=await kernel.readAuthoritativeScope({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId});
  assert.deepEqual(scope,{
    entity_id:ids.entityId,
    entity_name:'Wan Pacific Real Estate Development LLC',
    entity_code:'WBPA',
    base_currency:'USD',
    period_id:ids.periodId,
    period_code:'2026-07',
    period_start:'2026-07-01',
    period_end:'2026-07-31',
    period_status:'SOFT_CLOSED'
  });
});

pgTest('current actor access returns only the authenticated session permissions for one allowed entity',async()=>{
  const ids=await seed({status:'DRAFT',attachmentStatus:null}),other=await seed({status:'DRAFT',attachmentStatus:null});
  const actor='access-diagnostics-reader',permissions=['WBS.PAYABLE.REVIEW','AP.VIEW'];
  await adminPool.query(`INSERT INTO runtime_actor_grant_set(tenant_id,actor_id,entity_id,version,updated_by)
    VALUES($1,$2,$3,7,'grant-sync-test')`,[ids.tenantId,actor,ids.entityId]);
  const kernel=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,actor,permissions)});
  assert.deepEqual(await kernel.readCurrentActorAccess({tenantId:ids.tenantId,entityId:ids.entityId}),{
    tenant_id:ids.tenantId,entity_id:ids.entityId,actor_id:actor,grant_set_version:7,
    permissions:['AP.VIEW','WBS.PAYABLE.REVIEW'],configured_permissions:['AP.VIEW','WBS.PAYABLE.REVIEW'],session_refresh_required:false
  });
  const driftKernel=new PostgresAccountingKernel(runtimePool,{sessionProvider:async()=>{
    const session=await trustedSession(ids,actor,permissions);
    await adminPool.query("INSERT INTO runtime_actor_grant(tenant_id,actor_id,entity_id,permission) VALUES($1,$2,$3,'GL.REPORT.VIEW')",[ids.tenantId,actor,ids.entityId]);
    await adminPool.query("UPDATE runtime_actor_grant_set SET version=8 WHERE tenant_id=$1 AND actor_id=$2 AND entity_id=$3",[ids.tenantId,actor,ids.entityId]);
    return session;
  }});
  assert.deepEqual(await driftKernel.readCurrentActorAccess({tenantId:ids.tenantId,entityId:ids.entityId}),{
    tenant_id:ids.tenantId,entity_id:ids.entityId,actor_id:actor,grant_set_version:8,
    permissions:['AP.VIEW','WBS.PAYABLE.REVIEW'],configured_permissions:['AP.VIEW','GL.REPORT.VIEW','WBS.PAYABLE.REVIEW'],session_refresh_required:true
  });
  await assert.rejects(()=>kernel.readCurrentActorAccess({tenantId:ids.tenantId,entityId:other.entityId}),error=>error.code==='42501');
  await assert.rejects(()=>kernel.readCurrentActorAccess({tenantId:other.tenantId,entityId:other.entityId}),error=>error.code==='42501');
  const issuer=new PostgresContextIssuer(issuerPool,{principalProvider:async()=>({trusted:true,actorId:actor})});
  const revokedKernel=new PostgresAccountingKernel(runtimePool,{sessionProvider:async()=>{
    const session=await trustedSession(ids,actor,permissions);
    await issuer.revoke({contextToken:session.contextToken,reason:'access diagnostics revoke test'});
    return session;
  }});
  await assert.rejects(()=>revokedKernel.readCurrentActorAccess({tenantId:ids.tenantId,entityId:ids.entityId}),error=>error.code==='42501');
  const expiredKernel=new PostgresAccountingKernel(runtimePool,{sessionProvider:async()=>{
    const session=await trustedSession(ids,actor,permissions);
    await adminPool.query("UPDATE runtime_auth_context SET expires_at=now()-interval '1 second' WHERE token_hash=$1",[hash(session.contextToken)]);
    return session;
  }});
  await assert.rejects(()=>expiredKernel.readCurrentActorAccess({tenantId:ids.tenantId,entityId:ids.entityId}),error=>error.code==='42501');
  const emptyKernel=new PostgresAccountingKernel(runtimePool,{sessionProvider:async()=>{
    const session=await trustedSession(ids,actor,permissions);
    await adminPool.query("UPDATE runtime_auth_context SET grants=jsonb_build_array(jsonb_build_object('entity_id',$2::uuid,'permission','')) WHERE token_hash=$1",[hash(session.contextToken),ids.entityId]);
    return session;
  }});
  assert.deepEqual(await emptyKernel.readCurrentActorAccess({tenantId:ids.tenantId,entityId:ids.entityId}),{
    tenant_id:ids.tenantId,entity_id:ids.entityId,actor_id:actor,grant_set_version:8,permissions:[],
    configured_permissions:['AP.VIEW','GL.REPORT.VIEW','WBS.PAYABLE.REVIEW'],session_refresh_required:true
  });
  const malformedKernel=new PostgresAccountingKernel(runtimePool,{sessionProvider:async()=>{
    const session=await trustedSession(ids,actor,permissions);
    await adminPool.query("UPDATE runtime_auth_context SET grants=jsonb_build_array(jsonb_build_object('entity_id','not-a-uuid','permission','AP.VIEW')) WHERE token_hash=$1",[hash(session.contextToken)]);
    return session;
  }});
  await assert.rejects(()=>malformedKernel.readCurrentActorAccess({tenantId:ids.tenantId,entityId:ids.entityId}),error=>error.code==='42501');
});

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
  const denied=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'snapshot-reader',['WBS.AUTOREC.VIEW'])});
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

pgTest('operator-attested WBS Payables persist unsigned exception evidence only with replay, scope, and zero-accounting guards',async()=>{
  const ids=await seed({status:'DRAFT'}),actor='wbs-operator-attester';
  const kernel=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,actor,['WBS.PAYABLE.OPERATOR_ATTEST'])});
  const capturedAt='2026-07-31T23:00:00.000Z',raw={ap_guid:'ap-operator-2026-1',amount:'89.12500',company_code:ids.sourceEntityId,posting_date:'2026-07-15'};
  const rowHash=(await adminPool.query('SELECT refs_jsonb_hash($1::jsonb) hash',[JSON.stringify(raw)])).rows[0].hash;
  const args={tenantId:ids.tenantId,entityId:ids.entityId,capturedAt,providerContentHash:hash('operator-provider-content'),observationHash:hash('operator-observation'),companyCodes:[ids.sourceEntityId],rows:[{source_record_id:raw.ap_guid,source_version:`operator:${capturedAt}:${rowHash.slice(7,39)}`,row_hash:rowHash,raw}],reason:'Controller attests this exact WBS read for exception review.',idempotencyKey:'operator-pg-attest-0001'};
  const before=(await adminPool.query(`SELECT
    (SELECT count(*) FROM raw_event WHERE tenant_id=$1) raw_count,
    (SELECT count(*) FROM source_document WHERE tenant_id=$1) source_count,
    (SELECT count(*) FROM staging_item WHERE tenant_id=$1) staging_count,
    (SELECT count(*) FROM business_document WHERE tenant_id=$1) document_count,
    (SELECT count(*) FROM journal_entry WHERE tenant_id=$1) journal_count,
    (SELECT count(*) FROM ledger_line WHERE tenant_id=$1) ledger_count`,[ids.tenantId])).rows[0];
  const created=await kernel.attestWbsOperatorPayables(args);
  assert.deepEqual({...created,wbs_operator_payable_attestation_id:undefined},{status:'EXCEPTION_REVIEW_REQUIRED',provenance_mode:'OPERATOR_ATTESTED',signature_verified:false,company_scope_status:'ENTITY_SCOPE_MATCHED',row_count:1,idempotent:false,can_import_to_staging:false,can_review:false,can_create_draft:false,can_approve:false,can_post:false,wbs_operator_payable_attestation_id:undefined});
  const replay=await kernel.attestWbsOperatorPayables(args);assert.equal(replay.idempotent,true);assert.equal(replay.wbs_operator_payable_attestation_id,created.wbs_operator_payable_attestation_id);
  const retained=await kernel.listWbsOperatorPayableAttestations({tenantId:ids.tenantId,entityId:ids.entityId,limit:10});
  assert.deepEqual(retained.map(row=>({...row,captured_at:new Date(row.captured_at).toISOString(),attested_at:new Date(row.attested_at).toISOString()})),[{wbs_operator_payable_attestation_id:created.wbs_operator_payable_attestation_id,captured_at:capturedAt,company_code:ids.sourceEntityId,company_codes:[ids.sourceEntityId],company_scope_status:'ENTITY_SCOPE_MATCHED',row_count:1,provenance_mode:'OPERATOR_ATTESTED',signature_verified:false,evidence_status:'EXCEPTION_REVIEW_REQUIRED',can_create_draft:false,can_post:false,attested_at:new Date(retained[0].attested_at).toISOString()}]);
  await assert.rejects(kernel.attestWbsOperatorPayables({...args,reason:'A different controller reason conflicts with the same key.'}),error=>error.code==='23505');
  const denied=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'wbs-read-only',['WBS.AUTOREC.VIEW'])});
  await assert.rejects(denied.attestWbsOperatorPayables({...args,idempotencyKey:'operator-pg-denied-0001'}),error=>error.code==='42501');
  await assert.rejects(denied.listWbsOperatorPayableAttestations({tenantId:ids.tenantId,entityId:ids.entityId,limit:10}),error=>error.code==='42501');
  await assert.rejects(kernel.attestWbsOperatorPayables({...args,providerContentHash:hash('operator-provider-wrong-company'),observationHash:hash('operator-observation-wrong-company'),companyCodes:['WRONG-COMPANY'],idempotencyKey:'operator-pg-scope-0001'}),error=>error.code==='22023');
  const unassignedRaw={ap_guid:'ap-operator-2026-unassigned',amount:'12.50000',posting_date:'2026-07-16'};
  const unassignedHash=canonicalRequestHash(unassignedRaw);
  const unassigned=await kernel.attestWbsOperatorPayables({...args,providerContentHash:hash('operator-provider-unassigned'),observationHash:hash('operator-observation-unassigned'),companyCodes:[],rows:[{source_record_id:unassignedRaw.ap_guid,source_version:`operator:${capturedAt}:${unassignedHash.slice(7,39)}`,row_hash:unassignedHash,raw:unassignedRaw}],reason:'Retain a real row without company assignment as exception evidence.',idempotencyKey:'operator-pg-unassigned-0001'});
  assert.equal(unassigned.company_scope_status,'UNASSIGNED_COMPANY');assert.equal(unassigned.can_review,false);
  const storedUnassignedHash=(await adminPool.query("SELECT row_hash,refs_jsonb_hash(raw) expected FROM wbs_operator_payable_evidence_row WHERE tenant_id=$1 AND source_record_id=$2",[ids.tenantId,unassignedRaw.ap_guid])).rows[0];
  assert.equal(storedUnassignedHash.row_hash,storedUnassignedHash.expected);assert.notEqual(storedUnassignedHash.row_hash,unassignedHash);
  const mixedRaw=[{ap_guid:'ap-operator-2026-mixed-a',amount:'4.00000',company_code:'COMP-A',posting_date:'2026-07-17'},{ap_guid:'ap-operator-2026-mixed-b',amount:'5.00000',company_code:'COMP-B',posting_date:'2026-07-17'}];
  const mixedRows=[];for(const item of mixedRaw){const itemHash=(await adminPool.query('SELECT refs_jsonb_hash($1::jsonb) hash',[JSON.stringify(item)])).rows[0].hash;mixedRows.push({source_record_id:item.ap_guid,source_version:`operator:${capturedAt}:${itemHash.slice(7,39)}`,row_hash:itemHash,raw:item});}
  const mixed=await kernel.attestWbsOperatorPayables({...args,providerContentHash:hash('operator-provider-mixed'),observationHash:hash('operator-observation-mixed'),companyCodes:['COMP-A','COMP-B'],rows:mixedRows,reason:'Retain mixed-company real rows as exception evidence.',idempotencyKey:'operator-pg-mixed-0001'});
  assert.equal(mixed.company_scope_status,'MIXED_COMPANY');assert.equal(mixed.can_import_to_staging,false);assert.equal(mixed.can_create_draft,false);assert.equal(mixed.can_post,false);
  const after=(await adminPool.query(`SELECT
    (SELECT count(*) FROM raw_event WHERE tenant_id=$1) raw_count,
    (SELECT count(*) FROM source_document WHERE tenant_id=$1) source_count,
    (SELECT count(*) FROM staging_item WHERE tenant_id=$1) staging_count,
    (SELECT count(*) FROM business_document WHERE tenant_id=$1) document_count,
    (SELECT count(*) FROM journal_entry WHERE tenant_id=$1) journal_count,
    (SELECT count(*) FROM ledger_line WHERE tenant_id=$1) ledger_count`,[ids.tenantId])).rows[0];
  assert.deepEqual(after,before);
  assert.equal((await adminPool.query('SELECT count(*)::int n FROM wbs_operator_payable_attestation WHERE tenant_id=$1',[ids.tenantId])).rows[0].n,3);
  assert.equal((await adminPool.query('SELECT count(*)::int n FROM wbs_operator_payable_evidence_row WHERE tenant_id=$1',[ids.tenantId])).rows[0].n,4);
  const findings=(await adminPool.query("SELECT rule_id,risk_level,confidence,status,suggested_owner,due_date,due_date_status,source_row_hash,provider_content_hash,observation_hash FROM ai_finding WHERE tenant_id=$1 AND entity_id=$2 ORDER BY source_record_id",[ids.tenantId,ids.entityId])).rows;
  assert.equal(findings.length,4);assert.equal(findings.filter(row=>row.rule_id==='WBS_UNSIGNED_SOURCE').length,1);assert.equal(findings.filter(row=>row.rule_id==='WBS_ENTITY_SCOPE_EXCEPTION').length,3);
  for(const finding of findings){assert.equal(finding.status,'OPEN');assert.equal(finding.suggested_owner,'CONTROLLER');assert.equal(finding.due_date,null);assert.equal(finding.due_date_status,'HUMAN_ASSIGNMENT_REQUIRED');assert.match(finding.source_row_hash,/^sha256:[0-9a-f]{64}$/);assert.match(finding.provider_content_hash,/^sha256:[0-9a-f]{64}$/);assert.match(finding.observation_hash,/^sha256:[0-9a-f]{64}$/);}
  const findingAudit=(await adminPool.query("SELECT metadata FROM audit_event WHERE tenant_id=$1 AND entity_id=$2 AND event_type='AI_FINDING_MATERIALIZED'",[ids.tenantId,ids.entityId])).rows.map(row=>row.metadata);
  assert.equal(findingAudit.length,4);for(const event of findingAudit){assert.equal(event.analysis_mode,'DETERMINISTIC_READ_ONLY');assert.equal(event.can_create_draft,false);assert.equal(event.can_review,false);assert.equal(event.can_approve,false);assert.equal(event.can_post,false);assert.equal(Object.hasOwn(event,'raw'),false);}
  assert.equal((await adminPool.query("SELECT count(*)::int n FROM outbox_event WHERE tenant_id=$1 AND aggregate_type='AI_FINDING' AND event_type='AI_FINDING_MATERIALIZED'",[ids.tenantId])).rows[0].n,4);
  const audits=(await adminPool.query("SELECT metadata FROM audit_event WHERE tenant_id=$1 AND event_type='WBS_PAYABLE_OPERATOR_ATTESTED'",[ids.tenantId])).rows.map(row=>row.metadata);
  assert.deepEqual(new Set(audits.map(audit=>audit.company_scope_status)),new Set(['ENTITY_SCOPE_MATCHED','UNASSIGNED_COMPANY','MIXED_COMPANY']));
  for(const audit of audits){assert.equal(audit.provenance_mode,'OPERATOR_ATTESTED');assert.equal(audit.signature_verified,false);assert.equal(audit.can_import_to_staging,false);assert.equal(audit.can_review,false);assert.equal(audit.can_create_draft,false);assert.equal(audit.can_post,false);}
  await assert.rejects(adminPool.query("UPDATE wbs_operator_payable_evidence_row SET evidence_status='EXCEPTION_REVIEW_REQUIRED' WHERE tenant_id=$1",[ids.tenantId]),error=>error.code==='55000');
});

pgTest('operator exception row links append-only to the later exact signed Payable source without becoming Review authority',async()=>{
  const ids=await seed({status:'DRAFT'}),{privateKey,publicKey}=generateKeyPairSync('ed25519');
  const sourceId=randomUUID(),capturedAt='2026-07-20T03:00:00.000Z',snapshotToken=`operator-bridge-${randomUUID()}`,keyId='wbs-operator-bridge-pg';
  const sourceRow={ap_guid:sourceId,ap_type:'AUTOC',company_code:ids.sourceEntityId,currency:'USD',amount:'41.2500',invoice_date:'2026-07-15',incurred_date:'2026-07-18',posting_date:'2026-07-20',pay_due_date:'2026-07-25',invoice_no:'WBS-BRIDGE-001',vendor_no:'VENDOR-PG'};
  const rows=[sourceRow],providerContentHash=canonicalRequestHash(rows);
  const operator=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'bridge-operator',['WBS.PAYABLE.OPERATOR_ATTEST'])});
  const retained=await operator.attestWbsOperatorPayables({...ids,capturedAt,providerContentHash,observationHash:hash('operator-bridge-observation'),companyCodes:[ids.sourceEntityId],rows:[{source_record_id:sourceId,source_version:`operator:${capturedAt}:${providerContentHash.slice(7,39)}`,row_hash:canonicalRequestHash(sourceRow),raw:sourceRow}],reason:'Retain the exact provider Payable row as unsigned exception evidence.',idempotencyKey:'operator-signed-bridge-attest-0001'});
  const operatorEvidenceRowId=(await adminPool.query('SELECT wbs_operator_payable_evidence_row_id FROM wbs_operator_payable_evidence_row WHERE tenant_id=$1 AND entity_id=$2 AND wbs_operator_payable_attestation_id=$3 AND source_record_id=$4',[ids.tenantId,ids.entityId,retained.wbs_operator_payable_attestation_id,sourceId])).rows[0].wbs_operator_payable_evidence_row_id;
  const envelope={contract_version:'WBS-REFS-MCP-V1',tool:'list_payables',environment:'production',captured_at:capturedAt,source:{system:'WBS'},scope:{company:ids.sourceEntityId,currency:'USD',snapshot_token:snapshotToken},record_count:1,content_sha256:providerContentHash.slice(7),cursor_next:null,etl_notice:'Snapshot comparison required',rows};
  const conventions=[{scope:{company_key:ids.sourceEntityId,currency:'USD'},receipt:{hash:providerContentHash,ref:'object://wbs/payable/operator-bridge',version:'1',verification_id:'operator-bridge-verify',key_id:keyId,algorithm:'Ed25519',verified_on:capturedAt},rule_id:'WBS-PAYABLE-OPERATOR-BRIDGE-DIRECTION',version:'1',ap_type:'AUTOC',direction:'DEBIT'}];
  const unsigned=buildWbsMcpReadonlySnapshot({envelopes:[envelope],snapshotId:randomUUID(),dictionaryVersion:'WBS-MCP-V1',environment:'PRODUCTION',delivery:{mode:'SIGNED_SNAPSHOT_PACKAGE',snapshot_token:snapshotToken,extract_started_at:'2026-07-20T02:59:00.000Z',extract_completed_at:capturedAt,consistency:'COMPLETE',read_consistency:'SNAPSHOT_ISOLATION',pagination:'PRIMARY_KEY_SEEK'},detachedSignature:{key_id:keyId,algorithm:'Ed25519',value:'placeholder'},payableDirectionConventions:conventions});
  const snapshot={...unsigned,detached_signature:{...unsigned.detached_signature,value:sign(null,Buffer.from(unsigned.package_hash),privateKey).toString('base64')}},verifier=createWbsSnapshotSignatureVerifier({publicKeys:{[keyId]:publicKey.export({type:'spki',format:'pem'})}});
  const importer=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'bridge-signed-importer',['WBS.SNAPSHOT.IMPORT']),wbsSnapshotVerifier:verifier}),ingestion=createWbsAdmittedPayableIngestion({kernel:importer,signatureVerifier:verifier});
  await ingestion.ingest({tenantId:ids.tenantId,entityId:ids.entityId,snapshot,idempotencyKey:'operator-signed-bridge-ingest-0001'});
  const signed=(await adminPool.query('SELECT wbs_inbound_row_id,source_version,raw,normalized FROM wbs_inbound_row WHERE tenant_id=$1 AND entity_id=$2 AND source_record_id=$3 ORDER BY created_at DESC LIMIT 1',[ids.tenantId,ids.entityId,sourceId])).rows[0];
  assert.equal(signed.raw.mcp_row_hash,canonicalRequestHash(sourceRow));assert.equal(signed.normalized.upstream_mcp_content_hash,providerContentHash);
  const before=(await adminPool.query('SELECT (SELECT count(*) FROM journal_entry WHERE tenant_id=$1) journal_count,(SELECT count(*) FROM ledger_line WHERE tenant_id=$1) ledger_count',[ids.tenantId])).rows[0];
  const linked=await importer.linkWbsOperatorEvidenceToSignedSource({...ids,wbsOperatorPayableEvidenceRowId:operatorEvidenceRowId,wbsInboundRowId:signed.wbs_inbound_row_id,idempotencyKey:'operator-signed-source-link-0001'});
  assert.deepEqual({status:linked.status,operatorStatus:linked.operator_evidence_status,signedRowId:linked.wbs_inbound_row_id,review:linked.can_review,draft:linked.can_create_draft,post:linked.can_post},{status:'SIGNED_SOURCE_EQUIVALENCE_RECORDED',operatorStatus:'EXCEPTION_REVIEW_REQUIRED',signedRowId:signed.wbs_inbound_row_id,review:false,draft:false,post:false});
  const replay=await importer.linkWbsOperatorEvidenceToSignedSource({...ids,wbsOperatorPayableEvidenceRowId:operatorEvidenceRowId,wbsInboundRowId:signed.wbs_inbound_row_id,idempotencyKey:'operator-signed-source-link-0001'});assert.equal(replay.idempotent,true);
  const after=(await adminPool.query('SELECT (SELECT count(*) FROM journal_entry WHERE tenant_id=$1) journal_count,(SELECT count(*) FROM ledger_line WHERE tenant_id=$1) ledger_count',[ids.tenantId])).rows[0];assert.deepEqual(after,before);
  const operatorOnly=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'bridge-operator',['WBS.PAYABLE.OPERATOR_ATTEST'])});
  await assert.rejects(operatorOnly.linkWbsOperatorEvidenceToSignedSource({...ids,wbsOperatorPayableEvidenceRowId:operatorEvidenceRowId,wbsInboundRowId:signed.wbs_inbound_row_id,idempotencyKey:'operator-signed-source-link-denied'}),error=>error.code==='42501');
  const reviewReader=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'bridge-review-reader',['WBS.PAYABLE.REVIEW','AP.VIEW'])});
  const reviewCandidate=await reviewReader.getWbsPayableReviewCandidate({tenantId:ids.tenantId,entityId:ids.entityId,wbsInboundRowId:signed.wbs_inbound_row_id});assert.equal(reviewCandidate[0].wbs_inbound_row_id,signed.wbs_inbound_row_id);
  await assert.rejects(reviewReader.getWbsPayableReviewCandidate({tenantId:ids.tenantId,entityId:ids.entityId,wbsInboundRowId:operatorEvidenceRowId}),error=>error.code==='P0002');
  await assert.rejects(adminPool.query('UPDATE wbs_operator_signed_source_link SET company_code=company_code WHERE wbs_operator_signed_source_link_id=$1',[linked.wbs_operator_signed_source_link_id]),error=>error.code==='55000');
});

pgTest('provider-signed Payable admission atomically reaches Review Draft four-role Post and same-JE reports',async()=>{
  const ids=await seed({status:'DRAFT'}),{privateKey,publicKey}=generateKeyPairSync('ed25519'),keyId='wbs-payable-composition-pg',capturedAt='2026-07-11T03:00:00.000Z',snapshotToken=`pg-payable-${randomUUID()}`,sourceId=randomUUID(),badSourceId=randomUUID();
  await adminPool.query("UPDATE tenant SET tenant_code='DEMO_STAGE3_PAYABLE_2026',name='DEMO isolated Stage 3 WBS payable acceptance' WHERE tenant_id=$1",[ids.tenantId]);
  await adminPool.query(`INSERT INTO controlled_demo_tenant(tenant_id,scenario_code,display_label,created_by,expires_at)
    VALUES($1,'STAGE3_SIGNED_PAYABLE','DEMO test-key signed Payable to report acceptance','demo-admin',clock_timestamp()+interval '1 day')`,[ids.tenantId]);
  const rows=[
    {ap_guid:sourceId,ap_type:'AUTOC',company_code:ids.sourceEntityId,currency:'USD',amount:'89.1250',invoice_date:'2026-07-01',incurred_date:'2026-07-10',posting_date:'2026-07-11',pay_due_date:'2026-07-05',invoice_no:'WBS-INV-PG-001',vendor_no:'VENDOR-PG'},
    {ap_guid:badSourceId,ap_type:'AUTOC',company_code:ids.sourceEntityId,currency:'USD',amount:'10.0000',invoice_date:'2026-07-08',incurred_date:'2026-07-10',posting_date:'2026-07-11',pay_due_date:'2026-07-07',invoice_no:'WBS-INV-PG-BAD',vendor_no:'VENDOR-PG'}
  ].sort((left,right)=>left.ap_guid.localeCompare(right.ap_guid));
  const retainedSourceRow=rows.find(row=>row.ap_guid===sourceId),operatorContentHash=canonicalRequestHash(rows);
  const operatorKernel=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'wbs-payable-operator',['WBS.PAYABLE.OPERATOR_ATTEST'])});
  const retained=await operatorKernel.attestWbsOperatorPayables({...ids,capturedAt,providerContentHash:operatorContentHash,
    observationHash:hash('provider-signed-full-chain-operator-observation'),companyCodes:[ids.sourceEntityId],
    rows:[{source_record_id:sourceId,source_version:`operator:${capturedAt}:${canonicalRequestHash(retainedSourceRow).slice(7,39)}`,
      row_hash:canonicalRequestHash(retainedSourceRow),raw:retainedSourceRow}],
    reason:'Retain the exact live Payable row while awaiting independent provider-signed redelivery.',
    idempotencyKey:'provider-signed-full-chain-operator-retain'});
  const envelope={contract_version:'WBS-REFS-MCP-V1',tool:'list_payables',environment:'production',captured_at:capturedAt,source:{system:'WBS'},scope:{company:ids.sourceEntityId,currency:'USD',snapshot_token:snapshotToken},record_count:rows.length,content_sha256:canonicalRequestHash(rows).slice(7),cursor_next:null,etl_notice:'Snapshot comparison required',rows};
  const conventions=[{scope:{company_key:ids.sourceEntityId,currency:'USD'},receipt:{hash:`sha256:${envelope.content_sha256}`,ref:'object://wbs/payable/pg-direction',version:'1',verification_id:'pg-verify-1',key_id:keyId,algorithm:'Ed25519',verified_on:capturedAt},rule_id:'WBS-PAYABLE-PG-DIRECTION',version:'1',ap_type:'AUTOC',direction:'DEBIT'}];
  const unsigned=buildWbsMcpReadonlySnapshot({envelopes:[envelope],snapshotId:randomUUID(),dictionaryVersion:'WBS-MCP-V1',environment:'PRODUCTION',delivery:{mode:'SIGNED_SNAPSHOT_PACKAGE',snapshot_token:snapshotToken,extract_started_at:'2026-07-11T02:59:00.000Z',extract_completed_at:capturedAt,consistency:'COMPLETE',read_consistency:'SNAPSHOT_ISOLATION',pagination:'PRIMARY_KEY_SEEK'},detachedSignature:{key_id:keyId,algorithm:'Ed25519',value:'placeholder'},payableDirectionConventions:conventions});
  const requestRaw=Buffer.from('{"tool":"list_payables","company":"'+ids.sourceEntityId+'"}'),responseRaw=Buffer.from(JSON.stringify(envelope));
  const admissionNow=Date.now(),signedAt=new Date(admissionNow-60_000).toISOString(),expiresAt=new Date(admissionNow+9*60_000).toISOString();
  const signedDelivery=await createSyntheticWbsSignedDelivery({unsignedSnapshot:unsigned,requestRaw,responseRaw,scope:{tenant_id:ids.tenantId,entity_id:ids.entityId,company_code:ids.sourceEntityId},issuer:'wbs-provider-pg',keyId,nonce:`nonce-${randomUUID()}`,signedAt,expiresAt,privateKeyPem:privateKey.export({type:'pkcs8',format:'pem'}).toString(),now:admissionNow});
  const verifier=createWbsSnapshotSignatureVerifier({publicKeys:{[keyId]:publicKey.export({type:'spki',format:'pem'})}}),serviceActor='admitted-payable-importer';
  const kernel=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,serviceActor,['WBS.SNAPSHOT.IMPORT']),wbsSnapshotVerifier:verifier});
  const demoStatus=await kernel.readControlledDemoTenant({tenantId:ids.tenantId});
  assert.deepEqual({is_demo:demoStatus.is_demo,lifecycle_status:demoStatus.lifecycle_status,scenario_code:demoStatus.scenario_code},{is_demo:true,lifecycle_status:'ACTIVE_DEMO',scenario_code:'STAGE3_SIGNED_PAYABLE'});
  const service=createWbsProviderSignedPayableAdmission({kernel,providerTrust:signedDelivery.providerTrust,principal:{trusted:true,tenantId:ids.tenantId,actorId:serviceActor},serviceActorId:serviceActor,clock:()=>admissionNow});
  const body={receipt:signedDelivery.receipt,requestRawBase64:requestRaw.toString('base64'),responseRawBase64:responseRaw.toString('base64'),packageRawBase64:signedDelivery.packageRaw.toString('base64')};
  const journalsBefore=(await adminPool.query('SELECT count(*)::int n FROM journal_entry WHERE tenant_id=$1',[ids.tenantId])).rows[0].n,idempotencyKey=`wbs-payable-pg-${randomUUID()}`;
  const zeroBefore=(await adminPool.query("SELECT (SELECT count(*)::int FROM wbs_inbound_row WHERE tenant_id=$1) inbound,(SELECT count(*)::int FROM journal_entry WHERE tenant_id=$1) journals,(SELECT count(*)::int FROM ledger_line WHERE tenant_id=$1) ledger",[ids.tenantId])).rows[0];
  for(const changed of [{...body,responseRawBase64:Buffer.from('{}').toString('base64')},{...body,receipt:{...body.receipt,entity_id:randomUUID()}}])await assert.rejects(service.admit({tenantId:ids.tenantId,entityId:ids.entityId,...changed,idempotencyKey:`wbs-provider-negative-${randomUUID()}`}),error=>error.code?.startsWith('WBS_'));
  const expiredService=createWbsProviderSignedPayableAdmission({kernel,providerTrust:signedDelivery.providerTrust,principal:{trusted:true,tenantId:ids.tenantId,actorId:serviceActor},serviceActorId:serviceActor,clock:()=>admissionNow+20*60_000});
  await assert.rejects(expiredService.admit({tenantId:ids.tenantId,entityId:ids.entityId,...body,idempotencyKey:`wbs-provider-expired-${randomUUID()}`}),error=>error.code==='WBS_SIGNED_DELIVERY_RECEIPT_EXPIRED');
  const unsignedPackage=structuredClone(signedDelivery.package);delete unsignedPackage.detached_signature;
  await assert.rejects(service.admit({tenantId:ids.tenantId,entityId:ids.entityId,...body,packageRawBase64:Buffer.from(canonicalRequestBody(unsignedPackage)).toString('base64'),idempotencyKey:`wbs-provider-unsigned-${randomUUID()}`}),error=>error.code?.startsWith('WBS_'));
  assert.deepEqual((await adminPool.query("SELECT (SELECT count(*)::int FROM wbs_inbound_row WHERE tenant_id=$1) inbound,(SELECT count(*)::int FROM journal_entry WHERE tenant_id=$1) journals,(SELECT count(*)::int FROM ledger_line WHERE tenant_id=$1) ledger",[ids.tenantId])).rows[0],zeroBefore);
  const created=await service.admit({tenantId:ids.tenantId,entityId:ids.entityId,...body,idempotencyKey}),replayed=await service.admit({tenantId:ids.tenantId,entityId:ids.entityId,...body,idempotencyKey});
  assert.deepEqual({status:created.status,replay:replayed.idempotent,rows:created.row_count,linked:created.linked_operator_exception_count,draft:created.can_create_draft,post:created.can_post},{status:'PERSISTED_PAYABLE_STAGING_REVIEW_REQUIRED',replay:true,rows:2,linked:1,draft:false,post:false});
  await assert.rejects(service.admit({tenantId:ids.tenantId,entityId:ids.entityId,...body,idempotencyKey:`wbs-payable-nonce-replay-${randomUUID()}`}),error=>error.code==='23505');
  assert.equal((await adminPool.query('SELECT count(*)::int n FROM wbs_provider_signed_payable_admission WHERE tenant_id=$1',[ids.tenantId])).rows[0].n,1);
  const storedRows=(await adminPool.query("SELECT i.wbs_inbound_row_id,r.receipt_hash,i.source_record_id,i.source_version,i.raw,i.normalized,i.outcome,i.outcome_kind,refs_wbs_payable_review_evidence_hash(i.wbs_inbound_row_id,i.source_record_id,i.source_version,r.receipt_hash,i.raw,i.normalized,i.outcome,i.outcome_kind) evidence_hash FROM wbs_inbound_receipt r JOIN wbs_inbound_row i USING(receipt_id) WHERE r.tenant_id=$1 AND r.entity_id=$2 AND i.source_record_id=ANY($3::text[])",[ids.tenantId,ids.entityId,[sourceId,badSourceId]])).rows,stored=storedRows.find(row=>row.source_record_id===sourceId),badStored=storedRows.find(row=>row.source_record_id===badSourceId);
  const retainedRows=await operatorKernel.listWbsOperatorPayableExceptionRows({...ids,wbsOperatorPayableAttestationId:retained.wbs_operator_payable_attestation_id,limit:10});
  assert.deepEqual({count:retainedRows.length,status:retainedRows[0].signed_link_status,signedRow:retainedRows[0].signed_wbs_inbound_row_id},{count:1,status:'ELIGIBLE_FOR_SIGNED_REVIEW',signedRow:stored.wbs_inbound_row_id});
  assert.equal(stored.source_record_id,sourceId);assert.match(stored.source_version,/^snapshot:/);assert.equal(stored.raw.amount,'-89.1250');assert.equal(stored.normalized.amount_money4,'-89.1250');assert.equal(stored.normalized.company_key,ids.sourceEntityId);assert.equal(stored.normalized.currency,'USD');assert.equal(stored.outcome_kind,'STAGING');assert.match(stored.receipt_hash,/^sha256:[0-9a-f]{64}$/);
  assert.equal((await adminPool.query('SELECT count(*)::int n FROM journal_entry WHERE tenant_id=$1',[ids.tenantId])).rows[0].n,journalsBefore);

  const attachmentHash=hash('exact payable attachment'),uploadArgs={...ids,wbsInboundRowId:stored.wbs_inbound_row_id,
    name:'payable.pdf',mediaType:'application/pdf',sizeBytes:10,contentHash:attachmentHash,
    storageRef:`object://attachments/${randomUUID()}`,storageVersion:`pending:${randomUUID()}`,idempotencyKey:'wbs-payable-row-upload-pg-0001'};
  const exactUploader=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'exact-uploader',['ATTACHMENT.CREATE','AP.VIEW'])});
  const reserved=await exactUploader.reserveWbsPayableAttachment(uploadArgs),reserveReplay=await exactUploader.reserveWbsPayableAttachment(uploadArgs),attachmentId=reserved.attachment_id;
  assert.deepEqual({purpose:reserved.purpose,row:reserved.wbs_inbound_row_id,replay:reserveReplay.idempotent},{purpose:'WBS_PAYABLE_SUPPORT_EVIDENCE',row:stored.wbs_inbound_row_id,replay:true});
  await assert.rejects(exactUploader.reserveWbsPayableAttachment({...uploadArgs,wbsInboundRowId:badStored.wbs_inbound_row_id}),error=>error.code==='23505');
  await assert.rejects(exactUploader.reserveWbsPayableAttachment({...uploadArgs,entityId:randomUUID(),idempotencyKey:'wbs-payable-row-upload-cross-entity'}),error=>error.code==='42501');
  await exactUploader.requestAttachmentFinalize({tenantId:ids.tenantId,entityId:ids.entityId,attachmentId,idempotencyKey:'wbs-payable-row-upload-finalize-request'});
  const exactScanner=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'exact-scanner-1',['ATTACHMENT.FINALIZE'])});
  const finalized=await exactScanner.finalizeAttachment({...ids,attachmentId,storageRef:uploadArgs.storageRef,observedSizeBytes:10,
    observedContentHash:attachmentHash,observedMediaType:'application/pdf',storageVersion:'object-version-1',scanClean:true,
    scanRef:'scanner://wbs-payable/exact-1',idempotencyKey:'wbs-payable-row-upload-finalize'});
  assert.equal(finalized.status,'VERIFIED_CLEAN');
  await adminPool.query("INSERT INTO member_master(tenant_id,entity_id,member_ref,member_type,display_name) VALUES($1,$2,'VENDOR-PG','VENDOR','Signed WBS vendor')",[ids.tenantId,ids.entityId]);
  await adminPool.query("INSERT INTO account_master(tenant_id,entity_id,account_code,account_name,requires_member) VALUES($1,$2,'610000','WBS payable expense',false)",[ids.tenantId,ids.entityId]);
  const settingId=randomUUID(),mappingId=randomUUID(),lowerMappingId=randomUUID(),mappingInput={company_key:ids.sourceEntityId,currency:'USD',vendor_ref:'VENDOR-PG',cost_code_ref:null},mappingOutput={vendor_ref:'VENDOR-PG',offset_account_code:'610000',amount_multiplier:'-1',source_direction:'DEBIT',rule_code:'WBS_PAYABLE_AP_MAP',rule_version:'1'};
  const configHashes=(await adminPool.query("SELECT refs_jsonb_hash('{}'::jsonb) setting_hash,refs_jsonb_hash(jsonb_build_object('input_keys',$1::jsonb,'output_rules',$2::jsonb)) mapping_hash,refs_jsonb_hash($1::jsonb) input_key_hash",[JSON.stringify(mappingInput),JSON.stringify(mappingOutput)])).rows[0];
  await adminPool.query(`INSERT INTO setting_snapshot(setting_snapshot_id,tenant_id,entity_id,family,scope_type,scope_key,version,effective_from,status,snapshot,snapshot_hash,created_by,approved_by,approved_at)
    VALUES($1,$2,$3::uuid,'WBS_PAYABLE_AP_REVIEW','ENTITY',$3::uuid::text,1,'2026-01-01','APPROVED','{}',$4,'payable-setting-maker','payable-setting-approver',now())`,[settingId,ids.tenantId,ids.entityId,configHashes.setting_hash]);
  await adminPool.query(`INSERT INTO mapping_snapshot(mapping_snapshot_id,tenant_id,entity_id,family,scope_type,scope_key,input_key_hash,version,priority,effective_from,status,input_keys,output_rules,snapshot_hash,created_by,approved_by,approved_at)
    VALUES($1,$2,$3::uuid,'WBS_PAYABLE_AP','ENTITY',$3::uuid::text,$4,1,10,'2026-01-01','APPROVED',$5,$6,$7,'payable-mapping-maker','payable-mapping-approver',now())`,[mappingId,ids.tenantId,ids.entityId,configHashes.input_key_hash,JSON.stringify(mappingInput),JSON.stringify(mappingOutput),configHashes.mapping_hash]);
  await adminPool.query(`INSERT INTO mapping_snapshot(mapping_snapshot_id,tenant_id,entity_id,family,scope_type,scope_key,input_key_hash,version,priority,effective_from,status,input_keys,output_rules,snapshot_hash,created_by,approved_by,approved_at)
    VALUES($1,$2,$3::uuid,'WBS_PAYABLE_AP','ENTITY',$3::uuid::text,$4,2,1,'2026-01-01','APPROVED',$5,$6,$7,'lower-mapping-maker','lower-mapping-approver',now())`,[lowerMappingId,ids.tenantId,ids.entityId,configHashes.input_key_hash,JSON.stringify(mappingInput),JSON.stringify(mappingOutput),configHashes.mapping_hash]);
  const reviewer=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'wbs-payable-reviewer',['WBS.PAYABLE.REVIEW'])}),reviewArgs={...ids,wbsInboundRowId:stored.wbs_inbound_row_id,expectedRevision:0,expectedSourceVersion:stored.source_version,expectedReceiptHash:stored.receipt_hash,expectedEvidenceHash:stored.evidence_hash,settingSnapshotId:settingId,mappingSnapshotId:mappingId,attachmentIds:[attachmentId],reason:'Independently review the exact signed WBS Payable evidence',idempotencyKey:'wbs-payable-review-pg-0001'};
  const denied=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'wbs-payable-reader',[])});
  await assert.rejects(denied.reviewWbsPayable(reviewArgs),error=>error.code==='42501');
  const reviewReader=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'wbs-payable-reviewer',['WBS.PAYABLE.REVIEW','AP.VIEW'])});
  const candidates=await reviewReader.listWbsPayableReviewCandidates({tenantId:ids.tenantId,entityId:ids.entityId,limit:10}),candidate=candidates.find(item=>item.wbs_inbound_row_id===stored.wbs_inbound_row_id);
  assert.ok(candidate);assert.deepEqual({version:candidate.source_version,receipt:candidate.receipt_hash,evidence:candidate.evidence_hash,revision:candidate.revision,period:candidate.period_id,number:candidate.document_number,invoice:candidate.invoice_date,due:candidate.due_date,date:candidate.accounting_date,currency:candidate.currency,amount:candidate.gross_amount,vendor:candidate.vendor_name,offset:candidate.offset_account_code,setting:candidate.setting_snapshot_id,mapping:candidate.mapping_snapshot_id,attachments:candidate.attachment_choices,readiness:candidate.review_readiness,canReview:candidate.can_review},{version:stored.source_version,receipt:stored.receipt_hash,evidence:stored.evidence_hash,revision:'0',period:ids.periodId,number:'WBS-INV-PG-001',invoice:'2026-07-01',due:'2026-07-05',date:'2026-07-11',currency:'USD',amount:'89.1250',vendor:'Signed WBS vendor',offset:'610000',setting:settingId,mapping:mappingId,attachments:[],readiness:'VERIFIED_ATTACHMENT_REQUIRED',canReview:false});
  const binderUploads=await reviewReader.listWbsPayableAttachmentUploads({tenantId:ids.tenantId,entityId:ids.entityId,wbsInboundRowId:stored.wbs_inbound_row_id});
  assert.deepEqual({upload:binderUploads.can_upload,bind:binderUploads.can_bind,count:binderUploads.attachments.length,item:binderUploads.attachments[0]},{upload:false,bind:true,count:1,item:{attachment_id:attachmentId,name:'payable.pdf',media_type:'application/pdf',status:'VERIFIED_CLEAN',verified_at:binderUploads.attachments[0].verified_at,can_bind:true}});
  const uploaderUploads=await exactUploader.listWbsPayableAttachmentUploads({tenantId:ids.tenantId,entityId:ids.entityId,wbsInboundRowId:stored.wbs_inbound_row_id});
  assert.deepEqual({upload:uploaderUploads.can_upload,bind:uploaderUploads.can_bind,item:uploaderUploads.attachments[0].can_bind},{upload:true,bind:false,item:false});
  for(const forbidden of ['content_hash','storage_ref','storage_version','receipt_hash','provider_receipt_hash','evidence_hash'])assert.equal(Object.hasOwn(binderUploads.attachments[0],forbidden),false);
  await assert.rejects(reviewReader.listWbsPayableAttachmentUploads({tenantId:ids.tenantId,entityId:ids.entityId,wbsInboundRowId:randomUUID()}),error=>error.code==='P0002');
  for(const forbidden of ['raw','normalized','payload_ref','source_record_id','provider_request','provider_response','signature','access_token'])assert.equal(Object.hasOwn(candidate,forbidden),false);
  assert.deepEqual((await reviewReader.getWbsPayableReviewCandidate({tenantId:ids.tenantId,entityId:ids.entityId,wbsInboundRowId:stored.wbs_inbound_row_id}))[0],candidate);
  const reviewOnlyReader=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'wbs-payable-review-only',['WBS.PAYABLE.REVIEW'])});
  await assert.rejects(reviewOnlyReader.listWbsPayableReviewCandidates({tenantId:ids.tenantId,entityId:ids.entityId,limit:10}),error=>error.code==='42501');
  await assert.rejects(reviewer.reviewWbsPayable({...reviewArgs,mappingSnapshotId:lowerMappingId,idempotencyKey:'wbs-payable-review-pg-lower-map'}),error=>error.code==='23514');
  // A clean entity attachment is still unusable until it is bound to this
  // exact signed WBS row and immutable object version.
  await assert.rejects(reviewer.reviewWbsPayable(reviewArgs),error=>error.code==='23514'&&/exact immutable row binding/i.test(error.message));

  const attachmentMeta=(await adminPool.query('SELECT content_hash,storage_version,uploaded_by FROM attachment WHERE tenant_id=$1 AND entity_id=$2 AND attachment_id=$3',[ids.tenantId,ids.entityId,attachmentId])).rows[0];
  const providerReceiptHash=(await adminPool.query('SELECT receipt_hash FROM wbs_snapshot_receipt WHERE tenant_id=$1 AND entity_id=$2 AND source_record_id=$3 AND source_version=$4',[ids.tenantId,ids.entityId,stored.source_record_id,stored.source_version])).rows[0].receipt_hash;
  const secondAttachmentId=randomUUID(),secondAttachmentHash=hash('second exact payable attachment');
  await adminPool.query(`INSERT INTO attachment(attachment_id,tenant_id,entity_id,name,media_type,size_bytes,content_hash,storage_ref,storage_version,uploaded_by,uploaded_at,verified_at,scan_status,finalization_status,finalized_at)
    VALUES($1,$2,$3,'second-payable.pdf','application/pdf',11,$4,$5,'object-version-2','second-uploader',now(),now(),'CLEAN','VERIFIED_CLEAN',now())`,[secondAttachmentId,ids.tenantId,ids.entityId,secondAttachmentHash,`object://attachments/${secondAttachmentId}`]);
  for(const [id,scanner] of [[secondAttachmentId,'exact-scanner-2']])await adminPool.query(`INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,after_hash,metadata)
    VALUES($1::uuid,$2::uuid,'ATTACHMENT_FINALIZED','ATTACHMENT',$3::uuid,'FINALIZE',$4::text,'SERVICE_ACCOUNT','ATTACHMENT.FINALIZE',$3::uuid::text,$3::uuid::text,$5::text,'{"accepted":true}')`,[ids.tenantId,ids.entityId,id,scanner,hash(`scanner-${id}`)]);
  const providerReceiptHashBad=(await adminPool.query('SELECT receipt_hash FROM wbs_snapshot_receipt WHERE tenant_id=$1 AND entity_id=$2 AND source_record_id=$3 AND source_version=$4',[ids.tenantId,ids.entityId,badStored.source_record_id,badStored.source_version])).rows[0].receipt_hash;
  const bindBase={...ids,wbsInboundRowId:stored.wbs_inbound_row_id,attachmentId,expectedRevision:0,expectedSourceVersion:stored.source_version,expectedReceiptHash:stored.receipt_hash,expectedProviderReceiptHash:providerReceiptHash,expectedEvidenceHash:stored.evidence_hash,expectedAttachmentContentHash:attachmentMeta.content_hash,expectedAttachmentStorageVersion:attachmentMeta.storage_version,reason:'Bind exact clean invoice evidence to one signed payable row',idempotencyKey:'wbs-payable-bind-pg-0001'};
  const bindBad={...ids,wbsInboundRowId:badStored.wbs_inbound_row_id,attachmentId:secondAttachmentId,expectedRevision:0,expectedSourceVersion:badStored.source_version,expectedReceiptHash:badStored.receipt_hash,expectedProviderReceiptHash:providerReceiptHashBad,expectedEvidenceHash:badStored.evidence_hash,expectedAttachmentContentHash:secondAttachmentHash,expectedAttachmentStorageVersion:'object-version-2',reason:'Bind second exact clean invoice evidence to its signed payable row',idempotencyKey:'wbs-payable-bind-pg-0002'};
  const binder=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'independent-attachment-binder',['WBS.PAYABLE.REVIEW','AP.VIEW'])});
  const bindDenied=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'binding-one-permission',['WBS.PAYABLE.REVIEW'])});
  await assert.rejects(bindDenied.bindWbsPayableAttachment(bindBase),error=>error.code==='42501');
  const accountingBeforeBinding=(await adminPool.query("SELECT (SELECT count(*)::int FROM raw_event WHERE tenant_id=$1) raw,(SELECT count(*)::int FROM source_document WHERE tenant_id=$1) source,(SELECT count(*)::int FROM staging_item WHERE tenant_id=$1) staging,(SELECT count(*)::int FROM business_document WHERE tenant_id=$1) bills,(SELECT count(*)::int FROM journal_entry WHERE tenant_id=$1) journals,(SELECT count(*)::int FROM ledger_line WHERE tenant_id=$1) ledger",[ids.tenantId])).rows[0];
  for(const [change,key] of [
    [{expectedSourceVersion:'snapshot:changed'},'source'],[{expectedReceiptHash:hash('changed inbound receipt')},'receipt'],[{expectedProviderReceiptHash:hash('changed provider receipt')},'provider'],[{expectedEvidenceHash:hash('changed evidence')},'evidence'],[{expectedAttachmentContentHash:hash('changed attachment')},'content'],[{expectedAttachmentStorageVersion:'changed-object-version'},'storage']
  ])await assert.rejects(binder.bindWbsPayableAttachment({...bindBase,...change,idempotencyKey:`wbs-bind-drift-${key}`}),error=>error.code==='40001');
  const unverifiedId=randomUUID();await adminPool.query(`INSERT INTO attachment(attachment_id,tenant_id,entity_id,name,media_type,size_bytes,content_hash,storage_ref,storage_version,uploaded_by,uploaded_at,scan_status,finalization_status) VALUES($1,$2,$3,'pending.pdf','application/pdf',9,$4,$5,'object-version-pending','pending-uploader',now(),'PENDING','PENDING')`,[unverifiedId,ids.tenantId,ids.entityId,hash('pending'),`object://attachments/${unverifiedId}`]);
  await assert.rejects(binder.bindWbsPayableAttachment({...bindBase,attachmentId:unverifiedId,expectedAttachmentContentHash:hash('pending'),expectedAttachmentStorageVersion:'object-version-pending',idempotencyKey:'wbs-bind-unverified'}),error=>error.code==='23503');
  for(const [actor,key] of [['admitted-payable-importer','importer'],[attachmentMeta.uploaded_by,'uploader'],['exact-scanner-1','scanner']]){
    const sodKernel=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,actor,['WBS.PAYABLE.REVIEW','AP.VIEW'])});
    await assert.rejects(sodKernel.bindWbsPayableAttachment({...bindBase,idempotencyKey:`wbs-bind-sod-${key}`}),error=>error.code==='42501');
  }
  await assert.rejects(binder.bindWbsPayableAttachment({...bindBase,entityId:randomUUID(),idempotencyKey:'wbs-bind-cross-entity'}),error=>error.code==='42501');
  await assert.rejects(binder.bindWbsPayableAttachment({...bindBase,tenantId:randomUUID(),idempotencyKey:'wbs-bind-cross-tenant'}),error=>error.code==='42501');
  const safeBind={...ids,wbsInboundRowId:stored.wbs_inbound_row_id,attachmentId,expectedRevision:0,reason:bindBase.reason,idempotencyKey:bindBase.idempotencyKey};
  const bound=await binder.bindWbsPayableUploadedAttachment(safeBind),boundReplay=await binder.bindWbsPayableUploadedAttachment(safeBind);
  assert.deepEqual({status:bound.status,replay:boundReplay.idempotent,review:bound.can_review,draft:bound.can_create_draft,post:bound.can_post},{status:'BOUND_EVIDENCE_ONLY',replay:true,review:false,draft:false,post:false});
  const boundCandidate=(await reviewReader.getWbsPayableReviewCandidate({tenantId:ids.tenantId,entityId:ids.entityId,wbsInboundRowId:stored.wbs_inbound_row_id}))[0];
  assert.deepEqual({choices:boundCandidate.attachment_choices.map(choice=>choice.attachment_id),readiness:boundCandidate.review_readiness,canReview:boundCandidate.can_review},{choices:[attachmentId],readiness:'READY_FOR_REVIEW',canReview:true});
  assert.deepEqual(Object.keys(boundCandidate.attachment_choices[0]).sort(),['attachment_id','media_type','name','verified_at']);
  await assert.rejects(binder.bindWbsPayableUploadedAttachment({...safeBind,reason:'Changed reason must conflict under the same idempotency key'}),error=>error.code==='23505');
  await binder.bindWbsPayableAttachment(bindBad);
  await assert.rejects(binder.bindWbsPayableAttachment({...bindBad,attachmentId,expectedAttachmentContentHash:attachmentMeta.content_hash,expectedAttachmentStorageVersion:attachmentMeta.storage_version,idempotencyKey:'wbs-bind-cross-row-one'}),error=>error.code==='23505');
  await assert.rejects(binder.bindWbsPayableAttachment({...bindBase,attachmentId:secondAttachmentId,expectedAttachmentContentHash:secondAttachmentHash,expectedAttachmentStorageVersion:'object-version-2',idempotencyKey:'wbs-bind-cross-row-two'}),error=>error.code==='23505');
  assert.deepEqual((await adminPool.query("SELECT (SELECT count(*)::int FROM raw_event WHERE tenant_id=$1) raw,(SELECT count(*)::int FROM source_document WHERE tenant_id=$1) source,(SELECT count(*)::int FROM staging_item WHERE tenant_id=$1) staging,(SELECT count(*)::int FROM business_document WHERE tenant_id=$1) bills,(SELECT count(*)::int FROM journal_entry WHERE tenant_id=$1) journals,(SELECT count(*)::int FROM ledger_line WHERE tenant_id=$1) ledger",[ids.tenantId])).rows[0],accountingBeforeBinding);
  const beforeBadReview=(await adminPool.query("SELECT (SELECT count(*)::int FROM raw_event WHERE tenant_id=$1) raw_events,(SELECT count(*)::int FROM source_document WHERE tenant_id=$1) source_documents,(SELECT count(*)::int FROM rule_evaluation WHERE tenant_id=$1) rule_evaluations,(SELECT count(*)::int FROM staging_item WHERE tenant_id=$1) staging_items,(SELECT count(*)::int FROM wbs_payable_review_evidence WHERE tenant_id=$1) reviews",[ids.tenantId])).rows[0];
  await assert.rejects(reviewer.reviewWbsPayable({...reviewArgs,wbsInboundRowId:badStored.wbs_inbound_row_id,expectedSourceVersion:badStored.source_version,expectedReceiptHash:badStored.receipt_hash,expectedEvidenceHash:badStored.evidence_hash,idempotencyKey:'wbs-payable-review-pg-due-before-invoice'}),error=>error.code==='23514'&&/due date cannot precede invoice date/i.test(error.message));
  assert.deepEqual((await adminPool.query("SELECT (SELECT count(*)::int FROM raw_event WHERE tenant_id=$1) raw_events,(SELECT count(*)::int FROM source_document WHERE tenant_id=$1) source_documents,(SELECT count(*)::int FROM rule_evaluation WHERE tenant_id=$1) rule_evaluations,(SELECT count(*)::int FROM staging_item WHERE tenant_id=$1) staging_items,(SELECT count(*)::int FROM wbs_payable_review_evidence WHERE tenant_id=$1) reviews",[ids.tenantId])).rows[0],beforeBadReview);
  const reviewed=await reviewer.reviewWbsPayable(reviewArgs),reviewReplay=await reviewer.reviewWbsPayable(reviewArgs);
  assert.deepEqual({status:reviewed.status,revision:reviewed.revision,replay:reviewReplay.idempotent,draft:reviewed.can_create_draft,approve:reviewed.can_approve,post:reviewed.can_post},{status:'READY_FOR_DRAFT_EVIDENCE_ONLY',revision:0,replay:true,draft:false,approve:false,post:false});
  const reviewedCandidate=(await reviewReader.getWbsPayableReviewCandidate({tenantId:ids.tenantId,entityId:ids.entityId,wbsInboundRowId:stored.wbs_inbound_row_id}))[0];assert.equal(reviewedCandidate.review_readiness,'ALREADY_REVIEWED');assert.equal(reviewedCandidate.can_review,false);
  const evidence=(await adminPool.query("SELECT s.status::text,s.version::text,s.reviewed_by,d.document_type,d.document_no,d.business_date::text,d.accounting_date::text,d.status document_status,d.gross_amount::text,r.rule_code,e.document_number,e.invoice_date::text,e.due_date::text,e.reviewed_by evidence_reviewer FROM wbs_payable_review_evidence e JOIN staging_item s ON s.staging_item_id=e.staging_item_id JOIN source_document d ON d.source_document_id=e.source_document_id JOIN rule_evaluation r ON r.rule_evaluation_id=e.rule_evaluation_id WHERE e.wbs_payable_review_evidence_id=$1",[reviewed.wbs_payable_review_evidence_id])).rows[0];
  assert.deepEqual(evidence,{status:'READY_FOR_DRAFT',version:'0',reviewed_by:'wbs-payable-reviewer',document_type:'WBS_PAYABLE',document_no:'WBS-INV-PG-001',business_date:'2026-07-10',accounting_date:'2026-07-11',document_status:'READY_FOR_DRAFT',gross_amount:'89.1250',rule_code:'WBS_PAYABLE_AP_MAP',document_number:'WBS-INV-PG-001',invoice_date:'2026-07-01',due_date:'2026-07-05',evidence_reviewer:'wbs-payable-reviewer'});
  const evidenceCounts=(await adminPool.query("SELECT (SELECT count(*)::int FROM wbs_payable_review_evidence WHERE tenant_id=$1) reviews,(SELECT count(*)::int FROM wbs_payable_review_attachment WHERE tenant_id=$1) attachments,(SELECT count(*)::int FROM source_link WHERE tenant_id=$1 AND link_type='WBS_PAYABLE_REVIEW') review_links,(SELECT count(*)::int FROM source_link WHERE tenant_id=$1 AND link_type='SOURCE_ATTACHMENT' AND source_document_id=$2) attachment_links,(SELECT count(*)::int FROM business_document WHERE tenant_id=$1) business_documents,(SELECT count(*)::int FROM ledger_line WHERE tenant_id=$1) ledger_lines",[ids.tenantId,reviewed.source_document_id])).rows[0];
  assert.deepEqual(evidenceCounts,{reviews:1,attachments:1,review_links:1,attachment_links:1,business_documents:0,ledger_lines:0});
  assert.equal((await adminPool.query('SELECT count(*)::int n FROM journal_entry WHERE tenant_id=$1',[ids.tenantId])).rows[0].n,journalsBefore);
  await assert.rejects(reviewer.reviewWbsPayable({...reviewArgs,expectedEvidenceHash:hash('stale-review-evidence'),idempotencyKey:'wbs-payable-review-pg-0002'}),error=>error.code==='40001');
  assert.deepEqual((await adminPool.query("SELECT refs_wbs_payable_iso_date('2026-02-29') invalid_date,refs_wbs_payable_iso_date('2026-02-28')::text valid_date")).rows[0],{invalid_date:null,valid_date:'2026-02-28'});
  await assert.rejects(adminPool.query("UPDATE wbs_payable_review_evidence SET review_reason='tampered evidence' WHERE wbs_payable_review_evidence_id=$1",[reviewed.wbs_payable_review_evidence_id]),error=>error.code==='55000');

  const evidenceMaker=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'wbs-payable-maker',['WBS.AUTOREC.VIEW','AP.VIEW','AP.BILL.CREATE'])});
  const listedEvidence=await evidenceMaker.listWbsPayableReviewEvidence({tenantId:ids.tenantId,entityId:ids.entityId,limit:10});
  assert.equal(listedEvidence.length,1);assert.deepEqual({id:listedEvidence[0].wbs_payable_review_evidence_id,row:listedEvidence[0].wbs_inbound_row_id,number:listedEvidence[0].document_number,invoice:listedEvidence[0].invoice_date,due:listedEvidence[0].due_date,date:listedEvidence[0].accounting_date,currency:listedEvidence[0].currency,amount:listedEvidence[0].gross_amount,readiness:listedEvidence[0].draft_readiness,canDraft:listedEvidence[0].can_create_draft},{id:reviewed.wbs_payable_review_evidence_id,row:stored.wbs_inbound_row_id,number:'WBS-INV-PG-001',invoice:'2026-07-01',due:'2026-07-05',date:'2026-07-11',currency:'USD',amount:'89.1250',readiness:'READY_FOR_AP_DRAFT',canDraft:true});
  for(const forbidden of ['raw_payload','normalized_payload','provider_request','provider_response','signature','access_token'])assert.equal(Object.hasOwn(listedEvidence[0],forbidden),false);
  assert.deepEqual((await evidenceMaker.getWbsPayableReviewEvidence({tenantId:ids.tenantId,entityId:ids.entityId,reviewEvidenceId:reviewed.wbs_payable_review_evidence_id}))[0],listedEvidence[0]);
  const wbsOnlyReader=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'wbs-only-reader',['WBS.AUTOREC.VIEW'])});
  const apOnlyReader=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'ap-only-reader',['AP.VIEW'])});
  await assert.rejects(wbsOnlyReader.listWbsPayableReviewEvidence({tenantId:ids.tenantId,entityId:ids.entityId,limit:10}),error=>error.code==='42501');
  await assert.rejects(apOnlyReader.listWbsPayableReviewEvidence({tenantId:ids.tenantId,entityId:ids.entityId,limit:10}),error=>error.code==='42501');
  const reviewerEvidenceReader=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'wbs-payable-reviewer',['WBS.AUTOREC.VIEW','AP.VIEW','AP.BILL.CREATE'])});
  const reviewerRead=(await reviewerEvidenceReader.getWbsPayableReviewEvidence({tenantId:ids.tenantId,entityId:ids.entityId,reviewEvidenceId:reviewed.wbs_payable_review_evidence_id}))[0];
  assert.deepEqual({readiness:reviewerRead.draft_readiness,canDraft:reviewerRead.can_create_draft},{readiness:'MAKER_REVIEWER_SOD',canDraft:false});

  const draftArgs={...ids,wbsInboundRowId:stored.wbs_inbound_row_id,reviewEvidenceId:reviewed.wbs_payable_review_evidence_id,expectedRevision:0,expectedEvidenceHash:stored.evidence_hash,mappingSnapshotId:mappingId,attachmentIds:[attachmentId],reason:'Create the AP Bill Draft from frozen reviewed WBS evidence',idempotencyKey:'wbs-payable-draft-pg-0001'};
  const reviewerAsMaker=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'wbs-payable-reviewer',['AP.BILL.CREATE'])});
  const maker=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'wbs-payable-maker',['AP.BILL.CREATE'])});
  const aiProposalService=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'ai-payable-proposal-service',['AI.PROPOSAL.CREATE'])});
  const proposalArgs={...ids,reviewEvidenceId:reviewed.wbs_payable_review_evidence_id,modelId:'REFS_RULE_ASSIST_V1',promptVersion:'WBS_PAYABLE_V1',idempotencyKey:'ai-wbs-payable-proposal-pg-0001'};
  await assert.rejects(denied.proposeAiWbsPayableDraft(proposalArgs),error=>error.code==='42501');
  const proposed=await aiProposalService.proposeAiWbsPayableDraft(proposalArgs),proposalReplay=await aiProposalService.proposeAiWbsPayableDraft(proposalArgs);
  assert.deepEqual({replay:proposalReplay.idempotent,draft:proposed.can_create_draft,submit:proposed.can_submit,review:proposed.can_review,approve:proposed.can_approve,post:proposed.can_post},{replay:true,draft:false,submit:false,review:false,approve:false,post:false});
  assert.deepEqual((await adminPool.query("SELECT p.proposal_lines,r.decision FROM ai_wbs_payable_draft_proposal p LEFT JOIN ai_wbs_payable_draft_proposal_review r ON r.ai_wbs_payable_draft_proposal_id=p.ai_wbs_payable_draft_proposal_id WHERE p.tenant_id=$1 AND p.ai_wbs_payable_draft_proposal_id=$2",[ids.tenantId,proposed.ai_wbs_payable_draft_proposal_id])).rows[0],{proposal_lines:[{line_no:1,account_code:'610000',debit_amount:'89.1250',credit_amount:'0.0000',source:'REVIEWED_MAPPING'},{line_no:2,account_code:'291001',debit_amount:'0.0000',credit_amount:'89.1250',source:'REVIEWED_MAPPING'}],decision:null});
  await assert.rejects(reviewerAsMaker.reviewAiWbsPayableDraftProposal({...ids,proposalId:proposed.ai_wbs_payable_draft_proposal_id,decision:'ACCEPTED',reason:'The recommended lines match the reviewed evidence',idempotencyKey:'ai-wbs-payable-proposal-review-pg-reviewer'}),error=>error.code==='42501'&&/maker and evidence reviewer/i.test(error.message));
  const accepted=await maker.reviewAiWbsPayableDraftProposal({...ids,proposalId:proposed.ai_wbs_payable_draft_proposal_id,decision:'ACCEPTED',reason:'The recommended lines match the reviewed evidence',idempotencyKey:'ai-wbs-payable-proposal-review-pg-0001'});
  assert.deepEqual({decision:accepted.decision,draft:accepted.can_create_draft,submit:accepted.can_submit,approve:accepted.can_approve,post:accepted.can_post},{decision:'ACCEPTED',draft:false,submit:false,approve:false,post:false});
  const draftMutationCounts=async()=>(await adminPool.query("SELECT (SELECT count(*)::int FROM business_document WHERE tenant_id=$1 AND entity_id=$2) business_documents,(SELECT count(*)::int FROM journal_entry WHERE tenant_id=$1 AND entity_id=$2) journal_entries,(SELECT count(*)::int FROM journal_line WHERE tenant_id=$1 AND entity_id=$2) journal_lines,(SELECT count(*)::int FROM wbs_payable_draft_evidence WHERE tenant_id=$1 AND entity_id=$2) draft_evidence,(SELECT count(*)::int FROM source_link WHERE tenant_id=$1 AND entity_id=$2 AND link_type IN ('SOURCE_TO_JE','JE_ATTACHMENT')) draft_links,(SELECT count(*)::int FROM posting_batch WHERE tenant_id=$1 AND entity_id=$2) posting_batches,(SELECT count(*)::int FROM ledger_line WHERE tenant_id=$1 AND entity_id=$2) ledger_lines",[ids.tenantId,ids.entityId])).rows[0];
  const beforeFailedDrafts=await draftMutationCounts();
  await assert.rejects(reviewerAsMaker.createWbsPayableApDraft(draftArgs),error=>error.code==='42501'&&/maker and reviewer/i.test(error.message));
  await assert.rejects(denied.createWbsPayableApDraft(draftArgs),error=>error.code==='42501');
  await assert.rejects(maker.createWbsPayableApDraft({...draftArgs,entityId:randomUUID(),idempotencyKey:'wbs-payable-draft-pg-cross-scope'}),error=>error.code==='42501');
  await assert.rejects(maker.createWbsPayableApDraft({...draftArgs,expectedEvidenceHash:hash('stale-draft-evidence-before-create'),idempotencyKey:'wbs-payable-draft-pg-hash-conflict'}),error=>error.code==='40001');
  await assert.rejects(maker.createWbsPayableApDraft({...draftArgs,attachmentIds:[randomUUID()],idempotencyKey:'wbs-payable-draft-pg-wrong-attachment'}),error=>error.code==='23514');
  await adminPool.query("INSERT INTO source_link(tenant_id,entity_id,link_type,source_document_id,journal_entry_id,created_by) VALUES($1,$2,'AI_ACCOUNTING_DECISION_SOURCE',$3,$4,'parallel-ai-maker')",[ids.tenantId,ids.entityId,reviewed.source_document_id,ids.journalId]);
  await assert.rejects(maker.createWbsPayableApDraft({...draftArgs,idempotencyKey:'wbs-payable-draft-pg-existing-ai-booking'}),error=>error.code==='40001');
  await adminPool.query('ALTER TABLE source_link DISABLE TRIGGER USER');await adminPool.query("DELETE FROM source_link WHERE source_document_id=$1 AND journal_entry_id=$2 AND created_by='parallel-ai-maker'",[reviewed.source_document_id,ids.journalId]);await adminPool.query('ALTER TABLE source_link ENABLE TRIGGER USER');
  await adminPool.query("UPDATE accounting_period SET status='SOFT_CLOSED',closed_by='controller',closed_at=now(),version=version+1 WHERE tenant_id=$1 AND entity_id=$2 AND period_id=$3",[ids.tenantId,ids.entityId,ids.periodId]);
  await assert.rejects(maker.createWbsPayableApDraft({...draftArgs,idempotencyKey:'wbs-payable-draft-pg-closed-period'}),error=>error.code==='55000');
  await adminPool.query("UPDATE accounting_period SET status='OPEN',closed_by=NULL,closed_at=NULL,version=version+1 WHERE tenant_id=$1 AND entity_id=$2 AND period_id=$3",[ids.tenantId,ids.entityId,ids.periodId]);
  assert.deepEqual(await draftMutationCounts(),beforeFailedDrafts);
  const drafted=await maker.createWbsPayableApDraft(draftArgs),draftReplay=await maker.createWbsPayableApDraft(draftArgs);
  assert.deepEqual({status:drafted.status,type:drafted.journal_type,revision:drafted.revision,staging:drafted.staging_version,replay:draftReplay.idempotent,draft:drafted.can_create_draft,submit:drafted.can_submit,review:drafted.can_review,approve:drafted.can_approve,post:drafted.can_post},{status:'DRAFT',type:'AUTO',revision:0,staging:1,replay:true,draft:false,submit:false,review:false,approve:false,post:false});
  const draftEvidence=(await adminPool.query(`SELECT d.document_kind,d.document_number,d.counterparty_ref,d.counterparty_name,d.currency,d.accounting_date::text,d.due_date::text,d.gross_amount::text,d.open_balance::text,d.status document_status,d.source_document_id,d.draft_journal_entry_id,
      j.journal_number,j.journal_type,j.status::text journal_status,j.journal_date::text,j.currency journal_currency,j.created_by,
      s.status::text staging_status,s.version::text staging_version,w.created_by bridge_maker,w.mapping_snapshot_id,w.attachment_ids,
      (SELECT jsonb_agg(jsonb_build_object('line_no',l.line_no,'account_code',l.account_code,'debit',l.debit_amount::text,'credit',l.credit_amount::text,'member_ref',l.member_ref) ORDER BY l.line_no) FROM journal_line l WHERE l.tenant_id=w.tenant_id AND l.entity_id=w.entity_id AND l.journal_entry_id=w.journal_entry_id) lines
    FROM wbs_payable_draft_evidence w JOIN business_document d ON d.business_document_id=w.business_document_id JOIN journal_entry j ON j.journal_entry_id=w.journal_entry_id JOIN staging_item s ON s.staging_item_id=w.staging_item_id
    WHERE w.tenant_id=$1 AND w.entity_id=$2 AND w.wbs_payable_review_evidence_id=$3`,[ids.tenantId,ids.entityId,reviewed.wbs_payable_review_evidence_id])).rows[0];
  assert.deepEqual({kind:draftEvidence.document_kind,number:draftEvidence.document_number,vendor:draftEvidence.counterparty_ref,name:draftEvidence.counterparty_name,currency:draftEvidence.currency,date:draftEvidence.accounting_date,due:draftEvidence.due_date,gross:draftEvidence.gross_amount,open:draftEvidence.open_balance,status:draftEvidence.document_status,source:draftEvidence.source_document_id,journal:draftEvidence.draft_journal_entry_id,journalNumber:draftEvidence.journal_number,type:draftEvidence.journal_type,journalStatus:draftEvidence.journal_status,journalDate:draftEvidence.journal_date,journalCurrency:draftEvidence.journal_currency,maker:draftEvidence.created_by,stagingStatus:draftEvidence.staging_status,stagingVersion:draftEvidence.staging_version,bridgeMaker:draftEvidence.bridge_maker,mapping:draftEvidence.mapping_snapshot_id,attachments:draftEvidence.attachment_ids},{kind:'AP_BILL',number:'WBS-INV-PG-001',vendor:'VENDOR-PG',name:'Signed WBS vendor',currency:'USD',date:'2026-07-11',due:'2026-07-05',gross:'89.1250',open:'89.1250',status:'DRAFT',source:reviewed.source_document_id,journal:drafted.journal_entry_id,journalNumber:`WBS-AP-${reviewed.wbs_payable_review_evidence_id.replaceAll('-','')}`,type:'AUTO',journalStatus:'DRAFT',journalDate:'2026-07-11',journalCurrency:'USD',maker:'wbs-payable-maker',stagingStatus:'DRAFT_CREATED',stagingVersion:'1',bridgeMaker:'wbs-payable-maker',mapping:mappingId,attachments:[attachmentId]});
  assert.deepEqual(draftEvidence.lines,[{line_no:1,account_code:'610000',debit:'89.1250',credit:'0.0000',member_ref:null},{line_no:2,account_code:'291001',debit:'0.0000',credit:'89.1250',member_ref:'VENDOR-PG'}]);
  const draftCounts=(await adminPool.query("SELECT (SELECT count(*)::int FROM business_document WHERE tenant_id=$1 AND source_document_id=$2) bills,(SELECT count(*)::int FROM journal_entry WHERE tenant_id=$1 AND journal_entry_id=$3 AND journal_type='AUTO' AND status='DRAFT') journals,(SELECT count(*)::int FROM journal_line WHERE tenant_id=$1 AND journal_entry_id=$3) journal_lines,(SELECT count(*)::int FROM source_link WHERE tenant_id=$1 AND source_document_id=$2 AND journal_entry_id=$3 AND link_type='SOURCE_TO_JE') source_links,(SELECT count(*)::int FROM source_link WHERE tenant_id=$1 AND journal_entry_id=$3 AND attachment_id=$4 AND link_type='JE_ATTACHMENT') attachment_links,(SELECT count(*)::int FROM posting_batch WHERE tenant_id=$1) posting_batches,(SELECT count(*)::int FROM ledger_line WHERE tenant_id=$1) ledger_lines,(SELECT count(*)::int FROM audit_event WHERE tenant_id=$1 AND event_type='WBS_PAYABLE_AP_DRAFT_CREATED') audits,(SELECT count(*)::int FROM outbox_event WHERE tenant_id=$1 AND event_type='WBS_PAYABLE_AP_DRAFT_CREATED') outbox",[ids.tenantId,reviewed.source_document_id,drafted.journal_entry_id,attachmentId])).rows[0];
  assert.deepEqual(draftCounts,{bills:1,journals:1,journal_lines:2,source_links:1,attachment_links:1,posting_batches:0,ledger_lines:0,audits:1,outbox:1});
  const afterSuccessfulDraft=await draftMutationCounts();
  assert.deepEqual({businessDocuments:afterSuccessfulDraft.business_documents-beforeFailedDrafts.business_documents,journalEntries:afterSuccessfulDraft.journal_entries-beforeFailedDrafts.journal_entries,journalLines:afterSuccessfulDraft.journal_lines-beforeFailedDrafts.journal_lines,draftEvidence:afterSuccessfulDraft.draft_evidence-beforeFailedDrafts.draft_evidence,draftLinks:afterSuccessfulDraft.draft_links-beforeFailedDrafts.draft_links,postingBatches:afterSuccessfulDraft.posting_batches-beforeFailedDrafts.posting_batches,ledgerLines:afterSuccessfulDraft.ledger_lines-beforeFailedDrafts.ledger_lines},{businessDocuments:1,journalEntries:1,journalLines:2,draftEvidence:1,draftLinks:2,postingBatches:0,ledgerLines:0});
  assert.deepEqual(await draftMutationCounts(),afterSuccessfulDraft);
  const draftedEvidence=(await evidenceMaker.getWbsPayableReviewEvidence({tenantId:ids.tenantId,entityId:ids.entityId,reviewEvidenceId:reviewed.wbs_payable_review_evidence_id}))[0];
  assert.deepEqual({status:draftedEvidence.evidence_status,readiness:draftedEvidence.draft_readiness,canDraft:draftedEvidence.can_create_draft,bill:draftedEvidence.business_document_id,journal:draftedEvidence.journal_entry_id},{status:'DRAFT_CREATED',readiness:'ALREADY_DRAFTED',canDraft:false,bill:drafted.business_document_id,journal:drafted.journal_entry_id});
  await assert.rejects(maker.createWbsPayableApDraft({...draftArgs,expectedEvidenceHash:hash('stale-draft-evidence'),idempotencyKey:'wbs-payable-draft-pg-stale'}),error=>error.code==='40001');
  await assert.rejects(adminPool.query("UPDATE wbs_payable_draft_evidence SET maker_reason='tampered Draft evidence' WHERE tenant_id=$1",[ids.tenantId]),error=>error.code==='55000');

  // Advance this exact signed WBS payable through the ordinary journal workflow.
  // Each step has a distinct actor and no import/review/maker actor is allowed to
  // auto-approve or auto-post the resulting accounting entry.
  const submitter=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'wbs-payable-submitter',['GL.JE.SUBMIT'])});
  const journalReviewer=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'wbs-payable-journal-reviewer',['GL.JE.REVIEW'])});
  const journalApprover=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'wbs-payable-journal-approver',['GL.JE.APPROVE'])});
  const journalPoster=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'wbs-payable-journal-poster',['GL.JE.POST'])});
  await assert.rejects(maker.transitionJournal({...ids,journalEntryId:drafted.journal_entry_id,action:'SUBMIT',expectedRevision:0,idempotencyKey:'wbs-payable-maker-cannot-submit'}),error=>error.code==='42501');
  assert.equal((await submitter.transitionJournal({...ids,journalEntryId:drafted.journal_entry_id,action:'SUBMIT',expectedRevision:0,idempotencyKey:'wbs-payable-submit-pg-0001'})).status,'PENDING_REVIEW');
  assert.equal((await journalReviewer.transitionJournal({...ids,journalEntryId:drafted.journal_entry_id,action:'REVIEW',expectedRevision:1,idempotencyKey:'wbs-payable-journal-review-pg-0001'})).status,'PENDING_APPROVAL');
  assert.equal((await journalApprover.transitionJournal({...ids,journalEntryId:drafted.journal_entry_id,action:'APPROVE',expectedRevision:2,idempotencyKey:'wbs-payable-approve-pg-0001'})).status,'APPROVED');
  const posted=await journalPoster.postJournal({...ids,journalEntryId:drafted.journal_entry_id,periodId:ids.periodId,expectedRevision:3,idempotencyKey:'wbs-payable-post-pg-0001'});
  assert.equal(posted.idempotent,false);

  const postedState=(await adminPool.query(`SELECT d.status document_status,d.open_balance::text,d.draft_journal_entry_id,d.posted_journal_entry_id,j.status::text journal_status,s.status::text staging_status,s.version::text staging_version,
      (SELECT count(DISTINCT l.posting_batch_id)::int FROM ledger_line l WHERE l.tenant_id=d.tenant_id AND l.entity_id=d.entity_id AND l.journal_entry_id=j.journal_entry_id) posting_batches,
      (SELECT count(*)::int FROM ledger_line l WHERE l.tenant_id=d.tenant_id AND l.entity_id=d.entity_id AND l.journal_entry_id=j.journal_entry_id) ledger_lines
    FROM business_document d JOIN journal_entry j ON j.journal_entry_id=d.posted_journal_entry_id JOIN wbs_payable_draft_evidence w ON w.business_document_id=d.business_document_id JOIN staging_item s ON s.staging_item_id=w.staging_item_id
    WHERE d.tenant_id=$1 AND d.entity_id=$2 AND d.business_document_id=$3`,[ids.tenantId,ids.entityId,drafted.business_document_id])).rows[0];
  assert.deepEqual(postedState,{document_status:'OPEN',open_balance:'89.1250',draft_journal_entry_id:null,posted_journal_entry_id:drafted.journal_entry_id,journal_status:'POSTED',staging_status:'POSTED',staging_version:'5',posting_batches:1,ledger_lines:2});

  const authorityReader=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'wbs-payable-authority-reader',['GL.REPORT.VIEW','GL.JE.VIEW','AP.VIEW'])});
  const gl=await authorityReader.listGeneralLedger({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId,accountCode:'610000',query:'WBS-INV-PG-001',limit:50,offset:0});
  assert.equal(gl.length,1);assert.deepEqual({journal:gl[0].journal_entry_id,debit:gl[0].debit_amount,credit:gl[0].credit_amount,sources:gl[0].source_document_ids},{journal:drafted.journal_entry_id,debit:'89.1250',credit:'0.0000',sources:[reviewed.source_document_id]});
  const statements=await authorityReader.getFinancialStatements({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId});
  const trialExpense=statements.find(row=>row.statement_type==='TRIAL_BALANCE'&&row.account_code==='610000');
  const trialPayable=statements.find(row=>row.statement_type==='TRIAL_BALANCE'&&row.account_code==='291001');
  assert.deepEqual({debit:trialExpense.period_debit,credit:trialExpense.period_credit,balance:trialExpense.display_balance},{debit:'89.1250',credit:'0.0000',balance:'89.1250'});
  assert.deepEqual({debit:trialPayable.period_debit,credit:trialPayable.period_credit,balance:trialPayable.display_balance},{debit:'0.0000',credit:'89.1250',balance:'-89.1250'});
  assert.deepEqual(await authorityReader.getApAging({tenantId:ids.tenantId,entityId:ids.entityId,asOfDate:'2026-08-31'}),[{currency:'USD',current_amount:'0.0000',days_1_30:'0.0000',days_31_60:'89.1250',days_61_90:'0.0000',days_91_plus:'0.0000',total_open_balance:'89.1250'}]);
});

pgTest('isolated test-key Cost-to-CWIP admission survives independent Review Draft four-role Post and report lineage',async()=>{
  const ids=await seed({status:'DRAFT',attachmentStatus:null,extraAccounts:[
    {accountCode:'164100',accountName:'Construction in progress - land'},
    {accountCode:'610000',accountName:'Cost clearing'}
  ]});
  await adminPool.query("UPDATE tenant SET tenant_code='DEMO_STAGE3_COST_CWIP_2026',name='DEMO isolated Cost-to-CWIP acceptance' WHERE tenant_id=$1",[ids.tenantId]);
  await adminPool.query(`INSERT INTO controlled_demo_tenant(tenant_id,scenario_code,display_label,created_by,expires_at)
    VALUES($1,'STAGE3_TEST_KEY_COST_CWIP','DEMO test-key Cost-to-CWIP to report acceptance','demo-admin',clock_timestamp()+interval '1 day')`,[ids.tenantId]);

  const {privateKey,publicKey}=generateKeyPairSync('ed25519'),keyId='wbs-cost-cwip-pg-test-key',costLedgerId=`COST-PG-${randomUUID()}`;
  const costRow={costLedgerId,currency:'USD',amount:'125.5000',cost_date:'2026-07-10',posting_date:'2026-07-11',project_ref:'PROJECT-01',cost_code_ref:'CWIP-LAND',description:'Land preparation',direction:'DEBIT'};
  const view={name:'BGDATA.cost_general_ledger',company_key:ids.sourceEntityId,rows:[costRow],row_count:1,first_primary_key:costLedgerId,last_primary_key:costLedgerId,content_hash:canonicalRequestHash([costRow])};
  const unsigned={schema_version:'WBS_READONLY_SNAPSHOT_V2',snapshot_id:randomUUID(),captured_at:'2026-07-11T03:00:00.000Z',environment:'PRODUCTION',source_system:'WBS',dictionary_version:'WBS-COST-GL-V1',delivery:{mode:'SIGNED_SNAPSHOT_PACKAGE',snapshot_token:`cost-cwip-${randomUUID()}`,extract_started_at:'2026-07-11T02:59:00.000Z',extract_completed_at:'2026-07-11T03:00:00.000Z',consistency:'COMPLETE',read_consistency:'SNAPSHOT_ISOLATION',pagination:'PRIMARY_KEY_SEEK'},views:[view],detached_signature:{key_id:keyId,algorithm:'Ed25519',value:'placeholder'}};
  unsigned.package_hash=canonicalRequestHash(Object.fromEntries(Object.entries(unsigned).filter(([key])=>!['package_hash','detached_signature'].includes(key))));
  const snapshot={...unsigned,detached_signature:{...unsigned.detached_signature,value:sign(null,Buffer.from(unsigned.package_hash),privateKey).toString('base64')}};
  const verifier=createWbsSnapshotSignatureVerifier({publicKeys:{[keyId]:publicKey.export({type:'spki',format:'pem'})}});
  const importer=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'cost-cwip-test-importer',['WBS.SNAPSHOT.IMPORT']),wbsSnapshotVerifier:verifier});
  const admission=createWbsAdmittedCostCwipIngestion({kernel:importer,signatureVerifier:verifier});
  const admitted=await admission.ingest({tenantId:ids.tenantId,entityId:ids.entityId,snapshot,idempotencyKey:'cost-cwip-pg-test-admission-0001'});
  assert.deepEqual({status:admitted.status,staging:admitted.staging_count,draft:admitted.can_create_draft,post:admitted.can_post},{status:'PERSISTED_COST_CWIP_STAGING_REVIEW_REQUIRED',staging:1,draft:false,post:false});
  const stored=(await adminPool.query(`SELECT i.wbs_inbound_row_id,i.source_version,r.receipt_hash,i.raw,i.normalized,i.outcome_kind,
      refs_wbs_cost_cwip_review_evidence_hash(i.wbs_inbound_row_id,i.source_record_id,i.source_version,r.receipt_hash,i.raw,i.normalized,i.outcome,i.outcome_kind) evidence_hash
    FROM wbs_inbound_receipt r JOIN wbs_inbound_row i USING(receipt_id)
    WHERE r.tenant_id=$1 AND r.entity_id=$2 AND i.source_record_id=$3`,[ids.tenantId,ids.entityId,costLedgerId])).rows[0];
  assert.deepEqual({amount:stored.normalized.amount_money4,project:stored.normalized.project_ref,cost:stored.normalized.cost_code_ref,outcome:stored.outcome_kind},{amount:'125.5000',project:'PROJECT-01',cost:'CWIP-LAND',outcome:'STAGING'});

  const settingId=randomUUID(),mappingId=randomUUID();
  const mappingInput={company_key:ids.sourceEntityId,currency:'USD',project_ref:'PROJECT-01',cost_code_ref:'CWIP-LAND'};
  const mappingOutput={cwip_account_code:'164100',offset_account_code:'610000',rule_code:'WBS_COST_CWIP_TEST',rule_version:'1'};
  const hashes=(await adminPool.query("SELECT refs_jsonb_hash('{}'::jsonb) setting_hash,refs_jsonb_hash($1::jsonb) input_hash,refs_jsonb_hash(jsonb_build_object('input_keys',$1::jsonb,'output_rules',$2::jsonb)) mapping_hash",[JSON.stringify(mappingInput),JSON.stringify(mappingOutput)])).rows[0];
  await adminPool.query(`INSERT INTO setting_snapshot(setting_snapshot_id,tenant_id,entity_id,family,scope_type,scope_key,version,effective_from,status,snapshot,snapshot_hash,created_by,approved_by,approved_at)
    VALUES($1,$2,$3::uuid,'WBS_COST_CWIP_REVIEW','ENTITY',$3::text,1,'2026-01-01','APPROVED','{}',$4,'cost-setting-maker','cost-setting-approver',now())`,[settingId,ids.tenantId,ids.entityId,hashes.setting_hash]);
  await adminPool.query(`INSERT INTO mapping_snapshot(mapping_snapshot_id,tenant_id,entity_id,family,scope_type,scope_key,input_key_hash,version,priority,effective_from,status,input_keys,output_rules,snapshot_hash,created_by,approved_by,approved_at)
    VALUES($1,$2,$3::uuid,'WBS_COST_CWIP','ENTITY',$3::text,$4,1,1,'2026-01-01','APPROVED',$5::jsonb,$6::jsonb,$7,'cost-mapping-maker','cost-mapping-approver',now())`,[mappingId,ids.tenantId,ids.entityId,hashes.input_hash,JSON.stringify(mappingInput),JSON.stringify(mappingOutput),hashes.mapping_hash]);

  const reviewer=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'cost-cwip-reviewer',['WBS.COST.CWIP.REVIEW'])});
  const reviewArgs={...ids,wbsInboundRowId:stored.wbs_inbound_row_id,periodId:ids.periodId,expectedSourceVersion:stored.source_version,expectedReceiptHash:stored.receipt_hash,expectedEvidenceHash:stored.evidence_hash,settingSnapshotId:settingId,mappingSnapshotId:mappingId,reason:'Independently review this exact signed Cost-to-CWIP evidence.',idempotencyKey:'cost-cwip-pg-test-review-0001'};
  const denied=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'cost-cwip-reader',[])});
  await assert.rejects(denied.reviewWbsCostCwip(reviewArgs),error=>error.code==='42501');
  const reviewed=await reviewer.reviewWbsCostCwip(reviewArgs),reviewReplay=await reviewer.reviewWbsCostCwip(reviewArgs);
  assert.deepEqual({status:reviewed.status,replay:reviewReplay.idempotent,draft:reviewed.can_create_draft,approve:reviewed.can_approve,post:reviewed.can_post},{status:'READY_FOR_DRAFT',replay:true,draft:false,approve:false,post:false});
  await assert.rejects(reviewer.reviewWbsCostCwip({...reviewArgs,expectedEvidenceHash:hash('stale-cost-evidence'),idempotencyKey:'cost-cwip-pg-test-review-stale'}),error=>error.code==='40001');

  const maker=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'cost-cwip-maker',['WBS.COST.CWIP.DRAFT','GL.JE.AUTO.CREATE'])});
  const draftArgs={...ids,reviewEvidenceId:reviewed.wbs_cost_cwip_review_evidence_id,expectedEvidenceHash:stored.evidence_hash,reason:'Create a standard Draft journal from reviewed Cost-to-CWIP evidence.',idempotencyKey:'cost-cwip-pg-test-draft-0001'};
  const readyState=(await adminPool.query(`SELECT s.status::text staging_status,s.version::text staging_version,d.status::text source_status,d.document_type,
      m.snapshot_hash,m.snapshot_hash=refs_jsonb_hash(jsonb_build_object('input_keys',m.input_keys,'output_rules',m.output_rules)) mapping_hash_matches
    FROM wbs_cost_cwip_review_evidence e
    JOIN staging_item s ON s.staging_item_id=e.staging_item_id
    JOIN source_document d ON d.source_document_id=e.source_document_id
    JOIN mapping_snapshot m ON m.mapping_snapshot_id=e.mapping_snapshot_id
    WHERE e.tenant_id=$1 AND e.entity_id=$2 AND e.wbs_cost_cwip_review_evidence_id=$3`,[ids.tenantId,ids.entityId,reviewed.wbs_cost_cwip_review_evidence_id])).rows[0];
  assert.deepEqual(readyState,{staging_status:'READY_FOR_DRAFT',staging_version:'0',source_status:'READY_FOR_DRAFT',document_type:'WBS_COST_CWIP',snapshot_hash:hashes.mapping_hash,mapping_hash_matches:true});
  const makerVisible=(await maker.inSession(client=>client.query(`SELECT s.status::text staging_status,s.version::text staging_version,d.status::text source_status,d.document_type,
      m.snapshot_hash=m_expected.snapshot_hash mapping_hash_matches
    FROM wbs_cost_cwip_review_evidence e
    JOIN staging_item s ON s.staging_item_id=e.staging_item_id
    JOIN source_document d ON d.source_document_id=e.source_document_id
    JOIN mapping_snapshot m ON m.mapping_snapshot_id=e.mapping_snapshot_id
    CROSS JOIN LATERAL (SELECT refs_jsonb_hash(jsonb_build_object('input_keys',m.input_keys,'output_rules',m.output_rules)) snapshot_hash) m_expected
    WHERE e.tenant_id=$1 AND e.entity_id=$2 AND e.wbs_cost_cwip_review_evidence_id=$3`,[ids.tenantId,ids.entityId,reviewed.wbs_cost_cwip_review_evidence_id]))).rows[0];
  assert.deepEqual(makerVisible,{staging_status:'READY_FOR_DRAFT',staging_version:'0',source_status:'READY_FOR_DRAFT',document_type:'WBS_COST_CWIP',mapping_hash_matches:true});
  await assert.rejects(reviewer.createWbsCostCwipDraft(draftArgs),error=>error.code==='42501');
  const drafted=await maker.createWbsCostCwipDraft(draftArgs),draftReplay=await maker.createWbsCostCwipDraft(draftArgs);
  assert.equal(drafted.status,'DRAFT');
  assert.equal(draftReplay.idempotent,true);
  assert.equal(draftReplay.journal_entry_id,drafted.journal_entry_id);
  const draftState=(await adminPool.query(`SELECT j.status::text status,j.journal_type,COUNT(l.*)::int lines
    FROM journal_entry j JOIN journal_line l ON l.journal_entry_id=j.journal_entry_id
    WHERE j.tenant_id=$1 AND j.entity_id=$2 AND j.journal_entry_id=$3 GROUP BY j.status,j.journal_type`,[ids.tenantId,ids.entityId,drafted.journal_entry_id])).rows[0];
  assert.deepEqual(draftState,{status:'DRAFT',journal_type:'AUTO',lines:2});

  const submitter=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'cost-cwip-submitter',['GL.JE.SUBMIT'])});
  const journalReviewer=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'cost-cwip-journal-reviewer',['GL.JE.REVIEW'])});
  const approver=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'cost-cwip-approver',['GL.JE.APPROVE'])});
  const poster=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'cost-cwip-poster',['GL.JE.POST'])});
  assert.equal((await submitter.transitionJournal({...ids,journalEntryId:drafted.journal_entry_id,action:'SUBMIT',expectedRevision:0,idempotencyKey:'cost-cwip-pg-test-submit-0001'})).status,'PENDING_REVIEW');
  assert.equal((await journalReviewer.transitionJournal({...ids,journalEntryId:drafted.journal_entry_id,action:'REVIEW',expectedRevision:1,idempotencyKey:'cost-cwip-pg-test-journal-review-0001'})).status,'PENDING_APPROVAL');
  assert.equal((await approver.transitionJournal({...ids,journalEntryId:drafted.journal_entry_id,action:'APPROVE',expectedRevision:2,idempotencyKey:'cost-cwip-pg-test-approve-0001'})).status,'APPROVED');
  await poster.postJournal({...ids,journalEntryId:drafted.journal_entry_id,periodId:ids.periodId,expectedRevision:3,idempotencyKey:'cost-cwip-pg-test-post-0001'});
  const posted=(await adminPool.query(`SELECT j.status::text journal_status,(SELECT count(*)::int FROM ledger_line l WHERE l.tenant_id=j.tenant_id AND l.entity_id=j.entity_id AND l.journal_entry_id=j.journal_entry_id) ledger_lines,
      (SELECT count(*)::int FROM source_link s WHERE s.tenant_id=j.tenant_id AND s.entity_id=j.entity_id AND s.journal_entry_id=j.journal_entry_id AND s.source_document_id=$4) source_links
    FROM journal_entry j WHERE j.tenant_id=$1 AND j.entity_id=$2 AND j.journal_entry_id=$3`,[ids.tenantId,ids.entityId,drafted.journal_entry_id,reviewed.source_document_id])).rows[0];
  assert.deepEqual(posted,{journal_status:'POSTED',ledger_lines:2,source_links:1});
  const reader=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'cost-cwip-report-reader',['GL.JE.VIEW','GL.REPORT.VIEW'])});
  const gl=await reader.listGeneralLedger({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId,accountCode:'164100',query:costLedgerId,limit:10,offset:0});
  assert.deepEqual({count:gl.length,journal:gl[0]?.journal_entry_id,debit:gl[0]?.debit_amount,source:gl[0]?.source_document_ids},{count:1,journal:drafted.journal_entry_id,debit:'125.5000',source:[reviewed.source_document_id]});
  const statements=await reader.getFinancialStatements({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId});
  const trial=statements.find(row=>row.statement_type==='TRIAL_BALANCE'&&row.account_code==='164100');
  assert.deepEqual({debit:trial.period_debit,credit:trial.period_credit,balance:trial.display_balance},{debit:'125.5000',credit:'0.0000',balance:'125.5000'});
});

pgTest('provider-signed Bank source survives exact Match Unmatch adjustment Post reconciliation and same-source reports',async()=>{
  const ids=await seed({status:'DRAFT'}),snapshotId=randomUUID(),capturedAt=new Date().toISOString(),{privateKey,publicKey}=generateKeyPairSync('ed25519'),alternateKey=generateKeyPairSync('ed25519');
  const bankRows=[
    {bankTransactionId:'BANK-TXN-1',bank_account_ref:'BANK-1',transaction_date:'2026-07-15',currency:'USD',amount:'25.0000'},
    {bankTransactionId:'BANK-TXN-2',bank_account_ref:'BANK-1',transaction_date:'2026-07-16',currency:'USD',amount:'25.0000'}
  ];
  const view={name:'BGDATA.bank_transaction',company_key:ids.sourceEntityId,rows:bankRows,row_count:2,first_primary_key:'BANK-TXN-1',last_primary_key:'BANK-TXN-2',content_hash:canonicalRequestHash(bankRows)};
  const snapshot={schema_version:'WBS_READONLY_SNAPSHOT_V2',snapshot_id:snapshotId,captured_at:capturedAt,environment:'PRODUCTION',source_system:'WBS',dictionary_version:'WBS-DICT-TEST',views:[view],delivery:{mode:'SIGNED_SNAPSHOT_PACKAGE',extract_started_at:capturedAt,extract_completed_at:capturedAt,consistency:'COMPLETE',read_consistency:'SNAPSHOT_ISOLATION',pagination:'PRIMARY_KEY_SEEK'},detached_signature:{key_id:'wbs-bank-test',algorithm:'Ed25519',value:''}};
  const {detached_signature,...snapshotManifest}=snapshot;snapshot.package_hash=canonicalRequestHash(snapshotManifest);snapshot.detached_signature.value=sign(null,Buffer.from(snapshot.package_hash),privateKey).toString('base64');
  const publicKeys={'wbs-bank-test':publicKey.export({type:'spki',format:'pem'}),'wbs-bank-test-rotated':alternateKey.publicKey.export({type:'spki',format:'pem'})},snapshotVerifier=createWbsSnapshotSignatureVerifier({publicKeys}),manifestVerifier=createWbsManifestSignatureVerifier({publicKeys});
  const importer=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'signed-bank-importer',['WBS.SNAPSHOT.IMPORT','WBS.BANK.ADMIT']),wbsSnapshotVerifier:snapshotVerifier,wbsSignedBankAdmissionVerifier:value=>manifestVerifier({manifest_hash:value.admission_hash,detached_signature:value.detached_signature})});
  await importer.recordWbsSnapshot({tenantId:ids.tenantId,entityId:ids.entityId,snapshot,idempotencyKey:'signed-bank-snapshot-0001'});
  const receipts=(await adminPool.query("SELECT source_record_id,source_version,payload_hash,payload_ref FROM wbs_snapshot_receipt WHERE tenant_id=$1 AND entity_id=$2 AND source_module='BGDATA.bank_transaction' ORDER BY source_record_id",[ids.tenantId,ids.entityId])).rows;
  const makeAdmission=(statementChanges={},transactionChanges={},receipt=receipts[0],options={})=>{
    const keyId=options.keyId||'wbs-bank-test',signingKey=options.signingKey||privateKey;
    const admission={schema_version:'WBS_SIGNED_BANK_ADMISSION_V1',environment:'PRODUCTION',source_system:'WBS',admission_status:'ADMITTED',snapshot_id:snapshotId,package_hash:snapshot.package_hash,source_entity_id:ids.sourceEntityId,key_id:keyId,algorithm:'Ed25519',statement:{statement_id:'STMT-2026-07',bank_account_ref:'BANK-1',statement_start_date:'2026-07-01',statement_end_date:'2026-07-31',currency:'USD',opening_balance:'0.0000',ending_balance:'25.0000',payload_hash:hash('statement-2026-07'),payload_ref:'object://wbs-bank-statements/STMT-2026-07',...statementChanges},transactions:[{...receipt,external_bank_line_id:'EXT-1',transaction_date:'2026-07-15',currency:'USD',bank_account_ref:'BANK-1',amount:'25.0000',...transactionChanges}],detached_signature:{key_id:keyId,algorithm:'Ed25519',value:''}};
    const {detached_signature,...manifest}=admission;admission.admission_hash=canonicalRequestHash(manifest);admission.detached_signature.value=sign(null,Buffer.from(admission.admission_hash),signingKey).toString('base64');return admission;
  };
  const admission=makeAdmission(),journalsBefore=(await adminPool.query('SELECT count(*)::int n FROM journal_entry WHERE tenant_id=$1',[ids.tenantId])).rows[0].n;
  const denied=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'signed-bank-reader',['WBS.SNAPSHOT.IMPORT']),wbsSignedBankAdmissionVerifier:value=>manifestVerifier({manifest_hash:value.admission_hash,detached_signature:value.detached_signature})});
  await assert.rejects(denied.admitWbsSignedBankStatement({tenantId:ids.tenantId,entityId:ids.entityId,admission,idempotencyKey:'signed-bank-admission-denied'}),error=>error.code==='42501');
  const created=await importer.admitWbsSignedBankStatement({tenantId:ids.tenantId,entityId:ids.entityId,admission,idempotencyKey:'signed-bank-admission-0001'});
  assert.deepEqual({count:created.transaction_count,idempotent:created.idempotent},{count:1,idempotent:false});
  const replay=await importer.admitWbsSignedBankStatement({tenantId:ids.tenantId,entityId:ids.entityId,admission,idempotencyKey:'signed-bank-admission-0001'});
  assert.equal(replay.idempotent,true);assert.equal(replay.statement_receipt_id,created.statement_receipt_id);
  const changed=makeAdmission({ending_balance:'126.0000'});
  await assert.rejects(importer.admitWbsSignedBankStatement({tenantId:ids.tenantId,entityId:ids.entityId,admission:changed,idempotencyKey:'signed-bank-admission-0001'}),error=>error.code==='23505');
  const beforeKeyRotation=(await adminPool.query("SELECT (SELECT count(*)::int FROM wbs_bank_statement_receipt WHERE tenant_id=$1) statements,(SELECT count(*)::int FROM source_document WHERE tenant_id=$1 AND document_type='BANK_TRANSACTION') documents,(SELECT count(*)::int FROM bank_source WHERE tenant_id=$1) bank_sources,(SELECT count(*)::int FROM audit_event WHERE tenant_id=$1 AND event_type='WBS_BANK_STATEMENT_ADMITTED') audits,(SELECT count(*)::int FROM outbox_event WHERE tenant_id=$1 AND event_type='WBS_BANK_STATEMENT_ADMITTED') outbox",[ids.tenantId])).rows[0];
  const reSignedKeyRotation=makeAdmission({}, {}, receipts[0], {keyId:'wbs-bank-test-rotated',signingKey:alternateKey.privateKey});
  await assert.rejects(importer.admitWbsSignedBankStatement({tenantId:ids.tenantId,entityId:ids.entityId,admission:reSignedKeyRotation,idempotencyKey:'signed-bank-admission-0001'}),error=>error.code==='23505');
  assert.deepEqual((await adminPool.query("SELECT (SELECT count(*)::int FROM wbs_bank_statement_receipt WHERE tenant_id=$1) statements,(SELECT count(*)::int FROM source_document WHERE tenant_id=$1 AND document_type='BANK_TRANSACTION') documents,(SELECT count(*)::int FROM bank_source WHERE tenant_id=$1) bank_sources,(SELECT count(*)::int FROM audit_event WHERE tenant_id=$1 AND event_type='WBS_BANK_STATEMENT_ADMITTED') audits,(SELECT count(*)::int FROM outbox_event WHERE tenant_id=$1 AND event_type='WBS_BANK_STATEMENT_ADMITTED') outbox",[ids.tenantId])).rows[0],beforeKeyRotation);
  const tampered=makeAdmission({statement_id:'STMT-2026-07-BAD'},{payload_hash:hash('not-the-receipt')});
  await assert.rejects(importer.admitWbsSignedBankStatement({tenantId:ids.tenantId,entityId:ids.entityId,admission:tampered,idempotencyKey:'signed-bank-admission-0002'}),error=>error.code==='23514');
  const counts=(await adminPool.query("SELECT (SELECT count(*)::int FROM wbs_bank_statement_receipt WHERE tenant_id=$1) statements,(SELECT count(*)::int FROM source_document WHERE tenant_id=$1 AND document_type='BANK_TRANSACTION') documents,(SELECT count(*)::int FROM bank_source WHERE tenant_id=$1) bank_sources,(SELECT count(*)::int FROM audit_event WHERE tenant_id=$1 AND event_type='WBS_BANK_STATEMENT_ADMITTED') audits,(SELECT count(*)::int FROM outbox_event WHERE tenant_id=$1 AND event_type='WBS_BANK_STATEMENT_ADMITTED') outbox",[ids.tenantId])).rows[0];
  assert.deepEqual(counts,{statements:1,documents:1,bank_sources:1,audits:1,outbox:1});
  assert.equal((await adminPool.query('SELECT count(*)::int n FROM journal_entry WHERE tenant_id=$1',[ids.tenantId])).rows[0].n,journalsBefore);
  await assert.rejects(adminPool.query('UPDATE wbs_bank_statement_receipt SET ending_balance=999 WHERE tenant_id=$1',[ids.tenantId]),error=>error.code==='55000');

  const admittedSource=(await adminPool.query('SELECT bank_source_id,source_document_id FROM wbs_bank_statement_transaction WHERE tenant_id=$1 AND entity_id=$2 AND wbs_bank_statement_receipt_id=$3',[ids.tenantId,ids.entityId,created.statement_receipt_id])).rows[0];
  // Prove that the exact provider-created bank_source can enter the ordinary
  // payment matching boundary without a hand-written bank_source/bank_match.
  // The receipt is deliberately unmatched again before the adjustment path so
  // both command histories are retained while the reconciliation remains open.
  await adminPool.query("INSERT INTO member_master(tenant_id,entity_id,member_ref,member_type,display_name) VALUES($1,$2,'CUSTOMER-SIGNED-BANK','CUSTOMER','Signed bank customer')",[ids.tenantId,ids.entityId]);
  const augustPeriodId=randomUUID();
  await adminPool.query("INSERT INTO accounting_period(period_id,tenant_id,entity_id,period_code,starts_on,ends_on,status) VALUES($1,$2,$3,'2026-08','2026-08-01','2026-08-31','OPEN')",[augustPeriodId,ids.tenantId,ids.entityId]);
  const invoiceId=randomUUID();
  await adminPool.query(`INSERT INTO business_document(business_document_id,tenant_id,entity_id,document_kind,document_number,counterparty_ref,counterparty_name,currency,accounting_date,due_date,gross_amount,open_balance,status,created_by)
    VALUES($1,$2,$3,'AR_INVOICE','INV-SIGNED-BANK-25','CUSTOMER-SIGNED-BANK','Signed bank customer','USD','2026-07-15','2026-08-15',25,25,'OPEN','fixture')`,[invoiceId,ids.tenantId,ids.entityId]);
  const receiptMaker=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'wbs-statement-receipt-maker',['AR.RECEIPT.CREATE','GL.JE.SUBMIT'])});
  const receiptJeReviewer=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'wbs-statement-receipt-je-reviewer',['GL.JE.REVIEW'])});
  const receiptJeApprover=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'wbs-statement-receipt-je-approver',['GL.JE.APPROVE'])});
  const receiptJePoster=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'wbs-statement-receipt-je-poster',['GL.JE.POST'])});
  const receipt=await receiptMaker.createArReceipt({...ids,periodId:augustPeriodId,businessDocumentId:invoiceId,receiptNumber:'RCPT-SIGNED-BANK-25',receiptDate:'2026-08-01',cashAccountCode:'111000',bankMemberRef:'BANK-1',amount:25,reason:'Exact signed bank receipt candidate within the allowed match window',idempotencyKey:'wbs-statement-receipt-create-001'});
  await attachAutoSource({...ids,journalId:receipt.journal_entry_id},{reuseApprovedSnapshots:true});
  await receiptMaker.transitionJournal({...ids,journalEntryId:receipt.journal_entry_id,action:'SUBMIT',expectedRevision:0,idempotencyKey:'wbs-statement-receipt-submit-001'});
  await receiptJeReviewer.transitionJournal({...ids,journalEntryId:receipt.journal_entry_id,action:'REVIEW',expectedRevision:1,idempotencyKey:'wbs-statement-receipt-review-001'});
  await receiptJeApprover.transitionJournal({...ids,journalEntryId:receipt.journal_entry_id,action:'APPROVE',expectedRevision:2,idempotencyKey:'wbs-statement-receipt-approve-001'});
  await receiptJePoster.postJournal({...ids,journalEntryId:receipt.journal_entry_id,periodId:augustPeriodId,expectedRevision:3,idempotencyKey:'wbs-statement-receipt-post-001'});
  const statementMatcher=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'wbs-statement-match-maker',['BANK.MATCH.CREATE'])});
  const statementUnmatcher=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'wbs-statement-match-controller',['BANK.MATCH.UNMATCH'])});
  const candidates=await statementMatcher.listBankMatchCandidates({...ids,bankSourceId:admittedSource.bank_source_id});
  assert.equal(candidates.length,1);assert.equal(candidates[0].payment_occurrence_id,receipt.payment_occurrence_id);assert.equal(candidates[0].journal_entry_id,receipt.journal_entry_id);
  const statementMatch=await statementMatcher.createBankPaymentMatch({...ids,bankSourceId:admittedSource.bank_source_id,paymentOccurrenceId:receipt.payment_occurrence_id,expectedBankVersion:0,expectedOccurrenceVersion:1,reason:'Exact provider-signed bank source matched to posted AR receipt',idempotencyKey:'wbs-statement-bank-match-001'});
  assert.equal(statementMatch.status,'ACTIVE');assert.equal(statementMatch.idempotent,false);
  const matchEvidence=(await adminPool.query('SELECT payment_occurrence_id,journal_entry_id,journal_line_id,ledger_line_id,status,matched_by FROM bank_match WHERE bank_match_id=$1',[statementMatch.bank_match_id])).rows[0];
  assert.equal(matchEvidence.payment_occurrence_id,receipt.payment_occurrence_id);assert.equal(matchEvidence.journal_entry_id,receipt.journal_entry_id);assert.ok(matchEvidence.journal_line_id);assert.ok(matchEvidence.ledger_line_id);assert.equal(matchEvidence.status,'ACTIVE');assert.equal(matchEvidence.matched_by,'wbs-statement-match-maker');
  const unmatched=await statementUnmatcher.unmatchBankPayment({...ids,bankSourceId:admittedSource.bank_source_id,bankMatchId:statementMatch.bank_match_id,expectedMatchVersion:0,reason:'Independent controller returns the exact signed source to adjustment review',idempotencyKey:'wbs-statement-bank-unmatch-001'});
  assert.equal(unmatched.status,'UNMATCHED');assert.equal(unmatched.revision,1);
  const crossReceiptAdmission=makeAdmission({statement_id:'STMT-2026-07-OTHER',opening_balance:'0.0000',ending_balance:'25.0000',payload_hash:hash('statement-2026-07-other'),payload_ref:'object://wbs-bank-statements/STMT-2026-07-OTHER'},{external_bank_line_id:'EXT-2',transaction_date:'2026-07-16',amount:'25.0000'},receipts[1]);
  const crossReceipt=await importer.admitWbsSignedBankStatement({tenantId:ids.tenantId,entityId:ids.entityId,admission:crossReceiptAdmission,idempotencyKey:'signed-bank-admission-0003'});
  const unrelatedBankSourceId=(await adminPool.query('SELECT bank_source_id FROM wbs_bank_statement_transaction WHERE tenant_id=$1 AND entity_id=$2 AND wbs_bank_statement_receipt_id=$3',[ids.tenantId,ids.entityId,crossReceipt.statement_receipt_id])).rows[0].bank_source_id;
  await assert.rejects(importer.startReconciliationFromAdmittedWbsStatement({...ids,statementReceiptId:created.statement_receipt_id,reason:'Importer cannot start the statement review',idempotencyKey:'wbs-statement-recon-denied-001'}),error=>error.code==='42501');
  const starter=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'wbs-statement-recon-starter',['BANK.RECONCILIATION.START'])});
  const bankOnlyReader=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'wbs-statement-bank-only-reader',['BANK.VIEW'])});
  await assert.rejects(starter.listAdmittedWbsBankStatementReceipts({...ids,bankAccountRef:'BANK-1',limit:10}),error=>error.code==='42501');
  await assert.rejects(bankOnlyReader.listAdmittedWbsBankStatementReceipts({...ids,bankAccountRef:'BANK-1',limit:10}),error=>error.code==='42501');
  const receiptReader=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'wbs-statement-selection-reader',['BANK.VIEW','BANK.RECONCILIATION.START'])});
  const availableReceipts=await receiptReader.listAdmittedWbsBankStatementReceipts({...ids,bankAccountRef:'BANK-1',limit:10});
  assert.equal(availableReceipts.length,2);assert(availableReceipts.every(row=>row.selection_state==='AVAILABLE_FOR_SERVER_VALIDATION'));
  const safeFields=['wbs_bank_statement_receipt_id','bank_account_ref','statement_start_date','statement_end_date','currency','opening_balance','ending_balance','transaction_count','statement_activity_amount','admission_hash','signature_verified','admission_status','admitted_at','reconciliation_id','reconciliation_status','reconciliation_version','selection_state'];
  assert.deepEqual(Object.keys(availableReceipts[0]),safeFields);assert.equal(availableReceipts[0].signature_verified,true);assert.equal(availableReceipts[0].admission_status,'ADMITTED');
  assert(availableReceipts.every(row=>/^\d{4}-\d{2}-\d{2}$/.test(row.statement_start_date)&&/^\d{4}-\d{2}-\d{2}$/.test(row.statement_end_date)));
  assert.deepEqual(await receiptReader.getAdmittedWbsBankStatementReceipt({...ids,statementReceiptId:randomUUID()}),[]);
  const startArgs={...ids,statementReceiptId:created.statement_receipt_id,reason:'Start review from the exact signed WBS statement',idempotencyKey:'wbs-statement-recon-start-001'};
  const started=await starter.startReconciliationFromAdmittedWbsStatement(startArgs),startReplay=await starter.startReconciliationFromAdmittedWbsStatement(startArgs);
  assert.deepEqual({receipt:started.wbs_bank_statement_receipt_id,account:started.bank_account_ref,start:started.statement_start_date,end:started.statement_ending_date,opening:Number(started.statement_opening_balance),ending:Number(started.statement_ending_balance),currency:started.currency,status:started.status,replay:startReplay.idempotent},{receipt:created.statement_receipt_id,account:'BANK-1',start:'2026-07-01',end:'2026-07-31',opening:0,ending:25,currency:'USD',status:'DRAFT',replay:true});
  await assert.rejects(starter.startReconciliationFromAdmittedWbsStatement({...startArgs,reason:'A different canonical reconciliation review reason'}),error=>error.code==='23505');
  await assert.rejects(starter.startReconciliationFromAdmittedWbsStatement({...startArgs,idempotencyKey:'wbs-statement-recon-start-002'}),error=>error.code==='23505');
  const storedReconciliation=(await adminPool.query('SELECT wbs_bank_statement_receipt_id,bank_account_ref,statement_ending_date::text,statement_opening_balance::text,statement_ending_balance::text,currency,status::text FROM reconciliation WHERE reconciliation_id=$1',[started.reconciliation_id])).rows[0];
  assert.deepEqual(storedReconciliation,{wbs_bank_statement_receipt_id:created.statement_receipt_id,bank_account_ref:'BANK-1',statement_ending_date:'2026-07-31',statement_opening_balance:'0.0000',statement_ending_balance:'25.0000',currency:'USD',status:'DRAFT'});
  const startedReceipts=await receiptReader.listAdmittedWbsBankStatementReceipts({...ids,bankAccountRef:'BANK-1',limit:10});
  assert.equal(startedReceipts.find(row=>row.wbs_bank_statement_receipt_id===created.statement_receipt_id).selection_state,'ALREADY_STARTED');
  assert.equal(startedReceipts.find(row=>row.wbs_bank_statement_receipt_id===crossReceipt.statement_receipt_id).selection_state,'BLOCKED_OPEN_RECONCILIATION');
  const selectedReceipt=await receiptReader.getAdmittedWbsBankStatementReceipt({...ids,statementReceiptId:created.statement_receipt_id});assert.equal(selectedReceipt.length,1);assert.equal(selectedReceipt[0].reconciliation_id,started.reconciliation_id);assert.deepEqual({start:selectedReceipt[0].statement_start_date,end:selectedReceipt[0].statement_end_date},{start:'2026-07-01',end:'2026-07-31'});
  const reader=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'wbs-statement-recon-reader',['BANK.VIEW'])});
  const exactSummary=await reader.getReconciliationSummary({...ids,bankAccountRef:'BANK-1',statementEndingDate:'2026-07-31'});
  assert.equal(exactSummary.length,1);assert.equal(Number(exactSummary[0].bank_transaction_count),1);assert.equal(Number(exactSummary[0].statement_activity_amount),25);
  const worksheet=await reader.listReconciliationWorksheet({...ids,reconciliationId:started.reconciliation_id});
  assert.equal(worksheet.length,1);assert.equal(worksheet[0].bank_source_id,admittedSource.bank_source_id);assert.equal(Number(worksheet[0].amount),25);
  await assert.rejects(adminPool.query('INSERT INTO reconciliation_item(tenant_id,entity_id,reconciliation_id,bank_source_id,state,cleared_by,reason) VALUES($1,$2,$3,$4,\'CLEARED\',\'fixture\',\'Unrelated row must not enter receipt worksheet\')',[ids.tenantId,ids.entityId,started.reconciliation_id,unrelatedBankSourceId]),error=>error.code==='23514');
  await assert.rejects(adminPool.query('UPDATE reconciliation SET wbs_bank_statement_receipt_id=NULL WHERE reconciliation_id=$1',[started.reconciliation_id]),error=>error.code==='55000');
  const actionCounts=(await adminPool.query("SELECT (SELECT count(*)::int FROM bank_match WHERE tenant_id=$1) matches,(SELECT count(*)::int FROM reconciliation_item WHERE tenant_id=$1) items,(SELECT count(*)::int FROM reconciliation WHERE tenant_id=$1 AND status<>'DRAFT') progressed",[ids.tenantId])).rows[0];
  assert.deepEqual(actionCounts,{matches:1,items:0,progressed:0});

  const attachmentId=(await adminPool.query("SELECT attachment_id FROM source_link WHERE tenant_id=$1 AND entity_id=$2 AND journal_entry_id=$3 AND attachment_id IS NOT NULL",[ids.tenantId,ids.entityId,ids.journalId])).rows[0].attachment_id;
  const rejectedMakerSession=await trustedSession(ids,'wbs-statement-cross-receipt-maker',['BANK.RECONCILIATION.ADJUSTMENT_DRAFT','GL.JE.CREATE']);
  const rejectedMaker=new PostgresAccountingKernel(runtimePool,{sessionProvider:async()=>rejectedMakerSession});
  const maker=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'wbs-statement-adjustment-maker',['BANK.RECONCILIATION.ADJUSTMENT_DRAFT','GL.JE.CREATE','GL.JE.SUBMIT'])});
  const adjustmentArgs=(bankSourceId,journalNumber,idempotencyKey)=>({...ids,reconciliationId:started.reconciliation_id,bankSourceId,expectedReconciliationVersion:0,periodId:ids.periodId,journalNumber,journalDate:'2026-07-16',currency:'USD',description:'Record exact admitted statement adjustment',lines:[
    {line_no:1,account_code:'111000',debit_amount:'25.0000',credit_amount:'0.0000',member_ref:'BANK-1',description:'Signed statement movement',dimensions:{}},
    {line_no:2,account_code:'291001',debit_amount:'0.0000',credit_amount:'25.0000',member_ref:'VENDOR-1',description:'Supported statement offset',dimensions:{}}
  ],attachmentIds:[attachmentId],reason:'Independent evidence for exact admitted statement adjustment',idempotencyKey});
  const adjustmentWriteCounts=async()=>{
    const {rows:[row]}=await adminPool.query("SELECT (SELECT count(*)::int FROM journal_entry WHERE tenant_id=$1) journal_entries,(SELECT count(*)::int FROM journal_line WHERE tenant_id=$1) journal_lines,(SELECT count(*)::int FROM source_link WHERE tenant_id=$1) source_links,(SELECT count(*)::int FROM reconciliation_adjustment_draft WHERE tenant_id=$1) adjustment_drafts,(SELECT count(*)::int FROM audit_event WHERE tenant_id=$1) audits,(SELECT count(*)::int FROM outbox_event WHERE tenant_id=$1) outbox",[ids.tenantId]);
    return row;
  };
  const beforeRejectedAdjustment=await adjustmentWriteCounts();
  await assert.rejects(rejectedMaker.createReconciliationAdjustmentDraft(adjustmentArgs(unrelatedBankSourceId,'JE-WBS-CROSS-RECEIPT','wbs-statement-cross-receipt-adjustment-001')),error=>error.code==='23514'&&/(admitted WBS statement receipt|tied reconciliation)/i.test(error.message));
  assert.deepEqual(await adjustmentWriteCounts(),beforeRejectedAdjustment);

  const adjustment=await maker.createReconciliationAdjustmentDraft(adjustmentArgs(admittedSource.bank_source_id,'JE-WBS-RECEIPT-ADJUSTMENT','wbs-statement-receipt-adjustment-001'));
  assert.equal(adjustment.journal_status,'DRAFT');assert.equal(adjustment.reconciliation_revision,1);
  await maker.transitionJournal({...ids,journalEntryId:adjustment.journal_entry_id,action:'SUBMIT',expectedRevision:0,idempotencyKey:'wbs-statement-adjustment-submit-001'});
  const reviewer=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'wbs-statement-adjustment-reviewer',['GL.JE.REVIEW','BANK.RECONCILIATION.REVIEW'])});
  await reviewer.transitionJournal({...ids,journalEntryId:adjustment.journal_entry_id,action:'REVIEW',expectedRevision:1,idempotencyKey:'wbs-statement-adjustment-je-review-001'});
  const approver=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'wbs-statement-adjustment-approver',['GL.JE.APPROVE'])});
  await approver.transitionJournal({...ids,journalEntryId:adjustment.journal_entry_id,action:'APPROVE',expectedRevision:2,idempotencyKey:'wbs-statement-adjustment-approve-001'});
  const poster=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'wbs-statement-adjustment-poster',['GL.JE.POST'])});
  await poster.postJournal({...ids,journalEntryId:adjustment.journal_entry_id,periodId:ids.periodId,expectedRevision:3,idempotencyKey:'wbs-statement-adjustment-post-001'});
  const sourceLineage=(await adminPool.query("SELECT source_document_id,bank_source_id,reconciliation_id,journal_entry_id FROM source_link WHERE tenant_id=$1 AND entity_id=$2 AND link_type='RECONCILIATION_ADJUSTMENT_SOURCE_DOCUMENT' AND journal_entry_id=$3",[ids.tenantId,ids.entityId,adjustment.journal_entry_id])).rows;
  assert.deepEqual(sourceLineage,[{source_document_id:admittedSource.source_document_id,bank_source_id:admittedSource.bank_source_id,reconciliation_id:started.reconciliation_id,journal_entry_id:adjustment.journal_entry_id}]);
  const reportReader=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'wbs-statement-adjustment-report-reader',['GL.JE.VIEW','GL.REPORT.VIEW'])});
  const adjustmentDetail=await reportReader.getJournalEntryDetail({...ids,journalEntryId:adjustment.journal_entry_id});
  assert.equal(adjustmentDetail.lines.length,2);assert(adjustmentDetail.lines.every(line=>line.source_document_ids.includes(admittedSource.source_document_id)));
  const adjustmentLedger=await reportReader.listGeneralLedger({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId,accountCode:'111000',query:'JE-WBS-RECEIPT-ADJUSTMENT',limit:10,offset:0});
  const adjustmentCash=adjustmentLedger.find(row=>row.journal_entry_id===adjustment.journal_entry_id);
  assert.ok(adjustmentCash);assert.ok(adjustmentCash.source_document_ids.includes(admittedSource.source_document_id));
  const adjustmentStatements=await reportReader.getFinancialStatements({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId});
  for(const statementType of ['TRIAL_BALANCE','BALANCE_SHEET','CASH_FLOW']){
    const row=adjustmentStatements.find(candidate=>candidate.statement_type===statementType&&candidate.account_code==='111000');
    assert.ok(row,`${statementType} must expose the admitted WBS statement adjustment`);
    assert.ok(row.journal_entry_ids.includes(adjustment.journal_entry_id));assert.ok(row.source_document_ids.includes(admittedSource.source_document_id));
  }
  const clearer=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'wbs-statement-adjustment-clearer',['BANK.RECONCILIATION.CLEAR'])});
  const cleared=await clearer.setReconciliationAdjustmentClearance({...ids,reconciliationId:started.reconciliation_id,bankSourceId:admittedSource.bank_source_id,expectedReconciliationVersion:1,expectedBankVersion:0,clear:true,reason:'Clear only the exact signed statement receipt row',idempotencyKey:'wbs-statement-adjustment-clear-001'});
  assert.equal(cleared.revision,2);assert.equal(Number(cleared.difference),0);
  const rotatedStarterReviewer=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'wbs-statement-recon-starter',['BANK.RECONCILIATION.REVIEW'])});
  await assert.rejects(rotatedStarterReviewer.transitionReconciliation({...ids,reconciliationId:started.reconciliation_id,action:'REVIEW',expectedVersion:2,reason:'A rotated starter identity must remain separated from review',idempotencyKey:'wbs-statement-starter-review-sod-001'}),error=>error.code==='42501'&&/independent from prior maker/i.test(error.message));
  const reviewed=await reviewer.transitionReconciliation({...ids,reconciliationId:started.reconciliation_id,action:'REVIEW',expectedVersion:2,reason:'Review exact receipt evidence despite unrelated same-date row',idempotencyKey:'wbs-statement-adjustment-review-001'});
  assert.equal(reviewed.status,'IN_REVIEW');
  const rotatedClearerSigner=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'wbs-statement-adjustment-clearer',['BANK.RECONCILIATION.SIGN_OFF'])});
  await assert.rejects(rotatedClearerSigner.transitionReconciliation({...ids,reconciliationId:started.reconciliation_id,action:'SIGN_OFF',expectedVersion:3,reason:'A rotated clearance identity must remain separated from sign off',idempotencyKey:'wbs-statement-clearer-signoff-sod-001'}),error=>error.code==='42501'&&/independent from prior maker/i.test(error.message));
  const signer=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'wbs-statement-adjustment-signer',['BANK.RECONCILIATION.SIGN_OFF'])});
  const signed=await signer.transitionReconciliation({...ids,reconciliationId:started.reconciliation_id,action:'SIGN_OFF',expectedVersion:3,reason:'Sign off only the exact admitted statement receipt evidence',idempotencyKey:'wbs-statement-adjustment-signoff-001'});
  assert.equal(signed.status,'RECONCILED');assert.ok(signed.snapshot_id);
  const rotatedMatcherReopener=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'wbs-statement-match-maker',['BANK.RECONCILIATION.REOPEN'])});
  await assert.rejects(rotatedMatcherReopener.transitionReconciliation({...ids,reconciliationId:started.reconciliation_id,action:'REOPEN',expectedVersion:4,reason:'A rotated match identity must remain separated from reopen',idempotencyKey:'wbs-statement-matcher-reopen-sod-001'}),error=>error.code==='42501'&&/independent from prior maker/i.test(error.message));
  const independentReopener=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'wbs-statement-independent-reopener',['BANK.RECONCILIATION.REOPEN'])});
  const reopened=await independentReopener.transitionReconciliation({...ids,reconciliationId:started.reconciliation_id,action:'REOPEN',expectedVersion:4,reason:'Independent controller reopens the latest signed statement',idempotencyKey:'wbs-statement-independent-reopen-001'});
  assert.equal(reopened.status,'REOPENED');
  const retainedMatch=(await adminPool.query('SELECT status,version::int AS revision,matched_by,unmatched_by,bank_source_id,payment_occurrence_id,journal_entry_id,ledger_line_id FROM bank_match WHERE bank_match_id=$1',[statementMatch.bank_match_id])).rows[0];
  assert.deepEqual({status:retainedMatch.status,revision:retainedMatch.revision,matchedBy:retainedMatch.matched_by,unmatchedBy:retainedMatch.unmatched_by,bankSource:retainedMatch.bank_source_id,payment:retainedMatch.payment_occurrence_id,journal:retainedMatch.journal_entry_id,hasLedger:Boolean(retainedMatch.ledger_line_id)},{status:'UNMATCHED',revision:1,matchedBy:'wbs-statement-match-maker',unmatchedBy:'wbs-statement-match-controller',bankSource:admittedSource.bank_source_id,payment:receipt.payment_occurrence_id,journal:receipt.journal_entry_id,hasLedger:true});
  await assert.rejects(
    adminPool.query("UPDATE reconciliation SET status='IN_REVIEW',reviewed_by='maintenance',reviewed_at=clock_timestamp(),review_reason='Maintenance cannot bypass a signed receipt actor boundary' WHERE tenant_id=$1 AND entity_id=$2 AND reconciliation_id=$3",[ids.tenantId,ids.entityId,started.reconciliation_id]),
    error=>error.code==='42501'&&/Authenticated actor missing/i.test(error.message)
  );
  const legacyReconciliationId=randomUUID();
  await adminPool.query(`INSERT INTO reconciliation(reconciliation_id,tenant_id,entity_id,bank_account_ref,statement_ending_date,statement_opening_balance,statement_ending_balance,book_ending_balance,currency,difference,status)
    VALUES($1,$2,$3,'LEGACY-MAINTENANCE-COMPATIBILITY','2026-07-30',0,0,0,'USD',0,'DRAFT')`,[legacyReconciliationId,ids.tenantId,ids.entityId]);
  const legacyMaintenance=await adminPool.query("UPDATE reconciliation SET status='IN_REVIEW',reviewed_by='maintenance',reviewed_at=clock_timestamp(),review_reason='Legacy non-receipt maintenance compatibility' WHERE tenant_id=$1 AND entity_id=$2 AND reconciliation_id=$3 RETURNING status",[ids.tenantId,ids.entityId,legacyReconciliationId]);
  assert.equal(legacyMaintenance.rows[0].status,'IN_REVIEW');
  await adminPool.query('DELETE FROM reconciliation WHERE reconciliation_id=$1',[legacyReconciliationId]);
  assert.equal((await adminPool.query('SELECT count(*)::int n FROM reconciliation_item WHERE reconciliation_id=$1 AND bank_source_id=$2 AND state=\'CLEARED\'',[started.reconciliation_id,admittedSource.bank_source_id])).rows[0].n,1);
  assert.equal((await adminPool.query("SELECT count(*)::int n FROM audit_event WHERE tenant_id=$1 AND object_id=$2 AND event_type='RECONCILIATION_STARTED' AND permission_used='BANK.RECONCILIATION.START' AND metadata->>'wbs_bank_statement_receipt_id'=$3",[ids.tenantId,started.reconciliation_id,created.statement_receipt_id])).rows[0].n,1);
});

pgTest('signed WBS transition-contract verification is view-scoped and produces no accounting write',async()=>{
  const ids=await seed({status:'DRAFT'}),{privateKey,publicKey}=generateKeyPairSync('ed25519');
  const unsigned={schema_version:'WBS_AUTOREC_TRANSITION_CONTRACT_V1',source_system:'WBS',environment:'PRODUCTION',contract_id:randomUUID(),issued_at:'2026-08-11T00:00:00Z',valid_from:'2026-08-11T00:00:00Z',valid_until:'2027-08-11T00:00:00Z',scope:{company_keys:[ids.sourceEntityId],dictionary_version:'WBS-DICT-2026-08'},transitions:[{transition_id:'CANCEL_RELEASE_V1',operation:'CANCEL_RELEASE',from_state:'RELEASED',to_state:'NOT_MATCHED',requires_reason:true,required_actor_roles:['AUTOREC_CONTROLLER'],segregation_of_duties:{review_required:true,requester_reviewer_must_differ:true,forbidden_prior_actor_roles:['INCURRENCE_APPROVER']},accounting_guard:{blocks_when_accounting_reviewed:true,blocks_when_accounting_approved:true,blocks_when_accounting_posted:true}}]};
  const contractHash=canonicalRequestHash(unsigned),contract={...unsigned,contract_hash:contractHash,detached_signature:{key_id:'wbs-transition-pg-test',algorithm:'Ed25519',value:sign(null,Buffer.from(contractHash),privateKey).toString('base64')}};
  const verifier=createWbsAutoRecTransitionContractVerifier({publicKeys:{'wbs-transition-pg-test':publicKey.export({type:'spki',format:'pem'})}});
  const readerSession=await trustedSession(ids,'transition-contract-reader',['WBS.AUTOREC.VIEW']);
  const before=(await adminPool.query('SELECT count(*)::int n FROM audit_event WHERE tenant_id=$1',[ids.tenantId])).rows[0].n;
  const reader=new PostgresAccountingKernel(runtimePool,{sessionProvider:async()=>readerSession,wbsAutoRecTransitionContractVerifier:verifier});
  const verified=await reader.verifyWbsAutoRecTransitionContract({tenantId:ids.tenantId,entityId:ids.entityId,contract});
  assert.deepEqual({verified:verified.signature_verified,refsAction:verified.can_transition_refs,post:verified.can_post},{verified:true,refsAction:false,post:false});
  const denied=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'transition-contract-denied',[]),wbsAutoRecTransitionContractVerifier:verifier});
  await assert.rejects(denied.verifyWbsAutoRecTransitionContract({tenantId:ids.tenantId,entityId:ids.entityId,contract}),error=>error.code==='42501');
  const after=(await adminPool.query('SELECT count(*)::int n FROM audit_event WHERE tenant_id=$1',[ids.tenantId])).rows[0].n;
  assert.equal(after,before);
});

pgTest('WBS multi-receipt inbound snapshot persists atomically and replays without a journal command',async()=>{
  const ids=await seed({status:'DRAFT'}),snapshotId=randomUUID(),rowId=randomUUID(),capturedAt=new Date().toISOString();
  const snapshot={schema_version:'WBS_READONLY_SNAPSHOT_V1',snapshot_id:snapshotId,captured_at:capturedAt,environment:'SANDBOX',source_system:'WBS',dictionary_version:'WBS-DICT-TEST',views:[{name:'BGDATA.payable',company_key:ids.sourceEntityId,rows:[{apGuId:rowId,ap_type:'AUTOC'}]}]};
  snapshot.views=snapshot.views.map(view=>({...view,content_hash:canonicalRequestHash(view.rows)}));snapshot.package_hash=canonicalRequestHash(snapshot);
  const kernel=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'snapshot-importer',['WBS.SNAPSHOT.IMPORT'])});
  const observed=await kernel.recordWbsSnapshot({tenantId:ids.tenantId,entityId:ids.entityId,snapshot,idempotencyKey:'snapshot-multi-inbound-0001'});
  const group=(recordId,receiptHash)=>({receipt:{payload_hash:receiptHash,payload_ref:`object://wbs-snapshot/${snapshotId}/inbound/${recordId}`},rows:[{source_record_id:recordId,source_version:`snapshot:${snapshotId}:${recordId}`,raw:{record_id:recordId},normalized:{source_type:'PAYABLE',source_record_id:recordId,source_version:`snapshot:${snapshotId}:${recordId}`,receipt_hash:receiptHash,receipt_ref:`object://wbs-snapshot/${snapshotId}/inbound/${recordId}`},outcome:{stage:'STAGING_REVIEW_REQUIRED'},outcome_kind:'STAGING'}]});
  const groups=[group('PAY-1',hash('multi-receipt-1')),group('BANK-1',hash('multi-receipt-2'))],idempotencyKey='wbs-multi-receipt-0001',requestHash=canonicalRequestHash({tenant_id:ids.tenantId,entity_id:ids.entityId,import_batch_id:observed.import_batch_id,groups,idempotency_key:idempotencyKey});
  const created=await kernel.persistWbsInboundSnapshotRows({tenantId:ids.tenantId,entityId:ids.entityId,importBatchId:observed.import_batch_id,groups,idempotencyKey,requestHash});
  assert.deepEqual({groups:created.receipt_group_count,rows:created.row_count,draft:created.can_create_draft,post:created.can_post},{groups:2,rows:2,draft:false,post:false});assert.equal(created.groups.length,2);assert(created.groups.every(item=>item.receipt_id&&item.row_count===1));
  const replay=await kernel.persistWbsInboundSnapshotRows({tenantId:ids.tenantId,entityId:ids.entityId,importBatchId:observed.import_batch_id,groups,idempotencyKey,requestHash});assert.equal(replay.idempotent,true);
  await assert.rejects(kernel.persistWbsInboundSnapshotRows({tenantId:ids.tenantId,entityId:ids.entityId,importBatchId:observed.import_batch_id,groups,idempotencyKey,requestHash:hash('changed-multi-request')}),error=>error.code==='23505');
  const duplicate=[group('DUP-1',hash('multi-duplicate-1')),group('DUP-1',hash('multi-duplicate-2'))],duplicateHash=canonicalRequestHash({tenant_id:ids.tenantId,entity_id:ids.entityId,import_batch_id:observed.import_batch_id,groups:duplicate,idempotency_key:'wbs-multi-receipt-0002'});
  await assert.rejects(kernel.persistWbsInboundSnapshotRows({tenantId:ids.tenantId,entityId:ids.entityId,importBatchId:observed.import_batch_id,groups:duplicate,idempotencyKey:'wbs-multi-receipt-0002',requestHash:duplicateHash}),error=>error.code==='22023');
  const counts=await adminPool.query('SELECT (SELECT count(*)::int FROM wbs_inbound_receipt WHERE tenant_id=$1 AND entity_id=$2) AS receipts,(SELECT count(*)::int FROM wbs_inbound_row WHERE tenant_id=$1 AND entity_id=$2) AS rows',[ids.tenantId,ids.entityId]);assert.deepEqual(counts.rows[0],{receipts:2,rows:2});
});

pgTest('WBS single-receipt inbound persistence retains request-correlated audit evidence and never creates a journal',async()=>{
  const ids=await seed({status:'DRAFT'}),snapshotId=randomUUID(),rowId=randomUUID(),capturedAt=new Date().toISOString();
  const journalsBefore=(await adminPool.query('SELECT count(*)::int n FROM journal_entry WHERE tenant_id=$1',[ids.tenantId])).rows[0].n;
  const snapshot={schema_version:'WBS_READONLY_SNAPSHOT_V1',snapshot_id:snapshotId,captured_at:capturedAt,environment:'SANDBOX',source_system:'WBS',dictionary_version:'WBS-DICT-TEST',views:[{name:'BGDATA.payable',company_key:ids.sourceEntityId,rows:[{apGuId:rowId,ap_type:'AUTOC'}]}]};
  snapshot.views=snapshot.views.map(view=>({...view,content_hash:canonicalRequestHash(view.rows)}));snapshot.package_hash=canonicalRequestHash(snapshot);
  const kernel=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'single-inbound-importer',['WBS.SNAPSHOT.IMPORT'])});
  const observed=await kernel.recordWbsSnapshot({tenantId:ids.tenantId,entityId:ids.entityId,snapshot,idempotencyKey:'snapshot-single-inbound-0001'});
  const receipt={payload_hash:hash('single-receipt'),payload_ref:`object://wbs-snapshot/${snapshotId}/inbound/PAY-SINGLE`};
  const rows=[{source_record_id:'PAY-SINGLE',source_version:`snapshot:${snapshotId}:PAY-SINGLE`,raw:{record_id:'PAY-SINGLE'},normalized:{source_type:'PAYABLE',source_record_id:'PAY-SINGLE',source_version:`snapshot:${snapshotId}:PAY-SINGLE`,receipt_hash:receipt.payload_hash,receipt_ref:receipt.payload_ref},outcome:{stage:'STAGING_REVIEW_REQUIRED'},outcome_kind:'STAGING'}];
  const idempotencyKey='wbs-single-receipt-0001',requestHash=canonicalRequestHash({tenant_id:ids.tenantId,entity_id:ids.entityId,import_batch_id:observed.import_batch_id,receipt,rows,idempotency_key:idempotencyKey});
  const created=await kernel.persistWbsInboundRows({tenantId:ids.tenantId,entityId:ids.entityId,importBatchId:observed.import_batch_id,receipt,rows,idempotencyKey,requestHash});
  assert.deepEqual({rows:created.row_count,draft:created.can_create_draft,approve:created.can_approve,post:created.can_post},{rows:1,draft:false,approve:false,post:false});assert(created.receipt_id);
  const audit=(await adminPool.query("SELECT request_id,correlation_id,idempotency_key,after_hash FROM audit_event WHERE tenant_id=$1 AND entity_id=$2 AND event_type='WBS_INBOUND_PERSISTED' AND object_id=$3",[ids.tenantId,ids.entityId,created.receipt_id])).rows[0];
  assert.deepEqual(audit,{request_id:idempotencyKey,correlation_id:idempotencyKey,idempotency_key:idempotencyKey,after_hash:requestHash});
  const replay=await kernel.persistWbsInboundRows({tenantId:ids.tenantId,entityId:ids.entityId,importBatchId:observed.import_batch_id,receipt,rows,idempotencyKey,requestHash});assert.equal(replay.idempotent,true);
  await assert.rejects(kernel.persistWbsInboundRows({tenantId:ids.tenantId,entityId:ids.entityId,importBatchId:observed.import_batch_id,receipt,rows,idempotencyKey,requestHash:hash('changed-single-request')}),error=>error.code==='23505');
  assert.equal((await adminPool.query('SELECT count(*)::int n FROM journal_entry WHERE tenant_id=$1',[ids.tenantId])).rows[0].n,journalsBefore);
});

pgTest('WBS AutoRec Reserve and Release persist receipt-bound source reservations without creating a journal',async()=>{
  const ids=await seed({status:'DRAFT'}),snapshotId=randomUUID(),capturedAt=new Date().toISOString();
  const journalsBefore=(await adminPool.query('SELECT count(*)::int n FROM journal_entry WHERE tenant_id=$1',[ids.tenantId])).rows[0].n;
  const snapshot={schema_version:'WBS_READONLY_SNAPSHOT_V1',snapshot_id:snapshotId,captured_at:capturedAt,environment:'SANDBOX',source_system:'WBS',dictionary_version:'WBS-DICT-EXECUTION',views:[{name:'BGDATA.payable',company_key:ids.sourceEntityId,rows:[{apGuId:randomUUID(),ap_type:'AUTOC'}]}]};
  snapshot.views=snapshot.views.map(view=>({...view,content_hash:canonicalRequestHash(view.rows)}));snapshot.package_hash=canonicalRequestHash(snapshot);
  const kernel=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'autorec-manager',['WBS.SNAPSHOT.IMPORT','BANK.AUTOREC.MANAGE'])});
  const observed=await kernel.recordWbsSnapshot({tenantId:ids.tenantId,entityId:ids.entityId,snapshot,idempotencyKey:'snapshot-execution-0001'});
  const bankId='BANK-RESERVE-1',payId='PAY-RESERVE-1',raceBankId='BANK-RESERVE-RACE',racePayId='PAY-RESERVE-RACE',bankHash=hash('reserve-bank'),payHash=hash('reserve-pay'),raceBankHash=hash('reserve-race-bank'),racePayHash=hash('reserve-race-pay');
  const makeGroup=(sourceRecordId,receiptHash,payloadRef,normalized)=>({receipt:{payload_hash:receiptHash,payload_ref:payloadRef},rows:[{source_record_id:sourceRecordId,source_version:'v1',raw:{company_key:ids.sourceEntityId},normalized,outcome:{stage:'STAGING_REVIEWED'},outcome_kind:'STAGING'}]});
  const bank=makeGroup(bankId,bankHash,`object://wbs-snapshot/${snapshotId}/bank`,{source_type:'BANK_TRANSACTION',source_record_id:bankId,source_version:'v1',company_key:ids.sourceEntityId,currency:'USD',amount:'100.0000',bank_account_ref:'BANK-1'});
  const payable=makeGroup(payId,payHash,`object://wbs-snapshot/${snapshotId}/payable`,{source_type:'PAYABLE',source_record_id:payId,source_version:'v1',company_key:ids.sourceEntityId,currency:'USD',amount:'100.0000'});
  const raceBank=makeGroup(raceBankId,raceBankHash,`object://wbs-snapshot/${snapshotId}/race-bank`,{source_type:'BANK_TRANSACTION',source_record_id:raceBankId,source_version:'v1',company_key:ids.sourceEntityId,currency:'USD',amount:'100.0000',bank_account_ref:'BANK-1'});
  const racePayable=makeGroup(racePayId,racePayHash,`object://wbs-snapshot/${snapshotId}/race-payable`,{source_type:'PAYABLE',source_record_id:racePayId,source_version:'v1',company_key:ids.sourceEntityId,currency:'USD',amount:'100.0000'});
  const groups=[bank,payable,raceBank,racePayable],inboundKey='wbs-execution-inbound-001',inboundHash=canonicalRequestHash({tenant_id:ids.tenantId,entity_id:ids.entityId,import_batch_id:observed.import_batch_id,groups,idempotency_key:inboundKey});
  await kernel.persistWbsInboundSnapshotRows({tenantId:ids.tenantId,entityId:ids.entityId,importBatchId:observed.import_batch_id,groups,idempotencyKey:inboundKey,requestHash:inboundHash});
  const config=(await adminPool.query("SELECT refs_jsonb_hash(jsonb_build_object('input_keys',jsonb_build_object('company_key',$1::text,'currency','USD'),'output_rules','{}'::jsonb)) AS snapshot_hash",[ids.sourceEntityId])).rows[0];
  await adminPool.query(`INSERT INTO mapping_snapshot(mapping_snapshot_id,tenant_id,entity_id,family,scope_type,scope_key,input_key_hash,version,priority,effective_from,status,input_keys,output_rules,snapshot_hash,created_by,approved_by,approved_at)
    VALUES($1,$2,$3::uuid,'WBS_AUTOREC','ENTITY',$3::uuid::text,$4,1,1,'2020-01-01','APPROVED',jsonb_build_object('company_key',$5::text,'currency','USD'),'{}',$6,'fixture-maker','fixture-approver',now())`,[randomUUID(),ids.tenantId,ids.entityId,hash('reserve-mapping-key'),ids.sourceEntityId,config.snapshot_hash]);
  const review={request_type:'AUTOREC_REVIEW_REQUEST',status:'REVIEW_REQUIRED',review_candidate_id:hash('reserve-candidate'),company_key:ids.sourceEntityId,currency:'USD',bank_account_ref:'BANK-1',allocated_amount:'100.0000',trace:{bank_source_record_id:bankId,bank_source_version:'v1',business_source_record_id:payId,business_source_version:'v1',bank_receipt_id:'bank-receipt',bank_receipt_ref:bank.receipt.payload_ref,bank_receipt_hash:bankHash,business_receipt_id:'pay-receipt',business_receipt_ref:payable.receipt.payload_ref,business_receipt_hash:payHash,bank_business_date:'2026-08-01',bank_accounting_date:'2026-08-01',business_business_date:'2026-08-01',business_accounting_date:'2026-08-01'}};
  const reserve=buildWbsAutoRecExecutionIntent({command:'RESERVE',currentState:'REVIEW_REQUIRED',reviewCandidate:review,idempotencyKey:'wbs-reserve-pg-0001'});
  const created=await kernel.executeWbsAutoRecIntent({tenantId:ids.tenantId,entityId:ids.entityId,intent:reserve});
  assert.deepEqual({state:created.next_state,draft:created.can_create_draft,post:created.can_post},{state:'RESERVED',draft:false,post:false});
  const replay=await kernel.executeWbsAutoRecIntent({tenantId:ids.tenantId,entityId:ids.entityId,intent:reserve});assert.equal(replay.idempotent,true);
  const reservationReceipt={reservation_id:created.execution_receipt_id,request_hash:created.request_hash,control_hash:created.control_hash,version:String(created.version),review_candidate_id:review.review_candidate_id,bank_source_record_id:bankId,bank_source_version:'v1',business_source_record_id:payId,business_source_version:'v1',allocated_amount:'100.0000'};
  const beforeTamper=(await adminPool.query("SELECT (SELECT count(*)::int FROM wbs_autorec_execution_event WHERE tenant_id=$1) AS events,(SELECT count(*)::int FROM wbs_autorec_source_reservation WHERE tenant_id=$1) AS reservations,(SELECT count(*)::int FROM journal_entry WHERE tenant_id=$1) AS journals",[ids.tenantId])).rows[0];
  const tamperedRelease=buildWbsAutoRecExecutionIntent({command:'RELEASE',currentState:'RESERVED',reviewCandidate:review,reservationReceipt:{...reservationReceipt,request_hash:hash('tampered-reservation-request')},idempotencyKey:'wbs-release-tampered-pg-0001'});
  await assert.rejects(kernel.executeWbsAutoRecIntent({tenantId:ids.tenantId,entityId:ids.entityId,intent:tamperedRelease}),error=>error.code==='22023');
  const afterTamper=(await adminPool.query("SELECT (SELECT count(*)::int FROM wbs_autorec_execution_event WHERE tenant_id=$1) AS events,(SELECT count(*)::int FROM wbs_autorec_source_reservation WHERE tenant_id=$1) AS reservations,(SELECT count(*)::int FROM journal_entry WHERE tenant_id=$1) AS journals",[ids.tenantId])).rows[0];
  assert.deepEqual(afterTamper,beforeTamper);
  const release=buildWbsAutoRecExecutionIntent({command:'RELEASE',currentState:'RESERVED',reviewCandidate:review,reservationReceipt,idempotencyKey:'wbs-release-pg-0001'});
  const released=await kernel.executeWbsAutoRecIntent({tenantId:ids.tenantId,entityId:ids.entityId,intent:release});assert.equal(released.next_state,'RELEASED');
  const raceReview=id=>({...review,review_candidate_id:hash(id),allocated_amount:'60.0000',trace:{...review.trace,bank_source_record_id:raceBankId,business_source_record_id:racePayId,bank_receipt_ref:raceBank.receipt.payload_ref,bank_receipt_hash:raceBankHash,business_receipt_ref:racePayable.receipt.payload_ref,business_receipt_hash:racePayHash}});
  const race=[
    buildWbsAutoRecExecutionIntent({command:'RESERVE',currentState:'REVIEW_REQUIRED',reviewCandidate:raceReview('reserve-race-candidate-a'),idempotencyKey:'wbs-reserve-race-a'}),
    buildWbsAutoRecExecutionIntent({command:'RESERVE',currentState:'REVIEW_REQUIRED',reviewCandidate:raceReview('reserve-race-candidate-b'),idempotencyKey:'wbs-reserve-race-b'})
  ];
  const raceResults=await Promise.allSettled(race.map(intent=>kernel.executeWbsAutoRecIntent({tenantId:ids.tenantId,entityId:ids.entityId,intent})));
  assert.equal(raceResults.filter(item=>item.status==='fulfilled').length,1);assert.equal(raceResults.filter(item=>item.status==='rejected').length,1);
  const counts=await adminPool.query("SELECT (SELECT count(*)::int FROM wbs_autorec_execution_event WHERE tenant_id=$1) AS events,(SELECT count(*)::int FROM wbs_autorec_source_reservation WHERE tenant_id=$1) AS reservations,(SELECT count(*)::int FROM journal_entry WHERE tenant_id=$1) AS journals",[ids.tenantId]);
  assert.deepEqual(counts.rows[0],{events:3,reservations:4,journals:journalsBefore});
});

pgTest('independent AutoRec review and immutable accounting-event foundation derive exact G11 Drafts from approved rules',async()=>{
  const ids=await seed({status:'APPROVED',journalType:'AUTO',extraAccounts:[{accountCode:'610000',accountName:'Operating Expense'}]});
  const bankTrace=await attachAutoSource(ids,{sourceRecordPrefix:'AUTOREC-BANK-REVIEW'});
  const poster=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'review-fixture-poster',['GL.JE.POST'])});
  await poster.postJournal({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId,journalEntryId:ids.journalId,expectedRevision:0,idempotencyKey:'autorec-review-post-001'});
  const bankDocument=(await adminPool.query('SELECT * FROM source_document WHERE source_document_id=$1',[bankTrace.documentId])).rows[0];
  const businessTrace=await attachAutoSource(ids,{sourceRecordPrefix:'AUTOREC-PAYABLE-REVIEW',sourceModule:'payable',linkJournal:false,reuseApprovedSnapshots:true});
  await adminPool.query("UPDATE source_document SET document_type='PAYABLE' WHERE source_document_id=$1",[businessTrace.documentId]);
  const businessDocument=(await adminPool.query('SELECT * FROM source_document WHERE source_document_id=$1',[businessTrace.documentId])).rows[0];
  const businessRecord=businessDocument.source_record_id,businessVersion=businessDocument.source_version,businessDocumentId=businessDocument.source_document_id;
  const cash=(await adminPool.query(`SELECT jl.journal_line_id,ll.ledger_line_id FROM journal_line jl JOIN ledger_line ll
    ON ll.tenant_id=jl.tenant_id AND ll.entity_id=jl.entity_id AND ll.journal_entry_id=jl.journal_entry_id AND ll.journal_line_id=jl.journal_line_id
    WHERE jl.tenant_id=$1 AND jl.entity_id=$2 AND jl.journal_entry_id=$3 AND jl.account_code='111000'`,[ids.tenantId,ids.entityId,ids.journalId])).rows[0];
  const bankSourceId=randomUUID(),bankMatchId=randomUUID();
  await adminPool.query(`INSERT INTO bank_source(bank_source_id,tenant_id,entity_id,source_document_id,bank_account_ref,external_bank_line_id,transaction_date,currency,amount)
    VALUES($1,$2,$3,$4,'BANK-1','AUTOREC-BANK-REVIEW-LINE','2026-07-15','USD',100)`,[bankSourceId,ids.tenantId,ids.entityId,bankTrace.documentId]);
  await adminPool.query(`INSERT INTO bank_match(bank_match_id,tenant_id,entity_id,bank_source_id,business_source_document_id,journal_entry_id,journal_line_id,ledger_line_id,candidate_rule_code,amount_delta,currency_match,date_delta_days,status,matched_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,'EXACT_POSTED_PAYMENT',0,true,0,'ACTIVE','autorec-match-maker')`,[bankMatchId,ids.tenantId,ids.entityId,bankSourceId,businessDocumentId,ids.journalId,cash.journal_line_id,cash.ledger_line_id]);
  const reviewCandidateId=hash('autorec-independent-review-candidate'),executionReceiptId=randomUUID();
  const candidate={request_type:'AUTOREC_REVIEW_REQUEST',status:'REVIEW_REQUIRED',review_candidate_id:reviewCandidateId,company_key:ids.sourceEntityId,currency:'USD',bank_account_ref:'BANK-1',allocated_amount:'100.0000',trace:{bank_source_record_id:bankDocument.source_record_id,bank_source_version:bankDocument.source_version,business_source_record_id:businessRecord,business_source_version:businessVersion}};
  const candidateHash=(await adminPool.query('SELECT refs_jsonb_hash($1::jsonb) candidate_hash',[JSON.stringify(candidate)])).rows[0].candidate_hash;
  const executionRequestHash=hash('autorec-review-reserve-request');
  await adminPool.query(`INSERT INTO wbs_autorec_execution_event(execution_receipt_id,tenant_id,entity_id,review_candidate_id,command,current_state,next_state,version,request_hash,idempotency_key,intent)
    VALUES($1,$2,$3,$4,'RESERVE','REVIEW_REQUIRED','RESERVED',1,$5,'autorec-review-reserve-001',jsonb_build_object('review_candidate',$6::jsonb))`,[executionReceiptId,ids.tenantId,ids.entityId,reviewCandidateId,executionRequestHash,JSON.stringify(candidate)]);
  await adminPool.query(`INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash)
    VALUES($1,$2,'WBS_AUTOREC_EXECUTION_PERSISTED','WBS_AUTOREC_EXECUTION',$3,'RESERVE','autorec-candidate-preparer','USER','BANK.AUTOREC.MANAGE','autorec-review-reserve-001','autorec-review-reserve-001','autorec-review-reserve-001',$4)`,[ids.tenantId,ids.entityId,executionReceiptId,executionRequestHash]);
  await adminPool.query(`INSERT INTO wbs_autorec_source_reservation(tenant_id,entity_id,execution_receipt_id,review_candidate_id,source_side,source_type,source_record_id,source_version,currency,allocated_amount)
    VALUES($1,$2,$3,$4,'BANK','BANK_TRANSACTION',$5,$6,'USD',100),($1,$2,$3,$4,'BUSINESS','PAYABLE',$7,$8,'USD',100)`,[ids.tenantId,ids.entityId,executionReceiptId,reviewCandidateId,bankDocument.source_record_id,bankDocument.source_version,businessRecord,businessVersion]);
  await adminPool.query(`INSERT INTO wbs_autorec_execution_event(tenant_id,entity_id,review_candidate_id,command,current_state,next_state,version,request_hash,idempotency_key,intent)
    VALUES($1,$2,$3,'RELEASE','RESERVED','RELEASED',2,$4,'autorec-review-release-001',jsonb_build_object('review_candidate',$5::jsonb))`,[ids.tenantId,ids.entityId,reviewCandidateId,hash('autorec-review-release-request'),JSON.stringify(candidate)]);

  const args={tenantId:ids.tenantId,entityId:ids.entityId,reviewCandidateId,candidateHash,bankMatchId,expectedMatchRevision:0,decision:'ACCEPTED',reason:'Independent controller accepted the exact persisted AutoRec Bank Match evidence',idempotencyKey:'autorec-match-review-001'};
  const reviewer=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'autorec-independent-reviewer',['BANK.MATCH.REVIEW','WBS.AUTOREC.VIEW'])});
  const accepted=await reviewer.reviewWbsAutoRecBankMatch(args);
  const g11WriteCounts=async()=>((await adminPool.query(`SELECT
    (SELECT count(*)::int FROM accounting_event WHERE tenant_id=$1) events,
    (SELECT count(*)::int FROM journal_accounting_event WHERE tenant_id=$1) bindings,
    (SELECT count(*)::int FROM journal_entry WHERE tenant_id=$1) journals,
    (SELECT count(*)::int FROM journal_line WHERE tenant_id=$1) journal_lines,
    (SELECT count(*)::int FROM source_link WHERE tenant_id=$1) source_links,
    (SELECT count(*)::int FROM wbs_autorec_execution_event WHERE tenant_id=$1) executions,
    (SELECT count(*)::int FROM wbs_autorec_g11_completion WHERE tenant_id=$1) completions,
    (SELECT count(*)::int FROM wbs_autorec_g11_completion_line WHERE tenant_id=$1) completion_lines,
    (SELECT count(*)::int FROM idempotency_receipt WHERE tenant_id=$1 AND operation_scope LIKE 'WBS_AUTOREC_G11_%') receipts,
    (SELECT count(*)::int FROM audit_event WHERE tenant_id=$1 AND event_type='WBS_AUTOREC_G11_INCURRED') incur_audits,
    (SELECT count(*)::int FROM outbox_event WHERE tenant_id=$1 AND event_type='WBS_AUTOREC_G11_INCURRED') incur_outbox`,[ids.tenantId])).rows[0]);
  const rejectsWithoutG11Writes=async(action,predicate)=>{const before=await g11WriteCounts();await assert.rejects(action,predicate);assert.deepEqual(await g11WriteCounts(),before);};
  assert.deepEqual({candidate:accepted.review_candidate_id,match:accepted.bank_match_id,revision:accepted.bank_match_revision,decision:accepted.decision,sod:accepted.sod_verified,g11:accepted.g11_linked,incurred:accepted.incurred},{candidate:reviewCandidateId,match:bankMatchId,revision:0,decision:'ACCEPTED',sod:true,g11:false,incurred:false});
  assert.equal(accepted.candidate_hash,candidateHash);assert.match(accepted.evidence_hash,/^sha256:[0-9a-f]{64}$/);assert.equal(accepted.reviewed_by,'autorec-independent-reviewer');assert.ok(Date.parse(accepted.reviewed_at));
  const replay=await reviewer.reviewWbsAutoRecBankMatch(args);assert.equal(replay.idempotent,true);assert.equal(replay.wbs_autorec_match_review_id,accepted.wbs_autorec_match_review_id);
  const read=await reviewer.getWbsAutoRecBankMatchReview({tenantId:ids.tenantId,entityId:ids.entityId,reviewId:accepted.wbs_autorec_match_review_id});
  assert.deepEqual({candidate:read.review_candidate_id,match:read.bank_match_id,revision:read.bank_match_revision,hash:read.candidate_hash,decision:read.decision,reviewer:read.reviewed_by,sod:read.sod_verified,g11:read.g11_linked,incurred:read.incurred},{candidate:reviewCandidateId,match:bankMatchId,revision:0,hash:candidateHash,decision:'ACCEPTED',reviewer:'autorec-independent-reviewer',sod:true,g11:false,incurred:false});
  const sameActor=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'autorec-match-maker',['BANK.MATCH.REVIEW'])});
  await assert.rejects(sameActor.reviewWbsAutoRecBankMatch({...args,idempotencyKey:'autorec-match-review-sod'}),error=>error.code==='42501');
  await assert.rejects(reviewer.reviewWbsAutoRecBankMatch({...args,expectedMatchRevision:1,idempotencyKey:'autorec-match-review-revision'}),error=>error.code==='40001');
  assert.equal((await adminPool.query('SELECT count(*)::int n FROM wbs_autorec_match_review WHERE tenant_id=$1 AND entity_id=$2',[ids.tenantId,ids.entityId])).rows[0].n,1);
  const eventMaker=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'autorec-event-maker',['BANK.AUTOREC.G11.DRAFT'])});
  const eventArgs={tenantId:ids.tenantId,entityId:ids.entityId,reviewId:accepted.wbs_autorec_match_review_id,periodId:ids.periodId,expectedEvidenceHash:accepted.evidence_hash,reason:'Dedicated producer must fail until exact event mappings are persisted',idempotencyKey:'autorec-event-draft-001'};
  const before=(await adminPool.query('SELECT (SELECT count(*)::int FROM accounting_event WHERE tenant_id=$1) events,(SELECT count(*)::int FROM journal_accounting_event WHERE tenant_id=$1) bindings,(SELECT count(*)::int FROM journal_entry WHERE tenant_id=$1) journals,(SELECT count(*)::int FROM idempotency_receipt WHERE tenant_id=$1) receipts',[ids.tenantId])).rows[0];
  await assert.rejects(eventMaker.createWbsAutoRecPayableIncurDraft(eventArgs),error=>error.code==='23514');
  const after=(await adminPool.query('SELECT (SELECT count(*)::int FROM accounting_event WHERE tenant_id=$1) events,(SELECT count(*)::int FROM journal_accounting_event WHERE tenant_id=$1) bindings,(SELECT count(*)::int FROM journal_entry WHERE tenant_id=$1) journals,(SELECT count(*)::int FROM idempotency_receipt WHERE tenant_id=$1) receipts',[ids.tenantId])).rows[0];assert.deepEqual(after,before);
  const g11Input={company_key:ids.sourceEntityId,currency:'USD',bank_account_ref:'BANK-1'},g11Rules={clearing_account:'291001',clearing_member_ref:'VENDOR-1',bank_member_ref:'BANK-1',payable_incur_offset_account:'610000',autoc_offset_account:'111000'};
  const g11Hash=(await adminPool.query("SELECT refs_jsonb_hash(jsonb_build_object('input_keys',$1::jsonb,'output_rules',$2::jsonb)) snapshot_hash",[JSON.stringify(g11Input),JSON.stringify(g11Rules)])).rows[0].snapshot_hash,g11MappingId=randomUUID();
  await adminPool.query(`INSERT INTO mapping_snapshot(mapping_snapshot_id,tenant_id,entity_id,family,scope_type,scope_key,input_key_hash,version,priority,effective_from,status,input_keys,output_rules,snapshot_hash,created_by,approved_by,approved_at)
    VALUES($1,$2,$3,'WBS_AUTOREC_G11','ENTITY',$8,$4,1,1,'2026-01-01','APPROVED',$5::jsonb,$6::jsonb,$7,'g11-mapping-maker','g11-mapping-approver',now())`,[g11MappingId,ids.tenantId,ids.entityId,hash('g11-input'),JSON.stringify(g11Input),JSON.stringify(g11Rules),g11Hash,ids.entityId]);
  const payableDraft=await eventMaker.createWbsAutoRecPayableIncurDraft(eventArgs);
  const autocDraft=await eventMaker.createWbsAutoRecAutocDraft({...eventArgs,idempotencyKey:'autorec-event-draft-002'});
  assert.deepEqual([payableDraft.event_type,autocDraft.event_type],['PAYABLE_INCUR','AUTOC']);
  assert.equal(payableDraft.amount,'100.0000');assert.equal(autocDraft.amount,'100.0000');assert.notEqual(payableDraft.journal_entry_id,autocDraft.journal_entry_id);
  const replayDraft=await eventMaker.createWbsAutoRecPayableIncurDraft(eventArgs);assert.equal(replayDraft.idempotent,true);assert.equal(replayDraft.journal_entry_id,payableDraft.journal_entry_id);
  const g11Rows=(await adminPool.query(`SELECT ae.event_type,ae.source_document_id,ae.mapping_snapshot_id,je.status,je.journal_type,jl.line_no,jl.account_code,jl.debit_amount::text,jl.credit_amount::text,jl.member_ref
    FROM accounting_event ae JOIN journal_accounting_event jae USING(tenant_id,entity_id,accounting_event_id)
    JOIN journal_entry je USING(tenant_id,entity_id,journal_entry_id) JOIN journal_line jl USING(tenant_id,entity_id,journal_entry_id)
    WHERE ae.tenant_id=$1 AND ae.entity_id=$2 AND ae.wbs_autorec_match_review_id=$3 ORDER BY ae.event_type,jl.line_no`,[ids.tenantId,ids.entityId,accepted.wbs_autorec_match_review_id])).rows;
  assert.equal(g11Rows.length,4);assert(g11Rows.every(row=>row.status==='DRAFT'&&row.journal_type==='AUTO'&&row.mapping_snapshot_id===g11MappingId));
  assert.deepEqual(g11Rows.map(row=>[row.event_type,row.account_code,row.debit_amount,row.credit_amount,row.member_ref]),[
    ['AUTOC','291001','100.0000','0.0000','VENDOR-1'],['AUTOC','111000','0.0000','100.0000','BANK-1'],
    ['PAYABLE_INCUR','610000','100.0000','0.0000',null],['PAYABLE_INCUR','291001','0.0000','100.0000','VENDOR-1']
  ]);
  const unauthorizedFinalizer=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'g11-unauthorized-finalizer',[])});
  const beforePostFinalizer=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'g11-before-post-finalizer',['BANK.AUTOREC.G11.INCUR'])});
  const negativeIncurArgs={tenantId:ids.tenantId,entityId:ids.entityId,reviewId:accepted.wbs_autorec_match_review_id,expectedEvidenceHash:accepted.evidence_hash,reason:'Negative finalizer control must leave all G11 facts unchanged',idempotencyKey:'g11-incur-before-post-negative'};
  await rejectsWithoutG11Writes(()=>unauthorizedFinalizer.finalizeWbsAutoRecG11Incur({...negativeIncurArgs,idempotencyKey:'g11-incur-unauthorized-negative'}),error=>error.code==='42501');
  await rejectsWithoutG11Writes(()=>beforePostFinalizer.finalizeWbsAutoRecG11Incur(negativeIncurArgs),error=>error.code==='23514');
  const crossEntityFinalizer=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'g11-cross-entity-finalizer',['BANK.AUTOREC.G11.INCUR'])});
  await rejectsWithoutG11Writes(()=>crossEntityFinalizer.finalizeWbsAutoRecG11Incur({...negativeIncurArgs,entityId:randomUUID(),idempotencyKey:'g11-incur-cross-entity-negative'}),error=>error.code==='42501');
  await rejectsWithoutG11Writes(()=>adminPool.query(`INSERT INTO source_link(tenant_id,entity_id,link_type,source_document_id,staging_item_id,journal_entry_id,created_by)
    VALUES($1,$2,'SOURCE_TO_JE',$3,$4,$5,'generic-second-link-fixture')`,[ids.tenantId,ids.entityId,payableDraft.source_document_id,payableDraft.staging_item_id,ids.journalId]),error=>error.code==='23505');
  const submitter=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'g11-submitter',['GL.JE.SUBMIT'])});
  const journalReviewer=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'g11-journal-reviewer',['GL.JE.REVIEW'])});
  const journalApprover=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'g11-journal-approver',['GL.JE.APPROVE'])});
  const g11Poster=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'g11-poster',['GL.JE.POST'])});
  for(const [suffix,draft] of [['pi',payableDraft],['ac',autocDraft]]){
    assert.equal((await submitter.transitionJournal({...ids,journalEntryId:draft.journal_entry_id,action:'SUBMIT',expectedRevision:0,idempotencyKey:`g11-${suffix}-submit-001`})).status,'PENDING_REVIEW');
    assert.equal((await journalReviewer.transitionJournal({...ids,journalEntryId:draft.journal_entry_id,action:'REVIEW',expectedRevision:1,idempotencyKey:`g11-${suffix}-review-001`})).status,'PENDING_APPROVAL');
    assert.equal((await journalApprover.transitionJournal({...ids,journalEntryId:draft.journal_entry_id,action:'APPROVE',expectedRevision:2,idempotencyKey:`g11-${suffix}-approve-001`})).status,'APPROVED');
    assert.equal((await g11Poster.postJournal({...ids,journalEntryId:draft.journal_entry_id,expectedRevision:3,idempotencyKey:`g11-${suffix}-post-001`})).idempotent,false);
  }
  const postedButNotIncurred=await reviewer.getWbsAutoRecBankMatchReview({tenantId:ids.tenantId,entityId:ids.entityId,reviewId:accepted.wbs_autorec_match_review_id});
  assert.deepEqual({linked:postedButNotIncurred.g11_linked,incurred:postedButNotIncurred.incurred},{linked:false,incurred:false});
  const finalizer=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'g11-finalizer',['BANK.AUTOREC.G11.INCUR','WBS.AUTOREC.VIEW'])});
  const incurArgs={tenantId:ids.tenantId,entityId:ids.entityId,reviewId:accepted.wbs_autorec_match_review_id,expectedEvidenceHash:accepted.evidence_hash,reason:'Independent finalizer verified both exact posted G11 journals and clearing net zero',idempotencyKey:'g11-incur-finalize-001'};
  const priorPosterFinalizer=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'g11-poster',['BANK.AUTOREC.G11.INCUR'])});
  await rejectsWithoutG11Writes(()=>priorPosterFinalizer.finalizeWbsAutoRecG11Incur({...incurArgs,idempotencyKey:'g11-incur-finalizer-sod-negative'}),error=>error.code==='42501');
  const incurred=await finalizer.finalizeWbsAutoRecG11Incur(incurArgs);
  assert.deepEqual({linked:incurred.g11_linked,incurred:incurred.incurred,version:incurred.incur_execution_version},{linked:true,incurred:true,version:3});
  const incurReplay=await finalizer.finalizeWbsAutoRecG11Incur(incurArgs);assert.equal(incurReplay.idempotent,true);assert.equal(incurReplay.wbs_autorec_g11_completion_id,incurred.wbs_autorec_g11_completion_id);
  const evidence=await finalizer.getWbsAutoRecG11Evidence({tenantId:ids.tenantId,entityId:ids.entityId,reviewId:accepted.wbs_autorec_match_review_id});
  assert.equal(evidence.g11_linked,true);assert.equal(evidence.incurred,true);assert.equal(evidence.lines.length,4);assert.equal(evidence.accounting_events.length,2);
  assert.equal(evidence.released_candidate.allocated_amount,'100.0000');assert(evidence.accounting_events.every(row=>row.amount==='100.0000'));
  assert(evidence.lines.every(row=>typeof row.debit_amount==='string'&&/^\d+\.\d{4}$/.test(row.debit_amount)&&typeof row.credit_amount==='string'&&/^\d+\.\d{4}$/.test(row.credit_amount)));
  assert.equal(evidence.incur_event.command,'INCUR');assert.equal(evidence.incur_event.next_state,'INCURRED');
  const completedReview=await reviewer.getWbsAutoRecBankMatchReview({tenantId:ids.tenantId,entityId:ids.entityId,reviewId:accepted.wbs_autorec_match_review_id});
  assert.deepEqual({linked:completedReview.g11_linked,incurred:completedReview.incurred},{linked:true,incurred:true});
  assert.equal((await adminPool.query("SELECT coalesce(sum(debit_amount-credit_amount),0)::text net FROM wbs_autorec_g11_completion_line WHERE tenant_id=$1 AND entity_id=$2 AND account_code='291001' AND member_ref='VENDOR-1'",[ids.tenantId,ids.entityId])).rows[0].net,'0.0000');
  await adminPool.query(`INSERT INTO wbs_autorec_execution_event(tenant_id,entity_id,review_candidate_id,command,current_state,next_state,version,request_hash,idempotency_key,intent)
    VALUES($1,$2,$3,'RESERVE','REVIEW_REQUIRED','RESERVED',4,$4,'autorec-stale-completion-reserve',jsonb_build_object('review_candidate',$5::jsonb))`,[ids.tenantId,ids.entityId,reviewCandidateId,hash('autorec-stale-completion-reserve'),JSON.stringify(candidate)]);
  const staleCompletion=await reviewer.getWbsAutoRecBankMatchReview({tenantId:ids.tenantId,entityId:ids.entityId,reviewId:accepted.wbs_autorec_match_review_id});
  assert.deepEqual({linked:staleCompletion.g11_linked,incurred:staleCompletion.incurred},{linked:false,incurred:false});
  await rejectsWithoutG11Writes(()=>finalizer.finalizeWbsAutoRecG11Incur({...incurArgs,idempotencyKey:'g11-incur-latest-drift-negative'}),error=>error.code==='23514');
  await assert.rejects(adminPool.query("UPDATE accounting_event SET created_by='tampered' WHERE accounting_event_id=$1",[payableDraft.accounting_event_id]),error=>error.code==='55000');
  await assert.rejects(adminPool.query('DELETE FROM journal_accounting_event WHERE accounting_event_id=$1',[payableDraft.accounting_event_id]),error=>error.code==='55000');
});

pgTest('WBS trace relation evidence is receipt-bound, replay-safe, readable, and never creates a journal',async()=>{
  const ids=await seed({status:'DRAFT'}),snapshotId=randomUUID(),traceSourceId=randomUUID(),capturedAt=new Date().toISOString();
  const journalsBefore=(await adminPool.query('SELECT count(*)::int n FROM journal_entry WHERE tenant_id=$1',[ids.tenantId])).rows[0].n;
  const snapshot={schema_version:'WBS_READONLY_SNAPSHOT_V1',snapshot_id:snapshotId,captured_at:capturedAt,environment:'SANDBOX',source_system:'WBS',dictionary_version:'WBS-DICT-TRACE',views:[{name:'BGDATA.payable',company_key:ids.sourceEntityId,rows:[{apGuId:traceSourceId,ap_type:'AUTOC'}]}]};
  snapshot.views=snapshot.views.map(view=>({...view,content_hash:canonicalRequestHash(view.rows)}));snapshot.package_hash=canonicalRequestHash(snapshot);
  const kernel=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'trace-importer',['WBS.SNAPSHOT.IMPORT'])});
  const observed=await kernel.recordWbsSnapshot({tenantId:ids.tenantId,entityId:ids.entityId,snapshot,idempotencyKey:'snapshot-trace-0001'});
  const receipt={payload_hash:hash('trace-receipt'),payload_ref:`object://wbs-snapshot/${snapshotId}/inbound/${traceSourceId}`};
  const rows=[{source_record_id:traceSourceId,source_version:`snapshot:${snapshotId}:${traceSourceId}`,raw:{record_id:traceSourceId,company_key:ids.sourceEntityId},normalized:{source_type:'PAYABLE',source_record_id:traceSourceId,source_version:`snapshot:${snapshotId}:${traceSourceId}`,company_key:ids.sourceEntityId,receipt_hash:receipt.payload_hash,receipt_ref:receipt.payload_ref},outcome:{stage:'STAGING_REVIEW_REQUIRED'},outcome_kind:'STAGING'}];
  const inboundKey='wbs-trace-inbound-0001',inboundHash=canonicalRequestHash({tenant_id:ids.tenantId,entity_id:ids.entityId,import_batch_id:observed.import_batch_id,receipt,rows,idempotency_key:inboundKey});
  await kernel.persistWbsInboundRows({tenantId:ids.tenantId,entityId:ids.entityId,importBatchId:observed.import_batch_id,receipt,rows,idempotencyKey:inboundKey,requestHash:inboundHash});
  const source={tenant_id:ids.tenantId,entity_id:ids.entityId,company_key:ids.sourceEntityId,source_type:'PAYABLE',source_record_id:traceSourceId,source_version:`snapshot:${snapshotId}:${traceSourceId}`,receipt_hash:receipt.payload_hash,wbs_key_type:'ap_guid'};
  const traceReceipt={ref:`receipt://wbs/trace/${traceSourceId}`,version:'v1',issued_at:capturedAt,manifest_hash:hash('trace-manifest'),key_id:'wbs-test-key',algorithm:'Ed25519',content_hash:hash('trace-content')};
  const relations=[{relation_id:'PAY-TRACE-BANK-1',relation_type:'PAYABLE_TO_BANK',related:{key_type:'cb_id',key_value:'BANK-TRACE'},observed_version:'observed:v1',can_use_as_source_key:false,can_match:false,can_transition:false,can_post:false}];
  const bindingHash=canonicalRequestHash({source,receipt:traceReceipt,relations});
  const relationPersistencePlan={request_type:'WBS_TRACE_RELATION_PERSISTENCE_PLAN_V1',status:'BLOCKED_ON_RELATION_EVIDENCE_PERSISTENCE',idempotency_key:bindingHash,binding_hash:bindingHash,required_kernel_capability:'persistWbsTraceRelationEvidence',source,trace_receipt:traceReceipt,relations};
  const persisted=await createWbsTraceRelationOrchestrator({kernel}).persist({relationPersistencePlan});
  const created=persisted.persistence_receipt;
  assert.deepEqual({relations:created.relation_count,draft:created.can_create_draft,post:created.can_post},{relations:1,draft:false,post:false});assert(created.relation_evidence_id);
  const replay=await kernel.persistWbsTraceRelationEvidence({tenantId:ids.tenantId,entityId:ids.entityId,source,traceReceipt,relations,idempotencyKey:bindingHash,bindingHash});assert.equal(replay.idempotent,true);
  await assert.rejects(kernel.persistWbsTraceRelationEvidence({tenantId:ids.tenantId,entityId:ids.entityId,source,traceReceipt,relations,idempotencyKey:'wbs-trace-relation-0002',bindingHash:hash('forged-binding')}),error=>error.code==='WBS_TRACE_RELATION_HASH_INVALID');
  await assert.rejects(kernel.readWbsTraceRelationEvidence({tenantId:ids.tenantId,entityId:ids.entityId,source,read_only:true}),error=>error.code==='42501');
  const reader=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'trace-reader',['WBS.AUTOREC.VIEW'])});
  const read=await reader.readWbsTraceRelationEvidence({tenantId:ids.tenantId,entityId:ids.entityId,source,read_only:true});assert.equal(read.relation_evidence_id,created.relation_evidence_id);assert.equal(read.relations.length,1);assert.equal(read.relations[0].related.key_type,'cb_id');assert.equal(read.can_post,false);
  const audit=(await adminPool.query("SELECT after_hash,metadata FROM audit_event WHERE tenant_id=$1 AND entity_id=$2 AND event_type='WBS_TRACE_RELATION_PERSISTED' AND object_id=$3",[ids.tenantId,ids.entityId,created.relation_evidence_id])).rows[0];assert.deepEqual(audit,{after_hash:bindingHash,metadata:{relation_count:1}});
  const reportSource={...source,source_type:'COST_GENERAL_LEDGER'};
  await assert.rejects(kernel.persistWbsTraceRelationEvidence({tenantId:ids.tenantId,entityId:ids.entityId,source:reportSource,traceReceipt,relations,idempotencyKey:'wbs-trace-report-blocked-0001'}),error=>error.code==='22023');
  assert.equal((await adminPool.query('SELECT count(*)::int n FROM wbs_trace_relation_evidence WHERE tenant_id=$1 AND entity_id=$2',[ids.tenantId,ids.entityId])).rows[0].n,1);
  assert.equal((await adminPool.query('SELECT count(*)::int n FROM journal_entry WHERE tenant_id=$1',[ids.tenantId])).rows[0].n,journalsBefore);
});

pgTest('WBS Cost GL control metrics are receipt-bound, readable, replay-safe, and never create a journal',async()=>{
  const ids=await seed({status:'DRAFT'}),snapshotId=randomUUID(),capturedAt=new Date().toISOString();
  const journalsBefore=(await adminPool.query('SELECT count(*)::int n FROM journal_entry WHERE tenant_id=$1',[ids.tenantId])).rows[0].n;
  const snapshot={schema_version:'WBS_READONLY_SNAPSHOT_V1',snapshot_id:snapshotId,captured_at:capturedAt,environment:'SANDBOX',source_system:'WBS',dictionary_version:'WBS-DICT-CONTROL',views:[{name:'BGDATA.payable',company_key:ids.sourceEntityId,rows:[{apGuId:randomUUID(),ap_type:'AUTOC'}]}]};
  snapshot.views=snapshot.views.map(view=>({...view,content_hash:canonicalRequestHash(view.rows)}));snapshot.package_hash=canonicalRequestHash(snapshot);
  const kernel=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'control-importer',['WBS.SNAPSHOT.IMPORT'])});
  const observed=await kernel.recordWbsSnapshot({tenantId:ids.tenantId,entityId:ids.entityId,snapshot,idempotencyKey:'snapshot-control-0001'});
  const inboundReceipt={payload_hash:hash('cost-control-receipt'),payload_ref:`object://wbs-snapshot/${snapshotId}/inbound/COST-GL`};
  const rows=[{source_record_id:'COST-GL',source_version:`snapshot:${snapshotId}:COST-GL`,raw:{record_id:'COST-GL',company_key:ids.sourceEntityId},normalized:{source_type:'COST_GENERAL_LEDGER',source_record_id:'COST-GL',source_version:`snapshot:${snapshotId}:COST-GL`,company_key:ids.sourceEntityId,receipt_hash:inboundReceipt.payload_hash,receipt_ref:inboundReceipt.payload_ref},outcome:{stage:'CONTROL_EVIDENCE_ONLY'},outcome_kind:'EXCEPTION'}];
  const inboundKey='wbs-control-inbound-0001',inboundHash=canonicalRequestHash({tenant_id:ids.tenantId,entity_id:ids.entityId,import_batch_id:observed.import_batch_id,receipt:inboundReceipt,rows,idempotency_key:inboundKey});
  const inbound=await kernel.persistWbsInboundRows({tenantId:ids.tenantId,entityId:ids.entityId,importBatchId:observed.import_batch_id,receipt:inboundReceipt,rows,idempotencyKey:inboundKey,requestHash:inboundHash});
  const scope={tenant_id:ids.tenantId,entity_id:ids.entityId,company_key:ids.sourceEntityId,period:'2026-08',currency:'USD'};
  const metrics=Array.from({length:14},(_,index)=>({metric_key:`COST_METRIC_${String(index+1).padStart(2,'0')}`,amount:`${(index+1)*10}.0000`}));
  const receipt={hash:inboundReceipt.payload_hash,metrics_hash:canonicalRequestHash(metrics),ref:inboundReceipt.payload_ref,version:'v1',scope,signature_verified:true,manifest_hash:hash('control-manifest'),key_id:'wbs-control-key',algorithm:'Ed25519'};
  const bindingHash=canonicalRequestHash({sourceType:'COST_GENERAL_LEDGER',scope,receiptId:inbound.receipt_id,receipt,metrics});
  const created=await kernel.persistWbsControlMetricSnapshot({tenantId:ids.tenantId,entityId:ids.entityId,sourceType:'COST_GENERAL_LEDGER',scope,receiptId:inbound.receipt_id,receipt,metrics,idempotencyKey:bindingHash,bindingHash});
  assert.deepEqual({source:created.source_type,draft:created.can_create_draft,post:created.can_post},{source:'COST_GENERAL_LEDGER',draft:false,post:false});
  const replay=await kernel.persistWbsControlMetricSnapshot({tenantId:ids.tenantId,entityId:ids.entityId,sourceType:'COST_GENERAL_LEDGER',scope,receiptId:inbound.receipt_id,receipt,metrics,idempotencyKey:bindingHash,bindingHash});assert.equal(replay.idempotent,true);
  await assert.rejects(kernel.readPersistedWbsControlSnapshot({source_type:'COST_GENERAL_LEDGER',tenant_id:ids.tenantId,entity_id:ids.entityId,scope,read_only:true}),error=>error.code==='42501');
  const reader=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'control-reader',['WBS.AUTOREC.VIEW'])});
  const read=await reader.readPersistedWbsControlSnapshot({source_type:'COST_GENERAL_LEDGER',tenant_id:ids.tenantId,entity_id:ids.entityId,scope,read_only:true});assert.equal(read.snapshot_id,created.snapshot_id);assert.equal(read.metrics.length,14);assert.equal(read.receipt.signature_verified,true);assert.equal(read.can_post,false);
  const partialMetrics=metrics.slice(0,13),partialReceipt={...receipt,metrics_hash:canonicalRequestHash(partialMetrics)},partialBindingHash=canonicalRequestHash({sourceType:'COST_GENERAL_LEDGER',scope,receiptId:inbound.receipt_id,receipt:partialReceipt,metrics:partialMetrics});
  await assert.rejects(kernel.persistWbsControlMetricSnapshot({tenantId:ids.tenantId,entityId:ids.entityId,sourceType:'COST_GENERAL_LEDGER',scope,receiptId:inbound.receipt_id,receipt:partialReceipt,metrics:partialMetrics,idempotencyKey:'wbs-control-partial-0001',bindingHash:partialBindingHash}),error=>error.code==='22023');
  await assert.rejects(kernel.persistWbsControlMetricSnapshot({tenantId:ids.tenantId,entityId:ids.entityId,sourceType:'COST_GENERAL_LEDGER',scope,receiptId:inbound.receipt_id,receipt,metrics:[...metrics,{metric_key:'COST_METRIC_03',amount:'30.0000'}],idempotencyKey:'wbs-control-forged-0001'}),error=>error.code==='WBS_CONTROL_SNAPSHOT_METRICS_HASH_INVALID');
  const propertyScope={tenant_id:ids.tenantId,entity_id:ids.entityId,company_key:ids.sourceEntityId,property_ref:'PROPERTY-001',period_start:'2026-08-01',period_end:'2026-08-31',currency:'USD',bank_account_ref:'BANK-001'};
  const propertyReceipt={...receipt,scope:propertyScope};
  await assert.rejects(kernel.persistWbsControlMetricSnapshot({tenantId:ids.tenantId,entityId:ids.entityId,sourceType:'PROPERTY_COMPARISON',scope:propertyScope,receiptId:inbound.receipt_id,receipt:propertyReceipt,metrics,idempotencyKey:'wbs-control-cross-source-0001'}),error=>error.code==='22023');
  assert.equal((await adminPool.query('SELECT count(*)::int n FROM journal_entry WHERE tenant_id=$1',[ids.tenantId])).rows[0].n,journalsBefore);
});

pgTest('WBS Property Comparison metrics retain property and bank scope as non-transactional control evidence',async()=>{
  const ids=await seed({status:'DRAFT'}),snapshotId=randomUUID(),capturedAt=new Date().toISOString();
  const journalsBefore=(await adminPool.query('SELECT count(*)::int n FROM journal_entry WHERE tenant_id=$1',[ids.tenantId])).rows[0].n;
  const snapshot={schema_version:'WBS_READONLY_SNAPSHOT_V1',snapshot_id:snapshotId,captured_at:capturedAt,environment:'SANDBOX',source_system:'WBS',dictionary_version:'WBS-DICT-PROPERTY',views:[{name:'BGDATA.payable',company_key:ids.sourceEntityId,rows:[{apGuId:randomUUID(),ap_type:'AUTOC'}]}]};
  snapshot.views=snapshot.views.map(view=>({...view,content_hash:canonicalRequestHash(view.rows)}));snapshot.package_hash=canonicalRequestHash(snapshot);
  const kernel=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'property-control-importer',['WBS.SNAPSHOT.IMPORT'])});
  const observed=await kernel.recordWbsSnapshot({tenantId:ids.tenantId,entityId:ids.entityId,snapshot,idempotencyKey:'snapshot-property-control-0001'});
  const inboundReceipt={payload_hash:hash('property-control-receipt'),payload_ref:`object://wbs-snapshot/${snapshotId}/inbound/PROPERTY`};
  const rows=[{source_record_id:'PROPERTY-CONTROL',source_version:`snapshot:${snapshotId}:PROPERTY-CONTROL`,raw:{record_id:'PROPERTY-CONTROL',company_key:ids.sourceEntityId},normalized:{source_type:'PROPERTY_COMPARISON',source_record_id:'PROPERTY-CONTROL',source_version:`snapshot:${snapshotId}:PROPERTY-CONTROL`,company_key:ids.sourceEntityId,receipt_hash:inboundReceipt.payload_hash,receipt_ref:inboundReceipt.payload_ref},outcome:{stage:'CONTROL_EVIDENCE_ONLY'},outcome_kind:'EXCEPTION'}];
  const inboundKey='wbs-property-inbound-0001',inboundHash=canonicalRequestHash({tenant_id:ids.tenantId,entity_id:ids.entityId,import_batch_id:observed.import_batch_id,receipt:inboundReceipt,rows,idempotency_key:inboundKey});
  const inbound=await kernel.persistWbsInboundRows({tenantId:ids.tenantId,entityId:ids.entityId,importBatchId:observed.import_batch_id,receipt:inboundReceipt,rows,idempotencyKey:inboundKey,requestHash:inboundHash});
  const scope={tenant_id:ids.tenantId,entity_id:ids.entityId,company_key:ids.sourceEntityId,property_ref:'PROPERTY-001',period_start:'2026-08-01',period_end:'2026-08-31',currency:'USD',bank_account_ref:'BANK-001'};
  const metrics=[{metric_key:'PROPERTY_VALUE',amount:'100.0000'}],receipt={hash:inboundReceipt.payload_hash,metrics_hash:canonicalRequestHash(metrics),ref:inboundReceipt.payload_ref,version:'v1',scope,signature_verified:true,manifest_hash:hash('property-control-manifest'),key_id:'wbs-property-key',algorithm:'Ed25519'};
  const bindingHash=canonicalRequestHash({sourceType:'PROPERTY_COMPARISON',scope,receiptId:inbound.receipt_id,receipt,metrics});
  const created=await kernel.persistWbsControlMetricSnapshot({tenantId:ids.tenantId,entityId:ids.entityId,sourceType:'PROPERTY_COMPARISON',scope,receiptId:inbound.receipt_id,receipt,metrics,idempotencyKey:bindingHash,bindingHash});
  await assert.rejects(kernel.readPersistedWbsControlSnapshot({source_type:'PROPERTY_COMPARISON',tenant_id:ids.tenantId,entity_id:ids.entityId,scope,read_only:true}),error=>error.code==='42501');
  const reader=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'property-control-reader',['WBS.AUTOREC.VIEW'])});
  const read=await reader.readPersistedWbsControlSnapshot({source_type:'PROPERTY_COMPARISON',tenant_id:ids.tenantId,entity_id:ids.entityId,scope,read_only:true});
  assert.deepEqual({id:read.snapshot_id===created.snapshot_id,property:read.scope.property_ref,bank:read.scope.bank_account_ref,draft:read.can_create_draft,post:read.can_post},{id:true,property:'PROPERTY-001',bank:'BANK-001',draft:false,post:false});
  assert.equal((await adminPool.query('SELECT count(*)::int n FROM journal_entry WHERE tenant_id=$1',[ids.tenantId])).rows[0].n,journalsBefore);
});

pgTest('WBS AutoRec mapping read retains its immutable snapshot and effective window',async()=>{
  const ids=await seed({status:'DRAFT'});
  const inputKeys={company_key:ids.sourceEntityId,source_type:'BANK_TRANSACTION',currency:'USD',bank_account_ref:'BANK-1'};
  const mappingId=randomUUID();
  const hashes=(await adminPool.query("SELECT refs_jsonb_hash($1::jsonb) AS input_key_hash,refs_jsonb_hash(jsonb_build_object('input_keys',$1::jsonb,'output_rules','{}'::jsonb)) AS snapshot_hash",[JSON.stringify(inputKeys)])).rows[0];
  await adminPool.query(`INSERT INTO mapping_snapshot(mapping_snapshot_id,tenant_id,entity_id,family,scope_type,scope_key,input_key_hash,version,priority,effective_from,effective_to,status,input_keys,output_rules,snapshot_hash,created_by,approved_by,approved_at)
    VALUES($1,$2,$3::uuid,'WBS_AUTOREC','ENTITY',($3::uuid)::text,$4,7,0,'2026-01-01T00:00:00.000Z',NULL,'APPROVED',$5::jsonb,'{}'::jsonb,$6,'mapping-maker','mapping-approver',now())`,[mappingId,ids.tenantId,ids.entityId,hashes.input_key_hash,JSON.stringify(inputKeys),hashes.snapshot_hash]);
  const kernel=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'autorec-reader',['WBS.AUTOREC.VIEW'])});
  const mappings=await kernel.readApprovedWbsAutoRecMappings({tenantId:ids.tenantId,entityId:ids.entityId,companyKey:ids.sourceEntityId,read_only:true});
  const mapping=mappings.find(row=>row.mapping_id===mappingId);
  assert.deepEqual({snapshot_hash:mapping?.snapshot_hash,effective_from:mapping?.effective_from,effective_to:mapping?.effective_to,source_type:mapping?.source_type,currency:mapping?.currency,bank_account_ref:mapping?.bank_account_ref},{snapshot_hash:hashes.snapshot_hash,effective_from:'2026-01-01T00:00:00+00:00',effective_to:null,source_type:'BANK_TRANSACTION',currency:'USD',bank_account_ref:'BANK-1'});
});

pgTest('WBS AutoRec mapping read retains a retired mapping only as closed-period evidence',async()=>{
  const ids=await seed({status:'DRAFT'});
  const inputKeys={company_key:ids.sourceEntityId,source_type:'PAYABLE',currency:'USD',bank_account_ref:'BANK-1'};
  const mappingId=randomUUID();
  const hashes=(await adminPool.query("SELECT refs_jsonb_hash($1::jsonb) AS input_key_hash,refs_jsonb_hash(jsonb_build_object('input_keys',$1::jsonb,'output_rules','{}'::jsonb)) AS snapshot_hash",[JSON.stringify(inputKeys)])).rows[0];
  await adminPool.query(`INSERT INTO mapping_snapshot(mapping_snapshot_id,tenant_id,entity_id,family,scope_type,scope_key,input_key_hash,version,priority,effective_from,effective_to,status,input_keys,output_rules,snapshot_hash,created_by,retired_by,retired_at,retire_reason,lifecycle_revision)
    VALUES($1,$2,$3::uuid,'WBS_AUTOREC','ENTITY',($3::uuid)::text,$4,8,0,'2025-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z','RETIRED',$5::jsonb,'{}'::jsonb,$6,'mapping-maker','mapping-retirer',now(),'Historical source evidence only',1)`,[mappingId,ids.tenantId,ids.entityId,hashes.input_key_hash,JSON.stringify(inputKeys),hashes.snapshot_hash]);
  const kernel=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'autorec-history-reader',['WBS.AUTOREC.VIEW'])});
  const mapping=(await kernel.readApprovedWbsAutoRecMappings({tenantId:ids.tenantId,entityId:ids.entityId,companyKey:ids.sourceEntityId,read_only:true})).find(row=>row.mapping_id===mappingId);
  assert.deepEqual({status:mapping?.status,snapshot_hash:mapping?.snapshot_hash,effective_from:mapping?.effective_from,effective_to:mapping?.effective_to},{status:'RETIRED',snapshot_hash:hashes.snapshot_hash,effective_from:'2025-01-01T00:00:00+00:00',effective_to:'2026-01-01T00:00:00+00:00'});
});

pgTest('WBS AutoRec matching-policy reader returns only approved immutable scoped rule evidence',async()=>{
  const ids=await seed({status:'DRAFT'}),policyId=randomUUID();
  const inputKeys={company_key:ids.sourceEntityId,currency:'USD',bank_account_ref:'BANK-1'};
  const outputRules={rule_id:'WBS-MATCH-1',rule_version:'1',bank_mapping_id:'bank-map',bank_mapping_version:'2',bank_mapping_snapshot_hash:hash('bank-map'),business_mapping_id:'pay-map',business_mapping_version:'3',business_mapping_snapshot_hash:hash('pay-map'),amount_tolerance:'0.0100',date_window_days:'3',date_match_basis:'BUSINESS_AND_ACCOUNTING'};
  const hashes=(await adminPool.query("SELECT refs_jsonb_hash($1::jsonb) AS input_key_hash,refs_jsonb_hash(jsonb_build_object('input_keys',$1::jsonb,'output_rules',$2::jsonb)) AS snapshot_hash",[JSON.stringify(inputKeys),JSON.stringify(outputRules)])).rows[0];
  await adminPool.query(`INSERT INTO mapping_snapshot(mapping_snapshot_id,tenant_id,entity_id,family,scope_type,scope_key,input_key_hash,version,priority,effective_from,effective_to,status,input_keys,output_rules,snapshot_hash,created_by,approved_by,approved_at)
    VALUES($1,$2,$3::uuid,'WBS_AUTOREC_MATCH','ENTITY',($3::uuid)::text,$4,1,0,'2026-01-01T00:00:00.000Z',NULL,'APPROVED',$5::jsonb,$6::jsonb,$7,'policy-maker','policy-approver',now())`,[policyId,ids.tenantId,ids.entityId,hashes.input_key_hash,JSON.stringify(inputKeys),JSON.stringify(outputRules),hashes.snapshot_hash]);
  const kernel=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'policy-reader',['WBS.AUTOREC.VIEW'])});
  const policy=(await kernel.readApprovedWbsAutoRecMatchingPolicies({tenantId:ids.tenantId,entityId:ids.entityId,companyKey:ids.sourceEntityId,read_only:true})).find(row=>row.policy_id===policyId);
  assert.deepEqual({rule:policy?.rule_id,tolerance:policy?.amount_tolerance,window:policy?.date_window_days,basis:policy?.date_match_basis,hash:policy?.policy_snapshot_hash},{rule:'WBS-MATCH-1',tolerance:'0.0100',window:'3',basis:'BUSINESS_AND_ACCOUNTING',hash:hashes.snapshot_hash});
});

pgTest('WBS AutoRec matching-policy reader retains a retired rule only for closed-period evidence',async()=>{
  const ids=await seed({status:'DRAFT'}),policyId=randomUUID();
  const inputKeys={company_key:ids.sourceEntityId,currency:'USD',bank_account_ref:'BANK-1'};
  const outputRules={rule_id:'WBS-MATCH-HISTORICAL',rule_version:'7',bank_mapping_id:'bank-map',bank_mapping_version:'2',bank_mapping_snapshot_hash:hash('bank-map'),business_mapping_id:'pay-map',business_mapping_version:'4',business_mapping_snapshot_hash:hash('pay-map'),amount_tolerance:'0.0000',date_window_days:'3',date_match_basis:'ACCOUNTING_ONLY'};
  const hashes=(await adminPool.query("SELECT refs_jsonb_hash($1::jsonb) AS input_key_hash,refs_jsonb_hash(jsonb_build_object('input_keys',$1::jsonb,'output_rules',$2::jsonb)) AS snapshot_hash",[JSON.stringify(inputKeys),JSON.stringify(outputRules)])).rows[0];
  await adminPool.query(`INSERT INTO mapping_snapshot(mapping_snapshot_id,tenant_id,entity_id,family,scope_type,scope_key,input_key_hash,version,priority,effective_from,effective_to,status,input_keys,output_rules,snapshot_hash,created_by,retired_by,retired_at,retire_reason,lifecycle_revision)
    VALUES($1,$2,$3::uuid,'WBS_AUTOREC_MATCH','ENTITY',($3::uuid)::text,$4,7,0,'2025-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z','RETIRED',$5::jsonb,$6::jsonb,$7,'policy-maker','policy-retirer',now(),'Closed-period trace only',1)`,[policyId,ids.tenantId,ids.entityId,hashes.input_key_hash,JSON.stringify(inputKeys),JSON.stringify(outputRules),hashes.snapshot_hash]);
  const kernel=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'policy-history-reader',['WBS.AUTOREC.VIEW'])});
  const policy=(await kernel.readApprovedWbsAutoRecMatchingPolicies({tenantId:ids.tenantId,entityId:ids.entityId,companyKey:ids.sourceEntityId,read_only:true})).find(row=>row.policy_id===policyId);
  assert.deepEqual({status:policy?.status,from:policy?.effective_from,to:policy?.effective_to,rule:policy?.rule_id},{status:'RETIRED',from:'2025-01-01T00:00:00+00:00',to:'2026-01-01T00:00:00+00:00',rule:'WBS-MATCH-HISTORICAL'});
});

pgTest('WBS AutoRec observed state evidence is receipt-bound history, not a REFS workflow command',async()=>{
  const ids=await seed({status:'DRAFT'}),snapshotId=randomUUID(),capturedAt=new Date().toISOString();
  const journalsBefore=(await adminPool.query('SELECT count(*)::int n FROM journal_entry WHERE tenant_id=$1',[ids.tenantId])).rows[0].n;
  const snapshot={schema_version:'WBS_READONLY_SNAPSHOT_V1',snapshot_id:snapshotId,captured_at:capturedAt,environment:'SANDBOX',source_system:'WBS',dictionary_version:'WBS-DICT-AUTOREC',views:[{name:'BGDATA.payable',company_key:ids.sourceEntityId,rows:[{apGuId:randomUUID(),ap_type:'AUTOC'}]}]};
  snapshot.views=snapshot.views.map(view=>({...view,content_hash:canonicalRequestHash(view.rows)}));snapshot.package_hash=canonicalRequestHash(snapshot);
  const kernel=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'autorec-observation-importer',['WBS.SNAPSHOT.IMPORT'])});
  const observed=await kernel.recordWbsSnapshot({tenantId:ids.tenantId,entityId:ids.entityId,snapshot,idempotencyKey:'snapshot-autorec-observation-0001'});
  const receipt={payload_hash:hash('autorec-observation-receipt'),payload_ref:`object://wbs-snapshot/${snapshotId}/inbound/AUTOREC-DETAIL`};
  const rows=[{source_record_id:'PD-OBSERVED-001',source_version:`snapshot:${snapshotId}:PD-OBSERVED-001`,raw:{record_id:'PD-OBSERVED-001',company_key:ids.sourceEntityId},normalized:{source_type:'AUTOREC_PAYMENT_DETAIL',source_record_id:'PD-OBSERVED-001',source_version:`snapshot:${snapshotId}:PD-OBSERVED-001`,company_key:ids.sourceEntityId,receipt_hash:receipt.payload_hash,receipt_ref:receipt.payload_ref},outcome:{stage:'REVIEW_ONLY'},outcome_kind:'EXCEPTION'}];
  const inboundKey='wbs-autorec-observation-inbound-0001',inboundHash=canonicalRequestHash({tenant_id:ids.tenantId,entity_id:ids.entityId,import_batch_id:observed.import_batch_id,receipt,rows,idempotency_key:inboundKey});
  const inbound=await kernel.persistWbsInboundRows({tenantId:ids.tenantId,entityId:ids.entityId,importBatchId:observed.import_batch_id,receipt,rows,idempotencyKey:inboundKey,requestHash:inboundHash});
  const observations=[{company_key:ids.sourceEntityId,source_record_id:'PD-OBSERVED-001',source_version:rows[0].source_version,receipt_id:inbound.receipt_id,receipt_hash:receipt.payload_hash,observed_at:'2026-08-10T12:00:00Z',observed_state:'RELEASED',observed_workflow_step:'DATA_PROCESSING_RELEASE',source_status_code:'Released',source_match_status_code:'Matched'}];
  const bindingHash=canonicalRequestHash({tenantId:ids.tenantId,entityId:ids.entityId,observations});
  const created=await kernel.persistWbsAutoRecObservedStateEvidence({tenantId:ids.tenantId,entityId:ids.entityId,observations,idempotencyKey:bindingHash,bindingHash});
  assert.deepEqual({accepted:created.accepted_count,release:created.can_release,incur:created.can_incur,post:created.can_post},{accepted:1,release:false,incur:false,post:false});
  const replay=await kernel.persistWbsAutoRecObservedStateEvidence({tenantId:ids.tenantId,entityId:ids.entityId,observations,idempotencyKey:bindingHash,bindingHash});assert.equal(replay.idempotent,true);
  await assert.rejects(kernel.readWbsAutoRecObservedStateEvidence({tenantId:ids.tenantId,entityId:ids.entityId,companyKey:ids.sourceEntityId,sourceRecordIds:['PD-OBSERVED-001'],read_only:true}),error=>error.code==='42501');
  const reader=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'autorec-observation-reader',['WBS.AUTOREC.VIEW'])});
  const read=await reader.readWbsAutoRecObservedStateEvidence({tenantId:ids.tenantId,entityId:ids.entityId,companyKey:ids.sourceEntityId,sourceRecordIds:['PD-OBSERVED-001'],read_only:true});
  assert.deepEqual({count:read.length,state:read[0].observed_state,step:read[0].observed_workflow_step,post:read[0].can_post},{count:1,state:'RELEASED',step:'DATA_PROCESSING_RELEASE',post:false});
  await assert.rejects(kernel.persistWbsAutoRecObservedStateEvidence({tenantId:ids.tenantId,entityId:ids.entityId,observations,idempotencyKey:'wbs-autorec-observation-forged-0001',bindingHash:hash('forged-state-binding')}),error=>error.code==='WBS_AUTOREC_OBSERVED_STATE_HASH_INVALID');
  assert.equal((await adminPool.query('SELECT count(*)::int n FROM journal_entry WHERE tenant_id=$1',[ids.tenantId])).rows[0].n,journalsBefore);
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

pgTest('WBS test importer grant bootstraps v1 then upgrades through v4 and remains restart-idempotent',async()=>{
  const ids=await seed(),sync=new PostgresGrantSync(grantSyncPool,{principalProvider:async()=>({trusted:true,serviceId:'platform-iam-sync'})});
  const actors={importer:'wbs-bootstrap-importer',maker:'wbs-bootstrap-maker',submitter:'wbs-bootstrap-submitter',reviewer:'wbs-bootstrap-reviewer',approver:'wbs-bootstrap-approver',poster:'wbs-bootstrap-poster'};
  const scope={tenantId:ids.tenantId,entityId:ids.entityId,companyCode:'WBPA',actors};
  const legacy=await sync.reconcile({tenantId:ids.tenantId,entityId:ids.entityId,actorId:actors.importer,permissions:['WBS.TEST.IMPORT'],expectedVersion:0,idempotencyKey:'wbs-test-import-importer-grant-v1'});
  assert.equal(legacy.version,1);assert.equal(legacy.idempotent,false);
  const upgraded=await reconcileWbsTestImportActorGrants({scope,grantSync:sync});
  assert.equal(upgraded.importer.version,4);assert.equal(upgraded.importer.idempotent,false);
  const restarted=await reconcileWbsTestImportActorGrants({scope,grantSync:sync});
  assert.equal(restarted.importer.version,4);assert.equal(restarted.importer.idempotent,true);
  assert.deepEqual((await adminPool.query(`SELECT version FROM runtime_actor_grant_set WHERE tenant_id=$1 AND actor_id=$2 AND entity_id=$3`,[ids.tenantId,actors.importer,ids.entityId])).rows[0],{version:'4'});
  assert.deepEqual((await adminPool.query(`SELECT permission FROM runtime_actor_grant WHERE tenant_id=$1 AND actor_id=$2 AND entity_id=$3 AND revoked_at IS NULL ORDER BY permission`,[ids.tenantId,actors.importer,ids.entityId])).rows.map(row=>row.permission),['AP.VIEW','BANK.MATCH.CREATE','BANK.RECONCILIATION.START','BANK.VIEW','WBS.TEST.IMPORT']);
  assert.deepEqual((await adminPool.query(`SELECT idempotency_key FROM runtime_grant_sync_receipt WHERE tenant_id=$1 AND actor_id=$2 AND entity_id=$3 ORDER BY idempotency_key`,[ids.tenantId,actors.importer,ids.entityId])).rows.map(row=>row.idempotency_key),['wbs-test-import-importer-grant-v1','wbs-test-import-importer-grant-v2','wbs-test-import-importer-grant-v3','wbs-test-import-importer-grant-v4']);
  assert.equal((await adminPool.query(`SELECT count(*)::int n FROM audit_event WHERE tenant_id=$1 AND entity_id=$2 AND event_type='ACTOR_GRANTS_RECONCILED'`,[ids.tenantId,ids.entityId])).rows[0].n,19);
});

pgTest('Stage 1 provisioning creates only minimal read scope, replays exactly and grants the observed OIDC subject',async()=>{
  const tenantId=randomUUID(),entityId=randomUUID(),periodId=randomUUID();
  const environment={
    NODE_ENV:'production',REFS_DEPLOYMENT_ENV:'staging',REFS_STAGE1_BOOTSTRAP_CONFIRM:'STAGE1_AUTHORITATIVE_ONLY',
    REFS_STAGE1_TENANT_ID:tenantId,REFS_STAGE1_TENANT_CODE:`T${tenantId.replaceAll('-','').slice(0,8)}`.toUpperCase(),REFS_STAGE1_TENANT_NAME:'Stage 1 tenant',
    REFS_STAGE1_ENTITY_ID:entityId,REFS_STAGE1_ENTITY_CODE:`E${entityId.replaceAll('-','').slice(0,8)}`.toUpperCase(),REFS_STAGE1_ENTITY_NAME:'Stage 1 entity',
    REFS_STAGE1_PERIOD_ID:periodId,REFS_STAGE1_PERIOD_CODE:'2026-08',REFS_STAGE1_PERIOD_START:'2026-08-01',REFS_STAGE1_PERIOD_END:'2026-08-31',
    REFS_STAGE1_BASE_CURRENCY:'USD',REFS_STAGE1_CASH_ACCOUNT_CODE:'111000',REFS_STAGE1_PROVISION_IDEMPOTENCY_KEY:'stage1-provision-pg-0001',
    REFS_STAGE1_OIDC_SUBJECT:'auth0|observed-stage1-subject',REFS_STAGE1_GRANT_EXPECTED_VERSION:'0',REFS_STAGE1_GRANT_IDEMPOTENCY_KEY:'stage1-grant-pg-0001',
  };
  const provision=stage1ProvisionConfig(environment),grant=stage1GrantConfig(environment);
  await assert.rejects(provisionStage1Scope(runtimePool,provision),error=>error.code==='STAGE1_BOOTSTRAP_DB_IDENTITY_DENIED');
  const created=await provisionStage1Scope(adminPool,provision,{allowTestIdentity:true});
  assert.deepEqual(created,{idempotent:false,tenantCount:1,entityCount:1,periodCount:1,accountCount:3,auditCount:1});
  const replay=await provisionStage1Scope(adminPool,provision,{allowTestIdentity:true});
  assert.equal(replay.idempotent,true);
  await assert.rejects(provisionStage1Scope(adminPool,{...provision,entityName:'Conflicting entity name'},{allowTestIdentity:true}),error=>error.code==='STAGE1_BOOTSTRAP_IDEMPOTENCY_CONFLICT');
  assert.deepEqual((await adminPool.query('SELECT (SELECT count(*)::int FROM tenant) tenants,(SELECT count(*)::int FROM entity) entities,(SELECT count(*)::int FROM accounting_period) periods,(SELECT count(*)::int FROM account_master) accounts,(SELECT count(*)::int FROM audit_event WHERE event_type=\'STAGE1_SCOPE_PROVISIONED\') provision_audits')).rows[0],{tenants:1,entities:1,periods:1,accounts:3,provision_audits:1});
  await assert.rejects(grantStage1ReadAccess(adminPool,grant),error=>error.code==='GRANT_SYNC_DB_IDENTITY_DENIED');
  await assert.rejects(grantStage1ReadAccess(grantSyncPool,grant,{principalProvider:async()=>({trusted:false,serviceId:'platform-iam-sync'})}),error=>error.code==='GRANT_SYNC_PRINCIPAL_DENIED');
  const granted=await grantStage1ReadAccess(grantSyncPool,grant);
  assert.deepEqual(granted,{idempotent:false,version:1,permissionCount:5});
  const grantReplay=await grantStage1ReadAccess(grantSyncPool,grant);
  assert.equal(grantReplay.idempotent,true);
  const permissions=(await adminPool.query('SELECT permission FROM runtime_actor_grant WHERE tenant_id=$1 AND entity_id=$2 AND actor_id=$3 AND revoked_at IS NULL ORDER BY permission',[tenantId,entityId,grant.actorId])).rows.map(row=>row.permission);
  assert.deepEqual(permissions,STAGE1_READ_PERMISSIONS);
  assert.equal((await adminPool.query("SELECT count(*)::int n FROM audit_event WHERE tenant_id=$1 AND entity_id=$2 AND event_type IN ('STAGE1_SCOPE_PROVISIONED','ACTOR_GRANTS_RECONCILED')",[tenantId,entityId])).rows[0].n,2);
});

pgTest('Stage 1 WBS operator self-upgrade adds only exception retain and replays concurrently without widening grants',async()=>{
  const ids=await seed(),actor='auth0|stage1-operator-reader';
  const sync=new PostgresGrantSync(grantSyncPool,{principalProvider:async()=>({trusted:true,serviceId:'platform-iam-sync'})});
  await sync.reconcile({tenantId:ids.tenantId,actorId:actor,entityId:ids.entityId,permissions:STAGE1_READ_PERMISSIONS,expectedVersion:0,idempotencyKey:'operator-seed-read-0001'});
  await upgradeStage1WbsReadAccess(grantSyncPool,{tenantId:ids.tenantId,entityId:ids.entityId,actorId:actor,expectedVersion:1,permissions:[...STAGE1_READ_PERMISSIONS,'WBS.AUTOREC.VIEW'],idempotencyKey:'operator-seed-wbs-0001'});
  const input={tenantId:ids.tenantId,entityId:ids.entityId,actorId:actor,expectedVersion:2,permissions:STAGE1_WBS_OPERATOR_PERMISSIONS,idempotencyKey:'operator-upgrade-0001'};
  const [first,replay]=await Promise.all([upgradeStage1WbsOperatorAccess(grantSyncPool,input),upgradeStage1WbsOperatorAccess(grantSyncPool,input)]);
  assert.equal(first.version,3);assert.equal([first.idempotent,replay.idempotent].filter(Boolean).length,1);
  const permissions=(await adminPool.query('SELECT permission FROM runtime_actor_grant WHERE tenant_id=$1 AND entity_id=$2 AND actor_id=$3 AND revoked_at IS NULL ORDER BY permission',[ids.tenantId,ids.entityId,actor])).rows.map(row=>row.permission);
  assert.deepEqual(permissions,[...STAGE1_WBS_OPERATOR_PERMISSIONS].sort());
  await assert.rejects(upgradeStage1WbsOperatorAccess(grantSyncPool,{...input,idempotencyKey:'operator-upgrade-0002'}),error=>error.code==='40001');
  await assert.rejects(upgradeStage1WbsOperatorAccess(adminPool,{...input,idempotencyKey:'operator-upgrade-0003'}),error=>error.code==='GRANT_SYNC_DB_IDENTITY_DENIED');
  await adminPool.query("UPDATE runtime_actor_grant SET revoked_at=now() WHERE tenant_id=$1 AND entity_id=$2 AND actor_id=$3 AND permission='WBS.PAYABLE.OPERATOR_ATTEST'",[ids.tenantId,ids.entityId,actor]);
  await assert.rejects(upgradeStage1WbsOperatorAccess(grantSyncPool,input),error=>error.code==='42501');
});

pgTest('controlled test workflow self-upgrade requires exact version-3 operator grants and replays at version 4',async()=>{
  const ids=await seed(),actor='auth0|controlled-test-operator';
  const sync=new PostgresGrantSync(grantSyncPool,{principalProvider:async()=>({trusted:true,serviceId:'platform-iam-sync'})});
  await sync.reconcile({tenantId:ids.tenantId,actorId:actor,entityId:ids.entityId,permissions:STAGE1_READ_PERMISSIONS,expectedVersion:0,idempotencyKey:'controlled-seed-read-0001'});
  await upgradeStage1WbsReadAccess(grantSyncPool,{tenantId:ids.tenantId,entityId:ids.entityId,actorId:actor,expectedVersion:1,permissions:[...STAGE1_READ_PERMISSIONS,'WBS.AUTOREC.VIEW'],idempotencyKey:'controlled-seed-wbs-0001'});
  await upgradeStage1WbsOperatorAccess(grantSyncPool,{tenantId:ids.tenantId,entityId:ids.entityId,actorId:actor,expectedVersion:2,permissions:STAGE1_WBS_OPERATOR_PERMISSIONS,idempotencyKey:'controlled-seed-operator-0001'});
  const input={tenantId:ids.tenantId,entityId:ids.entityId,actorId:actor,expectedVersion:3,permissions:STAGE1_CONTROLLED_TEST_WORKFLOW_PERMISSIONS,idempotencyKey:'controlled-workflow-upgrade-0001'};
  const created=await upgradeStage1ControlledTestWorkflowAccess(grantSyncPool,input),replay=await upgradeStage1ControlledTestWorkflowAccess(grantSyncPool,input);
  assert.deepEqual(created,{idempotent:false,version:4,permissionCount:22});assert.equal(replay.idempotent,true);assert.equal(replay.version,4);
  const permissions=(await adminPool.query('SELECT permission FROM runtime_actor_grant WHERE tenant_id=$1 AND entity_id=$2 AND actor_id=$3 AND revoked_at IS NULL ORDER BY permission',[ids.tenantId,ids.entityId,actor])).rows.map(row=>row.permission);
  assert.deepEqual(permissions,[...STAGE1_CONTROLLED_TEST_WORKFLOW_PERMISSIONS].sort());
  assert.equal((await adminPool.query('SELECT count(*)::int n FROM runtime_grant_sync_receipt WHERE tenant_id=$1 AND entity_id=$2 AND actor_id=$3',[ids.tenantId,ids.entityId,actor])).rows[0].n,4);
  await assert.rejects(upgradeStage1ControlledTestWorkflowAccess(grantSyncPool,{...input,idempotencyKey:'controlled-workflow-upgrade-0002'}),error=>error.code==='40001');
  const other=await seed(),otherActor='auth0|different-version-three';
  await sync.reconcile({tenantId:other.tenantId,actorId:otherActor,entityId:other.entityId,permissions:['AP.VIEW'],expectedVersion:0,idempotencyKey:'controlled-other-v1-0001'});
  await sync.reconcile({tenantId:other.tenantId,actorId:otherActor,entityId:other.entityId,permissions:['AP.VIEW','AR.VIEW'],expectedVersion:1,idempotencyKey:'controlled-other-v2-0001'});
  await sync.reconcile({tenantId:other.tenantId,actorId:otherActor,entityId:other.entityId,permissions:['AP.VIEW','AR.VIEW','BANK.VIEW'],expectedVersion:2,idempotencyKey:'controlled-other-v3-0001'});
  await assert.rejects(upgradeStage1ControlledTestWorkflowAccess(grantSyncPool,{tenantId:other.tenantId,entityId:other.entityId,actorId:otherActor,expectedVersion:3,permissions:STAGE1_CONTROLLED_TEST_WORKFLOW_PERMISSIONS,idempotencyKey:'controlled-other-upgrade-0001'}),error=>error.code==='42501');
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

pgTest('retained AI decision requires human acceptance and creates only a standard Draft atomically',async()=>{
  const ids=await seed({status:'DRAFT'}),sourceLineId=randomUUID(),auto=await attachAutoSource(ids,{linkJournal:false,sourceModule:'payable',sourceRecordPrefix:'AI-DECISION'}),sourceDocumentId=auto.documentId;
  const attachmentId=(await adminPool.query('SELECT attachment_id FROM source_link WHERE journal_entry_id=$1 AND attachment_id IS NOT NULL',[ids.journalId])).rows[0].attachment_id;
  await adminPool.query("UPDATE source_document SET document_type='INVOICE',status='READY_FOR_DRAFT',gross_amount=125 WHERE source_document_id=$1",[sourceDocumentId]);
  await adminPool.query("INSERT INTO source_document_line(source_document_line_id,tenant_id,entity_id,source_document_id,source_line_id,line_no,description,amount,direction,party_ref) VALUES($1,$2,$3,$4,'1',1,'AI decision source',125,'NONE','VENDOR-1')",[sourceLineId,ids.tenantId,ids.entityId,sourceDocumentId]);
  await adminPool.query("INSERT INTO source_link(tenant_id,entity_id,link_type,source_document_id,attachment_id,created_by) VALUES($1,$2,'SOURCE_ATTACHMENT',$3,$4,'provider')",[ids.tenantId,ids.entityId,sourceDocumentId,attachmentId]);
  const packet={schema_version:'AI_ACCOUNTING_DECISION_PACKET_V1',status:'READY_FOR_HUMAN_REVIEW',tenant_id:ids.tenantId,entity_id:ids.entityId,company_code:ids.sourceEntityId,accounting_period_id:ids.periodId,accounting_date:'2026-07-16',settings_snapshot_id:randomUUID(),source:{source_document_id:sourceDocumentId,source_document_line_id:sourceLineId,currency:'USD'},reason:'Approved settings classify the retained invoice.',proposed_journal:{lines:[{line_number:1,side:'DEBIT',account_code:'111000',amount:'125.0000',member_ref:'BANK-1',project_ref:null,property_ref:null,cost_code_ref:null},{line_number:2,side:'CREDIT',account_code:'291001',amount:'125.0000',member_ref:'VENDOR-1',project_ref:null,property_ref:null,cost_code_ref:null}]},action_flags:{can_create_draft:false,can_review:false,can_approve:false,can_post:false}};
  const producer=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'ai-controller',['AI.ANALYSIS.EXPLAIN'])});
  const retained=await producer.retainAiAccountingDecision({tenantId:ids.tenantId,entityId:ids.entityId,packet,idempotencyKey:'retain-ai-decision-pg-1'});
  assert.equal(retained.packet_status,'READY_FOR_HUMAN_REVIEW');assert.equal(retained.can_create_draft,false);
  const maker=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'human-ai-maker',['GL.JE.CREATE'])});
  await assert.rejects(maker.createAiAccountingDecisionDraft({tenantId:ids.tenantId,entityId:ids.entityId,decisionId:retained.ai_accounting_decision_id,expectedDecisionHash:retained.decision_hash,expectedAcceptanceHash:hash('missing'),reason:'Attempt before acceptance must fail.',idempotencyKey:'draft-before-accept'}));
  const accepted=await maker.humanDecideAiAccounting({tenantId:ids.tenantId,entityId:ids.entityId,decisionId:retained.ai_accounting_decision_id,expectedDecisionHash:retained.decision_hash,expectedRevision:0,outcome:'ACCEPTED',reason:'Human maker verified source, accounts, dimensions, and period.',idempotencyKey:'accept-ai-decision-pg-1'});
  const draft=await maker.createAiAccountingDecisionDraft({tenantId:ids.tenantId,entityId:ids.entityId,decisionId:retained.ai_accounting_decision_id,expectedDecisionHash:retained.decision_hash,expectedAcceptanceHash:accepted.evidence_hash,reason:'Create standard Draft for separate workflow.',idempotencyKey:'draft-ai-decision-pg-1'});
  assert.equal(draft.status,'DRAFT');assert.equal((await adminPool.query('SELECT status FROM journal_entry WHERE journal_entry_id=$1',[draft.journal_entry_id])).rows[0].status,'DRAFT');
  assert.equal((await adminPool.query('SELECT count(*)::int n FROM ledger_line WHERE journal_entry_id=$1',[draft.journal_entry_id])).rows[0].n,0);
  assert.equal((await adminPool.query('SELECT count(*)::int n FROM ai_accounting_decision_draft_evidence WHERE journal_entry_id=$1',[draft.journal_entry_id])).rows[0].n,1);
});

pgTest('AI decision run retains the whole population atomically with one actor-bound root replay',async()=>{
  const ids=await seed({status:'DRAFT'}),first=await attachAutoSource(ids,{linkJournal:false,sourceModule:'payable',sourceRecordPrefix:'AI-BATCH-1'}),second=await attachAutoSource(ids,{linkJournal:false,sourceModule:'bankFeed',sourceRecordPrefix:'AI-BATCH-2',reuseApprovedSnapshots:true}),settingsId=randomUUID();
  const packet=(sourceDocumentId,overrides={})=>({schema_version:'AI_ACCOUNTING_DECISION_PACKET_V1',status:'READY_FOR_HUMAN_REVIEW',tenant_id:ids.tenantId,entity_id:ids.entityId,company_code:ids.sourceEntityId,accounting_period_id:ids.periodId,accounting_date:'2026-07-16',settings_snapshot_id:settingsId,source:{source_document_id:sourceDocumentId,source_document_line_id:randomUUID(),currency:'USD'},reason:'Approved settings classify retained source evidence.',proposed_journal:{lines:[]},action_flags:{can_create_draft:false,can_review:false,can_approve:false,can_post:false},...overrides});
  const kernel=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'ai-batch-controller',['AI.ANALYSIS.EXPLAIN'])}),baseline=async()=>(await adminPool.query("SELECT (SELECT count(*)::int FROM ai_accounting_decision WHERE tenant_id=$1) decisions,(SELECT count(*)::int FROM audit_event WHERE tenant_id=$1 AND event_type='AI_ACCOUNTING_DECISION_RETAINED') audits,(SELECT count(*)::int FROM outbox_event WHERE tenant_id=$1 AND event_type='AI_ACCOUNTING_DECISION_RETAINED') outbox,(SELECT count(*)::int FROM idempotency_receipt WHERE tenant_id=$1 AND operation_scope LIKE 'AI_ACCOUNTING_DECISION%') receipts",[ids.tenantId])).rows[0],before=await baseline();
  const firstPacket=packet(first.documentId);
  await assert.rejects(kernel.retainAiAccountingDecisionBatch({tenantId:ids.tenantId,entityId:ids.entityId,accountingPeriodId:ids.periodId,packets:[firstPacket,firstPacket],idempotencyKey:'ai-batch-duplicate-packet-001'}),error=>error.code==='23514');
  assert.deepEqual(await baseline(),before,'duplicate canonical packets must write no decision, audit, outbox, or root/child receipt');
  await assert.rejects(kernel.retainAiAccountingDecisionBatch({tenantId:ids.tenantId,entityId:ids.entityId,accountingPeriodId:ids.periodId,packets:[firstPacket,packet(first.documentId,{reason:'A distinct packet still cannot decide the same retained source twice.'})],idempotencyKey:'ai-batch-duplicate-source-001'}),error=>error.code==='23514');
  assert.deepEqual(await baseline(),before,'different packets for one retained source must write no decision, audit, outbox, or root/child receipt');
  const unsafe=packet(second.documentId,{action_flags:{can_create_draft:false,can_review:false,can_approve:false,can_post:true}});
  await assert.rejects(kernel.retainAiAccountingDecisionBatch({tenantId:ids.tenantId,entityId:ids.entityId,accountingPeriodId:ids.periodId,packets:[packet(first.documentId),unsafe],idempotencyKey:'ai-batch-rollback-001'}),error=>error.code==='23514');
  assert.deepEqual(await baseline(),before,'a later unsafe packet must roll back prior decision, audit, outbox, and child/root receipts');
  const rootKey='x'.repeat(200),packets=[packet(first.documentId),packet(second.documentId)],created=await kernel.retainAiAccountingDecisionBatch({tenantId:ids.tenantId,entityId:ids.entityId,accountingPeriodId:ids.periodId,packets,idempotencyKey:rootKey}),replay=await kernel.retainAiAccountingDecisionBatch({tenantId:ids.tenantId,entityId:ids.entityId,accountingPeriodId:ids.periodId,packets,idempotencyKey:rootKey});
  assert.equal(created.row_count,2);assert.equal(created.idempotent,false);assert.equal(replay.idempotent,true);assert.deepEqual(replay.receipts.map(row=>row.ai_accounting_decision_id),created.receipts.map(row=>row.ai_accounting_decision_id));assert.deepEqual(await baseline(),{decisions:2,audits:2,outbox:2,receipts:3});
  const otherActor=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'ai-batch-other',['AI.ANALYSIS.EXPLAIN'])});await assert.rejects(otherActor.retainAiAccountingDecisionBatch({tenantId:ids.tenantId,entityId:ids.entityId,accountingPeriodId:ids.periodId,packets,idempotencyKey:rootKey}),error=>error.code==='23505');
  await assert.rejects(kernel.retainAiAccountingDecisionBatch({tenantId:ids.tenantId,entityId:ids.entityId,accountingPeriodId:ids.periodId,packets:[packets[0]],idempotencyKey:rootKey}),error=>error.code==='23505');
});

pgTest('retained WBS Payable and approved settings drive the production AI decision through human Post reports and outcome review',async()=>{
  const ids=await seed({status:'DRAFT',extraAccounts:[{accountCode:'610000',accountName:'Operating expense'}]}),wbs=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'wbs-ai-e2e-importer',['WBS.SNAPSHOT.IMPORT'])});
  const retainedSource=await retainFinal1PayableFixture({pool:adminPool,kernel:wbs,ids});assert.equal(retainedSource.receipt.row_count,1);const settings=await installApprovedAiSettingsFixture({pool:adminPool,ids,companyCode:ids.sourceEntityId});
  await adminPool.query('ALTER TABLE source_link DISABLE TRIGGER USER');
  const aiKernel=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'ai-e2e-controller',['AI.ANALYSIS.EXPLAIN','AI.ACCOUNTING.SETTINGS.VIEW','AI.AMORTIZATION.VIEW'])}),settingsAdapter=createAiAccountingApprovedSettingsAdapter({settingsReader:({tenantId,entityId,periodId})=>aiKernel.readApprovedWbsAiEntityPeriodSettings({tenantId,entityId,periodId,readOnly:true}),accountMasterReader:scope=>aiKernel.readAiAccountMasterBindings(scope)}),classification=createAiInvoiceAccountingClassificationService({classificationInputReader:scope=>aiKernel.readAiInvoiceClassificationSource(scope),duplicateFindingReader:({tenantId,entityId,accountingPeriodId,limit})=>aiKernel.listAiDuplicatePayableFindingsForPeriod({tenantId,entityId,periodId:accountingPeriodId,limit}),capitalizationPolicyReader:scope=>settingsAdapter.readCapitalizationPolicy(scope)}),decisionService=createAiAccountingApprovedDecisionService({sourceReader:scope=>aiKernel.readAiInvoiceClassificationSource(scope),classificationService:classification,scheduleReader:scope=>aiKernel.listAiAmortizationSchedules(scope),settingsAdapter});
  const pendingAttachmentId=randomUUID();await adminPool.query(`INSERT INTO attachment(attachment_id,tenant_id,entity_id,name,media_type,size_bytes,content_hash,storage_ref,storage_version,uploaded_by,uploaded_at,scan_status,finalization_status) VALUES($1,$2,$3,'pending-support.pdf','application/pdf',10,$4,$5,'pending-support-v1','wbs-provider',now(),'PENDING','PENDING')`,[pendingAttachmentId,ids.tenantId,ids.entityId,hash('pending-support'),`s3://refs-wbs-ai-e2e/${pendingAttachmentId}`]);await adminPool.query("INSERT INTO source_link(tenant_id,entity_id,link_type,source_document_id,attachment_id,created_by) VALUES($1,$2,'SOURCE_ATTACHMENT',$3,$4,'wbs-provider')",[ids.tenantId,ids.entityId,retainedSource.sourceDocumentId,pendingAttachmentId]);let unsafe=await decisionService.analyze({tenantId:ids.tenantId,entityId:ids.entityId,accountingPeriodId:ids.periodId,limit:10});assert.equal(unsafe.packets[0].classification,'BLOCKED');assert.equal(unsafe.packets[0].source.completeness_status,'INCOMPLETE');assert.equal(unsafe.packets[0].source.source_detail.execution_evidence.attachments.length,2);assert.deepEqual(unsafe.packets[0].proposed_journal.lines,[]);await adminPool.query('ALTER TABLE source_link DISABLE TRIGGER USER');await adminPool.query('DELETE FROM source_link WHERE source_document_id=$1 AND attachment_id=$2',[retainedSource.sourceDocumentId,pendingAttachmentId]);await adminPool.query('ALTER TABLE source_link ENABLE TRIGGER USER');
  await adminPool.query("UPDATE account_master SET active=false WHERE tenant_id=$1 AND entity_id=$2 AND account_code='291001'",[ids.tenantId,ids.entityId]);await assert.rejects(decisionService.analyze({tenantId:ids.tenantId,entityId:ids.entityId,accountingPeriodId:ids.periodId,limit:10}),error=>error.code==='AI_ACCOUNTING_ACCOUNT_MASTER_INVALID');await adminPool.query("UPDATE account_master SET active=true,required_member_type='CUSTOMER' WHERE tenant_id=$1 AND entity_id=$2 AND account_code='291001'",[ids.tenantId,ids.entityId]);await assert.rejects(decisionService.analyze({tenantId:ids.tenantId,entityId:ids.entityId,accountingPeriodId:ids.periodId,limit:10}),error=>error.code==='AI_ACCOUNTING_ACCOUNT_MASTER_INVALID');await adminPool.query("UPDATE account_master SET required_member_type='VENDOR' WHERE tenant_id=$1 AND entity_id=$2 AND account_code='291001'",[ids.tenantId,ids.entityId]);
  await adminPool.query("UPDATE member_master SET active=false WHERE tenant_id=$1 AND entity_id=$2 AND member_ref='VENDOR-1'",[ids.tenantId,ids.entityId]);unsafe=await decisionService.analyze({tenantId:ids.tenantId,entityId:ids.entityId,accountingPeriodId:ids.periodId,limit:10});assert.equal(unsafe.packets[0].classification,'BLOCKED');assert.deepEqual(unsafe.packets[0].proposed_journal.lines,[]);assert.deepEqual(unsafe.packets[0].expected_report_deltas,[]);
  await adminPool.query("UPDATE member_master SET active=true,member_type='CUSTOMER' WHERE tenant_id=$1 AND entity_id=$2 AND member_ref='VENDOR-1'",[ids.tenantId,ids.entityId]);unsafe=await decisionService.analyze({tenantId:ids.tenantId,entityId:ids.entityId,accountingPeriodId:ids.periodId,limit:10});assert.equal(unsafe.packets[0].classification,'BLOCKED');assert.deepEqual(unsafe.packets[0].proposed_journal.lines,[]);
  await adminPool.query("UPDATE member_master SET member_type='VENDOR' WHERE tenant_id=$1 AND entity_id=$2 AND member_ref='VENDOR-1'",[ids.tenantId,ids.entityId]);const batch=await decisionService.analyze({tenantId:ids.tenantId,entityId:ids.entityId,accountingPeriodId:ids.periodId,limit:10});assert.equal(batch.row_count,1);assert.equal(batch.packets[0].classification,'EXPENSE',JSON.stringify(batch.packets[0]));assert.equal(batch.packets[0].settings_snapshot_id,settings.settingsSnapshotId);assert.equal(batch.packets[0].source.admission_status,'ADMITTED');assert.deepEqual(batch.packets[0].proposed_journal.lines.map(row=>[row.account_code,row.side,row.amount,row.member_ref]),[['610000','DEBIT','125.0000',null],['291001','CREDIT','125.0000','VENDOR-1']]);
  const run=await aiKernel.retainAiAccountingDecisionBatch({tenantId:ids.tenantId,entityId:ids.entityId,accountingPeriodId:ids.periodId,packets:batch.packets,idempotencyKey:'wbs-ai-decision-run-e2e-001'}),decision=run.receipts[0];assert.equal(decision.packet_status,'READY_FOR_HUMAN_REVIEW');assert.equal(decision.source_document_id,batch.packets[0].source.source_document_id);assert.equal((await aiKernel.retainAiAccountingDecisionBatch({tenantId:ids.tenantId,entityId:ids.entityId,accountingPeriodId:ids.periodId,packets:batch.packets,idempotencyKey:'wbs-ai-decision-run-e2e-001'})).idempotent,true);
  const maker=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'AP_PREPARER',['GL.JE.CREATE'])}),accepted=await maker.humanDecideAiAccounting({tenantId:ids.tenantId,entityId:ids.entityId,decisionId:decision.ai_accounting_decision_id,expectedDecisionHash:decision.decision_hash,expectedRevision:0,outcome:'ACCEPTED',reason:'Human maker verified retained WBS source and approved settings.',idempotencyKey:'wbs-ai-human-accept-e2e-001'}),draftArtifacts=async()=>(await adminPool.query("SELECT (SELECT count(*)::int FROM ai_accounting_decision_draft_evidence WHERE ai_accounting_decision_id=$1) evidence,(SELECT count(*)::int FROM audit_event WHERE object_id=$1 AND event_type='AI_ACCOUNTING_DECISION_DRAFT_CREATED') audit,(SELECT count(*)::int FROM outbox_event WHERE aggregate_id=$1 AND event_type='AI_ACCOUNTING_DECISION_DRAFT_CREATED') outbox,(SELECT count(*)::int FROM idempotency_receipt WHERE operation_scope=$2) receipts",[decision.ai_accounting_decision_id,`AI_ACCOUNTING_DECISION_DRAFT:${ids.entityId}`])).rows[0],beforeDraft=await draftArtifacts();
  const duplicateCandidate=await attachAutoSource(ids,{linkJournal:false,sourceModule:'bankFeed',sourceRecordPrefix:'AI-LATE-DUP',reuseApprovedSnapshots:true}),duplicateDocs=(await adminPool.query('SELECT source_document_id,payload_hash,version FROM source_document WHERE tenant_id=$1 AND entity_id=$2 AND source_document_id=ANY($3::uuid[]) ORDER BY source_document_id::text',[ids.tenantId,ids.entityId,[retainedSource.sourceDocumentId,duplicateCandidate.documentId]])).rows;assert.equal(duplicateDocs.length,2);const duplicateFindingId=randomUUID();await adminPool.query("INSERT INTO ai_duplicate_payable_finding(ai_duplicate_payable_finding_id,tenant_id,entity_id,source_document_id,candidate_source_document_id,source_payload_hash,source_document_version,candidate_payload_hash,candidate_document_version,match_key_hash,finding_hash,rule_id,risk_level,confidence,reason,suggested_action,suggested_owner,due_date_status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'DUPLICATE_PAYABLE_EXACT','HIGH',1.0000,'A later exact duplicate source requires renewed human review.','Stop Draft creation and investigate the retained duplicate evidence.','CONTROLLER','HUMAN_ASSIGNMENT_REQUIRED')",[duplicateFindingId,ids.tenantId,ids.entityId,duplicateDocs[0].source_document_id,duplicateDocs[1].source_document_id,duplicateDocs[0].payload_hash,duplicateDocs[0].version,duplicateDocs[1].payload_hash,duplicateDocs[1].version,hash('late-duplicate-match'),hash('late-duplicate-finding')]);await assert.rejects(maker.createAiAccountingDecisionDraft({tenantId:ids.tenantId,entityId:ids.entityId,decisionId:decision.ai_accounting_decision_id,expectedDecisionHash:decision.decision_hash,expectedAcceptanceHash:accepted.evidence_hash,reason:'A later duplicate finding must invalidate the stale decision.',idempotencyKey:'wbs-ai-draft-duplicate-drift'}),error=>error.code==='40001');assert.deepEqual(await draftArtifacts(),beforeDraft);await adminPool.query('ALTER TABLE ai_duplicate_payable_finding DISABLE TRIGGER USER');await adminPool.query('DELETE FROM ai_duplicate_payable_finding WHERE ai_duplicate_payable_finding_id=$1',[duplicateFindingId]);await adminPool.query('ALTER TABLE ai_duplicate_payable_finding ENABLE TRIGGER USER');
  await assert.rejects(maker.createAiAccountingDecisionDraft({tenantId:ids.tenantId,entityId:ids.entityId,decisionId:decision.ai_accounting_decision_id,expectedDecisionHash:decision.decision_hash,expectedAcceptanceHash:accepted.evidence_hash,reason:null,idempotencyKey:'wbs-ai-draft-null-reason'}),error=>error.code==='22023');assert.deepEqual(await draftArtifacts(),beforeDraft);
  const driftAttachmentId=randomUUID();await adminPool.query(`INSERT INTO attachment(attachment_id,tenant_id,entity_id,name,media_type,size_bytes,content_hash,storage_ref,storage_version,uploaded_by,uploaded_at,verified_at,scan_status,finalization_status,finalized_at) VALUES($1,$2,$3,'late-clean-support.pdf','application/pdf',10,$4,$5,'late-clean-v1','wbs-provider',now(),now(),'CLEAN','VERIFIED_CLEAN',now())`,[driftAttachmentId,ids.tenantId,ids.entityId,hash('late-clean-support'),`s3://refs-wbs-ai-e2e/${driftAttachmentId}`]);await adminPool.query("INSERT INTO source_link(tenant_id,entity_id,link_type,source_document_id,attachment_id,created_by) VALUES($1,$2,'SOURCE_ATTACHMENT',$3,$4,'wbs-provider')",[ids.tenantId,ids.entityId,retainedSource.sourceDocumentId,driftAttachmentId]);await assert.rejects(maker.createAiAccountingDecisionDraft({tenantId:ids.tenantId,entityId:ids.entityId,decisionId:decision.ai_accounting_decision_id,expectedDecisionHash:decision.decision_hash,expectedAcceptanceHash:accepted.evidence_hash,reason:'Attachment-set drift must fail closed.',idempotencyKey:'wbs-ai-draft-attachment-drift'}),error=>error.code==='40001');assert.deepEqual(await draftArtifacts(),beforeDraft);await adminPool.query('ALTER TABLE source_link DISABLE TRIGGER USER');await adminPool.query('DELETE FROM source_link WHERE source_document_id=$1 AND attachment_id=$2',[retainedSource.sourceDocumentId,driftAttachmentId]);await adminPool.query('ALTER TABLE source_link ENABLE TRIGGER USER');
  await adminPool.query("UPDATE account_master SET active=false WHERE tenant_id=$1 AND entity_id=$2 AND account_code='291001'",[ids.tenantId,ids.entityId]);await assert.rejects(maker.createAiAccountingDecisionDraft({tenantId:ids.tenantId,entityId:ids.entityId,decisionId:decision.ai_accounting_decision_id,expectedDecisionHash:decision.decision_hash,expectedAcceptanceHash:accepted.evidence_hash,reason:'Account-master drift must fail closed.',idempotencyKey:'wbs-ai-draft-account-drift'}),error=>error.code==='40001');assert.deepEqual(await draftArtifacts(),beforeDraft);await adminPool.query("UPDATE account_master SET active=true WHERE tenant_id=$1 AND entity_id=$2 AND account_code='291001'",[ids.tenantId,ids.entityId]);
  await adminPool.query("INSERT INTO source_link(tenant_id,entity_id,link_type,source_document_id,journal_entry_id,created_by) VALUES($1,$2,'SOURCE_TO_JE',$3,$4,'parallel-booking-maker')",[ids.tenantId,ids.entityId,retainedSource.sourceDocumentId,ids.journalId]);await assert.rejects(maker.createAiAccountingDecisionDraft({tenantId:ids.tenantId,entityId:ids.entityId,decisionId:decision.ai_accounting_decision_id,expectedDecisionHash:decision.decision_hash,expectedAcceptanceHash:accepted.evidence_hash,reason:'A later initial booking must prevent a duplicate Draft.',idempotencyKey:'wbs-ai-draft-booking-drift'}),error=>error.code==='40001');assert.deepEqual(await draftArtifacts(),beforeDraft);await adminPool.query('ALTER TABLE source_link DISABLE TRIGGER USER');await adminPool.query("DELETE FROM source_link WHERE source_document_id=$1 AND journal_entry_id=$2 AND created_by='parallel-booking-maker'",[retainedSource.sourceDocumentId,ids.journalId]);await adminPool.query('ALTER TABLE source_link ENABLE TRIGGER USER');
  const originalPayloadHash=(await adminPool.query('SELECT payload_hash FROM source_document WHERE source_document_id=$1',[retainedSource.sourceDocumentId])).rows[0].payload_hash;await adminPool.query('ALTER TABLE source_document DISABLE TRIGGER USER');await adminPool.query('UPDATE source_document SET payload_hash=$2 WHERE source_document_id=$1',[retainedSource.sourceDocumentId,hash('source-payload-drift')]);await adminPool.query('ALTER TABLE source_document ENABLE TRIGGER USER');await assert.rejects(maker.createAiAccountingDecisionDraft({tenantId:ids.tenantId,entityId:ids.entityId,decisionId:decision.ai_accounting_decision_id,expectedDecisionHash:decision.decision_hash,expectedAcceptanceHash:accepted.evidence_hash,reason:'Retained source drift must fail closed.',idempotencyKey:'wbs-ai-draft-source-drift'}),error=>error.code==='40001');assert.deepEqual(await draftArtifacts(),beforeDraft);await adminPool.query('ALTER TABLE source_document DISABLE TRIGGER USER');await adminPool.query('UPDATE source_document SET payload_hash=$2 WHERE source_document_id=$1',[retainedSource.sourceDocumentId,originalPayloadHash]);await adminPool.query('ALTER TABLE source_document ENABLE TRIGGER USER');
  const restoredBatch=await decisionService.analyze({tenantId:ids.tenantId,entityId:ids.entityId,accountingPeriodId:ids.periodId,limit:10});assert.equal(restoredBatch.packets[0].status,'READY_FOR_HUMAN_REVIEW',JSON.stringify(restoredBatch.packets[0]));assert.equal(restoredBatch.packets[0].source.source_payload_hash,batch.packets[0].source.source_payload_hash);assert.equal(restoredBatch.packets[0].source.source_line_hash,batch.packets[0].source.source_line_hash);
  const concurrentAttachmentId=randomUUID();await adminPool.query(`INSERT INTO attachment(attachment_id,tenant_id,entity_id,name,media_type,size_bytes,content_hash,storage_ref,storage_version,uploaded_by,uploaded_at,verified_at,scan_status,finalization_status,finalized_at) VALUES($1,$2,$3,'concurrent-clean-support.pdf','application/pdf',10,$4,$5,'concurrent-clean-v1','wbs-provider',now(),now(),'CLEAN','VERIFIED_CLEAN',now())`,[concurrentAttachmentId,ids.tenantId,ids.entityId,hash('concurrent-clean-support'),`s3://refs-wbs-ai-e2e/${concurrentAttachmentId}`]);await adminPool.query(`CREATE OR REPLACE FUNCTION refs_test_pause_ai_draft() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.journal_number LIKE 'AI-DEC-%' THEN PERFORM pg_advisory_xact_lock(257257); END IF; RETURN NEW; END $$`);await adminPool.query('CREATE TRIGGER refs_test_pause_ai_draft BEFORE INSERT ON journal_entry FOR EACH ROW EXECUTE FUNCTION refs_test_pause_ai_draft()');const pause=await adminPool.connect();await pause.query('SELECT pg_advisory_lock(257257)');const draftPromise=maker.createAiAccountingDecisionDraft({tenantId:ids.tenantId,entityId:ids.entityId,decisionId:decision.ai_accounting_decision_id,expectedDecisionHash:decision.decision_hash,expectedAcceptanceHash:accepted.evidence_hash,reason:'Create the standard human-controlled Draft.',idempotencyKey:'wbs-ai-draft-e2e-001'});let waiting=false;for(let attempt=0;attempt<100&&!waiting;attempt++){waiting=(await adminPool.query("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%refs_create_ai_accounting_decision_draft%') waiting")).rows[0].waiting;if(!waiting)await new Promise(resolve=>setTimeout(resolve,25));}assert.equal(waiting,true,'Draft must reach the paused insert while retaining its evidence locks');const mustBlock=async(sql,args)=>{const client=await adminPool.connect();try{await client.query('BEGIN');await client.query("SET LOCAL statement_timeout='250ms'");await assert.rejects(client.query(sql,args),error=>error.code==='57014');await client.query('ROLLBACK');}finally{try{await client.query('ROLLBACK');}catch{}client.release();}};try{await mustBlock('UPDATE source_document_line SET amount=amount WHERE source_document_line_id=$1',[batch.packets[0].source.source_document_line_id]);await mustBlock('DELETE FROM source_link WHERE source_document_id=$1 AND attachment_id=$2',[retainedSource.sourceDocumentId,retainedSource.attachmentId]);await mustBlock("INSERT INTO source_link(tenant_id,entity_id,link_type,source_document_id,attachment_id,created_by) VALUES($1,$2,'SOURCE_ATTACHMENT',$3,$4,'concurrent-writer')",[ids.tenantId,ids.entityId,retainedSource.sourceDocumentId,concurrentAttachmentId]);await mustBlock("INSERT INTO source_link(tenant_id,entity_id,link_type,source_document_id,journal_entry_id,created_by) VALUES($1,$2,'SOURCE_TO_JE',$3,$4,'concurrent-booking-maker')",[ids.tenantId,ids.entityId,retainedSource.sourceDocumentId,ids.journalId]);await mustBlock('UPDATE attachment SET storage_version=storage_version WHERE attachment_id=$1',[retainedSource.attachmentId]);await mustBlock("UPDATE account_master SET active=active WHERE tenant_id=$1 AND entity_id=$2 AND account_code='291001'",[ids.tenantId,ids.entityId]);}finally{await pause.query('SELECT pg_advisory_unlock(257257)');pause.release();}const draft=await draftPromise;await adminPool.query('DROP TRIGGER refs_test_pause_ai_draft ON journal_entry');await adminPool.query('DROP FUNCTION refs_test_pause_ai_draft()');assert.equal(draft.status,'DRAFT');
  const submitter=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'AP_PREPARER',['GL.JE.SUBMIT'])}),reviewer=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'AP_REVIEWER',['GL.JE.REVIEW'])}),approver=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'CONTROLLER',['GL.JE.APPROVE'])}),poster=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'GL_POSTER',['GL.JE.POST'])});
  await submitter.transitionJournal({...ids,journalEntryId:draft.journal_entry_id,action:'SUBMIT',expectedRevision:0,idempotencyKey:'wbs-ai-submit-e2e-001'});await reviewer.transitionJournal({...ids,journalEntryId:draft.journal_entry_id,action:'REVIEW',expectedRevision:1,idempotencyKey:'wbs-ai-review-e2e-001'});await approver.transitionJournal({...ids,journalEntryId:draft.journal_entry_id,action:'APPROVE',expectedRevision:2,idempotencyKey:'wbs-ai-approve-e2e-001'});await poster.postJournal({...ids,journalEntryId:draft.journal_entry_id,periodId:ids.periodId,expectedRevision:3,idempotencyKey:'wbs-ai-post-e2e-001'});
  const reportMaker=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'wbs-ai-e2e-report-maker',['GL.REPORT.SNAPSHOT.PREPARE','GL.REPORT.VIEW'])}),proposal=await reportMaker.prepareFinancialStatementSnapshot({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId,idempotencyKey:'wbs-ai-report-prepare-e2e-001'}),reportApprover=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'wbs-ai-e2e-report-approver',['GL.REPORT.SNAPSHOT.APPROVE'])});await reportApprover.approveFinancialStatementSnapshot({tenantId:ids.tenantId,entityId:ids.entityId,proposalId:proposal.financial_statement_snapshot_proposal_id,idempotencyKey:'wbs-ai-report-approve-e2e-001'});
  const outcome=await aiKernel.retainAiAccountingPostedOutcomeReview({tenantId:ids.tenantId,entityId:ids.entityId,decisionId:decision.ai_accounting_decision_id,expectedDecisionHash:decision.decision_hash,expectedReviewRevision:-1,idempotencyKey:'wbs-ai-outcome-e2e-001'});assert.equal(outcome.status,'CONSISTENT',JSON.stringify(outcome));assert.equal(outcome.evidence.journal_entry_id,draft.journal_entry_id);assert.equal(outcome.evidence.decision_hash,decision.decision_hash);assert.equal(outcome.can_post,false);
});

pgTest('server-derived AI Posted outcome review binds decision human workflow ledger trial balance and report atomically',async()=>{
  const ids=await seed({status:'DRAFT'}),sourceLineId=randomUUID(),auto=await attachAutoSource(ids,{linkJournal:false,sourceModule:'payable',sourceRecordPrefix:'AI-OUTCOME'}),sourceDocumentId=auto.documentId;
  const attachmentId=(await adminPool.query('SELECT attachment_id FROM source_link WHERE journal_entry_id=$1 AND attachment_id IS NOT NULL',[ids.journalId])).rows[0].attachment_id;
  await adminPool.query("UPDATE source_document SET document_type='INVOICE',status='READY_FOR_DRAFT',gross_amount=125 WHERE source_document_id=$1",[sourceDocumentId]);
  await adminPool.query("INSERT INTO source_document_line(source_document_line_id,tenant_id,entity_id,source_document_id,source_line_id,line_no,description,amount,direction,party_ref) VALUES($1,$2,$3,$4,'1',1,'AI outcome source',125,'NONE','VENDOR-1')",[sourceLineId,ids.tenantId,ids.entityId,sourceDocumentId]);
  await adminPool.query("INSERT INTO source_link(tenant_id,entity_id,link_type,source_document_id,attachment_id,created_by) VALUES($1,$2,'SOURCE_ATTACHMENT',$3,$4,'provider')",[ids.tenantId,ids.entityId,sourceDocumentId,attachmentId]);
  const settingsId=randomUUID(),settingsHash=hash('ai-outcome-settings'),sourceLineHash=hash('ai-outcome-source-line'),policy=(account_code,account_class,account_type,normal_balance)=>({account_code,account_class,account_type,normal_balance,contra:false,report_statement:'BALANCE_SHEET',cash_flow_classification:'NONE',required_dimensions:['MEMBER'],optional_dimensions:[],effective_from:'2026-01-01',effective_to:null,settings_snapshot_id:settingsId,settings_snapshot_hash:settingsHash}),line=(line_number,side,account_code,account_class,account_type,member_ref)=>({line_number,side,account_code,account_class,account_type,amount:'125.0000',currency:'USD',member_ref,project_ref:null,property_ref:null,cost_code_ref:null,dimension_requirements:['MEMBER'],source_document_id:sourceDocumentId,source_document_line_id:sourceLineId,source_line_hash:sourceLineHash}),delta=(account_code,account_class,member_ref)=>({statement:'BALANCE_SHEET',cash_flow_classification:'NONE',accounting_period_id:ids.periodId,account_code,account_class,currency:'USD',project_ref:null,property_ref:null,member_ref,cost_code_ref:null,source_document_line_id:sourceLineId,direction:'INCREASE',amount:'125.0000'});
  const packet={schema_version:'AI_ACCOUNTING_DECISION_PACKET_V1',status:'READY_FOR_HUMAN_REVIEW',tenant_id:ids.tenantId,entity_id:ids.entityId,company_code:ids.sourceEntityId,accounting_period_id:ids.periodId,accounting_date:'2026-07-16',settings_snapshot_id:settingsId,settings_snapshot_hash:settingsHash,source:{source_document_id:sourceDocumentId,source_document_line_id:sourceLineId,source_line_hash:sourceLineHash,currency:'USD',cash_direction:'NON_CASH'},reason:'Approved settings classify the retained invoice.',approved_account_policies:[policy('111000','ASSET','CASH','DEBIT'),policy('291001','LIABILITY','ACCOUNTS_PAYABLE','CREDIT')],proposed_journal:{lines:[line(1,'DEBIT','111000','ASSET','CASH','BANK-1'),line(2,'CREDIT','291001','LIABILITY','ACCOUNTS_PAYABLE','VENDOR-1')]},expected_report_deltas:[delta('111000','ASSET','BANK-1'),delta('291001','LIABILITY','VENDOR-1')],action_flags:{can_create_draft:false,can_review:false,can_approve:false,can_post:false}};
  const producer=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'ai-outcome-producer',['AI.ANALYSIS.EXPLAIN'])}),retained=await producer.retainAiAccountingDecision({tenantId:ids.tenantId,entityId:ids.entityId,packet,idempotencyKey:'retain-ai-outcome-pg-1'});
  const maker=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'ai-outcome-maker',['GL.JE.CREATE','GL.JE.SUBMIT'])}),accepted=await maker.humanDecideAiAccounting({tenantId:ids.tenantId,entityId:ids.entityId,decisionId:retained.ai_accounting_decision_id,expectedDecisionHash:retained.decision_hash,expectedRevision:0,outcome:'ACCEPTED',reason:'Human maker verified the exact retained decision.',idempotencyKey:'accept-ai-outcome-pg-1'}),draft=await maker.createAiAccountingDecisionDraft({tenantId:ids.tenantId,entityId:ids.entityId,decisionId:retained.ai_accounting_decision_id,expectedDecisionHash:retained.decision_hash,expectedAcceptanceHash:accepted.evidence_hash,reason:'Create standard Draft for human workflow.',idempotencyKey:'draft-ai-outcome-pg-1'});
  await maker.transitionJournal({tenantId:ids.tenantId,entityId:ids.entityId,journalEntryId:draft.journal_entry_id,action:'SUBMIT',expectedRevision:0,idempotencyKey:'submit-ai-outcome-pg-1'});
  const reviewer=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'ai-outcome-reviewer',['GL.JE.REVIEW'])});await reviewer.transitionJournal({tenantId:ids.tenantId,entityId:ids.entityId,journalEntryId:draft.journal_entry_id,action:'REVIEW',expectedRevision:1,idempotencyKey:'review-ai-outcome-pg-1'});
  const approver=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'ai-outcome-approver',['GL.JE.APPROVE'])});await approver.transitionJournal({tenantId:ids.tenantId,entityId:ids.entityId,journalEntryId:draft.journal_entry_id,action:'APPROVE',expectedRevision:2,idempotencyKey:'approve-ai-outcome-pg-1'});
  const poster=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'ai-outcome-poster',['GL.JE.POST'])});await poster.postJournal({...ids,journalEntryId:draft.journal_entry_id,expectedRevision:3,idempotencyKey:'post-ai-outcome-pg-1'});
  const snapshotPreparer=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'ai-outcome-report-preparer',['GL.REPORT.SNAPSHOT.PREPARE','GL.REPORT.VIEW'])}),proposal=await snapshotPreparer.prepareFinancialStatementSnapshot({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId,idempotencyKey:'prepare-ai-outcome-report-pg-1'}),snapshotApprover=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'ai-outcome-report-approver',['GL.REPORT.SNAPSHOT.APPROVE'])});await snapshotApprover.approveFinancialStatementSnapshot({tenantId:ids.tenantId,entityId:ids.entityId,proposalId:proposal.financial_statement_snapshot_proposal_id,idempotencyKey:'approve-ai-outcome-report-pg-1'});
  const outcomeReviewer=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'ai-outcome-auditor',['AI.ANALYSIS.EXPLAIN'])}),outcome=await outcomeReviewer.retainAiAccountingPostedOutcomeReview({tenantId:ids.tenantId,entityId:ids.entityId,decisionId:retained.ai_accounting_decision_id,expectedDecisionHash:retained.decision_hash,expectedReviewRevision:-1,idempotencyKey:'retain-ai-posted-outcome-pg-1'});
  assert.equal(outcome.status,'CONSISTENT',JSON.stringify(outcome));assert.deepEqual(outcome.reason_codes,[]);assert.equal(outcome.can_create_draft,false);assert.equal(outcome.can_review,false);assert.equal(outcome.can_approve,false);assert.equal(outcome.can_post,false);
  assert.equal((await adminPool.query('SELECT count(*)::int n FROM ai_accounting_posted_outcome_review WHERE ai_accounting_decision_id=$1',[retained.ai_accounting_decision_id])).rows[0].n,1);
  assert.equal((await adminPool.query("SELECT count(*)::int n FROM audit_event WHERE object_id=$1 AND event_type='AI_ACCOUNTING_POSTED_OUTCOME_REVIEWED'",[retained.ai_accounting_decision_id])).rows[0].n,1);
  assert.equal((await adminPool.query("SELECT count(*)::int n FROM outbox_event WHERE aggregate_id=$1 AND event_type='AI_ACCOUNTING_POSTED_OUTCOME_REVIEWED'",[outcome.ai_accounting_posted_outcome_review_id])).rows[0].n,1);
  const replay=await outcomeReviewer.retainAiAccountingPostedOutcomeReview({tenantId:ids.tenantId,entityId:ids.entityId,decisionId:retained.ai_accounting_decision_id,expectedDecisionHash:retained.decision_hash,expectedReviewRevision:-1,idempotencyKey:'retain-ai-posted-outcome-pg-1'});assert.equal(replay.idempotent,true);assert.equal(replay.ai_accounting_posted_outcome_review_id,outcome.ai_accounting_posted_outcome_review_id);
  await assert.rejects(()=>outcomeReviewer.retainAiAccountingPostedOutcomeReview({tenantId:ids.tenantId,entityId:ids.entityId,decisionId:retained.ai_accounting_decision_id,expectedDecisionHash:retained.decision_hash,expectedReviewRevision:-1,idempotencyKey:'retain-ai-posted-outcome-pg-cas'}),/revision conflict/i);
  const history=await outcomeReviewer.listAiAccountingPostedOutcomeReviews({tenantId:ids.tenantId,entityId:ids.entityId,decisionId:retained.ai_accounting_decision_id,limit:10});assert.equal(history.length,1);assert.equal(history[0].review_revision,0);assert.equal(history[0].can_post,false);await assert.rejects(()=>outcomeReviewer.listAiAccountingPostedOutcomeReviews({tenantId:ids.tenantId,entityId:ids.entityId,decisionId:randomUUID(),limit:10}),/not found/i);

  const snapshotId=(await adminPool.query('SELECT financial_statement_snapshot_id FROM financial_statement_snapshot WHERE tenant_id=$1 AND entity_id=$2 AND period_id=$3 ORDER BY version DESC LIMIT 1',[ids.tenantId,ids.entityId,ids.periodId])).rows[0].financial_statement_snapshot_id;
  await adminPool.query('ALTER TABLE financial_statement_snapshot_row DISABLE TRIGGER USER');
  await adminPool.query("UPDATE financial_statement_snapshot_row SET period_debit=period_debit+1,ending_debit=ending_debit+1,display_balance=display_balance+1 WHERE financial_statement_snapshot_id=$1 AND account_code='111000'",[snapshotId]);
  await adminPool.query(`UPDATE financial_statement_snapshot_row SET row_hash=refs_jsonb_hash(jsonb_build_object('statement_type',statement_type,'statement_section',statement_section,'classification_basis',classification_basis,'account_code',account_code,'account_name',account_name,'opening_debit',opening_debit,'opening_credit',opening_credit,'period_debit',period_debit,'period_credit',period_credit,'ending_debit',ending_debit,'ending_credit',ending_credit,'display_balance',display_balance,'journal_entry_ids',journal_entry_ids,'journal_line_ids',journal_line_ids,'ledger_line_ids',ledger_line_ids,'source_document_ids',source_document_ids)) WHERE financial_statement_snapshot_id=$1`,[snapshotId]);
  await adminPool.query('ALTER TABLE financial_statement_snapshot_row ENABLE TRIGGER USER');
  await adminPool.query('ALTER TABLE financial_statement_snapshot DISABLE TRIGGER USER');
  await adminPool.query(`WITH rows AS (SELECT COALESCE(jsonb_agg(jsonb_build_object('statement_type',statement_type,'statement_section',statement_section,'classification_basis',classification_basis,'account_code',account_code,'account_name',account_name,'opening_debit',opening_debit,'opening_credit',opening_credit,'period_debit',period_debit,'period_credit',period_credit,'ending_debit',ending_debit,'ending_credit',ending_credit,'display_balance',display_balance,'journal_entry_ids',journal_entry_ids,'journal_line_ids',journal_line_ids,'ledger_line_ids',ledger_line_ids,'source_document_ids',source_document_ids) ORDER BY statement_type,statement_section,account_code),'[]'::jsonb) value FROM financial_statement_snapshot_row WHERE financial_statement_snapshot_id=$1) UPDATE financial_statement_snapshot SET snapshot_hash=refs_jsonb_hash(rows.value),ledger_evidence_hash=refs_jsonb_hash(jsonb_build_object('statement_rows',rows.value)) FROM rows WHERE financial_statement_snapshot_id=$1`,[snapshotId]);
  await adminPool.query('ALTER TABLE financial_statement_snapshot ENABLE TRIGGER USER');
  const wrongSnapshot=await outcomeReviewer.retainAiAccountingPostedOutcomeReview({tenantId:ids.tenantId,entityId:ids.entityId,decisionId:retained.ai_accounting_decision_id,expectedDecisionHash:retained.decision_hash,expectedReviewRevision:0,idempotencyKey:'retain-ai-posted-outcome-pg-snapshot-value-drift'});assert.equal(wrongSnapshot.status,'MISMATCH');assert.ok(wrongSnapshot.reason_codes.includes('REPORT_SNAPSHOT_MISMATCH'));assert.equal(wrongSnapshot.evidence.report_snapshot_exact,false);

  await adminPool.query('ALTER TABLE ai_accounting_decision DISABLE TRIGGER USER');
  await adminPool.query("UPDATE ai_accounting_decision SET packet=jsonb_set(jsonb_set(packet,'{expected_report_deltas,0,amount}','\"999.0000\"'::jsonb),'{expected_report_deltas,0,direction}','\"DECREASE\"'::jsonb) WHERE ai_accounting_decision_id=$1",[retained.ai_accounting_decision_id]);
  await adminPool.query('UPDATE ai_accounting_decision SET decision_hash=refs_jsonb_hash(packet) WHERE ai_accounting_decision_id=$1',[retained.ai_accounting_decision_id]);await adminPool.query('ALTER TABLE ai_accounting_decision ENABLE TRIGGER USER');
  const driftHash=(await adminPool.query('SELECT decision_hash FROM ai_accounting_decision WHERE ai_accounting_decision_id=$1',[retained.ai_accounting_decision_id])).rows[0].decision_hash,wrongReport=await outcomeReviewer.retainAiAccountingPostedOutcomeReview({tenantId:ids.tenantId,entityId:ids.entityId,decisionId:retained.ai_accounting_decision_id,expectedDecisionHash:driftHash,expectedReviewRevision:1,idempotencyKey:'retain-ai-posted-outcome-pg-report-drift'});assert.equal(wrongReport.status,'MISMATCH');assert.ok(wrongReport.reason_codes.includes('REPORT_SNAPSHOT_MISMATCH'));

  const constraint=(await adminPool.query(`SELECT conname,pg_get_constraintdef(oid) definition FROM pg_constraint WHERE conrelid='outbox_event'::regclass AND contype='u' AND pg_get_constraintdef(oid) LIKE '%aggregate_type%event_type%payload_hash%'`)).rows[0],reviewOutbox=(await adminPool.query("SELECT * FROM outbox_event WHERE aggregate_id=$1 AND event_type='JOURNAL_REVIEW' LIMIT 1",[draft.journal_entry_id])).rows[0],originalSubmitId=(await adminPool.query("SELECT outbox_event_id FROM outbox_event WHERE aggregate_id=$1 AND event_type='JOURNAL_SUBMIT' LIMIT 1",[draft.journal_entry_id])).rows[0]?.outbox_event_id;
  assert.ok(constraint?.conname&&constraint?.definition);assert.ok(reviewOutbox);assert.ok(originalSubmitId);let duplicateSubmitId;
  try{
    await adminPool.query('ALTER TABLE outbox_event DISABLE TRIGGER USER');
    const dropSql=(await adminPool.query("SELECT format('ALTER TABLE outbox_event DROP CONSTRAINT %I',$1::text) sql",[constraint.conname])).rows[0].sql;await adminPool.query(dropSql);
    await adminPool.query('DELETE FROM outbox_event WHERE outbox_event_id=$1',[reviewOutbox.outbox_event_id]);
    duplicateSubmitId=(await adminPool.query("INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash,status,attempt_count,available_at,published_at,last_error,created_at) SELECT tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash,status,attempt_count,available_at,published_at,last_error,created_at FROM outbox_event WHERE aggregate_id=$1 AND event_type='JOURNAL_SUBMIT' LIMIT 1 RETURNING outbox_event_id",[draft.journal_entry_id])).rows[0].outbox_event_id;
    await adminPool.query('ALTER TABLE outbox_event ENABLE TRIGGER USER');
    assert.equal((await adminPool.query("SELECT count(*)::int n FROM outbox_event WHERE tenant_id=$1 AND entity_id=$2 AND aggregate_id=$3 AND event_type IN ('JOURNAL_SUBMIT','JOURNAL_REVIEW','JOURNAL_APPROVE','JOURNAL_POSTED')",[ids.tenantId,ids.entityId,draft.journal_entry_id])).rows[0].n,4);
    const missingOutbox=await outcomeReviewer.retainAiAccountingPostedOutcomeReview({tenantId:ids.tenantId,entityId:ids.entityId,decisionId:retained.ai_accounting_decision_id,expectedDecisionHash:driftHash,expectedReviewRevision:2,idempotencyKey:'retain-ai-posted-outcome-pg-outbox-substitution'});assert.ok(missingOutbox.reason_codes.includes('WORKFLOW_EVIDENCE_MISSING_OR_MISMATCHED'));
  }finally{
    await adminPool.query('ALTER TABLE outbox_event DISABLE TRIGGER USER');
    await adminPool.query("DELETE FROM outbox_event WHERE aggregate_id=$1 AND event_type='JOURNAL_SUBMIT' AND outbox_event_id<>$2",[draft.journal_entry_id,originalSubmitId]);
    await adminPool.query("INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash,status,attempt_count,available_at,published_at,last_error,created_at) SELECT tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash,status,attempt_count,available_at,published_at,last_error,created_at FROM jsonb_populate_record(NULL::outbox_event,$1::jsonb) saved WHERE NOT EXISTS(SELECT 1 FROM outbox_event current WHERE current.tenant_id=saved.tenant_id AND current.aggregate_type=saved.aggregate_type AND current.aggregate_id=saved.aggregate_id AND current.event_type=saved.event_type AND current.payload_hash=saved.payload_hash)",[JSON.stringify(reviewOutbox)]);
    const restoreSql=(await adminPool.query("SELECT format('ALTER TABLE outbox_event ADD CONSTRAINT %I %s',$1::text,$2::text) sql",[constraint.conname,constraint.definition])).rows[0].sql;await adminPool.query(restoreSql);
    await adminPool.query('ALTER TABLE outbox_event ENABLE TRIGGER USER');
  }
  const restoredConstraint=(await adminPool.query(`SELECT pg_get_constraintdef(oid) definition FROM pg_constraint WHERE conrelid='outbox_event'::regclass AND conname=$1`,[constraint.conname])).rows[0];assert.equal(restoredConstraint?.definition,constraint.definition);

  const postedOutbox=(await adminPool.query("SELECT outbox_event_id,payload,payload_hash FROM outbox_event WHERE tenant_id=$1 AND entity_id=$2 AND aggregate_id=$3 AND event_type='JOURNAL_POSTED' LIMIT 1",[ids.tenantId,ids.entityId,draft.journal_entry_id])).rows[0];assert.ok(postedOutbox);
  try{
    await adminPool.query('ALTER TABLE outbox_event DISABLE TRIGGER USER');
    await adminPool.query("UPDATE outbox_event SET payload=payload||jsonb_build_object('unexpected_field','must-fail-closed'),payload_hash=refs_jsonb_hash(payload||jsonb_build_object('unexpected_field','must-fail-closed')) WHERE outbox_event_id=$1",[postedOutbox.outbox_event_id]);
    await adminPool.query('ALTER TABLE outbox_event ENABLE TRIGGER USER');
    assert.equal((await adminPool.query("SELECT count(*)::int n FROM outbox_event WHERE tenant_id=$1 AND entity_id=$2 AND aggregate_id=$3 AND event_type IN ('JOURNAL_SUBMIT','JOURNAL_REVIEW','JOURNAL_APPROVE','JOURNAL_POSTED')",[ids.tenantId,ids.entityId,draft.journal_entry_id])).rows[0].n,4);
    const extraPostedField=await outcomeReviewer.retainAiAccountingPostedOutcomeReview({tenantId:ids.tenantId,entityId:ids.entityId,decisionId:retained.ai_accounting_decision_id,expectedDecisionHash:driftHash,expectedReviewRevision:3,idempotencyKey:'retain-ai-posted-outcome-pg-post-outbox-extra-field'});assert.ok(extraPostedField.reason_codes.includes('WORKFLOW_EVIDENCE_MISSING_OR_MISMATCHED'));assert.equal(extraPostedField.evidence.workflow_exact,false);
  }finally{
    await adminPool.query('ALTER TABLE outbox_event DISABLE TRIGGER USER');
    await adminPool.query('UPDATE outbox_event SET payload=$2::jsonb,payload_hash=$3 WHERE outbox_event_id=$1',[postedOutbox.outbox_event_id,JSON.stringify(postedOutbox.payload),postedOutbox.payload_hash]);
    await adminPool.query('ALTER TABLE outbox_event ENABLE TRIGGER USER');
  }

  await adminPool.query('ALTER TABLE journal_entry DISABLE TRIGGER USER');await adminPool.query("UPDATE journal_entry SET currency='CAD' WHERE journal_entry_id=$1",[draft.journal_entry_id]);await adminPool.query('ALTER TABLE journal_entry ENABLE TRIGGER USER');await adminPool.query('ALTER TABLE source_link DISABLE TRIGGER USER');await adminPool.query("DELETE FROM source_link WHERE journal_entry_id=$1 AND link_type='AI_ACCOUNTING_DECISION_SOURCE'",[draft.journal_entry_id]);await adminPool.query('ALTER TABLE source_link ENABLE TRIGGER USER');
  const journalDrift=await outcomeReviewer.retainAiAccountingPostedOutcomeReview({tenantId:ids.tenantId,entityId:ids.entityId,decisionId:retained.ai_accounting_decision_id,expectedDecisionHash:driftHash,expectedReviewRevision:4,idempotencyKey:'retain-ai-posted-outcome-pg-journal-drift'});assert.ok(journalDrift.reason_codes.includes('JOURNAL_SCOPE_MISMATCH'));assert.ok(journalDrift.reason_codes.includes('SOURCE_LINEAGE_MISMATCH'));

  await adminPool.query('ALTER TABLE ai_accounting_human_decision DISABLE TRIGGER USER');await adminPool.query("UPDATE ai_accounting_human_decision SET decision_hash=$2,evidence_hash=$2 WHERE ai_accounting_decision_id=$1",[retained.ai_accounting_decision_id,hash('wrong-acceptance')]);await adminPool.query('ALTER TABLE ai_accounting_human_decision ENABLE TRIGGER USER');await adminPool.query('ALTER TABLE ai_accounting_decision_draft_evidence DISABLE TRIGGER USER');await adminPool.query("UPDATE ai_accounting_decision_draft_evidence SET acceptance_hash=$2,evidence_hash=$2 WHERE ai_accounting_decision_id=$1",[retained.ai_accounting_decision_id,hash('wrong-draft')]);await adminPool.query('ALTER TABLE ai_accounting_decision_draft_evidence ENABLE TRIGGER USER');
  const receiptDrift=await outcomeReviewer.retainAiAccountingPostedOutcomeReview({tenantId:ids.tenantId,entityId:ids.entityId,decisionId:retained.ai_accounting_decision_id,expectedDecisionHash:driftHash,expectedReviewRevision:5,idempotencyKey:'retain-ai-posted-outcome-pg-receipt-drift'});assert.ok(receiptDrift.reason_codes.includes('ACCEPTANCE_EVIDENCE_MISMATCH'));assert.ok(receiptDrift.reason_codes.includes('DRAFT_EVIDENCE_MISMATCH'));
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
  const token=actor=>{const now=Math.floor(Date.now()/1000),header=Buffer.from(JSON.stringify({alg:'RS256',kid:'test-key',typ:'JWT'})).toString('base64url'),payload=Buffer.from(JSON.stringify({iss:issuer,aud:audience,iat:now,exp:now+300,[REFS_TENANT_CLAIM]:ids.tenantId,sub:actor})).toString('base64url'),signature=sign('RSA-SHA256',Buffer.from(`${header}.${payload}`),privateKey).toString('base64url');return `${header}.${payload}.${signature}`;};
  const server=createProductionAccountingServer({runtimePool,issuerPool,authenticator,attachmentStorage:{probe:async()=>true},virusScanner:{probe:async()=>true},scannerServiceActorId:'scanner-service',wbsSnapshotVerifier:()=>true,wbsAutoRecTransitionContractVerifier:()=>({signature_verified:true}),allowedOrigins:['https://app.example']});
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

pgTest('authenticated HTTP lists only exact-period Journal Entries and excludes same-entity future rows',async()=>{
  const ids=await seed({status:'DRAFT'}),other=await seed({status:'DRAFT',tenantId:ids.tenantId});
  const januaryPeriodId=randomUUID(),januaryJournalId=randomUUID(),januaryPostedId=randomUUID();
  await adminPool.query("INSERT INTO accounting_period(period_id,tenant_id,entity_id,period_code,starts_on,ends_on,status) VALUES($1,$2,$3,'2026-01','2026-01-01','2026-01-31','CLOSED')",[januaryPeriodId,ids.tenantId,ids.entityId]);
  await adminPool.query(`INSERT INTO journal_entry(journal_entry_id,tenant_id,entity_id,period_id,journal_number,journal_type,status,journal_date,currency,created_by,reviewed_by,approved_by,posted_by,posted_at)
    VALUES($1,$2,$3,$4,'JE-JAN-DRAFT','MANUAL','DRAFT','2026-01-15','USD','jan-maker',NULL,NULL,NULL,NULL),
      ($5,$2,$3,$4,'JE-JAN-POSTED','AUTO','POSTED','2026-01-20','USD','jan-maker','jan-reviewer','jan-approver','jan-poster','2026-02-01T00:00:00Z')`,[januaryJournalId,ids.tenantId,ids.entityId,januaryPeriodId,januaryPostedId]);
  const api=createAccountingApi({
    authenticate:async()=>({trusted:true,tenantId:ids.tenantId,actorId:'http-journal-reader'}),
    kernelFactory:async()=>new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'http-journal-reader',['GL.JE.VIEW'])})
  });
  const response=await api({method:'GET',url:`/api/v1/entities/${ids.entityId}/journal-entries?periodId=${januaryPeriodId}&limit=1&offset=0`,headers:{},body:null});
  assert.equal(response.status,200);assert.equal(response.headers['cache-control'],'no-store');assert.equal(response.body.data.length,1);
  assert.deepEqual(response.body.scope,{entity_id:ids.entityId,period_id:januaryPeriodId,period_start:'2026-01-01',period_end:'2026-01-31',period_status:'CLOSED',total_count:2,limit:1,offset:0});
  assert.equal(response.body.data[0].journal_entry_id,januaryPostedId);assert.equal(response.body.data[0].period_id,januaryPeriodId);assert.equal(response.body.data[0].status,'POSTED');
  const second=await api({method:'GET',url:`/api/v1/entities/${ids.entityId}/journal-entries?periodId=${januaryPeriodId}&limit=1&offset=1`,headers:{},body:null});
  assert.equal(second.status,200);assert.equal(second.body.data[0].journal_entry_id,januaryJournalId);assert.equal(second.body.data[0].status,'DRAFT');
  assert.ok(![...response.body.data,...second.body.data].some(row=>row.journal_entry_id===ids.journalId),'the July journal must not appear in the January register or become drillable');
  assert.equal((await api({method:'GET',url:`/api/v1/entities/${ids.entityId}/journal-entries`,headers:{},body:null})).status,400);
  assert.equal((await api({method:'GET',url:`/api/v1/entities/${ids.entityId}/journal-entries?periodId=${other.periodId}`,headers:{},body:null})).status,404);
  assert.equal((await api({method:'GET',url:`/api/v1/entities/${other.entityId}/journal-entries?periodId=${other.periodId}`,headers:{},body:null})).status,403);
});

pgTest('Journal workflow capability read requires GL.JE.VIEW and returns only fixed entity permissions',async()=>{
  const ids=await seed({status:'DRAFT'}),other=await seed({status:'DRAFT',tenantId:ids.tenantId});
  const kernel=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'journal-capability-reader',['GL.JE.VIEW','GL.JE.SUBMIT','GL.JE.APPROVE'])});
  assert.deepEqual(await kernel.getJournalWorkflowCapabilities({tenantId:ids.tenantId,entityId:ids.entityId}),{entity_id:ids.entityId,can_submit:true,can_review:false,can_approve:true,can_post:false});
  await assert.rejects(kernel.getJournalWorkflowCapabilities({tenantId:ids.tenantId,entityId:other.entityId}),error=>error.code==='42501');
  const noView=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'journal-capability-no-view',['GL.JE.SUBMIT'])});
  await assert.rejects(noView.getJournalWorkflowCapabilities({tenantId:ids.tenantId,entityId:ids.entityId}),error=>error.code==='42501');
});

pgTest('authenticated HTTP reads exact-period ordered Draft Journal lines without fabricated ledger identities',async()=>{
  const ids=await seed({status:'DRAFT'}),other=await seed({status:'DRAFT',tenantId:ids.tenantId});
  const api=createAccountingApi({
    authenticate:async()=>({trusted:true,tenantId:ids.tenantId,actorId:'http-journal-detail-reader'}),
    kernelFactory:async()=>new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'http-journal-detail-reader',['GL.JE.VIEW'])})
  });
  const response=await api({method:'GET',url:`/api/v1/entities/${ids.entityId}/journal-entries/${ids.journalId}?periodId=${ids.periodId}`,headers:{},body:null});
  assert.equal(response.status,200);assert.equal(response.headers['cache-control'],'no-store');
  assert.deepEqual({entity:response.body.data.entity_id,period:response.body.data.period_id,journal:response.body.data.journal_entry_id,status:response.body.data.status,date:response.body.data.journal_date,revision:response.body.data.revision},{entity:ids.entityId,period:ids.periodId,journal:ids.journalId,status:'DRAFT',date:'2026-07-15',revision:0});
  assert.deepEqual(response.body.data.lines.map(line=>({line_no:line.line_no,account_code:line.account_code,debit_amount:line.debit_amount,credit_amount:line.credit_amount,ledger_line_id:line.ledger_line_id})),[
    {line_no:1,account_code:'111000',debit_amount:'100.0000',credit_amount:'0.0000',ledger_line_id:null},
    {line_no:2,account_code:'291001',debit_amount:'0.0000',credit_amount:'100.0000',ledger_line_id:null},
  ]);
  assert.equal((await api({method:'GET',url:`/api/v1/entities/${ids.entityId}/journal-entries/${ids.journalId}?periodId=${other.periodId}`,headers:{},body:null})).status,404);
  assert.equal((await api({method:'GET',url:`/api/v1/entities/${other.entityId}/journal-entries/${other.journalId}?periodId=${other.periodId}`,headers:{},body:null})).status,403);
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

pgTest('authoritative AP AR documents and adjustments are exact-period paged reads with no cross-period drill facts',async()=>{
  const ids=await seed({status:'DRAFT'}),other=await seed({status:'DRAFT',tenantId:ids.tenantId});
  const januaryPeriodId=randomUUID(),januaryDraftJournalId=randomUUID(),januaryPostedJournalId=randomUUID(),billId=randomUUID(),invoiceId=randomUUID(),julyBillId=randomUUID(),januaryApAdjustmentId=randomUUID(),januaryArAdjustmentId=randomUUID(),julyAdjustmentId=randomUUID();
  await adminPool.query("INSERT INTO accounting_period(period_id,tenant_id,entity_id,period_code,starts_on,ends_on,status) VALUES($1,$2,$3,'2026-01','2026-01-01','2026-01-31','CLOSED')",[januaryPeriodId,ids.tenantId,ids.entityId]);
  await adminPool.query(`INSERT INTO journal_entry(journal_entry_id,tenant_id,entity_id,period_id,journal_number,journal_type,status,journal_date,currency,created_by,reviewed_by,approved_by,posted_by,posted_at)
    VALUES($1,$2,$3,$4,'JE-JAN-AP-DRAFT','MANUAL','DRAFT','2026-01-10','USD','jan-maker',NULL,NULL,NULL,NULL),
      ($5,$2,$3,$4,'JE-JAN-AR-POSTED','AUTO','POSTED','2026-01-20','USD','jan-maker','jan-reviewer','jan-approver','jan-poster','2026-02-01T00:00:00Z')`,[januaryDraftJournalId,ids.tenantId,ids.entityId,januaryPeriodId,januaryPostedJournalId]);
  await adminPool.query(`INSERT INTO business_document(business_document_id,tenant_id,entity_id,draft_journal_entry_id,posted_journal_entry_id,document_kind,document_number,counterparty_ref,counterparty_name,currency,accounting_date,due_date,gross_amount,open_balance,status,created_by)
    VALUES($1,$2,$3,$4,NULL,'AP_BILL','BILL-JAN-DRAFT','VENDOR-1','Vendor','USD','2026-01-10','2026-02-10',100,100,'DRAFT','fixture'),
      ($5,$2,$3,NULL,$6,'AR_INVOICE','INV-JAN-POSTED','CUSTOMER-1','Customer','USD','2026-01-20','2026-02-20',80,80,'OPEN','fixture'),
      ($7,$2,$3,$8,NULL,'AP_BILL','BILL-JULY-EXCLUDED','VENDOR-1','Vendor','USD','2026-07-15','2026-08-15',50,50,'DRAFT','fixture')`,[billId,ids.tenantId,ids.entityId,januaryDraftJournalId,invoiceId,januaryPostedJournalId,julyBillId,ids.journalId]);
  await adminPool.query(`INSERT INTO business_adjustment(business_adjustment_id,tenant_id,entity_id,adjustment_kind,amount,currency,accounting_date,period_id,reason,status,draft_journal_entry_id,idempotency_key,request_hash,created_by)
    VALUES($1,$2,$3,'AP_VENDOR_CREDIT',12,'USD','2026-01-10',$4,'January AP adjustment','DRAFT',$5,'jan-ap-adjustment',$6,'fixture'),
      ($7,$2,$3,'AR_CREDIT_MEMO',8,'USD','2026-01-20',$4,'January AR adjustment','POSTED',NULL,'jan-ar-adjustment',$6,'fixture'),
      ($8,$2,$3,'AP_VENDOR_CREDIT',9,'USD','2026-07-15',$9,'July adjustment excluded','DRAFT',$10,'july-ap-adjustment',$6,'fixture')`,[januaryApAdjustmentId,ids.tenantId,ids.entityId,januaryPeriodId,januaryDraftJournalId,hash('period-read-adjustments'),januaryArAdjustmentId,julyAdjustmentId,ids.periodId,ids.journalId]);
  await adminPool.query('UPDATE business_adjustment SET posted_journal_entry_id=$1 WHERE business_adjustment_id=$2',[januaryPostedJournalId,januaryArAdjustmentId]);
  const api=createAccountingApi({
    authenticate:async()=>({trusted:true,tenantId:ids.tenantId,actorId:'http-document-reader'}),
    kernelFactory:async()=>new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'http-document-reader',['AP.VIEW','AR.VIEW'])})
  });
  const reads=[];for(const path of ['ap/bills','ar/invoices','ap/adjustments','ar/adjustments'])reads.push(await api({method:'GET',url:`/api/v1/entities/${ids.entityId}/${path}?periodId=${januaryPeriodId}&limit=1&offset=0`,headers:{},body:null}));
  for(const response of reads){assert.equal(response.status,200);assert.equal(response.headers['cache-control'],'no-store');assert.deepEqual(response.body.scope,{entity_id:ids.entityId,period_id:januaryPeriodId,period_start:'2026-01-01',period_end:'2026-01-31',period_status:'CLOSED',total_count:1,limit:1,offset:0});assert.equal(response.body.data.length,1);assert.equal(response.body.data[0].period_id,januaryPeriodId);}
  assert.deepEqual(reads.map(response=>response.body.data[0].business_document_id||response.body.data[0].business_adjustment_id),[billId,invoiceId,januaryApAdjustmentId,januaryArAdjustmentId]);
  assert.ok(reads.flatMap(response=>response.body.data).every(row=>row.business_document_id!==julyBillId&&row.business_adjustment_id!==julyAdjustmentId));
  assert.equal((await api({method:'GET',url:`/api/v1/entities/${ids.entityId}/ap/bills`,headers:{},body:null})).status,400);
  assert.equal((await api({method:'GET',url:`/api/v1/entities/${ids.entityId}/ap/adjustments?periodId=${other.periodId}`,headers:{},body:null})).status,404);
  assert.equal((await api({method:'GET',url:`/api/v1/entities/${other.entityId}/ap/bills?periodId=${other.periodId}`,headers:{},body:null})).status,403);
  assert.equal((await api({method:'GET',url:`/api/v1/entities/${ids.entityId}/ap/bills?periodId=${januaryPeriodId}`,headers:{'Idempotency-Key':'read-not-allowed'},body:null})).status,400);
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
  const ap=await api({method:'GET',url:`/api/v1/entities/${ids.entityId}/ap/adjustments?periodId=${ids.periodId}`,headers:{},body:null});
  const ar=await api({method:'GET',url:`/api/v1/entities/${ids.entityId}/ar/adjustments?periodId=${ids.periodId}`,headers:{},body:null});
  assert.equal(ap.status,200);assert.deepEqual(ap.body.data.map(row=>({business_adjustment_id:row.business_adjustment_id,adjustment_kind:row.adjustment_kind,amount:row.amount,status:row.status})),[{business_adjustment_id:apId,adjustment_kind:'AP_VENDOR_CREDIT',amount:'12.5000',status:'DRAFT'}]);
  assert.equal(ar.status,200);assert.deepEqual(ar.body.data.map(row=>({business_adjustment_id:row.business_adjustment_id,adjustment_kind:row.adjustment_kind,amount:row.amount,status:row.status})),[{business_adjustment_id:arId,adjustment_kind:'AR_CREDIT_MEMO',amount:'8.0000',status:'POSTED'}]);
  assert.equal((await api({method:'GET',url:`/api/v1/entities/${other.entityId}/ap/adjustments?periodId=${other.periodId}`,headers:{},body:null})).status,403);
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
  const readBill=(await api({method:'GET',url:`${root}/ap/bills?periodId=${ids.periodId}`,headers:{'x-test-actor':'document-reader'},body:null})).body.data[0];
  assert.deepEqual({business_document_id:readBill.business_document_id,status:readBill.status,offset_account_code:readBill.offset_account_code,description:readBill.description,journal_entry_id:readBill.journal_entry_id,journal_status:readBill.journal_status,journal_revision:readBill.journal_revision,period_id:readBill.period_id},{business_document_id:bill.business_document_id,status:'OPEN',offset_account_code:'610000',description:'Native AP bill',journal_entry_id:bill.journal_entry_id,journal_status:'POSTED',journal_revision:'4',period_id:ids.periodId});
  const readInvoice=(await api({method:'GET',url:`${root}/ar/invoices?periodId=${ids.periodId}`,headers:{'x-test-actor':'document-reader'},body:null})).body.data[0];
  assert.deepEqual({business_document_id:readInvoice.business_document_id,status:readInvoice.status,offset_account_code:readInvoice.offset_account_code,description:readInvoice.description,journal_entry_id:readInvoice.journal_entry_id,journal_status:readInvoice.journal_status,journal_revision:readInvoice.journal_revision,period_id:readInvoice.period_id},{business_document_id:invoice.business_document_id,status:'OPEN',offset_account_code:'400000',description:'Native AR invoice',journal_entry_id:invoice.journal_entry_id,journal_status:'POSTED',journal_revision:'4',period_id:ids.periodId});
  const spoof=await send('document-maker',`${root}/ap/bills`,{periodId:ids.periodId,documentNumber:'BILL-NO-EVIDENCE',counterpartyRef:'VENDOR-1',counterpartyName:'Vendor',currency:'USD',accountingDate:'2026-07-18',amount:100,offsetAccountCode:'610000',attachmentIds:[]},'native-ap-bill-no-evidence');
  assert.equal(spoof.status,422);
});

pgTest('controlled DEMO tenant runs one AP Bill through HTTP Draft, four-role Post, GL, TB and AP aging without affecting another tenant',async()=>{
  const ids=await seed({status:'DRAFT',extraAccounts:[{accountCode:'610000',accountName:'DEMO operating expense'}],attachmentName:'DEMO-only-AP-support.pdf',attachmentStorageRef:'s3://refs-demo-isolated/AP-BILL-089125',attachmentStorageVersion:'demo-v1'});
  await adminPool.query("UPDATE tenant SET tenant_code='DEMO_AP_E2E',name='DEMO tenant isolated AP acceptance' WHERE tenant_id=$1",[ids.tenantId]);
  await adminPool.query("UPDATE entity SET entity_code='DEMO_AP_2026',source_system='REFS_DEMO',source_entity_id='DEMO_AP_2026',name='DEMO entity AP acceptance' WHERE tenant_id=$1 AND entity_id=$2",[ids.tenantId,ids.entityId]);
  ids.sourceEntityId='DEMO_AP_2026';
  await adminPool.query(`INSERT INTO controlled_demo_tenant(tenant_id,scenario_code,display_label,created_by,expires_at)
    VALUES($1,'AP_DEMO_E2E','DEMO isolated AP acceptance','demo-admin',clock_timestamp()+interval '1 day')`,[ids.tenantId]);
  const protectedIds=await seed({status:'DRAFT',tenantId:randomUUID(),entityId:randomUUID(),periodId:randomUUID(),journalId:randomUUID()});
  const protectedBefore=(await adminPool.query(`SELECT (SELECT count(*)::int FROM business_document WHERE tenant_id=$1) documents,(SELECT count(*)::int FROM journal_entry WHERE tenant_id=$1) journals,(SELECT count(*)::int FROM ledger_line WHERE tenant_id=$1) ledger_lines`,[protectedIds.tenantId])).rows[0];
  const attachmentId=(await adminPool.query('SELECT attachment_id FROM source_link WHERE tenant_id=$1 AND journal_entry_id=$2 AND attachment_id IS NOT NULL',[ids.tenantId,ids.journalId])).rows[0].attachment_id;
  const permissions={'demo-ap-maker':['AP.BILL.CREATE','GL.JE.SUBMIT'],'demo-ap-reviewer':['GL.JE.REVIEW'],'demo-ap-approver':['GL.JE.APPROVE'],'demo-ap-poster':['GL.JE.POST'],'demo-ap-reader':['AP.VIEW','GL.JE.VIEW','GL.REPORT.VIEW']};
  const api=createAccountingApi({authenticate:async({headers})=>({trusted:true,tenantId:ids.tenantId,actorId:headers['x-test-actor']}),kernelFactory:async principal=>new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,principal.actorId,permissions[principal.actorId]||[])})});
  const demoReader=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'demo-ap-reader',permissions['demo-ap-reader'])});
  const demoStatus=await demoReader.readControlledDemoTenant({tenantId:ids.tenantId});
  assert.equal(demoStatus.lifecycle_status,'ACTIVE_DEMO');
  const send=(actor,path,body,idempotencyKey,revision)=>api({method:'POST',url:path,body,headers:{'x-test-actor':actor,'idempotency-key':idempotencyKey,...(revision==null?{}:{'if-match':`"${revision}"`})}});
  const read=(actor,path)=>api({method:'GET',url:path,body:null,headers:{'x-test-actor':actor}});
  const root=`/api/v1/entities/${ids.entityId}`,billBody={periodId:ids.periodId,documentNumber:'DEMO-AP-BILL-089125',counterpartyRef:'VENDOR-1',counterpartyName:'DEMO supplier',currency:'USD',accountingDate:'2026-07-15',dueDate:'2026-07-31',amount:'89.1250',offsetAccountCode:'610000',description:'DEMO only: controlled AP acceptance scenario',attachmentIds:[attachmentId]};
  const created=await send('demo-ap-maker',`${root}/ap/bills`,billBody,'demo-ap-bill-create-0001');
  assert.equal(created.status,201,JSON.stringify(created.body));const draft=created.body.data;
  assert.deepEqual({status:draft.status,kind:draft.document_kind,revision:draft.revision},{status:'DRAFT',kind:'AP_BILL',revision:0});
  const replay=await send('demo-ap-maker',`${root}/ap/bills`,billBody,'demo-ap-bill-create-0001');
  assert.equal(replay.status,200);assert.equal(replay.body.data.idempotent,true);assert.equal(replay.body.data.journal_entry_id,draft.journal_entry_id);
  const source=await attachAutoSource({...ids,journalId:draft.journal_entry_id},{sourceSystem:'REFS_DEMO',sourceModule:'payable',sourceRecordPrefix:'DEMO-AP'});
  assert.deepEqual((await adminPool.query('SELECT source_system,source_module,source_record_id FROM source_document WHERE tenant_id=$1 AND source_document_id=$2',[ids.tenantId,source.documentId])).rows[0],{source_system:'REFS_DEMO',source_module:'payable',source_record_id:`DEMO-AP-${draft.journal_entry_id}`});
  assert.equal((await adminPool.query("SELECT count(*)::int n FROM source_link WHERE tenant_id=$1 AND entity_id=$2 AND source_document_id=$3 AND journal_entry_id=$4 AND link_type='SOURCE_TO_JE'",[ids.tenantId,ids.entityId,source.documentId,draft.journal_entry_id])).rows[0].n,1);
  assert.deepEqual((await adminPool.query("SELECT a.name,a.storage_ref,a.storage_version,a.content_hash FROM attachment a JOIN source_link l ON l.attachment_id=a.attachment_id WHERE l.tenant_id=$1 AND l.entity_id=$2 AND l.journal_entry_id=$3 AND l.link_type='JE_ATTACHMENT'",[ids.tenantId,ids.entityId,draft.journal_entry_id])).rows[0],{name:'DEMO-only-AP-support.pdf',storage_ref:'s3://refs-demo-isolated/AP-BILL-089125',storage_version:'demo-v1',content_hash:hash('attachment')});
  const journalPath=`${root}/journal-entries/${draft.journal_entry_id}`;
  assert.equal((await send('demo-ap-maker',`${journalPath}/transitions/submit`,{},'demo-ap-submit-0001',0)).status,201);
  assert.equal((await send('demo-ap-reviewer',`${journalPath}/transitions/review`,{},'demo-ap-review-0001',1)).status,201);
  assert.equal((await send('demo-ap-approver',`${journalPath}/transitions/approve`,{},'demo-ap-approve-0001',2)).status,201);
  assert.equal((await send('demo-ap-poster',`${journalPath}/post`,{periodId:ids.periodId},'demo-ap-post-0001',3)).status,201);
  const journal=(await adminPool.query('SELECT status,created_by,reviewed_by,approved_by,posted_by,revision FROM journal_entry WHERE tenant_id=$1 AND entity_id=$2 AND journal_entry_id=$3',[ids.tenantId,ids.entityId,draft.journal_entry_id])).rows[0];
  assert.deepEqual(journal,{status:'POSTED',created_by:'demo-ap-maker',reviewed_by:'demo-ap-reviewer',approved_by:'demo-ap-approver',posted_by:'demo-ap-poster',revision:'4'});assert.equal(new Set([journal.created_by,journal.reviewed_by,journal.approved_by,journal.posted_by]).size,4);
  const audit=(await adminPool.query("SELECT event_type,actor_id FROM audit_event WHERE tenant_id=$1 AND entity_id=$2 AND (object_id=$3 OR object_id=$4) ORDER BY occurred_at",[ids.tenantId,ids.entityId,draft.business_document_id,draft.journal_entry_id])).rows;
  assert.ok(audit.some(row=>row.event_type==='AP_BILL_DRAFT_CREATED'&&row.actor_id==='demo-ap-maker'));assert.ok(audit.some(row=>row.event_type==='AP_BILL_POSTED'&&row.actor_id==='demo-ap-poster'));assert.ok(audit.some(row=>row.event_type==='JOURNAL_POSTED'&&row.actor_id==='demo-ap-poster'));
  const gl=await read('demo-ap-reader',`${root}/general-ledger/entries?periodId=${ids.periodId}&accountCode=610000&query=DEMO-AP-BILL-089125&limit=10&offset=0`);
  assert.equal(gl.status,200);assert.equal(gl.headers['cache-control'],'no-store');const expense=gl.body.data.find(row=>row.journal_entry_id===draft.journal_entry_id);assert.ok(expense);assert.deepEqual({debit:expense.debit_amount,credit:expense.credit_amount,sources:expense.source_document_ids},{debit:'89.1250',credit:'0.0000',sources:[source.documentId]});
  const reports=await read('demo-ap-reader',`${root}/reports/financial-statements?periodId=${ids.periodId}`);
  assert.equal(reports.status,200);assert.equal(reports.headers['cache-control'],'no-store');
  for(const [accountCode,debit,credit] of [['610000','89.1250','0.0000'],['291001','0.0000','89.1250']]){const row=reports.body.data.find(candidate=>candidate.statement_type==='TRIAL_BALANCE'&&candidate.account_code===accountCode);assert.ok(row,`trial balance must include DEMO ${accountCode}`);assert.equal(row.period_debit,debit);assert.equal(row.period_credit,credit);assert.ok(row.journal_entry_ids.includes(draft.journal_entry_id));assert.ok(row.source_document_ids.includes(source.documentId));}
  const aging=await read('demo-ap-reader',`${root}/ap/aging?asOf=2026-08-31`);
  assert.equal(aging.status,200);assert.equal(aging.headers['cache-control'],'no-store');assert.deepEqual(aging.body.data,[{currency:'USD',current_amount:'0.0000',days_1_30:'0.0000',days_31_60:'89.1250',days_61_90:'0.0000',days_91_plus:'0.0000',total_open_balance:'89.1250'}]);
  const crossTenant=await send('demo-ap-maker',`/api/v1/entities/${protectedIds.entityId}/ap/bills`,billBody,'demo-ap-cross-tenant-0001');assert.equal(crossTenant.status,403);
  const protectedAfter=(await adminPool.query(`SELECT (SELECT count(*)::int FROM business_document WHERE tenant_id=$1) documents,(SELECT count(*)::int FROM journal_entry WHERE tenant_id=$1) journals,(SELECT count(*)::int FROM ledger_line WHERE tenant_id=$1) ledger_lines`,[protectedIds.tenantId])).rows[0];
  assert.deepEqual(protectedAfter,protectedBefore);
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

pgTest('posting response loss is safe: same-hash retry yields one journal posting before state validation',async()=>{
  const ids=await seed();
  const kernel=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids)});
  const args={...ids,journalEntryId:ids.journalId,expectedRevision:0,idempotencyKey:'post-key-0001',requestHash:hash('post')};
  const first=await kernel.postJournal(args);
  const replay=await kernel.postJournal(args);
  assert.equal(first.idempotent,false);assert.equal(replay.idempotent,true);assert.equal(replay.posting_batch_id,first.posting_batch_id);assert.equal(first.revision,1);assert.equal(replay.revision,1);
  await assert.rejects(kernel.postJournal({...args,expectedRevision:1,requestHash:hash('caller-is-ignored')}),error=>error.code==='23505');
  assert.equal((await adminPool.query('SELECT count(*)::int AS n FROM ledger_line')).rows[0].n,2);
  assert.equal((await adminPool.query('SELECT count(*)::int AS n FROM journal_entry WHERE journal_entry_id=$1',[ids.journalId])).rows[0].n,1);
  assert.equal((await adminPool.query('SELECT count(DISTINCT posting_batch_id)::int AS n FROM ledger_line WHERE journal_entry_id=$1',[ids.journalId])).rows[0].n,1);
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

pgTest('AP AR period control lineage 166 nets posted allocations reversals void credit and refund without cross-period inference',async()=>{
  const insertPostedControlJournal=async({ids,periodId,sourceDocumentId,suffix,module,controlAmount})=>{
    const journalEntryId=randomUUID(),controlJournalLineId=randomUUID(),cashJournalLineId=randomUUID(),attachmentId=randomUUID();
    const accountCode=module==='AP'?'291001':'120200',memberRef=module==='AP'?'VENDOR-1':'CUSTOMER-1',positive=controlAmount>0,amount=Math.abs(controlAmount);
    const controlDebit=module==='AR'?positive:!positive,controlCredit=!controlDebit;
    await adminPool.query(`INSERT INTO journal_entry(journal_entry_id,tenant_id,entity_id,period_id,journal_number,journal_type,status,journal_date,currency,description,created_by,reviewed_by,approved_by,posted_by,posted_at,revision)
      VALUES($1,$2,$3,$4,$5,'MANUAL','APPROVED',CASE WHEN $6='2026-07' THEN '2026-07-20'::date ELSE '2026-08-20'::date END,'USD',$5,'maker','reviewer','approver',NULL,NULL,0)`,[journalEntryId,ids.tenantId,ids.entityId,periodId,`CONTROL-166-${suffix}`,periodId===ids.periodId?'2026-07':'2026-08']);
    await adminPool.query(`INSERT INTO journal_line(journal_line_id,tenant_id,entity_id,period_id,journal_entry_id,line_no,account_code,debit_amount,credit_amount,member_ref) VALUES
      ($1,$2,$3,$4,$5,1,$6,$7,$8,$9),($10,$2,$3,$4,$5,2,'111000',$8,$7,'BANK-1')`,[controlJournalLineId,ids.tenantId,ids.entityId,periodId,journalEntryId,accountCode,controlDebit?amount:0,controlCredit?amount:0,memberRef,cashJournalLineId]);
    await adminPool.query(`INSERT INTO attachment(attachment_id,tenant_id,entity_id,name,media_type,size_bytes,content_hash,storage_ref,storage_version,uploaded_by,uploaded_at,verified_at,scan_status,finalization_status,finalized_at)
      VALUES($1,$2,$3,$4,'application/pdf',10,$5,$6,'v1','maker',now(),now(),'CLEAN','VERIFIED_CLEAN',now())`,[attachmentId,ids.tenantId,ids.entityId,`control-166-${suffix}.pdf`,hash(`control-166-attachment-${suffix}`),`object://control-166/${attachmentId}`]);
    await adminPool.query("INSERT INTO source_link(tenant_id,entity_id,link_type,journal_entry_id,attachment_id,created_by) VALUES($1,$2,'JE_ATTACHMENT',$3,$4,'maker')",[ids.tenantId,ids.entityId,journalEntryId,attachmentId]);
    await adminPool.query('INSERT INTO source_link(tenant_id,entity_id,link_type,source_document_id,journal_entry_id,created_by) VALUES($1,$2,$3,$4,$5,\'fixture\')',[ids.tenantId,ids.entityId,`CONTROL_166_${suffix}`,sourceDocumentId,journalEntryId]);
    const poster=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,`control-166-${suffix}-poster`,['GL.JE.POST'])});
    await poster.postJournal({...ids,periodId,journalEntryId,expectedRevision:0,idempotencyKey:`control-166-post-${suffix}`});
    const controlLedgerLineId=(await adminPool.query('SELECT ledger_line_id FROM ledger_line WHERE tenant_id=$1 AND entity_id=$2 AND journal_entry_id=$3 AND journal_line_id=$4',[ids.tenantId,ids.entityId,journalEntryId,controlJournalLineId])).rows[0].ledger_line_id;
    return {journalEntryId,controlJournalLineId,controlLedgerLineId};
  };
  const setup=async module=>{
    const ids=await seed({status:'APPROVED',journalType:'AUTO',attachmentStatus:null,
      extraAccounts:module==='AR'?[{accountCode:'400000',accountName:'Revenue'}]:[],extraMembers:module==='AR'?[{memberRef:'CUSTOMER-1',memberType:'CUSTOMER',displayName:'Customer'}]:[],
      journalLines:module==='AP'?[{lineNo:1,accountCode:'111000',debit:100,credit:0,memberRef:'BANK-1'},{lineNo:2,accountCode:'291001',debit:0,credit:100,memberRef:'VENDOR-1'}]:[{lineNo:1,accountCode:'120200',debit:100,credit:0,memberRef:'CUSTOMER-1'},{lineNo:2,accountCode:'400000',debit:0,credit:100}]});
    const source=await attachAutoSource(ids),poster=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,`${module}-control-lineage-poster`,['GL.JE.POST'])});
    await poster.postJournal({...ids,journalEntryId:ids.journalId,expectedRevision:0,idempotencyKey:`${module}-control-lineage-post`});
    const documentId=randomUUID();await adminPool.query(`INSERT INTO business_document(business_document_id,tenant_id,entity_id,source_document_id,document_kind,document_number,counterparty_ref,counterparty_name,currency,accounting_date,due_date,gross_amount,open_balance,status,posted_journal_entry_id,created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,'USD','2026-07-15','2026-08-15',100,100,'OPEN',$9,'fixture')`,[documentId,ids.tenantId,ids.entityId,source.documentId,module==='AP'?'AP_BILL':'AR_INVOICE',`${module}-CONTROL-166`,module==='AP'?'VENDOR-1':'CUSTOMER-1',module==='AP'?'Vendor':'Customer',ids.journalId]);
    const augustPeriod=randomUUID();await adminPool.query("INSERT INTO accounting_period(period_id,tenant_id,entity_id,period_code,starts_on,ends_on,status) VALUES($1,$2,$3,'2026-08','2026-08-01','2026-08-31','OPEN')",[augustPeriod,ids.tenantId,ids.entityId]);
    return {ids,source,documentId,augustPeriod};
  };

  const ap=await setup('AP'),apPayment=await insertPostedControlJournal({ids:ap.ids,periodId:ap.ids.periodId,sourceDocumentId:ap.source.documentId,suffix:'AP-PAY',module:'AP',controlAmount:-20}),apReversal=await insertPostedControlJournal({ids:ap.ids,periodId:ap.augustPeriod,sourceDocumentId:ap.source.documentId,suffix:'AP-REV',module:'AP',controlAmount:20}),apVoid=await insertPostedControlJournal({ids:ap.ids,periodId:ap.augustPeriod,sourceDocumentId:ap.source.documentId,suffix:'AP-VOID',module:'AP',controlAmount:-100}),occurrenceId=randomUUID(),allocationId=randomUUID(),reversalId=randomUUID(),voidId=randomUUID();
  await adminPool.query(`INSERT INTO payment_occurrence(payment_occurrence_id,tenant_id,entity_id,business_document_id,occurrence_kind,amount,currency,accounting_date,period_id,status,posted_journal_entry_id,idempotency_key,request_hash,created_by,created_at) VALUES($1,$2,$3,$4,'AP_PAYMENT',20,'USD','2026-07-20',$5,'REVERSED',$6,'control-166-ap-pay',$7,'fixture','2026-07-20T00:00:00Z')`,[occurrenceId,ap.ids.tenantId,ap.ids.entityId,ap.documentId,ap.ids.periodId,apPayment.journalEntryId,hash('control-166-ap-pay')]);
  await adminPool.query(`INSERT INTO business_allocation(business_allocation_id,tenant_id,entity_id,business_document_id,payment_occurrence_id,amount,currency,status,posted_journal_entry_id,created_by,created_at) VALUES($1,$2,$3,$4,$5,20,'USD','REVERSED',$6,'fixture','2026-07-20T00:00:00Z')`,[allocationId,ap.ids.tenantId,ap.ids.entityId,ap.documentId,occurrenceId,apPayment.journalEntryId]);
  await adminPool.query(`INSERT INTO business_adjustment(business_adjustment_id,tenant_id,entity_id,adjustment_kind,source_occurrence_id,amount,currency,accounting_date,period_id,reason,status,draft_journal_entry_id,posted_journal_entry_id,original_journal_entry_id,idempotency_key,request_hash,created_by) VALUES($1,$2,$3,'AP_PAYMENT_REVERSAL',$4,20,'USD','2026-08-20',$5,'Exact reversal','POSTED',$6,$6,$7,'control-166-ap-rev',$8,'fixture')`,[reversalId,ap.ids.tenantId,ap.ids.entityId,occurrenceId,ap.augustPeriod,apReversal.journalEntryId,apPayment.journalEntryId,hash('control-166-ap-rev')]);
  await adminPool.query(`INSERT INTO business_adjustment(business_adjustment_id,tenant_id,entity_id,adjustment_kind,business_document_id,amount,currency,accounting_date,period_id,reason,status,draft_journal_entry_id,posted_journal_entry_id,original_journal_entry_id,idempotency_key,request_hash,created_by) VALUES($1,$2,$3,'AP_BILL_VOID',$4,100,'USD','2026-08-20',$5,'Exact void','POSTED',$6,$6,$7,'control-166-ap-void',$8,'fixture')`,[voidId,ap.ids.tenantId,ap.ids.entityId,ap.documentId,ap.augustPeriod,apVoid.journalEntryId,ap.ids.journalId,hash('control-166-ap-void')]);
  await adminPool.query("UPDATE business_document SET open_balance=0,status='VOID' WHERE business_document_id=$1",[ap.documentId]);
  const apReader=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ap.ids,'control-lineage-ap-reader',['AP.VIEW'])}),apJuly=(await apReader.getApControlTotal({...ap.ids,periodId:ap.ids.periodId}))[0],apAugust=(await apReader.getApControlTotal({...ap.ids,periodId:ap.augustPeriod}))[0];
  assert.deepEqual([apJuly.open_balance,apJuly.control_balance,apJuly.in_balance],['80.0000','80.0000',true]);assert.deepEqual([apAugust.open_balance,apAugust.control_balance,apAugust.in_balance],['0.0000','0.0000',true]);assert.ok(apAugust.journal_entry_ids.includes(apVoid.journalEntryId));assert.ok(apAugust.source_document_ids.includes(ap.source.documentId));

  const ar=await setup('AR'),arReceipt=await insertPostedControlJournal({ids:ar.ids,periodId:ar.ids.periodId,sourceDocumentId:ar.source.documentId,suffix:'AR-RECEIPT',module:'AR',controlAmount:-20}),arReversal=await insertPostedControlJournal({ids:ar.ids,periodId:ar.augustPeriod,sourceDocumentId:ar.source.documentId,suffix:'AR-REV',module:'AR',controlAmount:20}),arCredit=await insertPostedControlJournal({ids:ar.ids,periodId:ar.augustPeriod,sourceDocumentId:ar.source.documentId,suffix:'AR-CREDIT',module:'AR',controlAmount:-40}),arRefund=await insertPostedControlJournal({ids:ar.ids,periodId:ar.augustPeriod,sourceDocumentId:ar.source.documentId,suffix:'AR-REFUND',module:'AR',controlAmount:10}),arOccurrenceId=randomUUID(),arAllocationId=randomUUID(),arReversalId=randomUUID(),creditId=randomUUID(),refundId=randomUUID(),creditAllocationId=randomUUID();
  await adminPool.query(`INSERT INTO payment_occurrence(payment_occurrence_id,tenant_id,entity_id,business_document_id,occurrence_kind,amount,currency,accounting_date,period_id,status,posted_journal_entry_id,idempotency_key,request_hash,created_by,created_at) VALUES($1,$2,$3,$4,'AR_RECEIPT',20,'USD','2026-07-20',$5,'REVERSED',$6,'control-166-ar-receipt',$7,'fixture','2026-07-20T00:00:00Z')`,[arOccurrenceId,ar.ids.tenantId,ar.ids.entityId,ar.documentId,ar.ids.periodId,arReceipt.journalEntryId,hash('control-166-ar-receipt')]);
  await adminPool.query(`INSERT INTO business_allocation(business_allocation_id,tenant_id,entity_id,business_document_id,payment_occurrence_id,amount,currency,status,posted_journal_entry_id,created_by,created_at) VALUES($1,$2,$3,$4,$5,20,'USD','REVERSED',$6,'fixture','2026-07-20T00:00:00Z')`,[arAllocationId,ar.ids.tenantId,ar.ids.entityId,ar.documentId,arOccurrenceId,arReceipt.journalEntryId]);
  await adminPool.query(`INSERT INTO business_adjustment(business_adjustment_id,tenant_id,entity_id,adjustment_kind,source_occurrence_id,amount,currency,accounting_date,period_id,reason,status,draft_journal_entry_id,posted_journal_entry_id,original_journal_entry_id,idempotency_key,request_hash,created_by) VALUES($1,$2,$3,'AR_RECEIPT_REVERSAL',$4,20,'USD','2026-08-20',$5,'Exact reversal','POSTED',$6,$6,$7,'control-166-ar-rev',$8,'fixture')`,[arReversalId,ar.ids.tenantId,ar.ids.entityId,arOccurrenceId,ar.augustPeriod,arReversal.journalEntryId,arReceipt.journalEntryId,hash('control-166-ar-rev')]);
  await adminPool.query(`INSERT INTO business_adjustment(business_adjustment_id,tenant_id,entity_id,adjustment_kind,amount,currency,accounting_date,period_id,reason,status,draft_journal_entry_id,posted_journal_entry_id,idempotency_key,request_hash,created_by) VALUES($1,$2,$3,'AR_CREDIT_MEMO',40,'USD','2026-08-20',$4,'Exact credit','POSTED',$5,$5,'control-166-ar-credit',$6,'fixture')`,[creditId,ar.ids.tenantId,ar.ids.entityId,ar.augustPeriod,arCredit.journalEntryId,hash('control-166-ar-credit')]);
  await adminPool.query(`INSERT INTO business_allocation(business_allocation_id,tenant_id,entity_id,business_document_id,business_adjustment_id,amount,currency,status,posted_journal_entry_id,created_by,created_at) VALUES($1,$2,$3,$4,$5,30,'USD','ACTIVE',$6,'fixture','2026-08-20T00:00:00Z')`,[creditAllocationId,ar.ids.tenantId,ar.ids.entityId,ar.documentId,creditId,arCredit.journalEntryId]);
  await adminPool.query(`INSERT INTO business_adjustment(business_adjustment_id,tenant_id,entity_id,adjustment_kind,source_adjustment_id,amount,currency,accounting_date,period_id,reason,status,draft_journal_entry_id,posted_journal_entry_id,original_journal_entry_id,idempotency_key,request_hash,created_by) VALUES($1,$2,$3,'AR_REFUND',$4,10,'USD','2026-08-20',$5,'Refund unapplied credit','POSTED',$6,$6,$7,'control-166-ar-refund',$8,'fixture')`,[refundId,ar.ids.tenantId,ar.ids.entityId,creditId,ar.augustPeriod,arRefund.journalEntryId,arCredit.journalEntryId,hash('control-166-ar-refund')]);
  await adminPool.query("UPDATE business_document SET open_balance=70,status='PARTIALLY_PAID' WHERE business_document_id=$1",[ar.documentId]);
  const arReader=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ar.ids,'control-lineage-ar-reader',['AR.VIEW'])}),arJuly=(await arReader.getArControlTotal({...ar.ids,periodId:ar.ids.periodId}))[0],arAugust=(await arReader.getArControlTotal({...ar.ids,periodId:ar.augustPeriod}))[0];
  assert.deepEqual([arJuly.open_balance,arJuly.control_balance,arJuly.in_balance],['80.0000','80.0000',true]);assert.deepEqual([arAugust.open_balance,arAugust.control_balance,arAugust.in_balance],['70.0000','70.0000',true]);assert.ok(arAugust.journal_entry_ids.includes(arRefund.journalEntryId));assert.ok(arAugust.source_document_ids.includes(ar.source.documentId));
  await assert.rejects(arReader.getApControlTotal({...ar.ids,periodId:ar.ids.periodId}),error=>error.code==='42501');await assert.rejects(arReader.getArControlTotal({...ar.ids,periodId:randomUUID()}),error=>error.code==='P0002');
});

pgTest('isolated property rent pickup carries invoice and bank receipt evidence through AR, JE, GL, trial balance, and reports',async()=>{
  // This is intentionally REFS-owned fixture data: it proves the accounting
  // chain that a future signed Property Operations feed must populate, without
  // treating test data as WBS evidence or making any external WBS call.
  const ids=await seed({status:'APPROVED',journalType:'AUTO',attachmentStatus:null,
    extraAccounts:[{accountCode:'400100',accountName:'Property Rental Revenue'}],
    extraMembers:[{memberRef:'TENANT-UNIT-101',memberType:'CUSTOMER',displayName:'Unit 101 tenant'}],
    journalLines:[
      {lineNo:1,accountCode:'120200',debit:100,credit:0,memberRef:'TENANT-UNIT-101',dimensions:{property_ref:'PROP-1',project_ref:'PROJECT-1',unit_ref:'UNIT-101'}},
      {lineNo:2,accountCode:'400100',debit:0,credit:100,dimensions:{property_ref:'PROP-1',project_ref:'PROJECT-1',unit_ref:'UNIT-101'}}
    ]});
  await adminPool.query("UPDATE tenant SET tenant_code='DEMO_STAGE4_PROPERTY_2026',name='DEMO isolated property report acceptance' WHERE tenant_id=$1",[ids.tenantId]);
  await adminPool.query(`INSERT INTO controlled_demo_tenant(tenant_id,scenario_code,display_label,created_by,expires_at)
    VALUES($1,'STAGE4_PROPERTY_REPORTING','DEMO property, project, and unit report acceptance','demo-admin',clock_timestamp()+interval '1 day')`,[ids.tenantId]);
  const invoiceSource=await attachAutoSource(ids);
  const invoicePoster=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'rent-invoice-poster',['GL.JE.POST'])});
  await invoicePoster.postJournal({...ids,journalEntryId:ids.journalId,periodId:ids.periodId,expectedRevision:0,idempotencyKey:'rent-pickup-invoice-post'});
  const invoiceId=randomUUID();
  await adminPool.query(`INSERT INTO business_document(business_document_id,tenant_id,entity_id,source_document_id,document_kind,document_number,counterparty_ref,counterparty_name,currency,accounting_date,due_date,gross_amount,open_balance,status,posted_journal_entry_id,created_by)
    VALUES($1,$2,$3,$4,'AR_INVOICE','RENT-PROP-1-UNIT-101','TENANT-UNIT-101','Unit 101 tenant','USD','2026-07-15','2026-07-31',100,100,'OPEN',$5,'isolated-rent-pickup')`,[invoiceId,ids.tenantId,ids.entityId,invoiceSource.documentId,ids.journalId]);
  const maker=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'rent-receipt-maker',['AR.RECEIPT.CREATE','GL.JE.SUBMIT'])});
  const reviewer=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'rent-receipt-reviewer',['GL.JE.REVIEW'])});
  const approver=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'rent-receipt-approver',['GL.JE.APPROVE'])});
  const poster=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'rent-receipt-poster',['GL.JE.POST'])});
  const receipt=await maker.createArReceipt({...ids,businessDocumentId:invoiceId,receiptNumber:'RENT-REC-PROP-1-40',receiptDate:'2026-07-16',cashAccountCode:'111000',bankMemberRef:'BANK-1',amount:40,reason:'Isolated Property Operations rent pickup',idempotencyKey:'rent-pickup-receipt-create'});
  const receiptSource=await attachAutoSource({...ids,journalId:receipt.journal_entry_id},{reuseApprovedSnapshots:true});
  await maker.transitionJournal({...ids,journalEntryId:receipt.journal_entry_id,action:'SUBMIT',expectedRevision:0,idempotencyKey:'rent-pickup-receipt-submit'});
  await reviewer.transitionJournal({...ids,journalEntryId:receipt.journal_entry_id,action:'REVIEW',expectedRevision:1,idempotencyKey:'rent-pickup-receipt-review'});
  await approver.transitionJournal({...ids,journalEntryId:receipt.journal_entry_id,action:'APPROVE',expectedRevision:2,idempotencyKey:'rent-pickup-receipt-approve'});
  await poster.postJournal({...ids,journalEntryId:receipt.journal_entry_id,periodId:ids.periodId,expectedRevision:3,idempotencyKey:'rent-pickup-receipt-post'});

  const reader=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'rent-pickup-reader',['AR.VIEW','GL.JE.VIEW','GL.REPORT.VIEW'])});
  const demoStatus=await reader.readControlledDemoTenant({tenantId:ids.tenantId});
  assert.deepEqual({is_demo:demoStatus.is_demo,lifecycle_status:demoStatus.lifecycle_status,scenario_code:demoStatus.scenario_code},{is_demo:true,lifecycle_status:'ACTIVE_DEMO',scenario_code:'STAGE4_PROPERTY_REPORTING'});
  assert.deepEqual(await reader.getArAging({tenantId:ids.tenantId,entityId:ids.entityId,asOfDate:'2026-08-31'}),[{currency:'USD',current_amount:'0.0000',days_1_30:'0.0000',days_31_60:'60.0000',days_61_90:'0.0000',days_91_plus:'0.0000',total_open_balance:'60.0000'}]);
  assert.deepEqual(await reader.getArControlTotal({tenantId:ids.tenantId,entityId:ids.entityId}),[{currency:'USD',open_balance:'60.0000',control_balance:'60.0000',in_balance:true}]);

  const invoiceDetail=await reader.getJournalEntryDetail({...ids,journalEntryId:ids.journalId});
  const receiptDetail=await reader.getJournalEntryDetail({...ids,journalEntryId:receipt.journal_entry_id});
  assert(invoiceDetail.lines.every(line=>line.source_document_ids.includes(invoiceSource.documentId)));
  assert(receiptDetail.lines.every(line=>line.source_document_ids.includes(receiptSource.documentId)));
  const revenueLedger=(await reader.listGeneralLedger({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId,accountCode:'400100',query:null,limit:10,offset:0})).filter(row=>row.journal_entry_id===ids.journalId);
  assert.equal(revenueLedger.length,1);assert.equal(revenueLedger[0].credit_amount,'100.0000');assert.deepEqual(revenueLedger[0].source_document_ids,[invoiceSource.documentId]);
  const cashLedger=(await reader.listGeneralLedger({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId,accountCode:'111000',query:null,limit:10,offset:0})).filter(row=>row.journal_entry_id===receipt.journal_entry_id);
  assert.equal(cashLedger.length,1);assert.equal(cashLedger[0].debit_amount,'40.0000');assert.deepEqual(cashLedger[0].source_document_ids,[receiptSource.documentId]);
  const statements=await reader.getFinancialStatements({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId});
  for(const [statementType,accountCode,journalEntryId,sourceDocumentId,amount] of [
    ['TRIAL_BALANCE','120200',ids.journalId,invoiceSource.documentId,'60.0000'],
    ['BALANCE_SHEET','120200',ids.journalId,invoiceSource.documentId,'60.0000'],
    ['TRIAL_BALANCE','400100',ids.journalId,invoiceSource.documentId,'-100.0000'],
    ['INCOME_STATEMENT','400100',ids.journalId,invoiceSource.documentId,'100.0000'],
    ['TRIAL_BALANCE','111000',receipt.journal_entry_id,receiptSource.documentId,'40.0000'],
    ['BALANCE_SHEET','111000',receipt.journal_entry_id,receiptSource.documentId,'40.0000'],
    ['CASH_FLOW','111000',receipt.journal_entry_id,receiptSource.documentId,'40.0000']
  ]){
    const row=statements.find(candidate=>candidate.statement_type===statementType&&candidate.account_code===accountCode);
    assert.ok(row,`${statementType} must expose ${accountCode} rent pickup evidence`);
    assert.equal(row.display_balance,amount);assert.ok(row.journal_entry_ids.includes(journalEntryId));assert.ok(row.source_document_ids.includes(sourceDocumentId));
  }
  for(const [dimensionType,dimensionRef,statementType] of [['PROPERTY','PROP-1','PROPERTY_PNL'],['PROJECT','PROJECT-1','PROJECT_PNL'],['UNIT','UNIT-101','UNIT_PROFITABILITY']]){
    const rows=await reader.getDimensionProfitability({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId,dimensionType,dimensionRef});
    const revenue=rows.find(row=>row.account_code==='400100');
    assert.ok(revenue,`${dimensionType} must retain the rent-revenue row`);assert.equal(revenue.statement_type,statementType);assert.equal(revenue.display_balance,'100.0000');assert.ok(revenue.journal_entry_ids.includes(ids.journalId));assert.ok(revenue.source_document_ids.includes(invoiceSource.documentId));
  }
});

pgTest('signed Property Rent charge reaches independent review AR Draft four-role Post and exact reports',async()=>{
  const ids=await seed({status:'DRAFT',journalType:'AUTO',attachmentStatus:null,
    extraAccounts:[{accountCode:'400100',accountName:'Property Rental Revenue'}],
    extraMembers:[{memberRef:'TENANT-UNIT-101',memberType:'CUSTOMER',displayName:'Unit 101 tenant'}]});
  const batchId=randomUUID(),snapshotImportId=randomUUID(),snapshotReceiptId=randomUUID(),receiptId=randomUUID(),rowId=randomUUID(),snapshotId=randomUUID(),sourceRecordId='RENT-PROP-1-UNIT-101-202607',sourceVersion=`snapshot:${snapshotId}:rent-001`,receiptHash=hash('signed property rent payload'),payloadRef='object://wbs-snapshot/property-rent-001';
  const normalized={source_system:'WBS',source_type:'PROPERTY_RENT_CHARGE',admission:'TRANSACTION_CANDIDATE',transaction_kind:'RENT_CHARGE',source_record_id:sourceRecordId,source_version:sourceVersion,receipt_hash:receiptHash,receipt_ref:payloadRef,company_key:ids.sourceEntityId,currency:'USD',accounting_date:'2026-07-15',business_date:'2026-07-01',amount_money4:'100.0000',property_ref:'PROP-1',unit_ref:'UNIT-101',lease_ref:'LEASE-101',tenant_ref:'TENANT-UNIT-101',charge_number:'RENT-PROP-1-UNIT-101-202607'};
  const raw={charge_id:sourceRecordId,amount:'100.0000'},outcome={stage:'STAGING_REVIEW_REQUIRED'};
  await adminPool.query(`INSERT INTO import_batch(import_batch_id,tenant_id,entity_id,connector_code,source_module,source_entity_id,idempotency_key,request_hash,status,row_count,started_at,completed_at) VALUES($1,$2,$3,'WBS_SNAPSHOT','pmCharge',$4,'rent-import-fixture',$5,'SUCCEEDED',1,now(),now())`,[batchId,ids.tenantId,ids.entityId,ids.sourceEntityId,hash('rent import')]);
  await adminPool.query(`INSERT INTO wbs_snapshot_import(wbs_snapshot_import_id,tenant_id,entity_id,snapshot_id,captured_at,environment,dictionary_version,package_hash,import_batch_id,created_by) VALUES($1,$2,$3,$4,'2026-07-15T03:00:00Z','PRODUCTION','WBS-RENT-V1',$5,$6,'signed-rent-importer')`,[snapshotImportId,ids.tenantId,ids.entityId,snapshotId,hash('rent package'),batchId]);
  await adminPool.query(`INSERT INTO wbs_snapshot_delivery_attestation(tenant_id,entity_id,wbs_snapshot_import_id,attestation,attestation_hash,created_by) VALUES($1,$2,$3,$4::jsonb,$5,'signed-rent-importer')`,[ids.tenantId,ids.entityId,snapshotImportId,JSON.stringify({schema_version:'WBS_READONLY_SNAPSHOT_V2',delivery:{consistency:'COMPLETE',pagination:'PRIMARY_KEY_SEEK',read_consistency:'SNAPSHOT_ISOLATION'},views:[{name:'pmCharge',company_key:ids.sourceEntityId,row_count:1,first_primary_key:sourceRecordId,last_primary_key:sourceRecordId,content_hash:receiptHash}]}),hash('rent attestation')]);
  await adminPool.query(`INSERT INTO wbs_snapshot_receipt(wbs_snapshot_receipt_id,tenant_id,entity_id,wbs_snapshot_import_id,source_module,source_entity_id,source_record_id,source_version,payload_hash,payload_ref,ingestion_kind,receipt_hash) VALUES($1,$2,$3,$4,'pmCharge',$5,$6,$7,$8,$9,'TRANSACTION_CANDIDATE',$10)`,[snapshotReceiptId,ids.tenantId,ids.entityId,snapshotImportId,ids.sourceEntityId,sourceRecordId,sourceVersion,receiptHash,payloadRef,hash('rent snapshot receipt')]);
  await adminPool.query(`INSERT INTO wbs_inbound_receipt(receipt_id,tenant_id,entity_id,import_batch_id,receipt_hash,payload_ref) VALUES($1,$2,$3,$4,$5,$6)`,[receiptId,ids.tenantId,ids.entityId,batchId,receiptHash,payloadRef]);
  await adminPool.query(`INSERT INTO wbs_inbound_row(wbs_inbound_row_id,tenant_id,entity_id,receipt_id,source_record_id,source_version,raw,normalized,outcome,outcome_kind) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,'STAGING')`,[rowId,ids.tenantId,ids.entityId,receiptId,sourceRecordId,sourceVersion,JSON.stringify(raw),JSON.stringify(normalized),JSON.stringify(outcome)]);
  const evidenceHash=(await adminPool.query('SELECT refs_wbs_property_rent_source_evidence_hash($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8) evidence_hash',[rowId,sourceRecordId,sourceVersion,receiptHash,JSON.stringify(raw),JSON.stringify(normalized),JSON.stringify(outcome),'STAGING'])).rows[0].evidence_hash;
  const admissionKernel=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'rent-admitter',['WBS.PROPERTY.REVIEW'])});
  const zero=async()=>(await adminPool.query(`SELECT (SELECT count(*)::int FROM business_document WHERE tenant_id=$1 AND entity_id=$2) documents,(SELECT count(*)::int FROM wbs_property_rent_review_evidence WHERE tenant_id=$1 AND entity_id=$2) reviews,(SELECT count(*)::int FROM wbs_property_rent_draft_evidence WHERE tenant_id=$1 AND entity_id=$2) drafts,(SELECT count(*)::int FROM ledger_line WHERE tenant_id=$1 AND entity_id=$2) ledger`,[ids.tenantId,ids.entityId])).rows[0];
  const before=await zero();
  await assert.rejects(admissionKernel.admitWbsPropertyRentSource({...ids,entityId:randomUUID(),wbsInboundRowId:rowId,expectedSourceVersion:sourceVersion,expectedReceiptHash:receiptHash,expectedEvidenceHash:evidenceHash,reason:'Reject cross entity property rent evidence',idempotencyKey:'rent-admit-scope-001'}),error=>error.code==='42501');
  await assert.rejects(admissionKernel.admitWbsPropertyRentSource({...ids,wbsInboundRowId:rowId,expectedSourceVersion:`${sourceVersion}:stale`,expectedReceiptHash:receiptHash,expectedEvidenceHash:evidenceHash,reason:'Reject stale property rent source version',idempotencyKey:'rent-admit-version-001'}),error=>error.code==='40001');
  await assert.rejects(admissionKernel.admitWbsPropertyRentSource({...ids,wbsInboundRowId:rowId,expectedSourceVersion:sourceVersion,expectedReceiptHash:receiptHash,expectedEvidenceHash:hash('stale rent'),reason:'Reject stale property rent evidence',idempotencyKey:'rent-admit-stale-001'}),error=>error.code==='40001');assert.deepEqual(await zero(),before);
  const admitted=await admissionKernel.admitWbsPropertyRentSource({...ids,wbsInboundRowId:rowId,expectedSourceVersion:sourceVersion,expectedReceiptHash:receiptHash,expectedEvidenceHash:evidenceHash,reason:'Admit exact signed property rent transaction',idempotencyKey:'rent-admit-valid-001'});
  const settingId=randomUUID(),mappingId=randomUUID(),inputKeys={company_key:ids.sourceEntityId,currency:'USD',property_ref:'PROP-1',unit_ref:'UNIT-101',lease_ref:'LEASE-101',tenant_ref:'TENANT-UNIT-101'},outputRules={receivable_account_code:'120200',revenue_account_code:'400100',due_days:'16',rule_code:'WBS_PROPERTY_RENT_PICKUP',rule_version:'1'};
  const hashes=(await adminPool.query(`SELECT refs_jsonb_hash('{}'::jsonb) setting_hash,refs_jsonb_hash($1::jsonb) input_hash,refs_jsonb_hash(jsonb_build_object('input_keys',$1::jsonb,'output_rules',$2::jsonb)) mapping_hash`,[JSON.stringify(inputKeys),JSON.stringify(outputRules)])).rows[0];
  await adminPool.query(`INSERT INTO setting_snapshot(setting_snapshot_id,tenant_id,entity_id,family,scope_type,scope_key,version,effective_from,status,snapshot,snapshot_hash,created_by,approved_by,approved_at) VALUES($1,$2,$3::uuid,'WBS_PROPERTY_RENT_REVIEW','ENTITY',($3::uuid)::text,1,'2026-01-01','APPROVED','{}',$4,'rent-setting-maker','rent-setting-approver',now())`,[settingId,ids.tenantId,ids.entityId,hashes.setting_hash]);
  await adminPool.query(`INSERT INTO mapping_snapshot(mapping_snapshot_id,tenant_id,entity_id,family,scope_type,scope_key,input_key_hash,version,priority,effective_from,status,input_keys,output_rules,snapshot_hash,created_by,approved_by,approved_at) VALUES($1,$2,$3::uuid,'WBS_PROPERTY_RENT_PICKUP','ENTITY',($3::uuid)::text,$4,1,100,'2026-01-01','APPROVED',$5::jsonb,$6::jsonb,$7,'rent-map-maker','rent-map-approver',now())`,[mappingId,ids.tenantId,ids.entityId,hashes.input_hash,JSON.stringify(inputKeys),JSON.stringify(outputRules),hashes.mapping_hash]);
  const reviewer=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'rent-source-reviewer',['WBS.PROPERTY.RENT.REVIEW'])});
  const reviewed=await reviewer.reviewWbsPropertyRent({...ids,admissionId:admitted.wbs_property_rent_source_admission_id,periodId:ids.periodId,expectedRevision:0,expectedEvidenceHash:evidenceHash,reason:'Review exact rent charge with server mapping',idempotencyKey:'rent-review-valid-001'});assert.equal(reviewed.revision,1);
  const maker=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'rent-draft-maker',['WBS.PROPERTY.RENT.DRAFT','AR.INVOICE.CREATE','GL.JE.AUTO.CREATE'])});
  await assert.rejects(reviewer.createWbsPropertyRentDraft({...ids,reviewEvidenceId:reviewed.review_evidence_id,expectedRevision:1,expectedEvidenceHash:evidenceHash,reason:'Reviewer cannot create rent Draft',idempotencyKey:'rent-draft-sod-001'}),error=>error.code==='42501');
  const beforeDraft=await zero();await assert.rejects(maker.createWbsPropertyRentDraft({...ids,reviewEvidenceId:reviewed.review_evidence_id,expectedRevision:0,expectedEvidenceHash:evidenceHash,reason:'Reject stale rent staging revision',idempotencyKey:'rent-draft-revision-001'}),error=>error.code==='40001');await assert.rejects(maker.createWbsPropertyRentDraft({...ids,reviewEvidenceId:reviewed.review_evidence_id,expectedRevision:1,expectedEvidenceHash:hash('stale reviewed rent'),reason:'Reject stale reviewed rent evidence',idempotencyKey:'rent-draft-stale-001'}),error=>error.code==='40001');assert.deepEqual(await zero(),beforeDraft);
  const drafted=await maker.createWbsPropertyRentDraft({...ids,reviewEvidenceId:reviewed.review_evidence_id,expectedRevision:1,expectedEvidenceHash:evidenceHash,reason:'Create AR Invoice from reviewed signed rent',idempotencyKey:'rent-draft-valid-001'});
  const submitter=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'rent-submitter',['GL.JE.SUBMIT'])}),jeReviewer=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'rent-je-reviewer',['GL.JE.REVIEW'])}),approver=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'rent-approver',['GL.JE.APPROVE'])}),poster=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'rent-poster',['GL.JE.POST'])});
  await submitter.transitionJournal({...ids,journalEntryId:drafted.journal_entry_id,action:'SUBMIT',expectedRevision:0,idempotencyKey:'rent-submit-001'});await jeReviewer.transitionJournal({...ids,journalEntryId:drafted.journal_entry_id,action:'REVIEW',expectedRevision:1,idempotencyKey:'rent-je-review-001'});await approver.transitionJournal({...ids,journalEntryId:drafted.journal_entry_id,action:'APPROVE',expectedRevision:2,idempotencyKey:'rent-approve-001'});await poster.postJournal({...ids,journalEntryId:drafted.journal_entry_id,periodId:ids.periodId,expectedRevision:3,idempotencyKey:'rent-post-001'});
  const reader=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'rent-authority-reader',['AR.VIEW','GL.JE.VIEW','GL.REPORT.VIEW'])});
  const detail=await reader.getJournalEntryDetail({...ids,journalEntryId:drafted.journal_entry_id});assert(detail.lines.every(line=>line.source_document_ids.includes(admitted.source_document_id)));
  const invoice=(await reader.listBusinessDocuments({tenantId:ids.tenantId,entityId:ids.entityId,documentKind:'AR_INVOICE',periodId:ids.periodId,limit:100,offset:0})).rows.find(row=>row.business_document_id===drafted.business_document_id);assert.deepEqual({status:invoice.status,amount:invoice.gross_amount,journal:invoice.journal_entry_id},{status:'OPEN',amount:'100.0000',journal:drafted.journal_entry_id});
  const gl=await reader.listGeneralLedger({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId,accountCode:'400100',query:null,limit:20,offset:0});const rentGl=gl.find(row=>row.journal_entry_id===drafted.journal_entry_id);assert.equal(rentGl.credit_amount,'100.0000');assert.deepEqual(rentGl.source_document_ids,[admitted.source_document_id]);
  const statements=await reader.getFinancialStatements({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId});const revenue=statements.find(row=>row.statement_type==='INCOME_STATEMENT'&&row.account_code==='400100');assert.equal(revenue.display_balance,'100.0000');assert.ok(revenue.journal_entry_ids.includes(drafted.journal_entry_id));assert.ok(revenue.source_document_ids.includes(admitted.source_document_id));
  for(const [dimensionType,dimensionRef] of [['PROPERTY','PROP-1'],['UNIT','UNIT-101']]){const rows=await reader.getDimensionProfitability({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId,dimensionType,dimensionRef});const row=rows.find(item=>item.account_code==='400100');assert.equal(row.display_balance,'100.0000');assert.ok(row.source_document_ids.includes(admitted.source_document_id));}
  const augustPeriodId=randomUUID();await adminPool.query("INSERT INTO accounting_period(period_id,tenant_id,entity_id,period_code,starts_on,ends_on,status) VALUES($1,$2,$3,'2026-08','2026-08-01','2026-08-31','OPEN')",[augustPeriodId,ids.tenantId,ids.entityId]);
  const queueReader=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'rent-queue-reader',['WBS.PROPERTY.REVIEW'])});
  const julyQueue=await queueReader.listWbsPropertyRentPickup({...ids,periodId:ids.periodId,limit:10});assert.equal(julyQueue.length,1);assert.deepEqual({status:julyQueue[0].workflow_status,period:julyQueue[0].period_id,property:julyQueue[0].property_ref},{status:'POSTED',period:ids.periodId,property:'PROP-1'});
  assert.deepEqual(await queueReader.listWbsPropertyRentPickup({...ids,periodId:augustPeriodId,limit:10}),[],'reviewed July Rent evidence must not leak into the August queue');
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
  const julySnapshot=await reader.getAgingSnapshotSummary({tenantId:ids.tenantId,entityId:ids.entityId,documentKind:'AP_BILL',periodId:ids.periodId,asOfDate:'2026-07-31'});
  assert.deepEqual(julySnapshot.rows,[{counterparty_ref:'VENDOR-1',counterparty_name:'Vendor',currency:'USD',current_amount:'0.0000',days_1_30:'60.0000',days_31_60:'0.0000',days_61_90:'0.0000',days_91_plus:'0.0000',total_open_balance:'60.0000',document_count:'1'}]);
  assert.equal(julySnapshot.scope.detail_count,1);assert.equal(julySnapshot.scope.counterparty_count,1);assert.match(julySnapshot.scope.snapshot_hash,/^sha256:[0-9a-f]{64}$/);
  const julyDetail=await reader.getAgingSnapshotDetail({tenantId:ids.tenantId,entityId:ids.entityId,documentKind:'AP_BILL',periodId:ids.periodId,asOfDate:'2026-07-31',counterpartyRef:'VENDOR-1',counterpartyName:'Vendor',currency:'USD',limit:25,offset:0});
  assert.equal(julyDetail.rows.length,1);assert.equal(julyDetail.rows[0].business_document_id,billId);assert.equal(julyDetail.rows[0].open_balance,'60.0000');assert.equal(julyDetail.scope.snapshot_id,julySnapshot.scope.snapshot_id);assert.equal(julyDetail.scope.snapshot_hash,julySnapshot.scope.snapshot_hash);
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
  const retainedJuly=await reader.getAgingSnapshotSummary({tenantId:ids.tenantId,entityId:ids.entityId,documentKind:'AP_BILL',periodId:ids.periodId,asOfDate:'2026-07-31'}),augustSnapshot=await reader.getAgingSnapshotSummary({tenantId:ids.tenantId,entityId:ids.entityId,documentKind:'AP_BILL',periodId:augustPeriod,asOfDate:'2026-08-31'});
  assert.equal(retainedJuly.rows[0].total_open_balance,'60.0000','an August reversal must not rewrite the July historical snapshot');assert.equal(retainedJuly.scope.snapshot_hash,julySnapshot.scope.snapshot_hash);
  assert.equal(augustSnapshot.rows[0].total_open_balance,'100.0000');assert.notEqual(augustSnapshot.scope.snapshot_hash,julySnapshot.scope.snapshot_hash);
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
  await assert.rejects(denied.listReconciliationScopes({tenantId:ids.tenantId,entityId:ids.entityId}),error=>error.code==='42501');
  const reader=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'bank-reader',['BANK.VIEW'])});
  const rows=await reader.listBankTransactions({tenantId:ids.tenantId,entityId:ids.entityId,bankAccountRef:'BANK-1',fromDate:'2026-07-01',throughDate:'2026-07-31',limit:25});
  assert.equal(rows.length,1);assert.equal(rows[0].bank_source_id,bankSourceId);assert.equal(rows[0].bank_match_id,bankMatchId);
  assert.equal(rows[0].transaction_date,'2026-07-15');assert.equal(typeof rows[0].transaction_date,'string');
  assert.equal(rows[0].match_status,'ACTIVE');assert.equal(rows[0].journal_entry_id,ids.journalId);assert.equal(rows[0].amount,'100.0000');
  await assert.rejects(reader.listBankTransactions({tenantId:ids.tenantId,entityId:ids.entityId,bankAccountRef:'BANK-1',limit:null}),error=>error.code==='22023');
  assert.deepEqual(await reader.listBankTransactions({tenantId:ids.tenantId,entityId:ids.entityId,bankAccountRef:'OTHER',limit:25}),[]);
  const oldBankSourceId=randomUUID(),priorReconciliationId=randomUUID();
  await adminPool.query(`INSERT INTO bank_source(bank_source_id,tenant_id,entity_id,source_document_id,bank_account_ref,external_bank_line_id,transaction_date,currency,amount)
    VALUES($1,$2,$3,$4,'BANK-1','BANK-LINE-OLD','2026-07-05','USD',25)`,[oldBankSourceId,ids.tenantId,ids.entityId,trace.documentId]);
  await adminPool.query(`INSERT INTO reconciliation(reconciliation_id,tenant_id,entity_id,bank_account_ref,statement_ending_date,statement_ending_balance,difference,status,reconciled_by,reconciled_at)
    VALUES($1,$2,$3,'BANK-1','2026-07-10',25,0,'RECONCILED','bank-reviewer',now())`,[priorReconciliationId,ids.tenantId,ids.entityId]);
  const firstPage=await reader.listBankTransactions({tenantId:ids.tenantId,entityId:ids.entityId,bankAccountRef:'BANK-1',fromDate:'2026-07-01',throughDate:'2026-07-31',limit:1,offset:0});
  const secondPage=await reader.listBankTransactions({tenantId:ids.tenantId,entityId:ids.entityId,bankAccountRef:'BANK-1',fromDate:'2026-07-01',throughDate:'2026-07-31',limit:1,offset:1});
  assert.deepEqual(firstPage.map(row=>row.bank_source_id),[bankSourceId]);
  assert.deepEqual(secondPage.map(row=>row.bank_source_id),[oldBankSourceId]);
  await assert.rejects(reader.listBankTransactions({tenantId:ids.tenantId,entityId:ids.entityId,bankAccountRef:'BANK-1',limit:1,offset:10001}),error=>error.code==='22023');
  const summaries=await reader.getReconciliationSummary({tenantId:ids.tenantId,entityId:ids.entityId,bankAccountRef:'BANK-1',statementEndingDate:'2026-07-31'});
  assert.equal(summaries.length,1);assert.equal(summaries[0].reconciliation_id,reconciliationId);
  assert.equal(summaries[0].bank_transaction_count,'1');assert.equal(summaries[0].active_match_count,'1');assert.equal(summaries[0].unmatched_transaction_count,'0');
  assert.equal(summaries[0].statement_activity_amount,'100.0000');
  assert.deepEqual(await reader.getReconciliationSummary({tenantId:ids.tenantId,entityId:ids.entityId,bankAccountRef:'BANK-1',statementEndingDate:'2026-07-10'}),[]);
  const scopes=await reader.listReconciliationScopes({tenantId:ids.tenantId,entityId:ids.entityId,limit:25});
  assert.deepEqual(scopes.map(row=>({id:row.reconciliation_id,account:row.bank_account_ref,date:row.statement_ending_date,status:row.status,version:row.version})),[
    {id:reconciliationId,account:'BANK-1',date:'2026-07-31',status:'DRAFT',version:'0'},
    {id:priorReconciliationId,account:'BANK-1',date:'2026-07-10',status:'RECONCILED',version:'0'}
  ]);
  await assert.rejects(reader.listReconciliationScopes({tenantId:ids.tenantId,entityId:ids.entityId,limit:201}),error=>error.code==='22023');
  const indexes=(await adminPool.query("SELECT to_regclass('public.bank_source_read_scope_idx') bank, to_regclass('public.reconciliation_live_read_scope_idx') live, to_regclass('public.reconciliation_reconciled_cutoff_idx') cutoff")).rows[0];
  assert.deepEqual(indexes,{bank:'bank_source_read_scope_idx',live:'reconciliation_live_read_scope_idx',cutoff:'reconciliation_reconciled_cutoff_idx'});

  const outside=await seed({status:'DRAFT',attachmentStatus:null,tenantId:ids.tenantId});
  await assert.rejects(reader.listBankTransactions({tenantId:ids.tenantId,entityId:outside.entityId,bankAccountRef:'BANK-1'}),error=>error.code==='42501');
  const api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId:ids.tenantId,actorId:'bank-reader'}),kernelFactory:async()=>reader});
  const response=await api({method:'GET',url:`/api/v1/entities/${ids.entityId}/bank/reconciliation?bankAccountRef=BANK-1&statementEndingDate=2026-07-31`,body:null,headers:{}});
  assert.equal(response.status,200);assert.equal(response.headers['cache-control'],'no-store');assert.equal(response.body.data[0].reconciliation_id,reconciliationId);
  const scopeResponse=await api({method:'GET',url:`/api/v1/entities/${ids.entityId}/bank/reconciliations/scopes?limit=25`,body:null,headers:{}});
  assert.equal(scopeResponse.status,200);assert.equal(scopeResponse.headers['cache-control'],'no-store');assert.deepEqual(scopeResponse.body.data.map(row=>row.reconciliation_id),[reconciliationId,priorReconciliationId]);
});

pgTest('reconciliation lifecycle is scoped, idempotent, separated by role, snapshotted, and reopen-gated',async()=>{
  const ids=await seed({status:'APPROVED',attachmentStatus:null});const billId=randomUUID();
  await adminPool.query(`INSERT INTO business_document(business_document_id,tenant_id,entity_id,document_kind,document_number,counterparty_ref,counterparty_name,currency,accounting_date,due_date,gross_amount,open_balance,status,created_by)
    VALUES($1,$2,$3,'AP_BILL','BILL-RECON-1','VENDOR-1','Vendor','USD','2026-07-15','2026-08-15',100,100,'APPROVED','fixture')`,[billId,ids.tenantId,ids.entityId]);
  const paymentMaker=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'recon-payment-maker',['AP.PAYMENT.CREATE','GL.JE.SUBMIT'])});
  const paymentReviewer=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'recon-payment-reviewer',['GL.JE.REVIEW'])});
  const paymentApprover=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'recon-payment-approver',['GL.JE.APPROVE'])});
  const paymentPoster=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'recon-payment-poster',['GL.JE.POST'])});
  const payment=await paymentMaker.createApPayment({...ids,businessDocumentId:billId,paymentNumber:'PAY-RECON-100',paymentDate:'2026-07-16',cashAccountCode:'111000',bankMemberRef:'BANK-1',amount:100,reason:'Reconciliation exact payment evidence',idempotencyKey:'recon-payment-create-001'});
  const trace=await attachAutoSource({...ids,journalId:payment.journal_entry_id});
  await paymentMaker.transitionJournal({...ids,journalEntryId:payment.journal_entry_id,action:'SUBMIT',expectedRevision:0,idempotencyKey:'recon-payment-submit-001'});
  await paymentReviewer.transitionJournal({...ids,journalEntryId:payment.journal_entry_id,action:'REVIEW',expectedRevision:1,idempotencyKey:'recon-payment-review-001'});
  await paymentApprover.transitionJournal({...ids,journalEntryId:payment.journal_entry_id,action:'APPROVE',expectedRevision:2,idempotencyKey:'recon-payment-approve-001'});
  await paymentPoster.postJournal({...ids,journalEntryId:payment.journal_entry_id,periodId:ids.periodId,expectedRevision:3,idempotencyKey:'recon-payment-post-001'});
  const bankSourceId=randomUUID();
  await adminPool.query(`INSERT INTO bank_source(bank_source_id,tenant_id,entity_id,source_document_id,bank_account_ref,external_bank_line_id,transaction_date,currency,amount)
    VALUES($1,$2,$3,$4,'BANK-1','BANK-RECON-1','2026-07-16','USD',-100)`,[bankSourceId,ids.tenantId,ids.entityId,trace.documentId]);
  const matcher=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'recon-matcher',['BANK.MATCH.CREATE'])});
  const matched=await matcher.createBankPaymentMatch({...ids,bankSourceId,paymentOccurrenceId:payment.payment_occurrence_id,expectedBankVersion:0,expectedOccurrenceVersion:1,reason:'Exact posted payment selected for reconciliation',idempotencyKey:'recon-bank-match-001'});
  const bankMatchId=matched.bank_match_id;
  const starter=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'recon-starter',['BANK.RECONCILIATION.START'])});
  const clearer=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'recon-clearer',['BANK.RECONCILIATION.CLEAR'])});
  const reviewer=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'recon-reviewer',['BANK.RECONCILIATION.REVIEW'])});
  const signer=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'recon-signer',['BANK.RECONCILIATION.SIGN_OFF'])});
  const reopener=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'recon-reopener',['BANK.RECONCILIATION.REOPEN'])});
  const unmatcher=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'recon-unmatcher',['BANK.MATCH.UNMATCH'])});
  const startArgs={...ids,bankAccountRef:'BANK-1',statementEndingDate:'2026-07-31',statementOpeningBalance:'0.0000',statementEndingBalance:'-100.0000',reason:'Start July statement review',idempotencyKey:'reconciliation-start-001'};
  const started=await starter.startReconciliation(startArgs),startReplay=await starter.startReconciliation(startArgs);
  assert.equal(started.status,'DRAFT');assert.equal(started.revision,0);assert.equal(startReplay.idempotent,true);
  await adminPool.query("UPDATE payment_occurrence SET status='DRAFT' WHERE payment_occurrence_id=$1",[payment.payment_occurrence_id]);
  await assert.rejects(clearer.setReconciliationClearance({...ids,reconciliationId:started.reconciliation_id,bankSourceId,expectedReconciliationVersion:0,expectedBankVersion:0,clear:true,reason:'Changed occurrence must not clear',idempotencyKey:'reconciliation-clear-tampered-occurrence-001'}),error=>error.code==='23514'&&/exact actively matched/i.test(error.message));
  await adminPool.query("UPDATE payment_occurrence SET status='POSTED' WHERE payment_occurrence_id=$1",[payment.payment_occurrence_id]);
  const cleared=await clearer.setReconciliationClearance({...ids,reconciliationId:started.reconciliation_id,bankSourceId,expectedReconciliationVersion:0,expectedBankVersion:0,clear:true,reason:'Exact active match cleared',idempotencyKey:'reconciliation-clear-001'});
  assert.equal(Number(cleared.difference),0);assert.equal(cleared.revision,1);
  const reviewed=await reviewer.transitionReconciliation({...ids,reconciliationId:started.reconciliation_id,action:'REVIEW',expectedVersion:1,reason:'Reviewer verified complete statement evidence',idempotencyKey:'reconciliation-review-001'});
  assert.equal(reviewed.status,'IN_REVIEW');assert.equal(reviewed.revision,2);
  await assert.rejects(reviewer.transitionReconciliation({...ids,reconciliationId:started.reconciliation_id,action:'SIGN_OFF',expectedVersion:2,reason:'Reviewer cannot sign own work',idempotencyKey:'reconciliation-signoff-bad-001'}),error=>error.code==='42501');
  const signed=await signer.transitionReconciliation({...ids,reconciliationId:started.reconciliation_id,action:'SIGN_OFF',expectedVersion:2,reason:'Independent controller statement sign off',idempotencyKey:'reconciliation-signoff-001'});
  assert.equal(signed.status,'RECONCILED');assert.ok(signed.snapshot_id);assert.match(signed.snapshot_hash,/^sha256:[0-9a-f]{64}$/);
  await assert.rejects(starter.startReconciliation({...startArgs,statementEndingDate:'2026-07-30',idempotencyKey:'reconciliation-retro-start-001'}),error=>error.code==='23514'&&/latest signed-off/i.test(error.message));
  await assert.rejects(unmatcher.unmatchBankPayment({...ids,bankSourceId,bankMatchId,expectedMatchVersion:0,reason:'Blocked while statement is signed',idempotencyKey:'reconciliation-unmatch-bad-001'}),error=>error.code==='23514'&&/reopened/i.test(error.message));
  const laterReconciliationId=randomUUID();
  await adminPool.query(`INSERT INTO reconciliation(reconciliation_id,tenant_id,entity_id,bank_account_ref,statement_ending_date,statement_opening_balance,statement_ending_balance,book_ending_balance,currency,difference,status,reconciled_by,reconciled_at)
    VALUES($1,$2,$3,'BANK-1','2026-08-31',-100,-100,-100,'USD',0,'RECONCILED','later-signer',now())`,[laterReconciliationId,ids.tenantId,ids.entityId]);
  await adminPool.query(`INSERT INTO reconciliation_snapshot(reconciliation_snapshot_id,tenant_id,entity_id,reconciliation_id,reconciliation_version,statement_ending_date,snapshot_body,snapshot_hash,signed_off_by)
    VALUES(gen_random_uuid(),$1,$2,$3,0,'2026-08-31',jsonb_build_object('fixture','later-signed'),refs_jsonb_hash(jsonb_build_object('fixture','later-signed')),'later-signer')`,[ids.tenantId,ids.entityId,laterReconciliationId]);
  await assert.rejects(reopener.transitionReconciliation({...ids,reconciliationId:started.reconciliation_id,action:'REOPEN',expectedVersion:3,reason:'Older statement cannot reopen after later sign off',idempotencyKey:'reconciliation-reopen-out-of-order-001'}),error=>error.code==='23514'&&/latest signed-off/i.test(error.message));
  const laterReopened=await reopener.transitionReconciliation({...ids,reconciliationId:laterReconciliationId,action:'REOPEN',expectedVersion:0,reason:'Latest signed statement may be reopened',idempotencyKey:'reconciliation-reopen-later-001'});
  assert.equal(laterReopened.status,'REOPENED');
  await assert.rejects(reopener.transitionReconciliation({...ids,reconciliationId:started.reconciliation_id,action:'REOPEN',expectedVersion:3,reason:'Older statement remains blocked after latest reopen',idempotencyKey:'reconciliation-reopen-after-latest-reopened-001'}),error=>error.code==='23514'&&/latest signed-off/i.test(error.message));
  await adminPool.query('DELETE FROM reconciliation_snapshot WHERE reconciliation_id=$1',[laterReconciliationId]);
  await adminPool.query('DELETE FROM reconciliation WHERE reconciliation_id=$1',[laterReconciliationId]);
  const reopened=await reopener.transitionReconciliation({...ids,reconciliationId:started.reconciliation_id,action:'REOPEN',expectedVersion:3,reason:'Independent controller approved reopen',idempotencyKey:'reconciliation-reopen-001'});
  assert.equal(reopened.status,'REOPENED');assert.equal(reopened.revision,4);
  assert.equal((await unmatcher.unmatchBankPayment({...ids,bankSourceId,bankMatchId,expectedMatchVersion:0,reason:'Unmatch after controlled statement reopen',idempotencyKey:'reconciliation-unmatch-001'})).status,'UNMATCHED');
  const snapshot=(await adminPool.query('SELECT signed_off_by,snapshot_hash FROM reconciliation_snapshot WHERE reconciliation_id=$1',[started.reconciliation_id])).rows[0];
  assert.equal(snapshot.signed_off_by,'recon-signer');assert.equal(snapshot.snapshot_hash,signed.snapshot_hash);
});

pgTest('reconciliation adjustment Draft binds one unresolved bank source through Posted clearance, review, and immutable sign-off',async()=>{
  const ids=await seed({status:'APPROVED'});const trace=await attachAutoSource(ids,{linkJournal:false});const bankSourceId=randomUUID();
  await adminPool.query(`INSERT INTO bank_source(bank_source_id,tenant_id,entity_id,source_document_id,bank_account_ref,external_bank_line_id,transaction_date,currency,amount)
    VALUES($1,$2,$3,$4,'BANK-1','BANK-ADJUSTMENT-1','2026-07-20','USD',50)`,[bankSourceId,ids.tenantId,ids.entityId,trace.documentId]);
  const attachmentId=(await adminPool.query("SELECT attachment_id FROM source_link WHERE tenant_id=$1 AND entity_id=$2 AND journal_entry_id=$3 AND attachment_id IS NOT NULL",[ids.tenantId,ids.entityId,ids.journalId])).rows[0].attachment_id;
  const starter=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'adjustment-starter',['BANK.RECONCILIATION.START'])});
  const started=await starter.startReconciliation({...ids,bankAccountRef:'BANK-1',statementEndingDate:'2026-07-31',statementOpeningBalance:'0.0000',statementEndingBalance:'50.0000',reason:'Start statement with one unresolved bank charge',idempotencyKey:'adjustment-start-001'});
  assert.equal(Number(started.difference),50);assert.equal(started.revision,0);
  const maker=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'adjustment-maker',['BANK.RECONCILIATION.ADJUSTMENT_DRAFT','BANK.RECONCILIATION.REVIEW','GL.JE.CREATE','GL.JE.SUBMIT'])});
  const args={...ids,reconciliationId:started.reconciliation_id,bankSourceId,expectedReconciliationVersion:0,periodId:ids.periodId,journalNumber:'JE-RECON-ADJ-001',journalDate:'2026-07-20',currency:'USD',description:'Record the supported statement cash adjustment',lines:[
    {line_no:1,account_code:'111000',debit_amount:'50.0000',credit_amount:'0.0000',member_ref:'BANK-1',description:'Statement bank movement',dimensions:{}},
    {line_no:2,account_code:'291001',debit_amount:'0.0000',credit_amount:'50.0000',member_ref:'VENDOR-1',description:'Offsetting payable evidence',dimensions:{}}
  ],attachmentIds:[attachmentId],reason:'Independent support for one exact statement adjustment',idempotencyKey:'adjustment-draft-001'};
  const otherEntity=await seed({status:'DRAFT',tenantId:ids.tenantId}),otherAttachment=(await adminPool.query("SELECT attachment_id FROM source_link WHERE tenant_id=$1 AND entity_id=$2 AND journal_entry_id=$3 AND attachment_id IS NOT NULL",[otherEntity.tenantId,otherEntity.entityId,otherEntity.journalId])).rows[0].attachment_id;
  await assert.rejects(maker.createReconciliationAdjustmentDraft({...args,attachmentIds:[otherAttachment],idempotencyKey:'adjustment-cross-entity-evidence'}),error=>error.code==='23503');
  const created=await maker.createReconciliationAdjustmentDraft(args),replay=await maker.createReconciliationAdjustmentDraft(args);
  assert.equal(created.journal_status,'DRAFT');assert.equal(created.reconciliation_revision,1);assert.equal(replay.idempotent,true);assert.equal(replay.journal_entry_id,created.journal_entry_id);
  const clearer=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'adjustment-clearer',['BANK.RECONCILIATION.CLEAR'])});
  const clearArgs={...ids,reconciliationId:started.reconciliation_id,bankSourceId,expectedReconciliationVersion:1,expectedBankVersion:0,clear:true,reason:'Clear exact posted adjustment against statement source',idempotencyKey:'adjustment-clear-001'};
  await assert.rejects(clearer.setReconciliationAdjustmentClearance(clearArgs),error=>error.code==='23514');
  await maker.transitionJournal({...ids,journalEntryId:created.journal_entry_id,action:'SUBMIT',expectedRevision:0,idempotencyKey:'adjustment-submit-001'});
  const reviewer=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'adjustment-reviewer',['GL.JE.REVIEW','BANK.RECONCILIATION.REVIEW'])});
  await reviewer.transitionJournal({...ids,journalEntryId:created.journal_entry_id,action:'REVIEW',expectedRevision:1,idempotencyKey:'adjustment-je-review-001'});
  const approver=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'adjustment-approver',['GL.JE.APPROVE'])});
  await approver.transitionJournal({...ids,journalEntryId:created.journal_entry_id,action:'APPROVE',expectedRevision:2,idempotencyKey:'adjustment-approve-001'});
  const poster=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'adjustment-poster',['GL.JE.POST'])});
  await poster.postJournal({...ids,journalEntryId:created.journal_entry_id,expectedRevision:3,idempotencyKey:'adjustment-post-001'});
  const worksheetReader=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'adjustment-worksheet-reader',['BANK.VIEW'])});
  const postedWorksheet=(await worksheetReader.listReconciliationWorksheet({tenantId:ids.tenantId,entityId:ids.entityId,reconciliationId:started.reconciliation_id})).find(item=>item.bank_source_id===bankSourceId);
  assert.deepEqual({journal_entry_id:postedWorksheet.adjustment_journal_entry_id,journal_status:postedWorksheet.adjustment_journal_status,clearance_eligible:postedWorksheet.adjustment_clearance_eligible},{journal_entry_id:created.journal_entry_id,journal_status:'POSTED',clearance_eligible:true});
  assert.ok(Number.isSafeInteger(Number(postedWorksheet.adjustment_journal_version)));
  const cleared=await clearer.setReconciliationAdjustmentClearance(clearArgs),clearReplay=await clearer.setReconciliationAdjustmentClearance(clearArgs);
  assert.equal(Number(cleared.difference),0);assert.equal(cleared.revision,2);assert.equal(clearReplay.idempotent,true);
  await assert.rejects(maker.transitionReconciliation({...ids,reconciliationId:started.reconciliation_id,action:'REVIEW',expectedVersion:2,reason:'Maker must not review own adjustment reconciliation',idempotencyKey:'adjustment-maker-review-001'}),error=>error.code==='42501');
  const reviewed=await reviewer.transitionReconciliation({...ids,reconciliationId:started.reconciliation_id,action:'REVIEW',expectedVersion:2,reason:'Independent reviewer confirmed exact Posted adjustment evidence',idempotencyKey:'adjustment-review-001'});
  assert.equal(reviewed.status,'IN_REVIEW');
  const signer=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'adjustment-signer',['BANK.RECONCILIATION.SIGN_OFF'])});
  const signed=await signer.transitionReconciliation({...ids,reconciliationId:started.reconciliation_id,action:'SIGN_OFF',expectedVersion:3,reason:'Independent controller signs off adjusted statement evidence',idempotencyKey:'adjustment-signoff-001'});
  assert.equal(signed.status,'RECONCILED');assert.ok(signed.snapshot_id);
  assert.deepEqual((await adminPool.query('SELECT state,bank_match_id FROM reconciliation_item WHERE reconciliation_id=$1 AND bank_source_id=$2',[started.reconciliation_id,bankSourceId])).rows[0],{state:'CLEARED',bank_match_id:null});
  assert.equal((await adminPool.query("SELECT count(*)::int n FROM audit_event WHERE object_id=$1 AND event_type='RECONCILIATION_ADJUSTMENT_DRAFT_CREATED'",[created.journal_entry_id])).rows[0].n,1);
  assert.equal((await adminPool.query("SELECT count(*)::int n FROM audit_event WHERE object_id=$1 AND event_type='RECONCILIATION_ADJUSTMENT_ITEM_CLEARED'",[started.reconciliation_id])).rows[0].n,1);
});

pgTest('reconciliation adjustment Draft binds one item amount inside a multi-row statement difference',async()=>{
  const ids=await seed({status:'APPROVED'});const trace=await attachAutoSource(ids,{linkJournal:false});
  await adminPool.query("INSERT INTO member_master(tenant_id,entity_id,member_ref,member_type,display_name) VALUES($1,$2,'BANK-MULTI','BANK','Multi-row test bank')",[ids.tenantId,ids.entityId]);
  const firstBankSourceId=randomUUID(),secondBankSourceId=randomUUID();
  await adminPool.query(`INSERT INTO bank_source(bank_source_id,tenant_id,entity_id,source_document_id,bank_account_ref,external_bank_line_id,transaction_date,currency,amount)
    VALUES($1,$3,$4,$5,'BANK-MULTI','BANK-MULTI-1','2026-07-20','USD',50),
          ($2,$3,$4,$5,'BANK-MULTI','BANK-MULTI-2','2026-07-21','USD',30)`,[firstBankSourceId,secondBankSourceId,ids.tenantId,ids.entityId,trace.documentId]);
  const attachmentId=(await adminPool.query("SELECT attachment_id FROM source_link WHERE tenant_id=$1 AND entity_id=$2 AND journal_entry_id=$3 AND attachment_id IS NOT NULL",[ids.tenantId,ids.entityId,ids.journalId])).rows[0].attachment_id;
  const starter=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'multi-adjustment-starter',['BANK.RECONCILIATION.START'])});
  const started=await starter.startReconciliation({...ids,bankAccountRef:'BANK-MULTI',statementEndingDate:'2026-07-31',statementOpeningBalance:'0.0000',statementEndingBalance:'80.0000',reason:'Start statement with two unresolved bank rows',idempotencyKey:'multi-adjustment-start-001'});
  assert.equal(Number(started.difference),80);
  const maker=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'multi-adjustment-maker',['BANK.RECONCILIATION.ADJUSTMENT_DRAFT','GL.JE.CREATE'])});
  const base={...ids,reconciliationId:started.reconciliation_id,bankSourceId:firstBankSourceId,expectedReconciliationVersion:0,periodId:ids.periodId,journalNumber:'JE-RECON-MULTI-001',journalDate:'2026-07-20',currency:'USD',description:'Record one supported row within a multi-row statement',attachmentIds:[attachmentId],reason:'Bind only the selected unresolved bank row',idempotencyKey:'multi-adjustment-draft-001'};
  const lines=amount=>[
    {line_no:1,account_code:'111000',debit_amount:`${amount}.0000`,credit_amount:'0.0000',member_ref:'BANK-MULTI',description:'Selected statement row',dimensions:{}},
    {line_no:2,account_code:'291001',debit_amount:'0.0000',credit_amount:`${amount}.0000`,member_ref:'VENDOR-1',description:'Offsetting evidence',dimensions:{}}
  ];
  await assert.rejects(maker.createReconciliationAdjustmentDraft({...base,lines:lines(49),idempotencyKey:'multi-adjustment-wrong-amount'}),error=>error.code==='23514'&&/exactly one bank-account line/i.test(error.message));
  const created=await maker.createReconciliationAdjustmentDraft({...base,lines:lines(50)});
  assert.equal(created.journal_status,'DRAFT');assert.equal(created.reconciliation_revision,1);
  const state=(await adminPool.query('SELECT r.difference::text,d.bank_delta::text FROM reconciliation r JOIN reconciliation_adjustment_draft d ON d.tenant_id=r.tenant_id AND d.entity_id=r.entity_id AND d.reconciliation_id=r.reconciliation_id WHERE r.reconciliation_id=$1 AND d.bank_source_id=$2',[started.reconciliation_id,firstBankSourceId])).rows[0];
  assert.deepEqual(state,{difference:'80.0000',bank_delta:'50.0000'});
  assert.equal((await adminPool.query('SELECT count(*)::int n FROM reconciliation_adjustment_draft WHERE reconciliation_id=$1 AND bank_source_id=$2',[started.reconciliation_id,secondBankSourceId])).rows[0].n,0);
});

pgTest('reconciliation rejects mixed currencies and non-posted hand-made match evidence',async()=>{
  const ids=await seed({status:'APPROVED',journalType:'AUTO',attachmentStatus:null});const trace=await attachAutoSource(ids);
  const starter=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'recon-negative-starter',['BANK.RECONCILIATION.START'])});
  const clearer=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'recon-negative-clearer',['BANK.RECONCILIATION.CLEAR'])});
  const mixedUsd=randomUUID(),mixedEur=randomUUID();
  await adminPool.query(`INSERT INTO bank_source(bank_source_id,tenant_id,entity_id,source_document_id,bank_account_ref,external_bank_line_id,transaction_date,currency,amount)
    VALUES($1,$3,$4,$5,'BANK-MIX','BANK-MIX-USD','2026-07-15','USD',10),($2,$3,$4,$5,'BANK-MIX','BANK-MIX-EUR','2026-07-16','EUR',10)`,[mixedUsd,mixedEur,ids.tenantId,ids.entityId,trace.documentId]);
  await assert.rejects(starter.startReconciliation({...ids,bankAccountRef:'BANK-MIX',statementEndingDate:'2026-07-31',statementOpeningBalance:'0.0000',statementEndingBalance:'20.0000',reason:'Mixed currency statement must fail closed',idempotencyKey:'reconciliation-mixed-currency-001'}),error=>error.code==='23514'&&/one statement currency/i.test(error.message));

  const concurrentSource=randomUUID();
  await adminPool.query(`INSERT INTO bank_source(bank_source_id,tenant_id,entity_id,source_document_id,bank_account_ref,external_bank_line_id,transaction_date,currency,amount)
    VALUES($1,$2,$3,$4,'BANK-CONCURRENT','BANK-CONCURRENT-1','2026-07-15','USD',10)`,[concurrentSource,ids.tenantId,ids.entityId,trace.documentId]);
  const concurrent=await Promise.allSettled([
    starter.startReconciliation({...ids,bankAccountRef:'BANK-CONCURRENT',statementEndingDate:'2026-07-30',statementOpeningBalance:'0.0000',statementEndingBalance:'0.0000',reason:'Concurrent statement candidate one',idempotencyKey:'reconciliation-concurrent-start-001'}),
    starter.startReconciliation({...ids,bankAccountRef:'BANK-CONCURRENT',statementEndingDate:'2026-07-31',statementOpeningBalance:'0.0000',statementEndingBalance:'0.0000',reason:'Concurrent statement candidate two',idempotencyKey:'reconciliation-concurrent-start-002'}),
  ]);
  assert.equal(concurrent.filter(result=>result.status==='fulfilled').length,1);
  assert.equal(concurrent.filter(result=>result.status==='rejected'&&result.reason?.code==='23505').length,1);

  const bankSourceId=randomUUID(),bankMatchId=randomUUID();
  const journalLineId=(await adminPool.query('SELECT journal_line_id FROM journal_line WHERE journal_entry_id=$1 ORDER BY line_no LIMIT 1',[ids.journalId])).rows[0].journal_line_id;
  await adminPool.query(`INSERT INTO bank_source(bank_source_id,tenant_id,entity_id,source_document_id,bank_account_ref,external_bank_line_id,transaction_date,currency,amount)
    VALUES($1,$2,$3,$4,'BANK-FAKE','BANK-FAKE-1','2026-07-15','USD',100)`,[bankSourceId,ids.tenantId,ids.entityId,trace.documentId]);
  await adminPool.query(`INSERT INTO bank_match(bank_match_id,tenant_id,entity_id,bank_source_id,business_source_document_id,journal_entry_id,journal_line_id,candidate_rule_code,amount_delta,currency_match,date_delta_days,status,matched_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,'EXACT_POSTED_PAYMENT',0,true,0,'ACTIVE','fixture-matcher')`,[bankMatchId,ids.tenantId,ids.entityId,bankSourceId,trace.documentId,ids.journalId,journalLineId]);
  const started=await starter.startReconciliation({...ids,bankAccountRef:'BANK-FAKE',statementEndingDate:'2026-07-31',statementOpeningBalance:'0.0000',statementEndingBalance:'100.0000',reason:'Start fake evidence negative statement',idempotencyKey:'reconciliation-fake-start-001'});
  await assert.rejects(clearer.setReconciliationClearance({...ids,reconciliationId:started.reconciliation_id,bankSourceId,expectedReconciliationVersion:0,expectedBankVersion:0,clear:true,reason:'Hand-made active match must not clear',idempotencyKey:'reconciliation-fake-clear-001'}),error=>error.code==='23514'&&/exact actively matched/i.test(error.message));
});

pgTest('193 isolated WBS TEST_ONLY Bank Match independently approves exact config, accepts the period-scoped Stage1 Payable, posts one payment, links GL, and replays',async()=>{
  const ids=await seed({status:'DRAFT',attachmentStatus:null,extraMembers:[{memberRef:'WBS_TEST_BANK',memberType:'BANK',displayName:'Legacy WBS test Bank'}]});
  await adminPool.query("UPDATE entity SET source_system='REFS_STAGE1' WHERE tenant_id=$1 AND entity_id=$2",[ids.tenantId,ids.entityId]);
  const batchIds=[randomUUID(),randomUUID()],rawIds=[randomUUID(),randomUUID()],sourceIds=[randomUUID(),randomUUID()],billId=randomUUID(),bankSourceId=randomUUID();
  const decoyPeriodId=randomUUID(),decoyBatchId=randomUUID(),decoyRawId=randomUUID(),decoySourceId=randomUUID(),decoyBillId=randomUUID();
  await adminPool.query(`INSERT INTO import_batch(import_batch_id,tenant_id,entity_id,connector_code,source_module,source_entity_id,idempotency_key,request_hash,status,row_count,started_at,completed_at)
    VALUES($1,$3,$4,'WBS_TEST','payable',$5,'match-payable-fixture',$6,'SUCCEEDED',1,now(),now()),($2,$3,$4,'WBS_TEST','bankFeed',$5,'match-bank-fixture',$7,'SUCCEEDED',1,now(),now())`,[...batchIds,ids.tenantId,ids.entityId,ids.sourceEntityId,hash('match-payable-batch'),hash('match-bank-batch')]);
  await adminPool.query(`INSERT INTO raw_event(raw_event_id,tenant_id,entity_id,import_batch_id,source_system,source_module,source_entity_id,source_record_id,source_version,event_type,occurred_at,payload_hash,payload_ref,correlation_id)
    VALUES($1,$3,$4,$5,'REFS_STAGE1','payable',$6,'MATCH-PAYABLE','test:v1','UPSERT',now(),$7,$8,'MATCH-PAYABLE'),($2,$3,$4,$9,'REFS_STAGE1','bankFeed',$6,'MATCH-BANK','test:v1','UPSERT',now(),$10,$11,'MATCH-BANK')`,[...rawIds,ids.tenantId,ids.entityId,batchIds[0],ids.sourceEntityId,hash('match-payable-raw'),`object://test/${rawIds[0]}`,batchIds[1],hash('match-bank-raw'),`object://test/${rawIds[1]}`]);
  await adminPool.query(`INSERT INTO source_document(source_document_id,tenant_id,entity_id,raw_event_id,source_system,source_module,source_entity_id,source_record_id,source_version,document_type,document_no,business_date,accounting_date,currency,gross_amount,status,source_ref,payload_hash)
    VALUES($1,$3,$4,$5,'REFS_STAGE1','payable',$6,'MATCH-PAYABLE','test:v1','WBS_TEST_PAYABLE','WBS-TEST-MATCHPAYABLE','2026-07-01','2026-07-01','USD',1000,'POSTED','REFS_STAGE1:MATCH-PAYABLE',$7),($2,$3,$4,$8,'REFS_STAGE1','bankFeed',$6,'MATCH-BANK','test:v1','WBS_TEST_BANK_TRANSACTION','WBS-TEST-MATCH-BANK','2026-07-01','2026-07-01','USD',40,'POSTED','REFS_STAGE1:MATCH-BANK',$9)`,[...sourceIds,ids.tenantId,ids.entityId,rawIds[0],ids.sourceEntityId,hash('match-payable-source'),rawIds[1],hash('match-bank-source')]);
  await adminPool.query("INSERT INTO accounting_period(period_id,tenant_id,entity_id,period_code,starts_on,ends_on,status) VALUES($1,$2,$3,'2026-06','2026-06-01','2026-06-30','OPEN')",[decoyPeriodId,ids.tenantId,ids.entityId]);
  await adminPool.query(`INSERT INTO import_batch(import_batch_id,tenant_id,entity_id,connector_code,source_module,source_entity_id,idempotency_key,request_hash,status,row_count,started_at,completed_at)
    VALUES($1,$2,$3,'WBS_TEST','payable',$4,'match-payable-cross-period-decoy',$5,'SUCCEEDED',1,now(),now())`,[decoyBatchId,ids.tenantId,ids.entityId,ids.sourceEntityId,hash('match-payable-cross-period-decoy-batch')]);
  await adminPool.query(`INSERT INTO raw_event(raw_event_id,tenant_id,entity_id,import_batch_id,source_system,source_module,source_entity_id,source_record_id,source_version,event_type,occurred_at,payload_hash,payload_ref,correlation_id)
    VALUES($1,$2,$3,$4,'REFS_STAGE1','payable',$5,'MATCH-PAYABLE-CROSS-PERIOD-DECOY','test:v1','UPSERT',now(),$6,$7,'MATCH-PAYABLE-CROSS-PERIOD-DECOY')`,[decoyRawId,ids.tenantId,ids.entityId,decoyBatchId,ids.sourceEntityId,hash('match-payable-cross-period-decoy-raw'),`object://test/${decoyRawId}`]);
  await adminPool.query(`INSERT INTO source_document(source_document_id,tenant_id,entity_id,raw_event_id,source_system,source_module,source_entity_id,source_record_id,source_version,document_type,document_no,business_date,accounting_date,currency,gross_amount,status,source_ref,payload_hash)
    VALUES($1,$2,$3,$4,'REFS_STAGE1','payable',$5,'MATCH-PAYABLE-CROSS-PERIOD-DECOY','test:v1','WBS_TEST_PAYABLE','WBS-TEST-DECOY-OTHERPERIOD','2026-06-30','2026-06-30','USD',999999,'POSTED','REFS_STAGE1:MATCH-PAYABLE-CROSS-PERIOD-DECOY',$6)`,[decoySourceId,ids.tenantId,ids.entityId,decoyRawId,ids.sourceEntityId,hash('match-payable-cross-period-decoy-source')]);
  await adminPool.query(`INSERT INTO business_document(business_document_id,tenant_id,entity_id,source_document_id,document_kind,document_number,counterparty_ref,counterparty_name,currency,accounting_date,due_date,gross_amount,open_balance,status,created_by)
    VALUES($1,$2,$3,$4,'AP_BILL','WBS-TEST-DECOY-OTHERPERIOD','VENDOR-1','Cross-period WBS test vendor','USD','2026-06-30','2026-07-31',999999,999999,'OPEN','fixture')`,[decoyBillId,ids.tenantId,ids.entityId,decoySourceId]);
  await adminPool.query(`INSERT INTO business_document(business_document_id,tenant_id,entity_id,source_document_id,document_kind,document_number,counterparty_ref,counterparty_name,currency,accounting_date,due_date,gross_amount,open_balance,status,created_by)
    VALUES($1,$2,$3,$4,'AP_BILL','WBS-TEST-MATCHPAYABLE','VENDOR-1','WBS test vendor','USD','2026-07-01','2026-07-31',1000,1000,'OPEN','fixture')`,[billId,ids.tenantId,ids.entityId,sourceIds[0]]);
  await adminPool.query(`INSERT INTO bank_source(bank_source_id,tenant_id,entity_id,source_document_id,bank_account_ref,external_bank_line_id,transaction_date,currency,amount)
    VALUES($1,$2,$3,$4,'WBS_TEST_BANK','WBS-TEST-MATCH-LEGACY','2026-07-01','USD',-40)`,[bankSourceId,ids.tenantId,ids.entityId,sourceIds[1]]);
  const actors={importer:'wbs-match-importer',maker:'wbs-match-maker',submitter:'wbs-match-submitter',reviewer:'wbs-match-reviewer',approver:'wbs-match-approver',poster:'wbs-match-poster'};
  const permissions={importer:['WBS.TEST.IMPORT','BANK.VIEW','AP.VIEW','BANK.MATCH.CREATE'],maker:['WBS.TEST.IMPORT','AP.PAYMENT.CREATE'],submitter:['GL.JE.SUBMIT'],reviewer:['GL.JE.REVIEW','BANK.RECONCILIATION.REVIEW'],approver:['GL.JE.APPROVE'],poster:['GL.JE.POST']};
  const makerWithReview=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,actors.maker,[...permissions.maker,...permissions.reviewer])});
  const proposed=await makerWithReview.proposeWbsTestBankMatchConfig({tenantId:ids.tenantId,entityId:ids.entityId});
  await assert.rejects(makerWithReview.approveWbsTestBankMatchConfig({tenantId:ids.tenantId,entityId:ids.entityId,settingSnapshotId:proposed.setting_snapshot_id,mappingSnapshotId:proposed.mapping_snapshot_id}),error=>error.code==='23514'&&/approval evidence/i.test(error.message));
  const commandKey=`wbs-test-bank-match:${bankSourceId}`,partial=await makerWithReview.createApPayment({tenantId:ids.tenantId,entityId:ids.entityId,businessDocumentId:billId,periodId:ids.periodId,
    paymentNumber:`WBS-MATCH-${createHash('sha256').update(commandKey,'utf8').digest('hex').slice(0,32)}`,paymentDate:'2026-07-01',cashAccountCode:'111000',bankMemberRef:'WBS_TEST_BANK',amount:'40.0000',reason:'TEST_ONLY Prove one isolated WBS TEST_ONLY posted-payment Bank Match',idempotencyKey:`${commandKey}:payment`});
  assert.deepEqual((await adminPool.query('SELECT status,source_document_id FROM payment_occurrence WHERE payment_occurrence_id=$1',[partial.payment_occurrence_id])).rows,[{status:'DRAFT',source_document_id:null}]);
  const service=createControlledTestBankMatchService({scope:{tenantId:ids.tenantId,entityId:ids.entityId,bankAccountRef:'WBS_TEST_BANK',cashAccountCode:'111000',actors},authorize:async()=>{},kernelForActor:actorId=>{const role=Object.entries(actors).find(([,value])=>value===actorId)[0];return new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,actorId,permissions[role])});}});
  const input={tenantId:ids.tenantId,entityId:ids.entityId,reason:'Prove one isolated WBS TEST_ONLY posted-payment Bank Match',idempotencyKey:'wbs-test-bank-match-pg-001'};
  const first=await service.run(input),replay=await service.run(input);
  assert.equal(first.idempotent,false);assert.equal(replay.idempotent,true);assert.equal(replay.bank_match_id,first.bank_match_id);assert.equal(first.bank_source_id,bankSourceId);assert.equal(first.business_document_id,billId);
  const evidence=(await adminPool.query(`SELECT bm.status,j.status journal_status,j.revision journal_revision,po.status payment_status,po.version payment_version,jl.member_ref,jl.credit_amount::text,ll.ledger_line_id,sl.link_type,bd.open_balance::text
    FROM bank_match bm JOIN payment_occurrence po ON po.payment_occurrence_id=bm.payment_occurrence_id JOIN journal_entry j ON j.journal_entry_id=bm.journal_entry_id JOIN journal_line jl ON jl.journal_line_id=bm.journal_line_id JOIN ledger_line ll ON ll.ledger_line_id=bm.ledger_line_id JOIN source_link sl ON sl.bank_match_id=bm.bank_match_id AND sl.link_type='POSTED_PAYMENT_BANK_MATCH' JOIN business_document bd ON bd.business_document_id=po.business_document_id WHERE bm.bank_match_id=$1`,[first.bank_match_id])).rows;
  assert.deepEqual(evidence,[{status:'ACTIVE',journal_status:'POSTED',journal_revision:'4',payment_status:'POSTED',payment_version:'1',member_ref:'WBS_TEST_BANK',credit_amount:'40.0000',ledger_line_id:first.ledger_line_id,link_type:'POSTED_PAYMENT_BANK_MATCH',open_balance:'960.0000'}]);
  const sourceEvidence=(await adminPool.query(`SELECT
      (SELECT count(*)::int FROM staging_item WHERE tenant_id=$1 AND entity_id=$2 AND source_document_id=$3) staging_count,
      (SELECT count(*)::int FROM rule_evaluation WHERE tenant_id=$1 AND source_document_id=$3 AND rule_code='WBS_TEST_BANK_MATCH_PAYMENT') rule_count,
      (SELECT count(*)::int FROM source_link WHERE tenant_id=$1 AND entity_id=$2 AND link_type='SOURCE_TO_JE' AND source_document_id=$3 AND journal_entry_id=$4) source_link_count,
      (SELECT source_document_id FROM payment_occurrence WHERE tenant_id=$1 AND entity_id=$2 AND payment_occurrence_id=$5) payment_source_document_id,
      (SELECT count(*)::int FROM audit_event WHERE tenant_id=$1 AND entity_id=$2 AND event_type='CONTROLLED_TEST_BANK_PAYMENT_SOURCE_BOUND' AND object_id=$5) bind_audit_count`,
    [ids.tenantId,ids.entityId,sourceIds[0],first.journal_entry_id,first.payment_occurrence_id])).rows;
  assert.deepEqual(sourceEvidence,[{staging_count:1,rule_count:1,source_link_count:1,payment_source_document_id:sourceIds[0],bind_audit_count:1}]);
  assert.equal((await adminPool.query("SELECT count(*)::int n FROM reconciliation WHERE tenant_id=$1 AND entity_id=$2 AND bank_account_ref LIKE 'WBS_TEST_BANK_2026_%'",[ids.tenantId,ids.entityId])).rows[0].n,0);
  assert.equal((await adminPool.query('SELECT count(*)::int n FROM bank_match WHERE tenant_id=$1 AND entity_id=$2',[ids.tenantId,ids.entityId])).rows[0].n,1);
  const configEvidence=(await adminPool.query(`SELECT
      (SELECT count(*)::int FROM setting_snapshot WHERE tenant_id=$1 AND entity_id=$2 AND family='BANK' AND status='APPROVED' AND created_by=$3 AND approved_by=$4) setting_count,
      (SELECT count(*)::int FROM mapping_snapshot WHERE tenant_id=$1 AND entity_id=$2 AND family='BANK' AND status='APPROVED' AND created_by=$3 AND approved_by=$4) mapping_count,
      (SELECT count(*)::int FROM audit_event WHERE tenant_id=$1 AND entity_id=$2 AND event_type='CONTROLLED_TEST_BANK_MATCH_CONFIG_PROPOSED') proposal_audits,
      (SELECT count(*)::int FROM audit_event WHERE tenant_id=$1 AND entity_id=$2 AND event_type='CONTROLLED_TEST_BANK_MATCH_CONFIG_APPROVED') approval_audits`,[ids.tenantId,ids.entityId,actors.maker,actors.reviewer])).rows;
  assert.deepEqual(configEvidence,[{setting_count:1,mapping_count:1,proposal_audits:2,approval_audits:2}]);
});

pgTest('061 bank match creates exact posted AP evidence once and fails closed for reversal and ambiguous cash account evidence',async()=>{
  const ids=await seed({status:'APPROVED',attachmentStatus:null});const billId=randomUUID();
  await adminPool.query(`INSERT INTO business_document(business_document_id,tenant_id,entity_id,document_kind,document_number,counterparty_ref,counterparty_name,currency,accounting_date,due_date,gross_amount,open_balance,status,created_by)
    VALUES($1,$2,$3,'AP_BILL','BILL-BANK-MATCH-1','VENDOR-1','Vendor','USD','2026-07-15','2026-08-15',120,120,'APPROVED','fixture')`,[billId,ids.tenantId,ids.entityId]);
  const maker=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'bank-payment-maker',['AP.PAYMENT.CREATE','GL.JE.SUBMIT'])});
  const reviewer=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'bank-payment-reviewer',['GL.JE.REVIEW'])});
  const approver=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'bank-payment-approver',['GL.JE.APPROVE'])});
  const poster=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'bank-payment-poster',['GL.JE.POST'])});
  const postPayment=async({number,suffix,ambiguous=false})=>{
    const payment=await maker.createApPayment({...ids,businessDocumentId:billId,paymentNumber:number,paymentDate:'2026-07-16',cashAccountCode:'111000',bankMemberRef:'BANK-1',amount:40,reason:'Bank match AP payment',idempotencyKey:`bank-payment-${suffix}`});
    if(ambiguous){
      await adminPool.query('UPDATE journal_line SET debit_amount=80 WHERE journal_entry_id=$1 AND line_no=1',[payment.journal_entry_id]);
      await adminPool.query(`INSERT INTO journal_line(tenant_id,entity_id,period_id,journal_entry_id,line_no,account_code,debit_amount,credit_amount,member_ref,description,dimensions)
        VALUES($1,$2,$3,$4,3,'111000',0,40,'BANK-1','Ambiguous duplicate cash evidence','{}'::jsonb)`,[ids.tenantId,ids.entityId,ids.periodId,payment.journal_entry_id]);
    }
    const trace=await attachAutoSource({...ids,journalId:payment.journal_entry_id},{reuseApprovedSnapshots:suffix!=='exact'});
    await maker.transitionJournal({...ids,journalEntryId:payment.journal_entry_id,action:'SUBMIT',expectedRevision:0,idempotencyKey:`bank-payment-submit-${suffix}`});
    await reviewer.transitionJournal({...ids,journalEntryId:payment.journal_entry_id,action:'REVIEW',expectedRevision:1,idempotencyKey:`bank-payment-review-${suffix}`});
    await approver.transitionJournal({...ids,journalEntryId:payment.journal_entry_id,action:'APPROVE',expectedRevision:2,idempotencyKey:`bank-payment-approve-${suffix}`});
    await poster.postJournal({...ids,journalEntryId:payment.journal_entry_id,periodId:ids.periodId,expectedRevision:3,idempotencyKey:`bank-payment-post-${suffix}`});
    return {payment,trace};
  };
  const exact=await postPayment({number:'PAY-BANK-40',suffix:'exact'});const bankSourceId=randomUUID();
  await adminPool.query(`INSERT INTO bank_source(bank_source_id,tenant_id,entity_id,source_document_id,bank_account_ref,external_bank_line_id,transaction_date,currency,amount)
    VALUES($1,$2,$3,$4,'BANK-1','BANK-MATCH-EXACT','2026-07-16','USD',-40)`,[bankSourceId,ids.tenantId,ids.entityId,exact.trace.documentId]);
  const matcher=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'bank-payment-matcher',['BANK.MATCH.CREATE'])});
  const unmatcher=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'bank-payment-unmatcher',['BANK.MATCH.UNMATCH'])});
  const candidates=await matcher.listBankMatchCandidates({...ids,bankSourceId});
  assert.equal(candidates.length,1);
  assert.deepEqual(candidates[0],{
    payment_occurrence_id:exact.payment.payment_occurrence_id,
    occurrence_version:1,
    occurrence_kind:'AP_PAYMENT',
    business_source_document_id:billId,
    accounting_date:'2026-07-16',
    currency:'USD',
    amount:'40.0000',
    journal_entry_id:exact.payment.journal_entry_id,
    journal_line_id:candidates[0].journal_line_id,
    ledger_line_id:candidates[0].ledger_line_id,
    date_delta_days:0
  });
  assert.ok(candidates[0].journal_line_id);assert.ok(candidates[0].ledger_line_id);
  const shanghaiCandidates=await matcher.inSession(async client=>{
    await client.query("SET LOCAL TIME ZONE 'Asia/Shanghai'");
    return (await client.query('SELECT * FROM refs_list_bank_match_candidates($1,$2,$3)',[ids.tenantId,ids.entityId,bankSourceId])).rows;
  });
  assert.equal(shanghaiCandidates[0].accounting_date,'2026-07-16');
  assert.equal((await adminPool.query('SELECT count(*)::int n FROM bank_match WHERE bank_source_id=$1',[bankSourceId])).rows[0].n,0);
  const matchArgs={...ids,bankSourceId,paymentOccurrenceId:exact.payment.payment_occurrence_id,expectedBankVersion:0,expectedOccurrenceVersion:1,reason:'Reviewed exact posted AP payment',idempotencyKey:'bank-match-exact-001'};
  const created=await matcher.createBankPaymentMatch(matchArgs);const replay=await matcher.createBankPaymentMatch(matchArgs);
  assert.equal(created.status,'ACTIVE');assert.equal(created.idempotent,false);assert.equal(replay.idempotent,true);assert.equal(replay.bank_match_id,created.bank_match_id);
  const evidence=(await adminPool.query('SELECT payment_occurrence_id,journal_entry_id,journal_line_id,ledger_line_id FROM bank_match WHERE bank_match_id=$1',[created.bank_match_id])).rows[0];
  assert.equal(evidence.payment_occurrence_id,exact.payment.payment_occurrence_id);assert.equal(evidence.journal_entry_id,exact.payment.journal_entry_id);assert.ok(evidence.journal_line_id);assert.ok(evidence.ledger_line_id);
  const augustPeriod=randomUUID();await adminPool.query("INSERT INTO accounting_period(period_id,tenant_id,entity_id,period_code,starts_on,ends_on,status) VALUES($1,$2,$3,'2026-08','2026-08-01','2026-08-31','OPEN')",[augustPeriod,ids.tenantId,ids.entityId]);
  const reversalMaker=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'bank-payment-reversal',['AP.PAYMENT.REVERSE','GL.JE.SUBMIT'])});
  await assert.rejects(reversalMaker.createApPaymentReversal({...ids,sourceOccurrenceId:exact.payment.payment_occurrence_id,periodId:augustPeriod,journalNumber:'PAY-BANK-40-REV',journalDate:'2026-08-02',reason:'Attempt reversal while actively matched',idempotencyKey:'bank-match-reversal-001'}),error=>error.code==='23514'&&/explicitly unmatched/i.test(error.message));
  assert.equal((await adminPool.query('SELECT status FROM payment_occurrence WHERE payment_occurrence_id=$1',[exact.payment.payment_occurrence_id])).rows[0].status,'POSTED');
  const unmatchArgs={...ids,bankSourceId,bankMatchId:created.bank_match_id,expectedMatchVersion:0,reason:'Controller approved unmatch before payment reversal',idempotencyKey:'bank-unmatch-exact-001'};
  const unmatched=await unmatcher.unmatchBankPayment(unmatchArgs);const unmatchReplay=await unmatcher.unmatchBankPayment(unmatchArgs);
  assert.equal(unmatched.status,'UNMATCHED');assert.equal(unmatched.revision,1);assert.equal(unmatchReplay.idempotent,true);
  const reversal=await reversalMaker.createApPaymentReversal({...ids,sourceOccurrenceId:exact.payment.payment_occurrence_id,periodId:augustPeriod,journalNumber:'PAY-BANK-40-REV',journalDate:'2026-08-02',reason:'Reverse payment after controlled bank unmatch',idempotencyKey:'bank-match-reversal-002'});
  assert.equal(reversal.status,'DRAFT');

  const ambiguous=await postPayment({number:'PAY-BANK-AMBIG',suffix:'ambiguous',ambiguous:true});const ambiguousBankSourceId=randomUUID();
  await adminPool.query(`INSERT INTO bank_source(bank_source_id,tenant_id,entity_id,source_document_id,bank_account_ref,external_bank_line_id,transaction_date,currency,amount)
    VALUES($1,$2,$3,$4,'BANK-1','BANK-MATCH-AMBIGUOUS','2026-07-16','USD',-40)`,[ambiguousBankSourceId,ids.tenantId,ids.entityId,ambiguous.trace.documentId]);
  await assert.rejects(matcher.createBankPaymentMatch({...ids,bankSourceId:ambiguousBankSourceId,paymentOccurrenceId:ambiguous.payment.payment_occurrence_id,expectedBankVersion:0,expectedOccurrenceVersion:1,reason:'Reject ambiguous posted cash evidence',idempotencyKey:'bank-match-ambiguous-001'}),error=>error.code==='23514'&&/exactly one posted cash ledger line/i.test(error.message));
  assert.equal((await adminPool.query('SELECT count(*)::int n FROM bank_match WHERE bank_source_id=$1',[ambiguousBankSourceId])).rows[0].n,0);

  const invoiceId=randomUUID();
  await adminPool.query("INSERT INTO member_master(tenant_id,entity_id,member_ref,member_type,display_name) VALUES($1,$2,'CUSTOMER-1','CUSTOMER','Customer')",[ids.tenantId,ids.entityId]);
  await adminPool.query(`INSERT INTO business_document(business_document_id,tenant_id,entity_id,document_kind,document_number,counterparty_ref,counterparty_name,currency,accounting_date,due_date,gross_amount,open_balance,status,created_by)
    VALUES($1,$2,$3,'AR_INVOICE','INV-BANK-MATCH-1','CUSTOMER-1','Customer','USD','2026-07-15','2026-08-15',35,35,'OPEN','fixture')`,[invoiceId,ids.tenantId,ids.entityId]);
  const receiptMaker=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'bank-receipt-maker',['AR.RECEIPT.CREATE','GL.JE.SUBMIT'])});
  const receipt=await receiptMaker.createArReceipt({...ids,businessDocumentId:invoiceId,receiptNumber:'RCPT-BANK-35',receiptDate:'2026-07-17',cashAccountCode:'111000',bankMemberRef:'BANK-1',amount:35,reason:'Bank match AR receipt',idempotencyKey:'bank-receipt-exact-001'});
  await attachAutoSource({...ids,journalId:receipt.journal_entry_id},{reuseApprovedSnapshots:true});
  await receiptMaker.transitionJournal({...ids,journalEntryId:receipt.journal_entry_id,action:'SUBMIT',expectedRevision:0,idempotencyKey:'bank-receipt-submit-001'});
  await reviewer.transitionJournal({...ids,journalEntryId:receipt.journal_entry_id,action:'REVIEW',expectedRevision:1,idempotencyKey:'bank-receipt-review-001'});
  await approver.transitionJournal({...ids,journalEntryId:receipt.journal_entry_id,action:'APPROVE',expectedRevision:2,idempotencyKey:'bank-receipt-approve-001'});
  await poster.postJournal({...ids,journalEntryId:receipt.journal_entry_id,periodId:ids.periodId,expectedRevision:3,idempotencyKey:'bank-receipt-post-001'});
  const receiptBankSourceId=randomUUID();await adminPool.query(`INSERT INTO bank_source(bank_source_id,tenant_id,entity_id,source_document_id,bank_account_ref,external_bank_line_id,transaction_date,currency,amount)
    VALUES($1,$2,$3,$4,'BANK-1','BANK-MATCH-RECEIPT','2026-07-17','USD',35)`,[receiptBankSourceId,ids.tenantId,ids.entityId,exact.trace.documentId]);
  const receiptMatch=await matcher.createBankPaymentMatch({...ids,bankSourceId:receiptBankSourceId,paymentOccurrenceId:receipt.payment_occurrence_id,expectedBankVersion:0,expectedOccurrenceVersion:1,reason:'Reviewed exact posted AR receipt',idempotencyKey:'bank-match-receipt-001'});
  assert.equal(receiptMatch.status,'ACTIVE');
  assert.equal((await unmatcher.unmatchBankPayment({...ids,bankSourceId:receiptBankSourceId,bankMatchId:receiptMatch.bank_match_id,expectedMatchVersion:0,reason:'Controller approved receipt unmatch',idempotencyKey:'bank-unmatch-receipt-001'})).status,'UNMATCHED');
});

pgTest('Stage 2 test-data chain traces one reconciled bank payment through its posted JE, GL, TB and report rows',async()=>{
  const ids=await seed({status:'APPROVED',attachmentStatus:null});
  await adminPool.query("UPDATE tenant SET tenant_code='DEMO_STAGE2_BANK_2026',name='DEMO isolated Stage 2 Bank acceptance' WHERE tenant_id=$1",[ids.tenantId]);
  await adminPool.query(`INSERT INTO controlled_demo_tenant(tenant_id,scenario_code,display_label,created_by,expires_at)
    VALUES($1,'STAGE2_BANK_RECONCILIATION','DEMO isolated Bank to report acceptance','demo-admin',clock_timestamp()+interval '1 day')`,[ids.tenantId]);
  const amount='100.1234';
  const billId=randomUUID();
  await adminPool.query(`INSERT INTO business_document(business_document_id,tenant_id,entity_id,document_kind,document_number,counterparty_ref,counterparty_name,currency,accounting_date,due_date,gross_amount,open_balance,status,created_by)
    VALUES($1,$2,$3,'AP_BILL','BILL-STAGE2-CHAIN-1','VENDOR-1','Stage 2 test vendor','USD','2026-07-15','2026-08-15',$4,$4,'APPROVED','fixture')`,[billId,ids.tenantId,ids.entityId,amount]);
  const maker=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'stage2-maker',['AP.PAYMENT.CREATE','GL.JE.SUBMIT'])});
  const reviewer=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'stage2-je-reviewer',['GL.JE.REVIEW'])});
  const approver=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'stage2-je-approver',['GL.JE.APPROVE'])});
  const poster=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'stage2-je-poster',['GL.JE.POST'])});
  const payment=await maker.createApPayment({...ids,businessDocumentId:billId,paymentNumber:'PAY-STAGE2-100',paymentDate:'2026-07-16',cashAccountCode:'111000',bankMemberRef:'BANK-1',amount,reason:'Stage 2 exact bank payment',idempotencyKey:'stage2-payment-create-001'});
  const source=await attachAutoSource({...ids,journalId:payment.journal_entry_id});
  await maker.transitionJournal({...ids,journalEntryId:payment.journal_entry_id,action:'SUBMIT',expectedRevision:0,idempotencyKey:'stage2-payment-submit-001'});
  await reviewer.transitionJournal({...ids,journalEntryId:payment.journal_entry_id,action:'REVIEW',expectedRevision:1,idempotencyKey:'stage2-payment-review-001'});
  await approver.transitionJournal({...ids,journalEntryId:payment.journal_entry_id,action:'APPROVE',expectedRevision:2,idempotencyKey:'stage2-payment-approve-001'});
  await poster.postJournal({...ids,journalEntryId:payment.journal_entry_id,periodId:ids.periodId,expectedRevision:3,idempotencyKey:'stage2-payment-post-001'});

  const bankSourceId=randomUUID();
  await adminPool.query(`INSERT INTO bank_source(bank_source_id,tenant_id,entity_id,source_document_id,bank_account_ref,external_bank_line_id,transaction_date,currency,amount)
    VALUES($1,$2,$3,$4,'BANK-1','BANK-STAGE2-100','2026-07-16','USD',-$5::numeric)`,[bankSourceId,ids.tenantId,ids.entityId,source.documentId,amount]);
  const matcher=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'stage2-matcher',['BANK.MATCH.CREATE'])});
  const candidates=await matcher.listBankMatchCandidates({...ids,bankSourceId});
  assert.equal(candidates.length,1);assert.equal(candidates[0].payment_occurrence_id,payment.payment_occurrence_id);assert.equal(candidates[0].journal_entry_id,payment.journal_entry_id);
  const match=await matcher.createBankPaymentMatch({...ids,bankSourceId,paymentOccurrenceId:payment.payment_occurrence_id,expectedBankVersion:0,expectedOccurrenceVersion:1,reason:'Exact stage 2 payment evidence',idempotencyKey:'stage2-bank-match-001'});
  const evidence=(await adminPool.query('SELECT journal_entry_id,journal_line_id,ledger_line_id FROM bank_match WHERE bank_match_id=$1',[match.bank_match_id])).rows[0];
  assert.equal(evidence.journal_entry_id,payment.journal_entry_id);assert.ok(evidence.journal_line_id);assert.ok(evidence.ledger_line_id);
  const reader=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'stage2-report-reader',['BANK.VIEW','GL.JE.VIEW','GL.REPORT.VIEW'])});
  const demoStatus=await reader.readControlledDemoTenant({tenantId:ids.tenantId});
  assert.deepEqual({is_demo:demoStatus.is_demo,lifecycle_status:demoStatus.lifecycle_status,scenario_code:demoStatus.scenario_code},{is_demo:true,lifecycle_status:'ACTIVE_DEMO',scenario_code:'STAGE2_BANK_RECONCILIATION'});
  const otherTenant=await seed({status:'DRAFT',attachmentStatus:null,tenantId:randomUUID(),entityId:randomUUID(),periodId:randomUUID(),journalId:randomUUID()});
  await assert.rejects(reader.listBankTransactions({tenantId:otherTenant.tenantId,entityId:otherTenant.entityId,bankAccountRef:'BANK-1'}),error=>error.code==='42501');

  const starter=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'stage2-recon-starter',['BANK.RECONCILIATION.START'])});
  const clearer=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'stage2-recon-clearer',['BANK.RECONCILIATION.CLEAR'])});
  const reconReviewer=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'stage2-recon-reviewer',['BANK.RECONCILIATION.REVIEW'])});
  const signer=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'stage2-recon-signer',['BANK.RECONCILIATION.SIGN_OFF'])});
  const reconciliation=await starter.startReconciliation({...ids,bankAccountRef:'BANK-1',statementEndingDate:'2026-07-31',statementOpeningBalance:'0.0000',statementEndingBalance:'-100.1234',reason:'Stage 2 test statement',idempotencyKey:'stage2-reconciliation-start-001'});
  const cleared=await clearer.setReconciliationClearance({...ids,reconciliationId:reconciliation.reconciliation_id,bankSourceId,expectedReconciliationVersion:0,expectedBankVersion:0,clear:true,reason:'Clear exact posted stage 2 payment',idempotencyKey:'stage2-reconciliation-clear-001'});
  assert.equal(Number(cleared.difference),0);
  const worksheet=await reader.listReconciliationWorksheet({...ids,reconciliationId:reconciliation.reconciliation_id});
  assert.equal(worksheet.length,1);assert.equal(worksheet[0].bank_source_id,bankSourceId);assert.equal(worksheet[0].clearance_state,'CLEARED');assert.equal(worksheet[0].bank_match_id,match.bank_match_id);
  const reviewed=await reconReviewer.transitionReconciliation({...ids,reconciliationId:reconciliation.reconciliation_id,action:'REVIEW',expectedVersion:1,reason:'Review exact bank to JE evidence',idempotencyKey:'stage2-reconciliation-review-001'});
  const signed=await signer.transitionReconciliation({...ids,reconciliationId:reconciliation.reconciliation_id,action:'SIGN_OFF',expectedVersion:2,reason:'Sign off stage 2 test statement',idempotencyKey:'stage2-reconciliation-signoff-001'});
  assert.equal(reviewed.status,'IN_REVIEW');assert.equal(signed.status,'RECONCILED');assert.match(signed.snapshot_hash,/^sha256:[0-9a-f]{64}$/);
  const signedSnapshot=await reader.getSignedReconciliationSnapshot({tenantId:ids.tenantId,entityId:ids.entityId,reconciliationId:reconciliation.reconciliation_id});
  assert.equal(signedSnapshot.length,1);assert.equal(signedSnapshot[0].snapshot_hash,signed.snapshot_hash);
  assert.match(JSON.stringify(signedSnapshot[0].snapshot_body),new RegExp(bankSourceId));assert.match(JSON.stringify(signedSnapshot[0].snapshot_body),new RegExp(match.bank_match_id));assert.match(JSON.stringify(signedSnapshot[0].snapshot_body),/CLEARED/);

  const ledger=await reader.listGeneralLedger({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId,accountCode:'111000',query:null,limit:50,offset:0});
  const cashLedger=ledger.find(row=>row.journal_entry_id===payment.journal_entry_id);
  assert.ok(cashLedger);assert.equal(cashLedger.credit_amount,amount);assert.deepEqual(cashLedger.source_document_ids,[source.documentId]);
  const statements=await reader.getFinancialStatements({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId});
  for(const statementType of ['TRIAL_BALANCE','BALANCE_SHEET','CASH_FLOW']){
    const row=statements.find(candidate=>candidate.statement_type===statementType&&candidate.account_code==='111000');
    assert.ok(row,`${statementType} must include the reconciled cash ledger row`);
    assert.equal(row.display_balance,'-100.1234');
    assert.ok(row.journal_entry_ids.includes(payment.journal_entry_id));assert.ok(row.ledger_line_ids.includes(evidence.ledger_line_id));assert.ok(row.source_document_ids.includes(source.documentId));
  }
  const snapshot=(await adminPool.query('SELECT snapshot_body,snapshot_hash FROM reconciliation_snapshot WHERE reconciliation_id=$1',[reconciliation.reconciliation_id])).rows[0];
  assert.equal(snapshot.snapshot_hash,signed.snapshot_hash);assert.match(JSON.stringify(snapshot.snapshot_body),new RegExp(bankSourceId));assert.match(JSON.stringify(snapshot.snapshot_body),new RegExp(match.bank_match_id));
});

pgTest('financial statements read only POSTED ledger evidence with entity, period, and source drill scope',async()=>{
  const ids=await seed({status:'APPROVED',journalType:'AUTO',attachmentStatus:null,
    extraAccounts:[{accountCode:'610000',accountName:'Operating Expense'}],
    journalLines:[{lineNo:1,accountCode:'610000',debit:100,credit:0},{lineNo:2,accountCode:'111000',debit:0,credit:100,memberRef:'BANK-1'}]});
  const trace=await attachAutoSource(ids);
  const denied=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'report-denied',['AP.VIEW'])});
  await assert.rejects(denied.getFinancialStatements({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId}),error=>error.code==='42501');
  const poster=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'report-poster',['GL.JE.POST'])});
  await poster.postJournal({...ids,journalEntryId:ids.journalId,periodId:ids.periodId,expectedRevision:0,idempotencyKey:'report-post-001'});
  const reader=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'report-reader',['GL.REPORT.VIEW'])});
  const rows=await reader.getFinancialStatements({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId});
  assert.deepEqual([...new Set(rows.map(row=>row.statement_type))].sort(),['BALANCE_SHEET','CASH_FLOW','INCOME_STATEMENT','TRIAL_BALANCE']);
  const expense=rows.find(row=>row.statement_type==='INCOME_STATEMENT'&&row.account_code==='610000');
  assert.equal(expense.statement_section,'EXPENSES');assert.equal(expense.period_debit,'100.0000');assert.equal(expense.display_balance,'100.0000');
  assert.deepEqual(expense.journal_entry_ids,[ids.journalId]);assert.ok(expense.journal_line_ids.length===1);assert.ok(expense.ledger_line_ids.length===1);assert.deepEqual(expense.source_document_ids,[trace.documentId]);
  const cash=rows.find(row=>row.statement_type==='CASH_FLOW'&&row.account_code==='111000');
  assert.equal(cash.statement_section,'DIRECT_CASH_MOVEMENT');assert.equal(cash.display_balance,'-100.0000');
  assert.ok(rows.every(row=>row.period_id===ids.periodId&&row.period_code==='2026-07'&&row.classification_basis==='ACCOUNT_CODE_PREFIX_AND_BANK_MEMBER'));
  const other=await seed({status:'DRAFT',attachmentStatus:null,tenantId:ids.tenantId});
  await assert.rejects(reader.getFinancialStatements({tenantId:ids.tenantId,entityId:other.entityId,periodId:other.periodId}),error=>error.code==='42501');
  const api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId:ids.tenantId,actorId:'report-reader'}),kernelFactory:async()=>reader});
  const response=await api({method:'GET',url:`/api/v1/entities/${ids.entityId}/reports/financial-statements?periodId=${ids.periodId}`,body:null,headers:{}});
  assert.equal(response.status,200);assert.equal(response.headers['cache-control'],'no-store');assert.equal(response.body.data.length,rows.length);
});

pgTest('isolated financial-statement snapshots retain immutable versioned GL and source drill evidence',async()=>{
  const ids=await seed({status:'APPROVED',journalType:'AUTO',attachmentStatus:null,
    extraAccounts:[{accountCode:'610000',accountName:'Snapshot Expense'}],
    journalLines:[{lineNo:1,accountCode:'610000',debit:75,credit:0},{lineNo:2,accountCode:'111000',debit:0,credit:75,memberRef:'BANK-1'}]});
  const trace=await attachAutoSource(ids);
  const poster=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'snapshot-poster',['GL.JE.POST'])});
  await poster.postJournal({...ids,journalEntryId:ids.journalId,periodId:ids.periodId,expectedRevision:0,idempotencyKey:'statement-snapshot-post-001'});
  const liveReader=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'snapshot-reader',['GL.REPORT.VIEW'])});
  const live=(await liveReader.getFinancialStatements({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId})).find(row=>row.statement_type==='INCOME_STATEMENT'&&row.account_code==='610000');
  assert.ok(live);assert.deepEqual(live.source_document_ids,[trace.documentId]);
  const preparer=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'snapshot-maker',['GL.REPORT.VIEW','GL.REPORT.SNAPSHOT.PREPARE'])});
  const proposal=await preparer.prepareFinancialStatementSnapshot({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId,idempotencyKey:'statement-snapshot-prepare-001'});
  assert.equal(proposal.status,'PENDING_APPROVAL');assert.equal(proposal.prepared_by,'snapshot-maker');
  await assert.rejects(preparer.approveFinancialStatementSnapshot({tenantId:ids.tenantId,entityId:ids.entityId,proposalId:proposal.financial_statement_snapshot_proposal_id,idempotencyKey:'statement-snapshot-self-approve-001'}),error=>error.code==='42501');
  const approver=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'snapshot-approver',['GL.REPORT.SNAPSHOT.APPROVE'])});
  const first=await approver.approveFinancialStatementSnapshot({tenantId:ids.tenantId,entityId:ids.entityId,proposalId:proposal.financial_statement_snapshot_proposal_id,idempotencyKey:'statement-snapshot-approve-001'});
  assert.deepEqual({version:first.version,status:first.status,prepared:first.prepared_by,approved:first.approved_by},{version:'1',status:'APPROVED',prepared:'snapshot-maker',approved:'snapshot-approver'});
  const secondProposal=await preparer.prepareFinancialStatementSnapshot({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId,idempotencyKey:'statement-snapshot-prepare-002'});
  const latest=await approver.approveFinancialStatementSnapshot({tenantId:ids.tenantId,entityId:ids.entityId,proposalId:secondProposal.financial_statement_snapshot_proposal_id,idempotencyKey:'statement-snapshot-approve-002'});
  assert.equal(latest.version,'2');
  const snapshotRows=await liveReader.getFinancialStatementSnapshot({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId});
  assert.ok(snapshotRows.length>=1);assert.deepEqual({snapshot:snapshotRows[0].financial_statement_snapshot_id,version:snapshotRows[0].version,balance:snapshotRows.find(row=>row.statement_type==='INCOME_STATEMENT'&&row.account_code==='610000').display_balance,sources:snapshotRows.find(row=>row.statement_type==='INCOME_STATEMENT'&&row.account_code==='610000').source_document_ids},{snapshot:latest.financial_statement_snapshot_id,version:'2',balance:'75.0000',sources:[trace.documentId]});
  await assert.rejects(adminPool.query('UPDATE financial_statement_snapshot SET version=3 WHERE financial_statement_snapshot_id=$1',[latest.financial_statement_snapshot_id]),error=>error.code==='55000');
  await assert.rejects(adminPool.query('DELETE FROM financial_statement_snapshot_row WHERE financial_statement_snapshot_id=$1',[latest.financial_statement_snapshot_id]),error=>error.code==='55000');
  const other=await seed({status:'DRAFT',attachmentStatus:null,tenantId:ids.tenantId});
  await assert.rejects(liveReader.getFinancialStatementSnapshot({tenantId:ids.tenantId,entityId:other.entityId,periodId:other.periodId}),error=>error.code==='42501');
  const api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId:ids.tenantId,actorId:'snapshot-reader'}),kernelFactory:async()=>liveReader});
  const response=await api({method:'GET',url:`/api/v1/entities/${ids.entityId}/reports/financial-statement-snapshot?periodId=${ids.periodId}`,body:null,headers:{}});
  assert.equal(response.status,200);assert.equal(response.headers['cache-control'],'no-store');assert.equal(response.body.data[0].version,'2');
});

pgTest('chart of accounts and account register read only same-entity POSTED fixed-decimal ledger evidence',async()=>{
  const ids=await seed({status:'APPROVED',journalType:'AUTO',attachmentStatus:null,
    extraAccounts:[{accountCode:'610000',accountName:'Operating Expense'}],
    journalLines:[{lineNo:1,accountCode:'610000',debit:10.101,credit:0},{lineNo:2,accountCode:'111000',debit:0,credit:10.101,memberRef:'BANK-1'}]});
  const trace=await attachAutoSource(ids);
  const poster=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'coa-register-poster',['GL.JE.POST'])});
  await poster.postJournal({...ids,journalEntryId:ids.journalId,periodId:ids.periodId,expectedRevision:0,idempotencyKey:'coa-register-post-001'});
  const denied=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'coa-register-denied',['AP.VIEW'])});
  await assert.rejects(denied.listChartOfAccounts({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId}),error=>error.code==='42501');
  const reader=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'coa-register-reader',['GL.REPORT.VIEW','GL.JE.VIEW'])});
  const coa=await reader.listChartOfAccounts({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId});
  const expense=coa.find(row=>row.account_code==='610000'&&row.currency==='USD');
  assert.deepEqual({start:expense.period_start,end:expense.period_end},{start:'2026-07-01',end:'2026-07-31'});
  assert.deepEqual({opening:expense.opening_balance,debit:expense.period_debit,credit:expense.period_credit,ending:expense.ending_balance,lines:expense.posted_ledger_line_count},{opening:'0.0000',debit:'10.1010',credit:'0.0000',ending:'10.1010',lines:'1'});
  const register=await reader.listAccountRegister({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId,accountCode:'610000'});
  assert.deepEqual({start:register[0].period_start,end:register[0].period_end,journalDate:register[0].journal_date},{start:'2026-07-01',end:'2026-07-31',journalDate:'2026-07-15'});
  assert.equal(register.length,1);assert.deepEqual({debit:register[0].debit_amount,credit:register[0].credit_amount,opening:register[0].opening_balance,running:register[0].running_balance},{debit:'10.1010',credit:'0.0000',opening:'0.0000',running:'10.1010'});
  assert.deepEqual(register[0].source_document_ids,[trace.documentId]);
  const generalLedger=await reader.listGeneralLedger({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId,accountCode:'610000',query:null,limit:50,offset:0});
  assert.equal(generalLedger.length,1);
  assert.deepEqual({period:generalLedger[0].period_id,debit:generalLedger[0].debit_amount,credit:generalLedger[0].credit_amount,total:generalLedger[0].total_count},{period:ids.periodId,debit:'10.1010',credit:'0.0000',total:'1'});
  assert.deepEqual(generalLedger[0].source_document_ids,[trace.documentId]);
  const api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId:ids.tenantId,actorId:'coa-register-reader'}),kernelFactory:async()=>reader});
  const coaResponse=await api({method:'GET',url:`/api/v1/entities/${ids.entityId}/general-ledger/chart-of-accounts?periodId=${ids.periodId}`,body:null,headers:{}});
  const registerResponse=await api({method:'GET',url:`/api/v1/entities/${ids.entityId}/general-ledger/account-register?periodId=${ids.periodId}&accountCode=610000`,body:null,headers:{}});
  const generalLedgerResponse=await api({method:'GET',url:`/api/v1/entities/${ids.entityId}/general-ledger/entries?periodId=${ids.periodId}&accountCode=610000&limit=50&offset=0`,body:null,headers:{}});
  assert.equal(coaResponse.status,200);assert.equal(registerResponse.status,200);assert.equal(generalLedgerResponse.status,200);assert.equal(coaResponse.headers['cache-control'],'no-store');
  assert.deepEqual({start:coaResponse.body.data.find(row=>row.account_code==='610000'&&row.currency==='USD').period_start,end:coaResponse.body.data.find(row=>row.account_code==='610000'&&row.currency==='USD').period_end},{start:'2026-07-01',end:'2026-07-31'});
  assert.deepEqual({start:registerResponse.body.data[0].period_start,end:registerResponse.body.data[0].period_end,journalDate:registerResponse.body.data[0].journal_date,running:registerResponse.body.data[0].running_balance},{start:'2026-07-01',end:'2026-07-31',journalDate:'2026-07-15',running:'10.1010'});assert.equal(generalLedgerResponse.body.data[0].debit_amount,'10.1010');
});

pgTest('financial statement period comparison reads two ordered periods and marks a missing prior side rather than deriving zero',async()=>{
  const ids=await seed({status:'APPROVED',journalType:'AUTO',attachmentStatus:null,
    extraAccounts:[{accountCode:'610000',accountName:'Operating Expense'}],
    journalLines:[{lineNo:1,accountCode:'610000',debit:100,credit:0},{lineNo:2,accountCode:'111000',debit:0,credit:100,memberRef:'BANK-1'}]});
  await attachAutoSource(ids);
  const priorPeriodId=randomUUID();
  await adminPool.query("INSERT INTO accounting_period(period_id,tenant_id,entity_id,period_code,starts_on,ends_on,status) VALUES($1,$2,$3,'2026-06','2026-06-01','2026-06-30','OPEN')",[priorPeriodId,ids.tenantId,ids.entityId]);
  const poster=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'comparison-poster',['GL.JE.POST'])});
  await poster.postJournal({...ids,journalEntryId:ids.journalId,periodId:ids.periodId,expectedRevision:0,idempotencyKey:'comparison-post-001'});
  const reader=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'comparison-reader',['GL.REPORT.VIEW'])});
  const rows=await reader.getFinancialStatementPeriodComparison({tenantId:ids.tenantId,entityId:ids.entityId,currentPeriodId:ids.periodId,priorPeriodId});
  const current=rows.find(row=>row.statement_type==='INCOME_STATEMENT'&&row.account_code==='610000');
  assert.equal(current.comparison_status,'MISSING_PRIOR_EVIDENCE');assert.equal(current.current_display_balance,'100.0000');assert.equal(current.prior_display_balance,null);assert.equal(current.prior_ledger_line_ids,null);
  const comparisonHttpRows=JSON.parse(JSON.stringify(rows));
  const comparisonClientRead=await refreshAuthoritativeFinancialStatementPeriodComparison({config:{baseUrl:'https://accounting.test',entityId:ids.entityId,periodId:ids.periodId,getAccessToken:async()=>`test-token-${'a'.repeat(32)}`},priorPeriodId,fetcher:async()=>({ok:true,status:200,json:async()=>({ok:true,data:comparisonHttpRows})})});
  assert.equal(comparisonClientRead.ok,true,JSON.stringify({comparisonClientRead,comparisonHttpRows}));
  await assert.rejects(reader.getFinancialStatementPeriodComparison({tenantId:ids.tenantId,entityId:ids.entityId,currentPeriodId:ids.periodId,priorPeriodId:ids.periodId}),error=>error.code==='22023');
  await assert.rejects(reader.getFinancialStatementPeriodComparison({tenantId:ids.tenantId,entityId:ids.entityId,currentPeriodId:priorPeriodId,priorPeriodId:ids.periodId}),error=>error.code==='22023');
  const api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId:ids.tenantId,actorId:'comparison-reader'}),kernelFactory:async()=>reader});
  const response=await api({method:'GET',url:`/api/v1/entities/${ids.entityId}/reports/financial-statement-period-comparison?currentPeriodId=${ids.periodId}&priorPeriodId=${priorPeriodId}`,body:null,headers:{}});
  assert.equal(response.status,200);assert.equal(response.headers['cache-control'],'no-store');assert.equal(response.body.data.find(row=>row.account_code==='610000').comparison_status,'MISSING_PRIOR_EVIDENCE');
});

pgTest('dimension profitability reads only exact POSTED ledger dimensions and never fills a missing property, project, unit, or lot',async()=>{
  const ids=await seed({status:'APPROVED',journalType:'AUTO',attachmentStatus:null,
    extraAccounts:[{accountCode:'400000',accountName:'Rental Revenue'},{accountCode:'610000',accountName:'Property Expense'}],
    journalLines:[
      {lineNo:1,accountCode:'111000',debit:75,credit:0,memberRef:'BANK-1',dimensions:{property_ref:'PROPERTY-01',project_ref:'PROJECT-01',unit_ref:'UNIT-01',lot_ref:'LOT-01'}},
      {lineNo:2,accountCode:'400000',debit:0,credit:100,dimensions:{property_ref:'PROPERTY-01',project_ref:'PROJECT-01',unit_ref:'UNIT-01',lot_ref:'LOT-01'}},
      {lineNo:3,accountCode:'610000',debit:25,credit:0,dimensions:{property_ref:'PROPERTY-01',project_ref:'PROJECT-01',unit_ref:'UNIT-01',lot_ref:'LOT-01'}}
    ]});
  const trace=await attachAutoSource(ids);
  const poster=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'dimension-poster',['GL.JE.POST'])});
  await poster.postJournal({...ids,journalEntryId:ids.journalId,periodId:ids.periodId,expectedRevision:0,idempotencyKey:'dimension-post-001'});
  const reader=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'dimension-reader',['GL.REPORT.VIEW'])});
  const propertyRows=await reader.getDimensionProfitability({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId,dimensionType:'PROPERTY',dimensionRef:'PROPERTY-01'});
  assert.deepEqual(propertyRows.map(row=>[row.statement_type,row.statement_section,row.account_code,row.display_balance]),[['PROPERTY_PNL','EXPENSES','610000','25.0000'],['PROPERTY_PNL','REVENUE','400000','100.0000']]);
  assert.ok(propertyRows.every(row=>row.classification_basis==='POSTED_LEDGER_DIMENSION_EXACT'&&row.dimension_type==='PROPERTY'&&row.dimension_ref==='PROPERTY-01'));
  assert.ok(propertyRows.every(row=>row.journal_entry_ids.includes(ids.journalId)&&row.source_document_ids.includes(trace.documentId)));
  const projectRows=await reader.getDimensionProfitability({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId,dimensionType:'PROJECT',dimensionRef:'PROJECT-01'});
  assert.equal(projectRows.length,2);assert.ok(projectRows.every(row=>row.statement_type==='PROJECT_PNL'));
  const unitRows=await reader.getDimensionProfitability({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId,dimensionType:'UNIT',dimensionRef:'UNIT-01'});
  assert.equal(unitRows.length,2);assert.ok(unitRows.every(row=>row.statement_type==='UNIT_PROFITABILITY'));
  const lotRows=await reader.getDimensionProfitability({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId,dimensionType:'LOT',dimensionRef:'LOT-01'});
  assert.deepEqual(lotRows.map(row=>[row.statement_type,row.statement_section,row.account_code,row.display_balance]),[['LOT_PROFITABILITY','EXPENSES','610000','25.0000'],['LOT_PROFITABILITY','REVENUE','400000','100.0000']]);
  assert.ok(lotRows.every(row=>row.classification_basis==='POSTED_LEDGER_DIMENSION_EXACT'&&row.journal_entry_ids.includes(ids.journalId)&&row.source_document_ids.includes(trace.documentId)));
  assert.deepEqual(await reader.getDimensionProfitability({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId,dimensionType:'PROPERTY',dimensionRef:'PROPERTY-MISSING'}),[]);
  await assert.rejects(reader.getDimensionProfitability({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId,dimensionType:'ACCOUNT',dimensionRef:'PROPERTY-01'}),error=>error.code==='22023');
  const api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId:ids.tenantId,actorId:'dimension-reader'}),kernelFactory:async()=>reader});
  const response=await api({method:'GET',url:`/api/v1/entities/${ids.entityId}/reports/dimension-profitability?periodId=${ids.periodId}&dimensionType=PROPERTY&dimensionRef=PROPERTY-01`,body:null,headers:{}});
  assert.equal(response.status,200);assert.equal(response.headers['cache-control'],'no-store');assert.equal(response.body.data.length,2);
  const lotResponse=await api({method:'GET',url:`/api/v1/entities/${ids.entityId}/reports/dimension-profitability?periodId=${ids.periodId}&dimensionType=LOT&dimensionRef=LOT-01`,body:null,headers:{}});
  assert.equal(lotResponse.status,200);assert.equal(lotResponse.headers['cache-control'],'no-store');assert.deepEqual(lotResponse.body.data.map(row=>row.statement_type),['LOT_PROFITABILITY','LOT_PROFITABILITY']);
});

pgTest('cash flow statement classifies POSTED cash only through one exact approved mapping snapshot',async()=>{
  const ids=await seed({status:'APPROVED',journalType:'AUTO',attachmentStatus:'VERIFIED_CLEAN'});
  const trace=await attachAutoSource(ids);
  const poster=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'cash-flow-poster',['GL.JE.POST'])});
  await poster.postJournal({...ids,journalEntryId:ids.journalId,periodId:ids.periodId,expectedRevision:0,idempotencyKey:'cash-flow-post-001'});
  const reader=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'cash-flow-reader',['GL.REPORT.VIEW'])});
  const missing=await reader.getCashFlowClassification({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId});
  assert.equal(missing.length,1);assert.deepEqual({classification:missing[0].classification,status:missing[0].mapping_status,basis:missing[0].classification_basis,effect:missing[0].cash_effect,mapping:missing[0].mapping_snapshot_id},{classification:'BLOCKED',status:'BLOCKED_MAPPING_REQUIRED',basis:'CASH_FLOW_MAPPING_SNAPSHOT_REQUIRED',effect:'100.0000',mapping:null});
  const inputKeys={cash_account_code:'111000',counterpart_account_code:'291001'};
  const snapshotHash=(await adminPool.query("SELECT refs_jsonb_hash(jsonb_build_object('input_keys',$1::jsonb,'output_rules',jsonb_build_object('classification','OPERATING'))) AS snapshot_hash",[JSON.stringify(inputKeys)])).rows[0].snapshot_hash;
  const mappingId=randomUUID();
  await adminPool.query(`INSERT INTO mapping_snapshot(mapping_snapshot_id,tenant_id,entity_id,family,scope_type,scope_key,input_key_hash,version,priority,effective_from,status,input_keys,output_rules,snapshot_hash,created_by,approved_by,approved_at)
    VALUES($1,$2,$3,'CASH_FLOW_CLASSIFICATION','ENTITY',$7,$4,1,0,'2026-01-01','APPROVED',$5::jsonb,jsonb_build_object('classification','OPERATING'),$6,'cash-flow-maker','cash-flow-approver',now())`,[mappingId,ids.tenantId,ids.entityId,hash('cash-flow-mapping-key'),JSON.stringify(inputKeys),snapshotHash,ids.entityId]);
  const rows=await reader.getCashFlowClassification({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId});
  assert.equal(rows.length,1);assert.deepEqual({classification:rows[0].classification,status:rows[0].mapping_status,basis:rows[0].classification_basis,effect:rows[0].cash_effect,mapping:rows[0].mapping_snapshot_id,version:rows[0].mapping_version,hash:rows[0].mapping_snapshot_hash},{classification:'OPERATING',status:'CLASSIFIED',basis:'APPROVED_CASH_FLOW_MAPPING_SNAPSHOT_EXACT',effect:'100.0000',mapping:mappingId,version:'1',hash:snapshotHash});
  assert.deepEqual(rows[0].source_document_ids,[trace.documentId]);
  await assert.rejects(reader.getCashFlowClassification({tenantId:ids.tenantId,entityId:randomUUID(),periodId:ids.periodId}),error=>error.code==='42501');
  const api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId:ids.tenantId,actorId:'cash-flow-reader'}),kernelFactory:async()=>reader});
  const response=await api({method:'GET',url:`/api/v1/entities/${ids.entityId}/reports/cash-flow-classification?periodId=${ids.periodId}`,body:null,headers:{}});
  assert.equal(response.status,200);assert.equal(response.headers['cache-control'],'no-store');assert.equal(response.body.data[0].mapping_status,'CLASSIFIED');
});

pgTest('CWIP rollforward admits an account only through one exact immutable mapping snapshot and retains posted ledger evidence',async()=>{
  const ids=await seed({status:'APPROVED',journalType:'AUTO',attachmentStatus:'VERIFIED_CLEAN'});const trace=await attachAutoSource(ids);
  const poster=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'cwip-poster',['GL.JE.POST'])});await poster.postJournal({...ids,journalEntryId:ids.journalId,periodId:ids.periodId,expectedRevision:0,idempotencyKey:'cwip-post-001'});
  const reader=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'cwip-reader',['GL.REPORT.VIEW'])});assert.deepEqual(await reader.getCwipRollforward({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId}),[]);
  const inputKeys={account_code:'111000'};const snapshotHash=(await adminPool.query("SELECT refs_jsonb_hash(jsonb_build_object('input_keys',$1::jsonb,'output_rules',jsonb_build_object('classification','CWIP'))) AS snapshot_hash",[JSON.stringify(inputKeys)])).rows[0].snapshot_hash;const mappingId=randomUUID();
  await adminPool.query(`INSERT INTO mapping_snapshot(mapping_snapshot_id,tenant_id,entity_id,family,scope_type,scope_key,input_key_hash,version,priority,effective_from,status,input_keys,output_rules,snapshot_hash,created_by,approved_by,approved_at)
    VALUES($1,$2,$3,'CWIP_ACCOUNT_CLASSIFICATION','ENTITY',$7,$4,1,0,'2026-01-01','APPROVED',$5::jsonb,jsonb_build_object('classification','CWIP'),$6,'cwip-maker','cwip-approver',now())`,[mappingId,ids.tenantId,ids.entityId,hash('cwip-account-mapping-key'),JSON.stringify(inputKeys),snapshotHash,ids.entityId]);
  const rows=await reader.getCwipRollforward({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId});assert.equal(rows.length,1);assert.deepEqual({account:rows[0].account_code,status:rows[0].mapping_status,basis:rows[0].classification_basis,opening:rows[0].opening_balance,debit:rows[0].period_debit,credit:rows[0].period_credit,closing:rows[0].closing_balance,mapping:rows[0].mapping_snapshot_id,hash:rows[0].mapping_snapshot_hash},{account:'111000',status:'MAPPED_CWIP_ACCOUNT',basis:'APPROVED_CWIP_ACCOUNT_MAPPING_SNAPSHOT_EXACT',opening:'0.0000',debit:'100.0000',credit:'0.0000',closing:'100.0000',mapping:mappingId,hash:snapshotHash});assert.deepEqual(rows[0].source_document_ids,[trace.documentId]);
  const api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId:ids.tenantId,actorId:'cwip-reader'}),kernelFactory:async()=>reader});const response=await api({method:'GET',url:`/api/v1/entities/${ids.entityId}/reports/cwip-rollforward?periodId=${ids.periodId}`,body:null,headers:{}});assert.equal(response.status,200);assert.equal(response.headers['cache-control'],'no-store');assert.equal(response.body.data[0].mapping_status,'MAPPED_CWIP_ACCOUNT');
});

pgTest('construction-loan rollforward admits a credit-normal liability only through one exact immutable mapping snapshot and retains posted ledger evidence',async()=>{
  const ids=await seed({status:'APPROVED',journalType:'AUTO',attachmentStatus:'VERIFIED_CLEAN'});const trace=await attachAutoSource(ids);
  const poster=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'construction-loan-poster',['GL.JE.POST'])});await poster.postJournal({...ids,journalEntryId:ids.journalId,periodId:ids.periodId,expectedRevision:0,idempotencyKey:'construction-loan-post-001'});
  const reader=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'construction-loan-reader',['GL.REPORT.VIEW'])});assert.deepEqual(await reader.getConstructionLoanRollforward({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId}),[]);
  const inputKeys={account_code:'291001'};const snapshotHash=(await adminPool.query("SELECT refs_jsonb_hash(jsonb_build_object('input_keys',$1::jsonb,'output_rules',jsonb_build_object('classification','CONSTRUCTION_LOAN'))) AS snapshot_hash",[JSON.stringify(inputKeys)])).rows[0].snapshot_hash;const mappingId=randomUUID();
  await adminPool.query(`INSERT INTO mapping_snapshot(mapping_snapshot_id,tenant_id,entity_id,family,scope_type,scope_key,input_key_hash,version,priority,effective_from,status,input_keys,output_rules,snapshot_hash,created_by,approved_by,approved_at)
    VALUES($1,$2,$3,'CONSTRUCTION_LOAN_ACCOUNT_CLASSIFICATION','ENTITY',$7,$4,1,0,'2026-01-01','APPROVED',$5::jsonb,jsonb_build_object('classification','CONSTRUCTION_LOAN'),$6,'construction-loan-maker','construction-loan-approver',now())`,[mappingId,ids.tenantId,ids.entityId,hash('construction-loan-account-mapping-key'),JSON.stringify(inputKeys),snapshotHash,ids.entityId]);
  const rows=await reader.getConstructionLoanRollforward({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId});assert.equal(rows.length,1);assert.deepEqual({account:rows[0].account_code,status:rows[0].mapping_status,basis:rows[0].classification_basis,opening:rows[0].opening_balance,draws:rows[0].period_draws,repayments:rows[0].period_repayments,closing:rows[0].closing_balance,mapping:rows[0].mapping_snapshot_id,hash:rows[0].mapping_snapshot_hash},{account:'291001',status:'MAPPED_CONSTRUCTION_LOAN_ACCOUNT',basis:'APPROVED_CONSTRUCTION_LOAN_ACCOUNT_MAPPING_SNAPSHOT_EXACT',opening:'0.0000',draws:'100.0000',repayments:'0.0000',closing:'100.0000',mapping:mappingId,hash:snapshotHash});assert.deepEqual(rows[0].source_document_ids,[trace.documentId]);
  const api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId:ids.tenantId,actorId:'construction-loan-reader'}),kernelFactory:async()=>reader});const response=await api({method:'GET',url:`/api/v1/entities/${ids.entityId}/reports/construction-loan-rollforward?periodId=${ids.periodId}`,body:null,headers:{}});assert.equal(response.status,200);assert.equal(response.headers['cache-control'],'no-store');assert.equal(response.body.data[0].mapping_status,'MAPPED_CONSTRUCTION_LOAN_ACCOUNT');
});

pgTest('prepaid rollforward admits a debit-normal asset only through one exact immutable mapping snapshot and retains posted ledger evidence',async()=>{
  const ids=await seed({status:'APPROVED',journalType:'AUTO',attachmentStatus:'VERIFIED_CLEAN'});const trace=await attachAutoSource(ids);
  const poster=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'prepaid-poster',['GL.JE.POST'])});await poster.postJournal({...ids,journalEntryId:ids.journalId,periodId:ids.periodId,expectedRevision:0,idempotencyKey:'prepaid-post-001'});
  const reader=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'prepaid-reader',['GL.REPORT.VIEW'])});assert.deepEqual(await reader.getPrepaidRollforward({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId}),[]);
  const inputKeys={account_code:'111000'};const snapshotHash=(await adminPool.query("SELECT refs_jsonb_hash(jsonb_build_object('input_keys',$1::jsonb,'output_rules',jsonb_build_object('classification','PREPAID'))) AS snapshot_hash",[JSON.stringify(inputKeys)])).rows[0].snapshot_hash;const mappingId=randomUUID();
  await adminPool.query(`INSERT INTO mapping_snapshot(mapping_snapshot_id,tenant_id,entity_id,family,scope_type,scope_key,input_key_hash,version,priority,effective_from,status,input_keys,output_rules,snapshot_hash,created_by,approved_by,approved_at)
    VALUES($1,$2,$3,'PREPAID_ACCOUNT_CLASSIFICATION','ENTITY',$7,$4,1,0,'2026-01-01','APPROVED',$5::jsonb,jsonb_build_object('classification','PREPAID'),$6,'prepaid-maker','prepaid-approver',now())`,[mappingId,ids.tenantId,ids.entityId,hash('prepaid-account-mapping-key'),JSON.stringify(inputKeys),snapshotHash,ids.entityId]);
  const rows=await reader.getPrepaidRollforward({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId});assert.equal(rows.length,1);assert.deepEqual({account:rows[0].account_code,status:rows[0].mapping_status,basis:rows[0].classification_basis,opening:rows[0].opening_balance,additions:rows[0].period_additions,amortization:rows[0].period_amortization,closing:rows[0].closing_balance,mapping:rows[0].mapping_snapshot_id,hash:rows[0].mapping_snapshot_hash},{account:'111000',status:'MAPPED_PREPAID_ACCOUNT',basis:'APPROVED_PREPAID_ACCOUNT_MAPPING_SNAPSHOT_EXACT',opening:'0.0000',additions:'100.0000',amortization:'0.0000',closing:'100.0000',mapping:mappingId,hash:snapshotHash});assert.deepEqual(rows[0].source_document_ids,[trace.documentId]);
  const api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId:ids.tenantId,actorId:'prepaid-reader'}),kernelFactory:async()=>reader});const response=await api({method:'GET',url:`/api/v1/entities/${ids.entityId}/reports/prepaid-rollforward?periodId=${ids.periodId}`,body:null,headers:{}});assert.equal(response.status,200);assert.equal(response.headers['cache-control'],'no-store');assert.equal(response.body.data[0].mapping_status,'MAPPED_PREPAID_ACCOUNT');
});

pgTest('AI amortization proposal creates a source-bound twelve-month schedule with audit evidence but never creates a journal',async()=>{
  const ids=await seed({status:'DRAFT',attachmentStatus:null,extraAccounts:[{accountCode:'141500',accountName:'Prepaid insurance'},{accountCode:'610100',accountName:'Insurance expense'}]});
  const trace=await attachAutoSource(ids,{linkJournal:false});
  await adminPool.query("UPDATE source_document SET status='READY_FOR_DRAFT' WHERE tenant_id=$1 AND entity_id=$2 AND source_document_id=$3",[ids.tenantId,ids.entityId,trace.documentId]);
  await adminPool.query("INSERT INTO source_document_line(tenant_id,entity_id,source_document_id,source_line_id,line_no,amount,direction,project_ref,property_ref) VALUES($1,$2,$3,'insurance-line-1',1,100,'DEBIT','PROJECT-1','PROPERTY-1')",[ids.tenantId,ids.entityId,trace.documentId]);
  await retainPrepaidInvoiceClassification({ids,sourceDocumentId:trace.documentId,label:'proposal-only'});
  const proposer=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'ai-preparer',['AI.AMORTIZATION.PROPOSE'])});
  const args=[ids.tenantId,ids.entityId,trace.documentId,hash('auto-doc'),'2026-01-01','2026-12-31','141500','610100',JSON.stringify({project_ref:'PROJECT-1',property_ref:'PROPERTY-1',allocation_basis:'SOURCE_DIMENSIONED'}),'0.9500','Insurance policy coverage evidenced by source document'];
  await assert.rejects(proposer.inSession(async client=>{
    const requestHash=(await client.query('SELECT refs_propose_ai_amortization_schedule_hash($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11) AS request_hash',args)).rows[0].request_hash;
    return client.query('SELECT refs_propose_ai_amortization_schedule($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13) AS result',[...args,'ai-amortization-missing-evidence-001',requestHash]);
  }),error=>error.code==='23514');
  const coverage=await proposer.recordAiAmortizationCoverageEvidence({tenantId:ids.tenantId,entityId:ids.entityId,sourceDocumentId:trace.documentId,sourcePayloadHash:hash('auto-doc'),coverageStart:'2026-01-01',coverageEnd:'2026-12-31',evidenceRef:'source_attachment:insurance-policy.pdf#coverage',evidenceHash:hash('insurance-coverage-evidence'),extractionMethod:'HUMAN_VERIFIED_SOURCE_FIELD',idempotencyKey:'ai-amortization-coverage-001'});
  assert.equal(coverage.can_create_draft,false);
  const coverageReader=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'ai-coverage-reader',['AI.AMORTIZATION.VIEW'])});const retainedCoverage=await coverageReader.listAiAmortizationCoverageEvidence({tenantId:ids.tenantId,entityId:ids.entityId,limit:50}),isoDate=value=>value instanceof Date?`${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,'0')}-${String(value.getDate()).padStart(2,'0')}`:String(value).slice(0,10);assert.equal(retainedCoverage.length,1);assert.deepEqual({source:retainedCoverage[0].source_document_id,start:isoDate(retainedCoverage[0].coverage_start),end:isoDate(retainedCoverage[0].coverage_end),draft:retainedCoverage[0].can_create_draft,post:retainedCoverage[0].can_post},{source:trace.documentId,start:'2026-01-01',end:'2026-12-31',draft:false,post:false});
  const proposal=await proposer.inSession(async client=>{
    const requestHash=(await client.query('SELECT refs_propose_ai_amortization_schedule_hash($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11) AS request_hash',args)).rows[0].request_hash;
    return (await client.query('SELECT refs_propose_ai_amortization_schedule($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13) AS result',[...args,'ai-amortization-12-month-001',requestHash])).rows[0].result;
  });
  assert.deepEqual({status:proposal.status,lines:proposal.line_count,draft:proposal.can_create_draft,review:proposal.can_review,approve:proposal.can_approve,post:proposal.can_post},{status:'PROPOSED',lines:12,draft:false,review:false,approve:false,post:false});
  const rows=await adminPool.query("SELECT line_no,to_char(amortization_month,'YYYY-MM-DD') AS amortization_month,amount FROM ai_amortization_schedule_line WHERE tenant_id=$1 AND entity_id=$2 AND ai_amortization_schedule_id=$3 ORDER BY line_no",[ids.tenantId,ids.entityId,proposal.ai_amortization_schedule_id]);
  assert.equal(rows.rowCount,12);assert.equal(rows.rows[0].amortization_month,'2026-01-01');assert.equal(rows.rows[11].amortization_month,'2026-12-01');
  assert.equal((await adminPool.query('SELECT sum(amount)::text total FROM ai_amortization_schedule_line WHERE ai_amortization_schedule_id=$1',[proposal.ai_amortization_schedule_id])).rows[0].total,'100.0000');
  assert.equal((await adminPool.query("SELECT count(*)::int n FROM journal_entry WHERE tenant_id=$1",[ids.tenantId])).rows[0].n,1);
  assert.equal((await adminPool.query("SELECT count(*)::int n FROM audit_event WHERE tenant_id=$1 AND event_type='AI_AMORTIZATION_PROPOSED'",[ids.tenantId])).rows[0].n,1);
  const reader=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'ai-schedule-reader',['AI.AMORTIZATION.VIEW'])});
  const visible=await reader.listAiAmortizationSchedules({tenantId:ids.tenantId,entityId:ids.entityId,limit:50});
  assert.equal(visible.length,1);assert.equal(visible[0].ai_amortization_schedule_id,proposal.ai_amortization_schedule_id);assert.equal(visible[0].schedule_lines.length,12);assert.deepEqual({draft:visible[0].can_create_draft,review:visible[0].can_review,approve:visible[0].can_approve,post:visible[0].can_post},{draft:false,review:false,approve:false,post:false});
  const replay=await proposer.inSession(async client=>{
    const requestHash=(await client.query('SELECT refs_propose_ai_amortization_schedule_hash($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11) AS request_hash',args)).rows[0].request_hash;
    return (await client.query('SELECT refs_propose_ai_amortization_schedule($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13) AS result',[...args,'ai-amortization-12-month-001',requestHash])).rows[0].result;
  });
  assert.equal(replay.idempotent,true);
  await assert.rejects(proposer.inSession(async client=>{
    const changed=[...args];changed[10]='Different reason with the same idempotency key';const requestHash=(await client.query('SELECT refs_propose_ai_amortization_schedule_hash($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11) AS request_hash',changed)).rows[0].request_hash;
    return client.query('SELECT refs_propose_ai_amortization_schedule($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13) AS result',[...changed,'ai-amortization-12-month-001',requestHash]);
  }),error=>error.code==='23505');
  const denied=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'ai-reader',['GL.REPORT.VIEW'])});
  await assert.rejects(denied.inSession(client=>client.query('SELECT refs_propose_ai_amortization_schedule($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13)',[...args,'ai-amortization-denied-001',hash('not-reached')])),error=>error.code==='42501');
});

pgTest('AI amortization creates a human Draft then standard Posted JE with immutable source and ledger lineage',async()=>{
  const ids=await seed({status:'DRAFT',extraAccounts:[{accountCode:'141500',accountName:'Prepaid insurance'},{accountCode:'610100',accountName:'Insurance expense'}]});
  const attachmentId=(await adminPool.query("SELECT attachment_id FROM source_link WHERE tenant_id=$1 AND entity_id=$2 AND journal_entry_id=$3 AND attachment_id IS NOT NULL",[ids.tenantId,ids.entityId,ids.journalId])).rows[0].attachment_id;
  const trace=await attachAutoSource(ids,{linkJournal:false});
  await adminPool.query("UPDATE source_document SET status='READY_FOR_DRAFT' WHERE tenant_id=$1 AND entity_id=$2 AND source_document_id=$3",[ids.tenantId,ids.entityId,trace.documentId]);
  await adminPool.query("INSERT INTO source_document_line(tenant_id,entity_id,source_document_id,source_line_id,line_no,amount,direction,project_ref,property_ref) VALUES($1,$2,$3,'ai-amort-line-1',1,100,'DEBIT','PROJECT-1','PROPERTY-1')",[ids.tenantId,ids.entityId,trace.documentId]);
  await retainPrepaidInvoiceClassification({ids,sourceDocumentId:trace.documentId,label:'human-draft'});
  const proposer=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'ai-analysis-proposer',['AI.AMORTIZATION.PROPOSE'])});
  await proposer.recordAiAmortizationCoverageEvidence({tenantId:ids.tenantId,entityId:ids.entityId,sourceDocumentId:trace.documentId,sourcePayloadHash:hash('auto-doc'),coverageStart:'2026-01-01',coverageEnd:'2026-12-31',evidenceRef:'source_attachment:insurance-policy.pdf#coverage',evidenceHash:hash('insurance-coverage-evidence'),extractionMethod:'HUMAN_VERIFIED_SOURCE_FIELD',idempotencyKey:'ai-human-draft-coverage-0001'});
  const proposal=await proposer.proposeAiAmortizationSchedule({tenantId:ids.tenantId,entityId:ids.entityId,sourceDocumentId:trace.documentId,sourcePayloadHash:hash('auto-doc'),coverageStart:'2026-01-01',coverageEnd:'2026-12-31',prepaidAccountCode:'141500',expenseAccountCode:'610100',memberTrace:{project_ref:'PROJECT-1',property_ref:'PROPERTY-1',allocation_basis:'SOURCE_DIMENSIONED'},confidence:0.95,reason:'Retained insurance source supports a deterministic twelve-month amortization proposal.',idempotencyKey:'ai-human-draft-proposal-0001'});
  const scheduleReader=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'ai-schedule-attachment-reader',['AI.AMORTIZATION.VIEW'])});
  const beforeSourceLink=await scheduleReader.listAiAmortizationSchedules({tenantId:ids.tenantId,entityId:ids.entityId,limit:50});
  assert.deepEqual(beforeSourceLink[0].eligible_source_attachment_ids,[],'same-entity attachment not linked to this source document must stay ineligible');
  await adminPool.query("INSERT INTO source_link(tenant_id,entity_id,link_type,source_document_id,attachment_id,created_by) VALUES($1,$2,'SOURCE_ATTACHMENT',$3,$4,'source-retainer')",[ids.tenantId,ids.entityId,trace.documentId,attachmentId]);
  const afterSourceLink=await scheduleReader.listAiAmortizationSchedules({tenantId:ids.tenantId,entityId:ids.entityId,limit:50});
  assert.deepEqual(afterSourceLink[0].eligible_source_attachment_ids,[attachmentId],'reader must return only the exact source-bound clean attachment');
  const july=(await adminPool.query("SELECT ai_amortization_schedule_line_id,amount::text FROM ai_amortization_schedule_line WHERE tenant_id=$1 AND entity_id=$2 AND ai_amortization_schedule_id=$3 AND amortization_month='2026-07-01'",[ids.tenantId,ids.entityId,proposal.ai_amortization_schedule_id])).rows[0];
  const args={tenantId:ids.tenantId,entityId:ids.entityId,aiAmortizationScheduleId:proposal.ai_amortization_schedule_id,aiAmortizationScheduleLineId:july.ai_amortization_schedule_line_id,periodId:ids.periodId,expectedProposalHash:proposal.proposal_hash,attachmentIds:[attachmentId],reason:'Controller converts the retained July schedule line into a standard Draft for review.',idempotencyKey:'ai-human-draft-create-0001'};
  const sameActor=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'ai-analysis-proposer',['AI.AMORTIZATION.PROPOSE','AI.AMORTIZATION.DRAFT','GL.JE.CREATE'])});
  await assert.rejects(sameActor.createAiAmortizationDraft(args),error=>error.code==='42501');
  const maker=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'ai-draft-maker',['AI.AMORTIZATION.DRAFT','GL.JE.CREATE'])});
  const drafted=await maker.createAiAmortizationDraft(args),replay=await maker.createAiAmortizationDraft(args);assert.deepEqual({status:drafted.status,type:drafted.journal_type,amount:july.amount,replay:replay.idempotent},{status:'DRAFT',type:'MANUAL',amount:'8.3333',replay:true});
  const evidence=(await adminPool.query("SELECT source_document_id,journal_entry_id,line_amount::text FROM ai_amortization_draft_evidence WHERE tenant_id=$1 AND entity_id=$2 AND ai_amortization_draft_evidence_id=$3",[ids.tenantId,ids.entityId,drafted.ai_amortization_draft_evidence_id])).rows[0];assert.deepEqual({...evidence,source_document_id:String(evidence.source_document_id),journal_entry_id:String(evidence.journal_entry_id)},{source_document_id:trace.documentId,journal_entry_id:drafted.journal_entry_id,line_amount:'8.3333'});
  const submitter=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'ai-je-submitter',['GL.JE.SUBMIT'])}),reviewer=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'ai-je-reviewer',['GL.JE.REVIEW'])}),approver=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'ai-je-approver',['GL.JE.APPROVE'])}),poster=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'ai-je-poster',['GL.JE.POST'])});
  await submitter.transitionJournal({...ids,journalEntryId:drafted.journal_entry_id,action:'SUBMIT',expectedRevision:0,idempotencyKey:'ai-human-draft-submit'});await reviewer.transitionJournal({...ids,journalEntryId:drafted.journal_entry_id,action:'REVIEW',expectedRevision:1,idempotencyKey:'ai-human-draft-review'});await approver.transitionJournal({...ids,journalEntryId:drafted.journal_entry_id,action:'APPROVE',expectedRevision:2,idempotencyKey:'ai-human-draft-approve'});await poster.postJournal({...ids,journalEntryId:drafted.journal_entry_id,periodId:ids.periodId,expectedRevision:3,idempotencyKey:'ai-human-draft-post'});assert.equal((await adminPool.query('SELECT status FROM journal_entry WHERE tenant_id=$1 AND entity_id=$2 AND journal_entry_id=$3',[ids.tenantId,ids.entityId,drafted.journal_entry_id])).rows[0].status,'POSTED');
  assert.equal((await adminPool.query("SELECT count(*)::int n FROM ledger_line WHERE tenant_id=$1 AND entity_id=$2 AND journal_entry_id=$3",[ids.tenantId,ids.entityId,drafted.journal_entry_id])).rows[0].n,2);
  const reader=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'ai-lineage-reader',['GL.JE.VIEW','GL.REPORT.VIEW'])});const detail=await reader.getJournalEntryDetail({tenantId:ids.tenantId,entityId:ids.entityId,journalEntryId:drafted.journal_entry_id,periodId:ids.periodId});assert.equal(detail.lines.some(line=>line.source_document_ids.includes(trace.documentId)),true);const statements=await reader.getFinancialStatements({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId});assert.equal(statements.some(row=>row.statement_type==='TRIAL_BALANCE'&&(row.account_code==='141500'||row.account_code==='610100')&&row.journal_entry_ids.includes(drafted.journal_entry_id)&&row.source_document_ids.includes(trace.documentId)),true);
});

pgTest('prior-service invoice classification creates an immutable accrual proposal with zero journal effect',async()=>{
  const ids=await seed({status:'DRAFT',attachmentStatus:null,extraAccounts:[{accountCode:'610100',accountName:'Operating expense'}]});
  const trace=await attachAutoSource(ids,{linkJournal:false});
  await adminPool.query("UPDATE source_document SET status='READY_FOR_DRAFT' WHERE tenant_id=$1 AND entity_id=$2 AND source_document_id=$3",[ids.tenantId,ids.entityId,trace.documentId]);
  const lineId=(await adminPool.query("INSERT INTO source_document_line(tenant_id,entity_id,source_document_id,source_line_id,line_no,amount,direction,project_ref,property_ref) VALUES($1,$2,$3,'prior-service-invoice',1,100,'DEBIT','PROJECT-1','PROPERTY-1') RETURNING source_document_line_id",[ids.tenantId,ids.entityId,trace.documentId])).rows[0].source_document_line_id;
  const evidenceId=randomUUID(),classificationHash=hash('prior-service-accrual-classification');
  await adminPool.query(`INSERT INTO ai_invoice_accounting_classification_evidence( ai_invoice_accounting_classification_evidence_id,tenant_id,entity_id,accounting_period_id,source_document_id,source_document_line_id,source_payload_hash,source_line_hash,classifier_version,classification,reason,confidence,required_human_fields,rule_id,classification_hash,status,created_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,'AI_INVOICE_ACCOUNTING_CLASSIFICATION_V2','ACCRUAL_REVIEW','Service was received before the invoice date and requires Controller accrual review.',0.95,$9::jsonb,'AI_PRIOR_SERVICE_ACCRUAL_REVIEW_V1',$10,'REVIEW_REQUIRED','invoice-classifier')`,[evidenceId,ids.tenantId,ids.entityId,ids.periodId,trace.documentId,lineId,hash('auto-doc'),hash('prior-service-line'),JSON.stringify(['accrual_period','expense_account','liability_account','reversal_decision']),classificationHash]);
  const before=(await adminPool.query('SELECT (SELECT count(*)::int FROM journal_entry WHERE tenant_id=$1) journals,(SELECT count(*)::int FROM ledger_line WHERE tenant_id=$1) ledger',[ids.tenantId])).rows[0];
  const proposer=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'accrual-proposer',['AI.ACCRUAL.PROPOSE'])});
  const args={tenantId:ids.tenantId,entityId:ids.entityId,classificationEvidenceId:evidenceId,classificationHash,accountingPeriodId:ids.periodId,expenseAccountCode:'610100',liabilityAccountCode:'291001',memberTrace:{project_ref:'PROJECT-1',property_ref:'PROPERTY-1',allocation_basis:'SOURCE_DIMENSIONED'},reversalDecision:'NO_AUTOMATIC_REVERSAL',reversalDate:null,reason:'Controller must validate the prior-service accrual basis and account mapping.',idempotencyKey:'invoice-accrual-proposal-001'};
  const proposal=await proposer.proposeAiInvoiceAccrual(args),replay=await proposer.proposeAiInvoiceAccrual(args);
  assert.deepEqual({status:proposal.status,source:proposal.source_document_id,line:proposal.source_document_line_id,amount:proposal.amount,draft:proposal.can_create_draft,review:proposal.can_review,approve:proposal.can_approve,post:proposal.can_post,replay:replay.idempotent},{status:'PROPOSED',source:trace.documentId,line:lineId,amount:100,draft:false,review:false,approve:false,post:false,replay:true});
  await assert.rejects(proposer.proposeAiInvoiceAccrual({...args,reason:'A changed accounting conclusion must not reuse the original receipt.'}),error=>error.code==='23505');
  const reader=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'accrual-reader',['AI.ACCRUAL.VIEW'])}),rows=await reader.listAiInvoiceAccrualProposals({tenantId:ids.tenantId,entityId:ids.entityId,limit:50});
  assert.equal(rows.length,1);assert.equal(rows[0].classification_hash,classificationHash);
  assert.deepEqual((await adminPool.query('SELECT (SELECT count(*)::int FROM journal_entry WHERE tenant_id=$1) journals,(SELECT count(*)::int FROM ledger_line WHERE tenant_id=$1) ledger',[ids.tenantId])).rows[0],before);
  assert.equal((await adminPool.query("SELECT count(*)::int n FROM audit_event WHERE tenant_id=$1 AND entity_id=$2 AND event_type='AI_INVOICE_ACCRUAL_PROPOSED'",[ids.tenantId,ids.entityId])).rows[0].n,1);
  assert.equal((await adminPool.query("SELECT count(*)::int n FROM outbox_event WHERE tenant_id=$1 AND entity_id=$2 AND event_type='AI_INVOICE_ACCRUAL_PROPOSED'",[ids.tenantId,ids.entityId])).rows[0].n,1);
});

pgTest('ordinary retained invoice creates an immutable expense proposal with zero journal effect',async()=>{
  const ids=await seed({status:'DRAFT',attachmentStatus:null,extraAccounts:[{accountCode:'610100',accountName:'Operating expense'}]});
  const trace=await attachAutoSource(ids,{linkJournal:false});
  await adminPool.query("UPDATE source_document SET status='READY_FOR_DRAFT' WHERE tenant_id=$1 AND entity_id=$2 AND source_document_id=$3",[ids.tenantId,ids.entityId,trace.documentId]);
  const lineId=(await adminPool.query("INSERT INTO source_document_line(tenant_id,entity_id,source_document_id,source_line_id,line_no,amount,direction,project_ref,property_ref) VALUES($1,$2,$3,'ordinary-expense-invoice',1,275.50,'DEBIT','PROJECT-1','PROPERTY-1') RETURNING source_document_line_id",[ids.tenantId,ids.entityId,trace.documentId])).rows[0].source_document_line_id;
  const policyId=randomUUID(),policySnapshot={input_keys:{currency:'USD'},output_rules:{capitalization_threshold:'5000.0000'}},policyHash=(await adminPool.query('SELECT refs_jsonb_hash($1::jsonb) snapshot_hash',[JSON.stringify(policySnapshot)])).rows[0].snapshot_hash,evidenceId=randomUUID(),classificationHash=hash('ordinary-expense-classification');
  await adminPool.query("INSERT INTO setting_snapshot(setting_snapshot_id,tenant_id,entity_id,family,scope_type,scope_key,version,effective_from,status,snapshot,snapshot_hash,created_by,approved_by,approved_at) VALUES($1,$2,$3,'AI_CAPITALIZATION_POLICY','ENTITY',$3::uuid::text,1,'2026-01-01','APPROVED',$4::jsonb,$5,'policy-maker','policy-approver',now())",[policyId,ids.tenantId,ids.entityId,JSON.stringify(policySnapshot),policyHash]);
  await adminPool.query(`INSERT INTO ai_invoice_accounting_classification_evidence(ai_invoice_accounting_classification_evidence_id,tenant_id,entity_id,accounting_period_id,source_document_id,source_document_line_id,source_payload_hash,source_line_hash,classifier_version,classification,reason,confidence,required_human_fields,rule_id,policy_snapshot_id,policy_snapshot_hash,policy_evidence,classification_hash,status,created_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,'AI_INVOICE_ACCOUNTING_CLASSIFICATION_V2','EXPENSE','No retained multi-period coverage or capitalization basis was found under the approved policy.',0.90,$9::jsonb,'AI_ORDINARY_EXPENSE_V1',$10,$11,'{}'::jsonb,$12,'CLASSIFIED','invoice-classifier')`,[evidenceId,ids.tenantId,ids.entityId,ids.periodId,trace.documentId,lineId,hash('auto-doc'),hash('ordinary-expense-line'),JSON.stringify(['expense_account','cost_center_or_member']),policyId,policyHash,classificationHash]);
  const before=(await adminPool.query('SELECT (SELECT count(*)::int FROM journal_entry WHERE tenant_id=$1) journals,(SELECT count(*)::int FROM staging_item WHERE tenant_id=$1) staging,(SELECT count(*)::int FROM ledger_line WHERE tenant_id=$1) ledger',[ids.tenantId])).rows[0];
  const proposer=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'expense-proposer',['AI.EXPENSE.PROPOSE'])}),args={tenantId:ids.tenantId,entityId:ids.entityId,classificationEvidenceId:evidenceId,classificationHash,accountingPeriodId:ids.periodId,expenseAccountCode:'610100',liabilityAccountCode:'291001',memberTrace:{project_ref:'PROJECT-1',property_ref:'PROPERTY-1',allocation_basis:'SOURCE_DIMENSIONED'},reason:'Controller confirmed the retained invoice is an ordinary operating expense under the approved policy.',idempotencyKey:'invoice-expense-proposal-001'};
  const proposal=await proposer.proposeAiInvoiceExpense(args),replay=await proposer.proposeAiInvoiceExpense(args);
  assert.deepEqual({status:proposal.status,amount:proposal.amount,rule:proposal.rule_id,policy:proposal.policy_snapshot_hash,draft:proposal.can_create_draft,review:proposal.can_review,approve:proposal.can_approve,post:proposal.can_post,replay:replay.idempotent},{status:'PROPOSED',amount:275.5,rule:'AI_ORDINARY_EXPENSE_V1',policy:policyHash,draft:false,review:false,approve:false,post:false,replay:true});
  await assert.rejects(proposer.proposeAiInvoiceExpense({...args,expenseAccountCode:'150100'}),error=>error.code==='23505');
  const reader=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'expense-reader',['AI.EXPENSE.VIEW'])}),rows=await reader.listAiInvoiceExpenseProposals({tenantId:ids.tenantId,entityId:ids.entityId,limit:50});
  assert.equal(rows.length,1);assert.equal(rows[0].classification_hash,classificationHash);assert.equal(rows[0].policy_snapshot_hash,policyHash);
  assert.deepEqual((await adminPool.query('SELECT (SELECT count(*)::int FROM journal_entry WHERE tenant_id=$1) journals,(SELECT count(*)::int FROM staging_item WHERE tenant_id=$1) staging,(SELECT count(*)::int FROM ledger_line WHERE tenant_id=$1) ledger',[ids.tenantId])).rows[0],before);
  assert.equal((await adminPool.query("SELECT count(*)::int n FROM audit_event WHERE tenant_id=$1 AND entity_id=$2 AND event_type='AI_INVOICE_EXPENSE_PROPOSED'",[ids.tenantId,ids.entityId])).rows[0].n,1);assert.equal((await adminPool.query("SELECT count(*)::int n FROM outbox_event WHERE tenant_id=$1 AND entity_id=$2 AND event_type='AI_INVOICE_EXPENSE_PROPOSED'",[ids.tenantId,ids.entityId])).rows[0].n,1);
});

pgTest('policy-backed construction invoice creates an immutable CWIP proposal with zero journal effect',async()=>{
  const ids=await seed({status:'DRAFT',attachmentStatus:null,extraAccounts:[{accountCode:'150100',accountName:'Construction in progress'}]});
  const trace=await attachAutoSource(ids,{linkJournal:false});
  await adminPool.query("UPDATE source_document SET status='READY_FOR_DRAFT' WHERE tenant_id=$1 AND entity_id=$2 AND source_document_id=$3",[ids.tenantId,ids.entityId,trace.documentId]);
  const lineId=(await adminPool.query("INSERT INTO source_document_line(tenant_id,entity_id,source_document_id,source_line_id,line_no,amount,direction,project_ref,property_ref) VALUES($1,$2,$3,'capital-invoice',1,25000,'DEBIT','PROJECT-1','PROPERTY-1') RETURNING source_document_line_id",[ids.tenantId,ids.entityId,trace.documentId])).rows[0].source_document_line_id;
  const policyId=randomUUID(),policySnapshot={input_keys:{currency:'USD'},output_rules:{capitalization_threshold:'5000.0000'}},policyHash=(await adminPool.query('SELECT refs_jsonb_hash($1::jsonb) snapshot_hash',[JSON.stringify(policySnapshot)])).rows[0].snapshot_hash,evidenceId=randomUUID(),classificationHash=hash('capital-classification');
  await adminPool.query("INSERT INTO setting_snapshot(setting_snapshot_id,tenant_id,entity_id,family,scope_type,scope_key,version,effective_from,status,snapshot,snapshot_hash,created_by,approved_by,approved_at) VALUES($1,$2,$3,'AI_CAPITALIZATION_POLICY','ENTITY',$3::uuid::text,1,'2026-01-01','APPROVED',$4::jsonb,$5,'policy-maker','policy-approver',now())",[policyId,ids.tenantId,ids.entityId,JSON.stringify(policySnapshot),policyHash]);
  await adminPool.query(`INSERT INTO ai_invoice_accounting_classification_evidence(ai_invoice_accounting_classification_evidence_id,tenant_id,entity_id,accounting_period_id,source_document_id,source_document_line_id,source_payload_hash,source_line_hash,classifier_version,classification,reason,confidence,required_human_fields,rule_id,policy_snapshot_id,policy_snapshot_hash,policy_evidence,classification_hash,status,created_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,'AI_INVOICE_ACCOUNTING_CLASSIFICATION_V2','CAPITALIZATION_REVIEW','Approved policy identifies a threshold-qualified construction cost.',0.99,$9::jsonb,'AI_CAPITALIZATION_POLICY_V1',$10,$11,'{}'::jsonb,$12,'REVIEW_REQUIRED','invoice-classifier')`,[evidenceId,ids.tenantId,ids.entityId,ids.periodId,trace.documentId,lineId,hash('auto-doc'),hash('capital-line'),JSON.stringify(['capital_account','placed_in_service_date','controller_approval']),policyId,policyHash,classificationHash]);
  const before=(await adminPool.query('SELECT (SELECT count(*)::int FROM journal_entry WHERE tenant_id=$1) journals,(SELECT count(*)::int FROM staging_item WHERE tenant_id=$1) staging,(SELECT count(*)::int FROM ledger_line WHERE tenant_id=$1) ledger',[ids.tenantId])).rows[0];
  const proposer=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'capital-proposer',['AI.CAPITALIZATION.PROPOSE'])}),args={tenantId:ids.tenantId,entityId:ids.entityId,classificationEvidenceId:evidenceId,classificationHash,accountingPeriodId:ids.periodId,capitalizationTreatment:'CWIP',assetAccountCode:'150100',liabilityAccountCode:'291001',assetClass:'CONSTRUCTION_IN_PROGRESS',memberTrace:{project_ref:'PROJECT-1',property_ref:'PROPERTY-1',allocation_basis:'SOURCE_DIMENSIONED'},placedInServiceDate:null,usefulLifeMonths:null,reason:'Controller confirmed the construction cost is eligible for CWIP under approved policy.',idempotencyKey:'invoice-capital-proposal-001'};
  const proposal=await proposer.proposeAiInvoiceCapitalization(args),replay=await proposer.proposeAiInvoiceCapitalization(args);assert.deepEqual({status:proposal.status,treatment:proposal.capitalization_treatment,amount:proposal.amount,draft:proposal.can_create_draft,review:proposal.can_review,approve:proposal.can_approve,post:proposal.can_post,replay:replay.idempotent},{status:'PROPOSED',treatment:'CWIP',amount:25000,draft:false,review:false,approve:false,post:false,replay:true});
  await assert.rejects(proposer.proposeAiInvoiceCapitalization({...args,assetClass:'BUILDING',idempotencyKey:args.idempotencyKey}),error=>error.code==='23505');
  const reader=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'capital-reader',['AI.CAPITALIZATION.VIEW'])}),rows=await reader.listAiInvoiceCapitalizationProposals({tenantId:ids.tenantId,entityId:ids.entityId,limit:50});assert.equal(rows.length,1);assert.equal(rows[0].policy_snapshot_hash,policyHash);
  assert.deepEqual((await adminPool.query('SELECT (SELECT count(*)::int FROM journal_entry WHERE tenant_id=$1) journals,(SELECT count(*)::int FROM staging_item WHERE tenant_id=$1) staging,(SELECT count(*)::int FROM ledger_line WHERE tenant_id=$1) ledger',[ids.tenantId])).rows[0],before);
  assert.equal((await adminPool.query("SELECT count(*)::int n FROM audit_event WHERE tenant_id=$1 AND entity_id=$2 AND event_type='AI_INVOICE_CAPITALIZATION_PROPOSED'",[ids.tenantId,ids.entityId])).rows[0].n,1);assert.equal((await adminPool.query("SELECT count(*)::int n FROM outbox_event WHERE tenant_id=$1 AND entity_id=$2 AND event_type='AI_INVOICE_CAPITALIZATION_PROPOSED'",[ids.tenantId,ids.entityId])).rows[0].n,1);
});

pgTest('construction loan source creates immutable transaction classification evidence',async()=>{
  const ids=await seed({status:'DRAFT',attachmentStatus:null,extraAccounts:[{accountCode:'230000',accountName:'Construction loan payable'}]});
  const trace=await attachAutoSource(ids,{linkJournal:false,sourceModule:'loan',sourceRecordPrefix:'CONSTRUCTION-LOAN-DRAW'});
  await adminPool.query("UPDATE source_document SET status='READY_FOR_DRAFT' WHERE tenant_id=$1 AND entity_id=$2 AND source_document_id=$3",[ids.tenantId,ids.entityId,trace.documentId]);
  const lineId=(await adminPool.query(`INSERT INTO source_document_line(tenant_id,entity_id,source_document_id,source_line_id,line_no,amount,direction,description,loan_ref,bank_account_ref,project_ref,property_ref)
    VALUES($1,$2,$3,'construction-loan-draw-1',1,250000,'INFLOW','Construction draw advance','LOAN-REF-001','BANK-1','PROJECT-1','PROPERTY-1') RETURNING source_document_line_id`,[ids.tenantId,ids.entityId,trace.documentId])).rows[0].source_document_line_id;
  const counts=()=>adminPool.query(`SELECT
    (SELECT count(*)::int FROM ai_construction_loan_classification_evidence WHERE tenant_id=$1) evidence,
    (SELECT count(*)::int FROM audit_event WHERE tenant_id=$1 AND event_type='AI_CONSTRUCTION_LOAN_CLASSIFIED') audits,
    (SELECT count(*)::int FROM outbox_event WHERE tenant_id=$1 AND event_type='AI_CONSTRUCTION_LOAN_CLASSIFIED') outbox,
    (SELECT count(*)::int FROM journal_entry WHERE tenant_id=$1) journals,
    (SELECT count(*)::int FROM staging_item WHERE tenant_id=$1) staging,
    (SELECT count(*)::int FROM ledger_line WHERE tenant_id=$1) ledger`,[ids.tenantId]).then(result=>result.rows[0]);
  const before=await counts(),classifier=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'loan-classifier',['AI.LOAN.CLASSIFY'])}),args={tenantId:ids.tenantId,entityId:ids.entityId,sourceDocumentLineId:lineId,expectedClassification:'LOAN_DRAW',idempotencyKey:'construction-loan-classification-001'};
  const created=await classifier.classifyAiConstructionLoanLine(args),replay=await classifier.classifyAiConstructionLoanLine(args);
  assert.deepEqual({classification:created.classification,status:created.status,draft:created.can_create_draft,review:created.can_review,approve:created.can_approve,post:created.can_post,idempotent:created.idempotent,replay:replay.idempotent},{classification:'LOAN_DRAW',status:'REVIEW_REQUIRED',draft:false,review:false,approve:false,post:false,idempotent:false,replay:true});
  assert.deepEqual(created.entry_shape,[{side:'DEBIT',account_role:'CASH'},{side:'CREDIT',account_role:'CONSTRUCTION_LOAN_PAYABLE'}]);
  await assert.rejects(classifier.classifyAiConstructionLoanLine({...args,expectedClassification:'INTEREST_REVIEW'}),error=>error.code==='23514');
  const conflictingActor=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'other-loan-classifier',['AI.LOAN.CLASSIFY'])});
  await assert.rejects(conflictingActor.classifyAiConstructionLoanLine(args),error=>error.code==='23505');
  const reader=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'loan-reader',['AI.LOAN.VIEW'])}),rows=await reader.listAiConstructionLoanClassifications({tenantId:ids.tenantId,entityId:ids.entityId,limit:50});
  assert.equal(rows.length,1);assert.equal(rows[0].classification,'LOAN_DRAW');assert.equal(rows[0].source_document_line_id,lineId);assert.equal(rows[0].source_payload_hash,hash('auto-doc'));
  assert.deepEqual(await counts(),{evidence:before.evidence+1,audits:before.audits+1,outbox:before.outbox+1,journals:before.journals,staging:before.staging,ledger:before.ledger});
  const beforeProposal=await counts(),proposer=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'loan-proposer',['AI.LOAN.PROPOSE'])}),proposalArgs={tenantId:ids.tenantId,entityId:ids.entityId,classificationEvidenceId:created.ai_construction_loan_classification_evidence_id,classificationHash:created.classification_hash,accountingPeriodId:ids.periodId,treatmentDecision:'LOAN_DRAW_CASH',debitAccountCode:'111000',creditAccountCode:'230000',memberTrace:{project_ref:'PROJECT-1',property_ref:'PROPERTY-1',allocation_basis:'SOURCE_DIMENSIONED'},reason:'Controller selected cash receipt against construction loan payable for the retained draw.',idempotencyKey:'construction-loan-entry-proposal-001'};
  const proposal=await proposer.proposeAiConstructionLoanEntry(proposalArgs),proposalReplay=await proposer.proposeAiConstructionLoanEntry(proposalArgs);assert.deepEqual({status:proposal.status,treatment:proposal.treatment_decision,date:String(proposal.journal_date).slice(0,10),amount:Number(proposal.amount),draft:proposal.can_create_draft,review:proposal.can_review,approve:proposal.can_approve,post:proposal.can_post,replay:proposalReplay.idempotent},{status:'PROPOSED',treatment:'LOAN_DRAW_CASH',date:'2026-07-15',amount:250000,draft:false,review:false,approve:false,post:false,replay:true});
  await assert.rejects(proposer.proposeAiConstructionLoanEntry({...proposalArgs,treatmentDecision:'EXPENSED_INTEREST',idempotencyKey:'construction-loan-entry-proposal-wrong-treatment'}),error=>error.code==='23514');await assert.rejects(proposer.proposeAiConstructionLoanEntry({...proposalArgs,creditAccountCode:'291001'}),error=>error.code==='23505');
  const proposals=await reader.listAiConstructionLoanEntryProposals({tenantId:ids.tenantId,entityId:ids.entityId,limit:50});assert.equal(proposals.length,1);assert.equal(proposals[0].classification_hash,created.classification_hash);assert.deepEqual(await counts(),beforeProposal);assert.equal((await adminPool.query("SELECT count(*)::int n FROM audit_event WHERE tenant_id=$1 AND entity_id=$2 AND event_type='AI_CONSTRUCTION_LOAN_ENTRY_PROPOSED'",[ids.tenantId,ids.entityId])).rows[0].n,1);assert.equal((await adminPool.query("SELECT count(*)::int n FROM outbox_event WHERE tenant_id=$1 AND entity_id=$2 AND event_type='AI_CONSTRUCTION_LOAN_ENTRY_PROPOSED'",[ids.tenantId,ids.entityId])).rows[0].n,1);
  const badLineId=(await adminPool.query(`INSERT INTO source_document_line(tenant_id,entity_id,source_document_id,source_line_id,line_no,amount,direction,description,loan_ref)
    VALUES($1,$2,$3,'construction-loan-bad-direction',2,1000,'OUTFLOW','Construction draw advance','LOAN-REF-002') RETURNING source_document_line_id`,[ids.tenantId,ids.entityId,trace.documentId])).rows[0].source_document_line_id,beforeBad=await counts();
  await assert.rejects(classifier.classifyAiConstructionLoanLine({tenantId:ids.tenantId,entityId:ids.entityId,sourceDocumentLineId:badLineId,expectedClassification:'LOAN_DRAW',idempotencyKey:'construction-loan-classification-bad-direction'}),error=>error.code==='23514');
  assert.deepEqual(await counts(),beforeBad);
});

pgTest('AI finding assignment is source-hash-bound, idempotent, audited, revisioned, and has zero accounting effects',async()=>{
  const ids=await seed({status:'DRAFT',attachmentStatus:null});
  const trace=await attachAutoSource(ids,{linkJournal:false});
  await adminPool.query("UPDATE source_document SET status='READY_FOR_DRAFT' WHERE tenant_id=$1 AND entity_id=$2 AND source_document_id=$3",[ids.tenantId,ids.entityId,trace.documentId]);
  await adminPool.query("INSERT INTO source_document_line(tenant_id,entity_id,source_document_id,source_line_id,line_no,amount,direction,description) VALUES($1,$2,$3,'finding-action-insurance-line',1,100,'DEBIT','Annual insurance policy premium')",[ids.tenantId,ids.entityId,trace.documentId]);
  const finding=(await adminPool.query("SELECT ai_prepaid_coverage_finding_id,finding_hash FROM ai_prepaid_coverage_finding WHERE tenant_id=$1 AND entity_id=$2 AND source_document_id=$3",[ids.tenantId,ids.entityId,trace.documentId])).rows[0];
  assert.ok(finding);
  const before=(await adminPool.query("SELECT (SELECT count(*)::int FROM journal_entry WHERE tenant_id=$1) journals,(SELECT count(*)::int FROM ledger_line WHERE tenant_id=$1) ledger",[ids.tenantId])).rows[0];
  const controller=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'ai-finding-controller',['AI.FINDING.ASSIGN'])});
  const command={tenantId:ids.tenantId,entityId:ids.entityId,findingKind:'PREPAID_COVERAGE',findingId:finding.ai_prepaid_coverage_finding_id,findingHash:finding.finding_hash,owner:'CONTROLLER',dueDate:'2026-08-31',expectedRevision:0,idempotencyKey:'ai-finding-assign-001'};
  const created=await controller.assignAiFindingAction(command);
  assert.deepEqual({owner:created.owner,due:created.due_date,revision:created.revision,draft:created.can_create_draft,review:created.can_review,approve:created.can_approve,post:created.can_post,idempotent:created.idempotent},{owner:'CONTROLLER',due:'2026-08-31',revision:0,draft:false,review:false,approve:false,post:false,idempotent:false});
  const replay=await controller.assignAiFindingAction(command);assert.equal(replay.idempotent,true);assert.equal(replay.ai_finding_action_id,created.ai_finding_action_id);
  await assert.rejects(controller.assignAiFindingAction({...command,owner:'SECOND_CONTROLLER'}),error=>error.code==='23505');
  const reassigned=await controller.assignAiFindingAction({...command,owner:'SECOND_CONTROLLER',dueDate:'2026-09-05',expectedRevision:0,idempotencyKey:'ai-finding-assign-002'});assert.deepEqual({owner:reassigned.owner,due:reassigned.due_date,revision:reassigned.revision,idempotent:reassigned.idempotent},{owner:'SECOND_CONTROLLER',due:'2026-09-05',revision:1,idempotent:false});
  const candidates=await controller.listAiFindingAssignmentCandidates({tenantId:ids.tenantId,entityId:ids.entityId,limit:100}),actions=await controller.listAiFindingActions({tenantId:ids.tenantId,entityId:ids.entityId,limit:100});
  assert.deepEqual({candidate:candidates[0].finding_id,hash:candidates[0].finding_hash,draft:candidates[0].can_create_draft,post:candidates[0].can_post},{candidate:finding.ai_prepaid_coverage_finding_id,hash:finding.finding_hash,draft:false,post:false});
  assert.deepEqual({action:actions[0].ai_finding_action_id,owner:actions[0].owner,due:actions[0].due_date,revision:actions[0].revision,draft:actions[0].can_create_draft,post:actions[0].can_post},{action:created.ai_finding_action_id,owner:'SECOND_CONTROLLER',due:'2026-09-05',revision:1,draft:false,post:false});
  await assert.rejects(controller.assignAiFindingAction({...command,idempotencyKey:'ai-finding-assign-stale'}),error=>error.code==='40001');
  const resolver=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'ai-finding-resolver',['AI.FINDING.RESOLVE'])});
  const resolution={tenantId:ids.tenantId,entityId:ids.entityId,aiFindingActionId:created.ai_finding_action_id,findingHash:finding.finding_hash,reason:'Controller verified retained policy evidence and completed the follow-up.',expectedRevision:1,idempotencyKey:'ai-finding-resolve-001'};
  const resolved=await resolver.resolveAiFindingAction(resolution),resolvedReplay=await resolver.resolveAiFindingAction(resolution);assert.deepEqual({status:resolved.status,revision:resolved.revision,post:resolved.can_post,replay:resolvedReplay.idempotent},{status:'RESOLVED',revision:2,post:false,replay:true});
  await assert.rejects(resolver.resolveAiFindingAction({...resolution,reason:'A different human conclusion must not reuse the original resolution receipt.'}),error=>error.code==='23505');
  const otherResolver=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'ai-finding-second-resolver',['AI.FINDING.RESOLVE'])});
  await assert.rejects(otherResolver.resolveAiFindingAction(resolution),error=>error.code==='23505');
  await assert.rejects(controller.assignAiFindingAction({...command,expectedRevision:2,idempotencyKey:'ai-finding-assign-resolved'}),error=>error.code==='55000');
  assert.equal((await adminPool.query("SELECT count(*)::int n FROM audit_event WHERE tenant_id=$1 AND entity_id=$2 AND event_type='AI_FINDING_ACTION_RESOLVED'",[ids.tenantId,ids.entityId])).rows[0].n,1);
  const after=(await adminPool.query("SELECT (SELECT count(*)::int FROM journal_entry WHERE tenant_id=$1) journals,(SELECT count(*)::int FROM ledger_line WHERE tenant_id=$1) ledger",[ids.tenantId])).rows[0];assert.deepEqual(after,before);
  assert.equal((await adminPool.query("SELECT count(*)::int n FROM audit_event WHERE tenant_id=$1 AND entity_id=$2 AND event_type='AI_FINDING_ACTION_ASSIGNED'",[ids.tenantId,ids.entityId])).rows[0].n,2);
  assert.equal((await adminPool.query("SELECT status FROM ai_prepaid_coverage_finding WHERE tenant_id=$1 AND entity_id=$2 AND ai_prepaid_coverage_finding_id=$3",[ids.tenantId,ids.entityId,finding.ai_prepaid_coverage_finding_id])).rows[0].status,'OPEN');
});

pgTest('signed insurance source reaches independent monthly review, AUTO Draft, standard Post, GL and prepaid rollforward',async()=>{
  const ids=await seed({status:'APPROVED',journalType:'AUTO',attachmentStatus:null,extraAccounts:[{accountCode:'141500',accountName:'Prepaid insurance'},{accountCode:'610100',accountName:'Insurance expense'}],journalLines:[{lineNo:1,accountCode:'141500',debit:100,credit:0},{lineNo:2,accountCode:'291001',debit:0,credit:100,memberRef:'VENDOR-1'}]}),trace=await attachAutoSource(ids,{sourceModule:'payable',sourceRecordPrefix:'SIGNED-INSURANCE'});
  await adminPool.query("UPDATE source_document SET document_type='WBS_PAYABLE',status='READY_FOR_DRAFT',gross_amount=100 WHERE tenant_id=$1 AND entity_id=$2 AND source_document_id=$3",[ids.tenantId,ids.entityId,trace.documentId]);
  await adminPool.query("INSERT INTO source_document_line(tenant_id,entity_id,source_document_id,source_line_id,line_no,amount,direction) VALUES($1,$2,$3,'insurance-premium',1,100,'DEBIT')",[ids.tenantId,ids.entityId,trace.documentId]);
  await retainPrepaidInvoiceClassification({ids,sourceDocumentId:trace.documentId,label:'signed-insurance'});
  const snapshotImportId=randomUUID(),admissionId=randomUUID(),scheduleId=randomUUID(),scheduleLineId=randomUUID(),coverageId=randomUUID(),settingId=randomUUID(),mappingId=randomUUID(),proposalHash=hash('signed-insurance-proposal'),coverageHash=hash('signed-insurance-coverage'),sourceHash=hash('auto-doc'),snapshotHash=hash('signed-insurance-package');
  await adminPool.query("INSERT INTO wbs_snapshot_import(wbs_snapshot_import_id,tenant_id,entity_id,snapshot_id,captured_at,environment,dictionary_version,package_hash,import_batch_id,created_by) VALUES($1,$2,$3,$4,now(),'PRODUCTION','WBS-MCP-V1',$5,$6,'signed-insurance-importer')",[snapshotImportId,ids.tenantId,ids.entityId,randomUUID(),snapshotHash,trace.batchId]);
  await adminPool.query(`INSERT INTO wbs_provider_signed_payable_admission(wbs_provider_signed_payable_admission_id,tenant_id,entity_id,issuer,key_id,algorithm,nonce,company_code,signed_at,expires_at,request_raw_hash,response_raw_hash,package_raw_hash,package_hash,receipt_hash,snapshot_id,import_batch_id,wbs_snapshot_import_id,admitted_by)
    VALUES($1,$2,$3,'wbs-provider','insurance-key','Ed25519',$4,$5,now()-interval '1 minute',now()+interval '9 minutes',$6,$7,$8,$9,$10,$11,$12,$13,'signed-insurance-importer')`,[admissionId,ids.tenantId,ids.entityId,`nonce-${randomUUID()}`,ids.sourceEntityId,hash('insurance-request'),hash('insurance-response'),hash('insurance-package-raw'),snapshotHash,hash('insurance-receipt'),randomUUID(),trace.batchId,snapshotImportId]);
  await adminPool.query(`INSERT INTO ai_amortization_coverage_evidence(ai_amortization_coverage_evidence_id,tenant_id,entity_id,source_document_id,source_payload_hash,source_document_version,coverage_start,coverage_end,evidence_ref,evidence_hash,extraction_method,coverage_hash,created_by)
    VALUES($1,$2,$3,$4,$5,0,'2026-07-01','2027-06-30','object://signed-insurance/policy',$6,'SIGNED_ATTACHMENT_FIELD',$7,'insurance-analysis-preparer')`,[coverageId,ids.tenantId,ids.entityId,trace.documentId,sourceHash,hash('insurance-policy'),coverageHash]);
  await adminPool.query(`INSERT INTO ai_amortization_schedule(ai_amortization_schedule_id,tenant_id,entity_id,source_document_id,source_payload_hash,source_document_version,rule_id,analysis_mode,confidence,coverage_start,coverage_end,currency,original_amount,prepaid_account_code,expense_account_code,member_trace,proposal_reason,proposal_hash,created_by)
    VALUES($1,$2,$3,$4,$5,0,'PREPAID_AMORTIZATION_V1','DETERMINISTIC_EVIDENCE_BACKED',1,'2026-07-01','2027-06-30','USD',100,'141500','610100',$6::jsonb,'Signed insurance coverage supports deterministic monthly allocation.',$7,'insurance-analysis-preparer')`,[scheduleId,ids.tenantId,ids.entityId,trace.documentId,sourceHash,JSON.stringify({project_ref:null,property_ref:null,allocation_basis:'ENTITY_ONLY'}),proposalHash]);
  await adminPool.query("INSERT INTO ai_amortization_schedule_line(ai_amortization_schedule_line_id,tenant_id,entity_id,ai_amortization_schedule_id,line_no,amortization_month,amount,source_payload_hash) VALUES($1,$2,$3,$4,1,'2026-07-01',8.3333,$5)",[scheduleLineId,ids.tenantId,ids.entityId,scheduleId,sourceHash]);
  const settingSnapshot={rule_id:'PREPAID_AMORTIZATION_V1',frequency:'MONTHLY'},mappingInput={account_code:'141500'},mappingOutput={classification:'PREPAID',prepaid_type:'INSURANCE'},configHashes=(await adminPool.query("SELECT refs_jsonb_hash($1::jsonb) setting_hash,refs_jsonb_hash(jsonb_build_object('input_keys',$2::jsonb,'output_rules',$3::jsonb)) mapping_hash,refs_jsonb_hash($2::jsonb) input_hash",[JSON.stringify(settingSnapshot),JSON.stringify(mappingInput),JSON.stringify(mappingOutput)])).rows[0];
  await adminPool.query("INSERT INTO setting_snapshot(setting_snapshot_id,tenant_id,entity_id,family,scope_type,scope_key,version,effective_from,status,snapshot,snapshot_hash,created_by,approved_by,approved_at) VALUES($1,$2,$3::uuid,'PREPAID_AMORTIZATION_POLICY','ENTITY',$3::uuid::text,1,'2026-01-01','APPROVED',$4::jsonb,$5,'setting-maker','setting-approver',now())",[settingId,ids.tenantId,ids.entityId,JSON.stringify(settingSnapshot),configHashes.setting_hash]);
  await adminPool.query("INSERT INTO mapping_snapshot(mapping_snapshot_id,tenant_id,entity_id,family,scope_type,scope_key,input_key_hash,version,priority,effective_from,status,input_keys,output_rules,snapshot_hash,created_by,approved_by,approved_at) VALUES($1,$2,$3::uuid,'PREPAID_ACCOUNT_CLASSIFICATION','ENTITY',$3::uuid::text,$4,1,0,'2026-01-01','APPROVED',$5::jsonb,$6::jsonb,$7,'mapping-maker','mapping-approver',now())",[mappingId,ids.tenantId,ids.entityId,configHashes.input_hash,JSON.stringify(mappingInput),JSON.stringify(mappingOutput),configHashes.mapping_hash]);
  const capitalizationPoster=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'capitalization-poster',['GL.JE.POST'])});await capitalizationPoster.postJournal({...ids,journalEntryId:ids.journalId,periodId:ids.periodId,expectedRevision:0,idempotencyKey:'insurance-capitalization-post'});
  const capitalizationLedger=(await adminPool.query("SELECT ledger_line_id FROM ledger_line WHERE tenant_id=$1 AND entity_id=$2 AND journal_entry_id=$3 AND account_code='141500'",[ids.tenantId,ids.entityId,ids.journalId])).rows[0].ledger_line_id;
  const permissionOnlyEntity=await seed({tenantId:ids.tenantId,status:'DRAFT',attachmentStatus:null}),crossEntityActor='insurance-cross-entity-reader';
  await adminPool.query("INSERT INTO runtime_actor_grant(tenant_id,actor_id,entity_id,permission) VALUES($1,$2,$3,'PREPAID.AMORTIZATION.REVIEW'),($1,$2,$3,'PREPAID.AMORTIZATION.DRAFT'),($1,$2,$3,'GL.JE.AUTO.CREATE')",[ids.tenantId,crossEntityActor,permissionOnlyEntity.entityId]);
  const crossEntityReader=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,crossEntityActor,['GL.REPORT.VIEW'])}),crossEntityRead=await crossEntityReader.inSession(async client=>(await client.query('SELECT * FROM refs_read_insurance_prepaid_amortization($1,$2,$3,50)',[ids.tenantId,ids.entityId,ids.periodId])).rows[0].refs_read_insurance_prepaid_amortization);
  assert.equal(crossEntityRead.readiness_status,'READY_FOR_INDEPENDENT_REVIEW');assert.equal(crossEntityRead.can_independently_review,false);assert.equal(crossEntityRead.can_create_draft,false);
  const reviewer=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'insurance-controller',['PREPAID.AMORTIZATION.REVIEW'])}),reviewArgs=[ids.tenantId,ids.entityId,admissionId,scheduleId,scheduleLineId,ids.periodId,settingId,mappingId,ids.journalId,capitalizationLedger,sourceHash,proposalHash,coverageHash,'Independently reviewed signed insurance coverage and posted capitalization.'];
  const reviewMutationCounts=()=>adminPool.query("SELECT (SELECT count(*)::int FROM insurance_prepaid_amortization_review WHERE tenant_id=$1) reviews,(SELECT count(*)::int FROM insurance_prepaid_amortization_draft_evidence WHERE tenant_id=$1) drafts,(SELECT count(*)::int FROM journal_entry WHERE tenant_id=$1) journals,(SELECT count(*)::int FROM ledger_line WHERE tenant_id=$1) ledger",[ids.tenantId]).then(value=>value.rows[0]),beforeRejectedReview=await reviewMutationCounts();
  await assert.rejects(reviewer.inSession(async client=>{const changed=[...reviewArgs];changed[10]=hash('wrong-source');const requestHash=(await client.query('SELECT refs_review_insurance_prepaid_amortization_hash($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) hash',changed)).rows[0].hash;return client.query('SELECT refs_review_insurance_prepaid_amortization($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)',[...changed,'insurance-review-wrong-source',requestHash]);}),error=>error.code==='23514');
  assert.deepEqual(await reviewMutationCounts(),beforeRejectedReview);
  await assert.rejects(reviewer.inSession(client=>client.query('SELECT refs_review_insurance_prepaid_amortization_http($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)',[...reviewArgs.slice(0,10),1,...reviewArgs.slice(10),'insurance-review-stale-version'])),error=>error.code==='40001');
  assert.deepEqual(await reviewMutationCounts(),beforeRejectedReview);
  const reviewed=await reviewer.inSession(async client=>(await client.query('SELECT refs_review_insurance_prepaid_amortization_http($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) result',[...reviewArgs.slice(0,10),0,...reviewArgs.slice(10),'insurance-review-001'])).rows[0].result);
  assert.equal(reviewed.status,'INDEPENDENTLY_REVIEWED');assert.equal(reviewed.amount,'8.3333');
  const makerArgs=[ids.tenantId,ids.entityId,reviewed.insurance_prepaid_amortization_review_id,reviewed.evidence_hash,'Prepare only the reviewed monthly insurance amortization Draft.'];
  const draftMutationCounts=()=>adminPool.query("SELECT (SELECT count(*)::int FROM insurance_prepaid_amortization_draft_evidence WHERE tenant_id=$1) drafts,(SELECT count(*)::int FROM import_batch WHERE tenant_id=$1 AND connector_code='REFS_AMORTIZATION') imports,(SELECT count(*)::int FROM source_document WHERE tenant_id=$1 AND document_type='INSURANCE_AMORTIZATION') documents,(SELECT count(*)::int FROM staging_item WHERE tenant_id=$1 AND source_document_id IN(SELECT source_document_id FROM source_document WHERE tenant_id=$1 AND document_type='INSURANCE_AMORTIZATION')) staging,(SELECT count(*)::int FROM journal_entry WHERE tenant_id=$1) journals,(SELECT count(*)::int FROM ledger_line WHERE tenant_id=$1) ledger",[ids.tenantId]).then(value=>value.rows[0]),beforeRejectedDraft=await draftMutationCounts();
  await assert.rejects(reviewer.inSession(async client=>{const requestHash=(await client.query('SELECT refs_create_insurance_prepaid_amortization_draft_hash($1,$2,$3,$4,$5) hash',makerArgs)).rows[0].hash;return client.query('SELECT refs_create_insurance_prepaid_amortization_draft($1,$2,$3,$4,$5,$6,$7)',[...makerArgs,'insurance-draft-sod',requestHash]);}),error=>error.code==='42501');
  assert.deepEqual(await draftMutationCounts(),beforeRejectedDraft);
  const maker=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'insurance-draft-maker',['PREPAID.AMORTIZATION.DRAFT','GL.JE.AUTO.CREATE'])}),drafted=await maker.inSession(async client=>{const requestHash=(await client.query('SELECT refs_create_insurance_prepaid_amortization_draft_hash($1,$2,$3,$4,$5) hash',makerArgs)).rows[0].hash;return (await client.query('SELECT refs_create_insurance_prepaid_amortization_draft($1,$2,$3,$4,$5,$6,$7) result',[...makerArgs,'insurance-draft-001',requestHash])).rows[0].result;});
  assert.deepEqual({status:drafted.status,type:drafted.journal_type,amount:drafted.amount},{status:'DRAFT',type:'AUTO',amount:'8.3333'});assert.equal((await adminPool.query('SELECT count(*)::int n FROM ledger_line WHERE journal_entry_id=$1',[drafted.journal_entry_id])).rows[0].n,0);
  const submitter=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'insurance-submitter',['GL.JE.SUBMIT'])}),journalReviewer=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'insurance-je-reviewer',['GL.JE.REVIEW'])}),approver=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'insurance-approver',['GL.JE.APPROVE'])}),poster=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'insurance-poster',['GL.JE.POST'])});
  await submitter.transitionJournal({...ids,journalEntryId:drafted.journal_entry_id,action:'SUBMIT',expectedRevision:0,idempotencyKey:'insurance-submit'});await journalReviewer.transitionJournal({...ids,journalEntryId:drafted.journal_entry_id,action:'REVIEW',expectedRevision:1,idempotencyKey:'insurance-je-review'});await approver.transitionJournal({...ids,journalEntryId:drafted.journal_entry_id,action:'APPROVE',expectedRevision:2,idempotencyKey:'insurance-approve'});await poster.postJournal({...ids,journalEntryId:drafted.journal_entry_id,periodId:ids.periodId,expectedRevision:3,idempotencyKey:'insurance-post'});
  const reader=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'insurance-reader',['GL.REPORT.VIEW'])}),rollforward=await reader.getPrepaidRollforward({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId}),prepaid=rollforward.find(row=>row.account_code==='141500');assert.deepEqual({additions:prepaid.period_additions,amortization:prepaid.period_amortization,closing:prepaid.closing_balance},{additions:'100.0000',amortization:'8.3333',closing:'91.6667'});assert.ok(prepaid.journal_entry_ids.includes(drafted.journal_entry_id));assert.ok(prepaid.source_document_ids.includes(trace.documentId));assert.ok(prepaid.source_document_ids.includes(drafted.derived_source_document_id));
});

pgTest('AI exact duplicate payable finding retains paired source evidence without changing either source or creating a journal',async()=>{
  const ids=await seed({status:'DRAFT',attachmentStatus:null});
  const first=await attachAutoSource(ids,{linkJournal:false,sourceModule:'payable',sourceRecordPrefix:'DUP-A'});
  const second=await attachAutoSource({...ids,journalId:randomUUID()},{linkJournal:false,sourceModule:'payable',sourceRecordPrefix:'DUP-B',reuseApprovedSnapshots:true});
  for(const documentId of [first.documentId,second.documentId])await adminPool.query("UPDATE source_document SET status='READY_FOR_DRAFT',document_no='INV-EXACT-42' WHERE tenant_id=$1 AND entity_id=$2 AND source_document_id=$3",[ids.tenantId,ids.entityId,documentId]);
  await adminPool.query("INSERT INTO source_document_line(tenant_id,entity_id,source_document_id,source_line_id,line_no,amount,direction,party_ref) VALUES($1,$2,$3,'duplicate-line-a',1,100,'DEBIT','VENDOR-1'),($1,$2,$4,'duplicate-line-b',1,100,'DEBIT','VENDOR-1')",[ids.tenantId,ids.entityId,first.documentId,second.documentId]);
  const reader=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'ai-duplicate-reader',['AI.AMORTIZATION.PROPOSE'])});
  const retained=await reader.listAiDuplicatePayableFindings({tenantId:ids.tenantId,entityId:ids.entityId,limit:50});
  assert.equal(retained.length,1);assert.deepEqual({rule:retained[0].rule_id,risk:retained[0].risk_level,confidence:retained[0].confidence,status:retained[0].status,draft:retained[0].can_create_draft,review:retained[0].can_review,approve:retained[0].can_approve,post:retained[0].can_post},{rule:'DUPLICATE_PAYABLE_EXACT',risk:'HIGH',confidence:'1.0000',status:'OPEN',draft:false,review:false,approve:false,post:false});
  assert.equal((await adminPool.query("SELECT count(*)::int n FROM journal_entry WHERE tenant_id=$1",[ids.tenantId])).rows[0].n,1);
  assert.equal((await adminPool.query("SELECT count(*)::int n FROM audit_event WHERE tenant_id=$1 AND event_type='AI_DUPLICATE_PAYABLE_FINDING_MATERIALIZED'",[ids.tenantId])).rows[0].n,1);
  const documents=(await adminPool.query("SELECT status FROM source_document WHERE tenant_id=$1 AND entity_id=$2 ORDER BY source_document_id",[ids.tenantId,ids.entityId])).rows;assert.deepEqual(documents.map(row=>row.status),['READY_FOR_DRAFT','READY_FOR_DRAFT']);
});

pgTest('AI unmatched bank payment finding retains bank evidence, never changes the bank record, and reflects a later human match',async()=>{
  const ids=await seed({status:'DRAFT',attachmentStatus:null});const trace=await attachAutoSource(ids,{linkJournal:false});const bankSourceId=randomUUID();
  await adminPool.query(`INSERT INTO bank_source(bank_source_id,tenant_id,entity_id,source_document_id,bank_account_ref,external_bank_line_id,transaction_date,currency,amount)
    VALUES($1,$2,$3,$4,'BANK-1','UNMATCHED-PAYMENT-1','2026-07-15','USD',-100)`,[bankSourceId,ids.tenantId,ids.entityId,trace.documentId]);
  const reader=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'ai-bank-reader',['AI.AMORTIZATION.PROPOSE'])});
  let retained=await reader.listAiUnmatchedBankPaymentFindings({tenantId:ids.tenantId,entityId:ids.entityId,limit:50});assert.equal(retained.length,1);assert.deepEqual({rule:retained[0].rule_id,risk:retained[0].risk_level,state:retained[0].current_match_state,draft:retained[0].can_create_draft,review:retained[0].can_review,approve:retained[0].can_approve,post:retained[0].can_post},{rule:'BANK_PAYMENT_UNMATCHED',risk:'MEDIUM',state:'OPEN',draft:false,review:false,approve:false,post:false});
  assert.equal((await adminPool.query("SELECT count(*)::int n FROM journal_entry WHERE tenant_id=$1",[ids.tenantId])).rows[0].n,1);assert.equal((await adminPool.query("SELECT count(*)::int n FROM audit_event WHERE tenant_id=$1 AND event_type='AI_UNMATCHED_BANK_PAYMENT_FINDING_MATERIALIZED'",[ids.tenantId])).rows[0].n,1);
  await adminPool.query(`INSERT INTO bank_match(bank_match_id,tenant_id,entity_id,bank_source_id,business_source_document_id,candidate_rule_code,amount_delta,currency_match,date_delta_days,status,matched_by)
    VALUES($1,$2,$3,$4,$5,'CONTROLLER_RETAINED_MATCH',0,true,0,'ACTIVE','controller')`,[randomUUID(),ids.tenantId,ids.entityId,bankSourceId,trace.documentId]);
  retained=await reader.listAiUnmatchedBankPaymentFindings({tenantId:ids.tenantId,entityId:ids.entityId,limit:50});assert.equal(retained[0].current_match_state,'MATCHED_AFTER_FINDING');assert.equal((await adminPool.query('SELECT amount FROM bank_source WHERE bank_source_id=$1',[bankSourceId])).rows[0].amount,'-100.0000');
});

pgTest('AI analysis explain reads every authoritative finding family but has no amortization or journal authority',async()=>{
  const ids=await seed({status:'DRAFT',attachmentStatus:null});
  const analyst=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'ai-explain-reader',['AI.ANALYSIS.EXPLAIN'])});
  const reads=await Promise.all([
    analyst.listAiWbsExceptionFindings({tenantId:ids.tenantId,entityId:ids.entityId,limit:50}),
    analyst.listAiPrepaidCoverageFindings({tenantId:ids.tenantId,entityId:ids.entityId,limit:50}),
    analyst.listAiDuplicatePayableFindings({tenantId:ids.tenantId,entityId:ids.entityId,limit:50}),
    analyst.listAiUnmatchedBankPaymentFindings({tenantId:ids.tenantId,entityId:ids.entityId,limit:50}),
    analyst.listAiCostDimensionFindings({tenantId:ids.tenantId,entityId:ids.entityId,limit:50}),
    analyst.listAiLoanReferenceFindings({tenantId:ids.tenantId,entityId:ids.entityId,limit:50}),
    analyst.readAiAccountingAnalysisSummary({tenantId:ids.tenantId,entityId:ids.entityId}),
  ]);
  assert.equal(reads.length,7);assert.ok(reads.every(Array.isArray));
  await assert.rejects(analyst.inSession(client=>client.query("SELECT refs_assert_scope($1,$2,'AI.AMORTIZATION.PROPOSE')",[ids.tenantId,ids.entityId])),error=>error.code==='42501');
  await assert.rejects(analyst.inSession(client=>client.query("SELECT refs_assert_scope($1,$2,'GL.JE.MAKER')",[ids.tenantId,ids.entityId])),error=>error.code==='42501');
});

pgTest('AI analysis explain completes and replays a retained WBS finding with an explanation-only audit receipt',async()=>{
  const ids=await seed({status:'DRAFT',attachmentStatus:null}),capturedAt='2026-08-15T00:00:00.000Z';
  const raw={ap_guid:`ai-explain-${randomUUID()}`,amount:'89.12500',company_code:ids.sourceEntityId,posting_date:'2026-08-14'};
  const rowHash=(await adminPool.query('SELECT refs_jsonb_hash($1::jsonb) hash',[JSON.stringify(raw)])).rows[0].hash;
  const operator=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'ai-explain-operator',['WBS.PAYABLE.OPERATOR_ATTEST'])});
  await operator.attestWbsOperatorPayables({tenantId:ids.tenantId,entityId:ids.entityId,capturedAt,providerContentHash:hash('ai-explain-provider'),observationHash:hash('ai-explain-observation'),companyCodes:[ids.sourceEntityId],rows:[{source_record_id:raw.ap_guid,source_version:`operator:${capturedAt}:${rowHash.slice(7,39)}`,row_hash:rowHash,raw}],reason:'Retain one WBS row for explanation-only controller evidence.',idempotencyKey:'ai-explain-retain-0001'});
  const analyst=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'ai-explain-receiver',['AI.ANALYSIS.EXPLAIN'])});
  const [finding]=await analyst.listAiWbsExceptionFindings({tenantId:ids.tenantId,entityId:ids.entityId,limit:10});assert.ok(finding);
  const summary=(await analyst.readAiAccountingAnalysisSummary({tenantId:ids.tenantId,entityId:ids.entityId})).map(row=>({category:row.category,total_findings:row.total_findings,high_findings:row.high_findings,medium_findings:row.medium_findings,low_findings:row.low_findings,latest_materialized_at:new Date(row.latest_materialized_at).toISOString()}));
  const evidence=[{category:'WBS_EXCEPTION',finding_id:finding.ai_finding_id,rule_id:finding.rule_id,risk_level:finding.risk_level,confidence:Number(finding.confidence),reason:finding.reason,suggested_action:finding.suggested_action,source_refs:[finding.source_evidence_row_id],evidence_hashes:[...new Set([finding.source_row_hash,finding.provider_content_hash,finding.observation_hash])],source_versions:[],created_at:new Date(finding.created_at).toISOString()}];
  const idempotencyKey='ai-explain-receipt-0001',started=await analyst.beginAiAccountingAnalysisExplanation({tenantId:ids.tenantId,entityId:ids.entityId,summary,evidence,idempotencyKey});
  assert.equal(started.result.state,'STARTED');
  const output={traceId:'ai-explain-pg-0001',providerRequestId:null,model:'test-controller-memo',elapsedMs:0,result:{headline:'One retained WBS exception requires controller review.',risk_level:'MEDIUM',narrative:'The immutable WBS exception remains outside Draft and posting workflows.',controller_actions:[{category:'WBS_EXCEPTION',finding_ids:[finding.ai_finding_id],action:'Review the retained WBS exception evidence.'}],can_create_draft:false,can_review:false,can_approve:false,can_post:false}};
  const completed=await analyst.completeAiAccountingAnalysisExplanation({tenantId:ids.tenantId,entityId:ids.entityId,idempotencyKey,requestHash:started.requestHash,output});assert.deepEqual(completed,output);
  const replay=await analyst.beginAiAccountingAnalysisExplanation({tenantId:ids.tenantId,entityId:ids.entityId,summary,evidence,idempotencyKey});assert.equal(replay.result.state,'REPLAY');assert.deepEqual(replay.result.response,output);
  const reports=await analyst.listAiAccountingAnalysisReports({tenantId:ids.tenantId,entityId:ids.entityId,limit:10});assert.equal(reports.length,1);assert.deepEqual({idempotency_key:reports[0].idempotency_key,request_hash:reports[0].request_hash,actor_id:reports[0].actor_id,report:reports[0].report,can_create_draft:reports[0].can_create_draft,can_review:reports[0].can_review,can_approve:reports[0].can_approve,can_post:reports[0].can_post},{idempotency_key:idempotencyKey,request_hash:started.requestHash,actor_id:'ai-explain-receiver',report:output,can_create_draft:false,can_review:false,can_approve:false,can_post:false});
  await assert.rejects(analyst.listAiAccountingAnalysisReports({tenantId:ids.tenantId,entityId:ids.entityId,limit:51}),error=>error.code==='22023');
  const audit=(await adminPool.query("SELECT permission_used,metadata FROM audit_event WHERE tenant_id=$1 AND entity_id=$2 AND event_type='AI_ACCOUNTING_ANALYSIS_EXPLAINED'",[ids.tenantId,ids.entityId])).rows;
  assert.deepEqual(audit.map(row=>row.permission_used),['AI.ANALYSIS.EXPLAIN']);assert.deepEqual(audit[0].metadata,{schema_version:'REFS_AI_ACCOUNTING_ANALYSIS_EXPLANATION_V1',trace_id:output.traceId,provider_request_id:null,model:output.model,elapsed_ms:0,can_create_draft:false,can_review:false,can_approve:false,can_post:false});
  const accounting=(await adminPool.query(`SELECT
    (SELECT count(*)::int FROM journal_entry WHERE tenant_id=$1) AS journals,
    (SELECT count(*)::int FROM staging_item WHERE tenant_id=$1) AS staging,
    (SELECT count(*)::int FROM ledger_line WHERE tenant_id=$1) AS ledger`,[ids.tenantId])).rows[0];
  assert.deepEqual(accounting,{journals:1,staging:0,ledger:0});
});

pgTest('intercompany reconciliation requires two authorized entity scopes, reciprocal exact mappings, and POSTED ledger evidence without creating an elimination',async()=>{
  const current=await seed({status:'APPROVED',journalType:'AUTO',attachmentStatus:'VERIFIED_CLEAN'});
  const counterparty=await seed({status:'APPROVED',journalType:'AUTO',attachmentStatus:'VERIFIED_CLEAN',tenantId:current.tenantId,extraMembers:[{memberRef:'AFFILIATE-1',memberType:'CUSTOMER_OR_AFFILIATE',displayName:'Counterparty entity'}],journalLines:[{lineNo:1,accountCode:'111000',debit:0,credit:100,memberRef:'BANK-1'},{lineNo:2,accountCode:'120200',debit:100,credit:0,memberRef:'AFFILIATE-1'}]});
  const currentTrace=await attachAutoSource(current),counterpartyTrace=await attachAutoSource(counterparty);
  await new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(current,'intercompany-current-poster',['GL.JE.POST'])}).postJournal({...current,journalEntryId:current.journalId,periodId:current.periodId,expectedRevision:0,idempotencyKey:'intercompany-current-post-001'});
  await new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(counterparty,'intercompany-counterparty-poster',['GL.JE.POST'])}).postJournal({...counterparty,journalEntryId:counterparty.journalId,periodId:counterparty.periodId,expectedRevision:0,idempotencyKey:'intercompany-counterparty-post-001'});
  const actor='intercompany-reader';
  await adminPool.query(`INSERT INTO runtime_actor_grant(tenant_id,actor_id,entity_id,permission) VALUES($1,$2,$3,'GL.REPORT.VIEW'),($1,$2,$4,'GL.REPORT.VIEW')`,[current.tenantId,actor,current.entityId,counterparty.entityId]);
  const reader=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(current,actor,['GL.REPORT.VIEW'])});
  await assert.rejects(reader.getIntercompanyReconciliation({tenantId:current.tenantId,entityId:current.entityId,periodId:current.periodId,counterpartyEntityId:current.entityId,counterpartyPeriodId:current.periodId}),error=>error.code==='22023');
  assert.deepEqual(await reader.getIntercompanyReconciliation({tenantId:current.tenantId,entityId:current.entityId,periodId:current.periodId,counterpartyEntityId:counterparty.entityId,counterpartyPeriodId:counterparty.periodId}),[]);
  const insertMapping=async({ids,accountCode,counterpartyEntityId,classification,counterpartyAccountCode,counterpartyClassification})=>{
    const inputKeys={account_code:accountCode,counterparty_entity_id:counterpartyEntityId};const outputRules={classification,counterparty_account_code:counterpartyAccountCode,counterparty_classification:counterpartyClassification};
    const snapshotHash=(await adminPool.query("SELECT refs_jsonb_hash(jsonb_build_object('input_keys',$1::jsonb,'output_rules',$2::jsonb)) AS snapshot_hash",[JSON.stringify(inputKeys),JSON.stringify(outputRules)])).rows[0].snapshot_hash;
    const mappingId=randomUUID();
    await adminPool.query(`INSERT INTO mapping_snapshot(mapping_snapshot_id,tenant_id,entity_id,family,scope_type,scope_key,input_key_hash,version,priority,effective_from,status,input_keys,output_rules,snapshot_hash,created_by,approved_by,approved_at)
      VALUES($1,$2,$3::uuid,'INTERCOMPANY_ACCOUNT_PAIR','ENTITY',$3::text,$4,1,0,'2026-01-01','APPROVED',$5::jsonb,$6::jsonb,$7,'intercompany-maker','intercompany-approver',now())`,[mappingId,ids.tenantId,ids.entityId,hash(`intercompany:${accountCode}:${counterpartyEntityId}`),JSON.stringify(inputKeys),JSON.stringify(outputRules),snapshotHash]);
    return {mappingId,snapshotHash};
  };
  const currentMapping=await insertMapping({ids:current,accountCode:'291001',counterpartyEntityId:counterparty.entityId,classification:'DUE_TO',counterpartyAccountCode:'120200',counterpartyClassification:'DUE_FROM'});
  let rows=await reader.getIntercompanyReconciliation({tenantId:current.tenantId,entityId:current.entityId,periodId:current.periodId,counterpartyEntityId:counterparty.entityId,counterpartyPeriodId:counterparty.periodId});
  assert.deepEqual({status:rows[0].mapping_status,current:rows[0].current_closing_balance,counterparty:rows[0].counterparty_closing_balance,difference:rows[0].difference_amount,inBalance:rows[0].in_balance},{status:'BLOCKED_COUNTERPARTY_MAPPING_REQUIRED',current:null,counterparty:null,difference:null,inBalance:false});
  const counterpartyMapping=await insertMapping({ids:counterparty,accountCode:'120200',counterpartyEntityId:current.entityId,classification:'DUE_FROM',counterpartyAccountCode:'291001',counterpartyClassification:'DUE_TO'});
  rows=await reader.getIntercompanyReconciliation({tenantId:current.tenantId,entityId:current.entityId,periodId:current.periodId,counterpartyEntityId:counterparty.entityId,counterpartyPeriodId:counterparty.periodId});
  assert.equal(rows.length,1);assert.deepEqual({account:rows[0].account_code,counterparty:rows[0].counterparty_account_code,status:rows[0].mapping_status,current:rows[0].current_closing_balance,counterpartyClosing:rows[0].counterparty_closing_balance,difference:rows[0].difference_amount,inBalance:rows[0].in_balance,currentMapping:rows[0].mapping_snapshot_id,counterpartyMapping:rows[0].counterparty_mapping_snapshot_id},{account:'291001',counterparty:'120200',status:'MAPPED_INTERCOMPANY_PAIR',current:'-100.0000',counterpartyClosing:'100.0000',difference:'0.0000',inBalance:true,currentMapping:currentMapping.mappingId,counterpartyMapping:counterpartyMapping.mappingId});
  assert.deepEqual(rows[0].source_document_ids,[currentTrace.documentId]);assert.deepEqual(rows[0].counterparty_source_document_ids,[counterpartyTrace.documentId]);
  const api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId:current.tenantId,actorId:actor}),kernelFactory:async()=>reader});
  const response=await api({method:'GET',url:`/api/v1/entities/${current.entityId}/reports/intercompany-reconciliation?periodId=${current.periodId}&counterpartyEntityId=${counterparty.entityId}&counterpartyPeriodId=${counterparty.periodId}`,body:null,headers:{}});
  assert.equal(response.status,200);assert.equal(response.headers['cache-control'],'no-store');assert.equal(response.body.data[0].mapping_status,'MAPPED_INTERCOMPANY_PAIR');
  const denied=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(current,'intercompany-denied',['GL.REPORT.VIEW'])});
  await assert.rejects(denied.getIntercompanyReconciliation({tenantId:current.tenantId,entityId:current.entityId,periodId:current.periodId,counterpartyEntityId:counterparty.entityId,counterpartyPeriodId:counterparty.periodId}),error=>error.code==='42501');
  assert.equal((await adminPool.query("SELECT count(*)::int n FROM journal_entry WHERE tenant_id=$1 AND journal_type='ELIMINATION'",[current.tenantId])).rows[0].n,0);
});

pgTest('budget versus actual reads one approved immutable snapshot against same-currency POSTED ledger evidence without mutating a budget or journal',async()=>{
  const ids=await seed({status:'APPROVED',journalType:'AUTO',attachmentStatus:'VERIFIED_CLEAN',extraAccounts:[{accountCode:'610000',accountName:'Operating expense'}]});const trace=await attachAutoSource(ids);
  await new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'budget-poster',['GL.JE.POST'])}).postJournal({...ids,journalEntryId:ids.journalId,periodId:ids.periodId,expectedRevision:0,idempotencyKey:'budget-post-001'});
  const actor='budget-reader';await adminPool.query("INSERT INTO runtime_actor_grant(tenant_id,actor_id,entity_id,permission) VALUES($1,$2,$3,'GL.REPORT.VIEW')",[ids.tenantId,actor,ids.entityId]);
  const reader=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,actor,['GL.REPORT.VIEW'])});assert.deepEqual(await reader.getBudgetVsActual({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId}),[]);
  const snapshotId=randomUUID(),snapshotHash=hash(`budget-snapshot:${ids.periodId}`),receiptHash=hash(`budget-receipt:${ids.periodId}`);
  await adminPool.query(`INSERT INTO budget_snapshot(budget_snapshot_id,tenant_id,entity_id,period_id,version,currency,source_ref,source_version,receipt_hash,snapshot_hash,prepared_by,approved_by,approved_at)
    VALUES($1,$2,$3,$4,1,'USD','approved-budget-2026-07','1',$5,$6,'budget-maker','budget-approver',now())`,[snapshotId,ids.tenantId,ids.entityId,ids.periodId,receiptHash,snapshotHash]);
  await adminPool.query(`INSERT INTO budget_line(budget_snapshot_id,tenant_id,entity_id,period_id,account_code,comparison_side,budget_amount,budget_line_hash)
    VALUES($1,$2,$3,$4,'111000','DEBIT',120,$5),($1,$2,$3,$4,'610000','DEBIT',50,$6)`,[snapshotId,ids.tenantId,ids.entityId,ids.periodId,hash('budget-111000'),hash('budget-610000')]);
  const rows=await reader.getBudgetVsActual({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId});assert.equal(rows.length,2);
  const cash=rows.find(row=>row.account_code==='111000'),expense=rows.find(row=>row.account_code==='610000');assert.deepEqual({status:cash.report_status,budget:cash.budget_amount,actual:cash.actual_amount,variance:cash.variance_amount,snapshot:cash.budget_snapshot_id,receipt:cash.budget_receipt_hash},{status:'APPROVED_BUDGET_VS_ACTUAL',budget:'120.0000',actual:'100.0000',variance:'20.0000',snapshot:snapshotId,receipt:receiptHash});assert.deepEqual(cash.source_document_ids,[trace.documentId]);assert.deepEqual({status:expense.report_status,budget:expense.budget_amount,actual:expense.actual_amount,variance:expense.variance_amount},{status:'BLOCKED_POSTED_ACTUAL_EVIDENCE_REQUIRED',budget:null,actual:null,variance:null});
  await assert.rejects(adminPool.query('UPDATE budget_line SET budget_amount=999 WHERE budget_snapshot_id=$1',[snapshotId]),error=>error.code==='55000');
  const api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId:ids.tenantId,actorId:actor}),kernelFactory:async()=>reader});const response=await api({method:'GET',url:`/api/v1/entities/${ids.entityId}/reports/budget-vs-actual?periodId=${ids.periodId}`,body:null,headers:{}});assert.equal(response.status,200);assert.equal(response.headers['cache-control'],'no-store');assert.equal(response.body.data.find(row=>row.account_code==='111000').report_status,'APPROVED_BUDGET_VS_ACTUAL');
});

pgTest('consolidation reads only an approved immutable two-member scope with explicit elimination evidence and never creates an elimination journal',async()=>{
  const reporting=await seed({status:'APPROVED',journalType:'AUTO',attachmentStatus:'VERIFIED_CLEAN'});
  const member=await seed({status:'APPROVED',journalType:'AUTO',attachmentStatus:'VERIFIED_CLEAN',tenantId:reporting.tenantId,extraMembers:[{memberRef:'AFFILIATE-1',memberType:'CUSTOMER_OR_AFFILIATE',displayName:'Affiliate member'}],journalLines:[{lineNo:1,accountCode:'111000',debit:0,credit:100,memberRef:'BANK-1'},{lineNo:2,accountCode:'120200',debit:100,credit:0,memberRef:'AFFILIATE-1'}]});
  const reportingTrace=await attachAutoSource(reporting),memberTrace=await attachAutoSource(member);
  await new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(reporting,'consolidation-reporting-poster',['GL.JE.POST'])}).postJournal({...reporting,journalEntryId:reporting.journalId,periodId:reporting.periodId,expectedRevision:0,idempotencyKey:'consolidation-reporting-post-001'});
  await new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(member,'consolidation-member-poster',['GL.JE.POST'])}).postJournal({...member,journalEntryId:member.journalId,periodId:member.periodId,expectedRevision:0,idempotencyKey:'consolidation-member-post-001'});
  const snapshotId=randomUUID(),groupRef='GROUP-2026-07',actor='consolidation-reader',snapshotHash=hash('consolidation-snapshot'),receiptHash=hash('consolidation-receipt');
  await adminPool.query(`INSERT INTO consolidation_snapshot(consolidation_snapshot_id,tenant_id,reporting_entity_id,reporting_period_id,group_ref,version,currency,source_ref,source_version,receipt_hash,snapshot_hash,prepared_by,approved_by,approved_at)
    VALUES($1,$2,$3,$4,$5,1,'USD','approved-consolidation-2026-07','1',$6,$7,'consolidation-maker','consolidation-approver',now())`,[snapshotId,reporting.tenantId,reporting.entityId,reporting.periodId,groupRef,receiptHash,snapshotHash]);
  for(const value of [
    [reporting.entityId,reporting.periodId,'REPORTING-ENTITY'],[member.entityId,member.periodId,'AFFILIATE-ENTITY']
  ])await adminPool.query(`INSERT INTO consolidation_member(consolidation_snapshot_id,tenant_id,reporting_entity_id,reporting_period_id,member_entity_id,member_period_id,member_ref,member_source_ref,member_source_version,member_receipt_hash,member_snapshot_hash)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,'1',$9,$10)`,[snapshotId,reporting.tenantId,reporting.entityId,reporting.periodId,value[0],value[1],value[2],`member-source:${value[2]}`,hash(`member-receipt:${value[2]}`),hash(`member-snapshot:${value[2]}`)]);
  await adminPool.query(`INSERT INTO consolidation_account_map(consolidation_snapshot_id,member_entity_id,source_account_code,presentation_account_code,presentation_side,mapping_hash)
    VALUES($1,$2,'291001','IC-100','CREDIT',$3),($1,$4,'120200','IC-100','CREDIT',$5)`,[snapshotId,reporting.entityId,hash('consolidation-map-reporting'),member.entityId,hash('consolidation-map-member')]);
  await adminPool.query("INSERT INTO runtime_actor_grant(tenant_id,actor_id,entity_id,permission) VALUES($1,$2,$3,'GL.REPORT.VIEW')",[reporting.tenantId,actor,reporting.entityId]);
  const reader=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(reporting,actor,['GL.REPORT.VIEW'])});
  let rows=await reader.getConsolidation({tenantId:reporting.tenantId,entityId:reporting.entityId,periodId:reporting.periodId,groupRef});
  assert.deepEqual({status:rows[0].report_status,actual:rows[0].member_actual_amount,elimination:rows[0].elimination_amount},{status:'BLOCKED_MEMBER_SCOPE_REQUIRED',actual:null,elimination:null});
  await adminPool.query("INSERT INTO runtime_actor_grant(tenant_id,actor_id,entity_id,permission) VALUES($1,$2,$3,'GL.REPORT.VIEW')",[reporting.tenantId,actor,member.entityId]);
  rows=await reader.getConsolidation({tenantId:reporting.tenantId,entityId:reporting.entityId,periodId:reporting.periodId,groupRef});
  assert.deepEqual({status:rows[0].report_status,actual:rows[0].member_actual_amount,elimination:rows[0].elimination_amount},{status:'BLOCKED_ELIMINATION_EVIDENCE_REQUIRED',actual:null,elimination:null});
  await adminPool.query(`INSERT INTO consolidation_elimination_evidence(consolidation_snapshot_id,presentation_account_code,presentation_side,elimination_ref,elimination_amount,evidence_hash,receipt_hash)
    VALUES($1,'IC-100','CREDIT','approved-elimination-2026-07',0,$2,$3)`,[snapshotId,hash('consolidation-elimination-evidence'),hash('consolidation-elimination-receipt')]);
  rows=await reader.getConsolidation({tenantId:reporting.tenantId,entityId:reporting.entityId,periodId:reporting.periodId,groupRef});
  assert.deepEqual({status:rows[0].report_status,members:rows[0].member_count,evidenceMembers:rows[0].evidence_member_count,actual:rows[0].member_actual_amount,elimination:rows[0].elimination_amount,consolidated:rows[0].consolidated_amount,snapshot:rows[0].consolidation_snapshot_id,hash:rows[0].consolidation_snapshot_hash},{status:'APPROVED_CONSOLIDATION_SNAPSHOT_AND_POSTED_LEDGER_EXACT',members:2,evidenceMembers:2,actual:'0.0000',elimination:'0.0000',consolidated:'0.0000',snapshot:snapshotId,hash:snapshotHash});
  assert.deepEqual(rows[0].source_document_ids.sort(),[reportingTrace.documentId,memberTrace.documentId].sort());assert.deepEqual(rows[0].elimination_refs,['approved-elimination-2026-07']);
  const api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId:reporting.tenantId,actorId:actor}),kernelFactory:async()=>reader});
  const response=await api({method:'GET',url:`/api/v1/entities/${reporting.entityId}/reports/consolidation?periodId=${reporting.periodId}&groupRef=${groupRef}`,body:null,headers:{}});assert.equal(response.status,200);assert.equal(response.headers['cache-control'],'no-store');assert.equal(response.body.data[0].report_status,'APPROVED_CONSOLIDATION_SNAPSHOT_AND_POSTED_LEDGER_EXACT');
  assert.equal((await adminPool.query("SELECT count(*)::int n FROM journal_entry WHERE tenant_id=$1 AND journal_type='ELIMINATION'",[reporting.tenantId])).rows[0].n,0);
});

pgTest('controlled test unsigned WBS Bank rows create isolated source evidence and one ordinary DRAFT reconciliation',async()=>{
  const ids=await seed({status:'DRAFT',attachmentStatus:'VERIFIED_CLEAN',extraAccounts:[{accountCode:'610000',accountName:'Controlled test Bank offset expense'}]});
  const observation={schema_version:'WBS_LIVE_PILOT_OBSERVATION_V1',status:'NOT_ADMITTED',observation_mode:'UNSIGNED_PILOT',source_system:'WBS',tool:'list_bank_transactions',environment:'PRODUCTION',entity_id:ids.entityId,captured_at:'2026-08-18T00:00:00.000Z',provider_content_sha256:'b'.repeat(64),scope:{company_codes:['WBPA'],date_range:['2026-01-01','2026-12-31']},record_count:2,rows:[
    {source_record_hash:`sha256:${'a'.repeat(64)}`,currency:'USD',accounting_date:'2026-07-11',amount:'50.0000',direction:'DEBIT',status:'POSTED'},
    {source_record_hash:`sha256:${'c'.repeat(64)}`,currency:'USD',accounting_date:'2026-07-12',amount:'30.0000',direction:'DEBIT',status:'POSTED'}
  ],signature_verified:false,can_import:false,can_create_transaction:false,can_match:false,can_allocate:false,can_create_draft:false,can_approve:false,can_post:false,can_reverse:false,observation_hash:`sha256:${'d'.repeat(64)}`};
  const importer=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'controlled-bank-importer',['WBS.TEST.IMPORT','BANK.RECONCILIATION.START'])});
  const before=(await adminPool.query('SELECT count(*)::int journals FROM journal_entry WHERE tenant_id=$1 AND entity_id=$2',[ids.tenantId,ids.entityId])).rows[0];
  const args={...ids,companyCode:'WBPA',observation,bankAccountRef:'WBS_TEST_BANK',idempotencyKey:'controlled-test-bank-pg-001'};
  const created=await importer.createWbsControlledTestBankScope(args);assert.equal(created.status,'DRAFT');assert.equal(created.test_only,true);assert.equal(created.provenance_mode,'CONTROLLED_TEST_UNSIGNED');assert.equal(created.transaction_count,2);assert.equal(created.bank_account_ref,'WBS_TEST_BANK');assert.equal(created.idempotent,false);
  const replay=await importer.createWbsControlledTestBankScope(args);assert.equal(replay.idempotent,true);assert.deepEqual(replay.bank_source_ids,created.bank_source_ids);
  const retained=(await adminPool.query(`SELECT i.test_only,i.provenance_mode,i.row_count,r.status,r.difference,count(ir.*)::int retained_rows
    FROM wbs_controlled_test_bank_import i JOIN reconciliation r ON r.tenant_id=i.tenant_id AND r.entity_id=i.entity_id AND r.reconciliation_id=i.reconciliation_id
    JOIN wbs_controlled_test_bank_import_row ir ON ir.tenant_id=i.tenant_id AND ir.entity_id=i.entity_id AND ir.wbs_controlled_test_bank_import_id=i.wbs_controlled_test_bank_import_id
    WHERE i.tenant_id=$1 AND i.entity_id=$2 GROUP BY i.test_only,i.provenance_mode,i.row_count,r.status,r.difference`,[ids.tenantId,ids.entityId])).rows[0];
  assert.deepEqual(retained,{test_only:true,provenance_mode:'CONTROLLED_TEST_UNSIGNED',row_count:2,status:'DRAFT',difference:'80.0000',retained_rows:2});
  const sources=(await adminPool.query(`SELECT d.document_type,d.status,d.source_ref,dl.external_dimension_refs,bs.bank_account_ref,bs.amount::text
    FROM wbs_controlled_test_bank_import_row ir JOIN source_document d ON d.tenant_id=ir.tenant_id AND d.entity_id=ir.entity_id AND d.source_document_id=ir.source_document_id
    JOIN source_document_line dl ON dl.tenant_id=ir.tenant_id AND dl.entity_id=ir.entity_id AND dl.source_document_line_id=ir.source_document_line_id
    JOIN bank_source bs ON bs.tenant_id=ir.tenant_id AND bs.entity_id=ir.entity_id AND bs.bank_source_id=ir.bank_source_id
    WHERE ir.tenant_id=$1 AND ir.entity_id=$2 ORDER BY ir.row_index`,[ids.tenantId,ids.entityId])).rows;
  assert.deepEqual(sources.map(row=>[row.document_type,row.status,row.bank_account_ref,row.amount,row.external_dimension_refs.test_only,row.external_dimension_refs.provenance_mode]),[
    ['WBS_TEST_BANK_TRANSACTION','RECEIVED','WBS_TEST_BANK','50.0000',true,'CONTROLLED_TEST_UNSIGNED'],
    ['WBS_TEST_BANK_TRANSACTION','RECEIVED','WBS_TEST_BANK','30.0000',true,'CONTROLLED_TEST_UNSIGNED']
  ]);assert.ok(sources.every(row=>row.source_ref.startsWith('object://refs-test-only/')));
  const reader=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'controlled-bank-reader',['BANK.VIEW'])});
  const transactions=await reader.listBankTransactions({tenantId:ids.tenantId,entityId:ids.entityId,bankAccountRef:'WBS_TEST_BANK',fromDate:'2026-07-01',throughDate:'2026-07-31',limit:10});assert.equal(transactions.length,2);
  assert.deepEqual(transactions.map(row=>row.transaction_date),['2026-07-12','2026-07-11']);assert.ok(transactions.every(row=>typeof row.transaction_date==='string'));
  const scopes=await reader.listReconciliationScopes({tenantId:ids.tenantId,entityId:ids.entityId,limit:10});assert.equal(scopes.length,1);assert.equal(scopes[0].reconciliation_id,created.reconciliation_id);assert.equal(scopes[0].status,'DRAFT');
  const summary=await reader.getReconciliationSummary({tenantId:ids.tenantId,entityId:ids.entityId,bankAccountRef:'WBS_TEST_BANK',statementEndingDate:'2026-07-31'});
  assert.equal(summary.length,1);assert.equal(summary[0].statement_ending_date,'2026-07-31');assert.equal(typeof summary[0].statement_ending_date,'string');
  const worksheet=await reader.listReconciliationWorksheet({tenantId:ids.tenantId,entityId:ids.entityId,reconciliationId:created.reconciliation_id});
  assert.equal(worksheet.length,2);assert.deepEqual(worksheet.map(row=>row.transaction_date),['2026-07-11','2026-07-12']);assert.ok(worksheet.every(row=>typeof row.transaction_date==='string'));
  const oneItem=await reader.getReconciliationWorksheetItem({tenantId:ids.tenantId,entityId:ids.entityId,reconciliationId:created.reconciliation_id,bankSourceId:created.bank_source_ids[1]});
  assert.equal(oneItem.bank_source_id,created.bank_source_ids[1]);assert.equal(oneItem.transaction_date,'2026-07-12');
  assert.deepEqual((await adminPool.query('SELECT count(*)::int journals FROM journal_entry WHERE tenant_id=$1 AND entity_id=$2',[ids.tenantId,ids.entityId])).rows[0],before);
  assert.equal((await adminPool.query('SELECT count(*)::int n FROM wbs_bank_statement_receipt WHERE tenant_id=$1 AND entity_id=$2',[ids.tenantId,ids.entityId])).rows[0].n,0);
  const denied=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'controlled-bank-denied',['WBS.TEST.IMPORT'])});
  await assert.rejects(denied.createWbsControlledTestBankScope({...args,idempotencyKey:'controlled-test-bank-pg-denied'}),error=>error.code==='42501');
  const counts=await adminPool.query('SELECT (SELECT count(*) FROM wbs_controlled_test_bank_import WHERE tenant_id=$1 AND entity_id=$2)::int imports,(SELECT count(*) FROM bank_source WHERE tenant_id=$1 AND entity_id=$2)::int sources',[ids.tenantId,ids.entityId]);assert.deepEqual(counts.rows[0],{imports:1,sources:2});

  const actors={importer:'controlled-bank-runner-importer',maker:'controlled-bank-runner-maker',submitter:'controlled-bank-runner-submitter',reviewer:'controlled-bank-runner-reviewer',approver:'controlled-bank-runner-approver',poster:'controlled-bank-runner-poster'};
  const permissions={
    importer:['BANK.VIEW','BANK.MATCH.CREATE'],maker:['BANK.RECONCILIATION.ADJUSTMENT_DRAFT','GL.JE.CREATE'],submitter:['GL.JE.SUBMIT'],
    reviewer:['GL.JE.REVIEW','BANK.RECONCILIATION.REVIEW'],approver:['GL.JE.APPROVE','BANK.RECONCILIATION.SIGN_OFF'],poster:['GL.JE.POST','BANK.RECONCILIATION.CLEAR','BANK.RECONCILIATION.REOPEN']
  };
  const service=createControlledTestBankWorkflowService({scope:{tenantId:ids.tenantId,entityId:ids.entityId,companyCode:'WBPA',bankAccountRef:'WBS_TEST_BANK',cashAccountCode:'111000',offsetAccountCode:'610000',actors},authorize:async()=>{},kernelForActor:actorId=>{
    const role=Object.entries(actors).find(([,value])=>value===actorId)?.[0];return new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,actorId,permissions[role])});
  }});
  const completed=await service.run({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId,reconciliationId:created.reconciliation_id,reason:'Run isolated WBS Bank lifecycle through signed snapshot and reopen',idempotencyKey:'controlled-bank-runner-pg-001'});
  assert.deepEqual({status:completed.status,test_only:completed.test_only,provenance_mode:completed.provenance_mode,processed:completed.processed_count,matched:completed.matched_count,adjusted:completed.adjusted_count,cleared:completed.cleared_count,revision:completed.revision},
    {status:'CONTROLLED_TEST_BANK_WORKFLOW_REOPENED',test_only:true,provenance_mode:'CONTROLLED_TEST_UNSIGNED',processed:2,matched:0,adjusted:2,cleared:2,revision:7});
  assert.equal(completed.journal_entry_ids.length,2);assert.ok(completed.snapshot_id);assert.match(completed.snapshot_hash,/^sha256:[0-9a-f]{64}$/);
  const completedReplay=await service.run({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId,reconciliationId:created.reconciliation_id,reason:'Run isolated WBS Bank lifecycle through signed snapshot and reopen',idempotencyKey:'controlled-bank-runner-pg-001'});
  assert.equal(completedReplay.idempotent,true);assert.equal(completedReplay.revision,7);assert.deepEqual(completedReplay.journal_entry_ids.sort(),completed.journal_entry_ids.sort());
  const proof=(await adminPool.query(`SELECT r.status,r.version,r.difference::text,count(DISTINCT ri.reconciliation_item_id) FILTER(WHERE ri.state='CLEARED')::int cleared,
    count(DISTINCT rad.journal_entry_id)::int adjustments,count(DISTINCT ll.journal_entry_id)::int posted_ledgers,count(DISTINCT rs.reconciliation_snapshot_id)::int snapshots
    FROM reconciliation r JOIN reconciliation_item ri ON ri.tenant_id=r.tenant_id AND ri.entity_id=r.entity_id AND ri.reconciliation_id=r.reconciliation_id
    LEFT JOIN reconciliation_adjustment_draft rad ON rad.tenant_id=ri.tenant_id AND rad.entity_id=ri.entity_id AND rad.reconciliation_id=ri.reconciliation_id AND rad.bank_source_id=ri.bank_source_id
    LEFT JOIN ledger_line ll ON ll.tenant_id=rad.tenant_id AND ll.entity_id=rad.entity_id AND ll.journal_entry_id=rad.journal_entry_id
    LEFT JOIN reconciliation_snapshot rs ON rs.tenant_id=r.tenant_id AND rs.entity_id=r.entity_id AND rs.reconciliation_id=r.reconciliation_id
    WHERE r.tenant_id=$1 AND r.entity_id=$2 AND r.reconciliation_id=$3 GROUP BY r.status,r.version,r.difference`,[ids.tenantId,ids.entityId,created.reconciliation_id])).rows[0];
  assert.deepEqual(proof,{status:'REOPENED',version:'7',difference:'0.0000',cleared:2,adjustments:2,posted_ledgers:2,snapshots:1});
  // 181 owns the Bank cap and item reader assertions below.  Roll back the
  // later AI audit actor/source module/read, stage batch, Bank identity and Payable migrations
  // first, then 181.
  // This fixture deliberately exercises an older migration's rollback after
  // retaining a completed 185 stage.  Remove only its synthetic stage facts;
  // production down remains fail-closed while any checkpoint is retained.
  await adminPool.query('TRUNCATE wbs_test_bank_import_stage_final,wbs_test_bank_import_stage_row,wbs_test_bank_import_stage_chunk,wbs_test_bank_import_stage');
  // Roll back by immutable migration identity.  Other feature migrations may
  // be inserted between 193 and the latest schema without changing this
  // historical contract test.
  await migrateDownThrough(adminPool,'181_wbs_test_large_bank_batch.sql');
  const rolledBack=(await adminPool.query(`SELECT
    to_regprocedure('refs_get_reconciliation_worksheet_item(uuid,uuid,uuid,uuid)') IS NULL item_reader_removed,
    to_regprocedure('refs_list_reconciliation_adjustment_evidence(uuid,uuid,integer)') IS NOT NULL evidence_retained,
    pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conname='wbs_controlled_test_bank_import_row_count_check')) LIKE '%500%' import_cap_restored,
    pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conname='wbs_controlled_test_bank_import_row_row_index_check')) LIKE '%499%' row_cap_restored,
    pg_get_functiondef('refs_create_wbs_controlled_test_bank_scope(uuid,uuid,uuid,text,jsonb,text,text,text)'::regprocedure) LIKE '%NOT BETWEEN 1 AND 500%' function_cap_restored,
    pg_get_functiondef('refs_guard_reconciliation_adjustment_lifecycle()'::regprocedure) LIKE '%adjustment.bank_delta<>(SELECT source.amount%' item_guard_retained`)).rows[0];
  assert.deepEqual(rolledBack,{item_reader_removed:true,evidence_retained:true,import_cap_restored:true,row_cap_restored:true,function_cap_restored:true,item_guard_retained:true});
  await migrateUp(adminPool);
  const restored=(await adminPool.query(`SELECT
    to_regprocedure('refs_get_reconciliation_worksheet_item(uuid,uuid,uuid,uuid)') IS NOT NULL item_reader_restored,
    to_regprocedure('refs_list_reconciliation_adjustment_evidence(uuid,uuid,integer)') IS NOT NULL evidence_retained,
    pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conname='wbs_controlled_test_bank_import_row_count_check')) LIKE '%10000%' import_cap_restored,
    pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conname='wbs_controlled_test_bank_import_row_row_index_check')) LIKE '%9999%' row_cap_restored,
    pg_get_functiondef('refs_create_wbs_controlled_test_bank_scope(uuid,uuid,uuid,text,jsonb,text,text,text)'::regprocedure) LIKE '%NOT BETWEEN 1 AND 10000%' function_cap_restored,
    pg_get_functiondef('refs_guard_reconciliation_adjustment_lifecycle()'::regprocedure) LIKE '%adjustment.bank_delta<>(SELECT source.amount%' item_guard_retained`)).rows[0];
  assert.deepEqual(restored,{item_reader_restored:true,evidence_retained:true,import_cap_restored:true,row_cap_restored:true,function_cap_restored:true,item_guard_retained:true});
});

pgTest('WBS TEST Bank resumes 100 Draft journals after low-timeout submit and post-clear boundaries',async()=>{
  const ids=await seed({status:'DRAFT',attachmentStatus:'VERIFIED_CLEAN',extraAccounts:[{accountCode:'610000',accountName:'Controlled test Bank offset expense'}]}),reason='UNSIGNED TEST ONLY — exercise bounded post-clear timeout recovery';
  const rows=Array.from({length:100},(_,index)=>({source_record_hash:hash(`wbs-bank-post-clear-100-${index}`),currency:'USD',accounting_date:`2026-07-${String(index%28+1).padStart(2,'0')}`,amount:'1.0000',direction:'DEBIT',status:'POSTED'}));
  const observation={schema_version:'WBS_LIVE_PILOT_OBSERVATION_V1',status:'NOT_ADMITTED',observation_mode:'UNSIGNED_PILOT',source_system:'WBS',tool:'list_bank_transactions',environment:'PRODUCTION',entity_id:ids.entityId,captured_at:'2026-08-19T00:00:00.000Z',provider_content_sha256:createHash('sha256').update('post-clear-100').digest('hex'),scope:{company_codes:['WBPA'],date_range:['2026-01-01','2026-12-31']},record_count:rows.length,rows,signature_verified:false,can_import:false,can_create_transaction:false,can_match:false,can_allocate:false,can_create_draft:false,can_approve:false,can_post:false,can_reverse:false,observation_hash:hash('post-clear-100-observation')};
  const actors={maker:'bank-post-clear-maker',submitter:'bank-post-clear-submitter',reviewer:'bank-post-clear-reviewer',approver:'bank-post-clear-approver',poster:'bank-post-clear-poster'},permissions={maker:['BANK.RECONCILIATION.ADJUSTMENT_DRAFT','GL.JE.CREATE'],submitter:['GL.JE.SUBMIT'],reviewer:['GL.JE.REVIEW'],approver:['GL.JE.APPROVE'],poster:['GL.JE.POST','BANK.RECONCILIATION.CLEAR']};
  const kernel=actor=>new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,actors[actor],permissions[actor])}),importer=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'bank-post-clear-importer',['WBS.TEST.IMPORT','BANK.RECONCILIATION.START'])});
  const created=await importer.createWbsControlledTestBankScope({...ids,companyCode:'WBPA',observation,bankAccountRef:'WBS_TEST_BANK',idempotencyKey:'bank-post-clear-import'}),bankSourceIds=created.bank_source_ids,idempotencyRoot='bank-post-clear-workflow';
  const evidence=await kernel('maker').listVerifiedCleanAttachmentIds({tenantId:ids.tenantId,entityId:ids.entityId,limit:1});
  const batch={tenantId:ids.tenantId,entityId:ids.entityId,reconciliationId:created.reconciliation_id,bankSourceIds,idempotencyRoot};
  await kernel('maker').draftWbsTestBankAdjustmentBatch({...batch,periodId:ids.periodId,attachmentIds:evidence,reason});
  const directLowSubmit=async()=>{const session=await sessionProvider(ids,actors.submitter,permissions.submitter)(),client=await runtimePool.connect();try{await client.query('BEGIN');await client.query('SET LOCAL ROLE refs_app');await client.query('SELECT refs_bootstrap_context($1)',[session.contextToken]);await client.query("SELECT set_config('statement_timeout','5ms',true)");await client.query('SELECT refs_wbs_test_bank_adjustment_submit_batch($1,$2,$3,$4::uuid[],$5)',[ids.tenantId,ids.entityId,created.reconciliation_id,bankSourceIds,idempotencyRoot]);await client.query('COMMIT');}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}};
  await assert.rejects(directLowSubmit(),error=>error.code==='57014');
  const draftState=(await adminPool.query(`SELECT count(*) FILTER(WHERE j.status='DRAFT' AND j.revision=0)::int draft_revision_zero,count(*) FILTER(WHERE j.status<>'DRAFT')::int advanced
    FROM reconciliation_adjustment_draft d JOIN journal_entry j ON j.tenant_id=d.tenant_id AND j.entity_id=d.entity_id AND j.journal_entry_id=d.journal_entry_id
    WHERE d.tenant_id=$1 AND d.entity_id=$2 AND d.reconciliation_id=$3`,[ids.tenantId,ids.entityId,created.reconciliation_id])).rows[0];
  assert.deepEqual(draftState,{draft_revision_zero:100,advanced:0});
  await kernel('submitter').submitWbsTestBankAdjustmentBatch(batch);await kernel('reviewer').reviewWbsTestBankAdjustmentBatch(batch);await kernel('approver').approveWbsTestBankAdjustmentBatch(batch);
  const directLowTimeout=async()=>{const session=await sessionProvider(ids,actors.poster,permissions.poster)(),client=await runtimePool.connect();try{await client.query('BEGIN');await client.query('SET LOCAL ROLE refs_app');await client.query('SELECT refs_bootstrap_context($1)',[session.contextToken]);await client.query("SELECT set_config('statement_timeout','5ms',true)");await client.query('SELECT refs_wbs_test_bank_adjustment_post_clear_batch($1,$2,$3,$4,$5::uuid[],$6,$7)',[ids.tenantId,ids.entityId,created.reconciliation_id,ids.periodId,bankSourceIds,reason,idempotencyRoot]);await client.query('COMMIT');}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}};
  await assert.rejects(directLowTimeout(),error=>error.code==='57014');
  const state=async()=>(await adminPool.query(`SELECT count(*) FILTER(WHERE j.status='APPROVED')::int approved,count(*) FILTER(WHERE j.status='POSTED')::int posted,count(*) FILTER(WHERE ri.state='CLEARED')::int cleared
    FROM reconciliation_adjustment_draft d JOIN journal_entry j ON j.tenant_id=d.tenant_id AND j.entity_id=d.entity_id AND j.journal_entry_id=d.journal_entry_id
    LEFT JOIN reconciliation_item ri ON ri.tenant_id=d.tenant_id AND ri.entity_id=d.entity_id AND ri.reconciliation_id=d.reconciliation_id AND ri.bank_source_id=d.bank_source_id
    WHERE d.tenant_id=$1 AND d.entity_id=$2 AND d.reconciliation_id=$3`,[ids.tenantId,ids.entityId,created.reconciliation_id])).rows[0];
  assert.deepEqual(await state(),{approved:100,posted:0,cleared:0});
  const poster=kernel('poster'),completed=await poster.postClearWbsTestBankAdjustmentBatch({...batch,periodId:ids.periodId,reason}),replay=await poster.postClearWbsTestBankAdjustmentBatch({...batch,periodId:ids.periodId,reason});
  assert.equal(completed.posted_count,100);assert.equal(completed.cleared_count,100);assert.equal(replay.posted_count,0);assert.equal(replay.cleared_count,0);
  assert.deepEqual(await state(),{approved:0,posted:100,cleared:100});assert.equal((await runtimePool.query('SHOW statement_timeout')).rows[0].statement_timeout,'10s');
});

pgTest('WBS TEST Bank monthly identity admits legacy July hashes, isolates months, and rejects changed same-month payloads',async()=>{
  const ids=await seed({status:'DRAFT',attachmentStatus:null}),actor='controlled-bank-monthly-identity';
  const importer=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,actor,['WBS.TEST.IMPORT','BANK.RECONCILIATION.START'])});
  const periods=await importer.ensureWbsTestH12026Periods(ids),periodByCode=new Map(periods.periods.map(period=>[period.period_code,period.period_id]));
  const sourceHash=hash('legacy-july-bank-row-reused-in-h1'),legacyBatch=randomUUID(),legacyRaw=randomUUID();
  await adminPool.query("INSERT INTO import_batch(import_batch_id,tenant_id,entity_id,connector_code,source_module,source_entity_id,idempotency_key,request_hash,status,row_count,started_at,completed_at) VALUES($1,$2,$3,'WBS_TEST','bankFeed',$4,'legacy-july-bank-batch',$5,'SUCCEEDED',1,now(),now())",[legacyBatch,ids.tenantId,ids.entityId,ids.sourceEntityId,hash('legacy-july-bank-batch')]);
  await adminPool.query(`INSERT INTO raw_event(raw_event_id,tenant_id,entity_id,import_batch_id,source_system,source_module,source_entity_id,source_record_id,source_version,event_type,occurred_at,payload_hash,payload_ref,correlation_id)
    VALUES($1,$2,$3,$4,'WBS','bankFeed',$5,$6,'test:legacy-july','UPSERT','2026-07-11',$7,$8,'legacy-july-bank-row')`,[legacyRaw,ids.tenantId,ids.entityId,legacyBatch,ids.sourceEntityId,`test-bank:${sourceHash.slice(7,31)}`,sourceHash,`object://refs-test-only/${ids.entityId}/bank/${sourceHash.slice(7)}`]);
  const makeObservation=({month,date,amount='10.0000',identity})=>({schema_version:'WBS_LIVE_PILOT_OBSERVATION_V1',status:'NOT_ADMITTED',observation_mode:'UNSIGNED_PILOT',source_system:'WBS',tool:'list_bank_transactions',environment:'PRODUCTION',entity_id:ids.entityId,captured_at:'2026-08-19T00:00:00.000Z',provider_content_sha256:createHash('sha256').update(identity).digest('hex'),scope:{company_codes:['WBPA'],date_range:[`2026-${month}-01`,new Date(Date.UTC(2026,Number(month),0)).toISOString().slice(0,10)]},record_count:1,rows:[{source_record_hash:sourceHash,currency:'USD',accounting_date:date,amount,direction:'DEBIT',status:'POSTED'}],signature_verified:false,can_import:false,can_create_transaction:false,can_match:false,can_allocate:false,can_create_draft:false,can_approve:false,can_post:false,can_reverse:false,observation_hash:hash(identity)});
  const january=makeObservation({month:'01',date:'2026-01-11',identity:'bank-monthly-jan-v1'}),february=makeObservation({month:'02',date:'2026-02-11',identity:'bank-monthly-feb-v1'});
  const januaryResult=await importer.createWbsControlledTestBankScope({...ids,periodId:periodByCode.get('2026-01'),companyCode:'WBPA',observation:january,bankAccountRef:'WBS_TEST_BANK_2026_01',idempotencyKey:'bank-monthly-identity-jan'});
  const februaryResult=await importer.createWbsControlledTestBankScope({...ids,periodId:periodByCode.get('2026-02'),companyCode:'WBPA',observation:february,bankAccountRef:'WBS_TEST_BANK_2026_02',idempotencyKey:'bank-monthly-identity-feb'});
  assert.equal(januaryResult.transaction_count,1);assert.equal(februaryResult.transaction_count,1);for(const result of [januaryResult,februaryResult])assert.deepEqual(Object.fromEntries(['can_import','can_match','can_create_draft','can_post'].map(key=>[key,result[key]])),{can_import:false,can_match:false,can_create_draft:false,can_post:false});
  const retained=(await adminPool.query(`SELECT ir.bank_account_ref,ir.source_record_hash,re.source_record_id,re.payload_hash,re.payload_ref,d.source_ref
    FROM wbs_controlled_test_bank_import_row ir JOIN raw_event re ON re.tenant_id=ir.tenant_id AND re.raw_event_id=ir.raw_event_id
    JOIN source_document d ON d.tenant_id=ir.tenant_id AND d.entity_id=ir.entity_id AND d.source_document_id=ir.source_document_id
    WHERE ir.tenant_id=$1 AND ir.entity_id=$2 ORDER BY ir.bank_account_ref`,[ids.tenantId,ids.entityId])).rows;
  assert.deepEqual(retained.map(row=>row.bank_account_ref),['WBS_TEST_BANK_2026_01','WBS_TEST_BANK_2026_02']);
  for(const row of retained){assert.equal(row.source_record_hash,sourceHash);assert.equal(row.payload_hash,sourceHash);assert.equal(row.source_record_id,`test-bank:${row.bank_account_ref.toLowerCase()}:${sourceHash.slice(7,31)}`);assert.ok(row.payload_ref.includes(`/bank/${row.bank_account_ref.toLowerCase()}/`));assert.equal(row.source_ref,row.payload_ref);}
  const before=(await adminPool.query("SELECT (SELECT count(*)::int FROM import_batch WHERE tenant_id=$1) batches,(SELECT count(*)::int FROM raw_event WHERE tenant_id=$1) raw,(SELECT count(*)::int FROM wbs_controlled_test_bank_import WHERE tenant_id=$1) imports,(SELECT count(*)::int FROM bank_source WHERE tenant_id=$1) bank,(SELECT count(*)::int FROM wbs_test_bank_import_stage WHERE tenant_id=$1) stages",[ids.tenantId])).rows[0];
  const changed={...january,provider_content_sha256:createHash('sha256').update('bank-monthly-jan-changed').digest('hex'),rows:[{...january.rows[0],amount:'11.0000'}],observation_hash:hash('bank-monthly-jan-changed')};
  await assert.rejects(importer.createWbsControlledTestBankScope({...ids,periodId:periodByCode.get('2026-01'),companyCode:'WBPA',observation:changed,bankAccountRef:'WBS_TEST_BANK_2026_01',idempotencyKey:'bank-monthly-identity-jan-changed'}),error=>error.code==='23505');
  assert.deepEqual((await adminPool.query("SELECT (SELECT count(*)::int FROM import_batch WHERE tenant_id=$1) batches,(SELECT count(*)::int FROM raw_event WHERE tenant_id=$1) raw,(SELECT count(*)::int FROM wbs_controlled_test_bank_import WHERE tenant_id=$1) imports,(SELECT count(*)::int FROM bank_source WHERE tenant_id=$1) bank,(SELECT count(*)::int FROM wbs_test_bank_import_stage WHERE tenant_id=$1) stages",[ids.tenantId])).rows[0],before);
  // Clear this test's synthetic checkpoints.  250 has already been proven to
  // reject their disposal before this explicit fixture cleanup; 185 must now
  // roll back normally rather than be used as a second, false guard.
  await adminPool.query('TRUNCATE wbs_test_bank_import_stage_final,wbs_test_bank_import_stage_row,wbs_test_bank_import_stage_chunk,wbs_test_bank_import_stage');
  await migrateDownThrough(adminPool,'185_wbs_test_bank_staged_import.sql');
  await migrateUp(adminPool);
  assert.match((await adminPool.query("SELECT pg_get_functiondef('refs_create_wbs_controlled_test_bank_scope(uuid,uuid,uuid,text,jsonb,text,text,text)'::regprocedure) definition")).rows[0].definition,/lower\(p_bank_account_ref\)/);
});

pgTest('WBS Bank range batch admits sanitized cursor rows under the ten-thousand monthly bound and rejects 10001 before writes',async()=>{
  const ids=await seed({status:'DRAFT',attachmentStatus:null}),actor='controlled-bank-range-importer';
  const importer=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,actor,['WBS.TEST.IMPORT','BANK.RECONCILIATION.START'])});
  const rows=Array.from({length:11},(_,index)=>({source_record_hash:hash(`wbs-bank-range-${index}`),currency:'USD',accounting_date:`2026-07-${String(index+1).padStart(2,'0')}`,amount:'1.0000',direction:'DEBIT',status:'POSTED'}));
  const observation={schema_version:'WBS_LIVE_PILOT_OBSERVATION_V1',status:'NOT_ADMITTED',observation_mode:'UNSIGNED_PILOT',source_system:'WBS',tool:'list_bank_transactions',environment:'PRODUCTION',entity_id:ids.entityId,captured_at:'2026-08-19T00:00:00.000Z',provider_content_sha256:'e'.repeat(64),scope:{company_codes:['WBPA'],date_range:['2026-01-01','2026-12-31']},record_count:rows.length,rows,signature_verified:false,can_import:false,can_create_transaction:false,can_match:false,can_allocate:false,can_create_draft:false,can_approve:false,can_post:false,can_reverse:false,observation_hash:hash('wbs-bank-range-observation')};
  const created=await importer.createWbsControlledTestBankScope({...ids,companyCode:'WBPA',observation,bankAccountRef:'WBS_TEST_BANK',idempotencyKey:'controlled-test-bank-range-001'});
  assert.equal(created.transaction_count,11);assert.equal(created.bank_source_ids.length,11);assert.equal(created.status,'DRAFT');assert.equal(created.test_only,true);
  const persisted=(await adminPool.query(`SELECT i.row_count,count(r.*)::int retained_rows,count(DISTINCT i.reconciliation_id)::int reconciliations
    FROM wbs_controlled_test_bank_import i JOIN wbs_controlled_test_bank_import_row r USING(tenant_id,entity_id,wbs_controlled_test_bank_import_id)
    WHERE i.tenant_id=$1 AND i.entity_id=$2 GROUP BY i.row_count`,[ids.tenantId,ids.entityId])).rows[0];assert.deepEqual(persisted,{row_count:11,retained_rows:11,reconciliations:1});
  const before=(await adminPool.query('SELECT count(*)::int imports FROM wbs_controlled_test_bank_import WHERE tenant_id=$1 AND entity_id=$2',[ids.tenantId,ids.entityId])).rows[0];
  const installed=(await adminPool.query(`SELECT
    pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conname='wbs_controlled_test_bank_import_row_count_check')) LIKE '%10000%' import_cap,
    pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conname='wbs_controlled_test_bank_import_row_row_index_check')) LIKE '%9999%' row_cap,
    pg_get_functiondef('refs_create_wbs_controlled_test_bank_scope(uuid,uuid,uuid,text,jsonb,text,text,text)'::regprocedure) LIKE '%NOT BETWEEN 1 AND 10000%' function_cap,
    to_regprocedure('refs_get_reconciliation_worksheet_item(uuid,uuid,uuid,uuid)') IS NOT NULL item_reader`)).rows[0];
  assert.deepEqual(installed,{import_cap:true,row_cap:true,function_cap:true,item_reader:true});
  const tooMany=Array.from({length:10001},(_,index)=>({...rows[0],source_record_hash:hash(`wbs-bank-overflow-${index}`)})),overflow={...observation,record_count:10001,rows:tooMany,observation_hash:hash('wbs-bank-overflow-observation')};
  await assert.rejects(importer.createWbsControlledTestBankScope({...ids,companyCode:'WBPA',observation:overflow,bankAccountRef:'WBS_TEST_BANK',idempotencyKey:'controlled-test-bank-range-overflow'}),error=>error.code==='22023');
  assert.deepEqual((await adminPool.query('SELECT count(*)::int imports FROM wbs_controlled_test_bank_import WHERE tenant_id=$1 AND entity_id=$2',[ids.tenantId,ids.entityId])).rows[0],before);
});

pgTest('WBS TEST Bank stages and set-publishes 1888 January rows with one reconciliation and exact replay',async()=>{
  const ids=await seed({status:'DRAFT',attachmentStatus:null}),actor='controlled-bank-january-1888';
  const importer=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,actor,['WBS.TEST.IMPORT','BANK.RECONCILIATION.START'])});
  const periods=await importer.ensureWbsTestH12026Periods(ids),periodId=periods.periods.find(row=>row.period_code==='2026-01').period_id;
  const rows=Array.from({length:1888},(_,index)=>({source_record_hash:hash(`wbs-live-january-bank-${index}`),currency:'USD',accounting_date:`2026-01-${String(index%28+1).padStart(2,'0')}`,amount:'1.0000',direction:index%2?'CREDIT':'DEBIT',status:'POSTED'}));
  const makeObservation=(items,identity)=>({schema_version:'WBS_LIVE_PILOT_OBSERVATION_V1',status:'NOT_ADMITTED',observation_mode:'UNSIGNED_PILOT',source_system:'WBS',tool:'list_bank_transactions',environment:'PRODUCTION',entity_id:ids.entityId,captured_at:'2026-08-19T00:00:00.000Z',provider_content_sha256:createHash('sha256').update(identity).digest('hex'),scope:{company_codes:['WBPA'],date_range:['2026-01-01','2026-01-31']},record_count:items.length,rows:items,signature_verified:false,can_import:false,can_create_transaction:false,can_match:false,can_allocate:false,can_create_draft:false,can_approve:false,can_post:false,can_reverse:false,observation_hash:hash(identity)});
  const counts=async()=>(await adminPool.query("SELECT (SELECT count(*)::int FROM import_batch WHERE tenant_id=$1) batches,(SELECT count(*)::int FROM raw_event WHERE tenant_id=$1) raw,(SELECT count(*)::int FROM source_document WHERE tenant_id=$1) documents,(SELECT count(*)::int FROM bank_source WHERE tenant_id=$1) bank,(SELECT count(*)::int FROM reconciliation WHERE tenant_id=$1) reconciliations,(SELECT count(*)::int FROM wbs_controlled_test_bank_import WHERE tenant_id=$1) imports,(SELECT count(*)::int FROM wbs_test_bank_import_stage WHERE tenant_id=$1) stages,(SELECT count(*)::int FROM wbs_test_bank_import_stage_chunk WHERE tenant_id=$1) chunks,(SELECT count(*)::int FROM wbs_test_bank_import_stage_row WHERE tenant_id=$1) staged_rows,(SELECT count(*)::int FROM wbs_test_bank_import_stage_final WHERE tenant_id=$1) finals",[ids.tenantId])).rows[0];
  const zero=await counts(),invalidRows=[...rows.slice(0,-1),{...rows.at(-1),amount:'0.0000'}];
  await assert.rejects(importer.createWbsControlledTestBankScope({...ids,periodId,companyCode:'WBPA',observation:makeObservation(invalidRows,'wbs-live-january-bank-invalid-last'),bankAccountRef:'WBS_TEST_BANK_2026_01',idempotencyKey:'wbs-live-january-bank-invalid-last'}),error=>error.code==='22023');
  assert.deepEqual(await counts(),zero);
  const args={...ids,periodId,companyCode:'WBPA',observation:makeObservation(rows,'wbs-live-january-bank-1888'),bankAccountRef:'WBS_TEST_BANK_2026_01',idempotencyKey:'wbs-live-january-bank-1888'};
  const created=await importer.createWbsControlledTestBankScope(args),replay=await importer.createWbsControlledTestBankScope(args);
  assert.equal(created.transaction_count,1888);assert.equal(created.bank_source_ids.length,1888);assert.equal(new Set(created.bank_source_ids).size,1888);assert.equal(created.idempotent,false);
  assert.equal(replay.idempotent,true);assert.equal(replay.reconciliation_id,created.reconciliation_id);assert.deepEqual(replay.bank_source_ids,created.bank_source_ids);
  assert.deepEqual(await counts(),{batches:1,raw:1888,documents:1888,bank:1888,reconciliations:1,imports:1,stages:1,chunks:19,staged_rows:1888,finals:1});
  assert.equal((await runtimePool.query('SHOW statement_timeout')).rows[0].statement_timeout,'10s');
});

pgTest('WBS TEST Bank retained checkpoint rejects changed chunk replay and resumes without partial core visibility',async()=>{
  const ids=await seed({status:'DRAFT',attachmentStatus:null}),actor='controlled-bank-checkpoint-resume',permissions=['WBS.TEST.IMPORT','BANK.RECONCILIATION.START'];
  const importer=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,actor,permissions)}),periods=await importer.ensureWbsTestH12026Periods(ids),periodId=periods.periods.find(row=>row.period_code==='2026-01').period_id;
  const rows=Array.from({length:201},(_,index)=>({source_record_hash:hash(`wbs-bank-checkpoint-${index}`),currency:'USD',accounting_date:`2026-01-${String(index%28+1).padStart(2,'0')}`,amount:'1.0000',direction:'DEBIT',status:'POSTED'})),observation={schema_version:'WBS_LIVE_PILOT_OBSERVATION_V1',status:'NOT_ADMITTED',observation_mode:'UNSIGNED_PILOT',source_system:'WBS',tool:'list_bank_transactions',environment:'PRODUCTION',entity_id:ids.entityId,captured_at:'2026-08-19T00:00:00.000Z',provider_content_sha256:createHash('sha256').update('checkpoint-provider').digest('hex'),scope:{company_codes:['WBPA'],date_range:['2026-01-01','2026-01-31']},record_count:rows.length,rows,signature_verified:false,can_import:false,can_create_transaction:false,can_match:false,can_allocate:false,can_create_draft:false,can_approve:false,can_post:false,can_reverse:false,observation_hash:hash('checkpoint-root')},idempotencyKey='wbs-bank-checkpoint-root';
  const stagedCall=async({changed=false}={})=>{const session=await sessionProvider(ids,actor,permissions)(),client=await runtimePool.connect();try{await client.query('BEGIN');await client.query('SET LOCAL ROLE refs_app');await client.query('SELECT refs_bootstrap_context($1)',[session.contextToken]);const requestHash=(await client.query('SELECT refs_create_wbs_controlled_test_bank_scope_hash($1,$2,$3,$4,$5::jsonb,$6) request_hash',[ids.tenantId,ids.entityId,periodId,'WBPA',JSON.stringify(observation),'WBS_TEST_BANK_2026_01'])).rows[0].request_hash,begin=(await client.query('SELECT refs_begin_wbs_test_bank_staged_import($1,$2,$3,$4,$5::jsonb,$6,$7,$8) result',[ids.tenantId,ids.entityId,periodId,'WBPA',JSON.stringify(observation),'WBS_TEST_BANK_2026_01',idempotencyKey,requestHash])).rows[0].result,chunk=rows.slice(0,100);if(changed)chunk[0]={...chunk[0],amount:'2.0000'};const result=(await client.query('SELECT refs_append_wbs_test_bank_staged_chunk($1,$2,$3,$4,$5::jsonb,$6) result',[ids.tenantId,ids.entityId,begin.stage_id,0,JSON.stringify(chunk),`${idempotencyKey}:chunk:0`])).rows[0].result;await client.query('COMMIT');return result;}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}};
  const appendRemainder=async stageId=>{const session=await sessionProvider(ids,actor,permissions)(),client=await runtimePool.connect();try{await client.query('BEGIN');await client.query('SET LOCAL ROLE refs_app');await client.query('SELECT refs_bootstrap_context($1)',[session.contextToken]);for(let chunkIndex=1;chunkIndex<3;chunkIndex++)await client.query('SELECT refs_append_wbs_test_bank_staged_chunk($1,$2,$3,$4,$5::jsonb,$6)',[ids.tenantId,ids.entityId,stageId,chunkIndex,JSON.stringify(rows.slice(chunkIndex*100,(chunkIndex+1)*100)),`${idempotencyKey}:chunk:${chunkIndex}`]);await client.query('COMMIT');return stageId;}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}};
  const finalizeCall=async(stageId,statementTimeout=null)=>{const session=await sessionProvider(ids,actor,permissions)(),client=await runtimePool.connect();try{await client.query('BEGIN');await client.query('SET LOCAL ROLE refs_app');await client.query('SELECT refs_bootstrap_context($1)',[session.contextToken]);if(statementTimeout)await client.query("SELECT set_config('statement_timeout',$1,true)",[statementTimeout]);const result=(await client.query('SELECT refs_finalize_wbs_test_bank_staged_import($1,$2,$3) result',[ids.tenantId,ids.entityId,stageId])).rows[0].result;await client.query('COMMIT');return result;}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}};
  const firstStage=await stagedCall();assert.equal(firstStage.idempotent,false);assert.deepEqual(Object.fromEntries(['can_import','can_match','can_create_draft','can_post'].map(key=>[key,firstStage[key]])),{can_import:false,can_match:false,can_create_draft:false,can_post:false});assert.equal((await stagedCall()).idempotent,true);await assert.rejects(stagedCall({changed:true}),error=>error.code==='23505');
  const partial=(await adminPool.query("SELECT (SELECT count(*)::int FROM wbs_test_bank_import_stage_row WHERE tenant_id=$1) staged,(SELECT count(*)::int FROM bank_source WHERE tenant_id=$1) bank,(SELECT count(*)::int FROM reconciliation WHERE tenant_id=$1) reconciliations,(SELECT count(*)::int FROM wbs_controlled_test_bank_import WHERE tenant_id=$1) imports",[ids.tenantId])).rows[0];assert.deepEqual(partial,{staged:100,bank:0,reconciliations:0,imports:0});
  const changedUnpersisted=[...rows.slice(100,200)];changedUnpersisted[0]={...changedUnpersisted[0],amount:'2.0000'};
  await assert.rejects((async()=>{const session=await sessionProvider(ids,actor,permissions)(),client=await runtimePool.connect();try{await client.query('BEGIN');await client.query('SET LOCAL ROLE refs_app');await client.query('SELECT refs_bootstrap_context($1)',[session.contextToken]);await client.query('SELECT refs_append_wbs_test_bank_staged_chunk($1,$2,$3,$4,$5::jsonb,$6)',[ids.tenantId,ids.entityId,firstStage.stage_id,1,JSON.stringify(changedUnpersisted),`${idempotencyKey}:chunk:1`]);await client.query('COMMIT');}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}})(),error=>error.code==='23505');
  assert.deepEqual((await adminPool.query("SELECT (SELECT count(*)::int FROM wbs_test_bank_import_stage_row WHERE tenant_id=$1) staged,(SELECT count(*)::int FROM bank_source WHERE tenant_id=$1) bank,(SELECT count(*)::int FROM reconciliation WHERE tenant_id=$1) reconciliations,(SELECT count(*)::int FROM wbs_controlled_test_bank_import WHERE tenant_id=$1) imports",[ids.tenantId])).rows[0],partial);
  const stageId=await appendRemainder(firstStage.stage_id);
  await adminPool.query("CREATE FUNCTION refs_test_delay_wbs_bank_finalize() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(0.05); RETURN NEW; END $$");
  await adminPool.query("CREATE TRIGGER refs_test_delay_wbs_bank_finalize BEFORE INSERT ON import_batch FOR EACH ROW WHEN (NEW.connector_code='WBS_TEST') EXECUTE FUNCTION refs_test_delay_wbs_bank_finalize()");
  await assert.rejects(finalizeCall(stageId,'5ms'),error=>error.code==='57014');
  assert.deepEqual((await adminPool.query("SELECT (SELECT count(*)::int FROM wbs_test_bank_import_stage_row WHERE tenant_id=$1) staged,(SELECT count(*)::int FROM bank_source WHERE tenant_id=$1) bank,(SELECT count(*)::int FROM reconciliation WHERE tenant_id=$1) reconciliations,(SELECT count(*)::int FROM wbs_controlled_test_bank_import WHERE tenant_id=$1) imports",[ids.tenantId])).rows[0],{staged:201,bank:0,reconciliations:0,imports:0});
  await adminPool.query("UPDATE accounting_period SET status='CLOSED' WHERE tenant_id=$1 AND entity_id=$2 AND period_id=$3",[ids.tenantId,ids.entityId,periodId]);
  await assert.rejects(finalizeCall(stageId),error=>error.code==='55000');
  assert.deepEqual((await adminPool.query("SELECT (SELECT count(*)::int FROM wbs_test_bank_import_stage_row WHERE tenant_id=$1) staged,(SELECT count(*)::int FROM bank_source WHERE tenant_id=$1) bank,(SELECT count(*)::int FROM reconciliation WHERE tenant_id=$1) reconciliations,(SELECT count(*)::int FROM wbs_controlled_test_bank_import WHERE tenant_id=$1) imports",[ids.tenantId])).rows[0],{staged:201,bank:0,reconciliations:0,imports:0});
  await adminPool.query("UPDATE accounting_period SET status='OPEN' WHERE tenant_id=$1 AND entity_id=$2 AND period_id=$3",[ids.tenantId,ids.entityId,periodId]);
  const completed=await importer.createWbsControlledTestBankScope({...ids,periodId,companyCode:'WBPA',observation,bankAccountRef:'WBS_TEST_BANK_2026_01',idempotencyKey});assert.equal(completed.transaction_count,201);assert.equal(completed.bank_source_ids.length,201);
  await adminPool.query('DROP TRIGGER refs_test_delay_wbs_bank_finalize ON import_batch');await adminPool.query('DROP FUNCTION refs_test_delay_wbs_bank_finalize()');
  assert.deepEqual((await adminPool.query("SELECT (SELECT count(*)::int FROM wbs_test_bank_import_stage_row WHERE tenant_id=$1) staged,(SELECT count(*)::int FROM bank_source WHERE tenant_id=$1) bank,(SELECT count(*)::int FROM reconciliation WHERE tenant_id=$1) reconciliations,(SELECT count(*)::int FROM wbs_controlled_test_bank_import WHERE tenant_id=$1) imports",[ids.tenantId])).rows[0],{staged:201,bank:201,reconciliations:1,imports:1});
  const beforeDown=(await adminPool.query("SELECT (SELECT count(*)::int FROM wbs_test_bank_import_stage_row WHERE tenant_id=$1) staged,(SELECT count(*)::int FROM bank_source WHERE tenant_id=$1) bank,(SELECT count(*)::int FROM wbs_test_bank_import_stage_final WHERE tenant_id=$1) finals",[ids.tenantId])).rows[0];
  await migrateDownThrough(adminPool,'251_wbs_ai_approved_entity_period_settings_read.sql');
  await assert.rejects(migrateDown(adminPool),error=>error.code==='55006'); // 250 refuses to discard the immutable checkpoint payload.
  assert.deepEqual((await adminPool.query("SELECT (SELECT count(*)::int FROM wbs_test_bank_import_stage_row WHERE tenant_id=$1) staged,(SELECT count(*)::int FROM bank_source WHERE tenant_id=$1) bank,(SELECT count(*)::int FROM wbs_test_bank_import_stage_final WHERE tenant_id=$1) finals",[ids.tenantId])).rows[0],beforeDown);
  await adminPool.query('TRUNCATE wbs_test_bank_import_stage_final,wbs_test_bank_import_stage_row,wbs_test_bank_import_stage_chunk,wbs_test_bank_import_stage');
  await migrateDown(adminPool); // 250 after explicit test-fixture disposal.
  // 185's retained-checkpoint guard correctly sees the explicit fixture
  // disposal above, so its down migration must now succeed.  Locate it by
  // immutable identity because unrelated migrations may exist above it.
  await migrateDownThrough(adminPool,'185_wbs_test_bank_staged_import.sql');
  assert.deepEqual((await adminPool.query("SELECT (SELECT count(*)::int FROM bank_source WHERE tenant_id=$1) bank",[ids.tenantId])).rows[0],{bank:beforeDown.bank});
  await migrateUp(adminPool);
});

pgTest('AI reads exactly one approved entity-period settings snapshot and rejects missing or drifted child bindings without writes',async()=>{
  const ids=await seed({status:'DRAFT',attachmentStatus:null}),actor='ai-settings-reader',permissions=['AI.ACCOUNTING.SETTINGS.VIEW'];
  const period=(await adminPool.query('SELECT period_id,period_code,starts_on,ends_on FROM accounting_period WHERE tenant_id=$1 AND entity_id=$2 AND period_id=$3',[ids.tenantId,ids.entityId,ids.periodId])).rows[0];
  const hashJson=async value=>(await adminPool.query('SELECT refs_jsonb_hash($1::jsonb) AS value',[JSON.stringify(value)])).rows[0].value;
  const coaRoles=['ACCUMULATED_AMORTIZATION','ACCUMULATED_DEPRECIATION','ACCRUED_LIABILITY','AP','AR','CASH','CWIP','CUSTOMER_DEPOSIT_LIABILITY','DEFERRED_REVENUE','EQUITY','ESCROW','EXPENSE','FIXED_ASSET','INTERCOMPANY_CLEARING','INTERCOMPANY_DUE_FROM','INTERCOMPANY_DUE_TO','INTERCOMPANY_ELIMINATION','INTEREST','LOAN','PREPAID','RETAINED_EARNINGS','REVENUE','SECURITY_DEPOSIT_ASSET','TAX_PAYABLE'];
  const coaClass=role=>['EXPENSE','INTEREST'].includes(role)?'EXPENSE':role==='REVENUE'?'REVENUE':['EQUITY','RETAINED_EARNINGS','INTERCOMPANY_ELIMINATION'].includes(role)?'EQUITY':['AP','ACCRUED_LIABILITY','LOAN','DEFERRED_REVENUE','TAX_PAYABLE','CUSTOMER_DEPOSIT_LIABILITY','INTERCOMPANY_DUE_TO'].includes(role)?'LIABILITY':'ASSET';
  const coaAccounts=coaRoles.map((role,index)=>({role,account_code:String(110000+index).padStart(6,'0'),account_class:coaClass(role),account_type:'CURRENT',dimension_requirements:[],effective_from:'2026-01-01',effective_to:null,status:'ACTIVE',posting_allowed:true}));
  const children={
    coa:{family:'AI_ACCOUNTING_COA_V1',snapshot:{schema_version:'AI_ACCOUNTING_COA_V1',settings:{currency:'USD',accounts:coaAccounts}}},
    vendor_treatment:{family:'AI_ACCOUNTING_VENDOR_TREATMENT_V1',snapshot:{schema_version:'AI_ACCOUNTING_VENDOR_TREATMENT_V1',settings:{default_treatment:'BLOCKED',vendor_rules:[{rule_id:'vendor-1',vendor_ref:'vendor-1',aliases:['Vendor One'],contract_keys:['contract_id'],service_keys:['service_code'],treatment:'EXPENSE',payment_terms_days:30,recurring:false,duplicate_normalization:true,source_requirements:['invoice_no'],effective_from:'2026-01-01',effective_to:null}]}}},
    project_property_cost_code:{family:'AI_ACCOUNTING_PROJECT_PROPERTY_COST_CODE_V1',snapshot:{schema_version:'AI_ACCOUNTING_PROJECT_PROPERTY_COST_CODE_V1',settings:{default_capitalization_treatment:'BLOCKED',dimension_rules:[{rule_id:'qualifying-project-1',scope_level:'PROJECT',project_ref:'project-1',property_ref:null,cost_code_ref:null,member_ref:null,ownership_requirement:'OPTIONAL',member_requirement:'OPTIONAL',capitalization_treatment:'CWIP',cwip_account_role:'CWIP',status:'ACTIVE',effective_from:'2026-01-01',effective_to:null,completion_date:null,pis_date:null}]}}},
    period_close_policy:{family:'AI_ACCOUNTING_PERIOD_CLOSE_POLICY_V1',snapshot:{schema_version:'AI_ACCOUNTING_PERIOD_CLOSE_POLICY_V1',settings:{period_id:ids.periodId,period_code:period.period_code,period_start:period.starts_on.toISOString().slice(0,10),period_end:period.ends_on.toISOString().slice(0,10),period_status:'OPEN',cutoff_date:'2026-07-31',accrual_cutoff_date:'2026-07-31',prepaid_boundary_date:'2026-07-31',allow_post:true,posting_lock:false,hard_lock:false,soft_lock:false,reversal_policy:'NONE',prior_period_adjustment_policy:'BLOCKED',override_policy:'CONTROLLER_ONLY',business_calendar:'US',non_business_dates:[]}}},
    tax:{family:'AI_ACCOUNTING_TAX_V1',snapshot:{schema_version:'AI_ACCOUNTING_TAX_V1',settings:{jurisdiction:'US',treatment:'GROSS',allocation_method:'STRAIGHT_LINE_DAILY',allocation_precision:'0.0001',coverage_start:period.starts_on.toISOString().slice(0,10),coverage_end:period.ends_on.toISOString().slice(0,10),residual_rule:'EXPENSE',expense_account_role:'EXPENSE',prepaid_account_role:'PREPAID',accrual_account_role:'ACCRUED_LIABILITY',tax_codes:[{code:'US-GROSS',rate:'0.0000',basis:'GROSS',recoverability:'NON_RECOVERABLE',expense_treatment:'EXPENSE',evidence_requirements:['invoice_no'],effective_from:'2026-01-01',effective_to:null}],effective_from:'2026-01-01',effective_to:null}}},intercompany:{family:'AI_ACCOUNTING_INTERCOMPANY_V1',snapshot:{schema_version:'AI_ACCOUNTING_INTERCOMPANY_V1',settings:{enabled:true,clearing_account_role:'INTERCOMPANY_CLEARING',entities:[{company_code:'ICPARTNER',counterparty_entity_id:'11111111-1111-4111-8111-111111111111',counterparty_approval_id:'22222222-2222-4222-8222-222222222222',counterparty_approval_hash:'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',currency:'USD',dimension_requirements:[],due_to_account_role:'INTERCOMPANY_DUE_TO',due_from_account_role:'INTERCOMPANY_DUE_FROM',elimination_account_role:'INTERCOMPANY_ELIMINATION',effective_from:'2026-01-01',effective_to:null}]}}},
    materiality:{family:'AI_ACCOUNTING_MATERIALITY_V1',snapshot:{schema_version:'AI_ACCOUNTING_MATERIALITY_V1',settings:{amount_drop_ratio:'0.5000',amount_drop_window_days:30,ap_aging_amount:'100.0000',ap_stale_days:30,balance_dormant_days:90,budget_variance_amount:'100.0000',currency:'USD',duplicate_amount:'100.0000',effective_from:'2026-01-01',effective_to:null,financial_statement_amount:'100.0000',loan_difference_amount:'100.0000',loan_excess_draw_amount:'100.0000',manual_je_amount:'100.0000',manual_round_amount:'1.0000',minimum_absolute_balance:'1.0000',minimum_open_amount:'1.0000',near_duplicate_amount:'100.0000',vendor_frequency_count:5,vendor_frequency_window_days:30}}},approval_thresholds:{family:'AI_ACCOUNTING_APPROVAL_THRESHOLDS_V1',snapshot:{schema_version:'AI_ACCOUNTING_APPROVAL_THRESHOLDS_V1',settings:{expense_amount_threshold:'100.0000',prepaid_amount_threshold:'100.0000',accrual_amount_threshold:'100.0000',cwip_amount_threshold:'100.0000',currency:'USD',approval_levels:['DRAFT','REVIEW','APPROVE','POST'].map(action=>({workflow:'AP',action,risk_band:'LOW',confidence_band:'HIGH',minimum_amount:'0.0000',maximum_amount:'999999.0000',preparer_role:'AP_PREPARER',reviewer_role:'AP_REVIEWER',approver_role:'CONTROLLER',poster_role:'GL_POSTER',override_policy:'CONTROLLER_ONLY',sod_constraints:['PREPARER_NE_REVIEWER','PREPARER_NE_APPROVER','PREPARER_NE_POSTER','REVIEWER_NE_APPROVER','REVIEWER_NE_POSTER','APPROVER_NE_POSTER'],effective_from:'2026-01-01',effective_to:null}))}}}
  };
  children.approval_thresholds.snapshot.settings.approval_levels=children.approval_thresholds.snapshot.settings.approval_levels.map(level=>({...level,submitter_role:level.preparer_role,submit_permission:'GL.JE.SUBMIT'}));
  children.approval_thresholds.snapshot.settings.classification_thresholds=['EXPENSE','PREPAID','ACCRUAL','CAPITALIZATION','PAYMENT','LOAN','REVENUE','DEPOSIT','INTERCOMPANY','REIMBURSEMENT','FIXED_ASSET','TAX','CLOSING_COST','RECLASS','REVERSAL'].map(classification=>({classification,risk_band:'LOW',confidence_band:'HIGH',workflow:'STANDARD',minimum_amount:'0.0000',maximum_amount:'999999.0000',effective_from:'2026-01-01',effective_to:null}));
  children.report_mapping={family:'AI_ACCOUNTING_REPORT_MAPPING_V1',snapshot:{schema_version:'AI_ACCOUNTING_REPORT_MAPPING_V1',settings:{currency:'USD',account_mappings:coaAccounts.map((account,index)=>({account_role:account.role,account_code:account.account_code,statement:account.account_class==='REVENUE'||account.account_class==='EXPENSE'?'IS':'BS',normal_balance:account.account_class==='LIABILITY'||account.account_class==='EQUITY'||account.account_class==='REVENUE'||['ACCUMULATED_DEPRECIATION','ACCUMULATED_AMORTIZATION'].includes(account.role)?'CREDIT':'DEBIT',contra:['ACCUMULATED_DEPRECIATION','ACCUMULATED_AMORTIZATION'].includes(account.role),cash_flow_class:index===3?'OPERATING':'NON_CASH',report_row_code:`ROW_${account.role}`,effective_from:'2026-01-01',effective_to:null}))}}};
  children.loan_capitalization_policy={family:'AI_ACCOUNTING_LOAN_CAPITALIZATION_POLICY_V1',snapshot:{schema_version:'AI_ACCOUNTING_LOAN_CAPITALIZATION_POLICY_V1',settings:{currency:'USD',loan_purpose:'QUALIFYING_ASSET_ONLY',capitalization_start_policy:'WHEN_QUALIFYING_ACTIVITY_STARTS',suspension_policy:'PAUSE_DURING_EXTENDED_SUSPENSION',cessation_policy:'ON_READY_FOR_INTENDED_USE',eligible_interest_policy:'ACTUAL_INTEREST',eligible_fee_policy:'DIRECT_FEES_ONLY',expense_account_role:'EXPENSE',cwip_account_role:'CWIP',fixed_asset_account_role:'FIXED_ASSET',materiality_amount:'100.0000',qualifying_combinations:[{project_ref:'project-1',property_ref:null,asset_ref:null,effective_from:'2026-01-01',effective_to:null}],required_evidence:['loan_agreement','interest_statement'],effective_from:'2026-01-01',effective_to:null}}};
  const refs={};let version=1;
  for(const [key,entry] of Object.entries(children)){
    const settingSnapshotId=randomUUID(),snapshotHash=await hashJson(entry.snapshot);refs[key]={setting_snapshot_id:settingSnapshotId,version:1,snapshot_hash:snapshotHash};
    await adminPool.query(`INSERT INTO setting_snapshot(setting_snapshot_id,tenant_id,entity_id,family,scope_type,scope_key,version,effective_from,effective_to,status,snapshot,snapshot_hash,created_by,approved_by,approved_at)
      VALUES($1,$2,$3,$4,'ENTITY',$3::uuid::text,1,'2026-01-01','2027-01-01','APPROVED',$5::jsonb,$6,'settings-maker','settings-approver',now())`,[settingSnapshotId,ids.tenantId,ids.entityId,entry.family,JSON.stringify(entry.snapshot),snapshotHash]);
  }
  const parentSnapshot={schema_version:'AI_ACCOUNTING_ENTITY_PERIOD_SETTINGS_SNAPSHOT_V1',company_code:'WBPA',period_id:ids.periodId,period_code:period.period_code,period_start:period.starts_on.toISOString().slice(0,10),period_end:period.ends_on.toISOString().slice(0,10),currency:'USD',...refs};
  const parentHash=await hashJson(parentSnapshot),parentId=randomUUID();
  await adminPool.query(`INSERT INTO setting_snapshot(setting_snapshot_id,tenant_id,entity_id,family,scope_type,scope_key,version,effective_from,effective_to,status,snapshot,snapshot_hash,created_by,approved_by,approved_at)
    VALUES($1,$2,$3,'AI_ACCOUNTING_ENTITY_PERIOD_SETTINGS_V1','ENTITY',$3::uuid::text,$4,'2026-01-01','2027-01-01','APPROVED',$5::jsonb,$6,'settings-maker','settings-approver',now())`,[parentId,ids.tenantId,ids.entityId,version,JSON.stringify(parentSnapshot),parentHash]);
  // Issue the DB-owned context before the zero-write baseline.  The reader
  // itself must remain a pure no-store read, including on rejection.
  const readerSession=await trustedSession(ids,actor,permissions),failureSession=await trustedSession(ids,`${actor}-failure`,permissions);
  const reader=new PostgresAccountingKernel(runtimePool,{sessionProvider:async()=>readerSession});
  const failureReader=new PostgresAccountingKernel(runtimePool,{sessionProvider:async()=>failureSession});
  const dto=await reader.readApprovedWbsAiEntityPeriodSettings({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId,readOnly:true});
  assert.equal(dto.settings_snapshot_id,parentId);assert.equal(dto.settings_hash,parentHash);assert.equal(dto.settings_version,1);assert.equal(dto.schema_version,'WBS_AI_APPROVED_ENTITY_PERIOD_SETTINGS_V1');assert.equal(dto.approval_status,'APPROVED');assert.equal(dto.coa.settings.accounts.length,coaRoles.length);assert.equal(dto.coa.settings.accounts.find(account=>account.role==='AP').account_code,'110003');assert.equal(dto.coa.settings.accounts.find(account=>account.role==='INTERCOMPANY_DUE_TO').status,'ACTIVE');assert.equal(dto.coa.settings.accounts.find(account=>account.role==='AR').status,'ACTIVE');assert.equal(dto.vendor_treatment.settings.default_treatment,'BLOCKED');assert.equal(dto.can_post,false);
  const beforeFailure=(await adminPool.query("SELECT (SELECT count(*)::int FROM audit_event WHERE tenant_id=$1) audit,(SELECT count(*)::int FROM outbox_event WHERE tenant_id=$1) outbox,(SELECT count(*)::int FROM journal_entry WHERE tenant_id=$1) journals,(SELECT count(*)::int FROM ledger_line WHERE tenant_id=$1) ledger,(SELECT count(*)::int FROM source_document WHERE tenant_id=$1) source,(SELECT count(*)::int FROM staging_item WHERE tenant_id=$1) staging",[ids.tenantId])).rows[0];
  await assert.rejects(failureReader.readApprovedWbsAiEntityPeriodSettings({tenantId:ids.tenantId,entityId:ids.entityId,periodId:randomUUID(),readOnly:true}),error=>error.code==='23514');
  const afterFailure=(await adminPool.query("SELECT (SELECT count(*)::int FROM audit_event WHERE tenant_id=$1) audit,(SELECT count(*)::int FROM outbox_event WHERE tenant_id=$1) outbox,(SELECT count(*)::int FROM journal_entry WHERE tenant_id=$1) journals,(SELECT count(*)::int FROM ledger_line WHERE tenant_id=$1) ledger,(SELECT count(*)::int FROM source_document WHERE tenant_id=$1) source,(SELECT count(*)::int FROM staging_item WHERE tenant_id=$1) staging",[ids.tenantId])).rows[0];assert.deepEqual(afterFailure,beforeFailure);
});

pgTest('WBS H1 TEST_ONLY period provisioning creates six exact OPEN months idempotently and rejects conflicts before partial inserts',async()=>{
  const ids=await seed({status:'DRAFT',attachmentStatus:null});
  const importer=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,'wbs-h1-period-importer',['WBS.TEST.IMPORT'])});
  const created=await importer.ensureWbsTestH12026Periods(ids),replay=await importer.ensureWbsTestH12026Periods(ids);
  const expected=Array.from({length:6},(_,index)=>{const month=index+1,code=`2026-${String(month).padStart(2,'0')}`;return {period_code:code,starts_on:`${code}-01`,ends_on:new Date(Date.UTC(2026,month,0)).toISOString().slice(0,10)};});
  assert.equal(created.status,'WBS_TEST_H1_PERIODS_READY');assert.equal(created.test_only,true);assert.deepEqual(created.periods.map(({period_code,starts_on,ends_on})=>({period_code,starts_on,ends_on})),expected);assert.deepEqual(replay,created);
  const stored=(await adminPool.query("SELECT period_code,starts_on::text,ends_on::text,status FROM accounting_period WHERE tenant_id=$1 AND entity_id=$2 AND period_code BETWEEN '2026-01' AND '2026-06' ORDER BY period_code",[ids.tenantId,ids.entityId])).rows;
  assert.deepEqual(stored,expected.map(row=>({...row,status:'OPEN'})));
  const conflict=await seed({status:'DRAFT',attachmentStatus:null});
  await adminPool.query("INSERT INTO accounting_period(tenant_id,entity_id,ledger_code,period_code,starts_on,ends_on,status) VALUES($1,$2,'PRIMARY','2026-03','2026-03-02','2026-03-31','OPEN')",[conflict.tenantId,conflict.entityId]);
  const denied=new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(conflict,'wbs-h1-period-conflict',['WBS.TEST.IMPORT'])});
  await assert.rejects(denied.ensureWbsTestH12026Periods(conflict),error=>error.code==='23514');
  const conflictRows=(await adminPool.query("SELECT period_code FROM accounting_period WHERE tenant_id=$1 AND entity_id=$2 AND period_code BETWEEN '2026-01' AND '2026-06' ORDER BY period_code",[conflict.tenantId,conflict.entityId])).rows;
  assert.deepEqual(conflictRows,[{period_code:'2026-03'}]);
});

pgTest('WBS H1 paged import preserves prior July rows with the same source hashes and posts nine new monthly AP journals',async()=>{
  const ids=await seed({status:'DRAFT',attachmentStatus:null});
  await adminPool.query('DELETE FROM journal_line WHERE tenant_id=$1 AND entity_id=$2 AND journal_entry_id=$3',[ids.tenantId,ids.entityId,ids.journalId]);
  await adminPool.query('DELETE FROM journal_entry WHERE tenant_id=$1 AND entity_id=$2 AND journal_entry_id=$3',[ids.tenantId,ids.entityId,ids.journalId]);
  const rows=[
    ['2026-01-01','10.1000'],['2026-01-02','20.2000'],['2026-01-31','50.3100'],
    ['2026-02-01','500.0000'],['2026-02-28','504.8500'],
    ['2026-03-01','1000.0000'],['2026-03-31','509.1200'],
    ['2026-06-01','132000.0000'],['2026-06-30','447.7500']
  ].map(([accounting_date,amount],index)=>({source_record_hash:hash(`wbs-live-h1-payable-${index+1}`),currency:'USD',accounting_date,amount,status:'CLEAR'}));
  const august={source_record_hash:hash('wbs-live-annual-august-hold'),currency:'USD',accounting_date:'2026-08-13',amount:'127.4300',status:'HOLD'};
  const makeObservation=({scopeRows,dateRange,identity})=>({schema_version:'WBS_LIVE_PILOT_OBSERVATION_V1',status:'NOT_ADMITTED',observation_mode:'UNSIGNED_PILOT',source_system:'WBS',tool:'list_payables',environment:'PRODUCTION',entity_id:ids.entityId,captured_at:'2026-08-19T00:00:00.000Z',provider_content_sha256:createHash('sha256').update(canonicalRequestBody(scopeRows),'utf8').digest('hex'),scope:{company_codes:['WBPA'],date_range:dateRange},record_count:scopeRows.length,rows:scopeRows,signature_verified:false,can_import:false,can_create_transaction:false,can_match:false,can_allocate:false,can_create_draft:false,can_approve:false,can_post:false,can_reverse:false,observation_hash:hash(identity)});
  const annual=makeObservation({scopeRows:[...rows,august],dateRange:['2026-01-01','2026-12-31'],identity:'wbs-live-annual-july-legacy'}),h1=makeObservation({scopeRows:rows,dateRange:['2026-01-01','2026-06-30'],identity:'wbs-live-h1-exact-range'}),emptyBank={...makeObservation({scopeRows:[],dateRange:['2026-01-01','2026-06-30'],identity:'wbs-live-h1-bank-empty'}),tool:'list_bank_transactions'};
  const actors={importer:'wbs-h1-importer',maker:'wbs-h1-maker',submitter:'wbs-h1-submitter',reviewer:'wbs-h1-reviewer',approver:'wbs-h1-approver',poster:'wbs-h1-poster'},permissions={importer:['WBS.TEST.IMPORT','BANK.RECONCILIATION.START'],maker:['WBS.TEST.IMPORT','AP.BILL.CREATE'],submitter:['GL.JE.SUBMIT'],reviewer:['GL.JE.REVIEW'],approver:['GL.JE.APPROVE'],poster:['GL.JE.POST']};
  const kernelForActor=actor=>new PostgresAccountingKernel(runtimePool,{sessionProvider:sessionProvider(ids,actor,permissions[Object.keys(actors).find(role=>actors[role]===actor)])});
  const pilotService={
    async readObservation(){return annual;},
    async readObservationPage({tool,cursor,snapshot_token,date_from,date_to}){assert.equal(cursor,null);assert.equal(snapshot_token,null);const observation=tool==='list_payables'?h1:{...emptyBank,scope:{company_codes:['WBPA'],date_range:[date_from,date_to]},observation_hash:hash(`wbs-live-bank-empty-${date_from}`)};return {observation,cursor_next:null,pagination:{snapshot_token:`snapshot-${tool}-${date_from}`,captured_at:'2026-08-19T00:00:00.000Z',contract_version:'WBS-REFS-MCP-V1',environment:'production',source_hash:hash(`wbs-source-${tool}`),first_stable_key:observation.rows.length?'001':null,last_stable_key:observation.rows.length?'009':null}};}
  };
  const service=createWbsTestImportService({pilotService,kernelForActor,authorizeBank:async()=>{},scope:{tenantId:ids.tenantId,entityId:ids.entityId,companyCode:'WBPA',actors}});
  const legacy=await service.importPayables({...ids,companyCode:'WBPA',dateFrom:'2026-01-01',dateTo:'2026-12-31',limit:10,idempotencyKey:'wbs-h1-legacy-july-001'});
  assert.deepEqual({imported:legacy.imported_count,posted:legacy.posted_count},{imported:10,posted:10});
  const julyBefore=(await adminPool.query('SELECT count(*)::int documents FROM business_document WHERE tenant_id=$1 AND entity_id=$2 AND accounting_date BETWEEN $3 AND $4',[ids.tenantId,ids.entityId,'2026-07-01','2026-07-31'])).rows[0].documents;assert.equal(julyBefore,10);
  const commands=[1,2,3,6].map(month=>{const periodCode=`2026-${String(month).padStart(2,'0')}`;return {tenantId:ids.tenantId,entityId:ids.entityId,companyCode:'WBPA',dateFrom:`${periodCode}-01`,dateTo:new Date(Date.UTC(2026,month,0)).toISOString().slice(0,10),pageSize:10,maxPages:1000,idempotencyKey:`wbs-h1-exact-month-${periodCode}`};});
  const imported=[];for(const command of commands)imported.push(await service.importRange(command));assert.deepEqual(imported.reduce((totals,row)=>({imported:totals.imported+row.payables.imported_count,replayed:totals.replayed+row.payables.replayed_count,posted:totals.posted+row.payables.posted_count}),{imported:0,replayed:0,posted:0}),{imported:9,replayed:0,posted:9});
  const monthly=(await adminPool.query(`SELECT p.period_code,count(DISTINCT b.business_document_id)::int ap_count,coalesce(sum(b.gross_amount),0)::numeric(22,4)::text amount_total
    FROM accounting_period p LEFT JOIN business_document b ON b.tenant_id=p.tenant_id AND b.entity_id=p.entity_id AND b.accounting_date BETWEEN p.starts_on AND p.ends_on AND b.document_kind='AP_BILL'
    WHERE p.tenant_id=$1 AND p.entity_id=$2 AND p.period_code BETWEEN '2026-01' AND '2026-06' GROUP BY p.period_code ORDER BY p.period_code`,[ids.tenantId,ids.entityId])).rows;
  assert.deepEqual(monthly,[{period_code:'2026-01',ap_count:3,amount_total:'80.6100'},{period_code:'2026-02',ap_count:2,amount_total:'1004.8500'},{period_code:'2026-03',ap_count:2,amount_total:'1509.1200'},{period_code:'2026-04',ap_count:0,amount_total:'0.0000'},{period_code:'2026-05',ap_count:0,amount_total:'0.0000'},{period_code:'2026-06',ap_count:2,amount_total:'132447.7500'}]);
  const closed=(await adminPool.query(`SELECT
    (SELECT count(*)::int FROM source_document WHERE tenant_id=$1 AND entity_id=$2 AND accounting_date BETWEEN '2026-01-01' AND '2026-06-30') h1_sources,
    (SELECT count(*)::int FROM business_document WHERE tenant_id=$1 AND entity_id=$2 AND accounting_date BETWEEN '2026-01-01' AND '2026-06-30') h1_ap,
    (SELECT count(*)::int FROM journal_entry j JOIN accounting_period p ON p.tenant_id=j.tenant_id AND p.entity_id=j.entity_id AND p.period_id=j.period_id WHERE j.tenant_id=$1 AND j.entity_id=$2 AND p.period_code BETWEEN '2026-01' AND '2026-06') h1_je,
    (SELECT count(*)::int FROM ledger_line l JOIN accounting_period p ON p.tenant_id=l.tenant_id AND p.entity_id=l.entity_id AND p.period_id=l.period_id WHERE l.tenant_id=$1 AND l.entity_id=$2 AND p.period_code BETWEEN '2026-01' AND '2026-06') h1_gl,
    (SELECT count(*)::int FROM business_document WHERE tenant_id=$1 AND entity_id=$2 AND accounting_date BETWEEN '2026-07-01' AND '2026-07-31') july_ap`,[ids.tenantId,ids.entityId])).rows[0];
  assert.deepEqual(closed,{h1_sources:9,h1_ap:9,h1_je:9,h1_gl:18,july_ap:10});
  const replay=[];for(const command of commands)replay.push(await service.importRange(command));assert.deepEqual(replay.reduce((totals,row)=>({imported:totals.imported+row.payables.imported_count,replayed:totals.replayed+row.payables.replayed_count,posted:totals.posted+row.payables.posted_count}),{imported:0,replayed:0,posted:0}),{imported:0,replayed:9,posted:9});
  assert.deepEqual((await adminPool.query(`SELECT count(*)::int h1_ap,(SELECT count(*)::int FROM business_document WHERE tenant_id=$1 AND entity_id=$2 AND accounting_date BETWEEN '2026-07-01' AND '2026-07-31') july_ap FROM business_document WHERE tenant_id=$1 AND entity_id=$2 AND accounting_date BETWEEN '2026-01-01' AND '2026-06-30'`,[ids.tenantId,ids.entityId])).rows[0],{h1_ap:9,july_ap:10});
});
