// R08 A/B: a WBS company whose Settings reference accounts its COA lacks is seeded only through a
// signed decision on an exact proposal; after seeding and a human Settings decision the Payable line
// becomes a controller-review candidate and still cannot post. Nothing here creates a Draft.
import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import pg from 'pg';
import {createPool} from '../runtime/db.mjs';
import {runtimeConfig} from '../runtime/config.mjs';
import {migrateUp} from '../runtime/migrations.mjs';
import {PostgresAccountingKernel} from '../runtime/kernel-repository.mjs';
import {PostgresContextIssuer} from '../runtime/context-issuer.mjs';
import {buildCoaSeedProposal,applyCoaSeedDecision,assertCoaSeedDecision,inferMemberRequirement,COA_SEED_DECISION_SCHEMA} from '../runtime/wbs-coa-seed.mjs';
import {decisionTemplate} from '../tools/propose-wbs-coa-seed.mjs';

const config=runtimeConfig();
let admin=null,runtime=null,issuer=null,unavailable=null;
before(async()=>{try{
  admin=await createPool({databaseUrl:config.migrationDatabaseUrl,applicationName:'refs-r08-admin',max:3});await admin.query('SELECT 1');await migrateUp(admin,{});
  runtime=await createPool({databaseUrl:config.databaseUrl,applicationName:'refs-r08-runtime',max:4});
  issuer=await createPool({databaseUrl:config.contextIssuerDatabaseUrl,applicationName:'refs-r08-issuer',max:2});
}catch(error){unavailable=`POSTGRES NOT RUN: ${error.code||error.name}: ${error.message}`;if(config.requirePostgres)throw error;}});
after(async()=>{for(const p of [admin,runtime,issuer])if(p)await p.end();});
const pgTest=(name,fn)=>test(name,async t=>{if(unavailable){t.skip(unavailable);return;}await fn(t);});
const hash=s=>`sha256:${createHash('sha256').update(s).digest('hex')}`;

async function scope({withInactive=true}={}){
  const tenantId=randomUUID(),entityId=randomUUID(),periodId=randomUUID(),code=`W${randomUUID().replaceAll('-','').slice(0,6).toUpperCase()}`;
  await admin.query('INSERT INTO tenant(tenant_id,tenant_code,name) VALUES($1,$2,$3)',[tenantId,`T${tenantId.replaceAll('-','').slice(0,8)}`.toUpperCase(),'r08']);
  await admin.query("INSERT INTO entity(entity_id,tenant_id,entity_code,source_system,source_entity_id,name,base_currency) VALUES($1,$2,$3,'WBS',$3,'R08 company','USD')",[entityId,tenantId,code]);
  await admin.query("INSERT INTO accounting_period(period_id,tenant_id,entity_id,ledger_code,period_code,starts_on,ends_on,status) VALUES($1,$2,$3,'PRIMARY','2026-06','2026-06-01','2026-06-30','OPEN')",[periodId,tenantId,entityId]);
  // The template seed: exactly what provision-wbs-h1-companies copies, plus one inactive account.
  await admin.query(`INSERT INTO account_master(tenant_id,entity_id,account_code,account_name,requires_member,required_member_type,active) VALUES
    ($1,$2,'111000','Cash',true,'BANK',true),($1,$2,'291001','Due to Vendor',true,'VENDOR',true),($1,$2,'705000','Old other income',false,NULL,false)`,[tenantId,entityId]);
  await admin.query("INSERT INTO member_master(tenant_id,entity_id,member_ref,member_type,display_name,active) VALUES($1,$2,'V-1','VENDOR','Vendor one',true)",[tenantId,entityId]);
  const settings=[
    [1,'Debit','R-100','P-100','651000','Repairs and maintenance','Project'],
    [2,'Credit','','','291001','Due to Vendor','Vendor'],
    [3,'Debit','R-200','P-100','164200','CWIP - Hard cost','Project'],
    [4,'Debit','R-201','P-200','164200','CWIP hard costs','Project'],       // same code, another name
    [5,'Debit','R-300','P-100','705000','Other income','Project'],          // exists inactive
    [6,'Credit','','P-900','291050','Retention payable','Vendor']];
  for(const [id,side,detail,projects,journal,name,supp] of settings.filter(r=>withInactive||r[4]!=='705000'))await admin.query(`INSERT INTO wbs_h1_accounting_setting_stage(tenant_id,company_code,setting_id,setting_type,category,business_type,detail,project_codes,journal_code,account_name,supplementary,effective_from,effective_to,setting_hash)
    VALUES($1,$2,$3,$4,'Payable',4,$5,$6,$7,$8,$9,'2026-01-01','2026-12-31',$10)`,[tenantId,code,id,side,detail,projects,journal,name,supp,hash(`r08-setting-${code}-${id}`)]);
  await admin.query(`INSERT INTO wbs_h1_payable_mapping_source_stage(tenant_id,entity_id,company_code,period_code,wbs_uuid,source_record_hash,accounting_date,amount,project_code,cost_code,vendor_no,source_fact_hash,provider_content_hash,captured_at)
    VALUES($1,$2,$3,'2026-06','WBS-PAY-R08',$4,'2026-06-15','125.0000','P-100','R-100','V-1',$5,$6,'2026-09-24T09:00:00Z')`,[tenantId,entityId,code,hash(`r08-src-${code}`),hash(`r08-fact-${code}`),hash(`r08-provider-${code}`)]);
  return {tenantId,entityId,periodId,code};
}
async function controllerFor(ids){
  const actorId=`r08-controller-${ids.code.toLowerCase()}`;
  for(const permission of ['WBS.AUTOREC.VIEW','WBS.H1.SETTINGS.DECIDE'])await admin.query(`INSERT INTO runtime_actor_grant(tenant_id,actor_id,entity_id,permission,authority_class,valid_until) VALUES($1,$2,$3,$4,'WBS_H1_SETTINGS_CONTROLLER',clock_timestamp()+interval '1 hour')`,[ids.tenantId,actorId,ids.entityId,permission]);
  const ci=new PostgresContextIssuer(issuer,{principalProvider:async()=>({trusted:true,actorId,tenantId:ids.tenantId})});
  return new PostgresAccountingKernel(runtime,{sessionProvider:()=>ci.issue({tenantId:ids.tenantId})});
}
const withClient=async fn=>{const c=await admin.connect();try{return await fn(c);}finally{c.release();}};
const accounts=ids=>admin.query('SELECT account_code,account_name,requires_member,required_member_type,active FROM account_master WHERE tenant_id=$1 AND entity_id=$2 ORDER BY 1',[ids.tenantId,ids.entityId]).then(r=>r.rows);

pgTest('R08-1: the proposal lists only missing accounts, dedups them, marks inference, refuses to pick between names, and writes nothing',async()=>{
  const ids=await scope();const beforeRows=await accounts(ids);
  const proposal=await withClient(c=>buildCoaSeedProposal(c,{tenantId:ids.tenantId,companyCodes:[ids.code]}));
  assert.equal(proposal.accounting_authority,'PROPOSAL_ONLY');
  const items=Object.fromEntries(proposal.companies[0].items.map(i=>[i.account_code,i]));
  assert.deepEqual(Object.keys(items).sort(),['164200','291050','651000','705000']); // 291001 already active
  assert.deepEqual([items['651000'].status,items['651000'].account_name,items['651000'].requires_member,items['651000'].inferred],['PROPOSED','Repairs and maintenance',false,true]);
  assert.deepEqual([items['291050'].status,items['291050'].required_member_type,items['291050'].inference_rule],['PROPOSED','VENDOR','CODE_291_AP_VENDOR']);
  assert.deepEqual([items['164200'].status,items['164200'].account_name,items['164200'].name_candidates],['NAME_CONFLICT',null,['CWIP - Hard cost','CWIP hard costs']]);
  assert.equal(items['705000'].status,'EXISTS_INACTIVE');
  assert.deepEqual(proposal.totals,{companies:1,items:4,proposed:2,name_conflicts:1,exists_inactive:1});
  assert.equal((await withClient(c=>buildCoaSeedProposal(c,{tenantId:ids.tenantId,companyCodes:[ids.code]}))).proposal_hash,proposal.proposal_hash,'deterministic');
  assert.deepEqual(await accounts(ids),beforeRows);
  assert.deepEqual(inferMemberRequirement('120200').required_member_type,'CUSTOMER_OR_AFFILIATE');
});

pgTest('R08-2: a signed decision seeds exactly the approved accounts once, with an audit event; drift, unknown items, unresolved names and inactive rows are refused',async()=>{
  const ids=await scope();
  const proposal=await withClient(c=>buildCoaSeedProposal(c,{tenantId:ids.tenantId,companyCodes:[ids.code]}));
  const template=decisionTemplate(proposal);
  assert.deepEqual(template.decisions.map(d=>[d.account_code,d.decision]).sort(),[['164200','REJECT'],['291050','APPROVE'],['651000','APPROVE'],['705000','REJECT']]);
  const signed={...template,approved_by:'owner-ricky',approved_at:'2026-09-26T08:00:00Z',reason:'Create the WBS accounts referenced by approved Payable Settings.'};
  signed.decisions=signed.decisions.map(d=>d.account_code==='164200'?{company_code:d.company_code,account_code:'164200',decision:'APPROVE',account_name:'CWIP - Hard cost',requires_member:false,required_member_type:null}:d);
  assert.throws(()=>assertCoaSeedDecision({...signed,reason:'x'}),{code:'COA_SEED_DECISION_INVALID'});
  // Name not among the WBS candidates is refused unless explicitly overridden.
  const badName={...signed,decisions:signed.decisions.map(d=>d.account_code==='164200'?{...d,account_name:'Something else'}:d)};
  await assert.rejects(withClient(c=>applyCoaSeedDecision(c,{tenantId:ids.tenantId,decision:badName})),{code:'COA_SEED_NAME_UNRESOLVED'});
  const inactive={...signed,decisions:[...signed.decisions.filter(d=>d.account_code!=='705000'),{company_code:ids.code,account_code:'705000',decision:'APPROVE',account_name:'Other income',requires_member:false,required_member_type:null}]};
  await assert.rejects(withClient(c=>applyCoaSeedDecision(c,{tenantId:ids.tenantId,decision:inactive})),{code:'COA_SEED_ITEM_NOT_SEEDABLE'});
  const unknown={...signed,decisions:[...signed.decisions,{company_code:ids.code,account_code:'999999',decision:'APPROVE',account_name:'Invented',requires_member:false,required_member_type:null}]};
  await assert.rejects(withClient(c=>applyCoaSeedDecision(c,{tenantId:ids.tenantId,decision:unknown})),{code:'COA_SEED_ITEM_UNKNOWN'});
  assert.equal((await accounts(ids)).length,3,'refused decisions write nothing');
  // Drift: a new Setting after approval changes the proposal, so the signature no longer applies.
  await admin.query(`INSERT INTO wbs_h1_accounting_setting_stage(tenant_id,company_code,setting_id,setting_type,category,business_type,detail,project_codes,journal_code,account_name,supplementary,effective_from,effective_to,setting_hash)
    VALUES($1,$2,7,'Debit','Payable',4,'R-400','P-100','652000','Utilities','Project','2026-01-01','2026-12-31',$3)`,[ids.tenantId,ids.code,hash(`r08-setting-${ids.code}-7`)]);
  await assert.rejects(withClient(c=>applyCoaSeedDecision(c,{tenantId:ids.tenantId,decision:signed})),{code:'COA_SEED_PROPOSAL_DRIFT'});
  assert.equal((await accounts(ids)).length,3);
  const fresh=await withClient(c=>buildCoaSeedProposal(c,{tenantId:ids.tenantId,companyCodes:[ids.code]}));
  const resigned={...signed,proposal_hash:fresh.proposal_hash};
  const receipt=await withClient(c=>applyCoaSeedDecision(c,{tenantId:ids.tenantId,decision:resigned}));
  assert.equal(receipt.status,'APPLIED');assert.deepEqual(receipt.companies[0].inserted.sort(),['164200','291050','651000']);
  const rows=Object.fromEntries((await accounts(ids)).map(r=>[r.account_code,r]));
  assert.deepEqual(rows['291050'],{account_code:'291050',account_name:'Retention payable',requires_member:true,required_member_type:'VENDOR',active:true});
  assert.equal(rows['705000'].active,false,'an inactive account is never reactivated by seeding');
  assert.equal(rows['652000'],undefined,'an item that was not in the signed decision is not created');
  const audit=(await admin.query("SELECT actor_id,metadata FROM audit_event WHERE tenant_id=$1 AND event_type='WBS_COA_SEED_APPLIED'",[ids.tenantId])).rows;
  assert.equal(audit.length,1);assert.equal(audit[0].actor_id,'owner-ricky');assert.equal(audit[0].metadata.inserted_count,3);
  const replay=await withClient(c=>applyCoaSeedDecision(c,{tenantId:ids.tenantId,decision:resigned}));
  assert.equal(replay.status,'ALREADY_APPLIED');
  assert.equal((await admin.query("SELECT count(*)::int n FROM audit_event WHERE tenant_id=$1 AND event_type='WBS_COA_SEED_APPLIED'",[ids.tenantId])).rows[0].n,1);
});

pgTest('R08-3: before seeding the Payable line is an exception; after seeding and a human Settings decision it is a controller-review candidate that still cannot post, and no Draft exists',async()=>{
  // A Settings proposal with any not-ready account cannot be approved, and reactivating an inactive
  // account is not a seed decision, so this company has no inactive reference.
  const ids=await scope({withInactive:false});const controller=await controllerFor(ids);
  let settings=await controller.readWbsH1AccountingSettingsProposal({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId});
  assert.equal(settings.status,'EXCEPTION');
  assert.ok(settings.rules.some(r=>r.account_code==='651000'&&r.decision==='ACCOUNT_NOT_READY'));
  let payable=await controller.readWbsH1PayableAccountingProposal({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId,limit:50,offset:0});
  assert.equal(payable.ready_count,0);assert.ok(payable.rows[0].exception_codes.includes('SETTINGS_NOT_APPROVED'));
  assert.ok(payable.rows[0].exception_codes.includes('DEBIT_ACCOUNT_NOT_READY'),payable.rows[0].exception_codes.join(','));
  assert.equal(payable.rows[0].status,'EXCEPTION');assert.equal(payable.can_create_draft,false);
  // Seed the accounts (name conflict resolved by the approver) and reject the inactive one.
  const proposal=await withClient(c=>buildCoaSeedProposal(c,{tenantId:ids.tenantId,companyCodes:[ids.code]}));
  const decision={...decisionTemplate(proposal),approved_by:'owner-ricky',approved_at:'2026-09-26T08:00:00Z',reason:'Create the WBS accounts referenced by the Payable Settings.'};
  decision.decisions=decision.decisions.map(d=>d.account_code==='164200'?{...d,decision:'APPROVE',account_name:'CWIP - Hard cost',requires_member:false,required_member_type:null}:d);
  await withClient(c=>applyCoaSeedDecision(c,{tenantId:ids.tenantId,decision}));
  settings=await controller.readWbsH1AccountingSettingsProposal({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId});
  assert.deepEqual(settings.rules.filter(r=>r.decision==='ACCOUNT_NOT_READY').map(r=>r.account_code),[],'every referenced account is now ready');
  assert.equal(settings.status,'READY_FOR_HUMAN_REVIEW');
  const journalsBefore=(await admin.query('SELECT count(*)::int n FROM journal_entry WHERE tenant_id=$1',[ids.tenantId])).rows[0].n;
  await controller.decideWbsH1AccountingSettings({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId,expectedProposalHash:settings.proposal_hash,outcome:'APPROVED',reason:'Controller approved the WBS Payable Settings for June.',idempotencyKey:`r08-settings-${ids.code}`});
  payable=await controller.readWbsH1PayableAccountingProposal({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId,limit:50,offset:0});
  assert.equal(payable.settings_outcome,'APPROVED');assert.equal(payable.ready_count,1,JSON.stringify(payable.rows[0]?.exception_codes));
  assert.equal(payable.rows[0].status,'READY_FOR_CONTROLLER_REVIEW');
  assert.deepEqual(payable.rows[0].proposed_lines.map(l=>[l.side,l.account_code,l.amount,l.member_ref]),[['DEBIT','651000','125.0000',null],['CREDIT','291001','125.0000','V-1']]);
  assert.deepEqual({create:payable.can_create_draft,review:payable.can_review,approve:payable.can_approve,post:payable.can_post},{create:false,review:false,approve:false,post:false});
  assert.equal((await admin.query('SELECT count(*)::int n FROM journal_entry WHERE tenant_id=$1',[ids.tenantId])).rows[0].n,journalsBefore,'no Draft or posting is created by seeding or deciding');
});

test('R08-4: decision shape is validated before any database access',()=>{
  assert.throws(()=>assertCoaSeedDecision({schema_version:COA_SEED_DECISION_SCHEMA,proposal_hash:'x',decisions:[]}),{code:'COA_SEED_DECISION_INVALID'});
  const ok={schema_version:COA_SEED_DECISION_SCHEMA,proposal_hash:`sha256:${'a'.repeat(64)}`,approved_by:'owner',approved_at:'2026-09-26T00:00:00Z',reason:'Seed the accounts.',
    decisions:[{company_code:'W1',account_code:'651000',decision:'APPROVE',account_name:'Repairs',requires_member:false,required_member_type:null}]};
  assert.equal(assertCoaSeedDecision(ok),ok);
  assert.throws(()=>assertCoaSeedDecision({...ok,decisions:[{...ok.decisions[0],requires_member:true,required_member_type:null}]}),{code:'COA_SEED_DECISION_INVALID'});
  assert.throws(()=>assertCoaSeedDecision({...ok,decisions:[ok.decisions[0],ok.decisions[0]]}),{code:'COA_SEED_DECISION_INVALID'});
});

pgTest('R08-5 (R09 gate): the live WBS H1 Draft command still refuses a non-positive source amount, so no UNDECIDED negative line can become a Draft',async()=>{
  // R09's decisionPermits governs what a *decided* negative line may become. Until decisions are
  // persisted, the only safe state is that the Draft command refuses every negative line outright.
  const def=(await admin.query("SELECT pg_get_functiondef('refs_create_wbs_h1_payable_reclass_draft(uuid,uuid,uuid,text,text,text,text,text)'::regprocedure) d")).rows[0].d;
  assert.match(def,/source_row\.amount<=0/);
  assert.equal((await admin.query("SELECT count(*)::int n FROM pg_proc WHERE pronamespace='public'::regnamespace AND prosrc ILIKE '%negative_sign_decision%'")).rows[0].n,0,
    'if a persisted negative-sign decision store appears, the Draft command must consult decisionPermits and this test must be replaced');
});

pgTest('R08-6 / W08: formal reports can only see Posted journals — ledger_line is written only by the two posting functions and is append-only',async()=>{
  // Every formal report (trial balance, statements, GL, budget vs actual, custom reports) reads
  // ledger_line. If only posting writes it, no Draft, proposal, staged or raw WBS row can reach a
  // report, whatever the report query filters.
  const writers=(await admin.query("SELECT proname FROM pg_proc WHERE pronamespace='public'::regnamespace AND prosrc ~* 'INSERT\\s+INTO\\s+(public\\.)?ledger_line\\M' ORDER BY 1")).rows.map(r=>r.proname);
  assert.deepEqual(writers,['refs_post_journal','refs_post_unit_transfer_reversal_journal']);
  const triggers=(await admin.query("SELECT tgname FROM pg_trigger WHERE tgrelid='ledger_line'::regclass AND NOT tgisinternal")).rows.map(r=>r.tgname);
  assert.ok(triggers.includes('ledger_line_append_only'));
  for(const fn of writers){
    const src=(await admin.query('SELECT string_agg(prosrc,chr(10)) s FROM pg_proc WHERE proname=$1',[fn])).rows[0].s;
    assert.match(src,/POSTED/,`${fn} must only write ledger lines for a journal it posts`);
  }
});
