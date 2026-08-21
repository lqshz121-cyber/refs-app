import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeClosingSettlement,classifyClosingSettlementLine} from '../runtime/ai-closing-settlement-review.mjs';

const ids={entity:'11111111-1111-4111-8111-111111111111',period:'22222222-2222-4222-8222-222222222222',doc:'33333333-3333-4333-8333-333333333333'};
const line=(n,overrides={})=>({source_document_id:ids.doc,source_document_line_id:`44444444-4444-4444-8444-${String(n).padStart(12,'0')}`,source_payload_hash:`sha256:${'a'.repeat(64)}`,source_line_hash:`sha256:${String(n%10).repeat(64)}`,entity_id:ids.entity,accounting_period_id:ids.period,settlement_type:'PURCHASE',closing_date:'2026-08-20',line_code:'PURCHASE PRICE',description:'Purchase price',side:'DEBIT',amount:'500000.0000',currency:'USD',property_ref:'PROPERTY-1',project_ref:'PROJECT-1',counterparty_name:'Seller LLC',...overrides});

test('closing lines classify purchase price, loan, title, proration, escrow, credit and professional fees without accounting authority',()=>{
  const cases=[['PURCHASE_PRICE','PURCHASE PRICE','Purchase price'],['LOAN_PROCEEDS','LOAN','Mortgage loan proceeds'],['TITLE_OR_CLOSING_COST','TITLE','Title insurance fee'],['TAX_OR_OPERATING_PRORATION','TAX','Property tax proration'],['ESCROW_OR_DEPOSIT','RESERVE','Tax reserve'],['CREDIT_OR_CONCESSION','CREDIT','Seller credit'],['BROKER_OR_PROFESSIONAL_FEE','COMMISSION','Broker commission']];
  for(const [expected,line_code,description] of cases){const result=classifyClosingSettlementLine(line(1,{line_code,description}));assert.equal(result.treatment,expected);assert.deepEqual(result.action_flags,{can_create_draft:false,can_review:false,can_approve:false,can_post:false});assert.match(result.reason,/retained/i);}
});

test('missing property, ambiguous nature and malformed source fail closed',()=>{
  assert.equal(classifyClosingSettlementLine(line(1,{property_ref:null})).rule_id,'AI_CLOSING_PROPERTY_REQUIRED_V1');
  assert.equal(classifyClosingSettlementLine(line(1,{description:'Seller credit for title fee'})).rule_id,'AI_CLOSING_TREATMENT_AMBIGUOUS_OR_UNSUPPORTED_V1');
  const malformed=line(1);delete malformed.source_line_hash;assert.equal(classifyClosingSettlementLine(malformed).rule_id,'AI_CLOSING_SETTLEMENT_SOURCE_INVALID_V1');
});

test('batch produces a source-bound imbalance finding and balanced statement produces none',()=>{
  const debit=line(1),credit=line(2,{line_code:'LOAN',description:'Mortgage loan proceeds',side:'CREDIT'});
  const unbalanced=analyzeClosingSettlement([debit,{...credit,amount:'450000.0000'}],{entityId:ids.entity,accountingPeriodId:ids.period});
  assert.equal(unbalanced.finding_count,3);assert.equal(unbalanced.findings.at(-1).finding_type,'CLOSING_SETTLEMENT_IMBALANCE');assert.equal(unbalanced.findings.at(-1).amount,'50000.0000');
  const balanced=analyzeClosingSettlement([debit,credit],{entityId:ids.entity,accountingPeriodId:ids.period});assert.equal(balanced.finding_count,2);assert.equal(balanced.findings.some(item=>item.finding_type==='CLOSING_SETTLEMENT_IMBALANCE'),false);
});

test('scope and population are bounded',()=>{assert.throws(()=>analyzeClosingSettlement(new Array(501).fill(line(1)),{entityId:ids.entity,accountingPeriodId:ids.period}),error=>error.code==='AI_CLOSING_SETTLEMENT_SCOPE_INVALID');});
