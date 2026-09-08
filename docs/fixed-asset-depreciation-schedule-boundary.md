# Expected depreciation schedule boundaries

Migration 353 corrects the retained straight-line/full-month schedule read. The earlier query capped elapsed months before checking whether a period falls within the useful life, so periods after the asset's useful life still produced a monthly recommendation. It also limited the final instalment to the rounded monthly amount, leaving a residual when rounding down.

The read now retains the actual elapsed month count. Period depreciation is zero before service and after useful life. The final useful-life month brings expected accumulated depreciation to the exact depreciable basis; its amount is the difference from the previous cumulative amount. Intermediate cumulative amounts remain capped at the basis, so rounding cannot make the schedule depreciate below salvage value.

The repository also unwraps the JSON values returned by the PostgreSQL set-returning function. Previously it passed rows containing a function-name property to the analysis evaluator, which expects the asset fields themselves.

Fresh PostgreSQL 16 verification uses actual reviewed register evidence and runtime identity. Two cases exercise rounding in opposite directions over 120 months, checking before-service, first, penultimate, final and after-life periods. The actual analysis evaluator consumes these database rows and returns no due finding before service or after useful life. A second case verifies manifest hashes and the exact function down/up roundtrip.

This is an expected schedule used by suggestions. It does not reconcile Posted depreciation, impairment or disposal, and does not create or post journals. Native depreciation commands and their full business workflow remain separate delivery work. Existing permissions are unchanged. The down migration restores the prior read function without mutating retained register or accounting data.
