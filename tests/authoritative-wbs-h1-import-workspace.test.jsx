import fs from 'node:fs';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {AuthoritativeWbsH1ImportWorkspace} from '../src/authoritative-wbs-h1-import-workspace.jsx';
import {refreshAuthoritativeWbsH1ImportInventory} from '../src/accounting-api.js';

const entityId='11111111-1111-4111-8111-111111111111',periodId='22222222-2222-4222-8222-222222222222',config={baseUrl:'https://api.example.test',entityId,periodId,getAccessToken:async()=> 'abcdefghijklmnop'};
const counts={source_record_count:1,source_amount:'125.0000',controlled_test_posted_count:0,formal_mapping_posted_count:0,mapping_missing_count:1,mapping_ready_count:0,mapping_ambiguous_count:0};
const data={schema_version:'WBS_H1_IMPORT_INVENTORY_V1',company_code:'SUCF',currency:'USD',date_from:'2026-01-01',date_to:'2026-06-30',limit:50,offset:0,totals:counts,months:Array.from({length:6},(_,index)=>({period_code:`2026-${String(index+1).padStart(2,'0')}`,...counts,source_record_count:index===0?1:0,source_amount:index===0?'125.0000':'0.0000',mapping_missing_count:index===0?1:0})),rows:[{source_record_hash:`sha256:${'a'.repeat(64)}`,accounting_date:'2026-01-15',amount:'125.0000',project_code:null,cost_code:'100',vendor_no:'V-1',import_state:'SOURCE_STAGED',mapping_state:'MAPPING_MISSING'}],source_mode:'REAL_WBS_STAGED',accounting_authority:'NONE',can_create_draft:false,can_review:false,can_approve:false,can_post:false};

const markup=renderToStaticMarkup(<AuthoritativeWbsH1ImportWorkspace config={config} fetcher={async()=>{throw new Error('SSR must not fetch');}}/>);
assert.match(markup,/2026 H1 business data/);assert.match(markup,/Loading WBS business data/);assert.doesNotMatch(markup,/Create Draft|Approve|Post journal|localStorage|seed\.js/);

async function verifyClient(){
  let call;const result=await refreshAuthoritativeWbsH1ImportInventory({config,limit:50,offset:0,fetcher:async(url,options)=>{call={url,options};return {ok:true,json:async()=>({ok:true,data})};}});
  assert.equal(result.ok,true);assert.match(call.url,/\/wbs\/h1-import-inventory\?limit=50&offset=0$/);assert.equal(call.options.method,'GET');assert.equal(call.options.cache,'no-store');assert.equal('body' in call.options,false);
  assert.equal((await refreshAuthoritativeWbsH1ImportInventory({config,limit:50,offset:0,fetcher:async()=>({ok:true,json:async()=>({ok:true,data:{...data,can_post:true}})})})).code,'WBS_H1_IMPORT_INVENTORY_PROTOCOL');
}

const source=fs.readFileSync('src/authoritative-wbs-h1-import-workspace.jsx','utf8');
for(const copy of ['Imported business data is available','Imported source rows are not formal ledger entries','Controlled test posted','Ready for mapping review','NO ACCOUNTING ACTION'])assert.match(source,new RegExp(copy));
assert.doesNotMatch(source,/wbs_uuid|Create Draft|Approve|Post journal|localStorage|seed\.js/);
verifyClient().then(()=>console.log('authoritative WBS H1 import workspace: real company source inventory remains read only')).catch(error=>{console.error(error);process.exitCode=1;});
