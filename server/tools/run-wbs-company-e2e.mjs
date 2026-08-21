import {createHash} from 'node:crypto';
import {createPool} from '../runtime/db.mjs';
import {PostgresAccountingKernel} from '../runtime/kernel-repository.mjs';
import {PostgresContextIssuer} from '../runtime/context-issuer.mjs';

const companyCode=(process.argv[2]||'WBPA').trim().toUpperCase();
if(!/^[A-Z0-9_-]{2,32}$/.test(companyCode))throw new Error('Company code is invalid');

const required=['DATABASE_URL','MIGRATION_DATABASE_URL','CONTEXT_ISSUER_DATABASE_URL'];
for(const key of required)if(!process.env[key])throw new Error(`${key} is required`);

const admin=await createPool({databaseUrl:process.env.MIGRATION_DATABASE_URL,applicationName:'refs-wbs-company-e2e-admin',max:2});
const runtime=await createPool({databaseUrl:process.env.DATABASE_URL,applicationName:'refs-wbs-company-e2e-runtime',max:4});
const issuerPool=await createPool({databaseUrl:process.env.CONTEXT_ISSUER_DATABASE_URL,applicationName:'refs-wbs-company-e2e-issuer',max:2});

const hex=value=>createHash('sha256').update(String(value)).digest('hex');
const sha=value=>`sha256:${hex(value)}`;
const uuid=value=>{const h=hex(value);return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;};
const tenantId=uuid('refs:wbs-h1:test-tenant');
const entityId=uuid(`refs:wbs-h1:entity:${companyCode}`);
const ids={tenantId,entityId};

async function session(actorId,permissions){
  for(const permission of permissions)await admin.query(`INSERT INTO runtime_actor_grant(tenant_id,actor_id,entity_id,permission)
    VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`,[tenantId,actorId,entityId,permission]);
  return new PostgresContextIssuer(issuerPool,{principalProvider:async()=>({trusted:true,actorId})}).issue({tenantId});
}
const kernel=(actor,permissions)=>new PostgresAccountingKernel(runtime,{sessionProvider:()=>session(actor,permissions)});

try{
  const candidate=(await admin.query(`SELECT wbs_uuid,company_code,business_id,long_id,type,amount,invoice_date,incurred_date,posting_date,
      vendor_no,project_code,cost_code,business_status,pay_status,review_status,journal_no
    FROM wbs_h1_import.ap_business
    WHERE company_code=$1 AND COALESCE(review_status,'')<>'Y'
      AND COALESCE(NULLIF(posting_date,''),NULLIF(invoice_date,''),NULLIF(incurred_date,'')) BETWEEN '2026-01-01' AND '2026-06-30'
      AND amount ~ '^-?[0-9]+(\\.[0-9]+)?$' AND amount::numeric<>0
    ORDER BY (NULLIF(cost_code,'') IS NOT NULL) DESC,(NULLIF(project_code,'') IS NOT NULL) DESC,
      COALESCE(NULLIF(posting_date,''),NULLIF(invoice_date,''),NULLIF(incurred_date,'')),wbs_uuid LIMIT 1`,[companyCode])).rows[0];
  if(!candidate)throw new Error(`No eligible H1 2026 WBS Payable row found for ${companyCode}`);
  const sourceDate=(candidate.posting_date||candidate.invoice_date||candidate.incurred_date).slice(0,10);
  const periodCode=sourceDate.slice(0,7);
  const periodId=uuid(`refs:wbs-h1:period:${companyCode}:${periodCode}`);
  const amount=Math.abs(Number(candidate.amount)).toFixed(4);
  const sourceIdentity={company_code:companyCode,wbs_uuid:candidate.wbs_uuid,business_id:candidate.business_id,long_id:candidate.long_id,
    type:candidate.type,accounting_date:sourceDate,amount:candidate.amount,vendor_no:candidate.vendor_no,project_code:candidate.project_code,
    cost_code:candidate.cost_code,business_status:candidate.business_status,pay_status:candidate.pay_status,review_status:candidate.review_status,
    journal_no:candidate.journal_no};
  const sourceRecordHash=sha(JSON.stringify(sourceIdentity));
  const providerContentHash=hex(JSON.stringify({dataset:'wbs_h1_import.ap_business',manifest:'wbs-h1-2026',source:sourceIdentity}));
  const mappings=(await admin.query(`SELECT stable_key,payload->>'id' setting_id,payload->>'journal_code' account_code,
      payload->>'account' account_name,payload->>'start_date' starts_at,payload->>'end_date' ends_at
    FROM wbs_h1_import.reference_row
    WHERE domain='accounting_setting' AND company_code=$1 AND payload->>'business_type'='4'
      AND payload->>'category'='Payable' AND payload->>'type'='Debit' AND payload->>'detail'=$2 AND payload->>'pj_code'=$1
      AND $3::timestamp BETWEEN (payload->>'start_date')::timestamp AND (payload->>'end_date')::timestamp`,
    [companyCode,candidate.cost_code,sourceDate])).rows;
  if(mappings.length!==1)throw new Error(`WBS Payable mapping is ${mappings.length===0?'missing':'ambiguous'} for the selected row`);
  const mapping=mappings[0];
  if(!/^[A-Z0-9][A-Z0-9._-]{1,31}$/i.test(mapping.account_code||'')||!mapping.account_name)throw new Error('WBS Payable mapping account is invalid');

  await admin.query('INSERT INTO tenant(tenant_id,tenant_code,name) VALUES($1,$2,$3) ON CONFLICT (tenant_id) DO NOTHING',
    [tenantId,'WBSH1TEST','WBS H1 2026 controlled test']);
  await admin.query(`INSERT INTO entity(entity_id,tenant_id,entity_code,source_system,source_entity_id,name,base_currency)
    VALUES($1,$2,$3,'WBS',$3,$3,'USD') ON CONFLICT (entity_id) DO NOTHING`,[entityId,tenantId,companyCode]);
  await admin.query(`INSERT INTO accounting_period(period_id,tenant_id,entity_id,period_code,starts_on,ends_on,status)
    VALUES($1,$2,$3,$4,($4||'-01')::date,(date_trunc('month',($4||'-01')::date)+interval '1 month'-interval '1 day')::date,'OPEN')
    ON CONFLICT (period_id) DO NOTHING`,[periodId,tenantId,entityId,periodCode]);
  await admin.query(`INSERT INTO account_master(tenant_id,entity_id,account_code,account_name,requires_member,required_member_type,active)
    VALUES($1,$2,'291001','Accounts Payable',true,'VENDOR',true)
    ON CONFLICT (tenant_id,entity_id,account_code) DO UPDATE SET account_name=EXCLUDED.account_name,requires_member=true,required_member_type='VENDOR',active=true`,[tenantId,entityId]);
  await admin.query(`INSERT INTO account_master(tenant_id,entity_id,account_code,account_name,requires_member,required_member_type,active)
    VALUES($1,$2,$3,$4,false,NULL,true)
    ON CONFLICT (tenant_id,entity_id,account_code) DO UPDATE SET account_name=EXCLUDED.account_name,active=true`,
    [tenantId,entityId,mapping.account_code,mapping.account_name]);

  const row={source_record_hash:sourceRecordHash,currency:'USD',accounting_date:sourceDate,amount,status:candidate.business_status||'UNREVIEWED'};
  const observationWithoutHash={schema_version:'WBS_LIVE_PILOT_OBSERVATION_V1',status:'NOT_ADMITTED',observation_mode:'UNSIGNED_PILOT',
    source_system:'WBS',tool:'list_payables',environment:'PRODUCTION',entity_id:entityId,captured_at:'2026-08-21T00:00:00.000Z',
    provider_content_sha256:providerContentHash,scope:{company_codes:[companyCode],date_range:['2026-01-01','2026-06-30']},
    record_count:1,rows:[row],signature_verified:false,can_import:false,can_create_transaction:false,can_match:false,can_allocate:false,
    can_create_draft:false,can_approve:false,can_post:false,can_reverse:false};
  const observation={...observationWithoutHash,observation_hash:sha(JSON.stringify(observationWithoutHash))};
  const key=`wbs-h1-${companyCode.toLowerCase()}-${sourceRecordHash.slice(7,23)}`;

  const maker=kernel('wbs-h1-maker',['WBS.TEST.IMPORT','AP.BILL.CREATE']);
  const submitter=kernel('wbs-h1-submitter',['GL.JE.SUBMIT']);
  const reviewer=kernel('wbs-h1-reviewer',['GL.JE.REVIEW']);
  const approver=kernel('wbs-h1-approver',['GL.JE.APPROVE']);
  const poster=kernel('wbs-h1-poster',['GL.JE.POST']);
  const importer=kernel('wbs-h1-importer',['WBS.TEST.IMPORT']);
  const reader=kernel('wbs-h1-reader',['GL.REPORT.VIEW','GL.JE.VIEW','AP.VIEW']);

  const prior=(await admin.query(`SELECT business_document_id,journal_entry_id,source_document_id,attachment_id
    FROM wbs_test_import_draft WHERE tenant_id=$1 AND entity_id=$2 AND source_record_hash=$3 ORDER BY created_at LIMIT 1`,
    [tenantId,entityId,sourceRecordHash])).rows[0];
  const draft=prior||await maker.createWbsTestPayableDraft({tenantId,entityId,periodId,observation,row,rowIndex:0,idempotencyKey:`${key}:draft:v2`});
  let journal=(await admin.query('SELECT status::text,revision FROM journal_entry WHERE tenant_id=$1 AND entity_id=$2 AND journal_entry_id=$3',[tenantId,entityId,draft.journal_entry_id])).rows[0];
  if(journal.status==='DRAFT')await submitter.transitionJournal({tenantId,entityId,journalEntryId:draft.journal_entry_id,action:'SUBMIT',expectedRevision:Number(journal.revision),idempotencyKey:`${key}:submit`});
  journal=(await admin.query('SELECT status::text,revision FROM journal_entry WHERE tenant_id=$1 AND entity_id=$2 AND journal_entry_id=$3',[tenantId,entityId,draft.journal_entry_id])).rows[0];
  if(journal.status==='PENDING_REVIEW')await reviewer.transitionJournal({tenantId,entityId,journalEntryId:draft.journal_entry_id,action:'REVIEW',expectedRevision:Number(journal.revision),idempotencyKey:`${key}:review`});
  journal=(await admin.query('SELECT status::text,revision FROM journal_entry WHERE tenant_id=$1 AND entity_id=$2 AND journal_entry_id=$3',[tenantId,entityId,draft.journal_entry_id])).rows[0];
  if(journal.status==='PENDING_APPROVAL')await approver.transitionJournal({tenantId,entityId,journalEntryId:draft.journal_entry_id,action:'APPROVE',expectedRevision:Number(journal.revision),idempotencyKey:`${key}:approve`});
  journal=(await admin.query('SELECT status::text,revision FROM journal_entry WHERE tenant_id=$1 AND entity_id=$2 AND journal_entry_id=$3',[tenantId,entityId,draft.journal_entry_id])).rows[0];
  if(journal.status==='APPROVED')await poster.postJournal({tenantId,entityId,periodId,journalEntryId:draft.journal_entry_id,expectedRevision:Number(journal.revision),idempotencyKey:`${key}:post`});
  const sourceStatus=(await admin.query('SELECT status::text FROM source_document WHERE tenant_id=$1 AND entity_id=$2 AND source_document_id=$3',[tenantId,entityId,draft.source_document_id])).rows[0]?.status;
  if(sourceStatus==='READY_FOR_DRAFT')await importer.finalizeWbsTestImportSource({tenantId,entityId,sourceDocumentId:draft.source_document_id,
    businessDocumentId:draft.business_document_id,journalEntryId:draft.journal_entry_id,idempotencyKey:`${key}:finalize`});

  const reclassMaker=kernel('wbs-h1-mapping-maker',['GL.JE.CREATE']);
  const reclass=await reclassMaker.createManualJournal({tenantId,entityId,periodId,journalNumber:`WBS-MAP-${sourceRecordHash.slice(7,19).toUpperCase()}`,
    journalDate:sourceDate,currency:'USD',description:`Apply approved WBS Payable setting ${mapping.setting_id}`,
    attachmentIds:[draft.attachment_id],idempotencyKey:`${key}:mapping-reclass`,lines:[
      {line_no:1,account_code:mapping.account_code,debit_amount:Number(amount),credit_amount:0,member_ref:null,
        description:`WBS setting ${mapping.setting_id}: ${mapping.account_name}`,dimensions:{project_ref:candidate.project_code||null,cost_code_ref:candidate.cost_code||null}},
      {line_no:2,account_code:'610000',debit_amount:0,credit_amount:Number(amount),member_ref:null,
        description:'Reverse controlled-import placeholder expense',dimensions:{project_ref:candidate.project_code||null,cost_code_ref:candidate.cost_code||null}}
    ]});
  let reclassState=(await admin.query('SELECT status::text,revision FROM journal_entry WHERE tenant_id=$1 AND entity_id=$2 AND journal_entry_id=$3',[tenantId,entityId,reclass.journal_entry_id])).rows[0];
  if(reclassState.status==='DRAFT')await submitter.transitionJournal({tenantId,entityId,journalEntryId:reclass.journal_entry_id,action:'SUBMIT',expectedRevision:Number(reclassState.revision),idempotencyKey:`${key}:mapping-submit`});
  reclassState=(await admin.query('SELECT status::text,revision FROM journal_entry WHERE tenant_id=$1 AND entity_id=$2 AND journal_entry_id=$3',[tenantId,entityId,reclass.journal_entry_id])).rows[0];
  if(reclassState.status==='PENDING_REVIEW')await reviewer.transitionJournal({tenantId,entityId,journalEntryId:reclass.journal_entry_id,action:'REVIEW',expectedRevision:Number(reclassState.revision),idempotencyKey:`${key}:mapping-review`});
  reclassState=(await admin.query('SELECT status::text,revision FROM journal_entry WHERE tenant_id=$1 AND entity_id=$2 AND journal_entry_id=$3',[tenantId,entityId,reclass.journal_entry_id])).rows[0];
  if(reclassState.status==='PENDING_APPROVAL')await approver.transitionJournal({tenantId,entityId,journalEntryId:reclass.journal_entry_id,action:'APPROVE',expectedRevision:Number(reclassState.revision),idempotencyKey:`${key}:mapping-approve`});
  reclassState=(await admin.query('SELECT status::text,revision FROM journal_entry WHERE tenant_id=$1 AND entity_id=$2 AND journal_entry_id=$3',[tenantId,entityId,reclass.journal_entry_id])).rows[0];
  if(reclassState.status==='APPROVED')await poster.postJournal({tenantId,entityId,periodId,journalEntryId:reclass.journal_entry_id,expectedRevision:Number(reclassState.revision),idempotencyKey:`${key}:mapping-post`});
  await admin.query(`INSERT INTO source_link(tenant_id,entity_id,link_type,source_document_id,journal_entry_id,created_by)
    VALUES($1,$2,'SOURCE_TO_JE',$3,$4,'wbs-h1-mapping-maker') ON CONFLICT DO NOTHING`,[tenantId,entityId,draft.source_document_id,reclass.journal_entry_id]);

  const ledger=await reader.listGeneralLedger({tenantId,entityId,periodId,accountCode:null,query:null,limit:50,offset:0});
  const statements=await reader.getFinancialStatements({tenantId,entityId,periodId});
  const exactLedger=ledger.filter(item=>[draft.journal_entry_id,reclass.journal_entry_id].includes(item.journal_entry_id));
  const trialBalance=statements.filter(item=>item.statement_type==='TRIAL_BALANCE'&&[mapping.account_code,'291001'].includes(item.account_code));
  const incomeStatement=statements.filter(item=>item.statement_type==='INCOME_STATEMENT'&&item.account_code===mapping.account_code);
  const balanceSheet=statements.filter(item=>item.statement_type==='BALANCE_SHEET'&&item.account_code==='291001');

  await admin.query(`CREATE TABLE IF NOT EXISTS wbs_h1_import.e2e_run(
    company_code text NOT NULL,source_record_hash text NOT NULL,source_date date NOT NULL,amount numeric(20,4) NOT NULL,
    project_present boolean NOT NULL,cost_code_present boolean NOT NULL,period_code text NOT NULL,refs_entity_id uuid NOT NULL,
    source_document_id uuid NOT NULL,journal_entry_id uuid NOT NULL,journal_status text NOT NULL,ledger_line_count integer NOT NULL,
    trial_balance_ready boolean NOT NULL,income_statement_ready boolean NOT NULL,balance_sheet_ready boolean NOT NULL,
    provenance_mode text NOT NULL,completed_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(company_code,source_record_hash))`);
  await admin.query(`ALTER TABLE wbs_h1_import.e2e_run ADD COLUMN IF NOT EXISTS wbs_setting_id text,
    ADD COLUMN IF NOT EXISTS mapped_account_code text,ADD COLUMN IF NOT EXISTS mapped_account_name text,
    ADD COLUMN IF NOT EXISTS reclass_journal_entry_id uuid`);
  await admin.query(`INSERT INTO wbs_h1_import.e2e_run(company_code,source_record_hash,source_date,amount,project_present,cost_code_present,
      period_code,refs_entity_id,source_document_id,journal_entry_id,journal_status,ledger_line_count,trial_balance_ready,income_statement_ready,balance_sheet_ready,provenance_mode)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'POSTED',$11,$12,$13,$14,'UNSIGNED_TEST_ONLY')
    ON CONFLICT(company_code,source_record_hash) DO UPDATE SET journal_status='POSTED',ledger_line_count=EXCLUDED.ledger_line_count,
      trial_balance_ready=EXCLUDED.trial_balance_ready,income_statement_ready=EXCLUDED.income_statement_ready,
      balance_sheet_ready=EXCLUDED.balance_sheet_ready,completed_at=now()`,[companyCode,sourceRecordHash,sourceDate,amount,
      Boolean(candidate.project_code),Boolean(candidate.cost_code),periodCode,entityId,draft.source_document_id,draft.journal_entry_id,exactLedger.length,
      trialBalance.length===2,incomeStatement.length===1,balanceSheet.length===1]);
  await admin.query(`UPDATE wbs_h1_import.e2e_run SET wbs_setting_id=$3,mapped_account_code=$4,mapped_account_name=$5,
    reclass_journal_entry_id=$6 WHERE company_code=$1 AND source_record_hash=$2`,
    [companyCode,sourceRecordHash,mapping.setting_id,mapping.account_code,mapping.account_name,reclass.journal_entry_id]);

  console.log(JSON.stringify({status:'COMPLETE',company_code:companyCode,source_scope:'REAL_WBS_H1_2026',provenance_mode:'UNSIGNED_TEST_ONLY',
    source_record_hash:sourceRecordHash,accounting_date:sourceDate,amount,period_code:periodCode,project_present:Boolean(candidate.project_code),
    cost_code_present:Boolean(candidate.cost_code),wbs_mapping:{setting_id:mapping.setting_id,account_code:mapping.account_code,
      account_name:mapping.account_name,effective_from:mapping.starts_at.slice(0,10),effective_to:mapping.ends_at.slice(0,10)},
    workflow:['DRAFT','PENDING_REVIEW','PENDING_APPROVAL','APPROVED','POSTED'],
    journal_entry_id:draft.journal_entry_id,source_document_id:draft.source_document_id,ledger_lines:exactLedger.map(line=>({account_code:line.account_code,
      debit_amount:line.debit_amount,credit_amount:line.credit_amount,currency:line.currency})),reports:{trial_balance:trialBalance.length===2,
      income_statement:incomeStatement.length===1,balance_sheet:balanceSheet.length===1}},null,2));
}finally{
  await Promise.allSettled([admin.end(),runtime.end(),issuerPool.end()]);
}
