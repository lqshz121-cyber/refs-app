import assert from 'node:assert/strict';
import test from 'node:test';
import {createAiFullControllerScanService,AiFullControllerScanError} from '../runtime/ai-full-controller-scan-service.mjs';
import {readFileSync} from 'node:fs';

const tenant='tenant-1',entity='entity-1',period='period-1';
const actions={can_create_draft:false,can_review:false,can_approve:false,can_post:false};
const batch=(schema,findings=[])=>({schema_version:schema,current_accounting_period_id:period,scanned_line_count:findings.length,finding_count:findings.length,findings,action_flags:actions});
const analyzer=value=>({analyze:async input=>typeof value==='function'?value(input):value});

test('runs every registered Controller analyzer and preserves a split-billing monthly finding',async()=>{
  const seen=[];
  const service=createAiFullControllerScanService({analyzers:{
    VENDOR_MONTHLY_SPEND:analyzer(input=>(seen.push(input),batch('AI_VENDOR_MONTHLY_SPEND_ANOMALY_BATCH_V1',[{entity_id:entity,accounting_period_id:period,current_month_total:'500.0000',historical_monthly_median:'100.0000',rule_id:'AI_VENDOR_MONTHLY_SPEND_V1',risk_level:'HIGH',reason:'Four 125 invoices total 500 against a historical monthly total of 100.',suggested_action:'Review the complete retained invoice population and approved vendor baseline.'}]))),
    VENDOR_SINGLE_INVOICE:analyzer(batch('AI_VENDOR_INVOICE_AMOUNT_ANOMALY_BATCH_V1',[]))
  }});
  const result=await service.analyze({tenantId:tenant,entityId:entity,currentAccountingPeriodId:period,limit:500});
  assert.equal(result.status,'COMPLETE');assert.equal(result.required_section_count,2);assert.equal(result.complete_section_count,2);assert.equal(result.finding_count,1);
  assert.deepEqual(result.risk_summary,{high:1,medium:0,low:0});assert.deepEqual(result.coverage_summary,{complete_section_count:2,unavailable_section_count:0,unavailable_sections:[]});
  assert.equal(result.sections.find(section=>section.category==='VENDOR_MONTHLY_SPEND').findings[0].current_month_total,'500.0000');
  assert.deepEqual(result.action_flags,actions);assert.deepEqual(seen[0],{tenantId:tenant,entityId:entity,currentAccountingPeriodId:period,limit:500});
});

test('marks the whole scan incomplete when one required analyzer is unavailable without hiding valid findings',async()=>{
  const service=createAiFullControllerScanService({analyzers:{BANK:analyzer(()=>{throw Object.assign(new Error('transport down'),{code:'AI_BANK_EVIDENCE_READER_REQUIRED'});}),VENDOR:analyzer(batch('AI_VENDOR_BATCH_V1',[{entity_id:entity,accounting_period_id:period,risk_level:'HIGH',rule_id:'AI_VENDOR_REVIEW_V1',reason:'The vendor evidence requires controller review.',suggested_action:'Review the retained vendor evidence before close.'}]))}});
  const result=await service.analyze({tenantId:tenant,entityId:entity,currentAccountingPeriodId:period});
  assert.equal(result.status,'INCOMPLETE');assert.equal(result.complete_section_count,1);assert.equal(result.finding_count,1);
  assert.deepEqual(result.risk_summary,{high:1,medium:0,low:0});assert.deepEqual(result.coverage_summary,{complete_section_count:1,unavailable_section_count:1,unavailable_sections:[{category:'BANK',error_code:'AI_BANK_EVIDENCE_READER_REQUIRED'}]});
  assert.deepEqual(result.sections.find(section=>section.category==='BANK'),{category:'BANK',status:'UNAVAILABLE',error_code:'AI_BANK_EVIDENCE_READER_REQUIRED',finding_count:null,findings:[],action_flags:actions});
});

test('fails a section closed for action authority, wrong scope, or secret-shaped evidence',async()=>{
  for(const unsafe of [
    {...batch('X'),action_flags:{...actions,can_post:true}},
    batch('X',[{entity_id:'other',accounting_period_id:period,rule_id:'AI_SCOPE_V1',risk_level:'HIGH',reason:'This finding has the wrong entity scope.',suggested_action:'Reject the unscoped evidence before close.'}]),
    batch('X',[{entity_id:entity,accounting_period_id:period,rule_id:'AI_SECRET_V1',risk_level:'HIGH',reason:'This finding includes forbidden secret-shaped evidence.',suggested_action:'Reject secret-shaped evidence before close.',authorization:'Bearer secret'}]),
    batch('X',[{entity_id:entity,accounting_period_id:period,rule_id:'AI_SECRET_VALUE_V1',risk_level:'HIGH',reason:'Authorization: Bearer abcdefghijklmnop',suggested_action:'Reject credential material embedded in an otherwise allowed text field.'}]),
    batch('X',[{entity_id:entity,accounting_period_id:period,rule_id:'AI_VIRTUAL_KEY_V1',risk_level:'HIGH',reason:'A retained description contained sk-abcdefgh12345678',suggested_action:'Reject credential material embedded in retained evidence.'}]),
    batch('X',[{entity_id:entity,accounting_period_id:period,risk_level:'HIGH',reason:'This finding has no stable accounting rule.',suggested_action:'Reject unexplained evidence before close.'}]),
    batch('X',[{entity_id:entity,accounting_period_id:period,rule_id:'AI_UNEXPLAINED_V1',risk_level:'HIGH',reason:'short',suggested_action:'Reject unexplained evidence before close.'}])
  ]){
    const result=await createAiFullControllerScanService({analyzers:{UNSAFE:analyzer(unsafe)}}).analyze({tenantId:tenant,entityId:entity,currentAccountingPeriodId:period});
    assert.equal(result.status,'INCOMPLETE');assert.equal(result.complete_section_count,0);assert.equal(result.sections[0].error_code,'AI_FULL_SCAN_SECTION_INVALID');assert.deepEqual(result.action_flags,actions);
  }
});

test('rejects invalid configuration and unbounded scan scope',async()=>{
  assert.throws(()=>createAiFullControllerScanService(),AiFullControllerScanError);
  assert.throws(()=>createAiFullControllerScanService({analyzers:{bad:analyzer(batch('X'))}}),AiFullControllerScanError);
  await assert.rejects(()=>createAiFullControllerScanService({analyzers:{GOOD:analyzer(batch('X'))}}).analyze({tenantId:tenant,entityId:entity,currentAccountingPeriodId:period,limit:2001}),AiFullControllerScanError);
});

test('production wiring includes vendor, bank, source, cutoff, accrual, rent, loan, reporting, and manual-JE controls',()=>{
  const source=readFileSync(new URL('../runtime/accounting-server.mjs',import.meta.url),'utf8');
  for(const category of ['AP_INVOICE_CUTOFF','BANK_DUPLICATE_PAYMENT','BANK_PAYEE_VENDOR_MISMATCH','BANK_UNUSUAL_PAYMENT','INVOICE_SOURCE_SUPPORT','MANUAL_JOURNAL_RISK','NEW_VENDOR_MATERIAL_INVOICE','VENDOR_ACCOUNT_CODING_DRIFT','VENDOR_ACCOUNTING_TREATMENT_DRIFT','VENDOR_INVOICE_AMOUNT_DROP','VENDOR_INVOICE_FREQUENCY','VENDOR_INVOICE_NEAR_DUPLICATE','VENDOR_MONTHLY_SPEND','VENDOR_PAYMENT_TERMS_DRIFT','VENDOR_SINGLE_INVOICE_SPIKE'])assert.match(source,new RegExp(`${category}:adapt\\(`));
  for(const category of ['ACCRUAL_CANDIDATE:accrual','AP_AGING_RISK:apAging','BALANCE_SHEET_ACCOUNT_AGING:balanceSheetAging','BANK_RECONCILIATION_EXCEPTION:bankReconciliation','BUDGET_VS_ACTUAL:budgetVariance','CONSTRUCTION_LOAN_BALANCE:constructionLoan','CONSTRUCTION_LOAN_DRAW_CWIP:constructionLoanDrawCwip','CONSTRUCTION_LOAN_PROJECT_COST:constructionLoanProjectCost','CONSTRUCTION_LOAN_TRANSACTION:constructionLoanTransaction','COST_DIMENSION:costDimension','CWIP_POST_COMPLETION:cwipPostCompletion','DUPLICATE_PAYABLE:duplicatePayable','FINANCIAL_STATEMENT_VARIANCE:financialVariance','FIXED_ASSET_DISPOSAL_GAP:fixedAssetDisposalGap','FIXED_ASSET_IMPAIRMENT:fixedAssetImpairment','FIXED_ASSET_IMPAIRMENT_POSTED_RECONCILIATION:fixedAssetImpairmentPosted','FIXED_ASSET_POST_DISPOSAL_DEPRECIATION:fixedAssetPostDisposalDepreciation','FIXED_ASSET_POSTED_RECONCILIATION:fixedAssetPostedReconciliation','INVOICE_ACCOUNTING_CLASSIFICATION:invoiceAccountingClassification','INTERCOMPANY_CLOSE:intercompany','LOAN_REFERENCE:loanReference','PROPERTY_RENT_REVENUE:propertyRent','PREPAID_AMORTIZATION:prepaidAmortization','PREPAID_COVERAGE:prepaidCoverage','SECURITY_DEPOSIT_LIABILITY:securityDepositLiability'])assert.match(source,new RegExp(category));
  for(const token of ['listAiPrepaidCoverageFindingsForPeriod','listAiDuplicatePayableFindingsForPeriod','listAiCostDimensionFindingsForPeriod','listAiLoanReferenceFindingsForPeriod'])assert.match(source,new RegExp(token));
  assert.match(source,/BANK_GL_BALANCE_RECONCILIATION:bankGlBalanceReconciliation/);assert.match(source,/getAiBankGlBalanceReconciliation/);
  for(const token of ['listAiPropertyRentRevenueReviews','getAiFinancialStatementVarianceComparison','getAiFinancialVariancePolicy','getAiBudgetVsActualSource','getAiBudgetVariancePolicy','getConstructionLoanRollforward','getAiConstructionLoanLenderBalances','getAiConstructionLoanBalancePolicy','listInsurancePrepaidAmortization','getAiFixedAssetDisposalGapSource','detectFixedAssetDisposalGaps','getAiApAgingRiskSource','getAiApAgingRiskPolicy','listAiIntercompanyCounterpartyPeriods','getIntercompanyReconciliation','listAiUnmatchedBankPaymentFindingsForPeriod','period.period_end','AI_ACCRUAL_CONTROLLER_SCAN_BATCH_V1','projectPrepaidAmortizationControllerReviews'])assert.match(source,new RegExp(token.replace('.','\\.')));
  assert.match(source,/createAiFullControllerScanService\(\{analyzers:/);assert.match(source,/aiFullControllerScanServiceFactory,/);
  assert.match(source,/ACCOUNTING_DECISION:accountingDecision/);assert.match(source,/projectAiAccountingDecisionControllerScan/);
  assert.match(source,/createAiCwipPostCompletionReviewService/);assert.match(source,/readAiCwipPostCompletionSource/);
  assert.match(source,/AI_INVOICE_ACCOUNTING_CLASSIFICATION_CONTROLLER_SCAN_BATCH_V1/);assert.match(source,/listAiDuplicatePayableFindingsForPeriod/);
  assert.match(source,/includeControllerEvidence:true/);assert.match(source,/posted_treatment_consistency/);assert.match(source,/consistency\.status==='MISMATCH'/);
});
