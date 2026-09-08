# Acquisition source drill

Migration 352 upgrades the asset movement response to `FIXED_ASSET_MOVEMENTS_V2`. A posted acquisition row can expose its retained posting source when the scoped acquisition binding, acquisition posting, original evidence binding and `SOURCE_TO_JE` link all identify the same asset and journal. The projection reads retained identity, version and hash; it does not infer a source from an account or amount.

The acquisition source link must also identify the exact source document line retained by the acquisition binding. A historical link with a null line, or a different line on the same document, cannot produce an exact acquisition source. The real PostgreSQL scenario verifies the matching line, temporarily clears it in the disposable fixture, checks that the entire source tuple becomes blocked, and restores it before checking visibility again.

Each row requires nullable `acquisition_binding_id`. `EXACT_ACQUISITION_SOURCE` requires that binding and the complete source tuple, with no disposal binding. `EXACT_DISPOSAL_SOURCE` requires the converse. Missing or multiple source candidates expose no source tuple. Depreciation, impairment and legacy entries without the exact retained chain continue to report that no posting source link is retained.

The asset activity page offers **View posting source** for either exact family. The existing drill reads the source again in the row's accounting period and checks the retained version, hash, currency and posted journal membership before opening it. A mismatch displays an error instead of substituting another source.

The detail identity includes the selected accounting period and API base URL. Changing either unmounts the current acquisition/activity panels and invalidates their pending requests; the detail effect loads the replacement view. The actual same-company period-switch browser scenario remains part of integration acceptance.

`npm run test:asset-acquisition-browser` also runs the checked-in scope browser harness. Chromium renders the actual asset workspace and movement component, with mocked API exports and a minimal lineage renderer. It verifies late-source rejection after a same-company period switch, closure of an already-open drill, opening in the retained row period, and refusal of changed hash/version/currency/journal membership. These component checks do not replace real API/source-drill acceptance.

Deploy the V2 database function and matching API/frontend contract together. A V1 payload is rejected by the V2 validator. The down migration restores the previous V1 read function and grants; it does not remove any acquisition, original evidence, ledger or source history. A rollback therefore also requires the previous API/frontend contract.

Development evidence: closed contract tests, fixed asset UI suite and three fresh PostgreSQL 16 cases passed without skips in the selected database scope: posted asset register/source reconciliation, posting audit migration compatibility, and exact V2/down-to-V1/up-to-V2 function roundtrip. A further real register run verifies that removing either original evidence binding or acquisition posting in the disposable fixture blocks the entire acquisition source tuple while disposal remains readable; restoring the exact fixture rows restores acquisition source visibility. Reads use the real runtime connection and viewer identity. Fixture restoration preserves consumption history without repeating insert-trigger side effects.

This is not final release acceptance. Independent audit, full required database gates and real source-drill browser acceptance remain required.
