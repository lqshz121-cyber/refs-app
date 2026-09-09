# Disposal source binding and posting integrity

Migration 337 adds an immutable source-to-Draft binding. The maker uses
POST /api/v1/entities/{entityId}/fixed-assets/disposal-source-bindings with
Idempotency-Key and If-Match. The server derives identity and scope, requires
GL.JE.CREATE, and records asset, journal, source version/hash and source link.
Binding increments the maker-owned Draft revision and commits audit/outbox
with the receipt. Exact concurrent retries return the same binding. Different
payloads under the same key and stale revisions are rejected.

The journal posting trigger locks the registered asset and revalidates current
source version, hash, status and currency. A complete asset disposal must clear
its prior Posted cost balance. Any later-dated Posted movement for the asset
prevents a backdated disposal. A unique immutable posting marker prevents a
second disposal and any subsequent asset-dimension posting, including drafts
prepared before disposal. All failures roll back posting batch, ledger, audit,
outbox and status together. Concurrent future adjustment versus backdated
disposal admits only one transaction. Source rows are locked during validation.

Disposal review requires each disposal journal's exact immutable source link.
It also validates historical impairment expense counterpart lines against the
assessment, closing the wrong-expense gap found independently in migration336.
Rollback refuses retained bindings and restores336 only when there is no new
binding history; applied migrations are unchanged.

The HTTP response validates exact requested identifiers, hash, positive source
version, incremented revision and replay flag. OpenAPI defines the receipt.
Actual PostgreSQL scenarios cover migration roundtrip, normal and impaired
flows, wrong counterpart, missing source, source drift, scoped authorization,
immutable binding, concurrent same-key binding and disposal races.

This is a backend integrity increment, not full fixed-asset delivery. Full typed
impairment/disposal Draft generation and pre-post financial reconciliation,
authoritative register/detail reads with derived disposed state, UI forms,
controlled correction of prepared bindings, and live user acceptance remain
required. Current financial disposal review occurs after journal posting;
its checks must not be represented as pre-post validation. Fixture sources do
not establish WBS production accounting authority. No deployment or real
accounting write is performed by this change.
