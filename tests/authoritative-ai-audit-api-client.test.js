import assert from 'node:assert/strict';
import {refreshAuthoritativeAiWbsExceptionFindings} from '../src/accounting-api.js';

const entityId='11111111-1111-4111-8111-111111111111';
const config={entityId,periodId:'33333333-3333-4333-8333-333333333333',baseUrl:'https://accounting.example',getAccessToken:async()=> 'a'.repeat(48)};
const row={ai_finding_id:'22222222-2222-4222-8222-222222222222',finding_key:'WBS_EXCEPTION:33333333-3333-4333-8333-333333333333',source_evidence_row_id:'33333333-3333-4333-8333-333333333333',source_record_id:'AP-2026-001',source_version:'operator:2026-01-01:abc',source_row_hash:`sha256:${'1'.repeat(64)}`,provider_content_hash:`sha256:${'2'.repeat(64)}`,observation_hash:`sha256:${'3'.repeat(64)}`,rule_id:'WBS_UNSIGNED_SOURCE',risk_level:'MEDIUM',confidence:'0.9800',status:'OPEN',reason:'Unsigned provider source remains exception evidence.',suggested_action:'Obtain a provider-signed source before human review.',suggested_owner:'CONTROLLER',due_date:null,due_date_status:'HUMAN_ASSIGNMENT_REQUIRED',created_at:'2026-08-14T00:00:00.000Z',can_create_draft:false,can_review:false,can_approve:false,can_post:false};
let call;
const result=await refreshAuthoritativeAiWbsExceptionFindings({config,fetcher:async(url,options)=>{call={url,options};return {ok:true,json:async()=>({ok:true,data:[row]})};}});
assert.equal(result.ok,true);assert.equal(result.rows[0].confidence,0.98);assert.match(call.url,/\/ai\/findings\/wbs-exceptions\?limit=50$/);assert.equal(call.options.method,'GET');assert.equal(call.options.credentials,'include');assert.equal(call.options.cache,'no-store');assert.equal(call.options.headers.authorization,`Bearer ${'a'.repeat(48)}`);assert.equal('body' in call.options,false);
const read=async data=>refreshAuthoritativeAiWbsExceptionFindings({config,fetcher:async()=>({ok:true,json:async()=>({ok:true,data})})});
for(const invalid of [{...row,can_post:true},{...row,source_row_hash:'sha256:bad'},{...row,confidence:'0.98000'},{...row,unexpected:'credential'}])assert.equal((await read([invalid])).code,'AI_WBS_EXCEPTION_FINDING_PROTOCOL');
assert.equal((await read([row,{...row,ai_finding_id:'44444444-4444-4444-8444-444444444444'}])).code,'AI_WBS_EXCEPTION_FINDING_PROTOCOL','duplicate immutable source evidence must fail closed');
assert.equal((await refreshAuthoritativeAiWbsExceptionFindings({config,limit:101,fetcher:async()=>{throw new Error('must not fetch');}})).code,'AI_WBS_EXCEPTION_FINDING_SCOPE_INVALID');
console.log('authoritative AI Audit API client: immutable findings are strictly scoped and action-free');
