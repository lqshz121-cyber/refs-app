import {createAuthoritativeWbsH1ControlRun,appendAuthoritativeWbsH1ControlLines,finalizeAuthoritativeWbsH1ControlRun,refreshCurrentActorAccess} from './accounting-api.js';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA64=/^[0-9a-f]{64}$/;
const COMPANY_CODE=/^[A-Z0-9][A-Z0-9_:-]{0,63}$/;
const CURRENCY=/^[A-Z]{3}$/;
const CONTROL=/[\u0000-\u001f\u007f]/;
const MAX_PAGE_BYTES=7*1024*1024;
const EMPTY_PAGE_BYTES=new TextEncoder().encode('{"lines":[]}').byteLength;
const MAX_MANIFEST_BYTES=1024*1024;
const encoder=new TextEncoder();

// Small streaming SHA-256 implementation. It retains only one 64-byte block,
// so a 314 MB File is never copied into one browser ArrayBuffer.
export class StreamingSha256{
  constructor(){this.state=new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]);this.block=new Uint8Array(64);this.blockLength=0;this.bytes=0;this.finished=false;}
  update(input){if(this.finished)throw new Error('SHA-256 is already finalized');const data=typeof input==='string'?encoder.encode(input):input;if(!(data instanceof Uint8Array))throw new Error('SHA-256 input must be bytes');this.bytes+=data.byteLength;let offset=0;while(offset<data.byteLength){const take=Math.min(64-this.blockLength,data.byteLength-offset);this.block.set(data.subarray(offset,offset+take),this.blockLength);this.blockLength+=take;offset+=take;if(this.blockLength===64){this.#compress(this.block);this.blockLength=0;}}return this;}
  #compress(chunk){const k=StreamingSha256.K,w=new Uint32Array(64);for(let i=0;i<16;i++){const j=i*4;w[i]=((chunk[j]<<24)|(chunk[j+1]<<16)|(chunk[j+2]<<8)|chunk[j+3])>>>0;}for(let i=16;i<64;i++){const a=w[i-15],b=w[i-2],s0=((a>>>7)|(a<<25))^((a>>>18)|(a<<14))^(a>>>3),s1=((b>>>17)|(b<<15))^((b>>>19)|(b<<13))^(b>>>10);w[i]=(w[i-16]+s0+w[i-7]+s1)>>>0;}let [a,b,c,d,e,f,g,h]=this.state;for(let i=0;i<64;i++){const s1=((e>>>6)|(e<<26))^((e>>>11)|(e<<21))^((e>>>25)|(e<<7)),ch=(e&f)^(~e&g),t1=(h+s1+ch+k[i]+w[i])>>>0,s0=((a>>>2)|(a<<30))^((a>>>13)|(a<<19))^((a>>>22)|(a<<10)),maj=(a&b)^(a&c)^(b&c),t2=(s0+maj)>>>0;h=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=b;b=a;a=(t1+t2)>>>0;}this.state[0]=(this.state[0]+a)>>>0;this.state[1]=(this.state[1]+b)>>>0;this.state[2]=(this.state[2]+c)>>>0;this.state[3]=(this.state[3]+d)>>>0;this.state[4]=(this.state[4]+e)>>>0;this.state[5]=(this.state[5]+f)>>>0;this.state[6]=(this.state[6]+g)>>>0;this.state[7]=(this.state[7]+h)>>>0;}
  digestHex(){if(this.finished)throw new Error('SHA-256 is already finalized');this.finished=true;const bitLength=BigInt(this.bytes)*8n;this.block[this.blockLength++]=0x80;if(this.blockLength>56){this.block.fill(0,this.blockLength);this.#compress(this.block);this.blockLength=0;}this.block.fill(0,this.blockLength,56);for(let i=0;i<8;i++)this.block[63-i]=Number((bitLength>>BigInt(i*8))&255n);this.#compress(this.block);return [...this.state].map(value=>value.toString(16).padStart(8,'0')).join('');}
}
StreamingSha256.K=Uint32Array.from([0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2]);

export function canonicalRequestBody(value){if(value===null||typeof value!=='object')return JSON.stringify(value);if(Array.isArray(value))return `[${value.map(canonicalRequestBody).join(',')}]`;return `{${Object.keys(value).sort().filter(key=>value[key]!==undefined).map(key=>`${JSON.stringify(key)}:${canonicalRequestBody(value[key])}`).join(',')}}`;}
export const browserCanonicalRequestHash=value=>`sha256:${new StreamingSha256().update(canonicalRequestBody(value)).digestHex()}`;

const strictUtcTimestamp=value=>{if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value))return false;const parsed=new Date(value);return !Number.isNaN(parsed.valueOf())&&parsed.toISOString()===value;};
const text=(value,max=256)=>{if(value==null||String(value).trim()==='')return null;const out=String(value).trim();return out.length>max||CONTROL.test(out)?null:out;};
const strictDate=value=>{const raw=text(value,32);if(!raw||!/^\d{4}-\d{2}-\d{2}(?:[ T].*)?$/.test(raw))return null;const date=raw.slice(0,10),[y,m,d]=date.split('-').map(Number),parsed=new Date(Date.UTC(y,m-1,d));return parsed.getUTCFullYear()===y&&parsed.getUTCMonth()===m-1&&parsed.getUTCDate()===d?date:null;};
const money=value=>{const raw=typeof value==='number'&&Number.isFinite(value)?String(value):text(value,64);if(!raw||! /^-?(?:0|[1-9]\d{0,15})(?:\.\d+)?$/.test(raw))return null;const [whole,fraction='']=raw.split('.');if(fraction.length>4&&!/^0+$/.test(fraction.slice(4)))return null;return `${whole}.${fraction.slice(0,4).padEnd(4,'0')}`;};
const units=value=>{const normalized=money(value);return normalized===null?null:BigInt(normalized.replace('.',''));};
const fromUnits=value=>`${value<0n?'-':''}${String(value<0n?-value:value).padStart(5,'0').slice(0,-4)}.${String(value<0n?-value:value).padStart(5,'0').slice(-4)}`;
const optional=(row,...names)=>{for(const name of names){const out=text(row?.[name]);if(out!==null)return out;}return null;};

// Keep this fact construction byte-for-byte aligned with the server normalizer;
// the parity test imports both implementations and compares complete rows.
export function normalizeBrowserWbsH1AccountingControlRow(row,{tenantId,entityId,companyCode,currency,sourceVersion,rowOrdinal}={}){
  const sourceId=Number(row?.id),sourceCompany=text(row?.com_code??row?.company_code,64),postingDate=strictDate(row?.posting_date),setDate=strictDate(row?.set_date);
  const debit=money(row?.debtor??(String(row?.accounting_type||'').toUpperCase()==='DEBIT'?row?.accounting_value:null));
  const credit=money(row?.lender??(String(row?.accounting_type||'').toUpperCase()==='CREDIT'?row?.accounting_value:null));
  if(!UUID.test(tenantId||'')||!UUID.test(entityId||'')||!COMPANY_CODE.test(companyCode||'')||!CURRENCY.test(currency||'')||!/^sha256:[0-9a-f]{64}$/.test(sourceVersion||'')||!Number.isSafeInteger(sourceId)||sourceId<1||sourceCompany!==companyCode||!Number.isSafeInteger(rowOrdinal)||rowOrdinal<1||debit===null||credit===null||(units(debit)!==0n&&units(credit)!==0n))throw new Error('WBS accounting control rows require exact scope, stable identity, and at most one signed MONEY4 debit/credit side.');
  const account=optional(row,'account'),payee=optional(row,'payee_no','payee'),project=optional(row,'pj_code','project_code','project'),cost=optional(row,'cost_code'),unit=optional(row,'unit_guid','unit_code','unit');
  const date=postingDate??setDate,periodCode=date?.slice(0,7)??null,inH1=periodCode!==null&&periodCode>='2026-01'&&periodCode<='2026-06';
  const gaps=[];if(!postingDate)gaps.push('MISSING_POSTING_DATE');if(!account)gaps.push('MISSING_ACCOUNT');if(!project)gaps.push('MISSING_PROJECT');if(!cost)gaps.push('MISSING_COST_CODE');if(!payee)gaps.push('MISSING_PAYEE');if(units(debit)===0n&&units(credit)===0n)gaps.push('ZERO_AMOUNT');
  const completenessStatus=!inH1?'OUTSIDE_H1':gaps.length===0?'COMPLETE':gaps.length===1?gaps[0]:'MULTIPLE_GAPS';
  const cbId=optional(row,'cb_id');
  const facts={tenant_id:tenantId,entity_id:entityId,company_code:companyCode,currency,source_version:sourceVersion,wbs_accounting_info_id:sourceId,row_ordinal:rowOrdinal,journal_group_id:cbId??optional(row,'journal_group_id','journal_no','business_guid'),line_no:Number.isSafeInteger(Number(row?.sort??row?.line_no))?Number(row?.sort??row?.line_no):null,period_code:inH1?periodCode:null,set_date:setDate,posting_date:postingDate,account_code:account,debit_amount:debit,credit_amount:credit,member_ref:payee,project_ref:project,property_ref:optional(row,'property_ref','property'),cost_code:cost,unit_ref:unit,business_guid:optional(row,'business_guid'),sys_id:optional(row,'sys_id'),bill_no:optional(row,'bill_no'),cb_id:cbId,come_from:optional(row,'come_from')??'UNKNOWN',source:optional(row,'source')??'UNKNOWN',review_status:optional(row,'review')??'UNKNOWN',closed_status:optional(row,'closed')??'UNKNOWN',completeness_status:completenessStatus,gap_codes:gaps,excluded_from_h1:!inH1};
  return Object.freeze({...facts,line_hash:browserCanonicalRequestHash(facts)});
}

async function readSmallJson(file){if(!file||typeof file.stream!=='function'||file.size<2||file.size>MAX_MANIFEST_BYTES)throw new Error('manifest.json must be a selected JSON file no larger than 1 MiB');const reader=file.stream().getReader(),decoder=new TextDecoder('utf-8',{fatal:true});let value='';try{for(;;){const next=await reader.read();if(next.done)break;value+=decoder.decode(next.value,{stream:true});}value+=decoder.decode();}finally{reader.releaseLock();}try{return JSON.parse(value);}catch{throw new Error('manifest.json is not valid JSON');}}

export async function validateBrowserWbsH1Manifest({manifestFile,rawFile,companyCode}){
  if(manifestFile?.name!=='manifest.json'||!rawFile||typeof rawFile.stream!=='function')throw new Error('Select manifest.json and its accounting_info NDJSON file');
  const manifest=await readSmallJson(manifestFile);
  if(!manifest||manifest.schema_version!=='WBS_H1_2026_LOCAL_SNAPSHOT_V1'||manifest.date_from!=='2026-01-01'||manifest.date_to!=='2026-06-30'||!strictUtcTimestamp(manifest.generated_at)||!COMPANY_CODE.test(companyCode||'')||!Array.isArray(manifest.files))throw new Error('The WBS H1 manifest scope is invalid');
  const matches=manifest.files.filter(file=>file?.domain==='accounting_info'&&file.company_code===companyCode&&file.period==='2026-H1');if(matches.length!==1)throw new Error('The WBS H1 accounting_info manifest entry is missing or ambiguous');
  const entry=matches[0],fileName=`accounting_info__${companyCode}__2026-H1.ndjson`;
  if(String(entry.path||'').split(/[\\/]/).at(-1)!==fileName||rawFile.name!==fileName||!Number.isSafeInteger(entry.rows)||entry.rows<1||!Number.isSafeInteger(entry.bytes)||entry.bytes<1||rawFile.size!==entry.bytes||!SHA64.test(entry.sha256||''))throw new Error('The selected accounting_info file does not exactly match the manifest name, rows, bytes, or SHA-256 contract');
  return Object.freeze({schema_version:manifest.schema_version,domain:'accounting_info',company_code:companyCode,period:'2026-H1',date_from:manifest.date_from,date_to:manifest.date_to,generated_at:manifest.generated_at,file_name:fileName,rows:entry.rows,bytes:entry.bytes,sha256:entry.sha256.toLowerCase()});
}

async function scanRawRows({rawFile,sourceManifest,scope,onLine}){
  const reader=rawFile.stream().getReader(),decoder=new TextDecoder('utf-8',{fatal:true}),rawHash=new StreamingSha256();let carry='',rowCount=0,lastId=0,rawBytes=0;
  const consume=async rawLine=>{if(rawLine.endsWith('\r'))rawLine=rawLine.slice(0,-1);if(rawLine.trim()==='')throw new Error('Blank NDJSON rows are not allowed');let row;try{row=JSON.parse(rawLine);}catch{throw new Error(`Invalid WBS NDJSON at row ${rowCount+1}`);}const id=Number(row?.id);if(!Number.isSafeInteger(id)||id<=lastId)throw new Error(`WBS accounting_info IDs must be strictly ascending at row ${rowCount+1}`);lastId=id;rowCount++;await onLine(normalizeBrowserWbsH1AccountingControlRow(row,{...scope,companyCode:sourceManifest.company_code,rowOrdinal:rowCount}));};
  try{for(;;){const next=await reader.read();if(next.done)break;rawBytes+=next.value.byteLength;rawHash.update(next.value);const decoded=carry+decoder.decode(next.value,{stream:true}),parts=decoded.split('\n');carry=parts.pop();for(const line of parts)await consume(line);}carry+=decoder.decode();if(carry!=='')await consume(carry);}finally{reader.releaseLock();}
  const digest=rawHash.digestHex();if(rowCount!==sourceManifest.rows||rawBytes!==sourceManifest.bytes||digest!==sourceManifest.sha256)throw new Error(`WBS accounting_info manifest drift: rows=${rowCount}, bytes=${rawBytes}, sha256=${digest}`);return {rowCount,rawBytes,digest};
}

export async function summarizeBrowserWbsH1AccountingStream({rawFile,sourceManifest,tenantId,entityId,currency='USD',sourceVersion}){
  let count=0,included=0,debit=0n,credit=0n;const populationHash=new StreamingSha256(),groups=new Map();
  await scanRawRows({rawFile,sourceManifest,scope:{tenantId,entityId,currency,sourceVersion},onLine:line=>{count++;populationHash.update(`${line.line_hash}\n`);if(line.excluded_from_h1)return;included++;debit+=units(line.debit_amount);credit+=units(line.credit_amount);const key=`${line.period_code}\0${line.currency}\0${line.come_from}`,group=groups.get(key)??{debit:0n,credit:0n};group.debit+=units(line.debit_amount);group.credit+=units(line.credit_amount);groups.set(key,group);}});
  if(debit!==credit||[...groups.values()].some(group=>group.debit!==group.credit))throw new Error('The complete WBS H1 accounting population is not balanced by period/currency/module');
  return Object.freeze({snapshot_token_hash:browserCanonicalRequestHash(sourceManifest),provider_content_hash:`sha256:${sourceManifest.sha256}`,captured_at:sourceManifest.generated_at,expected_row_count:count,included_h1_row_count:included,excluded_row_count:count-included,expected_debit_amount:fromUnits(debit),expected_credit_amount:fromUnits(credit),population_hash:`sha256:${populationHash.digestHex()}`,accounting_authority:'CONTROL_EVIDENCE_ONLY',can_create_draft:false,can_review:false,can_approve:false,can_post:false});
}

export async function uploadBrowserWbsH1AccountingControl({config,companyCode,manifestFile,rawFile,currency='USD',fetcher=globalThis.fetch,resume=null,onProgress=()=>{}}={}){
  let runId=resume?.runId||null,page=0,rowsUploaded=0,sourceVersion=null;
  try{
    if(!config||!UUID.test(config.entityId||'')||!CURRENCY.test(currency))throw new Error('One authoritative entity and ISO currency are required');
    const access=await refreshCurrentActorAccess({config,fetcher});if(!access.ok)throw Object.assign(new Error(access.message),{code:access.code});
    const sourceManifest=await validateBrowserWbsH1Manifest({manifestFile,rawFile,companyCode});sourceVersion=browserCanonicalRequestHash({schema_version:'WBS_H1_ACCOUNTING_CONTROL_SOURCE_V1',manifest:sourceManifest});
    onProgress({phase:'VERIFYING',runId,page:0,rows:0});
    const summary=await summarizeBrowserWbsH1AccountingStream({rawFile,sourceManifest,tenantId:access.row.tenant_id,entityId:config.entityId,currency,sourceVersion});
    runId=runId||globalThis.crypto?.randomUUID?.();if(!UUID.test(runId||''))throw new Error('A secure browser UUID generator is required for a control run');
    const idempotencyKey=`wbs-h1-accounting:${sourceVersion.slice(7,55)}`;
    const created=await createAuthoritativeWbsH1ControlRun({config,idempotencyKey,run:{runId,companyCode,currency,sourceVersion,snapshotTokenHash:summary.snapshot_token_hash,providerContentHash:summary.provider_content_hash,sourceManifest,capturedAt:summary.captured_at,expectedRowCount:summary.expected_row_count,includedH1RowCount:summary.included_h1_row_count,excludedRowCount:summary.excluded_row_count,expectedDebitAmount:summary.expected_debit_amount,expectedCreditAmount:summary.expected_credit_amount,populationHash:summary.population_hash},fetcher});if(!created.ok)throw Object.assign(new Error(created.message),{code:created.code});
    onProgress({phase:'UPLOADING',runId,page:0,rows:0,totalRows:summary.expected_row_count});
    let lines=[],pageBytes=EMPTY_PAGE_BYTES;
    const flush=async()=>{if(!lines.length)return;const nextPage=page+1,result=await appendAuthoritativeWbsH1ControlLines({config,runId,lines,idempotencyKey:`${idempotencyKey}:page:${nextPage}`,fetcher});if(!result.ok)throw Object.assign(new Error(result.message),{code:result.code});page=nextPage;rowsUploaded+=lines.length;lines=[];pageBytes=EMPTY_PAGE_BYTES;onProgress({phase:'UPLOADING',runId,page,rows:rowsUploaded,totalRows:summary.expected_row_count});};
    await scanRawRows({rawFile,sourceManifest,scope:{tenantId:access.row.tenant_id,entityId:config.entityId,currency,sourceVersion},onLine:async line=>{const lineBytes=encoder.encode(JSON.stringify(line)).byteLength,nextBytes=pageBytes+(lines.length?1:0)+lineBytes;if(lines.length===1000||nextBytes>MAX_PAGE_BYTES){await flush();if(EMPTY_PAGE_BYTES+lineBytes>MAX_PAGE_BYTES)throw new Error('One normalized accounting row exceeds the 7 MiB page boundary');}lines.push(line);pageBytes+=(lines.length===1?0:1)+lineBytes;}});await flush();
    const finalized=await finalizeAuthoritativeWbsH1ControlRun({config,runId,idempotencyKey:`${idempotencyKey}:finalize`,fetcher});if(!finalized.ok)throw Object.assign(new Error(finalized.message),{code:finalized.code});onProgress({phase:'COMPLETE',runId,page,rows:rowsUploaded,totalRows:summary.expected_row_count,receiptHash:finalized.data.receipt_hash});return {ok:true,runId,pageCount:page,rowCount:rowsUploaded,receipt:finalized.data};
  }catch(error){return {ok:false,code:error.code||'WBS_H1_ACCOUNTING_CONTROL_UPLOAD_FAILED',message:error.message||'Control evidence upload failed.',resume:runId?{runId}:null,runId,page,rows:rowsUploaded,sourceVersion};}
}
