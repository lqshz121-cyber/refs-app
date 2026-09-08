# Native fixed asset acquisition — implementation in progress

Migration 341 and `PostgresAccountingKernel.createFixedAssetAcquisition` create a Draft using an independently reviewed asset, its capitalization proposal and exact retained source line. The server derives the amount, accounts, currency, dimensions and active vendor identity. Caller-controlled values are journal number/date, accounting period, expected source version, attachment IDs and reason. Existing PostgreSQL Draft validation and attachment ownership apply.

The transaction retains an immutable source/version/line snapshot, source-to-journal link and full financial journal snapshot with audit, outbox and actor-bound idempotency. Multiple unposted Drafts are allowed. Bound acquisition Post rejects source drift and financial changes, locks the asset and admits one acquisition posting. The existing Submit/Review/Approve/Post workflow remains authoritative.

Real PostgreSQL 15 and 16 focused tests each passed 2/2 without skips on the working implementation: Draft/replay/conflict, tenant and role rejection, missing attachments, derived two-line financial content, four-role workflow, source-version drift rollback, duplicate acquisition rejection, immutable bindings and migration down/up in a rollback transaction. These are isolated fixture results, not live acceptance.

Remaining work before acceptance:

- Add the closed HTTP/OpenAPI command and native entry form with company scope and useful validation messages.
- Validate the retained original classification source-line hash, not only a snapshot at Draft creation; enforce project/property and source lineage consistency.
- Prevent unbound manual acquisition postings, including manual duplicates after a native acquisition. Migration 341 currently guards bound native acquisition journals only. Update existing asset fixtures to use the native acquisition operation when this global guard is added.
- Add concurrency, financial line mutation and source-line drift rejection tests; verify historical acquisition/date interactions and negative-money cases.
- Expose exact acquisition binding in movement/source drill contracts; add period-bound depreciation and pre-Post impairment binding, correction/reversal workflows.
- Finish exact committed root/server/build/PG15/16 gates, independent audit and real API/identity/browser acceptance. No production release is authorized by these isolated results.
