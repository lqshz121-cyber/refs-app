import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PostgresAccountingKernel} from '../runtime/kernel-repository.mjs';

test('Postgres WBS AutoRec readers are explicitly read-only, scoped, and expose no JE command',async()=>{
  const up=await readFile(new URL('../db/migrations/059_wbs_inbound_autorec_read.sql',import.meta.url),'utf8');
  const down=await readFile(new URL('../db/migrations/down/059_wbs_inbound_autorec_read.sql',import.meta.url),'utf8');
  for(const token of ['refs_assert_scope','row.tenant_id=p_tenant','row.entity_id=p_entity','row.source_record_id=ANY\\(p_source_records\\)','company_key',"status='APPROVED'","family='WBS_AUTOREC'",'REVOKE ALL','GRANT EXECUTE'])assert.match(up,new RegExp(token));
  assert.match(up,/mapping_snapshot WHERE tenant_id=p_tenant AND entity_id=p_entity/);
  assert.doesNotMatch(up,/entity_id IS NULL OR entity_id=p_entity/);
  assert.doesNotMatch(up,/\b(?:INSERT|UPDATE|DELETE)\b|refs_create_auto_journal|refs_post_journal/i);
  for(const name of ['refs_read_wbs_inbound_rows','refs_read_wbs_autorec_control_rows','refs_read_wbs_autorec_mappings'])assert.match(down,new RegExp(`DROP FUNCTION IF EXISTS ${name}`));
  const calls=[],kernel=Object.create(PostgresAccountingKernel.prototype);
  kernel.inSession=async work=>work({query:async(sql,args)=>{calls.push({sql,args});return {rowCount:1,rows:[{rows:sql.includes('control_rows')?{companyRows:[],detailRows:[],persistedRows:[]}:[]}]};}});
  const selection={tenantId:'t',entityId:'e',companyKey:'C',sourceRecordIds:['one'],read_only:true};
  assert.deepEqual(await kernel.readPersistedWbsInboundRows(selection),[]);
  assert.deepEqual(await kernel.readPersistedWbsControlRows(selection),{companyRows:[],detailRows:[],persistedRows:[]});
  assert.deepEqual(await kernel.readApprovedWbsAutoRecMappings(selection),[]);
  assert.equal(calls.length,3);assert.ok(calls.every(call=>call.args[0]==='t'&&call.args[1]==='e'&&call.args[2]==='C'));
  await assert.rejects(()=>kernel.readPersistedWbsInboundRows({...selection,read_only:false}),error=>error.code==='WBS_AUTOREC_READ_SCOPE_INVALID');
  await assert.rejects(()=>kernel.readPersistedWbsInboundRows({...selection,companyKey:' '}),error=>error.code==='WBS_AUTOREC_READ_SCOPE_INVALID');
  await assert.rejects(()=>kernel.readPersistedWbsControlRows({...selection,sourceRecordIds:['one','']}),error=>error.code==='WBS_AUTOREC_READ_SCOPE_INVALID');
  await assert.rejects(()=>kernel.readApprovedWbsAutoRecMappings({...selection,companyKey:''}),error=>error.code==='WBS_AUTOREC_READ_SCOPE_INVALID');
  assert.equal(calls.length,3);
});

test('Cost GL and Property comparison use immutable scoped control reads and one approved mapping only',async()=>{
  const up=await readFile(new URL('../db/migrations/067_wbs_control_reconciliation_read.sql',import.meta.url),'utf8');
  const down=await readFile(new URL('../db/migrations/down/067_wbs_control_reconciliation_read.sql',import.meta.url),'utf8');
  for(const token of ['refs_control_metric_snapshot','ENABLE ROW LEVEL SECURITY','reject_mutation','refs_read_refs_control_metric_snapshot','refs_read_wbs_control_reconciliation_mapping','candidate_count<>1','WBS_COST_GL_CONTROL_RECONCILIATION','WBS_PROPERTY_CONTROL_RECONCILIATION','REVOKE ALL','GRANT EXECUTE'])assert.match(up,new RegExp(token));
  assert.doesNotMatch(up,/\b(?:INSERT|UPDATE|DELETE)\b[\s\S]*(?:journal|wbs_inbound_row|source_document)/i);
  for(const name of ['refs_read_refs_control_metric_snapshot','refs_read_wbs_control_reconciliation_mapping'])assert.match(down,new RegExp(`DROP FUNCTION IF EXISTS ${name}`));
  const calls=[],kernel=Object.create(PostgresAccountingKernel.prototype);
  kernel.inSession=async work=>work({query:async(sql,args)=>{calls.push({sql,args});return {rowCount:1,rows:[{result:null}]};}});
  const selection={source_type:'COST_GENERAL_LEDGER',tenant_id:'t',entity_id:'e',scope:{tenant_id:'t',entity_id:'e',company_key:'C',period:'2026-08',currency:'USD'},read_only:true};
  assert.equal(await kernel.readPersistedRefsControlMetricSnapshot(selection),null);
  assert.equal(await kernel.readApprovedWbsControlReconciliationMapping(selection),null);
  assert.equal(calls.length,2);assert.ok(calls.every(call=>call.args[0]==='t'&&call.args[1]==='e'&&call.args[2]==='COST_GENERAL_LEDGER'));
  await assert.rejects(()=>kernel.readPersistedRefsControlMetricSnapshot({...selection,read_only:false}),error=>error.code==='WBS_CONTROL_READ_SCOPE_INVALID');
  await assert.rejects(()=>kernel.readApprovedWbsControlReconciliationMapping({...selection,scope:null}),error=>error.code==='WBS_CONTROL_READ_SCOPE_INVALID');
});

test('control reconciliation mapping read returns the database-owned mapping family',async()=>{
  const up=await readFile(new URL('../db/migrations/068_wbs_control_reconciliation_mapping_type.sql',import.meta.url),'utf8');
  const down=await readFile(new URL('../db/migrations/down/068_wbs_control_reconciliation_mapping_type.sql',import.meta.url),'utf8');
  assert.match(up,/'mapping_type',m\.family/);
  assert.match(up,/SET search_path=pg_catalog,public,pg_temp/);
  assert.doesNotMatch(up,/\b(?:INSERT|UPDATE|DELETE)\b/i);
  assert.doesNotMatch(down,/'mapping_type',m\.family/);
  assert.match(down,/SET search_path=pg_catalog,public,pg_temp/);
});

test('AutoRec mapping reader includes the immutable mapping snapshot and effective window',async()=>{
  const up=await readFile(new URL('../db/migrations/069_wbs_autorec_mapping_trace_read.sql',import.meta.url),'utf8');
  const down=await readFile(new URL('../db/migrations/down/069_wbs_autorec_mapping_trace_read.sql',import.meta.url),'utf8');
  for(const token of ["'snapshot_hash',snapshot_hash","'effective_from',effective_from","'effective_to',effective_to",'family=\'WBS_AUTOREC\'','refs_assert_scope','REVOKE ALL','GRANT EXECUTE'])assert.match(up,new RegExp(token));
  assert.doesNotMatch(up,/\b(?:INSERT|UPDATE|DELETE)\b/i);
  assert.doesNotMatch(down,/'snapshot_hash',snapshot_hash/);
  assert.match(down,/SET search_path=pg_catalog,public,pg_temp/);
});

test('AutoRec mapping reader retains retired snapshots for closed-period receipt trace',async()=>{
  const up=await readFile(new URL('../db/migrations/070_wbs_autorec_historical_mapping_read.sql',import.meta.url),'utf8');
  const down=await readFile(new URL('../db/migrations/down/070_wbs_autorec_historical_mapping_read.sql',import.meta.url),'utf8');
  for(const token of ["status IN \\('APPROVED','RETIRED'\\)","'effective_from',effective_from","'effective_to',effective_to",'refs_assert_scope','REVOKE ALL','GRANT EXECUTE'])assert.match(up,new RegExp(token));
  assert.doesNotMatch(up,/effective_from<=clock_timestamp\(\)/);
  assert.match(down,/status='APPROVED'/);
});
