# Native fixed asset acquisition — implementation in progress

Migration 341 and `PostgresAccountingKernel.createFixedAssetAcquisition` create a Draft using an independently reviewed asset, its capitalization proposal and exact retained source line. The server derives the amount, accounts, currency, dimensions and active vendor identity. Caller-controlled values are journal number/date, accounting period, expected source version, attachment IDs and reason. Existing PostgreSQL Draft validation and attachment ownership apply.

The transaction retains an immutable source/version/line snapshot, source-to-journal link and full financial journal snapshot with audit, outbox and actor-bound idempotency. Multiple unposted Drafts are allowed. Bound acquisition Post rejects source drift and financial changes, locks the asset and admits one acquisition posting. The existing Submit/Review/Approve/Post workflow remains authoritative.

Real PostgreSQL 15 and 16 focused tests each passed 2/2 without skips on the working implementation: Draft/replay/conflict, tenant and role rejection, missing attachments, derived two-line financial content, four-role workflow, source-version drift rollback, duplicate acquisition rejection, immutable bindings and migration down/up in a rollback transaction. These are isolated fixture results, not live acceptance.

Remaining work before acceptance:

- Add the closed HTTP/OpenAPI command and native entry form with company scope and useful validation messages.
- Validate the retained original classification source-line hash, not only a snapshot at Draft creation; enforce project/property and source lineage consistency.
- Prevent unbound manual acquisition postings, including manual duplicates after a native acquisition. Migration 341 currently guards bound native acquisition journals only. Update existing asset fixtures to use the native acquisition operation when this global guard is added.
- Add concurrency, financial line mutation and source-line drift rejection tests; verify historical acquisition/date interactions and negative-money cases.
- Expose exact acquisition binding in movement/source drill contracts; add period-bound depreciation and pre-Post impairment binding, correction/reversal workflows.
- Finish exact committed root/server/build/PG15/16 gates, independent audit and real API/identity/browser acceptance. No production release is authorized by these isolated results.

## Source evidence revision (342)

New Drafts bind SOURCE_TO_JE to the exact source_document_line_id. Input attachment IDs must exactly equal the scoped source SOURCE_ATTACHMENT set; all must be VERIFIED_CLEAN/CLEAN. An immutable snapshot binds IDs, content hashes, storage references/versions and verification states. Post rechecks source line identity, the source attachment snapshot and the journal attachment set. Older 341 bindings without this proof cannot Post through the strengthened guard; create a corrected Draft. No historical binding is rewritten.

PG16 focused revision tests passed 3/3 without skips: unrelated clean attachment rejection before any Draft, exact source-line link and retained attachment hash, source-version rollback, appended source attachment rejection with unchanged ledger/posting/audit/outbox and APPROVED status, plus forward/down migration restoration. Early test fixture failures (UUID parameter type and missing verified_at) were fixed without weakening runtime constraints. This still does not cover the global manual-entry/source reuse/date or UI gaps listed above.

## Mandatory acquisition posting (343, verification in progress)

Every debit to a registered asset cost account requires the matching asset dimension and an exact native acquisition binding with its unique posting marker. The PostgreSQL BEFORE triggers run acquisition snapshot validation before this mandatory check, in the same transaction and under the asset lock. Legacy manual routes cannot bypass it. Existing asset ledger fixtures now acquire through the native command; future-disposal race fixtures use an actual later depreciation movement. Report tests require the newly retained acquisition source, instead of expecting an empty source list.

Unreleased 342 down migration now rejects retained attachment evidence with 55006; 343 down similarly refuses to remove mandatory posting control while any acquisition binding exists. Original forward migration 342 is unchanged. Empty-history rollback and retained-history rejection are tested separately. Global source-line reuse, source attachment append serialization, date policy, original classification line hash validation, UI/API and depreciation/impairment controls remain unfinished.

## Historical upgrade validation (344)

The upgrade stabilizes the journal/register population with table locks and scans existing Posted asset-account debits. Missing/mismatched asset dimensions, acquisition binding/posting, exact source-line link, retained attachment proof or financial journal snapshot cause 55006. The migration validates history only; it neither reconstructs source links nor changes posted rows. Its down migration leaves all mandatory controls and retained evidence intact.

A real PG16 test accepted valid bound history, then reproduced pre-343 unbound cost using the real workflow in an owned fresh database with only the new required trigger temporarily disabled (restored in finally). Reapplying the validation rejected the legacy history without changing ledger/audit/outbox. Every failed acquisition Post now explicitly verifies APPROVED/revision 3 and zero ledger, JOURNAL_POSTED audit/outbox, acquisition posting, posting batch and idempotency receipt. The focused suite passed 4/4 with zero skips before commit. Global source-line reuse and attachment append serialization remain next implementation work.

## Source-line consumption (345, final acceptance pending)

A scoped immutable source consumption row permits one Posted acquisition per exact source line, even when separate classifications/proposals/register assets reference it. Composite foreign keys tie consumption and posting to the same binding and asset scope. Migration backfill projects existing retained bindings/postings, rejects conflicting history and locks source links during installation. Native Post locks the source document/line for update before claiming consumption; generic Post checks the same source under the document lock. Draft creation rejects already Posted source use and requires the capitalization proposal period. Multiple unposted Drafts remain possible.

SOURCE_TO_JE insertion locks the target journal and source document, resolves line-only links to the authoritative document, rejects mismatched scope, and blocks late associations/reuse. Legacy line-only and document-only links participate in conflict checks. SOURCE_ATTACHMENT insertion shares the document lock and rejects additions after acquisition consumption. Dedicated append-versus-Post transaction-order tests remain required; sequential rejection alone is not that proof.

PG16 focused worktree tests passed 6/6 without skips: native flow/rollback, source attachment drift, empty 345 down/up exact function restoration, preservation of dependent consumption on attempted older rollback, two assets sharing a source line concurrently, generic-after-native, generic-first, generic/native concurrent Post with one winner, line-only normalization, source reuse at later creation and late association rejection. Early r1 test failed because its generic expense account was not in the fixture; corrected to a valid expense account without relaxing accounting validation. Original source-line classification hash, dedicated wrong-period/date tests, correction/reversal policy, HTTP/UI, movement drill updates and final exact multi-version/live acceptance remain open.

## Snapshot serialization (346)

The first deterministic append-first test found a real stale-snapshot defect: the appender committed while Post waited for the source row lock, but SERIALIZABLE Post could still read the older attachment set and commit. The rejected test remains evidence; row locking alone was insufficient.

A private scoped source serialization table now records a real version write shared by native creation/Post, generic source Post, source attachment insertion and source-journal association insertion. A transaction with an older SERIALIZABLE snapshot must retry and see the committed evidence. This does not change the business source version or rewrite retained evidence. Direct runtime-table/function access is revoked. Down refuses to remove the protection while acquisition bindings exist.

The two-order test verifies actual pg_blocking_pids. Append-first holds a real attachment transaction until Post is waiting, commits it, then requires Post rejection and complete rollback. Post-first pauses the real runtime connection at COMMIT, verifies the appender is blocked by that Post backend, releases Post and requires the append to fail. The same cases emulate pre-346 sources with no serialization row. Layered 346/345 down/up tests compare exact function definitions and private permissions. PG16 initial fixed test passed, and PG15 two tests passed before adding the legacy-without-fence variants; final variants remain under verification.
