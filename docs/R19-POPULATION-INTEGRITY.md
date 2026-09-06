# R19 population-integrity follow-up

Direct parent: `587a3b6fe2019d8999586af4badf5d80521a39dc`.
This changes only the local snapshot importer and its isolated tests. It does not
grant accounting authority, alter historical migrations, or execute a live import.

## Source-key boundary

The prior importer chose typed keys from `id` (accounting_info/ar_aging/invoice_details)
or `uuid` (ap_business); reference keys used `id`, `entity_id`, then `uuid`.
The existing accounting-setting normalizer also explicitly requires `row.id`
(`server/tools/stage-wbs-h1-accounting-settings.mjs`). These explicit source-field
choices are retained, but the invented company/batch-index fallback is removed.
No manifest declares a domain-specific composite-key contract in this checkout.
No real delivered manifest/NDJSON was available to this implementation review.
Thus this is NOT approval of every provider domain's uniqueness semantics: missing
keys, repeated keys, unsafe numeric identities and conflicting source rows STOP.
Any domain needing a compound key requires separate source-contract review, not
an automatic suffix, ordinal, company prefix, or digest-generated identity.

### Monetary projection boundary (follow-up to frozen 736e7de9)

Retaining raw JSON does not make a JS-derived text projection lossless. Real Node
parsing maps numeric `9007199254740993` to `9007199254740992`,
`0.10000000000000001` to `0.1`, and `1.2300` to `1.23`. Therefore the existing
mapped monetary columns now accept only original string values (or null/missing),
never JSON numbers, booleans or objects. Strings retain all digits and trailing
zeros; NUL is rejected instead of stripped. No decimal scale or business rounding
rule is guessed. This is a lexical preservation gate, not validation that a string
is a valid business amount. Provider deliveries with numeric amounts require a
separately reviewed lossless parsing/source-contract change before import.

Duplicate identities within one file are rejected even when content agrees,
including duplicates across batches. This preserves the distinction between parsed
row count and unique retained population. Numeric typed IDs are canonicalized for
duplicate detection. Different files may share an identity only with identical
retained source content and identical typed projection. They receive separate file
receipts but never replace business rows; counts across files are not additive.

## Storage and compatibility

Existing business tables remain unchanged. The local schema initializer adds
`wbs_h1_import.typed_source_row(domain, stable_key, source_payload jsonb)` to retain
the complete original JSON object, not just projected fields. Raw NDJSON line text
is cast to JSONB by PostgreSQL so JS number round-tripping cannot erase a difference
in unprojected source fields. JSONB equality ignores whitespace/property order;
the file SHA still binds exact bytes. Unsupported JSONB input (including NUL)
fails instead of being silently stripped from retained evidence.

New inserts use no-update conflicts plus exact population checks in the existing
single-client file transaction. A mismatch rolls back all new rows/evidence and
the receipt. Existing receipt replay verifies stored population, not just bytes.
Legacy typed rows without full source evidence are explicitly refused, even if
the projection matches. There is no fabricated automatic evidence backfill and no
deletion/rebuild command. Existing installations need a separately approved
reconciliation plan with retained original files; this change is not live-ready
for such data. Old receipts are never relabelled or updated by this implementation.

The additive table is local-import schema DDL, not an accounting migration. It
must be reviewed before running the initializer on an existing target. All writers
must use the current importer; its namespace advisory lock does not constrain an
old importer or an administrator issuing arbitrary SQL. Owner/admin remains a
trusted boundary. Identity tracking is per file in memory, so capacity testing is
still required for very large delivered files.

## Verification

Focused unit tests cover explicit keys, duplicate detection across batches,
read-only population verification on replay and drift rollback. The existing
required PostgreSQL fixture is extended with multi-batch missing/duplicate reference
keys, cross-file identical-content reuse, changed projected and unprojected source
content, legacy evidence refusal, and full before/after row/receipt/evidence checks.
The local Docker daemon is unavailable; real PG results must come from exact-SHA
fresh PG15/16/18 CI before approval. No local mock result is PostgreSQL evidence.
