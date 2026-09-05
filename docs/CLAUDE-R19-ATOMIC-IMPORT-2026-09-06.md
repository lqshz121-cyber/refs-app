# R19 atomic local-snapshot import follow-up

Parent: `67c0bc43660b6dcccd52cf500048068a169e094a`, including the cross-platform
esbuild API fix. This is the unchanged R19 implementation cherry-picked from frozen
`c750f1a147febc88229fa43a2b425847018933e7`; the old branch/object remain intact.
This slice does not modify the frozen F1 candidate or add/edit an accounting migration.

## Reproduction and cause

Claude's R19 correctly found that a Windows-recorded path cannot be opened verbatim
on Linux, and that manifest rows/bytes/hash were unverified. Its proposed final
probe nevertheless ran after automatic pool.query batch commits. A failed initial
import could retain rows, and a failed reimport could replace receipt claims while
retaining the old imported_at timestamp.

## Implemented boundary

The CLI is now import-safe and exports a per-file importer. A file's metadata,
all batch INSERTs, final parsed-row/byte/hash check and completion UPDATE use one
checked-out client in one transaction. An advisory transaction lock serializes the
local import namespace (including receipt creation), and the receipt row is locked.
Errors roll back; the client is always released and is evicted if rollback fails.

An existing receipt with changed domain/company/period/count/bytes/hash is rejected,
never relabelled. Legacy incomplete receipts fail closed for explicit reconciliation.
An identical completed replay streams and verifies the delivered bytes but performs
no receipt or row DML, preserving completion timestamps. No manifest path is trusted
as a directory: separator-normalized filenames resolve only below the supplied root.
Parsed row counts do not require a trailing newline.

Existing schema DDL, domain mappings, and the local staging row models remain as
before; this is not immutable signed WBS admission and is not accounting authority.
Atomicity is per file, not all files in a multi-file manifest. Previously completed
files remain committed if a later file fails. No live WBS provider, production DB,
identity provisioning, posting path or migration is executed by this work.

## Verification

Focused unit/coverage gate on the corrected base: exit 0, 13 pass, zero skip. It verifies single-client
query routing, late refusal/rollback, no-DML replay, receipt conflict, missing file,
malformed JSON, cross-platform paths and measurement drift.

Final local aggregate results rerun on the corrected base: root npm test exit 0 (TAP 1098 pass, zero fail/skip,
SSR 29/0 and audit 119/119 entities, 3955 JEs, zero failures); server npm test
exit 0 (1515 pass, zero fail, 163 PostgreSQL skips). Build and runtime-asset
verification exit 0. TAP totals include intentional duplicate suite execution.

A real PostgreSQL fixture is registered in the existing postgres-kernel.test.mjs
gate, so the existing fresh PostgreSQL 15/16/18 CI jobs require it with zero skips.
It executes multiple real batches before hash/count/byte or SQL failure and asserts
zero new rows/receipts, proves concurrent first-import/replay serialization, and
compares complete old receipt/rows after failed reimport and verified replay.
Local mock assertions are not claimed as PostgreSQL evidence. The local Docker
daemon remains unavailable; no daemon reset/start or live connection was attempted.
