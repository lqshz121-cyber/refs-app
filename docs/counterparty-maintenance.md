# Counterparty maintenance

This candidate adds a PostgreSQL master change workflow. It does not grant any real user access or create accounting journals. The existing register remains read-only until the separate maintenance UI is connected.

`POST /api/v1/entities/{entityId}/counterparty-changes` accepts kind, memberRef, changeType (CREATE or UPDATE), displayName, active and reason. CREATE starts at revision 0 and requires active=true. UPDATE requires a strong If-Match containing the current member revision. Both require a stable Idempotency-Key. Deactivation is an UPDATE with active=false; references, kind and company remain immutable.

`POST /api/v1/entities/{entityId}/counterparty-changes/{changeId}/review` accepts decision (APPROVE or REJECT) and reason, with If-Match `"0"`. The authenticated maker cannot approve their own request, including after a role change. Approval applies the stored desired state only if the master still matches the captured revision and before-state. Rejection leaves the master unchanged.

MASTER.COUNTERPARTY.PROPOSE belongs to the DRAFT authority; MASTER.COUNTERPARTY.APPROVE belongs to APPROVE. Frozen COUNTERPARTY_MAKER and COUNTERPARTY_APPROVER bundles include existing read permissions. Definitions do not provision grants. Ordinary AP.VIEW or AR.VIEW grants cannot mutate masters.

Request receipts bind actor, tenant, company and payload. Master update, request decision, audit and outbox commit atomically. Replays return the original receipt. A failed command leaves no partial master or success receipt. Every update to a vendor/customer increments its master revision, including updates outside this command. Rollback refuses to remove retained changes or nonzero master revisions.

Migration 327 is reserved for this isolated candidate; 328 belongs to the credit attachment candidate and 329 to WBS acceptance evidence. Final integration still requires a unified migration manifest and exact candidate gates.

Scoped SQL and real HTTP tests passed in fresh PostgreSQL 15 and 16, including empty up/down, review rollback and refusal to drop retained history. The API contract defines closed request and response schemas. Initial root/server regression exposed three OpenAPI integration omissions; the corrected targeted contract tests pass, with final full reruns still required.

Pending: scoped detail/change-history and queue reads, maintenance UI, broader concurrency cases, all required full gates, independent review, and deployed business acceptance. Targeted test results are not evidence of production completion.
