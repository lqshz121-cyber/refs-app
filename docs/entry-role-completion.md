# Sales receipt entry and attachment worker identities

`AR_SALES_RECEIPT_ENTRY_MAKER` is a human Draft role with the shared accounting
read permissions, `AR.SALES_RECEIPT.CREATE` and `ATTACHMENT.CREATE`. PostgreSQL
already maps the sales receipt creation permission to Draft. Migration 331's
upload compatibility therefore supports this role without another migration.
Runtime separation checks now include sales receipt creation in the maker group
and reject adding Submit, Review, Approve or Post to this role.

The formal-role PostgreSQL test now covers five entry roles. For sales receipts
it uses the granted role and issued context to create an actual Draft with
verified attachment evidence and checks the journal creator. The test also
creates a pending upload, checks replay and stale revisions, replaces the role
and verifies that the old context cannot upload. This does not replace the
separate full sales receipt posting and business acceptance scenarios.

Service role configuration uses the identity consumed by its own runtime:

| Service role | Required identity setting |
| --- | --- |
| `WBS_SNAPSHOT_IMPORTER_SERVICE` | `WBS_PROVIDER_SIGNED_SERVICE_ACTOR_ID` |
| `ATTACHMENT_SCANNER_SERVICE` | `ATTACHMENT_SCANNER_ACTOR_ID` |
| `ATTACHMENT_CLEANUP_SERVICE` | `ATTACHMENT_CLEANUP_ACTOR_ID` |
| `OUTBOX_DISPATCHER_SERVICE` | `OUTBOX_DISPATCH_ACTOR_ID` |

Previously scanner and cleanup grant configuration fell back to the WBS
identity. Missing worker-specific settings now fail configuration parsing even
when a WBS identity is present. This prevents assigning a worker's permission
to a different configured service merely because that setting exists.

These definitions do not reconcile live grants or repair any grants previously
assigned to the wrong actor. Those operations require inspection of the actual
deployment, reviewed actor identities and the existing exact-version grant
workflow. No person or service receives new permissions by loading this module.
