# Fixed asset workspace

The Fixed assets route reads the authenticated company register as of a local calendar date. It uses the V2 register and V1 movement contracts shared with the API; amounts remain four-place decimal strings and page cursors remain opaque. Tenant identity comes from the validated access/self response for the selected company. Access-read failures expose a retry instead of leaving the asset list loading indefinitely.

The list supports paging, date changes, refresh, detail loading and retry. Opening an asset focuses its detail heading; closing restores the originating button and list/window scroll. Date and list-page changes discard the selected detail. Pending list/detail responses cannot replace a newer company/date request.

Posted activity lists actual ledger rows. Journal buttons fetch the retained accounting period and verify the journal number, date, type, posting instant (at the journal API’s millisecond precision), full line count and debit/credit totals, plus the selected journal line, ledger line, account, currency and amounts before showing journal evidence. Posting-source buttons exist only for an exact retained disposal source binding. The source read must match its retained hash, document revision, currency and posted journal relationship. Returning from evidence restores the originating activity button.

## Verification limits

Owned browser fixtures cover desktop/mobile layout, paging, errors/retry, stale date responses, asset focus return, successful journal/source/linked-journal navigation, activity focus return and rejected changed source revisions. These fixtures are UI evidence only. They are not real PostgreSQL browser E2E, live deployment acceptance, or evidence of real accounting writes.

The page does not create, edit, depreciate or dispose assets. Acquisition/depreciation/impairment posting-source bindings remain an explicit backend gap; the page displays missing source links as missing. Assessment identifiers are readable trace references, not a completed assessment drill workflow. The full asset module and original platform goal remain incomplete until command workflows, real-data browser acceptance and deployment checks pass.
