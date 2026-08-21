import assert from 'node:assert/strict';
import test from 'node:test';
import {projectAiAccountingDecisionControllerScan} from '../runtime/ai-accounting-decision-controller-scan.mjs';
import {createAiFullControllerScanService} from '../runtime/ai-full-controller-scan-service.mjs';

const id=n=>`${String(n).padStart(8,'0')}-0000-4000-8000-${String(n).padStart(12,'0')}`;
const hash=n=>`sha256:${String(n).repeat(64).slice(0,64)}`;
const tenantId=id(1),entityId=id(2),accountingPeriodId=id(3);
const actions=Object.freeze({can_create_draft:false,can_review:false,can_approve:false,can_post:false});
const packet=(overrides={})=>({schema_version:'AI_ACCOUNTING_DECISION_PACKET_V1',status:'READY_FOR_HUMAN_REVIEW',tenant_id:tenantId,entity_id:entityId,accounting_period_id:accountingPeriodId,company_code:'WBPA',accounting_date:'2026-08-20',settings_snapshot_id:id(4),settings_snapshot_hash:hash(4),source:{source_document_id:id(5),source_document_line_id:id(6),source_type:'INVOICE',source_payload_hash:hash(5),source_line_hash:hash(6)},classification:'EXPENSE',rule_id:'EXPENSE_POLICY_V1',reason:'Approved policy classifies the admitted invoice as a current-period expense.',risk:{risk_level:'MEDIUM'},proposed_journal:{status:'SUGGESTED_ONLY',lines:[{side:'DEBIT',amount:'100.0000'},{side:'CREDIT',amount:'100.0000'}]},expected_report_deltas:[{statement:'INCOME_STATEMENT',amount:'100.0000'}],action_flags:actions,...overrides});
const batch=packets=>({schema_version:'AI_ACCOUNTING_DECISION_PACKET_FULL_BATCH_V1',scope:{tenant_id:tenantId,entity_id:entityId,accounting_period_id:accountingPeriodId},row_count:packets.length,decision_counts:{ready_for_human_review:packets.filter(row=>row.status==='READY_FOR_HUMAN_REVIEW').length,exception:packets.filter(row=>row.status==='EXCEPTION').length},packets,action_flags:actions});

test('projects approved Settings decisions into full Controller findings without accounting authority',()=>{
  const source=packet(),result=projectAiAccountingDecisionControllerScan(batch([source]),{tenantId,entityId,accountingPeriodId}),finding=result.findings[0];
  assert.equal(result.schema_version,'AI_ACCOUNTING_DECISION_CONTROLLER_SCAN_BATCH_V1');assert.equal(result.scanned_source_count,1);assert.equal(result.finding_count,1);
  assert.equal(finding.rule_id,'EXPENSE_POLICY_V1');assert.equal(finding.risk_level,'MEDIUM');assert.equal(finding.source_document_id,id(5));assert.equal(finding.decision_packet,source);
  assert.deepEqual(finding.decision_packet.proposed_journal.lines,source.proposed_journal.lines);assert.deepEqual(finding.decision_packet.expected_report_deltas,source.expected_report_deltas);
  assert.deepEqual(finding.action_flags,actions);assert.deepEqual(result.action_flags,actions);
});

test('projected packets pass the actual full Controller section safety gate',async()=>{
  const projected=projectAiAccountingDecisionControllerScan(batch([packet()]),{tenantId,entityId,accountingPeriodId}),result=await createAiFullControllerScanService({analyzers:{ACCOUNTING_DECISION:{analyze:async()=>projected}}}).analyze({tenantId,entityId,currentAccountingPeriodId:accountingPeriodId});
  assert.equal(result.status,'COMPLETE');assert.equal(result.complete_section_count,1);assert.equal(result.sections[0].status,'COMPLETE');assert.equal(result.sections[0].findings[0].source_document_id,id(5));
});

test('raises exceptions to high risk while retaining zero-line, zero-delta evidence',()=>{
  const source=packet({status:'EXCEPTION',risk:{risk_level:'LOW'},proposed_journal:{status:'SUGGESTED_ONLY',lines:[]},expected_report_deltas:[]}),finding=projectAiAccountingDecisionControllerScan(batch([source]),{tenantId,entityId,accountingPeriodId}).findings[0];
  assert.equal(finding.risk_level,'HIGH');assert.match(finding.suggested_action,/Resolve/);assert.equal(finding.decision_packet.proposed_journal.lines.length,0);assert.equal(finding.decision_packet.expected_report_deltas.length,0);
});

test('fails closed for wrong scope, unsafe status, action authority, or inconsistent counts',()=>{
  for(const invalid of [batch([packet({entity_id:id(9)})]),batch([packet({status:'POSTED'})]),batch([packet({action_flags:{...actions,can_post:true}})]),{...batch([packet()]),row_count:2}])assert.throws(()=>projectAiAccountingDecisionControllerScan(invalid,{tenantId,entityId,accountingPeriodId}),error=>error.code==='AI_ACCOUNTING_DECISION_RESPONSE_INVALID');
});
