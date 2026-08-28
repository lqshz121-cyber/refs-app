import assert from 'node:assert/strict';
import test from 'node:test';
import {buildAiFullControllerScanEvidence} from '../runtime/ai-full-controller-scan-evidence-contract.mjs';

const tenant='11111111-1111-4111-8111-111111111111',entity='22222222-2222-4222-8222-222222222222',period='33333333-3333-4333-8333-333333333333';
const actions={can_create_draft:false,can_review:false,can_approve:false,can_post:false};
const finding={entity_id:entity,accounting_period_id:period,rule_id:'AI_VENDOR_SPIKE_V1',risk_level:'HIGH',reason:'Current vendor spend is five times its retained historical baseline.',suggested_action:'Review the complete source population before any accounting action.'};
const scan=()=>({schema_version:'AI_FULL_CONTROLLER_SCAN_V1',entity_id:entity,current_accounting_period_id:period,status:'INCOMPLETE',required_section_count:2,complete_section_count:1,finding_count:1,risk_summary:{high:1,medium:0,low:0},coverage_summary:{complete_section_count:1,unavailable_section_count:1,unavailable_sections:[{category:'BANK_RECONCILIATION',error_code:'AI_BANK_SOURCE_UNAVAILABLE'}]},sections:[{category:'BANK_RECONCILIATION',status:'UNAVAILABLE',error_code:'AI_BANK_SOURCE_UNAVAILABLE',finding_count:null,findings:[],action_flags:actions},{category:'VENDOR_SPEND',status:'COMPLETE',schema_version:'AI_VENDOR_SPEND_BATCH_V1',finding_count:1,findings:[finding],action_flags:actions}],action_flags:actions});
const input=value=>({tenantId:tenant,entityId:entity,accountingPeriodId:period,releaseSha:'a'.repeat(40),capturedAt:'2026-08-23T20:30:00.000Z',requestedLimit:500,scan:value});

test('builds one canonical release-bound snapshot with stable section and finding hashes',()=>{
  const first=buildAiFullControllerScanEvidence(input(scan())),second=buildAiFullControllerScanEvidence(input(structuredClone(scan())));
  assert.deepEqual(first,second);assert.match(first.snapshot_hash,/^sha256:[0-9a-f]{64}$/);assert.deepEqual(first.registered_section_categories,['BANK_RECONCILIATION','VENDOR_SPEND']);
  assert.match(first.sections[1].section_hash,/^sha256:[0-9a-f]{64}$/);assert.match(first.sections[1].findings[0].finding_hash,/^sha256:[0-9a-f]{64}$/);assert.equal(first.sections[1].findings[0].finding_index,0);assert.deepEqual(first.action_flags,actions);
});
test('rejects missing sections, count/risk drift, duplicate findings, scope drift, unsafe secrets, and action authority',()=>{
  const mutations=[
    value=>{value.sections.pop();},value=>{value.finding_count=2;},value=>{value.risk_summary.high=0;},
    value=>{value.sections[1].findings.push(structuredClone(finding));value.sections[1].finding_count=2;value.finding_count=2;value.risk_summary.high=2;},
    value=>{value.sections[1].findings[0].entity_id=tenant;},value=>{value.sections[1].findings[0].reason='Authorization: Bearer abcdefghijklmnop';},value=>{value.action_flags.can_post=true;}
  ];
  for(const mutate of mutations){const value=structuredClone(scan());mutate(value);assert.throws(()=>buildAiFullControllerScanEvidence(input(value)),error=>/^AI_FULL_SCAN_EVIDENCE_/.test(error.code));}
});

test('rejects impossible timestamps, unordered or duplicate categories, and malformed unavailable sections',()=>{
  assert.throws(()=>buildAiFullControllerScanEvidence({...input(scan()),capturedAt:'2026-02-30T00:00:00.000Z'}),error=>error.code==='AI_FULL_SCAN_EVIDENCE_SCOPE_INVALID');
  for(const mutate of [value=>value.sections.reverse(),value=>{value.sections[1].category='BANK_RECONCILIATION';},value=>{value.sections[0].findings=[finding];}]){const value=structuredClone(scan());mutate(value);assert.throws(()=>buildAiFullControllerScanEvidence(input(value)),error=>/^AI_FULL_SCAN_EVIDENCE_/.test(error.code));}
});
