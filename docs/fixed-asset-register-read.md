# Authoritative fixed asset register and movement reads

Migration 339 supersedes the public migration 338 reader with V2. GET routes:

- /api/v1/entities/{entityId}/fixed-assets/register
- /api/v1/entities/{entityId}/fixed-assets/register/{assetId}
- /api/v1/entities/{entityId}/fixed-assets/register/{assetId}/movements

All require FIXED_ASSET.REGISTER.VIEW. The finite FIXED_ASSET_VIEWER role
contains only that permission; importing its definition grants no live access.
A GL.REPORT.VIEW-only principal is denied. The old raw-UUID SQL reader is no
longer executable by refs_app. Each request requires asOfDate, rejects command
headers and bodies, and returns company/tenant-bound data without caching.

Asset population includes currently retained assets whose placed-in-service
date is on or before asOfDate. Balances include only exact-asset-dimension,
asset-currency, Posted PRIMARY ledger through that accounting date. This is an
accounting-effective projection of retained facts, not a transaction-time
historical database snapshot. Original reviewed cost is distinct from current
Posted cost. Decimal strings preserve numeric(20,4) precision; balances and
net book value are validated with integer decimal units.

Register V2 distinguishes REGISTERED, ACTIVE, DISPOSAL_POSTED and
DISPOSED_REVIEWED. State contracts close the allowed evidence fields: registered
assets have zero ledger lines/balances and no disposal; active assets have
Posted movement and no disposal; disposal states require retained posting and
source fields, zero cost/depreciation/impairment/net balances, and the appropriate
absence or presence of review evidence. Invalid or incomplete backend receipts
are not presented as valid balances. Legacy reviews without exact binding do
not satisfy the complete V2 disposal contract; this change does not invent or
backfill accounting authority.

List and movement pages are bounded to 1..100 rows. Their opaque cursors are
HMAC-signed with a private database key. List cursors bind tenant, company,
asOfDate and last asset UUID. Movement cursors additionally bind asset and
read kind. Reuse in another scope/date/read kind or signature alteration is
rejected. UUID ordering is stable; each request uses a fresh database snapshot.
New records before a consumed ordering key require refreshing the list.
Cross-request snapshot consistency is not promised. Key storage and cursor
helper functions are not accessible to refs_app. Rollback removes the V2 read
objects/index/private key and exactly restores migration 338; accounting records remain.

The complete closed OpenAPI schemas are parity-tested against runtime schemas.
Rows include policy/accounts, member trace, register source/hash/reviewer,
capitalization proposal and disposal journal/binding/review. Disposal source
hash, immutable version and source_link_id are retained fields, not current
source values substituted for history. Invalid fields, extra/missing fields,
state combinations, amounts and scope are rejected.

Movement pages expose actual journal, journal-line, ledger-line, posting batch,
period, account, amounts, dimensions and posting audit. JE_LINE_TO_LEDGER links
are checked using all journal/line/batch/ledger identifiers. Missing or ambiguous
links receive explicit blocked lineage status. Full-journal ledger debit/credit
totals and line count are separate from page contents: one journal may span
pages. Per-page amounts must not be used to judge full-journal balance.

EXACT_DISPOSAL_SOURCE means the movement's journal has the immutable migration 337
binding and its exact SOURCE_TO_JE link. Acquisition/depreciation/impairment
journals without that authority report BLOCKED_MISSING_EXACT_SOURCE_BINDING;
source fields remain null. Register sources are not inferred as their posting
sources. Impairment assessment ID/hash and valuation source ID/hash are shown
as assessment evidence, separately from posting sources. No mutable source
version is substituted for an assessment's unretained historical version.

Actual PostgreSQL/HTTP proof posts acquisition, depreciation, impairment and
disposal, reads eleven ledger lines over four pages, checks source/ledger/audit
links, then compares each row to General Ledger and TRIAL_BALANCE output.
Period and ending debit/credit totals are recomputed in exact decimal units.
Report source IDs are checked as the union of actual linked journals; a disposal
source on a mixed account does not supply missing sources for earlier movements.
Cursor negatives include another valid same-company asset and an authorized
valid asset in a different tenant/company. Migration down/up is transactional.

A separate retained-read fixture proves four pages over 152 assets without
repeats/omissions. A 100,001-asset PostgreSQL 16 fixture reads first, next and deep
pages in 213 ms in the recorded run, excluding 99,579 ms of fixture creation. This is
local bounded-read performance evidence, not live production capacity or native
bulk creation workflow acceptance. OIDC test signature mutation now flips a
decoded byte deterministically; production authentication is unchanged.

Full fixed-asset delivery still requires exact source-bound acquisition,
depreciation and impairment Draft/Posting controls, typed entry/pre-post
financial validation, V2 client/UI alignment, concurrent-change UX and broader
production performance, independent exact gates and real user/live workflows.
The blocked source states expose unfinished lineage; they do not complete it.
