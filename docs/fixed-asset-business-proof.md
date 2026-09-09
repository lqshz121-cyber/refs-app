# Fixed asset business validation

The register regression starts with an isolated retained-source fixture at
version 1, approved capitalization policy and classification evidence. It then
uses real V3 formal grants and issued contexts to create a FIXED_ASSET proposal
and independently register the asset through PostgreSQL runtime commands.

It checks source identity/hash, cost and salvage, reviewer identity, immutable
register evidence, idempotent replay, conflicting payload rejection and exactly
one business audit/outbox event. Wrong-company access, excessive salvage and
missing accounts fail without business artifacts. Replacing the proposer's
grant with the review role still cannot authorize self-review. Identity context
issuance retains its own audit records. Registration does not create or post a
journal.

The ledger scenario then uses issued formal roles to create, submit, review,
approve and post acquisition (25,000), depreciation (2,000), and disposal
(24,000 proceeds and 1,000 gain). Impairment assessment reads the exact asset's
23,000 Posted carrying value and records a 5,000 proposed loss against an
18,000 valuation. The assessment itself creates no journal. Disposal clears
the asset cost and accumulated depreciation accounts. Review evidence records
the exact contributing journal and ledger identifiers, replays idempotently,
and emits one business audit/outbox event per review. Missing Posted evidence
is rejected. The attachment and retained source are isolated test fixtures.

This is direct command and Posted-ledger proof, not real-source or HTTP/browser
acceptance. The scenario does not book the proposed impairment. Disposal after
booked impairment, reconciliation of user-entered proceeds/depreciation to
Posted disposal lines, and independently verified disposal source linkage
remain required work. In particular, migration 240 currently checks the asset
credit total but computes carrying value and gain using request amounts; the
positive scenario does not establish that conflicting amounts are rejected.
No production grants or historical migrations are changed.
