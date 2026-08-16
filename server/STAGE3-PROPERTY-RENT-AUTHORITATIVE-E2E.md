# Stage 3 Property Operations → Rent Pickup current-release verifier

This verifier is an authenticated, `GET`-only readback of one already-posted, provider-signed Property Rent charge. It performs no admission, Review, Draft creation, transition, posting, export, or WBS browser access.

## Required environment

- `REFS_STAGING_API_BASE_URL`: exact HTTPS API origin.
- `REFS_STAGING_WEB_ORIGIN`: exact HTTPS authoritative web origin.
- `REFS_RELEASE_SHA`: full 40-character Git SHA expected from API live, API ready, and `refs-build.js`.
- `REFS_STAGE3_PROPERTY_RENT_E2E_READ_ACCESS_TOKEN`: short-lived read-only OIDC token. It is sent only as a Bearer header and must never be printed or written to an artifact.
- `REFS_STAGE3_PROPERTY_RENT_E2E_SCENARIO_PATH`: protected JSON scenario path.

The scenario freezes the entity and period plus exact admission, review, Draft, source, staging, business document, Journal Entry, mapping, Journal-line and ledger-line UUIDs. It also freezes source version, receipt/evidence/mapping hashes, Property reference, MONEY4 amount, two account codes, revision, three actors, and review/Draft/Post timestamps.

## Execute

From `server/`:

```text
node runtime/verify-stage3-property-rent-authoritative-e2e.mjs
```

The verifier first requires API live, API ready, and authoritative web to report the same `REFS_RELEASE_SHA`. Only then it issues authenticated `GET` requests for:

1. the period-scoped Property Rent pickup queue;
2. the exact POSTED AUTO Journal detail;
3. the receivable and revenue General Ledger legs;
4. the exact `PROPERTY` dimension-profitability report.

It requires canonical MONEY4 strings, exactly two source-bound Journal/GL legs, immutable mapping/review/Draft evidence, actors and timestamps, and Property report lineage back to the exact Journal, lines, ledger lines, and signed source document. Mixed releases, cross-period rows, JavaScript/numeric amounts, duplicate identities, or incomplete lineage fail closed.

Success proves only current-release readback of the supplied already-posted scenario. It does not prove provider admission completeness, WBS-wide source completeness, mapping completeness for other Properties, or authority to create or post accounting.
