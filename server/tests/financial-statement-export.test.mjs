import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {buildFinancialStatementCsv,validFinancialStatementExportRows} from '../runtime/financial-statement-export.mjs';
import {createAccountingApi} from '../api/accounting-http.mjs';

const id=n=>`${String(n).padStart(8,'0')}-1111-4111-8111-${String(n).padStart(12,'0')}`;
const tenantId=id(1),entityId=id(2),periodId=id(3),snapshotId=id(4),hash='sha256:'+'a'.repeat(64),row={financial_statement_snapshot_id:snapshotId,version:'1',currency:'USD',snapshot_hash:hash,ledger_evidence_hash:hash,prepared_by:'preparer',approved_by:'approver',approved_at:'2026-09-13T00:00:00.000Z',captured_at:'2026-09-13T00:00:00.000Z',statement_type:'TRIAL_BALANCE',statement_section:'Cash',classification_basis:'approved COA',account_code:'100001',account_name:'Cash',opening_debit:'1.0000',opening_credit:'0.0000',period_debit:'2.0000',period_credit:'0.0000',ending_debit:'3.0000',ending_credit:'0.0000',display_balance:'3.0000',journal_entry_ids:[id(5)],journal_line_ids:[id(6)],ledger_line_ids:[id(7)],source_document_ids:[id(8)],row_hash:hash};

test('financial statement export is deterministic, hash-bound, and rejects drift',()=>{
  const artifact=buildFinancialStatementCsv({rows:[row],entityId,periodId});
  assert.ok(artifact);assert.equal(artifact.format,'CSV');assert.equal(artifact.row_count,1);assert.match(artifact.content,/financial_statement_snapshot_id/);assert.match(artifact.content_hash,/^sha256:[a-f0-9]{64}$/);assert.equal(buildFinancialStatementCsv({rows:[row],entityId,periodId}).content_hash,artifact.content_hash);assert.equal(validFinancialStatementExportRows([{...row,account_code:'100002'}]),true);assert.equal(buildFinancialStatementCsv({rows:[{...row,approved_by:'preparer'}],entityId,periodId}),null);assert.equal(buildFinancialStatementCsv({rows:[{...row,display_balance:'3.00'}],entityId,periodId}),null);
});

test('financial statement export HTTP is a no-store read with closed format and raw CSV body',async()=>{
  const calls=[];const api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'reader'}),kernelFactory:async()=>({getFinancialStatementSnapshot:async args=>(calls.push(args),[row])})});
  const url=`/api/v1/entities/${entityId}/reports/financial-statement-snapshot/export?periodId=${periodId}&format=csv`;
  const response=await api({method:'GET',url,headers:{}});assert.equal(response.status,200);assert.equal(response.headers['content-type'],'text/csv; charset=utf-8');assert.equal(response.headers['cache-control'],'no-store');assert.match(response.rawBody,/statement_type/);assert.equal(calls.length,1);assert.deepEqual(calls[0],{tenantId,entityId,periodId});
  assert.equal((await api({method:'GET',url:url+'&extra=x',headers:{}})).status,400);assert.equal((await api({method:'GET',url:url.replace('format=csv','format=json'),headers:{}})).status,400);assert.equal((await api({method:'GET',url,headers:{'idempotency-key':'forbidden'}})).status,400);assert.equal((await api({method:'GET',url,headers:{},body:{}})).status,400);
});

test('financial statement export is declared as an authenticated CSV OpenAPI operation',async()=>{
  const contract=JSON.parse(await readFile(new URL('../api/openapi-accounting.json',import.meta.url),'utf8')),operation=contract.paths['/entities/{entityId}/reports/financial-statement-snapshot/export']?.get;
  assert.equal(operation?.operationId,'exportFinancialStatementSnapshot');assert.deepEqual(operation.parameters.map(parameter=>parameter.name||parameter.$ref),['#/components/parameters/EntityId','periodId','format']);assert.deepEqual(operation.parameters.find(parameter=>parameter.name==='format').schema.enum,['csv']);assert.equal(operation.responses['200'].$ref,'#/components/responses/FinancialStatementSnapshotExportOk');assert.equal(contract.components.responses.FinancialStatementSnapshotExportOk.content['text/csv'].schema.format,'binary');
});
