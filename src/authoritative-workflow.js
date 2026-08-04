const NEXT_ACTION=Object.freeze({
  DRAFT:'SUBMIT',
  PENDING_REVIEW:'REVIEW',
  PENDING_APPROVAL:'APPROVE',
  APPROVED:'POST',
});

export const nextAuthoritativeWorkflowAction=status=>NEXT_ACTION[String(status||'').toUpperCase()]||null;
