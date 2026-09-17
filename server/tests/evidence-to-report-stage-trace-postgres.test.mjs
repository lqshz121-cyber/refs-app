// H06: real-data reverse trace, staged. One entity walks the whole evidence
// chain against the production SQL on live PostgreSQL:
//
//   stage 0  nothing imported            -> evidence NO_EVIDENCE_IMPORTED, statements cite no ledger lines
//   stage 1  raw_event -> source_document -> staging_item -> DRAFT journal (SOURCE_TO_JE)
//                                         -> evidence EVIDENCE_WITHOUT_POSTINGS, statements STILL cite nothing
//                                            (a Draft must never read as a formal balance)
//   stage 2  approved journal posted through the kernel
//                                         -> evidence POSTED_EVIDENCE, and from each Trial Balance row:
//                                            ledger_line -> journal_entry(POSTED) -> source_link -> source_document
//                                            -> raw_event, with the amount re-derived from the fixture's own
//                                            randomised gross_amount, never from a canned sample.
//
// The fixture amount is random per run so the assertions cannot pass on a
// hard-coded example; every expected figure is computed from what was inserted.
import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID, createHash, randomInt} from 'node:crypto';
import {createPool} from '../runtime/db.mjs';
import {runtimeConfig} from '../runtime/config.mjs';
import {migrateUp} from '../runtime/migrations.mjs';
import {PostgresAccountingKernel} from '../runtime/kernel-repository.mjs';
import {PostgresContextIssuer} from '../runtime/context-issuer.mjs';

const config=runtimeConfig();
let admin=null,runtime=null,issuer=null,unavailable=null;
const sha=v=>`sha256:${createHash('sha256').update(String(v)).digest('hex')}`;
before(async()=>{try{
  admin=await createPool({databaseUrl:config.migrationDatabaseUrl,applicationName:'refs-h06-admin',max:2});await admin.query('SELECT 1');await migrateUp(admin,{});
  runtime=await createPool({databaseUrl:config.databaseUrl,applicationName:'refs-h06-runtime',max:4});await runtime.query('SELECT 1');
  issuer=await createPool({databaseUrl:config.contextIssuerDatabaseUrl,applicationName:'refs-h06-issuer',max:2});await issuer.query('SELECT 1');
}catch(error){unavailable=`POSTGRES NOT RUN: ${error.code||error.name}: ${error.message}`;if(config.requirePostgres)throw error;for(const p of [admin,runtime,issuer])if(p)await p.end().catch(()=>{});admin=runtime=issuer=null;}});
after(async()=>{for(const p of [admin,runtime,issuer])if(p)await p.end();});

async function grant(ids,actorId,permission){
  const authority=(await admin.query('SELECT authority_class FROM runtime_human_permission_authority WHERE permission_code=$1',[permission])).rows[0]?.authority_class||'ANALYSIS';
  await admin.query(`INSERT INTO runtime_actor_grant(tenant_id,actor_id,entity_id,permission,authority_class,valid_until) VALUES($1,$2,$3,$4,$5,clock_timestamp()+interval '1 hour') ON CONFLICT(tenant_id,actor_id,entity_id,permission) DO UPDATE SET revoked_at=NULL`,[ids.tenantId,actorId,ids.entityId,permission,authority]);
}
const kernelFor=(ids,actorId)=>{const ci=new PostgresContextIssuer(issuer,{principalProvider:async()=>({trusted:true,actorId,tenantId:ids.tenantId})});return new PostgresAccountingKernel(runtime,{sessionProvider:()=>ci.issue({tenantId:ids.tenantId})});};
function pgTest(name,fn){test(name,async t=>{if(unavailable){t.skip(unavailable);return;}await fn(t);});}

async function seedEntity(){
  const tenantId=randomUUID(),entityId=randomUUID(),periodId=randomUUID(),code=`H06${randomUUID().slice(0,4).toUpperCase()}`;
  await admin.query('INSERT INTO tenant(tenant_id,tenant_code,name) VALUES($1,$2,$3)',[tenantId,`T${tenantId.replaceAll('-','').slice(0,8)}`.toUpperCase(),'h06 tenant']);
  await admin.query("INSERT INTO entity(entity_id,tenant_id,entity_code,source_system,source_entity_id,name,base_currency) VALUES($1,$2,$3,'WBS',$3,'H06 trace entity','USD')",[entityId,tenantId,code]);
  await admin.query("INSERT INTO accounting_period(period_id,tenant_id,entity_id,period_code,starts_on,ends_on,status) VALUES($1,$2,$3,'2026-07','2026-07-01','2026-07-31','OPEN')",[periodId,tenantId,entityId]);
  await admin.query("INSERT INTO account_master(tenant_id,entity_id,account_code,account_name,requires_member,required_member_type) VALUES($1,$2,'291001','Accounts Payable',true,'VENDOR'),($1,$2,'610000','Repairs Expense',false,NULL)",[tenantId,entityId]);
  await admin.query("INSERT INTO member_master(tenant_id,entity_id,member_ref,member_type,display_name) VALUES($1,$2,'VENDOR-1','VENDOR','Vendor')",[tenantId,entityId]);
  const ids={tenantId,entityId,periodId,code};
  await grant(ids,'h06-reader','GL.REPORT.VIEW');await grant(ids,'h06-reader','GL.JE.VIEW');await grant(ids,'h06-poster','GL.JE.POST');
  return ids;
}
const statementsCiteNothing=rows=>rows.every(r=>(!Array.isArray(r.ledger_line_ids)||r.ledger_line_ids.length===0)&&Number(r.display_balance||0)===0);

async function importDraft(ids){
  // randomised amount: 12.34 .. 987,654.32, never a round sample figure
  const cents=randomInt(1234,98765432);const amount=(cents/100).toFixed(2);
  const batch=randomUUID(),raw=randomUUID(),doc=randomUUID(),journalId=randomUUID(),attachmentId=randomUUID();
  const recordId=`AP-${randomUUID().slice(0,8)}`,payloadHash=sha(`payload:${recordId}:${amount}`);
  await admin.query("INSERT INTO import_batch(import_batch_id,tenant_id,entity_id,connector_code,source_module,source_entity_id,idempotency_key,request_hash) VALUES($1,$2,$3,'WBS','payable',$4,$5,$6)",[batch,ids.tenantId,ids.entityId,ids.code,`h06-batch-${batch.slice(0,8)}`,sha(batch)]);
  await admin.query("INSERT INTO raw_event(raw_event_id,tenant_id,entity_id,import_batch_id,source_system,source_module,source_entity_id,source_record_id,source_version,event_type,occurred_at,payload_hash,payload_ref,correlation_id) VALUES($1,$2,$3,$4,'WBS','payable',$5,$6,'1','UPSERT','2026-07-15T12:00:00Z',$7,$8,$9)",[raw,ids.tenantId,ids.entityId,batch,ids.code,recordId,payloadHash,`object://h06/${recordId}`,`h06-${recordId}`]);
  await admin.query("INSERT INTO source_document(source_document_id,tenant_id,entity_id,raw_event_id,source_system,source_module,source_entity_id,source_record_id,source_version,document_type,document_no,business_date,accounting_date,currency,gross_amount,status,source_ref,payload_hash) VALUES($1,$2,$3,$4,'WBS','payable',$5,$6,'1','PAYABLE',$6,'2026-07-15','2026-07-15','USD',$7,'PENDING_CODING',$8,$9)",[doc,ids.tenantId,ids.entityId,raw,ids.code,recordId,amount,`wbs:${recordId}`,sha(`doc:${recordId}`)]);
  const staging=(await admin.query("INSERT INTO staging_item(tenant_id,entity_id,source_document_id,status) VALUES($1,$2,$3,'PENDING_CODING') RETURNING staging_item_id",[ids.tenantId,ids.entityId,doc])).rows[0].staging_item_id;
  await admin.query("INSERT INTO journal_entry(journal_entry_id,tenant_id,entity_id,period_id,journal_number,journal_type,status,journal_date,currency,description,created_by) VALUES($1,$2,$3,$4,$5,'MANUAL','DRAFT','2026-07-15','USD','WBS payable draft','h06-maker')",[journalId,ids.tenantId,ids.entityId,ids.periodId,`JE-${recordId}`]);
  await admin.query("INSERT INTO journal_line(tenant_id,entity_id,period_id,journal_entry_id,line_no,account_code,debit_amount,credit_amount,member_ref,dimensions) VALUES($1,$2,$3,$4,1,'610000',$5,0,NULL,'{}'::jsonb),($1,$2,$3,$4,2,'291001',0,$5,'VENDOR-1','{}'::jsonb)",[ids.tenantId,ids.entityId,ids.periodId,journalId,amount]);
  await admin.query("INSERT INTO source_link(tenant_id,entity_id,link_type,source_document_id,staging_item_id,journal_entry_id,created_by) VALUES($1,$2,'SOURCE_TO_JE',$3,$4,$5,'h06-maker')",[ids.tenantId,ids.entityId,doc,staging,journalId]);
  await admin.query("INSERT INTO attachment(attachment_id,tenant_id,entity_id,name,media_type,size_bytes,content_hash,storage_ref,storage_version,uploaded_by,uploaded_at,verified_at,scan_status,finalization_status,finalized_at) VALUES($1,$2,$3,'invoice.pdf','application/pdf',10,$4,$5,'v1','h06-maker',now(),now(),'CLEAN','VERIFIED_CLEAN',now())",[attachmentId,ids.tenantId,ids.entityId,sha(`att:${recordId}`),`object://h06/att/${recordId}`]);
  await admin.query("INSERT INTO source_link(tenant_id,entity_id,link_type,journal_entry_id,attachment_id,created_by) VALUES($1,$2,'JE_ATTACHMENT',$3,$4,'h06-maker')",[ids.tenantId,ids.entityId,journalId,attachmentId]);
  return {amount,raw,doc,staging,journalId,recordId,payloadHash};
}

pgTest('stage 0: an entity with nothing imported is NO_EVIDENCE_IMPORTED and its statements cite no ledger line',async()=>{
  const ids=await seedEntity();const reader=kernelFor(ids,'h06-reader');
  const evidence=await reader.readEntityEvidenceSummary(ids);
  assert.equal(evidence.evidence_state,'NO_EVIDENCE_IMPORTED');
  assert.deepEqual([evidence.journal_count,evidence.posted_journal_count,evidence.raw_event_count,evidence.staging_item_count,evidence.source_document_count],[0,0,0,0,0]);
  const rows=await reader.getFinancialStatements(ids);
  assert.ok(statementsCiteNothing(rows),'statements must not show any figure when nothing was imported');
});

pgTest('stage 1: raw -> source document -> staging -> DRAFT journal is EVIDENCE_WITHOUT_POSTINGS and still contributes nothing to any statement or the General Ledger',async()=>{
  const ids=await seedEntity();const reader=kernelFor(ids,'h06-reader');
  const fx=await importDraft(ids);
  const evidence=await reader.readEntityEvidenceSummary(ids);
  assert.equal(evidence.evidence_state,'EVIDENCE_WITHOUT_POSTINGS');
  assert.deepEqual([evidence.journal_count,evidence.posted_journal_count,evidence.raw_event_count,evidence.staging_item_count,evidence.source_document_count],[1,0,1,1,1]);
  assert.ok(evidence.last_raw_event_at!==null);
  const rows=await reader.getFinancialStatements(ids);
  assert.ok(statementsCiteNothing(rows),`a DRAFT journal of ${fx.amount} leaked into the statements`);
  const gl=await reader.listGeneralLedger({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId,limit:50});
  const glRows=Array.isArray(gl)?gl:(gl.rows||gl.entries||[]);
  assert.equal(glRows.length,0,'the General Ledger must not list draft lines');
  assert.equal((await admin.query('SELECT count(*)::int n FROM ledger_line WHERE tenant_id=$1 AND entity_id=$2',[ids.tenantId,ids.entityId])).rows[0].n,0);
});

pgTest('stage 2: once posted through the kernel, every statement row re-derives from ledger lines and traces back to the exact raw WBS event and amount',async()=>{
  const ids=await seedEntity();const reader=kernelFor(ids,'h06-reader');
  const fx=await importDraft(ids);
  // approval is a fixture step here (review/approve are covered by journal-lifecycle-contract-postgres); posting is the real kernel command
  await admin.query('ALTER TABLE journal_entry DISABLE TRIGGER USER');
  try{await admin.query("UPDATE journal_entry SET status='APPROVED',reviewed_by='h06-reviewer',approved_by='h06-approver' WHERE journal_entry_id=$1",[fx.journalId]);}finally{await admin.query('ALTER TABLE journal_entry ENABLE TRIGGER USER');}
  const revision=(await admin.query('SELECT revision FROM journal_entry WHERE journal_entry_id=$1',[fx.journalId])).rows[0].revision;
  await kernelFor(ids,'h06-poster').postJournal({...ids,journalEntryId:fx.journalId,expectedRevision:Number(revision),idempotencyKey:`h06-post-${fx.journalId}`});
  const evidence=await reader.readEntityEvidenceSummary(ids);
  assert.equal(evidence.evidence_state,'POSTED_EVIDENCE');assert.equal(evidence.posted_journal_count,1);
  const rows=await reader.getFinancialStatements(ids);
  const tb=rows.filter(r=>r.statement_type==='TRIAL_BALANCE');
  assert.equal(tb.length,2,'two accounts were touched');
  const expected={'610000':Number(fx.amount),'291001':-Number(fx.amount)};
  for(const row of tb){
    assert.equal(Number(row.display_balance),expected[row.account_code],`${row.account_code} balance must equal the fixture amount ${fx.amount}`);
    const sum=(await admin.query('SELECT coalesce(sum(debit_amount),0)::text d,coalesce(sum(credit_amount),0)::text c,count(*)::int n FROM ledger_line WHERE tenant_id=$1 AND entity_id=$2 AND ledger_line_id=ANY($3::uuid[])',[ids.tenantId,ids.entityId,row.ledger_line_ids])).rows[0];
    assert.equal(sum.n,row.ledger_line_ids.length);assert.equal(Number(sum.d)-Number(sum.c),Number(row.display_balance));
    const chain=(await admin.query(`SELECT j.journal_entry_id,j.status,sd.source_document_id,sd.gross_amount::text gross_amount,sd.source_record_id,re.raw_event_id,re.payload_hash,re.source_system,re.source_entity_id,si.staging_item_id
      FROM ledger_line l JOIN journal_entry j ON j.journal_entry_id=l.journal_entry_id
      JOIN source_link s ON s.journal_entry_id=j.journal_entry_id AND s.link_type='SOURCE_TO_JE'
      JOIN source_document sd ON sd.source_document_id=s.source_document_id
      JOIN staging_item si ON si.staging_item_id=s.staging_item_id
      JOIN raw_event re ON re.raw_event_id=sd.raw_event_id
      WHERE l.ledger_line_id=ANY($1::uuid[])`,[row.ledger_line_ids])).rows;
    assert.ok(chain.length>=1,`${row.account_code}: no SOURCE_TO_JE chain behind the cited ledger lines`);
    for(const hop of chain){
      assert.equal(hop.status,'POSTED');assert.equal(hop.journal_entry_id,fx.journalId);
      assert.equal(hop.source_document_id,fx.doc);assert.equal(hop.staging_item_id,fx.staging);assert.equal(hop.raw_event_id,fx.raw);
      assert.equal(Number(hop.gross_amount),Number(fx.amount),'source document amount must equal the posted figure');
      assert.equal(hop.source_record_id,fx.recordId);assert.equal(hop.payload_hash,fx.payloadHash);
      assert.equal(hop.source_system,'WBS');assert.equal(hop.source_entity_id,ids.code);
    }
  }
  assert.equal(tb.reduce((s,r)=>s+Number(r.display_balance),0),0);
  const gl=await reader.listGeneralLedger({tenantId:ids.tenantId,entityId:ids.entityId,periodId:ids.periodId,limit:50});
  const glRows=Array.isArray(gl)?gl:(gl.rows||gl.entries||[]);
  const cited=new Set(tb.flatMap(r=>r.ledger_line_ids));
  assert.ok(glRows.length>0&&glRows.every(r=>cited.has(r.ledger_line_id)),'the General Ledger must list exactly the lines the statements cite');
});
