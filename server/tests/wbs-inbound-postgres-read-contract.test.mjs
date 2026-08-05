import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PostgresAccountingKernel} from '../runtime/kernel-repository.mjs';

test('Postgres WBS AutoRec readers are explicitly read-only, scoped, and expose no JE command',async()=>{
  const up=await readFile(new URL('../db/migrations/059_wbs_inbound_autorec_read.sql',import.meta.url),'utf8');
  const down=await readFile(new URL('../db/migrations/down/059_wbs_inbound_autorec_read.sql',import.meta.url),'utf8');
  for(const token of ['refs_assert_scope','row.tenant_id=p_tenant','row.entity_id=p_entity','row.source_record_id=ANY\\(p_source_records\\)','company_key',"status='APPROVED'","family='WBS_AUTOREC'",'REVOKE ALL','GRANT EXECUTE'])assert.match(up,new RegExp(token));
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
  assert.equal(calls.length,3);
});
