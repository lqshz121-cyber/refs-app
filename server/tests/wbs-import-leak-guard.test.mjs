// H07: WBS import security / sensitive-data leak guards.
//  1. A provider row carrying names, memos, e-mails, tax ids and bank numbers
//     must leave the live-pilot observation as hash + amount + date + status only.
//  2. A provider failure (401/403/500/garbage) must never surface header values
//     or response bodies in the error the API can log or return.
//  3. The test-import scope resolver may not swap the deployment-pinned entity
//     or company for another one (H01-F3).
//  4. The receipts/task-file convention: no credential-like keys may sit in a
//     catalog probe artifact (re-uses the probe's own guard).
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {buildWbsLivePilotObservation} from '../runtime/wbs-live-pilot-read-service.mjs';
import {createReadOnlyWbsMcpClient,WBS_MCP_APPROVED_ENDPOINT} from '../runtime/wbs-readonly-mcp.mjs';
import {createWbsTestImportService,WbsTestImportError} from '../runtime/wbs-test-import-service.mjs';
import {assertArtifactHasNoNamesOrSecrets} from '../tools/wbs-company-catalog-probe.mjs';

const SENSITIVE={vendor_name:'Acme Plumbing LLC',memo:'pay John Q. Public for unit 4B',email:'john.public@example.com',tax_id:'12-3456789',bank_account_no:'000123456789',company_name:'Wan Pacific LLC',address:'1 Main St',phone:'+1 555 0100',invoice_no:'INV-9981',notes:'ssn 123-45-6789'};

test('sanitized live-pilot rows carry no provider text fields, only hash/amount/date/status',()=>{
  const entityId=randomUUID();
  for(const [tool,row] of [
    ['list_payables',{ap_guid:'ap-1',posting_date:'2026-08-06 00:00:00',amount:'123.45000',pay_status:'CLEAR',...SENSITIVE}],
    ['list_bank_transactions',{cb_id:77,set_date:'2026-08-03',debtor:'0.00000',lender:'50.00000',review:'Y',...SENSITIVE}],
    ['list_journal_entries',{id:5,posting_date:'2026-08-03',debtor:'10.00000',lender:'0',review:'1',...SENSITIVE}],
    ['list_autorec_details',{pd_guid:'pd-1',clear_date:'2026-08-01',payment:'1.00000',deposit:'0',status:'I',match_status:'M',...SENSITIVE}],
    ['list_autorec_banks',{pb_guid:'pb-1',pay_amount:'1',debit_amount:'2',quantity:'3',released:'4',released_quantity:'5',incurred:'6',status:'N',...SENSITIVE}]
  ]){
    const observed={rows:[row],scope:{company_codes:['WBPA'],date_range:['2026-08-01','2026-08-31']},captured_at:'2026-09-17T09:00:00Z',content_sha256:'a'.repeat(64)};
    const observation=buildWbsLivePilotObservation({observed,entityId,tool,requestedScope:{company_code:'WBPA',date_from:'2026-08-01',date_to:'2026-08-31'}});
    const text=JSON.stringify(observation);
    for(const [key,value] of Object.entries(SENSITIVE)){assert.equal(text.includes(value),false,`${tool}: leaked value of ${key}`);assert.equal(Object.hasOwn(observation.rows[0],key),false,`${tool}: leaked key ${key}`);}
    assert.equal(text.includes('ap-1')||text.includes('pd-1')||text.includes('pb-1'),false,`${tool}: stable key must be hashed, not copied`);
    assert.match(observation.rows[0].source_record_hash,/^sha256:[0-9a-f]{64}$/);
    assert.equal(observation.can_import,false);assert.equal(observation.can_post,false);
  }
});

test('provider failures never echo auth headers or response bodies into the thrown error',async()=>{
  const secret={'CF-Access-Client-Id':'client-id-SENTINEL-1','CF-Access-Client-Secret':'client-secret-SENTINEL-2','X-REFS-Auth':'refs-auth-SENTINEL-3'};
  const bodies=[[401,'{"error":"BODY-SENTINEL-401"}'],[403,'BODY-SENTINEL-403'],[500,'<html>BODY-SENTINEL-500</html>'],[200,'not json BODY-SENTINEL-200']];
  for(const [status,body] of bodies){
    const fetcher=async()=>new Response(body,{status,headers:{'content-type':status===200?'application/json':'text/plain'}});
    const client=createReadOnlyWbsMcpClient({endpoint:WBS_MCP_APPROVED_ENDPOINT,getAuthHeaders:()=>({...secret}),allowedReadTools:['list_payables'],fetcher});
    let caught=null;try{await client.initialize();}catch(error){caught=error;}
    assert.ok(caught,`status ${status} must throw`);
    const text=`${caught.code} ${caught.message} ${JSON.stringify(Object.getOwnPropertyNames(caught).map(k=>caught[k]))}`;
    for(const value of Object.values(secret))assert.equal(text.includes(value),false,`status ${status}: header value leaked`);
    assert.equal(/BODY-SENTINEL/.test(text),false,`status ${status}: response body leaked into error`);
    assert.match(String(caught.code||''),/^WBS_MCP_/);
  }
});

test('test-import scope resolver cannot replace the deployment-pinned entity or company (H01-F3)',async()=>{
  const tenantId=randomUUID(),pinnedEntity=randomUUID(),otherEntity=randomUUID();
  const actors=Object.fromEntries(['importer','reconciliationStarter','maker','paymentMaker','matchMaker','submitter','reviewer','approver','poster','clearer','reopener'].map(role=>[role,`wbs-test-${role}`]));
  const scope={tenantId,entityId:pinnedEntity,companyCode:'WBPA',actors};
  const pilotService={readObservation:async()=>{throw new Error('provider must not be reached when scope is denied');},readObservationPage:async()=>{throw new Error('unreachable');}};
  const kernelForActor=()=>({retainWbsTestPayableSource:async()=>{},createWbsTestPayableDraft:async()=>{},createWbsControlledTestBankScope:async()=>{}});
  const build=resolveScope=>createWbsTestImportService({scope,resolveScope,pilotService,kernelForActor,authorizeBank:async()=>true});
  const selection={tenantId,periodId:randomUUID(),companyCode:'WBPA',dateFrom:'2026-08-01',dateTo:'2026-08-31',limit:10,idempotencyKey:'h07-scope-denied-0001'};
  // a resolver that "finds" the requested (other) entity as WBPA must still be refused
  await assert.rejects(build(async()=>({tenantId,entityId:otherEntity,companyCode:'WBPA'})).importPayables({...selection,entityId:otherEntity}),e=>e instanceof WbsTestImportError&&e.code==='WBS_TEST_IMPORT_SCOPE_DENIED');
  // a resolver that widens the company is refused too
  await assert.rejects(build(async()=>({tenantId,entityId:pinnedEntity,companyCode:'OTHR'})).importPayables({...selection,companyCode:'OTHR',entityId:pinnedEntity}),e=>e.code==='WBS_TEST_IMPORT_SCOPE_DENIED');
  // the pinned entity + company reach the provider (which we make fail loudly to prove the gate opened)
  await assert.rejects(build(async()=>({tenantId,entityId:pinnedEntity,companyCode:'WBPA'})).importPayables({...selection,entityId:pinnedEntity}),/provider must not be reached/);
});

test('a catalog probe artifact with a credential-like key or a leaked field is refused by the artifact guard',()=>{
  const good={companies:[{company_code:'WBPA',name_status:'NAME_OK',name_sha256:`sha256:${'b'.repeat(64)}`,name_length:12,consolidation_node:false,source_row_key_sha256:null,first_seen_page:1,row_ordinal:0}]};
  assert.equal(assertArtifactHasNoNamesOrSecrets(good),true);
  assert.throws(()=>assertArtifactHasNoNamesOrSecrets({...good,authorization:'Bearer x'}),/credential-like/);
  assert.throws(()=>assertArtifactHasNoNamesOrSecrets({companies:[{...good.companies[0],company_name:'Wan Pacific'}]}),/leaks unexpected fields/);
});
