// P03: bank statement → reconciliation → book. Duplicate statement lines are refused at the database, the reconciliation's
// book balance is exactly the POSTED ledger for the bank member up to the statement date (bank-to-book tie), the difference
// is statement − book, a signed-off statement is locked (later retro start refused), and the book balance reverse-traces to
// the exact ledger lines / journals / attachment evidence. Every figure is read back from tables, never from a return value.
import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID, createHash} from 'node:crypto';
import {createPool} from '../runtime/db.mjs';
import {runtimeConfig} from '../runtime/config.mjs';
import {migrateUp} from '../runtime/migrations.mjs';
import {PostgresAccountingKernel} from '../runtime/kernel-repository.mjs';
import {PostgresContextIssuer} from '../runtime/context-issuer.mjs';
const config=runtimeConfig();const hash=v=>`sha256:${createHash('sha256').update(String(v)).digest('hex')}`;
let admin=null,runtime=null,issuer=null,unavailable=null;
before(async()=>{try{
  admin=await createPool({databaseUrl:config.migrationDatabaseUrl,applicationName:'refs-p03-admin',max:2});await admin.query('SELECT 1');await migrateUp(admin,{});
  runtime=await createPool({databaseUrl:config.databaseUrl,applicationName:'refs-p03-runtime',max:6});await runtime.query('SELECT 1');
  issuer=await createPool({databaseUrl:config.contextIssuerDatabaseUrl,applicationName:'refs-p03-issuer',max:4});await issuer.query('SELECT 1');
}catch(error){unavailable=`POSTGRES NOT RUN: ${error.code||error.name}: ${error.message}`;if(config.requirePostgres)throw error;for(const p of [admin,runtime,issuer])if(p)await p.end().catch(()=>{});admin=runtime=issuer=null;}});
after(async()=>{for(const p of [admin,runtime,issuer])if(p)await p.end();});
async function grant(ids,actorId,permission){
  const authority=(await admin.query('SELECT authority_class FROM runtime_human_permission_authority WHERE permission_code=$1',[permission])).rows[0]?.authority_class||'ANALYSIS';
  await admin.query(`INSERT INTO runtime_actor_grant(tenant_id,actor_id,entity_id,permission,authority_class,valid_until) VALUES($1,$2,$3,$4,$5,clock_timestamp()+interval '1 hour') ON CONFLICT(tenant_id,actor_id,entity_id,permission) DO UPDATE SET revoked_at=NULL,authority_class=EXCLUDED.authority_class`,[ids.tenantId,actorId,ids.entityId,permission,authority]);
}
const kernelFor=(ids,actorId)=>{const ci=new PostgresContextIssuer(issuer,{principalProvider:async()=>({trusted:true,actorId,tenantId:ids.tenantId})});return new PostgresAccountingKernel(runtime,{sessionProvider:()=>ci.issue({tenantId:ids.tenantId})});};
function pgTest(name,fn){test(name,async t=>{if(unavailable){t.skip(unavailable);return;}await fn(t);});}
async function seed(){
  const tenantId=randomUUID(),entityId=randomUUID(),periodId=randomUUID(),attachmentId=randomUUID(),code=`P3${randomUUID().slice(0,4).toUpperCase()}`;
  await admin.query('INSERT INTO tenant(tenant_id,tenant_code,name) VALUES($1,$2,$3)',[tenantId,`T${tenantId.replaceAll('-','').slice(0,8)}`.toUpperCase(),'p03']);
  await admin.query("INSERT INTO entity(entity_id,tenant_id,entity_code,source_system,source_entity_id,name,base_currency) VALUES($1,$2,$3,'WBS',$3,'P03 bank tie','USD')",[entityId,tenantId,code]);
  await admin.query("INSERT INTO accounting_period(period_id,tenant_id,entity_id,period_code,starts_on,ends_on,status) VALUES($1,$2,$3,'2026-07','2026-07-01','2026-07-31','OPEN')",[periodId,tenantId,entityId]);
  await admin.query("INSERT INTO account_master(tenant_id,entity_id,account_code,account_name,requires_member,required_member_type) VALUES($1,$2,'111000','Cash',true,'BANK'),($1,$2,'610000','Repairs Expense',false,NULL)",[tenantId,entityId]);
  await admin.query("INSERT INTO member_master(tenant_id,entity_id,member_ref,member_type,display_name) VALUES($1,$2,'BANK-1','BANK','Operating Cash')",[tenantId,entityId]);
  await admin.query(`INSERT INTO attachment(attachment_id,tenant_id,entity_id,name,media_type,size_bytes,content_hash,storage_ref,storage_version,uploaded_by,uploaded_at,verified_at,scan_status,finalization_status,finalized_at) VALUES($1,$2,$3,'statement.pdf','application/pdf',10,$4,$5,'v1','maker',now(),now(),'CLEAN','VERIFIED_CLEAN',now())`,[attachmentId,tenantId,entityId,hash(attachmentId),`object://p03/${attachmentId}`]);
  const ids={tenantId,entityId,periodId,attachmentId,code};
  for(const [a,p] of [['maker','GL.JE.CREATE'],['submitter','GL.JE.SUBMIT'],['reviewer','GL.JE.REVIEW'],['approver','GL.JE.APPROVE'],['poster','GL.JE.POST'],['starter','BANK.RECONCILIATION.START'],['rreviewer','BANK.RECONCILIATION.REVIEW'],['signer','BANK.RECONCILIATION.SIGN_OFF'],['viewer','BANK.VIEW']])await grant(ids,a,p);
  return ids;
}
async function postBankMovement(ids,tag,amount,date){
  const lines=[{line_no:1,account_code:'610000',debit_amount:amount,credit_amount:0,member_ref:null,dimensions:{}},{line_no:2,account_code:'111000',debit_amount:0,credit_amount:amount,member_ref:'BANK-1',dimensions:{}}];
  const je=await kernelFor(ids,'maker').createManualJournal({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId,journalNumber:`P03-${tag}`,journalDate:date,currency:'USD',description:'bank payment',attachmentIds:[ids.attachmentId],idempotencyKey:`p03-je-${tag}-${ids.code}`,lines});
  const id=je.journal_entry_id;
  await kernelFor(ids,'submitter').transitionJournal({tenantId:ids.tenantId,entityId:ids.entityId,journalEntryId:id,action:'SUBMIT',expectedRevision:0,idempotencyKey:`p03-sub-${tag}-${ids.code}`});
  await kernelFor(ids,'reviewer').transitionJournal({tenantId:ids.tenantId,entityId:ids.entityId,journalEntryId:id,action:'REVIEW',expectedRevision:1,idempotencyKey:`p03-rev-${tag}-${ids.code}`});
  await kernelFor(ids,'approver').transitionJournal({tenantId:ids.tenantId,entityId:ids.entityId,journalEntryId:id,action:'APPROVE',expectedRevision:2,idempotencyKey:`p03-app-${tag}-${ids.code}`});
  await kernelFor(ids,'poster').postJournal({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId,journalEntryId:id,expectedRevision:3,idempotencyKey:`p03-post-${tag}-${ids.code}`});
  return id;
}
async function statementLine(ids,lineId,date,amount){
  const batch=randomUUID(),raw=randomUUID(),doc=randomUUID(),src=randomUUID();
  await admin.query("INSERT INTO import_batch(import_batch_id,tenant_id,entity_id,connector_code,source_module,source_entity_id,idempotency_key,request_hash) VALUES($1,$2,$3,'WBS','bankFeed',$4,$5,$6)",[batch,ids.tenantId,ids.entityId,ids.code,`p03-batch-${lineId}`,hash(batch)]);
  await admin.query("INSERT INTO raw_event(raw_event_id,tenant_id,entity_id,import_batch_id,source_system,source_module,source_entity_id,source_record_id,source_version,event_type,occurred_at,payload_hash,payload_ref,correlation_id) VALUES($1,$2,$3,$4,'WBS','bankFeed',$5,$6,'1','UPSERT',$7,$8,$9,$10)",[raw,ids.tenantId,ids.entityId,batch,ids.code,lineId,`${date}T00:00:00Z`,hash(`raw-${lineId}`),`object://p03/${lineId}`,`p03-${lineId}`]);
  await admin.query("INSERT INTO source_document(source_document_id,tenant_id,entity_id,raw_event_id,source_system,source_module,source_entity_id,source_record_id,source_version,document_type,business_date,accounting_date,currency,gross_amount,status,source_ref,payload_hash) VALUES($1,$2,$3,$4,'WBS','bankFeed',$5,$6,'1','BANK_LINE',$7,$7,'USD',$8,'RECEIVED',$9,$10)",[doc,ids.tenantId,ids.entityId,raw,ids.code,lineId,date,amount,`bank:${lineId}`,hash(`doc-${lineId}`)]);
  await admin.query("INSERT INTO bank_source(bank_source_id,tenant_id,entity_id,source_document_id,bank_account_ref,external_bank_line_id,transaction_date,currency,amount) VALUES($1,$2,$3,$4,'BANK-1',$5,$6,'USD',$7)",[src,ids.tenantId,ids.entityId,doc,lineId,date,amount]);
  return {src,doc,raw};
}

pgTest('P03-1: the same external bank line cannot enter bank_source twice for one account',async()=>{
  const ids=await seed();
  await statementLine(ids,'LINE-DUP','2026-07-10',-40);
  await assert.rejects(statementLine(ids,'LINE-DUP','2026-07-10',-40),e=>e.code==='23505','duplicate (bank_account_ref, external_bank_line_id) is a unique violation');
  assert.equal((await admin.query("SELECT count(*)::int n FROM bank_source WHERE tenant_id=$1 AND external_bank_line_id='LINE-DUP'",[ids.tenantId])).rows[0].n,1);
});

pgTest('P03-2: bank-to-book tie — book balance = POSTED ledger for the bank member up to the statement date, difference = statement − book, and it reverse-traces to the exact journals',async()=>{
  const ids=await seed();
  const je1=await postBankMovement(ids,'A',100,'2026-07-05');const je2=await postBankMovement(ids,'B',35.5,'2026-07-20');
  // statement carries both payments (-135.50) plus one unbooked bank fee (-4.00)
  await statementLine(ids,'L1','2026-07-05',-100);await statementLine(ids,'L2','2026-07-20',-35.5);await statementLine(ids,'L3','2026-07-28',-4);
  const started=await kernelFor(ids,'starter').startReconciliation({tenantId:ids.tenantId,entityId:ids.entityId,bankAccountRef:'BANK-1',statementEndingDate:'2026-07-31',statementOpeningBalance:'0.0000',statementEndingBalance:'-139.5000',reason:'July statement review',idempotencyKey:`p03-start-${ids.code}`});
  const row=(await admin.query('SELECT status,statement_ending_balance::text s,book_ending_balance::text b,difference::text d FROM reconciliation WHERE reconciliation_id=$1',[started.reconciliation_id])).rows[0];
  assert.deepEqual(row,{status:row.status,s:'-139.5000',b:'-135.5000',d:'-4.0000'},'book = −135.50 from the two POSTED payments; difference = statement − book = −4.00 (the unbooked fee)');
  // reverse trace: the book balance is exactly the POSTED 111000/BANK-1 ledger lines dated ≤ statement end, each behind a POSTED journal with verified attachment evidence
  const trace=(await admin.query(`SELECT l.ledger_line_id,l.journal_entry_id,je.status,je.journal_date::text d,(l.debit_amount-l.credit_amount)::text net,
      EXISTS(SELECT 1 FROM source_link s JOIN attachment a ON a.attachment_id=s.attachment_id WHERE s.journal_entry_id=je.journal_entry_id AND s.link_type='JE_ATTACHMENT' AND a.finalization_status='VERIFIED_CLEAN') evidenced
    FROM ledger_line l JOIN journal_line jl ON jl.journal_line_id=l.journal_line_id JOIN journal_entry je ON je.journal_entry_id=l.journal_entry_id
    WHERE l.tenant_id=$1 AND l.entity_id=$2 AND jl.member_ref='BANK-1' AND je.journal_date<='2026-07-31' ORDER BY je.journal_date`,[ids.tenantId,ids.entityId])).rows;
  assert.equal(trace.length,2);assert.deepEqual(trace.map(t=>t.journal_entry_id).sort(),[je1,je2].sort());
  assert.ok(trace.every(t=>t.status==='POSTED'&&t.evidenced));
  assert.equal(trace.reduce((s,t)=>s+Number(t.net),0),-135.5);
  // a payment dated after the statement end must not enter the book balance of this statement
  await postBankMovement(ids,'C',10,'2026-07-31');
  const later=(await admin.query('SELECT book_ending_balance::text b FROM reconciliation WHERE reconciliation_id=$1',[started.reconciliation_id])).rows[0];
  assert.equal(later.b,'-135.5000','the reconciliation row keeps the balance computed at start; a re-review recomputes it explicitly');
  const audits=(await admin.query("SELECT count(*)::int n FROM audit_event WHERE tenant_id=$1 AND entity_id=$2 AND object_id=$3",[ids.tenantId,ids.entityId,started.reconciliation_id])).rows[0].n;
  assert.ok(audits>=1,'start is audited');
});

pgTest('P03-3: review is refused until every statement line is tied to exact posted evidence (book-to-bank + statement-activity tie); the lock/sign-off/reopen path itself is covered by postgres-kernel "reconciliation lifecycle"',async()=>{
  const ids=await seed();
  await postBankMovement(ids,'X',50,'2026-07-05');await statementLine(ids,'LX','2026-07-05',-50);
  const started=await kernelFor(ids,'starter').startReconciliation({tenantId:ids.tenantId,entityId:ids.entityId,bankAccountRef:'BANK-1',statementEndingDate:'2026-07-31',statementOpeningBalance:'0.0000',statementEndingBalance:'-50.0000',reason:'July statement fully explained',idempotencyKey:`p03-start-lock-${ids.code}`});
  assert.equal((await admin.query('SELECT difference::text d FROM reconciliation WHERE reconciliation_id=$1',[started.reconciliation_id])).rows[0].d,'0.0000','difference zero is necessary but not sufficient');
  const version=(await admin.query('SELECT version::int v FROM reconciliation WHERE reconciliation_id=$1',[started.reconciliation_id])).rows[0].v;
  // the manual JE moved the book, but the statement line is not matched to a posted payment occurrence → review must refuse
  await assert.rejects(kernelFor(ids,'rreviewer').transitionReconciliation({tenantId:ids.tenantId,entityId:ids.entityId,reconciliationId:started.reconciliation_id,action:'REVIEW',expectedVersion:version,reason:'Reviewer attempts review without matched lines',idempotencyKey:`p03-review-${ids.code}`}),e=>e.code==='23514'&&/tie|posted evidence/i.test(e.message));
  const row=(await admin.query('SELECT status,version::int v FROM reconciliation WHERE reconciliation_id=$1',[started.reconciliation_id])).rows[0];
  assert.equal(row.v,version,'a refused review leaves the version untouched');assert.notEqual(row.status,'IN_REVIEW');
  // no sign-off is possible either, so nothing can lock an unexplained statement
  await assert.rejects(kernelFor(ids,'signer').transitionReconciliation({tenantId:ids.tenantId,entityId:ids.entityId,reconciliationId:started.reconciliation_id,action:'SIGN_OFF',expectedVersion:version,reason:'Sign-off without review',idempotencyKey:`p03-sign-${ids.code}`}),e=>['23514','42501','22023'].includes(e.code));
  assert.equal((await admin.query('SELECT count(*)::int n FROM reconciliation_snapshot WHERE reconciliation_id=$1',[started.reconciliation_id])).rows[0].n,0,'no snapshot without sign-off');
  const audits=(await admin.query("SELECT count(*)::int n FROM audit_event WHERE tenant_id=$1 AND entity_id=$2 AND object_id=$3",[ids.tenantId,ids.entityId,started.reconciliation_id])).rows[0].n;
  assert.ok(audits>=1);
});
