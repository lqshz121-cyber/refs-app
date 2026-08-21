import assert from 'node:assert/strict';
import {refreshAuthoritativeAiSecurityDepositLiabilityReviews} from '../src/accounting-api.js';

const id=n=>`${String(n).padStart(8,'0')}-1111-4111-8111-${String(n).padStart(12,'0')}`;
const hash=n=>`sha256:${String(n).repeat(64).slice(0,64)}`;
const actions={can_create_draft:false,can_review:false,can_approve:false,can_post:false};
const config={baseUrl:'https://accounting.example',entityId:id(1),periodId:id(2),getAccessToken:async()=>'controlled-token-value'};
const row={schema_version:'AI_SECURITY_DEPOSIT_LIABILITY_REVIEW_V1',finding_type:'SECURITY_DEPOSIT_REVENUE_MISCLASSIFICATION',risk_level:'HIGH',rule_id:'AI_SECURITY_DEPOSIT_LIABILITY_V1',entity_id:config.entityId,accounting_period_id:config.periodId,source_classification:'SECURITY_DEPOSIT',mapping_status:'APPROVED_EXACT',period_id:config.periodId,source_document_id:id(3),source_document_line_id:id(4),source_payload_hash:hash(1),source_line_hash:hash(2),mapping_snapshot_id:id(5),mapping_snapshot_hash:hash(3),property_ref:'PROPERTY-1',unit_ref:'UNIT-101',lease_ref:'LEASE-1',tenant_ref:'TENANT-1',currency:'USD',deposit_amount:'500.0000',posted_revenue_amount:'500.0000',posted_liability_amount:'0.0000',revenue_account_code:'466000',security_deposit_liability_account_code:'225001',journal_entry_ids:[id(6)],journal_line_ids:[id(7),id(8)],ledger_line_ids:[id(9),id(10)],lineage_status:'SOURCE_LINE_BOUND_POSTED',liability_variance:'500.0000',reason:'Refundable tenant deposit was recorded as revenue.',suggested_action:'Verify refundability and prepare a reviewed reclassification.',suggested_journal_entry:{status:'SUGGESTED_ONLY',debit_account_code:'466000',credit_account_code:'225001',amount:'500.0000',memo:'Reclass refundable security deposit',source_document_id:id(3),source_document_line_id:id(4),debits_equal_credits:true},required_human_fields:['refundability_review','lease_terms_review','forfeiture_evidence_if_any','posted_line_review','controller_approval'],action_flags:actions};
const envelope=findings=>({ok:true,data:{schema_version:'AI_SECURITY_DEPOSIT_LIABILITY_REVIEW_BATCH_V1',scanned_deposit_count:findings.length,finding_count:findings.length,findings,action_flags:actions}});
const run=payload=>refreshAuthoritativeAiSecurityDepositLiabilityReviews({config,limit:100,fetcher:async(url,options)=>{assert.equal(url,`https://accounting.example/api/v1/entities/${config.entityId}/ai/security-deposits/liability-review?periodId=${config.periodId}&limit=100`);assert.equal(options.method,'GET');assert.equal(options.credentials,'include');assert.equal(options.cache,'no-store');assert.equal(options.headers.authorization,'Bearer controlled-token-value');return {ok:true,json:async()=>payload};}});

assert.equal((await run(envelope([row]))).ok,true);
const missingLiability={...row,posted_revenue_amount:'0.0000',posted_liability_amount:'0.0000',suggested_journal_entry:null};
assert.equal((await run(envelope([missingLiability]))).ok,true);
for(const invalid of [
  {...row,entity_id:id(99)},
  {...row,action_flags:{...actions,can_post:true}},
  {...row,source_payload_hash:'secret'},
  {...row,suggested_journal_entry:{...row.suggested_journal_entry,credit_account_code:'999999'}},
  {...row,suggested_journal_entry:null},
  {...row,raw_provider_payload:{authorization:'forbidden'}}
])assert.equal((await run(envelope([invalid]))).ok,false);
assert.equal((await run(envelope([row,row]))).ok,false);
console.log('authoritative AI security-deposit client: strict source-bound suggested-only DTO passed');
