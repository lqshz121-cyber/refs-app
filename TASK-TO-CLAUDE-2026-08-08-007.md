# Task 007 — Claude Lane B close accounting

Base: `036acb4`. Follow Lane B in `CLAUDE-ROUND-20-DIVISION-2026-08-08.md`.

Implement a source-backed, fixed-point, balanced Draft-only close-generator framework for
retainage, prepaid amortisation, insurance/property-tax accrual and depreciation. Every proposal
must carry entity, period, source, mapping, idempotency, balanced lines and audit reason. Missing
facts must produce Review exceptions. Do not auto-post or rewrite COGS, IC, opening balance,
period master or the JE state machine.
