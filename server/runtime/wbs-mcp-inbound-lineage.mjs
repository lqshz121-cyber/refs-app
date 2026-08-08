import {canonicalRequestHash} from './request-hash.mjs';
import {validateWbsReadEnvelope,WBS_READONLY_ROW_FIELDS} from './wbs-readonly-mcp.mjs';

// This module is deliberately an admission and lineage layer, not a WBS
// business-operation adapter.  Its output can be persisted only by the
// receipt-backed REFS ingress workflow and is never a Draft or posting command.
const stableKey=Object.freeze({list_payables:'ap_guid',list_bank_transactions:'cb_id',list_autorec_details:'pd_guid',list_autorec_banks:'pb_guid',list_journal_entries:'id'});
const sourceType=Object.freeze({list_payables:'PAYABLE',list_bank_transactions:'BANK_TRANSACTION',list_autorec_details:'AUTOREC_PAYMENT_DETAIL',list_autorec_banks:'AUTOREC_BANK_CONTROL',list_journal_entries:'WBS_JOURNAL_EVIDENCE',list_control_totals:'WBS_CONTROL_TOTAL',trace_by_key:'WBS_TRACE_RELATION'});
const text=value=>value==null?'':String(value).trim();
const money=value=>Number.isFinite(Number(value))?Number(Number(value).toFixed(4)):null;
const freeze=value=>Object.freeze(value);
const hash=row=>canonicalRequestHash(row);

export class WbsMcpLineageError extends Error {
  constructor(code,message){super(message);this.name='WbsMcpLineageError';this.code=code;}
}

function sorted(rows,key){return rows.every((row,index)=>index===0||text(rows[index-1][key])<text(row[key]));}
function signedMovement(row,credit,debit){
  const credited=money(row[credit]),debited=money(row[debit]);
  if((credited!==null&&credited!==0)&&(debited!==null&&debited!==0))return null;
  if(credited!==null&&credited!==0)return freeze({amount:Math.abs(credited),direction:'CREDIT'});
  if(debited!==null&&debited!==0)return freeze({amount:-Math.abs(debited),direction:'DEBIT'});
  return null;
}

// The provider has no revision, CDC, or tombstone guarantee.  A record absent
// from a later page is therefore evidence needing recheck, never a deletion.
export function planWbsMcpSnapshotDiff({previous=null,current}={}){
  const next=validateWbsReadEnvelope({toolName:current?.tool,envelope:current});
  const key=stableKey[next.tool_name];
  if(!key)return freeze({tool_name:next.tool_name,changes:freeze([]),requires_snapshot_diff:true,can_delete:false});
  if(!sorted(next.rows,key))throw new WbsMcpLineageError('WBS_MCP_ROWS_NOT_SORTED','WBS rows must be ascending by their stable source key.');
  let prior=null;
  if(previous!==null){
    prior=validateWbsReadEnvelope({toolName:previous?.tool,envelope:previous});
    if(prior.tool_name!==next.tool_name||canonicalRequestHash(prior.scope)!==canonicalRequestHash(next.scope))throw new WbsMcpLineageError('WBS_MCP_SNAPSHOT_SCOPE_MISMATCH','WBS snapshots must have the same tool and scope.');
  }
  const before=new Map((prior?.rows||[]).map(row=>[text(row[key]),hash(row)]));
  const seen=new Set(),changes=[];
  for(const row of next.rows){
    const id=text(row[key]),rowHash=hash(row);seen.add(id);
    changes.push(freeze({stable_key:id,row_hash:rowHash,kind:before.has(id)?(before.get(id)===rowHash?'UNCHANGED':'CHANGED'):'NEW',can_delete:false}));
  }
  for(const id of before.keys())if(!seen.has(id))changes.push(freeze({stable_key:id,kind:'ABSENT_UNCONFIRMED',requires_recheck:true,can_delete:false}));
  return freeze({tool_name:next.tool_name,scope:next.scope,content_sha256:next.content_sha256,changes:freeze(changes),requires_snapshot_diff:true,has_revision_contract:false,has_cdc_contract:false,has_tombstone_contract:false,can_delete:false});
}

function commonRow({tool,accepted,row}){
  const key=stableKey[tool];
  return {
    source_system:'WBS_MCP',source_type:sourceType[tool],source_record_id:key?text(row[key]):null,
    // The row has no provider revision. This version deliberately identifies
    // the immutable observed envelope, not a fabricated source revision.
    source_version:`snapshot:${accepted.content_sha256}:${hash(row).slice(7,23)}`,
    company_key:text(row.company_code||row.company||accepted.scope.company),
    receipt_hash:`sha256:${accepted.content_sha256}`,receipt_captured_at:accepted.captured_at,
    receipt_ref:null,raw_row_hash:hash(row),can_create_draft:false,can_allocate:false,can_post:false
  };
}

export function mapWbsMcpEnvelopeToInbound({envelope}={}){
  const accepted=validateWbsReadEnvelope({toolName:envelope?.tool,envelope});
  const tool=accepted.tool_name,rows=[];
  for(const row of accepted.rows){
    const common=commonRow({tool,accepted,row});
    if(tool==='list_payables')rows.push(freeze({...common,admission:'TRANSACTION_CANDIDATE',business_date:row.incurred_date||row.posting_date||null,posting_date:row.posting_date||null,amount:money(row.amount),currency:row.currency||null,vendor_ref:row.vendor_no||null,project_ref:row.project_guid||null,cost_ref:row.cost_id||null,payable_link:row.ap_long_id||null,journal_trace:row.journal_no||null}));
    else if(tool==='list_bank_transactions'){
      const movement=signedMovement(row,'lender','debtor');
      rows.push(freeze({...common,admission:movement?'TRANSACTION_CANDIDATE':'EXCEPTION_REVIEW_REQUIRED',amount:movement?.amount??null,direction:movement?.direction??null,currency:row.currency||null,bank_account_ref:row.account_code||null,bank_trace_ref:row.cb_id,raw_memo:row.description||null,autoc_relation:row.come_from||null,exception_code:movement?null:'WBS_MCP_AMOUNT_DIRECTION_REQUIRED'}));
    } else if(tool==='list_autorec_details'){
      const movement=signedMovement(row,'deposit','payment');
      rows.push(freeze({...common,admission:movement?'AUTOREC_REVIEW_EVIDENCE':'EXCEPTION_REVIEW_REQUIRED',amount:movement?.amount??null,direction:movement?.direction??null,currency:row.currency||null,bank_trace_ref:row.cb_id||null,autoc_bank_ref:row.pd_pv_guid||null,match_ref:row.match_guid||null,project_ref:row.project_guid||null,cost_ref:row.cost_code||null,vendor_ref:row.vendor_no||null,exception_code:movement?null:'WBS_MCP_AMOUNT_DIRECTION_REQUIRED'}));
    } else rows.push(freeze({...common,admission:'CONTROL_OR_TRACE_ONLY',fields:freeze(structuredClone(row))}));
  }
  return freeze({tool_name:tool,required_fields:WBS_READONLY_ROW_FIELDS[tool]??freeze([]),rows:freeze(rows),receipt_required_for_persistence:true,can_create_draft:false,can_allocate:false,can_post:false});
}

const snapshotView=Object.freeze({list_payables:'BGDATA.payable',list_bank_transactions:'BGDATA.bank_transaction',list_autorec_details:'BGDATA.autoc_detail'});
const snapshotPrimaryKey=Object.freeze({list_payables:'apGuId',list_bank_transactions:'cashOrBankBookId',list_autorec_details:'pdGuId'});
const uuid=value=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text(value));
const iso=value=>typeof value==='string'&&!Number.isNaN(Date.parse(value));

function mcpProvenance(accepted,row){return freeze({mcp_tool:accepted.tool_name,mcp_content_sha256:`sha256:${accepted.content_sha256}`,mcp_row_hash:hash(row),mcp_captured_at:accepted.captured_at});}
function snapshotRow(accepted,row){
  const provenance=mcpProvenance(accepted,row);
  if(accepted.tool_name==='list_payables')return freeze({...provenance,apGuId:text(row.ap_guid),currency:text(row.currency).toUpperCase()||null,amount:money(row.amount),invoice_date:row.incurred_date||row.posting_date||null,posting_date:row.posting_date||null,description:row.description||null,vendor_ref:row.vendor_no||null,project_ref:row.project_guid||null,cost_code_ref:row.cost_id||null});
  if(accepted.tool_name==='list_bank_transactions'){
    const movement=signedMovement(row,'lender','debtor');
    return freeze({...provenance,cashOrBankBookId:text(row.cb_id),bank_account_ref:row.account_code||null,currency:text(row.currency).toUpperCase()||null,amount:movement?.amount??null,transaction_date:row.set_date||null,direction:movement?.direction??null,description:row.description||null,come_from:row.come_from||null});
  }
  const movement=signedMovement(row,'deposit','payment');
  // pd_pv_guid is observed as a relation navigation value, not a verified
  // pb_guid. Leave pbGuId absent so the existing staging gate quarantines it.
  return freeze({...provenance,pdGuId:text(row.pd_guid),currency:text(row.currency).toUpperCase()||null,amount:movement?.amount??null,payment_date:row.incurred_date||row.clear_date||null,direction:movement?.direction??null,autoc_relation_ref:row.pd_pv_guid||null,vendor_ref:row.vendor_no||null,project_ref:row.project_guid||null,cost_code_ref:row.cost_code||null});
}

// Creates a receipt-bearing snapshot package that the existing REFS inbound
// adapter can consume. It accepts only transaction-producer views; report and
// control views must flow through their control-reconciliation path instead.
// It deliberately does not manufacture a pb_guid from pd_pv_guid.
export function buildWbsMcpReadonlySnapshot({envelopes,snapshotId,dictionaryVersion,environment='SANDBOX',delivery=null,detachedSignature=null}={}){
  if(!uuid(snapshotId)||typeof dictionaryVersion!=='string'||!dictionaryVersion.trim()||!Array.isArray(envelopes)||envelopes.length===0)throw new WbsMcpLineageError('WBS_MCP_SNAPSHOT_INPUT_INVALID','Snapshot id, dictionary version, and formal MCP envelopes are required.');
  if(!['SANDBOX','PRODUCTION'].includes(environment))throw new WbsMcpLineageError('WBS_MCP_SNAPSHOT_INPUT_INVALID','Snapshot environment is invalid.');
  const accepted=envelopes.map(envelope=>validateWbsReadEnvelope({toolName:envelope?.tool,envelope}));
  if(accepted.some(item=>!snapshotView[item.tool_name]))throw new WbsMcpLineageError('WBS_MCP_CONTROL_VIEW_NOT_TRANSACTIONAL','Control, journal, and trace MCP views cannot form a transaction snapshot.');
  if(new Set(accepted.map(item=>item.tool_name)).size!==accepted.length)throw new WbsMcpLineageError('WBS_MCP_SNAPSHOT_VIEW_DUPLICATE','A snapshot may contain one envelope per transaction producer view.');
  const company=text(accepted[0].scope.company),capturedAt=accepted[0].captured_at;
  if(!company||accepted.some(item=>text(item.scope.company)!==company||item.captured_at!==capturedAt))throw new WbsMcpLineageError('WBS_MCP_SNAPSHOT_SCOPE_INVALID','Formal MCP transaction envelopes require one company scope and captured-at timestamp.');
  for(const item of accepted){const key=stableKey[item.tool_name];if(!sorted(item.rows,key))throw new WbsMcpLineageError('WBS_MCP_ROWS_NOT_SORTED','WBS rows must be ascending by their stable source key.');}
  if(environment==='PRODUCTION'&&(!delivery||!detachedSignature))throw new WbsMcpLineageError('WBS_MCP_SNAPSHOT_SIGNATURE_REQUIRED','Production MCP snapshots require complete delivery evidence and a detached signature.');
  const views=accepted.map(item=>{
    const rows=item.rows.map(row=>snapshotRow(item,row));
    const key=snapshotPrimaryKey[item.tool_name];
    const view={name:snapshotView[item.tool_name],company_key:company,rows:freeze(rows),content_hash:canonicalRequestHash(rows)};
    if(environment==='PRODUCTION')Object.assign(view,{row_count:rows.length,first_primary_key:rows.length?rows[0][key]:null,last_primary_key:rows.length?rows.at(-1)[key]:null});
    return freeze(view);
  });
  const manifest={schema_version:environment==='PRODUCTION'?'WBS_READONLY_SNAPSHOT_V2':'WBS_READONLY_SNAPSHOT_V1',snapshot_id:snapshotId,captured_at:capturedAt,environment,source_system:'WBS',dictionary_version:dictionaryVersion,views};
  if(environment==='PRODUCTION')Object.assign(manifest,{delivery,detached_signature:detachedSignature});
  const hashInput=environment==='PRODUCTION'?Object.fromEntries(Object.entries(manifest).filter(([key])=>key!=='detached_signature')):manifest;
  return freeze({...manifest,package_hash:canonicalRequestHash(hashInput)});
}
