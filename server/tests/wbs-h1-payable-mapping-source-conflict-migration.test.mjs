import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('271 retains closed source conflicts and blocks proposal and Draft boundaries',async()=>{
  const up=await readFile(new URL('../db/migrations/271_wbs_h1_payable_mapping_source_conflict.sql',import.meta.url),'utf8');
  const down=await readFile(new URL('../db/migrations/down/271_wbs_h1_payable_mapping_source_conflict.sql',import.meta.url),'utf8');
  for(const token of [
    'wbs_h1_payable_mapping_source_conflict','retained_source_fact_hash','observed_source_fact_hash',
    'retained_provider_content_hash','observed_provider_content_hash','retained_captured_at','observed_captured_at',
    'SOURCE_FACT_DRIFT_UNRESOLVED','unresolved retained-versus-observed fact drift','ENABLE ROW LEVEL SECURITY',
    'source_record_hash=p_source_record_hash FOR SHARE','WBS H1 Payable source evidence changed or has no controlled posted baseline',
    'SELECT * INTO trace FROM wbs_test_import_draft',
    'REVOKE ALL ON TABLE wbs_h1_payable_mapping_source_conflict FROM PUBLIC,refs_app',
    'BEFORE UPDATE OR DELETE','REFUSE DATA LOSS'
  ])assert.match(up+'\n'+down,new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  assert.doesNotMatch(up,/ACCEPT_OBSERVED|observed facts accepted/i);
  assert.match(down,/EXISTS\(SELECT 1 FROM wbs_h1_payable_mapping_source_conflict\)/);
});
