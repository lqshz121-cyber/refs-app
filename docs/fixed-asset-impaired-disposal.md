# Disposal after Posted impairment

Migration 336 supports disposal of an asset with assessment-backed Posted
impairment. It replaces the temporary rejection in 335 with reconciliation of
each accumulated impairment account. Prior Posted balances exclude the current
disposal journals and include only the exact asset through the disposal date.
Each account's disposal debit must clear that prior balance completely.

Historical impairment ledger lines must carry
`fixed_asset_impairment_assessment_evidence_id`. The immutable assessment must
match tenant, company, asset, account, currency and date. The net Posted amount
for each assessment must equal its reviewed loss. Unbound or mismatched
postings cannot support an accepted disposal. Unbooked assessments do not
reduce carrying value. Prior Posted depreciation must also match the amount
cleared in the disposal journals.

The evidence stores accumulated impairment and its historical ledger-line
identifiers. Carrying value is cost less depreciation and impairment; gain or
loss is proceeds less carrying value. Impairment reversals are excluded from
gain/loss lines. Full disposal journal-line and ledger-line trace is retained.
The response retains its existing schema version and adds
`accumulated_impairment`, `impairment_ledger_line_ids` and the
`DISPOSAL_CARRYING_V2` carrying-version marker. Existing evidence receives zero
impairment and an empty history array; its original values are preserved.

The regression posts acquisition 25,000, depreciation 2,000, impairment 5,000
and a five-line disposal with proceeds 19,000. It verifies carrying value
18,000, gain 1,000 and zero remaining asset/depreciation/impairment balances.
Negative cases include missing reversal, assessment 5,000 versus Posted 7,000,
missing assessment identity and both invalid review orderings. Migration
rollback restores the prior schema and command only without new retained
carrying evidence.

These are isolated database/runtime scenarios with fixture sources and actual
formal journal roles. They do not prove typed impairment/disposal entry screens,
authoritative disposal-source-to-journal linkage, derived disposed read models,
multi-user concurrency, or live business acceptance. Those remain required.
