# Claude Task: Official WBS MCP accounting-field mapping review

**Priority:** HIGH  
**Category:** WBS / Accounting rules  
**Base:** `1233a133721513c6b04df79d2cb196109c8778db`  
**Branch:** `claude/wbs-mcp-lineage-review-20260805`

## Scope

Review the current credential-free WBS read-only MCP implementation against the official eight-tool contract already represented in the repository. Produce an executable, credential-free mapping from Payables, Bank Transactions, AutoRec Details, AutoRec Banks, Journal Entries, Control Totals, metadata, and trace results into receipt -> Raw -> Normalized -> Staging/Exception -> mapping review -> AutoRec review -> standard JE request/evidence seams.

Document stable keys, source types, entity/company/currency/date/amount/direction fields, cursor semantics, canonical row hash validation, snapshot-diff limitations, and Review/Exception reasons.

## Boundaries

- Do not copy credentials, URLs containing tokens, cookies, or provider rows into source, tests, logs, or task results.
- Do not recreate WBS modules and do not write to WBS.
- Do not create, approve, dispatch, or post journal entries.
- Absence is unconfirmed when revision/CDC/tombstone is unavailable; never infer deletion or reversal.

## Acceptance

- Exact eight-tool catalog and schema/annotation validation remains fail closed.
- Cross-company, changed replay, hash mismatch, missing stable key, unsupported currency, ambiguous mapping, and incomplete trace become scoped exceptions.
- Focused Node tests, full server tests, and `git diff --check` exit 0.
- Return SHA/base, files, tests+exit, mapping coverage, risks, and explicit no-production/no-write claim.
