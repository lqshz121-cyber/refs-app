# Authoritative browser acceptance

Status: **PREPARED, NOT EXECUTED**. This runbook requires an approved authenticated browser session, a deployed authoritative API, and a full promoted release SHA. It does not authorize a deployment, data write, Provider call, Draft, review, approval, or posting action.

## Preconditions

1. API `/health/live`, API `/health/ready`, and web `/refs-build.js` each return the same full 40-character release SHA and `Cache-Control: no-store`.
2. Web build metadata declares `channel: "AUTHORITATIVE"` and `authoritative: true`.
3. The tester has an ordinary read-only OIDC session. Do not use an administrator, write-capable token, or Provider credential.
4. Use retained API evidence only. No demo screen, seed data, `localStorage`, browser substitute, or direct database operation is acceptable evidence.

## Browser matrix

| Check | Required evidence |
| --- | --- |
| Release | Record API live/ready and `refs-build.js` full SHA values; all three match exactly. |
| Payables 1280px | Vendor selector is fully visible and usable; page body `scrollWidth <= clientWidth`. |
| Payables 900px and 200% zoom | Filters use two shrinkable columns; Vendor selector stays inside its grid track; page body has no horizontal overflow. |
| Payables 320px | Filters collapse to one column; controls remain visible, labelled, and at least 44px high. |
| Keyboard | Tab reaches Search, Status, dates, Transaction type, Vendor, Category, Reset, and table scroll region in visual order. Every focused control has a visible indicator. |
| Refresh and Back | Apply a non-sensitive filter, open retained evidence, use Back, then refresh. Query/filter/page/focus/scroll context is retained or the page explains a server-side reset. |
| Cross-entity | Attempt to open a retained record URL from a different entity scope. The API must return a rejection (normally 403/404); no other entity data may render. |
| Source trace | Source Document detail shows distinct Source payload hash, Mapping decision hash, and Company mapping hash. The response is `no-store`; mismatched/missing proof is blocked. |
| No local data | Browser storage inspection and network log show authoritative API reads only; no demo, seed, or `localStorage` business fallback. |

## Evidence packet

Save screenshots at 1280, 900/200%, and 320; record URL, viewport, release SHA, HTTP status, response `Cache-Control`, and body overflow result. Redact OIDC tokens and all Provider credentials. A failed precondition is **PARTIAL**, not a production pass.
