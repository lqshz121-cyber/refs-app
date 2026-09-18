// P05 HTTP contract: project masters and cost layers — reads are bodyless/no-store, commands need Idempotency-Key,
// transitions need If-Match, payloads are closed, kernel codes map to 403/404/409/412/422, protocol breaches are 502.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createAccountingApi} from '../api/accounting-http.mjs';
const tenantId=randomUUID(),entityId=randomUUID(),projectId=randomUUID(),periodId=randomUUID();
const H={'idempotency-key':'p05-http-key-1','content-type':'application/json'};
const masters={schema_version:'PROJECT_MASTERS_V1',accounting_authority:'NONE',projects:[{project_id:projectId,project_ref:'PRJ-1',status:'APPROVED',revision:1,cost_codes:[],units:[]}]};
const layers={schema_version:'PROJECT_COST_LAYERS_V1',accounting_authority:'NONE',can_capitalize:false,can_transfer:false,can_post:false,project_ref:'PRJ-1',project_id:projectId,project_status:'APPROVED',capitalization_policy:'CWIP_UNTIL_COMPLETION',period_id:null,period_code:null,as_of:null,layers:[],totals:{layer_count:0,exception_count:0,cwip_net:0,non_cwip_net:0,ledger_line_count:0}};
const created={schema_version:'PROJECT_MASTER_V1',project_id:projectId,status:'DRAFT',revision:0,idempotent:false,snapshot_hash:'sha256:'+'0'.repeat(64)};
const api=(kernel)=>createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'pmaker'}),kernelFactory:async()=>kernel});
const failing=code=>async()=>{const e=new Error(code==='40001'?'Project master revision is stale':'kernel');e.code=code;throw e;};

test('P05 reads: masters and cost layers are bodyless no-store reads; scope 403; foreign period 400; protocol 502',async()=>{
  const observed=[];let answerLayers=layers;
  const a=api({readProjectMasters:async args=>(observed.push(args),masters),readProjectCostLayers:async args=>(observed.push(args),answerLayers)});
  const base=`/api/v1/entities/${entityId}`;
  let r=await a({method:'GET',url:`${base}/projects`,body:null,headers:{}});assert.equal(r.status,200);assert.equal(r.headers['cache-control'],'no-store');assert.deepEqual(r.body.data,masters);assert.deepEqual(observed[0],{tenantId,entityId});
  r=await a({method:'GET',url:`${base}/projects/PRJ-1/cost-layers?periodId=${periodId}`,body:null,headers:{}});assert.equal(r.status,200);assert.deepEqual(observed[1],{tenantId,entityId,projectRef:'PRJ-1',periodId});
  r=await a({method:'GET',url:`${base}/projects/PRJ-1/cost-layers`,body:null,headers:{}});assert.equal(r.status,200);assert.equal(observed[2].periodId,null);
  for(const req of [{url:`${base}/projects`,body:{}},{url:`${base}/projects?x=1`,body:null},{url:`${base}/projects/PRJ-1/cost-layers?periodId=nope`,body:null},{url:`${base}/projects/${encodeURIComponent('bad ref!')}/cost-layers`,body:null}])assert.equal((await a({method:'GET',url:req.url,body:req.body,headers:{}})).status,400,req.url);
  assert.equal((await a({method:'GET',url:`${base}/projects`,body:null,headers:{'idempotency-key':'x'}})).status,400);
  answerLayers={...layers,can_capitalize:true};assert.equal((await a({method:'GET',url:`${base}/projects/PRJ-1/cost-layers`,body:null,headers:{}})).status,502);
  assert.equal((await api({readProjectMasters:failing('42501')})({method:'GET',url:`${base}/projects`,body:null,headers:{}})).status,403);
  assert.equal((await api({readProjectCostLayers:failing('22023')})({method:'GET',url:`${base}/projects/PRJ-1/cost-layers?periodId=${periodId}`,body:null,headers:{}})).status,400);
  assert.equal((await api({readProjectCostLayers:failing('42501')})({method:'GET',url:`${base}/projects/PRJ-1/cost-layers`,body:null,headers:{}})).status,403);
});

test('P05 commands: closed payloads, Idempotency-Key, If-Match CAS, and kernel code mapping',async()=>{
  const observed=[];
  const kernel={
    createProjectMaster:async args=>(observed.push(['project',args]),created),
    createProjectCostCode:async args=>(observed.push(['cc',args]),{schema_version:'PROJECT_COST_CODE_V1',cost_code_id:randomUUID(),project_id:projectId,status:'DRAFT',revision:0,idempotent:true}),
    createProjectUnit:async args=>(observed.push(['unit',args]),{schema_version:'PROJECT_UNIT_V1',unit_id:randomUUID(),project_id:projectId,status:'DRAFT',revision:0,idempotent:false}),
    transitionProjectMaster:async args=>(observed.push(['tr',args]),{schema_version:'PROJECT_MASTER_TRANSITION_V1',status:args.event,revision:args.expectedRevision+1,idempotent:false,approved_by:'papprover',retired_by:null}),
  };
  const a=api(kernel);const base=`/api/v1/entities/${entityId}`;
  const project={projectRef:'PRJ-1',projectName:'Riverside Phase 1',projectType:'DEVELOPMENT',capitalizationPolicy:'CWIP_UNTIL_COMPLETION',reason:'register development project'};
  let r=await a({method:'POST',url:`${base}/projects`,body:project,headers:H});
  assert.equal(r.status,201);assert.equal(r.headers.etag,'"0"');assert.equal(r.headers['cache-control'],'no-store');assert.deepEqual(r.body.data,created);
  assert.deepEqual(observed[0][1],{tenantId,entityId,...project,idempotencyKey:'p05-http-key-1'});
  assert.equal((await a({method:'POST',url:`${base}/projects`,body:project,headers:{'content-type':'application/json'}})).status,400,'idempotency key required');
  assert.equal((await a({method:'POST',url:`${base}/projects`,body:{...project,extra:1},headers:H})).status,400);
  assert.equal((await a({method:'POST',url:`${base}/projects`,body:{...project,projectType:'FUN'},headers:H})).status,400);
  assert.equal((await a({method:'POST',url:`${base}/projects`,body:{...project,projectRef:'bad ref'},headers:H})).status,400);
  assert.equal((await a({method:'POST',url:`${base}/projects`,body:{...project,reason:'short'},headers:H})).status,400);
  assert.equal((await a({method:'POST',url:`${base}/projects`,body:project,headers:{...H,'if-match':'"0"'}})).status,400);
  r=await a({method:'POST',url:`${base}/projects/${projectId}/cost-codes`,body:{costCodeRef:'01-LAND',costCodeName:'Land',costCategory:'LAND',capitalizable:true,reason:'land cost code'},headers:H});
  assert.equal(r.status,200,'idempotent replay is 200');assert.equal(observed[1][1].projectId,projectId);assert.equal(observed[1][1].capitalizable,true);
  assert.equal((await a({method:'POST',url:`${base}/projects/${projectId}/cost-codes`,body:{costCodeRef:'01-LAND',costCodeName:'Land',costCategory:'LAND',capitalizable:'yes',reason:'land cost code'},headers:H})).status,400);
  r=await a({method:'POST',url:`${base}/projects/${projectId}/units`,body:{unitRef:'U-101',unitName:'Unit 101',allocationBasis:'AREA',allocationWeight:'1250.5000',reason:'unit 101 by area'},headers:H});
  assert.equal(r.status,201);assert.equal(observed[2][1].allocationWeight,'1250.5000');
  assert.equal((await a({method:'POST',url:`${base}/projects/${projectId}/units`,body:{unitRef:'U-101',unitName:'Unit 101',allocationBasis:'AREA',allocationWeight:'0.0000',reason:'unit 101 by area'},headers:H})).status,400);
  assert.equal((await a({method:'POST',url:`${base}/projects/${projectId}/units`,body:{unitRef:'U-101',unitName:'Unit 101',allocationBasis:'AREA',allocationWeight:'12.5',reason:'unit 101 by area'},headers:H})).status,400,'canonical four decimals');
  // transitions
  const tr={event:'APPROVED',reason:'approve master data'};
  r=await a({method:'POST',url:`${base}/project-masters/projects/${projectId}/transitions`,body:tr,headers:{...H,'if-match':'"0"'}});
  assert.equal(r.status,200);assert.equal(r.headers.etag,'"1"');assert.deepEqual(observed[3][1],{tenantId,entityId,objectType:'PROJECT',objectId:projectId,expectedRevision:0,event:'APPROVED',reason:'approve master data',idempotencyKey:'p05-http-key-1'});
  r=await a({method:'POST',url:`${base}/project-masters/cost-codes/${projectId}/transitions`,body:{event:'RETIRED',reason:'retire cost code now'},headers:{...H,'if-match':'"3"'}});
  assert.equal(r.status,200);assert.equal(observed[4][1].objectType,'COST_CODE');assert.equal(observed[4][1].expectedRevision,3);
  assert.equal((await a({method:'POST',url:`${base}/project-masters/projects/${projectId}/transitions`,body:tr,headers:H})).status,428,'If-Match required');
  assert.equal((await a({method:'POST',url:`${base}/project-masters/projects/${projectId}/transitions`,body:{event:'DELETED',reason:'approve master data'},headers:{...H,'if-match':'"0"'}})).status,400);
  assert.equal((await a({method:'POST',url:`${base}/project-masters/things/${projectId}/transitions`,body:tr,headers:{...H,'if-match':'"0"'}})).status,404);
  // kernel error mapping
  const map=[['42501',403],['P0002',404],['23505',409],['23514',422],['22023',422]];
  for(const [code,status] of map)assert.equal((await api({createProjectMaster:failing(code)})({method:'POST',url:`${base}/projects`,body:project,headers:H})).status,status,code);
  assert.equal((await api({transitionProjectMaster:failing('40001')})({method:'POST',url:`${base}/project-masters/projects/${projectId}/transitions`,body:tr,headers:{...H,'if-match':'"0"'}})).status,412);
  assert.equal((await api({transitionProjectMaster:failing('42501')})({method:'POST',url:`${base}/project-masters/projects/${projectId}/transitions`,body:tr,headers:{...H,'if-match':'"0"'}})).status,403,'SoD maker≠approver');
  // protocol breach
  assert.equal((await api({createProjectMaster:async()=>({...created,status:'APPROVED'})})({method:'POST',url:`${base}/projects`,body:project,headers:H})).status,502);
});
