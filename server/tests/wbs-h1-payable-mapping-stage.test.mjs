import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizeWbsH1PayableMappingRow,stageWbsH1PayableMappingRawPage,stageWbsH1PayableMappingRawPageForTestImport} from '../tools/stage-wbs-h1-payable-mapping-source.mjs';
import {normalizeWbsH1AccountingSetting,normalizeWbsH1AccountingSettingsPage} from '../tools/stage-wbs-h1-accounting-settings.mjs';
import {normalizeWbsH1PayableCostCode} from '../tools/stage-wbs-h1-payable-cost-codes.mjs';
import {normalizeDirectWbsH1PayableMappingRows} from '../tools/stage-wbs-h1-payable-mapping-direct-snapshot.mjs';

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
  let staged;const pool={query:async(_sql,args)=>{staged=JSON.parse(args[0]);return {rows:[{receipt:{expected_count:1,exact_count:1,inserted_count:1,conflict_count:0,conflict_inserted_count:0,conflict_receipt_hash:'sha256:'+'0'.repeat(64)}}]};}};
  const observed={tool_name:'list_payables',scope:{company_codes:['OPPO']},content_sha256:'b'.repeat(64),captured_at:capturedAt,rows:[{ap_guid:'33333333-3333-4333-8333-333333333333',company_code:'OPPO',posting_date:'2026-03-01',amount:'10.0000',pj_code:'P1',cost_code:'C1',vendor_no:'V1'}]};
  const receipt=await stageWbsH1PayableMappingRawPage({pool,tenantId,entityId,tool:'list_payables',companyCode:'OPPO',observed});
  assert.equal(receipt.staged_row_count,1);assert.equal(staged.length,1);assert.equal(staged[0].period_code,'2026-03');assert.equal(staged[0].project_code,'P1');
  assert.deepEqual(await stageWbsH1PayableMappingRawPage({pool,tenantId,entityId,tool:'list_bank_transactions',companyCode:'OPPO',observed}),{staged_row_count:0});
});

test('test import reports an immutable mapping-stage drift without discarding the authoritative raw import page',async()=>{
  const conflictReceiptHash='sha256:'+'d'.repeat(64),pool={query:async()=>({rows:[{receipt:{expected_count:1,exact_count:0,inserted_count:0,conflict_count:1,conflict_inserted_count:1,conflict_receipt_hash:conflictReceiptHash}}]})},drifts=[];
  const observed={tool_name:'list_payables',scope:{company_codes:['WBPA']},content_sha256:'c'.repeat(64),captured_at:capturedAt,rows:[{ap_guid:'WORK-33333333-3333-4333-8333-333333333333',company_code:'WBPA',posting_date:'2026-01-15',amount:'10.0000'}]};
  const receipt=await stageWbsH1PayableMappingRawPageForTestImport({pool,tenantId,entityId,tool:'list_payables',companyCode:'WBPA',observed,onDrift:row=>drifts.push(row)});
  assert.deepEqual(receipt,{staged_row_count:0,drifted_source_evidence:true,conflict_count:1,conflict_receipt_hash:conflictReceiptHash});
  assert.deepEqual(drifts,[{status:'WBS_H1_PAYABLE_MAPPING_SOURCE_DRIFT',company_code:'WBPA',tool:'list_payables',conflict_count:1,conflict_receipt_hash:conflictReceiptHash}]);
});

test('a direct connected WBS snapshot binds exact H1 source facts for one provisioned company',()=>{
  const rows=normalizeDirectWbsH1PayableMappingRows([{uuid:'WORK-33333333-3333-4333-8333-333333333333',company_code:'OPAU',posting_date:'2026-04-30 00:00:00',incurred_date:'2026-04-20 00:00:00',amount:'25.5000',project_code:'PROJECT-1',cost_code:'14T041',vendor_no:'VENDOR-1'}],{tenantId,entityId,companyCode:'OPAU',providerContentHash,capturedAt});
  assert.equal(rows.length,1);assert.equal(rows[0].period_code,'2026-04');assert.equal(rows[0].project_code,'PROJECT-1');assert.equal(rows[0].cost_code,'14T041');assert.match(rows[0].source_fact_hash,/^sha256:[0-9a-f]{64}$/);
  assert.equal(normalizeDirectWbsH1PayableMappingRows([{uuid:'WORK-44444444-4444-4444-8444-444444444444',company_code:'OPAU',invoice_date:'2026-05-01',amount:'1.0000'}],{tenantId,entityId,companyCode:'OPAU',providerContentHash,capturedAt})[0].period_code,'2026-05');
  assert.equal(normalizeDirectWbsH1PayableMappingRows([{uuid:'WORK-55555555-5555-4555-8555-555555555555',company_code:'OPAU',invoice_date:'2026-05-01',amount:'1.0000',cost_code:'unsafe\u0007'}],{tenantId,entityId,companyCode:'OPAU',providerContentHash,capturedAt})[0].cost_code,null);
  assert.throws(()=>normalizeDirectWbsH1PayableMappingRows([{uuid:'WORK-33333333-3333-4333-8333-333333333333',company_code:'OTHER',posting_date:'2026-04-30',amount:'1.0000'}],{tenantId,entityId,companyCode:'OPAU',providerContentHash,capturedAt}));
  assert.throws(()=>normalizeDirectWbsH1PayableMappingRows([{uuid:'WORK-33333333-3333-4333-8333-333333333333',company_code:'OPAU',posting_date:'2026-07-01',amount:'1.0000'}],{tenantId,entityId,companyCode:'OPAU',providerContentHash,capturedAt}));
});

test('only exact WBS Payable Debit and Credit settings enter the private stage contract',()=>{
  const debit=normalizeWbsH1AccountingSetting({id:42,type:'Debit',category:'Payable',business_type:4,detail:'14T041',pj_code:'PROJECT-1,PROJECT-2',journal_code:'140100',account:'Prepaid Insurance',company_code:'OPPO',start_date:'2026-01-01 00:00:00',end_date:'2026-12-31 00:00:00',supplementary:'Project'},{tenantId});
  assert.equal(debit.company_code,'OPPO');assert.equal(debit.journal_code,'140100');assert.match(debit.setting_hash,/^sha256:[0-9a-f]{64}$/);
  const credit=normalizeWbsH1AccountingSetting({id:45,type:'Credit',category:'Payable',business_type:4,detail:'',pj_code:null,journal_code:'291001',account:'Accounts Payable',company_code:'OPPO',start_date:'2026-01-01 00:00:00',end_date:'2026-12-31 00:00:00',supplementary:'Vendor'},{tenantId});
  assert.deepEqual(Object.keys(credit),['tenant_id','company_code','setting_id','setting_type','category','business_type','detail','project_codes','journal_code','account_name','supplementary','effective_from','effective_to','setting_hash']);
  assert.deepEqual({...credit,setting_hash:undefined},{tenant_id:tenantId,company_code:'OPPO',setting_id:45,setting_type:'Credit',category:'Payable',business_type:4,detail:'',project_codes:'',journal_code:'291001',account_name:'Accounts Payable',supplementary:'Vendor',effective_from:'2026-01-01',effective_to:'2026-12-31',setting_hash:undefined});
  assert.match(credit.setting_hash,/^sha256:[0-9a-f]{64}$/);assert.notEqual(credit.setting_hash,debit.setting_hash);
  assert.equal(normalizeWbsH1AccountingSetting({id:43,type:'Debit',category:'Payable',business_type:4,detail:'',pj_code:null,journal_code:null,account:null,company_code:'OPPO',start_date:'2026-01-01',end_date:'2026-12-31',supplementary:null},{tenantId}).journal_code,'');
  assert.equal(normalizeWbsH1AccountingSetting({id:44,type:'Debit',category:'Payable',business_type:4,detail:'',pj_code:null,journal_code:null,account:null,company_code:'OPPO',start_date:'0031-01-12',end_date:'2026-12-31',supplementary:null},{tenantId}).effective_from,'0031-01-12');
  for(const unsafe of [{type:'Direct(Credit)'},{type:'credit'},{category:'Bank'},{business_type:5},{supplementary:'Company'},{supplementary:'Bank'},{journal_code:'unsafe account'}])assert.throws(()=>normalizeWbsH1AccountingSetting({...credit,...unsafe,id:50},{tenantId}));
  assert.throws(()=>normalizeWbsH1AccountingSetting({...debit,start_date:'2026-02-30'},{tenantId}));
  assert.throws(()=>normalizeWbsH1AccountingSetting({...credit,end_date:'2025-12-31'},{tenantId}));
});

test('accounting settings page retains a complete Debit/Credit pair and rejects duplicate identities',()=>{
  const debit={id:42,type:'Debit',category:'Payable',business_type:4,detail:'14T041',pj_code:'PROJECT-1',journal_code:'140100',account:'Prepaid Insurance',company_code:'OPPO',start_date:'2026-01-01',end_date:'2026-12-31',supplementary:'Project'};
  const credit={id:45,type:'Credit',category:'Payable',business_type:4,detail:'',pj_code:null,journal_code:'291001',account:'Accounts Payable',company_code:'OPPO',start_date:'2026-01-01',end_date:'2026-12-31',supplementary:'Vendor'};
  const rows=normalizeWbsH1AccountingSettingsPage({rows:[debit,credit]},{tenantId});
  assert.deepEqual(rows.map(row=>row.setting_type),['Debit','Credit']);assert.equal(rows.length,2);assert.equal(new Set(rows.map(row=>row.setting_hash)).size,2);
  assert.throws(()=>normalizeWbsH1AccountingSettingsPage({rows:[credit,{...credit,journal_code:'291002'}]},{tenantId}));
  assert.throws(()=>normalizeWbsH1AccountingSettingsPage({rows:[]},{tenantId}));
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
  assert.match(source,/refs_retain_wbs_h1_payable_mapping_source_rows/);assert.match(source,/conflict_receipt_hash/);
});

test('signed payable mapping migration accepts nonzero adjustments and refuses unsafe down',()=>{
  const up=readFileSync(new URL('../db/migrations/263_wbs_h1_signed_payable_mapping_amount.sql',import.meta.url),'utf8'),down=readFileSync(new URL('../db/migrations/down/263_wbs_h1_signed_payable_mapping_amount.sql',import.meta.url),'utf8');
  assert.match(up,/CHECK\(amount <> 0\)/);assert.match(down,/REFUSE DATA LOSS/);assert.match(down,/amount < 0/);
});

test('direct WBS cost-code evidence binds only the immutable Payable source identity',()=>{
  const row=normalizeWbsH1PayableCostCode({uuid:'WORK-33333333-3333-4333-8333-333333333333',company_code:'OPR1',cost_code:'14T041'});
  assert.match(row.source_record_hash,/^sha256:[0-9a-f]{64}$/);assert.match(row.evidence_hash,/^sha256:[0-9a-f]{64}$/);assert.equal(row.cost_code,'14T041');
  assert.throws(()=>normalizeWbsH1PayableCostCode({uuid:'unsafe key',company_code:'OPR1',cost_code:'14T041'}));
});

test('cost-code evidence is private append-only and mapping candidates prefer it',()=>{
  const up=readFileSync(new URL('../db/migrations/264_wbs_h1_payable_cost_code_evidence.sql',import.meta.url),'utf8'),down=readFileSync(new URL('../db/migrations/down/264_wbs_h1_payable_cost_code_evidence.sql',import.meta.url),'utf8'),runner=readFileSync(new URL('../tools/apply-wbs-h1-payable-mappings.mjs',import.meta.url),'utf8');
  for(const token of ['wbs_h1_payable_cost_code_stage','reject_mutation','REVOKE ALL'])assert.match(up,new RegExp(token));
  assert.match(down,/REFUSE DATA LOSS/);assert.match(runner,/coalesce\(c\.cost_code,b\.cost_code\)/);assert.match(runner,/LEFT JOIN wbs_h1_payable_cost_code_stage/);
});
