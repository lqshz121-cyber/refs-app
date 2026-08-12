# WBS signed production delivery and REFS admission

## Status and boundary

The 2026-08-03 contract and 2026-08-05 delivery note provide a read-only
Production MCP endpoint and two-layer access credentials. They do **not**
provide an Ed25519 trust pin, a provider signing key workflow, a signed live
receipt, a signed `WBS_READONLY_SNAPSHOT_V2` package, or immutable raw request,
response, and package artifacts. Those documents therefore authorize only the
existing `UNSIGNED_PILOT`; they cannot satisfy production admission by
themselves.

The access credentials printed in the delivery note must be rotated and stored
only in deployment secret management. They must never be copied into this
repository, a receipt, a capture manifest, or test output.

## Decision

Production delivery uses two independent Ed25519 signatures from one pinned
provider key:

1. The provider signs the canonical `package_hash` inside one complete,
   nonempty, company-scoped `WBS_READONLY_SNAPSHOT_V2` package.
2. The provider separately signs the fixed live-receipt payload. That receipt
   binds the exact raw MCP request bytes, raw MCP response bytes, canonical
   package bytes, unique nonce, 15-minute validity window, tenant, entity,
   company, and immutable snapshot id.
3. REFS obtains `{issuer, key_id, public_key, fingerprint_sha256}` through a
   channel separate from the evidence bundle and pins it before verification.
4. The offline REFS verifier checks both signatures, all raw hashes, expiry,
   exact independently configured scope, nonempty package contents, and package
   capture time. It then writes a private, write-once capture directory keyed by
   provider nonce. Reusing the nonce fails closed.
5. Verification does not import. The capture creates an exact request for the
   existing authenticated endpoint:
   `POST /api/v1/entities/{entityId}/wbs/snapshots`. That endpoint still derives
   tenant/entity from OIDC, verifies the pinned package signature again, applies
   idempotency, and records only immutable WBS snapshot receipts. It does not
   write WBS or create, approve, or post a journal.

## Provider command

The provider keeps its PKCS#8 Ed25519 private key outside the repository and
runs `npm run wbs:signed-delivery:create --` from `server` with:

- `--snapshot`, `--request-raw`, `--response-raw`, `--private-key`
- `--issuer`, `--key-id`, and a new unique `--nonce`
- `--tenant-id`, `--entity-id`, `--company-code`
- `--output-dir` for the evidence bundle
- `--trust-output` for the public trust record delivered separately

Optional `--signed-at` and `--expires-at` values must be canonical UTC. The
maximum lifetime is 15 minutes. The tool never generates a key and never sends
data over the network.

## REFS verification and capture command

Run `npm run wbs:signed-delivery:verify --` from `server` with:

- the separately pinned `--provider-trust`
- `--receipt`, `--request-raw`, `--response-raw`, and `--package-raw`
- independently configured `--tenant-id`, `--entity-id`, `--company-code`
- an operator-controlled, encrypted `--capture-dir` outside the repository

A success result is
`VERIFIED_CAPTURED_PENDING_AUTHORITATIVE_API`, not imported or posted. The
capture contains `capture-manifest.json` and `admission-request.json`; the API
call remains an explicit authenticated operator action. The existing release
gate must still verify the same real provider artifacts. Local simulation keys
or receipts never satisfy the production gate.
