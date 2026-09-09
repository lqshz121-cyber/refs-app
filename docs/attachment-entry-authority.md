# Attachment upload in accounting entry roles

Migration 331 allows the existing bill, invoice, bill payment and receipt entry
roles to upload supporting documents in the same authenticated workflow.
Previously these formal roles combined their business permission with
`ATTACHMENT.CREATE`, but PostgreSQL rejected the combination because attachment
upload has a different native authority class.

The native attachment class remains `ATTACHMENT_UPLOADER`. A database allowlist
permits `ATTACHMENT.CREATE` alongside `DRAFT`, `PAYMENT` or `RECEIPT` only when
the grant bundle contains a native business permission of that same class.
An upload permission alone cannot claim one of these classes. Context issuance
also requires an active, unexpired native permission in the same actor/entity
and in the issued context. Read-only context fallback remains unchanged.

Review, approval, posting, scanner finalization and cleanup are outside this
allowlist. Upload creates a pending attachment; it does not verify the object
or permit using an unverified attachment as accounting evidence.

New grant requests use `refs_grant_request_hash_v3` and
`refs_reconcile_actor_grants_v3`, with receipt policy `SOD_FINITE_V2` and evidence
schema `RUNTIME_GRANT_EVIDENCE_V3`. The previous V2 functions and V1 receipts
retain their original semantics. An idempotency key cannot replay across policy
versions. Grant replacement, finite expiration, revision checks, isolated IAM
identity, audit and outbox writes remain transactional.

The down migration restores the migration-308 context guard only when no V2
receipts exist. It refuses to discard retained policy evidence. Deploying this
migration does not assign or broaden any actual person's permissions.

The PostgreSQL regression exercises the four exact formal entry roles through
`PostgresGrantSync`, context issuance and attachment reservation, then verifies
replay, stale revision rejection, role replacement and denial of an actual
upload using an old context. It also exercises standalone upload, invalid
combinations without partial writes, audit policy metadata, clean down/up and
rollback protection after evidence exists. Results must be recorded against
the tested commit; the existence of this test is not proof of a passing run.

This change does not complete the broader role inventory. Credit entry,
sales receipts and other uncovered permissions still require their own exact
formal role definitions and full business acceptance. Production identity and
browser acceptance remain separate from isolated database tests.
