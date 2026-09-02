# Production AI accounting E2E runner

This runner verifies the shortest authoritative chain from one retained provider-signed WBS source through an AI accounting decision, distinct human workflow actors, a POSTED Journal, an approved immutable financial-statement snapshot, and a server-derived Posted outcome review.

It is **GET-only by default**. Do not enable writes until the exact release has passed CI and deployment gates, the business owner has approved this exact source and period, and IAM has issued the distinct frozen roles below. The runner never deploys, grants permissions, reads browser storage, or accesses the database directly.

## Non-secret scenario file

Keep tokens out of this file. Store only approved immutable identifiers and hashes:

```json
{
  "tenantId": "00000000-0000-4000-8000-000000000000",
  "entityId": "00000000-0000-4000-8000-000000000000",
  "periodId": "00000000-0000-4000-8000-000000000000",
  "sourceDocumentId": "00000000-0000-4000-8000-000000000000",
  "admissionId": "00000000-0000-4000-8000-000000000000",
  "sourcePayloadHash": "sha256:...",
  "sourceLineHash": "sha256:...",
  "sourceRowHash": "sha256:...",
  "admissionHash": "sha256:...",
  "runKey": "approved-change-ticket-unique-run-key",
  "reason": "Human verified the exact retained signed source and approved settings.",
  "actors": {
    "producer": "approved-oidc-sub",
    "maker": "approved-oidc-sub",
    "reviewer": "approved-oidc-sub",
    "approver": "approved-oidc-sub",
    "poster": "approved-oidc-sub",
    "snapshotPreparer": "approved-oidc-sub",
    "snapshotApprover": "approved-oidc-sub",
    "outcomeReviewer": "approved-oidc-sub",
    "readback": "approved-oidc-sub"
  }
}
```

Every actor value must be distinct. The source must already be provider-signed and admitted; this runner does not upload or admit source data.

## Environment

Required public configuration: `REFS_STAGING_API_BASE_URL`, `REFS_STAGING_WEB_ORIGIN`, exact 40-character `REFS_RELEASE_SHA`, and `REFS_PRODUCTION_AI_E2E_SCENARIO_PATH`.

Tokens are supplied only through the process environment and are never printed:

- `REFS_PRODUCTION_AI_E2E_PRODUCER_TOKEN`: `AI_CONTROLLER_REVIEWER`
- `REFS_PRODUCTION_AI_E2E_MAKER_TOKEN`: an entity-bound human maker with `GL.JE.CREATE`, `GL.JE.SUBMIT`, and `GL.JE.VIEW`. The same maker accepts the decision, creates the Draft, and submits that Draft; this matches the JE maker authority boundary while remaining separated from Review, Approve, and Post.
- `REFS_PRODUCTION_AI_E2E_REVIEWER_TOKEN`: `JE_REVIEWER`
- `REFS_PRODUCTION_AI_E2E_APPROVER_TOKEN`: `JE_APPROVER`
- `REFS_PRODUCTION_AI_E2E_POSTER_TOKEN`: `JE_POSTER`
- `REFS_PRODUCTION_AI_E2E_SNAPSHOT_PREPARER_TOKEN`: `GL_REPORT_SNAPSHOT_PREPARER`
- `REFS_PRODUCTION_AI_E2E_SNAPSHOT_APPROVER_TOKEN`: `GL_REPORT_SNAPSHOT_APPROVER`
- `REFS_PRODUCTION_AI_E2E_OUTCOME_REVIEWER_TOKEN`: `AI_CONTROLLER_REVIEWER` assigned to a different human/service subject from the producer
- `REFS_PRODUCTION_AI_E2E_READBACK_TOKEN`: a read-only actor with `GL.JE.VIEW`, `GL.REPORT.VIEW`, and `WBS.AUTOREC.VIEW`

Run the default preflight:

```powershell
npm run test:production-ai-accounting-e2e
```

It verifies API live/ready and Web build are exact `REFS_RELEASE_SHA` and `no-store`; every token resolves to the approved entity-bound actor; sessions are current; permissions are present without conflicting JE/report authority; the period is `OPEN`; and the exact signed source/payload/line hashes are retained. It sends no POST requests. The maker is one actor with Create + Submit + View; Reviewer, Approver, Poster, snapshot Preparer, and snapshot Approver remain distinct actors.

## Authorized write execution

Only after reviewing the preflight output and obtaining explicit accounting-write authorization, set both exact interlocks in the same process:

```powershell
$env:REFS_PRODUCTION_AI_E2E_WRITE_MODE='ENABLED'
$env:REFS_PRODUCTION_AI_E2E_WRITE_CONFIRMATION='I_UNDERSTAND_THIS_CREATES_AND_POSTS_ACCOUNTING'
npm run test:production-ai-accounting-e2e
```

One switch alone remains GET-only. A caller cannot forge `writeEnabled`: the runner internally verifies a module-private authorization proof bound to the exact release SHA, tenant/entity/period, signed source IDs and hashes, and `runKey` before any network request. With both switches, the runner stops on the first mismatch and performs:

1. retain the complete AI decision population and select the exact signed source;
2. read queue → human accept → read queue;
3. create standard MANUAL Draft → GET Journal;
4. the Draft maker submits, then distinct Reviewer, Approver, and Poster actors advance the exact `PENDING_REVIEW → PENDING_APPROVAL → APPROVED → POSTED` states with unique idempotency keys and exact strong `If-Match` revisions, followed by GET and retained queue readback after every transition;
5. prepare and independently approve the immutable statement snapshot, with GET readback;
6. retain the server-derived Posted outcome review using its exact current review revision, then GET history;
7. read the complete paged retained-decision queue and complete paged GL population, then require the exact Journal/source lineage in GL and financial statements.

AI decisions, human acceptance, Draft creation, snapshot commands and outcome review use their API-defined immutable hash/revision CAS fields. JE transitions use strong `If-Match`. Re-running the exact scenario is a real recovery path: every command is replayed with the same actor, payload, revision, and idempotency key, so already completed steps must return their sealed receipt while incomplete steps continue from the retained queue/Journal state. A different actor, payload, revision chain, release/source binding, or later outcome review fails closed. Never retry with a different `runKey` after an uncertain response.

Do not enable writes when release stamps drift, any actor overlaps, any token is duplicated, a session needs refresh, the period is not OPEN, source scope/hash/signature differs, or any response lacks `Cache-Control: no-store`.
