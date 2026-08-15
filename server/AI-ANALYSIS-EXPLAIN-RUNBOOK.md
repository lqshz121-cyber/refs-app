# Authoritative AI analysis enablement

Use this only after migration `140_ai_analysis_explain_scope.sql` is deployed
to the authoritative accounting database. It grants explanation of retained,
source-bound findings; it does not grant a proposal, Draft JE, review,
approval, posting, or source-system write.

## Preconditions

- Confirm the OIDC subject, tenant UUID, and entity UUID.
- Deploy the release containing the empty-evidence guard and migration 137.
- Configure an approved AI gateway only through Render secrets; never place a
  gateway key in source, audit payloads, or tickets.
- At least one retained authoritative finding must exist. Empty evidence is
  rejected before any model request or idempotency/audit reservation.

## Grant

Use the isolated `refs_grant_sync` IAM workflow to reconcile the actor's
complete active, entity-scoped grant set with exactly one added permission:
`AI.ANALYSIS.EXPLAIN`.

Do not write `runtime_actor_grant` directly. Preserve existing authorized
read permissions, use the current grant-set version, a new idempotency key,
and the canonical request hash. Do not add any of the following merely to
explain findings:

- `AI.AMORTIZATION.PROPOSE`
- `GL.JE.*`
- review, approval, or posting permissions

## Verify

1. Sign out and sign in again to refresh the OIDC runtime context.
2. Read the authoritative retained finding families and request one analysis
   explanation for the entity.
3. Confirm `can_create_draft=false`, `can_review=false`,
   `can_approve=false`, and `can_post=false`.
4. Confirm the `AI_ACCOUNTING_ANALYSIS_EXPLAINED` audit event records the
   actual permission used and a source-bound response hash.
5. Repeat the same idempotency key and confirm a durable replay without a
   second model request.

## Rollback

Remove `AI.ANALYSIS.EXPLAIN` through the same IAM sync flow. This revokes
access without deleting retained findings or prior audit evidence. Roll back
migration 137 only after no active grant references that permission.

## Escalate instead of bypassing

Escalate if retained evidence is absent, a reader is denied, or an output
exposes any accounting action flag. Do not use browser storage, mock data,
direct database writes, or a broader accounting role to work around it.
