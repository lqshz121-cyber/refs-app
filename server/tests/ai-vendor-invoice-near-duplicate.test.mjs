import assert from 'node:assert/strict';
import test from 'node:test';
import {detectVendorInvoiceNearDuplicates} from '../runtime/ai-vendor-invoice-near-duplicate.mjs';
const id=n=>`${String(n).padStart(8,'0')}-0000-4000-8000-${String(n).padStart(12,'0')}`;
const hash=n=>`sha256:${String(n%10).repeat(64)}`;
const row=(n,overrides={})=>({source_document_id:id(n),source_document_line_id:id(n+100),source_payload_hash:hash(n),source_line_hash:hash(n+1),entity_id:id(1),accounting_period_id:id(7),vendor_ref:'VENDOR-1',vendor_name:'Vendor One',invoice_number:'INV-1001',currency:'USD',amount:'500.0000',invoice_date:'2026-07-15',project_ref:'PROJECT-1',property_ref:'PROPERTY-1',source_admission_status:'ADMITTED',signature_verified:true,...overrides});
const policy={schema_version:'AI_VENDOR_INVOICE_NEAR_DUPLICATE_POLICY_V1',setting_snapshot_id:id(90),setting_snapshot_hash:hash(9),policy_version:1,maximum_date_gap_days:7,maximum_amount_variance_basis_points:100,maximum_absolute_amount_variance:'5.0000'};

test('finds punctuation-variant invoice numbers with similar amount and date while preserving both signed sources',()=>{
  const result=detectVendorInvoiceNearDuplicates([row(1),row(2,{invoice_number:'INV1001',amount:'502.0000',invoice_date:'2026-07-17'})],{policy,currentAccountingPeriodId:id(7)});
  assert.equal(result.finding_count,1);const finding=result.findings[0];assert.equal(finding.normalized_invoice_number,'INV1001');assert.equal(finding.amount_variance,'2.0000');assert.equal(finding.date_gap_days,2);assert.equal(finding.source_trace.length,2);assert.deepEqual(finding.source_trace.map(source=>source.accounting_period_id),[id(7),id(7)]);assert.deepEqual(finding.action_flags,{can_create_draft:false,can_review:false,can_approve:false,can_post:false});assert.deepEqual(finding.required_human_fields,['duplicate_determination','source_document_comparison','goods_or_services_received','payment_status','resolution_reason']);
});

test('does not relabel exact duplicate handling or compare across accounting identity and thresholds',()=>{
  assert.equal(detectVendorInvoiceNearDuplicates([row(1),row(2)],{policy,currentAccountingPeriodId:id(7)}).finding_count,0);
  for(const changed of [{entity_id:id(8)},{vendor_ref:'OTHER'},{currency:'CAD'},{project_ref:'OTHER'},{property_ref:'OTHER'},{invoice_number:'INV-2002'},{amount:'510.0000'},{invoice_date:'2026-08-01'}])assert.equal(detectVendorInvoiceNearDuplicates([row(1),row(2,{invoice_number:'INV1001',...changed})],{policy,currentAccountingPeriodId:id(7)}).finding_count,0);
});

test('fails closed for unsigned, unadmitted, incomplete, oversized, or policy-free evidence',()=>{
  for(const changed of [{signature_verified:false},{source_admission_status:'REJECTED'},{invoice_number:''},{source_payload_hash:'bad'},{amount:'500'}])assert.throws(()=>detectVendorInvoiceNearDuplicates([row(1),row(2,changed)],{policy,currentAccountingPeriodId:id(7)}),error=>error.code==='AI_VENDOR_NEAR_DUPLICATE_SOURCE_INVALID');
  assert.throws(()=>detectVendorInvoiceNearDuplicates([],{currentAccountingPeriodId:id(7)}),error=>error.code==='AI_VENDOR_NEAR_DUPLICATE_POLICY_REQUIRED');
  assert.throws(()=>detectVendorInvoiceNearDuplicates(Array.from({length:501},(_,index)=>row(index+1)),{policy,currentAccountingPeriodId:id(7)}),error=>error.code==='AI_VENDOR_NEAR_DUPLICATE_SCOPE_INVALID');
});

test('rejects duplicate retained lines and extra policy fields before secrets or invented authority can reach findings',()=>{
  const duplicate={...row(2,{invoice_number:'INV1001'}),source_document_line_id:row(1).source_document_line_id};
  assert.throws(()=>detectVendorInvoiceNearDuplicates([row(1),duplicate],{policy,currentAccountingPeriodId:id(7)}),error=>error.code==='AI_VENDOR_NEAR_DUPLICATE_SOURCE_DUPLICATE');
  for(const extra of [{authorization:'Bearer secret'},{api_key:'sk-secret'},{can_create_draft:true},{internal_rule_payload:{secret:'value'}}])assert.throws(()=>detectVendorInvoiceNearDuplicates([],{policy:{...policy,...extra},currentAccountingPeriodId:id(7)}),error=>error.code==='AI_VENDOR_NEAR_DUPLICATE_POLICY_REQUIRED');
});
