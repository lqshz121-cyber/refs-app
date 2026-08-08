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
