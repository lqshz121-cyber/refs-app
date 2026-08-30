// Frozen registry of the Full Controller scan sections this release is required
// to produce.
//
// Before this registry existed, `required_section_count` was derived from
// whatever analyzer map the caller happened to pass. A wiring regression that
// dropped an analyzer therefore shortened the denominator, every surviving
// section still completed, and the scan reported a confident COMPLETE with
// fewer findings. A silently narrower scan is indistinguishable from a clean
// one, so the registry is frozen here and compared against the wiring instead.
//
// ANALYZED_SECTIONS: a production analyzer must be wired for each of these.
// UNAVAILABLE_SECTIONS: sections this release must report on but cannot yet
// prove. They are emitted as UNAVAILABLE with a stable code, which forces the
// overall scan status to INCOMPLETE. No analyzer may claim one of these
// categories until the corresponding server-derived reader exists.

export const AI_FULL_CONTROLLER_ANALYZED_SECTIONS=Object.freeze([
  'ACCOUNTING_DECISION',
  'ACCRUAL_CANDIDATE',
  'ADMITTED_SOURCE_UNBOOKED',
  'AP_AGING_RISK',
  'AP_INVOICE_CUTOFF',
  'BALANCE_SHEET_ACCOUNT_AGING',
  'BANK_DUPLICATE_PAYMENT',
  'BANK_GL_BALANCE_RECONCILIATION',
  'BANK_PAYEE_VENDOR_MISMATCH',
  'BANK_RECONCILIATION_EXCEPTION',
  'BANK_UNUSUAL_PAYMENT',
  'BUDGET_VS_ACTUAL',
  'CLOSING_SETTLEMENT',
  'CONSTRUCTION_LOAN_BALANCE',
  'CONSTRUCTION_LOAN_DRAW_CWIP',
  'CONSTRUCTION_LOAN_PROJECT_COST',
  'CONSTRUCTION_LOAN_TRANSACTION',
  'COST_DIMENSION',
  'CWIP_POST_COMPLETION',
  'DUPLICATE_PAYABLE',
  'FINANCIAL_STATEMENT_VARIANCE',
  'FIXED_ASSET_DEPRECIATION',
  'FIXED_ASSET_DEPRECIATION_SCHEDULE',
  'FIXED_ASSET_DISPOSAL_GAP',
  'FIXED_ASSET_IMPAIRMENT',
  'FIXED_ASSET_IMPAIRMENT_POSTED_RECONCILIATION',
  'FIXED_ASSET_POSTED_RECONCILIATION',
  'FIXED_ASSET_POST_DISPOSAL_DEPRECIATION',
  'INTERCOMPANY_CLOSE',
  'INVOICE_ACCOUNTING_CLASSIFICATION',
  'INVOICE_SOURCE_SUPPORT',
  'LOAN_REFERENCE',
  'MANUAL_JOURNAL_RISK',
  'NEW_VENDOR_MATERIAL_INVOICE',
  'PREPAID_AMORTIZATION',
  'PREPAID_BALANCE_RECONCILIATION',
  'PREPAID_COVERAGE',
  'PROPERTY_RENT_REVENUE',
  'SECURITY_DEPOSIT_LIABILITY',
  'VENDOR_ACCOUNTING_TREATMENT_DRIFT',
  'VENDOR_ACCOUNT_CODING_DRIFT',
  'VENDOR_INVOICE_AMOUNT_DROP',
  'VENDOR_INVOICE_FREQUENCY',
  'VENDOR_INVOICE_NEAR_DUPLICATE',
  'VENDOR_MONTHLY_SPEND',
  'VENDOR_PAYMENT_TERMS_DRIFT',
  'VENDOR_SINGLE_INVOICE_SPIKE'
].slice().sort());

// PROPERTY_TAX has no server-derived, signed tax statement reader. A property
// tax obligation cannot be proven from a PAYABLES description, so this release
// must not present a zero-finding PROPERTY_TAX section as a clean result.
export const AI_FULL_CONTROLLER_UNAVAILABLE_SECTIONS=Object.freeze({
  PROPERTY_TAX:'AI_PROPERTY_TAX_STATEMENT_SOURCE_UNAVAILABLE'
});

export const AI_FULL_CONTROLLER_REQUIRED_SECTIONS=Object.freeze({
  analyzed:AI_FULL_CONTROLLER_ANALYZED_SECTIONS,
  unavailable:AI_FULL_CONTROLLER_UNAVAILABLE_SECTIONS
});
