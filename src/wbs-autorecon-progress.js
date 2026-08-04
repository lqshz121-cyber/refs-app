export const WBS_AUTORECON_PROGRESS = Object.freeze({
  status: 'PARTIAL — evidence-gated',
  sources: [
    { source: 'Payable Report', role: 'Transaction candidate', entry: 'Immutable receipt → Raw → Normalized → Staging', gate: 'Company/currency/mapping plus immutable key/version; posting date and journal no. are trace only' },
    { source: 'Bank Transaction Journal', role: 'Bank-side candidate', entry: 'Immutable bank receipt → Raw → bank source → Staging', gate: 'Account/date/amount/currency plus immutable bank transaction key' },
    { source: 'Auto Payments detail', role: 'Coding / allocation evidence', entry: 'Receipt pdGuid → Staging → allocation', gate: 'pdGuid, vendor/project/cost/description; cbId is relation navigation only' },
    { source: 'Cost General Ledger', role: 'Control evidence', entry: 'Raw → metric snapshot → posted-ledger comparison', gate: 'Never creates a source document, allocation, Draft, or posting' },
    { source: 'Property Comparison', role: 'Control evidence', entry: 'Raw → control snapshot → AutoRec control comparison', gate: 'Approved company/period/currency/bank mapping; never posts' },
  ],
  controls: [
    'Source-level reservation prevents duplicate allocation across match groups.',
    'Release freezes the complete source batch; cancellation cannot rewrite posted or reviewed accounting.',
    'Incur requires POSTED AUTO PAYABLE_INCUR and AUTOC legs, ledger links, and 291001 net zero.',
    'Reverse uses Draft reversal → Review → Approve → Post; the original ledger remains immutable.',
  ],
  liveEvidence: 'Live WBS non-empty immutable receipt key/version/hash is still UNKNOWN. This static site never creates or posts from screen data.',
});
