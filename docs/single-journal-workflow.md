# Saved journal workflow

Opening a saved Draft through the generic document, AI, or WBS handoff now reads the journal by its exact company, period, and journal ID. It opens a dedicated workflow page. It does not download every journal in the period or present a partial result as a complete register.

Each action retains the existing fresh server capability check, confirmation, revision precondition, and idempotency key. After an accepted command, the page reads that journal again and requires an increased revision and an advanced workflow state. An unconfirmed refresh removes the actionable journal until a successful refresh. Returning to the register loads the shared accounting bundle when required.

The separate cross-period settlement handoff still preloads its target scope and register. This change does not optimize that path, change server permissions, remove separation of duties, or persist navigation across a full browser restart.

Validation includes helper regression cases for direct reads, revision 9 to 10, stale revision/status, wrong period, cancellation, invalid refresh mode, and unchanged register mode. An isolated Chrome harness exercises the actual new React component at 1280 and 390 pixels with simulated capability and journal APIs: all four transitions, cancellation, focus, width containment, cache invalidation, failed refresh, and recovery. Simulated role changes are not real identity-provider or database acceptance. App-level live integration and independent audit remain required before production completion.
