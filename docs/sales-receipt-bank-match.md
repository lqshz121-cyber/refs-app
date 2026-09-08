# Sales Receipt bank match command

The command accepts a bank transaction and posted Sales Receipt with expected revisions and a review reason. It requires the existing BANK.MATCH.CREATE permission and a server-derived actor. The request hash and idempotency receipt bind the original request; replay by another actor is rejected.

It shares the account advisory lock used by reconciliation sign-off, then locks the bank row and receipt. Signed reconciliation coverage requires reopening before a new match. It rechecks posted state, bank member, currency, amount, date window, journal identity and one exact immutable cash ledger line. An active match for either source prevents duplication. A unique index also protects against races.

Match, source trace, audit, outbox and idempotency receipt commit atomically. Matching does not create or change a journal, ledger line, invoice or allocation. Migration 321 down removes command functions while leaving match history; migration 320 still refuses to remove typed source history.

Contract tests cover body/header validation, trusted scope, replay status, unavailable service and malformed receipts. PostgreSQL test additions use an actual created/posted cash sale, concurrent identical requests, later replay, changed request, another authorized actor, active-match conflict, candidate exclusion, unchanged ledger count and single audit/outbox event. These database additions await execution; local Docker is unavailable.

This command is not a complete end-user workflow. Typed bank/worksheet readback and UI, sign-off/unmatch concurrency acceptance, 100,001-row performance, independent audit and live business acceptance remain required. Existing payment matching remains separate and unchanged.
