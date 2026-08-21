import test from 'node:test';
import assert from 'node:assert/strict';
import {readWbsCompanyCatalog,provisionWbsCompanyScopes} from '../tools/provision-wbs-h1-companies.mjs';

const tenantId='10000000-0000-4000-8000-000000000001',templateEntityId='20000000-0000-4000-8000-000000000001';

test('reads the exact WBS company and name catalog through bounded cursor pages',async()=>{
  const calls=[],pages=[{record_count:2,rows:[{company_code:'WBPA',company_name:'Wan Pacific'},{company_code:'WBSM',company_name:'San Marcos'}],cursor_next:'next'},
    {record_count:1,rows:[{company_code:'WYHX',company_name:'Ïã¸Ûº£ÐÅ'}],cursor_next:null}];
  const result=await readWbsCompanyCatalog({client:{initialize:async()=>calls.push('initialize'),listTools:async()=>calls.push('tools'),readView:async args=>{calls.push(args);return pages.shift();}}});
  assert.equal(result.pages,2);assert.equal(result.rows,3);
  assert.deepEqual(result.companies,[{company_code:'WBPA',company_name:'Wan Pacific'},{company_code:'WBSM',company_name:'San Marcos'},{company_code:'WYHX',company_name:'WBS WYHX'}]);
  assert.deepEqual(calls.slice(0,2),['initialize','tools']);assert.deepEqual(calls[2],{toolName:'list_autorec_banks',args:{limit:10}});assert.deepEqual(calls[3],{toolName:'list_autorec_banks',args:{limit:10,cursor:'next'}});
});

test('provisions one entity and six periods per WBS company in one transaction',async()=>{
  const sql=[];const client={
    async query(text,params=[]){sql.push([text,params]);
      if(/SELECT entity_id::text,source_system/.test(text))return {rows:[{entity_id:templateEntityId,source_system:'REFS_STAGE1',source_entity_id:'REFS_US_001',base_currency:'USD'}]};
      if(/RETURNING entity_id::text/.test(text)){const entityId=params[0];return {rows:[{entity_id:entityId,inserted:params[2]!=='WBPA'}]};}
      if(/SELECT count\(DISTINCT e\.entity_id\)/.test(text))return {rows:[{company_count:2,period_count:12}]};
      return {rows:[]};
    },release(){sql.push(['RELEASE',[]]);}
  };
  const result=await provisionWbsCompanyScopes({pool:{connect:async()=>client},tenantId,templateEntityId,catalog:{companies:[{company_code:'WBPA',company_name:'Wan Pacific'},{company_code:'WBSM',company_name:'San Marcos'}]}});
  assert.equal(result.status,'WBS_H1_COMPANY_SCOPES_READY');assert.equal(result.company_count,2);assert.equal(result.period_count,12);
  assert.equal(sql[0][0],'BEGIN');assert.equal(sql.at(-2)[0],'COMMIT');assert.equal(sql.at(-1)[0],'RELEASE');
  assert.ok(sql.some(([text])=>/INSERT INTO runtime_actor_grant/.test(text)));assert.ok(sql.some(([text])=>/INSERT INTO account_master/.test(text)));
  assert.ok(sql.some(([text])=>/source_system='WBS',source_entity_id='WBPA'/.test(text)));
});

test('fails closed on duplicate company identity before provisioning',async()=>{
  const client={initialize:async()=>{},listTools:async()=>{},readView:async()=>({record_count:2,rows:[{company_code:'WBPA',company_name:'One'},{company_code:'WBPA',company_name:'Two'}],cursor_next:null})};
  await assert.rejects(readWbsCompanyCatalog({client}),/repeats WBPA/);
});
