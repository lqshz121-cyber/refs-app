# Observability contract (logs, metrics, alerts)

The kernel logs one JSON object per line (`{"event":..., ...}`). The authoritative
list of events, their level, safe fields and alert rule is
`runtime/observability-contract.mjs` (`EVENT_CATALOG`), enforced by
`tests/observability-contract.test.mjs`: an event the code emits but the catalog
does not know fails the suite, and so does a catalogued event nothing emits.

Database-derived metrics (`DB_METRICS`) are read-only SELECTs for a scraper on
the runtime login. The ones that page immediately are accounting controls, not
infrastructure: `posted_into_closed_period > 0`, `ap_control_out_of_balance > 0`,
`outbox_failed > 0 for 15 min`, `migration_ledger_hash != release manifest`.

Known gaps (`MISSING_EVENTS`): no access log with request id / latency, no event
when the serializable retry budget is exhausted (the 60 % of `40001` that are
deterministic CAS conflicts are invisible except as HTTP 503), no explicit
`posting_refused`, no operator-visible `period_closed` / `period_reopened`.
Adding them is a runtime change and is proposed, not done.

Redaction rules: ids only. No amounts, member or tenant names, tokens, or free
text reasons in log fields; `migration-observability.mjs` already whitelists error
codes and positions. The catalog test rejects fields whose name suggests any of
these.

Where to wire a SaaS later: ship stdout to the log sink; map `level` to
severity; implement `DB_METRICS` as scheduled queries; the alert strings are the
rules. Until then the contract is local and versioned with the code.

## database_idle_client_error (added 2026-09-17)

Staging read-back showed the API process exiting with status 1 whenever managed Postgres closed an idle pooled connection (pg emits `error` on the Pool; no listener → Node exits). `createPool` now records `{event:'database_idle_client_error',code}` and continues. Alert on rate (> 10/h), never on presence.
