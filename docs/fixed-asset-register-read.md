# Authoritative fixed asset register reads

Migration 338 adds refs_read_fixed_asset_register and two GET routes:
/api/v1/entities/{entityId}/fixed-assets/register and its /{assetId} detail.
Both require GL.REPORT.VIEW and an explicit asOfDate. List requests accept
limit 1 through 100 and an after UUID keyset cursor. Detail is scope-bound;
missing assets return404 without exposing another company's data. Reads reject
command headers and bodies. SQL runs under the trusted runtime identity.

Balances sum exact-asset-dimension Posted PRIMARY ledger lines through the
accounting date, in the asset currency. MONEY4 values remain decimal strings.
Original reviewed cost is separate from the Posted cost balance. Depreciation
and assessment-account impairment are subtracted to derive net book value.
A reviewed register without Posted movement is REGISTERED; otherwise ACTIVE.
A dated posting marker yields DISPOSAL_POSTED; dated review evidence yields
DISPOSED_REVIEWED. Querying a prior accounting date excludes the later disposal.
The immutable register status is not rewritten. These are current retained
facts projected by accounting date, not a historical transaction-time snapshot.

Rows include reviewed asset policy/accounts, source identity/hash, reviewer,
capitalization proposal, member trace and disposal binding/journal/review IDs.
Indexed company/UUID pagination evaluates balances only for the current page.
Pages each use a fresh database snapshot; no cross-request snapshot is promised.
No writes, automatic posting, new permissions or production grants are added.
Rollback drops only the read function and its two indexes.

The actual database/HTTP regression registers an asset, posts acquisition,
depreciation, impairment and disposal, then independently reviews disposal.
It verifies dated balances 25000,23000,18000,0; REGISTERED/ACTIVE/
DISPOSAL_POSTED/DISPOSED_REVIEWED; disposal trace and cross-company denial.
Migration probes run in their own rolled-back transactions. An inherited337
rollback probe was corrected to avoid uninstalling later migrations before
its expected history rejection.

Remaining full product acceptance includes multi-row pagination/concurrent
read and 100000-row performance, bounded ledger/journal/audit drilldown,
complete response contract review, API client and native page integration,
typed entry and pre-post financial validation, independent exact-SHA audit,
and live user workflows. Passing these focused reads does not complete the
fixed-asset module or the full platform.
