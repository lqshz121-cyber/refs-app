# Staging deployment gate

This blueprint is a deployment contract, not evidence of a live deployment.

1. Provision one TLS PostgreSQL endpoint with four distinct roles: runtime,
   migrator, context issuer, and grant sync.  Set the four corresponding URLs
   with `sslmode=verify-full`; do not reuse a role or password.
2. Provision an HTTPS OIDC issuer that returns RS256 access tokens containing
   `tenant_id` and `sub`, with the configured audience.  Configure the static
   frontend's runtime adapter to supply a short-lived bearer token through
   `getAccessToken`; never place an access token in `refs-runtime-config.js`.
3. Provision versioned object storage, a TLS scanner bridge, its CA file, and a
   least-privileged cleanup worker identity plus DB-authorized entity scopes.
4. Set the exact static frontend URL as `REFS_HTTP_ALLOWED_ORIGINS`.  The API
   allows only explicit HTTPS origins and requires the OIDC bearer token on all
   accounting reads and commands.
5. Before traffic: run migrations with the migrator identity, verify
   `/health/ready`, then execute a real browser login, refresh, Draft →
   Approve → Post, refresh persistence, and a rejected cross-tenant request.

The staging gate remains failed until those external resources and the browser
test have actual recorded evidence.

The two staging services intentionally use `autoDeployTrigger: off`; promote a
tested commit manually.  The API's `preDeployCommand` needs a Render plan that
supports pre-deploy commands.
