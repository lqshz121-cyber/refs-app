// Review-only exception rows for real-estate AP evidence. These rows never
// change bill, credit, JE, bank, aging or reconciliation state.
export function localExpenseReviewExceptions({ bills = [], vendorCredits = [], vendors = [], coa = [] } = {}) {
  const vendorsById = new Map(vendors.map(vendor => [String(vendor.vendor_id), vendor]));
  const accountsByCode = new Map(coa.map(account => [String(account.account_code), account]));
  const billRows = bills.flatMap(bill => {
    const vendor = vendorsById.get(String(bill.vendor_id));
    const account = accountsByCode.get(String(bill.account_code));
    const reason = vendor?.is_related_party ? 'RELATED_PARTY_REVIEW'
      : account?.account_type === 'ASSET' ? 'CAPITAL_OR_PREPAID_REVIEW'
      : !bill.paymentEvidence || bill.paymentEvidence.billState !== 'VALID_POSTED_AP' ? 'MISSING_POSTED_AP_PROOF'
      : !(bill.property_id || bill.project_id) ? 'MISSING_PROPERTY_PROJECT'
      : null;
    if (!reason) return [];
    return [{
      exception_id:`BILL:${bill.bill_id}`,
      source_kind:'BILL',
      source_id:bill.bill_id,
      source_label:bill.bill_no,
      discovered_on:bill.bill_date || null,
      entity_id:bill.entity_id || null,
      vendor_name:bill.vendor_name || vendor?.vendor_name || null,
      related_party:Boolean(vendor?.is_related_party),
      account_code:bill.account_code || null,
      account_type:account?.account_type || null,
      property_id:bill.property_id || null,
      project_id:bill.project_id || null,
      amount:Number(bill.amount || 0),
      outstanding_amount:Number(bill.amount || 0),
      cash_scope:bill.paymentEvidence?.cashScope || null,
      evidence_state:bill.paymentEvidence?.billState || 'NO_POSTED_AP_PROOF',
      reason,
      severity:reason === 'RELATED_PARTY_REVIEW' ? 'HIGH' : 'MEDIUM',
      workflow_state:'OPEN',
      owner:'Controller review',
      review_history:'Retained local exception; no automated resolution.',
      can_resolve:false,
    }];
  });
  const creditRows = vendorCredits.filter(credit => !credit.canReduceAging).map(credit => ({
    exception_id:`CREDIT:${credit.journal?.je_number || credit.billRef || 'unlinked'}`,
    source_kind:'VENDOR_CREDIT',
    source_id:credit.journal?.je_number || null,
    source_label:credit.journal?.je_number || credit.billRef || 'Unlinked credit',
    discovered_on:credit.journal?.je_date || null,
    entity_id:credit.entityId || null,
    vendor_name:credit.bill?.vendor_name || credit.journal?.payee || null,
    related_party:false,
    account_code:null,
    account_type:'AP_CREDIT',
    property_id:credit.creditDimensions?.propertyIds?.[0] || null,
    project_id:credit.creditDimensions?.projectIds?.[0] || null,
    amount:Number(credit.creditAmount || 0),
    outstanding_amount:Number(credit.unappliedAmount || 0),
    cash_scope:credit.creditBankEvidence?.cashScope || null,
    evidence_state:credit.auditState || 'NO_RETAINED_AUDIT',
    reason:credit.state || 'CREDIT_REVIEW_REQUIRED',
    severity:'MEDIUM',
    workflow_state:'HELD',
    owner:'Controller review',
    review_history:'Retained local credit exception; no automated application.',
    can_resolve:false,
  }));
  return [...billRows, ...creditRows].sort((left, right) => String(right.discovered_on || '').localeCompare(String(left.discovered_on || '')) || left.exception_id.localeCompare(right.exception_id));
}
