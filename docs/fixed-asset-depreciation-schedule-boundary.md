# Expected depreciation schedule boundaries

Migration 353 corrects the retained straight-line/full-month schedule read. The earlier query capped elapsed months before checking whether a period falls within the useful life, so periods after the asset's useful life still produced a monthly recommendation. It also limited the final instalment to the rounded monthly amount, leaving a residual when rounding down.

The read now retains the actual elapsed month count. Period depreciation is zero before service and after useful life. The final useful-life month brings expected accumulated depreciation to the exact depreciable basis; its amount is the difference from the previous cumulative amount. Intermediate cumulative amounts remain capped at the basis, so rounding cannot make the schedule depreciate below salvage value.

The repository also unwraps the JSON values returned by the PostgreSQL set-returning function. Previously it passed rows containing a function-name property to the analysis evaluator, which expects the asset fields themselves.

Fresh PostgreSQL 16 verification uses actual reviewed register evidence and runtime identity. Two cases exercise rounding in opposite directions over 120 months, checking before-service, first, penultimate, final and after-life periods. The actual analysis evaluator consumes these database rows and returns no due finding before service or after useful life. A second case verifies manifest hashes and the exact function down/up roundtrip.

Migration 354 makes the Posted depreciation reconciliation reader consume this same schedule for its expected period and accumulated amounts. Migration 238 had duplicated the old formulas, so correcting the schedule alone still left contradictory reconciliation findings after useful life and in the final month. The reconciliation retains its existing asset-bound Posted ledger aggregation, variance fields and lineage identifiers. Its down migration restores the exact prior reconciliation function.

The database boundary test checks both readers against independently specified amounts for all five periods and both rounding directions. With no Posted depreciation, reconciliation must report zero actual amounts and the exact negative expected balances as variances. A separate 354 test verifies checksums and the exact down/up function roundtrip.

This expected schedule uses the retained original register basis. It does not implement a revised depreciation policy following impairment or disposal, and does not create or post journals. Native depreciation commands and their full business workflow remain separate delivery work. Existing permissions are unchanged. Both down migrations restore prior read functions without mutating retained register or accounting data.
