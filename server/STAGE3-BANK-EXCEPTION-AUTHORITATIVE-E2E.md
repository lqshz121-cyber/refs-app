# Stage 3 Bank to Reconciliation Exception authoritative readback

This same-release verifier sends authenticated `GET` requests only. It proves:

`admitted signed WBS bank statement -> exact WBS bank source/hash/version -> immutable BANK_PAYMENT_UNMATCHED finding -> open reconciliation worksheet exception -> no active Match, clearance, adjustment Draft, or Posted Journal`

API live, API ready, and the authoritative web stamp must equal the exact same
40-character `REFS_RELEASE_SHA`. All monetary evidence is exact `MONEY4` text;
JavaScript numbers are rejected.

The scenario JSON must provide the exact entity, reconciliation and revision,
statement receipt and admission hash, finding ID, bank/source IDs and versions,
source payload hash, bank account and external line identity, transaction and
statement dates, currency, amount, and signed statement balances. The verifier
fails closed on duplicates, cross-lineage substitution, an active match, any
clearance/adjustment, or a posted Journal.

```powershell
$env:REFS_STAGING_API_BASE_URL = 'https://refs-accounting-api-staging.onrender.com'
$env:REFS_STAGING_WEB_ORIGIN = 'https://refs-app.onrender.com'
$env:REFS_RELEASE_SHA = '<40-character promoted Git SHA>'
$env:REFS_STAGE3_BANK_EXCEPTION_E2E_READ_ACCESS_TOKEN = '<scoped read-only bearer token>'
$env:REFS_STAGE3_BANK_EXCEPTION_E2E_SCENARIO_PATH = 'C:\secure\stage3-bank-exception-scenario.json'
node runtime/verify-stage3-bank-exception-authoritative-e2e.mjs
```

Run from `server`. The token is used only in Authorization headers and is never
printed or retained. This readback observes a persisted signed-admission flag
and hash; it must be paired with the offline provider trust, signature, and
replay gate. It never reads WBS credentials or admits provider data.
