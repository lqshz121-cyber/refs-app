import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizeWbsH1PayableMappingRow,stageWbsH1PayableMappingRawPage} from '../tools/stage-wbs-h1-payable-mapping-source.mjs';
import {normalizeWbsH1AccountingSetting} from '../tools/stage-wbs-h1-accounting-settings.mjs';

const tenantId='11111111-1111-4111-8111-111111111111',entityId='22222222-2222-4222-8222-222222222222',providerContentHash='sha256:'+'a'.repeat(64),capturedAt='2026-08-22T15:00:00.000Z';

test('WBS payable mapping source retains exact company, period, immutable key and accounting facts',()=>{
  const normalized=normalizeWbsH1PayableMappingRow({ap_guid:'33333333-3333-4333-8333-333333333333',company_code:'OPPO',posting_date:'2026-02-28 00:00:00',incurred_date:'2026-02-20 00:00:00',amount:'125.50000',pj_code:'PROJECT-1',cost_code:'14T041',vendor_no:'VENDOR-1'},{tenantId,entityId,companyCode:'OPPO',periodCode:'2026-02',providerContentHash,capturedAt});
  assert.equal(normalized.accounting_date,'2026-02-28');assert.equal(normalized.amount,'125.5000');assert.equal(normalized.cost_code,'14T041');assert.match(normalized.source_record_hash,/^sha256:[0-9a-f]{64}$/);assert.match(normalized.source_fact_hash,/^sha256:[0-9a-f]{64}$/);
  assert.equal(normalizeWbsH1PayableMappingRow({ap_guid:'WORK-33333333-3333-4333-8333-333333333333',company_code:'OPPO',posting_date:'2026-02-28',amount:'-1.2500'},{tenantId,entityId,companyCode:'OPPO',periodCode:'2026-02',providerContentHash,capturedAt}).amount,'-1.2500');
  assert.equal(normalizeWbsH1PayableMappingRow({...normalized,ap_guid:'44444444-4444-4444-8444-444444444444',company_code:'OTHER',posting_date:'2026-02-01'},{tenantId,entityId,companyCode:'OPPO',periodCode:'2026-02',providerContentHash,capturedAt}),null);
  assert.throws(()=>normalizeWbsH1PayableMappingRow({ap_guid:'unsafe provider id',company_code:'OPPO',posting_date:'2026-02-01',amount:'1.0000'},{tenantId,entityId,companyCode:'OPPO',periodCode:'2026-02',providerContentHash,capturedAt}));
  assert.throws(()=>normalizeWbsH1PayableMappingRow({ap_guid:'33333333-3333-4333-8333-333333333333',company_code:'OPPO',posting_date:'2026-02-30',amount:'1.0000'},{tenantId,entityId,companyCode:'OPPO',periodCode:'2026-02',providerContentHash,capturedAt}));
});

test('an importer raw Payable page is retained once without a second WBS read',async()=>{
  let staged;const pool={query:async(_sql,args)=>{staged=JSON.parse(args[0]);return {rows:[{expected_count:1,exact_count:1,inserted_count:1}]};}};
  const observed={tool_name:'list_payables',scope:{company_codes:['OPPO']},content_sha256:'b'.repeat(64),captured_at:capturedAt,rows:[{ap_guid:'33333333-3333-4333-8333-333333333333',company_code:'OPPO',posting_date:'2026-03-01',amount:'10.0000',pj_code:'P1',cost_code:'C1',vendor_no:'V1'}]};
  const receipt=await stageWbsH1PayableMappingRawPage({pool,tenantId,entityId,tool:'list_payables',companyCode:'OPPO',observed});
  assert.equal(receipt.staged_row_count,1);assert.equal(staged.length,1);assert.equal(staged[0].period_code,'2026-03');assert.equal(staged[0].project_code,'P1');
  assert.deepEqual(await stageWbsH1PayableMappingRawPage({pool,tenantId,entityId,tool:'list_bank_transactions',companyCode:'OPPO',observed}),{staged_row_count:0});
});

test('only exact WBS Payable Debit settings enter the private stage contract',()=>{
  const normalized=normalizeWbsH1AccountingSetting({id:42,type:'Debit',category:'Payable',business_type:4,detail:'14T041',pj_code:'PROJECT-1,PROJECT-2',journal_code:'140100',account:'Prepaid Insurance',company_code:'OPPO',start_date:'2026-01-01 00:00:00',end_date:'2026-12-31 00:00:00',supplementary:''},{tenantId});
  assert.equal(normalized.company_code,'OPPO');assert.equal(normalized.journal_code,'140100');assert.match(normalized.setting_hash,/^sha256:[0-9a-f]{64}$/);
  assert.equal(normalizeWbsH1AccountingSetting({id:43,type:'Debit',category:'Payable',business_type:4,detail:'',pj_code:null,journal_code:null,account:null,company_code:'OPPO',start_date:'2026-01-01',end_date:'2026-12-31',supplementary:null},{tenantId}).journal_code,'');
  assert.equal(normalizeWbsH1AccountingSetting({id:44,type:'Debit',category:'Payable',business_type:4,detail:'',pj_code:null,journal_code:null,account:null,company_code:'OPPO',start_date:'0031-01-12',end_date:'2026-12-31',supplementary:null},{tenantId}).effective_from,'0031-01-12');
  assert.throws(()=>normalizeWbsH1AccountingSetting({...normalized,type:'Credit'},{tenantId}));
  assert.throws(()=>normalizeWbsH1AccountingSetting({...normalized,start_date:'2026-02-30'},{tenantId}));
});

test('migration creates private append-only source and settings stages and refuses destructive down',()=>{
  const up=readFileSync(new URL('../db/migrations/262_wbs_h1_payable_mapping_stage.sql',import.meta.url),'utf8'),down=readFileSync(new URL('../db/migrations/down/262_wbs_h1_payable_mapping_stage.sql',import.meta.url),'utf8');
  for(const token of ['wbs_h1_payable_mapping_source_stage','wbs_h1_accounting_setting_stage','source_fact_hash','setting_hash','reject_mutation','REVOKE ALL'])assert.match(up,new RegExp(token));
  assert.match(down,/REFUSE DATA LOSS/);assert.match(down,/EXISTS\(SELECT 1 FROM wbs_h1_payable_mapping_source_stage\)/);
});

test('accounting setting stage counts both new inserts and command-snapshot matches',()=>{
  const source=readFileSync(new URL('../tools/stage-wbs-h1-accounting-settings.mjs',import.meta.url),'utf8');
  assert.match(source,/count\(\*\)::integer FROM inserted\)\+\(SELECT count\(\*\)::integer FROM input i JOIN wbs_h1_accounting_setting_stage/);
});

test('payable mapping source stage counts both new inserts and exact prior matches',()=>{
  const source=readFileSync(new URL('../tools/stage-wbs-h1-payable-mapping-source.mjs',import.meta.url),'utf8');
  assert.match(source,/source_fact_hash=i\.source_fact_hash\)\+\(SELECT count\(\*\) FROM inserted\)/);
});
