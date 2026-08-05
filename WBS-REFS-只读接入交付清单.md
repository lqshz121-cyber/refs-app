# WBS to REFS Read-Only Accounting Intake Runbook

Date: 2026-08-05
Scope: production pilot reads from the existing WBS accounting and Auto Bank Reconciliation data. REFS must never reconstruct WBS business modules or write back to WBS.

## Accepted MCP contract

- Endpoint: `https://refs-mcp.wbm3.com/mcp`
- Protocol: `2025-06-18`
- Transport: HTTPS Streamable HTTP JSON-RPC.
- Authentication is injected at runtime through `CF-Access-Client-Id`, `CF-Access-Client-Secret`, and `X-REFS-Auth`. Credentials must not be committed, printed, recorded in evidence, or included in errors.
- Client pilot limits: at most 10 rows per page and at most 2 concurrent requests.

Only these eight tools are allowed:

1. `get_meta`
2. `list_payables`
3. `list_bank_transactions`
4. `list_autorec_details`
5. `list_autorec_banks`
6. `list_journal_entries`
7. `list_control_totals`
8. `trace_by_key`

Any arbitrary SQL, stored procedure, mutation tool, or unlisted tool is rejected before network dispatch.

## Response validation

Every data response must contain `contract_version`, `tool`, `environment`, `captured_at`, `source`, `scope`, `record_count`, `content_sha256`, nullable `cursor_next`, `etl_notice`, and `rows`.

`content_sha256` is a bare 64-character lowercase hexadecimal SHA-256 of `rows`. Before hashing, objects are recursively key-sorted, array order is retained, and JSON is compact UTF-8 with no whitespace or newline. REFS recomputes and compares this value exactly.

Stable record keys are:

- Payable: `ap_guid`
- Bank transaction: `cb_id`
- AutoRec detail: `pd_guid`
- AutoRec bank: `pb_guid`
- Journal entry: `id`

The pilot is USD-only. Record count, stable key, cursor, production environment, scope, timestamp, and hash mismatches fail closed.

## Accounting and AutoRec boundary

REFS may retain immutable receipt, raw, normalized, staging, exception, mapping, and review evidence. An AutoRec review candidate requires exact company, currency, bank account, opposite direction, approved date window, amount capacity, stable source versions, Bill/Journal identifiers, account transition, project references, and review events.

Missing or ambiguous evidence creates a source-scoped exception with zero candidates. The inbound path always keeps allocation, release, Draft creation, dispatch, approval, and posting disabled. Standard REFS JE commands remain a separate controlled workflow.

WBS operations such as Create, Copy, Delete, Release, Incur, Revocation, Upload, Refresh, Post, Post All, and Cancel Post are outside this connector and must never be invoked.

## Known provider limitations

The current provider contract has no revision, CDC, or tombstone semantics. REFS must compare complete snapshots and must not infer deletion or history from absence. ETL windows and `etl_notice` remain evidence, not authorization.

The production MCP pilot is read-only, but it is not a signed provider receipt. A signed nonempty provider receipt, detached key/certificate identity, signature binding, nonce/replay contract, and immutable delivery receipt remain separate release evidence if production admission requires them.

## Acceptance commands

Run without echoing any environment variables or response rows:

```powershell
cd server
node --test tests/wbs-readonly-mcp.test.mjs tests/wbs-inbound-data-adapter.test.mjs
npm.cmd test
git diff --check
```

Acceptance requires exit code 0, no credential or business-row output, exact eight-tool allowlisting, hash-tamper rejection, pagination/concurrency enforcement, and all write/JE-dispatch flags remaining false.
