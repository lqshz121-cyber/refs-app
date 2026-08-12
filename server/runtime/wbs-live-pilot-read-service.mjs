import {createHash} from 'node:crypto';
import {canonicalRequestBody} from './request-hash.mjs';
import {WBS_MCP_APPROVED_ENDPOINT,createReadOnlyWbsMcpClient} from './wbs-readonly-mcp.mjs';

export const WBS_LIVE_PILOT_TOOLS=Object.freeze(['list_payables','list_bank_transactions','list_autorec_details','list_autorec_banks','list_journal_entries']);
const STABLE_KEY=Object.freeze({list_payables:'ap_guid',list_bank_transactions:'cb_id',list_autorec_details:'pd_guid',list_autorec_banks:'pb_guid',list_journal_entries:'id'});
const CONTROL=/[\u0000-\u001f\u007f]/;
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const token=value=>{
  if(typeof value!=='string')return null;
  const normalized=value.trim().toUpperCase();
  return /^[A-Z0-9][A-Z0-9_:-]{0,63}$/.test(normalized)?normalized:null;
};
const journalReviewStatus=value=>{
  const normalized=token(value);
  if(normalized===null)return null;
  const candidate=/^\d/.test(normalized)?`CODE_${normalized}`:normalized;
  return /^[A-Z][A-Z0-9_]{0,63}$/.test(candidate)?candidate:null;
};
const date=value=>{
  if(typeof value!=='string')return null;
  const raw=value.trim();
  // The production v0.1 provider emits SQL-style timestamps without a zone.
  // Accounting date is the declared calendar prefix, never a browser/server
  // timezone conversion. Accept only a bounded ISO/SQL datetime shape and
  // independently validate the calendar date before discarding the time.
  if(!/^\d{4}-\d{2}-\d{2}(?:[ T](?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)?)?$/.test(raw))return null;
  const prefix=raw.slice(0,10),[year,month,day]=prefix.split('-').map(Number);
  const parsed=new Date(Date.UTC(year,month-1,day));
  return parsed.getUTCFullYear()===year&&parsed.getUTCMonth()===month-1&&parsed.getUTCDate()===day?prefix:null;
};
// The live v0.1 provider emits scale-5 decimal strings. REFS may reduce them
// to MONEY4 only when the fifth and later digits are all zero; no rounding is
// permitted in an accounting observation.
const money=value=>{
  const raw=typeof value==='number'&&Number.isFinite(value)?String(value):typeof value==='string'?value.trim():'';
  if(!/^-?(?:0|[1-9]\d{0,15})(?:\.\d{1,})?$/.test(raw))return null;
  const [whole,fraction='']=raw.split('.');
  if(fraction.length>4&&!/^0+$/.test(fraction.slice(4)))return null;
  return `${whole}.${fraction.slice(0,4).padEnd(4,'0')}`;
};
const hash=value=>`sha256:${createHash('sha256').update(value,'utf8').digest('hex')}`;
const first=(row,fields,normalizer)=>{for(const field of fields){const value=normalizer(row[field]);if(value!==null)return value;}return null;};
const rowShape=(tool,row)=>{
  if(tool==='list_payables')return {accounting_date:first(row,['posting_date','incurred_date'],date),amount:money(row.amount),status:first(row,['pay_status','review_status'],token)||'UNKNOWN'};
  if(tool==='list_bank_transactions'){
    const debit=money(row.debtor),credit=money(row.lender),debitActive=debit!==null&&debit!=='0.0000',creditActive=credit!==null&&credit!=='0.0000';
    return {accounting_date:first(row,['posting_date','set_date'],date),amount:debitActive&&!creditActive?debit:creditActive&&!debitActive?credit:debit||credit,direction:debitActive&&!creditActive?'DEBIT':creditActive&&!debitActive?'CREDIT':'UNKNOWN',status:token(row.review)||'UNKNOWN'};
  }
  if(tool==='list_autorec_details')return {accounting_date:first(row,['incurred_date','clear_date'],date),payment_amount:money(row.payment),deposit_amount:money(row.deposit),status:token(row.status)||'UNKNOWN',match_status:token(row.match_status)||'UNKNOWN'};
  if(tool==='list_autorec_banks')return {pay_amount:money(row.pay_amount),debit_amount:money(row.debit_amount),quantity:money(row.quantity),released_amount:money(row.released),released_quantity:money(row.released_quantity),incurred_amount:money(row.incurred),status:token(row.status)||'UNKNOWN'};
  return {accounting_date:first(row,['posting_date','set_date'],date),debit_amount:money(row.debtor),credit_amount:money(row.lender),review_status:journalReviewStatus(row.review)||'UNKNOWN'};
};
const sanitizeRow=(tool,row)=>{
  const key=row[STABLE_KEY[tool]],keyText=typeof key==='string'?key:Number.isSafeInteger(key)?String(key):'';
  if(!keyText||CONTROL.test(keyText))fail('WBS_LIVE_PILOT_ROW_KEY_INVALID','WBS pilot row has no safe source observation key.');
  const out={source_record_hash:hash(`${tool}\u0000${keyText}`),currency:'USD'};
  for(const [field,value] of Object.entries(rowShape(tool,row)))if(value!==null||tool==='list_autorec_banks')out[field]=value;
  return Object.freeze(out);
};

export class WbsLivePilotError extends Error{constructor(code,message){super(message);this.name='WbsLivePilotError';this.code=code;}}
const fail=(code,message)=>{throw new WbsLivePilotError(code,message);};

export function parseWbsLivePilotSelection(searchParams){
  const allowed=new Set(['tool','limit']);for(const key of searchParams.keys())if(!allowed.has(key))fail('WBS_LIVE_PILOT_QUERY_INVALID',`Unexpected query parameter: ${key}`);
  if(searchParams.getAll('tool').length!==1||!WBS_LIVE_PILOT_TOOLS.includes(searchParams.get('tool')))fail('WBS_LIVE_PILOT_TOOL_INVALID','tool must be one approved live observation tool.');
  if(searchParams.getAll('limit').length!==1)fail('WBS_LIVE_PILOT_LIMIT_INVALID','limit must occur exactly once.');
  const raw=searchParams.get('limit');if(!/^(?:[1-9]|10)$/.test(raw))fail('WBS_LIVE_PILOT_LIMIT_INVALID','limit must be an integer from 1 to 10.');
  return Object.freeze({tool:searchParams.get('tool'),limit:Number(raw)});
}

export function createWbsLivePilotClient({credentials,fetcher=globalThis.fetch}={}){
  if(!plain(credentials))fail('WBS_LIVE_PILOT_CONFIG_INVALID','WBS live pilot server credentials are unavailable.');
  return createReadOnlyWbsMcpClient({endpoint:WBS_MCP_APPROVED_ENDPOINT,getAuthHeaders:()=>structuredClone(credentials),allowedReadTools:WBS_LIVE_PILOT_TOOLS,fetcher,pilotObservationMode:true});
}

export function assertWbsLivePilotResult(value,{entityId,tool,limit}={}){
  const falseFlags=['can_import','can_create_transaction','can_match','can_allocate','can_create_draft','can_approve','can_post','can_reverse'];
  if(!plain(value)||value.schema_version!=='WBS_LIVE_PILOT_OBSERVATION_V1'||value.status!=='NOT_ADMITTED'||value.observation_mode!=='UNSIGNED_PILOT'||value.source_system!=='WBS'||value.environment!=='PRODUCTION'||value.entity_id!==entityId||value.tool!==tool||value.signature_verified!==false||!Array.isArray(value.rows)||value.rows.length!==value.record_count||value.record_count>limit||value.record_count>10||!/^[0-9a-f]{64}$/.test(value.provider_content_sha256||'')||!/^sha256:[0-9a-f]{64}$/.test(value.observation_hash||'')||falseFlags.some(flag=>value[flag]!==false))fail('WBS_LIVE_PILOT_RESULT_INVALID','WBS pilot result failed the read-only response contract.');
  return value;
}

export function createWbsLivePilotReadService({client,authorize}={}){
  if(!client||typeof client.initialize!=='function'||typeof client.listTools!=='function'||typeof client.readView!=='function'||typeof authorize!=='function')fail('WBS_LIVE_PILOT_CONFIG_INVALID','WBS live pilot requires a read client and scoped authorizer.');
  let ready=null;const prepare=()=>ready??=(async()=>{await client.initialize();await client.listTools();return true;})().catch(error=>{ready=null;throw error;});
  return Object.freeze({
    read_only:true,
    async readObservation({tenantId,entityId,tool,limit}={}){
      if(!tenantId||!entityId||!WBS_LIVE_PILOT_TOOLS.includes(tool)||!Number.isSafeInteger(limit)||limit<1||limit>10)fail('WBS_LIVE_PILOT_SELECTION_INVALID','A scoped approved WBS pilot selection is required.');
      await authorize({tenantId,entityId});
      let observed;try{await prepare();observed=await client.readView({toolName:tool,args:{limit}});}catch{fail('WBS_LIVE_PILOT_PROVIDER_UNAVAILABLE','The WBS live pilot provider response was unavailable or unsafe.');}
      const companyCodes=Array.isArray(observed.scope?.company_codes)&&observed.scope.company_codes.every(value=>typeof value==='string'&&value.length<=128&&!CONTROL.test(value))?[...observed.scope.company_codes]:[];
      const rows=observed.rows.map(row=>sanitizeRow(tool,plain(row)?row:{}));
      const sourceDateRange=Array.isArray(observed.scope?.date_range)?observed.scope.date_range:[];
      const dateRange=Object.freeze([date(sourceDateRange[0])||null,date(sourceDateRange[1])||null]);
      const core={schema_version:'WBS_LIVE_PILOT_OBSERVATION_V1',status:'NOT_ADMITTED',observation_mode:'UNSIGNED_PILOT',source_system:'WBS',tool,environment:'PRODUCTION',entity_id:entityId,captured_at:observed.captured_at,provider_content_sha256:observed.content_sha256,scope:Object.freeze({company_codes:Object.freeze(companyCodes),date_range:dateRange}),record_count:rows.length,rows:Object.freeze(rows),signature_verified:false,can_import:false,can_create_transaction:false,can_match:false,can_allocate:false,can_create_draft:false,can_approve:false,can_post:false,can_reverse:false};
      return Object.freeze({...core,observation_hash:hash(canonicalRequestBody(core))});
    }
  });
}
