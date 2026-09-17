# Historical migration tests without crossing barriers (S18)

## Problem

`postgres-kernel.test.mjs` has 20 `migrateDownThrough(adminPool,'<NNN>…')`
call sites (targets 181–333) and 16 `probeMigrationRoundTrip` sites. The
former walk the *shared* gate database down from the release head (423) to the
target. Every path crosses `down/401` (unconditional `RAISE`) and several
conditional barriers (e.g. 55006 "context additive-authority guard with active
contexts"). On any head ≥ 401 these tests fail with P0001/55006 before reaching
the migration they mean to test — this is the pre-existing red set triaged in
P0-B, N12 (:7241) and N11/N14 (:7733).

## Decision

Do not weaken barriers and do not add `migrateDown({force})`. A test that needs
a historical schema head builds it on a **fresh `_test` database** with
`migrateUp(pool,{until:'<NNN>…'})`, exercises that migration's down/up there, and
drops the database. Barriers are never crossed; the live chain is never walked
backwards.

## Runner change (implemented)

`migrateUp(pool,{until})`:
- allowed only when `current_database()` ends in `_test` (`MIGRATION_UNTIL_FORBIDDEN`);
- `until` must be a manifest file name (`MIGRATION_UNTIL_UNKNOWN`);
- the manifest and the ledger-ahead check still evaluate the **full** file list, so a
  database ahead of the release is refused exactly as before;
- applies `name <= until` in manifest order; a later plain `migrateUp` completes
  the chain, so the fixture is never a fork.

Proof: `tests/migration-historical-head-postgres.test.mjs` (5/5 on PG 16.4):
head = 317 exactly; down 317 → up 317; full up → 429; unknown target refused;
non-`_test` database refused.

## Conversion pattern for the 20 call sites (to do, one hunk each)

```js
// before
await migrateDownThrough(adminPool,'317_native_sales_receipt.sql');
await migrateUp(adminPool);

// after
await withHistoricalHead('317_native_sales_receipt.sql',async ({pool,url})=>{
  await migrateDown(pool);           // the migration under test
  await migrateUp(pool,{until:'317_native_sales_receipt.sql'});
  // any assertions that need the historical head go here, on `pool`
});
// the shared gate database is untouched; the rest of the test continues on adminPool
```

`withHistoricalHead` = create `refs_hist_<rand>_test`, retarget the four role
URLs (as the proof test does), `migrateUp({until})`, run, drop with `FORCE`,
restore env. Each conversion is reviewed against the test's original intent:
where the original also asserted feature behaviour *after* the roundtrip on the
shared database, that part stays as is.

Cost: one CREATE DATABASE + up-to-N migrations per site (~3–8 s each on PG16);
acceptable in `postgres-required`, and far cheaper than the current guaranteed
failure.

## Out of scope

`probeMigrationRoundTrip` (in-transaction single-function down/up with ROLLBACK)
already avoids barriers and stays.
