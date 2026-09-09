# Original payable source evidence (348, development)

New Final-1 payable admissions retain the original raw JSON row and normalized input alongside the exact source document and line snapshots in the same PostgreSQL transaction. The original row hash uses the existing provider-compatible canonical JSON helper from migration 167, not PostgreSQL's formatted JSON hash. Raw row identity, amount, vendor, project/property, invoice dates and service fields are checked against normalized facts before retention.

The wrapper preserves the existing signed-control, typed-document and revision validations. Runtime callers cannot invoke the renamed internal retention function or insert evidence directly. Original evidence is immutable and scoped; source-line evidence fields and source-document business fields cannot subsequently change. Document workflow status/version may still advance. Corrections need a new source version.

There is no backfill from current normalized values. An idempotent replay without an existing original evidence record cannot certify historical source rows. New capture requires document and line tuples written in the current transaction. An owned database test removes only the new capture record to emulate pre-348 data, changes a same-amount source fact, and verifies replay rejection without creating original evidence.

The immutable retained source row must also originate in that transaction. Its creation identity cannot be refreshed by no-op updates to mutable source records; a real runtime replay test exercises that attempt. A generated whole-evidence hash covers scope, source identities, raw and normalized facts and both snapshots. Its audit and outbox events commit with capture, and replay creates neither duplicate evidence nor duplicate events.

The down migration refuses to discard retained original evidence. Installation and rollback are blocking operations requiring drained writers; production enforcement remains a separate release requirement.

This is a prerequisite for the fixed-asset original-source hash check, not completion of it. Native Draft/Post still need classification/proposal/retained-row/raw-event/current-version/policy checks and an immutable binding to this evidence. Existing assets without verifiable original evidence must not be silently certified. Live provider authenticity, all business modules and final production acceptance remain outside these focused tests.
