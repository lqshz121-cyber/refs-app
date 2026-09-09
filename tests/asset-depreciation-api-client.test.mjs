import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,webcrypto} from 'node:crypto';
import {readAuthoritativeDepreciationOptions,createAuthoritativeAssetDepreciation} from '../src/accounting-api.js';
const tenantId=randomUUID(),entityId=randomUUID(),assetId=randomUUID(),periodId=randomUUID(),hash='sha256:'+'a'.repeat(64);
const config={tenantId,entityId,periodId,baseUrl:'https://accounting.example',getAccessToken:async()=> 'a'.repeat(48)};
const options={schema_version:'FIXED_ASSET_DEPRECIATION_OPTIONS_V1',tenant_id:tenantId,entity_id:entityId,asset_id:assetId,asset_tag:'Building 1',evidence_status:'ACTIVE',register_evidence_hash:hash,currency:'USD',cost_basis:'25000.0000',salvage_value:'1000.0000',asset_account_code:'150100',accumulated_depreciation_account_code:'159100',depreciation_expense_account_code:'610100',period:{period_id:periodId,period_code:'2026-07',starts_on:'2026-07-01',ends_on:'2026-07-31',status:'OPEN'},source:{source_document_id:randomUUID(),source_document_version:1,source_payload_hash:hash},acquisition:{binding_id:randomUUID(),journal_entry_id:randomUUID()},schedule:{schedule_snapshot_hash:hash,expected_period_depreciation:'200.0000',expected_accumulated_depreciation:'200.0000',expected_prior_accumulated_depreciation:'0.0000'},actual_posted_cost:'25000.0000',actual_prior_accumulated_depreciation:'0.0000',acquisition_posted:true,impairment_recorded:false,disposal_recorded:false,readiness_status:'READY',pending_journals:[],more_pending_journals:false,requires_command_validation:true};
options.member_trace={project_ref:'PROJECT-1',property_ref:'PROPERTY-1',allocation_basis:'PROJECT_PROPERTY'};
options.policy={policy_snapshot_id:randomUUID(),policy_snapshot_hash:hash,policy_snapshot_version:1,policy_version:1};
Object.assign(options.source,{source_document_line_id:randomUUID(),source_line_snapshot_hash:hash,original_evidence_id:randomUUID(),original_evidence_hash:hash});
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
test('blocked or stale depreciation cannot issue a POST',async()=>{
 let calls=0;const fetcher=async()=>{calls++;return response(receipt,201);};
 for(const patch of [{config:{...config,periodId:randomUUID()}},{journalDate:'2026-07-30'},{reason:'short'},{options:{...options,readiness_status:'BLOCKED_ALREADY_POSTED'}},{options:{...options,impairment_recorded:true}},{options:{...options,source:null,acquisition:null,acquisition_posted:false}},{options:{...options,schedule:{...options.schedule,expected_period_depreciation:'0.0000'}}}])assert.equal((await createAuthoritativeAssetDepreciation({...command,...patch,fetcher})).ok,false);
 assert.equal(calls,0);
});
test('depreciation receipt binds source schedule acquisition period amount and Draft state',async()=>{
 for(const patch of [{asset_id:randomUUID()},{period_id:randomUUID()},{expected_amount:'201.0000'},{source_document_id:randomUUID()},{source_document_version:2},{source_payload_hash:'sha256:'+'b'.repeat(64)},{schedule_snapshot_hash:'sha256:'+'b'.repeat(64)},{register_evidence_hash:'sha256:'+'b'.repeat(64)},{acquisition_binding_id:randomUUID()},{acquisition_journal_entry_id:randomUUID()},{status:'POSTED'},{revision:1},{idempotent:true},{can_post:true}])assert.equal((await createAuthoritativeAssetDepreciation({...command,fetcher:async()=>response({...receipt,...patch},201)})).ok,false);
 assert.equal((await createAuthoritativeAssetDepreciation({...command,fetcher:async()=>response(receipt,201)})).ok,true);
});
