import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createAccountingApi} from '../api/accounting-http.mjs';

const tenantId=randomUUID(),entityId=randomUUID(),periodId=randomUUID(),journalEntryId=randomUUID();
const detail={entity_id:entityId,period_id:periodId,journal_entry_id:journalEntryId,journal_number:'JE-1',journal_type:'MANUAL',status:'DRAFT',journal_date:'2026-08-01',currency:'USD',description:null,revision:'1',created_at:'2026-08-01T00:00:00.000Z',posted_at:null,lines:[{line_no:1,journal_line_id:randomUUID(),ledger_line_id:null,account_code:'111000',debit_amount:'1.0000',credit_amount:'0.0000',member_ref:null,description:null,dimensions:{},source_document_ids:[]}]};

const makeApi=(read=async()=>detail,authenticate=async()=>({trusted:true,tenantId,actorId:'reader'}))=>createAccountingApi({authenticate,kernelFactory:async()=>({getJournalEntryDetail:read})});
const request=(api,url=`/api/v1/entities/${entityId}/journal-entries/${journalEntryId}?periodId=${periodId}`,extra={})=>api({method:'GET',url,body:null,headers:{},...extra});

test('Journal Entry detail is an exact no-store GET and derives tenant identity from OIDC',async()=>{
  const calls=[],api=makeApi(async input=>(calls.push(input),detail));
  const response=await request(api);
  assert.equal(response.status,200);assert.equal(response.headers['cache-control'],'no-store');assert.deepEqual(response.body,{ok:true,data:detail});
  assert.deepEqual(calls,[{tenantId,entityId,periodId,journalEntryId}]);
});

test('Journal Entry detail rejects command headers, bodies, ambiguous query, and invalid identities',async()=>{
  const api=makeApi();
  assert.equal((await request(api,undefined,{headers:{'Idempotency-Key':'not-a-read'}})).body.code,'IDEMPOTENCY_KEY_NOT_ALLOWED');
  assert.equal((await request(api,undefined,{headers:{'If-Match':'"1"'}})).body.code,'IF_MATCH_NOT_ALLOWED');
  assert.equal((await request(api,undefined,{body:{periodId}})).body.code,'READ_BODY_FORBIDDEN');
  assert.equal((await request(api,`/api/v1/entities/${entityId}/journal-entries/${journalEntryId}`)).body.code,'INVALID_PATH_PARAMETER');
  assert.equal((await request(api,`/api/v1/entities/${entityId}/journal-entries/${journalEntryId}?periodId=${periodId}&periodId=${periodId}`)).body.code,'DUPLICATE_QUERY_PARAMETER');
  assert.equal((await request(api,`/api/v1/entities/${entityId}/journal-entries/${journalEntryId}?periodId=${periodId}&limit=1`)).body.code,'UNEXPECTED_QUERY_PARAMETER');
  assert.equal((await request(api,`/api/v1/entities/${entityId}/journal-entries/not-a-uuid?periodId=${periodId}`)).body.code,'INVALID_PATH_PARAMETER');
});

test('Journal Entry detail is anonymous-401, permission-403, and scope-nondisclosing-404',async()=>{
  assert.equal((await request(makeApi(async()=>detail,async()=>null))).status,401);
  const denied=Object.assign(new Error('hidden grant detail'),{code:'42501'});
  const forbidden=await request(makeApi(async()=>{throw denied;}));assert.equal(forbidden.status,403);assert.doesNotMatch(forbidden.body.message,/hidden/);
  const absent=Object.assign(new Error('hidden record detail'),{code:'P0002'});
  const notFound=await request(makeApi(async()=>{throw absent;}));assert.equal(notFound.status,404);assert.equal(notFound.body.code,'JOURNAL_ENTRY_NOT_FOUND');
});

test('Journal Entry detail OpenAPI is closed, fixed-money, nullable-ledger, and GET-only',async()=>{
  const contract=JSON.parse(await readFile(new URL('../api/openapi-accounting.json',import.meta.url),'utf8'));
  const path=contract.paths['/entities/{entityId}/journal-entries/{journalEntryId}'];assert.ok(path.get);assert.equal(path.post,undefined);
  assert.equal(path.get.requestBody,undefined);assert.equal(path.get.responses['200'].$ref,'#/components/responses/JournalEntryDetailReadOk');
  assert.deepEqual(path.get.parameters.map(item=>item.$ref||item.name),['#/components/parameters/EntityId','#/components/parameters/JournalEntryId','periodId']);
  const row=contract.components.schemas.JournalEntryDetailReadRow,line=contract.components.schemas.JournalEntryDetailLine;
  assert.equal(row.additionalProperties,false);assert.equal(line.additionalProperties,false);assert.equal(line.properties.debit_amount.pattern,'^(?:0|[1-9][0-9]{0,15})\\.[0-9]{4}$');
  assert.deepEqual(line.properties.ledger_line_id.oneOf,[{'$ref':'#/components/schemas/Uuid'},{type:'null'}]);
});

test('095 read migration enforces view scope, exact period, ordered lines, and real ledger linkage',async()=>{
  const up=await readFile(new URL('../db/migrations/095_journal_entry_detail_read.sql',import.meta.url),'utf8');
  const down=await readFile(new URL('../db/migrations/down/095_journal_entry_detail_read.sql',import.meta.url),'utf8');
  assert.match(up,/refs_assert_scope\(p_tenant,p_entity,'GL\.JE\.VIEW'\)/);assert.match(up,/ap\.period_id=p_period/);assert.match(up,/j\.period_id=p_period AND j\.journal_entry_id=p_journal/);
  assert.match(up,/CASE WHEN j\.status='POSTED' THEN ll\.ledger_line_id ELSE NULL END/);assert.match(up,/ORDER BY jl\.line_no,jl\.journal_line_id/);
  assert.match(up,/REVOKE ALL ON FUNCTION refs_get_journal_entry_detail/);assert.match(up,/GRANT EXECUTE ON FUNCTION refs_get_journal_entry_detail/);
  assert.match(down,/DROP FUNCTION refs_get_journal_entry_detail/);
});
