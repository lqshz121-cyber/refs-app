const clone = value => structuredClone(value);

const failure = (code, message) => ({ok:false, code, message, nextDocument:null, draftJE:null});

function commonGuard({document, permission, can, period, sourceSystem, sourceDocId, existingJEs=[]}) {
  if (!document) return failure('AP_DOCUMENT_NOT_FOUND', 'AP document no longer exists.');
  if (!can(permission)) return failure('AP_PERMISSION_DENIED', `Missing permission ${permission}.`);
  if (!period) return failure('PERIOD_NOT_CONFIGURED', `Period ${document.period_code || ''} is not configured.`);
  const accountingDate=document.accounting_date || document.bill_date || document.payment_date;
  if (!accountingDate || String(accountingDate).slice(0,7)!==document.period_code || period.period_code!==document.period_code) return failure('PERIOD_DATE_MISMATCH','Accounting date must belong to the document-owned period.');
  if (period.status !== 'OPEN') return failure('4005', `Period ${period.period_code || document.period_code || ''} is not open.`);
  if (!Number.isFinite(+document.amount) || +document.amount <= 0) return failure('AP_AMOUNT_INVALID', 'Amount must be greater than zero.');
  if (!sourceDocId) return failure('AP_SOURCE_REQUIRED', 'source_doc_id is required.');
  if (existingJEs.some(je => je.source_system === sourceSystem && je.source_doc_id === sourceDocId && je.posting_status !== 'REVERSED')) {
    return failure('AP_DUPLICATE_SOURCE', 'An active journal entry already exists for this AP source.');
  }
  return null;
}

function draftHeader({document, user, jeId, jeNumber, sourceSystem, sourceDocId, sourceObjectType, sourceObjectId, ruleCode, settingUsed, mappingUsed, description, lines}) {
  return {
    je_id:jeId,
    je_number:jeNumber,
    entity_id:document.entity_id,
    period_code:document.period_code,
    je_date:document.accounting_date || document.bill_date || document.payment_date,
    currency:document.currency || 'USD',
    je_type:'AUTO',
    source_system:sourceSystem,
    source_doc_id:sourceDocId,
    source_object_type:sourceObjectType,
    source_object_id:sourceObjectId,
    rule_code:ruleCode,
    setting_used:clone(settingUsed),
    mapping_used:clone(mappingUsed),
    description,
    payee:document.vendor_name || '',
    posting_status:'DRAFT',
    created_by:user.user_id,
    revision:0,
    history:[{a:'CREATE DRAFT FROM AP', by:user.user_id, at:document.accounting_date || document.bill_date || document.payment_date}],
    lines,
  };
}

export function approveBillCommand({bill, user, can=()=>false, period, existingJEs=[], jeId, jeNumber,
  sourceDocId=`AP-BILL:${bill?.bill_id}`, ruleCode='AP-BILL-V1', settingUsed='AP_DEFAULT_V1', mappingUsed='AP_BILL_LINES_V1'}) {
  const sourceSystem='AP';
  const blocked=commonGuard({document:bill, permission:'AP.INVOICE.APPROVE', can, period, sourceSystem, sourceDocId, existingJEs});
  if (blocked) return blocked;
  if (bill.status !== 'PENDING_APPROVAL') return failure('AP_BILL_STATE', 'Only PENDING_APPROVAL bills can be approved.');
  if (bill.created_by === user?.user_id) return failure('4009', 'Maker cannot approve the same bill.');
  if (!Array.isArray(bill.lines) || !bill.lines.length) return failure('AP_BILL_LINES_REQUIRED', 'Bill requires at least one line.');
  const lines=[];
  let total=0;
  for (const line of bill.lines) {
    const amount=+line.amount;
    if (!line.account_code || !Number.isFinite(amount) || amount <= 0) return failure('AP_BILL_LINE_INVALID', 'Every bill line requires an account and positive amount.');
    total+=amount;
    lines.push({account_code:line.account_code, debit_amount:amount, credit_amount:0,
      description:line.description || '', member:line.member, vendor_id:line.vendor_id,
      property_id:line.property_id, project_id:line.project_id, cost_code:line.cost_code});
  }
  if (Math.abs(total-(+bill.amount)) >= 0.005) return failure('AP_BILL_TOTAL_MISMATCH', 'Bill header amount must equal its line total.');
  lines.push({account_code:'291001', debit_amount:0, credit_amount:total, vendor_id:bill.vendor_id,
    member:bill.vendor_name, description:`Due to/from_${bill.vendor_name}`});
  const draftJE=draftHeader({document:bill,user,jeId,jeNumber,sourceSystem,sourceDocId,sourceObjectType:'AP_BILL',sourceObjectId:bill.bill_id,ruleCode,settingUsed,mappingUsed,
    description:`${bill.bill_no || sourceDocId} · ${bill.vendor_name}`,lines});
  return {ok:true, code:null, nextDocument:{...clone(bill),status:'APPROVED_PENDING_POST',approved_by:user.user_id,draft_je_id:jeId,draft_je_number:jeNumber,draft_source_doc_id:sourceDocId}, draftJE};
}

export function payBillCommand({bill, user, can=()=>false, period, existingJEs=[], jeId, jeNumber,
  paymentId, paymentDate, paymentPeriodCode, ruleCode='AP-PAYMENT-V1', settingUsed='AP_PAYMENT_DEFAULT_V1', mappingUsed='AP_PAYMENT_CASH_V1'}) {
  const sourceSystem='AP_PAYMENT';
  if (!paymentId) return failure('AP_PAYMENT_ID_REQUIRED', 'payment_id is required for every payment occurrence.');
  const sourceDocId=`AP-PAYMENT:${paymentId}`;
  const occurrence=bill?{...bill,accounting_date:paymentDate,period_code:paymentPeriodCode,payment_date:paymentDate}:bill;
  const blocked=commonGuard({document:occurrence, permission:'AP.PAYMENT.CREATE', can, period, sourceSystem, sourceDocId, existingJEs});
  if (blocked) return blocked;
  if (bill.status !== 'APPROVED') return failure('AP_BILL_PAYMENT_STATE', 'Only APPROVED bills can be paid.');
  if ((bill.cash_account_code || '111000') === '111000' && !bill.bank_member) return failure('4020', 'Operating Cash requires a bank member.');
  const amount=+bill.amount;
  const lines=[
    {account_code:'291001',debit_amount:amount,credit_amount:0,vendor_id:bill.vendor_id,member:bill.vendor_name,description:`Clear ${bill.bill_no || ''}`},
    {account_code:bill.cash_account_code || '111000',debit_amount:0,credit_amount:amount,member:bill.bank_member,description:'Operating Cash'},
  ];
  const draftJE=draftHeader({document:occurrence,user,jeId,jeNumber,sourceSystem,sourceDocId,sourceObjectType:'AP_BILL',sourceObjectId:bill.bill_id,ruleCode,settingUsed,mappingUsed,
    description:`Payment ${bill.bill_no || sourceDocId} · ${bill.vendor_name}`,lines});
  return {ok:true, code:null, nextDocument:{...clone(bill),status:'PAYMENT_PENDING',payment_id:paymentId,payment_date:paymentDate,payment_period_code:paymentPeriodCode,payment_draft_je_id:jeId,payment_draft_je_number:jeNumber,payment_source_doc_id:sourceDocId}, draftJE};
}
