import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createAccountingApi} from '../api/accounting-http.mjs';
import {PostgresAccountingKernel} from '../runtime/kernel-repository.mjs';

test('financial statement snapshots are append-only, canonical POSTED-ledger captures with a separate maker permission',async()=>{
  const up=await readFile(new URL('../db/migrations/108_financial_statement_snapshot.sql',import.meta.url),'utf8');
  const down=await readFile(new URL('../db/migrations/down/108_financial_statement_snapshot.sql',import.meta.url),'utf8');
  for(const token of ['GL.REPORT.SNAPSHOT.CREATE','CREATE TABLE financial_statement_snapshot','financial_statement_snapshot_append_only','refs_create_financial_statement_snapshot','refs_get_financial_statements','refs_financial_statement_snapshot_hash','refs_financial_statement_snapshot_request_hash','refs_list_financial_statement_snapshots','refs_get_financial_statement_snapshot','FINANCIAL_STATEMENT_SNAPSHOT_CAPTURED','POSTED_LEDGER','idempotency_receipt','audit_event','outbox_event','REVOKE ALL','GRANT EXECUTE'])assert.match(up,new RegExp(token));
  assert.match(up,/PERFORM refs_assert_scope\(p_tenant,p_entity,'GL\.REPORT\.SNAPSHOT\.CREATE'\)/);
  assert.match(up,/PERFORM refs_assert_scope\(p_tenant,p_entity,'GL\.REPORT\.VIEW'\)/);
  assert.doesNotMatch(up,/\b(?:INSERT INTO journal_entry|UPDATE journal_entry|DELETE FROM journal_entry|INSERT INTO ledger_line|UPDATE ledger_line|DELETE FROM ledger_line|refs_post_journal)\b/i);
  for(const token of ['DROP FUNCTION refs_get_financial_statement_snapshot','DROP FUNCTION refs_list_financial_statement_snapshots','DROP FUNCTION refs_create_financial_statement_snapshot','DROP TRIGGER financial_statement_snapshot_append_only','DROP TABLE financial_statement_snapshot'])assert.match(down,new RegExp(token));
});

test('repository delegates snapshot capture and reads to PostgreSQL functions',async()=>{
  const calls=[],kernel=Object.create(PostgresAccountingKernel.prototype);
  kernel.inSession=async work=>work({query:async(sql,args)=>{calls.push({sql,args});return {rowCount:1,rows:sql.includes('request_hash')?[{request_hash:'sha256:'+('a'.repeat(64))}]:[{result:{status:'CAPTURED'}}]};}});
  const result=await kernel.createFinancialStatementSnapshot({tenantId:'tenant',entityId:'entity',periodId:'period',reason:'Capture signed close evidence',idempotencyKey:'report-snapshot-0001'});
  assert.equal(result.status,'CAPTURED');assert.equal(calls[0].sql,'SELECT refs_financial_statement_snapshot_request_hash($1,$2,$3,$4) AS request_hash');assert.equal(calls[1].sql,'SELECT refs_create_financial_statement_snapshot($1,$2,$3,$4,$5,$6) AS result');assert.equal(calls[1].args.slice(0,5).join('|'),'tenant|entity|period|Capture signed close evidence|report-snapshot-0001');assert.match(calls[1].args[5],/^sha256:[0-9a-f]{64}$/);
  calls.length=0;kernel.inSession=async work=>work({query:async(sql,args)=>{calls.push({sql,args});return {rows:[{version:'1'}]};}});
  assert.deepEqual(await kernel.listFinancialStatementSnapshots({tenantId:'tenant',entityId:'entity',periodId:'period'}),[{version:'1'}]);assert.equal(calls[0].sql,'SELECT * FROM refs_list_financial_statement_snapshots($1,$2,$3)');
  calls.length=0;assert.deepEqual(await kernel.getFinancialStatementSnapshot({tenantId:'tenant',entityId:'entity',financialStatementSnapshotId:'snapshot'}),[{version:'1'}]);assert.equal(calls[0].sql,'SELECT * FROM refs_get_financial_statement_snapshot($1,$2,$3)');
});

test('snapshot HTTP commands are idempotent and reads remain no-store/bodyless',async()=>{
  const tenantId=randomUUID(),entityId=randomUUID(),periodId=randomUUID(),snapshotId=randomUUID(),calls=[];
  const api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'report-snapshot-maker'}),kernelFactory:async()=>({
    createFinancialStatementSnapshot:async value=>{calls.push(['create',value]);return {financial_statement_snapshot_id:snapshotId,status:'CAPTURED',idempotent:false};},
    listFinancialStatementSnapshots:async value=>{calls.push(['list',value]);return [{financial_statement_snapshot_id:snapshotId}];},
    getFinancialStatementSnapshot:async value=>{calls.push(['get',value]);return [{financial_statement_snapshot_id:snapshotId}];}
  })});
  const base=`/api/v1/entities/${entityId}/reports/financial-statement-snapshots`;
  let response=await api({method:'POST',url:base,headers:{'idempotency-key':'report-snapshot-0001'},body:{periodId,reason:'Capture retained close evidence'}});
  assert.equal(response.status,201);assert.equal(response.headers['cache-control'],'no-store');assert.deepEqual(calls[0],['create',{tenantId,entityId,periodId,reason:'Capture retained close evidence',idempotencyKey:'report-snapshot-0001'}]);
  response=await api({method:'GET',url:`${base}?periodId=${periodId}`,headers:{},body:null});assert.equal(response.status,200);assert.equal(response.headers['cache-control'],'no-store');assert.deepEqual(calls[1],['list',{tenantId,entityId,periodId}]);
  response=await api({method:'GET',url:`${base}/${snapshotId}`,headers:{},body:null});assert.equal(response.status,200);assert.deepEqual(calls[2],['get',{tenantId,entityId,financialStatementSnapshotId:snapshotId}]);
  assert.equal((await api({method:'POST',url:base,headers:{'idempotency-key':'short'},body:{periodId,reason:'Capture retained close evidence'}})).body.code,'IDEMPOTENCY_KEY_REQUIRED');
  assert.equal((await api({method:'GET',url:`${base}?periodId=${periodId}`,headers:{'idempotency-key':'forbidden'},body:null})).body.code,'READ_COMMAND_HEADERS_FORBIDDEN');
  assert.equal((await api({method:'GET',url:`${base}/${snapshotId}`,headers:{},body:{}})).body.code,'READ_BODY_FORBIDDEN');
});
