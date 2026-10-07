import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {reconcileWbsH1CompanyActorGrants,selectWbsH1GrantRoles,wbsH1GrantExpiry,wbsH1RoleBundle} from '../tools/reconcile-wbs-h1-company-actor-grants.mjs';
import {classifyWbsH1SettingsScope,decideWbsH1AccountingSettingsForScopes,settingsDecisionIdempotencyKey,runStagingSettingsOperation,assertSettingsDatabaseEndpoints,assertSettingsPilotScope,StagingWbsH1SettingsKernel} from '../tools/decide-wbs-h1-accounting-settings.mjs';

const T='6fb25daf-0799-4805-bede-be54230da33c';
const E1='11111111-1111-4111-a111-111111111111',E2='22222222-2222-4222-a222-222222222222';

test('settings CLI scope guard permits broad read-only plans but rejects unscoped pilot writes',()=>{
  assert.doesNotThrow(()=>assertSettingsPilotScope({companyCode:null,periodCode:null,dryRun:true}));
  assert.doesNotThrow(()=>assertSettingsPilotScope({companyCode:'WBPA',periodCode:'2026-01',dryRun:false}));
  for(const scope of [
    {companyCode:null,periodCode:null},
    {companyCode:'WBPA',periodCode:null},
    {companyCode:null,periodCode:'2026-01'}
  ])assert.throws(()=>assertSettingsPilotScope({...scope,dryRun:false}),/explicit company and single H1 period/);
  assert.throws(()=>assertSettingsPilotScope({companyCode:'WBPA,OTHER',periodCode:'2026-01',dryRun:true}),/COMPANY is invalid/);
  assert.throws(()=>assertSettingsPilotScope({companyCode:'WBPA',periodCode:'2026-07',dryRun:true}),/one 2026 H1 period/);
});

test('settings CLI rejects omitted company or period before database configuration and connection',()=>{
  const tool=fileURLToPath(new URL('../tools/decide-wbs-h1-accounting-settings.mjs',import.meta.url));
  for(const [company,period] of [['',''],['WBPA',''],['','2026-01']]){
    const env={...process.env,REFS_WBS_TEST_IMPORT_TENANT_ID:T,REFS_WBS_TEST_IMPORT_SETTINGS_CONTROLLER_ACTOR_ID:'pilot-settings-controller',REFS_WBS_H1_SETTINGS_COMPANY:company,REFS_WBS_H1_SETTINGS_PERIOD:period,REFS_WBS_H1_SETTINGS_DRY_RUN:'0'};
    for(const key of ['DATABASE_URL','MIGRATION_DATABASE_URL','CONTEXT_ISSUER_DATABASE_URL','GRANT_SYNC_DATABASE_URL'])delete env[key];
    const result=spawnSync(process.execPath,[tool],{env,encoding:'utf8',timeout:10000});
    assert.equal(result.status,1);
    const receipt=JSON.parse(result.stderr.trim());
    assert.equal(receipt.status,'WBS_H1_SETTINGS_DECISIONS_FAILED');
    assert.match(receipt.message,/explicit company and single H1 period/);
    assert.equal(result.stdout,'');
  }
});

test('reclass maker is an explicit finite role without silently widening the AP maker bundle',()=>{
  const reclass=wbsH1RoleBundle('reclassMaker'),maker=wbsH1RoleBundle('maker');
  assert.equal(reclass.authorityClass,'DRAFT');assert.ok(reclass.permissions.includes('WBS.H1.PAYABLE.DRAFT'));
  assert.equal(reclass.permissions.includes('GL.JE.POST'),false);assert.equal(maker.permissions.includes('WBS.H1.PAYABLE.DRAFT'),false);
  assert.equal(selectWbsH1GrantRoles().includes('reclassMaker'),false);
  assert.deepEqual(selectWbsH1GrantRoles('reclassMaker'),['reclassMaker']);
});

test('WH1R-6 deployment denial prevents settings work and mismatched connections are rejected',async()=>{
  let worked=false;
  const denied={async query(){return {rows:[{asserted:false}]};}};
  await assert.rejects(()=>runStagingSettingsOperation(denied,{},async()=>{worked=true;}),{code:'DEPLOYMENT_IDENTITY_DENIED'});
  assert.equal(worked,false);
  let issued=false,connected=false;
  const guarded=new StagingWbsH1SettingsKernel({async connect(){connected=true;assert.fail('runtime must not connect after denial');}},{sessionProvider:async()=>{issued=true;assert.fail('context must not be issued after denial');}},{},denied);
  await assert.rejects(()=>guarded.inSession(async()=>assert.fail('denied work must not run')),{code:'DEPLOYMENT_IDENTITY_DENIED'});
  assert.deepEqual([issued,connected],[false,false]);
  const calls=[];
  const allowed={async query(sql,args){calls.push({sql,args});return {rows:[{asserted:true}]};}};
  const target={installationId:T,expectedDatabase:'isolated_test'};
  assert.equal(await runStagingSettingsOperation(allowed,target,async()=>42),42);
  assert.deepEqual(calls[0].args,[T,'isolated_test']);
  const config=Object.fromEntries(['databaseUrl','contextIssuerDatabaseUrl','migrationDatabaseUrl','grantSyncDatabaseUrl'].map(key=>[key,'postgresql://role:password@localhost:55432/isolated_test']));
  assert.doesNotThrow(()=>assertSettingsDatabaseEndpoints(config));
  assert.throws(()=>assertSettingsDatabaseEndpoints({...config,grantSyncDatabaseUrl:'postgresql://role:password@localhost:55432/other_test'}),/same database endpoint/);
});

test('WH1R-7 version reads are retried only on serialization failure and failures preserve remaining grants',async()=>{
  let reads=0,writes=0;
  const sync={async currentVersion({entityId}){
    reads++;
    if(reads===1)throw Object.assign(new Error('serialization'),{code:'40001'});
    if(entityId===E2)throw Object.assign(new Error('connection unavailable'),{code:'08006'});
    return 0;
  },async reconcile(){writes++;return {idempotent:false};}};
  const result=await reconcileWbsH1CompanyActorGrants({grantSync:sync,tenantId:T,entities:[{entity_id:E1,company_code:'OPAA'},{entity_id:E2,company_code:'OPBB'}],actors:{importer:'importer'},roles:['importer'],humanValidUntil:'2026-10-07T00:00:00.000Z'});
  assert.equal(result.status,'WBS_H1_COMPANY_GRANTS_PARTIAL');
  assert.deepEqual([reads,writes,result.reconciled,result.failed],[3,1,1,1]);
  assert.equal(result.failures[0].code,'08006');
});

test('WH1R-8 failed approvals have one final outcome while the plan remains available',async()=>{
  const kernel={async readWbsH1AccountingSettingsProposal(){return {status:'READY_FOR_HUMAN_REVIEW',exception_count:0,ready_rule_count:1,proposal_hash:'sha256:x'};},async readWbsH1AccountingSettingsDecision(){return null;},async decideWbsH1AccountingSettings(){throw Object.assign(new Error('proposal drift'),{code:'23514'});}};
  const result=await decideWbsH1AccountingSettingsForScopes({scopes:[{tenant_id:T,entity_id:E1,company_code:'OPAA',period_id:E2,period_code:'2026-01'}],kernel,reason:'regression test approval'});
  assert.deepEqual(result.plan_counts,{APPROVABLE:1});
  assert.deepEqual(result.counts,{FAILED:1});
  assert.equal(Object.values(result.counts).reduce((a,b)=>a+b,0),result.scope_count);
  assert.equal(result.approved_now,0);
});

test('WH1R-9 exception worklist retains more than fifty missing accounts and ambiguous rules',async()=>{
  const rules=Array.from({length:70},(_,i)=>({decision:'MAPPING_MISSING',detail:`COST-${i}`}));
  rules.push({decision:'MAPPING_AMBIGUOUS',detail:'LEGAL'});
  const kernel={async readWbsH1AccountingSettingsProposal(){return {status:'EXCEPTION',exception_count:71,ready_rule_count:0,proposal_hash:'sha256:x',rules};},async readWbsH1AccountingSettingsDecision(){return null;},async decideWbsH1AccountingSettings(){assert.fail('exceptions must not be approved');}};
  const result=await decideWbsH1AccountingSettingsForScopes({scopes:[{tenant_id:T,entity_id:E1,company_code:'OPAA',period_id:E2,period_code:'2026-01'}],kernel,reason:'regression test exception',dryRun:true});
  assert.equal(result.exception_companies[0].missing_details.length,70);
  assert.deepEqual(result.exception_companies[0].ambiguous_details,['LEGAL']);
});

test('WH1R-1 role bundles are the frozen startup/test-import bundles; settingsController is the WBS_H1_SETTINGS_CONTROLLER role',()=>{
  assert.deepEqual(wbsH1RoleBundle('importer'),{authorityClass:'SERVICE',permissions:['WBS.TEST.IMPORT']});
  assert.deepEqual(wbsH1RoleBundle('poster'),{authorityClass:'POST',permissions:['GL.JE.POST']});
  const controller=wbsH1RoleBundle('settingsController');
  assert.equal(controller.authorityClass,'WBS_H1_SETTINGS_CONTROLLER');
  assert.ok(controller.permissions.includes('WBS.H1.SETTINGS.DECIDE')&&controller.permissions.includes('WBS.AUTOREC.VIEW'));
  assert.ok(!controller.permissions.some(permission=>/^GL\.JE\.(CREATE|SUBMIT|REVIEW|APPROVE|POST)$/.test(permission)));
  assert.throws(()=>wbsH1RoleBundle('owner'),/Unknown WBS H1 actor role/);
  assert.deepEqual(selectWbsH1GrantRoles(undefined),['importer','maker','submitter','reviewer','approver','poster']);
  assert.throws(()=>selectWbsH1GrantRoles('maker,maker'),/distinct/);
});

test('WH1R-2 human expiry is finite and inside the 24h grant-sync window',()=>{
  const now=Date.UTC(2026,8,30,12,0,0);
  assert.equal(wbsH1GrantExpiry(undefined,now),'2026-10-01T00:00:00.000Z');
  assert.equal(wbsH1GrantExpiry('1',now),'2026-09-30T13:00:00.000Z');
  for(const bad of ['0','24','1.5','x'])assert.throws(()=>wbsH1GrantExpiry(bad,now),/between 1 and 23/);
});

test('WH1R-3 grant runner reconciles every role on every entity with versioned idempotency keys, SERVICE without expiry, and retries only 40001',async()=>{
  const calls=[];const versions=new Map();let flaky=true;
  const grantSync={
    async currentVersion({tenantId,entityId,actorId}){return versions.get(`${entityId}:${actorId}`)||0;},
    async reconcile(request){
      if(flaky&&request.entityId===E2&&request.actorId==='poster-1'){flaky=false;throw Object.assign(new Error('serialization'),{code:'40001'});}
      calls.push(request);versions.set(`${request.entityId}:${request.actorId}`,request.expectedVersion+1);return {idempotent:false,version:request.expectedVersion+1};
    }
  };
  const entities=[{entity_id:E1,company_code:'OPAA'},{entity_id:E2,company_code:'OPBB'}];
  const actors={importer:'importer-1',poster:'poster-1'};
  const summary=await reconcileWbsH1CompanyActorGrants({grantSync,tenantId:T,entities,actors,roles:['importer','poster'],humanValidUntil:'2026-10-01T00:00:00.000Z'});
  assert.equal(summary.status,'WBS_H1_COMPANY_GRANTS_RECONCILED');
  assert.deepEqual([summary.entity_count,summary.role_count,summary.reconciled,summary.failed],[2,2,4,0]);
  const importer=calls.find(call=>call.actorId==='importer-1');
  assert.equal(importer.validUntil,null);assert.equal(importer.authorityClass,'SERVICE');
  const poster=calls.find(call=>call.actorId==='poster-1'&&call.entityId===E2);
  assert.equal(poster.validUntil,'2026-10-01T00:00:00.000Z');assert.equal(poster.authorityClass,'POST');
  assert.match(poster.idempotencyKey,/^wbs-h1-company-poster-grant-v1-OPBB-0-2026100100$/);
  // non-serialization failures are reported, not retried
  const failing={async currentVersion(){return 0;},async reconcile(){throw Object.assign(new Error('Human workflow grants require a finite expiry'),{code:'22023'});}};
  const partial=await reconcileWbsH1CompanyActorGrants({grantSync:failing,tenantId:T,entities:[entities[0]],actors,roles:['poster'],humanValidUntil:'2026-10-01T00:00:00.000Z'});
  assert.equal(partial.status,'WBS_H1_COMPANY_GRANTS_PARTIAL');assert.equal(partial.failures[0].code,'22023');
  await assert.rejects(()=>reconcileWbsH1CompanyActorGrants({grantSync,tenantId:T,entities,actors:{importer:'same',poster:'same'},roles:['importer','poster'],humanValidUntil:'x'}),/distinct/);
});

test('WH1R-4 settings classification approves only exception-free proposals and never touches decided ones',()=>{
  const ready={status:'READY_FOR_HUMAN_REVIEW',exception_count:0,ready_rule_count:3,proposal_hash:'sha256:'+'a'.repeat(64),rules:[]};
  assert.deepEqual(classifyWbsH1SettingsScope({proposal:ready,decision:null}),{outcome:'APPROVABLE',proposal_hash:ready.proposal_hash,ready_rule_count:3});
  assert.equal(classifyWbsH1SettingsScope({proposal:ready,decision:{outcome:'APPROVED'}}).outcome,'ALREADY_APPROVED');
  assert.equal(classifyWbsH1SettingsScope({proposal:ready,decision:{outcome:'REJECTED'}}).outcome,'ALREADY_REJECTED');
  const exception={status:'EXCEPTION',exception_count:2,ready_rule_count:1,proposal_hash:'sha256:'+'b'.repeat(64),rules:[
    {decision:'MAPPING_MISSING',detail:'LEGAL',account_code:null},{decision:'ACCOUNT_NOT_READY',detail:'R&M',account_code:'620100'},{decision:'READY_FOR_HUMAN_REVIEW',detail:'OPEX',account_code:'610000'}]};
  const classified=classifyWbsH1SettingsScope({proposal:exception,decision:null});
  assert.equal(classified.outcome,'EXCEPTION');
  assert.deepEqual(classified.exceptions,{MAPPING_MISSING:1,ACCOUNT_NOT_READY:1,MAPPING_AMBIGUOUS:0});
  assert.deepEqual([classified.missing_details,classified.not_ready_accounts],[['LEGAL'],['620100']]);
  assert.equal(classifyWbsH1SettingsScope({proposal:{status:'READY_FOR_HUMAN_REVIEW',exception_count:0,ready_rule_count:0,rules:[],proposal_hash:'sha256:'+'c'.repeat(64)},decision:null}).outcome,'NO_RULES');
  assert.equal(classifyWbsH1SettingsScope({proposal:null,decision:null}).outcome,'PROPOSAL_UNAVAILABLE');
  assert.equal(settingsDecisionIdempotencyKey('OPAA','2026-01','sha256:x'),settingsDecisionIdempotencyKey('OPAA','2026-01','sha256:x'));
  assert.notEqual(settingsDecisionIdempotencyKey('OPAA','2026-01','sha256:x'),settingsDecisionIdempotencyKey('OPAA','2026-02','sha256:x'));
});

test('WH1R-5 settings runner: dry run decides nothing, real run approves APPROVABLE scopes only, folds exceptions per company, and reports failures',async()=>{
  const proposals={
    [`${E1}:p1`]:{status:'READY_FOR_HUMAN_REVIEW',exception_count:0,ready_rule_count:2,proposal_hash:'sha256:'+'1'.repeat(64),rules:[]},
    [`${E1}:p2`]:{status:'READY_FOR_HUMAN_REVIEW',exception_count:0,ready_rule_count:2,proposal_hash:'sha256:'+'2'.repeat(64),rules:[]},
    [`${E2}:p1`]:{status:'EXCEPTION',exception_count:1,ready_rule_count:1,proposal_hash:'sha256:'+'3'.repeat(64),rules:[{decision:'MAPPING_MISSING',detail:'LEGAL'}]},
    [`${E2}:p2`]:{status:'EXCEPTION',exception_count:1,ready_rule_count:1,proposal_hash:'sha256:'+'4'.repeat(64),rules:[{decision:'MAPPING_MISSING',detail:'TAX'}]},
  };
  const decided=new Map([[`${E1}:p2`,{outcome:'APPROVED'}]]);const decisions=[];
  const kernel={
    async readWbsH1AccountingSettingsProposal({entityId,periodId}){if(periodId==='boom')throw Object.assign(new Error('scope denied'),{code:'42501'});return proposals[`${entityId}:${periodId}`];},
    async readWbsH1AccountingSettingsDecision({entityId,periodId}){return decided.get(`${entityId}:${periodId}`)||null;},
    async decideWbsH1AccountingSettings(request){decisions.push(request);decided.set(`${request.entityId}:${request.periodId}`,{outcome:'APPROVED'});return {outcome:'APPROVED',idempotent:false,decision_id:'d',approved_rule_count:2};}
  };
  const scopes=[
    {tenant_id:T,entity_id:E1,company_code:'OPAA',period_id:'p1',period_code:'2026-01'},
    {tenant_id:T,entity_id:E1,company_code:'OPAA',period_id:'p2',period_code:'2026-02'},
    {tenant_id:T,entity_id:E2,company_code:'OPBB',period_id:'p1',period_code:'2026-01'},
    {tenant_id:T,entity_id:E2,company_code:'OPBB',period_id:'p2',period_code:'2026-02'},
    {tenant_id:T,entity_id:E2,company_code:'OPBB',period_id:'boom',period_code:'2026-03'},
  ];
  const reason='D-R08-3 delegated approval for the unit test';
  const plan=await decideWbsH1AccountingSettingsForScopes({scopes,kernel,reason,dryRun:true});
  assert.equal(plan.status,'WBS_H1_SETTINGS_DECISION_PLAN_PARTIAL');
  assert.deepEqual(plan.counts,{APPROVABLE:1,ALREADY_APPROVED:1,EXCEPTION:2,FAILED:1});
  assert.equal(decisions.length,0);
  assert.deepEqual(plan.exception_companies,[{company_code:'OPBB',periods:['2026-01','2026-02'],exceptions:{MAPPING_MISSING:1,ACCOUNT_NOT_READY:0,MAPPING_AMBIGUOUS:0},missing_details:['LEGAL','TAX'],not_ready_accounts:[],ambiguous_details:[]}]);
  assert.equal(plan.failures[0].code,'42501');
  const real=await decideWbsH1AccountingSettingsForScopes({scopes:scopes.slice(0,4),kernel,reason});
  assert.equal(real.status,'WBS_H1_SETTINGS_DECISIONS_COMPLETE');
  assert.deepEqual(real.counts,{APPROVED:1,ALREADY_APPROVED:1,EXCEPTION:2});
  assert.equal(Object.values(real.counts).reduce((a,b)=>a+b,0),real.scope_count);
  assert.deepEqual([real.approved_now,decisions.length,decisions[0].outcome,decisions[0].expectedProposalHash],[1,1,'APPROVED','sha256:'+'1'.repeat(64)]);
  assert.equal(decisions[0].idempotencyKey,settingsDecisionIdempotencyKey('OPAA','2026-01','sha256:'+'1'.repeat(64)));
  const again=await decideWbsH1AccountingSettingsForScopes({scopes:scopes.slice(0,4),kernel,reason});
  assert.deepEqual([again.approved_now,again.counts.ALREADY_APPROVED,decisions.length],[0,2,1]);
  await assert.rejects(()=>decideWbsH1AccountingSettingsForScopes({scopes,kernel,reason:'short'}),/8\.\.2000/);
});
