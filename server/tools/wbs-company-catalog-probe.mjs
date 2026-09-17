#!/usr/bin/env node
// Read-only WBS company catalog probe (H03 / entitycatalogfix Task A).
//
// Reads the approved read-only WBS MCP tool `list_autorec_banks` through the
// same bounded cursor traversal used by provision-wbs-h1-companies.mjs, but
// NEVER touches the REFS database and NEVER downgrades a missing or corrupt
// name to a fabricated label.  The artifact it emits is de-identified: every
// company name is retained only as sha256 + length + classification so the
// artifact can travel through receipts, chat and git without carrying legal
// names or provider payloads.  The exact names stay in the provider and are
// re-read by the 136 candidate retention step under WBS.COMPANY.CATALOG.RETAIN.
//
// Usage (credentials come from the environment only and are never echoed):
//   WBS_CF_ACCESS_CLIENT_ID=… WBS_CF_ACCESS_CLIENT_SECRET=… WBS_REFS_AUTH=… \
//     node server/tools/wbs-company-catalog-probe.mjs [--company CODE] [--placeholders codes.json] [--max-pages N]
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {createWbsLivePilotClient} from '../runtime/wbs-live-pilot-read-service.mjs';
import {canonicalRequestBody} from '../runtime/request-hash.mjs';

export const WBS_COMPANY_CATALOG_PROBE_SCHEMA='WBS_COMPANY_CATALOG_PROBE_V1';
const COMPANY=/^[A-Z0-9][A-Z0-9_:-]{0,63}$/;
const CONTROL=/[\u0000-\u001f\u007f]/;
// Latin-1 mojibake (GBK/UTF-8 text decoded as cp1252/latin1), replacement
// characters, and the markers the 136 controller already recognises.
const ENCODING_SUSPECT=/[\u00c0-\u00ff].{0,3}[\u00c0-\u00ff]|\ufffd|(?:\u00a8C|\u8127|\u951b)/u;
const CONSOLIDATED=/\(Consolidated\)\s*$/i;
const FORBIDDEN_KEY=/(?:^|_)(?:authorization|cookie|credential|password|secret|token|api_?key|private_?key)(?:$|_)/i;
const sha=value=>`sha256:${createHash('sha256').update(value,'utf8').digest('hex')}`;
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);

export function classifyCompanyName(value){
  const raw=typeof value==='string'?value:'';
  const name=raw.trim();
  if(!name)return {status:'NAME_MISSING',name:null};
  if(name.length>200)return {status:'NAME_TOO_LONG',name:null};
  if(CONTROL.test(name))return {status:'NAME_CONTROL_CHARS',name:null};
  if(ENCODING_SUSPECT.test(name))return {status:'NAME_ENCODING_SUSPECT',name};
  if(/^WBS [A-Z0-9_:-]+$/.test(name))return {status:'NAME_IS_PLACEHOLDER',name};
  return {status:'NAME_OK',name};
}

// De-identify one provider row.  Only the company code (a business key that
// already appears in REFS entity codes) is kept in clear text.
export function deidentifyCompanyRow(row,{page,ordinal}){
  if(!plain(row))return {ok:false,anomaly:{code:'ROW_SHAPE_INVALID',page,ordinal}};
  for(const key of Object.keys(row))if(FORBIDDEN_KEY.test(key))return {ok:false,anomaly:{code:'ROW_CREDENTIAL_LIKE_KEY',page,ordinal}};
  const companyCode=typeof row.company_code==='string'?row.company_code.trim().toUpperCase():'';
  if(!COMPANY.test(companyCode))return {ok:false,anomaly:{code:'COMPANY_CODE_INVALID',page,ordinal}};
  const classified=classifyCompanyName(row.company_name);
  const stableKey=typeof row.pb_guid==='string'&&row.pb_guid&&!CONTROL.test(row.pb_guid)?row.pb_guid:null;
  return {ok:true,company:Object.freeze({
    company_code:companyCode,
    name_status:classified.status,
    name_sha256:classified.name===null?null:sha(classified.name),
    name_length:classified.name===null?0:classified.name.length,
    consolidation_node:classified.name!==null&&CONSOLIDATED.test(classified.name),
    source_row_key_sha256:stableKey===null?null:sha(`list_autorec_banks\u0000${stableKey}`),
    first_seen_page:page,
    row_ordinal:ordinal
  })};
}

export async function probeWbsCompanyCatalog({client,maxPages=5000,companyFilter=null,now=()=>new Date()}={}){
  if(!client||typeof client.initialize!=='function'||typeof client.listTools!=='function'||typeof client.readView!=='function')throw new Error('WBS company catalog client is unavailable');
  if(!Number.isSafeInteger(maxPages)||maxPages<1||maxPages>5000)throw new Error('maxPages must be an integer from 1 to 5000');
  if(companyFilter!==null&&!COMPANY.test(companyFilter))throw new Error('--company must be a canonical WBS company code');
  const startedAt=now().toISOString();
  await client.initialize();await client.listTools();
  const companies=new Map(),cursors=new Set(),anomalies=[];let cursor=null,pages=0,rows=0,duplicateRows=0,pageContent=createHash('sha256');
  do{
    const args={limit:10};if(cursor!==null)args.cursor=cursor;
    const page=await client.readView({toolName:'list_autorec_banks',args});
    if(!plain(page)||!Array.isArray(page.rows)||page.rows.length>10||page.record_count!==page.rows.length)throw new Error('WBS company catalog page is invalid');
    pages++;rows+=page.rows.length;
    if(typeof page.content_sha256==='string')pageContent.update(page.content_sha256,'utf8');
    page.rows.forEach((row,ordinal)=>{
      const result=deidentifyCompanyRow(row,{page:pages,ordinal});
      if(!result.ok){anomalies.push(result.anomaly);return;}
      const company=result.company;
      if(companies.has(company.company_code)){
        duplicateRows++;
        const existing=companies.get(company.company_code);
        if(existing.name_sha256!==company.name_sha256)anomalies.push({code:'COMPANY_NAME_CONFLICT',company_code:company.company_code,page:pages,ordinal});
        return;
      }
      companies.set(company.company_code,company);
    });
    if(page.cursor_next!==null&&page.cursor_next!==undefined){
      if(typeof page.cursor_next!=='string'||!page.cursor_next||CONTROL.test(page.cursor_next)||cursors.has(page.cursor_next))throw new Error('WBS company catalog cursor is invalid');
      cursors.add(page.cursor_next);
    }
    cursor=page.cursor_next??null;
    if(pages>=maxPages&&cursor!==null)throw new Error('WBS company catalog exceeded the bounded page count');
  }while(cursor!==null);
  if(!companies.size)throw new Error('WBS company catalog is empty');
  let list=[...companies.values()].sort((a,b)=>a.company_code.localeCompare(b.company_code));
  if(companyFilter!==null){list=list.filter(row=>row.company_code===companyFilter);if(!list.length)anomalies.push({code:'COMPANY_FILTER_NOT_FOUND',company_code:companyFilter});}
  const byStatus={};for(const row of list)byStatus[row.name_status]=(byStatus[row.name_status]||0)+1;
  const control={pages,provider_rows:rows,unique_company_count:companies.size,emitted_company_count:list.length,duplicate_company_rows:duplicateRows,consolidation_node_count:list.filter(row=>row.consolidation_node).length,name_status_counts:byStatus,anomaly_count:anomalies.length};
  const core={schema_version:WBS_COMPANY_CATALOG_PROBE_SCHEMA,source_system:'WBS',source_tool:'list_autorec_banks',provider_environment:'PRODUCTION',read_only:true,database_written:false,wbs_written:false,company_filter:companyFilter,started_at:startedAt,finished_at:now().toISOString(),provider_pages_sha256:`sha256:${pageContent.digest('hex')}`,control,companies:list,anomalies};
  const hashCore={...core};delete hashCore.started_at;delete hashCore.finished_at;
  return Object.freeze({...core,artifact_hash:sha(canonicalRequestBody(hashCore))});
}

// Diff the probe against the codes currently carrying a placeholder name in
// REFS (a list of codes exported read-only by the operator; the probe itself
// never opens a database connection).
export function diffAgainstPlaceholders(probe,placeholderCodes){
  if(!Array.isArray(placeholderCodes)||placeholderCodes.some(code=>!COMPANY.test(code)))throw new Error('placeholder codes must be canonical WBS company codes');
  const byCode=new Map(probe.companies.map(row=>[row.company_code,row]));
  const resolvable=[],unresolved=[],missingInProvider=[];
  for(const code of [...new Set(placeholderCodes)].sort()){
    const row=byCode.get(code);
    if(!row){missingInProvider.push(code);continue;}
    (row.name_status==='NAME_OK'?resolvable:unresolved).push({company_code:code,name_status:row.name_status,consolidation_node:row.consolidation_node});
  }
  return Object.freeze({placeholder_count:new Set(placeholderCodes).size,resolvable_count:resolvable.length,unresolved_count:unresolved.length,missing_in_provider_count:missingInProvider.length,resolvable,unresolved,missing_in_provider:missingInProvider});
}

export function assertArtifactHasNoNamesOrSecrets(artifact){
  const walk=(value,path)=>{if(Array.isArray(value)){value.forEach((item,index)=>walk(item,`${path}[${index}]`));return;}if(!plain(value))return;for(const [key,item] of Object.entries(value)){if(FORBIDDEN_KEY.test(key))throw new Error(`probe artifact contains a credential-like key at ${path}.${key}`);walk(item,`${path}.${key}`);}};
  walk(artifact,'artifact');
  for(const row of artifact.companies){
    const keys=Object.keys(row).sort().join('|');
    if(keys!=='company_code|consolidation_node|first_seen_page|name_length|name_sha256|name_status|row_ordinal|source_row_key_sha256')throw new Error('probe artifact row leaks unexpected fields');
    if(row.name_sha256!==null&&!/^sha256:[0-9a-f]{64}$/.test(row.name_sha256))throw new Error('probe artifact row hash is not a sha256');
  }
  return true;
}

function parseArgs(argv){
  const out={company:null,placeholders:null,maxPages:5000};
  for(let index=0;index<argv.length;index++){
    const arg=argv[index];
    if(arg==='--company')out.company=String(argv[++index]||'').trim().toUpperCase();
    else if(arg==='--placeholders')out.placeholders=argv[++index];
    else if(arg==='--max-pages')out.maxPages=Number(argv[++index]);
    else throw new Error(`Unknown argument ${arg}`);
  }
  return out;
}

async function main(){
  const args=parseArgs(process.argv.slice(2));
  const required=['WBS_CF_ACCESS_CLIENT_ID','WBS_CF_ACCESS_CLIENT_SECRET','WBS_REFS_AUTH'];
  const missing=required.filter(key=>!process.env[key]);
  if(missing.length){process.stdout.write(`${JSON.stringify({schema_version:WBS_COMPANY_CATALOG_PROBE_SCHEMA,status:'BLOCKED_MISSING_CREDENTIALS',missing_env:missing})}\n`);process.exitCode=2;return;}
  const client=createWbsLivePilotClient({credentials:{'CF-Access-Client-Id':process.env.WBS_CF_ACCESS_CLIENT_ID,'CF-Access-Client-Secret':process.env.WBS_CF_ACCESS_CLIENT_SECRET,'X-REFS-Auth':process.env.WBS_REFS_AUTH}});
  const probe=await probeWbsCompanyCatalog({client,maxPages:args.maxPages,companyFilter:args.company||null});
  assertArtifactHasNoNamesOrSecrets(probe);
  const output={probe};
  if(args.placeholders){const codes=JSON.parse(readFileSync(args.placeholders,'utf8'));output.placeholder_diff=diffAgainstPlaceholders(probe,codes);}
  process.stdout.write(`${JSON.stringify(output)}\n`);
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  main().catch(error=>{process.stderr.write(`${error?.code||'WBS_COMPANY_CATALOG_PROBE_FAILED'}: ${error?.message||error}\n`);process.exitCode=1;});
}
