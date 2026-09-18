// P07 — loan master, approved draws, deterministic interest accrual and the controlled interest Draft (migration 431).
// The accrual is arithmetic: outstanding principal per day x rate / basis, split by the approved capitalisation window.
import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID, createHash} from 'node:crypto';
import {createPool} from '../runtime/db.mjs';
import {runtimeConfig} from '../runtime/config.mjs';
import {migrateUp} from '../runtime/migrations.mjs';
import {PostgresAccountingKernel} from '../runtime/kernel-repository.mjs';
import {PostgresContextIssuer} from '../runtime/context-issuer.mjs';

const config=runtimeConfig();
let admin=null,runtime=null,issuer=null,unavailable=null;
const hash=v=>`sha256:${createHash('sha256').update(String(v)).digest('hex')}`;

before(async()=>{try{
  admin=await createPool({databaseUrl:config.migrationDatabaseUrl,applicationName:'refs-p07-admin',max:2});await admin.query('SELECT 1');await migrateUp(admin,{});
  runtime=await createPool({databaseUrl:config.databaseUrl,applicationName:'refs-p07-runtime',max:6});await runtime.query('SELECT 1');
  issuer=await createPool({databaseUrl:config.contextIssuerDatabaseUrl,applicationName:'refs-p07-issuer',max:2});await issuer.query('SELECT 1');
}catch(error){unavailable=`POSTGRES NOT RUN: ${error.code||error.name}: ${error.message}`;if(config.requirePostgres)throw error;for(const p of [admin,runtime,issuer])if(p)await p.end().catch(()=>{});admin=runtime=issuer=null;}});
after(async()=>{for(const p of [admin,runtime,issuer])if(p)await p.end();});

async function grant(ids,actorId,permission){
  const a=(await admin.query('SELECT authority_class FROM runtime_human_permission_authority WHERE permission_code=$1',[permission])).rows[0]?.authority_class||'ANALYSIS';
  await admin.query(`INSERT INTO runtime_actor_grant(tenant_id,actor_id,entity_id,permission,authority_class,valid_until) VALUES($1,$2,$3,$4,$5,clock_timestamp()+interval '1 hour') ON CONFLICT(tenant_id,actor_id,entity_id,permission) DO UPDATE SET revoked_at=NULL,authority_class=EXCLUDED.authority_class,valid_until=EXCLUDED.valid_until`,[ids.tenantId,actorId,ids.entityId,permission,a]);
}
const kernelFor=(ids,actorId)=>{
  const ci=new PostgresContextIssuer(issuer,{principalProvider:async()=>({trusted:true,actorId,tenantId:ids.tenantId})});
  return new PostgresAccountingKernel(runtime,{sessionProvider:()=>ci.issue({tenantId:ids.tenantId})});
};
async function seed(tag,{classifyCwip=true}={}){
  const tenantId=randomUUID(),entityId=randomUUID(),periodId=randomUUID(),nextPeriodId=randomUUID(),attachmentId=randomUUID();
  await admin.query('INSERT INTO tenant(tenant_id,tenant_code,name) VALUES($1,$2,$3)',[tenantId,`T${tenantId.replaceAll('-','').slice(0,8)}`.toUpperCase(),`p07-${tag}`]);
  await admin.query("INSERT INTO entity(entity_id,tenant_id,entity_code,source_system,source_entity_id,name,base_currency) VALUES($1,$2,'E1','WBS','E1','E1','USD')",[entityId,tenantId]);
  await admin.query("INSERT INTO accounting_period(period_id,tenant_id,entity_id,period_code,starts_on,ends_on,status) VALUES($1,$2,$3,'2026-07','2026-07-01','2026-07-31','OPEN')",[periodId,tenantId,entityId]);
  await admin.query("INSERT INTO accounting_period(period_id,tenant_id,entity_id,period_code,starts_on,ends_on,status) VALUES($1,$2,$3,'2026-08','2026-08-01','2026-08-31','OPEN')",[nextPeriodId,tenantId,entityId]);
  await admin.query(`INSERT INTO account_master(tenant_id,entity_id,account_code,account_name,requires_member,required_member_type) VALUES
    ($1,$2,'150100','Construction in progress',false,NULL),($1,$2,'780100','Interest expense',false,NULL),
    ($1,$2,'292001','Accrued interest payable',true,'VENDOR'),($1,$2,'111000','Operating Cash',true,'BANK')`,[tenantId,entityId]);
  await admin.query(`INSERT INTO member_master(tenant_id,entity_id,member_ref,member_type,display_name) VALUES
    ($1,$2,'LENDER-1','VENDOR','Construction lender'),($1,$2,'BANK-1','BANK','Operating bank')`,[tenantId,entityId]);
  await admin.query(`INSERT INTO attachment(attachment_id,tenant_id,entity_id,name,media_type,size_bytes,content_hash,storage_ref,storage_version,uploaded_by,uploaded_at,verified_at,scan_status,finalization_status,finalized_at) VALUES($1,$2,$3,'note.pdf','application/pdf',10,$4,$5,'v1','maker',now(),now(),'CLEAN','VERIFIED_CLEAN',now())`,[attachmentId,tenantId,entityId,hash(attachmentId),`object://attachments/${attachmentId}`]);
  const ids={tenantId,entityId,periodId,nextPeriodId,attachmentId};
  if(classifyCwip){
    const mh=(await admin.query("SELECT refs_jsonb_hash(jsonb_build_object('input_keys',jsonb_build_object('account_code','150100'),'output_rules',jsonb_build_object('classification','CWIP'))) h")).rows[0].h;
    await admin.query(`INSERT INTO mapping_snapshot(mapping_snapshot_id,tenant_id,entity_id,family,scope_type,scope_key,input_key_hash,version,priority,effective_from,effective_to,status,input_keys,output_rules,snapshot_hash,created_by,approved_by,approved_at)
      VALUES($1,$2,$3::uuid,'CWIP_ACCOUNT_CLASSIFICATION','ENTITY',$3::text,$4,1,0,'2026-01-01T00:00:00Z',NULL,'APPROVED',jsonb_build_object('account_code','150100'),jsonb_build_object('classification','CWIP'),$5,'mapping-maker','mapping-approver',now())`,[randomUUID(),tenantId,entityId,hash('cwip-150100'),mh]);
  }
  for(const [a,p] of [['lmaker','LOAN.MASTER.CREATE'],['lapprover','LOAN.MASTER.APPROVE'],['lviewer','LOAN.MASTER.VIEW'],['reporter','GL.REPORT.VIEW'],['intmaker','LOAN.INTEREST.DRAFT'],
    ['submitter','GL.JE.SUBMIT'],['reviewer','GL.JE.REVIEW'],['approver','GL.JE.APPROVE'],['poster','GL.JE.POST']])await grant(ids,a,p);
  await grant(ids,'intmaker','GL.JE.CREATE');
  return ids;
}
const rejects=async(fn,code,re)=>{try{await fn();assert.fail('expected rejection '+code);}catch(e){assert.equal(e.code,code,e.message);if(re)assert.match(e.message,re);}};
function pgTest(name,fn){test(name,async t=>{if(unavailable){t.skip(unavailable);return;}await fn(t);});}

const makeLoan=(ids,args={})=>kernelFor(ids,'lmaker').createLoanMaster({tenantId:ids.tenantId,entityId:ids.entityId,loanRef:'LN-1',lenderMemberRef:'LENDER-1',
  facilityAmount:'1000000.0000',currency:'USD',annualRate:'0.073000',dayCountBasis:'ACT_365',capitalizationStart:'2026-07-01',capitalizationEnd:null,
  projectRef:'PRJ-1',cwipAccountCode:'150100',interestExpenseAccountCode:'780100',accruedInterestAccountCode:'292001',reason:'register construction loan',idempotencyKey:'p07-loan-1',...args});
const transition=(ids,actor,args)=>kernelFor(ids,actor).transitionLoanMaster({tenantId:ids.tenantId,entityId:ids.entityId,reason:'approve loan master data',...args});
const accrual=(ids,loanId,periodId=ids.periodId)=>kernelFor(ids,'reporter').readLoanInterestAccrual({tenantId:ids.tenantId,entityId:ids.entityId,loanId,periodId});

async function approvedLoanWithDraw(ids,{drawDate='2026-07-01',amount='1000000.0000',loanArgs={}}={}){
  const loan=await makeLoan(ids,loanArgs);
  await transition(ids,'lapprover',{objectType:'LOAN',objectId:loan.loan_id,expectedRevision:0,event:'APPROVED',idempotencyKey:'p07-appr-loan'});
  const draw=await kernelFor(ids,'lmaker').createLoanDraw({tenantId:ids.tenantId,entityId:ids.entityId,loanId:loan.loan_id,drawRef:'D-1',drawDate,amount,reason:'first construction draw',idempotencyKey:'p07-draw-1'});
  await transition(ids,'lapprover',{objectType:'DRAW',objectId:draw.loan_draw_id,expectedRevision:0,event:'APPROVED',idempotencyKey:'p07-appr-draw'});
  return {loanId:loan.loan_id,drawId:draw.loan_draw_id};
}

pgTest('P07-1: loan master and draws — SoD, CAS, facility bounds, and the masters read',async()=>{
  const ids=await seed('master');
  await rejects(()=>makeLoan(ids,{lenderMemberRef:'NOBODY',idempotencyKey:'p07-loan-nolender'}),'23503',/lender member/);
  await rejects(()=>makeLoan(ids,{interestExpenseAccountCode:'999999',idempotencyKey:'p07-loan-noacct'}),'23503',/chart of accounts/);
  const loan=await makeLoan(ids);
  assert.equal(loan.schema_version,'LOAN_MASTER_V1');assert.equal(loan.status,'DRAFT');assert.equal(Number(loan.annual_rate),0.073);assert.equal(loan.day_count_basis,'ACT_365');
  assert.equal((await makeLoan(ids)).idempotent,true);
  await rejects(()=>makeLoan(ids,{facilityAmount:'2000000.0000'}),'23505');
  // draws need an APPROVED loan; the maker may not approve
  await rejects(()=>kernelFor(ids,'lmaker').createLoanDraw({tenantId:ids.tenantId,entityId:ids.entityId,loanId:loan.loan_id,drawRef:'D-0',drawDate:'2026-07-01',amount:'1.0000',reason:'premature draw attempt',idempotencyKey:'p07-draw-early'}),'23514',/APPROVED loan/);
  await grant(ids,'lmaker','LOAN.MASTER.APPROVE');
  await rejects(()=>transition(ids,'lmaker',{objectType:'LOAN',objectId:loan.loan_id,expectedRevision:0,event:'APPROVED',idempotencyKey:'p07-self'}),'42501');
  await admin.query("UPDATE runtime_actor_grant SET revoked_at=clock_timestamp() WHERE tenant_id=$1 AND actor_id='lmaker' AND permission='LOAN.MASTER.APPROVE'",[ids.tenantId]);
  await rejects(()=>transition(ids,'lapprover',{objectType:'LOAN',objectId:loan.loan_id,expectedRevision:7,event:'APPROVED',idempotencyKey:'p07-stale'}),'40001');
  await transition(ids,'lapprover',{objectType:'LOAN',objectId:loan.loan_id,expectedRevision:0,event:'APPROVED',idempotencyKey:'p07-appr-loan'});
  // facility bound at create and at approve
  await rejects(()=>kernelFor(ids,'lmaker').createLoanDraw({tenantId:ids.tenantId,entityId:ids.entityId,loanId:loan.loan_id,drawRef:'D-BIG',drawDate:'2026-07-01',amount:'1000001.0000',reason:'over facility draw',idempotencyKey:'p07-draw-big'}),'23514',/facility/);
  const a=await kernelFor(ids,'lmaker').createLoanDraw({tenantId:ids.tenantId,entityId:ids.entityId,loanId:loan.loan_id,drawRef:'D-1',drawDate:'2026-07-01',amount:'600000.0000',reason:'first construction draw',idempotencyKey:'p07-draw-a'});
  const b=await kernelFor(ids,'lmaker').createLoanDraw({tenantId:ids.tenantId,entityId:ids.entityId,loanId:loan.loan_id,drawRef:'D-2',drawDate:'2026-07-16',amount:'600000.0000',reason:'second construction draw',idempotencyKey:'p07-draw-b'});
  await transition(ids,'lapprover',{objectType:'DRAW',objectId:a.loan_draw_id,expectedRevision:0,event:'APPROVED',idempotencyKey:'p07-appr-a'});
  // both drafts fit individually but not together: approval re-checks the bound
  await rejects(()=>transition(ids,'lapprover',{objectType:'DRAW',objectId:b.loan_draw_id,expectedRevision:0,event:'APPROVED',idempotencyKey:'p07-appr-b'}),'23514',/breach the facility/);
  // a repayment may not drive principal negative
  await rejects(()=>kernelFor(ids,'lmaker').createLoanDraw({tenantId:ids.tenantId,entityId:ids.entityId,loanId:loan.loan_id,drawRef:'D-R',drawDate:'2026-07-20',amount:'-700000.0000',reason:'over repayment attempt',idempotencyKey:'p07-draw-r'}),'23514',/below zero/);
  const read=await kernelFor(ids,'lviewer').readLoanMasters({tenantId:ids.tenantId,entityId:ids.entityId});
  assert.equal(read.accounting_authority,'NONE');assert.equal(read.loans.length,1);
  assert.equal(Number(read.loans[0].outstanding_principal),600000);assert.equal(read.loans[0].draws.length,2);
  await rejects(()=>kernelFor(ids,'reporter').readLoanMasters({tenantId:ids.tenantId,entityId:ids.entityId}),'42501');
  // loan cannot retire while an APPROVED draw remains
  await rejects(()=>transition(ids,'lapprover',{objectType:'LOAN',objectId:loan.loan_id,expectedRevision:1,event:'RETIRED',idempotencyKey:'p07-retire-loan'}),'23514',/Retire APPROVED draws/);
  const ev=(await admin.query('SELECT object_type,event_type FROM loan_master_event WHERE tenant_id=$1 ORDER BY recorded_at',[ids.tenantId])).rows.map(r=>`${r.object_type}:${r.event_type}`);
  assert.deepEqual(ev,['LOAN:CREATED','LOAN:APPROVED','DRAW:CREATED','DRAW:CREATED','DRAW:APPROVED']);
  await rejects(()=>admin.query('DELETE FROM loan_master_event WHERE tenant_id=$1',[ids.tenantId]),'55000');
});

pgTest('P07-2: accrual is deterministic arithmetic and splits on the approved capitalisation window',async()=>{
  const ids=await seed('accrual');
  // 1,000,000 drawn 2026-07-01, 7.3%/ACT_365 => 200.00 per day; July has 31 days => 6,200.00
  const {loanId}=await approvedLoanWithDraw(ids);
  const a=await accrual(ids,loanId);
  assert.equal(a.schema_version,'LOAN_INTEREST_ACCRUAL_V1');assert.equal(a.can_post,false);assert.equal(a.can_draft,false);
  assert.equal(Number(a.capitalized_amount),6200);assert.equal(Number(a.expensed_amount),0);assert.equal(Number(a.total_amount),6200);
  assert.equal(a.computation.basis_days,365);assert.equal(a.computation.capitalizable_days,31);assert.equal(a.computation.expensed_days,0);
  assert.equal(a.computation.opening_principal,'0.0000','a draw dated on the first day is not an opening balance');assert.equal(a.computation.closing_principal,'1000000.0000');assert.equal(a.computation.drawn_in_period,'1000000.0000');
  assert.match(a.computation_hash,/^sha256:[0-9a-f]{64}$/);assert.equal(a.existing_draft,null);
  // the hash is stable for identical inputs
  assert.equal((await accrual(ids,loanId)).computation_hash,a.computation_hash);
  // ACT_360 on the same facts: 1,000,000*0.073/360 = 202.7778/day * 31 = 6286.1111 (rounded once)
  const ids360=await seed('basis360');
  const l360=await approvedLoanWithDraw(ids360,{loanArgs:{dayCountBasis:'ACT_360'}});
  const a360=await accrual(ids360,l360.loanId);
  assert.equal(Number(a360.capitalized_amount),6286.1111);
  // a mid-period draw is counted from its own date: 16 days at 200 = 3200
  const ids2=await seed('middraw');
  const mid=await approvedLoanWithDraw(ids2,{drawDate:'2026-07-16'});
  assert.equal(Number((await accrual(ids2,mid.loanId)).capitalized_amount),3200);
  assert.equal((await accrual(ids2,mid.loanId)).computation.opening_principal,'0.0000');
  // window that closes mid-period splits the days; both buckets still sum to the total
  const ids3=await seed('split');
  const split=await approvedLoanWithDraw(ids3,{loanArgs:{capitalizationStart:'2026-07-01',capitalizationEnd:'2026-07-10'}});
  const s=await accrual(ids3,split.loanId);
  assert.equal(s.computation.capitalizable_days,10);assert.equal(s.computation.expensed_days,21);
  assert.equal(Number(s.capitalized_amount),2000);assert.equal(Number(s.expensed_amount),4200);assert.equal(Number(s.total_amount),6200);
  // no window at all: everything is expensed and no CWIP account is declared
  const ids4=await seed('nowindow');
  const plain=await approvedLoanWithDraw(ids4,{loanArgs:{capitalizationStart:null,capitalizationEnd:null,projectRef:null,cwipAccountCode:null}});
  const p=await accrual(ids4,plain.loanId);
  assert.equal(Number(p.capitalized_amount),0);assert.equal(Number(p.expensed_amount),6200);
  // DRAFT draws never count; only APPROVED ones do
  const ids5=await seed('draftdraw');
  const loan5=await makeLoan(ids5);
  await transition(ids5,'lapprover',{objectType:'LOAN',objectId:loan5.loan_id,expectedRevision:0,event:'APPROVED',idempotencyKey:'p07-appr-loan'});
  await kernelFor(ids5,'lmaker').createLoanDraw({tenantId:ids5.tenantId,entityId:ids5.entityId,loanId:loan5.loan_id,drawRef:'D-1',drawDate:'2026-07-01',amount:'1000000.0000',reason:'unapproved construction draw',idempotencyKey:'p07-draw-1'});
  assert.equal(Number((await accrual(ids5,loan5.loan_id)).total_amount),0);
  await rejects(()=>accrual(ids5,randomUUID()),'P0002');
  await rejects(()=>accrual(ids5,loan5.loan_id,randomUUID()),'22023');
  await rejects(()=>kernelFor(ids5,'lviewer').readLoanInterestAccrual({tenantId:ids5.tenantId,entityId:ids5.entityId,loanId:loan5.loan_id,periodId:ids5.periodId}),'42501');
});

pgTest('P07-3: interest Draft — computation-bound, never posts, one per period, and the posted trace ties back',async()=>{
  const ids=await seed('draft');
  const {loanId,drawId}=await approvedLoanWithDraw(ids);
  const a=await accrual(ids,loanId);
  const draft=(args={})=>kernelFor(ids,'intmaker').createLoanInterestDraft({tenantId:ids.tenantId,entityId:ids.entityId,loanId,periodId:ids.periodId,
    journalNumber:'P07-INT-1',journalDate:'2026-07-31',expectedComputationHash:a.computation_hash,reason:'accrue july construction interest',attachmentIds:[ids.attachmentId],idempotencyKey:'p07-int-1',...args});
  // a stale computation hash is refused
  await rejects(()=>draft({expectedComputationHash:hash('stale'),idempotencyKey:'p07-int-stale'}),'40001',/computation changed/);
  // a plain JE maker may not draft interest
  await rejects(()=>kernelFor(ids,'submitter').createLoanInterestDraft({tenantId:ids.tenantId,entityId:ids.entityId,loanId,periodId:ids.periodId,journalNumber:'P07-INT-X',journalDate:'2026-07-31',expectedComputationHash:a.computation_hash,reason:'accrue july construction interest',attachmentIds:[ids.attachmentId],idempotencyKey:'p07-int-nope'}),'42501');
  const first=await draft();
  assert.equal(first.schema_version,'LOAN_INTEREST_DRAFT_V1');assert.equal(first.status,'DRAFT');assert.equal(first.capitalized_amount,'6200.0000');assert.equal(first.expensed_amount,'0.0000');
  assert.equal(first.computation_hash,a.computation_hash);assert.equal(first.idempotent,false);
  assert.equal((await draft()).idempotent,true);
  // the Draft is not in the ledger
  const ledger=async code=>Number((await admin.query('SELECT COALESCE(sum(debit_amount-credit_amount),0)::text n FROM ledger_line WHERE tenant_id=$1 AND account_code=$2',[ids.tenantId,code])).rows[0].n);
  assert.equal(await ledger('150100'),0);
  // exactly two lines: Dr CWIP with the project dimension, Cr accrued interest against the lender
  const lines=(await admin.query('SELECT account_code,debit_amount::text d,credit_amount::text c,member_ref,dimensions FROM journal_line WHERE journal_entry_id=$1 ORDER BY line_no',[first.journal_entry_id])).rows;
  assert.equal(lines.length,2);
  assert.deepEqual([lines[0].account_code,lines[0].d,lines[0].dimensions],['150100','6200.0000',{project_ref:'PRJ-1'}]);
  assert.deepEqual([lines[1].account_code,lines[1].c,lines[1].member_ref],['292001','6200.0000','LENDER-1']);
  // one Draft per loan per period
  await rejects(()=>draft({journalNumber:'P07-INT-2',idempotencyKey:'p07-int-dup'}),'23505');
  // post it through the ordinary chain and the trace ties back to the binding
  for(const [action,rev] of [['SUBMIT',0],['REVIEW',1],['APPROVE',2]])
    await kernelFor(ids,action==='SUBMIT'?'submitter':action==='REVIEW'?'reviewer':'approver').transitionJournal({tenantId:ids.tenantId,entityId:ids.entityId,journalEntryId:first.journal_entry_id,action,expectedRevision:rev,idempotencyKey:`p07-${action}`});
  await kernelFor(ids,'poster').postJournal({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId,journalEntryId:first.journal_entry_id,expectedRevision:3,idempotencyKey:'p07-post'});
  assert.equal(await ledger('150100'),6200);assert.equal(await ledger('292001'),-6200);
  const back=await accrual(ids,loanId);
  assert.equal(back.existing_draft.journal_status,'POSTED');assert.equal(Number(back.existing_draft.capitalized_amount),6200);
  assert.equal(back.existing_draft.computation_hash,a.computation_hash,'the posted entry still points at the computation it came from');
  const b=(await admin.query('SELECT capitalized_amount::text cap,expensed_amount::text exp,computation FROM loan_interest_draft_binding WHERE tenant_id=$1',[ids.tenantId])).rows;
  assert.equal(b.length,1);assert.equal(b[0].cap,'6200.0000');assert.equal(b[0].computation.method,'DAILY_SIMPLE_INTEREST_ON_APPROVED_DRAWS');
  await rejects(()=>admin.query('UPDATE loan_interest_draft_binding SET capitalized_amount=1 WHERE tenant_id=$1',[ids.tenantId]),'55000');
  // a period with no interest cannot be drafted
  const nextAccrual=await kernelFor(ids,'reporter').readLoanInterestAccrual({tenantId:ids.tenantId,entityId:ids.entityId,loanId,periodId:ids.nextPeriodId});
  assert.equal(Number(nextAccrual.total_amount),6200,'august keeps accruing on the outstanding balance');
  const ids6=await seed('nointerest');
  const loan6=await makeLoan(ids6);
  await transition(ids6,'lapprover',{objectType:'LOAN',objectId:loan6.loan_id,expectedRevision:0,event:'APPROVED',idempotencyKey:'p07-appr-loan'});
  const zero=await accrual(ids6,loan6.loan_id);
  await rejects(()=>kernelFor(ids6,'intmaker').createLoanInterestDraft({tenantId:ids6.tenantId,entityId:ids6.entityId,loanId:loan6.loan_id,periodId:ids6.periodId,journalNumber:'P07-INT-0',journalDate:'2026-07-31',expectedComputationHash:zero.computation_hash,reason:'accrue july construction interest',attachmentIds:[ids6.attachmentId],idempotencyKey:'p07-int-zero'}),'23514',/no interest to accrue/);
  // capitalised interest requires the declared CWIP account to be classified
  const ids7=await seed('nocwipclass',{classifyCwip:false});
  const l7=await approvedLoanWithDraw(ids7);
  const a7=await accrual(ids7,l7.loanId);
  await rejects(()=>kernelFor(ids7,'intmaker').createLoanInterestDraft({tenantId:ids7.tenantId,entityId:ids7.entityId,loanId:l7.loanId,periodId:ids7.periodId,journalNumber:'P07-INT-7',journalDate:'2026-07-31',expectedComputationHash:a7.computation_hash,reason:'accrue july construction interest',attachmentIds:[ids7.attachmentId],idempotencyKey:'p07-int-7'}),'23514',/approved CWIP classification/);
  assert.ok(drawId);
});
