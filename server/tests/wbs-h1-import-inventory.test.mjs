import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {assertWbsH1ImportInventory} from '../runtime/wbs-h1-import-inventory.mjs';
import {PostgresAccountingKernel} from '../runtime/kernel-repository.mjs';

const hash=`sha256:${'a'.repeat(64)}`;
const counts={source_record_count:1,source_amount:'125.0000',controlled_test_posted_count:0,formal_mapping_posted_count:0,mapping_missing_count:1,mapping_ready_count:0,mapping_ambiguous_count:0};
const inventory={schema_version:'WBS_H1_IMPORT_INVENTORY_V1',company_code:'SUCF',currency:'USD',date_from:'2026-01-01',date_to:'2026-06-30',limit:50,offset:0,totals:counts,months:Array.from({length:6},(_,index)=>({period_code:`2026-${String(index+1).padStart(2,'0')}`,...counts,source_record_count:index===0?1:0,source_amount:index===0?'125.0000':'0.0000',mapping_missing_count:index===0?1:0})),rows:[{source_record_hash:hash,accounting_date:'2026-01-15',amount:'125.0000',project_code:null,cost_code:'100',vendor_no:'V-1',import_state:'SOURCE_STAGED',mapping_state:'MAPPING_MISSING'}],source_mode:'REAL_WBS_STAGED',accounting_authority:'NONE',can_create_draft:false,can_review:false,can_approve:false,can_post:false};

test('265 exposes a scoped, read-only company H1 inventory without accounting actions',async()=>{
  const up=await readFile(new URL('../db/migrations/265_wbs_h1_import_inventory_read.sql',import.meta.url),'utf8');
  for(const token of ["refs_assert_scope(p_tenant,p_entity,'WBS.AUTOREC.VIEW')",'wbs_h1_payable_mapping_source_stage','wbs_h1_accounting_setting_stage','CONTROLLED_TEST_POSTED','FORMAL_MAPPING_POSTED',"'source_mode','REAL_WBS_STAGED'","'accounting_authority','NONE'","'can_create_draft',false","'can_post',false",'REVOKE ALL','GRANT EXECUTE'])assert.match(up,new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  assert.doesNotMatch(up,/INSERT INTO|UPDATE |DELETE FROM/);
  const down=await readFile(new URL('../db/migrations/down/265_wbs_h1_import_inventory_read.sql',import.meta.url),'utf8');assert.match(down,/DROP FUNCTION refs_read_wbs_h1_import_inventory/);
});

test('inventory validator and kernel reject drift while retaining exact paging',async()=>{
  assert.equal(assertWbsH1ImportInventory(inventory,{limit:50,offset:0}),inventory);
  assert.throws(()=>assertWbsH1ImportInventory({...inventory,can_post:true},{limit:50,offset:0}),/INVALID/);
  assert.throws(()=>assertWbsH1ImportInventory({...inventory,months:inventory.months.slice(0,5)},{limit:50,offset:0}),/INVALID/);
  const calls=[],kernel=new PostgresAccountingKernel({},{sessionProvider:async()=>({trusted:true,contextToken:'x'.repeat(32)})});
  kernel.inSession=work=>work({query:async(sql,params)=>(calls.push({sql,params}),{rowCount:1,rows:[{result:inventory}]})});
  assert.equal(await kernel.readWbsH1ImportInventory({tenantId:'t',entityId:'e',limit:50,offset:0}),inventory);
  assert.match(calls[0].sql,/refs_read_wbs_h1_import_inventory/);assert.deepEqual(calls[0].params,['t','e',50,0]);
});
