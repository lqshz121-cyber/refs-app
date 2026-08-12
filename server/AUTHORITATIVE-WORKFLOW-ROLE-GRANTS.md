# Authoritative workflow role grants

This operator-only command assigns one complete, frozen role bundle to the
subject in a verified REFS OIDC access token. It replaces that subject's grant
set for the configured entity; it does not append permissions. Run it from the
accounting API service shell with the isolated `refs_grant_sync` connection.

The approved roles are:

- `WBS_PAYABLE_REVIEWER`: review signed, persisted WBS Payable evidence only.
- `WBS_PAYABLE_MAKER`: create an AP Bill Draft from reviewed WBS evidence and
  submit its Journal Draft. It cannot review, approve, or post.
- `JE_REVIEWER`, `JE_APPROVER`, `JE_POSTER`: one Journal workflow stage each.
- `BANK_MATCH_MAKER`: create or undo an exact posted-payment match.
- `BANK_RECONCILIATION_MAKER`: start, clear, and prepare Draft adjustments.
- `BANK_RECONCILIATION_REVIEWER`, `BANK_RECONCILIATION_APPROVER`, and
  `BANK_RECONCILIATION_REOPENER`: one reconciliation control stage each.

Every role retains the fixed Stage 1 read permissions. No role grants
`WBS.SNAPSHOT.IMPORT`, `WBS.BANK.ADMIT`, or provider signing authority.

Required environment in the API service shell:

```text
NODE_ENV=production
REFS_DEPLOYMENT_ENV=staging
REFS_WORKFLOW_ROLE_CONFIRM=AUTHORITATIVE_WORKFLOW_ROLE_ONLY
REFS_STAGE1_TENANT_ID=<configured tenant UUID>
REFS_STAGE1_ENTITY_ID=<configured entity UUID>
REFS_WORKFLOW_ROLE=<one approved role above>
REFS_WORKFLOW_GRANT_EXPECTED_VERSION=<current grant-set version>
REFS_WORKFLOW_GRANT_IDEMPOTENCY_KEY=<new stable operation key>
REFS_AUTHENTICATED_ACCESS_TOKEN=<fresh token for this role's user>
OIDC_ISSUER=<API secret>
OIDC_AUDIENCE=<API secret>
OIDC_JWKS_URI=<API secret>
GRANT_SYNC_DATABASE_URL=<isolated refs_grant_sync connection>
```

Run `npm run workflow:grant`. A success response reports only role, version,
idempotency state, and permission count. Clear the access-token environment
value immediately afterward. A version conflict must be resolved by reading
the current grant-set version through the IAM owner; never guess or retry with
a wider permission bundle.
