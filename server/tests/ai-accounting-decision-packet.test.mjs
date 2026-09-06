import test from 'node:test';
import assert from 'node:assert/strict';
import {assertAiAccountingDecisionPacketBatch,buildAiAccountingDecisionPacket,createAiAccountingDecisionPacketService} from '../runtime/ai-accounting-decision-packet.mjs';
import {classifyRetainedInvoice} from '../runtime/ai-invoice-accounting-classifier.mjs';
import {createAiInvoiceAccountingClassificationService} from '../runtime/ai-invoice-accounting-classification-service.mjs';

const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const hash=n=>`sha256:${n.toString(16).padStart(64,'0')}`;
const actions={can_create_draft:false,can_review:false,can_approve:false,can_post:false};
const entity=id(1),period=id(2),tenant=id(3);
const settings={schema_version:'AI_ACCOUNTING_SETTINGS_SNAPSHOT_V1',snapshot_id:id(4),version:7,snapshot_hash:hash(4),status:'APPROVED',entity_id:entity,accounting_period_id:period,currency:'USD',account_mappings:{expense_account_code:'610000',prepaid_asset_account_code:'140000',accrued_liability_account_code:'220000',cwip_account_code:'150000',accounts_payable_account_code:'210000'}};
const capitalizationPolicy={schema_version:'AI_CAPITALIZATION_POLICY_EVIDENCE_V1',setting_snapshot_id:id(5),setting_snapshot_hash:hash(5),policy_version:1,rule_id:'AI_CAPITALIZATION_POLICY_V1',currency:'USD',capitalization_threshold:'5000.0000',eligible_cost_classes:['HARD_COST'],charge_code_classification:{OPERATING:'OPERATING_EXPENSE'},project_status_by_ref:{},useful_life_months_by_cost_class:{HARD_COST:360},post_completion_treatment:'EXPENSE_OR_RECLASS_REVIEW'};
const source=(n=10,overrides={})=>({source_document_id:id(n),source_document_line_id:id(n+1),source_payload_hash:hash(n),source_line_hash:hash(n+1),entity_id:entity,accounting_period_id:period,vendor_ref:'VENDOR-1',currency:'USD',amount:'1200.0000',project_ref:'PROJECT-1',property_ref:null,...overrides});
const classification=(row,type,overrides={})=>({schema_version:'AI_INVOICE_ACCOUNTING_CLASSIFICATION_V2',source_document_id:row.source_document_id,source_document_line_id:row.source_document_line_id,source_payload_hash:row.source_payload_hash,source_line_hash:row.source_line_hash,classification:type,reason:`Source supports ${type}.`,confidence:.98,required_human_fields:['controller_conclusion'],rule_id:`AI_${type}_V1`,policy_evidence:null,action_flags:actions,...overrides});

for(const [type,debit,credit,bs,pl] of [
  ['EXPENSE','610000','210000',['ACCOUNTS_PAYABLE'],['OPERATING_EXPENSE']],
  ['PREPAID_AMORTIZATION','140000','210000',['PREPAID_ASSET','ACCOUNTS_PAYABLE'],[]],
  ['ACCRUAL_REVIEW','610000','220000',['ACCRUED_LIABILITY'],['OPERATING_EXPENSE']],
  ['CAPITALIZATION_REVIEW','150000','210000',['CWIP','ACCOUNTS_PAYABLE'],[]]
])test(`${type} produces a balanced suggested-only JE and report impact`,()=>{
  const row=source(),packet=buildAiAccountingDecisionPacket({entityId:entity,accountingPeriodId:period,source:row,classification:classification(row,type),settings});
  assert.equal(packet.status,'READY_FOR_HUMAN_REVIEW');assert.equal(packet.proposed_journal.status,'SUGGESTED_ONLY');assert.equal(packet.proposed_journal.balanced,true);
  assert.deepEqual(packet.proposed_journal.lines.map(line=>[line.side,line.account_code,line.amount]),[['DEBIT',debit,'1200.0000'],['CREDIT',credit,'1200.0000']]);
  assert.deepEqual(packet.report_impact.balance_sheet,bs);assert.deepEqual(packet.report_impact.income_statement,pl);assert.deepEqual(packet.action_flags,actions);
  assert.deepEqual(packet.trace,{source_to_decision:true,settings_to_decision:true,decision_to_draft:false,decision_to_posted_ledger:false,decision_to_report:false});
});

test('blocked classification produces an exception and no invented JE or report effect',()=>{
  const row=source(),packet=buildAiAccountingDecisionPacket({entityId:entity,accountingPeriodId:period,source:row,classification:classification(row,'BLOCKED',{confidence:1}),settings});
  assert.equal(packet.status,'EXCEPTION');assert.deepEqual(packet.proposed_journal.lines,[]);assert.equal(packet.proposed_journal.balanced,false);assert.deepEqual(packet.report_impact,{balance_sheet:[],income_statement:[],cash_flow:[]});assert.deepEqual(packet.action_flags,actions);
});

test('fails closed for stale settings, source drift, classification drift, or attempted authority',()=>{
  const row=source();
  for(const changed of [
    {settings:{...settings,status:'DRAFT'},classification:classification(row,'EXPENSE'),source:row},
    {settings,classification:classification(row,'EXPENSE'),source:{...row,currency:'EUR'}},
    {settings,classification:classification(row,'EXPENSE',{source_line_hash:hash(99)}),source:row},
    {settings,classification:classification(row,'EXPENSE',{action_flags:{...actions,can_create_draft:true}}),source:row}
  ])assert.throws(()=>buildAiAccountingDecisionPacket({entityId:entity,accountingPeriodId:period,...changed}));
});

test('service requires exact one-to-one source and classification populations',async()=>{
  const row1=source(10),row2=source(20),batch={results:[classification(row1,'EXPENSE'),classification(row2,'PREPAID_AMORTIZATION')]};
  const service=createAiAccountingDecisionPacketService({classificationService:{analyze:async()=>batch},settingsSnapshotReader:async()=>settings,sourceLineReader:async()=>[row1,row2]});
  const result=await service.analyze({tenantId:tenant,entityId:entity,accountingPeriodId:period});
  assert.equal(result.row_count,2);assert.deepEqual(result.decision_counts,{ready_for_human_review:2,exception:0});assert.deepEqual(result.action_flags,actions);
  const mismatch=createAiAccountingDecisionPacketService({classificationService:{analyze:async()=>batch},settingsSnapshotReader:async()=>settings,sourceLineReader:async()=>[row1]});
  await assert.rejects(()=>mismatch.analyze({tenantId:tenant,entityId:entity,accountingPeriodId:period}),error=>error.code==='AI_ACCOUNTING_DECISION_POPULATION_MISMATCH');
});

test('legacy decision response validator rejects credential material embedded in allowed text fields',async()=>{
  const row=source(),service=createAiAccountingDecisionPacketService({classificationService:{analyze:async()=>({results:[classification(row,'EXPENSE')]})},settingsSnapshotReader:async()=>settings,sourceLineReader:async()=>[row]}),safe=await service.analyze({tenantId:tenant,entityId:entity,accountingPeriodId:period});
  assert.equal(assertAiAccountingDecisionPacketBatch(safe,{tenantId:tenant,entityId:entity,accountingPeriodId:period}),safe);
  for(const reason of ['Authorization: Bearer abcdefghijklmnop','Retained memo contained pk-abcdefgh12345678'])assert.throws(()=>assertAiAccountingDecisionPacketBatch({...safe,packets:[{...safe.packets[0],reason}]},{tenantId:tenant,entityId:entity,accountingPeriodId:period}),error=>error.code==='AI_ACCOUNTING_DECISION_RESPONSE_INVALID');
});

test('an end-to-end property tax invoice reaches the packet as an exception with zero suggested lines',()=>{
  const row=source(40,{vendor_ref:'Harris County Tax Assessor-Collector',property_ref:'PROPERTY-1',project_ref:null,amount:'48250.0000'});
  const classified=classifyRetainedInvoice({
    source_document_id:row.source_document_id,source_document_line_id:row.source_document_line_id,
    source_payload_hash:row.source_payload_hash,source_line_hash:row.source_line_hash,
    entity_id:entity,accounting_period_id:period,accounting_date:'2026-06-30',
    vendor_name:'Harris County Tax Assessor-Collector',invoice_no:'TAX-2026',invoice_date:'2026-01-15',
    currency:'USD',amount:'48250.0000',service_period_start:'2026-01-01',service_period_end:'2026-12-31',
    description:'2026 property tax statement',project_ref:null,property_ref:'PROPERTY-1',member_ref:null,charge_code:'OPERATING',
    duplicate_status:'NONE',accounting_status:'NOT_RECORDED',project_status:'OPERATING',cost_class:'OPERATING_EXPENSE',
    asset_useful_life_months:null,capitalization_threshold:'5000.0000'
  });
  assert.equal(classified.classification,'BLOCKED');
  assert.equal(classified.rule_id,'AI_PAYABLE_DOCUMENT_KIND_EVIDENCE_REQUIRED_V1');
  const packet=buildAiAccountingDecisionPacket({entityId:entity,accountingPeriodId:period,source:row,classification:classified,settings});
  assert.equal(packet.status,'EXCEPTION');
  assert.equal(packet.proposed_journal.lines.length,0);
  assert.equal(packet.proposed_journal.balanced,false);
  assert.deepEqual(packet.report_impact,{balance_sheet:[],income_statement:[],cash_flow:[]});
  assert.deepEqual(packet.action_flags,actions);
  assert.equal(packet.risk_level,'HIGH');
});

test('production classification service sends common statutory property-tax documents to decision exceptions with zero suggested lines',async()=>{
  const retainedRows=[
    ['Harris County Appraisal District','2026 tax statement for parcel 0412-88-3301'],
    ['Harris County','County tax bill parcel 0412-88-3301'],
    ['Harris County Appraisal District','Notice of Appraised Value for parcel 0412-88-3301'],
    ['Harris County','County Taxes Due, parcel 0412-88-3301'],
    ['Spring Independent School District','School District Levy, property account 0412-88-3301'],
    ['Municipal Utility District','Special assessment for parcel 0412-88-3301'],
    ['Harris County','Tax invoice for parcel 0412-88-3301'],
    ['Harris County','Notice of delinquent taxes for parcel 0412-88-3301'],
    ['Spring Independent School District','School district taxes for property account 0412-88-3301'],
    ['Municipal Utility District','Municipal property levy for parcel 0412-88-3301'],
    ['Harris County','Tax certificate for parcel 0412-88-3301'],
    ['Harris County Appraisal District','Annual property assessment notice'],
    ['Harris County','Real property levy'],
    ['Harris County','Real estate assessment'],
    ['Harris County Appraisal District','Notice of appraised value, property ID 0412-88-3301'],
    ['Harris County Appraisal District','Assessed value notice'],
    ['Independent Valuation Office','Property valuation notice'],
    ['Harris County Appraisal District','Annual property appraisal notice'],
    ['Harris County Appraisal District','Notice of taxable value for parcel 0412-88-3301'],
    ['Harris County','Ad valorem charge'],
    ['Harris County','Annual millage bill'],
    ['Harris County','2026 mill rate statement'],
    ['Property Tax Advisors LLC','Property tax appeal consulting services'],
    ['Property Consultants LLC','Property assessment consulting for parcel 0412'],
    ['Valuation Advisors LLC','Property valuation consulting engagement'],
    ['Property Tax Advisors LLC','Property tax advisory retainer'],
    ['Property Tax Software LLC','Property tax software services invoice for parcel tracking'],
    ['Software LLC','Assessment software configuration'],
    ['Appeal Advisors LLC','Assessed value appeal service'],
    ['Appraisal Advisors LLC','Appraised value consulting'],
    ['Municipal Advisors LLC','Municipal property levy advisory'],
    ['Assessment Review LLC','Real estate assessment review service'],
    ['Tax Consultants LLC','Tax certificate consulting for property account'],
    ['Property Tax Attorneys LLC','County property tax legal filing for parcel']
  ].map(([vendor_name,description],index)=>{
    const n=60+index*10;
    return {source_document_id:id(n),source_document_line_id:id(n+1),source_payload_hash:hash(n),source_line_hash:hash(n+1),entity_id:entity,accounting_period_id:period,accounting_date:'2026-06-30',vendor_name,invoice_no:`TAX-2026-${index+1}`,invoice_date:'2026-01-15',currency:'USD',amount:'48250.0000',service_period_start:'2026-01-01',service_period_end:'2026-12-31',description,project_ref:null,property_ref:`PROPERTY-${index+1}`,charge_code:'OPERATING',accounting_status:'NOT_RECORDED'};
  });
  const classificationService=createAiInvoiceAccountingClassificationService({
    classificationInputReader:async()=>retainedRows,
    duplicateFindingReader:async()=>[],
    capitalizationPolicyReader:async()=>capitalizationPolicy
  });
  const decisionService=createAiAccountingDecisionPacketService({
    classificationService,
    settingsSnapshotReader:async()=>settings,
    sourceLineReader:async()=>retainedRows.map(row=>source(Number(row.source_document_id.slice(-12)),{
      source_document_id:row.source_document_id,source_document_line_id:row.source_document_line_id,
      source_payload_hash:row.source_payload_hash,source_line_hash:row.source_line_hash,
      vendor_ref:row.vendor_name,currency:row.currency,amount:row.amount,project_ref:null,property_ref:row.property_ref
    }))
  });
  const result=await decisionService.analyze({tenantId:tenant,entityId:entity,accountingPeriodId:period,limit:40});
  assert.equal(result.row_count,34);
  assert.deepEqual(result.decision_counts,{ready_for_human_review:0,exception:34});
  for(const packet of result.packets){
    assert.equal(packet.classification,'BLOCKED');
    assert.equal(packet.rule_id,'AI_PAYABLE_DOCUMENT_KIND_EVIDENCE_REQUIRED_V1');
    assert.equal(packet.status,'EXCEPTION');
    assert.deepEqual(packet.proposed_journal.lines,[]);
    assert.equal(packet.proposed_journal.balanced,false);
    assert.deepEqual(packet.report_impact,{balance_sheet:[],income_statement:[],cash_flow:[]});
    assert.deepEqual(packet.action_flags,actions);
  }
});
