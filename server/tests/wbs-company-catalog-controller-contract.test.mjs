import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createAccountingApi} from '../api/accounting-http.mjs';
import {normalizeWbsCompanyCatalogCandidate,wbsCompanyCatalogCanonicalHash} from '../runtime/wbs-company-catalog-controller.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const hash=character=>`sha256:${character.repeat(64)}`;

function candidate(){
  const value={
    catalogVersion:'wbs-company-catalog-2026-08-15-v1',generatedAt:'2026-08-15T01:02:03.000Z',providerEnvironment:'PRODUCTION',
    source:{name:'wbs-readonly-accountbook-export',version:'export:2026-08-15T01:00:00Z',rawFileHash:hash('1'),catalogHash:hash('0'),rowControl:{sourceRowCount:1,acceptedRowCount:1,rejectedRows:[]}},
    accountBookControl:{total:1,open:1,closed:0,companiesWithBooks:1},
    companies:[{companyCode:'WBPA',wbsCompanyId:'176',displayName:'Wan Pacific Real Estate Development LLC',legalName:'Wan Pacific Real Estate Development LLC',activeStatus:'ACTIVE',entityType:'LEGAL_ENTITY',baseCurrency:'USD',operationallyActive2026:true,accountBooks:[{accountBookId:'book-8676010831',accountName:'WPRED - Ops',accountStatus:'O',externalCompanyId:'176'}],accountBookCount:1,openAccountBookCount:1,domains:{PAYABLES:{rowCount:183,minDate:'2026-01-01',maxDate:'2026-08-15'},JOURNAL:{rowCount:199,minDate:'2026-01-01',maxDate:'2026-08-15'},BANK:{rowCount:17,minDate:'2026-01-01',maxDate:'2026-08-15'},AUTOREC:{pbStatus:'SOURCE_PRESENT',reconStart:'2026-01-01'}}}]
  };
  value.source.catalogHash=wbsCompanyCatalogCanonicalHash(value);return value;
}

test('candidate normalization retains hashes and source controls, emits row findings, and strips no hidden authority',()=>{
  const normalized=normalizeWbsCompanyCatalogCandidate(candidate());
  assert.equal(normalized.catalog_hash,wbsCompanyCatalogCanonicalHash(candidate()));
  assert.equal(normalized.rows.length,1);assert.equal(normalized.rows[0].company_code,'WBPA');assert.equal(normalized.rows[0].account_books.length,1);
  assert.equal(normalized.account_book_control.declared_total,1);assert.equal(normalized.account_book_control.recomputed_total,1);
  assert.ok(normalized.findings.some(item=>item.severity==='INFO'&&item.code==='CATALOG_ROW_RETAINED'));
  assert.equal('mapping_snapshot' in normalized,false);assert.equal('credentials' in normalized,false);
});

test('normalization fails closed for credential-like material, hash drift, duplicate identities, and control drift',()=>{
  const credential=candidate();credential.source.apiKey='do-not-retain';assert.throws(()=>normalizeWbsCompanyCatalogCandidate(credential),error=>error.code==='WBS_COMPANY_CATALOG_CREDENTIAL_FORBIDDEN');
  const drift=candidate();drift.companies[0].displayName='Changed after hash';assert.throws(()=>normalizeWbsCompanyCatalogCandidate(drift),error=>error.code==='WBS_COMPANY_CATALOG_HASH_MISMATCH');
  const rawDrift=candidate();rawDrift.source.rawFileHash=hash('9');assert.throws(()=>normalizeWbsCompanyCatalogCandidate(rawDrift),error=>error.code==='WBS_COMPANY_CATALOG_HASH_MISMATCH');
  const controls=candidate();controls.accountBookControl.total=2;controls.source.catalogHash=wbsCompanyCatalogCanonicalHash(controls);const normalized=normalizeWbsCompanyCatalogCandidate(controls);assert.ok(normalized.findings.some(item=>item.severity==='ERROR'&&item.code==='ACCOUNT_BOOK_TOTAL_MISMATCH'));
  const duplicate=candidate();duplicate.companies.push(structuredClone(duplicate.companies[0]));duplicate.source.rowControl.sourceRowCount=2;duplicate.source.rowControl.acceptedRowCount=2;duplicate.accountBookControl.total=2;duplicate.accountBookControl.open=2;duplicate.source.catalogHash=wbsCompanyCatalogCanonicalHash(duplicate);assert.ok(normalizeWbsCompanyCatalogCandidate(duplicate).findings.some(item=>item.code==='COMPANY_CODE_DUPLICATE'));
});

test('HTTP contract is authenticated, bounded, no-store, idempotent, CAS-controlled, and entity-scoped',async()=>{
  const tenantId=randomUUID(),entityId=randomUUID(),candidateId=randomUUID(),rowId=randomUUID(),calls=[];
  const kernel={
    retainWbsCompanyCatalogCandidate:async value=>(calls.push(['retain',value]),{wbs_company_catalog_candidate_id:candidateId,revision:0,idempotent:false}),
    listWbsCompanyCatalogCandidates:async value=>(calls.push(['list',value]),[]),listWbsCompanyCatalogRows:async value=>(calls.push(['rows',value]),[]),
    classifyWbsCompanyCatalogRow:async value=>(calls.push(['classify',value]),{decision_id:randomUUID(),revision:1,idempotent:false}),
    approveWbsCompanyCatalogRow:async value=>(calls.push(['approve',value]),{decision_id:randomUUID(),revision:2,idempotent:false,can_create_mapping_snapshot:false})
  };
  const api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'oidc|controller'}),kernelFactory:async()=>kernel}),base=`/api/v1/entities/${entityId}`;
  let response=await api({method:'POST',url:`${base}/wbs/company-catalogs`,headers:{'Idempotency-Key':'catalog-retain-001'},body:{catalog:candidate()}});assert.equal(response.status,201);assert.equal(response.headers['cache-control'],'no-store');assert.equal(calls[0][1].tenantId,tenantId);assert.equal(calls[0][1].entityId,entityId);
  response=await api({method:'GET',url:`${base}/wbs/company-catalogs?limit=20&offset=5`});assert.equal(response.status,200);assert.deepEqual(calls.at(-1)[1],{tenantId,entityId,limit:20,offset:5});
  response=await api({method:'GET',url:`${base}/wbs/company-catalogs/${candidateId}/companies?limit=50&offset=0`});assert.equal(response.status,200);assert.equal(calls.at(-1)[1].candidateId,candidateId);
  const classification={companyCode:'WBPA',displayName:'Wan Pacific Real Estate Development LLC',legalName:'Wan Pacific Real Estate Development LLC',entityType:'LEGAL_ENTITY',activeStatus:'ACTIVE',baseCurrency:'USD'};
  response=await api({method:'POST',url:`${base}/wbs/company-catalog-rows/${rowId}/classifications`,headers:{'Idempotency-Key':'catalog-classify-001','If-Match':'"0"'},body:{classification,reason:'Controller verified the exact legal entity identity.'}});assert.equal(response.status,201);assert.equal(response.headers.etag,'"1"');assert.equal(calls.at(-1)[1].expectedRevision,0);
  response=await api({method:'POST',url:`${base}/wbs/company-catalog-rows/${rowId}/approvals`,headers:{'Idempotency-Key':'catalog-approve-001','If-Match':'"1"'},body:{expectedCatalogHash:candidate().source.catalogHash,expectedRowHash:hash('2'),effectiveFrom:'2026-01-01',effectiveTo:null,reason:'Controller approves the exact source-bound company binding.'}});assert.equal(response.status,201);assert.equal(response.body.data.can_create_mapping_snapshot,false);
  assert.equal((await api({method:'POST',url:`${base}/wbs/company-catalog-rows/${rowId}/approvals`,headers:{'Idempotency-Key':'catalog-approve-002'},body:{expectedCatalogHash:hash('1'),expectedRowHash:hash('2'),effectiveFrom:'2026-01-01',effectiveTo:null,reason:'Controller approves the exact source-bound company binding.'}})).status,428);
  assert.equal((await api({method:'GET',url:`${base}/wbs/company-catalogs?limit=101`})).status,400);
});

test('migration contract is append-only, RLS, SoD/audit/outbox bound, and never creates accounting mappings',async()=>{
  const up=await readFile(resolve(root,'db/migrations/136_wbs_company_catalog_controller.sql'),'utf8'),down=await readFile(resolve(root,'db/migrations/down/136_wbs_company_catalog_controller.sql'),'utf8');
  for(const token of ['wbs_company_catalog_candidate','wbs_company_catalog_candidate_row','wbs_company_catalog_validation_finding','wbs_company_catalog_controller_decision','ENABLE ROW LEVEL SECURITY','reject_mutation','WBS.COMPANY.CATALOG.RETAIN','WBS.COMPANY.CATALOG.CLASSIFY','WBS.COMPANY.CATALOG.APPROVE','idempotency_receipt','audit_event','outbox_event','source_row_count=accepted_row_count+rejected_row_count','classification company code must equal the exact retained WBS company code','retention, classification, and approval actors must be distinct','Entity is already bound to a different WBS company'])assert.ok(up.toLowerCase().includes(token.toLowerCase()),`missing migration token: ${token}`);
  assert.doesNotMatch(up,/INSERT\s+INTO\s+mapping_snapshot/i);assert.match(up,/'can_create_mapping_snapshot',false/);assert.match(down,/DROP TABLE wbs_company_catalog_candidate/);
});
