# Additional formal workflow roles

The prior authority audit identified active PostgreSQL permissions that had no
formal runtime role. This catalog defines 28 human roles for audited
permissions with command consumers, using existing database authority classes and shared read
permissions. It does not migrate the authority matrix, combine incompatible
operations, or assign grants to a real actor.

The catalog covers advisory proposal preparation, bill void creation,
G11 and reconciliation management, configuration retirement, fixed asset
reviews, journal editing/rejection/reclassification/reversal, WBS company
catalog decisions, CWIP, insurance mapping, rent and property review.

Runtime validation rejects mismatched native authority labels and combinations
with later posting authority. Fresh PostgreSQL validation checks every catalog
permission against the actual authority table, issues its formal role, verifies
the selected company is accessible and another company is denied, then revokes
the write capability and checks the old context. The journal rejection role
also exercises a real pending journal returning to Draft with idempotent replay
and no ledger posting.

This closes a role-definition gap, not the complete business acceptance gap.
Most operations in this catalog still require their own direct API, UI and
business-lifecycle proof. In particular, separate native classes for journal
creation and editing have not been merged; registering the editor role does
not establish an end-to-end create/edit user experience. The three fixed asset
review actions require further direct business proof. The legacy database
permission `AP.BILL.VOID.APPROVE` has no command consumer and is deliberately
not offered as a formal role. Bill voids use `AP_BILL_VOID_MAKER`, then distinct
`JE_SUBMITTER`, `JE_REVIEWER`, `JE_APPROVER` and `JE_POSTER` actors. The void
regression exercises those actual formal grants and preserves the original
posted journal. The historical permission seed is unchanged. Real provisioning remains
an explicit reviewed deployment operation with finite grants and exact
revisions.
