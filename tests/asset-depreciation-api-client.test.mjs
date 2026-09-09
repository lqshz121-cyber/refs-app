import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,webcrypto} from 'node:crypto';
import {readAuthoritativeDepreciationOptions,createAuthoritativeAssetDepreciation} from '../src/accounting-api.js';
const tenantId=randomUUID(),entityId=randomUUID(),assetId=randomUUID(),periodId=randomUUID(),hash='sha256:'+'a'.repeat(64);
const config={tenantId,entityId,periodId,baseUrl:'https://accounting.example',getAccessToken:async()=> 'a'.repeat(48)};
const options={schema_version:'FIXED_ASSET_DEPRECIATION_OPTIONS_V2',tenant_id:tenantId,entity_id:entityId,asset_id:assetId,asset_tag:'Building 1',evidence_status:'ACTIVE',register_evidence_hash:hash,currency:'USD',cost_basis:'25000.0000',salvage_value:'1000.0000',asset_account_code:'150100',accumulated_depreciation_account_code:'159100',depreciation_expense_account_code:'610100',period:{period_id:periodId,period_code:'2026-07',starts_on:'2026-07-01',ends_on:'2026-07-31',status:'OPEN'},source:{source_document_id:randomUUID(),source_document_version:1,source_payload_hash:hash},acquisition:{binding_id:randomUUID(),journal_entry_id:randomUUID()},post_impairment_policy:null,schedule:{schedule_snapshot_hash:hash,schedule_basis:'ORIGINAL_REGISTER',revised_period_number:null,expected_period_depreciation:'200.0000',expected_accumulated_depreciation:'200.0000',expected_prior_accumulated_depreciation:'0.0000'},actual_posted_cost:'25000.0000',actual_prior_accumulated_depreciation:'0.0000',acquisition_posted:true,impairment_recorded:false,disposal_recorded:false,readiness_status:'READY',pending_journals:[],more_pending_journals:false,requires_command_validation:true};
options.member_trace={project_ref:'PROJECT-1',property_ref:'PROPERTY-1',allocation_basis:'PROJECT_PROPERTY'};
options.policy={policy_snapshot_id:randomUUID(),policy_snapshot_hash:hash,policy_snapshot_version:1,policy_version:1};
Object.assign(options.source,{source_document_line_id:randomUUID(),source_line_snapshot_hash:hash,original_evidence_id:randomUUID(),original_evidence_hash:hash});
const postPolicy={schema_version:'FIXED_ASSET_POST_IMPAIRMENT_DEPRECIATION_POLICY_V1',policy_id:randomUUID(),policy_evidence_hash:hash,status:'INDEPENDENTLY_REVIEWED',fixed_asset_register_evidence_id:assetId,impairment_assessment_evidence_id:randomUUID(),impairment_assessment_hash:hash,impairment_journal_entry_id:randomUUID(),impairment_posting_snapshot_hash:hash,effective_period_id:periodId,effective_from:'2026-08-01',convention:'NEXT_PERIOD_FULL_MONTH',remaining_useful_life_months:110,posted_cost_balance:'25000.0000',prior_accumulated_depreciation:'2000.0000',posted_accumulated_impairment:'5000.0000',revised_carrying_value:'18000.0000',salvage_value:'1000.0000',revised_depreciable_basis:'17000.0000',regular_period_amount:'154.5455',final_period_amount:'154.5405',reviewed_by:'policy-reviewer',reviewed_at:'2026-07-31T12:00:00Z',review_reason:'Independently reviewed revised useful life and amounts.'};
const revisedOptions={...options,period:{...options.period,period_code:'2026-08',starts_on:'2026-08-01',ends_on:'2026-08-31'},post_impairment_policy:postPolicy,schedule:{...options.schedule,schedule_basis:'POST_IMPAIRMENT_REVISED',revised_period_number:1,expected_period_depreciation:'154.5455',expected_accumulated_depreciation:'2154.5455',expected_prior_accumulated_depreciation:'2000.0000'},actual_prior_accumulated_depreciation:'2000.0000',impairment_recorded:true};
const receipt={schema_version:'FIXED_ASSET_DEPRECIATION_DRAFT_V1',journal_entry_id:randomUUID(),status:'DRAFT',revision:0,idempotent:false,binding_id:randomUUID(),asset_id:assetId,period_id:periodId,expected_amount:'200.0000',register_evidence_hash:hash,schedule_snapshot_hash:hash,source_document_id:options.source.source_document_id,source_document_version:options.source.source_document_version,source_payload_hash:options.source.source_payload_hash,source_link_id:randomUUID(),acquisition_binding_id:options.acquisition.binding_id,acquisition_journal_entry_id:options.acquisition.journal_entry_id};
const command={config,options,journalNumber:'DEP-1',journalDate:'2026-07-31',reason:'Record monthly depreciation',cryptoApi:webcrypto};
const response=(data,status=200)=>new Response(JSON.stringify({ok:true,data}),{status});
test('depreciation GET binds current period and rejects foreign scope',async()=>{
 let seen;assert.equal((await readAuthoritativeDepreciationOptions({config,assetId,fetcher:async(url,init)=>{seen={url,init};return response(options);}})).ok,true);
 assert.ok(seen.url.endsWith('depreciation-options?periodId='+periodId));assert.equal(seen.init.cache,'no-store');assert.equal(seen.init.credentials,'include');assert.match(seen.init.headers.authorization,/^Bearer /);assert.equal(seen.init.headers['idempotency-key'],undefined);
 for(const patch of [{entity_id:randomUUID()},{tenant_id:randomUUID()},{asset_id:randomUUID()},{period:{...options.period,period_id:randomUUID()}}])assert.equal((await readAuthoritativeDepreciationOptions({config,assetId,fetcher:async()=>response({...options,...patch})})).ok,false);
});
test('lost depreciation response retries stable identity without client amount or actor',async()=>{
 const requests=[];const fetcher=async(url,init)=>{requests.push({url,init});if(requests.length===1)throw Error('response lost');return response({...receipt,idempotent:true});};
 assert.equal((await createAuthoritativeAssetDepreciation({...command,fetcher})).ok,false);assert.equal((await createAuthoritativeAssetDepreciation({...command,fetcher})).ok,true);
 assert.equal(requests[0].init.headers['idempotency-key'],requests[1].init.headers['idempotency-key']);assert.equal(requests[1].init.headers['if-match'],undefined);
 assert.deepEqual(Object.keys(JSON.parse(requests[1].init.body)).sort(),['expectedRegisterEvidenceHash','expectedScheduleHash','journalDate','journalNumber','periodId','reason']);
 await createAuthoritativeAssetDepreciation({...command,reason:'A distinct reviewed explanation',fetcher});assert.notEqual(requests[1].init.headers['idempotency-key'],requests[2].init.headers['idempotency-key']);
});
test('reviewed revised depreciation schedule can create the next-period draft',async()=>{
 const revisedReceipt={...receipt,period_id:periodId,expected_amount:'154.5455'};
 const result=await createAuthoritativeAssetDepreciation({...command,options:revisedOptions,journalDate:'2026-08-31',fetcher:async()=>response(revisedReceipt,201)});
 assert.equal(result.ok,true);
});
test('blocked or stale depreciation cannot issue a POST',async()=>{
 let calls=0;const fetcher=async()=>{calls++;return response(receipt,201);};
 for(const patch of [{config:{...config,periodId:randomUUID()}},{journalDate:'2026-07-30'},{reason:'short'},{options:{...options,readiness_status:'BLOCKED_ALREADY_POSTED'}},{options:{...options,impairment_recorded:true}},{options:{...options,source:null,acquisition:null,acquisition_posted:false}},{options:{...options,schedule:{...options.schedule,expected_period_depreciation:'0.0000'} }},{options:{...options,actual_posted_cost:'24999.0000'}},{options:{...options,actual_prior_accumulated_depreciation:'100.0000'}}])assert.equal((await createAuthoritativeAssetDepreciation({...command,...patch,fetcher})).ok,false);
 assert.equal(calls,0);
});
test('depreciation receipt binds source schedule acquisition period amount and Draft state',async()=>{
 for(const patch of [{asset_id:randomUUID()},{period_id:randomUUID()},{expected_amount:'201.0000'},{source_document_id:randomUUID()},{source_document_version:2},{source_payload_hash:'sha256:'+'b'.repeat(64)},{schedule_snapshot_hash:'sha256:'+'b'.repeat(64)},{register_evidence_hash:'sha256:'+'b'.repeat(64)},{acquisition_binding_id:randomUUID()},{acquisition_journal_entry_id:randomUUID()},{status:'POSTED'},{revision:1},{idempotent:true},{can_post:true}])assert.equal((await createAuthoritativeAssetDepreciation({...command,fetcher:async()=>response({...receipt,...patch},201)})).ok,false);
 assert.equal((await createAuthoritativeAssetDepreciation({...command,fetcher:async()=>response(receipt,201)})).ok,true);
});
