import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {renderToStaticMarkup} from 'react-dom/server';
import {ProviderEvidenceTrace} from '../src/authoritative-lineage-drill.jsx';
import {readAuthoritativeSourceDocumentDetail} from '../src/accounting-api.js';
import {adaptProviderTraceForUi,PROVIDER_TRACE_DTO} from '../src/provider-trace-adapter.js';

const sourcePayloadHash=`sha256:${'b'.repeat(64)}`;
const readOnlyActions={can_propose_amortization:false,can_review:false,can_create_draft:false,can_approve:false,can_post:false};
const payable={source_document_line_id:'11111111-1111-4111-8111-111111111111',line_no:1,provider_trace:{trace_version:'WBS_PROVIDER_SOURCE_TRACE_V1',domain:'PAYABLES',source_payload_hash:sourcePayloadHash,disposition:'RETAINED',action_flags:readOnlyActions,invoice_no:'INV-2026-014',invoice_date:'2026-08-01',business_id:'BUS-901',accrual:{service_period_start:null,service_period_end:null,recurring_obligation_id:null,contract_id:null,charge_code:null,service_frequency:null,obligation_status:null}}};
const insurance={source_document_line_id:'22222222-2222-4222-8222-222222222222',line_no:2,provider_trace:{trace_version:'WBS_PROVIDER_SOURCE_TRACE_V1',domain:'INSURANCE',source_payload_hash:sourcePayloadHash,action_flags:readOnlyActions,policy_id:'POL-100',source_id:'100',pc_code:null,final_premium:'1200.0000',mapping_decision_id:null,mapping_decision_hash:null,company_mapping_hash:null,resolved_company_code:null,match_count:2,disposition:'MAPPING_REVIEW_REQUIRED',coverage_start:'2026-01-01',coverage_end:'2026-12-31',coverage_disposition:'EXCEPTION_REVIEW_REQUIRED'}};
const payableMarkup=renderToStaticMarkup(<ProviderEvidenceTrace lines={[payable]}/>);
const markup=renderToStaticMarkup(<ProviderEvidenceTrace lines={[payable,insurance]}/>);
const resolved={...insurance,provider_trace:{...insurance.provider_trace,match_count:1,disposition:'RESOLVED',mapping_decision_id:'33333333-3333-4333-8333-333333333333',mapping_decision_hash:`sha256:${'a'.repeat(64)}`,company_mapping_hash:`sha256:${'e'.repeat(64)}`,resolved_company_code:'WBPA',coverage_disposition:'POSITIVE_COVERAGE'}};
const manyMatches={...insurance,provider_trace:{...insurance.provider_trace,match_count:8}};
const unsupportedRaw={trace_version:'WBS_PROVIDER_SOURCE_TRACE_V2',domain:'UNKNOWN_DOMAIN',access_token:'Bearer do-not-render',html:'<script>alert(1)</script>'};
const unsupported={...insurance,provider_trace:{supported:false,reason:'UNSUPPORTED_PROVIDER_TRACE'}};
const xssMarkup=renderToStaticMarkup(<ProviderEvidenceTrace lines={[{...payable,provider_trace:{...payable.provider_trace,invoice_no:'<img src=x onerror=alert(1)>'}}]}/>);
assert.match(markup,/Provider source trace/);
assert.match(markup,/no-store read/,'the user-facing trace must state that retained evidence is read without browser caching');
assert.match(markup,/INV-2026-014/);
assert.match(markup,/BUS-901/);
assert.match(markup,/Source payload hash/);
const resolvedMarkup=renderToStaticMarkup(<ProviderEvidenceTrace lines={[resolved]}/>);
assert.match(resolvedMarkup,/Mapping decision hash/);
assert.match(resolvedMarkup,/Company mapping hash/);
assert.match(resolvedMarkup,/title="sha256:b{64}"/,'the source payload hash remains available as an audit tooltip');
assert.match(resolvedMarkup,/title="sha256:a{64}"/,'the mapping decision hash remains available as an audit tooltip');
assert.match(resolvedMarkup,/title="sha256:e{64}"/,'the company mapping hash remains available as an audit tooltip');
assert.doesNotMatch(markup,/can_propose_amortization|can_create_draft|can_post/,'action flags are contract guards, never user controls');
assert.equal((payableMarkup.match(/Not supplied by Provider/g)||[]).length,7,'all seven explicit-null accrual facts must remain source absence, not inferred defects');
assert.match(markup,/Mapping review required/);
assert.match(markup,/No Draft or Post action is available/);
assert.match(markup,/EXCEPTION_REVIEW_REQUIRED/,'coverage evidence must not be mistaken for an approved mapping');
assert.doesNotMatch(markup,/MAPPING_REVIEW_REQUIRED/,'the provider status token must be translated into customer-facing copy');
assert.doesNotMatch(markup,/company code/i,'the UI must not display or infer a company from a nullable provider company code');
assert.doesNotMatch(markup,/<script/i,'provider markup must be escaped and never interpreted as HTML');
assert.match(resolvedMarkup,/Controller mapping resolved/);
const manyMarkup=renderToStaticMarkup(<ProviderEvidenceTrace lines={[manyMatches]}/>);
assert.match(manyMarkup,/Mapping matches[^<]*<\/i><b>2\+<\/b>/,'match count must use the bounded 0/1/2+ display');
const unsupportedMarkup=renderToStaticMarkup(<ProviderEvidenceTrace lines={[unsupported]}/>);
assert.match(unsupportedMarkup,/Unsupported provider trace/);
assert.doesNotMatch(unsupportedMarkup,/Bearer|script|UNKNOWN_DOMAIN/,'unsupported traces must not expose raw provider fields');
assert.match(xssMarkup,/&lt;img src=x onerror=alert\(1\)&gt;/,'React must render unexpected provider text as text, never as an element');
assert.doesNotMatch(xssMarkup,/<img /,'React text rendering must not create an executable provider element');
const css=readFileSync(join(__dirname,'..','index.html'),'utf8');
assert.match(css,/@media\(max-width:900px\)\{[\s\S]*?\.authoritative-evidence-page \.qbo-toolgrid\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\);\}/,'provider trace cards must retain two safe columns at 900px');
assert.match(css,/\.authoritative-evidence-page \.qbo-toolgrid b\{overflow-wrap:anywhere;\}/,'long provider identifiers and hashes must wrap inside their cards');
assert.match(css,/@media\(max-width:600px\)\{\.authoritative-evidence-page \.qbo-toolgrid\{grid-template-columns:minmax\(0,1fr\);\}\}/,'provider trace cards must reduce to one column on phone widths');
assert.equal(renderToStaticMarkup(<ProviderEvidenceTrace lines={[]}/>),'');
assert.equal(adaptProviderTraceForUi({...payable.provider_trace,dto_kind:PROVIDER_TRACE_DTO.STANDARD}).domain,'PAYABLES','the standard adapter preserves the API-client validated DTO');
assert.deepEqual(adaptProviderTraceForUi({dto_kind:PROVIDER_TRACE_DTO.RELEASE_AUDITOR,provider_secret:'do-not-read',arbitrary_owner_field:'do-not-guess'}),{supported:false,reason:'UNSUPPORTED_PROVIDER_TRACE'},'the Release Auditor adapter remains opaque until its owner supplies an explicit safe adapter');
assert.deepEqual(adaptProviderTraceForUi({dto_kind:'FUTURE_PROVIDER_TRACE',credential:'Bearer do-not-render'}),{supported:false,reason:'UNSUPPORTED_PROVIDER_TRACE'},'unknown adapter versions are inert and never expose raw fields');

const config={entityId:'44444444-4444-4444-8444-444444444444',periodId:'55555555-5555-4555-8555-555555555555',baseUrl:'https://api.example',getAccessToken:async()=> 'a'.repeat(48)};
const sourceDocumentId='66666666-6666-4666-8666-666666666666';
const apiLine={...payable,source_document_line_id:'77777777-7777-4777-8777-777777777777',source_line_id:'PAY-001',amount:'1200.0000',direction:'NONE',party_ref:null,bank_account_ref:null,project_ref:null,property_ref:null,phase_ref:null,unit_ref:null,loan_ref:null,cost_code_ref:null};
const apiDetail={source_document_id:sourceDocumentId,source_document_revision:0,raw_event_id:'88888888-8888-4888-8888-888888888888',source_system:'WBS',source_module:'BGDATA.payable',source_record_id:'PAY-001',source_version:'final1:source',document_type:'WBS_FINAL1_PAYABLE',document_no:'INV-2026-014',business_date:'2026-08-01',accounting_date:'2026-08-01',currency:'USD',gross_amount:'1200.0000',status:'QUARANTINED',payload_hash:sourcePayloadHash,source_line_count:1,posted_journal_entry_ids:[],lines:[apiLine],created_at:'2026-08-16T00:00:00.000Z',updated_at:'2026-08-16T00:00:00.000Z'};
void (async()=>{
  const headers={get:key=>key==='cache-control'?'private, no-store':'application/json'};
  const apiResult=await readAuthoritativeSourceDocumentDetail({config,sourceDocumentId,fetcher:async()=>({ok:true,headers,json:async()=>({ok:true,data:[apiDetail]})})});
  assert.equal(apiResult.ok,true);
  assert.equal(apiResult.detail.lines[0].provider_trace.source_payload_hash,apiResult.detail.payload_hash,'the retained trace must bind to the parent source payload');
  assert.equal(apiResult.detail.lines[0].provider_trace.business_id,'BUS-901');
  assert.equal(apiResult.detail.lines[0].provider_trace.accrual.contract_id,null);
  const cacheable=await readAuthoritativeSourceDocumentDetail({config,sourceDocumentId,fetcher:async()=>({ok:true,headers:{get:key=>key==='cache-control'?'private':'application/json'},json:async()=>({ok:true,data:[apiDetail]})})});
  assert.equal(cacheable.ok,false,'a provider trace cannot be accepted from a cacheable detail response');
  const hashMismatch=await readAuthoritativeSourceDocumentDetail({config,sourceDocumentId,fetcher:async()=>({ok:true,headers,json:async()=>({ok:true,data:[{...apiDetail,lines:[{...apiLine,provider_trace:{...apiLine.provider_trace,source_payload_hash:`sha256:${'f'.repeat(64)}`}}]}]})})});
  assert.equal(hashMismatch.ok,false,'each provider trace must bind to the source document payload hash');
  const rejected=async trace=>readAuthoritativeSourceDocumentDetail({
    config,sourceDocumentId,
    fetcher:async()=>({ok:true,headers,json:async()=>({ok:true,data:[{...apiDetail,lines:[{...apiLine,provider_trace:trace}]}]})})
  });
  for(const [index,trace] of [
    {...apiLine.provider_trace,invoice_no:'<script>alert(1)</script>'},
    {...apiLine.provider_trace,business_id:'Bearer credential-that-must-not-render'},
    {...apiLine.provider_trace,business_id:'sk-proj-abcdefghijklmnop'},
    {...apiLine.provider_trace,business_id:'rk-abcdefghijklmnop'},
    {...apiLine.provider_trace,accrual:{...apiLine.provider_trace.accrual,service_frequency:'pk-abcdefghijklmnop'}},
    {...apiLine.provider_trace,accrual:{...apiLine.provider_trace.accrual,service_frequency:'rk-proj-abcdefghijklmnop'}},
    {...apiLine.provider_trace,business_id:'B'.repeat(129)},
    {...apiLine.provider_trace,source_payload_hash:null},
    {...apiLine.provider_trace,action_flags:{...readOnlyActions,can_post:true}},
    {...insurance.provider_trace,coverage_disposition:'MAPPING_REVIEW_REQUIRED'},
    {...resolved.provider_trace,coverage_disposition:'EXCEPTION_REVIEW_REQUIRED'},
    {...insurance.provider_trace,coverage_disposition:'POSITIVE_COVERAGE'},
    {...resolved.provider_trace,mapping_decision_hash:null},
    {...resolved.provider_trace,company_mapping_hash:null},
    {...resolved.provider_trace,mapping_decision_hash:sourcePayloadHash},
    {...resolved.provider_trace,company_mapping_hash:`sha256:${'a'.repeat(64)}`},
    {...insurance.provider_trace,disposition:'RESOLVED',match_count:2,mapping_decision_id:'33333333-3333-4333-8333-333333333333',mapping_decision_hash:`sha256:${'a'.repeat(64)}`,company_mapping_hash:`sha256:${'e'.repeat(64)}`,resolved_company_code:'WBPA'},
    {...insurance.provider_trace,disposition:'MAPPING_REVIEW_REQUIRED',match_count:1},
    {...insurance.provider_trace,disposition:'MAPPING_REVIEW_REQUIRED',resolved_company_code:'WBPA'},
    {...insurance.provider_trace,disposition:'QUARANTINED',mapping_decision_id:'33333333-3333-4333-8333-333333333333'},
    {...insurance.provider_trace,disposition:'REJECTED',resolved_company_code:'WBPA'}
  ].entries()){const result=await rejected(trace);assert.equal(result?.ok,false,`unsafe provider trace ${index} must not reach the UI`);assert.equal(result?.code,'ACCOUNTING_API_PROTOCOL',`unsafe provider trace ${index} must fail the API protocol`);assert.doesNotMatch(JSON.stringify(result),/(?:sk|rk|pk)-(?:proj-)?[A-Za-z0-9_-]{16,}/i,`unsafe provider trace ${index} must receive a generic non-reflecting protocol failure`);}
  for(const status of ['QUARANTINED','REJECTED']){const result=await rejected({...insurance.provider_trace,disposition:status,match_count:0});assert.equal(result.ok,true,`${status} without an approved resolution retains read-only source evidence`);assert.equal(result.detail.lines[0].provider_trace.disposition,status);const positive=await rejected({...insurance.provider_trace,disposition:status,match_count:0,coverage_disposition:'POSITIVE_COVERAGE'});assert.equal(positive.ok,false,`${status} cannot present positive coverage`);}
  for(const trace of [unsupportedRaw,{...insurance.provider_trace,disposition:'UNKNOWN_MAPPING_STATUS',access_token:'Bearer do-not-render'}]){const result=await rejected(trace);assert.equal(result.ok,true,'unknown trace metadata retains the source document');assert.deepEqual(result.detail.lines[0].provider_trace,{supported:false,reason:'UNSUPPORTED_PROVIDER_TRACE'},'unknown metadata is reduced to an inert unsupported marker');}
  const long=renderToStaticMarkup(<ProviderEvidenceTrace lines={[{...payable,provider_trace:{...payable.provider_trace,business_id:'B'.repeat(100)}}]}/>);
  assert.match(long,/B{61}\.\.\./,'long retained identifiers must truncate in the 900px-safe display');
  assert.match(long,/title="B{100}"/,'the full retained identifier stays available as an accessible tooltip');
  assert.doesNotMatch(long,/<button/i,'the source trace has no action controls');
  console.log('authoritative provider evidence trace: payable null facts and insurance mapping review remain read-only and explicit');
})().catch(error=>{console.error(error);process.exitCode=1;});
