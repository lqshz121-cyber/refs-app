# Fixed asset disposal review integrity

Previously, the review checked that Posted asset credits equalled original
cost but accepted caller-supplied depreciation and proceeds. A regression
reproduced acceptance of 1,000 depreciation when the disposal journal debited
2,000. The resulting reviewed carrying value and gain could disagree with GL.

Migration 334 replaces the commands without changing applied migrations.
Disposal review selects only asset credits posted on or before the disposal
date, then validates every line in the selected journals belongs to the exact
asset and currency. It reconciles accumulated depreciation, bank/receivable
proceeds and the remaining net gain/loss, retaining all journal-line and ledger
identifiers. The existing response schema gains a lineage-version marker.
Conflicting amounts or dates abort with no business evidence or receipt.

Disposal and impairment reviews lock the asset record. Impairment rejects an
asset disposed on or before the assessment date. The immutable registration
record is preserved. Rollback restores the previous command definitions only
when no version-2 disposal review evidence has been retained.

Remaining required work includes an authoritative disposal-source-to-journal
link, a read model that clearly shows disposal, and complete disposal treatment
after booked impairment. The current command rejects detected impairment
reversal lines rather than treating them as ordinary gain. This is not full
fixed-asset module acceptance or a production release.
