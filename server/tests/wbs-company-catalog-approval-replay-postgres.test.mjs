// H08: company-catalog approval contract gaps pinned on live PostgreSQL.
//   * approve replay with the same idempotency key and payload -> idempotent:true, no second decision/audit/outbox
//   * same idempotency key with a different payload -> 23505 (idempotency conflict), nothing written
//   * two approvers racing on the same classified row -> exactly one APPROVED decision, the other 40001/23505
//   * approval binds source_system/source_entity_id but NEVER touches entity.name (the H03 gap, pinned so a
//     future "apply approved name" command has to change this assertion deliberately)
import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID, createHash} from 'node:crypto';
import {createPool} from '../runtime/db.mjs';
import {runtimeConfig} from '../runtime/config.mjs';
import {migrateUp} from '../runtime/migrations.mjs';
import {PostgresAccountingKernel} from '../runtime/kernel-repository.mjs';
import {PostgresContextIssuer} from '../runtime/context-issuer.mjs';
import {normalizeWbsCompanyCatalogCandidate,wbsCompanyCatalogCanonicalHash,normalizeWbsCompanyClassification} from '../runtime/wbs-company-catalog-controller.mjs';

const config=runtimeConfig();
let admin=null,runtime=null,issuer=null,unavailable=null;
const hash=v=>`sha256:${createHash('sha256').update(String(v)).digest('hex')}`;
before(async()=>{try{
  admin=await createPool({databaseUrl:config.migrationDatabaseUrl,applicationName:'refs-h08-admin',max:2});await admin.query('SELECT 1');await migrateUp(admin,{});
  runtime=await createPool({databaseUrl:config.databaseUrl,applicationName:'refs-h08-runtime',max:6});await runtime.query('SELECT 1');
  issuer=await createPool({databaseUrl:config.contextIssuerDatabaseUrl,applicationName:'refs-h08-issuer',max:4});await issuer.query('SELECT 1');
}catch(error){unavailable=`POSTGRES NOT RUN: ${error.code||error.name}: ${error.message}`;if(config.requirePostgres)throw error;for(const p of [admin,runtime,issuer])if(p)await p.end().catch(()=>{});admin=runtime=issuer=null;}});
after(async()=>{for(const p of [admin,runtime,issuer])if(p)await p.end();});
async function grant(ids,actorId,permission){
  const authority=(await admin.query('SELECT authority_class FROM runtime_human_permission_authority WHERE permission_code=$1',[permission])).rows[0]?.authority_class||'ANALYSIS';
  await admin.query(`INSERT INTO runtime_actor_grant(tenant_id,actor_id,entity_id,permission,authority_class,valid_until) VALUES($1,$2,$3,$4,$5,clock_timestamp()+interval '1 hour') ON CONFLICT(tenant_id,actor_id,entity_id,permission) DO UPDATE SET revoked_at=NULL`,[ids.tenantId,actorId,ids.entityId,permission,authority]);
}
const kernelFor=(ids,actorId)=>{const ci=new PostgresContextIssuer(issuer,{principalProvider:async()=>({trusted:true,actorId,tenantId:ids.tenantId})});return new PostgresAccountingKernel(runtime,{sessionProvider:()=>ci.issue({tenantId:ids.tenantId})});};
function pgTest(name,fn){test(name,async t=>{if(unavailable){t.skip(unavailable);return;}await fn(t);});}

const NAME='Controller verified company name';
function makeCatalog(companyCode,raw){
  const input={catalogVersion:`h08-${companyCode}-v1`,generatedAt:'2026-09-01T00:00:00.000Z',providerEnvironment:'PRODUCTION',source:{name:'wbs-readonly-catalog-probe',version:'h08',rawFileHash:hash(raw),catalogHash:hash('placeholder'),rowControl:{sourceRowCount:1,acceptedRowCount:1,rejectedRows:[]}},accountBookControl:{total:1,open:1,closed:0,companiesWithBooks:1},companies:[{companyCode,wbsCompanyId:'900',displayName:NAME,legalName:NAME,activeStatus:'ACTIVE',entityType:'LEGAL_ENTITY',baseCurrency:'USD',operationallyActive2026:true,accountBooks:[{accountBookId:`book-${companyCode}`,accountName:'Operating',accountStatus:'O',externalCompanyId:'900'}],accountBookCount:1,openAccountBookCount:1,domains:{PAYABLES:{rowCount:3,minDate:'2026-01-01',maxDate:'2026-08-31'},JOURNAL:{rowCount:3,minDate:'2026-01-01',maxDate:'2026-08-31'},BANK:{rowCount:1,minDate:'2026-01-01',maxDate:'2026-08-31'},AUTOREC:{pbStatus:'SOURCE_PRESENT',reconStart:'2026-01-01'}}}]};
  input.source.catalogHash=wbsCompanyCatalogCanonicalHash(input);return normalizeWbsCompanyCatalogCandidate(input);
}
async function seedClassified(){
  const ids={tenantId:randomUUID(),entityId:randomUUID()},code=`H8${randomUUID().slice(0,4).toUpperCase()}`;
  await admin.query('INSERT INTO tenant(tenant_id,tenant_code,name) VALUES($1,$2,$3)',[ids.tenantId,`T${ids.tenantId.replaceAll('-','').slice(0,8)}`.toUpperCase(),'h08']);
  await admin.query("INSERT INTO entity(entity_id,tenant_id,entity_code,source_system,source_entity_id,name,base_currency) VALUES($1,$2,$3,'REFS_CATALOG_PENDING','PENDING',$4,'USD')",[ids.entityId,ids.tenantId,code,`WBS ${code}`]);
  for(const [actor,perms] of [['h08-retainer',['WBS.COMPANY.CATALOG.RETAIN','WBS.COMPANY.CATALOG.VIEW']],['h08-classifier',['WBS.COMPANY.CATALOG.CLASSIFY','WBS.COMPANY.CATALOG.VIEW']],['h08-approver-a',['WBS.COMPANY.CATALOG.APPROVE','WBS.COMPANY.CATALOG.VIEW']],['h08-approver-b',['WBS.COMPANY.CATALOG.APPROVE','WBS.COMPANY.CATALOG.VIEW']]])for(const p of perms)await grant(ids,actor,p);
  const catalog=makeCatalog(code,`raw-${code}`);
  const retained=await kernelFor(ids,'h08-retainer').retainWbsCompanyCatalogCandidate({...ids,catalog,idempotencyKey:`h08-retain-${code}`});
  const rows=await kernelFor(ids,'h08-retainer').listWbsCompanyCatalogRows({...ids,candidateId:retained.wbs_company_catalog_candidate_id,limit:10,offset:0});
  const rowId=rows[0].wbs_company_catalog_candidate_row_id;
  const classification=normalizeWbsCompanyClassification({companyCode:code,displayName:NAME,legalName:NAME,entityType:'LEGAL_ENTITY',activeStatus:'ACTIVE',baseCurrency:'USD'});
  await kernelFor(ids,'h08-classifier').classifyWbsCompanyCatalogRow({...ids,rowId,expectedRevision:0,classification,reason:'H08 independent classification.',idempotencyKey:`h08-classify-${code}`});
  return {ids,code,rowId,catalog,placeholderName:`WBS ${code}`};
}
const approvalArgs=(s,key,extra={})=>({...s.ids,rowId:s.rowId,expectedRevision:1,expectedCatalogHash:s.catalog.catalog_hash,expectedRowHash:s.catalog.rows[0].row_hash,effectiveFrom:'2026-01-01',effectiveTo:null,reason:'H08 approval of the exact reconciled binding.',idempotencyKey:key,...extra});
const counts=async ids=>(await admin.query(`SELECT (SELECT count(*) FROM wbs_company_catalog_controller_decision WHERE tenant_id=$1 AND entity_id=$2 AND decision_type='APPROVED')::int approved,(SELECT count(*) FROM audit_event WHERE tenant_id=$1 AND entity_id=$2 AND event_type='WBS_COMPANY_CATALOG_APPROVED')::int audit,(SELECT count(*) FROM outbox_event WHERE tenant_id=$1 AND entity_id=$2 AND event_type LIKE 'WBS_COMPANY_CATALOG_APPROV%')::int outbox`,[ids.tenantId,ids.entityId])).rows[0];

pgTest('approve replay with the same key and payload is idempotent and writes nothing twice',async()=>{
  const s=await seedClassified();const approver=kernelFor(s.ids,'h08-approver-a');
  const first=await approver.approveWbsCompanyCatalogRow(approvalArgs(s,`h08-approve-${s.code}`));
  assert.equal(first.idempotent,false);assert.equal(first.revision,2);
  const before=await counts(s.ids);
  const replay=await approver.approveWbsCompanyCatalogRow(approvalArgs(s,`h08-approve-${s.code}`));
  assert.equal(replay.idempotent,true);assert.equal(replay.decision_id,first.decision_id);assert.equal(replay.decision_hash,first.decision_hash);
  assert.deepEqual(await counts(s.ids),before);
  assert.equal(before.approved,1);assert.equal(before.audit,1);
});

pgTest('same idempotency key with a different payload is an idempotency conflict (23505) and writes nothing',async()=>{
  const s=await seedClassified();const approver=kernelFor(s.ids,'h08-approver-a');
  await approver.approveWbsCompanyCatalogRow(approvalArgs(s,`h08-approve-${s.code}`));
  const before=await counts(s.ids);
  await assert.rejects(approver.approveWbsCompanyCatalogRow(approvalArgs(s,`h08-approve-${s.code}`,{reason:'A different reason under the same key must not be replayed as the first.'})),e=>e.code==='23505');
  assert.deepEqual(await counts(s.ids),before);
});

pgTest('two approvers racing on one classified row produce exactly one APPROVED decision',async()=>{
  const s=await seedClassified();
  const results=await Promise.allSettled([kernelFor(s.ids,'h08-approver-a').approveWbsCompanyCatalogRow(approvalArgs(s,`h08-race-a-${s.code}`)),kernelFor(s.ids,'h08-approver-b').approveWbsCompanyCatalogRow(approvalArgs(s,`h08-race-b-${s.code}`))]);
  const ok=results.filter(r=>r.status==='fulfilled'),failed=results.filter(r=>r.status==='rejected');
  assert.equal(ok.length,1,`expected exactly one winner, got ${ok.length}`);
  assert.equal(failed.length,1);assert.ok(['40001','23505','23514'].includes(failed[0].reason?.code),`loser must fail closed with a CAS/idempotency code, got ${failed[0].reason?.code}`);
  const c=await counts(s.ids);assert.equal(c.approved,1);assert.equal(c.audit,1);
  const latest=(await admin.query('SELECT max(revision)::int revision FROM wbs_company_catalog_controller_decision WHERE tenant_id=$1 AND entity_id=$2',[s.ids.tenantId,s.ids.entityId])).rows[0].revision;
  assert.equal(latest,2);
});

pgTest('approval binds the WBS company but leaves entity.name untouched (no rename path exists yet)',async()=>{
  const s=await seedClassified();
  await kernelFor(s.ids,'h08-approver-a').approveWbsCompanyCatalogRow(approvalArgs(s,`h08-approve-${s.code}`));
  const entity=(await admin.query('SELECT name,source_system,source_entity_id FROM entity WHERE tenant_id=$1 AND entity_id=$2',[s.ids.tenantId,s.ids.entityId])).rows[0];
  assert.equal(entity.source_system,'WBS');assert.equal(entity.source_entity_id,s.code);
  assert.equal(entity.name,s.placeholderName,'136 approval must not rename the entity; an approved-name apply command with its own SoD/audit is the only sanctioned path');
  const decision=(await admin.query("SELECT display_name,legal_name FROM wbs_company_catalog_controller_decision WHERE tenant_id=$1 AND entity_id=$2 AND decision_type='APPROVED'",[s.ids.tenantId,s.ids.entityId])).rows[0];
  assert.equal(decision.display_name,NAME);assert.equal(decision.legal_name,NAME);
  // the read model exposes the approved name for a future apply step without it having leaked into entity
  const rows=await kernelFor(s.ids,'h08-retainer').listWbsCompanyCatalogRows({...s.ids,candidateId:(await admin.query('SELECT wbs_company_catalog_candidate_id FROM wbs_company_catalog_candidate WHERE tenant_id=$1 AND entity_id=$2',[s.ids.tenantId,s.ids.entityId])).rows[0].wbs_company_catalog_candidate_id,limit:10,offset:0});
  assert.equal(rows.length,1);
});
