# Fixed asset acquisition command

`POST /api/v1/entities/{entityId}/fixed-assets/register/{assetId}/acquisitions`
connects the HTTP API to `createFixedAssetAcquisition`. It requires the authenticated
maker's `GL.JE.CREATE` permission and an `Idempotency-Key`. Tenant and actor come
from the authenticated principal; PostgreSQL checks company scope.

The closed request contains `periodId`, `journalNumber`, `journalDate`,
`expectedSourceVersion` (positive safe integer), `attachmentIds` (1–25 distinct
UUIDs) and `reason`. `If-Match` is rejected: this creates a new Draft while checking
the retained source document version. No client amounts, account codes, vendor,
currency, actor, tenant or request hashes are accepted.

The native transaction derives journal lines from reviewed evidence, binds the
original payable and attachment evidence, and persists the Draft, audit and outbox.
The response is the closed `FIXED_ASSET_ACQUISITION_DRAFT_V1` receipt with ETag `"0"`.
Creation returns 201; exact idempotent replay returns 200 and the original Draft
receipt. It does not report the current journal workflow status after later actions.
Read the journal for its current revision before submitting, reviewing or posting.

Changed source preconditions return 412. Missing original capture and ambiguous
retained attachment associations have distinct 409 error codes. Genuine database
serialization exhaustion retains the existing 503 retry behavior. Other database
authorization, financial and uniqueness constraints remain authoritative.

Verification covers HTTP input/receipt contracts and real PostgreSQL creation and
replay through this dispatcher, followed by the existing multi-role approval/Post
and duplicate-acquisition checks. The test identity is an owned fixture, not live
OIDC. The frontend command form, acquisition movement-source drill, accounting date
policy, production writer drain and deployed user acceptance remain separate work.
