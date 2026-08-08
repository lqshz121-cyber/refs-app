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
const isoDate=value=>{const candidate=text(value);if(!/^\d{4}-\d{2}-\d{2}$/.test(candidate))return false;const parsed=new Date(`${candidate}T00:00:00.000Z`);return !Number.isNaN(parsed.getTime())&&parsed.toISOString().slice(0,10)===candidate;};
const validCurrency=value=>/^[A-Z]{3}$/.test(text(value).toUpperCase());
const validPeriod=value=>/^\d{4}-(0[1-9]|1[0-2])$/.test(text(value));
const scopedCurrency=(accepted,row)=>text(row.currency??accepted.scope.currency).toUpperCase()||null;
const payableTrace=row=>freeze(Object.fromEntries([
  ['ap_long_id',row.ap_long_id],['ap_type',row.ap_type],['business_status',row.business_status],['pay_status',row.pay_status],['pay_type',row.pay_type],
  ['posting_date',row.posting_date],['journal_no',row.journal_no],['check_no',row.check_no],['check_date',row.check_date],['clear_date',row.clear_date],
  ['bank_relation_ref',row.cb_id],['cost_ledger_ref',row.cost_ledger_id],['vendor_name',row.vendor_name],['project_code',row.pj_code]
].filter(([,value])=>text(value)!=='').map(([key,value])=>[key,text(value)])));
const bankTrace=row=>freeze(Object.fromEntries([
  ['transaction_date',row.set_date],['account_code',row.account_code],['payee',row.payee],['payee_no',row.payee_no],['memo',row.description],
  ['come_from',row.come_from],['child_come_from',row.child_come_from],['review_status',row.review],['statistical_business',row.statistical_business],['turn_flag',row.turn_flag]
].filter(([,value])=>text(value)!=='').map(([key,value])=>[key,text(value)])));
const autoRecDetailTrace=row=>freeze(Object.fromEntries([
  ['batch_guid',row.batch_guid],['biz_type',row.biz_type],['clear_date',row.clear_date],['incurred_date',row.incurred_date],['released_date',row.released_date],['released_by',row.released_by],
  ['data_source',row.data_source],['status',row.status],['match_status',row.match_status],['match_ref',row.match_guid],['bank_relation_ref',row.cb_id],['autoc_relation_ref',row.pd_pv_guid],
  ['vendor_ref',row.vendor_no],['project_ref',row.project_guid],['cost_code_ref',row.cost_code]
].filter(([,value])=>text(value)!=='').map(([key,value])=>[key,text(value)])));

export class WbsMcpLineageError extends Error {
  constructor(code,message){super(message);this.name='WbsMcpLineageError';this.code=code;}
}

function controlReceipt(value,contentSha){
  if(!value||typeof value!=='object'||text(value.hash)!==`sha256:${contentSha}`||!text(value.ref)||!text(value.version)||!text(value.verification_id)||!text(value.key_id)||!text(value.algorithm)||!isoDate(text(value.verified_on).slice(0,10)))throw new WbsMcpLineageError('WBS_MCP_CONTROL_RECEIPT_REQUIRED','AutoRec Bank controls require a verified receipt bound to this envelope hash, reference, version, key, algorithm, verification id, and date.');
  return freeze({hash:text(value.hash),ref:text(value.ref),version:text(value.version),verification_id:text(value.verification_id),key_id:text(value.key_id),algorithm:text(value.algorithm),verified_on:text(value.verified_on)});
}

// WBS PB fields are observed but their global business formula is not proven.
// This accepts a control total only when the provider explicitly attests that
// the supplied PB page is a ROW_SUM population for one company/currency/period
// and bank account. It remains control evidence, never a match or posting path.
export function buildWbsAutoRecBankControlEvidence({envelope,control}={}){
  const accepted=validateWbsReadEnvelope({toolName:envelope?.tool,envelope});
  if(accepted.tool_name!=='list_autorec_banks')throw new WbsMcpLineageError('WBS_MCP_CONTROL_TOOL_INVALID','AutoRec Bank control evidence requires the list_autorec_banks envelope.');
  if(!control||typeof control!=='object'||!control.scope||!control.formula||!control.totals)throw new WbsMcpLineageError('WBS_MCP_CONTROL_INPUT_REQUIRED','AutoRec Bank control scope, formula, totals, and verified receipt are required.');
  const receipt=controlReceipt(control.receipt,accepted.content_sha256);
  const scope={company_key:text(control.scope.company_key),currency:text(control.scope.currency).toUpperCase(),period:text(control.scope.period),bank_account_ref:text(control.scope.bank_account_ref)};
  if(!scope.company_key||!validCurrency(scope.currency)||!validPeriod(scope.period)||!scope.bank_account_ref||scope.company_key!==text(accepted.scope.company)||(text(accepted.scope.currency)&&text(accepted.scope.currency).toUpperCase()!==scope.currency))throw new WbsMcpLineageError('WBS_MCP_CONTROL_SCOPE_INVALID','AutoRec Bank control scope must exactly bind company, currency, period, and bank account to the envelope scope.');
  const formula={formula_id:text(control.formula.formula_id),version:text(control.formula.version),aggregation:text(control.formula.aggregation)};
  if(!formula.formula_id||!formula.version||formula.aggregation!=='ROW_SUM')throw new WbsMcpLineageError('WBS_MCP_CONTROL_FORMULA_REQUIRED','AutoRec Bank controls require an explicit provider ROW_SUM formula id and version.');
  if(!accepted.rows.length||accepted.rows.some(row=>text(row.company_code)!==scope.company_key||text(row.ah_id)!==scope.bank_account_ref))throw new WbsMcpLineageError('WBS_MCP_CONTROL_SCOPE_INVALID','Every AutoRec Bank row must belong to the attested company and bank account scope.');
  const fields=Object.freeze({quantity:'quantity',released_quantity:'released_quantity',pay_amount:'pay_amount',released_amount:'released',incurred_amount:'incurred',debit_amount:'debit_amount'});
  const calculated={};
  for(const [target,field] of Object.entries(fields)){
    const values=accepted.rows.map(row=>money(row[field]));
    if(values.some(value=>value===null))throw new WbsMcpLineageError('WBS_MCP_CONTROL_TOTALS_INVALID',`AutoRec Bank ${field} must be a finite decimal for ROW_SUM controls.`);
    calculated[target]=Number(values.reduce((sum,value)=>sum+value,0).toFixed(4));
    if(money(control.totals[target])===null||money(control.totals[target])!==calculated[target])throw new WbsMcpLineageError('WBS_MCP_CONTROL_TOTALS_INVALID',`Provider AutoRec Bank ${target} does not equal the attested ROW_SUM population.`);
  }
  return freeze({source_type:'AUTOREC_BANK_CONTROL',status:'CONTROL_EVIDENCE_READY',scope:freeze(scope),formula:freeze(formula),receipt,control_totals:freeze(calculated),row_count:accepted.rows.length,forward_trace:freeze({mcp_tool:accepted.tool_name,receipt_hash:receipt.hash,receipt_ref:receipt.ref,receipt_version:receipt.version,formula_id:formula.formula_id,formula_version:formula.version}),reverse_trace:freeze({company_key:scope.company_key,currency:scope.currency,period:scope.period,bank_account_ref:scope.bank_account_ref,source_row_keys:freeze(accepted.rows.map(row=>text(row.pb_guid)))}),can_create_transaction:false,can_allocate:false,can_release:false,can_incur:false,can_create_draft:false,can_post:false});
}

function sorted(rows,key){return rows.every((row,index)=>index===0||text(rows[index-1][key])<text(row[key]));}
function signedMovement(row,credit,debit,creditDirection='CREDIT',debitDirection='DEBIT'){
  const credited=money(row[credit]),debited=money(row[debit]);
  if((credited!==null&&credited!==0)&&(debited!==null&&debited!==0))return null;
  if(credited!==null&&credited!==0)return freeze({amount:creditDirection==='CREDIT'?Math.abs(credited):-Math.abs(credited),direction:creditDirection});
  if(debited!==null&&debited!==0)return freeze({amount:debitDirection==='CREDIT'?Math.abs(debited):-Math.abs(debited),direction:debitDirection});
  return null;
}

function bankDirectionRules(accepted,conventions){
  if(conventions==null)return new Map();
  if(!Array.isArray(conventions)||!conventions.length)throw new WbsMcpLineageError('WBS_MCP_BANK_DIRECTION_CONVENTION_REQUIRED','Bank Transaction admission requires one receipt-bound direction convention for every selected bank account.');
  const rules=new Map();
  for(const convention of conventions){
    const scope=convention?.scope||{},companyKey=text(scope.company_key),currency=text(scope.currency).toUpperCase(),account=text(scope.bank_account_ref);
    const receipt=controlReceipt(convention?.receipt,accepted.content_sha256);
    const debtorDirection=text(convention?.debtor_direction).toUpperCase(),lenderDirection=text(convention?.lender_direction).toUpperCase();
    const ruleId=text(convention?.rule_id),version=text(convention?.version);
    if(!companyKey||!validCurrency(currency)||!account||companyKey!==text(accepted.scope.company)||(text(accepted.scope.currency)&&currency!==text(accepted.scope.currency).toUpperCase())||!ruleId||!version||!['DEBIT','CREDIT'].includes(debtorDirection)||!['DEBIT','CREDIT'].includes(lenderDirection)||debtorDirection===lenderDirection||rules.has(account))throw new WbsMcpLineageError('WBS_MCP_BANK_DIRECTION_CONVENTION_INVALID','Every Bank Transaction direction convention must have one exact company/currency/account scope, receipt-bound rule id/version, and opposite debtor/lender directions.');
    rules.set(account,freeze({rule_id:ruleId,version,debtor_direction:debtorDirection,lender_direction:lenderDirection,receipt}));
  }
  return rules;
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
    // WBS provides no revision. Use the canonical row hash as the observed
    // immutable version: a change elsewhere in the paged envelope must not
    // create a false new version for an unchanged source row. The envelope
    // hash remains separately bound as the receipt provenance.
    source_version:`observed:${hash(row).slice(7)}`,
    company_key:text(row.company_code||row.company||accepted.scope.company),
    receipt_hash:`sha256:${accepted.content_sha256}`,receipt_captured_at:accepted.captured_at,
    receipt_ref:null,raw_row_hash:hash(row),can_create_draft:false,can_allocate:false,can_post:false
  };
}

function transactionAdmission({common,amountValue,currency,dateValue,bankAccountRequired=false,movementRequired=false,movement=null}){
  const missing=[];
  if(!text(common.source_record_id))missing.push('immutable_source_key');
  if(!text(common.company_key))missing.push('company');
  if(money(amountValue)===null||money(amountValue)===0)missing.push('nonzero_amount');
  if(!validCurrency(currency))missing.push('currency');
  if(!isoDate(dateValue))missing.push('business_date');
  if(bankAccountRequired&&!text(common.bank_account_ref))missing.push('bank_account_ref');
  if(movementRequired&&!movement)missing.push('unambiguous_direction');
  return missing.length?freeze({admission:'EXCEPTION_REVIEW_REQUIRED',exception_code:missing.includes('unambiguous_direction')?'WBS_MCP_AMOUNT_DIRECTION_REQUIRED':'WBS_MCP_TRANSACTION_FIELDS_REQUIRED',missing:freeze(missing)}):freeze({admission:'TRANSACTION_CANDIDATE',exception_code:null,missing:freeze([])});
}

export function mapWbsMcpEnvelopeToInbound({envelope,bankDirectionConventions=null}={}){
  const accepted=validateWbsReadEnvelope({toolName:envelope?.tool,envelope});
  const tool=accepted.tool_name,rows=[],bankRules=tool==='list_bank_transactions'?bankDirectionRules(accepted,bankDirectionConventions):new Map();
  for(const row of accepted.rows){
    const common=commonRow({tool,accepted,row});
    if(tool==='list_payables'){
      const currency=scopedCurrency(accepted,row),businessDate=row.incurred_date||row.posting_date||null,admission=transactionAdmission({common,amountValue:row.amount,currency,dateValue:businessDate});
      rows.push(freeze({...common,...admission,business_date:businessDate,posting_date:row.posting_date||null,amount:money(row.amount),currency,vendor_ref:row.vendor_no||null,project_ref:row.project_guid||null,cost_ref:row.cost_id||null,payable_link:row.ap_long_id||null,journal_trace:row.journal_no||null,payable_trace:payableTrace(row),can_use_trace_as_key:false,can_use_trace_as_posting_authority:false}));
    }
    else if(tool==='list_bank_transactions'){
      const directionRule=bankRules.get(text(row.account_code)),movement=directionRule?signedMovement(row,'lender','debtor',directionRule.lender_direction,directionRule.debtor_direction):null;
      const currency=scopedCurrency(accepted,row),bankCommon={...common,bank_account_ref:row.account_code||null},admission=transactionAdmission({common:bankCommon,amountValue:movement?.amount,currency,dateValue:row.set_date,bankAccountRequired:true,movementRequired:true,movement});
      rows.push(freeze({...bankCommon,...admission,exception_code:!directionRule?'WBS_MCP_BANK_DIRECTION_CONVENTION_REQUIRED':admission.exception_code,amount:movement?.amount??null,direction:movement?.direction??null,currency,bank_direction_rule:directionRule?freeze({rule_id:directionRule.rule_id,version:directionRule.version,receipt_hash:directionRule.receipt.hash}):null,bank_trace_ref:row.cb_id,raw_memo:row.description||null,autoc_relation:row.come_from||null,bank_trace:bankTrace(row),can_use_trace_as_key:false,can_use_trace_as_posting_authority:false}));
    } else if(tool==='list_autorec_details'){
      const movement=signedMovement(row,'deposit','payment');
      const currency=scopedCurrency(accepted,row),businessDate=row.incurred_date||row.clear_date||null,admission=transactionAdmission({common,amountValue:movement?.amount,currency,dateValue:businessDate,movementRequired:true,movement});
      rows.push(freeze({...common,...admission,admission:admission.admission==='TRANSACTION_CANDIDATE'?'AUTOREC_REVIEW_EVIDENCE':admission.admission,amount:movement?.amount??null,direction:movement?.direction??null,currency,business_date:businessDate,bank_trace_ref:row.cb_id||null,autoc_bank_ref:row.pd_pv_guid||null,match_ref:row.match_guid||null,project_ref:row.project_guid||null,cost_ref:row.cost_code||null,vendor_ref:row.vendor_no||null,autorc_detail_trace:autoRecDetailTrace(row),can_use_trace_as_key:false,can_use_trace_as_state_authority:false,can_use_trace_as_posting_authority:false}));
    } else if(tool==='list_autorec_banks'){
      // These are observed WBS controls, not a transaction feed. The provider
      // contract does not yet prove period/currency/field semantics, so retain
      // the values and receipt lineage without permitting reconciliation or a
      // journal path.
      rows.push(freeze({...common,admission:'CONTROL_EVIDENCE_ONLY',control_type:'WBS_AUTOREC_BANK_SUMMARY',control_semantics:'OBSERVED_UNVERIFIED',bank_summary_id:text(row.pb_guid),bank_account_name:row.ah_name||null,bank_account_ref:row.ah_id||null,reconciliation_start_date:row.reconciliation_start_date||null,status:row.status||null,quantity:money(row.quantity),released_quantity:money(row.released_quantity),pay_amount:money(row.pay_amount),released_amount:money(row.released),incurred_amount:money(row.incurred),debit_amount:money(row.debit_amount),can_reconcile:false,can_create_draft:false,can_allocate:false,can_post:false}));
    } else if(tool==='list_journal_entries'){
      const movement=signedMovement(row,'lender','debtor');
      const traceComplete=Boolean(text(row.journal_no)&&text(row.account)&&isoDate(row.posting_date)&&movement);
      rows.push(freeze({...common,admission:'TRACE_EVIDENCE_ONLY',trace_type:'WBS_JOURNAL_LEDGER_EVIDENCE',trace_completeness:traceComplete?'TRACE_COMPLETE':'TRACE_INCOMPLETE',journal_entry_id:row.id,journal_no:row.journal_no||null,posting_date:row.posting_date||null,account_ref:row.account||null,amount:movement?.amount??null,direction:movement?.direction??null,bank_source_ref:row.cb_id||null,payable_ref:row.bill_no||null,project_ref:row.pj_code||row.project||null,cost_ref:row.cost_code||null,source_relation:row.come_from||null,review_status:row.review||null,reviewer:row.reviewer||null,can_create_transaction:false,can_reconcile:false,can_create_draft:false,can_allocate:false,can_post:false}));
    } else rows.push(freeze({...common,admission:'CONTROL_OR_TRACE_ONLY',fields:freeze(structuredClone(row))}));
  }
  return freeze({tool_name:tool,required_fields:WBS_READONLY_ROW_FIELDS[tool]??freeze([]),rows:freeze(rows),receipt_required_for_persistence:true,can_create_draft:false,can_allocate:false,can_post:false});
}

const snapshotView=Object.freeze({list_payables:'BGDATA.payable',list_bank_transactions:'BGDATA.bank_transaction',list_autorec_details:'BGDATA.autoc_detail'});
const snapshotPrimaryKey=Object.freeze({list_payables:'apGuId',list_bank_transactions:'cashOrBankBookId',list_autorec_details:'pdGuId'});
const uuid=value=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text(value));
const iso=value=>typeof value==='string'&&!Number.isNaN(Date.parse(value));

function mcpProvenance(accepted,row){return freeze({mcp_tool:accepted.tool_name,mcp_content_sha256:`sha256:${accepted.content_sha256}`,mcp_row_hash:hash(row),mcp_captured_at:accepted.captured_at});}
function snapshotRow(accepted,row,bankRules){
  const provenance=mcpProvenance(accepted,row);
  if(accepted.tool_name==='list_payables')return freeze({...provenance,apGuId:text(row.ap_guid),currency:scopedCurrency(accepted,row),amount:money(row.amount),invoice_date:row.incurred_date||row.posting_date||null,posting_date:row.posting_date||null,description:row.description||null,vendor_ref:row.vendor_no||null,project_ref:row.project_guid||null,cost_code_ref:row.cost_id||null,external_trace:payableTrace(row),can_use_trace_as_key:false,can_use_trace_as_posting_authority:false});
  if(accepted.tool_name==='list_bank_transactions'){
    const directionRule=bankRules?.get(text(row.account_code)),movement=directionRule?signedMovement(row,'lender','debtor',directionRule.lender_direction,directionRule.debtor_direction):null;
    return freeze({...provenance,cashOrBankBookId:text(row.cb_id),bank_account_ref:row.account_code||null,currency:scopedCurrency(accepted,row),amount:movement?.amount??null,transaction_date:row.set_date||null,direction:movement?.direction??null,bank_direction_rule:directionRule?freeze({rule_id:directionRule.rule_id,version:directionRule.version,receipt_hash:directionRule.receipt.hash}):null,description:row.description||null,come_from:row.come_from||null,external_trace:bankTrace(row),can_use_trace_as_key:false,can_use_trace_as_posting_authority:false});
  }
  const movement=signedMovement(row,'deposit','payment');
  // pd_pv_guid is observed as a relation navigation value, not a verified
  // pb_guid. Leave pbGuId absent so the existing staging gate quarantines it.
  return freeze({...provenance,pdGuId:text(row.pd_guid),currency:scopedCurrency(accepted,row),amount:movement?.amount??null,payment_date:row.incurred_date||row.clear_date||null,direction:movement?.direction??null,autoc_relation_ref:row.pd_pv_guid||null,vendor_ref:row.vendor_no||null,project_ref:row.project_guid||null,cost_code_ref:row.cost_code||null,external_trace:autoRecDetailTrace(row),can_use_trace_as_key:false,can_use_trace_as_state_authority:false,can_use_trace_as_posting_authority:false});
}

// Creates a receipt-bearing snapshot package that the existing REFS inbound
// adapter can consume. It accepts only transaction-producer views; report and
// control views must flow through their control-reconciliation path instead.
// It deliberately does not manufacture a pb_guid from pd_pv_guid.
export function buildWbsMcpReadonlySnapshot({envelopes,snapshotId,dictionaryVersion,environment='SANDBOX',delivery=null,detachedSignature=null,bankDirectionConventions=null}={}){
  if(!uuid(snapshotId)||typeof dictionaryVersion!=='string'||!dictionaryVersion.trim()||!Array.isArray(envelopes)||envelopes.length===0)throw new WbsMcpLineageError('WBS_MCP_SNAPSHOT_INPUT_INVALID','Snapshot id, dictionary version, and formal MCP envelopes are required.');
  if(!['SANDBOX','PRODUCTION'].includes(environment))throw new WbsMcpLineageError('WBS_MCP_SNAPSHOT_INPUT_INVALID','Snapshot environment is invalid.');
  const accepted=envelopes.map(envelope=>validateWbsReadEnvelope({toolName:envelope?.tool,envelope}));
  if(accepted.some(item=>!snapshotView[item.tool_name]))throw new WbsMcpLineageError('WBS_MCP_CONTROL_VIEW_NOT_TRANSACTIONAL','Control, journal, and trace MCP views cannot form a transaction snapshot.');
  if(new Set(accepted.map(item=>item.tool_name)).size!==accepted.length)throw new WbsMcpLineageError('WBS_MCP_SNAPSHOT_VIEW_DUPLICATE','A snapshot may contain one envelope per transaction producer view.');
  const company=text(accepted[0].scope.company),capturedAt=accepted[0].captured_at;
  if(!company||accepted.some(item=>text(item.scope.company)!==company||item.captured_at!==capturedAt))throw new WbsMcpLineageError('WBS_MCP_SNAPSHOT_SCOPE_INVALID','Formal MCP transaction envelopes require one company scope and captured-at timestamp.');
  const bankEnvelope=accepted.find(item=>item.tool_name==='list_bank_transactions');
  const bankRules=bankEnvelope?bankDirectionRules(bankEnvelope,bankDirectionConventions):new Map();
  if(bankEnvelope&&bankEnvelope.rows.some(row=>!bankRules.has(text(row.account_code))))throw new WbsMcpLineageError('WBS_MCP_BANK_DIRECTION_CONVENTION_REQUIRED','Every selected Bank Transaction account requires a receipt-bound direction convention before snapshot admission.');
  for(const item of accepted){const key=stableKey[item.tool_name];if(!sorted(item.rows,key))throw new WbsMcpLineageError('WBS_MCP_ROWS_NOT_SORTED','WBS rows must be ascending by their stable source key.');}
  if(environment==='PRODUCTION'&&(!delivery||!detachedSignature))throw new WbsMcpLineageError('WBS_MCP_SNAPSHOT_SIGNATURE_REQUIRED','Production MCP snapshots require complete delivery evidence and a detached signature.');
  const views=accepted.map(item=>{
    const rows=item.rows.map(row=>snapshotRow(item,row,item.tool_name==='list_bank_transactions'?bankRules:null));
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
