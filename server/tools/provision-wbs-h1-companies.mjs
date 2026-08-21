#!/usr/bin/env node
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {createPool} from '../runtime/db.mjs';
import {createWbsLivePilotClient} from '../runtime/wbs-live-pilot-read-service.mjs';

const COMPANY=/^[A-Z0-9][A-Z0-9_:-]{0,63}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONTROL=/[\u0000-\u001f\u007f]/;

const deterministicUuid=value=>{
  const hex=createHash('sha256').update(value,'utf8').digest('hex');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`;
};

const displayName=(value,companyCode)=>{
  const name=typeof value==='string'?value.trim():'';
  // A few legacy WBS names arrive as irrecoverable mojibake.  Preserve the
  // authoritative company key and use an honest label instead of publishing
  // corrupt text as a legal company name.
  if(!name||name.length>200||CONTROL.test(name)||/[\u00c0-\u00ff].{0,3}[\u00c0-\u00ff]/.test(name))return `WBS ${companyCode}`;
  return name;
};

export async function readWbsCompanyCatalog({client,maxPages=5000}={}){
  if(!client||typeof client.initialize!=='function'||typeof client.listTools!=='function'||typeof client.readView!=='function')throw new Error('WBS company catalog client is unavailable');
  await client.initialize();await client.listTools();
  const companies=new Map(),cursors=new Set();let cursor=null,pages=0,rows=0;
  do{
    const args={limit:10};if(cursor!==null)args.cursor=cursor;
    const page=await client.readView({toolName:'list_autorec_banks',args});
    if(!page||!Array.isArray(page.rows)||page.rows.length>10||page.record_count!==page.rows.length)throw new Error('WBS company catalog page is invalid');
    pages++;rows+=page.rows.length;
    for(const row of page.rows){
      const companyCode=typeof row.company_code==='string'?row.company_code.trim().toUpperCase():'';
      if(!COMPANY.test(companyCode))throw new Error('WBS company catalog contains an invalid company code');
      if(companies.has(companyCode))throw new Error(`WBS company catalog repeats ${companyCode}`);
      companies.set(companyCode,Object.freeze({company_code:companyCode,company_name:displayName(row.company_name,companyCode)}));
    }
    if(page.cursor_next!==null){
      if(typeof page.cursor_next!=='string'||!page.cursor_next||CONTROL.test(page.cursor_next)||cursors.has(page.cursor_next))throw new Error('WBS company catalog cursor is invalid');
      cursors.add(page.cursor_next);
    }
    cursor=page.cursor_next;
    if(pages>maxPages)throw new Error('WBS company catalog exceeded the bounded page count');
  }while(cursor!==null);
  if(!companies.size)throw new Error('WBS company catalog is empty');
  return Object.freeze({pages,rows,companies:Object.freeze([...companies.values()].sort((left,right)=>left.company_code.localeCompare(right.company_code)))});
}

export async function provisionWbsCompanyScopes({pool,tenantId,templateEntityId,catalog}={}){
  if(!pool||typeof pool.connect!=='function'||!UUID.test(tenantId||'')||!UUID.test(templateEntityId||'')||!catalog||!Array.isArray(catalog.companies)||!catalog.companies.length)throw new Error('WBS company provisioning configuration is invalid');
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const template=(await client.query(`SELECT entity_id::text,source_system,source_entity_id,base_currency FROM entity
      WHERE tenant_id=$1 AND entity_id=$2 AND active FOR UPDATE`,[tenantId,templateEntityId])).rows[0];
    const expectedTemplate=template&&template.base_currency==='USD'&&(
      (template.source_system==='REFS_STAGE1'&&template.source_entity_id==='REFS_US_001')||
      (template.source_system==='WBS'&&template.source_entity_id==='WBPA')
    );
    if(!expectedTemplate)throw new Error('The configured REFS staging entity is not the expected legacy or WBS WBPA scope');
    const wbpa=catalog.companies.find(row=>row.company_code==='WBPA');
    if(!wbpa)throw new Error('The WBS company catalog does not contain WBPA');
    await client.query(`UPDATE entity SET entity_code='WBPA',source_system='WBS',source_entity_id='WBPA',name=$3
      WHERE tenant_id=$1 AND entity_id=$2`,[tenantId,templateEntityId,wbpa.company_name]);
    let created=0,reused=0;
    for(const company of catalog.companies){
      if(!COMPANY.test(company.company_code)||typeof company.company_name!=='string'||!company.company_name.trim())throw new Error('WBS company catalog row is invalid');
      const entityId=company.company_code==='WBPA'?templateEntityId:deterministicUuid(`refs:${tenantId}:wbs-company:${company.company_code}`);
      const inserted=await client.query(`INSERT INTO entity(entity_id,tenant_id,entity_code,source_system,source_entity_id,name,base_currency,active)
        VALUES($1,$2,$3,'WBS',$3,$4,'USD',true)
        ON CONFLICT(tenant_id,source_system,source_entity_id) DO UPDATE SET name=EXCLUDED.name,active=true
        RETURNING entity_id::text,(xmax=0) AS inserted`,[entityId,tenantId,company.company_code,company.company_name]);
      const exactEntityId=inserted.rows[0]?.entity_id;
      if(exactEntityId!==entityId)throw new Error(`Existing WBS entity identity conflicts for ${company.company_code}`);
      if(inserted.rows[0].inserted)created++;else reused++;
      await client.query(`INSERT INTO accounting_period(period_id,tenant_id,entity_id,ledger_code,period_code,starts_on,ends_on,status)
        SELECT $4,$1,$2,'PRIMARY',to_char(month_start,'YYYY-MM'),month_start,(month_start+interval '1 month - 1 day')::date,'OPEN'
        FROM (SELECT make_date(2026,$3,1) AS month_start) month_scope
        ON CONFLICT(tenant_id,entity_id,ledger_code,period_code) DO NOTHING`,
        [tenantId,entityId,1,deterministicUuid(`refs:${tenantId}:${entityId}:2026-01`)]);
      for(let month=2;month<=6;month++)await client.query(`INSERT INTO accounting_period(period_id,tenant_id,entity_id,ledger_code,period_code,starts_on,ends_on,status)
        VALUES($1,$2,$3,'PRIMARY',$4,make_date(2026,$5,1),(make_date(2026,$5,1)+interval '1 month - 1 day')::date,'OPEN')
        ON CONFLICT(tenant_id,entity_id,ledger_code,period_code) DO NOTHING`,[deterministicUuid(`refs:${tenantId}:${entityId}:2026-${String(month).padStart(2,'0')}`),tenantId,entityId,`2026-${String(month).padStart(2,'0')}`,month]);
      await client.query(`INSERT INTO account_master(tenant_id,entity_id,account_code,account_name,requires_member,required_member_type,active)
        SELECT tenant_id,$3,account_code,account_name,requires_member,required_member_type,active
        FROM account_master WHERE tenant_id=$1 AND entity_id=$2
        ON CONFLICT(tenant_id,entity_id,account_code) DO NOTHING`,[tenantId,templateEntityId,entityId]);
      await client.query(`INSERT INTO runtime_actor_grant(tenant_id,actor_id,entity_id,permission,valid_until,revoked_at)
        SELECT tenant_id,actor_id,$3,permission,valid_until,NULL FROM runtime_actor_grant
        WHERE tenant_id=$1 AND entity_id=$2 AND revoked_at IS NULL AND (valid_until IS NULL OR valid_until>clock_timestamp())
        ON CONFLICT(tenant_id,actor_id,entity_id,permission) DO UPDATE SET valid_until=EXCLUDED.valid_until,revoked_at=NULL`,[tenantId,templateEntityId,entityId]);
      await client.query(`INSERT INTO runtime_actor_grant_set(tenant_id,actor_id,entity_id,version,updated_by,updated_at)
        SELECT tenant_id,actor_id,$3,version,'wbs-all-company-provisioner',clock_timestamp()
        FROM runtime_actor_grant_set WHERE tenant_id=$1 AND entity_id=$2
        ON CONFLICT(tenant_id,actor_id,entity_id) DO UPDATE SET version=GREATEST(runtime_actor_grant_set.version,EXCLUDED.version),updated_by=EXCLUDED.updated_by,updated_at=EXCLUDED.updated_at`,[tenantId,templateEntityId,entityId]);
    }
    const evidence=(await client.query(`SELECT count(DISTINCT e.entity_id)::integer AS company_count,count(DISTINCT p.period_id)::integer AS period_count
      FROM entity e JOIN accounting_period p ON p.tenant_id=e.tenant_id AND p.entity_id=e.entity_id
      WHERE e.tenant_id=$1 AND e.source_system='WBS' AND e.active AND p.period_code BETWEEN '2026-01' AND '2026-06'`,[tenantId])).rows[0];
    if(evidence.company_count!==catalog.companies.length||evidence.period_count!==catalog.companies.length*6)throw new Error('Provisioned WBS company or H1 period count is incomplete');
    await client.query('COMMIT');
    return Object.freeze({status:'WBS_H1_COMPANY_SCOPES_READY',company_count:evidence.company_count,period_count:evidence.period_count,created_count:created,reused_count:reused});
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}

async function main(){
  const required=['MIGRATION_DATABASE_URL','REFS_WBS_TEST_IMPORT_TENANT_ID','REFS_WBS_TEST_IMPORT_ENTITY_ID','WBS_CF_ACCESS_CLIENT_ID','WBS_CF_ACCESS_CLIENT_SECRET','WBS_REFS_AUTH'];
  for(const key of required)if(!process.env[key])throw new Error(`${key} is required`);
  const wbsClient=createWbsLivePilotClient({credentials:{'CF-Access-Client-Id':process.env.WBS_CF_ACCESS_CLIENT_ID,'CF-Access-Client-Secret':process.env.WBS_CF_ACCESS_CLIENT_SECRET,'X-REFS-Auth':process.env.WBS_REFS_AUTH}});
  const catalog=await readWbsCompanyCatalog({client:wbsClient});
  const pool=await createPool({databaseUrl:process.env.MIGRATION_DATABASE_URL,applicationName:'refs-wbs-h1-company-provisioner',max:1});
  try{
    const result=await provisionWbsCompanyScopes({pool,tenantId:process.env.REFS_WBS_TEST_IMPORT_TENANT_ID,templateEntityId:process.env.REFS_WBS_TEST_IMPORT_ENTITY_ID,catalog});
    process.stdout.write(`${JSON.stringify({...result,provider_pages:catalog.pages,provider_rows:catalog.rows})}\n`);
  }finally{await pool.end();}
}

if(import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{process.stderr.write(`${JSON.stringify({status:'WBS_H1_COMPANY_SCOPES_FAILED',message:error.message})}\n`);process.exitCode=1;});
