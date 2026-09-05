# ADR-301: Production IAM deployment attestation

Status: Accepted for implementation; deployment requires independent approval.
Date: 2026-09-06

## Context

An environment variable is operator intent, not evidence of the connected database's environment. Production IAM must reject a wrong target before OIDC/JWKS access and before any grant reservation, audit, outbox, context, or accounting mutation. Existing staging callers and generic v2 reconciliation must remain compatible.

## Decision

Migration 301 adds an initially empty, singleton installation identity. Its installation UUID, `staging|production` environment, exact database name, and initialization timestamp cannot be updated, deleted, or truncated. Only the independent migration-owner login can execute the explicit initialization ceremony. Repeating the identical tuple returns false without a write; any drift fails closed. The owner/superuser remains the trusted administration boundary, not an adversary this mechanism can constrain.

`refs_grant_sync` receives no table access and only EXECUTE on the narrow SECURITY DEFINER assertion. PUBLIC, application, runtime, and context issuer have neither initialization nor assertion authority. The assertion checks the actual login and current database and returns only true or an error.

The production CLI checks four distinct database roles/credentials on one endpoint, requires expected installation and exact database, and asserts retained identity before authenticating a human or reconciling a service role. Human actor and tenant come from verified OIDC; entity existence/tenant membership is checked by v2. Exactly one frozen role is reconciled with canonical hash, finite human expiry <=24h, expected-version CAS, idempotency, audit and outbox. Service roles stay separate and use configured service actor identities. No API route grants roles and no live actor is automatically assigned.

## Alternatives and trade-offs

Environment-only gating was rejected because it authenticates neither database nor installation. Altering generic v2 was rejected because it would break staging/existing IAM clients. A separate CLI with a shared policy parser adds a deliberate administrative step but preserves current call contracts. The database owner is trusted to initialize the right environment; retain the installation UUID in independently approved operational records.

## Operations

1. Apply forward migrations using the independent migration credentials. Migration alone does not initialize identity or grant any role.
2. Independently approve an installation UUID, environment and exact database name. Supply all four existing database URLs (never in command history or documentation).
3. Set `REFS_EXPECTED_INSTALLATION_ID`, `REFS_DEPLOYMENT_ENV`, `REFS_EXPECTED_DATABASE_NAME`, and `REFS_DEPLOYMENT_IDENTITY_CONFIRM=INITIALIZE_IMMUTABLE_DEPLOYMENT_IDENTITY`. Run `node server/tools/initialize-deployment-identity.mjs` once. Identical replay is safe. Do not initialize merely to make a failing assertion pass.
4. For one approved production role, set `NODE_ENV=production`, `REFS_DEPLOYMENT_ENV=production`, `REFS_WORKFLOW_ROLE_CONFIRM=PRODUCTION_WORKFLOW_ROLE_ONLY`, the expected installation/database, and the existing role configuration (`REFS_STAGE1_TENANT_ID`, `REFS_STAGE1_ENTITY_ID`, `REFS_WORKFLOW_ROLE`, expiry, expected version, idempotency key, and verified-token OIDC settings for humans). Run `node server/tools/production-workflow-role-grant.mjs`. Existing STAGE1 scope variable names are retained for compatibility; they are not staging authority.
5. Service-only roles use their existing dedicated configured actor variable, not a human access token. Never place tokens or database URLs in logs or committed artifacts.

Restore/clone retains the original installation identity. Name/environment/installation mismatch is a STOP condition; never automatically re-seal or relabel the database. An uninitialized migration can roll back; an initialized identity makes migration 301 rollback fail closed. Disaster recovery uses a reviewed forward plan, not identity deletion.

## Verification

The existing staging CLI now calls a separate narrow staging-target guard before OIDC or reconciliation. Never-initialized legacy staging databases remain compatible. Once initialized, staging requires the exact expected installation UUID and database, and a production identity is always rejected even when callers supply staging environment variables. A missing migration/guard also fails closed. Generic v2 reconciliation and policy-only helpers retain their contracts; they are not CLI deployment authorization.

The production IAM fixture is registered in the existing fresh PostgreSQL suite and therefore runs in required PostgreSQL 15/16/18 CI. It uses real PostgreSQL ACLs via session authorization and rolls its synthetic initialization back. It checks uninitialized/wrong-environment/wrong-installation/wrong-database before key lookup; ordinary-role privilege denials; immutable replay/drift; invalid signature/audience, cross-tenant, mixed authority, unknown entity, overlong expiry; unchanged grant/audit/outbox/context/idempotency/accounting counts after denials; exact replacement, CAS, canonical audit/outbox hashes, idempotent replay and distinct service-only ceremony. No fixture touches a live deployment.
