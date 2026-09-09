# Disposal and impairment ordering

Migration 334 rejected impairment after an existing disposal review, but not
the reverse arrival order. A real PostgreSQL regression reproduced acceptance
of a July 25 disposal after a July 26 impairment assessment was already retained.

Migration 335 checks the reverse condition while holding the same asset row
lock: a disposal review cannot have a date on or before any retained impairment
assessment. Together with 334's impairment check, this enforces both orderings
of review evidence. Same-day evidence is rejected because these records carry
dates rather than an intraday ordering contract. Existing successful commands
retain their idempotent replay behavior.

The command also rejects an outstanding Posted impairment balance in any
assessment-linked accumulated impairment account, through the disposal date.
This covers disposal journals that omit the impairment reversal entirely.
The earlier guard still rejects detected reversal lines. Complete support for
disposal after booked impairment remains required; rejecting unsupported
accounting treatment is not implementation of that treatment.

Tests execute the normal Posted lifecycle, both arrival orders, and a Posted
5,000 impairment followed by a disposal omitting its reversal. Rejected review
commands leave no disposal evidence, business audit, outbox or receipt. An
isolated transaction verifies exact migration hashes and down/up definitions.
Rollback refuses removal once timeline-versioned disposal evidence exists.

These commands validate review evidence. Source-to-journal binding, a derived
disposed read model, full typed disposal accounting, concurrency acceptance
and live browser business testing are still outstanding.
