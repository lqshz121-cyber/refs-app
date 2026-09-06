const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const revision=v=>typeof v==='string'&&/^(0|[1-9]\d{0,18})$/.test(v)&&BigInt(v)<=9223372036854775807n;
const text=v=>typeof v==='string'&&v.length>0&&v===v.trim()&&!/[\u0000-\u001f\u007f]/.test(v);
const date=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
const money=v=>typeof v==='string'&&/^-?(0|[1-9]\d{0,39})\.\d{4}$/.test(v)&&v!=='-0.0000';
const units=v=>BigInt(v.replace('.',''));
export const validCreditAction=action=>['AP_CREDIT_APPLY','AR_CREDIT_APPLY','AR_REFUND'].includes(action);
export function validCreditUsageContext(v,{entityId,action,businessAdjustmentId,periodId}){
  if(!validCreditAction(action)||!exact(v,['schema_version','entity_id','action','period','credit','allocated_amount','refund_amount','available_amount'])
    ||v.schema_version!=='CREDIT_USAGE_CONTEXT_V1'||v.entity_id!==entityId||v.action!==action)return false;
  const p=v.period,c=v.credit;
  if(!exact(p,['period_id','starts_on','ends_on','status','revision'])||p.period_id!==periodId||!date(p.starts_on)||!date(p.ends_on)||p.starts_on>p.ends_on
    ||!['OPEN','SOFT_CLOSED','CLOSED'].includes(p.status)||!revision(p.revision)
    ||!exact(c,['business_adjustment_id','adjustment_kind','journal_entry_id','number','counterparty_ref','currency','amount','revision'])
    ||c.business_adjustment_id!==businessAdjustmentId||!uuid(c.journal_entry_id)||c.adjustment_kind!==(action==='AP_CREDIT_APPLY'?'AP_VENDOR_CREDIT':'AR_CREDIT_MEMO')
    ||!text(c.number)||!text(c.counterparty_ref)||typeof c.currency!=='string'||!/^[A-Z]{3}$/.test(c.currency)||!revision(c.revision)
    ||![c.amount,v.allocated_amount,v.refund_amount,v.available_amount].every(money))return false;
  const amount=units(c.amount),allocated=units(v.allocated_amount),refund=units(v.refund_amount);
  return amount>0n&&allocated>=0n&&refund>=0n&&(action!=='AP_CREDIT_APPLY'||refund===0n)&&amount-allocated-refund===units(v.available_amount);
}

export const validRefundKind=kind=>kind==='AR_REFUND';
export {validSettlementBankKind as validRefundBankKind,validSettlementBankPage as validRefundBankPage} from './native-settlement-contract.js';
export const validRefundContext=(value,{entityId,settlementKind,sourceAdjustmentId,periodId})=>validRefundKind(settlementKind)&&validCreditUsageContext(value,{entityId,action:settlementKind,businessAdjustmentId:sourceAdjustmentId,periodId});
export const refundContextAvailable=value=>value?.period?.status==='OPEN'&&typeof value.available_amount==='string'&&/^(0|[1-9]\d*)\.\d{4}$/.test(value.available_amount)&&BigInt(value.available_amount.replace('.',''))>0n;
