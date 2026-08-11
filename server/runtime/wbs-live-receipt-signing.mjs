// Fixed receipt-signature input shared by the offline release gate and the
// read-only WBS live-acceptance verifier.  The provider signs this exact
// fixed-order UTF-8 representation, rather than a self-described hash alone.
//
// Keep this module free of I/O so validation cannot read provider data, create
// accounting records, or accidentally introduce a transport dependency.
export const WBS_LIVE_RECEIPT_SIGNING_FIELDS = Object.freeze([
  'issuer',
  'kid',
  'algorithm',
  'request_sha256',
  'response_sha256',
  'package_hash',
  'nonce',
  'signed_at',
  'expires_at',
  'tenant_id',
  'entity_id',
  'company_code',
  'immutable_version',
  'nonempty',
]);

export const canonicalWbsLiveReceiptSigningPayload = receipt => JSON.stringify(
  Object.fromEntries(WBS_LIVE_RECEIPT_SIGNING_FIELDS.map(field => [field, receipt?.[field]])),
);
