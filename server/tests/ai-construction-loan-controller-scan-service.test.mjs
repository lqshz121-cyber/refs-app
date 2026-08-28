import assert from 'node:assert/strict';
import test from 'node:test';
import {createAiConstructionLoanControllerScanService} from '../runtime/ai-construction-loan-controller-scan-service.mjs';

const entityId='ca8d23c7-0ea6-4860-8e3e-caf9a3e22ce3',periodId='4e0b2744-2366-46d5-8b34-6ccf49deaabf';
const hash=value=>`sha256:${String(value).repeat(64).slice(0,64)}`;
const row=(description,direction='OUTFLOW',overrides={})=>({source_document_id:'00000000-0000-4000-8000-000000000001',source_document_line_id:'10000000-0000-4000-8000-000000000001',source_payload_hash:hash('a'),source_line_hash:hash('b'),loan_ref:'LOAN-1',currency:'USD',amount:'500.0000',direction,description,bank_account_ref:'BANK-1',project_ref:'PROJECT-1',property_ref:'PROPERTY-1',...overrides});

test('classifies the complete retained loan population with review-only accounting treatment',async()=>{
  let received;
  const service=createAiConstructionLoanControllerScanService({sourceReader:async scope=>{received=scope;return [row('Construction draw advance','INFLOW'),row('Monthly interest payment','OUTFLOW',{source_document_line_id:'10000000-0000-4000-8000-000000000002',source_line_hash:hash('c')}),row('Principal payment','OUTFLOW',{source_document_line_id:'10000000-0000-4000-8000-000000000003',source_line_hash:hash('d')}),row('Origination fee','OUTFLOW',{source_document_line_id:'10000000-0000-4000-8000-000000000004',source_line_hash:hash('e')}),row('Tax reserve','DEBIT',{source_document_line_id:'10000000-0000-4000-8000-000000000005',source_line_hash:hash('f')})];}});
  const batch=await service.analyze({tenantId:'tenant',entityId,accountingPeriodId:periodId,limit:500});
  assert.deepEqual(received,{tenantId:'tenant',entityId,accountingPeriodId:periodId,limit:500});
  assert.deepEqual(batch.findings.map(item=>item.classification),['LOAN_DRAW','INTEREST_REVIEW','PRINCIPAL_REPAYMENT','LOAN_FEE_REVIEW','ESCROW_RESERVE']);
  assert.deepEqual(batch.findings.map(item=>item.risk_level),['LOW','MEDIUM','LOW','MEDIUM','MEDIUM']);
  for(const finding of batch.findings){assert.equal(finding.entity_id,entityId);assert.equal(finding.accounting_period_id,periodId);assert.deepEqual(Object.fromEntries(['can_create_draft','can_review','can_approve','can_post'].map(key=>[key,finding[key]])),{can_create_draft:false,can_review:false,can_approve:false,can_post:false});assert.ok(finding.suggested_action.length>8);}
  assert.deepEqual(batch.action_flags,{can_create_draft:false,can_review:false,can_approve:false,can_post:false});
});

test('keeps malformed or ambiguous retained rows visible as high-risk blocked findings',async()=>{
  const service=createAiConstructionLoanControllerScanService({sourceReader:async()=>[row('Interest and principal payment')]});
  const batch=await service.analyze({tenantId:'tenant',entityId,accountingPeriodId:periodId});
  assert.equal(batch.finding_count,1);assert.equal(batch.findings[0].classification,'BLOCKED');assert.equal(batch.findings[0].risk_level,'HIGH');assert.equal(batch.findings[0].rule_id,'LOAN_NATURE_AMBIGUOUS');
});

test('returns a closed zero-row batch and rejects non-array source responses',async()=>{
  const empty=createAiConstructionLoanControllerScanService({sourceReader:async()=>[]});
  assert.equal((await empty.analyze({tenantId:'tenant',entityId,accountingPeriodId:periodId})).finding_count,0);
  const invalid=createAiConstructionLoanControllerScanService({sourceReader:async()=>null});
  await assert.rejects(invalid.analyze({tenantId:'tenant',entityId,accountingPeriodId:periodId}),error=>error.code==='AI_LOAN_CONTROLLER_SOURCE_INVALID');
});

test('rejects invalid bounds and a saturated construction-loan population before concluding coverage',async()=>{
  let reads=0;
  const service=createAiConstructionLoanControllerScanService({sourceReader:async()=>{reads++;return [row('Construction draw advance','INFLOW'),row('Principal payment')];}});
  await assert.rejects(service.analyze({tenantId:'tenant',entityId,accountingPeriodId:periodId,limit:0}),error=>error.code==='AI_LOAN_CONTROLLER_SCAN_SCOPE_INVALID');
  assert.equal(reads,0);
  await assert.rejects(service.analyze({tenantId:'tenant',entityId,accountingPeriodId:periodId,limit:2}),error=>error.code==='AI_LOAN_CONTROLLER_POPULATION_INCOMPLETE');
  assert.equal(reads,1);
});
