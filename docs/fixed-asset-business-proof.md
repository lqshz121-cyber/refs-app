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

This is direct register-command proof using fixture source evidence. It is not
real-source acceptance, HTTP/browser acceptance or proof of depreciation,
impairment, disposal, or their Posted-ledger lifecycle. Those remain separate
required work. No production grants or historical migrations are changed.
