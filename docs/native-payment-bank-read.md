# Native payment match readback

Migration 305 creates native payment occurrences without an imported `source_document_id`. Migration 061 permits that source to be null and copies it into the resulting bank match while retaining the journal, journal line, and ledger line. Bank transaction and reconciliation worksheet read functions return this nullable source; both OpenAPI read schemas also allow null.

The browser previously rejected every matched bank row and active worksheet row with a null business source. A regression fixture reproduced `ok: false` for a native payment match. The client now accepts an explicit null on a bank row only with `EXACT_POSTED_PAYMENT` and valid journal and journal-line identities. Worksheet rows still require their active match and journal identities. Malformed non-null sources and missing journal trace remain rejected. No source UUID is fabricated and no write permission changes.

The candidate reader is unchanged: its legacy `business_source_document_id` field is populated from the payment's business document ID, not its optional imported source. That identifier remains required.

This fixes native AP payment/AR invoice receipt readback. It does not add native Sales Receipt bank matching. That separate gap remains: migration 317 stores cash sales independently, whereas payment occurrences require an AP/AR business document and the existing candidate/match commands only support AP_PAYMENT and AR_RECEIPT. A future extension must retain a typed sales receipt source, exact posted cash-line evidence, concurrency and reconciliation guards, and match/unmatch audit history without creating a fictitious invoice.

Client regression tests cover nullable sources and malformed source/trace rejection. A deployed native payment match and reconciliation lifecycle, independent audit, and full cash-sale integration are still required for business acceptance.
