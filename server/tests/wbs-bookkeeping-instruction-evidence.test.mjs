import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const file=new URL('../contracts/wbs-bookkeeping-instruction-evidence.v1.json',import.meta.url);
const evidence=JSON.parse(await readFile(file,'utf8'));
const SHA=/^[0-9a-f]{64}$/;

test('bookkeeping instruction evidence is closed, source-bound, and never grants accounting actions',()=>{
  assert.equal(evidence.schema_version,'WBS_BOOKKEEPING_INSTRUCTION_EVIDENCE_V1');
  assert.equal(evidence.evidence_status,'UNAPPROVED_SOURCE_INSTRUCTION');
  assert.match(evidence.archive_sha256,SHA);
  assert.deepEqual(evidence.action_flags,{can_create_draft:false,can_submit:false,can_review:false,can_approve:false,can_post:false});
  assert.ok(evidence.rules.length>=14);
  assert.equal(new Set(evidence.rules.map(rule=>rule.rule_id)).size,evidence.rules.length);
  for(const rule of evidence.rules){
    assert.deepEqual(Object.keys(rule).sort(),['fact','required_binding','rule_id','source']);
    assert.match(rule.rule_id,/^[A-Z0-9_]+$/);
    assert.deepEqual(Object.keys(rule.source).sort(),['rows','sha256','sheet','workbook']);
    assert.match(rule.source.sha256,SHA);
    assert.ok(Array.isArray(rule.source.rows)&&rule.source.rows.length>0&&rule.source.rows.every(Number.isSafeInteger));
    assert.ok(Array.isArray(rule.required_binding)&&rule.required_binding.length>0);
    assert.ok(!JSON.stringify(rule).includes('can_post'));
  }
});

test('instruction evidence covers the observed depreciation, allocation, vertical-development, and loan families',()=>{
  const ids=new Set(evidence.rules.map(rule=>rule.rule_id));
  for(const id of ['DEPRECIATION_RESIDENTIAL_HOMES','INVOICE_PROPERTY_ALLOCATION','INVOICE_ALLOCATION_REVIEW','VERTICAL_CWIP_BEFORE_COMPLETION','LOAN_DRAW','LOAN_COST_AMORTIZATION','LOAN_INTEREST','LOAN_PRINCIPAL_REPAYMENT'])assert.ok(ids.has(id),id);
});
