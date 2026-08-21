import test from 'node:test';
import assert from 'node:assert/strict';
import {assertAiAccountingDecisionPacketBatch,buildAiAccountingDecisionPacket,createAiAccountingDecisionPacketService} from '../runtime/ai-accounting-decision-packet.mjs';

const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const hash=n=>`sha256:${n.toString(16).padStart(64,'0')}`;
const actions={can_create_draft:false,can_review:false,can_approve:false,can_post:false};
const entity=id(1),period=id(2),tenant=id(3);
const settings={schema_version:'AI_ACCOUNTING_SETTINGS_SNAPSHOT_V1',snapshot_id:id(4),version:7,snapshot_hash:hash(4),status:'APPROVED',entity_id:entity,accounting_period_id:period,currency:'USD',account_mappings:{expense_account_code:'610000',prepaid_asset_account_code:'140000',accrued_liability_account_code:'220000',cwip_account_code:'150000',accounts_payable_account_code:'210000'}};
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
