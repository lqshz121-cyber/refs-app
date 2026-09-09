# Credit entry with supporting attachments

The credit entry UI requires both credit creation and attachment upload. The
previous credit maker roles had no upload permission, so they could not use
that UI workflow. `AP_VENDOR_CREDIT_ENTRY_MAKER` and
`AR_CREDIT_MEMO_ENTRY_MAKER` provide the respective creation permission, shared
read access and `ATTACHMENT.CREATE` under the existing `ADJUSTMENT` class.

Migration 333 extends the migration-331 anchored compatibility table with one
pair: `ATTACHMENT.CREATE` / `ADJUSTMENT`. The V3 grant algorithm is unchanged:
the bundle must contain a native Adjustment permission, and the context must
carry an active same-entity native anchor. Upload alone cannot claim Adjustment
authority. Review, approval, posting, allocation, refund and scanner permissions
are not added to either entry role.

Existing maker role definitions remain unchanged. This migration creates no
user grants and does not change stored accounting documents. Its down migration
refuses when credit-upload grant history exists, including revoked grants and
retained V2 receipts. With no such evidence it removes only the added pair and
restores the prior table constraint.

Tests use the actual browser access predicate with the formal roles and real
PostgreSQL grant/context boundaries. Each credit role reserves a pending upload
and creates a Manual Draft credit using separately verified fixture evidence;
the draft replay returns the same journal. Negative cases retain the absence
of later workflow authority and reject unanchored or mixed-authority bundles.
Pending uploads are never treated as verified evidence. Real object-store,
scanner and deployed user acceptance remain separate requirements.
