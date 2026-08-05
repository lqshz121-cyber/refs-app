# Full-stack staging integration plan

## Preconditions

This is a plan only. Do not start the merge until independent audit confirms
that `main@b2c30361af4a5f95f56106f614ff97b0cb04ccf8` has no `server/` tree and
that `b330cd5bfcf29214c889620bb2ebc5d25c85196d` contains the reviewed full-stack
tree. Do not force-push any branch.

## Inputs and integration order

1. Create a new integration worktree and branch from
   `b330cd5bfcf29214c889620bb2ebc5d25c85196d`.
2. Record a clean baseline: `git status --short`, `git diff --check`, and the
   baseline SHA.
3. Merge the current reviewed UI release as one non-fast-forward merge:
   `git merge --no-ff --no-commit b2c30361af4a5f95f56106f614ff97b0cb04ccf8`.
   This preserves the deployed UI lineage (`ffc11d1`, `ac427e3`, `b2c3036`) and
   avoids cherry-picking only part of a Pages release.
4. Resolve only audited UI conflicts, run the validation gates below, commit a
   new frozen integration SHA, then submit it for independent audit.

## Expected conflict review set

Audit these paths if Git reports a conflict; do not use `ours` or `theirs`
without reviewing the semantic result:

- `index.html` — shared English/readability and responsive topbar/Table CSS.
- `src/app.jsx`, `src/ui.jsx`, `src/modules-core.jsx`, `src/modules-more.jsx` —
  shell, Dashboard business-fit navigation, and report layout.
- `src/module-ap.jsx`, `src/module-ar.jsx`, `src/module-banktx.jsx`,
  `src/module-bankrec.jsx`, `src/module-coa.jsx` — previously divergent UI
  surfaces; retain the `b330cd5` API/accounting boundary and the reviewed UI
  presentation only.
- `package.json`, `package-lock.json`, `.gitignore`, verifier scripts — retain
  deterministic full-stack scripts from `b330cd5`; do not accept unrelated
  dirty package changes.

## Required validation before any staging deploy

All commands below run from the future clean full-stack integration worktree.
Create a per-run evidence directory first and preserve every `*.log` and
`*.exit` file for audit:

```powershell
$run = Get-Date -Format 'yyyyMMdd-HHmmss'
$evidence = "outputs/staging-gate/$run"
New-Item -ItemType Directory -Force -Path $evidence | Out-Null
```

### Local integration matrix

```powershell
git status --short
git diff --check
npm ci
npm run build
node tools/run-verifiers.mjs *>&1 | Tee-Object "$evidence/root-visual.log"
$LASTEXITCODE | Set-Content "$evidence/root-visual.exit"
Set-Location server
npm ci
npm test *>&1 | Tee-Object "$evidence/server-unit.log"
$LASTEXITCODE | Set-Content "$evidence/server-unit.exit"
$env:POSTGRES_IMAGE='postgres:16-alpine'
npm run test:postgres:fresh *>&1 | Tee-Object "$evidence/pg16-fresh.log"
$LASTEXITCODE | Set-Content "$evidence/pg16-fresh.exit"
$env:POSTGRES_IMAGE='postgres:15-alpine'
npm run test:postgres:fresh *>&1 | Tee-Object "$evidence/pg15-fresh.log"
$LASTEXITCODE | Set-Content "$evidence/pg15-fresh.exit"
```

The integration SHA must add back the reviewed root `test` script from
`b330cd5`; `main@b2c3036` has no acceptance-grade root test script and must
not be treated as passing this matrix until then.

### Source, dist, and preview UI matrix

```powershell
rg --pcre2 -n --glob '*.js' --glob '*.jsx' '[\p{Han}\x{FFFD}\x{80}-\x{9F}]' src *>&1 |
  Tee-Object "$evidence/source-visible-unicode.log"
$LASTEXITCODE | Set-Content "$evidence/source-visible-unicode.exit"
rg --pcre2 -n '[\p{Han}\x{FFFD}\x{80}-\x{9F}]' dist *>&1 |
  Tee-Object "$evidence/dist-visible-unicode.log"
$LASTEXITCODE | Set-Content "$evidence/dist-visible-unicode.exit"
```

For the SHA-specific HTTPS preview, run the audited browser capture command
and save one PNG plus one visible-text JSON per page under
`$evidence/ui/`: Dashboard, Reports, Reconcile, BankTx, Expenses, Accounting,
Rule Center, and Integration Hub. Each JSON must include preview URL, build
stamp, headings, visible CJK/mojibake matches, and capture timestamp. The
browser runner is the current release-audit harness; its invocation is:

```powershell
node tools/capture-live-ui-evidence.mjs --base-url "$env:REFS_STAGING_WEB_ORIGIN" --out "$evidence/ui" *>&1 |
  Tee-Object "$evidence/ui-capture.log"
$LASTEXITCODE | Set-Content "$evidence/ui-capture.exit"
```

If that capture harness is not present in the integrated SHA, this is a
fail-closed P0: add it before accepting a preview, rather than replacing the
eight-page evidence with a source scan.

### HTTPS API and OIDC matrix

Platform/Ops must load exactly these server variables in the secret store:
`DATABASE_URL`, `MIGRATION_DATABASE_URL`,
`CONTEXT_ISSUER_DATABASE_URL`, `GRANT_SYNC_DATABASE_URL`, `OIDC_ISSUER`,
`OIDC_AUDIENCE`, `OIDC_JWKS_URI`, `REFS_HTTP_ALLOWED_ORIGINS`,
`REFS_STAGING_API_BASE_URL`, and `REFS_STAGING_WEB_ORIGIN`. The web deployment
must also receive the public `REFS_PUBLIC_OIDC_*` and
`REFS_PUBLIC_ACCOUNTING_API_BASE_URL` coordinates from `.env.staging.example`.

```powershell
Set-Location server
npm run validate:staging-env *>&1 | Tee-Object "$evidence/staging-env.log"
$LASTEXITCODE | Set-Content "$evidence/staging-env.exit"
npm run test:staging:smoke *>&1 | Tee-Object "$evidence/staging-api-oidc-smoke.log"
$LASTEXITCODE | Set-Content "$evidence/staging-api-oidc-smoke.exit"
```

`test:staging:smoke` proves HTTPS readiness, web security headers/runtime
coordinates, CORS, and anonymous fail-closed API behavior. A separately
recorded OIDC login/callback token refresh is still required before calling
the browser E2E authenticated.

### S3/scanner lifecycle matrix

Platform/Ops must provide: `S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION`,
`S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `VIRUS_SCANNER_ENDPOINT`,
`VIRUS_SCANNER_TOKEN`, `VIRUS_SCANNER_CA_FILE`,
`VIRUS_SCANNER_SERVER_NAME`, `ATTACHMENT_SCANNER_ACTOR_ID`,
`ATTACHMENT_CLEANUP_ACTOR_ID`, and `ATTACHMENT_CLEANUP_SCOPES`.

```powershell
Set-Location server
npm run test:attachments:containers *>&1 | Tee-Object "$evidence/s3-scanner-container.log"
$LASTEXITCODE | Set-Content "$evidence/s3-scanner-container.exit"
```

This command is a disposable container parity gate, not proof of the provider
bucket. Before release, Platform/Ops must also preserve a staging upload → scan
→ allow/quarantine → authorized cleanup transaction log at
`$evidence/s3-scanner-staging-lifecycle.log`; absence of that provider-backed
artifact is a P0.

### WBS signed nonempty receipt matrix

Platform/WBS must set `WBS_SNAPSHOT_ED25519_PUBLIC_KEYS` to the approved public
keyring only, then provide one de-identified nonempty read-only snapshot with
key id, Ed25519 signature, package hash, scope, version and timestamp.

```powershell
Set-Location server
node --test tests/wbs-snapshot-package.test.mjs tests/wbs-snapshot-signature.test.mjs *>&1 |
  Tee-Object "$evidence/wbs-receipt-verifier.log"
$LASTEXITCODE | Set-Content "$evidence/wbs-receipt-verifier.exit"
```

The actual provider receipt verification/admission command must be added to
the full-stack integration SHA with a fixed input path and a receipt-only log
that excludes credentials and raw business rows. Until that command and its
nonempty provider artifact exist, WBS remains a release P0.

### Rollback evidence

```powershell
git status --short | Tee-Object "$evidence/pre-rollback-status.log"
git show --no-patch --format=fuller HEAD | Tee-Object "$evidence/candidate-sha.log"
git revert -m 1 <merge-sha> --no-edit
git diff --check
git status --short | Tee-Object "$evidence/post-revert-status.log"
```

Only execute the revert on the integration branch after a failed deploy. For
an uncommitted merge use `git merge --abort`; do not reset or force-push.

### External gates

Only after Platform/Ops supplies the HTTPS API/OIDC/S3/scanner configuration
and WBS supplies the signed receipt may these commands be counted as passing.

## Safe rollback

Before the merge, create and push a named integration baseline branch. During
the uncommitted merge, use `git merge --abort` if a conflict cannot be resolved
without changing accounting behavior. After a committed candidate, revert the
single merge commit with `git revert -m 1 <merge-sha>`; never reset, force-push,
or overwrite `main`, `release/b874bc0-staging`, or the deployed Pages branch.
