# Accounting scope read lifecycle

Changing company or period immediately revokes pending shared accounting reads
and starts loading the new scope. The previous journal workflow and reconciliation
drill are cleared with the previous scope's records. Signing out or unmounting
also revokes reads.

The app captures a generation when creating its callbacks. A delayed response
and a callback invoked later by an old component both have to match that generation
before changing state. Requests within each read channel use the most recent
request only. Separate workflow and page-refresh channels do not cancel each
other's loading completion.

This guard protects presentation state; server identity, scope authorization,
posting controls and persisted records remain governed by the API. It neither
loads records from browser storage nor grants access to additional companies.

The deterministic regression tests cover delayed company A data after company B
selection, overlapping refreshes, sign-out, concurrent workflow reads, and an old
callback invoked after switching company. Live acceptance must additionally
exercise rapid company/period switching and sign-out against real authorized
accounts, checking displayed company labels, ledger data and refresh persistence.
