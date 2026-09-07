# Cash sale bank candidate foundation

The candidate API reads posted Sales Receipts by bank transaction identity using BANK.MATCH.CREATE. It preserves the receipt identity, exact amount, journal revision and cash journal/ledger line; it never creates an invoice or payment occurrence. Pages use a scoped UUID cursor and a 1–100 row bound.

Migration 320 adds a scoped sales receipt identity to bank matches, a unique active-receipt index, and a posted receipt candidate index. Candidate eligibility requires the same bank member, currency, positive amount, a date within 31 days, a matching posted journal and exactly one cash ledger line. Active bank/receipt matches are excluded. The down migration refuses to discard any retained cash-sale match history, including unmatched rows.

Local contract and OpenAPI tests cover exact scope, amount strings, ordered pages, trace identities, malformed output, denied access and invalid requests. The PostgreSQL native-sale test adds candidate readback after actual creation/Post, changed bank amounts, permission denial, a synthetic match for exclusion/history rollback checks, and down/up preservation. Those database assertions require remote verification because local Docker is unavailable. Synthetic match rows test schema and reads, not a match command or signed bank ingestion.

This is not the complete bank workflow. The cash-sale match command, source-aware bank/worksheet readback, UI, concurrency and 100,001-row performance evidence, independent audit and live business acceptance remain outstanding. The read endpoint does not confer command authorization.
