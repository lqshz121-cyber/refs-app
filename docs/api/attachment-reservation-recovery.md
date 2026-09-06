# Recovering native attachment uploads

The generic attachment reservation endpoint now resolves an existing request
before presigning an upload. Migration 303 adds a scoped lookup of the retained
reservation receipt and immutable attachment metadata. It requires
`ATTACHMENT.CREATE`, the original uploader, the original tenant/entity/request
key and matching name, media type, size and content hash.

This recovers earlier random object addresses as well as new deterministic
ones. It does not regenerate an address from a legacy pending version string,
overwrite receipt hashes, extend upload deadlines, create another attachment,
or add another reservation audit/outbox event. New concurrent requests still
share a deterministic object identity and the existing PostgreSQL idempotency
transaction.

Pending uploads receive a URL for the original database-bound object. The URL
lifetime is bounded by the original immutable upload deadline. Expired,
rejected, cleaned or cleanup-claimed uploads cannot resume; the caller starts
a new upload with a new request key, while existing cleanup/retention controls
continue to govern the old record. A conflict never deletes storage: issuing
a presigned URL creates no object, and deletion could erase an earlier success.

A previously verified-clean attachment returns its identity and matching file
metadata with HTTP 200, `idempotent: true`, and no upload URL. The browser checks
the company and selected file's name/type/size/hash, then returns the verified
attachment without another PUT or finalize call. Storage version evidence
remains bound to the original scan.

The API and migration must ship together. Removing migration 303 while running
the new API fails closed; the down migration drops only the lookup function and
retains all attachment and receipt data. Existing WBS row-bound reservation
semantics are unchanged.

Verification covers a reproduced same-key/random-object conflict, legacy
random-key recovery, conflicting metadata, uploader and scope denial,
concurrent reservations, down/up restoration, bounded URL expiry, preserved
objects on failure, verified browser replay without another mutation, and
actual MinIO version preservation through the existing ClamAV/PostgreSQL gate.
