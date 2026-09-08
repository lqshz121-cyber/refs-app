# Typed bank source evidence in the browser

Bank and reconciliation worksheet parsing now retains the explicit source kind, payment occurrence identity, Sales Receipt identity/number/revision and ledger identity returned by migration 322. A cash-sale rule requires complete typed receipt evidence and exact posted journal/line/ledger identities. Mixed identities, partial envelopes, invalid revisions and source metadata on unmatched worksheet rows fail validation. Receipt revisions remain strings, including values above JavaScript's safe integer range.

Older deployed readers with none of the typed fields retain their existing parsing behavior. This compatibility does not infer cash sales from null imported sources and does not accept a partial new response.

Bank detail shows the actual receipt number or payment identity and supplied ledger line. Bank detail and active worksheet rows include an expandable source detail with receipt/payment ID and journal/line/ledger evidence. Historical bank matches retain the source detail. This displays evidence; opening the business document itself remains a separate navigation requirement.

API fixtures cover active/history cash-sale readback, exact revision retention, mixed/missing identities and worksheet validation. SSR covers the receipt summary and actual ledger display. An isolated Chrome fixture renders the actual bank detail and API parser at 1280 and 390 pixels, checking ten conditions at each width, including keyboard expansion/collapse, focus, horizontal overflow and absence of fixture writes/errors. Its API response is mocked. Added PostgreSQL acceptance exercises actual database-to-API wire serialization through both browser readers and awaits remote execution.

Cash-sale candidate selection and matching controls, direct business-document navigation, signed reconciliation/unmatch concurrency, independent review and live identity/business acceptance remain required. No live deployment or production-completeness claim is made.
