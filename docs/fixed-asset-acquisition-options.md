# Acquisition form data

Migration 350 adds a scoped read for the acquisition form. The runtime exposes it
through `GET /api/v1/entities/{entityId}/fixed-assets/register/{assetId}/acquisition-options`.
It requires `GL.JE.CREATE` for the authenticated company. It performs no business
writes and does not grant permissions or return raw payloads/storage coordinates.

The closed V1 result contains the asset cost and account references, proposal
period, current source document revision/date/number/hash, original evidence
identity/hash when present, source attachment IDs/names, attachment verification
status, and whether an acquisition or disposal has been recorded. Attachment rows
are ordered by UUID and bounded to 26; the command accepts at most 25, so 26 reports
TOO_MANY without enumerating an unbounded source history.

The result is form data, not a readiness certificate. `requires_command_validation`
is always true. Original evidence presence alone does not prove current policy,
raw admission or source consistency. The existing acquisition transaction repeats
those checks and atomically records the Draft and evidence. A later source change
can invalidate a displayed form; refresh on its 412 response. No default journal
date policy is introduced by this read.

The read may return MISSING, UNVERIFIED, AMBIGUOUS or TOO_MANY attachment status.
These states remain visible rather than returning a filtered subset that would
fail the command's exact attachment-set check. The down migration removes only
the read function, preserving all accounting and source evidence.

Verification includes HTTP scope/closed-response checks and real PostgreSQL
permission denial, missing/verified attachment reads, original evidence identity,
uppercase UUID normalization, unchanged business/audit/outbox counts, and down/up
with retained records. Frontend integration and deployed user acceptance remain
required before claiming the form is available online.
