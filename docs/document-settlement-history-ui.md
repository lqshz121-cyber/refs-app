# Settlement history in document details

AP bill and AR invoice details display retained payment/receipt history for the exact source document across payment periods. Readers see reference, accounting date, payment period, exact amount/currency, occurrence state and linked journal state. Previous/Next use the API's retained occurrence cursor; Refresh restarts from the newest page. Failed reads discard the prior page instead of displaying it as current.

AP.VIEW or AR.VIEW controls the corresponding history panel. GL.JE.VIEW is required to enable journal drill buttons. The drill reads the occurrence's payment period and rejects a changed revision/status/currency before opening the existing journal/ledger/source evidence viewer. Returning restores focus to the history row.

This is a read-only view of API data. It neither synthesizes payment records from journals nor changes balances. No-result messages apply only to the selected document. The component suppresses late asynchronous results after unmount, serializes interactions, and keeps the original source-company scope while reading later payment periods.

Contract tests cover scoped GETs, precision, contaminated pages and cross-period journal details; rendering checks cover actual view permissions. Real browser keyboard/focus/resize checks and deployed business acceptance remain outstanding.
