import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createAccountingApi} from '../api/accounting-http.mjs';
import {PostgresAccountingKernel} from '../runtime/kernel-repository.mjs';

test('financial statement SQL is POSTED-only, scoped, traceable, reversible, and read-only',async()=>{
  const up=await readFile(new URL('../db/migrations/062_financial_statement_read.sql',import.meta.url),'utf8');
  const down=await readFile(new URL('../db/migrations/down/062_financial_statement_read.sql',import.meta.url),'utf8');
  for(const token of ["'GL.REPORT.VIEW'",'refs_assert_scope','p.tenant_id=p_tenant','p.entity_id=p_entity','p.period_id=p_period',"j.status='POSTED'",'journal_entry_ids','journal_line_ids','ledger_line_ids','source_document_ids','ACCOUNT_CODE_PREFIX_AND_BANK_MEMBER','REVOKE ALL','GRANT EXECUTE'])assert.match(up,new RegExp(token));
  for(const statement of ['TRIAL_BALANCE','BALANCE_SHEET','INCOME_STATEMENT','CASH_FLOW'])assert.match(up,new RegExp(statement));
  assert.match(up,/required_member_type='BANK'/);
  assert.match(up,/DIRECT_CASH_MOVEMENT/);
  assert.match(up,/direct cash-account movement evidence/);
  assert.match(up,/Operating\/investing\/financing classification is not inferred/);
  assert.doesNotMatch(up,/\b(?:INSERT INTO journal_entry|UPDATE journal_entry|DELETE FROM journal_entry|INSERT INTO ledger_line|UPDATE ledger_line|DELETE FROM ledger_line|refs_post_journal)\b/i);
  assert.match(down,/DROP FUNCTION refs_get_financial_statements/);assert.match(down,/active=false/);assert.doesNotMatch(down,/DELETE FROM permission_catalog/i);
});

test('repository and HTTP expose one authenticated entity-period no-store read',async()=>{
  const calls=[],kernel=Object.create(PostgresAccountingKernel.prototype);
  kernel.inSession=async work=>work({query:async(sql,args)=>{calls.push({sql,args});return {rows:[{statement_type:'TRIAL_BALANCE'}]};}});
  assert.deepEqual(await kernel.getFinancialStatements({tenantId:'tenant',entityId:'entity',periodId:'period'}),[{statement_type:'TRIAL_BALANCE'}]);
  assert.deepEqual(calls,[{sql:'SELECT * FROM refs_get_financial_statements($1,$2,$3)',args:['tenant','entity','period']}]);
  const tenantId=randomUUID(),entityId=randomUUID(),periodId=randomUUID(),httpCalls=[];
  const api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'reader'}),kernelFactory:async()=>({getFinancialStatements:async scope=>{httpCalls.push(scope);return [];}})});
  const response=await api({method:'GET',url:`/api/v1/entities/${entityId}/reports/financial-statements?periodId=${periodId}`,headers:{},body:null});
  assert.equal(response.status,200);assert.equal(response.headers['cache-control'],'no-store');assert.deepEqual(response.body,{ok:true,data:[]});assert.deepEqual(httpCalls,[{tenantId,entityId,periodId}]);
  assert.equal((await api({method:'GET',url:`/api/v1/entities/${entityId}/reports/financial-statements`,headers:{},body:null})).status,400);
  assert.equal((await api({method:'GET',url:`/api/v1/entities/${entityId}/reports/financial-statements?periodId=${periodId}&extra=1`,headers:{},body:null})).body.code,'UNEXPECTED_QUERY_PARAMETER');
  assert.equal((await api({method:'GET',url:`/api/v1/entities/${entityId}/reports/financial-statements?periodId=${periodId}`,headers:{'idempotency-key':'forbidden'},body:null})).body.code,'IDEMPOTENCY_KEY_NOT_ALLOWED');
  assert.equal((await api({method:'GET',url:`/api/v1/entities/${entityId}/reports/financial-statements?periodId=${periodId}`,headers:{},body:{}})).body.code,'READ_BODY_FORBIDDEN');
});

test('financial statement period comparison is a two-period POSTED evidence read that marks missing evidence rather than zero',async()=>{
  const up=await readFile(new URL('../db/migrations/076_financial_statement_period_comparison_read.sql',import.meta.url),'utf8');
  const down=await readFile(new URL('../db/migrations/down/076_financial_statement_period_comparison_read.sql',import.meta.url),'utf8');
  for(const token of ['refs_get_financial_statement_period_comparison',"'GL.REPORT.VIEW'",'refs_assert_scope','p_current_period=p_prior_period','v_prior.ends_on>=v_current.starts_on','refs_get_financial_statements','FULL OUTER JOIN','MISSING_CURRENT_EVIDENCE','MISSING_PRIOR_EVIDENCE','COMPARABLE_POSTED_EVIDENCE','REVOKE ALL','GRANT EXECUTE'])assert.match(up,new RegExp(token));
  assert.doesNotMatch(up,/INSERT INTO journal_entry|UPDATE journal_entry|DELETE FROM journal_entry|INSERT INTO ledger_line|UPDATE ledger_line|DELETE FROM ledger_line|refs_post_journal/i);
  assert.match(down,/DROP FUNCTION refs_get_financial_statement_period_comparison/);
  const calls=[],kernel=Object.create(PostgresAccountingKernel.prototype);
  kernel.inSession=async work=>work({query:async(sql,args)=>{calls.push({sql,args});return {rows:[{comparison_status:'COMPARABLE_POSTED_EVIDENCE'}]};}});
  assert.deepEqual(await kernel.getFinancialStatementPeriodComparison({tenantId:'tenant',entityId:'entity',currentPeriodId:'current',priorPeriodId:'prior'}),[{comparison_status:'COMPARABLE_POSTED_EVIDENCE'}]);
  assert.deepEqual(calls,[{sql:'SELECT * FROM refs_get_financial_statement_period_comparison($1,$2,$3,$4)',args:['tenant','entity','current','prior']}]);
  const tenantId=randomUUID(),entityId=randomUUID(),currentPeriodId=randomUUID(),priorPeriodId=randomUUID(),httpCalls=[];
  const api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'reader'}),kernelFactory:async()=>({getFinancialStatementPeriodComparison:async scope=>{httpCalls.push(scope);return [];}})});
  const base=`/api/v1/entities/${entityId}/reports/financial-statement-period-comparison?currentPeriodId=${currentPeriodId}&priorPeriodId=${priorPeriodId}`;
  const response=await api({method:'GET',url:base,headers:{},body:null});
  assert.equal(response.status,200);assert.equal(response.headers['cache-control'],'no-store');assert.deepEqual(httpCalls,[{tenantId,entityId,currentPeriodId,priorPeriodId}]);
  assert.equal((await api({method:'GET',url:base.replace('&priorPeriodId','&unexpected'),headers:{},body:null})).body.code,'UNEXPECTED_QUERY_PARAMETER');
  assert.equal((await api({method:'GET',url:base,headers:{'idempotency-key':'forbidden'},body:null})).body.code,'IDEMPOTENCY_KEY_NOT_ALLOWED');
  assert.equal((await api({method:'GET',url:base,headers:{},body:{}})).body.code,'READ_BODY_FORBIDDEN');
});

test('dimension profitability is a bounded POSTED-ledger read and never infers a missing dimension',async()=>{
  const up=await readFile(new URL('../db/migrations/074_dimension_profitability_read.sql',import.meta.url),'utf8');
  const down=await readFile(new URL('../db/migrations/down/074_dimension_profitability_read.sql',import.meta.url),'utf8');
  for(const token of ['refs_get_dimension_profitability','PROPERTY','PROJECT','UNIT',"'GL.REPORT.VIEW'",'j.status=\'POSTED\'','POSTED_LEDGER_DIMENSION_EXACT','l.dimensions @> jsonb_build_object','REVOKE ALL','GRANT EXECUTE'])assert.match(up,new RegExp(token));
  assert.doesNotMatch(up,/source_document_line.*JOIN.*ledger_line|INSERT INTO journal_entry|UPDATE journal_entry|DELETE FROM journal_entry|INSERT INTO ledger_line|UPDATE ledger_line|DELETE FROM ledger_line/i);
  assert.match(down,/DROP FUNCTION refs_get_dimension_profitability/);assert.match(down,/DROP INDEX ledger_line_dimension_profitability_gin_idx/);
  const calls=[],kernel=Object.create(PostgresAccountingKernel.prototype);
  kernel.inSession=async work=>work({query:async(sql,args)=>{calls.push({sql,args});return {rows:[{dimension_type:'PROPERTY'}]};}});
  assert.deepEqual(await kernel.getDimensionProfitability({tenantId:'tenant',entityId:'entity',periodId:'period',dimensionType:'PROPERTY',dimensionRef:'PROPERTY-01'}),[{dimension_type:'PROPERTY'}]);
  assert.deepEqual(calls,[{sql:'SELECT * FROM refs_get_dimension_profitability($1,$2,$3,$4,$5)',args:['tenant','entity','period','PROPERTY','PROPERTY-01']}]);
  const tenantId=randomUUID(),entityId=randomUUID(),periodId=randomUUID(),httpCalls=[];
  const api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'reader'}),kernelFactory:async()=>({getDimensionProfitability:async scope=>{httpCalls.push(scope);return [];}})});
  const base=`/api/v1/entities/${entityId}/reports/dimension-profitability?periodId=${periodId}&dimensionType=PROPERTY&dimensionRef=PROPERTY-01`;
  const response=await api({method:'GET',url:base,headers:{},body:null});
  assert.equal(response.status,200);assert.equal(response.headers['cache-control'],'no-store');assert.deepEqual(httpCalls,[{tenantId,entityId,periodId,dimensionType:'PROPERTY',dimensionRef:'PROPERTY-01'}]);
  assert.equal((await api({method:'GET',url:base.replace('PROPERTY','UNKNOWN'),headers:{},body:null})).body.code,'INVALID_QUERY_PARAMETER');
  assert.equal((await api({method:'GET',url:`${base}&unexpected=1`,headers:{},body:null})).body.code,'UNEXPECTED_QUERY_PARAMETER');
  assert.equal((await api({method:'GET',url:base,headers:{'idempotency-key':'forbidden'},body:null})).body.code,'IDEMPOTENCY_KEY_NOT_ALLOWED');
  assert.equal((await api({method:'GET',url:base,headers:{},body:{}})).body.code,'READ_BODY_FORBIDDEN');
});

test('cash flow classification is a read-only exact mapping-snapshot report that blocks rather than infers',async()=>{
  const up=await readFile(new URL('../db/migrations/075_cash_flow_classification_read.sql',import.meta.url),'utf8');
  const down=await readFile(new URL('../db/migrations/down/075_cash_flow_classification_read.sql',import.meta.url),'utf8');
  for(const token of ['refs_get_cash_flow_classification',"'GL.REPORT.VIEW'",'CASH_FLOW_CLASSIFICATION',"'APPROVED','RETIRED'",'cash_account_code','counterpart_account_code','BLOCKED_MAPPING_REQUIRED','BLOCKED_MAPPING_AMBIGUOUS','BLOCKED_JOURNAL_SHAPE_REQUIRED','APPROVED_CASH_FLOW_MAPPING_SNAPSHOT_EXACT','REVOKE ALL','GRANT EXECUTE'])assert.match(up,new RegExp(token));
  assert.doesNotMatch(up,/INSERT INTO journal_entry|UPDATE journal_entry|DELETE FROM journal_entry|INSERT INTO ledger_line|UPDATE ledger_line|DELETE FROM ledger_line|refs_post_journal/i);
  assert.match(down,/DROP FUNCTION refs_get_cash_flow_classification/);assert.match(down,/DROP INDEX mapping_snapshot_cash_flow_exact_read_idx/);
  const calls=[],kernel=Object.create(PostgresAccountingKernel.prototype);
  kernel.inSession=async work=>work({query:async(sql,args)=>{calls.push({sql,args});return {rows:[{classification:'OPERATING'}]};}});
  assert.deepEqual(await kernel.getCashFlowClassification({tenantId:'tenant',entityId:'entity',periodId:'period'}),[{classification:'OPERATING'}]);
  assert.deepEqual(calls,[{sql:'SELECT * FROM refs_get_cash_flow_classification($1,$2,$3)',args:['tenant','entity','period']}]);
  const tenantId=randomUUID(),entityId=randomUUID(),periodId=randomUUID(),httpCalls=[];
  const api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'reader'}),kernelFactory:async()=>({getCashFlowClassification:async scope=>{httpCalls.push(scope);return [];}})});
  const base=`/api/v1/entities/${entityId}/reports/cash-flow-classification?periodId=${periodId}`;
  const response=await api({method:'GET',url:base,headers:{},body:null});
  assert.equal(response.status,200);assert.equal(response.headers['cache-control'],'no-store');assert.deepEqual(httpCalls,[{tenantId,entityId,periodId}]);
  assert.equal((await api({method:'GET',url:`${base}&unexpected=1`,headers:{},body:null})).body.code,'UNEXPECTED_QUERY_PARAMETER');
  assert.equal((await api({method:'GET',url:base,headers:{'idempotency-key':'forbidden'},body:null})).body.code,'IDEMPOTENCY_KEY_NOT_ALLOWED');
  assert.equal((await api({method:'GET',url:base,headers:{},body:{}})).body.code,'READ_BODY_FORBIDDEN');
});

test('CWIP rollforward is a read-only exact account-mapping report with no inferred capitalization conclusion',async()=>{
  const up=await readFile(new URL('../db/migrations/077_cwip_rollforward_read.sql',import.meta.url),'utf8');
  const down=await readFile(new URL('../db/migrations/down/077_cwip_rollforward_read.sql',import.meta.url),'utf8');
  for(const token of ['refs_get_cwip_rollforward',"'GL.REPORT.VIEW'",'CWIP_ACCOUNT_CLASSIFICATION','MAPPED_CWIP_ACCOUNT','BLOCKED_MAPPING_AMBIGUOUS','APPROVED_CWIP_ACCOUNT_MAPPING_SNAPSHOT_EXACT','REVOKE ALL','GRANT EXECUTE'])assert.match(up,new RegExp(token));
  assert.doesNotMatch(up,/INSERT INTO journal_entry|UPDATE journal_entry|DELETE FROM journal_entry|INSERT INTO ledger_line|UPDATE ledger_line|DELETE FROM ledger_line|refs_post_journal/i);assert.match(down,/DROP FUNCTION refs_get_cwip_rollforward/);
  const calls=[],kernel=Object.create(PostgresAccountingKernel.prototype);kernel.inSession=async work=>work({query:async(sql,args)=>{calls.push({sql,args});return {rows:[{mapping_status:'MAPPED_CWIP_ACCOUNT'}]};}});
  assert.deepEqual(await kernel.getCwipRollforward({tenantId:'tenant',entityId:'entity',periodId:'period'}),[{mapping_status:'MAPPED_CWIP_ACCOUNT'}]);assert.deepEqual(calls,[{sql:'SELECT * FROM refs_get_cwip_rollforward($1,$2,$3)',args:['tenant','entity','period']}]);
  const tenantId=randomUUID(),entityId=randomUUID(),periodId=randomUUID(),httpCalls=[];const api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'reader'}),kernelFactory:async()=>({getCwipRollforward:async scope=>{httpCalls.push(scope);return [];}})});const base=`/api/v1/entities/${entityId}/reports/cwip-rollforward?periodId=${periodId}`;
  const response=await api({method:'GET',url:base,headers:{},body:null});assert.equal(response.status,200);assert.equal(response.headers['cache-control'],'no-store');assert.deepEqual(httpCalls,[{tenantId,entityId,periodId}]);assert.equal((await api({method:'GET',url:`${base}&extra=1`,headers:{},body:null})).body.code,'UNEXPECTED_QUERY_PARAMETER');assert.equal((await api({method:'GET',url:base,headers:{},body:{}})).body.code,'READ_BODY_FORBIDDEN');
});
