import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createAccountingApi} from '../api/accounting-http.mjs';
import {PostgresAccountingKernel} from '../runtime/kernel-repository.mjs';
import {MIGRATION_MANIFEST} from '../runtime/migration-manifest.mjs';

const up=await readFile(new URL('../db/migrations/064_journal_entry_line_read.sql',import.meta.url),'utf8');
const down=await readFile(new URL('../db/migrations/down/064_journal_entry_line_read.sql',import.meta.url),'utf8');
const contract=JSON.parse(await readFile(new URL('../api/openapi-accounting.json',import.meta.url),'utf8'));

// Amounts are compared as integer minor units. A test that reached for a float would be
// asserting the wrong contract.
const minorUnits=value=>BigInt(String(value).replace('.',''));

test('journal entry line SQL is scoped, authorized, source-linked, reversible and read-only',()=>{
  for(const token of ["'GL.JE.VIEW'",'refs_assert_scope','SECURITY DEFINER','SET search_path=pg_catalog,public,pg_temp','public\\.journal_line','public\\.ledger_line','public\\.source_link','jl\\.tenant_id=p_tenant','jl\\.entity_id=p_entity','jl\\.journal_entry_id=p_journal_entry_id','REVOKE ALL','GRANT EXECUTE ON FUNCTION refs_get_journal_entry_lines\\(uuid,uuid,uuid\\) TO refs_app'])assert.match(up,new RegExp(token));
  for(const column of ['line_no','account_code','debit_amount numeric\\(20,4\\)','credit_amount numeric\\(20,4\\)','member_ref','dimensions jsonb','ledger_line_id','source_document_id'])assert.match(up,new RegExp(column));
  assert.match(up,/REVOKE ALL ON FUNCTION refs_get_journal_entry_lines\(uuid,uuid,uuid\) FROM PUBLIC/);
  // A read path must never write, and must never create a second GL.JE.VIEW permission row.
  assert.doesNotMatch(up,/\b(?:INSERT INTO|UPDATE|DELETE FROM|TRUNCATE)\b/i);
  assert.doesNotMatch(up,/permission_catalog/i);
  assert.match(down,/DROP FUNCTION refs_get_journal_entry_lines\(uuid,uuid,uuid\)/);
  assert.match(down,/REVOKE EXECUTE ON FUNCTION refs_get_journal_entry_lines\(uuid,uuid,uuid\) FROM refs_app/);
  // GL.JE.VIEW belongs to 057; rolling 064 back must not disable the list read.
  assert.doesNotMatch(down,/permission_catalog/i);
});

test('migration 064 is the newest manifest entry and both checksums are real',async()=>{
  const entry=MIGRATION_MANIFEST.at(-1);
  assert.equal(entry.name,'064_journal_entry_line_read.sql');
  assert.equal(createHash('sha256').update(up.replace(/\r\n/g,'\n')).digest('hex'),entry.up);
  assert.equal(createHash('sha256').update(down.replace(/\r\n/g,'\n')).digest('hex'),entry.down);
});

test('OpenAPI exposes the line read without mutating the JournalLine write contract',()=>{
  const operation=contract.paths['/entities/{entityId}/journal-entries/{journalEntryId}/lines'].get;
  assert.equal(operation.operationId,'getJournalEntryLines');
  assert.deepEqual(operation.parameters,[{$ref:'#/components/parameters/EntityId'},{$ref:'#/components/parameters/JournalEntryId'}]);
  assert.equal(operation.responses['200'].$ref,'#/components/responses/JournalEntryLineReadOk');
  assert.equal(operation.responses.default.$ref,'#/components/responses/Problem');
  assert.match(operation.description,/cannot create, edit, post, export, or persist/i);
  assert.equal(contract.components.responses.JournalEntryLineReadOk.headers['Cache-Control'].schema.const,'no-store');
  const row=contract.components.schemas.JournalEntryLineReadRow;
  assert.equal(row.additionalProperties,false);
  assert.deepEqual(row.required,['journal_entry_id','journal_line_id','line_no','account_code','account_name','debit_amount','credit_amount','currency','dimensions','period_id']);
  // Read amounts are canonical decimal strings. #/components/schemas/Money is a JSON
  // number and stays reserved for the write path it already serves.
  for(const field of ['debit_amount','credit_amount']){
    assert.equal(row.properties[field].type,'string');
    assert.equal(row.properties[field].pattern,'^[0-9]+\\.[0-9]{4}$');
  }
  assert.equal(contract.components.schemas.Money.type,'number');
  assert.equal(contract.components.schemas.JournalLine.properties.debit_amount.$ref,'#/components/schemas/Money');
});

test('the repository issues one scoped read-only call',async()=>{
  const calls=[],kernel=Object.create(PostgresAccountingKernel.prototype);
  kernel.inSession=async work=>work({query:async(sql,args)=>{calls.push({sql,args});return {rows:[{line_no:1}]};}});
  assert.deepEqual(await kernel.getJournalEntryLines({tenantId:'tenant',entityId:'entity',journalEntryId:'journal'}),[{line_no:1}]);
  assert.deepEqual(calls,[{sql:'SELECT * FROM refs_get_journal_entry_lines($1,$2,$3)',args:['tenant','entity','journal']}]);
});

test('HTTP line read is authenticated, path-scoped, no-store, body-free and balanced',async()=>{
  const tenantId=randomUUID(),entityId=randomUUID(),journalEntryId=randomUUID(),periodId=randomUUID();
  const lines=[
    {journal_entry_id:journalEntryId,journal_line_id:randomUUID(),line_no:1,account_code:'610000',account_name:'Operating Expense',debit_amount:'100.2500',credit_amount:'0.0000',currency:'USD',member_ref:null,description:'Expense',dimensions:{},period_id:periodId,ledger_line_id:null,posted_at:null,source_document_id:randomUUID()},
    {journal_entry_id:journalEntryId,journal_line_id:randomUUID(),line_no:2,account_code:'111000',account_name:'Cash',debit_amount:'0.0000',credit_amount:'100.2500',currency:'USD',member_ref:'BANK-1',description:null,dimensions:{},period_id:periodId,ledger_line_id:null,posted_at:null,source_document_id:null}
  ];
  const scopes=[];
  const api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'je-reader'}),kernelFactory:async()=>({getJournalEntryLines:async scope=>{scopes.push(scope);return lines;}})});
  const url=`/api/v1/entities/${entityId}/journal-entries/${journalEntryId}/lines`;
  const response=await api({method:'GET',url,headers:{},body:null});
  assert.equal(response.status,200);
  assert.equal(response.headers['cache-control'],'no-store');
  assert.equal(response.body.ok,true);
  assert.deepEqual(response.body.data,lines);
  // Tenant comes from the authenticated principal; entity and journal come from the path.
  assert.deepEqual(scopes,[{tenantId,entityId,journalEntryId}]);

  const totals=response.body.data.reduce((carry,row)=>({debit:carry.debit+minorUnits(row.debit_amount),credit:carry.credit+minorUnits(row.credit_amount)}),{debit:0n,credit:0n});
  assert.equal(totals.debit,1002500n);
  assert.equal(totals.debit,totals.credit);

  assert.equal((await api({method:'GET',url,headers:{'idempotency-key':'forbidden-read-key'},body:null})).body.code,'IDEMPOTENCY_KEY_NOT_ALLOWED');
  assert.equal((await api({method:'GET',url,headers:{},body:{}})).body.code,'READ_BODY_FORBIDDEN');
  assert.equal((await api({method:'GET',url,headers:{},body:{tenantId:randomUUID()}})).body.code,'IDENTITY_FIELD_FORBIDDEN');
  assert.equal((await api({method:'GET',url:`${url}?extra=1`,headers:{},body:null})).body.code,'UNEXPECTED_QUERY_PARAMETER');
  assert.equal((await api({method:'GET',url:`/api/v1/entities/${entityId}/journal-entries/not-a-uuid/lines`,headers:{},body:null})).body.code,'INVALID_PATH_PARAMETER');
  assert.equal((await api({method:'GET',url:`/api/v1/entities/not-a-uuid/journal-entries/${journalEntryId}/lines`,headers:{},body:null})).body.code,'INVALID_PATH_PARAMETER');
  assert.equal((await api({method:'POST',url,headers:{'idempotency-key':'command-key-0001'},body:{}})).status,404);

  const anonymous=createAccountingApi({authenticate:async()=>null,kernelFactory:async()=>{throw new Error('must not reach the kernel');}});
  assert.equal((await anonymous({method:'GET',url,headers:{},body:null})).status,401);
  const untrusted=createAccountingApi({authenticate:async()=>({trusted:false,tenantId,actorId:'je-reader'}),kernelFactory:async()=>{throw new Error('must not reach the kernel');}});
  assert.equal((await untrusted({method:'GET',url,headers:{},body:null})).status,401);
  const denied=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'no-grant'}),kernelFactory:async()=>({getJournalEntryLines:async()=>{throw Object.assign(new Error('Permission GL.JE.VIEW denied'),{code:'42501'});}})});
  assert.equal((await denied({method:'GET',url,headers:{},body:null})).status,403);
  // Another tenant's Journal Entry is simply not in scope: an empty, non-leaking read.
  const foreign=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'je-reader'}),kernelFactory:async()=>({getJournalEntryLines:async()=>[]})});
  const empty=await foreign({method:'GET',url,headers:{},body:null});
  assert.equal(empty.status,200);assert.deepEqual(empty.body,{ok:true,data:[]});
});
