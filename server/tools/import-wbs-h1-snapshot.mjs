#!/usr/bin/env node
import {createReadStream,readFileSync} from 'node:fs';
import {createInterface} from 'node:readline';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createSnapshotIntegrityProbe,resolveSnapshotEntryPath} from '../runtime/wbs-h1-snapshot-manifest.mjs';

export async function initializeSnapshotImportSchema(client){
await client.query(`
CREATE SCHEMA IF NOT EXISTS wbs_h1_import;
CREATE TABLE IF NOT EXISTS wbs_h1_import.snapshot_file(
  path text PRIMARY KEY,domain text NOT NULL,company_code text,period_code text,
  row_count bigint NOT NULL,byte_count bigint NOT NULL,sha256 text NOT NULL,
  imported_row_count bigint NOT NULL DEFAULT 0,imported_at timestamptz
);
CREATE TABLE IF NOT EXISTS wbs_h1_import.accounting_line(
  wbs_id bigint PRIMARY KEY,company_code text,set_date text,posting_date text,business_guid text,
  cb_id text,sys_id text,detail_type text,sort_no text,group_sort text,cost_type text,monthly_type text,
  account text,account_code text,accounting_code text,cost_code text,project text,project_code text,
  amount text,accounting_value text,accounting_type text,description text,payee text,payee_no text,
  bill_no text,unit text,unit_guid text,source text,journal_no text,review text,approve_status text,
  closed text,pay_status text
);
ALTER TABLE wbs_h1_import.accounting_line ADD COLUMN IF NOT EXISTS cb_id text;
ALTER TABLE wbs_h1_import.accounting_line ADD COLUMN IF NOT EXISTS sys_id text;
ALTER TABLE wbs_h1_import.accounting_line ADD COLUMN IF NOT EXISTS detail_type text;
ALTER TABLE wbs_h1_import.accounting_line ADD COLUMN IF NOT EXISTS sort_no text;
ALTER TABLE wbs_h1_import.accounting_line ADD COLUMN IF NOT EXISTS group_sort text;
ALTER TABLE wbs_h1_import.accounting_line ADD COLUMN IF NOT EXISTS cost_type text;
ALTER TABLE wbs_h1_import.accounting_line ADD COLUMN IF NOT EXISTS monthly_type text;
CREATE INDEX IF NOT EXISTS wbs_h1_accounting_company_date ON wbs_h1_import.accounting_line(company_code,set_date);
CREATE INDEX IF NOT EXISTS wbs_h1_accounting_business ON wbs_h1_import.accounting_line(business_guid);
CREATE TABLE IF NOT EXISTS wbs_h1_import.ap_business(
  wbs_uuid text PRIMARY KEY,company_code text,business_id text,long_id text,type text,amount text,
  invoice_no text,invoice_date text,incurred_date text,posting_date text,due_date text,vendor_no text,
  vendor text,project_code text,project_name text,cost_code text,cost_name text,unit_code text,
  business_status text,pay_status text,review_status text,journal_no text,description text
);
CREATE INDEX IF NOT EXISTS wbs_h1_ap_company_date ON wbs_h1_import.ap_business(company_code,posting_date);
CREATE TABLE IF NOT EXISTS wbs_h1_import.ar_aging(
  wbs_id bigint PRIMARY KEY,snapshot_period text,snapshot_date text,company_code text,project_code text,
  customer_no text,customer_name text,vendor_no text,vendor text,invoice_no text,invoice_date text,
  due_date text,amount text,paid_amount text,balance text,days_overdue text,aging_bucket text,
  bucket_amount text,cost_code text,unit_code text,pay_status text
);
CREATE INDEX IF NOT EXISTS wbs_h1_ar_company_period ON wbs_h1_import.ar_aging(company_code,snapshot_period);
CREATE TABLE IF NOT EXISTS wbs_h1_import.invoice_detail(
  wbs_id bigint PRIMARY KEY,parent_wbs_id text,invoice_id text,invoice_no text,invoice_date text,
  invoice_amount text,invoice_total_amount text,activity_no text,activity_description text,
  description text,check_no text,check_date text,clear_date text,po_no text
);
CREATE TABLE IF NOT EXISTS wbs_h1_import.reference_row(
  domain text NOT NULL,stable_key text NOT NULL,company_code text,payload jsonb NOT NULL,
  PRIMARY KEY(domain,stable_key)
);
`);

}

const specifications={
  accounting_info:{table:'accounting_line',columns:['wbs_id','company_code','set_date','posting_date','business_guid','cb_id','sys_id','detail_type','sort_no','group_sort','cost_type','monthly_type','account','account_code','accounting_code','cost_code','project','project_code','amount','accounting_value','accounting_type','description','payee','payee_no','bill_no','unit','unit_guid','source','journal_no','review','approve_status','closed','pay_status'],map:r=>[r.id,r.com_code,r.set_date,r.posting_date,r.business_guid,r.cb_id,r.sys_id,r.detail_type,r.sort,r.group_sort,r.cost_type,r.monthly_type,r.account,r.account_code,r.accounting_code,r.cost_code,r.project,r.pj_code,r.amount,r.accounting_value,r.accounting_type,r.description,r.payee,r.payee_no,r.bill_no,r.unit,r.unit_guid,r.source,r.journal_no,r.review,r.approve_status,r.closed,r.pay_status]},
  ap_business:{table:'ap_business',columns:['wbs_uuid','company_code','business_id','long_id','type','amount','invoice_no','invoice_date','incurred_date','posting_date','due_date','vendor_no','vendor','project_code','project_name','cost_code','cost_name','unit_code','business_status','pay_status','review_status','journal_no','description'],map:r=>[r.uuid,r.company_code,r.business_id,r.long_id,r.type,r.amount,r.invoice_no,r.invoice_date,r.incurred_date,r.posting_date,r.pay_due_date,r.vendor_no,r.vendor,r.project_code,r.project_name,r.cost_code,r.cost_name,r.unit_code,r.business_status,r.pay_status,r.review_status,r.journal_no,r.description]},
  ar_aging:{table:'ar_aging',columns:['wbs_id','snapshot_period','snapshot_date','company_code','project_code','customer_no','customer_name','vendor_no','vendor','invoice_no','invoice_date','due_date','amount','paid_amount','balance','days_overdue','aging_bucket','bucket_amount','cost_code','unit_code','pay_status'],map:r=>[r.id,r.snapshot_period,r.snapshot_date,r.com_code,r.pj_code,r.customer_no,r.customer_name,r.vendor_no,r.vendor,r.invoice_no,r.invoice_date,r.pay_due_date,r.amount,r.paid_amount,r.ar_balance,r.days_overdue,r.aging_bucket,r.bucket_amount,r.cost_code,r.unit_code,r.pay_status]},
  invoice_details:{table:'invoice_detail',columns:['wbs_id','parent_wbs_id','invoice_id','invoice_no','invoice_date','invoice_amount','invoice_total_amount','activity_no','activity_description','description','check_no','check_date','clear_date','po_no'],map:r=>[r.id,r.wbs_id,r.invoice_id,r.invoice_no,r.invoice_date,r.invoice_amt,r.invoice_tot_amt,r.activity_no,r.activity_desc,r.description,r.check_no,r.check_date,r.clear_date,r.fs_po_no]},
};
const referenceDomains=new Set(['accounting_setting','accounting_monthly_setting','costcode_account_relation','corpmastersub','mdm_company','mdm_entity','mdm_project','mdm_cost_code','mdm_account_book']);
const text=value=>value===null||value===undefined?null:String(value).replaceAll('\u0000','');
const closedJson=value=>JSON.parse(JSON.stringify(value).replace(/\\u0000/g,''));

async function insertBatch(client,domain,rows){
  const spec=specifications[domain];
  if(spec){
    const payload=rows.map(row=>Object.fromEntries(spec.columns.map((column,index)=>[column,text(spec.map(row)[index])])));
    const declaration=spec.columns.map(column=>`"${column}" text`).join(',');
    const select=spec.columns.map(column=>column==='wbs_id'?`NULLIF(x."${column}",'')::bigint`:`x."${column}"`).join(',');
    const updates=spec.columns.slice(1).map(column=>`"${column}"=EXCLUDED."${column}"`).join(',');
    await client.query(`INSERT INTO wbs_h1_import.${spec.table}(${spec.columns.map(x=>`"${x}"`).join(',')}) SELECT ${select} FROM jsonb_to_recordset($1::jsonb) AS x(${declaration}) ON CONFLICT (${spec.columns[0]}) DO UPDATE SET ${updates}`,[JSON.stringify(payload)]);
    return;
  }
  if(referenceDomains.has(domain)){
    const payload=rows.map((row,index)=>({domain,stable_key:String(row.id??row.entity_id??row.uuid??`${row.company_code??'all'}:${index}`),company_code:text(row.company_code??row.com_code),payload:closedJson(row)}));
    await client.query(`INSERT INTO wbs_h1_import.reference_row(domain,stable_key,company_code,payload) SELECT domain,stable_key,company_code,payload FROM jsonb_to_recordset($1::jsonb) AS x(domain text,stable_key text,company_code text,payload jsonb) ON CONFLICT DO NOTHING`,[JSON.stringify(payload)]);
  }
}


export async function importSnapshotFile({pool,root,file,batchSize=1000}){
  if(!Number.isSafeInteger(batchSize)||batchSize<1||batchSize>1000)throw new Error('Invalid snapshot batch size');
  if(!Object.hasOwn(specifications,file?.domain)&&!referenceDomains.has(file?.domain))throw new Error('Unsupported snapshot domain');
  // Snapshot scalar claims before asynchronous work; never reread mutable caller state.
  file=Object.freeze({...file});
  const sourcePath=resolveSnapshotEntryPath(root,file),probe=createSnapshotIntegrityProbe(file);
  const client=await pool.connect();
  let input,reader,begun=false,releaseError;
  try{
    await client.query('BEGIN');begun=true;
    // Serialise this local-import namespace, including a previously absent receipt.
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('refs:wbs-h1-local-snapshot-import',0))");
    const prior=(await client.query('SELECT * FROM wbs_h1_import.snapshot_file WHERE path=$1 FOR UPDATE',[file.path])).rows[0];
    if(prior){
      const identical=prior.domain===file.domain&&prior.company_code===(file.company_code??null)&&prior.period_code===(file.period??null)&&
        String(prior.row_count)===String(probe.expected.rows)&&String(prior.byte_count)===String(probe.expected.bytes)&&prior.sha256.toLowerCase()===probe.expected.sha256;
      if(!identical)throw new Error('Snapshot receipt conflict: retained manifest evidence cannot be relabelled');
      if(!prior.imported_at||String(prior.imported_row_count)!==String(probe.expected.rows))throw new Error('Snapshot receipt is incomplete; explicit reconciliation is required');
    }else{
      await client.query('INSERT INTO wbs_h1_import.snapshot_file(path,domain,company_code,period_code,row_count,byte_count,sha256) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [file.path,file.domain,file.company_code,file.period,probe.expected.rows,probe.expected.bytes,probe.expected.sha256]);
    }
    input=createReadStream(sourcePath);
    input.on('data',chunk=>probe.observe(chunk));
    reader=createInterface({input,crlfDelay:Infinity});
    let batch=[],count=0;
    for await(const line of reader){
      if(!line)continue;
      const row=JSON.parse(line);
      if(!row||typeof row!=='object'||Array.isArray(row))throw new Error('Snapshot rows must be JSON objects');
      count++;
      if(!prior){
        batch.push(row);
        if(batch.length===batchSize){await insertBatch(client,file.domain,batch);batch=[];}
      }
    }
    if(batch.length)await insertBatch(client,file.domain,batch);
    probe.settle(count);
    // Replays verify bytes but perform no metadata or business-row updates.
    if(!prior)await client.query('UPDATE wbs_h1_import.snapshot_file SET imported_row_count=$2,imported_at=clock_timestamp() WHERE path=$1',[file.path,count]);
    await client.query('COMMIT');begun=false;
    return Object.freeze({rows:count,replayed:Boolean(prior)});
  }catch(error){
    if(begun){
      try{await client.query('ROLLBACK');}
      catch(rollbackError){releaseError=rollbackError;throw new AggregateError([error,rollbackError],'Snapshot import and rollback failed');}
    }
    throw error;
  }finally{
    reader?.close();input?.destroy();client.release(releaseError);
  }
}

export async function runSnapshotImport({root,onlyDomain=null,url}){
  if(!url)throw new Error('MIGRATION_DATABASE_URL is required');
  root=resolve(root);
  const manifest=JSON.parse(readFileSync(resolve(root,'manifest.json'),'utf8'));
  if(!Array.isArray(manifest.files))throw new Error('Snapshot manifest files must be an array');
  const {default:pg}=await import('pg');
  const pool=new pg.Pool({connectionString:url,max:2,application_name:'refs-wbs-h1-import'});
  try{
    await initializeSnapshotImportSchema(pool);
    let grand=0;
    for(const file of manifest.files){
      if(onlyDomain&&file.domain!==onlyDomain)continue;
      if(!Object.hasOwn(specifications,file.domain)&&!referenceDomains.has(file.domain))continue;
      grand+=(await importSnapshotFile({pool,root,file})).rows;
    }
await pool.query(`CREATE OR REPLACE VIEW wbs_h1_import.company_summary AS SELECT c.company_code,COALESCE(a.accounting_rows,0) accounting_rows,COALESCE(ap.ap_rows,0) ap_rows,COALESCE(ar.ar_rows,0) ar_rows FROM (SELECT DISTINCT company_code FROM wbs_h1_import.accounting_line WHERE company_code IS NOT NULL UNION SELECT DISTINCT company_code FROM wbs_h1_import.ap_business WHERE company_code IS NOT NULL UNION SELECT DISTINCT company_code FROM wbs_h1_import.ar_aging WHERE company_code IS NOT NULL) c LEFT JOIN (SELECT company_code,count(*) accounting_rows FROM wbs_h1_import.accounting_line GROUP BY company_code)a USING(company_code) LEFT JOIN(SELECT company_code,count(*) ap_rows FROM wbs_h1_import.ap_business GROUP BY company_code)ap USING(company_code) LEFT JOIN(SELECT company_code,count(*) ar_rows FROM wbs_h1_import.ar_aging GROUP BY company_code)ar USING(company_code)`);
const result=await pool.query(`SELECT count(*) company_count,sum(accounting_rows) accounting_rows,sum(ap_rows) ap_rows,sum(ar_rows) ar_rows FROM wbs_h1_import.company_summary`);
    return {status:'COMPLETE',imported_rows:grand,...result.rows[0]};
  }finally{await pool.end();}
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const result=await runSnapshotImport({root:process.argv[2]||'outputs/wbs-h1-2026',onlyDomain:process.argv[3]||null,url:process.env.MIGRATION_DATABASE_URL});
  process.stdout.write(JSON.stringify(result)+'\n');
}
