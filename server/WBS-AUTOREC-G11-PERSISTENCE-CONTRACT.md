# WBS AutoRec G11 persisted-incur contract

`INCUR` is a REFS accounting event, never a WBS screen-state import.  It is
admissible only after the same immutable `review_candidate_id` has a RELEASED
execution receipt and exactly two linked, existing, POSTED `AUTO` journals.

| Requirement | Authoritative evidence | Reject when |
| --- | --- | --- |
| Candidate and sources | `wbs_autorec_execution_event` plus both `wbs_autorec_source_reservation` rows | Candidate is not exactly RELEASED, source version or receipt hash differs, or allocation amount differs. |
| Two journal legs | A new append-only candidate-to-journal link: one `PAYABLE_INCUR`, one `AUTOC` | Either leg is absent, duplicated, not `AUTO`/`POSTED`, or the two journal IDs are equal. |
| Standard posting evidence | `journal_entry`, immutable `posting_batch`, `ledger_line`, and `audit_event(AUTO_JOURNAL_CREATED)` for each leg | Any journal has no posted batch, no ledger lines, or no matching creation audit. |
| WBS source trace | Immutable `source_link` from each journal through its REFS source/staging evidence, then the candidate's WBS receipt/source version | A journal has no qualifying REFS trace, or it traces to another company/currency/bank/source. |
| 291001 clearing | `ledger_line` grouped by `member_ref` across both legs | Any member is missing on one leg, any net is non-zero, or either leg's absolute clearing total differs from the reserved allocation. |
| Incurrence event | A new append-only execution event `RELEASED -> INCURRED`, one idempotency receipt, one audit event | Caller supplies a journal ID, a state, an amount, or a G11 result that cannot be derived from the preceding evidence. |

The future command must lock the execution event, both journal entries and
their ledger rows in a deterministic order, then re-run all checks in the same
transaction.  It must not create, review, approve or post journals.  Missing
evidence returns a fail-closed error with zero execution event, audit or outbox
write.  `REVERSE` remains a separate standard Draft-reversal workflow after
this Incurrence receipt exists.
