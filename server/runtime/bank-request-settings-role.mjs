// Explicit same-user evidence access; not service execution or accounting writes.
export const BANK_REQUEST_SETTINGS_ROLE=Object.freeze({
  authorityClass:'BANK_IMPORT_REQUEST',principalKind:'HUMAN',
  permissions:Object.freeze(['WBS.AUTOREC.VIEW','WBS.TEST.BANK.IMPORT.REQUEST','ACCOUNTING.SETTINGS.WORKFLOW.VIEW','AI.ACCOUNTING.SETTINGS.VIEW'])
});

// Separate frozen bundle: preserve the existing website evidence reads when
// formal grant sync replaces the complete actor/entity permission set.
// AI.ANALYSIS.EXPLAIN is intentionally not a passive read-context permission.
export const BANK_REQUEST_ACCOUNTING_VIEW_ROLE=Object.freeze({
  authorityClass:'BANK_IMPORT_REQUEST',principalKind:'HUMAN',
  permissions:Object.freeze(['AP.VIEW','AR.VIEW','BANK.VIEW','GL.JE.VIEW','GL.REPORT.VIEW','WBS.AUTOREC.VIEW','AI.AMORTIZATION.VIEW','WBS.TEST.BANK.IMPORT.REQUEST','ACCOUNTING.SETTINGS.WORKFLOW.VIEW','AI.ACCOUNTING.SETTINGS.VIEW'])
});
