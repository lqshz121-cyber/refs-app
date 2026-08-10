export const WBS_AUTORECON_PROGRESS = Object.freeze({
  status: 'PARTIAL - evidence gated',
  sources: [
    { source: 'Payable Report', role: 'Business-side transaction evidence', entry: 'Signed receipt -> Raw -> Normalized -> Staging or Exception', gate: 'Immutable provider key/version, company, currency, direction, amount, posting date, and approved mapping are required. Source Detail is trace only.' },
    { source: 'Bank Transaction Journal Entries', role: 'Bank-side transaction evidence', entry: 'Signed receipt -> Raw -> Normalized -> Staging or Exception', gate: 'Immutable bank transaction key, bank account, transaction and posting dates, direction, amount, currency, and approved mapping are required.' },
    { source: 'Auto Payments Detail', role: 'Observed relation and state evidence', entry: 'Signed receipt -> Raw -> Normalized -> Staging or Exception -> review evidence', gate: 'pdGuid is required; cbId, batch, sequence, and reference values are relation trace only. WBS Release/Incur never changes a REFS state.' },
    { source: 'Cost General Ledger', role: 'Control evidence only', entry: 'Signed receipt -> immutable metric snapshot -> approved mapping -> control reconciliation', gate: 'Requires fourteen receipt-bound metrics and a scoped REFS target. It never creates a source document, allocation, Draft, or posting.' },
    { source: 'Property Comparison Report', role: 'Control evidence only', entry: 'Signed receipt -> immutable metric snapshot -> approved mapping -> control reconciliation', gate: 'Requires company, property, period, currency, bank scope, and a scoped REFS target. It never creates a source document, allocation, Draft, or posting.' },
  ],
  workflow: [
    { stage: 'Company Screening', observed: 'Company, bank account, M/R/C periods, quantity, amount, released/incurred totals, reconciliation balance, and date.', refs: 'Receipt-bound company control snapshot and per-company control-total trace.', authority: 'No allocation, Release, Incur, Draft, or posting authority.' },
    { stage: 'Data Processing and Release', observed: 'Not-matched bank payments and released payment detail with vendor, project, cost, reviewer, and relation trace.', refs: 'Bank and business evidence enters Raw -> Normalized -> Staging/Exception; a reviewed pair may become a non-dispatchable match proposal.', authority: 'WBS Release is observed history only; REFS allocation is separately authorized.' },
    { stage: 'Incur', observed: 'Observed Incur status and accounting relationship evidence when returned by a receipt.', refs: 'REFS validates its own posted PAYABLE_INCUR plus AUTOC legs, source/ledger links, and 291001 net zero.', authority: 'Observed WBS Incur cannot create or post a REFS journal.' },
    { stage: 'Incurred List', observed: 'Bank-to-AUTOC/payable relation, dimensions, attachment reference, reviewer, and comments-log trace.', refs: 'Append-only readback evidence for forward and reverse trace.', authority: 'No state transition, cancellation, JE, or posting command is available from this view.' },
  ],
  controls: [
    'A REFS allocation requires a source-level reservation and must reject duplicate allocation across match groups.',
    'REFS Release must freeze the complete source batch; cancellation cannot rewrite reviewed or posted accounting.',
    'REFS Incur requires posted AUTO PAYABLE_INCUR and AUTOC legs, ledger links, and 291001 net zero by member.',
    'REFS Reverse uses Draft reversal -> Review -> Approve -> Post; the original ledger remains immutable.',
  ],
  liveEvidence: 'Live signed, non-empty WBS provider receipts remain unavailable. This page is read-only and never creates, releases, incurs, approves, or posts from screen data.',
});
