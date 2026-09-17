// P0-F6 browser contract: the evidence-summary client read and the empty-state copy.
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {accountingApiConfig,refreshEntityEvidenceSummary} from '../src/accounting-api.js';
import {AuthoritativeScopeEmpty} from '../src/authoritative-read-state.jsx';
(async()=>{
const entityId='11111111-1111-4111-8111-111111111111',periodId='22222222-2222-4222-8222-222222222222';
const config=accountingApiConfig({__REFS_ACCOUNTING_API__:{baseUrl:'https://api.example/',entityId,periodId,cashAccountCode:'111000',getAccessToken:async()=>'a'.repeat(48)}});
const row={schema_version:'ENTITY_EVIDENCE_SUMMARY_V1',entity_id:entityId,period_id:periodId,journal_count:0,posted_journal_count:0,raw_event_count:0,staging_item_count:0,source_document_count:0,last_raw_event_at:null,evidence_state:'NO_EVIDENCE_IMPORTED'};
const ok=await refreshEntityEvidenceSummary({config,fetcher:async(url,o)=>{assert.match(url,/\/evidence-summary\?periodId=/);assert.equal(o.method,'GET');assert.equal(o.cache,'no-store');return {ok:true,json:async()=>({ok:true,data:row})};}});
assert.equal(ok.ok,true);assert.equal(ok.row.evidence_state,'NO_EVIDENCE_IMPORTED');
for(const bad of [{...row,evidence_state:'GUESS'},{...row,journal_count:-1},{...row,entity_id:periodId},{...row,schema_version:'X'}]){const r=await refreshEntityEvidenceSummary({config,fetcher:async()=>({ok:true,json:async()=>({ok:true,data:bad})})});assert.equal(r.ok,false);assert.equal(r.code,'ACCOUNTING_API_PROTOCOL');}
assert.equal((await refreshEntityEvidenceSummary({config,fetcher:async()=>{throw new Error('net');}})).code,'ACCOUNTING_API_UNREACHABLE');
const none=renderToStaticMarkup(React.createElement(AuthoritativeScopeEmpty,{subject:'Journal entries',requiresPosted:true,evidence:row}));
assert.match(none,/NO_EVIDENCE_IMPORTED/);assert.match(none,/not a zero balance/);assert.doesNotMatch(none,/INGESTION_BLOCKED/);
const pending=renderToStaticMarkup(React.createElement(AuthoritativeScopeEmpty,{subject:'Journal entries',requiresPosted:true,evidence:{...row,journal_count:3,evidence_state:'EVIDENCE_WITHOUT_POSTINGS'}}));
assert.match(pending,/EVIDENCE_WITHOUT_POSTINGS/);assert.match(pending,/3 journals \(0 posted\)/);
const legacy=renderToStaticMarkup(React.createElement(AuthoritativeScopeEmpty,{subject:'Journal entries',requiresPosted:true}));
assert.match(legacy,/INGESTION_BLOCKED/,'without a summary the previous copy is unchanged');
console.log('PASS entity evidence summary client + empty-state copy');

})().catch(e=>{console.error(e);process.exit(1);});
