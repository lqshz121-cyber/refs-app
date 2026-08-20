import test from 'node:test';
import assert from 'node:assert/strict';
import {buildAiAccountingDecisionPacketFullV1} from '../runtime/ai-accounting-decision-packet-full-contract.mjs';
import {hashAiAccountingEvidence,reviewAiAccountingPostedOutcomeFullV1} from '../runtime/ai-accounting-posted-outcome-full-contract.mjs';

const id=n=>`${String(n).padStart(8,'0')}-0000-4000-8000-${String(n).padStart(12,'0')}`;
const hash=n=>`sha256:${String(n).repeat(64).slice(0,64)}`;
const scope={tenantId:id(1),entityId:id(2),accountingPeriodId:id(3)};
const source={schema_version:'AI_ACCOUNTING_SOURCE_V1',tenant_id:scope.tenantId,entity_id:scope.entityId,company_code:'WBPA',accounting_period_id:scope.accountingPeriodId,business_date:'2026-07-15',accounting_date:'2026-07-15',currency:'USD',amount:'100.0000',source_document_id:id(4),source_document_line_id:id(5),source_payload_hash:hash(1),source_line_hash:hash(2),source_type:'INVOICE',project_ref:null,property_ref:null,vendor_ref:'VENDOR-7',member_ref:null,cost_code_ref:null,completeness_status:'COMPLETE',duplicate_status:'NONE',admission_status:'ADMITTED',exception_codes:[],source_detail:{invoice_date:'2026-07-15',invoice_number:'INV-7',service_period_end:'2026-07-31',service_period_start:'2026-07-01'}};
const traces=['ACCOUNT','CLASSIFICATION','MATERIALITY','APPROVAL','REPORT'].map((policy_type,index)=>({policy_type,snapshot_id:id(30+index),version:1,snapshot_hash:hash(3+index),rule_id:`${policy_type}_RULE_V1`}));
const line=(line_number,side,account_code,amount='100.0000')=>({line_number,side,account_code,account_class:side==='DEBIT'?'EXPENSE':'LIABILITY',account_type:side==='DEBIT'?'OPERATING_EXPENSE':'ACCOUNTS_PAYABLE',amount,currency:'USD',project_ref:null,property_ref:null,member_ref:null,cost_code_ref:null,dimension_requirements:[],source_document_id:id(4),source_document_line_id:id(5),source_line_hash:hash(2)});
const delta={statement:'INCOME_STATEMENT',accounting_period_id:scope.accountingPeriodId,account_code:'610000',account_class:'EXPENSE',direction:'INCREASE',amount:'100.0000',currency:'USD',project_ref:null,property_ref:null,member_ref:null,cost_code_ref:null,source_document_line_id:id(5)};
const packet=buildAiAccountingDecisionPacketFullV1({...scope,source,classification:'EXPENSE',ruleId:'EXPENSE_POLICY_V1',reason:'Approved current-period expense.',confidence:.94,risk:{risk_level:'MEDIUM',policy_rule_id:'RISK_POLICY_V1',materiality_threshold:'50.0000',approval_threshold:'500.0000',confidence_floor:.9,threshold_comparison:'AT_OR_ABOVE_MATERIALITY'},requiredHumanFields:['controller_conclusion'],policyTraces:traces,proposedJournal:{status:'SUGGESTED_ONLY',balanced:true,reversal_policy:'NONE',lines:[line(1,'DEBIT','610000'),line(2,'CREDIT','211000')]},expectedReportDeltas:[delta]});
const actual=(sourceLine,index)=>({...sourceLine,journal_line_id:id(50+index),ledger_line_id:id(60+index)});
const postedLines=packet.proposed_journal.lines.map(actual);
const receiptPayload={decision_packet_id:id(40),decision_packet_hash:hashAiAccountingEvidence(packet),journal_entry_id:id(42),source_document_id:id(4),source_document_line_id:id(5),created_by:'draft-maker',created_at:'2026-08-20T11:00:00Z'};
const receipt={decision_packet_id:id(40),decision_packet_hash:hashAiAccountingEvidence(packet),draft_receipt_id:id(41),draft_receipt_hash:hashAiAccountingEvidence(receiptPayload),draft_receipt_payload:receiptPayload,journal_entry_id:id(42),source_document_id:id(4),source_document_line_id:id(5)};
const journal=lines=>({status:'POSTED',journal_entry_id:id(42),journal_number:'JE-2026-0001',entity_id:scope.entityId,company_code:'WBPA',accounting_period_id:scope.accountingPeriodId,prepared_by:'maker',reviewed_by:'reviewer',approved_by:'approver',posted_by:'poster',lines});
const tb=lines=>({status:'POSTED_LEDGER_ONLY',snapshot_id:id(70),snapshot_hash:hash(9),entity_id:scope.entityId,accounting_period_id:scope.accountingPeriodId,journal_entry_id:id(42),ledger_line_ids:lines.map(row=>row.ledger_line_id),deltas:lines.map(row=>({side:row.side,account_code:row.account_code,account_class:row.account_class,amount:row.amount,currency:row.currency,project_ref:row.project_ref,property_ref:row.property_ref,member_ref:row.member_ref,cost_code_ref:row.cost_code_ref}))});
const report=(lines,deltas=[delta])=>({status:'POSTED_LEDGER_ONLY',report_snapshot_id:id(71),report_snapshot_hash:hash(10),trial_balance_snapshot_id:id(70),entity_id:scope.entityId,accounting_period_id:scope.accountingPeriodId,journal_entry_ids:[id(42)],ledger_line_ids:lines.map(row=>row.ledger_line_id),source_document_ids:[id(4)],deltas});

test('proves exact decision to Draft receipt to Posted JE to ledger/TB to report lineage',()=>{
  const result=reviewAiAccountingPostedOutcomeFullV1({packet,decisionToDraftReceipt:receipt,postedJournal:journal(postedLines),trialBalanceSnapshot:tb(postedLines),reportSnapshot:report(postedLines)});
  assert.equal(result.status,'CONSISTENT');assert.equal(result.journal_exact,true);assert.equal(result.trial_balance_exact,true);assert.equal(result.report_exact,true);assert.equal(result.unexpected_effect_count,0);assert.deepEqual(result.action_flags,{can_create_draft:false,can_review:false,can_approve:false,can_post:false});
});

test('unexpected or reversed report effects are MISMATCH rather than subset-pass',()=>{
  const extra={...delta,statement:'BALANCE_SHEET',account_code:'999999',account_class:'ASSET'};
  const result=reviewAiAccountingPostedOutcomeFullV1({packet,decisionToDraftReceipt:receipt,postedJournal:journal(postedLines),trialBalanceSnapshot:tb(postedLines),reportSnapshot:report(postedLines,[delta,extra])});
  assert.equal(result.status,'MISMATCH');assert.equal(result.unexpected_effect_count,1);
  const reversed={...delta,direction:'DECREASE'};
  assert.equal(reviewAiAccountingPostedOutcomeFullV1({packet,decisionToDraftReceipt:receipt,postedJournal:journal(postedLines),trialBalanceSnapshot:tb(postedLines),reportSnapshot:report(postedLines,[reversed])}).status,'MISMATCH');
});

test('rejects unbalanced GL, TB drift, missing receipt lineage, or failed SoD',()=>{
  const unbalanced=[postedLines[0],{...postedLines[1],amount:'99.0000'}];
  assert.throws(()=>reviewAiAccountingPostedOutcomeFullV1({packet,decisionToDraftReceipt:receipt,postedJournal:journal(unbalanced),trialBalanceSnapshot:tb(unbalanced),reportSnapshot:report(unbalanced)}),error=>error.code==='AI_ACCOUNTING_OUTCOME_POSTED_JOURNAL_INVALID');
  assert.throws(()=>reviewAiAccountingPostedOutcomeFullV1({packet,decisionToDraftReceipt:receipt,postedJournal:journal(postedLines),trialBalanceSnapshot:{...tb(postedLines),deltas:[]},reportSnapshot:report(postedLines)}),error=>error.code==='AI_ACCOUNTING_OUTCOME_TRIAL_BALANCE_INVALID');
  assert.throws(()=>reviewAiAccountingPostedOutcomeFullV1({packet,decisionToDraftReceipt:{...receipt,draft_receipt_hash:hash(7)},postedJournal:journal(postedLines),trialBalanceSnapshot:tb(postedLines),reportSnapshot:report(postedLines)}),error=>error.code==='AI_ACCOUNTING_OUTCOME_TRACE_INVALID');
  const sod={...journal(postedLines),posted_by:'approver'};
  assert.throws(()=>reviewAiAccountingPostedOutcomeFullV1({packet,decisionToDraftReceipt:receipt,postedJournal:sod,trialBalanceSnapshot:tb(postedLines),reportSnapshot:report(postedLines)}),error=>error.code==='AI_ACCOUNTING_OUTCOME_POSTED_JOURNAL_INVALID');
});

test('records a canonical human-authorized variance without calling it exact',()=>{
  const changed=[{...postedLines[0],account_code:'620000'},postedLines[1]],actualReport=[{...delta,account_code:'620000'}];
  const expectedLines=packet.proposed_journal.lines,actualLines=changed.map(({journal_line_id,ledger_line_id,...row})=>row);
  const base={status:'HUMAN_AUTHORIZED',authorized_by:'controller-variance',authorized_at:'2026-08-20T12:00:00Z',reason:'Controller approved a documented account reclassification.',expected_journal_hash:hashAiAccountingEvidence(expectedLines),actual_journal_hash:hashAiAccountingEvidence(actualLines),expected_report_hash:hashAiAccountingEvidence(packet.expected_report_deltas),actual_report_hash:hashAiAccountingEvidence(actualReport)};
  const variance={...base,variance_hash:hashAiAccountingEvidence({decision_packet_hash:hashAiAccountingEvidence(packet),expected_journal_hash:base.expected_journal_hash,actual_journal_hash:base.actual_journal_hash,expected_report_hash:base.expected_report_hash,actual_report_hash:base.actual_report_hash,reason:base.reason,authorized_by:base.authorized_by,authorized_at:base.authorized_at})};
  const result=reviewAiAccountingPostedOutcomeFullV1({packet,decisionToDraftReceipt:receipt,postedJournal:journal(changed),trialBalanceSnapshot:tb(changed),reportSnapshot:report(changed,actualReport),humanAuthorizedVariance:variance});
  assert.equal(result.status,'HUMAN_AUTHORIZED_VARIANCE');assert.equal(result.journal_exact,false);assert.equal(result.report_exact,false);assert.equal(result.variance_authorized,true);
});
