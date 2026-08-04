const clone = value => structuredClone(value);
const failure = (code, message) => ({ok:false, code, message, nextDocument:null, draftJE:null});

function guard({document, permission, can, period, sourceSystem, sourceDocId, existingJEs=[]}) {
  if (!document) return failure('AR_DOCUMENT_NOT_FOUND', 'AR document no longer exists.');
  if (!can(permission)) return failure('AR_PERMISSION_DENIED', `Missing permission ${permission}.`);
  if (!period) return failure('PERIOD_NOT_CONFIGURED', `Period ${document.period_code || ''} is not configured.`);
  const accountingDate=document.accounting_date || document.inv_date || document.payment_date;
  if(!accountingDate || String(accountingDate).slice(0,7)!==document.period_code || period.period_code!==document.period_code)return failure('PERIOD_DATE_MISMATCH','Accounting date must belong to the document-owned period.');
  if (period.status !== 'OPEN') return failure('4005', `Period ${period.period_code || document.period_code || ''} is not open.`);
  if (!Number.isFinite(+document.amount) || +document.amount <= 0) return failure('AR_AMOUNT_INVALID', 'Amount must be greater than zero.');
  if (!sourceDocId) return failure('AR_SOURCE_REQUIRED', 'source_doc_id is required.');
  if (existingJEs.some(je => je.source_system === sourceSystem && je.source_doc_id === sourceDocId && je.posting_status !== 'REVERSED')) {
    return failure('AR_DUPLICATE_SOURCE', 'An active journal entry already exists for this AR source.');
  }
  return null;
}

function makeDraft({invoice,user,jeId,jeNumber,sourceSystem,sourceDocId,sourceObjectType,sourceObjectId,ruleCode,settingUsed,mappingUsed,description,lines}) {
  return {je_id:jeId,je_number:jeNumber,entity_id:invoice.entity_id,period_code:invoice.period_code,
    je_date:invoice.accounting_date || invoice.inv_date || invoice.payment_date,currency:invoice.currency || 'USD',je_type:'AUTO',
    source_system:sourceSystem,source_doc_id:sourceDocId,source_object_type:sourceObjectType,source_object_id:sourceObjectId,
    rule_code:ruleCode,setting_used:clone(settingUsed),mapping_used:clone(mappingUsed),
    description,posting_status:'DRAFT',created_by:user.user_id,revision:0,
    history:[{a:'CREATE DRAFT FROM AR',by:user.user_id,at:invoice.accounting_date || invoice.inv_date || invoice.payment_date}],lines};
}

export function createInvoiceCommand({invoice,user,can=()=>false,period,existingJEs=[],jeId,jeNumber,
  sourceDocId=`AR-INVOICE:${invoice?.inv_id}`,ruleCode='AR-INVOICE-V1',settingUsed='AR_DEFAULT_V1',mappingUsed='AR_REVENUE_V1'}) {
  const sourceSystem='AR';
  const blocked=guard({document:invoice,permission:'AR.INVOICE.CREATE',can,period,sourceSystem,sourceDocId,existingJEs});
  if(blocked)return blocked;
  if (!['DRAFT','PENDING_APPROVAL'].includes(invoice.status)) return failure('AR_INVOICE_STATE','Only DRAFT or PENDING_APPROVAL invoices can create a draft JE.');
  if (invoice.status==='PENDING_APPROVAL' && invoice.created_by===user?.user_id) return failure('4009','Maker cannot approve the same invoice.');
  const amount=+invoice.amount;
  const lines=[
    {account_code:'120200',debit_amount:amount,credit_amount:0,customer_id:invoice.customer_id,member:invoice.customer_name,description:invoice.memo || ''},
    {account_code:invoice.revenue_account_code || '421803',debit_amount:0,credit_amount:amount,property_id:invoice.property_id,project_id:invoice.project_id,cost_code:invoice.cost_code,description:invoice.memo || ''},
  ];
  const draftJE=makeDraft({invoice,user,jeId,jeNumber,sourceSystem,sourceDocId,sourceObjectType:'AR_INVOICE',sourceObjectId:invoice.inv_id,ruleCode,settingUsed,mappingUsed,
    description:`Invoice ${invoice.inv_no || sourceDocId} · ${invoice.customer_name}`,lines});
  return {ok:true,code:null,nextDocument:{...clone(invoice),status:'OPEN_PENDING_POST',draft_je_id:jeId,draft_je_number:jeNumber,draft_source_doc_id:sourceDocId},draftJE};
}

export function receivePaymentCommand({invoice,user,can=()=>false,period,existingJEs=[],jeId,jeNumber,
  paymentId,paymentDate,paymentPeriodCode,ruleCode='AR-PAYMENT-V1',settingUsed='AR_PAYMENT_DEFAULT_V1',mappingUsed='AR_PAYMENT_CASH_V1'}) {
  const sourceSystem='AR_PAYMENT';
  if(!paymentId)return failure('AR_PAYMENT_ID_REQUIRED','payment_id is required for every receipt occurrence.');
  const sourceDocId=`AR-PAYMENT:${paymentId}`;
  const occurrence=invoice?{...invoice,accounting_date:paymentDate,period_code:paymentPeriodCode,payment_date:paymentDate}:invoice;
  const blocked=guard({document:occurrence,permission:'AR.PAYMENT.CREATE',can,period,sourceSystem,sourceDocId,existingJEs});
  if(blocked)return blocked;
  if(invoice.status!=='OPEN')return failure('AR_INVOICE_PAYMENT_STATE','Only OPEN invoices can receive payment.');
  if((invoice.cash_account_code || '111000')==='111000' && !invoice.bank_member)return failure('4020','Operating Cash requires a bank member.');
  const amount=+invoice.amount;
  const lines=[
    {account_code:invoice.cash_account_code || '111000',debit_amount:amount,credit_amount:0,member:invoice.bank_member,description:`Receipt ${invoice.inv_no || ''}`},
    {account_code:'120200',debit_amount:0,credit_amount:amount,customer_id:invoice.customer_id,member:invoice.customer_name,description:`Clear ${invoice.inv_no || ''}`},
  ];
  const draftJE=makeDraft({invoice:occurrence,user,jeId,jeNumber,sourceSystem,sourceDocId,sourceObjectType:'AR_INVOICE',sourceObjectId:invoice.inv_id,ruleCode,settingUsed,mappingUsed,
    description:`Payment received ${invoice.inv_no || sourceDocId}`,lines});
  return {ok:true,code:null,nextDocument:{...clone(invoice),status:'PAYMENT_PENDING',payment_id:paymentId,payment_date:paymentDate,payment_period_code:paymentPeriodCode,payment_draft_je_id:jeId,payment_draft_je_number:jeNumber,payment_source_doc_id:sourceDocId},draftJE};
}
