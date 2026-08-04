const accountForCredit = journal => (journal?.lines || []).find(line => String(line.account_code) !== '291001')?.account_code || '—';

// A local-only unified projection for the Expenses list. It never changes a Bill,
// Vendor Credit, payment, bank match, approval, or JE.
export function localExpenseTransactionRows({bills = [], vendorCredits = []} = {}) {
  const billRows = bills.map(bill => ({
    key:`bill:${bill.bill_id}`,
    kind:'BILL',
    record:bill,
    date:bill.bill_date,
    type:bill.status === 'PAID' && bill.pay_je_number ? 'Bill payment' : 'Bill',
    number:bill.bill_no,
    payee:bill.vendor_name || '—',
    category:bill.account_code || '—',
    amount:Number(bill.amount || 0),
    balance:['PAID','VOID'].includes(bill.status) ? 0 : Number(bill.amount || 0),
    state:bill.status || 'REVIEW_REQUIRED',
    source_state:bill.paymentEvidence?.billState || 'SOURCE_REVIEW_REQUIRED',
    property_id:bill.property_id || null,
    project_id:bill.project_id || null,
  }));
  const creditRows = vendorCredits.map(credit => ({
    key:`credit:${credit.journal.je_number}`,
    kind:'VENDOR_CREDIT',
    record:credit,
    date:credit.journal.je_date || '—',
    type:'Vendor credit',
    number:credit.journal.je_number,
    payee:credit.bill?.vendor_name || 'Unlinked local credit evidence',
    category:accountForCredit(credit.journal),
    amount:Number(credit.creditAmount || 0),
    balance:Math.max(0,Number(credit.creditAmount || 0) - Number(credit.applicationAmount || 0)),
    state:credit.state || 'REVIEW_REQUIRED',
    source_state:credit.auditState || 'SOURCE_REVIEW_REQUIRED',
    property_id:credit.creditDimensions?.propertyIds?.[0] || null,
    project_id:credit.creditDimensions?.projectIds?.[0] || null,
  }));
  return [...billRows,...creditRows].sort((left,right) => String(right.date).localeCompare(String(left.date)) || left.key.localeCompare(right.key));
}
