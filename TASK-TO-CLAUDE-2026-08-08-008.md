# Task 008 — Claude Lane C Bank/Reconcile PG

Base: `036acb4`. Follow Lane C in `CLAUDE-ROUND-20-DIVISION-2026-08-08.md`.

Harden existing Bank Match/Reconcile commands with real PG15/16 tests for exact POSTED evidence,
replay, active-match reversal block, duplicate-cash ambiguity zero-write, lock ordering and
rollback. Server/migration work only. Every migration needs up/down/checksum/fresh-DB evidence.
Do not build UI or WBS transport.
