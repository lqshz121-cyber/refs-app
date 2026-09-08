# Acquisition resume options V2

Migration 351 upgrades the acquisition form read to V2 without rewriting migration
350 or any retained evidence. The read now also requires GL.JE.VIEW before exposing
existing journal metadata. This is satisfied by the acquisition maker bundle.

The result provides up to 20 unposted acquisition journals, sorted by journal UUID,
with exact journal ID, number, date, period, status and revision. It probes one extra
row and sets more_pending_journals when the result is truncated. Only journals
joined through scoped native acquisition bindings qualify; unrelated manual
journals and other companies are excluded. Posted journals leave this resume list
and remain available through the existing ledger/activity reads. The response is
not permission to edit: opening a journal must perform a fresh scoped read and use
the normal workflow capabilities. Later status changes remain authoritative.

evidence_status names the immutable register review's ACTIVE state; it does not
mean the acquisition has Posted. placed_in_service_date supplies separate service
date context. Blank source document numbers and party references normalize to null
for display, with no changes to original source rows or hashes. Presence of source
evidence continues to require full command validation before Draft creation.

The down migration restores the exact V1 read and removes only the new lookup
index. No journal, binding, audit, ledger or original evidence is removed. API/UI
deployment must match the read version; a V2 client does not silently accept V1.

Verification includes 21 actual native Drafts to prove bounded resume results,
blank legacy source fields, upgrade/down/up with retained Drafts, and removal of
a Posted journal from the list while an independently Approved journal remains.
