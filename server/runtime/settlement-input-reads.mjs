const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const text=(value,max,empty=false)=>typeof value==='string'&&value===value.trim()&&value.length<=max&&(empty||value.length>0)&&!/[\u0000-\u001f\u007f]/.test(value);
const compare=(left,right)=>Buffer.compare(Buffer.from(left,'utf8'),Buffer.from(right,'utf8'));
export const validSettlementKind=kind=>['AP_PAYMENT','AR_RECEIPT'].includes(kind);
export const validSettlementBankSelection=({settlementKind,query='',afterRef=null,limit=50})=>validSettlementKind(settlementKind)
  &&text(query,128,true)&&(afterRef===null||text(afterRef,128))&&Number.isInteger(limit)&&limit>=1&&limit<=100;

export function validSettlementBankPage(value,{entityId,settlementKind,query='',afterRef=null,limit=50}){
  if(!validSettlementBankSelection({settlementKind,query,afterRef,limit})
    ||!exact(value,['schema_version','entity_id','settlement_kind','query','after_ref','limit','rows','next_ref'])
    ||value.schema_version!=='SETTLEMENT_BANK_MEMBERS_V1'||value.entity_id!==entityId||value.settlement_kind!==settlementKind
    ||value.query!==query||value.after_ref!==afterRef||value.limit!==limit||!Array.isArray(value.rows)||value.rows.length>limit)return false;
  let previous=afterRef;
  for(const row of value.rows){
    if(!exact(row,['member_ref','member_type','display_name'])||!text(row.member_ref,128)||!text(row.display_name,Infinity)
      ||row.member_type!=='BANK'||previous!==null&&compare(previous,row.member_ref)>=0)return false;
    previous=row.member_ref;
  }
  return value.next_ref===null||value.rows.length===limit&&value.next_ref===previous;
}

const date=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
const revision=value=>typeof value==='string'&&/^(0|[1-9]\d{0,18})$/.test(value)&&BigInt(value)<=9223372036854775807n;
const money=value=>typeof value==='string'&&/^-?(0|[1-9]\d{0,39})\.\d{4}$/.test(value)&&value!=='-0.0000';
const units=value=>BigInt(value.replace('.',''));

export function validSettlementContext(value,{entityId,settlementKind,businessDocumentId,periodId}){
  if(!validSettlementKind(settlementKind)||!exact(value,['schema_version','entity_id','settlement_kind','payment_period','document','pending_allocation_amount','available_amount','can_create_draft'])
    ||value.schema_version!=='SETTLEMENT_CONTEXT_V1'||value.entity_id!==entityId||value.settlement_kind!==settlementKind)return false;
  const p=value.payment_period,d=value.document;
  if(!exact(p,['period_id','starts_on','ends_on','status','revision'])||p.period_id!==periodId
    ||!date(p.starts_on)||!date(p.ends_on)||p.starts_on>p.ends_on||!['OPEN','SOFT_CLOSED','CLOSED'].includes(p.status)||!revision(p.revision)
    ||!exact(d,['business_document_id','document_kind','document_number','counterparty_ref','counterparty_name','currency','accounting_date','due_date','status','revision','open_balance'])
    ||d.business_document_id!==businessDocumentId||d.document_kind!==(settlementKind==='AP_PAYMENT'?'AP_BILL':'AR_INVOICE')
    ||!text(d.document_number,128)||!text(d.counterparty_ref,128)||!text(d.counterparty_name,255)||typeof d.currency!=='string'||!/^[A-Z]{3}$/.test(d.currency)
    ||!date(d.accounting_date)||d.due_date!==null&&!date(d.due_date)||!revision(d.revision)
    ||!['DRAFT','PENDING_POST','APPROVED','OPEN','PARTIALLY_PAID','PAID','VOID','REVERSED'].includes(d.status)
    ||!money(d.open_balance)||!money(value.pending_allocation_amount)||!money(value.available_amount))return false;
  const open=units(d.open_balance),pending=units(value.pending_allocation_amount),available=units(value.available_amount);
  if(open<0n||pending<0n||open-pending!==available)return false;
  const eligible=p.status==='OPEN'&&available>0n&&(settlementKind==='AP_PAYMENT'?['APPROVED','OPEN','PARTIALLY_PAID']:['OPEN','PARTIALLY_PAID']).includes(d.status);
  return value.can_create_draft===eligible;
}
