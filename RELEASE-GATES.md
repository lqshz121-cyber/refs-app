# Release gates — what must be green, how it is run, what counts as evidence

Normative for promoting a commit to staging or production. A gate is passed only
by the listed command exiting 0 on the exact candidate SHA, with the raw log kept
in the release evidence bundle (`npm run create:release-evidence-bundle`). "The
page opens" and "health check returns 200" are **not** gates; they are the last
two lines of the matrix and prove reachability only.

## 0. Candidate selection

The candidate is the single commit that (a) is `origin/main`'s head, (b) contains
every SHA any environment currently runs, and (c) has the Accounting Kernel Gate
workflow green for that exact SHA. If any environment runs a SHA that is not an
ancestor of the candidate, stop: reconcile first.

| Environment | Where its SHA is read | Must satisfy |
|---|---|---|
| main | `git rev-parse origin/main` | = candidate |
| staging (Render) | `/health/ready` → `release_sha` (`REFS_RELEASE_SHA`) | ancestor of candidate |
| production (Render) | same | ancestor of candidate |
| Pages (frontend) | `runtime-config.json` written at build | = candidate once deployed |

## 1. Gate matrix (executed in this order; stop at first red)

| # | Gate | Command (from repo root unless noted) | Evidence file | Owner |
|---|---|---|---|---|
| 1 | Lockfile-exact install | `npm ci && (cd server && npm ci)` | `install.log` | CI |
| 2 | TypeScript domain gate | `npm run typecheck` | `typecheck.log` | CI |
| 3 | Frontend build + runtime asset verification | `npm run build` (runs `verify:runtime-deployment-assets`) | `build.log` | CI |
| 4 | SSR gate | `npm run test:ssr` | `ssr.log` | CI |
| 5 | Ledger audit gate (demo seed, content rules) | `npm run test:audit` → `fails=0` required; `PERIOD_CONTROL_EXCEPTIONS_FOUND` is reported, not a failure | `audit.log` | CI |
| 6 | Root release suite | `npm test` (pretest/test/posttest, 99 segments) | `root-test.log` | CI |
| 7 | Kernel static + unit gate | `cd server && npm test` | `server-test.log` | CI |
| 8 | Database dictionary least-privilege | `cd server && npm run test:database-dictionary` | `dbdict.log` | CI |
| 9 | Fresh zero-skip PostgreSQL gate, **PG 16 and 17 matrix** | `cd server && POSTGRES_IMAGE=postgres:16-alpine npm run test:postgres:fresh` | `pg16-fresh.log` | CI (Docker) |
| 10 | Migration barrier contract | `cd server && npm run test:postgres:barriers` | `pg16-barriers.log` | CI (Docker) |
| 11 | Posting SoD contract | `cd server && npm run test:postgres:sod` | `pg16-sod.log` | CI (Docker) |
| 12 | Context retry revocation | `cd server && npm run test:postgres:context-revocation` | `pg16-ctx.log` | CI (Docker) |
| 13 | Business-closure fixtures | `cd server && npm run test:postgres:fixtures:closure` | `pg16-closures.log` | CI (Docker) |
| 14 | Backup / restore drill | `cd server && npm run test:backup:restore` | `backup-restore.log` | CI (Docker) |
| 15 | Deploy workflow shape | `node verify-release-deploy-gate.mjs` (Pages waits for same-SHA kernel gate) | `deploy-gate.log` | CI |
| 16 | Config validation (production) | `REFS_DEPLOYMENT_ENV=production node -e "import('./server/runtime/config.mjs').then(m=>m.runtimeConfig())"` with the production env — four distinct role URLs, no local defaults, `REFS_EXPECTED_INSTALLATION_ID` + `REFS_EXPECTED_DATABASE_NAME` set | `config.log` | Release owner |
| 17 | Sensitive-data sweep | `git grep -nE 'refs_(migrator|runtime|issuer|grant_sync)_test_' -- ':!server/compose.yaml' ':!server/runtime/docker-init.sql' ':!server/tests' ':!server/runtime/test-*'` must be empty; no `outputs/` artifact tracked | `secrets.log` | Release owner |
| 18 | External chain (OIDC / S3 / scanner / WBS read-only) | `npm run verify:external-release-gate` — **fails closed without configuration; a "skipped" is not a pass** | `external.log` | Release owner |
| 19 | Migration pre-deploy | Render `preDeployCommand: npm run db:up` — expect `migration_completed` only for new entries, else `skipped`; any `migration_failed` aborts the deploy | Render deploy log | Release owner |
| 20 | Rollback definition on file | `server/PRODUCTION-RECOVERY-RUNBOOK.md` acknowledged; backup taken **before** step 19 with `refs_schema_migration` and ledger hash recorded | backup manifest | Release owner |
| 21 | Logging / alerting | `/health/ready` scraped; alert on `migration_runner_failed`, `startup_failed`, 5xx rate, outbox dead-letter count | monitoring config | Ops |
| 22 | Reachability (not acceptance) | `/health/ready` 200 with `release_sha` = candidate; frontend shell renders | `reachability.log` | Ops |

## 2. Rollback triggers

Any of: gate 19 emits `migration_failed`; `/health/ready` not 200 within the deploy window; post-deploy `startup_failed`; outbox dead-letter growth; any 5xx on posting/reopen/settlement routes. Action: **do not** run `db:down`. Follow `server/PRODUCTION-RECOVERY-RUNBOOK.md` (restore + forward fix); redeploy the previous binary only if the rollback drill (T15) has shown it tolerates the applied schema.

## 3. What this document does not do

It does not deploy, does not change Render resources, and does not accept a release. It defines what a reviewer must see to accept one.
