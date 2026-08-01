const postedLink = je => je?.posting_status === 'POSTED' && je?.source_object_type && je?.source_object_id != null;

export function applyPostedDocumentTransition({ap, ar, je}) {
  if (!postedLink(je)) return {ok:false, code:'SOURCE_LINK_MISSING', ap, ar};
  const id = Number(je.source_object_id);
  if (je.source_object_type === 'AP_BILL') {
    const bill = ap?.bills?.find(row => Number(row.bill_id) === id);
    if (!bill) return {ok:false, code:'SOURCE_DOCUMENT_NOT_FOUND', ap, ar};
    const payment = je.source_system === 'AP_PAYMENT';
    const expected = payment ? 'PAYMENT_PENDING' : 'APPROVED_PENDING_POST';
    const nextStatus = payment ? 'PAID' : 'APPROVED';
    if (bill.status === nextStatus) return {ok:true, idempotent:true, ap, ar};
    if (bill.status !== expected) return {ok:false, code:'SOURCE_STATE_INVALID', ap, ar};
    return {
      ok:true,
      ap:{...ap,bills:ap.bills.map(row=>Number(row.bill_id)===id?{
        ...row,
        status:nextStatus,
        ...(payment
          ? {pay_je_number:je.je_number, paid_by:je.posted_by, paid_at:je.posted_at}
          : {je_number:je.je_number, posted_by:je.posted_by, posted_at:je.posted_at}),
      }:row)},
      ar,
    };
  }
  if (je.source_object_type === 'AR_INVOICE') {
    const invoice = ar?.invoices?.find(row => Number(row.inv_id) === id);
    if (!invoice) return {ok:false, code:'SOURCE_DOCUMENT_NOT_FOUND', ap, ar};
    const payment = je.source_system === 'AR_PAYMENT';
    const expected = payment ? 'PAYMENT_PENDING' : 'OPEN_PENDING_POST';
    const nextStatus = payment ? 'PAID' : 'OPEN';
    if (invoice.status === nextStatus) return {ok:true, idempotent:true, ap, ar};
    if (invoice.status !== expected) return {ok:false, code:'SOURCE_STATE_INVALID', ap, ar};
    return {
      ok:true,
      ap,
      ar:{...ar,invoices:ar.invoices.map(row=>Number(row.inv_id)===id?{
        ...row,
        status:nextStatus,
        ...(payment
          ? {pay_je_number:je.je_number, paid_by:je.posted_by, paid_at:je.posted_at}
          : {je_number:je.je_number, posted_by:je.posted_by, posted_at:je.posted_at}),
      }:row)},
    };
  }
  return {ok:false, code:'SOURCE_TYPE_UNSUPPORTED', ap, ar};
}
