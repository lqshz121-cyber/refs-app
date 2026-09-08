# Fixed asset original source binding (349, development)

Native acquisition Draft creation now retains a separate immutable relationship to migration 348's original payable evidence ID and whole-evidence hash. Scope and acquisition identity use composite foreign keys. Binding creation emits a business audit and outbox event containing the exact original evidence identity; the financial Draft and binding commit or roll back together.

Draft and Post validate the reviewed asset, capitalization proposal and classification against the retained source row and original snapshots. They compare source line hashes to the canonical raw-row hash, document and line identities, accounting period, currency and amount, source dimensions, raw event identity/currentness and admission package hash. A missing original capture cannot be inferred from the current normalized row.

The policy identity is checked against its stored content hash, entity scope and closed schema. Its validity is anchored to the proposal period end, matching migration 194's policy reader. A policy effective after the invoice date but valid at period end is a positive test; expired and incorrectly scoped policies are rejected.

Post repeats the checks under the existing acquisition source locks and a shared raw-event lock. Real two-connection tests verify that source supersession committed first makes Post reject with no accounting artifacts, while Post committed first retains its original evidence relationship and the later source update remains possible. Missing bindings also reject Post atomically.

Migration verifies existing bindings only when matching original capture already exists. It records distinct migration verification audit/outbox events with the actual database session identity, rather than attributing the migration to the original Draft creator. Unverifiable history aborts the migration without partial schema or financial changes. Downgrade refuses to discard retained original bindings. Installation and rollback require drained accounting writers; enforcement in production remains unverified.

Native test fixtures now import actual retained payable rows with canonical hashes and valid policy evidence. The older synthetic source fixture remains only for read-only register tests and explicit missing-original negative cases. None of these fixtures establishes live provider authenticity.

PG16 development tests cover layered migration rollback, historical verification/failure, missing capture and hash drift, policy validity/scope, Post revalidation, both supersession transaction orders, and the complete native acquisition workflow. Exact final gates, full PostgreSQL regression (including other payable users), HTTP/OpenAPI/UI, movement drill, accounting date policy, correction workflows and production acceptance remain required.
