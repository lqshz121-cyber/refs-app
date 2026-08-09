// Maps an IT-delivered, read-only WBS table row into the formal MCP field
// contract. This module has no database, network, or WBS write capability.
// It deliberately rejects inferred bank keys and company/currency fallbacks.

const text=value=>value==null?'':String(value).trim();
const code=value=>{const candidate=text(value);return candidate&&candidate.length<=128&&!/[\u0000-\u001f\u007f]/.test(candidate)?candidate:null;};
const currency=value=>/^[A-Z]{3}$/.test(text(value).toUpperCase())?text(value).toUpperCase():null;
const date=value=>{const candidate=text(value);if(!/^\d{4}-\d{2}-\d{2}$/.test(candidate))return null;const parsed=new Date(`${candidate}T00:00:00.000Z`);return !Number.isNaN(parsed.getTime())&&parsed.toISOString().slice(0,10)===candidate?candidate:null;};
const optional=value=>code(value)??null;

export class WbsProviderReadonlyRowAdapterError extends Error {
  constructor(code,message){super(message);this.name='WbsProviderReadonlyRowAdapterError';this.code=code;}
}
const fail=(code,message)=>{throw new WbsProviderReadonlyRowAdapterError(code,message);};
const scopeOf=scope=>{
  const companyCode=code(scope?.company_code),scopeCurrency=currency(scope?.currency);
  if(!companyCode||!scopeCurrency)fail('WBS_PROVIDER_SCOPE_REQUIRED','A signed WBS extraction company and ISO currency scope are required.');
  return Object.freeze({company_code:companyCode,currency:scopeCurrency});
};
const sameCompany=(actual,scope,source)=>{
  if(code(actual)!==scope.company_code)fail('WBS_PROVIDER_COMPANY_SCOPE_MISMATCH',`${source} row company must equal the signed extraction scope.`);
};
const required=(row,field,source)=>{const value=code(row?.[field]);if(!value)fail('WBS_PROVIDER_STABLE_KEY_REQUIRED',`${source} requires its provider-delivered immutable ${field}.`);return value;};
const amount=value=>value==null?null:String(value);

// sourceTable names intentionally follow the observed WBS table names. The
// provider must bind the output rows into a signed MCP envelope separately.
export function mapWbsReadonlyProviderRow({sourceTable,row,scope}={}){
  if(!row||typeof row!=='object'||Array.isArray(row))fail('WBS_PROVIDER_ROW_INVALID','A WBS source row must be an object.');
  const selected=scopeOf(scope);
  switch(text(sourceTable)){
    case 'wbsdata.account_book_payable_info': {
      sameCompany(row.company_code,selected,'Payable');
      return Object.freeze({ap_guid:required(row,'uuid','Payable'),ap_long_id:optional(row.long_id),ap_type:optional(row.type),amount:amount(row.amount),invoice_no:optional(row.invoice_no),invoice_date:date(row.invoice_date),incurred_date:date(row.incurred_date),posting_date:date(row.posting_date),clear_date:date(row.clear_date),pay_due_date:date(row.pay_due_date),check_no:optional(row.check_no),check_date:date(row.check_date),check_amount:amount(row.check_amount),company_code:selected.company_code,company_name:optional(row.company_name),project_guid:null,pj_code:optional(row.project_code),cost_id:optional(row.cost_id),cost_ledger_id:optional(row.cost_ledger_id),cost_code:optional(row.cost_code),vendor_no:optional(row.vendor_no),vendor_name:optional(row.vendor),description:optional(row.description),business_id:optional(row.business_id),business_status:optional(row.business_status),pay_status:optional(row.pay_status),pay_type:optional(row.pay_type),review_status:optional(row.review_status),journal_no:optional(row.journal_no),cb_id:optional(row.cb_id),bank_account_ref:null,currency:selected.currency});
    }
    case 'wbsdata.fast_auto_payment_detail': {
      // Detail rows do not provide a verified company/currency key suitable
      // for AutoRec admission. The signed provider extraction scope supplies
      // that boundary; raw company values are retained only as trace.
      return Object.freeze({pd_guid:required(row,'pd_guid','AutoRec Detail'),pd_pv_guid:optional(row.pd_pvguid),batch_guid:optional(row.pd_batchguid),cb_id:optional(row.pd_cbid),match_guid:optional(row.pd_match_guid),match_status:optional(row.pd_match_status),biz_type:optional(row.pd_biz_type),deposit:amount(row.pd_deposit),payment:amount(row.pd_payment),project_guid:optional(row.pd_pjguid),cost_code:optional(row.pd_cost_code),vendor_no:optional(row.pd_vendor_no),clear_date:date(row.pd_clear_date),incurred_date:date(row.pd_incurred_date),posting_date:null,released_date:date(row.pd_released_date),released_by:optional(row.pd_released_user_name),status:optional(row.pd_status),data_source:optional(row.pd_data_source),company_code:selected.company_code,currency:selected.currency,detail_company_trace:optional(row.pd_company),owner_company_trace:optional(row.pd_owner_company_code)});
    }
    case 'wbsdata.autopaymentbank': {
      sameCompany(row.PB_CompanyCode,selected,'AutoRec Bank');
      return Object.freeze({pb_guid:required(row,'PB_GuId','AutoRec Bank'),company_code:selected.company_code,company_name:optional(row.PB_CompanyName),ah_id:optional(row.PB_AhId),ah_name:optional(row.PB_AhName),quantity:amount(row.PB_Quantity),pay_amount:amount(row.PB_PayAmount),debit_amount:amount(row.PB_DebitAmount),released:amount(row.PB_Released),incurred:amount(row.PB_Incurred),reconciliation_start_date:date(row.PB_StartTransactionDate),status:optional(row.PB_Status),currency:selected.currency,match_month:optional(row.PB_MatchMonth),review_month:optional(row.PB_ReviewMonth),closed_month:optional(row.PB_ClosedMonth)});
    }
    case 'accounting.accounting_info': {
      sameCompany(row.com_code,selected,'Accounting journal');
      if(!Number.isSafeInteger(row.id))fail('WBS_PROVIDER_STABLE_KEY_REQUIRED','Accounting journal evidence requires its immutable numeric id.');
      return Object.freeze({id:row.id,cb_id:optional(row.cb_id),business_guid:optional(row.business_guid),company:selected.company_code,account:optional(row.account),account_code:optional(row.account_code),debtor:amount(row.debtor),lender:amount(row.lender),posting_date:date(row.posting_date),set_date:date(row.set_date),journal_no:optional(row.journal_no),bill_no:optional(row.bill_no),check_no:optional(row.check_no),check_date:date(row.check_date),clear_date:date(row.clear_date),come_from:optional(row.come_from),source:optional(row.source),project:optional(row.project),pj_code:optional(row.pj_code),cost_code:optional(row.cost_code),review:optional(row.review),reviewer:optional(row.reviewer),closed:optional(row.closed),currency:selected.currency});
    }
    case 'accounting.bank_transaction_result': {
      // accounting_info.id and cb_id are journal/relation locators. A
      // transaction producer is admissible only when WBS returns an explicit
      // immutable bank_transaction_id in the signed result row.
      sameCompany(row.company_code??row.com_code,selected,'Bank Transaction');
      return Object.freeze({bank_transaction_id:required(row,'bank_transaction_id','Bank Transaction'),cb_id:optional(row.cb_id),company_code:selected.company_code,currency:selected.currency,account_code:optional(row.account_code),debtor:amount(row.debtor),lender:amount(row.lender),set_date:date(row.set_date),posting_date:date(row.posting_date),payee:optional(row.payee),payee_no:optional(row.payee_no),description:optional(row.description),ref_no:optional(row.ref_no),come_from:optional(row.come_from),journal_no:optional(row.journal_no)});
    }
    default: fail('WBS_PROVIDER_SOURCE_UNSUPPORTED','The WBS source table is not admitted by the read-only accounting adapter.');
  }
}

// Some accounting evidence is visible only in a WBS read result, rather than
// its underlying base table.  This seam deliberately accepts only a small,
// immutable-key-bound supplement.  The caller still has to place the merged
// row in a signed WBS envelope before REFS can persist it.
export function mergeWbsReadonlyResultEvidence({sourceTable,row,resultRow,scope}={}){
  const mapped=mapWbsReadonlyProviderRow({sourceTable,row,scope});
  if(!resultRow||typeof resultRow!=='object'||Array.isArray(resultRow))fail('WBS_PROVIDER_RESULT_ROW_INVALID','A WBS result evidence row must be an object.');
  const selected=scopeOf(scope),resultCompany=code(resultRow.company_code??resultRow.company);
  if(resultCompany&&resultCompany!==selected.company_code)fail('WBS_PROVIDER_COMPANY_SCOPE_MISMATCH','WBS result evidence company must equal the signed extraction scope.');
  const resultCurrency=currency(resultRow.currency);
  if(resultCurrency&&resultCurrency!==selected.currency)fail('WBS_PROVIDER_CURRENCY_SCOPE_MISMATCH','WBS result evidence currency must equal the signed extraction scope.');
  if(text(sourceTable)==='wbsdata.fast_auto_payment_detail'){
    if(required(resultRow,'pd_guid','AutoRec Detail')!==mapped.pd_guid)fail('WBS_PROVIDER_RESULT_KEY_MISMATCH','AutoRec Detail result evidence must bind the same immutable pd_guid.');
    const posting=date(resultRow.posting_date);
    if(!posting)fail('WBS_PROVIDER_RESULT_FIELD_REQUIRED','AutoRec Detail result evidence requires an exact Posting Date.');
    return Object.freeze({...mapped,posting_date:posting,posting_date_source:'SIGNED_RESULT_ROW'});
  }
  if(text(sourceTable)==='wbsdata.autopaymentbank'){
    if(required(resultRow,'pb_guid','AutoRec Bank')!==mapped.pb_guid)fail('WBS_PROVIDER_RESULT_KEY_MISMATCH','AutoRec Bank result evidence must bind the same immutable pb_guid.');
    const releasedQuantity=amount(resultRow.released_quantity);
    if(releasedQuantity===null||!/^-?(?:0|[1-9]\d*)(?:\.\d{1,4})?$/.test(releasedQuantity))fail('WBS_PROVIDER_RESULT_FIELD_REQUIRED','AutoRec Bank result evidence requires an exact released_quantity.');
    return Object.freeze({...mapped,released_quantity:releasedQuantity,released_quantity_source:'SIGNED_RESULT_ROW'});
  }
  fail('WBS_PROVIDER_RESULT_SOURCE_UNSUPPORTED','Only AutoRec Detail and AutoRec Bank result evidence may supplement observed WBS base rows.');
}
