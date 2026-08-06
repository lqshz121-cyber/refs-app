# WBS read-only MCP — what already existed vs. what this branch added

Base commit: `1233a13` (`docs(wbs): normalize readonly MCP runbook`)
Branch: `claude/wbs-mcp-lineage-review-20260805`
Task: TASK-TO-CLAUDE-2026-08-05-002 (official WBS MCP accounting-field mapping review)

This branch is a **review and gap-closure** pass, not a greenfield build. A
previous plan document assumed the WBS MCP work did not exist. It does. This
file records the honest before/after so the diff can be judged accurately.

---

## 1. What already existed at base `1233a13`

### Read-only MCP client and contract — `server/runtime/wbs-readonly-mcp.mjs`

- The eight approved read-only tool names, frozen:
  `get_meta`, `list_payables`, `list_bank_transactions`, `list_autorec_details`,
  `list_autorec_banks`, `list_journal_entries`, `list_control_totals`,
  `trace_by_key`.
- `WBS_READONLY_ROW_FIELDS` — a frozen row-field **allowlist** (names only, no
  types) for six of the eight tools.
- `validateWbsReadEnvelope` — envelope-level contract: `content_sha256` over
  canonical sorted-compact rows, `record_count`, `environment === production`,
  `captured_at`, `source`, `scope`, `cursor_next`, `etl_notice`; a per-tool
  stable-key presence check for five tools; a USD-only row-currency check; and
  the explicit flags `requires_snapshot_diff: true`, `has_revision_contract:
  false`, `has_cdc_contract: false`, `has_tombstone_contract: false`.
- A hardened JSON-RPC / Streamable-HTTP client: single approved endpoint,
  injected credential-header provider, bounded event stream, request
  correlation, session handling, forbidden raw-query arguments, pilot page limit
  10, max concurrency 2, and fail-closed error codes.
- Tests: `server/tests/wbs-readonly-mcp.test.mjs`.

### Inbound adapter and pipeline — `server/runtime/wbs-inbound-data-adapter.mjs`

- `VIEW_TYPES` mapping the WBS snapshot view names
  (`BGDATA.payable`, `BGDATA.bank_transaction`, `BGDATA.autoc_detail`,
  `BGDATA.autoc_bank`, `accounting.accounting_info`, `accounting.balance_cell`,
  `accounting.income_cell`) to REFS source types.
- A `Raw → Normalized → Staging/Exception` preparation path over a **signed
  snapshot package** (`wbs-snapshot-package.mjs`, `wbs-snapshot-signature.mjs`).
- `evaluateWbsAutoReconciliationEligibility` / `buildAutoReconciliationReviewRequest`
  — the AutoRec eligibility gate (receipt, trace, direction, bank account,
  company, currency, date window, amount tolerance).
- `buildStandardDraftRequest`, `buildWbsInboundPersistencePlan`,
  `createWbsInboundOrchestrator`, `validatePostedJournalTrace`.
- `WBS_AUTOREC_OBSERVED_CONTRACT` — observed source/come-from vocabularies and
  the forbidden WBS operation list.

### Persistence, projection, contracts, docs

- Migrations `001` (full accounting/WBS object set incl. `raw_event`,
  `sync_cursor`, `mapping_snapshot`, `accounting_exception`), `054`–`056`,
  `058`, `059`.
- `wbs-inbound-persistence.mjs`, `wbs-inbound-autorec-projection.mjs`,
  `wbs-inbound-autorec-read-composition.mjs`,
  `wbs-inbound-autorec-postgres-reader.mjs`.
- `tools/verify-wbs-mcp-contract-live.mjs` — a sanitized live contract verifier
  (env-gated, never run in CI) plus its own test.
- Contract docs: `WBS-SOURCE-CONTRACT.md`, `contracts/WBS-DATA-SOURCE-SPEC.md`,
  `contracts/WBS-READONLY-VIEW-DELIVERY-REQUEST.md`,
  `contracts/ERROR-CODES.md`, `contracts/STATE-MACHINES.md`,
  `REFS-ARCHITECTURE-V2.md` §6 and §11.
- Exception **fixtures** (declarative JSON, asserted structurally by
  `server/tests/wbs-contract.test.mjs` against the SQL contract):
  `ambiguous-mapping`, `attachment-hash-mismatch`, `duplicate-raw-replay`,
  `matchinfo-missing-fields`, `out-of-order-tombstone`, `report-as-source`.
- App-side WBS accounting foundation and acceptance suites
  (`src/wbs-accounting-foundation.js`, `npm run test:wbs-accounting-foundation`,
  `npm run test:wbs-accounting-acceptance`, `npm run test:autorecon`).

## 2. The real gaps at base

1. **No per-source schema.** The six frozen allowlists were field *names* only.
   Nothing declared a type, a required flag, a date format or an account-code
   format, so "validate or raise a scoped exception" was not executable.
2. **`get_meta` and `trace_by_key` had no declared field surface at all** —
   two of the eight sources were named but not mapped.
3. **No executable stable-key derivation.** `stableKeyByTool` checked that a key
   *field was present*; nothing composed
   `source_system + source_id + source_version` into a replay-stable key, and
   nothing proved two replays produce identical keys.
4. **No `source_version` story for a source with no revision/CDC/tombstone
   contract.** The envelope declared `has_revision_contract: false` but nothing
   consumed that fact.
5. **Exception handling was scattered and unnamed.** The adapter emitted a
   single `WBS_RECEIPT_FIELD_MISSING`; the MCP client threw transport-level
   codes; the six JSON fixtures declared invariants but were not executed
   against any mapper. There was no single scoped-exception taxonomy covering
   cross-company, changed replay, hash mismatch, missing stable key,
   unsupported currency, ambiguous mapping and incomplete trace.
6. **No cursor semantics.** `cursor_next` was validated as "null or string" and
   `sync_cursor` existed in SQL, but there was no cursor object, no
   incremental/exhausted/blocked state machine and no replay-from-zero path.
7. **The MCP tool surface and the inbound adapter were not connected.** The
   adapter worked off snapshot `views` (`BGDATA.*` / `accounting.*`); the MCP
   client worked off tool names (`list_*`). Nothing joined them, so there was no
   end-to-end map from the eight tools through the pipeline.
8. **No `docs/` directory.** No document stated stable keys, field mappings,
   cursor semantics or mapping coverage.

## 3. What this branch added

| File | Status | What it is |
|---|---|---|
| `server/runtime/wbs-mcp-lineage.mjs` | new | The executable eight-source catalog with typed closed schemas, stable-key derivation, scoped exception taxonomy, cursor state machine, mapping resolution and the full `Receipt → Raw → Normalized → Staging/Exception → Mapping Review → AutoRec Review → JE request seam / evidence seam` mapper. |
| `server/tests/wbs-mcp-lineage.test.mjs` | new | 34 `node --test` cases on sanitized fixtures covering catalog integrity, coverage, key determinism, the happy path for all eight sources, every exception class, cursor semantics, replay from zero, and the accounting red lines. |
| `verify-wbs-mcp-lineage.mjs` | new | Root verifier (auto-discovered by `tools/run-verifiers.mjs`, so it runs inside `npm run test:visual`) binding `docs/WBS-MCP-LINEAGE.md` to the catalog and re-asserting the credential-free constraint. |
| `docs/WBS-MCP-LINEAGE.md` | new | The catalog, per-source field maps, stable keys, exception taxonomy, cursor semantics, coverage table and red-line statement. |
| `docs/WBS-MCP-CURRENT-STATE.md` | new | This file. |
| `package.json` | edited | Added `test:wbs-mcp-lineage` and wired it into `npm run test`. |
| `server/package.json` | edited | Added the lineage test to the server `node --test` list. |

**Nothing existing was deleted or rewritten.** The new module *imports* the
frozen contract rather than restating it:

- schemas for the six allowlisted tools are asserted field-for-field equal to
  `WBS_READONLY_ROW_FIELDS` (`verifyCatalogAgainstFrozenRowFields`), so the
  catalog cannot drift;
- the receipt stage calls the existing `validateWbsReadEnvelope` and translates
  its `WbsMcpError` codes into scoped lineage exceptions;
- the AutoRec stage hands off to the existing
  `evaluateWbsAutoReconciliationEligibility` rather than duplicating pairing
  logic;
- the JE stage names the existing `buildStandardDraftRequest` as the required
  human command rather than building a Draft.

## 4. Known gaps that remain (not closed on this branch)

1. **`get_meta` and `trace_by_key` schemas are REFS-declared, not provider-confirmed.**
   They are tagged `REFS_DECLARED_PENDING_PROVIDER_CONFIRMATION` in the catalog
   and flagged in the docs. WBS/IT must confirm the real field surface before
   production admission. Closing this needs provider input, not code.
2. **`WBS_MCP_ORIGIN` in `server/runtime/wbs-readonly-mcp.mjs` pins a hostname
   in source, and `tools/verify-wbs-mcp-contract-live.mjs` repeats it.** This
   pre-dates this branch and its existing tests assert on it, so removing it is
   a separate, coordinated change. The new lineage module contains no host,
   endpoint, header name, token or network call, and both its test suite and its
   verifier assert that.
3. **`WBS-SOURCE-CONTRACT.md` §1 points at `server/domain/wbs-readonly-mcp.mjs`
   and `server/domain/wbs-readonly-snapshot.mjs`; the real paths are
   `server/runtime/wbs-readonly-mcp.mjs` and
   `server/runtime/wbs-snapshot-package.mjs`.** Documentation drift that
   pre-dates this branch; left alone to keep the diff inside scope.
4. **The lineage cursor is in-memory only.** Persisting it into `sync_cursor`
   is a kernel command and would require a migration and an authorization path,
   which is out of scope for a read-only mapping review.
5. **`list_autorec_details` still cannot self-attest a company.** The mapper
   fails closed with `WBS_LINEAGE_CROSS_COMPANY` when the read scope does not
   pin one. A provider-side company column would be the real fix.
6. **The six declarative fixtures in `server/tests/fixtures/wbs/` remain
   contract assertions against SQL**, not inputs to the lineage mapper. The new
   suite builds its own sanitized envelopes because the fixtures describe raw
   events, not MCP envelopes. Converging the two is a reasonable follow-up.

## 5. Boundaries respected

- **No production. No write.** Read-only throughout; no WBS write path exists in
  the added code, no journal is created, approved, dispatched or posted, and no
  accounting calculation, state machine, API contract or authorization behaviour
  was changed.
- **Credential-free.** No credential, token, cookie, URL, hostname or header
  name was added, logged, exported or embedded. No live network call. All tests
  run on synthetic sanitized fixtures.
- No UI file was touched (`index.html`, `src/ui.jsx`, `src/app.jsx`,
  `src/module-banktx.jsx`, `src/module-bankrec.jsx` are unchanged).
- Committed locally only; not pushed, not merged.
